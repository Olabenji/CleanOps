# CleanOps Implementation Backlog

**Last reviewed:** 9 July 2026 — see [status-report.md](./status-report.md) for delivered detail.

## Foundation

- [x] Define database schema, enums, RLS policies, and seed data for a single pilot operator.
- [x] Configure Supabase local development and migration workflow.
- [ ] Implement phone OTP auth and role-aware session loading (email/password + Admin-provisioned staff done).
- [x] Create shared TypeScript domain models and validation schemas.
- [ ] Add Sentry and environment validation.

## Operator Web

- [x] Dashboard metrics: route progress, daily revenue, staff attendance, fleet status, and alerts.
- [x] Route planning with truck/driver assignment and stop edits (recurring schedule builder / loaders still open).
- [x] Floating trucks: any operational/standby truck can be assigned to any zone route (home zone optional).
- [x] Zone template save prompt after day-route edits + daily auto-load for operator/drivers.
- [x] Driver login fallback to load previous/default template when operator has not planned today.
- [x] Route-change in-app notices for affected drivers (push notifications still open).
- [x] Truck reassignment / route takeover: operator proposes mid-route or pre-start swap; drivers confirm on mobile (Sprint 5).
- [x] Resident/customer ledger with status, balance, current-month tag, and payment history.
- [x] Staff attendance and monthly payroll summary (task assignment / performance notes still open).
- [x] Admin master-data onboarding + staff login provisioning.
- [ ] Fleet profiles UI, fuel logs, maintenance calendar, reserve tracking beyond dashboard snapshot.
- [ ] Exportable reports for P&L, collections, attendance, and fleet costs.
- [x] Edit existing staff/truck/customer records.

## Mobile

- [x] Driver route (when assigned), shift, stop marking, incident report, offline queue.
- [x] Collection agent ledger lookup, payment entry, on-screen receipt, daily reconciliation.
- [x] Email/password staff sign-in + sign out / switch user.
- [x] Driver dumpsite log and fuel log screens.
- [x] Driver confirm/decline for operator-initiated truck handoffs (Sprint 5).
- [ ] Resident registration, schedule, balance, payments, receipts, and missed collection reports.
- [ ] Harden offline queue with MMKV and stricter no-silent-pilot fallbacks where still needed.

## Integrations

- [x] Paystack webhook verification + idempotent payment posting (Sprint 3).
- [ ] Paystack checkout initiation and dedicated transfer account handling.
- [ ] Twilio WhatsApp reminders, receipts, and suspension notices.
- [ ] Termii SMS fallback.
- [ ] Expo Push Notifications for role-specific alerts.

## Quality

- [ ] Type checks and migration checks in CI.
- [x] Unit tests for Paystack shared validation and webhook signature / idempotency key helpers.
- [ ] Broader unit tests for remaining shared validation schemas.
- [ ] Browser smoke tests for critical operator flows.
- [ ] Real-device Android QA for driver and agent workflows.
