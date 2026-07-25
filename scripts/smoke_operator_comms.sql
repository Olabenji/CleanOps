-- Smoke: operator_comms_snapshot + reminder preview/queue as demo owner
do $$
declare
  owner_id uuid;
  snap jsonb;
  preview jsonb;
  queued jsonb;
  phone_ok text;
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

  phone_ok := public.normalize_ng_phone('08031234567');
  if phone_ok is distinct from '+2348031234567' then
    raise exception 'normalize_ng_phone failed: %', phone_ok;
  end if;

  snap := public.operator_comms_snapshot(25);
  if snap is null then
    raise exception 'comms snapshot null';
  end if;

  if not (
    snap ? 'metrics'
    and snap ? 'reminderPreview5'
    and snap ? 'reminderPreview2'
    and snap ? 'recent'
  ) then
    raise exception 'missing comms keys: %', snap;
  end if;

  preview := public.preview_payment_reminder_candidates(5);
  if preview is null or not (preview ? 'candidates') then
    raise exception 'reminder preview failed: %', preview;
  end if;

  -- Force queue outside calendar window so smoke is date-independent.
  queued := public.queue_payment_reminders(5, true);
  if queued is null or not (queued ? 'queued') then
    raise exception 'queue reminders failed: %', queued;
  end if;

  raise notice 'comms ok candidates5=% queued=% metrics=%',
    jsonb_array_length(preview->'candidates'),
    queued->>'queued',
    snap->'metrics';
end
$$;
