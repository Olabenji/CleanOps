-- Resident messaging consent, structured WhatsApp template variables, and NGN wording.
--
-- Meta Utility templates. Variable order matches migration 0075.
-- payment_reminder (name, period, amount, due date):
-- Hi {{1}}, your CleanOps waste collection tag for {{2}} has NGN {{3}} outstanding. Please pay by {{4}} to keep service active.
-- payment_receipt (name, amount, method, date, reference):
-- Hi {{1}}, we received NGN {{2}} via {{3}} on {{4}}. Ref: {{5}}. Thank you for keeping your CleanOps service current.
-- suspension_notice (name, reason):
-- Hi {{1}}, your CleanOps waste collection service has been suspended. Reason: {{2}}. Pay your outstanding tag to restore collection.

create table if not exists public.resident_message_consent (
  customer_id uuid not null references public.customers(id) on delete cascade,
  operator_id uuid not null references public.operators(id) on delete cascade,
  channel text not null,
  granted boolean not null,
  source text not null,
  decided_at timestamptz not null default now(),
  recorded_by uuid references public.profiles(id) on delete set null,
  primary key (customer_id, channel),
  constraint resident_message_consent_channel_check check (channel in ('whatsapp', 'sms')),
  constraint resident_message_consent_source_check check (source in ('operator_dashboard', 'resident_app'))
);

comment on table public.resident_message_consent is
  'Per-resident opt-in for WhatsApp and SMS service notices. Sign-in OTP is not covered.';

create index if not exists resident_message_consent_operator_id_idx
  on public.resident_message_consent (operator_id);

create index if not exists resident_message_consent_recorded_by_idx
  on public.resident_message_consent (recorded_by);

alter table public.resident_message_consent enable row level security;

drop policy if exists "managers read resident message consent" on public.resident_message_consent;
create policy "managers read resident message consent"
  on public.resident_message_consent for select
  using (
    operator_id = public.current_operator_id()
    and public.current_app_role() in ('operator_owner', 'operations_supervisor', 'platform_admin')
  );

drop policy if exists "residents read own message consent" on public.resident_message_consent;
create policy "residents read own message consent"
  on public.resident_message_consent for select
  using (customer_id = public.current_customer_id());

revoke insert, update, delete on public.resident_message_consent from anon, authenticated;

