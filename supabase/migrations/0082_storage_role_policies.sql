-- Role-aware storage policies for driver licences and stop proof photos.
-- Paths stay as the app already writes them:
--   driver-licences: {operatorId}/{staffId}/{file}
--   stop-proofs:     {operatorId}/{stopId}/{file}
--
-- operations_supervisor is a manager alongside operator_owner (same split as
-- set_staff_licence and route planning). Residents do not view stop proof
-- anywhere in the web or mobile apps, so they get no proof access.
-- platform_admin profiles have no operator_id, so they do not match a folder.

create or replace function public.caller_staff_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select staff_members.id
  from public.staff_members
  where staff_members.profile_id = auth.uid()
    and staff_members.operator_id = public.current_operator_id()
    and staff_members.active
  order by
    case when staff_members.role = public.current_app_role() then 0 else 1 end,
    staff_members.created_at
  limit 1;
$$;

create or replace function public.caller_assigned_to_stop(stop_id text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  parsed uuid;
  staff_id uuid;
begin
  if public.current_app_role() not in ('driver', 'collection_agent') then
    return false;
  end if;

  begin
    parsed := stop_id::uuid;
  exception
    when invalid_text_representation then
      return false;
  end;

  staff_id := public.caller_staff_id();
  if staff_id is null then
    return false;
  end if;

  return exists (
    select 1
    from public.route_stops
    join public.routes on routes.id = route_stops.route_id
    where route_stops.id = parsed
      and routes.operator_id = public.current_operator_id()
      and routes.driver_id = staff_id
  );
end;
$$;

revoke all on function public.caller_staff_id() from public;
revoke all on function public.caller_assigned_to_stop(text) from public;
grant execute on function public.caller_staff_id() to authenticated;
grant execute on function public.caller_assigned_to_stop(text) to authenticated;

-- Driver licences -----------------------------------------------------------

drop policy if exists "Authenticated users can read driver licence objects" on storage.objects;
drop policy if exists "Authenticated users can upload driver licence objects" on storage.objects;
drop policy if exists "Authenticated users can update driver licence objects" on storage.objects;
drop policy if exists "Authenticated users can delete driver licence objects" on storage.objects;
drop policy if exists "Tenant users can read own driver licence objects" on storage.objects;
drop policy if exists "Tenant users can upload own driver licence objects" on storage.objects;
drop policy if exists "Tenant users can update own driver licence objects" on storage.objects;
drop policy if exists "Tenant users can delete own driver licence objects" on storage.objects;
drop policy if exists "Managers read driver licences" on storage.objects;
drop policy if exists "Drivers read own licence" on storage.objects;
drop policy if exists "Managers insert driver licences" on storage.objects;
drop policy if exists "Drivers insert own licence" on storage.objects;
drop policy if exists "Managers update driver licences" on storage.objects;
drop policy if exists "Managers delete driver licences" on storage.objects;

create policy "Managers read driver licences"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'driver-licences'
  and public.current_app_role() in ('operator_owner', 'operations_supervisor')
  and (storage.foldername(name))[1] = public.current_operator_id()::text
);

create policy "Drivers read own licence"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'driver-licences'
  and public.current_app_role() = 'driver'
  and (storage.foldername(name))[1] = public.current_operator_id()::text
  and (storage.foldername(name))[2] = public.caller_staff_id()::text
);

create policy "Managers insert driver licences"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'driver-licences'
  and public.current_app_role() in ('operator_owner', 'operations_supervisor')
  and (storage.foldername(name))[1] = public.current_operator_id()::text
);

create policy "Drivers insert own licence"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'driver-licences'
  and public.current_app_role() = 'driver'
  and (storage.foldername(name))[1] = public.current_operator_id()::text
  and (storage.foldername(name))[2] = public.caller_staff_id()::text
);

create policy "Managers update driver licences"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'driver-licences'
  and public.current_app_role() in ('operator_owner', 'operations_supervisor')
  and (storage.foldername(name))[1] = public.current_operator_id()::text
)
with check (
  bucket_id = 'driver-licences'
  and public.current_app_role() in ('operator_owner', 'operations_supervisor')
  and (storage.foldername(name))[1] = public.current_operator_id()::text
);

create policy "Managers delete driver licences"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'driver-licences'
  and public.current_app_role() in ('operator_owner', 'operations_supervisor')
  and (storage.foldername(name))[1] = public.current_operator_id()::text
);

-- Stop proof photos. No update policy: proof is immutable. -----------------

drop policy if exists "Tenant users can read own stop proof objects" on storage.objects;
drop policy if exists "Tenant users can upload own stop proof objects" on storage.objects;
drop policy if exists "Tenant users can update own stop proof objects" on storage.objects;
drop policy if exists "Tenant users can delete own stop proof objects" on storage.objects;
drop policy if exists "Managers read stop proofs" on storage.objects;
drop policy if exists "Field staff read own stop proofs" on storage.objects;
drop policy if exists "Field staff insert stop proofs" on storage.objects;
drop policy if exists "Owners delete stop proofs" on storage.objects;

create policy "Managers read stop proofs"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'stop-proofs'
  and public.current_app_role() in ('operator_owner', 'operations_supervisor')
  and (storage.foldername(name))[1] = public.current_operator_id()::text
);

create policy "Field staff read own stop proofs"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'stop-proofs'
  and public.current_app_role() in ('driver', 'collection_agent')
  and (storage.foldername(name))[1] = public.current_operator_id()::text
  and (
    owner = auth.uid()
    or owner_id = auth.uid()::text
  )
);

create policy "Field staff insert stop proofs"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'stop-proofs'
  and public.current_app_role() in ('driver', 'collection_agent')
  and (storage.foldername(name))[1] = public.current_operator_id()::text
  and public.caller_assigned_to_stop((storage.foldername(name))[2])
);

create policy "Owners delete stop proofs"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'stop-proofs'
  and public.current_app_role() = 'operator_owner'
  and (storage.foldername(name))[1] = public.current_operator_id()::text
);
