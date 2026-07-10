# CleanOps Status Report

**As of:** 9 July 2026  
**Phase:** Phase 1 — Core Ops Pilot (Weeks 1–8 target)  
**Workspace:** TypeScript monorepo (`apps/web`, `apps/mobile`, `packages/shared`, `supabase/`)

---

## Executive Summary

CleanOps has a working **local pilot stack**: Supabase schema (26 migrations), operator web dashboard with five workflow tabs, driver and collection-agent mobile apps with live Supabase sync and offline queuing, staff login provisioning from Admin, operator-side agent collection reconciliation, Paystack webhook, and driver fuel/dumpsite field logging.

**Rough completion against Phase 1 backlog:**

| Area | Status |
|------|--------|
| Foundation (schema, shared types, local dev) | ~90% |
| Operator web (dashboard, routes, payments, staff, admin) | ~85% |
| Driver mobile | ~75% |
| Collection agent mobile | ~90% (WhatsApp/PDF receipts deferred) |
| Resident mobile | 0% |
| Integrations (Paystack, Twilio, Termii, push) | ~35% (Paystack webhook verified; checkout pending) |
| Quality (CI, tests, device QA) | ~15% (shared Paystack unit tests; no CI yet) |

The system is **demo-ready for operator + driver + collection agent field testing** on one ward. It is **not production-ready** — no OTP auth, Paystack checkout is not initiated from apps yet (webhook is wired), and no CI.

**Sprints:** Sprint 1–5 complete (through truck reassignment & route takeover). Next: Sprint 6 (admin edit flows).

---

## Built Modules

### 1. Platform Foundation

**What it does**

- npm workspaces monorepo with shared Zod schemas in `packages/shared`
- PostgreSQL schema: operators, zones, staff, trucks, customers, routes, route stops, payments, attendance, incidents, fuel logs, dumpsite runs, maintenance events
- 26 migrations (`0001`–`0026`) with RLS policies and role-aware RPCs
- Seed data for one pilot operator, zones, trucks, customers, routes, demo users (operator, driver, collection agent)
- Local Supabase via Docker CLI; web env via Vite `envDir`
- Pilot-mode fallbacks in web and mobile services when Supabase is not configured (live sessions no longer silently substitute pilot routes)

**Functional spec (delivered)**

| Capability | Detail |
|------------|--------|
| Multi-tenant data model | All tenant tables carry `operator_id`; RLS scopes by authenticated profile |
| Role enum | `operator_owner`, `operations_supervisor`, `driver`, `collection_agent`, `resident`, `platform_admin` |
| Auth helpers | `current_operator_id()`, `current_app_role()` |
| Shared validation | Zod schemas for routes, payments, attendance, admin, incidents, agent collections, staff login results |
| Demo credentials | `owner@cleanops.local`, `driver@cleanops.local`, `agent@cleanops.local` (seed); Admin can provision more |

**Pending**

- Phone OTP authentication (email/password demo + Admin-provisioned staff)
- Sentry error tracking
- Strict environment validation at startup
- CI pipeline (typecheck, migration checks)
- Unit tests for broader shared schemas beyond Paystack helpers
- Production deployment configuration
- Paystack checkout initiation (webhook + RPC are ready; apps do not start charges yet)

---

### 2. Operator Dashboard (Web)

**Location:** `apps/web` → Dashboard tab  
**Backend:** `operator_dashboard_snapshot(input_date)` RPC (migration `0010`)

**Functional spec (delivered)**

| Capability | Detail |
|------------|--------|
| Operations date control | Date selector drives all workflow views for a chosen day |
| Daily metrics | Route progress, daily revenue, staff attendance ratio, fleet status |
| Route summaries | Per-zone route cards with stop completion counts |
| Recent payments | Latest payment activity |
| Fleet snapshot | Truck registration, zone, status, maintenance reserve |
| Alerts | Operational alert strings from snapshot |
| Recent incidents | Incident list filtered by operations date |

**Pending**

