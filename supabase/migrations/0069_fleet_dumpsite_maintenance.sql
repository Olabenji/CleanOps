-- Fleet remainder: dumpsite site registry + maintenance write path for operator Fleet board.

create table if not exists public.dumpsite_sites (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  name text not null,
  address text,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  daily_capacity_tonnes numeric(10, 2),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dumpsite_sites_name_not_blank check (length(trim(name)) > 0),
  constraint dumpsite_sites_lat_check check (latitude is null or latitude between -90 and 90),
  constraint dumpsite_sites_lng_check check (longitude is null or longitude between -180 and 180)
);

create unique index if not exists dumpsite_sites_operator_name_uidx
  on public.dumpsite_sites (operator_id, lower(trim(name)));

create index if not exists dumpsite_sites_operator_active_idx
  on public.dumpsite_sites (operator_id, active);

alter table public.dumpsite_sites enable row level security;

drop policy if exists "tenant read dumpsite sites" on public.dumpsite_sites;
create policy "tenant read dumpsite sites"
  on public.dumpsite_sites for select
  using (operator_id = public.current_operator_id());

drop policy if exists "managers write dumpsite sites" on public.dumpsite_sites;
create policy "managers write dumpsite sites"
  on public.dumpsite_sites for all
  using (
    operator_id = public.current_operator_id()
    and public.current_app_role() in ('operator_owner', 'operations_supervisor', 'platform_admin')
  )
  with check (
    operator_id = public.current_operator_id()
    and public.current_app_role() in ('operator_owner', 'operations_supervisor', 'platform_admin')
  );

drop policy if exists "managers write maintenance" on public.maintenance_events;
create policy "managers write maintenance"
  on public.maintenance_events for all
  using (
    operator_id = public.current_operator_id()
    and public.current_app_role() in ('operator_owner', 'operations_supervisor', 'platform_admin')
  )
  with check (
    operator_id = public.current_operator_id()
    and public.current_app_role() in ('operator_owner', 'operations_supervisor', 'platform_admin')
  );

-- Seed Lagos pilot dumpsites when operator exists and table empty for that tenant.
insert into public.dumpsite_sites (
  operator_id, name, address, latitude, longitude, daily_capacity_tonnes, notes
)
select
  o.id,
  v.name,
  v.address,
  v.latitude,
  v.longitude,
  v.daily_capacity_tonnes,
  v.notes
from public.operators o
cross join (
  values
    (
      'Olusosun landfill',
      'Olusosun, Ojota, Lagos',
      6.591200::numeric,
      3.379200::numeric,
      2500.00::numeric,
      'Primary LAWMA tip site for many Surulere ward runs.'
    ),
    (
      'Solous dumpsite',
      'Solous, Igando, Lagos',
      6.548100::numeric,
      3.251400::numeric,
      800.00::numeric,
      'Western corridor alternative tip.'
    )
) as v(name, address, latitude, longitude, daily_capacity_tonnes, notes)
where o.slug = 'next-to-godliness'
  and not exists (
    select 1 from public.dumpsite_sites ds where ds.operator_id = o.id
  );

