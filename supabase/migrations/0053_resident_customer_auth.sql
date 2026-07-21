-- Resident customer Auth profiles (Phase 2 prerequisite).
-- Email-only login; phone-as-username out of scope for v1.

alter table public.customers
  add column if not exists profile_id uuid references public.profiles(id) on delete set null;

create unique index if not exists customers_profile_id_uidx
  on public.customers (profile_id)
  where profile_id is not null;

create unique index if not exists customers_operator_email_uidx
  on public.customers (operator_id, lower(email))
  where email is not null and trim(email) <> '';

create or replace function public.current_customer_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.customers
  where profile_id = auth.uid()
  limit 1;
$$;

create or replace function public.provision_customer_login(
  input_customer_id uuid,
  input_login_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  tenant_id uuid := public.assert_admin_master_data_allowed();
  customer_row public.customers%rowtype;
  normalized_email text := lower(trim(input_login_email));
  new_profile_id uuid;
  temporary_password text := public.generate_staff_temporary_password();
  phone_value text;
begin
  select *
  into customer_row
  from public.customers
  where id = input_customer_id
    and operator_id = tenant_id;

  if not found then
    raise exception 'Customer not found';
  end if;

  if customer_row.profile_id is not null then
    raise exception 'Customer already has a linked login profile';
  end if;

  if normalized_email is null or normalized_email = '' then
    raise exception 'Login email is required';
  end if;

  if exists (
    select 1
    from public.customers
    where operator_id = tenant_id
      and id <> customer_row.id
      and email is not null
      and lower(email) = normalized_email
  ) then
    raise exception 'Another customer already uses this email';
  end if;

  phone_value := coalesce(nullif(trim(customer_row.phone), ''), '+2340000000000');

  new_profile_id := public.create_staff_auth_profile(
    tenant_id,
    customer_row.display_name,
    phone_value,
    'resident',
    normalized_email,
    temporary_password
  );

  update public.customers
  set
    profile_id = new_profile_id,
    email = normalized_email
  where id = customer_row.id;

  return jsonb_build_object(
    'customerId', customer_row.id,
    'profileId', new_profile_id,
    'loginEmail', normalized_email,
    'temporaryPassword', temporary_password,
    'loginProvisioned', true
  );
end;
$$;

create or replace function public.get_customer_password_reset_target(input_customer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tenant_id uuid := public.assert_admin_master_data_allowed();
  customer_row public.customers%rowtype;
begin
  select *
  into customer_row
  from public.customers
  where id = input_customer_id
    and operator_id = tenant_id;

  if not found then
    raise exception 'Customer not found';
  end if;

  if customer_row.profile_id is null or customer_row.email is null then
    raise exception 'Customer does not have a login profile';
  end if;

  return jsonb_build_object(
    'loginEmail', lower(customer_row.email),
    'customerName', customer_row.display_name
  );
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
            'hasLoginProfile', staff_members.profile_id is not null,
            'loginEmail', staff_members.login_email,
            'licenceExpiresOn', staff_members.licence_expires_on,
            'licenceImageUrl', staff_members.licence_image_url
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
            'email', customers.email,
            'address', customers.address,
            'customerType', customers.customer_type,
            'monthlyRateKobo', customers.monthly_rate_kobo,
            'serviceStatus', customers.service_status,
            'collectionsPerWeek', customers.collections_per_week,
            'preferredWeekdays', to_jsonb(customers.preferred_weekdays),
            'frequencyNotes', customers.frequency_notes,
            'hasLoginProfile', customers.profile_id is not null,
            'loginEmail', customers.email
          )
          order by zones.name, customers.display_name
        )
        from public.customers
        join public.zones on zones.id = customers.zone_id
        where customers.operator_id = public.current_operator_id()
      ), '[]'::jsonb)
  );
$$;

create or replace function public.get_session_operator_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  profile_row public.profiles%rowtype;
  operator_row public.operators%rowtype;
  customer_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into profile_row
  from public.profiles
  where id = auth.uid();

  if not found then
    raise exception 'Profile not found';
  end if;

  if profile_row.role = 'platform_admin' then
    return jsonb_build_object(
      'id', profile_row.id,
      'operatorId', null,
      'operatorName', null,
      'brandName', null,
      'operatorStatus', null,
      'planCode', null,
      'timezone', null,
      'customerId', null,
      'fullName', profile_row.full_name,
      'phone', profile_row.phone,
      'role', profile_row.role
    );
  end if;

  if profile_row.operator_id is null then
    raise exception 'Operator profile not found';
  end if;

  select *
  into operator_row
  from public.operators
  where id = profile_row.operator_id;

  if not found then
    raise exception 'Operator profile not found';
  end if;

  if operator_row.status = 'suspended' then
    raise exception 'This operator account is suspended. Contact CleanOps support.';
  end if;

  if profile_row.role = 'resident' then
    select id
    into customer_id
    from public.customers
    where profile_id = profile_row.id
      and operator_id = profile_row.operator_id
    limit 1;

    if customer_id is null then
      raise exception 'Resident account is not linked to a customer';
    end if;
  end if;

  return jsonb_build_object(
    'id', profile_row.id,
    'operatorId', profile_row.operator_id,
    'operatorName', operator_row.name,
    'brandName', operator_row.brand_name,
    'operatorStatus', operator_row.status,
    'planCode', operator_row.plan_code,
    'timezone', operator_row.timezone,
    'customerId', customer_id,
    'fullName', profile_row.full_name,
    'phone', profile_row.phone,
    'role', profile_row.role
  );
end;
$$;

create or replace function public.get_own_account_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  profile_row public.profiles%rowtype;
  staff_row public.staff_members%rowtype;
  operator_row public.operators%rowtype;
  customer_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into profile_row
  from public.profiles
  where id = auth.uid();

  if not found then
    raise exception 'Profile not found';
  end if;

  if profile_row.operator_id is not null then
    select *
    into operator_row
    from public.operators
    where id = profile_row.operator_id;

    if found and operator_row.status = 'suspended' and profile_row.role is distinct from 'platform_admin' then
      raise exception 'This operator account is suspended. Contact CleanOps support.';
    end if;
  end if;

  select *
  into staff_row
  from public.staff_members
  where profile_id = auth.uid()
  limit 1;

  if profile_row.role = 'resident' then
    select id
    into customer_id
    from public.customers
    where profile_id = auth.uid()
    limit 1;
  end if;

  return jsonb_build_object(
    'profileId', profile_row.id,
    'operatorId', profile_row.operator_id,
    'operatorName', operator_row.name,
    'brandName', operator_row.brand_name,
    'timezone', operator_row.timezone,
    'customerId', customer_id,
    'fullName', profile_row.full_name,
    'phone', profile_row.phone,
    'role', profile_row.role,
    'staffId', staff_row.id,
    'licenceExpiresOn', staff_row.licence_expires_on,
    'licenceImageUrl', staff_row.licence_image_url
  );
end;
$$;

grant execute on function public.current_customer_id() to authenticated;
grant execute on function public.provision_customer_login(uuid, text) to authenticated;
grant execute on function public.get_customer_password_reset_target(uuid) to authenticated;
