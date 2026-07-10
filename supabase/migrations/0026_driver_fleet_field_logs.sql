-- Driver field logging: fuel purchases and dumpsite run timestamps.

create policy "drivers insert dumpsite runs"
  on public.dumpsite_runs for insert
  with check (
    operator_id = public.current_operator_id()
    and exists (
      select 1
      from public.routes
      join public.staff_members
        on staff_members.id = routes.driver_id
      where routes.id = dumpsite_runs.route_id
        and routes.operator_id = public.current_operator_id()
        and staff_members.profile_id = auth.uid()
        and staff_members.role = 'driver'
        and staff_members.active
    )
  );

create policy "drivers update dumpsite runs"
  on public.dumpsite_runs for update
  using (
    operator_id = public.current_operator_id()
    and exists (
      select 1
      from public.routes
      join public.staff_members
        on staff_members.id = routes.driver_id
      where routes.id = dumpsite_runs.route_id
        and routes.operator_id = public.current_operator_id()
        and staff_members.profile_id = auth.uid()
        and staff_members.role = 'driver'
        and staff_members.active
    )
  )
  with check (
    operator_id = public.current_operator_id()
    and exists (
      select 1
      from public.routes
      join public.staff_members
        on staff_members.id = routes.driver_id
      where routes.id = dumpsite_runs.route_id
        and routes.operator_id = public.current_operator_id()
        and staff_members.profile_id = auth.uid()
        and staff_members.role = 'driver'
        and staff_members.active
    )
  );

create or replace function public.driver_dumpsite_run_for_route(input_route_id uuid)
returns jsonb
language plpgsql
stable
security invoker
as $$
declare
  driver_staff_id uuid;
  run_row public.dumpsite_runs%rowtype;
begin
  select id
  into driver_staff_id
  from public.staff_members
  where profile_id = auth.uid()
    and operator_id = public.current_operator_id()
    and role = 'driver'
    and active
  limit 1;

  if driver_staff_id is null then
    raise exception 'Only active drivers can view dumpsite runs';
  end if;

  if not exists (
    select 1
    from public.routes
    where routes.id = input_route_id
      and routes.operator_id = public.current_operator_id()
      and routes.driver_id = driver_staff_id
  ) then
    raise exception 'Assigned route not found';
  end if;

  select *
  into run_row
  from public.dumpsite_runs
  where route_id = input_route_id
    and operator_id = public.current_operator_id()
  order by coalesce(cleared_at, arrived_at, departed_at, now()) desc
  limit 1;

  if run_row.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'id', run_row.id,
    'routeId', run_row.route_id,
    'departedAt', run_row.departed_at,
    'arrivedAt', run_row.arrived_at,
    'clearedAt', run_row.cleared_at,
    'tippingFeeKobo', run_row.tipping_fee_kobo,
    'notes', run_row.notes
  );
end;
$$;

