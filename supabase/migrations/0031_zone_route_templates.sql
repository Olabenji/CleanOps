-- Sprint 7: zone/temp route templates, daily auto-load, driver fallback, route-change notices.

create type public.route_template_kind as enum ('zone_default', 'temporary');

create table public.route_templates (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  zone_id uuid not null references public.zones(id) on delete cascade,
  kind public.route_template_kind not null,
  name text not null,
  truck_id uuid references public.trucks(id) on delete set null,
  driver_id uuid references public.staff_members(id) on delete set null,
  source_route_id uuid references public.routes(id) on delete set null,
  created_by_staff_id uuid references public.staff_members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint route_templates_name_not_blank check (length(trim(name)) > 0)
);

create unique index route_templates_one_zone_default
  on public.route_templates (operator_id, zone_id)
  where kind = 'zone_default';

create index route_templates_operator_zone_idx
  on public.route_templates (operator_id, zone_id, kind);

create table public.route_template_stops (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.route_templates(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  stop_sequence integer not null check (stop_sequence > 0),
  unique (template_id, stop_sequence),
  unique (template_id, customer_id)
);

create table public.driver_route_notices (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  route_id uuid references public.routes(id) on delete cascade,
  driver_id uuid not null references public.staff_members(id) on delete cascade,
  notice_type text not null check (notice_type in ('route_plan_changed', 'routes_auto_loaded')),
  title text not null,
  body text not null,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

create index driver_route_notices_pending_idx
  on public.driver_route_notices (driver_id, created_at desc)
  where acknowledged_at is null;

alter table public.route_templates enable row level security;
alter table public.route_template_stops enable row level security;
alter table public.driver_route_notices enable row level security;

comment on table public.route_templates is
  'Zone default and temporary route templates used to plan daily routes.';
comment on column public.route_templates.kind is
  'zone_default = canonical per-zone template; temporary = one-off saved plan that does not replace the zone default.';

create or replace function public.current_staff_member_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select staff_members.id
  from public.staff_members
  where staff_members.profile_id = auth.uid()
    and staff_members.active
  limit 1;
$$;

create or replace function public.notify_route_plan_drivers(
  input_route_id uuid,
  input_notice_type text default 'route_plan_changed',
  input_title text default 'Route plan updated',
  input_body text default 'Your route plan was changed by the operator. Pull to refresh for the latest stops and assignment.'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  route_record public.routes%rowtype;
begin
  select *
  into route_record
  from public.routes
  where id = input_route_id;

  if route_record.id is null or route_record.driver_id is null then
    return;
  end if;

  if route_record.status in ('completed', 'cancelled') then
    return;
  end if;

  insert into public.driver_route_notices (
    operator_id,
    route_id,
    driver_id,
    notice_type,
    title,
    body
  )
  values (
    route_record.operator_id,
    route_record.id,
    route_record.driver_id,
    input_notice_type,
    input_title,
    input_body
  );
end;
$$;

create or replace function public.upsert_zone_default_template_from_route(input_route_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  route_record public.routes%rowtype;
  new_template_id uuid;
  zone_name text;
begin
  select *
  into route_record
  from public.routes
  where id = input_route_id;

  if route_record.id is null then
    raise exception 'Route not found';
  end if;

  select name into zone_name from public.zones where id = route_record.zone_id;

  insert into public.route_templates (
    operator_id,
    zone_id,
    kind,
    name,
    truck_id,
    driver_id,
    source_route_id,
    created_by_staff_id,
    updated_at
  )
  values (
    route_record.operator_id,
    route_record.zone_id,
    'zone_default',
    coalesce(zone_name, 'Zone') || ' default',
    route_record.truck_id,
    route_record.driver_id,
    route_record.id,
    public.current_staff_member_id(),
    now()
  )
  on conflict (operator_id, zone_id) where (kind = 'zone_default')
  do update set
    truck_id = excluded.truck_id,
    driver_id = excluded.driver_id,
    source_route_id = excluded.source_route_id,
    created_by_staff_id = coalesce(excluded.created_by_staff_id, public.route_templates.created_by_staff_id),
    updated_at = now()
  returning id into new_template_id;

  delete from public.route_template_stops
  where route_template_stops.template_id = new_template_id;

  insert into public.route_template_stops (template_id, customer_id, stop_sequence)
  select
    new_template_id,
    route_stops.customer_id,
    row_number() over (order by route_stops.stop_sequence)
  from public.route_stops
  join public.customers on customers.id = route_stops.customer_id
  where route_stops.route_id = route_record.id
    and customers.zone_id = route_record.zone_id
  order by route_stops.stop_sequence;

  return new_template_id;
end;
$$;

-- Unique partial index conflict target needs constraint name for ON CONFLICT in some PG versions.
-- Recreate as named unique constraint via index — ON CONFLICT (operator_id, zone_id) WHERE works in PG 15+.

create or replace function public.save_route_as_template(
  input_route_id uuid,
  input_kind public.route_template_kind,
  input_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  route_record public.routes%rowtype;
  new_template_id uuid;
  zone_name text;
  stop_count integer;
begin
  if public.current_app_role() not in ('operator_owner', 'operations_supervisor') then
    raise exception 'Only operators and supervisors can save route templates';
  end if;

  select *
  into route_record
  from public.routes
  where id = input_route_id
    and operator_id = public.current_operator_id();

  if route_record.id is null then
    raise exception 'Route not found';
  end if;

  select name into zone_name from public.zones where id = route_record.zone_id;

  if input_kind = 'zone_default' then
    new_template_id := public.upsert_zone_default_template_from_route(input_route_id);
  else
    insert into public.route_templates (
      operator_id,
      zone_id,
      kind,
      name,
      truck_id,
      driver_id,
      source_route_id,
      created_by_staff_id
    )
    values (
      route_record.operator_id,
      route_record.zone_id,
      'temporary',
      coalesce(nullif(trim(input_name), ''), coalesce(zone_name, 'Zone') || ' temp ' || to_char(now(), 'YYYY-MM-DD HH24:MI')),
      route_record.truck_id,
      route_record.driver_id,
      route_record.id,
      public.current_staff_member_id()
    )
    returning id into new_template_id;

    insert into public.route_template_stops (template_id, customer_id, stop_sequence)
    select
      new_template_id,
      route_stops.customer_id,
      row_number() over (order by route_stops.stop_sequence)
    from public.route_stops
    join public.customers on customers.id = route_stops.customer_id
    where route_stops.route_id = route_record.id
      and customers.zone_id = route_record.zone_id
    order by route_stops.stop_sequence;
  end if;

  select count(*) into stop_count
  from public.route_template_stops
  where route_template_stops.template_id = new_template_id;

  if stop_count = 0 then
    raise exception 'Cannot save a template with no in-zone stops';
  end if;

  return jsonb_build_object(
    'id', new_template_id,
    'kind', input_kind,
    'zoneId', route_record.zone_id,
    'zoneName', zone_name,
    'stopCount', stop_count
  );
end;
$$;

create or replace function public.ensure_zone_default_templates(input_operator_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  template_route record;
  created_count integer := 0;
begin
  for template_route in
    select distinct on (routes.zone_id)
      routes.id
    from public.routes
    where routes.operator_id = input_operator_id
      and routes.status != 'cancelled'
      and exists (
        select 1
        from public.route_stops
        join public.customers on customers.id = route_stops.customer_id
        where route_stops.route_id = routes.id
          and customers.zone_id = routes.zone_id
      )
      and not exists (
        select 1
        from public.route_templates
        where route_templates.operator_id = input_operator_id
          and route_templates.zone_id = routes.zone_id
          and route_templates.kind = 'zone_default'
      )
    order by routes.zone_id, routes.scheduled_date desc, routes.created_at desc
  loop
    perform public.upsert_zone_default_template_from_route(template_route.id);
    created_count := created_count + 1;
  end loop;

  return created_count;
end;
$$;

create or replace function public.plan_daily_routes(input_scheduled_date date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_id uuid := public.current_operator_id();
  planned_count integer := 0;
  zone_row record;
  template_row public.route_templates%rowtype;
  prior_route public.routes%rowtype;
  new_route_id uuid;
  template_id uuid;
begin
  if tenant_id is null then
    raise exception 'Operator profile not found';
  end if;

  if public.current_app_role() not in ('operator_owner', 'operations_supervisor', 'driver') then
    raise exception 'Not allowed to plan daily routes';
  end if;

  -- Drivers may only auto-load for today (enforced by caller); operators any date.
  if public.current_app_role() = 'driver' and input_scheduled_date <> current_date then
    raise exception 'Drivers can only load default routes for today';
  end if;

  perform public.ensure_zone_default_templates(tenant_id);

  for zone_row in
    select zones.id, zones.name
    from public.zones
    where zones.operator_id = tenant_id
    order by zones.name
  loop
    if exists (
      select 1
      from public.routes
      where operator_id = tenant_id
        and zone_id = zone_row.id
        and scheduled_date = input_scheduled_date
        and status != 'cancelled'
    ) then
      continue;
    end if;

    select *
    into template_row
    from public.route_templates
    where operator_id = tenant_id
      and zone_id = zone_row.id
      and kind = 'zone_default';

    if template_row.id is null then
      select *
      into prior_route
      from public.routes
      where operator_id = tenant_id
        and zone_id = zone_row.id
        and scheduled_date < input_scheduled_date
        and status != 'cancelled'
        and exists (
          select 1
          from public.route_stops
          join public.customers on customers.id = route_stops.customer_id
          where route_stops.route_id = routes.id
            and customers.zone_id = routes.zone_id
        )
      order by scheduled_date desc, created_at desc
      limit 1;

      if prior_route.id is null then
        continue;
      end if;

      template_id := public.upsert_zone_default_template_from_route(prior_route.id);
      select * into template_row from public.route_templates where id = template_id;
    end if;

    if not exists (
      select 1 from public.route_template_stops where template_id = template_row.id
    ) then
      continue;
    end if;

    insert into public.routes (
      operator_id,
      zone_id,
      truck_id,
      driver_id,
      scheduled_date,
      status
    )
    values (
      tenant_id,
      zone_row.id,
      template_row.truck_id,
      template_row.driver_id,
      input_scheduled_date,
      'scheduled'
    )
    returning id into new_route_id;

    insert into public.route_stops (
      route_id,
      customer_id,
      stop_sequence,
      status
    )
    select
      new_route_id,
      route_template_stops.customer_id,
      row_number() over (order by route_template_stops.stop_sequence),
      'pending'
    from public.route_template_stops
    join public.customers on customers.id = route_template_stops.customer_id
    where route_template_stops.template_id = template_row.id
      and customers.zone_id = zone_row.id
    order by route_template_stops.stop_sequence;

    if not exists (select 1 from public.route_stops where route_id = new_route_id) then
      delete from public.routes where id = new_route_id;
      continue;
    end if;

    planned_count := planned_count + 1;
  end loop;

  return planned_count;
end;
$$;

create or replace function public.ensure_daily_routes_loaded(input_scheduled_date date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_id uuid := public.current_operator_id();
  existing_count integer;
  planned_count integer := 0;
begin
  if tenant_id is null then
    raise exception 'Operator profile not found';
  end if;

  if public.current_app_role() not in ('operator_owner', 'operations_supervisor') then
    raise exception 'Only operators and supervisors can ensure daily routes';
  end if;

  select count(*)
  into existing_count
  from public.routes
  where operator_id = tenant_id
    and scheduled_date = input_scheduled_date
    and status != 'cancelled';

  if existing_count = 0 then
    planned_count := public.plan_daily_routes(input_scheduled_date);
  end if;

  return jsonb_build_object(
    'scheduledDate', input_scheduled_date,
    'alreadyLoaded', existing_count > 0,
    'plannedCount', planned_count,
    'routeCount', (
      select count(*)
      from public.routes
      where operator_id = tenant_id
        and scheduled_date = input_scheduled_date
        and status != 'cancelled'
    )
  );
end;
$$;

create or replace function public.driver_today_planning_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  staff_id uuid := public.current_staff_member_id();
  tenant_id uuid;
  route_count integer;
  assigned boolean;
begin
  if staff_id is null then
    raise exception 'Driver profile not found';
  end if;

  select operator_id into tenant_id
  from public.staff_members
  where id = staff_id;

  select count(*)
  into route_count
  from public.routes
  where operator_id = tenant_id
    and scheduled_date = current_date
    and status != 'cancelled';

  select exists (
    select 1
    from public.routes
    where operator_id = tenant_id
      and scheduled_date = current_date
      and driver_id = staff_id
      and status in ('scheduled', 'in_progress')
  ) into assigned;

  return jsonb_build_object(
    'hasAssignedRoute', assigned,
    'operatorRoutesExist', route_count > 0,
    'canLoadDefaults', route_count = 0
  );
end;
$$;

create or replace function public.driver_ensure_daily_routes_loaded()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  staff_id uuid := public.current_staff_member_id();
  tenant_id uuid;
  staff_role public.app_role;
  existing_count integer;
  planned_count integer := 0;
  assigned_route_id uuid;
begin
  if staff_id is null then
    raise exception 'Driver profile not found';
  end if;

  select operator_id, role
  into tenant_id, staff_role
  from public.staff_members
  where id = staff_id;

  if staff_role != 'driver' then
    raise exception 'Only drivers can use this fallback';
  end if;

  -- Bind current_operator_id for plan_daily_routes by ensuring profile linkage.
  if public.current_operator_id() is null then
    raise exception 'Operator context not available for driver';
  end if;

  select count(*)
  into existing_count
  from public.routes
  where operator_id = tenant_id
    and scheduled_date = current_date
    and status != 'cancelled';

  if existing_count > 0 then
    return jsonb_build_object(
      'scheduledDate', current_date,
      'alreadyLoaded', true,
      'plannedCount', 0,
      'routeCount', existing_count,
      'hasAssignedRoute', exists (
        select 1 from public.routes
        where operator_id = tenant_id
          and scheduled_date = current_date
          and driver_id = staff_id
          and status in ('scheduled', 'in_progress')
      )
    );
  end if;

  planned_count := public.plan_daily_routes(current_date);

  select id
  into assigned_route_id
  from public.routes
  where operator_id = tenant_id
    and scheduled_date = current_date
    and driver_id = staff_id
    and status in ('scheduled', 'in_progress')
  limit 1;

  if assigned_route_id is not null then
    perform public.notify_route_plan_drivers(
      assigned_route_id,
      'routes_auto_loaded',
      'Default route loaded',
      'Today''s zone templates were loaded because the operator had not planned routes yet.'
    );
  end if;

  -- Notify other drivers who received assignments from templates
  insert into public.driver_route_notices (
    operator_id,
    route_id,
    driver_id,
    notice_type,
    title,
    body
  )
  select
    routes.operator_id,
    routes.id,
    routes.driver_id,
    'routes_auto_loaded',
    'Default route loaded',
    'Today''s zone templates were loaded. Review your stops before starting the shift.'
  from public.routes
  where routes.operator_id = tenant_id
    and routes.scheduled_date = current_date
    and routes.status = 'scheduled'
    and routes.driver_id is not null
    and routes.driver_id <> staff_id;

  return jsonb_build_object(
    'scheduledDate', current_date,
    'alreadyLoaded', false,
    'plannedCount', planned_count,
    'routeCount', (
      select count(*) from public.routes
      where operator_id = tenant_id
        and scheduled_date = current_date
        and status != 'cancelled'
    ),
    'hasAssignedRoute', assigned_route_id is not null
  );
end;
$$;

create or replace function public.pending_driver_route_notices()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  staff_id uuid := public.current_staff_member_id();
begin
  if staff_id is null then
    raise exception 'Driver profile not found';
  end if;

  -- Not STABLE: keep writable path free for future expiry logic.
  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', notices.id,
          'routeId', notices.route_id,
          'noticeType', notices.notice_type,
          'title', notices.title,
          'body', notices.body,
          'createdAt', notices.created_at
        )
        order by notices.created_at desc
      )
      from public.driver_route_notices notices
      where notices.driver_id = staff_id
        and notices.acknowledged_at is null
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.acknowledge_driver_route_notice(input_notice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  staff_id uuid := public.current_staff_member_id();
begin
  if staff_id is null then
    raise exception 'Driver profile not found';
  end if;

  update public.driver_route_notices
  set acknowledged_at = now()
  where id = input_notice_id
    and driver_id = staff_id
    and acknowledged_at is null;

  if not found then
    raise exception 'Notice not found';
  end if;
end;
$$;

-- Patch plan-edit RPCs to notify assigned drivers (based on floating-truck assignment rules).
create or replace function public.update_route_plan_assignment(
  input_route_id uuid,
  input_zone_id uuid,
  input_truck_id uuid,
  input_driver_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  route_record public.routes%rowtype;
  previous_driver_id uuid;
begin
  route_record := public.assert_route_planning_allowed(input_route_id);
  previous_driver_id := route_record.driver_id;

  if input_zone_id != route_record.zone_id then
    raise exception 'Route zone cannot be changed from assignment controls';
  end if;

  if not exists (
    select 1
    from public.trucks
    where id = input_truck_id
      and operator_id = route_record.operator_id
      and active
      and status in ('operational', 'standby')
  ) then
    raise exception 'Truck must be active and available (operational or standby)';
  end if;

  if input_driver_id is not null and not exists (
    select 1
    from public.staff_members
    where id = input_driver_id
      and operator_id = route_record.operator_id
      and role = 'driver'
      and active
  ) then
    raise exception 'Driver not found or inactive';
  end if;

  if exists (
    select 1
    from public.routes
    where id <> input_route_id
      and operator_id = route_record.operator_id
      and scheduled_date = route_record.scheduled_date
      and truck_id = input_truck_id
      and status != 'cancelled'
  ) then
    raise exception 'Truck is already assigned on this date';
  end if;

  if input_driver_id is not null and exists (
    select 1
    from public.routes
    where id <> input_route_id
      and operator_id = route_record.operator_id
      and scheduled_date = route_record.scheduled_date
      and driver_id = input_driver_id
      and status != 'cancelled'
  ) then
    raise exception 'Driver is already assigned on this date';
  end if;

  update public.routes
  set
    truck_id = input_truck_id,
    driver_id = input_driver_id
  where id = input_route_id;

  perform public.notify_route_plan_drivers(input_route_id);

  if previous_driver_id is not null
    and (input_driver_id is null or input_driver_id <> previous_driver_id)
  then
    insert into public.driver_route_notices (
      operator_id,
      route_id,
      driver_id,
      notice_type,
      title,
      body
    )
    values (
      route_record.operator_id,
      input_route_id,
      previous_driver_id,
      'route_plan_changed',
      'Route assignment changed',
      'You were removed from a route plan. Pull to refresh your assignments.'
    );
  end if;
end;
$$;

create or replace function public.add_route_plan_stop(input_route_id uuid, input_customer_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  route_record public.routes%rowtype;
  next_sequence integer;
begin
  route_record := public.assert_route_planning_allowed(input_route_id);

  if not exists (
    select 1
    from public.customers
    where id = input_customer_id
      and operator_id = route_record.operator_id
  ) then
    raise exception 'Customer not found';
  end if;

  perform public.assert_route_stop_zone_match(input_route_id, input_customer_id);

  if exists (
    select 1
    from public.route_stops
    where route_id = input_route_id
      and customer_id = input_customer_id
  ) then
    raise exception 'Customer is already on this route';
  end if;

  select coalesce(max(stop_sequence), 0) + 1
  into next_sequence
  from public.route_stops
  where route_id = input_route_id;

  insert into public.route_stops (
    route_id,
    customer_id,
    stop_sequence,
    status
  )
  values (
    input_route_id,
    input_customer_id,
    next_sequence,
    'pending'
  );

  perform public.notify_route_plan_drivers(input_route_id);
end;
$$;

create or replace function public.remove_route_plan_stop(input_stop_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  stop_record public.route_stops%rowtype;
begin
  select *
  into stop_record
  from public.route_stops
  where id = input_stop_id;

  if stop_record.id is null then
    raise exception 'Route stop not found';
  end if;

  perform public.assert_route_planning_allowed(stop_record.route_id);

  delete from public.route_stops
  where id = input_stop_id;

  perform public.normalize_route_stop_sequence(stop_record.route_id);
  perform public.notify_route_plan_drivers(stop_record.route_id);
end;
$$;

create or replace function public.move_route_plan_stop(input_stop_id uuid, input_direction text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  stop_record public.route_stops%rowtype;
  swap_record public.route_stops%rowtype;
begin
  select *
  into stop_record
  from public.route_stops
  where id = input_stop_id;

  if stop_record.id is null then
    raise exception 'Route stop not found';
  end if;

  perform public.assert_route_planning_allowed(stop_record.route_id);

  if input_direction = 'up' then
    select *
    into swap_record
    from public.route_stops
    where route_id = stop_record.route_id
      and stop_sequence < stop_record.stop_sequence
    order by stop_sequence desc
    limit 1;
  elsif input_direction = 'down' then
    select *
    into swap_record
    from public.route_stops
    where route_id = stop_record.route_id
      and stop_sequence > stop_record.stop_sequence
    order by stop_sequence asc
    limit 1;
  else
    raise exception 'Move direction must be up or down';
  end if;

  if swap_record.id is null then
    return;
  end if;

  update public.route_stops
  set stop_sequence = -stop_record.stop_sequence
  where id = swap_record.id;

  update public.route_stops
  set stop_sequence = swap_record.stop_sequence
  where id = stop_record.id;

  update public.route_stops
  set stop_sequence = stop_record.stop_sequence
  where id = swap_record.id;

  perform public.notify_route_plan_drivers(stop_record.route_id);
end;
$$;

-- Bootstrap zone defaults from latest historical routes for all operators.
do $$
declare
  op record;
begin
  for op in select id from public.operators
  loop
    perform public.ensure_zone_default_templates(op.id);
  end loop;
end;
$$;
