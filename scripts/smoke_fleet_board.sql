-- Smoke: operator_fleet_snapshot as demo owner
do $$
declare
  owner_id uuid;
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

  snap := public.operator_fleet_snapshot(current_date);
  if snap is null then
    raise exception 'snapshot null';
  end if;
  if not (
    snap ? 'metrics'
    and snap ? 'trucks'
    and snap ? 'dumpsiteRuns'
    and snap ? 'fuelLogs'
    and snap ? 'maintenanceEvents'
    and snap ? 'dumpsiteSites'
    and snap ? 'activeTruckPositions'
  ) then
    raise exception 'missing keys: %', snap;
  end if;
  raise notice 'trucks=% fuel=% dumpsite=% maintenance=% sites=% activeTrucks=% metrics=%',
    jsonb_array_length(snap->'trucks'),
    jsonb_array_length(snap->'fuelLogs'),
    jsonb_array_length(snap->'dumpsiteRuns'),
    jsonb_array_length(snap->'maintenanceEvents'),
    jsonb_array_length(snap->'dumpsiteSites'),
    jsonb_array_length(snap->'activeTruckPositions'),
    snap->'metrics';
end
$$;
