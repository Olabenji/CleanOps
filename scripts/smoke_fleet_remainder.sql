-- Smoke: maintenance + dumpsite registry RPCs as demo owner
do $$
declare
  owner_id uuid;
  truck_id uuid;
  maint jsonb;
  site jsonb;
  snap jsonb;
begin
  select profiles.id into owner_id
  from public.profiles
  join auth.users on auth.users.id = profiles.id
  where auth.users.email = 'owner@cleanops.local'
  limit 1;

  if owner_id is null then
    raise exception 'owner demo user missing';
  end if;

  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  select id into truck_id
  from public.trucks
  where operator_id = public.current_operator_id()
  limit 1;

  if truck_id is null then
    raise exception 'no truck';
  end if;

  maint := public.record_maintenance_event(
    truck_id,
    current_date,
    'Smoke brake check',
    'Ajegunle Workshop',
    150000
  );
  if maint is null or not (maint ? 'id') then
    raise exception 'maintenance failed: %', maint;
  end if;

  site := public.upsert_dumpsite_site(
    null,
    'Smoke Tip Site',
    'Surulere',
    6.5,
    3.35,
    100,
    'smoke',
    true
  );
  if site is null or not (site ? 'id') then
    raise exception 'site upsert failed: %', site;
  end if;

  snap := public.operator_fleet_snapshot(current_date);
  if jsonb_array_length(snap->'dumpsiteSites') < 1 then
    raise exception 'no dumpsite sites in snapshot';
  end if;
  if coalesce((snap->'metrics'->>'maintenanceEventsThisMonth')::int, 0) < 1 then
    raise exception 'maintenance metric missing';
  end if;

  raise notice 'ok maint=% site=% sites=% maintMetric=%',
    maint->>'truckRegistration',
    site->>'name',
    jsonb_array_length(snap->'dumpsiteSites'),
    snap->'metrics'->>'maintenanceEventsThisMonth';
end
$$;
