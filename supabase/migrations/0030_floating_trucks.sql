-- Floating fleet: trucks may be assigned to any zone route.
-- trucks.zone_id remains an optional home/preferred zone for display and soft sorting only.

comment on column public.trucks.zone_id is
  'Optional home/preferred zone for display and soft planner sorting. Not enforced on route assignment — trucks are floaters.';

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
            'zoneId', zones.id,
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
            'zoneId', trucks.zone_id,
            'helper', concat(
              'Home: ',
              coalesce(zones.name, 'none'),
              ' · ',
              trucks.status
            )
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
set search_path = public
as $$
declare
  route_record public.routes%rowtype;
begin
  route_record := public.assert_route_planning_allowed(input_route_id);

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
end;
$$;

-- Home zone is optional when onboarding a truck.
create or replace function public.onboard_truck(
  input_zone_id uuid,
  input_registration_number text,
  input_make text default null,
  input_model text default null,
  input_year integer default null,
  input_status public.truck_status default 'operational'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_id uuid := public.assert_admin_master_data_allowed();
  new_id uuid;
begin
  if input_zone_id is not null and not exists (
    select 1 from public.zones where id = input_zone_id and operator_id = tenant_id
  ) then
    raise exception 'Zone not found';
  end if;

  if exists (
    select 1 from public.trucks
    where operator_id = tenant_id
      and upper(registration_number) = upper(trim(input_registration_number))
  ) then
    raise exception 'A truck with this registration already exists';
  end if;

  insert into public.trucks (
    operator_id,
    zone_id,
    registration_number,
    make,
    model,
    year,
    status,
    active
  )
  values (
    tenant_id,
    input_zone_id,
    upper(trim(input_registration_number)),
    nullif(trim(coalesce(input_make, '')), ''),
    nullif(trim(coalesce(input_model, '')), ''),
    input_year,
    input_status,
    true
  )
  returning id into new_id;

  return new_id;
end;
$$;
