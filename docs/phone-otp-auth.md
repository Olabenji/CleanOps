# Phone OTP auth

Foundation leftover from Item 5 Comms. Email/password remains the default; phone OTP signs in **already provisioned** profiles (staff, residents, operators) whose `profiles.phone` matches a Nigerian mobile number.

## Approach

**Termii SMS OTP + Supabase session linking** (not Supabase Auth built-in phone provider).

- Supabase Auth phone SMS typically needs Twilio/MessageBird in the Auth dashboard; this stack already uses **Termii** for Nigerian SMS.
- OTP uses Termii's transactional `dnd` route. `TERMII_BASE_URL` overrides the default `https://api.ng.termii.com` for both this function and resident-notice SMS. Sign-in OTP is not blocked by WhatsApp/SMS notice consent.
- Edge Function `phone-otp` issues a hashed 6-digit challenge, sends SMS via Termii, then on verify uses `auth.admin.generateLink` (magic link) and returns `tokenHash` for `supabase.auth.verifyOtp({ type: 'email' })`.
- Role-aware session loading is unchanged: clients still call `get_session_operator_context` after the session exists.

## Try it (local)

1. Apply migration `0078_phone_otp_auth.sql` (`npx supabase migration up` or `db reset` as you usually do).
2. Put secrets in `.env.functions.local` (do not invent keys):

```
TERMII_API_KEY=...          # required for real SMS
TERMII_SENDER_ID=CleanOps
PHONE_OTP_DEV_REVEAL=true   # local only: return OTP in API when Termii is unset
PHONE_OTP_PEPPER=...        # required; the function does not derive this from the service role key
```

3. Serve functions: `npm run dev:functions`
4. Web: login → **Sign in with phone OTP** → e.g. `08000000201` (demo driver `+2348000000201`).
5. Mobile: same control on `SignInScreen`.
6. SQL smoke: `psql ... -f scripts/smoke_phone_otp.sql`

Without `TERMII_API_KEY`, request returns a clear `sms_not_configured` soft-fail (HTTP 503) unless `PHONE_OTP_DEV_REVEAL=true`, which returns `devCode` for local verify. That flag is ignored when `SUPABASE_URL` points at a hosted `*.supabase.co` project. A missing `PHONE_OTP_PEPPER` fails the request with a clear configuration error.

## Limits

| Rule | Value |
|------|--------|
| OTP length | 6 digits |
| Expiry | 10 minutes |
| Resend cooldown | 60 seconds |
| Max requests / phone / hour | 5 |
| Max verify attempts / challenge | 5 |

Audit rows land in `phone_otp_audit`. Challenges in `phone_otp_challenges` (service_role only).

## Hosted

```bash
npx supabase db push
npx supabase functions deploy phone-otp
npx supabase secrets set TERMII_API_KEY=... TERMII_SENDER_ID=CleanOps PHONE_OTP_PEPPER=...
```

## Out of scope

- Public self-signup by phone
- Linking OTP to an already-signed-in session without going through verify
- Non-NG numbers
