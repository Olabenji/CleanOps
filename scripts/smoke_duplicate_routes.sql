-- 0079: untouched scheduled duplicates can be cancelled; progressed
-- duplicates raise and are left unchanged. The transaction rolls back.
begin;

do $$
declare
  operator_id uuid := '00000000-0000-4000-8000-000000000001';
  zone_id uuid := '00000000-0000-4000-8000-000000000101';
  truck_id uuid := '00000000-0000-4000-8000-000000000301';
  driver_id uuid := '00000000-0000-4000-8000-000000000201';
  kept_id uuid := '00000000-0000-4000-8000-000000009001';
  extra_id uuid := '00000000-0000-4000-8000-000000009002';
  done_a uuid := '00000000-0000-4000-8000-000000009011';
  done_b uuid := '00000000-0000-4000-8000-000000009012';
  kept_status public.route_status;
  extra_status public.route_status;
  done_status_a public.route_status;
  done_status_b public.route_status;
  raised boolean := false;
  message text;
begin
  execute 'drop index if exists public.routes_one_active_per_zone_day_idx';

  insert into public.routes (
    id, operator_id, zone_id, truck_id, driver_id, scheduled_date, status, created_at
  )
  values
    (kept_id, operator_id, zone_id, truck_id, driver_id, date '2099-03-01', 'scheduled', '2099-02-01'),
    (extra_id, operator_id, zone_id, truck_id, driver_id, date '2099-03-01', 'scheduled', '2099-02-02');

  perform public.reconcile_duplicate_zone_day_routes();

  select status into kept_status from public.routes where id = kept_id;
  select status into extra_status from public.routes where id = extra_id;
  if kept_status is distinct from 'scheduled' or extra_status is distinct from 'cancelled' then
    raise exception 'untouched duplicate was not cancelled conservatively (kept %, extra %)', kept_status, extra_status;
  end if;

  insert into public.routes (
    id, operator_id, zone_id, truck_id, driver_id, scheduled_date, status, created_at
  )
  values
    (done_a, operator_id, zone_id, truck_id, driver_id, date '2099-03-02', 'completed', '2099-02-01'),
    (done_b, operator_id, zone_id, truck_id, driver_id, date '2099-03-02', 'completed', '2099-02-02');

  begin
    perform public.reconcile_duplicate_zone_day_routes();
  exception
    when others then
      raised := true;
      message := sqlerrm;
  end;

  if not raised or message not like '%operator ' || operator_id::text || ', zone ' || zone_id::text || ', date 2099-03-02%' then
    raise exception 'progressed duplicates did not fail loudly: %', coalesce(message, 'no error');
  end if;

  select status into done_status_a from public.routes where id = done_a;
  select status into done_status_b from public.routes where id = done_b;
  if done_status_a is distinct from 'completed' or done_status_b is distinct from 'completed' then
    raise exception 'progressed duplicates were altered (% / %)', done_status_a, done_status_b;
  end if;

  raise notice 'SMOKE PASS';
end
$$;

rollback;
