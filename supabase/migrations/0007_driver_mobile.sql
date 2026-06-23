create or replace function public.driver_assigned_route(input_date date default current_date)
returns jsonb
language sql
stable
security invoker
as $$
  with driver_staff as (
    select id
    from public.staff_members
    where profile_id = auth.uid()
      and operator_id = public.current_operator_id()
      and role = 'driver'
      and active
    limit 1
  ),
  assigned_route as (
    select routes.*
    from public.routes
    join driver_staff on driver_staff.id = routes.driver_id
    where routes.operator_id = public.current_operator_id()
      and routes.scheduled_date = input_date
    order by routes.created_at desc
    limit 1
  )
  select coalesce(
    (
      select jsonb_build_object(
        'id', assigned_route.id,
        'zoneName', zones.name,
        'truckRegistration', trucks.registration_number,
        'driverName', staff_members.full_name,
        'status', assigned_route.status,
        'completedStops', count(route_stops.id) filter (where route_stops.status = 'completed')::int,
        'totalStops', greatest(count(route_stops.id), 1)::int,
        'delayed', assigned_route.status = 'in_progress'
          and (count(route_stops.id) filter (where route_stops.status = 'completed'))::numeric
            / greatest(count(route_stops.id), 1) < 0.35,
        'scheduledDate', assigned_route.scheduled_date,
        'startedAt', assigned_route.started_at,
        'completedAt', assigned_route.completed_at,
        'stops', coalesce(
          jsonb_agg(
            jsonb_build_object(
              'id', route_stops.id,
              'customerName', customers.display_name,
              'address', customers.address,
              'stopSequence', route_stops.stop_sequence,
              'status', route_stops.status,
              'completedAt', route_stops.completed_at,
              'notes', route_stops.notes,
              'skipReason', route_stops.skip_reason,
              'serviceStatus', customers.service_status
            )
            order by route_stops.stop_sequence
          ) filter (where route_stops.id is not null),
          '[]'::jsonb
        )
      )
      from assigned_route
      join public.zones on zones.id = assigned_route.zone_id
      join public.trucks on trucks.id = assigned_route.truck_id
      left join public.staff_members on staff_members.id = assigned_route.driver_id
      left join public.route_stops on route_stops.route_id = assigned_route.id
      left join public.customers on customers.id = route_stops.customer_id
      group by
        assigned_route.id,
        assigned_route.status,
        assigned_route.scheduled_date,
        assigned_route.started_at,
        assigned_route.completed_at,
        zones.name,
        trucks.registration_number,
        staff_members.full_name
    ),
    'null'::jsonb
  );
$$;

create or replace function public.sync_driver_stop_action(
  input_stop_id uuid,
  next_status public.route_stop_status,
  input_notes text default null,
  input_skip_reason text default null
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  parent_route_id uuid;
begin
  parent_route_id := public.update_route_stop_status(
    input_stop_id,
    next_status,
    input_notes,
    input_skip_reason
  );

  return jsonb_build_object(
    'routeId', parent_route_id,
    'stopId', input_stop_id,
    'status', next_status,
    'syncedAt', now()
  );
end;
$$;
