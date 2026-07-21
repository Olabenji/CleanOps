-- Unserviced stop recovery (next calendar day) + resident inbox/push foundation.

-- ---------------------------------------------------------------------------
-- 1. Make-good / recovery model upgrades
-- ---------------------------------------------------------------------------

alter table public.collection_make_goods
  add column if not exists target_date date,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists scheduled_route_stop_id uuid references public.route_stops(id) on delete set null;

update public.collection_make_goods
set target_date = coalesce(target_date, source_date + 1)
where target_date is null;

alter table public.collection_make_goods
  alter column target_date set not null;

drop index if exists public.collection_make_goods_one_active_per_customer;

create unique index if not exists collection_make_goods_source_occurrence_uidx
  on public.collection_make_goods (customer_id, source_date);

create index if not exists collection_make_goods_operator_target_idx
  on public.collection_make_goods (operator_id, status, target_date);

create table if not exists public.route_stop_make_goods (
  route_stop_id uuid not null references public.route_stops(id) on delete cascade,
  make_good_id uuid not null references public.collection_make_goods(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (route_stop_id, make_good_id)
);

create index if not exists route_stop_make_goods_make_good_idx
  on public.route_stop_make_goods (make_good_id);

alter table public.route_stop_make_goods enable row level security;

drop policy if exists "tenant read route stop make goods" on public.route_stop_make_goods;
create policy "tenant read route stop make goods"
  on public.route_stop_make_goods for select
  using (
    exists (
      select 1
      from public.route_stops rs
      join public.routes r on r.id = rs.route_id
      where rs.id = route_stop_id
        and r.operator_id = public.current_operator_id()
    )
  );

drop policy if exists "managers write route stop make goods" on public.route_stop_make_goods;
create policy "managers write route stop make goods"
  on public.route_stop_make_goods for all
  using (
    public.current_app_role() in ('operator_owner', 'operations_supervisor', 'driver', 'collection_agent')
    and exists (
      select 1
      from public.route_stops rs
      join public.routes r on r.id = rs.route_id
      where rs.id = route_stop_id
        and r.operator_id = public.current_operator_id()
    )
  )
  with check (
    public.current_app_role() in ('operator_owner', 'operations_supervisor', 'driver', 'collection_agent')
    and exists (
      select 1
      from public.route_stops rs
      join public.routes r on r.id = rs.route_id
      where rs.id = route_stop_id
        and r.operator_id = public.current_operator_id()
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Resident notifications + push devices + outbox
-- ---------------------------------------------------------------------------

create table if not exists public.resident_notifications (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  make_good_id uuid references public.collection_make_goods(id) on delete set null,
  kind text not null check (kind in ('unserviced_recovery', 'recovery_resolved')),
  title text not null,
  body text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'unread'
    check (status in ('unread', 'read', 'resolved')),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  resolved_at timestamptz
);

create index if not exists resident_notifications_customer_created_idx
  on public.resident_notifications (customer_id, created_at desc);

create index if not exists resident_notifications_make_good_idx
  on public.resident_notifications (make_good_id);

alter table public.resident_notifications enable row level security;

drop policy if exists "resident read own notifications" on public.resident_notifications;
create policy "resident read own notifications"
  on public.resident_notifications for select
  using (
    operator_id = public.current_operator_id()
    and (
      (
        public.current_app_role() = 'resident'
        and customer_id = public.current_customer_id()
      )
      or public.current_app_role() in (
        'operator_owner',
        'operations_supervisor',
        'platform_admin'
      )
    )
  );

drop policy if exists "managers write resident notifications" on public.resident_notifications;
create policy "managers write resident notifications"
  on public.resident_notifications for all
  using (
    operator_id = public.current_operator_id()
    and public.current_app_role() in ('operator_owner', 'operations_supervisor', 'platform_admin')
  )
  with check (
    operator_id = public.current_operator_id()
    and public.current_app_role() in ('operator_owner', 'operations_supervisor', 'platform_admin')
  );

create table if not exists public.resident_push_devices (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  installation_id text not null,
  expo_push_token text not null,
  platform text not null check (platform in ('ios', 'android', 'web', 'unknown')),
  app_version text,
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (profile_id, installation_id)
);

create index if not exists resident_push_devices_customer_active_idx
  on public.resident_push_devices (customer_id)
  where disabled_at is null;

alter table public.resident_push_devices enable row level security;

drop policy if exists "resident manage own push devices" on public.resident_push_devices;
create policy "resident manage own push devices"
  on public.resident_push_devices for all
  using (
    profile_id = auth.uid()
    and customer_id = public.current_customer_id()
  )
  with check (
    profile_id = auth.uid()
    and customer_id = public.current_customer_id()
    and operator_id = public.current_operator_id()
  );

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  notification_id uuid references public.resident_notifications(id) on delete set null,
  channel text not null default 'expo_push' check (channel = 'expo_push'),
  dedupe_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'sent', 'failed', 'cancelled')),
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  provider_ticket_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dedupe_key)
);

