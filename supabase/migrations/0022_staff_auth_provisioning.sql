-- Sprint 2: provision Supabase Auth users when onboarding staff.

alter table public.staff_members
  add column if not exists login_email text;

create unique index if not exists staff_members_operator_login_email_idx
  on public.staff_members (operator_id, lower(login_email))
  where login_email is not null;

create or replace function public.generate_staff_temporary_password()
returns text
language sql
volatile
as $$
  select 'CleanOps-' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 8));
$$;

create or replace function public.create_staff_auth_profile(
  p_operator_id uuid,
  p_full_name text,
  p_phone text,
  p_role public.app_role,
  p_login_email text,
  p_temporary_password text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  new_user_id uuid := gen_random_uuid();
  new_identity_id uuid := gen_random_uuid();
  normalized_email text := lower(trim(p_login_email));
begin
  if normalized_email is null or normalized_email = '' then
    raise exception 'Login email is required';
  end if;

  if exists (select 1 from auth.users where lower(email) = normalized_email) then
    raise exception 'An auth account with this email already exists';
  end if;

  insert into auth.users (
    id,
    instance_id,
    aud,
    role,
    email,
    phone,
    encrypted_password,
    email_confirmed_at,
    phone_confirmed_at,
    created_at,
    updated_at,
    raw_app_meta_data,
    raw_user_meta_data,
    is_super_admin,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change,
    phone_change_token,
    phone_change,
    email_change_token_current,
    reauthentication_token
  )
  values (
    new_user_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    normalized_email,
    trim(p_phone),
    crypt(p_temporary_password, gen_salt('bf')),
    now(),
    now(),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', trim(p_full_name)),
    false,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    ''
  );

  insert into auth.identities (
    id,
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  )
  values (
    new_identity_id,
    new_user_id::text,
    new_user_id,
    jsonb_build_object(
      'sub', new_user_id::text,
      'email', normalized_email,
      'email_verified', true,
      'phone_verified', true
    ),
    'email',
    now(),
    now(),
    now()
  );

  insert into public.profiles (id, operator_id, role, full_name, phone)
  values (new_user_id, p_operator_id, p_role, trim(p_full_name), trim(p_phone));

  return new_user_id;
end;
$$;

create or replace function public.provision_staff_member_login(
  input_staff_id uuid,
  input_login_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  tenant_id uuid := public.assert_admin_master_data_allowed();
  staff_row public.staff_members%rowtype;
  normalized_email text := lower(trim(input_login_email));
  new_profile_id uuid;
  temporary_password text := public.generate_staff_temporary_password();
begin
  select *
  into staff_row
  from public.staff_members
  where id = input_staff_id
    and operator_id = tenant_id;

  if not found then
    raise exception 'Staff member not found';
  end if;

  if staff_row.profile_id is not null then
    raise exception 'Staff member already has a linked login profile';
  end if;

  if normalized_email is null or normalized_email = '' then
    raise exception 'Login email is required';
  end if;

  new_profile_id := public.create_staff_auth_profile(
    tenant_id,
    staff_row.full_name,
    staff_row.phone,
    staff_row.role,
    normalized_email,
    temporary_password
  );

  update public.staff_members
  set profile_id = new_profile_id,
      login_email = normalized_email
  where id = staff_row.id;

  return jsonb_build_object(
    'staffId', staff_row.id,
    'profileId', new_profile_id,
    'loginEmail', normalized_email,
    'temporaryPassword', temporary_password,
    'loginProvisioned', true
  );
end;
$$;

drop function if exists public.onboard_staff_member(text, text, public.app_role, integer);

create or replace function public.onboard_staff_member(
  input_full_name text,
  input_phone text,
  input_role public.app_role,
  input_monthly_salary_kobo integer default 0,
  input_login_email text default null,
  input_provision_login boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  tenant_id uuid := public.assert_admin_master_data_allowed();
  new_id uuid;
  normalized_email text := lower(trim(coalesce(input_login_email, '')));
  should_provision boolean := coalesce(input_provision_login, true)
    and input_role in ('driver', 'collection_agent', 'operations_supervisor');
  new_profile_id uuid;
  temporary_password text;
begin
  if exists (
    select 1 from public.staff_members
    where operator_id = tenant_id
      and phone = trim(input_phone)
  ) then
    raise exception 'A staff member with this phone already exists';
  end if;

  if should_provision and normalized_email = '' then
    raise exception 'Login email is required when provisioning staff login access';
  end if;

  insert into public.staff_members (
    operator_id,
    full_name,
    phone,
    role,
    monthly_salary_kobo,
    active,
    login_email
  )
  values (
    tenant_id,
    trim(input_full_name),
    trim(input_phone),
    input_role,
    greatest(input_monthly_salary_kobo, 0),
    true,
    case when should_provision then normalized_email else null end
  )
  returning id into new_id;

  if should_provision then
    temporary_password := public.generate_staff_temporary_password();
    new_profile_id := public.create_staff_auth_profile(
      tenant_id,
      trim(input_full_name),
      trim(input_phone),
      input_role,
      normalized_email,
      temporary_password
    );

    update public.staff_members
    set profile_id = new_profile_id
    where id = new_id;

    return jsonb_build_object(
      'staffId', new_id,
      'profileId', new_profile_id,
      'loginEmail', normalized_email,
      'temporaryPassword', temporary_password,
      'loginProvisioned', true
    );
  end if;

  return jsonb_build_object(
    'staffId', new_id,
    'profileId', null,
    'loginEmail', null,
    'temporaryPassword', null,
    'loginProvisioned', false
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
            'loginEmail', staff_members.login_email
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
