-- Item 5 Comms: WhatsApp (Twilio) reminders / receipts / suspension notices
-- with Termii SMS fallback. Extends notification outbox + operator RPCs.

-- ---------------------------------------------------------------------------
-- 1. Expand notification kinds + outbox channels
-- ---------------------------------------------------------------------------

alter table public.resident_notifications
  drop constraint if exists resident_notifications_kind_check;

alter table public.resident_notifications
  add constraint resident_notifications_kind_check
  check (
    kind in (
      'unserviced_recovery',
      'recovery_resolved',
      'payment_reminder',
      'payment_receipt',
      'suspension_notice'
    )
  );

alter table public.notification_outbox
  drop constraint if exists notification_outbox_channel_check;

alter table public.notification_outbox
  add constraint notification_outbox_channel_check
  check (channel in ('expo_push', 'whatsapp', 'sms'));

create index if not exists notification_outbox_comms_claim_idx
  on public.notification_outbox (status, next_attempt_at)
  where status in ('queued', 'failed')
    and channel in ('whatsapp', 'sms');

-- ---------------------------------------------------------------------------
-- 2. Phone normalize + enqueue messaging (WhatsApp preferred, SMS fallback)
-- ---------------------------------------------------------------------------

create or replace function public.normalize_ng_phone(input_phone text)
returns text
language plpgsql
immutable
as $$
declare
  digits text;
begin
  digits := regexp_replace(coalesce(input_phone, ''), '[^0-9]', '', 'g');
  if digits = '' then
    return null;
  end if;

  if left(digits, 1) = '0' and length(digits) = 11 then
    digits := concat('234', substr(digits, 2));
  elsif left(digits, 3) <> '234' and length(digits) = 10 then
    digits := concat('234', digits);
  end if;

  if left(digits, 3) <> '234' or length(digits) < 12 or length(digits) > 14 then
    return null;
  end if;

  return concat('+', digits);
end;
$$;

create or replace function public.enqueue_resident_comms(
  input_operator_id uuid,
  input_customer_id uuid,
  input_kind text,
  input_title text,
  input_body text,
  input_payload jsonb default '{}'::jsonb,
  input_dedupe_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  notification_id uuid;
  outbox_id uuid;
  customer_phone text;
  e164 text;
  dedupe text;
begin
  if input_kind not in ('payment_reminder', 'payment_receipt', 'suspension_notice') then
    raise exception 'Unsupported comms kind: %', input_kind;
  end if;

  select customers.phone
  into customer_phone
  from public.customers
  where customers.id = input_customer_id
    and customers.operator_id = input_operator_id;

  if not found then
    raise exception 'Customer not found for comms enqueue';
  end if;

  e164 := public.normalize_ng_phone(customer_phone);
  if e164 is null then
    return null;
  end if;

  dedupe := coalesce(
    nullif(trim(input_dedupe_key), ''),
    concat(input_kind, ':', input_customer_id::text, ':', gen_random_uuid()::text)
  );

  -- Prefer WhatsApp; dispatcher falls back to Termii SMS when Twilio is unavailable/fails.
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
    null,
    input_kind,
    input_title,
    input_body,
    coalesce(input_payload, '{}'::jsonb) || jsonb_build_object('phoneE164', e164),
    'unread'
  )
  returning id into notification_id;

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
    'whatsapp',
    dedupe,
    jsonb_build_object(
      'notificationId', notification_id,
      'kind', input_kind,
      'title', input_title,
      'body', input_body,
      'phoneE164', e164,
      'fallbackChannel', 'sms',
      'data', coalesce(input_payload, '{}'::jsonb)
    ),
    'queued'
  )
  on conflict (dedupe_key) do nothing
  returning id into outbox_id;

  if outbox_id is null then
    delete from public.resident_notifications where id = notification_id;
    return null;
  end if;

  return notification_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Reminder candidates + queue
-- ---------------------------------------------------------------------------

create or replace function public.payment_reminder_due_date(input_as_of date default current_date)
returns date
language sql
immutable
as $$
  select (date_trunc('month', input_as_of)::date + interval '1 month - 1 day')::date;
$$;

create or replace function public.preview_payment_reminder_candidates(
  input_days_before_due integer,
  input_as_of date default current_date
)
returns jsonb
language plpgsql
stable
security invoker
as $$
declare
  tenant_id uuid := public.current_operator_id();
  due_date date := public.payment_reminder_due_date(input_as_of);
  target_date date;
