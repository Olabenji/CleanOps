-- record_agent_payment declared a PL/pgSQL variable `paid_at` that shadowed
-- payments.paid_at in the monthly sum query, causing "column reference paid_at is ambiguous".
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
  payment_paid_at timestamptz := now();
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
    payment_paid_at
  )
  on conflict (operator_id, idempotency_key) do update
    set external_reference = excluded.external_reference
  returning id into new_payment_id;

  select coalesce(sum(payments.amount_kobo), 0)::int
  into paid_this_month
  from public.payments
  where payments.operator_id = tenant_id
    and payments.customer_id = input_customer_id
    and date_trunc('month', payments.paid_at) = date_trunc('month', now());

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
    'paidAt', payment_paid_at,
    'outstandingKobo', outstanding_balance
  );
end;
$$;
