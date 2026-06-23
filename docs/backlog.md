# CleanOps Implementation Backlog

## Foundation

- Define database schema, enums, RLS policies, and seed data for a single pilot operator.
- Configure Supabase local development and migration workflow.
- Implement phone OTP auth and role-aware session loading.
- Create shared TypeScript domain models and validation schemas.
- Add Sentry and environment validation.

## Operator Web

- Dashboard metrics: route progress, daily revenue, staff attendance, fleet status, and alerts.
- Route schedule builder with truck, driver, loader, and zone assignments.
- Resident ledger with status, balance, current-month tag, and payment history.
- Staff directory, attendance log, task assignment, payroll summary, and performance notes.
- Fleet profiles, fuel logs, maintenance calendar, reserve tracking, and breakdown incidents.
- Exportable reports for P&L, collections, attendance, and fleet costs.

## Mobile

- Driver route list, active shift, stop marking, dumpsite log, fuel log, and incident report.
- Collection agent ledger lookup, payment entry, receipt issue, and daily reconciliation.
- Resident registration, schedule, balance, payments, receipts, and missed collection reports.
- Offline queue with sync status and idempotent replay.

## Integrations

- Paystack checkout, dedicated transfer account handling, and webhook verification.
- Twilio WhatsApp reminders, receipts, and suspension notices.
- Termii SMS fallback.
- Expo Push Notifications for role-specific alerts.

## Quality

- Type checks and migration checks in CI.
- Unit tests for shared validation and payment webhook idempotency.
- Browser smoke tests for critical operator flows.
- Real-device Android QA for driver and agent workflows.