- Real-time refresh (Supabase Realtime)
- Exportable reports (P&L, collections, attendance, fleet costs)
- Drill-down from metrics into detailed reports
- Platform-owner / multi-operator views (Phase 3)

---

### 3. Route Operations (Web)

**Location:** Routes tab  
**Backend:** `plan_daily_routes`, `update_route_stop_status`, `transition_route_status`, `route_planning_options`, `update_route_plan_assignment`, `add/remove/move_route_plan_stop` (migrations `0004`, `0010`–`0012`, `0014`–`0015`)

**Functional spec (delivered)**

| Capability | Detail |
|------------|--------|
| Route list by date | Two-column layout: route list + detail/planner |
| Plan from templates | `plan_daily_routes` clones recent route patterns onto a future date |
| Route planning (scheduled only) | Change truck/driver; add/remove/reorder stops before shift starts |
| Zone/truck guards | Truck must belong to route zone (migration `0012`) |
| Operator stop corrections | Override stop status on active/completed routes |
| Route cancellation | Operator can cancel; start/complete is field-only (driver mobile) |
| Inline errors | Validation errors shown near planner controls, not only top banner |
| Status lifecycle | `scheduled` → `in_progress` → `completed` / `cancelled` |
| Route progress reconcile | Derived stop counts synced via migrations `0014`–`0015` |

**Pending**

- Full schedule builder (recurring templates, loader assignment)
- Loader staff assignment on routes (schema has `driver_id` only)
- Route template management UI
- Audit log for operator corrections
- Route export / print
- GPS / photo proof on stops

---

### 4. Payment Ledger (Web)

**Location:** Payments tab  
**Backend:** `customer_ledger_snapshot`, `customer_payment_history`, `record_operator_payment`, `record_paystack_payment`, `update_customer_account_status`, `operator_agent_collections_snapshot` (migrations `0005`, `0019`, `0021`, `0025`)

**Functional spec (delivered)**

| Capability | Detail |
|------------|--------|
| Customer ledger | Balance, paid-this-month, outstanding, service status, suspension reason, last payment |
| Payment history | Per-customer payment timeline |
| Record payment | Manual entry with channel (cash, bank transfer, OPay, etc.) |
| Service status toggle | Suspend / reactivate customer service |
| Two-column layout | Customer list + detail panel |
| Agent collections | Sub-tab reconciles field agent cash by operations date; per-agent payment drill-down |
| Auto-activation | Full monthly payment reactivates suspended customers (migration `0019`) |
| Paystack webhook posting | Verified `charge.success` posts via Edge Function → `record_paystack_payment` |
| Live ledger refresh | Payments tab auto-refreshes every 20 seconds while open |

**Pending**

- Paystack checkout initiation from web
- Dedicated transfer account handling
- Receipt generation (PDF/WhatsApp) — deferred

---

### 5. Staff & Attendance (Web)

**Location:** Staff tab  
**Backend:** `attendance_snapshot`, `record_attendance_override`, `monthly_staff_summary` (migration `0006`)

**Functional spec (delivered)**

| Capability | Detail |
|------------|--------|
| Daily attendance | Checked-in vs absent per staff member for selected date |
| Supervisor override | Mark present/absent with reason and note |
| Monthly payroll summary | Days present/absent, estimated payroll per staff member |

**Pending**

- Staff directory as a standalone module (partially covered by Admin tab)
- Task assignment
- Performance notes
- Driver/agent self check-in from mobile
- Payroll automation and export (Phase 3)

---

### 6. Admin / Master Data (Web)

**Location:** Admin tab (`AdminView` component)  
**Backend:** `admin_master_data`, `onboard_staff_member`, `onboard_truck`, `onboard_customer`, `set_*_active`, `provision_staff_member_login`, `get_staff_password_reset_target` (migrations `0013`, `0020`, `0022`–`0024`)

**Functional spec (delivered)**

