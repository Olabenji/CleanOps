create or replace function public.assert_route_planning_allowed(input_route_id uuid)
returns public.routes
language plpgsql
security definer
as $$
declare
  route_record public.routes%rowtype;
begin
  select *
  into route_record
  from public.routes
  where id = input_route_id
    and operator_id = public.current_operator_id();

  if route_record.id is null then
    raise exception 'Route not found';
  end if;

  if public.current_app_role() not in ('operator_owner', 'operations_supervisor') then
    raise exception 'Only operators and supervisors can edit route plans';
  end if;

  if route_record.status != 'scheduled' or route_record.started_at is not null or route_record.completed_at is not null then
    raise exception 'Only scheduled routes that have not started can be edited';
  end if;

  return route_record;
end;
$$;

create or replace function public.route_planning_options()
returns jsonb
language sql
stable
security invoker
as $$
  select jsonb_build_object(
    'zones',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', zones.id,
            'label', zones.name,
            'helper', zones.description
          )
          order by zones.name
        )
        from public.zones
        where zones.operator_id = public.current_operator_id()
      ), '[]'::jsonb),
    'trucks',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', trucks.id,
            'label', trucks.registration_number,
            'helper', concat(coalesce(zones.name, 'Standby'), ' · ', trucks.status)
          )
          order by trucks.registration_number
        )
        from public.trucks
        left join public.zones on zones.id = trucks.zone_id
        where trucks.operator_id = public.current_operator_id()
          and trucks.active
      ), '[]'::jsonb),
    'drivers',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', staff_members.id,
            'label', staff_members.full_name,
            'helper', staff_members.phone
          )
          order by staff_members.full_name
        )
        from public.staff_members
        where staff_members.operator_id = public.current_operator_id()
          and staff_members.role = 'driver'
          and staff_members.active
      ), '[]'::jsonb),
    'customers',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', customers.id,
            'zoneId', customers.zone_id,
            'label', customers.display_name,
            'helper', concat(customers.address, ' · ', customers.service_status)
          )
          order by customers.display_name
        )
        from public.customers
        where customers.operator_id = public.current_operator_id()
      ), '[]'::jsonb)
  );
$$;

create or replace function public.update_route_plan_assignment(
  input_route_id uuid,
  input_zone_id uuid,
  input_truck_id uuid,
  input_driver_id uuid default null
)
returns void
language plpgsql
security definer
as $$
declare
  route_record public.routes%rowtype;
begin
  route_record := public.assert_route_planning_allowed(input_route_id);

  if not exists (select 1 from public.zones where id = input_zone_id and operator_id = route_record.operator_id) then
    raise exception 'Zone not found';
  end if;

  if not exists (
    select 1
    from public.trucks
    where id = input_truck_id
      and operator_id = route_record.operator_id
      and active
  ) then
    raise exception 'Truck not found or inactive';
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
    zone_id = input_zone_id,
    truck_id = input_truck_id,
    driver_id = input_driver_id
  where id = input_route_id;
end;
$$;

create or replace function public.add_route_plan_stop(input_route_id uuid, input_customer_id uuid)
returns void
language plpgsql
security definer
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

create or replace function public.normalize_route_stop_sequence(input_route_id uuid)
returns void
language sql
security definer
as $$
  with ordered as (
    select
      id,
      row_number() over (order by stop_sequence, id) as next_sequence
    from public.route_stops
    where route_id = input_route_id
  )
  update public.route_stops
  set stop_sequence = -ordered.next_sequence
  from ordered
  where route_stops.id = ordered.id;

  update public.route_stops
  set stop_sequence = abs(stop_sequence)
  where route_id = input_route_id
    and stop_sequence < 0;
$$;

create or replace function public.remove_route_plan_stop(input_stop_id uuid)
returns void
language plpgsql
security definer
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
end;
$$;

create or replace function public.move_route_plan_stop(input_stop_id uuid, input_direction text)
returns void
language plpgsql
security definer
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
end;
$$;
