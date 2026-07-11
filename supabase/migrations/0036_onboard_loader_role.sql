-- Allow onboarding loaders; do not auto-provision app login for loaders (no loader mobile app yet).

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
  if input_role not in (
    'driver',
    'loader',
    'collection_agent',
    'operations_supervisor'
  ) then
    raise exception 'Staff role must be driver, loader, collection agent, or operations supervisor';
  end if;

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
