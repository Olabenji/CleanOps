-- Enforce one-zone-per-customer on route stops and clean historical mismatches.

create or replace function public.assert_route_stop_zone_match(
  input_route_id uuid,
  input_customer_id uuid
)
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  route_zone_id uuid;
  customer_zone_id uuid;
begin
  select zone_id
  into route_zone_id
  from public.routes
  where id = input_route_id;

  if route_zone_id is null then
    raise exception 'Route not found';
  end if;

  select zone_id
  into customer_zone_id
  from public.customers
  where id = input_customer_id;

  if customer_zone_id is null then
    raise exception 'Customer not found';
  end if;

  if customer_zone_id <> route_zone_id then
    raise exception 'Customer belongs to a different zone than this route';
  end if;
end;
$$;

create or replace function public.enforce_route_stop_zone_match()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  perform public.assert_route_stop_zone_match(new.route_id, new.customer_id);
  return new;
end;
$$;

drop trigger if exists route_stops_zone_guard on public.route_stops;

create trigger route_stops_zone_guard
before insert or update of route_id, customer_id
on public.route_stops
for each row
execute function public.enforce_route_stop_zone_match();

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
  template_route record;
  new_route_id uuid;
begin
  if tenant_id is null then
    raise exception 'Operator profile not found';
  end if;

  if public.current_app_role() not in ('operator_owner', 'operations_supervisor') then
    raise exception 'Only operators and supervisors can plan routes';
  end if;

  for template_route in
    select distinct on (routes.zone_id)
      routes.*
    from public.routes
    where routes.operator_id = tenant_id
      and routes.scheduled_date < input_scheduled_date
      and exists (
        select 1
        from public.route_stops
        join public.customers on customers.id = route_stops.customer_id
        where route_stops.route_id = routes.id
          and customers.zone_id = routes.zone_id
      )
      and not exists (
        select 1
        from public.routes planned
        where planned.operator_id = tenant_id
          and planned.zone_id = routes.zone_id
          and planned.scheduled_date = input_scheduled_date
      )
    order by routes.zone_id, routes.scheduled_date desc, routes.created_at desc
  loop
    insert into public.routes (
      operator_id,
      zone_id,
      truck_id,
      driver_id,
      scheduled_date,
      status
    )
    values (
      template_route.operator_id,
      template_route.zone_id,
      template_route.truck_id,
      template_route.driver_id,
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
      route_stops.customer_id,
      row_number() over (order by route_stops.stop_sequence),
      'pending'
    from public.route_stops
    join public.customers on customers.id = route_stops.customer_id
    where route_stops.route_id = template_route.id
      and customers.zone_id = template_route.zone_id
    order by route_stops.stop_sequence;

    planned_count := planned_count + 1;
  end loop;

  return planned_count;
end;
$$;

do $$
declare
  route_id uuid;
begin
  create temp table _routes_needing_sequence_normalize (
    route_id uuid primary key
  ) on commit drop;

  insert into _routes_needing_sequence_normalize (route_id)
  select distinct route_stops.route_id
  from public.route_stops
  join public.routes on routes.id = route_stops.route_id
  join public.customers on customers.id = route_stops.customer_id
  where customers.zone_id <> routes.zone_id;

  delete from public.route_stops
  using public.routes, public.customers
  where route_stops.route_id = routes.id
    and route_stops.customer_id = customers.id
    and customers.zone_id <> routes.zone_id;

  for route_id in
    select _routes_needing_sequence_normalize.route_id
    from _routes_needing_sequence_normalize
  loop
    perform public.normalize_route_stop_sequence(route_id);
  end loop;
end;
$$;

comment on column public.customers.zone_id is
  'Single home zone for the customer. Route stops must use customers from the same zone as the route.';
