-- LAWMA collection frequency (Option 2): per-customer cadence + preferred weekdays,
-- due-today planning hints, and dashboard SLA alerts. Billing unchanged.

alter table public.customers
  add column if not exists collections_per_week smallint not null default 1,
  add column if not exists preferred_weekdays smallint[] not null default array[1]::smallint[],
  add column if not exists frequency_notes text;

alter table public.customers
  drop constraint if exists customers_collections_per_week_check;

alter table public.customers
  add constraint customers_collections_per_week_check
  check (collections_per_week between 1 and 7);

alter table public.customers
  drop constraint if exists customers_preferred_weekdays_check;

alter table public.customers
  add constraint customers_preferred_weekdays_check
  check (
    cardinality(preferred_weekdays) between 1 and 7
    and preferred_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
  );

comment on column public.customers.collections_per_week is
  'Agreed pickups per week. Residential LAWMA floor is 1; commercial is negotiated.';

comment on column public.customers.preferred_weekdays is
  'ISO weekdays (1=Mon … 7=Sun) when this customer is due for collection.';

comment on column public.customers.frequency_notes is
  'Optional site-evaluation notes for commercial frequency agreements.';

-- Backfill: zone rank maps residential/light accounts onto Mon–Fri; restaurants get 3× Mon/Wed/Fri.
with zone_rank as (
  select
    zones.id as zone_id,
    ((row_number() over (partition by zones.operator_id order by zones.name) - 1) % 5 + 1)::smallint as weekday
  from public.zones
)
update public.customers
set
  collections_per_week = case
    when customers.customer_type = 'restaurant' then 3
    else 1
  end,
  preferred_weekdays = case
    when customers.customer_type = 'restaurant' then array[1, 3, 5]::smallint[]
    else array[zone_rank.weekday]::smallint[]
  end,
  frequency_notes = case
    when customers.customer_type = 'restaurant' then 'Seed: restaurant multi-day cadence (Mon/Wed/Fri)'
    else null
  end
from zone_rank
where customers.zone_id = zone_rank.zone_id;