| Capability | Detail |
|------------|--------|
| Sub-tabs | Staff, Trucks, Customers with per-tab filters |
| Staff onboarding | Modal form with optional login email; auto-provisions Auth user + profile for field roles |
| Staff login management | Create login for existing staff; send password reset email; one-time temp password modal |
| Truck onboarding | Modal form: registration, zone, make/model/year, status; activate/deactivate |
| Customer onboarding | Modal form: zone, address, type, monthly rate, service status; suspend/reactivate |
| Zone reference | Read-only zone list for form dropdowns |
| Login indicator | `hasLoginProfile` + `loginEmail` on staff rows |
| Inline errors | Per-form and per-row error messages (not global banner only) |

**Pending**

- Edit existing staff/truck/customer records (create-only today)
- Zone CRUD (zones are seed-only)
- Auto-disable Auth user when staff deactivated

---

### 7. Driver Mobile App

**Location:** `apps/mobile` (Expo / React Native)  
**Backend:** `driver_assigned_route`, `sync_driver_stop_action`, `transition_route_status`, `report_driver_incident`, `record_fuel_log`, `record_dumpsite_run`, `driver_dumpsite_run_for_route` (migrations `0007`–`0009`, `0026`)

**Functional spec (delivered)**

| Capability | Detail |
|------------|--------|
| Shared sign-in | Email/password for provisioned staff; demo accounts available; show/hide password; keyboard-safe scroll |
| Role routing | Profile role opens Driver or Collection Agent workspace |
| Assigned route | Fetches today's route with stops when driver is assigned |
| Empty assignment | Live session with no route shows “Waiting for assignment” (no silent pilot stop list) |
| Start shift | Transitions route to `in_progress` |
| Stop actions | Complete or skip stops with optional note/reason |
| Fuel log entry | Litres, cost, station name logged against assigned route truck |
| Dumpsite run logging | Depart → arrive → cleared timestamps with optional tipping fee and notes |
| Incident reporting | Type, optional stop, title, description; syncs to `incident_reports` |
| Offline queue | Failed stop actions queued in AsyncStorage |
| Incident offline queue | Failed incidents also persisted and retried |
| Sync controls | Settings toggle for sync on/off; manual sync; last-sync timestamp |
| Sign out | Top bar + settings; switch user returns to sign-in |
| Safe area layout | `react-native-safe-area-context` |
| Network resilience | LAN IP config, backend diagnostics; pilot only when explicitly offline/pilot mode |

**Pending**

- Phone OTP auth
- GPS capture on stop completion
- Photo proof / Storage upload
- MMKV for faster durable queue (AsyncStorage in use; MMKV in deps but not wired)
- Multi-route list (single assigned route only)
- Push notifications for route changes

---

### 8. Collection Agent Mobile App

**Location:** `apps/mobile` → Collection Agent workflow (`AgentApp`, `CustomerPaymentModal`)  
**Backend:** `search_customers`, `record_agent_payment`, `agent_daily_collection_summary`, `reconcile_customer_service_after_payment` (migrations `0016`–`0019`)

**Functional spec (delivered)**

| Capability | Detail |
|------------|--------|
| Agent sign-in | Seed login or any Admin-provisioned agent account via email/password |
| Customer search | Search by name, phone, or address |
| Payment entry | Modal on customer select; channel selection; optional receipt reference |
| Transaction history | Per-customer payment timeline in payment modal |
| Receipt confirmation | On-screen receipt reference after payment; share via native Share sheet |
| Daily summary | End-of-day collection count and total kobo |
| Offline queue | Payment actions queued and synced when back online |
| Auto-activation | Full payment reactivates suspended customer service |
| Suspension context | Suspension reason shown on customer cards and payment modal |

**Pending**

- WhatsApp/SMS receipt delivery
- Printed PDF receipts

---

### 9. Incident Reporting (Cross-surface)

**Functional spec (delivered)**

| Surface | Capability |
|---------|------------|
| Mobile | Full incident form with 7 incident types; offline queue |
| Web dashboard | Recent incidents list on dashboard, filtered by date |
| Backend | `report_driver_incident` RPC with driver auth guard; `recent_incident_reports` |

