-- Operator exportable reports: collections, attendance, fleet costs, simple P&L summary.

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
      ), '[]'::jsonb)
    )
  );
end;
$$;

grant execute on function public.operator_reports_snapshot(date, date) to authenticated;
