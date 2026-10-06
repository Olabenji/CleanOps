# Resident Auth (email-only v1)

## Scope

Customer/resident login profiles are provisioned from Admin → Customers:

1. **Create login** — requires an email; creates Supabase Auth user with role `resident`, links `customers.profile_id`, stores email on the customer.
2. **Send reset email** — uses the same self-serve forgot-password path as staff (operator web recovery screen).

## Resident portal

After signing in with a resident login on the **same operator web URL**, CleanOps opens the resident home:

- Know Your PSP card (brand, operator, phone, zone trucks)
- Collection schedule (preferred weekdays / frequency)
- Own balance for the current month + Paystack checkout
- Own payment history
- Missed-collection / service complaint submit + own history (24h SLA)

RPCs / APIs (scoped by `current_customer_id()`):

- `get_resident_home()`
- `list_my_payments()`
- `get_resident_checkout_context()` (used by edge checkout)
- `submit_resident_service_complaint(...)`
- `list_my_service_complaints()`
- Edge Function `resident-paystack-checkout` → Paystack initialize with `metadata.operator_id` + `metadata.customer_id`

Settlement paths:

- Webhook `paystack-webhook` → `record_paystack_payment` (production / tunneled local)
- Return URL verify via `resident-paystack-verify` (works on localhost without a public webhook URL)

### Local Paystack setup

1. Put a **real** Paystack test secret in `.env.functions.local` (not `sk_test_local_cleanops` — that key is only for webhook HMAC smoke tests):

```
PAYSTACK_SECRET_KEY=sk_test_xxxxxxxx
SITE_URL=http://localhost:5173
```

2. Serve edge functions:

```bash
npm run dev:functions
```

3. Keep `paystack-webhook` available in the same serve process so successful charges post to the ledger.

The portal shows the function's real error message when checkout fails (missing function, invalid key, missing email, etc.).

Operator Complaints inbox continues to show resident-sourced rows for ack/resolve/escalate.

## Out of scope

- Public unauthenticated ward lookup page
- Make-good route stop from a resident complaint
- Native mobile resident app (mobile resident shell exists; phone OTP now shared with staff)

Phone OTP sign-in for provisioned profiles: see [phone-otp-auth.md](./phone-otp-auth.md).

## Session gate

- `get_session_operator_context` returns `customerId` for `resident` roles.
- Operator workspace and field mobile reject resident accounts.
- Forgot password still works from the shared web login.

See also: [password-recovery.md](./password-recovery.md).