create or replace function public.record_maintenance_event(
  input_truck_id uuid,
  input_event_date date,
  input_work_done text,
  input_workshop_name text default null,
  input_cost_kobo integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_id uuid := public.current_operator_id();
  app_role text := public.current_app_role();
  event_row public.maintenance_events%rowtype;
  truck_reg text;
begin
  if tenant_id is null then
    raise exception 'Operator profile not found';
  end if;

  if app_role not in ('operator_owner', 'operations_supervisor', 'platform_admin') then
    raise exception 'Not allowed to record maintenance';
  end if;

  if nullif(trim(coalesce(input_work_done, '')), '') is null then
    raise exception 'Describe the work done';
  end if;

  select registration_number
  into truck_reg
  from public.trucks
  where id = input_truck_id
    and operator_id = tenant_id;

  if truck_reg is null then
    raise exception 'Truck not found';
  end if;

  insert into public.maintenance_events (
    operator_id,
    truck_id,
    event_date,
    work_done,
    workshop_name,
    cost_kobo
  )
  values (
    tenant_id,
    input_truck_id,
    coalesce(input_event_date, public.operation_current_date()),
    trim(input_work_done),
    nullif(trim(coalesce(input_workshop_name, '')), ''),
    greatest(coalesce(input_cost_kobo, 0), 0)
  )
  returning * into event_row;

  return jsonb_build_object(
    'id', event_row.id,
    'truckId', event_row.truck_id,
    'truckRegistration', truck_reg,
    'eventDate', event_row.event_date,
    'workDone', event_row.work_done,
    'workshopName', event_row.workshop_name,
    'costKobo', event_row.cost_kobo
  );
end;
$$;

create or replace function public.upsert_dumpsite_site(
  input_site_id uuid default null,
  input_name text default null,
  input_address text default null,
  input_latitude numeric default null,
  input_longitude numeric default null,
  input_daily_capacity_tonnes numeric default null,
  input_notes text default null,
  input_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_id uuid := public.current_operator_id();
  app_role text := public.current_app_role();
  site_row public.dumpsite_sites%rowtype;
  site_name text := nullif(trim(coalesce(input_name, '')), '');
begin
  if tenant_id is null then
    raise exception 'Operator profile not found';
  end if;

  if app_role not in ('operator_owner', 'operations_supervisor', 'platform_admin') then
    raise exception 'Not allowed to manage dumpsite sites';
  end if;

  if site_name is null then
    raise exception 'Dumpsite name is required';
  end if;

  if input_site_id is null then
    insert into public.dumpsite_sites (
      operator_id,
      name,
      address,
      latitude,
      longitude,
      daily_capacity_tonnes,
      notes,
      active,
      updated_at
    )
    values (
      tenant_id,
      site_name,
      nullif(trim(coalesce(input_address, '')), ''),
      input_latitude,
      input_longitude,
      input_daily_capacity_tonnes,
      nullif(trim(coalesce(input_notes, '')), ''),
      coalesce(input_active, true),
      now()
    )
    returning * into site_row;
  else
    update public.dumpsite_sites
    set
      name = site_name,
      address = nullif(trim(coalesce(input_address, '')), ''),
      latitude = input_latitude,
      longitude = input_longitude,
      daily_capacity_tonnes = input_daily_capacity_tonnes,
      notes = nullif(trim(coalesce(input_notes, '')), ''),
      active = coalesce(input_active, active),
      updated_at = now()
    where id = input_site_id
      and operator_id = tenant_id
    returning * into site_row;

    if site_row.id is null then
      raise exception 'Dumpsite site not found';
    end if;
  end if;

  return jsonb_build_object(
    'id', site_row.id,
    'name', site_row.name,
    'address', site_row.address,
    'latitude', site_row.latitude,
    'longitude', site_row.longitude,
    'dailyCapacityTonnes', site_row.daily_capacity_tonnes,
    'notes', site_row.notes,
    'active', site_row.active
  );
end;
$$;

create or replace function public.operator_fleet_snapshot(input_date date default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  tenant_id uuid := public.current_operator_id();
  operation_date date := coalesce(input_date, public.operation_current_date());
  app_role text := public.current_app_role();
  month_start date := date_trunc('month', operation_date::timestamp)::date;
  month_end date := (date_trunc('month', operation_date::timestamp) + interval '1 month - 1 day')::date;
begin
  if tenant_id is null then
    return null;
  end if;

  if app_role not in (
    'operator_owner',
    'operations_supervisor',
    'platform_admin'
  ) then
    raise exception 'Not allowed to load fleet board';
  end if;

  return (
    with fleet_trucks as (
      select
        trucks.id,
        trucks.registration_number,
        coalesce(zones.name, 'Standby') as zone_name,
        trucks.status,
        trucks.active,
        greatest(
          trucks.monthly_maintenance_reserve_kobo - coalesce(monthly_spend.spend_kobo, 0),
          0
        )::int as reserve_remaining_kobo
      from public.trucks
      left join public.zones on zones.id = trucks.zone_id
      left join lateral (
        select sum(cost_kobo) as spend_kobo
        from public.maintenance_events
        where maintenance_events.truck_id = trucks.id
          and date_trunc('month', maintenance_events.event_date::timestamp)
            = date_trunc('month', operation_date::timestamp)
      ) monthly_spend on true
      where trucks.operator_id = tenant_id
    ),
    day_fuel as (
      select
        fuel_logs.id,
        trucks.registration_number as truck_registration,
        coalesce(staff_members.full_name, 'Unassigned') as driver_name,
        fuel_logs.litres,
        fuel_logs.cost_kobo,
        fuel_logs.station_name,
        fuel_logs.logged_at
      from public.fuel_logs
      join public.trucks on trucks.id = fuel_logs.truck_id
      left join public.staff_members on staff_members.id = fuel_logs.driver_id
      where fuel_logs.operator_id = tenant_id
        and fuel_logs.logged_at::date = operation_date
    ),
    day_dumpsite as (
      select
        dumpsite_runs.id,
        dumpsite_runs.route_id,
        zones.name as zone_name,
        trucks.registration_number as truck_registration,
        coalesce(staff_members.full_name, 'Unassigned') as driver_name,
        dumpsite_runs.departed_at,
        dumpsite_runs.arrived_at,
        dumpsite_runs.cleared_at,
        dumpsite_runs.dumpsite_site_name,
        dumpsite_runs.docket_number,
        dumpsite_runs.weighbridge_tonnes,
        dumpsite_runs.tipping_fee_kobo,
        case
          when dumpsite_runs.cleared_at is not null then 'cleared'
          when dumpsite_runs.arrived_at is not null then 'arrived'
          when dumpsite_runs.departed_at is not null then 'departed'
          else 'departed'
        end as phase
      from public.dumpsite_runs
      join public.routes on routes.id = dumpsite_runs.route_id
      join public.zones on zones.id = routes.zone_id
      join public.trucks on trucks.id = routes.truck_id
      left join public.staff_members on staff_members.id = routes.driver_id
      where dumpsite_runs.operator_id = tenant_id
        and routes.scheduled_date = operation_date
        and dumpsite_runs.departed_at is not null
    ),
    month_maintenance as (
      select
        maintenance_events.id,
        trucks.registration_number as truck_registration,
        maintenance_events.truck_id,
        maintenance_events.event_date,
        maintenance_events.work_done,
        maintenance_events.workshop_name,
        maintenance_events.cost_kobo
      from public.maintenance_events
      join public.trucks on trucks.id = maintenance_events.truck_id
      where maintenance_events.operator_id = tenant_id
        and maintenance_events.event_date between month_start and month_end
    ),
    site_rows as (
      select
        dumpsite_sites.id,
        dumpsite_sites.name,
        dumpsite_sites.address,
        dumpsite_sites.latitude,
        dumpsite_sites.longitude,
        dumpsite_sites.daily_capacity_tonnes,
        dumpsite_sites.notes,
        dumpsite_sites.active
      from public.dumpsite_sites
      where dumpsite_sites.operator_id = tenant_id
    )
    select jsonb_build_object(
      'operationDate', operation_date,
      'metrics', jsonb_build_object(
        'trucksTotal', (select count(*)::int from fleet_trucks),
        'trucksOperational', (
          select count(*)::int from fleet_trucks where status = 'operational' and active
        ),
        'trucksStandby', (
          select count(*)::int from fleet_trucks where status = 'standby' and active
        ),
        'trucksWorkshop', (
          select count(*)::int from fleet_trucks where status = 'workshop' and active
        ),
        'fuelLitresToday', coalesce((select sum(litres)::numeric from day_fuel), 0),
        'fuelSpendKoboToday', coalesce((select sum(cost_kobo)::int from day_fuel), 0),
        'dumpsiteInProgress', (
          select count(*)::int from day_dumpsite where phase in ('departed', 'arrived')
        ),
        'dumpsiteClearedToday', (
          select count(*)::int from day_dumpsite where phase = 'cleared'
        ),
        'maintenanceEventsThisMonth', (select count(*)::int from month_maintenance),
        'maintenanceSpendKoboThisMonth', coalesce((select sum(cost_kobo)::int from month_maintenance), 0),
        'dumpsiteSitesActive', (select count(*)::int from site_rows where active)
      ),
      'trucks', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', id,
              'registrationNumber', registration_number,
              'zoneName', zone_name,
              'status', status,
              'active', active,
              'reserveRemainingKobo', reserve_remaining_kobo
            )
            order by registration_number
          )
          from fleet_trucks
        ),
        '[]'::jsonb
      ),
      'dumpsiteRuns', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', id,
              'routeId', route_id,
              'zoneName', zone_name,
              'truckRegistration', truck_registration,
              'driverName', driver_name,
              'departedAt', departed_at,
              'arrivedAt', arrived_at,
              'clearedAt', cleared_at,
              'dumpsiteSiteName', dumpsite_site_name,
              'docketNumber', docket_number,
              'weighbridgeTonnes', weighbridge_tonnes,
              'tippingFeeKobo', tipping_fee_kobo,
              'phase', phase
            )
            order by coalesce(cleared_at, arrived_at, departed_at) desc
          )
          from day_dumpsite
        ),
        '[]'::jsonb
      ),
      'fuelLogs', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', id,
              'truckRegistration', truck_registration,
              'driverName', driver_name,
              'litres', litres,
              'costKobo', cost_kobo,
              'stationName', station_name,
              'loggedAt', logged_at
            )
            order by logged_at desc
          )
          from day_fuel
        ),
        '[]'::jsonb
      ),
      'maintenanceEvents', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', id,
              'truckId', truck_id,
              'truckRegistration', truck_registration,
              'eventDate', event_date,
              'workDone', work_done,
              'workshopName', workshop_name,
              'costKobo', cost_kobo
            )
            order by event_date desc, truck_registration
          )
          from month_maintenance
        ),
        '[]'::jsonb
      ),
      'dumpsiteSites', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', id,
              'name', name,
              'address', address,
              'latitude', latitude,
              'longitude', longitude,
              'dailyCapacityTonnes', daily_capacity_tonnes,
              'notes', notes,
              'active', active
            )
            order by active desc, name
          )
          from site_rows
        ),
        '[]'::jsonb
      )
    )
  );
end;
$$;

grant execute on function public.record_maintenance_event(uuid, date, text, text, integer) to authenticated;
grant execute on function public.upsert_dumpsite_site(uuid, text, text, numeric, numeric, numeric, text, boolean) to authenticated;
grant execute on function public.operator_fleet_snapshot(date) to authenticated;
