-- Resident missed-collection / service complaint submission (#137).
-- Scoped to current_customer_id(); does not reuse operator create/list RPCs.

create or replace function public.submit_resident_service_complaint(
  input_title text,
  input_description text,
  input_category text default 'missed_stop'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid := public.current_customer_id();
  v_tenant_id uuid := public.current_operator_id();
  v_zone_id uuid;
  v_category text := lower(trim(coalesce(input_category, 'missed_stop')));
  v_title text := nullif(trim(input_title), '');
  v_description text := nullif(trim(input_description), '');
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if public.current_app_role() is distinct from 'resident' then
    raise exception 'Only residents can submit resident complaints';
  end if;

  if v_customer_id is null or v_tenant_id is null then
    raise exception 'Resident account is not linked to a customer';
  end if;

  if v_title is null or char_length(v_title) < 3 then
    raise exception 'Complaint title is required';
  end if;

  if v_description is null or char_length(v_description) < 5 then
    raise exception 'Complaint description is required';
  end if;

  if v_category not in ('missed_stop', 'overflow', 'crew', 'billing', 'illegal_dump', 'other') then
    raise exception 'Invalid complaint category';
  end if;

  select customers.zone_id
  into v_zone_id
  from public.customers
  where customers.id = v_customer_id
    and customers.operator_id = v_tenant_id;

  if not found then
    raise exception 'Resident customer record not found';
  end if;

  insert into public.service_complaints (
    operator_id,
    customer_id,
    zone_id,
    source,
    category,
    title,
    description,
    sla_due_at
  )
  values (
    v_tenant_id,
    v_customer_id,
    v_zone_id,
    'resident',
    v_category,
    v_title,
    v_description,
    now() + interval '24 hours'
  )
  returning id into new_id;

  return new_id;
end;
$$;

create or replace function public.list_my_service_complaints()
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
    raise exception 'Only residents can list their complaints';
  end if;

  if v_customer_id is null or v_tenant_id is null then
    raise exception 'Resident account is not linked to a customer';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'customerId', c.customer_id,
        'customerName', customers.display_name,
        'routeId', c.route_id,
        'zoneName', zones.name,
        'source', c.source,
        'category', c.category,
        'title', c.title,
        'description', c.description,
        'status', c.status,
        'acknowledgedAt', c.acknowledged_at,
        'resolvedAt', c.resolved_at,
        'escalatedAt', c.escalated_at,
        'slaDueAt', c.sla_due_at,
        'resolutionNotes', c.resolution_notes,
        'createdAt', c.created_at,
        'slaBreached',
          c.resolved_at is null
          and c.sla_due_at < now()
      )
      order by c.created_at desc
    ),
    '[]'::jsonb
  )
  into result
  from public.service_complaints c
  left join public.customers on customers.id = c.customer_id
  left join public.zones on zones.id = c.zone_id
  where c.operator_id = v_tenant_id
    and c.customer_id = v_customer_id;

  return result;
end;
$$;

-- Prevent residents from reading the tenant-wide operator inbox via invoker RPC.
create or replace function public.list_service_complaints(input_date date default current_date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if public.current_operator_id() is null then
    raise exception 'Not authenticated';
  end if;

  if public.current_app_role() not in (
    'operator_owner',
    'operations_supervisor',
    'collection_agent',
    'platform_admin'
  ) then
    raise exception 'Not allowed to list operator complaints';
  end if;

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'customerId', c.customer_id,
          'customerName', customers.display_name,
          'routeId', c.route_id,
          'zoneName', zones.name,
          'source', c.source,
          'category', c.category,
          'title', c.title,
          'description', c.description,
          'status', c.status,
          'acknowledgedAt', c.acknowledged_at,
          'resolvedAt', c.resolved_at,
          'escalatedAt', c.escalated_at,
          'slaDueAt', c.sla_due_at,
          'resolutionNotes', c.resolution_notes,
          'createdAt', c.created_at,
          'slaBreached',
            c.resolved_at is null
            and c.sla_due_at < now()
        )
        order by
          case when c.resolved_at is null and c.sla_due_at < now() then 0 else 1 end,
          c.created_at desc
      ),
      '[]'::jsonb
    )
    from public.service_complaints c
    left join public.customers on customers.id = c.customer_id
    left join public.zones on zones.id = c.zone_id
    where c.operator_id = public.current_operator_id()
      and c.created_at::date <= coalesce(input_date, current_date)
  );
end;
$$;

grant execute on function public.submit_resident_service_complaint(text, text, text) to authenticated;
grant execute on function public.list_my_service_complaints() to authenticated;
grant execute on function public.list_service_complaints(date) to authenticated;

-- Residents may only read their own complaint rows via RLS (operator inbox remains staff).
drop policy if exists "tenant read service complaints" on public.service_complaints;

create policy "staff or own resident read service complaints"
  on public.service_complaints for select
  using (
    operator_id = public.current_operator_id()
    and (
      public.current_app_role() in (
        'operator_owner',
        'operations_supervisor',
        'collection_agent',
        'platform_admin'
      )
      or (
        public.current_app_role() = 'resident'
        and customer_id is not null
        and customer_id = public.current_customer_id()
      )
    )
  );