create or replace function public.record_fuel_log(
  input_route_id uuid,
  input_litres numeric,
  input_cost_kobo integer,
  input_station_name text,
  input_logged_at timestamptz default null
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  driver_staff_id uuid;
  route_record public.routes%rowtype;
  new_log_id uuid;
  logged_at_value timestamptz;
begin
  select id
  into driver_staff_id
  from public.staff_members
  where profile_id = auth.uid()
    and operator_id = public.current_operator_id()
    and role = 'driver'
    and active
  limit 1;

  if driver_staff_id is null then
    raise exception 'Only active drivers can record fuel logs';
  end if;

  if input_litres is null or input_litres <= 0 then
    raise exception 'Litres must be greater than zero';
  end if;

  if input_cost_kobo is null or input_cost_kobo <= 0 then
    raise exception 'Fuel cost must be greater than zero';
  end if;

  if nullif(trim(input_station_name), '') is null then
    raise exception 'Station name is required';
  end if;

  select *
  into route_record
  from public.routes
  where id = input_route_id
    and operator_id = public.current_operator_id()
    and driver_id = driver_staff_id;

  if route_record.id is null then
    raise exception 'Assigned route not found';
  end if;

  logged_at_value := coalesce(input_logged_at, now());

  insert into public.fuel_logs (
    operator_id,
    truck_id,
    driver_id,
    litres,
    cost_kobo,
    station_name,
    logged_at
  )
  values (
    route_record.operator_id,
    route_record.truck_id,
    driver_staff_id,
    input_litres,
    input_cost_kobo,
    trim(input_station_name),
    logged_at_value
  )
  returning id into new_log_id;

  return jsonb_build_object(
    'id', new_log_id,
    'routeId', route_record.id,
    'truckRegistration', (
      select trucks.registration_number
      from public.trucks
      where trucks.id = route_record.truck_id
    ),
    'litres', input_litres,
    'costKobo', input_cost_kobo,
    'stationName', trim(input_station_name),
    'loggedAt', logged_at_value
  );
end;
$$;

create or replace function public.record_dumpsite_run(
  input_route_id uuid,
  input_phase text,
  input_tipping_fee_kobo integer default null,
  input_notes text default null
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  driver_staff_id uuid;
  route_record public.routes%rowtype;
  run_row public.dumpsite_runs%rowtype;
  phase text := lower(trim(input_phase));
  event_time timestamptz := now();
begin
  select id
  into driver_staff_id
  from public.staff_members
  where profile_id = auth.uid()
    and operator_id = public.current_operator_id()
    and role = 'driver'
    and active
  limit 1;

  if driver_staff_id is null then
    raise exception 'Only active drivers can record dumpsite runs';
  end if;

  if phase not in ('depart', 'arrive', 'clear') then
    raise exception 'Dumpsite phase must be depart, arrive, or clear';
  end if;

  select *
  into route_record
  from public.routes
  where id = input_route_id
    and operator_id = public.current_operator_id()
    and driver_id = driver_staff_id;

  if route_record.id is null then
    raise exception 'Assigned route not found';
  end if;

  select *
  into run_row
  from public.dumpsite_runs
  where route_id = input_route_id
    and operator_id = public.current_operator_id()
    and cleared_at is null
  order by coalesce(departed_at, arrived_at, event_time) desc
  limit 1;

  if phase = 'depart' then
    if run_row.id is not null and run_row.departed_at is not null then
      raise exception 'Dumpsite run already departed for this route';
    end if;

    insert into public.dumpsite_runs (
      operator_id,
      route_id,
      departed_at,
      tipping_fee_kobo,
      notes
    )
    values (
      route_record.operator_id,
      route_record.id,
      event_time,
      0,
      nullif(trim(input_notes), '')
    )
    returning * into run_row;
  elsif phase = 'arrive' then
    if run_row.id is null or run_row.departed_at is null then
      raise exception 'Depart for dumpsite before recording arrival';
    end if;

    if run_row.arrived_at is not null then
      raise exception 'Dumpsite arrival already recorded';
    end if;

    update public.dumpsite_runs
    set
      arrived_at = event_time,
      notes = coalesce(nullif(trim(input_notes), ''), notes)
    where id = run_row.id
    returning * into run_row;
  else
    if run_row.id is null or run_row.arrived_at is null then
      raise exception 'Arrive at dumpsite before recording clearance';
    end if;

    if run_row.cleared_at is not null then
      raise exception 'Dumpsite clearance already recorded';
    end if;

    update public.dumpsite_runs
    set
      cleared_at = event_time,
      tipping_fee_kobo = coalesce(input_tipping_fee_kobo, tipping_fee_kobo, 0),
      notes = coalesce(nullif(trim(input_notes), ''), notes)
    where id = run_row.id
    returning * into run_row;
  end if;

  return jsonb_build_object(
    'id', run_row.id,
    'routeId', run_row.route_id,
    'departedAt', run_row.departed_at,
    'arrivedAt', run_row.arrived_at,
    'clearedAt', run_row.cleared_at,
    'tippingFeeKobo', run_row.tipping_fee_kobo,
    'notes', run_row.notes
  );
end;
$$;