begin
  if public.current_app_role() not in ('operator_owner', 'operations_supervisor', 'platform_admin') then
    raise exception 'Comms preview is not permitted for this role';
  end if;

  if input_days_before_due not in (2, 5) then
    raise exception 'daysBeforeDue must be 2 or 5';
  end if;

  target_date := due_date - input_days_before_due;

  return jsonb_build_object(
    'asOf', input_as_of,
    'dueDate', due_date,
    'daysBeforeDue', input_days_before_due,
    'targetDate', target_date,
    'windowMatchesToday', target_date = input_as_of,
    'candidates', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'customerId', c.id,
            'customerName', c.display_name,
            'wardName', z.name,
            'phone', c.phone,
            'phoneE164', public.normalize_ng_phone(c.phone),
            'monthlyRateKobo', c.monthly_rate_kobo,
            'paidThisMonthKobo', coalesce(paid.paid_this_month_kobo, 0),
            'outstandingKobo', greatest(c.monthly_rate_kobo - coalesce(paid.paid_this_month_kobo, 0), 0),
            'serviceStatus', c.service_status
          )
          order by c.display_name
        )
        from public.customers c
        join public.zones z on z.id = c.zone_id
        left join lateral (
          select coalesce(sum(p.amount_kobo), 0)::int as paid_this_month_kobo
          from public.payments p
          where p.operator_id = c.operator_id
            and p.customer_id = c.id
            and date_trunc('month', p.paid_at) = date_trunc('month', input_as_of::timestamptz)
        ) paid on true
        where c.operator_id = tenant_id
          and c.service_status = 'active'
          and nullif(trim(c.phone), '') is not null
          and public.normalize_ng_phone(c.phone) is not null
          and greatest(c.monthly_rate_kobo - coalesce(paid.paid_this_month_kobo, 0), 0) > 0
      ),
      '[]'::jsonb
    )
  );
end;
$$;

