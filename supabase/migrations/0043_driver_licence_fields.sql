-- Driver licence expiry + mock image URL for fleet compliance tracking.

alter table public.staff_members
  add column if not exists licence_expires_on date,
  add column if not exists licence_image_url text;

comment on column public.staff_members.licence_expires_on is
  'Driver licence expiry date. Meaningful for role=driver; null for other staff.';

comment on column public.staff_members.licence_image_url is
  'Public URL/path to a licence card image (pilot mockups under /driver-licences/).';

drop function if exists public.onboard_staff_member(text, text, public.app_role, integer, text, boolean);
drop function if exists public.update_staff_member(uuid, text, text, public.app_role, integer);

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
  input_monthly_salary_kobo integer default 0,
  input_login_email text default null,
  input_provision_login boolean default true,
  input_licence_expires_on date default null,
  input_licence_image_url text default null
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
  licence_url text := nullif(trim(coalesce(input_licence_image_url, '')), '');
begin
  if input_role not in (
    'driver',
    'loader',
    'collection_agent',
    'operations_supervisor'
  ) then
    raise exception 'Staff role must be driver, loader, collection agent, or operations supervisor';
  end if;

  if input_role = 'driver' and input_licence_expires_on is null then
    raise exception 'Driver licence expiry date is required';
  end if;

  if input_role <> 'driver' and (
    input_licence_expires_on is not null or licence_url is not null
  ) then
    raise exception 'Licence fields are only allowed for drivers';
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

  if input_role = 'driver' and licence_url is null then
    licence_url := '/driver-licences/placeholder.svg';
  end if;

  insert into public.staff_members (
    operator_id,
    full_name,
    phone,
    role,
    monthly_salary_kobo,
    active,
    login_email,
    licence_expires_on,
    licence_image_url
  )
  values (
    tenant_id,
    trim(input_full_name),
    trim(input_phone),
    input_role,
    greatest(input_monthly_salary_kobo, 0),
    true,
    case when should_provision then normalized_email else null end,
    case when input_role = 'driver' then input_licence_expires_on else null end,
    case when input_role = 'driver' then licence_url else null end
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

create or replace function public.update_staff_member(
  input_staff_id uuid,
  input_full_name text,
  input_phone text,
  input_role public.app_role,
  input_monthly_salary_kobo integer default 0,
  input_licence_expires_on date default null,
  input_licence_image_url text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_id uuid := public.assert_admin_master_data_allowed();
  staff_record public.staff_members%rowtype;
  licence_url text := nullif(trim(coalesce(input_licence_image_url, '')), '');
begin
  if input_role not in (
    'driver',
    'loader',
    'collection_agent',
    'operations_supervisor'
  ) then
    raise exception 'Staff role must be driver, loader, collection agent, or operations supervisor';
  end if;

  if input_role = 'driver' and input_licence_expires_on is null then
    raise exception 'Driver licence expiry date is required';
  end if;

  if input_role <> 'driver' and (
    input_licence_expires_on is not null or licence_url is not null
  ) then
    raise exception 'Licence fields are only allowed for drivers';
  end if;

  select *
  into staff_record
  from public.staff_members
  where id = input_staff_id
    and operator_id = tenant_id;

  if not found then
    raise exception 'Staff member not found';
  end if;

  if exists (
    select 1
    from public.staff_members
    where operator_id = tenant_id
      and phone = trim(input_phone)
      and id <> input_staff_id
  ) then
    raise exception 'A staff member with this phone already exists';
  end if;

  if input_role = 'driver' and licence_url is null then
    licence_url := coalesce(staff_record.licence_image_url, '/driver-licences/placeholder.svg');
  end if;

  update public.staff_members
  set
    full_name = trim(input_full_name),
    phone = trim(input_phone),
    role = input_role,
    monthly_salary_kobo = greatest(input_monthly_salary_kobo, 0),
    licence_expires_on = case when input_role = 'driver' then input_licence_expires_on else null end,
    licence_image_url = case when input_role = 'driver' then licence_url else null end
  where id = input_staff_id;

  if staff_record.profile_id is not null then
    update public.profiles
    set
      full_name = trim(input_full_name),
      phone = trim(input_phone),
      role = input_role
    where id = staff_record.profile_id
      and operator_id = tenant_id;
  end if;
end;
$$;

-- Pilot mock licence cards for seeded drivers.
update public.staff_members
set
  licence_expires_on = '2027-03-15'::date,
  licence_image_url = '/driver-licences/adewale-johnson.svg'
where id = '00000000-0000-4000-8000-000000000201'
  and role = 'driver';

update public.staff_members
set
  licence_expires_on = '2026-11-30'::date,
  licence_image_url = '/driver-licences/chinedu-okafor.svg'
where id = '00000000-0000-4000-8000-000000000202'
  and role = 'driver';

update public.staff_members
set
  licence_expires_on = '2028-01-20'::date,
  licence_image_url = '/driver-licences/musa-balogun.svg'
where id = '00000000-0000-4000-8000-000000000203'
  and role = 'driver';

update public.staff_members
set
  licence_expires_on = '2027-08-12'::date,
  licence_image_url = '/driver-licences/samuel-ibitoye.svg'
where id = '00000000-0000-4000-8000-000000000207'
  and role = 'driver';

-- Any other drivers in the tenant get a placeholder + 1-year default expiry.
update public.staff_members
set
  licence_expires_on = coalesce(licence_expires_on, (current_date + interval '1 year')::date),
  licence_image_url = coalesce(licence_image_url, '/driver-licences/placeholder.svg')
where role = 'driver'
  and (licence_expires_on is null or licence_image_url is null);