create index if not exists notification_outbox_claim_idx
  on public.notification_outbox (status, next_attempt_at)
  where status in ('queued', 'failed');

alter table public.notification_outbox enable row level security;

drop policy if exists "managers read notification outbox" on public.notification_outbox;
create policy "managers read notification outbox"
  on public.notification_outbox for select
  using (
    operator_id = public.current_operator_id()
    and public.current_app_role() in ('operator_owner', 'operations_supervisor', 'platform_admin')
  );

-- ---------------------------------------------------------------------------
-- 3. Notification helpers
-- ---------------------------------------------------------------------------

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

  dedupe := concat(input_kind, ':', coalesce(input_make_good_id::text, notification_id::text));

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

create or replace function public.register_resident_push_device(
  input_installation_id text,
  input_expo_push_token text,
  input_platform text default 'unknown',
  input_app_version text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid := public.current_customer_id();
  v_operator_id uuid := public.current_operator_id();
  device_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if public.current_app_role() is distinct from 'resident' then
    raise exception 'Only residents can register push devices';
  end if;

  if v_customer_id is null or v_operator_id is null then
    raise exception 'Resident account is not linked to a customer';
  end if;

  if nullif(trim(coalesce(input_installation_id, '')), '') is null then
    raise exception 'Installation id is required';
  end if;

  if nullif(trim(coalesce(input_expo_push_token, '')), '') is null then
    raise exception 'Expo push token is required';
  end if;

  insert into public.resident_push_devices (
    operator_id,
    customer_id,
    profile_id,
    installation_id,
    expo_push_token,
    platform,
    app_version,
    last_seen_at,
    disabled_at
  )
  values (
    v_operator_id,
    v_customer_id,
    auth.uid(),
    trim(input_installation_id),
    trim(input_expo_push_token),
    case
      when input_platform in ('ios', 'android', 'web') then input_platform
      else 'unknown'
    end,
    nullif(trim(coalesce(input_app_version, '')), ''),
    now(),
    null
  )
  on conflict (profile_id, installation_id) do update
  set
    expo_push_token = excluded.expo_push_token,
    platform = excluded.platform,
    app_version = excluded.app_version,
    last_seen_at = now(),
    disabled_at = null
  returning id into device_id;

  return device_id;
end;
$$;

create or replace function public.unregister_resident_push_device(input_installation_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.resident_push_devices
  set disabled_at = now()
  where profile_id = auth.uid()
    and installation_id = trim(input_installation_id)
    and disabled_at is null;
end;
$$;

create or replace function public.list_my_resident_notifications(input_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_customer_id uuid := public.current_customer_id();
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if public.current_app_role() is distinct from 'resident' then
    raise exception 'Only residents can list notifications';
  end if;

  if v_customer_id is null then
    raise exception 'Resident account is not linked to a customer';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', n.id,
          'kind', n.kind,
          'title', n.title,
          'body', n.body,
          'payload', n.payload,
          'status', n.status,
          'makeGoodId', n.make_good_id,
          'createdAt', n.created_at,
          'readAt', n.read_at,
          'resolvedAt', n.resolved_at
        )
        order by n.created_at desc
      )
      from (
        select *
        from public.resident_notifications
        where customer_id = v_customer_id
        order by created_at desc
        limit greatest(coalesce(input_limit, 50), 1)
      ) n
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.mark_resident_notification_read(input_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid := public.current_customer_id();
begin
  if public.current_app_role() is distinct from 'resident' or v_customer_id is null then
    raise exception 'Only residents can mark notifications read';
  end if;

  update public.resident_notifications
  set
    status = case when status = 'unread' then 'read' else status end,
    read_at = coalesce(read_at, now())
  where id = input_notification_id
    and customer_id = v_customer_id
    and status in ('unread', 'read');
end;
$$;

create or replace function public.claim_notification_outbox(input_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed jsonb;
begin
  with picked as (
    select id
    from public.notification_outbox
    where status in ('queued', 'failed')
      and next_attempt_at <= now()
    order by next_attempt_at, created_at
    limit greatest(coalesce(input_limit, 50), 1)
    for update skip locked
  ),
  updated as (
    update public.notification_outbox o
    set
      status = 'processing',
      attempt_count = o.attempt_count + 1,
      updated_at = now()
    from picked
    where o.id = picked.id
    returning o.*
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', updated.id,
        'operatorId', updated.operator_id,
        'customerId', updated.customer_id,
        'notificationId', updated.notification_id,
        'payload', updated.payload,
        'attemptCount', updated.attempt_count,
        'tokens', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'deviceId', d.id,
              'token', d.expo_push_token,
              'platform', d.platform
            )
          )
          from public.resident_push_devices d
          where d.customer_id = updated.customer_id
            and d.disabled_at is null
        ), '[]'::jsonb)
      )
    ),
    '[]'::jsonb
  )
  into claimed
  from updated;

  return coalesce(claimed, '[]'::jsonb);
