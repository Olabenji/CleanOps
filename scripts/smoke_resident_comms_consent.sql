-- Consent filtering, NGN template variables, and comms caller role checks.
-- Rolled back so seed data and the outbox stay unchanged.
begin;

do $$
declare
  v_customer_id uuid := '00000000-0000-4000-8000-000000000401';
  other_customer uuid := '00000000-0000-4000-8000-000000000402';
  operator_id uuid := '00000000-0000-4000-8000-000000000001';
  owner_id uuid := '00000000-0000-4000-8000-000000000011';
  resident_id uuid := '00000000-0000-4000-8000-000000000041';
  driver_id uuid := '00000000-0000-4000-8000-000000000021';
  vars jsonb;
  body text;
  notification_id uuid;
  outbox_status text;
  outbox_error text;
  outbox_body text;
  outbox_channel text;
  fallback text;
  template_name text;
  first_variable text;
  variable_count integer;
  queued_id uuid;
  claimed jsonb;
  seen integer;
  context jsonb;
  consent_source text;
  consent_granted boolean;
begin
  vars := public.payment_reminder_template_variables(
    'Ada Obi',
    date '2026-10-08',
    500000,
    date '2026-10-31'
  );
  if vars->>0 is distinct from 'Ada Obi'
    or vars->>1 is distinct from to_char(date '2026-10-08', 'FMMonth YYYY')
    or vars->>2 is distinct from '5,000'
    or vars->>3 is distinct from to_char(date '2026-10-31', 'DD Mon YYYY')
    or jsonb_array_length(vars) <> 4
  then
    raise exception 'reminder variables drifted: %', vars;
  end if;

  body := public.render_resident_comms_body('payment_reminder', vars);
  if body not like '%NGN 5,000%' or position(U&'\20A6' in body) > 0 then
    raise exception 'reminder body: %', body;
  end if;

  body := public.render_resident_comms_body(
    'payment_receipt',
    public.payment_receipt_template_variables(
      'Ada Obi',
      500000,
      'paystack',
      timestamptz '2026-10-08 13:30+00',
      'PAY-123'
    )
  );
  if body not like '%NGN 5,000 via paystack%'
    or body not like '%Ref: PAY-123%'
    or body not like '%08 Oct 2026 14:30%'
    or position(U&'\20A6' in body) > 0
  then
    raise exception 'receipt body: %', body;
  end if;

  body := public.render_resident_comms_body(
    'suspension_notice',
    public.suspension_notice_template_variables('Ada Obi', 'Outstanding balance')
  );
  if body not like '%Reason: Outstanding balance%' then
    raise exception 'suspension body: %', body;
  end if;

  notification_id := public.enqueue_resident_comms(
    operator_id,
    v_customer_id,
    'payment_reminder',
    'Smoke reminder',
    'ignored',
    jsonb_build_object('templateVariables', vars),
    'smoke-consent:no-consent'
  );
  if notification_id is not null then
    raise exception 'enqueue should skip when consent is missing';
  end if;

  select o.status, o.last_error, o.payload->>'body'
  into outbox_status, outbox_error, outbox_body
  from public.notification_outbox o
  where o.dedupe_key = 'smoke-consent:no-consent:no-consent';

  if outbox_status is distinct from 'cancelled'
    or outbox_error is distinct from 'skipped: no consent for whatsapp or sms'
    or outbox_body not like '%NGN 5,000%'
  then
    raise exception 'consent skip was not logged: status=% error=% body=%', outbox_status, outbox_error, outbox_body;
  end if;

  perform public.record_resident_message_consent(
    operator_id, v_customer_id, 'whatsapp', true, 'operator_dashboard', owner_id
  );
  perform public.record_resident_message_consent(
    operator_id, v_customer_id, 'sms', true, 'operator_dashboard', owner_id
  );
  perform public.record_resident_message_consent(
    operator_id, other_customer, 'whatsapp', true, 'operator_dashboard', owner_id
  );

  notification_id := public.enqueue_resident_comms(
    operator_id,
    v_customer_id,
    'payment_reminder',
    'Smoke reminder',
    '',
    jsonb_build_object('templateVariables', vars),
    'smoke-consent:queued'
  );
  if notification_id is null then
    raise exception 'enqueue should queue after consent';
  end if;

  select
    o.id,
    o.status,
    o.channel,
    o.payload->>'fallbackChannel',
    o.payload->'template'->>'name',
    jsonb_array_length(o.payload->'template'->'variables'),
    o.payload->'template'->'variables'->>0,
    o.payload->>'body'
  into
    queued_id,
    outbox_status,
    outbox_channel,
    fallback,
    template_name,
    variable_count,
    first_variable,
    outbox_body
  from public.notification_outbox o
  where o.dedupe_key = 'smoke-consent:queued';

  if outbox_status is distinct from 'queued'
    or outbox_channel is distinct from 'whatsapp'
    or fallback is distinct from 'sms'
    or template_name is distinct from 'payment_reminder'
    or variable_count is distinct from 4
    or first_variable is distinct from 'Ada Obi'
    or outbox_body not like '%NGN 5,000%'
  then
    raise exception
      'queued template payload drifted: status=% channel=% fallback=% template=% vars=% first=% body=%',
      outbox_status, outbox_channel, fallback, template_name, variable_count, first_variable, outbox_body;
  end if;

  perform public.record_resident_message_consent(
    operator_id, v_customer_id, 'whatsapp', false, 'operator_dashboard', owner_id
  );
  perform public.record_resident_message_consent(
    operator_id, v_customer_id, 'sms', false, 'operator_dashboard', owner_id
  );

  update public.notification_outbox
  set next_attempt_at = '-infinity'
  where id = queued_id;

  claimed := public.claim_comms_outbox(50, operator_id);
  if not exists (
    select 1
    from jsonb_array_elements(claimed) item
    where item->>'id' = queued_id::text
      and (item->>'whatsappConsent')::boolean is false
      and (item->>'smsConsent')::boolean is false
  ) then
    raise exception 'claim did not expose withdrawn consent: %', claimed;
  end if;

  perform public.complete_comms_outbox(
    queued_id,
    false,
    null,
    null,
    'skipped_whatsapp: no resident consent; skipped_sms: no resident consent',
    true
  );

  select o.status, o.last_error
  into outbox_status, outbox_error
  from public.notification_outbox o
  where o.id = queued_id;

  if outbox_status is distinct from 'cancelled'
    or outbox_error not like '%no resident consent%'
  then
    raise exception 'dispatch skip was not cancelled: status=% error=%', outbox_status, outbox_error;
  end if;

  perform set_config('request.jwt.claim.sub', driver_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', driver_id::text, 'role', 'authenticated')::text,
    true
  );
  execute 'set local role authenticated';

  begin
    perform public.comms_caller_context();
    raise exception 'driver comms context should fail';
  exception
    when others then
      if sqlerrm not like '%not permitted%' then
        raise;
      end if;
  end;

  begin
    perform public.set_my_resident_message_consent('sms', true);
    raise exception 'driver should not set resident consent';
  exception
    when others then
      if sqlerrm not like '%Only residents%' then
        raise;
      end if;
  end;

  perform set_config('request.jwt.claim.sub', resident_id::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', resident_id::text, 'role', 'authenticated')::text,
    true
  );

  perform public.set_my_resident_message_consent('sms', true);

  select consent.source, consent.granted
  into consent_source, consent_granted
  from public.resident_message_consent consent
  where consent.customer_id = v_customer_id
    and consent.channel = 'sms';

  if consent_source is distinct from 'resident_app' or consent_granted is distinct from true then
    raise exception 'resident consent was not stored: source=% granted=%', consent_source, consent_granted;
  end if;

  select count(*)
  into seen
  from public.resident_message_consent consent
  where consent.customer_id = other_customer;

  if seen <> 0 then
    raise exception 'resident can read another customer consent';
  end if;

  begin
    perform public.set_my_resident_message_consent('email', true);
    raise exception 'bad channel should fail';
  exception
    when others then
      if sqlerrm not like '%whatsapp or sms%' then
        raise;
      end if;
  end;

  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', owner_id::text, 'role', 'authenticated')::text,
    true
  );

  context := public.comms_caller_context();
  if (context->>'operatorId')::uuid is distinct from operator_id
    or context->>'role' is distinct from 'operator_owner'
  then
    raise exception 'owner comms context: %', context;
  end if;

  execute 'reset role';
  raise notice 'SMOKE PASS';
end
$$;

rollback;
