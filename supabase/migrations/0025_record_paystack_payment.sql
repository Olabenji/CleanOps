-- Idempotent Paystack payment posting for the paystack-webhook Edge Function.
-- Called with the service role; not available to anon/authenticated clients.

create or replace function public.record_paystack_payment(
  input_operator_id uuid,
  input_customer_id uuid,
  input_amount_kobo integer,
  input_external_reference text,
  input_paid_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  customer_operator_id uuid;
  monthly_rate integer;
  payment_reference text;
  idempotency text;
  new_payment_id uuid;
  payment_paid_at timestamptz;
  paid_this_month integer;
  outstanding_balance integer;
  already_posted boolean := false;
begin
  if input_amount_kobo is null or input_amount_kobo <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;

  payment_reference := nullif(trim(input_external_reference), '');
  if payment_reference is null then
    raise exception 'Paystack reference is required';
  end if;

  select customers.operator_id, customers.monthly_rate_kobo
  into customer_operator_id, monthly_rate
  from public.customers
  where customers.id = input_customer_id;

  if customer_operator_id is null then
    raise exception 'Customer not found';
  end if;

  if customer_operator_id <> input_operator_id then
    raise exception 'Customer does not belong to operator';
  end if;

  idempotency := concat('paystack:', payment_reference);
  payment_paid_at := coalesce(input_paid_at, now());

  select payments.id
  into new_payment_id
  from public.payments
  where payments.operator_id = input_operator_id
    and payments.idempotency_key = idempotency
  limit 1;

  if new_payment_id is not null then
    already_posted := true;
  else
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
      input_operator_id,
      input_customer_id,
      null,
      'paystack',
      input_amount_kobo,
      payment_reference,
      idempotency,
      payment_paid_at
    )
    on conflict (operator_id, idempotency_key) do update
      set external_reference = excluded.external_reference
    returning id into new_payment_id;

    already_posted := false;
  end if;

  perform public.reconcile_customer_service_after_payment(input_customer_id, input_operator_id);

  select coalesce(sum(payments.amount_kobo), 0)::int
  into paid_this_month
  from public.payments
  where payments.operator_id = input_operator_id
    and payments.customer_id = input_customer_id
    and date_trunc('month', payments.paid_at) = date_trunc('month', now());

  outstanding_balance := greatest(monthly_rate - paid_this_month, 0);

  return jsonb_build_object(
    'paymentId', new_payment_id,
    'receiptReference', payment_reference,
    'amountKobo', input_amount_kobo,
    'channel', 'paystack',
    'paidAt', payment_paid_at,
    'outstandingKobo', outstanding_balance,
    'alreadyPosted', already_posted
  );
end;
$$;

revoke all on function public.record_paystack_payment(uuid, uuid, integer, text, timestamptz) from public;
revoke all on function public.record_paystack_payment(uuid, uuid, integer, text, timestamptz) from anon;
revoke all on function public.record_paystack_payment(uuid, uuid, integer, text, timestamptz) from authenticated;
grant execute on function public.record_paystack_payment(uuid, uuid, integer, text, timestamptz) to service_role;

comment on function public.record_paystack_payment(uuid, uuid, integer, text, timestamptz) is
  'Posts a Paystack charge.success payment idempotently and reconciles customer service status. Service-role only.';
