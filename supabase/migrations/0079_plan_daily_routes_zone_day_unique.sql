-- Prevent same-day duplicate ward routes from concurrent plan_daily_routes.
-- Close-incomplete does not create routes; duplicates came from a TOCTOU race
-- when two planners both saw "no route for ward" and both inserted.
--
-- Only extra duplicates that are still scheduled and untouched are cancelled.
-- A route that is in progress, completed, or already has stop proof / completion
-- data is left alone. If those progressed rows still collide, the migration
-- raises and changes nothing, so a deploy fails instead of discarding real work.

create or replace function public.reconcile_duplicate_zone_day_routes()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  conflict_list text;
begin
  with route_progress as (
    select
      routes.id,
      routes.operator_id,
      routes.zone_id,
      routes.scheduled_date,
      routes.created_at,
      routes.status,
      (
        routes.status in ('in_progress', 'completed')
        or exists (
          select 1
          from public.route_stops
          where route_stops.route_id = routes.id
            and (
              route_stops.status in ('completed', 'skipped', 'missed_reported')
              or route_stops.completed_at is not null
              or nullif(btrim(coalesce(route_stops.proof_photo_path, '')), '') is not null
              or route_stops.location is not null
            )
        )
      ) as progressed
    from public.routes
    where routes.status <> 'cancelled'
  ),
  ranked as (
    select
      route_progress.id,
      route_progress.status,
      route_progress.progressed,
      row_number() over (
        partition by route_progress.operator_id, route_progress.zone_id, route_progress.scheduled_date
        order by
          case when route_progress.progressed then 0 else 1 end,
          route_progress.created_at asc,
          route_progress.id asc
      ) as rn,
      count(*) over (
        partition by route_progress.operator_id, route_progress.zone_id, route_progress.scheduled_date
      ) as group_size
    from route_progress
  )
  update public.routes
  set status = 'cancelled'
  where id in (
    select ranked.id
    from ranked
    where ranked.group_size > 1
      and ranked.rn > 1
      and ranked.status = 'scheduled'
      and not ranked.progressed
  );

  select string_agg(
    format(
      'operator %s, zone %s, date %s',
      conflicts.operator_id,
      conflicts.zone_id,
      conflicts.scheduled_date
    ),
    '; '
    order by conflicts.scheduled_date, conflicts.operator_id, conflicts.zone_id
  )
  into conflict_list
  from (
    select routes.operator_id, routes.zone_id, routes.scheduled_date
    from public.routes
    where routes.status <> 'cancelled'
    group by routes.operator_id, routes.zone_id, routes.scheduled_date
    having count(*) > 1
  ) conflicts;

  if conflict_list is not null then
    raise exception
      'Cannot enforce one active route per ward per day. Duplicate routes that are in progress, completed, or already have stop proof or completion data were left unchanged: %',
      conflict_list;
  end if;
end;
$$;

revoke all on function public.reconcile_duplicate_zone_day_routes() from public;

select public.reconcile_duplicate_zone_day_routes();

create unique index if not exists routes_one_active_per_zone_day_idx
  on public.routes (operator_id, zone_id, scheduled_date)
  where status <> 'cancelled';

