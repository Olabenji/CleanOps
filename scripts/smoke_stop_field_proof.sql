-- Smoke: sync_driver_stop_action with GPS + proof path (driver session)
do $$
declare
  driver_id uuid;
  stop_id uuid;
  result jsonb;
begin
  select profiles.id into driver_id
  from public.profiles
  join auth.users on auth.users.id = profiles.id
  where auth.users.email = 'driver@cleanops.local'
  limit 1;

  if driver_id is null then
    raise exception 'driver demo user missing';
  end if;

  perform set_config('request.jwt.claim.sub', driver_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  select rs.id into stop_id
  from public.route_stops rs
  join public.routes r on r.id = rs.route_id
  where rs.status = 'pending'
  order by r.scheduled_date desc
  limit 1;

  if stop_id is null then
    raise notice 'no pending stop; skip proof smoke';
    return;
  end if;

  result := public.sync_driver_stop_action(
    stop_id,
    'completed',
    'proof smoke',
    null,
    6.5,
    3.35,
    'smoke/path.jpg'
  );

  if result->>'proofPhotoPath' is distinct from 'smoke/path.jpg' then
    raise exception 'proof path missing: %', result;
  end if;

  raise notice 'proof smoke ok stop=% lat=%', stop_id, result->>'latitude';
end
$$;
