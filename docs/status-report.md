# CleanOps Status Report

**As of:** 23 June 2026  
**Phase:** Phase 1 — Core Ops Pilot (Weeks 1–8 target)  
**Workspace:** TypeScript monorepo (`apps/web`, `apps/mobile`, `packages/shared`, `supabase/`)

---

## Executive Summary

CleanOps has a working **local pilot stack**: Supabase schema (13 migrations), operator web dashboard with five workflow tabs, and a driver mobile app with live Supabase sync and offline queuing. The platform covers daily operations for a single PSP operator — routes, payments, staff attendance, incidents, and master-data onboarding.

**Rough completion against Phase 1 backlog:**

| Area | Status |
|------|--------|
| Foundation (schema, shared types, local dev) | ~75% |
| Operator web (dashboard, routes, payments, staff, admin) | ~60% |
| Driver mobile | ~55% |
| Collection agent mobile | 0% |
| Resident mobile | 0% |
| Integrations (Paystack, Twilio, Termii, push) | ~10% (stubs only) |
| Quality (CI, tests, device QA) | ~5% |

The system is **demo-ready for operator + driver field testing** on one ward. It is **not production-ready** — no OTP auth, no collection-agent workflow, no payment webhooks wired, and no CI.

---

## Built Modules

### 1. Platform Foundation

**What it does**

- npm workspaces monorepo with shared Zod schemas in `packages/shared`
- PostgreSQL schema: operators, zones, staff, trucks, customers, routes, route stops, payments, attendance, incidents, fuel logs, dumpsite runs, maintenance events
- 13 migrations (`0001`–`0013`) with RLS policies and role-aware RPCs
- Seed data for one pilot operator, zones, trucks, customers, routes, demo users
- Local Supabase via Docker CLI; web env via Vite `envDir`
- Pilot-mode fallbacks in web services when Supabase is not configured

**Functional spec (delivered)**

| Capability | Detail |
|------------|--------|
| Multi-tenant data model | All tenant tables carry `operator_id`; RLS scopes by authenticated profile |
| Role enum | `operator_owner`, `operations_supervisor`, `driver`, `collection_agent`, `resident`, `platform_admin` |
| Auth helpers | `current_operator_id()`, `current_app_role()` |
| Shared validation | Zod schemas for all domain types (routes, payments, attendance, admin, incidents) |
| Demo credentials | `owner@cleanops.local` / `driver@cleanops.local` (seed) |

**Pending**

- Phone OTP authentication (email/password demo only)
- Sentry error tracking
- Strict environment validation at startup
- CI pipeline (typecheck, migration checks)
- Unit tests for shared schemas and webhook idempotency
- Production deployment configuration
- Edge Function signature verification (Paystack webhook has no signature check yet)

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
**Backend:** `plan_daily_routes`, `update_route_stop_status`, `transition_route_status`, `route_planning_options`, `update_route_plan_assignment`, `add/remove/move_route_plan_stop` (migrations `0004`, `0010`–`0012`)

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
**Backend:** `customer_ledger_snapshot`, `customer_payment_history`, `record_operator_payment`, `update_customer_account_status` (migration `0005`)

**Functional spec (delivered)**

| Capability | Detail |
|------------|--------|
| Customer ledger | Balance, paid-this-month, outstanding, service status, last payment |
| Payment history | Per-customer payment timeline |
| Record payment | Manual entry with channel (cash, bank transfer, OPay, etc.) |
| Service status toggle | Suspend / reactivate customer service |
| Two-column layout | Customer list + detail panel |

**Pending**

- Paystack checkout initiation from web
- Automated payment posting via webhook (stub exists, not deployed/verified)
- Receipt generation (PDF/WhatsApp)
- Collection-agent reconciliation view
- Dedicated transfer account handling
- Current-month tag automation on payment

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

**Location:** Admin tab  
**Backend:** `admin_master_data`, `onboard_staff_member`, `onboard_truck`, `onboard_customer`, `set_*_active` (migration `0013`)

**Functional spec (delivered)**

| Capability | Detail |
|------------|--------|
| Staff onboarding | Name, phone, role, monthly salary; list with active/inactive toggle |
| Truck onboarding | Registration, zone, make/model/year, status; activate/deactivate |
| Customer onboarding | Zone, address, type, monthly rate, service status; suspend/reactivate |
| Zone reference | Read-only zone list for form dropdowns |
| Login indicator | `hasLoginProfile` flag shows whether staff has a linked Supabase auth user |

**Pending**

- Edit existing staff/truck/customer records (create-only today)
- Provision Supabase auth users when onboarding staff/drivers
- Zone CRUD (zones are seed-only)
- Link `profile_id` on staff from admin UI
- Collection-agent and supervisor-specific admin flows

---

### 7. Driver Mobile App

**Location:** `apps/mobile` (Expo / React Native)  
**Backend:** `driver_assigned_route`, `sync_driver_stop_action`, `transition_route_status`, `report_driver_incident` (migrations `0007`–`0009`)

**Functional spec (delivered)**

