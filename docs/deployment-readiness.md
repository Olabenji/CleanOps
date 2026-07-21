# Deployment Readiness Checklist

**Last updated:** 22 July 2026  
**Gate after:** local quality scripts / CI quality-gate workflow

## 1. Hosted database migrations

Apply all pending migrations through `0060` to the hosted Supabase project:

```bash
npx supabase link --project-ref <PROJECT_REF>
npx supabase db push
npx supabase migration list
```

Confirm remote includes:

- `0058_frequency_make_good.sql`
- `0059_unserviced_recovery_push.sql`
- `0060_fix_compliance_case_status.sql`

## 2. Edge Functions

Deploy and configure:

```bash
npx supabase functions deploy paystack-webhook --no-verify-jwt
npx supabase functions deploy resident-paystack-checkout
npx supabase functions deploy resident-paystack-verify
npx supabase functions deploy dispatch-resident-notifications --no-verify-jwt
```

## 3. Secrets and environment

Set hosted function secrets:

```bash
npx supabase secrets set PAYSTACK_SECRET_KEY=sk_live_or_sk_test_...
npx supabase secrets set SITE_URL=https://<operator-web-host>
```

Validate production app env before release:

```bash
# export EXPO_PUBLIC_* / SUPABASE_* / PAYSTACK_* / SITE_URL first
npm run env:check:production
```

Required keys are declared in `.env.example`.

## 4. Post-deploy smoke

Against hosted endpoints:

```bash
# Resident auth + home RPC
SUPABASE_URL=https://<project>.supabase.co \
SUPABASE_ANON_KEY=<anon> \
npm run test:resident

# Paystack webhook (use a non-production customer if testing live)
PAYSTACK_SECRET_KEY=sk_... \
PAYSTACK_WEBHOOK_URL=https://<project>.supabase.co/functions/v1/paystack-webhook \
npm run test:paystack:idempotent
```

Manual: operator close-incomplete → recovery notice → resident inbox.

## Blockers for this machine

Hosted project credentials / PAT and real Paystack secrets are not committed. Provide project ref + secrets when ready to execute the deploy steps above.
