# CleanOps Agent Handover

**Date:** 19 September 2026 (progress refresh) · prior detail pass 29 July 2026  
**Progress snapshot:** [progress-snapshot.md](./progress-snapshot.md)  
**Canvas (primary):** `~/.cursor/projects/c-Users-Administrator-Clean-Ops/canvases/cleanops-handover.canvas.tsx`  
**Prior chat:** [Frequency make-good routing](c8346825-81e3-469a-9123-a409f9793c01)  
**Feature commit:** `2eac133` — Complete LAWMA recovery and resident service parity · later tip `5df9593` fleet/reports/comms

This markdown mirrors the handover canvas for repo durability. Prefer migrations `0058`/`0059` if anything conflicts. For “where are we / what’s left / what now”, use [progress-snapshot.md](./progress-snapshot.md).

## Branch / workspace

- Branch: `main` (local work may be ahead of `origin/main`; uncommitted local may include `0076`–`0080` + OTP/GPS)
- Local DB: Docker `supabase_db_cleanops`; migrations through **0080** (truck live GPS) when applied
- Hosted Supabase (`mpklygwxjskeiebtbdws`): migrations through **0079** + Edge Functions redeployed 29 Jul; confirm **0080** push; Termii/Twilio secrets still required for live SMS/WhatsApp
- Local Edge: `npm run dev:functions` (uses `.env.functions.local`) — required for close→outbox auto-dispatch
- Quality gate: `.github/workflows/quality-gate.yml` — **local green 29 Jul** (typecheck, tests, build, db:lint, recovery/resident/Paystack/browser smokes). GitHub Actions run not verified here (`gh` unauthenticated).
- **Verdict:** pilot-ready / near production — go-live = one PSP ward on hosted, not more features

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
16. **Phone OTP auth** — Implemented (`0078` + Edge Function `phone-otp` + Termii); web + mobile UI. **Live SMS / human QA deferred** (walkthrough Step 5 skipped) — blocked on `TERMII_API_KEY`; optional A=`PHONE_OTP_DEV_REVEAL` / B=real SMS

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
- `supabase/migrations/0078_phone_otp_auth.sql`
- `supabase/functions/phone-otp/`
- `docs/phone-otp-auth.md`
- `scripts/smoke_phone_otp.sql`
- `packages/shared/src/customerImport.ts`
- `packages/shared/src/phoneOtp.ts`
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
- `scripts/ensure-eas-fcm-v1.mjs`
- `scripts/send-test-resident-push.mjs`
- `docs/expo-push-dev-build.md`
- `scripts/smoke_make_good.sql`
- `scripts/smoke_unserviced_recovery.sql`

## Pending (priority)

**P0 (production polish):** Termii/Twilio secrets for live SMS/WhatsApp/OTP QA; push hosted to **0080** if missing; commit/push local sync; optional `gh auth` for remote CI; Sentry + stricter production env checks.

**P0 done earlier:** ~~Real Expo push device QA~~ **DONE 29 Jul**. ~~CI quality gate~~ **DONE local 29 Jul**. ~~Hosted migrate through 0079 + Edge deploy~~ **DONE 29 Jul**.

**P1:** ~~Live truck GPS proximity~~ **DONE 29 Jul** (`0080` driver publish + Fleet prefer live ≤15 min; Lagos demo still remaps for AU testing). Confirm hosted has `0080`.

**P2:** **Phone OTP live SMS / human QA** (deferred from walkthrough Step 5) — code shipped; needs `TERMII_API_KEY` (+ optional A=DEV_REVEAL / B=real SMS). See `docs/phone-otp-auth.md`. Also: multi-route driver view; driver/agent device QA; reports/incident resolution polish; Realtime; virtual accounts/USSD; plan-code enforcement.

**P3:** Multi-PSP scale, i18n, LAWMA API, payroll automation

## Next human gates

1. ~~Expo push close→outbox tray + tap→Inbox~~ **done 29 Jul**
2. ~~Hosted Supabase through `0079` + Edge deploy~~ **done 29 Jul**
3. **Phone OTP / Comms** — set `TERMII_API_KEY` (+ Twilio), then walkthrough A (DEV_REVEAL) or B (real SMS) — parked
4. Optional: `gh auth login` so GitHub Actions quality-gate runs can be inspected from CLI
5. ~~Live truck GPS (code)~~ **done 29 Jul** (`0080`) — confirm hosted push
6. **First paid/design-partner ward pilot** on hosted (Growth packaging; meter WhatsApp/SMS)

## ADO

- Epic #127 LAWMA build order
- Feature #166 frequency + make-good; stories #167–#170
- #143 coverage list (no map yet)
- Status sync: `node scripts/ado-sync-pilot-status.js` (needs valid `.env_PAT.local`)
- Progress doc: [progress-snapshot.md](./progress-snapshot.md)
- PAT: `.env_PAT.local`
- Snapshots: `docs/ado-snapshots/`; helpers under `scripts/ado-*.js`

## Demo logins

Local seed only. Run `npm run demo:passwords` and read gitignored `.env.demo.local` (template: `demo.env.example`). Do not commit those passwords. Hosted projects are not seeded with these users by migrations.

## Plans (do not edit unless asked)

- `~/.cursor/plans/frequency_make-good_routing_b9849b0a.plan.md`
- `~/.cursor/plans/unserviced_recovery_push_40a8e199.plan.md`