create or replace function public.onboard_customer(
  input_zone_id uuid,
  input_display_name text,
  input_phone text,
  input_address text,
  input_customer_type public.customer_type,
  input_monthly_rate_kobo integer,
  input_service_status public.service_status default 'active',
  input_collections_per_week smallint default 1,
  input_preferred_weekdays smallint[] default array[1]::smallint[],
  input_frequency_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_id uuid := public.assert_admin_master_data_allowed();
  new_id uuid;
  weekdays smallint[] := (
    select coalesce(array_agg(distinct d order by d), array[1]::smallint[])
    from unnest(coalesce(input_preferred_weekdays, array[1]::smallint[])) as d
    where d between 1 and 7
  );
  freq smallint := least(greatest(coalesce(input_collections_per_week, 1), 1), 7);
begin
  if not exists (select 1 from public.zones where id = input_zone_id and operator_id = tenant_id) then
    raise exception 'Zone not found';
  end if;

  if cardinality(weekdays) < 1 then
    raise exception 'Select at least one preferred collection weekday';
  end if;

  if input_phone is not null and trim(input_phone) != '' and exists (
    select 1 from public.customers
    where operator_id = tenant_id
      and phone = trim(input_phone)
  ) then
    raise exception 'A customer with this phone already exists';
  end if;

  insert into public.customers (
    operator_id,
    zone_id,
    display_name,
    phone,
    address,
    customer_type,
    monthly_rate_kobo,
    service_status,
    suspension_reason,
    current_tag_month,
    collections_per_week,
    preferred_weekdays,
    frequency_notes
  )
  values (
    tenant_id,
    input_zone_id,
    trim(input_display_name),
    nullif(trim(coalesce(input_phone, '')), ''),
    trim(input_address),
    input_customer_type,
    greatest(input_monthly_rate_kobo, 0),
    input_service_status,
    case
      when input_service_status = 'suspended' then 'Outstanding monthly balance unpaid'
      else null
    end,
    case when input_service_status = 'active' then date_trunc('month', current_date)::date else null end,
    freq,
    weekdays,
    nullif(trim(coalesce(input_frequency_notes, '')), '')
  )
  returning id into new_id;

  return new_id;
end;
$$;

create or replace function public.update_customer(
  input_customer_id uuid,
  input_zone_id uuid,
  input_display_name text,
  input_phone text,
  input_address text,
  input_customer_type public.customer_type,
  input_monthly_rate_kobo integer,
  input_collections_per_week smallint default 1,
  input_preferred_weekdays smallint[] default array[1]::smallint[],
  input_frequency_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_id uuid := public.assert_admin_master_data_allowed();
  current_zone_id uuid;
  normalized_phone text := nullif(trim(coalesce(input_phone, '')), '');
  weekdays smallint[] := (
    select coalesce(array_agg(distinct d order by d), array[1]::smallint[])
    from unnest(coalesce(input_preferred_weekdays, array[1]::smallint[])) as d
    where d between 1 and 7
  );
  freq smallint := least(greatest(coalesce(input_collections_per_week, 1), 1), 7);
begin
  select zone_id
  into current_zone_id
  from public.customers
  where id = input_customer_id
    and operator_id = tenant_id;

  if current_zone_id is null then
    raise exception 'Customer not found';
  end if;

  if not exists (
    select 1 from public.zones where id = input_zone_id and operator_id = tenant_id
  ) then
    raise exception 'Zone not found';
  end if;

  if cardinality(weekdays) < 1 then
    raise exception 'Select at least one preferred collection weekday';
  end if;

  if normalized_phone is not null and exists (
    select 1
    from public.customers
    where operator_id = tenant_id
      and phone = normalized_phone
      and id <> input_customer_id
  ) then
    raise exception 'A customer with this phone already exists';
  end if;

  if input_zone_id <> current_zone_id then
    if exists (
      select 1
      from public.route_stops
      join public.routes on routes.id = route_stops.route_id
      where route_stops.customer_id = input_customer_id
        and routes.operator_id = tenant_id
        and routes.status = 'in_progress'
        and routes.zone_id <> input_zone_id
    ) then
      raise exception 'Cannot move customer while they are on an in-progress route. Finish or reassign the stop first.';
    end if;

    delete from public.route_stops
    using public.routes
    where route_stops.route_id = routes.id
      and route_stops.customer_id = input_customer_id
      and routes.operator_id = tenant_id
      and routes.zone_id <> input_zone_id
      and routes.status = 'scheduled';

    delete from public.route_template_stops
    using public.route_templates
    where route_template_stops.template_id = route_templates.id
      and route_template_stops.customer_id = input_customer_id
      and route_templates.operator_id = tenant_id
      and route_templates.zone_id <> input_zone_id;
  end if;

  update public.customers
  set
    zone_id = input_zone_id,
    display_name = trim(input_display_name),
    phone = normalized_phone,
    address = trim(input_address),
    customer_type = input_customer_type,
    monthly_rate_kobo = greatest(input_monthly_rate_kobo, 0),
    collections_per_week = freq,
    preferred_weekdays = weekdays,
    frequency_notes = nullif(trim(coalesce(input_frequency_notes, '')), '')
  where id = input_customer_id;
end;
$$;

create or replace function public.admin_master_data()
returns jsonb
language sql
stable
security invoker
as $$
  select jsonb_build_object(
    'zones',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', zones.id,
            'name', zones.name,
            'description', zones.description
          )
          order by zones.name
        )
        from public.zones
        where zones.operator_id = public.current_operator_id()
      ), '[]'::jsonb),
    'staff',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', staff_members.id,
            'fullName', staff_members.full_name,
            'phone', staff_members.phone,
            'role', staff_members.role,
            'monthlySalaryKobo', staff_members.monthly_salary_kobo,
            'active', staff_members.active,
            'hasLoginProfile', staff_members.profile_id is not null,
            'loginEmail', staff_members.login_email,
            'licenceExpiresOn', staff_members.licence_expires_on,
            'licenceImageUrl', staff_members.licence_image_url
          )
          order by staff_members.active desc, staff_members.full_name
        )
        from public.staff_members
        where staff_members.operator_id = public.current_operator_id()
      ), '[]'::jsonb),
    'trucks',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', trucks.id,
            'zoneId', trucks.zone_id,
            'zoneName', zones.name,
            'registrationNumber', trucks.registration_number,
            'make', trucks.make,
            'model', trucks.model,
            'year', trucks.year,
            'status', trucks.status,
            'active', trucks.active
          )
          order by trucks.active desc, trucks.registration_number
        )
        from public.trucks
        left join public.zones on zones.id = trucks.zone_id
        where trucks.operator_id = public.current_operator_id()
      ), '[]'::jsonb),
    'customers',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', customers.id,
            'zoneId', customers.zone_id,
            'zoneName', zones.name,
            'displayName', customers.display_name,
            'phone', customers.phone,
            'address', customers.address,
            'customerType', customers.customer_type,
            'monthlyRateKobo', customers.monthly_rate_kobo,
            'serviceStatus', customers.service_status,
            'collectionsPerWeek', customers.collections_per_week,
            'preferredWeekdays', to_jsonb(customers.preferred_weekdays),
            'frequencyNotes', customers.frequency_notes
          )
          order by zones.name, customers.display_name
        )
        from public.customers
        join public.zones on zones.id = customers.zone_id
        where customers.operator_id = public.current_operator_id()
      ), '[]'::jsonb)
  );