**Pending**

- Operator incident resolution workflow (mark resolved, assign follow-up)
- Incident detail view on web
- Incident type stored/displayed consistently on web list
- Notifications on new incidents

---

### 10. Backend RPC Inventory (Built)

| RPC | Purpose |
|-----|---------|
| `operator_dashboard_snapshot` | Dashboard metrics + summaries |
| `plan_daily_routes` | Clone routes to a future date |
| `route_planning_options` | Zones, trucks, drivers, customers for planner |
| `update_route_plan_assignment` | Change truck/driver on scheduled route |
| `add/remove/move_route_plan_stop` | Stop CRUD on scheduled routes |
| `update_route_stop_status` | Stop status updates (driver + operator) |
| `transition_route_status` | Route lifecycle transitions |
| `driver_assigned_route` | Driver's route for a date |
| `sync_driver_stop_action` | Idempotent driver stop sync |
| `report_driver_incident` | Driver incident creation |
| `record_fuel_log` | Driver fuel purchase log |
| `record_dumpsite_run` | Driver dumpsite depart/arrive/clear |
| `driver_dumpsite_run_for_route` | Current dumpsite run for route |
| `recent_incident_reports` | Dashboard incident feed |
| `customer_ledger_snapshot` | Payment ledger |
| `customer_payment_history` | Per-customer payments |
| `record_operator_payment` | Manual payment entry |
| `record_paystack_payment` | Idempotent Paystack webhook posting (service_role) |
| `update_customer_account_status` | Suspend/reactivate |
| `search_customers` | Agent customer lookup |
| `record_agent_payment` | Idempotent agent payment with receipt |
| `agent_daily_collection_summary` | Per-agent daily totals |
| `operator_agent_collections_snapshot` | Operator reconciliation by date |
| `reconcile_customer_service_after_payment` | Auto-activate on full payment |
| `attendance_snapshot` | Daily attendance |
| `record_attendance_override` | Supervisor override |
| `monthly_staff_summary` | Payroll estimate |
| `admin_master_data` | Admin lists |
| `onboard_staff/truck/customer` | Master data creation |
| `provision_staff_member_login` | Create Auth login for existing staff |
| `get_staff_password_reset_target` | Operator-scoped email for password reset |
| `set_staff/truck_active`, `set_customer_service_status` | Deactivation |

---

## Modules Not Yet Built

These are in `docs/roadmap.md` and `docs/backlog.md` but have **no implementation** (or schema-only stubs):

| Module | Phase | Notes |
|--------|-------|-------|
| **Resident mobile** | 2 | Registration, schedule, balance, payments, missed collection |
| **Fleet operations UI** | 1–2 | Driver mobile fuel/dumpsite done; operator web fleet views still pending |
| **Paystack integration** | 1 | Webhook verified + RPC posted; checkout initialize still pending |
| **Twilio WhatsApp** | 1 | `send-reminders` Edge Function stub only |
| **Termii SMS** | 1 | Not started |
| **Expo push notifications** | 1 | Not started |
| **Phone OTP auth** | 1 | Not started (email/password + Admin provisioned staff in place) |
| **Exportable reports** | 1 | P&L, collections, attendance, fleet cost exports |
| **CI / automated testing** | 1 | No `.github/` workflows; no unit/smoke tests |
| **Real-time sync** | 1+ | Supabase Realtime not wired |
| **Audit log** | 1 | Operator corrections not tracked |
| **Multi-tenant SaaS onboarding** | 3 | Schema-ready; no platform admin UI |
| **Payroll automation** | 3 | Monthly summary only |
| **i18n (Yoruba, Pidgin, Igbo)** | 3 | Not started |
| **LAWMA reporting API** | 3 | Not started |

---

## Schema vs UI Gap

Several tables have RLS policies but **no application layer**:

