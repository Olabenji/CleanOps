create type public.truck_status as enum (
  'operational',
  'standby',
  'workshop'
);

alter table public.trucks
  add column status public.truck_status not null default 'operational';

create table public.fuel_logs (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  truck_id uuid not null references public.trucks(id) on delete cascade,
  driver_id uuid references public.staff_members(id) on delete set null,
  litres numeric(10, 2) not null check (litres > 0),
  cost_kobo integer not null check (cost_kobo > 0),
  station_name text not null,
  logged_at timestamptz not null default now()
);

create table public.dumpsite_runs (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  route_id uuid not null references public.routes(id) on delete cascade,
  departed_at timestamptz,
  arrived_at timestamptz,
  cleared_at timestamptz,
  tipping_fee_kobo integer not null default 0,
  notes text
);

alter table public.fuel_logs enable row level security;
alter table public.dumpsite_runs enable row level security;

create policy "tenant read fuel logs"
  on public.fuel_logs for select
  using (operator_id = public.current_operator_id());

create policy "tenant read dumpsite runs"
  on public.dumpsite_runs for select
  using (operator_id = public.current_operator_id());

create policy "operator managers write routes"
  on public.routes for all
  using (
    operator_id = public.current_operator_id()
    and public.current_app_role() in ('operator_owner', 'operations_supervisor')
  )
  with check (
    operator_id = public.current_operator_id()
    and public.current_app_role() in ('operator_owner', 'operations_supervisor')
  );

create policy "drivers update assigned route stops"
  on public.route_stops for update
  using (
    exists (
      select 1
      from public.routes
      where routes.id = route_stops.route_id
        and routes.operator_id = public.current_operator_id()
        and (
          public.current_app_role() in ('operator_owner', 'operations_supervisor')
          or routes.driver_id in (
            select staff_members.id
            from public.staff_members
            where staff_members.profile_id = auth.uid()
          )
        )
    )
  );

create policy "agents insert payments"
  on public.payments for insert
  with check (
    operator_id = public.current_operator_id()
    and public.current_app_role() in ('operator_owner', 'operations_supervisor', 'collection_agent')
  );

create policy "staff insert attendance"
  on public.attendance_logs for insert
  with check (
    operator_id = public.current_operator_id()
    and public.current_app_role() in (
      'operator_owner',
      'operations_supervisor',
      'driver',
      'collection_agent'
    )
  );

create policy "drivers insert fuel logs"
  on public.fuel_logs for insert
  with check (
    operator_id = public.current_operator_id()
    and public.current_app_role() in ('operator_owner', 'operations_supervisor', 'driver')
  );

create or replace function public.operator_dashboard_snapshot()
returns jsonb
language plpgsql
stable
security invoker
as $$
declare
  tenant_id uuid := public.current_operator_id();
  today date := current_date;
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
              and routes.scheduled_date = today
          ),
          'helper', 'Stops completed across today''s active routes'
        ),
        jsonb_build_object(
          'label', 'Payments Today',
          'value', (
            select concat('₦', trim(to_char(coalesce(sum(amount_kobo), 0) / 100, 'FM999G999G999G990')))
            from public.payments
            where operator_id = tenant_id
              and paid_at::date = today
          ),
          'helper', 'Paystack, transfers, and agent entries'
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
              and checked_in_at::date = today
          ),
          'helper', 'Attendance logged for today''s shift'
        ),
        jsonb_build_object(
          'label', 'Fleet Alerts',
          'value', (
            select concat(count(*), ' open')
            from public.incident_reports
            where operator_id = tenant_id
              and resolved_at is null
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
            and routes.scheduled_date = today
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
            and checked_in_at::date = today
        ),
        'absent', greatest(
          (select count(*) from public.staff_members where operator_id = tenant_id and active)
          - (
            select count(distinct staff_member_id)
            from public.attendance_logs
            where operator_id = tenant_id
              and checked_in_at::date = today
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
            and date_trunc('month', maintenance_events.event_date::timestamp) = date_trunc('month', today::timestamp)
        ) monthly_spend on true
        where trucks.operator_id = tenant_id
      ), '[]'::jsonb),
    'alerts',
      coalesce((
        select jsonb_agg(title order by created_at desc)
        from public.incident_reports
        where operator_id = tenant_id
          and resolved_at is null
      ), '[]'::jsonb)
  );
end;
$$;
