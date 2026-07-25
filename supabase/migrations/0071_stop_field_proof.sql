-- Field proof on stops: GPS stamp + optional photo path; storage bucket for proofs.

alter table public.route_stops
  add column if not exists proof_photo_path text;

comment on column public.route_stops.proof_photo_path is
  'Storage object path (or signed URL) for driver stop proof photo.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'stop-proofs',
  'stop-proofs',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Tenant users can read own stop proof objects" on storage.objects;
create policy "Tenant users can read own stop proof objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'stop-proofs'
  and (storage.foldername(name))[1] = public.current_operator_id()::text
);

drop policy if exists "Tenant users can upload own stop proof objects" on storage.objects;
create policy "Tenant users can upload own stop proof objects"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'stop-proofs'
  and (storage.foldername(name))[1] = public.current_operator_id()::text
);

drop policy if exists "Tenant users can update own stop proof objects" on storage.objects;
create policy "Tenant users can update own stop proof objects"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'stop-proofs'
  and (storage.foldername(name))[1] = public.current_operator_id()::text
)
with check (
  bucket_id = 'stop-proofs'
  and (storage.foldername(name))[1] = public.current_operator_id()::text
);

drop policy if exists "Tenant users can delete own stop proof objects" on storage.objects;
create policy "Tenant users can delete own stop proof objects"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'stop-proofs'
  and (storage.foldername(name))[1] = public.current_operator_id()::text
);

drop function if exists public.sync_driver_stop_action(uuid, public.route_stop_status, text, text);

create or replace function public.sync_driver_stop_action(
  input_stop_id uuid,
  next_status public.route_stop_status,
  input_notes text default null,
  input_skip_reason text default null,
  input_latitude numeric default null,
  input_longitude numeric default null,
  input_proof_photo_path text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  parent_route_id uuid;
  proof_path text := nullif(trim(coalesce(input_proof_photo_path, '')), '');
begin
  parent_route_id := public.update_route_stop_status(
    input_stop_id,
    next_status,
    input_notes,
    input_skip_reason
  );

  if input_latitude is not null and input_longitude is not null then
    if input_latitude < -90 or input_latitude > 90 or input_longitude < -180 or input_longitude > 180 then
      raise exception 'Invalid GPS coordinates';
    end if;

    update public.route_stops
    set location = st_setsrid(st_makepoint(input_longitude, input_latitude), 4326)::geography
    where id = input_stop_id;
  end if;

  if proof_path is not null then
    update public.route_stops
    set proof_photo_path = proof_path
    where id = input_stop_id;
  end if;

  return jsonb_build_object(
    'routeId', parent_route_id,
    'stopId', input_stop_id,
    'status', next_status,
    'latitude', input_latitude,
    'longitude', input_longitude,
    'proofPhotoPath', proof_path,
    'syncedAt', now()
  );
end;
$$;

grant execute on function public.sync_driver_stop_action(
  uuid, public.route_stop_status, text, text, numeric, numeric, text
) to authenticated;