end;
$$;

create or replace function public.complete_notification_outbox(
  input_outbox_id uuid,
  input_success boolean,
  input_provider_ticket_id text default null,
  input_error text default null,
  input_disable_device_ids uuid[] default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notification_outbox
  set
    status = case when input_success then 'sent' else 'failed' end,
    provider_ticket_id = coalesce(input_provider_ticket_id, provider_ticket_id),
    last_error = case when input_success then null else coalesce(input_error, last_error) end,
    next_attempt_at = case
      when input_success then next_attempt_at
      else now() + make_interval(mins => least(attempt_count * 5, 60))
    end,
    updated_at = now()
  where id = input_outbox_id;

  if input_disable_device_ids is not null and cardinality(input_disable_device_ids) > 0 then
    update public.resident_push_devices
    set disabled_at = now()
    where id = any (input_disable_device_ids)
      and disabled_at is null;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Enqueue / resolve recovery obligations
-- ---------------------------------------------------------------------------

drop function if exists public.enqueue_collection_make_good(uuid);

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

  -- Linked recoveries missed again: bump one calendar day.
  if cardinality(linked_ids) > 0 then
    update public.collection_make_goods
    set
      status = 'open',
      target_date = greatest(target_date, route_row.scheduled_date) + 1,
      attempt_count = attempt_count + 1,
      scheduled_route_stop_id = null
    where id = any (linked_ids)
      and status in ('open', 'scheduled')
    returning id into make_good_id;

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

create or replace function public.resolve_linked_make_goods(input_completed_stop_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  stop_row public.route_stops%rowtype;
  route_row public.routes%rowtype;
  mg record;
begin
  select * into stop_row from public.route_stops where id = input_completed_stop_id;
  if stop_row.id is null then
    return;
  end if;

  select * into route_row from public.routes where id = stop_row.route_id;

  for mg in
    select cmg.*
    from public.route_stop_make_goods link
    join public.collection_make_goods cmg on cmg.id = link.make_good_id
    where link.route_stop_id = input_completed_stop_id
      and cmg.status in ('open', 'scheduled')
  loop
    update public.collection_make_goods
    set
      status = 'completed',
      completed_at = now(),
      completed_route_stop_id = input_completed_stop_id
    where id = mg.id;

    perform public.enqueue_resident_notification(
      mg.operator_id,
      mg.customer_id,
      mg.id,
      'recovery_resolved',
      'Collection completed',
      format(
        'Your make-up collection from %s has been completed.',
        to_char(mg.source_date, 'DD Mon YYYY')
      ),
      jsonb_build_object(
        'sourceDate', mg.source_date,
        'completedDate', coalesce(route_row.scheduled_date, public.operation_current_date()),
        'makeGoodId', mg.id
      )
    );
  end loop;
end;
$$;

-- Keep legacy name as a thin wrapper that only resolves linked items when a stop id is provided.
create or replace function public.clear_collection_make_good(
  input_customer_id uuid,
  input_completed_stop_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if input_completed_stop_id is not null then
    perform public.resolve_linked_make_goods(input_completed_stop_id);
    return;
  end if;

  -- Safety: without a stop link, do not clear unrelated recoveries.
  return;
end;
$$;

create or replace function public.update_route_stop_status(
  input_stop_id uuid,
  next_status public.route_stop_status,
  input_notes text default null,
  input_skip_reason text default null
)
returns uuid
language plpgsql
security invoker
as $$
declare
  parent_route_id uuid;
  stop_customer_id uuid;
begin
  select route_id, customer_id
  into parent_route_id, stop_customer_id
  from public.route_stops
  where id = input_stop_id;

  if parent_route_id is null then
    raise exception 'Route stop not found';
  end if;

  if next_status = 'skipped' and nullif(trim(coalesce(input_skip_reason, '')), '') is null then
    raise exception 'Skip reason is required';
  end if;

  update public.route_stops
  set
    status = next_status,
    completed_at = case when next_status = 'completed' then now() else null end,
    notes = nullif(trim(coalesce(input_notes, notes, '')), ''),
    skip_reason = case
      when next_status = 'skipped' then nullif(trim(coalesce(input_skip_reason, '')), '')
      when next_status = 'missed_reported' then coalesce(
        nullif(trim(coalesce(input_skip_reason, '')), ''),
        'Unserviced at route close'
      )
      else null
    end
  where id = input_stop_id;

  if not found then
    raise exception 'Route stop update was not permitted';
  end if;

  if next_status in ('skipped', 'missed_reported') then
    perform public.enqueue_collection_make_good(input_stop_id);
  elsif next_status = 'completed' then
    perform public.resolve_linked_make_goods(input_stop_id);
  end if;

  perform public.reconcile_route_progress(parent_route_id);

  return parent_route_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Supervisor finalize incomplete / unstarted routes
-- ---------------------------------------------------------------------------

create or replace function public.finalize_route_with_unserviced(
  input_route_id uuid,
  input_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_id uuid := public.current_operator_id();
  app_role text := public.current_app_role();
  route_record public.routes%rowtype;
  pending_count integer := 0;
  completed_count integer := 0;
  total_count integer := 0;
  outcome text;
  stop_id uuid;
  recovered integer := 0;
begin
  if tenant_id is null then
    raise exception 'Not authenticated';
  end if;

  if app_role not in ('operator_owner', 'operations_supervisor') then
    raise exception 'Only supervisors can close incomplete routes';
  end if;

  select *
  into route_record
  from public.routes
  where id = input_route_id
    and operator_id = tenant_id
  for update;

  if route_record.id is null then
    raise exception 'Route not found';
  end if;

  if route_record.status = 'completed' then
    raise exception 'Route is already completed';
  end if;

  if route_record.status = 'cancelled' then
    raise exception 'Cancelled routes cannot be finalized';
  end if;

  select
    count(*) filter (where status = 'pending'),
    count(*) filter (where status = 'completed'),
    count(*)
  into pending_count, completed_count, total_count
  from public.route_stops
  where route_id = input_route_id;

  outcome := case
    when completed_count = 0 and pending_count = total_count then 'not_started'
    else 'partial'
  end;

  for stop_id in
    select id
    from public.route_stops
    where route_id = input_route_id
      and status = 'pending'
    order by stop_sequence
  loop
    perform public.update_route_stop_status(
      stop_id,
      'missed_reported',
      nullif(trim(coalesce(input_note, '')), ''),
      coalesce(nullif(trim(coalesce(input_note, '')), ''), 'Unserviced at supervisor route close')
    );
    recovered := recovered + 1;
  end loop;

  update public.routes
  set
    status = 'completed',
    started_at = coalesce(started_at, now()),
    completed_at = now()
  where id = input_route_id
    and operator_id = tenant_id;

  return jsonb_build_object(
    'routeId', input_route_id,
    'outcome', outcome,
    'recoveredStops', recovered,
    'totalStops', total_count,
    'note', nullif(trim(coalesce(input_note, '')), '')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Idempotent plan_daily_routes (regular SLA + recovery merge)
-- ---------------------------------------------------------------------------

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
    order by created_at desc
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

-- ---------------------------------------------------------------------------
-- 7. Dashboard stale-route + recovery alerts; resident home targetDate
-- ---------------------------------------------------------------------------

create or replace function public.operator_dashboard_snapshot(input_date date default null)
returns jsonb
language plpgsql
stable
security invoker
as $$
declare
  tenant_id uuid := public.current_operator_id();
  operation_date date := coalesce(input_date, public.operation_current_date());
  open_make_good_count integer := 0;
  overdue_make_good_count integer := 0;
  stale_route_count integer := 0;
begin
  if tenant_id is null then
    return null;
  end if;

  select
    count(*) filter (where status in ('open', 'scheduled')),
    count(*) filter (where status in ('open', 'scheduled') and due_by < operation_date)
  into open_make_good_count, overdue_make_good_count
  from public.collection_make_goods
  where operator_id = tenant_id;

  select count(*)
  into stale_route_count
  from public.routes
  where operator_id = tenant_id
    and scheduled_date < operation_date
    and status in ('scheduled', 'in_progress');

  return jsonb_build_object(
    'operatorName',
      coalesce((select name from public.operators where id = tenant_id), 'CleanOps Operator'),
    'metrics',
      jsonb_build_array(
        jsonb_build_object(
          'label', 'Route Progress',
          'value', (
            select concat(
              coalesce(count(*) filter (where route_stops.status = 'completed'), 0),
              ' / ',
              coalesce(count(*), 0),
              ' stops'
            )
            from public.routes
            join public.route_stops on route_stops.route_id = routes.id
            where routes.operator_id = tenant_id
              and routes.scheduled_date = operation_date
          ),
          'helper', 'Stops completed across selected date routes'
        ),
        jsonb_build_object(
          'label', 'Payments',
          'value', (
            select concat('₦', trim(to_char(coalesce(sum(amount_kobo), 0) / 100, 'FM999G999G999G990')))
            from public.payments
            where operator_id = tenant_id
              and paid_at::date = operation_date
          ),
          'helper', 'Payments recorded on selected date'
        ),
        jsonb_build_object(
          'label', 'Staff Checked In',
          'value', (
            select concat(
              count(distinct attendance_logs.staff_member_id),
              ' / ',
              (select count(*) from public.staff_members where operator_id = tenant_id and active)
            )
            from public.attendance_logs
            where operator_id = tenant_id
              and checked_in_at::date = operation_date
          ),
          'helper', 'Attendance logged for selected date'
        ),
        jsonb_build_object(
          'label', 'Open Incidents',
          'value', (
            select concat(count(*), ' open')
            from public.incident_reports
            where operator_id = tenant_id
              and resolved_at is null
              and created_at::date <= operation_date
          ),
          'helper', 'Unresolved vehicle or route incidents'
        )
      ),
    'routes',
      coalesce((
        with route_progress as (
          select
            routes.id,
            zones.name as zone_name,
            trucks.registration_number,
            coalesce(staff_members.full_name, 'Unassigned') as driver_name,
            routes.status,
            count(route_stops.id) filter (where route_stops.status = 'completed')::int as completed_stops,
            greatest(count(route_stops.id), 1)::int as total_stops
          from public.routes
          join public.zones on zones.id = routes.zone_id
          join public.trucks on trucks.id = routes.truck_id
          left join public.staff_members on staff_members.id = routes.driver_id
          left join public.route_stops on route_stops.route_id = routes.id
          where routes.operator_id = tenant_id
            and routes.scheduled_date = operation_date
          group by routes.id, zones.name, trucks.registration_number, staff_members.full_name, routes.status
          order by zones.name
        )
        select jsonb_agg(
          jsonb_build_object(
            'id', id,
            'zoneName', zone_name,
            'truckRegistration', registration_number,
            'driverName', driver_name,
            'status', status,
            'completedStops', completed_stops,
            'totalStops', total_stops,
            'delayed', status = 'in_progress' and completed_stops::numeric / total_stops < 0.35
          )
        )
        from route_progress
      ), '[]'::jsonb),
    'recentPayments',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', payments.id,
            'customerName', customers.display_name,
            'channel', payments.channel,
            'amountKobo', payments.amount_kobo,
            'paidAt', payments.paid_at
          )
          order by payments.paid_at desc
        )
        from (
          select *
          from public.payments
          where operator_id = tenant_id
            and paid_at::date = operation_date
          order by paid_at desc
          limit 5
        ) payments
        join public.customers on customers.id = payments.customer_id
      ), '[]'::jsonb),
    'staffAttendance',
      jsonb_build_object(
        'totalStaff', (select count(*) from public.staff_members where operator_id = tenant_id and active),
        'checkedIn', (
          select count(distinct staff_member_id)
          from public.attendance_logs
          where operator_id = tenant_id
            and checked_in_at::date = operation_date
        ),
        'absent', greatest(
          (select count(*) from public.staff_members where operator_id = tenant_id and active)
          - (
            select count(distinct staff_member_id)
            from public.attendance_logs
            where operator_id = tenant_id
              and checked_in_at::date = operation_date
          ),
          0
        )
      ),
    'fleet',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'registrationNumber', trucks.registration_number,
            'zoneName', coalesce(zones.name, 'Standby'),
            'status', trucks.status,
            'reserveRemainingKobo', greatest(
              trucks.monthly_maintenance_reserve_kobo - coalesce(monthly_spend.spend_kobo, 0),
              0
            )
          )
          order by trucks.registration_number
        )
        from public.trucks
        left join public.zones on zones.id = trucks.zone_id
        left join lateral (
          select sum(cost_kobo) as spend_kobo
          from public.maintenance_events
          where maintenance_events.truck_id = trucks.id
            and date_trunc('month', maintenance_events.event_date::timestamp) = date_trunc('month', operation_date::timestamp)
        ) monthly_spend on true
        where trucks.operator_id = tenant_id
      ), '[]'::jsonb),
    'alerts',
      (
        with overdue as (
          select
            customers.customer_type,
            customers.collections_per_week,
            case
              when customers.customer_type in ('residential', 'estate') then 'residential'
              else 'commercial'
            end as sla_bucket
          from public.customers
          left join lateral (
            select max(route_stops.completed_at::date) as last_completed
            from public.route_stops
            join public.routes on routes.id = route_stops.route_id
            where route_stops.customer_id = customers.id
              and routes.operator_id = tenant_id
              and route_stops.status = 'completed'
          ) last_service on true
          where customers.operator_id = tenant_id
            and customers.service_status = 'active'
            and coalesce(last_service.last_completed, customers.created_at::date)
              < operation_date - ceil(7.0 / customers.collections_per_week)::int
        ),
        incident_alerts as (
          select title as alert_text, 0 as sort_key, created_at as sort_ts
          from public.incident_reports
          where operator_id = tenant_id
            and resolved_at is null
            and created_at::date <= operation_date
        ),
        sla_alerts as (
          select
            case
              when sla_bucket = 'residential' then
                concat(
                  count(*),
                  ' residential customer',
                  case when count(*) = 1 then '' else 's' end,
                  ' overdue for LAWMA weekly pickup'
                )
              else
                concat(
                  count(*),
                  ' commercial customer',
                  case when count(*) = 1 then '' else 's' end,
                  ' overdue for agreed collection frequency'
                )
            end as alert_text,
            case when sla_bucket = 'residential' then 1 else 2 end as sort_key,
            operation_date::timestamptz as sort_ts
          from overdue
          group by sla_bucket
        ),
        make_good_alerts as (
          select
            concat(
              open_make_good_count,
              ' missed collection',
              case when open_make_good_count = 1 then '' else 's' end,
              ' awaiting make-good'
            ) as alert_text,
            3 as sort_key,
            operation_date::timestamptz as sort_ts
          where open_make_good_count > 0
          union all
          select
            concat(
              overdue_make_good_count,
              ' make-good',
              case when overdue_make_good_count = 1 then '' else 's' end,
              ' past frequency SLA window'
            ) as alert_text,
            4 as sort_key,
            operation_date::timestamptz as sort_ts
          where overdue_make_good_count > 0
          union all
          select
            concat(
              stale_route_count,
              ' incomplete route',
              case when stale_route_count = 1 then '' else 's' end,
              ' from prior days need supervisor close'
            ) as alert_text,
            5 as sort_key,
            operation_date::timestamptz as sort_ts
          where stale_route_count > 0
        )
        select coalesce(
          (
            select jsonb_agg(alert_text order by sort_key, sort_ts desc)
            from (
              select * from incident_alerts
              union all
              select * from sla_alerts
              union all
              select * from make_good_alerts
            ) combined
          ),
          '[]'::jsonb
        )
      )
  );
