-- Coverage note for today's closed recovery stops; notify on linked make-good re-bump.

create or replace function public.enqueue_resident_notification(
  input_operator_id uuid,
  input_customer_id uuid,
  input_make_good_id uuid,
  input_kind text,
  input_title text,
  input_body text,
  input_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  notification_id uuid;
  dedupe text;
  target_part text;
begin
  insert into public.resident_notifications (
    operator_id,
    customer_id,
    make_good_id,
    kind,
    title,
    body,
    payload,
    status
  )
  values (
    input_operator_id,
    input_customer_id,
    input_make_good_id,
    input_kind,
    input_title,
    input_body,
    coalesce(input_payload, '{}'::jsonb),
    case when input_kind = 'recovery_resolved' then 'resolved' else 'unread' end
  )
  returning id into notification_id;

  if input_kind = 'recovery_resolved' then
    update public.resident_notifications
    set
      status = 'resolved',
      resolved_at = now()
    where make_good_id = input_make_good_id
      and kind = 'unserviced_recovery'
      and status in ('unread', 'read');
  end if;

  -- Include targetDate (or notification id) so re-bumped recoveries can enqueue a new push.
  target_part := coalesce(nullif(input_payload->>'targetDate', ''), notification_id::text);
  dedupe := concat(
    input_kind,
    ':',
    coalesce(input_make_good_id::text, notification_id::text),
    ':',
    target_part
  );

  insert into public.notification_outbox (
    operator_id,
    customer_id,
    notification_id,
    channel,
    dedupe_key,
    payload,
    status
  )
  values (
    input_operator_id,
    input_customer_id,
    notification_id,
    'expo_push',
    dedupe,
    jsonb_build_object(
      'notificationId', notification_id,
      'kind', input_kind,
      'title', input_title,
      'body', input_body,
      'data', coalesce(input_payload, '{}'::jsonb)
    ),
    'queued'
  )
  on conflict (dedupe_key) do nothing;

  return notification_id;
end;
$$;

create or replace function public.enqueue_collection_make_good(input_stop_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  stop_row public.route_stops%rowtype;
  route_row public.routes%rowtype;
  customer_row public.customers%rowtype;
  linked_ids uuid[];
  make_good_id uuid;
  was_due boolean := false;
  window_days integer;
  target date;
  title text;
  body text;
  bumped record;
begin
  select * into stop_row from public.route_stops where id = input_stop_id;
  if stop_row.id is null then
    return null;
  end if;

  select * into route_row from public.routes where id = stop_row.route_id;
  if route_row.id is null then
    return null;
  end if;

  select * into customer_row from public.customers where id = stop_row.customer_id;
  if customer_row.id is null or customer_row.service_status is distinct from 'active' then
    return null;
  end if;

  select coalesce(array_agg(rsmg.make_good_id), array[]::uuid[])
  into linked_ids
  from public.route_stop_make_goods rsmg
  where rsmg.route_stop_id = stop_row.id;

  -- Linked recoveries missed again: bump one calendar day and notify.
  if cardinality(linked_ids) > 0 then
    for bumped in
      update public.collection_make_goods
      set
        status = 'open',
        target_date = greatest(target_date, route_row.scheduled_date) + 1,
        attempt_count = attempt_count + 1,
        scheduled_route_stop_id = null
      where id = any (linked_ids)
        and status in ('open', 'scheduled')
      returning id, source_date, target_date, due_by, attempt_count
    loop
      make_good_id := bumped.id;
      title := 'Collection rescheduled again';
      body := format(
        'Your make-up collection on %s was missed. A subsequent collection is planned for %s.',
        to_char(route_row.scheduled_date, 'DD Mon YYYY'),
        to_char(bumped.target_date, 'DD Mon YYYY')
      );

      perform public.enqueue_resident_notification(
        route_row.operator_id,
        customer_row.id,
        bumped.id,
        'unserviced_recovery',
        title,
        body,
        jsonb_build_object(
          'sourceDate', bumped.source_date,
          'targetDate', bumped.target_date,
          'dueBy', bumped.due_by,
          'makeGoodId', bumped.id,
          'attemptCount', bumped.attempt_count
        )
      );
    end loop;

    delete from public.route_stop_make_goods
    where route_stop_id = stop_row.id;

    return make_good_id;
  end if;

  was_due :=
    stop_row.is_make_good
    or extract(isodow from route_row.scheduled_date)::int = any (customer_row.preferred_weekdays);

  if not was_due then
    return null;
  end if;

  if exists (
    select 1
    from public.collection_make_goods
    where customer_id = customer_row.id
      and source_date = route_row.scheduled_date
  ) then
    select id into make_good_id
    from public.collection_make_goods
    where customer_id = customer_row.id
      and source_date = route_row.scheduled_date;
    return make_good_id;
  end if;

  window_days := greatest(ceil(7.0 / greatest(customer_row.collections_per_week, 1))::int, 1);
  target := route_row.scheduled_date + 1;

  insert into public.collection_make_goods (
    operator_id,
    customer_id,
    source_route_id,
    source_route_stop_id,
    source_date,
    status,
    due_by,
    target_date,
    attempt_count
  )
  values (
    route_row.operator_id,
    customer_row.id,
    route_row.id,
    stop_row.id,
    route_row.scheduled_date,
    'open',
    route_row.scheduled_date + window_days,
    target,
    0
  )
  returning id into make_good_id;

  title := 'Collection rescheduled';
  body := format(
    'Your appointed collection on %s was missed. A subsequent collection is planned for %s.',
    to_char(route_row.scheduled_date, 'DD Mon YYYY'),
    to_char(target, 'DD Mon YYYY')
  );

  perform public.enqueue_resident_notification(
    route_row.operator_id,
    customer_row.id,
    make_good_id,
    'unserviced_recovery',
    title,
    body,
    jsonb_build_object(
      'sourceDate', route_row.scheduled_date,
      'targetDate', target,
      'dueBy', route_row.scheduled_date + window_days,
      'makeGoodId', make_good_id
    )
  );

  return make_good_id;
end;
$$;

create or replace function public.operator_coverage_snapshot(input_date date default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  tenant_id uuid := public.current_operator_id();
  operation_date date := coalesce(input_date, public.operation_current_date());
  app_role text := public.current_app_role();
begin
  if tenant_id is null then
    return null;
  end if;

  if app_role not in (
    'operator_owner',
    'operations_supervisor',
    'platform_admin'
  ) then
    raise exception 'Not allowed to load coverage board';
  end if;

  return (
    with make_goods as (
      select
        mg.id,
        mg.customer_id,
        c.display_name as customer_name,
        z.name as zone_name,
        mg.status,
        mg.source_date,
        mg.target_date,
        mg.due_by,
        mg.attempt_count,
        mg.opened_at,
        mg.completed_at,
        coalesce(
          source_stop.skip_reason,
          source_stop.notes,
          case
            when mg.source_route_stop_id is not null then 'Missed collection'
            else null
          end
        ) as skip_reason,
        case
          when mg.status in ('open', 'scheduled') and mg.due_by < operation_date then true
          else false
        end as overdue,
        case
          when mg.status in ('open', 'scheduled') and mg.target_date <= operation_date then true
          else false
        end as due_today
      from public.collection_make_goods mg
      join public.customers c on c.id = mg.customer_id
      join public.zones z on z.id = c.zone_id
      left join public.route_stops source_stop on source_stop.id = mg.source_route_stop_id
      where mg.operator_id = tenant_id
        and (
          mg.status in ('open', 'scheduled')
          or (
            mg.status = 'completed'
            and coalesce(mg.completed_at::date, mg.source_date) >= operation_date - 14
          )
        )
    ),
    day_stops as (
      select
        rs.id,
        rs.customer_id,
        rs.status,
        rs.is_make_good
      from public.routes r
      join public.route_stops rs on rs.route_id = r.id
      where r.operator_id = tenant_id
        and r.scheduled_date = operation_date
        and r.status != 'cancelled'
    ),
    deferred as (
      -- Today's planned stops that were closed/missed with recovery still targeting a future day.
      select count(*)::int as deferred_count
      from day_stops ds
      where ds.status in ('missed_reported', 'skipped')
        and exists (
          select 1
          from public.collection_make_goods mg
          where mg.operator_id = tenant_id
            and mg.customer_id = ds.customer_id
            and mg.status in ('open', 'scheduled')
            and mg.target_date > operation_date
        )
    )
    select jsonb_build_object(
      'operationDate', operation_date,
      'metrics', jsonb_build_object(
        'dueToday', (select count(*)::int from make_goods where due_today),
        'completedToday', (
          select count(*)::int
          from make_goods
          where status = 'completed'
            and completed_at::date = operation_date
        ),
        'open', (select count(*)::int from make_goods where status = 'open'),
        'scheduled', (select count(*)::int from make_goods where status = 'scheduled'),
        'overdue', (select count(*)::int from make_goods where overdue),
        'completedRecent', (select count(*)::int from make_goods where status = 'completed'),
        'stopsDueToday', (select count(*)::int from day_stops),
        'stopsCompletedToday', (
          select count(*)::int from day_stops where status = 'completed'
        ),
        'makeGoodStopsToday', (
          select count(*)::int from day_stops where is_make_good
        ),
        'stopsClosedForRecovery', (select deferred_count from deferred),
        'expectedCompletableToday', greatest(
          (select count(*)::int from day_stops) - (select deferred_count from deferred),
          0
        )
      ),
      'items', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', id,
              'customerId', customer_id,
              'customerName', customer_name,
              'zoneName', zone_name,
              'status', status,
              'sourceDate', source_date,
              'targetDate', target_date,
              'dueBy', due_by,
              'attemptCount', attempt_count,
              'skipReason', skip_reason,
              'openedAt', opened_at,
              'completedAt', completed_at,
              'overdue', overdue,
              'dueToday', due_today
            )
            order by
              case
                when overdue then 0
                when due_today then 1
                when status = 'open' then 2
                when status = 'scheduled' then 3
                else 4
              end,
              target_date,
              customer_name
          )
          from make_goods
        ),
        '[]'::jsonb
      )
    )
  );
end;
$$;

grant execute on function public.enqueue_resident_notification(uuid, uuid, uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.enqueue_collection_make_good(uuid) to authenticated;
grant execute on function public.operator_coverage_snapshot(date) to authenticated;