| Capability | Detail |
|------------|--------|
| Driver sign-in | Demo email/password via Supabase Auth |
| Assigned route | Fetches today's (or configured) route with stops |
| Start shift | Transitions route to `in_progress` |
| Stop actions | Complete or skip stops with optional note/reason |
| Incident reporting | Type, optional stop, title, description; syncs to `incident_reports` |
| Offline queue | Failed stop actions queued in AsyncStorage |
| Incident offline queue | Failed incidents also persisted and retried |
| Sync controls | Settings toggle for sync on/off; manual sync; last-sync timestamp |
| Per-stop sync state | Visual indicator for pending/failed offline items |
| Safe area layout | `react-native-safe-area-context` |

**Pending**

- Real login UI (phone OTP, not hardcoded demo sign-in)
- Dumpsite run logging (`dumpsite_runs` table exists, no UI/RPC)
- Fuel log entry (`fuel_logs` table exists, no UI/RPC)
- GPS capture on stop completion
- Photo proof / Storage upload
- MMKV for faster durable queue (AsyncStorage in use; MMKV in deps but not wired)
- Multi-route list (single assigned route only)
- Push notifications for route changes

---

### 8. Incident Reporting (Cross-surface)

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

### 9. Backend RPC Inventory (Built)

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
| `recent_incident_reports` | Dashboard incident feed |
| `customer_ledger_snapshot` | Payment ledger |
| `customer_payment_history` | Per-customer payments |
| `record_operator_payment` | Manual payment entry |
| `update_customer_account_status` | Suspend/reactivate |
| `attendance_snapshot` | Daily attendance |
| `record_attendance_override` | Supervisor override |
| `monthly_staff_summary` | Payroll estimate |
| `admin_master_data` | Admin lists |
| `onboard_staff/truck/customer` | Master data creation |
| `set_staff/truck_active`, `set_customer_service_status` | Deactivation |

---

## Modules Not Yet Built

These are in `docs/roadmap.md` and `docs/backlog.md` but have **no implementation** (or schema-only stubs):

| Module | Phase | Notes |
|--------|-------|-------|
| **Collection agent mobile** | 1 | Ledger lookup, payment entry, receipt, daily reconciliation — highest-priority gap |
| **Resident mobile** | 2 | Registration, schedule, balance, payments, missed collection |
| **Fleet operations UI** | 1–2 | `fuel_logs`, `dumpsite_runs`, `maintenance_events` tables exist; no web or mobile UI |
| **Paystack integration** | 1 | Edge Function stub only; no checkout, no signature verification, not deployed |
| **Twilio WhatsApp** | 1 | `send-reminders` Edge Function stub only |
| **Termii SMS** | 1 | Not started |
| **Expo push notifications** | 1 | Not started |
| **Phone OTP auth** | 1 | Not started |
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

- `fuel_logs` — insert policy for drivers; no RPC or mobile screen
- `dumpsite_runs` — read policy only; no RPC or mobile screen
- `maintenance_events` — schema only; no fleet maintenance calendar

---

## Immediate Next Action Steps

Ordered by impact on Phase 1 go-live (*one PSP, one ward, three trucks, full staff team*):

### 1. Collection agent mobile workflow (critical path)

The largest missing Phase 1 slice. Agents are in seed data and payment RLS already allows `collection_agent` inserts. Build: customer lookup, payment entry, receipt reference, end-of-day reconciliation — mirroring the driver app's Supabase + offline pattern.

### 2. Admin: auth provisioning for new staff

Onboarding creates `staff_members` rows but not login profiles. Wire `onboard_staff_member` (or a follow-up RPC) to create Supabase Auth users and link `profile_id`, so new drivers/agents can sign in without manual DB work.

### 3. Paystack webhook hardening + deployment

Add signature verification to `supabase/functions/paystack-webhook`, deploy locally/staging, and connect payment confirmation to ledger refresh on web.

### 4. End-to-end pilot validation

Run a full day simulation: plan tomorrow's routes on web → driver completes stops on device → operator sees live updates → record agent cash payment → verify ledger and attendance.

### 5. Driver field completeness

Add dumpsite and fuel log screens (tables and RLS already exist). These are on the Phase 1 backlog and needed for operational completeness.

### 6. Quality gate before go-live

Add CI (`typecheck` + migration lint), smoke tests for sign-in / plan routes / record payment, and one real Android device QA pass for driver sync and offline recovery.

### 7. Admin edit flows

Allow updating existing staff, truck, and customer records (not just create + deactivate).

---

## How to Run Today

```bash
npm install
supabase start          # or supabase db reset for fresh seed
npm run dev:web         # http://localhost:5173
npm run dev:mobile      # Expo; set LAN IP in apps/mobile/.env.local
```

| Role | Credentials |
|------|-------------|
| Operator (web) | `owner@cleanops.local` / `cleanops-demo-password` |
| Driver (mobile) | `driver@cleanops.local` / `cleanops-driver-password` |

---

## Summary

CleanOps has a solid **operator command center** (dashboard, routes, payments, staff, admin) and a **functional driver field app** with offline resilience. The database and RPC layer are ahead of the mobile surface area — collection agent, fleet logging, and integrations are the main gaps before a real ward pilot.

The single highest-leverage next build is the **collection agent mobile workflow**, followed by **staff auth provisioning** and **Paystack webhook** so payments can flow without manual operator entry.
