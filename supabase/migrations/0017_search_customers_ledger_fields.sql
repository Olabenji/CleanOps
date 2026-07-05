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
        'currentTagMonth', customers.current_tag_month,
        'lastPaymentAt', latest_payments.paid_at,
        'lastPaymentAmountKobo', latest_payments.amount_kobo,
        'lastPaymentChannel', latest_payments.channel
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
