# CleanOps Roadmap

**Last reviewed:** 19 September 2026 — prefer [progress-snapshot.md](./progress-snapshot.md) and [agent-handover.md](./agent-handover.md) when this file and the codebase disagree.

## Phase 1: Core Ops Pilot

Target: Weeks 1-8 — **complete for pilot purposes**

- Supabase schema, auth, RLS, seed data, and app foundations. **(done)**
- Operator dashboard for daily metrics, routes, payments, staff, and alerts. **(done)**
- Driver mobile workflow for shift start, assigned route, stop marking, wrap-up, incidents, GPS/photo proof. **(done — multi-route view open)**
- Collection agent workflow for payment logging, on-screen receipts, and reconciliation. **(done — WhatsApp/PDF deferred)**
- Staff auth provisioning from Admin (login create + password reset). **(done)**
- Paystack payment confirmation webhook. **(done)**
- Truck reassignment / route takeover (operator initiate, driver confirm). **(done)**
- Frequency-aware routing + make-good / next-day unserviced recovery + coverage board. **(done)**
- LAWMA P1 compliance evidence. **(done)**
- Fleet board, dumpsites, maintenance, exportable reports, bulk customer import. **(done)**
- WhatsApp reminders and receipts through Twilio + Termii SMS fallback. **(done — needs provider secrets for live send)**
- Phone OTP auth. **(code done — live SMS / human QA parked on Termii)**
- Live truck GPS pings on Fleet map. **(done locally `0080` — confirm hosted)**
- CI / quality gate + hosted deploy. **(local quality-gate green; hosted through 0079 / Edge redeployed 29 Jul)**

Go-live trigger: one PSP operator live on one ward with three trucks and the full staff team.

## Phase 2: Resident Platform

Target: Weeks 9-14 — **mostly shipped; polish + secrets remaining**

- Resident onboarding via Admin-provisioned customer login. **(done — self-serve registration open)**
- Balance, payment history, and Paystack checkout/verify on web + mobile. **(done)**
- Collection schedule and recovery / missed-collection notices (inbox + make-good note). **(done)**
- Complaints with 24h SLA. **(done)**
- Push notification infrastructure + physical Android E2E. **(done 29 Jul)**
- Truck proximity / live GPS on fleet. **(done via `0080` pings; collection-confirmation polish optional)**
- Fleet and maintenance module (operator UI). **(done)**
- USSD payment fallback exploration. **(pending)**

Go-live trigger: 100+ active resident accounts in Zone A (after first ward pilot).

## Phase 3: Scale

Target: Weeks 15-22

- Multi-operator SaaS onboarding polish + plan-code enforcement. **(platform admin basics exist)**
- Analytics and P&L reporting. **(exportable reports shipped; deeper analytics open)**
- Platform owner admin dashboard. **(partial)**
- Payroll automation.
- Yoruba, Pidgin, and Igbo language packs.
- LAWMA reporting API integration.

Go-live trigger: second PSP operator onboarded.

## Now (pilot gates)

1. Termii (+ Twilio) secrets → OTP / Comms live QA  
2. Hosted sync through `0080` + commit/push local  
3. First design-partner ward on hosted (Growth; meter WhatsApp/SMS)  

See [progress-snapshot.md](./progress-snapshot.md), [build-plan.md](./build-plan.md), and [status-report.md](./status-report.md).