- `fuel_logs` — driver RPC + mobile UI delivered; no operator web view yet
- `dumpsite_runs` — driver RPC + mobile UI delivered; no operator web view yet
- `maintenance_events` — schema only; no fleet maintenance calendar

---

## Immediate Next Action Steps

Ordered by impact on Phase 1 go-live (*one PSP, one ward, three trucks, full staff team*):

### 1. End-to-end pilot validation

Run a full day simulation including truck handoff: propose reassignment on Routes → confirm on driver mobile → verify truck/driver update.

### 2. Admin edit flows

Allow updating existing staff, truck, and customer records (not just create + deactivate).

### 3. Quality gate before go-live

Add CI (`typecheck` + migration lint), smoke tests for sign-in / plan routes / record payment, and one real Android device QA pass for driver and agent offline sync.

### 4. Admin edit flows

Allow updating existing staff, truck, and customer records (not just create + deactivate).

### 5. Paystack checkout initiate (follow-on)

Apps still need a Paystack initialize/checkout that attaches `metadata.operator_id` and `metadata.customer_id` before live resident payments.

### 6. Collection agent receipts (deferred)

WhatsApp/SMS and PDF receipt delivery after core pilot validation.

---

## How to Run Today

```bash
npm install
supabase start          # or supabase db reset for fresh seed
supabase migration up   # apply any new migrations (includes 0025 Paystack RPC)
npm run dev:web         # http://localhost:5173
npm run dev:mobile      # npx expo start -c; set LAN IP in apps/mobile/.env.local
```

For staff password reset emails locally, open Inbucket / Mailpit at http://localhost:54324 after calling **Send reset email** in Admin.

### Sprint 3 — Paystack webhook tests

**1. Unit tests (no Docker required)**

```bash
npm test                # runs Vitest in packages/shared (signature + idempotency helpers)
npm run typecheck
```

**2. Apply migration + serve the Edge Function**

Create `.env.functions.local` (gitignored):

```bash
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<from: supabase status -o env>
PAYSTACK_SECRET_KEY=sk_test_local_cleanops
```

```bash
supabase migration up
supabase functions serve --env-file .env.functions.local --no-verify-jwt
```

**3. Signed webhook smoke (second terminal)**

```bash
# PowerShell
$env:PAYSTACK_SECRET_KEY="sk_test_local_cleanops"
npm run test:paystack:post          # one charge.success
npm run test:paystack:idempotent    # same reference twice → alreadyPosted: true
npm run test:paystack:sign          # print raw body + signature for curl
```

Default smoke target: Blue Gate Mini Mart (`…404`) with ₦15,000 (`AMOUNT_KOBO=1500000`). Override with `CUSTOMER_ID`, `AMOUNT_KOBO`, `REFERENCE`, `PAYSTACK_WEBHOOK_URL`.

**4. Confirm on operator web**

Sign in as `owner@cleanops.local`, open **Payments**. Within ~20 seconds the Paystack row should appear (or click **Refresh data**). Full-month payments should clear suspension on that customer.

**5. Optional SQL check**

```sql
select * from public.payments where idempotency_key like 'paystack:%' order by paid_at desc limit 5;
```

| Role | Credentials |
|------|-------------|
| Operator (web) | `owner@cleanops.local` / `cleanops-demo-password` |
| Driver (mobile) | `driver@cleanops.local` / `cleanops-driver-password` |
| Collection agent (mobile) | `agent@cleanops.local` / `cleanops-agent-password` |
| Newly onboarded staff | Temp password shown once in Admin credentials modal |

---

## Summary

CleanOps has a solid **operator command center** (dashboard, routes, payments with agent reconciliation, staff, admin with staff login provisioning) and **field apps** for drivers and collection agents with offline resilience. Sprint 1–4 are complete through driver fuel/dumpsite field logging.

The highest-leverage next builds are **end-to-end pilot validation**, **driver field completeness**, and a **quality gate** before expanding into resident mobile / checkout initiate.

See [build-plan.md](./build-plan.md) for sprint sequencing.
