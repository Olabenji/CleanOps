-- Migration 0019 added a 3-arg overload without dropping the original 2-arg function,
-- which makes RPC calls ambiguous when only input_customer_id and next_status are sent.
drop function if exists public.set_customer_service_status(uuid, public.service_status);

create or replace function public.set_customer_service_status(
  input_customer_id uuid,
  next_status public.service_status,
  input_suspension_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_id uuid := public.assert_admin_master_data_allowed();
begin
  update public.customers
  set
    service_status = next_status,
    suspension_reason = case
      when next_status = 'suspended' then coalesce(nullif(trim(input_suspension_reason), ''), 'Suspended by operator')
      else null
    end,
    current_tag_month = case
      when next_status = 'active' and current_tag_month is null then date_trunc('month', current_date)::date
      when next_status = 'suspended' then null
      else current_tag_month
    end
  where id = input_customer_id
    and operator_id = tenant_id;

  if not found then
    raise exception 'Customer not found';
  end if;
end;
$$;