create or replace function public.queue_payment_reminders(
  input_days_before_due integer,
  input_force boolean default false,
  input_as_of date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_id uuid;
  preview jsonb;
  due_date date;
  target_date date;
  candidate jsonb;
  queued_count integer := 0;
  skipped_count integer := 0;
  notification_id uuid;
  title text;
  body text;
  month_label text;
begin
  if public.current_app_role() not in ('operator_owner', 'operations_supervisor', 'platform_admin') then
    raise exception 'Queueing reminders is not permitted for this role';
  end if;

  tenant_id := public.current_operator_id();
  preview := public.preview_payment_reminder_candidates(input_days_before_due, input_as_of);
  due_date := (preview->>'dueDate')::date;
  target_date := (preview->>'targetDate')::date;

  if not input_force and target_date is distinct from input_as_of then
    return jsonb_build_object(
      'queued', 0,
      'skipped', 0,
      'dueDate', due_date,
      'targetDate', target_date,
      'windowMatchesToday', false,
      'message', format(
        'Reminder window for %s-day notices is %s (due %s). Pass force=true to queue anyway.',
        input_days_before_due,
        target_date,
        due_date
      )
    );
  end if;

  month_label := to_char(input_as_of, 'FMMonth YYYY');

  for candidate in
    select value
    from jsonb_array_elements(preview->'candidates')
  loop
    title := format('Payment reminder — %s days before due', input_days_before_due);
    body := format(
      'Hi %s, your CleanOps waste collection tag for %s has ₦%s outstanding. Please pay by %s to keep service active.',
      candidate->>'customerName',
      month_label,
      to_char(((candidate->>'outstandingKobo')::numeric / 100), 'FM999,999,999'),
      to_char(due_date, 'DD Mon YYYY')
    );

    notification_id := public.enqueue_resident_comms(
      tenant_id,
      (candidate->>'customerId')::uuid,
      'payment_reminder',
      title,
      body,
      jsonb_build_object(
        'daysBeforeDue', input_days_before_due,
        'dueDate', due_date,
        'outstandingKobo', (candidate->>'outstandingKobo')::int
      ),
      concat(
        'payment_reminder:',
        candidate->>'customerId',
        ':',
        due_date::text,
        ':',
        input_days_before_due::text
      )
    );

    if notification_id is null then
      skipped_count := skipped_count + 1;
    else
      queued_count := queued_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'queued', queued_count,
    'skipped', skipped_count,
    'candidateCount', jsonb_array_length(preview->'candidates'),
    'dueDate', due_date,
    'targetDate', target_date,
    'windowMatchesToday', target_date = input_as_of,
    'daysBeforeDue', input_days_before_due
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Auto-enqueue receipts + suspension notices
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_payment_receipt_for_payment(input_payment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  payment_row record;
  title text;
  body text;
begin
  select
    p.id,
    p.operator_id,
    p.customer_id,
    p.amount_kobo,
    p.channel::text as channel,
    p.external_reference,
    p.paid_at,
    c.display_name
  into payment_row
  from public.payments p
  join public.customers c on c.id = p.customer_id
  where p.id = input_payment_id;

  if payment_row.id is null then
    return null;
  end if;

  title := 'Payment receipt';
  body := format(
    'Hi %s, we received ₦%s via %s on %s. Ref: %s. Thank you for keeping your CleanOps service current.',
    payment_row.display_name,
    to_char((payment_row.amount_kobo::numeric / 100), 'FM999,999,999'),
    replace(payment_row.channel, '_', ' '),
    to_char(payment_row.paid_at at time zone 'Africa/Lagos', 'DD Mon YYYY HH24:MI'),
    coalesce(nullif(payment_row.external_reference, ''), payment_row.id::text)
  );

  return public.enqueue_resident_comms(
    payment_row.operator_id,
    payment_row.customer_id,
    'payment_receipt',
    title,
    body,
    jsonb_build_object(
      'paymentId', payment_row.id,
      'amountKobo', payment_row.amount_kobo,
      'channel', payment_row.channel,
      'externalReference', payment_row.external_reference
    ),
    concat('payment_receipt:', payment_row.id::text)
  );
end;
$$;

create or replace function public.trg_enqueue_payment_receipt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enqueue_payment_receipt_for_payment(new.id);
  return new;
end;
$$;

drop trigger if exists payments_enqueue_receipt on public.payments;
create trigger payments_enqueue_receipt
  after insert on public.payments
  for each row
  execute function public.trg_enqueue_payment_receipt();

create or replace function public.trg_enqueue_suspension_notice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  title text;
  body text;
  reason text;
begin
  if new.service_status is distinct from 'suspended' then
    return new;
  end if;

  if old.service_status is not distinct from 'suspended' then
    return new;
  end if;

  reason := coalesce(nullif(trim(new.suspension_reason), ''), 'Suspended by operator');
  title := 'Service suspended';
  body := format(
    'Hi %s, your CleanOps waste collection service has been suspended. Reason: %s. Pay your outstanding tag to restore collection.',
    new.display_name,
    reason
  );

  perform public.enqueue_resident_comms(
    new.operator_id,
    new.id,
    'suspension_notice',
    title,
    body,
    jsonb_build_object(
      'suspensionReason', reason,
      'previousStatus', old.service_status
    ),
    concat(
      'suspension_notice:',
      new.id::text,
      ':',
      to_char(timezone('utc', now()), 'YYYY-MM-DD"T"HH24:MI')
    )
  );

  return new;
end;
$$;

drop trigger if exists customers_enqueue_suspension_notice on public.customers;
create trigger customers_enqueue_suspension_notice
  after update of service_status on public.customers
  for each row
  execute function public.trg_enqueue_suspension_notice();

-- ---------------------------------------------------------------------------
-- 5. Claim helpers (push stays expo-only; comms uses messaging channels)
-- ---------------------------------------------------------------------------

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
      and channel = 'expo_push'
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
        'channel', updated.channel,
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

create or replace function public.claim_comms_outbox(input_limit integer default 50)
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
      and channel in ('whatsapp', 'sms')
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
        'channel', updated.channel,
        'payload', updated.payload,
        'attemptCount', updated.attempt_count,
        'phoneE164', updated.payload->>'phoneE164',
        'fallbackChannel', coalesce(updated.payload->>'fallbackChannel', 'sms')
      )
    ),
    '[]'::jsonb
  )
  into claimed
  from updated;

  return coalesce(claimed, '[]'::jsonb);
end;
$$;

