-- Fleet map: expose started-ward truck positions (stop GPS → dumpsite → planned stop).
-- Also backfill demo customer coordinates so local seed routes can resolve a map pin.

-- Deterministic Surulere-area pins for demo customers (only when unset).
update public.customers
set location = st_setsrid(st_makepoint(v.lng, v.lat), 4326)::geography
from (
  values
    ('00000000-0000-4000-8000-000000000401'::uuid, 6.498100::float8, 3.354200::float8),
    ('00000000-0000-4000-8000-000000000402'::uuid, 6.498600::float8, 3.354800::float8),
    ('00000000-0000-4000-8000-000000000403'::uuid, 6.501200::float8, 3.358100::float8),
    ('00000000-0000-4000-8000-000000000404'::uuid, 6.501700::float8, 3.358700::float8),
    ('00000000-0000-4000-8000-000000000405'::uuid, 6.494200::float8, 3.360200::float8)
) as v(id, lat, lng)
where customers.id = v.id
  and customers.location is null;

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
    ),
    started_routes as (
      select
        routes.id as route_id,
        routes.truck_id,
        trucks.registration_number,
        coalesce(zones.name, 'Unassigned') as zone_name,
        routes.started_at,
        (
          select count(*)::int
          from public.route_stops
          where route_stops.route_id = routes.id
            and route_stops.status in ('completed', 'skipped')
        ) as completed_stops,
        (
          select count(*)::int
          from public.route_stops
          where route_stops.route_id = routes.id
        ) as total_stops
      from public.routes
      join public.trucks on trucks.id = routes.truck_id
      left join public.zones on zones.id = routes.zone_id
      where routes.operator_id = tenant_id
        and routes.scheduled_date = operation_date
        and routes.status = 'in_progress'
        and routes.started_at is not null
    ),
    stop_gps as (
      select distinct on (route_stops.route_id)
        route_stops.route_id,
        st_y(route_stops.location::geometry) as latitude,
        st_x(route_stops.location::geometry) as longitude,
        customers.display_name as label,
        coalesce(route_stops.completed_at, now()) as recorded_at
      from public.route_stops
      join public.customers on customers.id = route_stops.customer_id
      where route_stops.route_id in (select route_id from started_routes)
        and route_stops.location is not null
      order by
        route_stops.route_id,
        route_stops.completed_at desc nulls last,
        route_stops.stop_sequence desc
    ),
    dumpsite_pos as (
      select distinct on (day_dumpsite.route_id)
        day_dumpsite.route_id,
        site_rows.latitude,
        site_rows.longitude,
        site_rows.name as label,
        coalesce(
          day_dumpsite.arrived_at,
          day_dumpsite.departed_at
        ) as recorded_at
      from day_dumpsite
      join site_rows
        on lower(trim(site_rows.name)) = lower(trim(day_dumpsite.dumpsite_site_name))
      where day_dumpsite.phase in ('departed', 'arrived')
        and site_rows.latitude is not null
        and site_rows.longitude is not null
      order by
        day_dumpsite.route_id,
        coalesce(day_dumpsite.arrived_at, day_dumpsite.departed_at) desc nulls last
    ),
    next_planned as (
      select distinct on (route_stops.route_id)
        route_stops.route_id,
        st_y(customers.location::geometry) as latitude,
        st_x(customers.location::geometry) as longitude,
        customers.display_name as label,
        null::timestamptz as recorded_at
      from public.route_stops
      join public.customers on customers.id = route_stops.customer_id
      where route_stops.route_id in (select route_id from started_routes)
        and route_stops.status = 'pending'
        and customers.location is not null
      order by
        route_stops.route_id,
        route_stops.stop_sequence asc
    ),
    last_planned as (
      select distinct on (route_stops.route_id)
        route_stops.route_id,
        st_y(customers.location::geometry) as latitude,
        st_x(customers.location::geometry) as longitude,
        customers.display_name as label,
        route_stops.completed_at as recorded_at
      from public.route_stops
      join public.customers on customers.id = route_stops.customer_id
      where route_stops.route_id in (select route_id from started_routes)
        and route_stops.status in ('completed', 'skipped')
        and customers.location is not null
      order by
        route_stops.route_id,
        route_stops.completed_at desc nulls last,
        route_stops.stop_sequence desc
    ),
    route_centroid as (
      select
        route_stops.route_id,
        avg(st_y(customers.location::geometry)) as latitude,
        avg(st_x(customers.location::geometry)) as longitude,
        'Route stop centroid'::text as label,
        null::timestamptz as recorded_at
      from public.route_stops
      join public.customers on customers.id = route_stops.customer_id
      where route_stops.route_id in (select route_id from started_routes)
        and customers.location is not null
      group by route_stops.route_id
    ),
    active_truck_positions as (
      select
        started_routes.truck_id,
        started_routes.registration_number,
        started_routes.zone_name,
        started_routes.route_id,
        started_routes.started_at,
        started_routes.completed_stops,
        started_routes.total_stops,
        coalesce(
          stop_gps.latitude,
          dumpsite_pos.latitude,
          next_planned.latitude,
          last_planned.latitude,
          route_centroid.latitude
        ) as latitude,
        coalesce(
          stop_gps.longitude,
          dumpsite_pos.longitude,
          next_planned.longitude,
          last_planned.longitude,
          route_centroid.longitude
        ) as longitude,
        case
          when stop_gps.latitude is not null then 'last_stop_gps'
          when dumpsite_pos.latitude is not null then 'dumpsite'
          when next_planned.latitude is not null then 'planned_stop'
          when last_planned.latitude is not null then 'planned_stop'
          when route_centroid.latitude is not null then 'route_centroid'
          else null
        end as source,
        coalesce(
          stop_gps.label,
          dumpsite_pos.label,
          next_planned.label,
          last_planned.label,
          route_centroid.label
        ) as label,
        coalesce(
          stop_gps.recorded_at,
          dumpsite_pos.recorded_at,
          next_planned.recorded_at,
          last_planned.recorded_at,
          route_centroid.recorded_at
        ) as recorded_at
      from started_routes
      left join stop_gps on stop_gps.route_id = started_routes.route_id
      left join dumpsite_pos on dumpsite_pos.route_id = started_routes.route_id
      left join next_planned on next_planned.route_id = started_routes.route_id
      left join last_planned on last_planned.route_id = started_routes.route_id
      left join route_centroid on route_centroid.route_id = started_routes.route_id
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
        'dumpsiteSitesActive', (select count(*)::int from site_rows where active),
        'trucksStartedToday', (select count(*)::int from started_routes),
        'trucksMappedToday', (
          select count(*)::int from active_truck_positions where latitude is not null
        )
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
      ),
      'activeTruckPositions', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'truckId', truck_id,
              'registrationNumber', registration_number,
              'zoneName', zone_name,
              'routeId', route_id,
              'startedAt', started_at,
              'completedStops', completed_stops,
              'totalStops', total_stops,
              'latitude', latitude,
              'longitude', longitude,
              'source', source,
              'label', label,
              'recordedAt', recorded_at
            )
            order by registration_number
          )
          from active_truck_positions
        ),
        '[]'::jsonb
      )
    )
  );
end;
$$;

grant execute on function public.operator_fleet_snapshot(date) to authenticated;
