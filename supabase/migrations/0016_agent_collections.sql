create or replace function public.record_operator_payment(
  input_customer_id uuid,
  input_channel public.payment_channel,
  input_amount_kobo integer,
  input_external_reference text default null
)
returns uuid
language plpgsql
security invoker
as $$
declare
  tenant_id uuid;
  new_payment_id uuid;
  payment_reference text;
  monthly_rate integer;
  paid_this_month integer;
  outstanding_balance integer;
  collector_staff_id uuid;
begin
  if input_amount_kobo <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;

  if public.current_app_role() not in ('operator_owner', 'operations_supervisor', 'collection_agent') then
    raise exception 'Payment recording is not permitted for this role';
  end if;

  select operator_id, monthly_rate_kobo
  into tenant_id, monthly_rate
  from public.customers
  where id = input_customer_id
    and operator_id = public.current_operator_id();

  if tenant_id is null then
    raise exception 'Customer not found';
  end if;

  select staff_members.id
  into collector_staff_id
  from public.staff_members
  where staff_members.profile_id = auth.uid()
    and staff_members.operator_id = public.current_operator_id()
    and staff_members.active
  limit 1;

  payment_reference := coalesce(
    nullif(trim(input_external_reference), ''),
    concat('manual:', gen_random_uuid()::text)
  );

  insert into public.payments (
    operator_id,
    customer_id,
    collected_by_staff_id,
    channel,
    amount_kobo,
    external_reference,
    idempotency_key
  )
  values (
    tenant_id,
    input_customer_id,
    collector_staff_id,
    input_channel,
    input_amount_kobo,
    payment_reference,
    concat('operator:', payment_reference)
  )
  returning id into new_payment_id;

  select coalesce(sum(amount_kobo), 0)::int
  into paid_this_month
  from public.payments
  where operator_id = tenant_id
    and customer_id = input_customer_id
    and date_trunc('month', paid_at) = date_trunc('month', now());

  outstanding_balance := greatest(monthly_rate - paid_this_month, 0);

  update public.customers
  set
    service_status = case
      when outstanding_balance = 0 then 'active'
      else service_status
    end,
    current_tag_month = case
      when outstanding_balance = 0 then date_trunc('month', current_date)::date
      else current_tag_month
    end
  where id = input_customer_id
    and operator_id = tenant_id;

  return new_payment_id;
end;
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
        'currentTagMonth', customers.current_tag_month
      )
      order by customers.display_name
    ),
    '[]'::jsonb
  )
  from public.customers
  join public.zones on zones.id = customers.zone_id
  left join current_month_payments on current_month_payments.customer_id = customers.id
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

create or replace function public.record_agent_payment(
  input_customer_id uuid,
  input_amount_kobo integer,
  input_channel public.payment_channel default 'agent_cash',
  input_external_reference text default null,
  input_idempotency_key text default null
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  agent_staff_id uuid;
  tenant_id uuid;
  customer_name text;
  monthly_rate integer;
  payment_reference text;
  idempotency text;
  new_payment_id uuid;
  paid_this_month integer;
  outstanding_balance integer;
  paid_at timestamptz := now();
begin
  if public.current_app_role() not in ('collection_agent', 'operator_owner', 'operations_supervisor') then
    raise exception 'Only collection agents and operators can record agent payments';
  end if;

  if input_amount_kobo <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;

  select staff_members.id
  into agent_staff_id
  from public.staff_members
  where staff_members.profile_id = auth.uid()
    and staff_members.operator_id = public.current_operator_id()
    and staff_members.role = 'collection_agent'
    and staff_members.active
  limit 1;

  if agent_staff_id is null and public.current_app_role() = 'collection_agent' then
    raise exception 'Active collection agent profile not found';
  end if;

  select customers.operator_id, customers.display_name, customers.monthly_rate_kobo
  into tenant_id, customer_name, monthly_rate
  from public.customers
  where customers.id = input_customer_id
    and customers.operator_id = public.current_operator_id();

  if tenant_id is null then
    raise exception 'Customer not found';
  end if;

  payment_reference := coalesce(
    nullif(trim(input_external_reference), ''),
    concat('RCP-', to_char(now(), 'YYMMDD'), '-', upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)))
  );

  idempotency := coalesce(
    nullif(trim(input_idempotency_key), ''),
    concat('agent:', payment_reference)
  );

  insert into public.payments (
    operator_id,
    customer_id,
    collected_by_staff_id,
    channel,
    amount_kobo,
    external_reference,
    idempotency_key,
    paid_at
  )
  values (
    tenant_id,
    input_customer_id,
    agent_staff_id,
    input_channel,
    input_amount_kobo,
    payment_reference,
    idempotency,
    paid_at
  )
  on conflict (operator_id, idempotency_key) do update
    set external_reference = excluded.external_reference
  returning id into new_payment_id;

  select coalesce(sum(amount_kobo), 0)::int
  into paid_this_month
  from public.payments
  where operator_id = tenant_id
    and customer_id = input_customer_id
    and date_trunc('month', paid_at) = date_trunc('month', now());

  outstanding_balance := greatest(monthly_rate - paid_this_month, 0);

  update public.customers
  set
    service_status = case
      when outstanding_balance = 0 then 'active'
      else service_status
    end,
    current_tag_month = case
      when outstanding_balance = 0 then date_trunc('month', current_date)::date
      else current_tag_month
    end
  where id = input_customer_id
    and operator_id = tenant_id;

  return jsonb_build_object(
    'paymentId', new_payment_id,
    'receiptReference', payment_reference,
    'customerName', customer_name,
    'amountKobo', input_amount_kobo,
    'channel', input_channel,
    'paidAt', paid_at,
    'outstandingKobo', outstanding_balance
  );
end;
$$;

create or replace function public.agent_daily_collection_summary(input_date date default current_date)
returns jsonb
language plpgsql
stable
security invoker
as $$
declare
  agent_staff_id uuid;
  agent_name text;
begin
  select staff_members.id, staff_members.full_name
  into agent_staff_id, agent_name
  from public.staff_members
  where staff_members.profile_id = auth.uid()
    and staff_members.operator_id = public.current_operator_id()
    and staff_members.role = 'collection_agent'
    and staff_members.active
  limit 1;

  if agent_staff_id is null and public.current_app_role() = 'collection_agent' then
    raise exception 'Active collection agent profile not found';
  end if;

  return jsonb_build_object(
    'collectionDate', input_date,
    'agentName', coalesce(agent_name, 'Collection agent'),
    'totalCollectedKobo', coalesce((
      select sum(payments.amount_kobo)::int
      from public.payments
      where payments.operator_id = public.current_operator_id()
        and payments.collected_by_staff_id = agent_staff_id
        and payments.paid_at::date = input_date
    ), 0),
    'paymentCount', coalesce((
      select count(*)::int
      from public.payments
      where payments.operator_id = public.current_operator_id()
        and payments.collected_by_staff_id = agent_staff_id
        and payments.paid_at::date = input_date
    ), 0),
    'payments', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'paymentId', payments.id,
          'customerName', customers.display_name,
          'amountKobo', payments.amount_kobo,
          'channel', payments.channel,
          'receiptReference', payments.external_reference,
          'paidAt', payments.paid_at
        )
        order by payments.paid_at desc
      )
      from public.payments
      join public.customers on customers.id = payments.customer_id
      where payments.operator_id = public.current_operator_id()
        and payments.collected_by_staff_id = agent_staff_id
        and payments.paid_at::date = input_date
    ), '[]'::jsonb)
  );
end;
$$;