$$;

create or replace function public.customer_ledger_snapshot()
returns jsonb
language sql
stable
security invoker
as $$
  with current_month_payments as (
    select
      payments.customer_id,
      sum(payments.amount_kobo)::int as paid_this_month_kobo
    from public.payments
    where payments.operator_id = public.current_operator_id()
      and date_trunc('month', payments.paid_at) = date_trunc('month', now())
    group by payments.customer_id
  ),
  latest_payments as (
    select distinct on (payments.customer_id)
      payments.customer_id,
      payments.paid_at,
      payments.amount_kobo,
      payments.channel
    from public.payments
    where payments.operator_id = public.current_operator_id()
    order by payments.customer_id, payments.paid_at desc
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'customerId', customers.id,
        'displayName', customers.display_name,
        'phone', customers.phone,
        'address', customers.address,
        'customerType', customers.customer_type,
        'zoneName', zones.name,
        'monthlyRateKobo', customers.monthly_rate_kobo,
        'paidThisMonthKobo', coalesce(current_month_payments.paid_this_month_kobo, 0),
        'outstandingKobo', greatest(
          customers.monthly_rate_kobo - coalesce(current_month_payments.paid_this_month_kobo, 0),
          0
        ),
        'serviceStatus', customers.service_status,
        'suspensionReason', customers.suspension_reason,
        'currentTagMonth', customers.current_tag_month,
        'lastPaymentAt', latest_payments.paid_at,
        'lastPaymentAmountKobo', latest_payments.amount_kobo,
        'lastPaymentChannel', latest_payments.channel,
        'collectionsPerWeek', customers.collections_per_week,
        'preferredWeekdays', to_jsonb(customers.preferred_weekdays),
        'frequencyNotes', customers.frequency_notes
      )
      order by zones.name, customers.display_name
    ),
    '[]'::jsonb
  )
  from public.customers
  join public.zones on zones.id = customers.zone_id
  left join current_month_payments on current_month_payments.customer_id = customers.id
  left join latest_payments on latest_payments.customer_id = customers.id
  where customers.operator_id = public.current_operator_id();
$$;