create or replace function public.record_resident_message_consent(
  input_operator_id uuid,
  input_customer_id uuid,
  input_channel text,
  input_granted boolean,
  input_source text,
  input_recorded_by uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if input_channel not in ('whatsapp', 'sms') then
    raise exception 'Channel must be whatsapp or sms';
  end if;

  if input_source not in ('operator_dashboard', 'resident_app') then
    raise exception 'Unsupported consent source';
  end if;

  if not exists (
    select 1
    from public.customers
    where id = input_customer_id
      and operator_id = input_operator_id
  ) then
    raise exception 'Customer not found';
  end if;

  insert into public.resident_message_consent (
    customer_id,
    operator_id,
    channel,
    granted,
    source,
    decided_at,
    recorded_by
  )
  values (
    input_customer_id,
    input_operator_id,
    input_channel,
    input_granted,
    input_source,
    now(),
    input_recorded_by
  )
  on conflict (customer_id, channel) do update
  set
    operator_id = excluded.operator_id,
    granted = excluded.granted,
    source = excluded.source,
    decided_at = now(),
    recorded_by = excluded.recorded_by
  where public.resident_message_consent.granted is distinct from excluded.granted;
end;
$$;

revoke all on function public.record_resident_message_consent(uuid, uuid, text, boolean, text, uuid) from public;
revoke all on function public.record_resident_message_consent(uuid, uuid, text, boolean, text, uuid) from anon;
revoke all on function public.record_resident_message_consent(uuid, uuid, text, boolean, text, uuid) from authenticated;
grant execute on function public.record_resident_message_consent(uuid, uuid, text, boolean, text, uuid) to service_role;

create or replace function public.set_my_resident_message_consent(
  input_channel text,
  input_granted boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid := public.current_customer_id();
  v_operator_id uuid := public.current_operator_id();
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if public.current_app_role() is distinct from 'resident' then
    raise exception 'Only residents can update their message consent';
  end if;

  if v_customer_id is null or v_operator_id is null then
    raise exception 'Resident account is not linked to a customer';
  end if;

  if input_channel not in ('whatsapp', 'sms') then
    raise exception 'Channel must be whatsapp or sms';
  end if;

  perform public.record_resident_message_consent(
    v_operator_id,
    v_customer_id,
    input_channel,
    coalesce(input_granted, false),
    'resident_app',
    auth.uid()
  );
end;
$$;

revoke all on function public.set_my_resident_message_consent(text, boolean) from public;
revoke all on function public.set_my_resident_message_consent(text, boolean) from anon;
grant execute on function public.set_my_resident_message_consent(text, boolean) to authenticated;

create or replace function public.comms_caller_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tenant_id uuid := public.current_operator_id();
  app_role public.app_role := public.current_app_role();
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if app_role not in ('operator_owner', 'operations_supervisor', 'platform_admin') then
    raise exception 'Comms is not permitted for this role';
  end if;

  if tenant_id is null then
    raise exception 'Operator context is required';
  end if;

  return jsonb_build_object(
    'operatorId', tenant_id,
    'role', app_role
  );
end;
$$;

revoke all on function public.comms_caller_context() from public;
revoke all on function public.comms_caller_context() from anon;
grant execute on function public.comms_caller_context() to authenticated;

create or replace function public.format_kobo_amount(input_kobo integer)
returns text
language sql
immutable
set search_path = public
as $$
  select to_char((coalesce(input_kobo, 0)::numeric / 100), 'FM999,999,999');
$$;

create or replace function public.payment_reminder_template_variables(
  input_customer_name text,
  input_as_of date,
  input_outstanding_kobo integer,
  input_due_date date
)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_array(
    coalesce(input_customer_name, ''),
    to_char(input_as_of, 'FMMonth YYYY'),
    public.format_kobo_amount(input_outstanding_kobo),
    to_char(input_due_date, 'DD Mon YYYY')
  );
$$;

create or replace function public.payment_receipt_template_variables(
  input_customer_name text,
  input_amount_kobo integer,
  input_channel text,
  input_paid_at timestamptz,
  input_reference text
)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_array(
    coalesce(input_customer_name, ''),
    public.format_kobo_amount(input_amount_kobo),
    replace(coalesce(input_channel, ''), '_', ' '),
    to_char(input_paid_at at time zone 'Africa/Lagos', 'DD Mon YYYY HH24:MI'),
    coalesce(input_reference, '')
  );
$$;

create or replace function public.suspension_notice_template_variables(
  input_customer_name text,
  input_reason text
)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_array(
    coalesce(input_customer_name, ''),
    coalesce(input_reason, '')
  );
$$;

create or replace function public.render_resident_comms_body(
  input_kind text,
  input_variables jsonb
)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  vars text[] := array(
    select jsonb_array_elements_text(coalesce(input_variables, '[]'::jsonb))
  );
begin
  if input_kind = 'payment_reminder' then
    return format(
      'Hi %s, your CleanOps waste collection tag for %s has NGN %s outstanding. Please pay by %s to keep service active.',
      coalesce(vars[1], ''),
      coalesce(vars[2], ''),
      coalesce(vars[3], ''),
      coalesce(vars[4], '')
    );
  elsif input_kind = 'payment_receipt' then
    return format(
      'Hi %s, we received NGN %s via %s on %s. Ref: %s. Thank you for keeping your CleanOps service current.',
      coalesce(vars[1], ''),
      coalesce(vars[2], ''),
      coalesce(vars[3], ''),
      coalesce(vars[4], ''),
      coalesce(vars[5], '')
    );
  elsif input_kind = 'suspension_notice' then
    return format(
      'Hi %s, your CleanOps waste collection service has been suspended. Reason: %s. Pay your outstanding tag to restore collection.',
      coalesce(vars[1], ''),
      coalesce(vars[2], '')
    );
  end if;

  return null;
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
  template_variables jsonb := '[]'::jsonb;
  message_body text;
  whatsapp_granted boolean;
  sms_granted boolean;
  out_channel text;
  out_fallback text;
  out_status text;
  out_error text;
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

  if jsonb_typeof(coalesce(input_payload, '{}'::jsonb)->'templateVariables') = 'array' then
    template_variables := input_payload->'templateVariables';
  end if;

  if jsonb_array_length(template_variables) > 0 then
    message_body := public.render_resident_comms_body(input_kind, template_variables);
  end if;
  message_body := coalesce(message_body, input_body);

  dedupe := coalesce(
    nullif(trim(input_dedupe_key), ''),
    concat(input_kind, ':', input_customer_id::text, ':', gen_random_uuid()::text)
  );

  select exists (
    select 1
    from public.resident_message_consent consent
    where consent.customer_id = input_customer_id
      and consent.channel = 'whatsapp'
      and consent.granted
  )
  into whatsapp_granted;

  select exists (
    select 1
    from public.resident_message_consent consent
    where consent.customer_id = input_customer_id
      and consent.channel = 'sms'
      and consent.granted
  )
  into sms_granted;

  if whatsapp_granted and sms_granted then
    out_channel := 'whatsapp';
    out_fallback := 'sms';
    out_status := 'queued';
    out_error := null;
  elsif whatsapp_granted then
    out_channel := 'whatsapp';
    out_fallback := null;
    out_status := 'queued';
    out_error := null;
  elsif sms_granted then
    out_channel := 'sms';
    out_fallback := null;
    out_status := 'queued';
    out_error := null;
  else
    out_channel := 'whatsapp';
    out_fallback := null;
    out_status := 'cancelled';
    out_error := 'skipped: no consent for whatsapp or sms';
    dedupe := concat(dedupe, ':no-consent');
  end if;

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
    message_body,
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
    status,
    last_error
  )
  values (
    input_operator_id,
    input_customer_id,
    notification_id,
    out_channel,
    dedupe,
    jsonb_build_object(
      'notificationId', notification_id,
      'kind', input_kind,
      'title', input_title,
      'body', message_body,
      'phoneE164', e164,
      'fallbackChannel', out_fallback,
      'template', jsonb_build_object(
        'name', input_kind,
        'variables', template_variables
      ),
      'data', coalesce(input_payload, '{}'::jsonb) - 'templateVariables'
    ),
    out_status,
    out_error
  )
  on conflict (dedupe_key) do nothing
  returning id into outbox_id;

  if outbox_id is null then
    delete from public.resident_notifications where id = notification_id;
    return null;
  end if;

  if out_status = 'cancelled' then
    return null;
  end if;

  return notification_id;
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

  for candidate in
    select value
    from jsonb_array_elements(preview->'candidates')
  loop
    title := format('Payment reminder — %s days before due', input_days_before_due);
    notification_id := public.enqueue_resident_comms(
      tenant_id,
      (candidate->>'customerId')::uuid,
      'payment_reminder',
      title,
      '',
      jsonb_build_object(
        'daysBeforeDue', input_days_before_due,
        'dueDate', due_date,
        'outstandingKobo', (candidate->>'outstandingKobo')::int,
        'templateVariables', public.payment_reminder_template_variables(
          candidate->>'customerName',
          input_as_of,
          (candidate->>'outstandingKobo')::int,
          due_date
        )
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

  for candidate in
    select value
    from jsonb_array_elements(preview->'candidates')
  loop
    title := format('Payment reminder — %s days before due', input_days_before_due);
    notification_id := public.enqueue_resident_comms(
      input_operator_id,
      (candidate->>'customerId')::uuid,
      'payment_reminder',
      title,
      '',
      jsonb_build_object(
        'daysBeforeDue', input_days_before_due,
        'dueDate', due_date,
        'outstandingKobo', (candidate->>'outstandingKobo')::int,
        'templateVariables', public.payment_reminder_template_variables(
          candidate->>'customerName',
          input_as_of,
          (candidate->>'outstandingKobo')::int,
          due_date
        )
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

create or replace function public.enqueue_payment_receipt_for_payment(input_payment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  payment_row record;
  reference text;
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

  reference := coalesce(nullif(payment_row.external_reference, ''), payment_row.id::text);

  return public.enqueue_resident_comms(
    payment_row.operator_id,
    payment_row.customer_id,
    'payment_receipt',
    'Payment receipt',
    '',
    jsonb_build_object(
      'paymentId', payment_row.id,
      'amountKobo', payment_row.amount_kobo,
      'channel', payment_row.channel,
      'externalReference', payment_row.external_reference,
      'templateVariables', public.payment_receipt_template_variables(
        payment_row.display_name,
        payment_row.amount_kobo,
        payment_row.channel,
        payment_row.paid_at,
        reference
      )
    ),
    concat('payment_receipt:', payment_row.id::text)
  );
end;
$$;

create or replace function public.trg_enqueue_suspension_notice()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  reason text;
begin
  if new.service_status is distinct from 'suspended' then
    return new;
  end if;

  if old.service_status is not distinct from 'suspended' then
    return new;
  end if;

  reason := coalesce(nullif(trim(new.suspension_reason), ''), 'Suspended by operator');

  perform public.enqueue_resident_comms(
    new.operator_id,
    new.id,
    'suspension_notice',
    'Service suspended',
    '',
    jsonb_build_object(
      'suspensionReason', reason,
      'previousStatus', old.service_status,
      'templateVariables', public.suspension_notice_template_variables(new.display_name, reason)
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

drop function if exists public.claim_comms_outbox(integer);

create or replace function public.claim_comms_outbox(
  input_limit integer default 50,
  input_operator_id uuid default null
)
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
      and (input_operator_id is null or operator_id = input_operator_id)
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
        'fallbackChannel', updated.payload->>'fallbackChannel',
        'whatsappConsent', coalesce((
          select consent.granted
          from public.resident_message_consent consent
          where consent.customer_id = updated.customer_id
            and consent.channel = 'whatsapp'
        ), false),
        'smsConsent', coalesce((
          select consent.granted
          from public.resident_message_consent consent
          where consent.customer_id = updated.customer_id
            and consent.channel = 'sms'
        ), false)
      )
    ),
    '[]'::jsonb
  )
  into claimed
  from updated;

  return coalesce(claimed, '[]'::jsonb);
end;
$$;

drop function if exists public.complete_comms_outbox(uuid, boolean, text, text, text);

create or replace function public.complete_comms_outbox(
  input_outbox_id uuid,
  input_success boolean,
  input_channel_used text default null,
  input_provider_ticket_id text default null,
  input_error text default null,
  input_skip boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if input_skip then
    update public.notification_outbox
    set
      status = 'cancelled',
      last_error = coalesce(input_error, 'skipped'),
      updated_at = now(),
      payload = payload || jsonb_build_object('skipReason', coalesce(input_error, 'skipped'))
    where id = input_outbox_id;
    return;
  end if;

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

revoke all on function public.claim_comms_outbox(integer, uuid) from public;
revoke all on function public.claim_comms_outbox(integer, uuid) from anon;
revoke all on function public.claim_comms_outbox(integer, uuid) from authenticated;
grant execute on function public.claim_comms_outbox(integer, uuid) to service_role;

revoke all on function public.complete_comms_outbox(uuid, boolean, text, text, text, boolean) from public;
revoke all on function public.complete_comms_outbox(uuid, boolean, text, text, text, boolean) from anon;
revoke all on function public.complete_comms_outbox(uuid, boolean, text, text, text, boolean) from authenticated;
grant execute on function public.complete_comms_outbox(uuid, boolean, text, text, text, boolean) to service_role;

create or replace function public.admin_master_data()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'zones',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', zones.id,
            'name', zones.name,
            'description', zones.description
          )
          order by zones.name
        )
        from public.zones
        where zones.operator_id = public.current_operator_id()
      ), '[]'::jsonb),
    'staff',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', staff_members.id,
            'fullName', staff_members.full_name,
            'phone', staff_members.phone,
            'role', staff_members.role,
            'monthlySalaryKobo', staff_members.monthly_salary_kobo,
            'active', staff_members.active,
            'hasLoginProfile', staff_members.profile_id is not null,
            'loginEmail', staff_members.login_email,
            'licenceExpiresOn', staff_members.licence_expires_on,
            'licenceImageUrl', staff_members.licence_image_url
          )
          order by staff_members.active desc, staff_members.full_name
        )
        from public.staff_members
        where staff_members.operator_id = public.current_operator_id()
      ), '[]'::jsonb),
    'trucks',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', trucks.id,
            'zoneId', trucks.zone_id,
            'zoneName', zones.name,
            'registrationNumber', trucks.registration_number,
            'make', trucks.make,
            'model', trucks.model,
            'year', trucks.year,
            'status', trucks.status,
            'active', trucks.active
          )
          order by trucks.active desc, trucks.registration_number
        )
        from public.trucks
        left join public.zones on zones.id = trucks.zone_id
        where trucks.operator_id = public.current_operator_id()
      ), '[]'::jsonb),
    'customers',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', customers.id,
            'zoneId', customers.zone_id,
            'zoneName', zones.name,
            'displayName', customers.display_name,
            'phone', customers.phone,
            'email', customers.email,
            'address', customers.address,
            'customerType', customers.customer_type,
            'monthlyRateKobo', customers.monthly_rate_kobo,
            'serviceStatus', customers.service_status,
            'collectionsPerWeek', customers.collections_per_week,
            'preferredWeekdays', to_jsonb(customers.preferred_weekdays),
            'frequencyNotes', customers.frequency_notes,
            'hasLoginProfile', customers.profile_id is not null,
            'loginEmail', customers.email,
            'whatsappConsent', coalesce(consent.whatsapp_granted, false),
            'whatsappConsentAt', consent.whatsapp_decided_at,
            'whatsappConsentSource', consent.whatsapp_source,
            'smsConsent', coalesce(consent.sms_granted, false),
            'smsConsentAt', consent.sms_decided_at,
            'smsConsentSource', consent.sms_source
          )
          order by zones.name, customers.display_name
        )
        from public.customers
        join public.zones on zones.id = customers.zone_id
        left join lateral (
          select
            bool_or(channel = 'whatsapp' and granted) as whatsapp_granted,
            max(decided_at) filter (where channel = 'whatsapp') as whatsapp_decided_at,
            max(source) filter (where channel = 'whatsapp') as whatsapp_source,
            bool_or(channel = 'sms' and granted) as sms_granted,
            max(decided_at) filter (where channel = 'sms') as sms_decided_at,
            max(source) filter (where channel = 'sms') as sms_source
          from public.resident_message_consent consent_row
          where consent_row.customer_id = customers.id
        ) consent on true
        where customers.operator_id = public.current_operator_id()
      ), '[]'::jsonb)
  );
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
    'messageConsent', jsonb_build_object(
      'whatsapp', coalesce((
        select consent.granted
        from public.resident_message_consent consent
        where consent.customer_id = customers.id
          and consent.channel = 'whatsapp'
      ), false),
      'sms', coalesce((
        select consent.granted
        from public.resident_message_consent consent
        where consent.customer_id = customers.id
          and consent.channel = 'sms'
      ), false),
      'whatsappDecidedAt', (
        select consent.decided_at
        from public.resident_message_consent consent
        where consent.customer_id = customers.id
          and consent.channel = 'whatsapp'
      ),
      'smsDecidedAt', (
        select consent.decided_at
        from public.resident_message_consent consent
        where consent.customer_id = customers.id
          and consent.channel = 'sms'
      ),
      'whatsappSource', (
        select consent.source
        from public.resident_message_consent consent
        where consent.customer_id = customers.id
          and consent.channel = 'whatsapp'
      ),
      'smsSource', (
        select consent.source
        from public.resident_message_consent consent
        where consent.customer_id = customers.id
          and consent.channel = 'sms'
      )
    ),
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

