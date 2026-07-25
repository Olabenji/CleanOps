# CleanOps Agent Handover

**Date:** 25 July 2026  
**Canvas (primary):** `~/.cursor/projects/c-Users-Administrator-Clean-Ops/canvases/cleanops-handover.canvas.tsx`  
**Prior chat:** [Frequency make-good routing](c8346825-81e3-469a-9123-a409f9793c01)  
**Feature commit:** `2eac133` — Complete LAWMA recovery and resident service parity

This markdown mirrors the handover canvas for repo durability. Prefer migrations `0058`/`0059` if anything conflicts.

## Branch / workspace

- Branch: `main` (local work may be ahead of `origin/main`)
- Local DB: Docker `supabase_db_cleanops`; migrations through **0075** applied locally
- Hosted Supabase (`mpklygwxjskeiebtbdws`): migrations through **0075** when linked push succeeds; Edge Functions redeployed as needed

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
8. Operator Fleet board slim — trucks + day fuel/dumpsite (`0065`)
9. Settings console — ward default templates independent of ops date (`0066`/`0067`)
10. Zone → Ward user-facing labels (`0068`)
11. Fleet remainder — dumpsite registry + OSM map/proximity + maintenance calendar (`0069`)
12. Exportable reports — collections / attendance / fleet costs + P&L CSV (`0070`)
13. Driver stop field proof — GPS + optional photo; MMKV offline queue fallback (`0071`)
14. Settings **Customer data load** — CSV/TSV bulk import with preview, phone-skip idempotency, optional ward template append (`0072`)
15. Operator **Comms** — Twilio WhatsApp reminders/receipts/suspension + Termii SMS fallback (`0075`)

## Key paths

- `supabase/migrations/0058_frequency_make_good.sql`
- `supabase/migrations/0059_unserviced_recovery_push.sql`
- `supabase/migrations/0065_operator_fleet_board.sql`
- `supabase/migrations/0066_operator_settings_zone_templates.sql`
- `supabase/migrations/0067_fix_zone_template_settings_rls.sql`
- `supabase/migrations/0068_rename_zone_labels_to_ward.sql`
- `supabase/migrations/0069_fleet_dumpsite_maintenance.sql`
- `supabase/migrations/0070_operator_exportable_reports.sql`
- `supabase/migrations/0071_stop_field_proof.sql`
- `supabase/migrations/0072_bulk_customer_import.sql`
- `supabase/migrations/0075_operator_comms_twilio_termii.sql`
- `packages/shared/src/customerImport.ts`
- `apps/web/src/components/FleetView.tsx`
- `apps/web/src/components/ReportsView.tsx`
- `apps/web/src/components/CommsView.tsx`
- `apps/web/src/components/SettingsView.tsx`
- `apps/web/src/data/fleetService.ts`
- `apps/web/src/data/reportsService.ts`
- `apps/web/src/data/commsService.ts`
- `apps/web/src/data/settingsService.ts`
- `apps/mobile/src/data/fieldProof.ts`
- `apps/mobile/src/data/offlineQueueStore.ts`
- `scripts/smoke_fleet_board.sql`
- `scripts/smoke_operator_reports.sql`
- `scripts/smoke_operator_comms.sql`
- `scripts/smoke_bulk_customer_import.sql`
- `scripts/clear_future_plans.sql`
- `supabase/functions/dispatch-resident-notifications/`
- `supabase/functions/dispatch-resident-comms/`
- `supabase/functions/send-reminders/`
- `supabase/functions/resident-paystack-checkout/` (supports `callbackUrl`)
- `apps/web/src/components/ResidentApp.tsx`
- `apps/mobile/src/screens/ResidentApp.tsx`
- `apps/mobile/src/lib/residentPush.ts`
- `scripts/smoke_make_good.sql`
- `scripts/smoke_unserviced_recovery.sql`

## Pending (priority)

**P0:** Real Expo push device QA — EAS project linked; run `eas credentials` + `eas:build:android`, then checklist in `docs/expo-push-dev-build.md`

**P1:** Live truck GPS proximity still deferred (#142/#144 remainder); dumpsite registry + maintenance UI shipped (`0069`)

**P2:** OTP; multi-route driver view; reports/incident resolution polish; Realtime

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