create or replace function public.plan_daily_routes(input_scheduled_date date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_id uuid := public.current_operator_id();
  planned_count integer := 0;
  zone_row record;
  template_row public.route_templates%rowtype;
  prior_route public.routes%rowtype;
  v_route_id uuid;
  resolved_template_id uuid;
  dow integer := extract(isodow from input_scheduled_date)::int;
  created_route boolean;
  v_stop_id uuid;
  next_sequence integer;
  due_row record;
  recovery_row public.collection_make_goods%rowtype;
begin
  if tenant_id is null then
    raise exception 'Operator profile not found';
  end if;

  if public.current_app_role() not in ('operator_owner', 'operations_supervisor', 'driver') then
    raise exception 'Not allowed to plan daily routes';
  end if;

  if public.current_app_role() = 'driver'
    and input_scheduled_date <> public.operation_current_date() then
    raise exception 'Drivers can only load default routes for today';
  end if;

  -- Serialize concurrent planners for this operator + ops day.
  perform pg_advisory_xact_lock(
    hashtext(tenant_id::text),
    hashtext(input_scheduled_date::text)
  );

  perform public.ensure_zone_default_templates(tenant_id);

  for zone_row in
    select zones.id, zones.name
    from public.zones
    where zones.operator_id = tenant_id
    order by zones.name
  loop
    created_route := false;
    v_route_id := null;
    template_row := null;
    prior_route := null;

    select id
    into v_route_id
    from public.routes
    where operator_id = tenant_id
      and zone_id = zone_row.id
      and scheduled_date = input_scheduled_date
      and status != 'cancelled'
    order by
      case status
        when 'in_progress' then 0
        when 'completed' then 1
        when 'scheduled' then 2
        else 3
      end,
      created_at asc
    limit 1;

    select *
    into template_row
    from public.route_templates
    where operator_id = tenant_id
      and zone_id = zone_row.id
      and kind = 'zone_default';

    if template_row.id is null then
      select *
      into prior_route
      from public.routes
      where operator_id = tenant_id
        and zone_id = zone_row.id
        and scheduled_date < input_scheduled_date
        and status != 'cancelled'
        and exists (
          select 1
          from public.route_stops
          join public.customers on customers.id = route_stops.customer_id
          where route_stops.route_id = routes.id
            and customers.zone_id = routes.zone_id
        )
      order by scheduled_date desc, created_at desc
      limit 1;

      if prior_route.id is not null then
        resolved_template_id := public.upsert_zone_default_template_from_route(prior_route.id);
        select * into template_row from public.route_templates where id = resolved_template_id;
      end if;
    end if;

    if v_route_id is null then
      if template_row.id is null then
        continue;
      end if;

      if not exists (
        select 1 from public.route_template_stops
        where route_template_stops.template_id = template_row.id
      ) then
        continue;
      end if;

      insert into public.routes (
        operator_id,
        zone_id,
        truck_id,
        driver_id,
        scheduled_date,
        status
      )
      values (
        tenant_id,
        zone_row.id,
        template_row.truck_id,
        template_row.driver_id,
        input_scheduled_date,
        'scheduled'
      )
      returning id into v_route_id;

      created_route := true;
    end if;

    -- Regular preferred-day stops from template.
    if template_row.id is not null then
      for due_row in
        select
          rts.customer_id,
          rts.stop_sequence
        from public.route_template_stops rts
        join public.customers c on c.id = rts.customer_id
        where rts.template_id = template_row.id
          and c.zone_id = zone_row.id
          and c.service_status = 'active'
          and dow = any (c.preferred_weekdays)
          and not exists (
            select 1
            from public.route_stops rs
            where rs.route_id = v_route_id
              and rs.customer_id = rts.customer_id
          )
        order by rts.stop_sequence
      loop
        select coalesce(max(rs.stop_sequence), 0) + 1
        into next_sequence
        from public.route_stops rs
        where rs.route_id = v_route_id;

        insert into public.route_stops (
          route_id,
          customer_id,
          stop_sequence,
          status,
          is_make_good
        )
        values (
          v_route_id,
          due_row.customer_id,
          next_sequence,
          'pending',
          false
        );
      end loop;
    end if;

    -- Recovery obligations due on or before this plan date.
    for recovery_row in
      select cmg.*
      from public.collection_make_goods cmg
      join public.customers c on c.id = cmg.customer_id
      where cmg.operator_id = tenant_id
        and cmg.status in ('open', 'scheduled')
        and cmg.target_date <= input_scheduled_date
        and c.zone_id = zone_row.id
        and c.service_status = 'active'
      order by cmg.target_date, cmg.opened_at
    loop
      select rs.id
      into v_stop_id
      from public.route_stops rs
      where rs.route_id = v_route_id
        and rs.customer_id = recovery_row.customer_id
      limit 1;

      if v_stop_id is null then
        select coalesce(max(rs.stop_sequence), 0) + 1
        into next_sequence
        from public.route_stops rs
        where rs.route_id = v_route_id;

        insert into public.route_stops (
          route_id,
          customer_id,
          stop_sequence,
          status,
          is_make_good
        )
        values (
          v_route_id,
          recovery_row.customer_id,
          next_sequence,
          'pending',
          true
        )
        returning id into v_stop_id;
      else
        update public.route_stops
        set is_make_good = true
        where id = v_stop_id;
      end if;

      insert into public.route_stop_make_goods (route_stop_id, make_good_id)
      values (v_stop_id, recovery_row.id)
      on conflict do nothing;

      update public.collection_make_goods
      set
        status = 'scheduled',
        scheduled_route_stop_id = v_stop_id
      where id = recovery_row.id
        and status in ('open', 'scheduled');
    end loop;

    if not exists (select 1 from public.route_stops rs where rs.route_id = v_route_id) then
      if created_route then
        delete from public.routes where id = v_route_id;
      end if;
      continue;
    end if;

    planned_count := planned_count + 1;
  end loop;

  return planned_count;
end;
$$;
