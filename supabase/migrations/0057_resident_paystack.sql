-- Resident payment history + RLS harden for self-serve Paystack (#138).

create or replace function public.list_my_payments()
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
    raise exception 'Only residents can list their payments';
  end if;

  if v_customer_id is null or v_tenant_id is null then
    raise exception 'Resident account is not linked to a customer';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', payments.id,
        'channel', payments.channel,
        'amountKobo', payments.amount_kobo,
        'paidAt', payments.paid_at,
        'externalReference', payments.external_reference
      )
      order by payments.paid_at desc
    ),
    '[]'::jsonb
  )
  into result
  from public.payments
  where payments.operator_id = v_tenant_id
    and payments.customer_id = v_customer_id;

  return result;
end;
$$;

-- Context helper for edge checkout: own customer ids + email only.
create or replace function public.get_resident_checkout_context()
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
    raise exception 'Only residents can start checkout';
  end if;

  if v_customer_id is null or v_tenant_id is null then
    raise exception 'Resident account is not linked to a customer';
  end if;

  select jsonb_build_object(
    'customerId', customers.id,
    'operatorId', customers.operator_id,
    'displayName', customers.display_name,
    'email', coalesce(nullif(trim(customers.email), ''), nullif(trim(auth.jwt() ->> 'email'), '')),
    'outstandingKobo', greatest(
      customers.monthly_rate_kobo - coalesce((
        select sum(payments.amount_kobo)::int
        from public.payments
        where payments.customer_id = customers.id
          and payments.operator_id = customers.operator_id
          and date_trunc('month', payments.paid_at) =
            date_trunc('month', timezone(public.operation_timezone(), now()))
      ), 0),
      0
    )
  )
  into result
  from public.customers
  where customers.id = v_customer_id
    and customers.operator_id = v_tenant_id;

  if result is null then
    raise exception 'Resident customer record not found';
  end if;

  return result;
end;
$$;

drop policy if exists "tenant read payments" on public.payments;

create policy "staff or own resident read payments"
  on public.payments for select
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
        and customer_id is not null
        and customer_id = public.current_customer_id()
      )
    )
  );

grant execute on function public.list_my_payments() to authenticated;
grant execute on function public.get_resident_checkout_context() to authenticated;
