-- Narrow operator banner customization: mission, vision, and licence number only.
-- Pillars stay hardcoded in the app; roll back the 0076 pillar/tagline schema.

create or replace function public.default_operator_banner_config()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'mission', '',
    'vision', '',
    'licenseNumber', ''
  );
$$;

create or replace function public.normalize_operator_banner_config(input_config jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  mission text;
  vision text;
  license_number text;
begin
  if input_config is null or jsonb_typeof(input_config) is distinct from 'object' then
    return public.default_operator_banner_config();
  end if;

  mission := coalesce(trim(coalesce(input_config->>'mission', '')), '');
  vision := coalesce(trim(coalesce(input_config->>'vision', '')), '');
  license_number := coalesce(
    trim(coalesce(
      input_config->>'licenseNumber',
      input_config->>'license_number',
      ''
    )),
    ''
  );

  if char_length(mission) > 280 then
    raise exception 'Mission must be 280 characters or fewer';
  end if;
  if char_length(vision) > 280 then
    raise exception 'Vision must be 280 characters or fewer';
  end if;
  if char_length(license_number) > 80 then
    raise exception 'Operator licence number must be 80 characters or fewer';
  end if;

  return jsonb_build_object(
    'mission', mission,
    'vision', vision,
    'licenseNumber', license_number
  );
end;
$$;

update public.operators
set banner_config = public.normalize_operator_banner_config(
  case
    when banner_config ? 'mission'
      or banner_config ? 'vision'
      or banner_config ? 'licenseNumber'
      or banner_config ? 'license_number'
    then banner_config
    else public.default_operator_banner_config()
  end
);

drop function if exists public.update_operator_banner_config(text, jsonb);

create or replace function public.update_operator_banner_config(
  input_banner_config jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_id uuid := public.current_operator_id();
  app_role text := public.current_app_role();
  operator_row public.operators%rowtype;
  next_banner jsonb;
begin
  if tenant_id is null then
    raise exception 'Operator profile not found';
  end if;

  if app_role not in ('operator_owner', 'operations_supervisor', 'platform_admin') then
    raise exception 'Not allowed to update banner branding';
  end if;

  perform public.assert_operator_tenant_active(tenant_id);

  select * into operator_row
  from public.operators
  where id = tenant_id
  for update;

  if not found then
    raise exception 'Operator not found';
  end if;

  next_banner := public.normalize_operator_banner_config(
    coalesce(input_banner_config, operator_row.banner_config)
  );

  update public.operators
  set banner_config = next_banner
  where id = tenant_id
  returning * into operator_row;

  return jsonb_build_object(
    'id', operator_row.id,
    'bannerConfig', operator_row.banner_config
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
      'bannerConfig', null,
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
    'bannerConfig', coalesce(
      public.normalize_operator_banner_config(operator_row.banner_config),
      public.default_operator_banner_config()
    ),
    'fullName', profile_row.full_name,
    'phone', profile_row.phone,
    'role', profile_row.role
  );
end;
$$;

revoke all on function public.update_operator_banner_config(jsonb) from public;
revoke all on function public.update_operator_banner_config(jsonb) from anon;
grant execute on function public.update_operator_banner_config(jsonb) to authenticated;
grant execute on function public.default_operator_banner_config() to authenticated;
grant execute on function public.normalize_operator_banner_config(jsonb) to authenticated;

comment on column public.operators.banner_config is
  'Dashboard banner extras: mission, vision, and operator licence number. Value pillars stay hardcoded in the app.';
comment on function public.update_operator_banner_config is
  'Operator owner/supervisor: update mission, vision, and operator licence number on the dashboard banner.';
comment on function public.default_operator_banner_config is
  'Empty mission/vision/licence defaults for the dashboard banner slot.';
comment on function public.normalize_operator_banner_config is
  'Normalize banner_config to { mission, vision, licenseNumber }.';
