-- Operator reconciliation view for field agent collections (Sprint 1 completion).

create or replace function public.operator_agent_collections_snapshot(input_date date default current_date)
returns jsonb
language plpgsql
stable
security invoker
as $$
declare
  tenant_id uuid := public.current_operator_id();
begin
  if public.current_app_role() not in ('operator_owner', 'operations_supervisor') then
    raise exception 'Only operators can view agent collection reconciliation';
  end if;

  return jsonb_build_object(
    'collectionDate', input_date,
    'totalCollectedKobo', coalesce((
      select sum(payments.amount_kobo)::int
      from public.payments
      join public.staff_members on staff_members.id = payments.collected_by_staff_id
      where payments.operator_id = tenant_id
        and staff_members.role = 'collection_agent'
        and payments.paid_at::date = input_date
    ), 0),
    'paymentCount', coalesce((
      select count(*)::int
      from public.payments
      join public.staff_members on staff_members.id = payments.collected_by_staff_id
      where payments.operator_id = tenant_id
        and staff_members.role = 'collection_agent'
        and payments.paid_at::date = input_date
    ), 0),
    'agents', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'agentStaffId', staff_members.id,
          'agentName', staff_members.full_name,
          'totalCollectedKobo', coalesce(agent_totals.total_collected_kobo, 0),
          'paymentCount', coalesce(agent_totals.payment_count, 0),
          'payments', coalesce(agent_totals.payments, '[]'::jsonb)
        )
        order by staff_members.full_name
      )
      from public.staff_members
      left join lateral (
        select
          sum(payments.amount_kobo)::int as total_collected_kobo,
          count(*)::int as payment_count,
          jsonb_agg(
            jsonb_build_object(
              'paymentId', payments.id,
              'customerName', customers.display_name,
              'amountKobo', payments.amount_kobo,
              'channel', payments.channel,
              'receiptReference', payments.external_reference,
              'paidAt', payments.paid_at
            )
            order by payments.paid_at desc
          ) as payments
        from public.payments
        join public.customers on customers.id = payments.customer_id
        where payments.operator_id = tenant_id
          and payments.collected_by_staff_id = staff_members.id
          and payments.paid_at::date = input_date
      ) agent_totals on true
      where staff_members.operator_id = tenant_id
        and staff_members.role = 'collection_agent'
        and (
          staff_members.active
          or coalesce(agent_totals.payment_count, 0) > 0
        )
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.onboard_customer(
  input_zone_id uuid,
  input_display_name text,
  input_phone text,
  input_address text,
  input_customer_type public.customer_type,
  input_monthly_rate_kobo integer,
  input_service_status public.service_status default 'active'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_id uuid := public.assert_admin_master_data_allowed();
  new_id uuid;
begin
  if not exists (select 1 from public.zones where id = input_zone_id and operator_id = tenant_id) then
    raise exception 'Zone not found';
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
    current_tag_month
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
    case when input_service_status = 'active' then date_trunc('month', current_date)::date else null end
  )
  returning id into new_id;

  return new_id;
end;
$$;
