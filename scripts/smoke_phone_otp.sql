-- Smoke: phone OTP schema + NG phone lookup helper
do $$
declare
  lookup jsonb;
  e164 text;
begin
  e164 := public.normalize_ng_phone('08000000201');
  if e164 is distinct from '+2348000000201' then
    raise exception 'normalize_ng_phone failed: %', e164;
  end if;

  if to_regclass('public.phone_otp_challenges') is null then
    raise exception 'phone_otp_challenges missing';
  end if;

  if to_regclass('public.phone_otp_audit') is null then
    raise exception 'phone_otp_audit missing';
  end if;

  lookup := public.lookup_profile_for_phone_otp('+2348000000201');
  if lookup is null or (lookup->>'ok')::boolean is not true then
    raise exception 'driver phone lookup failed: %', lookup;
  end if;

  if lookup->>'email' is distinct from 'driver@cleanops.local' then
    raise exception 'unexpected driver email: %', lookup->>'email';
  end if;

  lookup := public.lookup_profile_for_phone_otp('+2349999999999');
  if (lookup->>'ok')::boolean is not false or lookup->>'error' is distinct from 'not_found' then
    raise exception 'expected not_found for unknown phone: %', lookup;
  end if;

  raise notice 'phone otp smoke ok email=% role=%',
    (public.lookup_profile_for_phone_otp('+2348000000201'))->>'email',
    (public.lookup_profile_for_phone_otp('+2348000000201'))->>'role';
end
$$;
