# CleanOps Implementation Backlog

**Last reviewed:** 19 September 2026 — see [progress-snapshot.md](./progress-snapshot.md), [status-report.md](./status-report.md), and [agent-handover.md](./agent-handover.md).

## Pilot / production gates (current)

- [ ] Set hosted `TERMII_API_KEY` (+ Twilio WhatsApp secrets) and complete phone OTP live SMS / human QA ([phone-otp-auth.md](./phone-otp-auth.md)).
- [ ] Confirm hosted migrations include `0080_truck_live_gps.sql`; push if missing.
- [ ] Commit/push local work so `origin/main` matches pilot machine.
- [ ] Optional: `gh auth login` and verify GitHub Actions quality-gate.
- [ ] Add Sentry and stricter production environment validation.
- [ ] First design-partner ward pilot on hosted (Growth packaging; meter WhatsApp/SMS).

## Foundation

- [x] Define database schema, enums, RLS policies, and seed data for a single pilot operator.
- [x] Configure Supabase local development and migration workflow.
- [x] Implement phone OTP auth and role-aware session loading (email/password + Admin-provisioned staff/residents done; Termii SMS OTP + session link via `phone-otp` / `0078`).
- [ ] **Phone OTP live SMS / human QA** — code done; deferred from walkthrough Step 5. Blocked on `TERMII_API_KEY` (+ optional A=`PHONE_OTP_DEV_REVEAL` / B=real SMS). See `docs/phone-otp-auth.md` / handover P2.
- [x] Create shared TypeScript domain models and validation schemas.
- [ ] Add Sentry and environment validation.
- [x] Operation calendar / operator timezone helpers (`0051`–`0052`).

## Operator Web

- [x] Dashboard metrics: route progress, daily revenue, staff attendance, fleet status, and alerts.
- [x] Route planning with truck/driver assignment and stop edits (recurring schedule builder / loaders still open).
- [x] Floating trucks: any operational/standby truck can be assigned to any zone route (home zone optional).
- [x] Zone template save prompt after day-route edits + daily auto-load for operator/drivers.
- [x] Driver login fallback to load previous/default template when operator has not planned today.
- [x] Route-change in-app notices for affected drivers (push notifications still open).
- [x] Truck reassignment / route takeover: operator proposes mid-route or pre-start swap; drivers confirm on mobile.
- [x] Frequency-aware `plan_daily_routes` + make-good enqueue/resolve (`0058`/`0059`).
- [x] Supervisor close-incomplete → next-calendar-day recovery (`finalize_route_with_unserviced`).
- [x] Suspended-stop Complete guard (operator + driver).
- [x] LAWMA P1 compliance evidence view (`0049`).
- [x] Resident/customer ledger with status, balance, current-month tag, and payment history.
- [x] Staff attendance and monthly payroll summary (task assignment / performance notes still open).
- [x] Admin master-data onboarding + staff login provisioning + resident customer login provision.
- [x] Make-good / Coverage board for open recoveries (ADO #143 slim — list before map).
- [x] Fleet board (#142/#144): trucks + day fuel/dumpsite (`0065`) plus dumpsite registry, site map/proximity, and maintenance calendar (`0069`). **Live truck GPS** via driver pings (`0080`, prefer ≤15 min on Fleet map).
- [x] Settings console with ward default template planning (`0066`/`0067`) — edit stops/truck/driver without depending on ops date.
- [x] Settings **Customer data load** — CSV/TSV bulk import with column mapping, preview/validation, phone-skip idempotency, optional ward template append (`0072`).
- [x] Exportable reports for P&L, collections, attendance, and fleet costs (`0070`).
- [x] Edit existing staff/truck/customer records (including collection frequency fields).

## Mobile

- [x] Driver route (when assigned), shift, stop marking, incident report, offline queue.
- [x] Driver wrap-up without auto-completing pending stops (`0050`).
- [x] Collection agent ledger lookup, payment entry, on-screen receipt, daily reconciliation.
- [x] Email/password sign-in for staff and residents + sign out / switch user.
- [x] Driver dumpsite log and fuel log screens.
- [x] Driver confirm/decline for operator-initiated truck handoffs.
- [x] Resident Home / Pay / Issues / Inbox / Profile (schedule, account, Paystack, complaints, notifications).
- [x] Real Expo push delivery via development/production build (Expo Go safely skipped on SDK 53+). **Physical Android E2E done 29 Jul** (Tunde Lawal): profile test push + close→outbox tray + tap→Inbox — `docs/expo-push-dev-build.md`
- [x] Harden offline queue with MMKV (AsyncStorage fallback) and default queue-on.
- [x] GPS + optional photo proof on stop complete/skip (`0071`); multi-route driver view still open.

## Integrations

- [x] Paystack webhook verification + idempotent payment posting.
- [x] Resident Paystack checkout initialize + verify (web + mobile callback).
- [ ] Dedicated transfer account / virtual account handling.
- [x] Twilio WhatsApp reminders, receipts, and suspension notices.
- [x] Termii SMS fallback.
- [x] Resident notification inbox + outbox + Expo push dispatch function (infra).
- [x] Physical-device Expo push end-to-end — EAS/FCM + profile test push + close→outbox tray + tap→Inbox (Tunde Lawal / Android, 29 Jul).

## Quality

- [x] Type checks and migration checks in CI (`.github/workflows/quality-gate.yml`; local green 29 Jul: env:check, typecheck, unit tests, build, db:lint, recovery/resident/Paystack smokes, Playwright).
- [x] Unit tests for Paystack shared validation and webhook signature / idempotency key helpers.
- [x] SQL smoke scripts for make-good and unserviced recovery.
- [ ] Broader unit tests for remaining shared validation schemas.
- [x] Browser smoke tests for critical resident login flow (Playwright; fixed Sign-in selector after phone OTP UI).
- [x] Real-device Android QA for resident push (driver/agent device QA still open).
- [x] Hosted Supabase migration + Edge Function deploy (through `0079` on `mpklygwxjskeiebtbdws`, 29 Jul; Termii/Twilio secrets still optional for live SMS/WhatsApp).