create or replace function public.search_customers(input_query text default null)
returns jsonb
language sql
stable
security invoker
as $$
  with current_month_payments as (
    select
      payments.customer_id,
      sum(payments.amount_kobo)::int as paid_this_month_kobo
    from public.payments
    where payments.operator_id = public.current_operator_id()
      and date_trunc('month', payments.paid_at) = date_trunc('month', now())
    group by payments.customer_id
  ),
  latest_payments as (
    select distinct on (payments.customer_id)
      payments.customer_id,
      payments.paid_at,
      payments.amount_kobo,
      payments.channel
    from public.payments
    where payments.operator_id = public.current_operator_id()
    order by payments.customer_id, payments.paid_at desc
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'customerId', customers.id,
        'displayName', customers.display_name,
        'phone', customers.phone,
        'address', customers.address,
        'customerType', customers.customer_type,
        'zoneName', zones.name,
        'monthlyRateKobo', customers.monthly_rate_kobo,
        'paidThisMonthKobo', coalesce(current_month_payments.paid_this_month_kobo, 0),
        'outstandingKobo', greatest(
          customers.monthly_rate_kobo - coalesce(current_month_payments.paid_this_month_kobo, 0),
          0
        ),
        'serviceStatus', customers.service_status,
        'suspensionReason', customers.suspension_reason,
        'currentTagMonth', customers.current_tag_month,
        'lastPaymentAt', latest_payments.paid_at,
        'lastPaymentAmountKobo', latest_payments.amount_kobo,
        'lastPaymentChannel', latest_payments.channel,
        'collectionsPerWeek', customers.collections_per_week,
        'preferredWeekdays', to_jsonb(customers.preferred_weekdays),
        'frequencyNotes', customers.frequency_notes
      )
      order by customers.display_name
    ),
    '[]'::jsonb
  )
  from public.customers
  join public.zones on zones.id = customers.zone_id
  left join current_month_payments on current_month_payments.customer_id = customers.id
  left join latest_payments on latest_payments.customer_id = customers.id
  where customers.operator_id = public.current_operator_id()
    and (
      input_query is null
      or trim(input_query) = ''
      or customers.display_name ilike '%' || trim(input_query) || '%'
      or coalesce(customers.phone, '') ilike '%' || trim(input_query) || '%'
      or customers.address ilike '%' || trim(input_query) || '%'
    )
  limit 25;
$$;

drop function if exists public.route_planning_options();

create or replace function public.route_planning_options(input_date date default current_date)
returns jsonb
language sql
stable
security invoker
as $$
  select jsonb_build_object(
    'zones',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', zones.id,
            'label', zones.name,
            'zoneId', zones.id,
            'helper', zones.description
          )
          order by zones.name
        )
        from public.zones
        where zones.operator_id = public.current_operator_id()
      ), '[]'::jsonb),
    'trucks',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', trucks.id,
            'label', trucks.registration_number,
            'zoneId', trucks.zone_id,
            'helper', concat(
              'Home: ',
              coalesce(zones.name, 'none'),
              ' · ',
              trucks.status
            )
          )
          order by trucks.registration_number
        )
        from public.trucks
        left join public.zones on zones.id = trucks.zone_id
        where trucks.operator_id = public.current_operator_id()
          and trucks.active
      ), '[]'::jsonb),
    'drivers',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', staff_members.id,
            'label', staff_members.full_name,
            'helper', staff_members.phone
          )
          order by staff_members.full_name
        )
        from public.staff_members
        where staff_members.operator_id = public.current_operator_id()
          and staff_members.role = 'driver'
          and staff_members.active
      ), '[]'::jsonb),
    'customers',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', customers.id,
            'zoneId', customers.zone_id,
            'label', customers.display_name,
            'helper', concat(
              customers.address,
              ' · ',
              customers.service_status,
              ' · ',
              customers.collections_per_week,
              'x/week',
              case
                when customers.service_status = 'active'
                  and extract(isodow from coalesce(input_date, current_date))::smallint
                      = any (customers.preferred_weekdays)
                then ' · Due today'
                else ''
              end
            ),
            'collectionsPerWeek', customers.collections_per_week,
            'preferredWeekdays', to_jsonb(customers.preferred_weekdays),
            'dueToday',
              customers.service_status = 'active'
              and extract(isodow from coalesce(input_date, current_date))::smallint
                  = any (customers.preferred_weekdays)
          )
          order by
            case
              when customers.service_status = 'active'
                and extract(isodow from coalesce(input_date, current_date))::smallint
                    = any (customers.preferred_weekdays)
              then 0
              else 1
            end,
            customers.display_name
        )
        from public.customers
        where customers.operator_id = public.current_operator_id()
      ), '[]'::jsonb)
  );
$$;

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
        )
        select coalesce(
          (
            select jsonb_agg(alert_text order by sort_key, sort_ts desc)
            from (
              select * from incident_alerts
              union all
              select * from sla_alerts
            ) combined
          ),
          '[]'::jsonb
        )
      )
  );
end;
$$;

grant execute on function public.route_planning_options(date) to authenticated;
