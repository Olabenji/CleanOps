-- Storage RLS: a driver cannot read another driver's licence, and a
-- non-owner cannot delete stop proof. Rolled back so seed data stays put.
begin;

do $$
declare
  v_operator_id uuid := '00000000-0000-4000-8000-000000000001';
  driver_user uuid := '00000000-0000-4000-8000-000000000021';
  driver_staff uuid := '00000000-0000-4000-8000-000000000201';
  other_staff uuid := '00000000-0000-4000-8000-000000000202';
  owner_user uuid := '00000000-0000-4000-8000-000000000011';
  agent_user uuid := '00000000-0000-4000-8000-000000000031';
  resident_user uuid := '00000000-0000-4000-8000-000000000041';
  own_licence text := v_operator_id::text || '/' || '00000000-0000-4000-8000-000000000201' || '/smoke-own.jpg';
  other_licence text := v_operator_id::text || '/' || '00000000-0000-4000-8000-000000000202' || '/smoke-other.jpg';
  stop_id uuid;
  proof_path text;
  seen integer;
  deleted integer;
  has_owner_id boolean;
begin
  -- Supabase blocks every DELETE on storage.objects unless this
  -- transaction-local flag is set. The flag only lets the statement
  -- run; row security still decides which rows are removed. Rollback
  -- drops the flag with the fixture rows.
  perform set_config('storage.allow_delete_query', 'true', true);

  select rs.id
  into stop_id
  from public.route_stops rs
  join public.routes r on r.id = rs.route_id
  where r.driver_id = driver_staff
    and r.operator_id = v_operator_id
  limit 1;

  if stop_id is null then
    raise exception 'assigned demo stop missing';
  end if;

  proof_path := v_operator_id::text || '/' || stop_id::text || '/smoke-proof.jpg';

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'storage'
      and table_name = 'objects'
      and column_name = 'owner_id'
  )
  into has_owner_id;

  if has_owner_id then
    insert into storage.objects (bucket_id, name, owner, owner_id)
    values
      ('driver-licences', own_licence, driver_user, driver_user::text),
      ('driver-licences', other_licence, driver_user, driver_user::text),
      ('stop-proofs', proof_path, driver_user, driver_user::text);
  else
    insert into storage.objects (bucket_id, name, owner)
    values
      ('driver-licences', own_licence, driver_user),
      ('driver-licences', other_licence, driver_user),
      ('stop-proofs', proof_path, driver_user);
  end if;

  perform set_config('request.jwt.claim.sub', driver_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', driver_user::text, 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';

  select count(*) into seen
  from storage.objects
  where bucket_id = 'driver-licences'
    and name = other_licence;
  if seen <> 0 then
    raise exception 'driver can read another driver licence';
  end if;

  select count(*) into seen
  from storage.objects
  where bucket_id = 'driver-licences'
    and name = own_licence;
  if seen <> 1 then
    raise exception 'driver cannot read own licence (saw %)', seen;
  end if;

  if has_owner_id then
    insert into storage.objects (bucket_id, name, owner, owner_id)
    values (
      'driver-licences',
      v_operator_id::text || '/' || driver_staff::text || '/smoke-upload.jpg',
      driver_user,
      driver_user::text
    );
  else
    insert into storage.objects (bucket_id, name, owner)
    values (
      'driver-licences',
      v_operator_id::text || '/' || driver_staff::text || '/smoke-upload.jpg',
      driver_user
    );
  end if;

  begin
    if has_owner_id then
      insert into storage.objects (bucket_id, name, owner, owner_id)
      values (
        'driver-licences',
        v_operator_id::text || '/' || other_staff::text || '/smoke-denied.jpg',
        driver_user,
        driver_user::text
      );
    else
      insert into storage.objects (bucket_id, name, owner)
      values (
        'driver-licences',
        v_operator_id::text || '/' || other_staff::text || '/smoke-denied.jpg',
        driver_user
      );
    end if;
    raise exception 'driver inserted another driver licence';
  exception
    when insufficient_privilege then
      null;
  end;

  delete from storage.objects
  where bucket_id = 'stop-proofs'
    and name = proof_path;
  get diagnostics deleted = row_count;
  if deleted <> 0 then
    raise exception 'driver deleted stop proof';
  end if;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', agent_user::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', agent_user::text, 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';

  delete from storage.objects
  where bucket_id = 'stop-proofs'
    and name = proof_path;
  get diagnostics deleted = row_count;
  if deleted <> 0 then
    raise exception 'collection agent deleted stop proof';
  end if;

  execute 'reset role';
  update public.profiles
  set role = 'operations_supervisor'
  where id = owner_user;

  perform set_config('request.jwt.claim.sub', owner_user::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', owner_user::text, 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';

  delete from storage.objects
  where bucket_id = 'stop-proofs'
    and name = proof_path;
  get diagnostics deleted = row_count;
  if deleted <> 0 then
    raise exception 'supervisor deleted stop proof';
  end if;

  select count(*) into seen
  from storage.objects
  where bucket_id = 'stop-proofs'
    and name = proof_path;
  if seen <> 1 then
    raise exception 'supervisor cannot read operator stop proof (saw %)', seen;
  end if;

  execute 'reset role';
  update public.profiles
  set role = 'operator_owner'
  where id = owner_user;

  perform set_config('request.jwt.claim.sub', resident_user::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', resident_user::text, 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';

  select count(*) into seen
  from storage.objects
  where name in (own_licence, other_licence, proof_path);
  if seen <> 0 then
    raise exception 'resident can read licence or proof objects';
  end if;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', owner_user::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', owner_user::text, 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';

  select count(*) into seen
  from storage.objects
  where bucket_id = 'driver-licences'
    and name in (own_licence, other_licence);
  if seen <> 2 then
    raise exception 'owner cannot read both licences (saw %)', seen;
  end if;

  delete from storage.objects
  where bucket_id = 'stop-proofs'
    and name = proof_path;
  get diagnostics deleted = row_count;
  if deleted <> 1 then
    raise exception 'owner could not delete stop proof (deleted %)', deleted;
  end if;

  execute 'reset role';
  raise notice 'SMOKE PASS';
end
$$;

rollback;
