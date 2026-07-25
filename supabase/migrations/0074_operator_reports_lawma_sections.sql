-- Extend operator_reports_snapshot with LAWMA-oriented ops sections:
-- ward collection coverage, disposal/tonnage tips, complaints, make-goods.

create or replace function public.operator_reports_snapshot(
  input_from_date date default null,
  input_to_date date default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  tenant_id uuid := public.current_operator_id();
  app_role text := public.current_app_role();
  from_date date := coalesce(input_from_date, date_trunc('month', public.operation_current_date())::date);
  to_date date := coalesce(input_to_date, public.operation_current_date());
  collections_kobo bigint := 0;
  payroll_kobo bigint := 0;
  fuel_kobo bigint := 0;
  maintenance_kobo bigint := 0;
  tipping_kobo bigint := 0;
  stops_planned int := 0;
  stops_completed int := 0;
  stops_missed int := 0;
  tonnes_total numeric := 0;
  tips_with_docket int := 0;
  tips_total int := 0;
  complaints_opened int := 0;
  complaints_resolved int := 0;
  complaints_sla_breached int := 0;
  make_goods_opened int := 0;
  make_goods_completed int := 0;
  make_goods_open_now int := 0;
begin
  if tenant_id is null then
    return null;
  end if;

  if app_role not in ('operator_owner', 'operations_supervisor', 'platform_admin') then
    raise exception 'Not allowed to load reports';
  end if;

  if to_date < from_date then
    raise exception 'Report end date must be on or after start date';
  end if;

  select coalesce(sum(payments.amount_kobo), 0)::bigint
  into collections_kobo
  from public.payments
  where payments.operator_id = tenant_id
    and payments.paid_at::date between from_date and to_date;

  select coalesce(sum((staff_members.monthly_salary_kobo / 22.0)::bigint), 0)::bigint
  into payroll_kobo
  from (
    select distinct
      attendance_logs.staff_member_id,
      attendance_logs.checked_in_at::date as attendance_day
    from public.attendance_logs
    where attendance_logs.operator_id = tenant_id
      and attendance_logs.checked_in_at::date between from_date and to_date
  ) days
  join public.staff_members on staff_members.id = days.staff_member_id
  where staff_members.operator_id = tenant_id;

  select coalesce(sum(fuel_logs.cost_kobo), 0)::bigint
  into fuel_kobo
  from public.fuel_logs
  where fuel_logs.operator_id = tenant_id
    and fuel_logs.logged_at::date between from_date and to_date;

  select coalesce(sum(maintenance_events.cost_kobo), 0)::bigint
  into maintenance_kobo
  from public.maintenance_events
  where maintenance_events.operator_id = tenant_id
    and maintenance_events.event_date between from_date and to_date;

  select coalesce(sum(dumpsite_runs.tipping_fee_kobo), 0)::bigint
  into tipping_kobo
  from public.dumpsite_runs
  where dumpsite_runs.operator_id = tenant_id
    and coalesce(dumpsite_runs.cleared_at, dumpsite_runs.arrived_at, dumpsite_runs.departed_at)::date
      between from_date and to_date;

  select
    coalesce(count(*), 0)::int,
    coalesce(count(*) filter (where route_stops.status = 'completed'), 0)::int,
    coalesce(
      count(*) filter (where route_stops.status in ('skipped', 'missed_reported')),
      0
    )::int
  into stops_planned, stops_completed, stops_missed
  from public.routes
  join public.route_stops on route_stops.route_id = routes.id
  where routes.operator_id = tenant_id
    and routes.scheduled_date between from_date and to_date
    and routes.status <> 'cancelled';

  select
    coalesce(sum(dumpsite_runs.weighbridge_tonnes), 0),
    coalesce(count(*), 0)::int,
    coalesce(count(*) filter (where nullif(trim(dumpsite_runs.docket_number), '') is not null), 0)::int
  into tonnes_total, tips_total, tips_with_docket
  from public.dumpsite_runs
  where dumpsite_runs.operator_id = tenant_id
    and coalesce(dumpsite_runs.cleared_at, dumpsite_runs.arrived_at, dumpsite_runs.departed_at)::date
      between from_date and to_date;

  select
    coalesce(count(*), 0)::int,
    coalesce(count(*) filter (where service_complaints.resolved_at is not null), 0)::int,
    coalesce(
      count(*) filter (
        where service_complaints.resolved_at is null
          and service_complaints.sla_due_at < now()
      ),
      0
    )::int
  into complaints_opened, complaints_resolved, complaints_sla_breached
  from public.service_complaints
  where service_complaints.operator_id = tenant_id
    and service_complaints.created_at::date between from_date and to_date;

  select
    coalesce(count(*) filter (
      where collection_make_goods.opened_at::date between from_date and to_date
    ), 0)::int,
    coalesce(count(*) filter (
      where collection_make_goods.status = 'completed'
        and coalesce(collection_make_goods.completed_at::date, collection_make_goods.target_date)
          between from_date and to_date
    ), 0)::int,
    coalesce(count(*) filter (
      where collection_make_goods.status in ('open', 'scheduled')
    ), 0)::int
  into make_goods_opened, make_goods_completed, make_goods_open_now
  from public.collection_make_goods
  where collection_make_goods.operator_id = tenant_id
    and (
      collection_make_goods.opened_at::date between from_date and to_date
      or (
        collection_make_goods.status = 'completed'
        and coalesce(collection_make_goods.completed_at::date, collection_make_goods.target_date)
          between from_date and to_date
      )
      or collection_make_goods.status in ('open', 'scheduled')
    );

  return (
    select jsonb_build_object(
      'fromDate', from_date,
      'toDate', to_date,
      'summary', jsonb_build_object(
        'collectionsKobo', collections_kobo,
        'payrollEstimateKobo', payroll_kobo,
        'fuelSpendKobo', fuel_kobo,
        'maintenanceSpendKobo', maintenance_kobo,
        'tippingFeesKobo', tipping_kobo,
        'opsCostKobo', payroll_kobo + fuel_kobo + maintenance_kobo + tipping_kobo,
        'netKobo', collections_kobo - (payroll_kobo + fuel_kobo + maintenance_kobo + tipping_kobo)
      ),
      'lawmaSummary', jsonb_build_object(
        'stopsPlanned', stops_planned,
        'stopsCompleted', stops_completed,
        'stopsMissed', stops_missed,
        'coveragePercent', case
          when stops_planned = 0 then 0
          else round((stops_completed::numeric / stops_planned::numeric) * 100, 1)
        end,
        'weighbridgeTonnes', tonnes_total,
        'disposalTips', tips_total,
        'tipsWithDocket', tips_with_docket,
        'complaintsOpened', complaints_opened,
        'complaintsResolved', complaints_resolved,
        'complaintsSlaBreached', complaints_sla_breached,
        'makeGoodsOpened', make_goods_opened,
        'makeGoodsCompleted', make_goods_completed,
        'makeGoodsOpenNow', make_goods_open_now
      ),
      'collections', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'paymentId', payments.id,
            'paidAt', payments.paid_at,
            'customerName', customers.display_name,
            'channel', payments.channel,
            'amountKobo', payments.amount_kobo,
            'externalReference', payments.external_reference,
            'collectedBy', staff_members.full_name
          )
          order by payments.paid_at desc
        )
        from public.payments
        join public.customers on customers.id = payments.customer_id
        left join public.staff_members on staff_members.id = payments.collected_by_staff_id
        where payments.operator_id = tenant_id
          and payments.paid_at::date between from_date and to_date
      ), '[]'::jsonb),
      'attendance', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'attendanceId', attendance_logs.id,
            'checkedInAt', attendance_logs.checked_in_at,
            'staffName', staff_members.full_name,
            'role', staff_members.role,
            'supervisorOverride', attendance_logs.supervisor_override,
            'notes', attendance_logs.notes,
            'dayPayrollEstimateKobo', (staff_members.monthly_salary_kobo / 22.0)::bigint
          )
          order by attendance_logs.checked_in_at desc
        )
        from public.attendance_logs
        join public.staff_members on staff_members.id = attendance_logs.staff_member_id
        where attendance_logs.operator_id = tenant_id
          and attendance_logs.checked_in_at::date between from_date and to_date
      ), '[]'::jsonb),
      'fleetCosts', coalesce((
        select jsonb_agg(row_data order by (row_data->>'occurredAt') desc)
        from (
          select jsonb_build_object(
            'id', fuel_logs.id,
            'costType', 'fuel',
            'occurredAt', fuel_logs.logged_at,
            'label', trucks.registration_number || ' · ' || fuel_logs.station_name,
            'detail', fuel_logs.litres::text || ' L',
            'amountKobo', fuel_logs.cost_kobo
          ) as row_data
          from public.fuel_logs
          join public.trucks on trucks.id = fuel_logs.truck_id
          where fuel_logs.operator_id = tenant_id
            and fuel_logs.logged_at::date between from_date and to_date

          union all

          select jsonb_build_object(
            'id', maintenance_events.id,
            'costType', 'maintenance',
            'occurredAt', maintenance_events.event_date::timestamptz,
            'label', trucks.registration_number || ' · ' || coalesce(maintenance_events.workshop_name, 'Workshop'),
            'detail', maintenance_events.work_done,
            'amountKobo', maintenance_events.cost_kobo
          )
          from public.maintenance_events
          join public.trucks on trucks.id = maintenance_events.truck_id
          where maintenance_events.operator_id = tenant_id
            and maintenance_events.event_date between from_date and to_date

          union all

          select jsonb_build_object(
            'id', dumpsite_runs.id,
            'costType', 'tipping',
            'occurredAt', coalesce(dumpsite_runs.cleared_at, dumpsite_runs.arrived_at, dumpsite_runs.departed_at),
            'label', coalesce(zones.name, 'Route') || ' · ' || coalesce(trucks.registration_number, 'Truck'),
            'detail', coalesce(dumpsite_runs.notes, 'Dumpsite tipping fee'),
            'amountKobo', dumpsite_runs.tipping_fee_kobo
          )
          from public.dumpsite_runs
          join public.routes on routes.id = dumpsite_runs.route_id
          left join public.zones on zones.id = routes.zone_id
          left join public.trucks on trucks.id = routes.truck_id
          where dumpsite_runs.operator_id = tenant_id
            and dumpsite_runs.tipping_fee_kobo > 0
            and coalesce(dumpsite_runs.cleared_at, dumpsite_runs.arrived_at, dumpsite_runs.departed_at)::date
              between from_date and to_date
        ) costs
      ), '[]'::jsonb),
      'wardCoverage', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'wardId', ward_id,
            'wardName', ward_name,
            'stopsPlanned', stops_planned_count,
            'stopsCompleted', stops_completed_count,
            'stopsMissed', stops_missed_count,
            'makeGoodStops', make_good_stops_count,
            'coveragePercent', case
              when stops_planned_count = 0 then 0
              else round((stops_completed_count::numeric / stops_planned_count::numeric) * 100, 1)
            end
          )
          order by ward_name
        )
        from (
          select
            zones.id as ward_id,
            zones.name as ward_name,
            count(*)::int as stops_planned_count,
            count(*) filter (where route_stops.status = 'completed')::int as stops_completed_count,
            count(*) filter (
              where route_stops.status in ('skipped', 'missed_reported')
            )::int as stops_missed_count,
            count(*) filter (where route_stops.is_make_good)::int as make_good_stops_count
          from public.routes
          join public.route_stops on route_stops.route_id = routes.id
          join public.zones on zones.id = routes.zone_id
          where routes.operator_id = tenant_id
            and routes.scheduled_date between from_date and to_date
            and routes.status <> 'cancelled'
          group by zones.id, zones.name
        ) ward_rows
      ), '[]'::jsonb),
      'disposalTips', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'runId', dumpsite_runs.id,
            'occurredAt', coalesce(dumpsite_runs.cleared_at, dumpsite_runs.arrived_at, dumpsite_runs.departed_at),
            'wardName', zones.name,
            'truckRegistration', trucks.registration_number,
            'dumpsiteSiteName', dumpsite_runs.dumpsite_site_name,
            'docketNumber', dumpsite_runs.docket_number,
            'weighbridgeTonnes', dumpsite_runs.weighbridge_tonnes,
            'tippingFeeKobo', dumpsite_runs.tipping_fee_kobo,
            'cleared', dumpsite_runs.cleared_at is not null
          )
          order by coalesce(dumpsite_runs.cleared_at, dumpsite_runs.arrived_at, dumpsite_runs.departed_at) desc
        )
        from public.dumpsite_runs
        join public.routes on routes.id = dumpsite_runs.route_id
        left join public.zones on zones.id = routes.zone_id
        left join public.trucks on trucks.id = routes.truck_id
        where dumpsite_runs.operator_id = tenant_id
          and coalesce(dumpsite_runs.cleared_at, dumpsite_runs.arrived_at, dumpsite_runs.departed_at)::date
            between from_date and to_date
      ), '[]'::jsonb),
      'serviceComplaints', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'complaintId', service_complaints.id,
            'createdAt', service_complaints.created_at,
            'category', service_complaints.category,
            'title', service_complaints.title,
            'status', service_complaints.status,
            'wardName', zones.name,
            'customerName', customers.display_name,
            'slaDueAt', service_complaints.sla_due_at,
            'resolvedAt', service_complaints.resolved_at,
            'slaBreached',
              service_complaints.resolved_at is null
              and service_complaints.sla_due_at < now()
          )
          order by service_complaints.created_at desc
        )
        from public.service_complaints
        left join public.customers on customers.id = service_complaints.customer_id
        left join public.zones on zones.id = service_complaints.zone_id
        where service_complaints.operator_id = tenant_id
          and service_complaints.created_at::date between from_date and to_date
      ), '[]'::jsonb),
      'makeGoods', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'makeGoodId', collection_make_goods.id,
            'customerName', customers.display_name,
            'wardName', zones.name,
            'status', collection_make_goods.status,
            'sourceDate', collection_make_goods.source_date,
            'targetDate', collection_make_goods.target_date,
            'dueBy', collection_make_goods.due_by,
            'attemptCount', collection_make_goods.attempt_count,
            'openedAt', collection_make_goods.opened_at,
            'completedAt', collection_make_goods.completed_at,
            'skipReason', coalesce(
              source_stop.skip_reason,
              source_stop.notes,
              case
                when collection_make_goods.source_route_stop_id is not null then 'Missed collection'
                else null
              end
            )
          )
          order by
            case
              when collection_make_goods.status in ('open', 'scheduled') then 0
              else 1
            end,
            collection_make_goods.target_date,
            customers.display_name
        )
        from public.collection_make_goods
        join public.customers on customers.id = collection_make_goods.customer_id
        join public.zones on zones.id = customers.zone_id
        left join public.route_stops source_stop
          on source_stop.id = collection_make_goods.source_route_stop_id
        where collection_make_goods.operator_id = tenant_id
          and (
            collection_make_goods.opened_at::date between from_date and to_date
            or (
              collection_make_goods.status = 'completed'
              and coalesce(
                collection_make_goods.completed_at::date,
                collection_make_goods.target_date
              ) between from_date and to_date
            )
            or collection_make_goods.status in ('open', 'scheduled')
          )
      ), '[]'::jsonb)
    )
  );
end;
$$;

grant execute on function public.operator_reports_snapshot(date, date) to authenticated;
