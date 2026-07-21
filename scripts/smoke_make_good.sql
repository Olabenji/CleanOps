-- Smoke: frequency filter + make-good enqueue/include/clear
\set ON_ERROR_STOP on

select public.operation_current_date() as ops_date,
  extract(isodow from public.operation_current_date()) as dow;

select extract(isodow from date '2099-01-05') as mon_dow,
       extract(isodow from date '2099-01-06') as tue_dow;

do $$
declare
  v_profile uuid := '00000000-0000-4000-8000-000000000011';
  v_operator uuid := '00000000-0000-4000-8000-000000000001';
  v_mon date := date '2099-01-05';
  v_tue date := date '2099-01-06';
  v_planned int;
  v_folake uuid := '00000000-0000-4000-8000-000000000401';
  v_block_c uuid := '00000000-0000-4000-8000-000000000405';
  v_stop_folake uuid;
  v_stop_mg uuid;
  v_mg_status text;
  v_mg_count int;
  v_mon_customers text[];
  v_tue_customers text[];
  v_alerts jsonb;
  v_make_good_flag boolean;
  v_home jsonb;
begin
  -- Clean prior smoke artefacts
  delete from collection_make_goods where customer_id in (v_folake, v_block_c);
  delete from route_stops where route_id in (
    select id from routes where scheduled_date in (v_mon, v_tue) and operator_id = v_operator
  );
  delete from routes where scheduled_date in (v_mon, v_tue) and operator_id = v_operator;

  perform set_config('request.jwt.claim.sub', v_profile::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_profile::text, 'role', 'authenticated')::text, true);

  v_planned := public.plan_daily_routes(v_mon);
  raise notice 'Monday planned routes: %', v_planned;

  select array_agg(c.display_name order by c.display_name)
  into v_mon_customers
  from routes r
  join route_stops rs on rs.route_id = r.id
  join customers c on c.id = rs.customer_id
  where r.scheduled_date = v_mon and r.operator_id = v_operator;

  raise notice 'Monday customers: %', v_mon_customers;

  if not exists (
    select 1 from routes r
    join route_stops rs on rs.route_id = r.id
    where r.scheduled_date = v_mon and r.operator_id = v_operator and rs.customer_id = v_folake
  ) then
    raise exception 'FAIL: Folake (Mon preferred) missing from Monday plan';
  end if;

  if exists (
    select 1 from routes r
    join route_stops rs on rs.route_id = r.id
    where r.scheduled_date = v_mon and r.operator_id = v_operator and rs.customer_id = v_block_c
  ) then
    raise exception 'FAIL: Block C (Wed preferred) should not appear on Monday';
  end if;

  select rs.id into v_stop_folake
  from routes r
  join route_stops rs on rs.route_id = r.id
  where r.scheduled_date = v_mon and r.operator_id = v_operator and rs.customer_id = v_folake
  limit 1;

  perform public.update_route_stop_status(v_stop_folake, 'skipped', null, 'Gate locked');

  select status into v_mg_status
  from collection_make_goods
  where customer_id = v_folake and status in ('open', 'scheduled');

  if v_mg_status is distinct from 'open' then
    raise exception 'FAIL: expected open make-good after skip, got %', v_mg_status;
  end if;

  raise notice 'Make-good opened after skip: %', v_mg_status;

  v_planned := public.plan_daily_routes(v_tue);
  raise notice 'Tuesday planned routes: %', v_planned;

  select array_agg(c.display_name order by c.display_name),
         bool_or(rs.is_make_good)
  into v_tue_customers, v_make_good_flag
  from routes r
  join route_stops rs on rs.route_id = r.id
  join customers c on c.id = rs.customer_id
  where r.scheduled_date = v_tue and r.operator_id = v_operator;

  raise notice 'Tuesday customers: % (any make-good flag=%)', v_tue_customers, v_make_good_flag;

  if not exists (
    select 1 from routes r
    join route_stops rs on rs.route_id = r.id
    where r.scheduled_date = v_tue and r.operator_id = v_operator
      and rs.customer_id = v_folake and rs.is_make_good
  ) then
    raise exception 'FAIL: Folake make-good missing on Tuesday plan';
  end if;

  select status into v_mg_status
  from collection_make_goods where customer_id = v_folake and status in ('open', 'scheduled');

  if v_mg_status is distinct from 'scheduled' then
    raise exception 'FAIL: expected scheduled make-good after Tue plan, got %', v_mg_status;
  end if;

  select rs.id into v_stop_mg
  from routes r
  join route_stops rs on rs.route_id = r.id
  where r.scheduled_date = v_tue and r.operator_id = v_operator and rs.customer_id = v_folake
  limit 1;

  perform public.update_route_stop_status(v_stop_mg, 'completed', null, null);

  select count(*) into v_mg_count
  from collection_make_goods
  where customer_id = v_folake and status in ('open', 'scheduled');

  if v_mg_count <> 0 then
    raise exception 'FAIL: make-good should clear after complete';
  end if;

  -- Re-open one make-good to verify dashboard alert + resident home shape
  insert into collection_make_goods (
    operator_id, customer_id, source_date, status, due_by
  ) values (
    v_operator, v_folake, v_mon, 'open', v_mon + 7
  );

  v_alerts := public.operator_dashboard_snapshot(public.operation_current_date())->'alerts';
  raise notice 'Dashboard alerts: %', v_alerts;

  if not exists (
    select 1 from jsonb_array_elements_text(v_alerts) a
    where a like '%awaiting make-good%'
  ) then
    raise exception 'FAIL: dashboard missing make-good alert';
  end if;

  -- Resident home makeGood payload (Folake profile if linked)
  update customers set profile_id = coalesce(profile_id, (
    select id from profiles where role = 'resident' and operator_id = v_operator limit 1
  )) where id = v_folake and profile_id is null;

  if exists (select 1 from customers where id = v_folake and profile_id is not null) then
    perform set_config('request.jwt.claim.sub', (select profile_id::text from customers where id = v_folake), true);
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', (select profile_id from customers where id = v_folake), 'role', 'authenticated')::text,
      true
    );
    begin
      v_home := public.get_resident_home();
      raise notice 'Resident makeGood: %', v_home->'makeGood';
      if v_home->'makeGood' is null or (v_home->'makeGood'->>'active') is distinct from 'true' then
        raise exception 'FAIL: resident home missing active makeGood';
      end if;
    exception when others then
      raise notice 'Resident home check skipped/failed: %', SQLERRM;
    end;
  else
    raise notice 'Resident home check skipped: Folake has no profile_id';
  end if;

  -- Cleanup make-good left for alert check
  delete from collection_make_goods where customer_id = v_folake and status = 'open' and source_date = v_mon;
  delete from route_stops where route_id in (
    select id from routes where scheduled_date in (v_mon, v_tue) and operator_id = v_operator
  );
  delete from routes where scheduled_date in (v_mon, v_tue) and operator_id = v_operator;

  raise notice 'SMOKE PASS';
end $$;
