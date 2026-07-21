# CleanOps Agent Handover

**Date:** 22 July 2026  
**Canvas (primary):** `~/.cursor/projects/c-Users-Administrator-Clean-Ops/canvases/cleanops-handover.canvas.tsx`  
**Prior chat:** [Frequency make-good routing](c8346825-81e3-469a-9123-a409f9793c01)  
**Feature commit:** `2eac133` — Complete LAWMA recovery and resident service parity

This markdown mirrors the handover canvas for repo durability. Prefer migrations `0058`/`0059` if anything conflicts.

## Branch / workspace

- Branch: `main` (ahead of `origin/main`; recovery/resident commit landed; docs + ADO artifacts may trail)
- Local DB: Docker `supabase_db_cleanops`; migrations through **0059** applied locally
- Hosted Supabase still needs proper migration + Edge Function deploy

## Locked product defaults

| Rule | Behavior |
|------|----------|
| Miss | `skipped` / `missed_reported` when due (preferred DOW) or already make-good |
| Recovery target | `source_date + 1` calendar day (weekends included) |
| EOD | Supervisor **Close incomplete** — no midnight auto-cron |
| SLA | Recovery never removes next regular preferred weekday |
| Overlap | One stop can fulfill regular + linked recovery |
| Auto-complaint | No |

## Shipped

1. Frequency-aware `plan_daily_routes` + `collection_make_goods` (`0058`)
2. Linked recoveries, supervisor finalize, inbox/outbox/devices (`0059`)
3. Resident web portal + mobile Home / Pay / Issues / Inbox / Profile
4. Paystack checkout + verify (web + mobile `cleanops://` callback)
5. Suspended-stop Complete disabled (driver + operator)
6. Expo Go safe push skip (SDK 53+)
7. LAWMA P1 compliance evidence (`0049`)

## Key paths

- `supabase/migrations/0058_frequency_make_good.sql`
- `supabase/migrations/0059_unserviced_recovery_push.sql`
- `supabase/functions/dispatch-resident-notifications/`
- `supabase/functions/resident-paystack-checkout/` (supports `callbackUrl`)
- `apps/web/src/components/ResidentApp.tsx`
- `apps/mobile/src/screens/ResidentApp.tsx`
- `apps/mobile/src/lib/residentPush.ts`
- `scripts/smoke_make_good.sql`
- `scripts/smoke_unserviced_recovery.sql`

## Pending (priority)

**P0:** CI/smoke/device QA; hosted deploy; real Expo push (EAS + dev build)

**P1:** Make-good/Coverage board (#143 slim); fleet/dumpsite operator UI (#142/#144)

**P2:** Twilio/Termii; OTP; GPS/photo proof; reports/incident resolution; Realtime

**P3:** Multi-PSP scale, i18n, LAWMA API

## ADO

- Epic #127 LAWMA build order
- Feature #166 frequency + make-good; stories #167–#170
- #143 coverage list (no map yet)
- PAT: `.env_PAT.local`
- Snapshots: `docs/ado-snapshots/`; helpers under `scripts/ado-*.js`

## Demo logins

| Role | Email |
|------|-------|
| Operator | `owner@cleanops.local` |
| Driver | `driver@cleanops.local` |
| Agent | `agent@cleanops.local` |
| Resident | Admin-provisioned customer login |

## Plans (do not edit unless asked)

- `~/.cursor/plans/frequency_make-good_routing_b9849b0a.plan.md`
- `~/.cursor/plans/unserviced_recovery_push_40a8e199.plan.md`
