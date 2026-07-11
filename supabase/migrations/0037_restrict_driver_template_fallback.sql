-- Restrict driver template fallback to zone-default drivers only.
-- Stop driver_assigned_route from returning other-day routes (caused wrong truck/zone on login).

create or replace function public.driver_is_zone_template_default(input_driver_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.route_templates
    where route_templates.driver_id = input_driver_id
      and route_templates.kind = 'zone_default'
  );
$$;

create or replace function public.driver_today_planning_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  staff_id uuid := public.current_staff_member_id();
  tenant_id uuid;
  staff_role public.app_role;
  route_count integer;
  assigned boolean;
  is_template_default boolean;
begin
  if staff_id is null then
    raise exception 'Driver profile not found';
  end if;

  select operator_id, role
  into tenant_id, staff_role
  from public.staff_members
  where id = staff_id;

  if staff_role != 'driver' then
    return jsonb_build_object(
      'hasAssignedRoute', false,
      'operatorRoutesExist', false,
      'canLoadDefaults', false,
      'isTemplateDefaultDriver', false
    );
  end if;

  select count(*)
  into route_count
  from public.routes
  where operator_id = tenant_id
    and scheduled_date = current_date
    and status != 'cancelled';

  select exists (
    select 1
    from public.routes
    where operator_id = tenant_id
      and scheduled_date = current_date
      and driver_id = staff_id
      and status in ('scheduled', 'in_progress')
  ) into assigned;

  is_template_default := public.driver_is_zone_template_default(staff_id);

  return jsonb_build_object(
    'hasAssignedRoute', assigned,
    'operatorRoutesExist', route_count > 0,
    'isTemplateDefaultDriver', is_template_default,
    -- Fallback only for drivers named on a zone default template, and only when today is unplanned.
    'canLoadDefaults', route_count = 0 and is_template_default
  );
end;
$$;

create or replace function public.driver_ensure_daily_routes_loaded()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  staff_id uuid := public.current_staff_member_id();
  tenant_id uuid;
  staff_role public.app_role;
  existing_count integer;
  planned_count integer := 0;
  assigned_route_id uuid;
begin
  if staff_id is null then
    raise exception 'Driver profile not found';
  end if;

  select operator_id, role
  into tenant_id, staff_role
  from public.staff_members
  where id = staff_id;

  if staff_role != 'driver' then
    raise exception 'Only drivers can use this fallback';
  end if;

  if not public.driver_is_zone_template_default(staff_id) then
    raise exception 'Only zone template default drivers can load today''s default routes';
  end if;

  if public.current_operator_id() is null then
    raise exception 'Operator context not available for driver';
  end if;

  select count(*)
  into existing_count
  from public.routes
  where operator_id = tenant_id
    and scheduled_date = current_date
    and status != 'cancelled';

  if existing_count > 0 then
    return jsonb_build_object(
      'scheduledDate', current_date,
      'alreadyLoaded', true,
      'plannedCount', 0,
      'routeCount', existing_count,
      'hasAssignedRoute', exists (
        select 1 from public.routes
        where operator_id = tenant_id
          and scheduled_date = current_date
          and driver_id = staff_id
          and status in ('scheduled', 'in_progress')
      )
    );
  end if;

  planned_count := public.plan_daily_routes(current_date);

  select id
  into assigned_route_id
  from public.routes
  where operator_id = tenant_id
    and scheduled_date = current_date
    and driver_id = staff_id
    and status in ('scheduled', 'in_progress')
  limit 1;

  if assigned_route_id is not null then
    perform public.notify_route_plan_drivers(
      assigned_route_id,
      'routes_auto_loaded',
      'Default route loaded',
      'Today''s zone templates were loaded because the operator had not planned routes yet.'
    );
  end if;

  insert into public.driver_route_notices (
    operator_id,
    route_id,
    driver_id,
    notice_type,
    title,
    body
  )
  select
    routes.operator_id,
    routes.id,
    routes.driver_id,
    'routes_auto_loaded',
    'Default route loaded',
    'Today''s zone templates were loaded. Review your stops before starting the shift.'
  from public.routes
  where routes.operator_id = tenant_id
    and routes.scheduled_date = current_date
    and routes.status = 'scheduled'
    and routes.driver_id is not null
    and routes.driver_id <> staff_id;

  return jsonb_build_object(
    'scheduledDate', current_date,
    'alreadyLoaded', false,
    'plannedCount', planned_count,
    'routeCount', (
      select count(*) from public.routes
      where operator_id = tenant_id
        and scheduled_date = current_date
        and status != 'cancelled'
    ),
    'hasAssignedRoute', assigned_route_id is not null
  );
end;
$$;

-- Only return the driver's route for the requested operations date (no other-day soft fallback).
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
      and routes.status in ('scheduled', 'in_progress')
    order by routes.created_at desc
    limit 1
  )
  select coalesce(
    (
      select jsonb_build_object(
        'id', assigned_route.id,
        'zoneName', zones.name,
        'truckRegistration', coalesce(trucks.registration_number, 'Unassigned truck'),
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
      left join public.trucks on trucks.id = assigned_route.truck_id
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
