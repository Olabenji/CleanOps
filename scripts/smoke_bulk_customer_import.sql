-- Smoke: bulk customer import RPC as demo operator.

do $$
declare
  owner_id uuid;
  result jsonb;
  phone text := '08039990001';
  inserted_before int;
  inserted_after int;
begin
  select id into owner_id
  from auth.users
  where email = 'owner@cleanops.local'
  limit 1;

  if owner_id is null then
    raise exception 'Demo owner not found';
  end if;

  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', owner_id::text, 'role', 'authenticated')::text,
    true
  );

  delete from public.customers
  where operator_id = public.current_operator_id()
    and customers.phone = '08039990001';

  result := public.import_customers_bulk(
    jsonb_build_array(
      jsonb_build_object(
        'rowNumber', 2,
        'displayName', 'Import Smoke Customer',
        'phone', '08039990001',
        'address', '99 Smoke Test Avenue Lagos',
        'wardName', 'Ward A',
        'customerType', 'residential',
        'monthlyRateKobo', 350000,
        'collectionsPerWeek', 1,
        'preferredWeekdays', jsonb_build_array(1),
        'frequencyNotes', 'bulk-import-smoke'
      )
    ),
    false,
    'bulk-import-smoke'
  );

  if coalesce((result ->> 'inserted')::int, 0) <> 1 then
    raise exception 'Expected 1 insert, got %', result;
  end if;

  -- Idempotent re-run should skip duplicate phone.
  result := public.import_customers_bulk(
    jsonb_build_array(
      jsonb_build_object(
        'rowNumber', 2,
        'displayName', 'Import Smoke Customer',
        'phone', '08039990001',
        'address', '99 Smoke Test Avenue Lagos',
        'wardName', 'Ward A',
        'customerType', 'residential',
        'monthlyRateKobo', 350000,
        'collectionsPerWeek', 1,
        'preferredWeekdays', jsonb_build_array(1),
        'frequencyNotes', 'bulk-import-smoke'
      )
    ),
    false,
    'bulk-import-smoke'
  );

  if coalesce((result ->> 'inserted')::int, 0) <> 0
     or coalesce((result ->> 'skippedDuplicates')::int, 0) <> 1 then
    raise exception 'Expected skip on re-run, got %', result;
  end if;

  select count(*)::int into inserted_after
  from public.customers
  where operator_id = public.current_operator_id()
    and customers.phone = '08039990001'
    and frequency_notes = 'bulk-import-smoke';

  if inserted_after <> 1 then
    raise exception 'Expected exactly one smoke customer, found %', inserted_after;
  end if;

  raise notice 'bulk customer import smoke OK: %', result;
end;
$$;

select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'import_customers_bulk';
