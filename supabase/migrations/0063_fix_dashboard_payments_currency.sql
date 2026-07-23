-- Fix dashboard Payments metric: ASCII NGN prefix instead of ₦ (renders as ??? in some browsers/fonts).
create or replace function public.operator_dashboard_snapshot(input_date date default null)
returns jsonb
language plpgsql
stable
security invoker
as $$
declare
  tenant_id uuid := public.current_operator_id();
  operation_date date := coalesce(input_date, public.operation_current_date());
  open_make_good_count integer := 0;
  overdue_make_good_count integer := 0;
  stale_route_count integer := 0;
begin
  if tenant_id is null then
    return null;
  end if;

  select
    count(*) filter (where status in ('open', 'scheduled')),
    count(*) filter (where status in ('open', 'scheduled') and due_by < operation_date)
  into open_make_good_count, overdue_make_good_count
  from public.collection_make_goods
  where operator_id = tenant_id;

  select count(*)
  into stale_route_count
  from public.routes
  where operator_id = tenant_id
    and scheduled_date < operation_date
    and status in ('scheduled', 'in_progress');

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
            select concat('NGN ', trim(to_char(coalesce(sum(amount_kobo), 0) / 100, 'FM999G999G999G990')))
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
      (
        with overdue as (
          select
            customers.customer_type,
            customers.collections_per_week,
            case
              when customers.customer_type in ('residential', 'estate') then 'residential'
              else 'commercial'
            end as sla_bucket
          from public.customers
          left join lateral (
            select max(route_stops.completed_at::date) as last_completed
            from public.route_stops
            join public.routes on routes.id = route_stops.route_id
            where route_stops.customer_id = customers.id
              and routes.operator_id = tenant_id
              and route_stops.status = 'completed'
          ) last_service on true
          where customers.operator_id = tenant_id
            and customers.service_status = 'active'
            and coalesce(last_service.last_completed, customers.created_at::date)
              < operation_date - ceil(7.0 / customers.collections_per_week)::int
        ),
        incident_alerts as (
          select title as alert_text, 0 as sort_key, created_at as sort_ts
          from public.incident_reports
          where operator_id = tenant_id
            and resolved_at is null
            and created_at::date <= operation_date
        ),
        sla_alerts as (
          select
            case
              when sla_bucket = 'residential' then
                concat(
                  count(*),
                  ' residential customer',
                  case when count(*) = 1 then '' else 's' end,
                  ' overdue for LAWMA weekly pickup'
                )
              else
                concat(
                  count(*),
                  ' commercial customer',
                  case when count(*) = 1 then '' else 's' end,
                  ' overdue for agreed collection frequency'
                )
            end as alert_text,
            case when sla_bucket = 'residential' then 1 else 2 end as sort_key,
            operation_date::timestamptz as sort_ts
          from overdue
          group by sla_bucket
        ),
        make_good_alerts as (
          select
            concat(
              open_make_good_count,
              ' missed collection',
              case when open_make_good_count = 1 then '' else 's' end,
              ' awaiting make-good'
            ) as alert_text,
            3 as sort_key,
            operation_date::timestamptz as sort_ts
          where open_make_good_count > 0
          union all
          select
            concat(
              overdue_make_good_count,
              ' make-good',
              case when overdue_make_good_count = 1 then '' else 's' end,
              ' past frequency SLA window'
            ) as alert_text,
            4 as sort_key,
            operation_date::timestamptz as sort_ts
          where overdue_make_good_count > 0
          union all
          select
            concat(
              stale_route_count,
              ' incomplete route',
              case when stale_route_count = 1 then '' else 's' end,
              ' from prior days need supervisor close'
            ) as alert_text,
            5 as sort_key,
            operation_date::timestamptz as sort_ts
          where stale_route_count > 0
        )
        select coalesce(
          (
            select jsonb_agg(alert_text order by sort_key, sort_ts desc)
            from (
              select * from incident_alerts
              union all
              select * from sla_alerts
              union all
              select * from make_good_alerts
            ) combined
          ),
          '[]'::jsonb
        )
      )
  );
end;
$$;

grant execute on function public.operator_dashboard_snapshot(date) to authenticated;