drop function if exists public.onboard_customer(
  uuid, text, text, text, public.customer_type, integer, public.service_status, smallint, smallint[], text
);

create or replace function public.onboard_customer(
  input_zone_id uuid,
  input_display_name text,
  input_phone text,
  input_address text,
  input_customer_type public.customer_type,
  input_monthly_rate_kobo integer,
  input_service_status public.service_status default 'active',
  input_collections_per_week smallint default 1,
  input_preferred_weekdays smallint[] default array[1]::smallint[],
  input_frequency_notes text default null,
  input_whatsapp_consent boolean default null,
  input_sms_consent boolean default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_id uuid := public.assert_admin_master_data_allowed();
  new_id uuid;
  weekdays smallint[] := (
    select coalesce(array_agg(distinct d order by d), array[1]::smallint[])
    from unnest(coalesce(input_preferred_weekdays, array[1]::smallint[])) as d
    where d between 1 and 7
  );
  freq smallint := least(greatest(coalesce(input_collections_per_week, 1), 1), 7);
begin
  if not exists (select 1 from public.zones where id = input_zone_id and operator_id = tenant_id) then
    raise exception 'Zone not found';
  end if;

  if cardinality(weekdays) < 1 then
    raise exception 'Select at least one preferred collection weekday';
  end if;

  if input_phone is not null and trim(input_phone) != '' and exists (
    select 1 from public.customers
    where operator_id = tenant_id
      and phone = trim(input_phone)
  ) then
    raise exception 'A customer with this phone already exists';
  end if;

  insert into public.customers (
    operator_id,
    zone_id,
    display_name,
    phone,
    address,
    customer_type,
    monthly_rate_kobo,
    service_status,
    suspension_reason,
    current_tag_month,
    collections_per_week,
    preferred_weekdays,
    frequency_notes
  )
  values (
    tenant_id,
    input_zone_id,
    trim(input_display_name),
    nullif(trim(coalesce(input_phone, '')), ''),
    trim(input_address),
    input_customer_type,
    greatest(input_monthly_rate_kobo, 0),
    input_service_status,
    case
      when input_service_status = 'suspended' then 'Outstanding monthly balance unpaid'
      else null
    end,
    case when input_service_status = 'active' then date_trunc('month', current_date)::date else null end,
    freq,
    weekdays,
    nullif(trim(coalesce(input_frequency_notes, '')), '')
  )
  returning id into new_id;

  if input_whatsapp_consent is not null then
    perform public.record_resident_message_consent(
      tenant_id,
      new_id,
      'whatsapp',
      input_whatsapp_consent,
      'operator_dashboard',
      auth.uid()
    );
  end if;

  if input_sms_consent is not null then
    perform public.record_resident_message_consent(
      tenant_id,
      new_id,
      'sms',
      input_sms_consent,
      'operator_dashboard',
      auth.uid()
    );
  end if;

  return new_id;
end;
$$;

drop function if exists public.update_customer(
  uuid, uuid, text, text, text, public.customer_type, integer, smallint, smallint[], text
);

create or replace function public.update_customer(
  input_customer_id uuid,
  input_zone_id uuid,
  input_display_name text,
  input_phone text,
  input_address text,
  input_customer_type public.customer_type,
  input_monthly_rate_kobo integer,
  input_collections_per_week smallint default 1,
  input_preferred_weekdays smallint[] default array[1]::smallint[],
  input_frequency_notes text default null,
  input_whatsapp_consent boolean default null,
  input_sms_consent boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_id uuid := public.assert_admin_master_data_allowed();
  current_zone_id uuid;
  normalized_phone text := nullif(trim(coalesce(input_phone, '')), '');
  weekdays smallint[] := (
    select coalesce(array_agg(distinct d order by d), array[1]::smallint[])
    from unnest(coalesce(input_preferred_weekdays, array[1]::smallint[])) as d
    where d between 1 and 7
  );
  freq smallint := least(greatest(coalesce(input_collections_per_week, 1), 1), 7);
begin
  select zone_id
  into current_zone_id
  from public.customers
  where id = input_customer_id
    and operator_id = tenant_id;

  if current_zone_id is null then
    raise exception 'Customer not found';
  end if;

  if not exists (
    select 1 from public.zones where id = input_zone_id and operator_id = tenant_id
  ) then
    raise exception 'Zone not found';
  end if;

  if cardinality(weekdays) < 1 then
    raise exception 'Select at least one preferred collection weekday';
  end if;

  if normalized_phone is not null and exists (
    select 1
    from public.customers
    where operator_id = tenant_id
      and phone = normalized_phone
      and id <> input_customer_id
  ) then
    raise exception 'A customer with this phone already exists';
  end if;

  if input_zone_id <> current_zone_id then
    if exists (
      select 1
      from public.route_stops
      join public.routes on routes.id = route_stops.route_id
      where route_stops.customer_id = input_customer_id
        and routes.operator_id = tenant_id
        and routes.status = 'in_progress'
        and routes.zone_id <> input_zone_id
    ) then
      raise exception 'Cannot move customer while they are on an in-progress route. Finish or reassign the stop first.';
    end if;

    delete from public.route_stops
    using public.routes
    where route_stops.route_id = routes.id
      and route_stops.customer_id = input_customer_id
      and routes.operator_id = tenant_id
      and routes.zone_id <> input_zone_id
      and routes.status = 'scheduled';

    delete from public.route_template_stops
    using public.route_templates
    where route_template_stops.template_id = route_templates.id
      and route_template_stops.customer_id = input_customer_id
      and route_templates.operator_id = tenant_id
      and route_templates.zone_id <> input_zone_id;
  end if;

  update public.customers
  set
    zone_id = input_zone_id,
    display_name = trim(input_display_name),
    phone = normalized_phone,
    address = trim(input_address),
    customer_type = input_customer_type,
    monthly_rate_kobo = greatest(input_monthly_rate_kobo, 0),
    collections_per_week = freq,
    preferred_weekdays = weekdays,
    frequency_notes = nullif(trim(coalesce(input_frequency_notes, '')), '')
  where id = input_customer_id;

  if input_whatsapp_consent is not null then
    perform public.record_resident_message_consent(
      tenant_id,
      input_customer_id,
      'whatsapp',
      input_whatsapp_consent,
      'operator_dashboard',
      auth.uid()
    );
  end if;

  if input_sms_consent is not null then
    perform public.record_resident_message_consent(
      tenant_id,
      input_customer_id,
      'sms',
      input_sms_consent,
      'operator_dashboard',
      auth.uid()
    );
  end if;
end;
$$;

revoke all on function public.onboard_customer(
  uuid, text, text, text, public.customer_type, integer, public.service_status, smallint, smallint[], text, boolean, boolean
) from public;
grant execute on function public.onboard_customer(
  uuid, text, text, text, public.customer_type, integer, public.service_status, smallint, smallint[], text, boolean, boolean
) to authenticated, service_role;

revoke all on function public.update_customer(
  uuid, uuid, text, text, text, public.customer_type, integer, smallint, smallint[], text, boolean, boolean
) from public;
grant execute on function public.update_customer(
  uuid, uuid, text, text, text, public.customer_type, integer, smallint, smallint[], text, boolean, boolean
) to authenticated, service_role;
