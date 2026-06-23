create or replace function public.operator_dashboard_snapshot(input_date date default current_date)
returns jsonb
language plpgsql
stable
security invoker
as $$
declare
  tenant_id uuid := public.current_operator_id();
  operation_date date := coalesce(input_date, current_date);
begin
  if tenant_id is null then
    return null;
  end if;

  return jsonb_build_object(
    'operatorName',
      coalesce((select name from public.operators where id = tenant_id), 'CleanOps Operator'),
    'metrics',
      jsonb_build_array(
        jsonb_build_object(
          'label', 'Route Progress',
          'value', (
            select concat(
              coalesce(count(*) filter (where route_stops.status = 'completed'), 0),
              ' / ',
              coalesce(count(*), 0),
              ' stops'
            )
            from public.routes
            join public.route_stops on route_stops.route_id = routes.id
            where routes.operator_id = tenant_id
              and routes.scheduled_date = operation_date
          ),
          'helper', 'Stops completed across selected date routes'
        ),
        jsonb_build_object(
          'label', 'Payments',
          'value', (
            select concat('₦', trim(to_char(coalesce(sum(amount_kobo), 0) / 100, 'FM999G999G999G990')))
            from public.payments
            where operator_id = tenant_id
              and paid_at::date = operation_date
          ),
          'helper', 'Payments recorded on selected date'
        ),
        jsonb_build_object(
          'label', 'Staff Checked In',
          'value', (
            select concat(
              count(distinct attendance_logs.staff_member_id),
              ' / ',
              (select count(*) from public.staff_members where operator_id = tenant_id and active)
            )
            from public.attendance_logs
            where operator_id = tenant_id
              and checked_in_at::date = operation_date
          ),
          'helper', 'Attendance logged for selected date'
        ),
        jsonb_build_object(
          'label', 'Open Incidents',
          'value', (
            select concat(count(*), ' open')
            from public.incident_reports
            where operator_id = tenant_id
              and resolved_at is null
              and created_at::date <= operation_date
          ),
          'helper', 'Unresolved vehicle or route incidents'
        )
      ),
    'routes',
      coalesce((
        with route_progress as (
          select
            routes.id,
            zones.name as zone_name,
            trucks.registration_number,
            coalesce(staff_members.full_name, 'Unassigned') as driver_name,
            routes.status,
            count(route_stops.id) filter (where route_stops.status = 'completed')::int as completed_stops,
            greatest(count(route_stops.id), 1)::int as total_stops
          from public.routes
          join public.zones on zones.id = routes.zone_id
          join public.trucks on trucks.id = routes.truck_id
          left join public.staff_members on staff_members.id = routes.driver_id
          left join public.route_stops on route_stops.route_id = routes.id
          where routes.operator_id = tenant_id
            and routes.scheduled_date = operation_date
          group by routes.id, zones.name, trucks.registration_number, staff_members.full_name, routes.status
          order by zones.name
        )
        select jsonb_agg(
          jsonb_build_object(
            'id', id,
            'zoneName', zone_name,
            'truckRegistration', registration_number,
            'driverName', driver_name,
            'status', status,
            'completedStops', completed_stops,
            'totalStops', total_stops,
            'delayed', status = 'in_progress' and completed_stops::numeric / total_stops < 0.35
          )
        )
        from route_progress
      ), '[]'::jsonb),
    'recentPayments',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', payments.id,
            'customerName', customers.display_name,
            'channel', payments.channel,
            'amountKobo', payments.amount_kobo,
            'paidAt', payments.paid_at
          )
          order by payments.paid_at desc
        )
        from (
          select *
          from public.payments
          where operator_id = tenant_id
            and paid_at::date = operation_date
          order by paid_at desc
          limit 5
        ) payments
        join public.customers on customers.id = payments.customer_id
      ), '[]'::jsonb),
    'staffAttendance',
      jsonb_build_object(
        'totalStaff', (select count(*) from public.staff_members where operator_id = tenant_id and active),
        'checkedIn', (
          select count(distinct staff_member_id)
          from public.attendance_logs
          where operator_id = tenant_id
            and checked_in_at::date = operation_date
        ),
        'absent', greatest(
          (select count(*) from public.staff_members where operator_id = tenant_id and active)
          - (
            select count(distinct staff_member_id)
            from public.attendance_logs
            where operator_id = tenant_id
              and checked_in_at::date = operation_date
          ),
          0
        )
      ),
    'fleet',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'registrationNumber', trucks.registration_number,
            'zoneName', coalesce(zones.name, 'Standby'),
            'status', trucks.status,
            'reserveRemainingKobo', greatest(
              trucks.monthly_maintenance_reserve_kobo - coalesce(monthly_spend.spend_kobo, 0),
              0
            )
          )
          order by trucks.registration_number
        )
        from public.trucks
        left join public.zones on zones.id = trucks.zone_id
        left join lateral (
          select sum(cost_kobo) as spend_kobo
          from public.maintenance_events
          where maintenance_events.truck_id = trucks.id
            and date_trunc('month', maintenance_events.event_date::timestamp) = date_trunc('month', operation_date::timestamp)
        ) monthly_spend on true
        where trucks.operator_id = tenant_id
      ), '[]'::jsonb),
    'alerts',
      coalesce((
        select jsonb_agg(title order by created_at desc)
        from public.incident_reports
        where operator_id = tenant_id
          and resolved_at is null
          and created_at::date <= operation_date
      ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.recent_incident_reports(
  input_limit integer default 10,
  input_date date default null
)
returns jsonb
language sql
stable
security invoker
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', incidents.id,
        'routeId', incidents.route_id,
        'routeLabel', zones.name,
        'truckRegistration', trucks.registration_number,
        'reportedBy', staff_members.full_name,
        'title', incidents.title,
        'description', incidents.description,
        'resolvedAt', incidents.resolved_at,
        'createdAt', incidents.created_at
      )
      order by incidents.created_at desc
    ),
    '[]'::jsonb
  )
  from (
    select *
    from public.incident_reports
    where operator_id = public.current_operator_id()
      and (input_date is null or created_at::date = input_date)
    order by created_at desc
    limit least(greatest(input_limit, 1), 50)
  ) incidents
  left join public.routes on routes.id = incidents.route_id
  left join public.zones on zones.id = routes.zone_id
  left join public.trucks on trucks.id = incidents.truck_id
  left join public.staff_members on staff_members.id = incidents.reported_by_staff_id;
$$;

create or replace function public.plan_daily_routes(input_scheduled_date date)
returns integer
language plpgsql
security definer
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
        where route_stops.route_id = routes.id
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
      route_stops.stop_sequence,
      'pending'
    from public.route_stops
    where route_stops.route_id = template_route.id
    order by route_stops.stop_sequence;

    planned_count := planned_count + 1;
  end loop;

  return planned_count;
end;
$$;