end;
$$;

create or replace function public.get_resident_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_customer_id uuid := public.current_customer_id();
  v_tenant_id uuid := public.current_operator_id();
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if public.current_app_role() is distinct from 'resident' then
    raise exception 'Only residents can load the resident home';
  end if;

  if v_customer_id is null or v_tenant_id is null then
    raise exception 'Resident account is not linked to a customer';
  end if;

  with month_payments as (
    select coalesce(sum(payments.amount_kobo), 0)::int as paid_this_month_kobo
    from public.payments
    where payments.operator_id = v_tenant_id
      and payments.customer_id = v_customer_id
      and date_trunc('month', payments.paid_at) = date_trunc('month', timezone(public.operation_timezone(), now()))
  ),
  latest_payment as (
    select
      payments.paid_at,
      payments.amount_kobo,
      payments.channel
    from public.payments
    where payments.operator_id = v_tenant_id
      and payments.customer_id = v_customer_id
    order by payments.paid_at desc
    limit 1
  ),
  zone_trucks as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'registrationNumber', trucks.registration_number,
          'status', trucks.status
        )
        order by trucks.registration_number
      ),
      '[]'::jsonb
    ) as trucks
    from public.trucks
    join public.customers on customers.zone_id = trucks.zone_id
    where customers.id = v_customer_id
      and trucks.operator_id = v_tenant_id
      and trucks.active
  ),
  active_make_good as (
    select
      true as active,
      mg.source_date,
      mg.target_date,
      mg.due_by,
      mg.status
    from public.collection_make_goods mg
    where mg.customer_id = v_customer_id
      and mg.operator_id = v_tenant_id
      and mg.status in ('open', 'scheduled')
    order by mg.target_date asc, mg.opened_at desc
    limit 1
  )
  select jsonb_build_object(
    'customerId', customers.id,
    'displayName', customers.display_name,
    'address', customers.address,
    'phone', customers.phone,
    'email', customers.email,
    'customerType', customers.customer_type,
    'zoneName', zones.name,
    'serviceStatus', customers.service_status,
    'suspensionReason', customers.suspension_reason,
    'collectionsPerWeek', customers.collections_per_week,
    'preferredWeekdays', to_jsonb(customers.preferred_weekdays),
    'frequencyNotes', customers.frequency_notes,
    'monthlyRateKobo', customers.monthly_rate_kobo,
    'paidThisMonthKobo', month_payments.paid_this_month_kobo,
    'outstandingKobo', greatest(
      customers.monthly_rate_kobo - month_payments.paid_this_month_kobo,
      0
    ),
    'lastPaymentAt', latest_payment.paid_at,
    'lastPaymentAmountKobo', latest_payment.amount_kobo,
    'lastPaymentChannel', latest_payment.channel,
    'psp', jsonb_build_object(
      'operatorName', operators.name,
      'brandName', operators.brand_name,
      'primaryContactPhone', operators.primary_contact_phone,
      'lawmaReference', operators.lawma_reference,
      'timezone', operators.timezone
    ),
    'zoneTrucks', zone_trucks.trucks,
    'makeGood', case
      when active_make_good.active then jsonb_build_object(
        'active', true,
        'sourceDate', active_make_good.source_date,
        'targetDate', active_make_good.target_date,
        'dueBy', active_make_good.due_by,
        'status', active_make_good.status
      )
      else null
    end
  )
  into result
  from public.customers
  join public.zones on zones.id = customers.zone_id
  join public.operators on operators.id = customers.operator_id
  cross join month_payments
  cross join zone_trucks
  left join latest_payment on true
  left join active_make_good on true
  where customers.id = v_customer_id
    and customers.operator_id = v_tenant_id;

  if result is null then
    raise exception 'Resident customer record not found';
  end if;

  return result;
end;
$$;

grant execute on function public.enqueue_resident_notification(uuid, uuid, uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.register_resident_push_device(text, text, text, text) to authenticated;
grant execute on function public.unregister_resident_push_device(text) to authenticated;
grant execute on function public.list_my_resident_notifications(integer) to authenticated;
grant execute on function public.mark_resident_notification_read(uuid) to authenticated;
grant execute on function public.claim_notification_outbox(integer) to service_role;
grant execute on function public.complete_notification_outbox(uuid, boolean, text, text, uuid[]) to service_role;
grant execute on function public.finalize_route_with_unserviced(uuid, text) to authenticated;
grant execute on function public.resolve_linked_make_goods(uuid) to authenticated;
grant execute on function public.enqueue_collection_make_good(uuid) to authenticated;
grant execute on function public.clear_collection_make_good(uuid, uuid) to authenticated;
grant execute on function public.plan_daily_routes(date) to authenticated;
grant execute on function public.operator_dashboard_snapshot(date) to authenticated;
grant execute on function public.get_resident_home() to authenticated;
grant execute on function public.update_route_stop_status(uuid, public.route_stop_status, text, text) to authenticated;
