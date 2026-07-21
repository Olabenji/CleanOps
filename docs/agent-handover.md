# CleanOps Agent Handover

**Date:** 21 Jul 2026  
**Canvas (primary):** `~/.cursor/projects/c-Users-Administrator-Clean-Ops/canvases/cleanops-handover.canvas.tsx`  
**Prior chat:** [Frequency make-good routing](c8346825-81e3-469a-9123-a409f9793c01)

This markdown mirrors the handover canvas for repo durability. Prefer the canvas in Cursor; if docs and this file disagree with migrations `0058`/`0059`, trust the migrations.

## Critical warning

`docs/status-report.md`, `docs/backlog.md`, and `docs/roadmap.md` are **stale** (still claim resident mobile = 0% and Paystack checkout pending). Do not use them as current truth.

## Branch / workspace

- Branch: `main` (ahead of `origin/main` by 2)
- Large **uncommitted** set: resident web/mobile, make-good, unserviced recovery, compliance, migrations `0049`–`0059`
- Local DB: Docker `supabase_db_cleanops`; migrations through **0059** applied manually via `psql`

## Locked product defaults

| Rule | Behavior |
|------|----------|
| Miss | `skipped` / `missed_reported` when due (preferred DOW) or already make-good |
| Recovery target | `source_date + 1` calendar day (weekends included) |
| EOD | Supervisor **Close incomplete** — no midnight auto-cron |
| SLA | Recovery never removes next regular preferred weekday |
| Overlap | One stop can fulfill regular + linked recovery |
| Auto-complaint | No |

## Shipped in this arc

1. Frequency-aware `plan_daily_routes` + `collection_make_goods` (`0058`)
2. Linked recoveries, supervisor finalize, inbox/outbox/devices (`0059`)
3. Resident web portal + mobile Home / Pay / Issues / Inbox / Profile
4. Paystack checkout + verify (web + mobile `cleanops://` callback)
5. Suspended-stop Complete disabled (driver + operator)
6. Expo Go safe push skip (SDK 53+)

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

**P0:** Commit hygiene; CI/smoke/device QA; real Expo push (EAS + dev build)

**P1:** Make-good/Coverage board (#143 slim); refresh stale docs; fleet/dumpsite operator UI (#142/#144)

**P2:** Twilio/Termii; OTP; GPS/photo proof; reports/incident resolution; Realtime

**P3:** Multi-PSP scale, i18n, LAWMA API

## ADO

- Epic #127 LAWMA build order
- Feature #166 frequency + make-good; stories #167–#170
- #143 coverage list (no map yet)
- PAT: `.env_PAT.local`

## New-agent starter prompt

```
You are continuing CleanOps after a large-chat handover.

Open and read the CleanOps Engineering Handover canvas, then skim:
- supabase/migrations/0058_frequency_make_good.sql
- supabase/migrations/0059_unserviced_recovery_push.sql
- apps/mobile/src/screens/ResidentApp.tsx
- docs/agent-handover.md

Branch: main (ahead of origin; many uncommitted files). Commit only when asked.

Highest-value next work (confirm with user):
1) Organize/commit recovery + resident parity
2) Production quality gate (CI + smoke)
3) Make-good / Coverage operator board
4) Real Expo push via development build

Ignore stale claims in docs/status-report.md about resident=0%.
```

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