create or replace function public.complete_comms_outbox(
  input_outbox_id uuid,
  input_success boolean,
  input_channel_used text default null,
  input_provider_ticket_id text default null,
  input_error text default null
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
    channel = coalesce(nullif(input_channel_used, ''), channel),
    provider_ticket_id = coalesce(input_provider_ticket_id, provider_ticket_id),
    last_error = case when input_success then null else coalesce(input_error, last_error) end,
    next_attempt_at = case
      when input_success then next_attempt_at
      else now() + make_interval(mins => least(attempt_count * 5, 60))
    end,
    updated_at = now(),
    payload = case
      when input_channel_used is null then payload
      else payload || jsonb_build_object('channelUsed', input_channel_used)
    end
  where id = input_outbox_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Operator Comms board snapshot
-- ---------------------------------------------------------------------------

create or replace function public.operator_comms_snapshot(input_limit integer default 50)
returns jsonb
language plpgsql
stable
security invoker
as $$
declare
  tenant_id uuid := public.current_operator_id();
  lim integer := least(greatest(coalesce(input_limit, 50), 1), 200);
begin
  if public.current_app_role() not in ('operator_owner', 'operations_supervisor', 'platform_admin') then
    raise exception 'Comms snapshot is not permitted for this role';
  end if;

  return jsonb_build_object(
    'metrics', jsonb_build_object(
      'queued', (
        select count(*)::int
        from public.notification_outbox o
        where o.operator_id = tenant_id
          and o.channel in ('whatsapp', 'sms')
          and o.status in ('queued', 'processing')
      ),
      'sentToday', (
        select count(*)::int
        from public.notification_outbox o
        where o.operator_id = tenant_id
          and o.channel in ('whatsapp', 'sms')
          and o.status = 'sent'
          and o.updated_at::date = (timezone('Africa/Lagos', now()))::date
      ),
      'failed', (
        select count(*)::int
        from public.notification_outbox o
        where o.operator_id = tenant_id
          and o.channel in ('whatsapp', 'sms')
          and o.status = 'failed'
      ),
      'remindersQueued', (
        select count(*)::int
        from public.notification_outbox o
        join public.resident_notifications n on n.id = o.notification_id
        where o.operator_id = tenant_id
          and o.channel in ('whatsapp', 'sms')
          and o.status in ('queued', 'processing', 'failed')
          and n.kind = 'payment_reminder'
      )
    ),
    'reminderPreview5', public.preview_payment_reminder_candidates(5),
    'reminderPreview2', public.preview_payment_reminder_candidates(2),
    'recent', coalesce(
      (
        select jsonb_agg(row_data order by created_at desc)
        from (
          select
            jsonb_build_object(
              'id', o.id,
              'notificationId', o.notification_id,
              'customerId', o.customer_id,
              'customerName', c.display_name,
              'wardName', z.name,
              'kind', n.kind,
              'channel', o.channel,
              'channelUsed', o.payload->>'channelUsed',
              'status', o.status,
              'title', n.title,
              'body', n.body,
              'phoneE164', o.payload->>'phoneE164',
              'attemptCount', o.attempt_count,
              'lastError', o.last_error,
              'providerTicketId', o.provider_ticket_id,
              'createdAt', o.created_at,
              'updatedAt', o.updated_at
            ) as row_data,
            o.created_at
          from public.notification_outbox o
          join public.customers c on c.id = o.customer_id
          left join public.zones z on z.id = c.zone_id
          left join public.resident_notifications n on n.id = o.notification_id
          where o.operator_id = tenant_id
            and o.channel in ('whatsapp', 'sms')
          order by o.created_at desc
          limit lim
        ) recent_rows
      ),
      '[]'::jsonb
    )
  );
end;
$$;

create or replace function public.queue_payment_reminders_for_operator(
  input_operator_id uuid,
  input_days_before_due integer,
  input_force boolean default false,
  input_as_of date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  preview jsonb;
  due_date date;
  target_date date;
  candidate jsonb;
  queued_count integer := 0;
  skipped_count integer := 0;
  notification_id uuid;
  title text;
  body text;
  month_label text;
begin
  if input_days_before_due not in (2, 5) then
    raise exception 'daysBeforeDue must be 2 or 5';
  end if;

  due_date := public.payment_reminder_due_date(input_as_of);
  target_date := due_date - input_days_before_due;

  if not input_force and target_date is distinct from input_as_of then
    return jsonb_build_object(
      'queued', 0,
      'skipped', 0,
      'dueDate', due_date,
      'targetDate', target_date,
      'windowMatchesToday', false,
      'message', format(
        'Reminder window for %s-day notices is %s (due %s). Pass force=true to queue anyway.',
        input_days_before_due,
        target_date,
        due_date
      )
    );
  end if;

  select jsonb_build_object(
    'candidates', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'customerId', c.id,
            'customerName', c.display_name,
            'outstandingKobo', greatest(c.monthly_rate_kobo - coalesce(paid.paid_this_month_kobo, 0), 0)
          )
          order by c.display_name
        )
        from public.customers c
        left join lateral (
          select coalesce(sum(p.amount_kobo), 0)::int as paid_this_month_kobo
          from public.payments p
          where p.operator_id = c.operator_id
            and p.customer_id = c.id
            and date_trunc('month', p.paid_at) = date_trunc('month', input_as_of::timestamptz)
        ) paid on true
        where c.operator_id = input_operator_id
          and c.service_status = 'active'
          and nullif(trim(c.phone), '') is not null
          and public.normalize_ng_phone(c.phone) is not null
          and greatest(c.monthly_rate_kobo - coalesce(paid.paid_this_month_kobo, 0), 0) > 0
      ),
      '[]'::jsonb
    )
  )
  into preview;

  month_label := to_char(input_as_of, 'FMMonth YYYY');

  for candidate in
    select value
    from jsonb_array_elements(preview->'candidates')
  loop
    title := format('Payment reminder — %s days before due', input_days_before_due);
    body := format(
      'Hi %s, your CleanOps waste collection tag for %s has ₦%s outstanding. Please pay by %s to keep service active.',
      candidate->>'customerName',
      month_label,
      to_char(((candidate->>'outstandingKobo')::numeric / 100), 'FM999,999,999'),
      to_char(due_date, 'DD Mon YYYY')
    );

    notification_id := public.enqueue_resident_comms(
      input_operator_id,
      (candidate->>'customerId')::uuid,
      'payment_reminder',
      title,
      body,
      jsonb_build_object(
        'daysBeforeDue', input_days_before_due,
        'dueDate', due_date,
        'outstandingKobo', (candidate->>'outstandingKobo')::int
      ),
      concat(
        'payment_reminder:',
        candidate->>'customerId',
        ':',
        due_date::text,
        ':',
        input_days_before_due::text
      )
    );

    if notification_id is null then
      skipped_count := skipped_count + 1;
    else
      queued_count := queued_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'queued', queued_count,
    'skipped', skipped_count,
    'candidateCount', jsonb_array_length(preview->'candidates'),
    'dueDate', due_date,
    'targetDate', target_date,
    'windowMatchesToday', target_date = input_as_of,
    'daysBeforeDue', input_days_before_due
  );
