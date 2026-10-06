-- Per-operator dashboard banner (identity tagline + customizable pillars).

create or replace function public.default_operator_banner_config()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'tagline', 'Licensed PSP operator',
    'pillars', jsonb_build_array(
      jsonb_build_object(
        'icon', 'chart',
        'title', 'Data-driven ops',
        'description', 'Decide from live day progress.'
      ),
      jsonb_build_object(
        'icon', 'route',
        'title', 'Improve efficiency',
        'description', 'Keep routes and crews moving.'
      ),
      jsonb_build_object(
        'icon', 'wallet',
        'title', 'Increase revenue',
        'description', 'Drive collections and compliance.'
      ),
      jsonb_build_object(
        'icon', 'leaf',
        'title', 'Cleaner communities',
        'description', 'Deliver a cleaner local ward.'
      )
    )
  );
$$;

alter table public.operators
  add column if not exists banner_config jsonb not null
    default public.default_operator_banner_config();

update public.operators
set banner_config = public.default_operator_banner_config()
where banner_config is null
   or banner_config = '{}'::jsonb
   or not (banner_config ? 'pillars');

create or replace function public.normalize_operator_banner_config(input_config jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  defaults jsonb := public.default_operator_banner_config();
  tagline text;
  pillars jsonb := '[]'::jsonb;
  pillar jsonb;
  icon_key text;
  title text;
  description text;
  allowed_icons text[] := array['chart', 'route', 'wallet', 'leaf', 'building', 'truck'];
  pillar_count integer := 0;
begin
  if input_config is null or jsonb_typeof(input_config) is distinct from 'object' then
    return defaults;
  end if;

  tagline := nullif(trim(coalesce(input_config->>'tagline', '')), '');
  if tagline is null then
    tagline := defaults->>'tagline';
  end if;
  if char_length(tagline) > 120 then
    raise exception 'Banner tagline must be 120 characters or fewer';
  end if;

  if jsonb_typeof(input_config->'pillars') = 'array' then
    for pillar in
      select value
      from jsonb_array_elements(input_config->'pillars')
    loop
      icon_key := lower(trim(coalesce(pillar->>'icon', '')));
      title := nullif(trim(coalesce(pillar->>'title', '')), '');
      description := nullif(trim(coalesce(pillar->>'description', '')), '');

      if title is null or description is null then
        raise exception 'Each banner pillar needs a title and description';
      end if;
      if char_length(title) > 60 then
        raise exception 'Banner pillar title must be 60 characters or fewer';
      end if;
      if char_length(description) > 120 then
        raise exception 'Banner pillar description must be 120 characters or fewer';
      end if;
      if icon_key is null or not (icon_key = any (allowed_icons)) then
        raise exception 'Banner pillar icon must be one of: chart, route, wallet, leaf, building, truck';
      end if;

      pillars := pillars || jsonb_build_array(
        jsonb_build_object(
          'icon', icon_key,
          'title', title,
          'description', description
        )
      );
      pillar_count := pillar_count + 1;
    end loop;
  end if;

  if pillar_count < 3 or pillar_count > 4 then
    raise exception 'Banner must include 3 or 4 pillars';
  end if;

  return jsonb_build_object(
    'tagline', tagline,
    'pillars', pillars
  );
end;
$$;

create or replace function public.update_operator_banner_config(
  input_brand_name text default null,
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
  next_brand text;
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

  next_brand := coalesce(nullif(trim(coalesce(input_brand_name, '')), ''), operator_row.brand_name);
  if next_brand is null or char_length(next_brand) < 2 then
    raise exception 'Brand name is required';
  end if;
  if char_length(next_brand) > 80 then
    raise exception 'Brand name must be 80 characters or fewer';
  end if;

  next_banner := public.normalize_operator_banner_config(
    coalesce(input_banner_config, operator_row.banner_config)
  );

  update public.operators
  set
    brand_name = next_brand,
    banner_config = next_banner
  where id = tenant_id
  returning * into operator_row;

  return jsonb_build_object(
    'id', operator_row.id,
    'brandName', operator_row.brand_name,
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
    'bannerConfig', coalesce(operator_row.banner_config, public.default_operator_banner_config()),
    'fullName', profile_row.full_name,
    'phone', profile_row.phone,
    'role', profile_row.role
  );
end;
$$;

revoke all on function public.update_operator_banner_config(text, jsonb) from public;
revoke all on function public.update_operator_banner_config(text, jsonb) from anon;
grant execute on function public.update_operator_banner_config(text, jsonb) to authenticated;
grant execute on function public.default_operator_banner_config() to authenticated;
grant execute on function public.normalize_operator_banner_config(jsonb) to authenticated;

comment on column public.operators.banner_config is
  'Dashboard brand footer: tagline + 3–4 pillars (icon key, title, description).';
comment on function public.update_operator_banner_config is
  'Operator owner/supervisor: update brand display name and dashboard banner pillars.';
comment on function public.default_operator_banner_config is
  'Default banner copy matching the original hardcoded dashboard footer.';
