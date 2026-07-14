-- Multi-tenant SaaS foundation: operator plan/status, platform admin RPCs.

create type public.operator_status as enum ('trial', 'active', 'suspended');
create type public.operator_plan_code as enum ('basic', 'growth', 'pro');

alter table public.operators
  add column if not exists slug text,
  add column if not exists status public.operator_status not null default 'active',
  add column if not exists plan_code public.operator_plan_code not null default 'basic',
  add column if not exists brand_name text,
  add column if not exists onboarded_at timestamptz;

update public.operators
set
  slug = coalesce(slug, lower(regexp_replace(trim(name), '[^a-zA-Z0-9]+', '-', 'g'))),
  brand_name = coalesce(brand_name, name),
  onboarded_at = coalesce(onboarded_at, created_at)
where true;

alter table public.operators
  alter column slug set not null,
  alter column brand_name set not null;

create unique index if not exists operators_slug_unique_idx
  on public.operators (slug);

create or replace function public.assert_platform_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if public.current_app_role() is distinct from 'platform_admin' then
    raise exception 'Only platform admins can manage tenants';
  end if;
end;
$$;

create or replace function public.assert_operator_tenant_active(p_operator_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tenant_status public.operator_status;
begin
  if p_operator_id is null then
    return;
  end if;

  select status
  into tenant_status
  from public.operators
  where id = p_operator_id;

  if not found then
    raise exception 'Operator profile not found';
  end if;

  if tenant_status = 'suspended' then
    raise exception 'This operator account is suspended. Contact CleanOps support.';
  end if;
end;
$$;

create or replace function public.create_operator_tenant(
  input_name text,
  input_slug text,
  input_owner_full_name text,
  input_owner_email text,
  input_owner_phone text,
  input_plan_code public.operator_plan_code default 'basic',
  input_brand_name text default null,
  input_lawma_reference text default null,
  input_status public.operator_status default 'trial'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  normalized_slug text;
  normalized_email text := lower(trim(input_owner_email));
  resolved_brand text := nullif(trim(coalesce(input_brand_name, input_name)), '');
  new_operator_id uuid := gen_random_uuid();
  owner_profile_id uuid;
  temporary_password text := public.generate_staff_temporary_password();
begin
  perform public.assert_platform_admin();

  if nullif(trim(input_name), '') is null then
    raise exception 'Operator name is required';
  end if;

  normalized_slug := lower(trim(both '-' from regexp_replace(trim(input_slug), '[^a-zA-Z0-9]+', '-', 'g')));

  if normalized_slug is null or normalized_slug = '' then
    raise exception 'Operator slug is required';
  end if;

  if exists (select 1 from public.operators where slug = normalized_slug) then
    raise exception 'An operator with this slug already exists';
  end if;

  if nullif(trim(input_owner_full_name), '') is null then
    raise exception 'Owner full name is required';
  end if;

  if normalized_email is null or normalized_email = '' then
    raise exception 'Owner login email is required';
  end if;

  if nullif(trim(input_owner_phone), '') is null then
    raise exception 'Owner phone is required';
  end if;

  insert into public.operators (
    id,
    name,
    slug,
    status,
    plan_code,
    brand_name,
    lawma_reference,
    primary_contact_phone,
    onboarded_at
  )
  values (
    new_operator_id,
    trim(input_name),
    normalized_slug,
    input_status,
    input_plan_code,
    resolved_brand,
    nullif(trim(input_lawma_reference), ''),
    trim(input_owner_phone),
    now()
  );

  owner_profile_id := public.create_staff_auth_profile(
    new_operator_id,
    trim(input_owner_full_name),
    trim(input_owner_phone),
    'operator_owner',
    normalized_email,
    temporary_password
  );

  return jsonb_build_object(
    'operatorId', new_operator_id,
    'name', trim(input_name),
    'slug', normalized_slug,
    'brandName', resolved_brand,
    'status', input_status,
    'planCode', input_plan_code,
    'ownerProfileId', owner_profile_id,
    'ownerEmail', normalized_email,
    'temporaryPassword', temporary_password
  );
end;
$$;

create or replace function public.list_operators()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.assert_platform_admin();

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'name', o.name,
          'slug', o.slug,
          'brandName', o.brand_name,
          'status', o.status,
          'planCode', o.plan_code,
          'lawmaReference', o.lawma_reference,
          'primaryContactPhone', o.primary_contact_phone,
          'onboardedAt', o.onboarded_at,
          'createdAt', o.created_at,
          'ownerEmail', owner.email,
          'ownerFullName', owner.full_name
        )
        order by o.created_at asc
      )
      from public.operators o
      left join lateral (
        select p.full_name, u.email
        from public.profiles p
        join auth.users u on u.id = p.id
        where p.operator_id = o.id
          and p.role = 'operator_owner'
        order by p.created_at asc
        limit 1
      ) owner on true
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.set_operator_status(
  input_operator_id uuid,
  input_status public.operator_status
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  operator_row public.operators%rowtype;
begin
  perform public.assert_platform_admin();

  update public.operators
  set status = input_status
  where id = input_operator_id
  returning * into operator_row;

  if not found then
    raise exception 'Operator not found';
  end if;

  return jsonb_build_object(
    'id', operator_row.id,
    'name', operator_row.name,
    'slug', operator_row.slug,
    'brandName', operator_row.brand_name,
    'status', operator_row.status,
    'planCode', operator_row.plan_code
  );
end;
$$;

create or replace function public.update_operator_branding(
  input_name text,
  input_brand_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_id uuid := public.current_operator_id();
  operator_row public.operators%rowtype;
begin
  if tenant_id is null then
    raise exception 'Operator profile not found';
  end if;

  if public.current_app_role() is distinct from 'operator_owner' then
    raise exception 'Only operator owners can update branding';
  end if;

  perform public.assert_operator_tenant_active(tenant_id);

  if nullif(trim(input_name), '') is null then
    raise exception 'Operator name is required';
  end if;

  if nullif(trim(input_brand_name), '') is null then
    raise exception 'Brand name is required';
  end if;

  update public.operators
  set
    name = trim(input_name),
    brand_name = trim(input_brand_name)
  where id = tenant_id
  returning * into operator_row;

  return jsonb_build_object(
    'id', operator_row.id,
    'name', operator_row.name,
    'brandName', operator_row.brand_name,
    'slug', operator_row.slug,
    'status', operator_row.status,
    'planCode', operator_row.plan_code
  );
end;
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

  return jsonb_build_object(
    'id', profile_row.id,
    'operatorId', profile_row.operator_id,
    'operatorName', operator_row.name,
    'brandName', operator_row.brand_name,
    'operatorStatus', operator_row.status,
    'planCode', operator_row.plan_code,
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

  return jsonb_build_object(
    'profileId', profile_row.id,
    'operatorId', profile_row.operator_id,
    'operatorName', operator_row.name,
    'brandName', operator_row.brand_name,
    'fullName', profile_row.full_name,
    'phone', profile_row.phone,
    'role', profile_row.role,
    'staffId', staff_row.id,
    'licenceExpiresOn', staff_row.licence_expires_on,
    'licenceImageUrl', staff_row.licence_image_url
  );
end;
$$;

revoke all on function public.create_staff_auth_profile(uuid, text, text, public.app_role, text, text) from public;
revoke all on function public.create_staff_auth_profile(uuid, text, text, public.app_role, text, text) from anon;
revoke all on function public.create_staff_auth_profile(uuid, text, text, public.app_role, text, text) from authenticated;

grant execute on function public.assert_platform_admin() to authenticated;
grant execute on function public.create_operator_tenant(text, text, text, text, text, public.operator_plan_code, text, text, public.operator_status) to authenticated;
grant execute on function public.list_operators() to authenticated;
grant execute on function public.set_operator_status(uuid, public.operator_status) to authenticated;
grant execute on function public.update_operator_branding(text, text) to authenticated;
grant execute on function public.get_session_operator_context() to authenticated;

comment on function public.create_operator_tenant is
  'Platform admin: create an independent operator tenant and owner login.';
comment on function public.list_operators is
  'Platform admin: list all operator tenants.';
comment on function public.set_operator_status is
  'Platform admin: set trial/active/suspended on a tenant.';
