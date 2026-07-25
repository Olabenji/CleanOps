-- Operator Fleet board snapshot (ADO #142/#144 slim — status + day fuel/dumpsite, no map/registry).

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
      )
    )
  );
end;
$$;

grant execute on function public.operator_fleet_snapshot(date) to authenticated;
