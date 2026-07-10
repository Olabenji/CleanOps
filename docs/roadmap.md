# CleanOps Roadmap

## Phase 1: Core Ops Pilot

Target: Weeks 1-8

- Supabase schema, auth, RLS, seed data, and app foundations. **(done)**
- Operator dashboard for daily metrics, routes, payments, staff, and alerts. **(done)**
- Driver mobile workflow for shift start, assigned route, stop marking, and incident reports. **(done — dumpsite/fuel pending)**
- Collection agent workflow for payment logging, on-screen receipts, and reconciliation. **(done — WhatsApp/PDF deferred)**
- Staff auth provisioning from Admin (login create + password reset). **(done)**
- Paystack payment confirmation webhook. **(done — Sprint 3)**
- Truck reassignment / route takeover (operator initiate, driver confirm). **(done — Sprint 5)**
- WhatsApp reminders and receipts through Twilio. **(deferred)**

Go-live trigger: one PSP operator live on one ward with three trucks and the full staff team.

## Phase 2: Resident Platform

Target: Weeks 9-14

- Resident onboarding and ledger matching.
- Balance, payment history, and Paystack payment flow.
- Collection schedule and missed collection reports.
- Truck proximity and collection confirmation notifications.
- Fleet and maintenance module.
- USSD payment fallback exploration.

Go-live trigger: 100+ active resident accounts in Zone A.

## Phase 3: Scale

Target: Weeks 15-22

- Multi-operator SaaS onboarding.
- Analytics and P&L reporting.
- Platform owner admin dashboard.
- Payroll automation.
- Yoruba, Pidgin, and Igbo language packs.
- LAWMA reporting API integration.

Go-live trigger: second PSP operator onboarded.

See [build-plan.md](./build-plan.md) and [status-report.md](./status-report.md) for current sprint status.

