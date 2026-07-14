-- Harden driver-licences storage: private bucket + signed-URL access pattern.

update storage.buckets
set public = false
where id = 'driver-licences';

drop policy if exists "Authenticated users can read driver licence objects" on storage.objects;
drop policy if exists "Authenticated users can upload driver licence objects" on storage.objects;
drop policy if exists "Authenticated users can update driver licence objects" on storage.objects;
drop policy if exists "Authenticated users can delete driver licence objects" on storage.objects;

create policy "Tenant users can read own driver licence objects"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'driver-licences'
  and (storage.foldername(name))[1] = public.current_operator_id()::text
);

create policy "Tenant users can upload own driver licence objects"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'driver-licences'
  and (storage.foldername(name))[1] = public.current_operator_id()::text
);

create policy "Tenant users can update own driver licence objects"
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

create policy "Tenant users can delete own driver licence objects"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'driver-licences'
  and (storage.foldername(name))[1] = public.current_operator_id()::text
);
