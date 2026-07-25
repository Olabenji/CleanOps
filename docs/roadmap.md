# CleanOps Roadmap

**Last reviewed:** 22 July 2026 — prefer [status-report.md](./status-report.md) and [agent-handover.md](./agent-handover.md) when this file and the codebase disagree.

## Phase 1: Core Ops Pilot

Target: Weeks 1-8 — **largely complete locally**

- Supabase schema, auth, RLS, seed data, and app foundations. **(done)**
- Operator dashboard for daily metrics, routes, payments, staff, and alerts. **(done)**
- Driver mobile workflow for shift start, assigned route, stop marking, wrap-up, and incident reports. **(done — GPS/photo still open)**
- Collection agent workflow for payment logging, on-screen receipts, and reconciliation. **(done — WhatsApp/PDF deferred)**
- Staff auth provisioning from Admin (login create + password reset). **(done)**
- Paystack payment confirmation webhook. **(done)**
- Truck reassignment / route takeover (operator initiate, driver confirm). **(done)**
- Frequency-aware routing + make-good / next-day unserviced recovery. **(done — coverage board UI open)**
- LAWMA P1 compliance evidence. **(done)**
- WhatsApp reminders and receipts through Twilio. **(done — Termii SMS fallback; needs provider secrets)**
- CI / quality gate + hosted deploy. **(pending — next)**

Go-live trigger: one PSP operator live on one ward with three trucks and the full staff team.

## Phase 2: Resident Platform

Target: Weeks 9-14 — **foundation shipped; polish + push remaining**

- Resident onboarding via Admin-provisioned customer login. **(done — self-serve registration open)**
- Balance, payment history, and Paystack checkout/verify on web + mobile. **(done)**
- Collection schedule and recovery / missed-collection notices (inbox + make-good note). **(done)**
- Complaints with 24h SLA. **(done)**
- Push notification infrastructure (devices, outbox, dispatch). **(done — live device push needs EAS/dev build)**
- Truck proximity and collection confirmation notifications. **(partial / pending)**
- Fleet and maintenance module (operator UI). **(pending)**
- USSD payment fallback exploration. **(pending)**

Go-live trigger: 100+ active resident accounts in Zone A.

## Phase 3: Scale

Target: Weeks 15-22

- Multi-operator SaaS onboarding polish. **(platform admin basics exist)**
- Analytics and P&L reporting.
- Platform owner admin dashboard. **(partial)**
- Payroll automation.
- Yoruba, Pidgin, and Igbo language packs.
- LAWMA reporting API integration.

Go-live trigger: second PSP operator onboarded.

See [build-plan.md](./build-plan.md) and [status-report.md](./status-report.md) for current status.
