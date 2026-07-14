# CleanOps SaaS packaging

One codebase, one deploy, plan-gated modules. Tenants are rows in `operators` with a `plan_code` of `basic`, `growth`, or `pro`.

## Distribution

| Channel | Approach |
|---------|----------|
| Operator web | Hosted SaaS |
| Driver / agent mobile | Same Expo apps; tenant from login |
| Sales motion | Platform admin onboards PSP → send owner credentials |
| Upsell | Change `plan_code` on the tenant |

## Licence tiers

### Basic — Run the ward

- Operations dashboard and alerts
- Daily routes (plan, cancel, stop corrections)
- Staff attendance
- Customer ledger + manual payment recording
- Admin master data (seat-capped)
- Mobile driver Today + agent Collect
- Soft caps: ~15 active logins, ~3 zones

Not included: reassignment/cover, templates, licence vault, Paystack collections, custom branding.

### Growth — Run efficiently

Everything in Basic, plus:

- Route reassignment / temporary cover
- Zone route templates
- Truck float / handoffs
- Driver licence vault + expiry
- Self-service profiles
- Higher caps (~40 seats, ~8 zones)
- Mobile shift history / wrap-up

### Pro — Scale and brand

Everything in Growth, plus:

- Paystack online collections + webhooks
- Custom brand name (and later logo)
- Larger / custom seat and zone packs
- Ops analytics packs (when built)
- Priority support SLA

## Module matrix

| Module | Basic | Growth | Pro |
|--------|-------|--------|-----|
| Dashboard + alerts | Yes | Yes | Yes |
| Routes daily ops | Yes | Yes | Yes |
| Attendance | Yes | Yes | Yes |
| Payments ledger (manual) | Yes | Yes | Yes |
| Admin master data | Yes | Yes | Yes |
| Mobile driver/agent core | Yes | Yes | Yes |
| Route reassignment / cover | — | Yes | Yes |
| Route templates | — | Yes | Yes |
| Truck handoffs / float | — | Yes | Yes |
| Licence vault + expiry | — | Yes | Yes |
| Self-service profiles | — | Yes | Yes |
| Paystack collections | — | — | Yes |
| Custom branding | — | — | Yes |
| Platform admin console | Platform only | Platform only | Platform only |

## Platform-only (never sold to tenants)

- Platform console
- Create / suspend tenants
- Cross-tenant support tooling

## Local multi-tenant smoke checklist

1. Sign in as `platform@cleanops.local` / `cleanops-platform-password`.
2. Confirm Next to Godliness and Island Clean appear in Operators.
3. Onboard a third operator; copy the one-time password.
4. Sign out; sign in as the new owner — empty/own workspace only.
5. Sign in as `owner@cleanops.local` — Next to Godliness data only; Island customers/staff absent.
6. Sign in as `island.owner@cleanops.local` / `cleanops-island-password` — Island brand in sidebar.
7. From platform console, Suspend Island Clean; Island owner sign-in should fail with suspended message.
8. Reactivate Island Clean.

## Notes

- Feature gating from `plan_code` is stored now; full UI/RPC enforcement is a follow-on phase.
- Auth emails are globally unique across tenants.
- Driver licence storage is private; uploads use signed URLs.
