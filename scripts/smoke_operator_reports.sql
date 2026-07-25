-- Smoke: operator_reports_snapshot as demo owner
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

  snap := public.operator_reports_snapshot(
    date_trunc('month', current_date)::date,
    current_date
  );

  if snap is null then
    raise exception 'reports snapshot null';
  end if;

  if not (
    snap ? 'summary'
    and snap ? 'collections'
    and snap ? 'attendance'
    and snap ? 'fleetCosts'
    and snap ? 'lawmaSummary'
    and snap ? 'wardCoverage'
    and snap ? 'disposalTips'
    and snap ? 'serviceComplaints'
    and snap ? 'makeGoods'
  ) then
    raise exception 'missing report keys: %', snap;
  end if;

  raise notice 'reports ok collections=% attendance=% fleet=% ward=% tips=% complaints=% makeGoods=% net=%',
    jsonb_array_length(snap->'collections'),
    jsonb_array_length(snap->'attendance'),
    jsonb_array_length(snap->'fleetCosts'),
    jsonb_array_length(snap->'wardCoverage'),
    jsonb_array_length(snap->'disposalTips'),
    jsonb_array_length(snap->'serviceComplaints'),
    jsonb_array_length(snap->'makeGoods'),
    snap->'summary'->>'netKobo';
end
$$;
