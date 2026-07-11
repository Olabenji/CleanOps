-- Driver + operator visibility for completed cover / reassignment jobs.

create or replace function public.driver_today_shift_summary(input_date date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  staff_id uuid := public.current_staff_member_id();
  tenant_id uuid;
  staff_role public.app_role;
begin
  if staff_id is null then
    raise exception 'Driver profile not found';
  end if;

  select operator_id, role
  into tenant_id, staff_role
  from public.staff_members
  where id = staff_id;

  if staff_role != 'driver' then
    return jsonb_build_object('jobs', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'jobs',
      coalesce(
        (
          select jsonb_agg(job order by job->>'sortAt' desc)
          from (
            -- Completed routes still assigned to this driver (including cover takeovers).
            select jsonb_build_object(
              'id', routes.id::text || ':completed',
              'jobType', case
                when cover.id is not null and cover.change_kind = 'driver' then 'cover_completed'
                when cover.id is not null then 'reassignment_completed'
                else 'route_completed'
              end,
              'routeId', routes.id,
              'zoneName', zones.name,
              'truckRegistration', coalesce(trucks.registration_number, 'Unassigned truck'),
              'status', routes.status,
              'completedStops', (
                select count(*)::int from public.route_stops
                where route_id = routes.id and status = 'completed'
              ),
              'totalStops', greatest((
                select count(*)::int from public.route_stops where route_id = routes.id
              ), 1),
              'startedAt', routes.started_at,
              'completedAt', routes.completed_at,
              'changeKind', cover.change_kind,
              'reason', cover.reason,
              'fromDriverName', from_driver.full_name,
              'toDriverName', to_driver.full_name,
              'fromTruckRegistration', from_truck.registration_number,
              'toTruckRegistration', to_truck.registration_number,
              'headline', case
                when cover.id is not null and cover.change_kind = 'driver' then
                  'Cover job completed · ' || zones.name
                when cover.id is not null then
                  'Reassignment completed · ' || zones.name
                else
                  'Route completed · ' || zones.name
              end,
              'detail', case
                when cover.id is not null and cover.change_kind = 'driver' then
                  'You covered for ' || coalesce(from_driver.full_name, 'another driver')
                  || ' on ' || coalesce(trucks.registration_number, 'the truck')
                  || ' (' || replace(cover.reason::text, '_', ' ') || ').'
                when cover.id is not null then
                  'Finished after reassignment from '
                  || coalesce(from_driver.full_name, 'previous driver')
                  || ' / '
                  || coalesce(from_truck.registration_number, 'previous truck')
                  || '.'
                else
                  'All stops resolved for this zone run.'
              end,
              'sortAt', coalesce(routes.completed_at, routes.created_at)
            ) as job
            from public.routes
            join public.zones on zones.id = routes.zone_id
            left join public.trucks on trucks.id = routes.truck_id
            left join lateral (
              select handoffs.*
              from public.route_truck_handoffs handoffs
              where handoffs.route_id = routes.id
                and handoffs.status = 'confirmed'
                and handoffs.to_driver_id = staff_id
              order by handoffs.confirmed_at desc nulls last
              limit 1
            ) cover on true
            left join public.staff_members from_driver on from_driver.id = cover.from_driver_id
            left join public.staff_members to_driver on to_driver.id = cover.to_driver_id
            left join public.trucks from_truck on from_truck.id = cover.from_truck_id
            left join public.trucks to_truck on to_truck.id = cover.to_truck_id
            where routes.operator_id = tenant_id
              and routes.scheduled_date = input_date
              and routes.driver_id = staff_id
              and routes.status = 'completed'

            union all

            -- Routes you handed off today (outgoing driver) that are still open or completed by the cover driver.
            select jsonb_build_object(
              'id', handoffs.id::text || ':released',
              'jobType', 'cover_released',
              'routeId', routes.id,
              'zoneName', zones.name,
              'truckRegistration', coalesce(to_truck.registration_number, trucks.registration_number, 'Unassigned truck'),
              'status', routes.status,
              'completedStops', (
                select count(*)::int from public.route_stops
                where route_id = routes.id and status = 'completed'
              ),
              'totalStops', greatest((
                select count(*)::int from public.route_stops where route_id = routes.id
              ), 1),
              'startedAt', routes.started_at,
              'completedAt', routes.completed_at,
              'changeKind', handoffs.change_kind,
              'reason', handoffs.reason,
              'fromDriverName', from_driver.full_name,
              'toDriverName', to_driver.full_name,
              'fromTruckRegistration', from_truck.registration_number,
              'toTruckRegistration', to_truck.registration_number,
              'headline', 'Handed off · ' || zones.name,
              'detail',
                'Covered by ' || coalesce(to_driver.full_name, 'another driver')
                || ' (' || replace(handoffs.reason::text, '_', ' ') || '). Route is now '
                || replace(routes.status::text, '_', ' ') || '.',
              'sortAt', coalesce(handoffs.confirmed_at, handoffs.created_at)
            ) as job
            from public.route_truck_handoffs handoffs
            join public.routes on routes.id = handoffs.route_id
            join public.zones on zones.id = routes.zone_id
            left join public.trucks on trucks.id = routes.truck_id
            left join public.staff_members from_driver on from_driver.id = handoffs.from_driver_id
            left join public.staff_members to_driver on to_driver.id = handoffs.to_driver_id
            left join public.trucks from_truck on from_truck.id = handoffs.from_truck_id
            left join public.trucks to_truck on to_truck.id = handoffs.to_truck_id
            where handoffs.operator_id = tenant_id
              and handoffs.from_driver_id = staff_id
              and handoffs.to_driver_id is distinct from staff_id
              and handoffs.status = 'confirmed'
              and routes.scheduled_date = input_date
          ) jobs
        ),
        '[]'::jsonb
      )
  );
end;
$$;

-- Operator: confirmed covers for a date (dashboard / routes context).
create or replace function public.route_cover_summaries_for_date(input_date date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_id uuid := public.current_operator_id();
begin
  if tenant_id is null then
    raise exception 'Operator profile not found';
  end if;

  if public.current_app_role() not in ('operator_owner', 'operations_supervisor') then
    raise exception 'Only operators and supervisors can view cover summaries';
  end if;

  perform public.expire_stale_route_truck_handoffs();

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'handoffId', handoffs.id,
          'routeId', handoffs.route_id,
          'zoneName', zones.name,
          'routeStatus', routes.status,
          'changeKind', handoffs.change_kind,
          'reason', handoffs.reason,
          'fromDriverName', from_driver.full_name,
          'toDriverName', to_driver.full_name,
          'fromTruckRegistration', from_truck.registration_number,
          'toTruckRegistration', to_truck.registration_number,
          'confirmedAt', handoffs.confirmed_at,
          'headline', case
            when handoffs.change_kind = 'driver' then
              zones.name || ': ' || coalesce(to_driver.full_name, 'Cover driver')
              || ' covered for ' || coalesce(from_driver.full_name, 'previous driver')
            when handoffs.change_kind = 'truck' then
              zones.name || ': truck ' || coalesce(from_truck.registration_number, '?')
              || ' → ' || coalesce(to_truck.registration_number, '?')
            else
              zones.name || ': reassigned to ' || coalesce(to_driver.full_name, 'new crew')
          end
        )
        order by handoffs.confirmed_at desc nulls last
      )
      from public.route_truck_handoffs handoffs
      join public.routes on routes.id = handoffs.route_id
      join public.zones on zones.id = routes.zone_id
      left join public.staff_members from_driver on from_driver.id = handoffs.from_driver_id
      left join public.staff_members to_driver on to_driver.id = handoffs.to_driver_id
      left join public.trucks from_truck on from_truck.id = handoffs.from_truck_id
      left join public.trucks to_truck on to_truck.id = handoffs.to_truck_id
      where handoffs.operator_id = tenant_id
        and handoffs.status = 'confirmed'
        and routes.scheduled_date = input_date
    ),
    '[]'::jsonb
  );
end;
$$;
