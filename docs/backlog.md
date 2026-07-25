# CleanOps Implementation Backlog

**Last reviewed:** 25 July 2026 — see [status-report.md](./status-report.md) and [agent-handover.md](./agent-handover.md).

## Foundation

- [x] Define database schema, enums, RLS policies, and seed data for a single pilot operator.
- [x] Configure Supabase local development and migration workflow.
- [ ] Implement phone OTP auth and role-aware session loading (email/password + Admin-provisioned staff/residents done).
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
- [x] Fleet board (#142/#144): trucks + day fuel/dumpsite (`0065`) plus dumpsite registry, site map/proximity, and maintenance calendar (`0069`). Live truck GPS proximity still deferred.
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
- [ ] Real Expo push delivery via development/production build (Expo Go safely skipped on SDK 53+).
- [x] Harden offline queue with MMKV (AsyncStorage fallback) and default queue-on.
- [x] GPS + optional photo proof on stop complete/skip (`0071`); multi-route driver view still open.

## Integrations

- [x] Paystack webhook verification + idempotent payment posting.
- [x] Resident Paystack checkout initialize + verify (web + mobile callback).
- [ ] Dedicated transfer account / virtual account handling.
- [x] Twilio WhatsApp reminders, receipts, and suspension notices.
- [x] Termii SMS fallback.
- [x] Resident notification inbox + outbox + Expo push dispatch function (infra).
- [ ] Physical-device Expo push end-to-end (EAS project + credentials + tap deep-link).

## Quality

- [ ] Type checks and migration checks in CI.
- [x] Unit tests for Paystack shared validation and webhook signature / idempotency key helpers.
- [x] SQL smoke scripts for make-good and unserviced recovery.
- [ ] Broader unit tests for remaining shared validation schemas.
- [ ] Browser smoke tests for critical operator + resident flows.
- [ ] Real-device Android QA for driver, agent, and resident workflows.
- [ ] Hosted Supabase migration + Edge Function deploy (local Docker through `0059`).
