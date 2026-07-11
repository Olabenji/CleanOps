-- Fix ambiguous template_id references in template save helpers.

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
  resolved_template_id uuid;
begin
  if tenant_id is null then
    raise exception 'Operator profile not found';
  end if;

  if public.current_app_role() not in ('operator_owner', 'operations_supervisor', 'driver') then
    raise exception 'Not allowed to plan daily routes';
  end if;

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

      resolved_template_id := public.upsert_zone_default_template_from_route(prior_route.id);
      select * into template_row from public.route_templates where id = resolved_template_id;
    end if;

    if not exists (
      select 1 from public.route_template_stops
      where route_template_stops.template_id = template_row.id
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
