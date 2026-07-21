-- Smoke: supervisor close -> next-day recovery + notification, regular SLA preserved
\set ON_ERROR_STOP on

do $$
declare
  v_profile uuid := '00000000-0000-4000-8000-000000000011';
  v_operator uuid := '00000000-0000-4000-8000-000000000001';
  v_mon date := date '2099-02-02'; -- Monday
  v_tue date := date '2099-02-03'; -- Tuesday
  v_folake uuid := '00000000-0000-4000-8000-000000000401';
  v_tunde uuid := '00000000-0000-4000-8000-000000000402';
  v_route_mon uuid;
  v_stop_folake uuid;
  v_result jsonb;
  v_mg_target date;
  v_notif_count int;
  v_tue_has_folake boolean;
  v_tue_is_make_good boolean;
begin
  delete from notification_outbox where customer_id in (v_folake, v_tunde);
  delete from resident_notifications where customer_id in (v_folake, v_tunde);
  delete from route_stop_make_goods where make_good_id in (
    select id from collection_make_goods where customer_id in (v_folake, v_tunde)
  );
  delete from collection_make_goods where customer_id in (v_folake, v_tunde);
  delete from route_stops where route_id in (
    select id from routes where scheduled_date in (v_mon, v_tue) and operator_id = v_operator
  );
  delete from routes where scheduled_date in (v_mon, v_tue) and operator_id = v_operator;

  perform set_config('request.jwt.claim.sub', v_profile::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_profile::text, 'role', 'authenticated')::text,
    true
  );

  perform public.plan_daily_routes(v_mon);

  select r.id into v_route_mon
  from routes r
  join route_stops rs on rs.route_id = r.id
  where r.scheduled_date = v_mon
    and r.operator_id = v_operator
    and rs.customer_id = v_folake
  limit 1;

  if v_route_mon is null then
    raise exception 'FAIL: Monday route for Folake missing';
  end if;

  -- Complete Tunde, leave Folake pending, then supervisor-close.
  select rs.id into v_stop_folake
  from route_stops rs
  where rs.route_id = v_route_mon and rs.customer_id = v_folake;

  perform public.update_route_stop_status(
    (select rs.id from route_stops rs where rs.route_id = v_route_mon and rs.customer_id = v_tunde limit 1),
    'completed',
    null,
    null
  );

  v_result := public.finalize_route_with_unserviced(v_route_mon, 'Smoke close');
  raise notice 'Finalize result: %', v_result;

  if (v_result->>'outcome') is distinct from 'partial' then
    raise exception 'FAIL: expected partial outcome';
  end if;

  select target_date into v_mg_target
  from collection_make_goods
  where customer_id = v_folake and status in ('open', 'scheduled');

  if v_mg_target is distinct from v_tue then
    raise exception 'FAIL: expected Tuesday target, got %', v_mg_target;
  end if;

  select count(*) into v_notif_count
  from resident_notifications
  where customer_id = v_folake and kind = 'unserviced_recovery';

  if v_notif_count < 1 then
    raise exception 'FAIL: recovery notification missing';
  end if;

  if not exists (
    select 1 from notification_outbox
    where customer_id = v_folake and status in ('queued', 'processing', 'sent', 'failed')
  ) then
    raise exception 'FAIL: notification outbox missing';
  end if;

  perform public.plan_daily_routes(v_tue);

  select
    exists (
      select 1 from routes r
      join route_stops rs on rs.route_id = r.id
      where r.scheduled_date = v_tue and r.operator_id = v_operator and rs.customer_id = v_folake
    ),
    coalesce((
      select rs.is_make_good from routes r
      join route_stops rs on rs.route_id = r.id
      where r.scheduled_date = v_tue and r.operator_id = v_operator and rs.customer_id = v_folake
      limit 1
    ), false)
  into v_tue_has_folake, v_tue_is_make_good;

  if not v_tue_has_folake or not v_tue_is_make_good then
    raise exception 'FAIL: Tuesday recovery stop missing/flagged wrong';
  end if;

  -- Complete recovery and ensure notification resolves.
  perform public.update_route_stop_status(
    (
      select rs.id from routes r
      join route_stops rs on rs.route_id = r.id
      where r.scheduled_date = v_tue and r.operator_id = v_operator and rs.customer_id = v_folake
      limit 1
    ),
    'completed',
    null,
    null
  );

  if exists (
    select 1 from collection_make_goods
    where customer_id = v_folake and status in ('open', 'scheduled')
  ) then
    raise exception 'FAIL: make-good still open after complete';
  end if;

  if not exists (
    select 1 from resident_notifications
    where customer_id = v_folake and kind = 'recovery_resolved'
  ) then
    raise exception 'FAIL: recovery_resolved notification missing';
  end if;

  -- Cleanup
  delete from notification_outbox where customer_id in (v_folake, v_tunde);
  delete from resident_notifications where customer_id in (v_folake, v_tunde);
  delete from route_stop_make_goods where make_good_id in (
    select id from collection_make_goods where customer_id in (v_folake, v_tunde)
  );
  delete from collection_make_goods where customer_id in (v_folake, v_tunde);
  delete from route_stops where route_id in (
    select id from routes where scheduled_date in (v_mon, v_tue) and operator_id = v_operator
  );
  delete from routes where scheduled_date in (v_mon, v_tue) and operator_id = v_operator;

  raise notice 'SMOKE PASS';
end $$;
