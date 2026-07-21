-- Frequency-aware planning + make-good carryover (Sprint 14).

alter table public.route_stops
  add column if not exists is_make_good boolean not null default false;

create table if not exists public.collection_make_goods (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  source_route_id uuid references public.routes(id) on delete set null,
  source_route_stop_id uuid references public.route_stops(id) on delete set null,
  source_date date not null,
  status text not null default 'open'
    check (status in ('open', 'scheduled', 'completed', 'cancelled')),
  due_by date not null,
  opened_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_route_stop_id uuid references public.route_stops(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists collection_make_goods_one_active_per_customer
  on public.collection_make_goods (customer_id)
  where status in ('open', 'scheduled');

create index if not exists collection_make_goods_operator_status_idx
  on public.collection_make_goods (operator_id, status, due_by);

alter table public.collection_make_goods enable row level security;

drop policy if exists "tenant read make goods" on public.collection_make_goods;
create policy "tenant read make goods"
  on public.collection_make_goods for select
  using (
    operator_id = public.current_operator_id()
    and (
      public.current_app_role() in (
        'operator_owner',
        'operations_supervisor',
        'collection_agent',
        'driver',
        'platform_admin'
      )
      or (
        public.current_app_role() = 'resident'
        and customer_id = public.current_customer_id()
      )
    )
  );

drop policy if exists "managers write make goods" on public.collection_make_goods;
create policy "managers write make goods"
  on public.collection_make_goods for all
  using (
    operator_id = public.current_operator_id()
    and public.current_app_role() in ('operator_owner', 'operations_supervisor', 'driver', 'collection_agent')
  )
  with check (
    operator_id = public.current_operator_id()
    and public.current_app_role() in ('operator_owner', 'operations_supervisor', 'driver', 'collection_agent')
  );

create or replace function public.enqueue_collection_make_good(input_stop_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  stop_row public.route_stops%rowtype;
  route_row public.routes%rowtype;
  customer_row public.customers%rowtype;
  was_due boolean := false;
  already_active boolean := false;
  window_days integer;
begin
  select * into stop_row from public.route_stops where id = input_stop_id;
  if stop_row.id is null then
    return;
  end if;

  select * into route_row from public.routes where id = stop_row.route_id;
  if route_row.id is null then
    return;
  end if;

  select * into customer_row from public.customers where id = stop_row.customer_id;
  if customer_row.id is null then
    return;
  end if;

  was_due :=
    stop_row.is_make_good
    or extract(isodow from route_row.scheduled_date)::int = any (customer_row.preferred_weekdays);

  select exists (
    select 1
    from public.collection_make_goods
    where customer_id = customer_row.id
      and status in ('open', 'scheduled')
  )
  into already_active;

  if not was_due and not already_active then
    return;
  end if;

  if already_active then
    return;
  end if;

  window_days := greatest(ceil(7.0 / greatest(customer_row.collections_per_week, 1))::int, 1);

  insert into public.collection_make_goods (
    operator_id,
    customer_id,
    source_route_id,
    source_route_stop_id,
    source_date,
    status,
    due_by
  )
  values (
    route_row.operator_id,
    customer_row.id,
    route_row.id,
    stop_row.id,
    route_row.scheduled_date,
    'open',
    route_row.scheduled_date + window_days
  );
end;
$$;

create or replace function public.clear_collection_make_good(
  input_customer_id uuid,
  input_completed_stop_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.collection_make_goods
  set
    status = 'completed',
    completed_at = now(),
    completed_route_stop_id = coalesce(input_completed_stop_id, completed_route_stop_id)
  where customer_id = input_customer_id
    and status in ('open', 'scheduled');
end;
$$;

create or replace function public.update_route_stop_status(
  input_stop_id uuid,
  next_status public.route_stop_status,
  input_notes text default null,
  input_skip_reason text default null
)
returns uuid
language plpgsql
security invoker
as $$
declare
  parent_route_id uuid;
  stop_customer_id uuid;
begin
  select route_id, customer_id
  into parent_route_id, stop_customer_id
  from public.route_stops
  where id = input_stop_id;

  if parent_route_id is null then
    raise exception 'Route stop not found';
  end if;

  if next_status = 'skipped' and nullif(trim(coalesce(input_skip_reason, '')), '') is null then
    raise exception 'Skip reason is required';
  end if;

  update public.route_stops
  set
    status = next_status,
    completed_at = case when next_status = 'completed' then now() else null end,
    notes = nullif(trim(coalesce(input_notes, notes, '')), ''),
    skip_reason = case
      when next_status = 'skipped' then nullif(trim(coalesce(input_skip_reason, '')), '')
      else null
    end
  where id = input_stop_id;

  if not found then
    raise exception 'Route stop update was not permitted';
  end if;

  if next_status in ('skipped', 'missed_reported') then
    perform public.enqueue_collection_make_good(input_stop_id);
  elsif next_status = 'completed' then
    perform public.clear_collection_make_good(stop_customer_id, input_stop_id);
  end if;

  perform public.reconcile_route_progress(parent_route_id);

  return parent_route_id;
end;
$$;

create or replace function public.plan_daily_routes(input_scheduled_date date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_id uuid := public.current_operator_id();
  planned_count integer := 0;
  zone_row record;
  template_row public.route_templates%rowtype;
  prior_route public.routes%rowtype;
  new_route_id uuid;
  resolved_template_id uuid;
  dow integer := extract(isodow from input_scheduled_date)::int;
begin
  if tenant_id is null then
    raise exception 'Operator profile not found';
  end if;

  if public.current_app_role() not in ('operator_owner', 'operations_supervisor', 'driver') then
    raise exception 'Not allowed to plan daily routes';
  end if;

  if public.current_app_role() = 'driver'
    and input_scheduled_date <> public.operation_current_date() then
    raise exception 'Drivers can only load default routes for today';
  end if;

  perform public.ensure_zone_default_templates(tenant_id);

  for zone_row in
    select zones.id, zones.name
    from public.zones
    where zones.operator_id = tenant_id
    order by zones.name
  loop
    if exists (
      select 1
      from public.routes
      where operator_id = tenant_id
        and zone_id = zone_row.id
        and scheduled_date = input_scheduled_date
        and status != 'cancelled'
    ) then
      continue;
    end if;

    select *
    into template_row
    from public.route_templates
    where operator_id = tenant_id
      and zone_id = zone_row.id
      and kind = 'zone_default';

    if template_row.id is null then
      select *
      into prior_route
      from public.routes
      where operator_id = tenant_id
        and zone_id = zone_row.id
        and scheduled_date < input_scheduled_date
        and status != 'cancelled'
        and exists (
          select 1
          from public.route_stops
          join public.customers on customers.id = route_stops.customer_id
          where route_stops.route_id = routes.id
            and customers.zone_id = routes.zone_id
        )
      order by scheduled_date desc, created_at desc
      limit 1;

      if prior_route.id is null then
        continue;
      end if;

      resolved_template_id := public.upsert_zone_default_template_from_route(prior_route.id);
      select * into template_row from public.route_templates where id = resolved_template_id;
    end if;

    if not exists (
      select 1 from public.route_template_stops
      where route_template_stops.template_id = template_row.id
    ) then
      continue;
    end if;

    insert into public.routes (
      operator_id,
      zone_id,
      truck_id,
      driver_id,
      scheduled_date,
      status
    )
    values (
      tenant_id,
      zone_row.id,
      template_row.truck_id,
      template_row.driver_id,
      input_scheduled_date,
      'scheduled'
    )
    returning id into new_route_id;

    insert into public.route_stops (
      route_id,
      customer_id,
      stop_sequence,
      status,
      is_make_good
    )
    select
      new_route_id,
      eligible.customer_id,
      row_number() over (order by eligible.stop_sequence),
      'pending',
      eligible.is_make_good
    from (
      select
        route_template_stops.customer_id,
        route_template_stops.stop_sequence,
        exists (
          select 1
          from public.collection_make_goods mg
          where mg.customer_id = customers.id
            and mg.operator_id = tenant_id
            and mg.status in ('open', 'scheduled')
        ) as is_make_good
      from public.route_template_stops
      join public.customers on customers.id = route_template_stops.customer_id
      where route_template_stops.template_id = template_row.id
        and customers.zone_id = zone_row.id
        and customers.service_status = 'active'
        and (
          dow = any (customers.preferred_weekdays)
          or exists (
            select 1
            from public.collection_make_goods mg
            where mg.customer_id = customers.id
              and mg.operator_id = tenant_id
              and mg.status in ('open', 'scheduled')
          )
        )
    ) eligible
    order by eligible.stop_sequence;

    if not exists (select 1 from public.route_stops where route_id = new_route_id) then
      delete from public.routes where id = new_route_id;
      continue;
    end if;

    update public.collection_make_goods mg
    set status = 'scheduled'
    where mg.operator_id = tenant_id
      and mg.status = 'open'
      and exists (
        select 1
        from public.route_stops rs
        where rs.route_id = new_route_id
          and rs.customer_id = mg.customer_id
      );

    planned_count := planned_count + 1;
  end loop;

  return planned_count;
end;
$$;

-- Dashboard alerts include make-good open/overdue counts.
create or replace function public.operator_dashboard_snapshot(input_date date default current_date)
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

create or replace function public.get_resident_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_customer_id uuid := public.current_customer_id();
  v_tenant_id uuid := public.current_operator_id();
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if public.current_app_role() is distinct from 'resident' then
    raise exception 'Only residents can load the resident home';
  end if;

  if v_customer_id is null or v_tenant_id is null then
    raise exception 'Resident account is not linked to a customer';
  end if;

  with month_payments as (
    select coalesce(sum(payments.amount_kobo), 0)::int as paid_this_month_kobo
    from public.payments
    where payments.operator_id = v_tenant_id
      and payments.customer_id = v_customer_id
      and date_trunc('month', payments.paid_at) = date_trunc('month', timezone(public.operation_timezone(), now()))
  ),
  latest_payment as (
    select
      payments.paid_at,
      payments.amount_kobo,
      payments.channel
    from public.payments
    where payments.operator_id = v_tenant_id
      and payments.customer_id = v_customer_id
    order by payments.paid_at desc
    limit 1
  ),
  zone_trucks as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'registrationNumber', trucks.registration_number,
          'status', trucks.status
        )
        order by trucks.registration_number
      ),
      '[]'::jsonb
    ) as trucks
    from public.trucks
    join public.customers on customers.zone_id = trucks.zone_id
    where customers.id = v_customer_id
      and trucks.operator_id = v_tenant_id
      and trucks.active
  ),
  active_make_good as (
    select
      true as active,
      mg.source_date,
      mg.due_by,
      mg.status
    from public.collection_make_goods mg
    where mg.customer_id = v_customer_id
      and mg.operator_id = v_tenant_id
      and mg.status in ('open', 'scheduled')
    order by mg.opened_at desc
    limit 1
  )
  select jsonb_build_object(
    'customerId', customers.id,
    'displayName', customers.display_name,
    'address', customers.address,
    'phone', customers.phone,
    'email', customers.email,
    'customerType', customers.customer_type,
    'zoneName', zones.name,
    'serviceStatus', customers.service_status,
    'suspensionReason', customers.suspension_reason,
    'collectionsPerWeek', customers.collections_per_week,
    'preferredWeekdays', to_jsonb(customers.preferred_weekdays),
    'frequencyNotes', customers.frequency_notes,
    'monthlyRateKobo', customers.monthly_rate_kobo,
    'paidThisMonthKobo', month_payments.paid_this_month_kobo,
    'outstandingKobo', greatest(
      customers.monthly_rate_kobo - month_payments.paid_this_month_kobo,
      0
    ),
    'lastPaymentAt', latest_payment.paid_at,
    'lastPaymentAmountKobo', latest_payment.amount_kobo,
    'lastPaymentChannel', latest_payment.channel,
    'psp', jsonb_build_object(
      'operatorName', operators.name,
      'brandName', operators.brand_name,
      'primaryContactPhone', operators.primary_contact_phone,
      'lawmaReference', operators.lawma_reference,
      'timezone', operators.timezone
    ),
    'zoneTrucks', zone_trucks.trucks,
    'makeGood', case
      when active_make_good.active then jsonb_build_object(
        'active', true,
        'sourceDate', active_make_good.source_date,
        'dueBy', active_make_good.due_by,
        'status', active_make_good.status
      )
      else null
    end
  )
  into result
  from public.customers
  join public.zones on zones.id = customers.zone_id
  join public.operators on operators.id = customers.operator_id
  cross join month_payments
  cross join zone_trucks
  left join latest_payment on true
  left join active_make_good on true
  where customers.id = v_customer_id
    and customers.operator_id = v_tenant_id;

  if result is null then
    raise exception 'Resident customer record not found';
  end if;

  return result;
end;
$$;

drop function if exists public.driver_assigned_route(date);

create function public.driver_assigned_route(input_date date default null)
returns jsonb
language sql
stable
security invoker
as $$
  with params as (
    select coalesce(input_date, public.operation_current_date()) as target_date
  ),
  driver_staff as (
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
    cross join params
    where routes.operator_id = public.current_operator_id()
      and routes.scheduled_date = params.target_date
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
              'serviceStatus', customers.service_status,
              'isMakeGood', route_stops.is_make_good
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

-- Soft gate: still allows supervisors to add off-frequency stops (manual override).
-- Sets is_make_good when the customer already has an open/scheduled make-good.
drop function if exists public.add_route_plan_stop(uuid, uuid);

create or replace function public.add_route_plan_stop(input_route_id uuid, input_customer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  route_record public.routes%rowtype;
  customer_row public.customers%rowtype;
  next_sequence integer;
  dow integer;
  is_due boolean := false;
  has_make_good boolean := false;
  warning_text text := null;
begin
  route_record := public.assert_route_planning_allowed(input_route_id);

  select *
  into customer_row
  from public.customers
  where id = input_customer_id
    and operator_id = route_record.operator_id;

  if customer_row.id is null then
    raise exception 'Customer not found';
  end if;

  perform public.assert_route_stop_zone_match(input_route_id, input_customer_id);

  if exists (
    select 1
    from public.route_stops
    where route_id = input_route_id
      and customer_id = input_customer_id
  ) then
    raise exception 'Customer is already on this route';
  end if;

  dow := extract(isodow from route_record.scheduled_date)::int;
  is_due := dow = any (customer_row.preferred_weekdays);

  select exists (
    select 1
    from public.collection_make_goods
    where customer_id = customer_row.id
      and operator_id = route_record.operator_id
      and status in ('open', 'scheduled')
  )
  into has_make_good;

  if not is_due and not has_make_good then
    warning_text := format(
      'Customer is not due on this weekday (ISO DOW %s). Added as manual override.',
      dow
    );
  end if;

  select coalesce(max(stop_sequence), 0) + 1
  into next_sequence
  from public.route_stops
  where route_id = input_route_id;

  insert into public.route_stops (
    route_id,
    customer_id,
    stop_sequence,
    status,
    is_make_good
  )
  values (
    input_route_id,
    input_customer_id,
    next_sequence,
    'pending',
    has_make_good
  );

  if has_make_good then
    update public.collection_make_goods
    set status = 'scheduled'
    where customer_id = customer_row.id
      and operator_id = route_record.operator_id
      and status = 'open';
  end if;

  perform public.notify_route_plan_drivers(input_route_id);

  return jsonb_build_object(
    'ok', true,
    'warning', warning_text,
    'isMakeGood', has_make_good
  );
end;
$$;

grant execute on function public.enqueue_collection_make_good(uuid) to authenticated;
grant execute on function public.clear_collection_make_good(uuid, uuid) to authenticated;
grant execute on function public.plan_daily_routes(date) to authenticated;
grant execute on function public.operator_dashboard_snapshot(date) to authenticated;
grant execute on function public.get_resident_home() to authenticated;
grant execute on function public.driver_assigned_route(date) to authenticated;
grant execute on function public.update_route_stop_status(uuid, public.route_stop_status, text, text) to authenticated;
grant execute on function public.add_route_plan_stop(uuid, uuid) to authenticated;
