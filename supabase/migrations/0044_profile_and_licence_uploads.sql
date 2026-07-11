-- Self-service profile updates + driver licence document storage.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'driver-licences',
  'driver-licences',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'application/pdf']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Authenticated users can read driver licence objects" on storage.objects;
drop policy if exists "Authenticated users can upload driver licence objects" on storage.objects;
drop policy if exists "Authenticated users can update driver licence objects" on storage.objects;
drop policy if exists "Authenticated users can delete driver licence objects" on storage.objects;

create policy "Authenticated users can read driver licence objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'driver-licences'
  and (storage.foldername(name))[1] = public.current_operator_id()::text
);

create policy "Authenticated users can upload driver licence objects"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'driver-licences'
  and (storage.foldername(name))[1] = public.current_operator_id()::text
);

create policy "Authenticated users can update driver licence objects"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'driver-licences'
  and (storage.foldername(name))[1] = public.current_operator_id()::text
)
with check (
  bucket_id = 'driver-licences'
  and (storage.foldername(name))[1] = public.current_operator_id()::text
);

create policy "Authenticated users can delete driver licence objects"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'driver-licences'
  and (storage.foldername(name))[1] = public.current_operator_id()::text
);

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

  select *
  into staff_row
  from public.staff_members
  where profile_id = auth.uid()
  limit 1;

  return jsonb_build_object(
    'profileId', profile_row.id,
    'operatorId', profile_row.operator_id,
    'fullName', profile_row.full_name,
    'phone', profile_row.phone,
    'role', profile_row.role,
    'staffId', staff_row.id,
    'licenceExpiresOn', staff_row.licence_expires_on,
    'licenceImageUrl', staff_row.licence_image_url
  );
end;
$$;

create or replace function public.update_own_profile(
  input_full_name text,
  input_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_row public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if length(trim(input_full_name)) < 2 then
    raise exception 'Full name is required';
  end if;

  if length(trim(input_phone)) < 7 then
    raise exception 'Phone number is required';
  end if;

  update public.profiles
  set
    full_name = trim(input_full_name),
    phone = trim(input_phone)
  where id = auth.uid()
  returning * into profile_row;

  if not found then
    raise exception 'Profile not found';
  end if;

  update public.staff_members
  set
    full_name = trim(input_full_name),
    phone = trim(input_phone)
  where profile_id = auth.uid();

  return public.get_own_account_profile();
end;
$$;

create or replace function public.set_staff_licence(
  input_staff_id uuid,
  input_licence_expires_on date,
  input_licence_image_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role public.app_role := public.current_app_role();
  tenant_id uuid := public.current_operator_id();
  staff_row public.staff_members%rowtype;
  image_url text := nullif(trim(coalesce(input_licence_image_url, '')), '');
  is_admin boolean := caller_role in ('operator_owner', 'operations_supervisor');
  is_own_driver boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if tenant_id is null then
    raise exception 'Operator context required';
  end if;

  if input_licence_expires_on is null then
    raise exception 'Driver licence expiry date is required';
  end if;

  if image_url is null then
    raise exception 'Licence document URL is required';
  end if;

  select *
  into staff_row
  from public.staff_members
  where id = input_staff_id
    and operator_id = tenant_id;

  if not found then
    raise exception 'Staff member not found';
  end if;

  if staff_row.role <> 'driver' then
    raise exception 'Licence documents are only allowed for drivers';
  end if;

  is_own_driver := caller_role = 'driver' and staff_row.profile_id = auth.uid();

  if not is_admin and not is_own_driver then
    raise exception 'Not allowed to update this driver licence';
  end if;

  update public.staff_members
  set
    licence_expires_on = input_licence_expires_on,
    licence_image_url = image_url
  where id = input_staff_id
  returning * into staff_row;

  return jsonb_build_object(
    'staffId', staff_row.id,
    'fullName', staff_row.full_name,
    'licenceExpiresOn', staff_row.licence_expires_on,
    'licenceImageUrl', staff_row.licence_image_url
  );
end;
$$;

comment on function public.update_own_profile is
  'Any logged-in user can update their own name and phone; mirrors to linked staff_members.';

comment on function public.set_staff_licence is
  'Operators can set any tenant driver licence; drivers can set their own after uploading a document.';

comment on function public.get_own_account_profile is
  'Returns the caller profile plus linked staff/licence fields when present.';
