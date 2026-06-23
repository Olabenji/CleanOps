create policy "operator managers update customers"
  on public.customers for update
  using (
    operator_id = public.current_operator_id()
    and public.current_app_role() in ('operator_owner', 'operations_supervisor')
  )
  with check (
    operator_id = public.current_operator_id()
    and public.current_app_role() in ('operator_owner', 'operations_supervisor')
  );

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
        'currentTagMonth', customers.current_tag_month,
        'lastPaymentAt', latest_payments.paid_at,
        'lastPaymentAmountKobo', latest_payments.amount_kobo,
        'lastPaymentChannel', latest_payments.channel
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

create or replace function public.customer_payment_history(input_customer_id uuid)
returns jsonb
language sql
stable
security invoker
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', payments.id,
        'customerName', customers.display_name,
        'channel', payments.channel,
        'amountKobo', payments.amount_kobo,
        'paidAt', payments.paid_at,
        'customerType', customers.customer_type,
        'address', customers.address,
        'serviceStatus', customers.service_status
      )
      order by payments.paid_at desc
    ),
    '[]'::jsonb
  )
  from public.payments
  join public.customers on customers.id = payments.customer_id
  where payments.operator_id = public.current_operator_id()
    and payments.customer_id = input_customer_id;
$$;

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
begin
  if input_amount_kobo <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;

  select operator_id, monthly_rate_kobo
  into tenant_id, monthly_rate
  from public.customers
  where id = input_customer_id
    and operator_id = public.current_operator_id();

  if tenant_id is null then
    raise exception 'Customer not found';
  end if;

  payment_reference := coalesce(
    nullif(trim(input_external_reference), ''),
    concat('manual:', gen_random_uuid()::text)
  );

  insert into public.payments (
    operator_id,
    customer_id,
    channel,
    amount_kobo,
    external_reference,
    idempotency_key
  )
  values (
    tenant_id,
    input_customer_id,
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

create or replace function public.update_customer_account_status(
  input_customer_id uuid,
  next_status public.service_status,
  next_tag_month date default null
)
returns uuid
language plpgsql
security invoker
as $$
begin
  update public.customers
  set
    service_status = next_status,
    current_tag_month = case
      when next_status = 'active' then coalesce(next_tag_month, current_tag_month, date_trunc('month', current_date)::date)
      else next_tag_month
    end
  where id = input_customer_id
    and operator_id = public.current_operator_id();

  if not found then
    raise exception 'Customer status update was not permitted';
  end if;

  return input_customer_id;
end;
$$;
