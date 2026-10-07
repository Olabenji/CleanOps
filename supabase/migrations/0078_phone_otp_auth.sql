-- Phone OTP auth (Foundation leftover from Item 5 Comms).
-- Challenges are written/verified by the phone-otp Edge Function (service_role).
-- SMS delivery uses Termii (same provider as comms SMS fallback).

create table if not exists public.phone_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  last_error text,
  constraint phone_otp_challenges_phone_e164_check
    check (phone_e164 ~ '^\+234[0-9]{10}$'),
  constraint phone_otp_challenges_attempt_count_check
    check (attempt_count >= 0 and attempt_count <= max_attempts)
);

create index if not exists phone_otp_challenges_phone_created_idx
  on public.phone_otp_challenges (phone_e164, created_at desc);

create index if not exists phone_otp_challenges_expires_idx
  on public.phone_otp_challenges (expires_at)
  where consumed_at is null;

create table if not exists public.phone_otp_audit (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text,
  profile_id uuid references public.profiles (id) on delete set null,
  event text not null,
  detail text,
  created_at timestamptz not null default now(),
  constraint phone_otp_audit_event_check
    check (
      event in (
        'request_accepted',
        'request_rejected',
        'sms_sent',
        'sms_not_configured',
        'sms_failed',
        'verify_ok',
        'verify_failed',
        'rate_limited'
      )
    )
);

create index if not exists phone_otp_audit_created_idx
  on public.phone_otp_audit (created_at desc);

alter table public.phone_otp_challenges enable row level security;
alter table public.phone_otp_audit enable row level security;

-- No anon/authenticated policies — service_role bypasses RLS for the Edge Function.

revoke all on table public.phone_otp_challenges from anon, authenticated;
revoke all on table public.phone_otp_audit from anon, authenticated;
grant select, insert, update on table public.phone_otp_challenges to service_role;
grant select, insert on table public.phone_otp_audit to service_role;

create or replace function public.lookup_profile_for_phone_otp(input_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  e164 text := public.normalize_ng_phone(input_phone);
  match_count integer;
  profile_row public.profiles%rowtype;
  login_email text;
begin
  if e164 is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_phone');
  end if;

  select count(*)::integer
  into match_count
  from public.profiles
  where public.normalize_ng_phone(phone) = e164;

  if match_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'phoneE164', e164);
  end if;

  if match_count > 1 then
    return jsonb_build_object('ok', false, 'error', 'ambiguous', 'phoneE164', e164);
  end if;

  select *
  into profile_row
  from public.profiles
  where public.normalize_ng_phone(phone) = e164
  limit 1;

  select users.email
  into login_email
  from auth.users
  where users.id = profile_row.id;

  if login_email is null or trim(login_email) = '' then
    return jsonb_build_object('ok', false, 'error', 'no_login', 'phoneE164', e164);
  end if;

  return jsonb_build_object(
    'ok', true,
    'phoneE164', e164,
    'profileId', profile_row.id,
    'role', profile_row.role,
    'fullName', profile_row.full_name,
    'email', login_email
  );
end;
$$;

revoke all on function public.lookup_profile_for_phone_otp(text) from public, anon, authenticated;
grant execute on function public.lookup_profile_for_phone_otp(text) to service_role;

comment on table public.phone_otp_challenges is
  'Hashed SMS OTP challenges for phone sign-in; managed by phone-otp Edge Function.';
comment on table public.phone_otp_audit is
  'Phone OTP request/verify audit trail including soft-fail when Termii is unset.';
