create or replace function public.assert_admin_master_data_allowed()
returns uuid
language plpgsql
security definer
as $$
declare
  tenant_id uuid := public.current_operator_id();
begin
  if tenant_id is null then
    raise exception 'Operator profile not found';
  end if;

  if public.current_app_role() not in ('operator_owner', 'operations_supervisor') then
    raise exception 'Only operators and supervisors can manage admin master data';
  end if;

  return tenant_id;
end;
$$;

create or replace function public.admin_master_data()
returns jsonb
language sql
stable
security invoker
as $$
  select jsonb_build_object(
    'zones',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', zones.id,
            'name', zones.name,
            'description', zones.description
          )
          order by zones.name
        )
        from public.zones
        where zones.operator_id = public.current_operator_id()
      ), '[]'::jsonb),
    'staff',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', staff_members.id,
            'fullName', staff_members.full_name,
            'phone', staff_members.phone,
            'role', staff_members.role,
            'monthlySalaryKobo', staff_members.monthly_salary_kobo,
            'active', staff_members.active,
            'hasLoginProfile', staff_members.profile_id is not null
          )
          order by staff_members.active desc, staff_members.full_name
        )
        from public.staff_members
        where staff_members.operator_id = public.current_operator_id()
      ), '[]'::jsonb),
    'trucks',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', trucks.id,
            'zoneId', trucks.zone_id,
            'zoneName', zones.name,
            'registrationNumber', trucks.registration_number,
            'make', trucks.make,
            'model', trucks.model,
            'year', trucks.year,
            'status', trucks.status,
            'active', trucks.active
          )
          order by trucks.active desc, trucks.registration_number
        )
        from public.trucks
        left join public.zones on zones.id = trucks.zone_id
        where trucks.operator_id = public.current_operator_id()
      ), '[]'::jsonb),
    'customers',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', customers.id,
            'zoneId', customers.zone_id,
            'zoneName', zones.name,
            'displayName', customers.display_name,
            'phone', customers.phone,
            'address', customers.address,
            'customerType', customers.customer_type,
            'monthlyRateKobo', customers.monthly_rate_kobo,
            'serviceStatus', customers.service_status
          )
          order by zones.name, customers.display_name
        )
        from public.customers
        join public.zones on zones.id = customers.zone_id
        where customers.operator_id = public.current_operator_id()
      ), '[]'::jsonb)
  );
$$;

create or replace function public.onboard_staff_member(
  input_full_name text,
  input_phone text,
  input_role public.app_role,
  input_monthly_salary_kobo integer default 0
)
returns uuid
language plpgsql
security definer
as $$
declare
  tenant_id uuid := public.assert_admin_master_data_allowed();
  new_id uuid;
begin
  if exists (
    select 1 from public.staff_members
    where operator_id = tenant_id
      and phone = input_phone
  ) then
    raise exception 'A staff member with this phone already exists';
  end if;

  insert into public.staff_members (
    operator_id,
    full_name,
    phone,
    role,
    monthly_salary_kobo,
    active
  )
  values (
    tenant_id,
    trim(input_full_name),
    trim(input_phone),
    input_role,
    greatest(input_monthly_salary_kobo, 0),
    true
  )
  returning id into new_id;

  return new_id;
end;
$$;

create or replace function public.set_staff_active(input_staff_id uuid, next_active boolean)
returns void
language plpgsql
security definer
as $$
declare
  tenant_id uuid := public.assert_admin_master_data_allowed();
begin
  update public.staff_members
  set active = next_active
  where id = input_staff_id
    and operator_id = tenant_id;

  if not found then
    raise exception 'Staff member not found';
  end if;
end;
$$;

create or replace function public.onboard_truck(
  input_zone_id uuid,
  input_registration_number text,
  input_make text default null,
  input_model text default null,
  input_year integer default null,
  input_status public.truck_status default 'operational'
)
returns uuid
language plpgsql
security definer
as $$
declare
  tenant_id uuid := public.assert_admin_master_data_allowed();
  new_id uuid;
begin
  if not exists (select 1 from public.zones where id = input_zone_id and operator_id = tenant_id) then
    raise exception 'Zone not found';
  end if;

  if exists (
    select 1 from public.trucks
    where operator_id = tenant_id
      and upper(registration_number) = upper(trim(input_registration_number))
  ) then
    raise exception 'A truck with this registration already exists';
  end if;

  insert into public.trucks (
    operator_id,
    zone_id,
    registration_number,
    make,
    model,
    year,
    status,
    active
  )
  values (
    tenant_id,
    input_zone_id,
    upper(trim(input_registration_number)),
    nullif(trim(coalesce(input_make, '')), ''),
    nullif(trim(coalesce(input_model, '')), ''),
    input_year,
    input_status,
    true
  )
  returning id into new_id;

  return new_id;
end;
$$;

create or replace function public.set_truck_active(input_truck_id uuid, next_active boolean)
returns void
language plpgsql
security definer
as $$
declare
  tenant_id uuid := public.assert_admin_master_data_allowed();
begin
  update public.trucks
  set active = next_active
  where id = input_truck_id
    and operator_id = tenant_id;

  if not found then
    raise exception 'Truck not found';
  end if;
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
    case when input_service_status = 'active' then date_trunc('month', current_date)::date else null end
  )
  returning id into new_id;

  return new_id;
end;
$$;

create or replace function public.set_customer_service_status(
  input_customer_id uuid,
  next_status public.service_status
)
returns void
language plpgsql
security definer
as $$
declare
  tenant_id uuid := public.assert_admin_master_data_allowed();
begin
  update public.customers
  set
    service_status = next_status,
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