end;
$$;

grant execute on function public.normalize_ng_phone(text) to authenticated;
revoke all on function public.enqueue_resident_comms(uuid, uuid, text, text, text, jsonb, text) from public;
revoke all on function public.enqueue_resident_comms(uuid, uuid, text, text, text, jsonb, text) from anon;
revoke all on function public.enqueue_resident_comms(uuid, uuid, text, text, text, jsonb, text) from authenticated;
grant execute on function public.payment_reminder_due_date(date) to authenticated;
grant execute on function public.preview_payment_reminder_candidates(integer, date) to authenticated;
grant execute on function public.queue_payment_reminders(integer, boolean, date) to authenticated;
grant execute on function public.operator_comms_snapshot(integer) to authenticated;

revoke all on function public.queue_payment_reminders_for_operator(uuid, integer, boolean, date) from public;
revoke all on function public.queue_payment_reminders_for_operator(uuid, integer, boolean, date) from anon;
revoke all on function public.queue_payment_reminders_for_operator(uuid, integer, boolean, date) from authenticated;
grant execute on function public.queue_payment_reminders_for_operator(uuid, integer, boolean, date) to service_role;

grant execute on function public.claim_comms_outbox(integer) to service_role;
grant execute on function public.complete_comms_outbox(uuid, boolean, text, text, text) to service_role;
grant execute on function public.enqueue_payment_receipt_for_payment(uuid) to service_role;
