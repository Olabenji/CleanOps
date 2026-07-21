-- Resident home portal slice: schedule + Know Your PSP + own balance.

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
    'zoneTrucks', zone_trucks.trucks
  )
  into result
  from public.customers
  join public.zones on zones.id = customers.zone_id
  join public.operators on operators.id = customers.operator_id
  cross join month_payments
  cross join zone_trucks
  left join latest_payment on true
  where customers.id = v_customer_id
    and customers.operator_id = v_tenant_id;

  if result is null then
    raise exception 'Resident customer record not found';
  end if;

  return result;
end;
$$;

grant execute on function public.get_resident_home() to authenticated;
