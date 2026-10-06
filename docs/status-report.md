# CleanOps Status Report

**As of:** 19 September 2026 (executive summary refresh; module sections below may lag — prefer [progress-snapshot.md](./progress-snapshot.md) and [agent-handover.md](./agent-handover.md))  
**Phase:** Phase 1 complete; Phase 2 largely shipped; pilot-ready / near production  
**Workspace:** TypeScript monorepo (`apps/web`, `apps/mobile`, `packages/shared`, `supabase/`)  
**Canonical handover:** [agent-handover.md](./agent-handover.md) · [progress-snapshot.md](./progress-snapshot.md)

---

## Executive Summary

CleanOps is **past demo and into pilot-ready / near production**. Operator web covers dashboard, routes, payments, staff, coverage, compliance, fleet, reports, comms, settings, and admin. Shared Expo mobile covers **driver / collection agent / resident** with frequency-aware routing, make-good recovery, field GPS/photo proof, live truck GPS pings (`0080`), Paystack, complaints, and Android push E2E (29 Jul). Phone OTP is implemented (`0078`); live SMS QA is parked on Termii secrets.

**Rough completion:**

| Area | Status |
|------|--------|
| Foundation (schema, shared types, local/hosted) | ~98% (local through `0080`; hosted through `0079`) |
| Operator web (incl. fleet, reports, comms, settings, coverage) | ~95% |
| Driver mobile | ~90% (multi-route view still open) |
| Collection agent mobile | ~90% (PDF receipts deferred) |
| Resident web + mobile | ~90% (push E2E done; polish remains) |
| Integrations (Paystack, Twilio, Termii, push, OTP) | ~85% (live Termii/Twilio secrets + OTP human QA open) |
| Quality (CI, tests, device QA) | ~70% (local quality-gate green; remote `gh` CI not verified; driver/agent device QA open) |

**Go-live trigger:** one PSP, one ward, ~3 trucks, full staff on hosted — not more features.  
**Next human gates:** Termii/Twilio secrets → OTP/Comms QA → confirm hosted `0080` → first design-partner ward pilot (meter WhatsApp/SMS).  
**Recent tip:** `5df9593` fleet/reports/field proof/bulk import/comms; local may also hold banner + OTP + live GPS until committed.

---

## Built Modules

### 1. Platform Foundation

**What it does**

- npm workspaces monorepo with shared Zod schemas in `packages/shared`
- PostgreSQL schema: operators, zones, staff, trucks, customers, routes, route stops, payments, attendance, incidents, fuel logs, dumpsite runs, maintenance events
- Migrations through `0059` with RLS policies and role-aware RPCs (frequency make-good, unserviced recovery, resident auth/home/complaints/Paystack, notifications outbox)
- Seed data for pilot operators, zones, trucks, customers, routes, demo users (operator, driver, collection agent); residents via Admin-provisioned customer logins
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
- Production / hosted Supabase migration + Edge Function deploy
- Phone OTP remains open (email/password + Admin-provisioned staff/residents in place)

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
| Alerts | Operational alert strings from snapshot (open/overdue make-goods, stale incomplete routes) |
| Recent incidents | Incident list filtered by operations date |
| Compliance | LAWMA P1 evidence view (`ComplianceView`, migration `0049`) |

**Pending**

- Dedicated make-good / coverage operator board (open recoveries, due_by, skip reason)
- Real-time refresh (Supabase Realtime)
- Exportable reports (P&L, collections, attendance, fleet costs)
- Drill-down from metrics into detailed reports
- Platform-owner multi-operator polish (basic platform admin exists)

---

### 3. Route Operations (Web)

**Location:** Routes tab  
**Backend:** `plan_daily_routes`, `update_route_stop_status`, `transition_route_status`, `route_planning_options`, `update_route_plan_assignment`, `add/remove/move_route_plan_stop` (migrations `0004`, `0010`–`0012`, `0014`–`0015`)

**Functional spec (delivered)**

| Capability | Detail |
|------------|--------|
| Route list by date | Two-column layout: route list + detail/planner |
| Plan from templates | `plan_daily_routes` / `ensure_daily_routes_loaded` apply zone default templates (migration `0031`) |
| Route planning (scheduled only) | Change truck/driver; add/remove/reorder stops before shift starts |
| Template pending banner | After plan edits, banner offers save to zone default / temp / discard; modal only on leave/sign-out |
| Zone/customer guards | Customer stops must match route zone. Trucks are floaters (home zone optional; migration `0030`) |
| Driver default-load fallback | If today has no routes, driver can load zone templates from mobile |
| Driver route-change notices | In-app notices when operator edits an assigned route plan |
| Operator stop corrections | Override stop status on active/completed routes |
| Route cancellation | Operator can cancel; start/complete is field-only (driver mobile) |
| Inline errors | Validation errors shown near planner controls, not only top banner |
| Status lifecycle | `scheduled` → `in_progress` → `completed` / `cancelled` |
| Route progress reconcile | Derived stop counts synced via migrations `0014`–`0015` |
| Frequency-aware plan | `plan_daily_routes` filters by `preferred_weekdays` and merges open recoveries (`0058`/`0059`) |
| Make-good stops | `is_make_good` badge; linked `route_stop_make_goods` resolve on complete |
| Close incomplete | Supervisor `finalize_route_with_unserviced` → next-calendar-day recovery + resident notice |
| Suspended stops | Complete blocked on driver + operator; Skip still allowed |

**Pending**

- Make-good / coverage list UI (ADO #143 slim — no map first)
- Full schedule builder (recurring calendar UI / loader assignment)
- Loader staff assignment on routes (schema has `driver_id` only)
- Expo push for route-change notices (in-app notices delivered; resident recovery push infra exists)
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

- Dedicated transfer account / virtual account handling
- Receipt generation (PDF/WhatsApp) — deferred

**Note:** Resident Paystack **checkout + verify** Edge Functions are shipped (web + mobile). Operator Payments tab still records manual / webhook posts; resident-initiated checkout lives on the resident surfaces.

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
**Backend:** `admin_master_data`, `onboard_*`, `update_staff_member`, `update_truck`, `update_customer`, `set_*_active`, `provision_staff_member_login`, `get_staff_password_reset_target` (migrations `0013`, `0020`, `0022`–`0024`, `0042`)

**Functional spec (delivered)**

| Capability | Detail |
|------------|--------|
| Sub-tabs | Staff, Trucks, Customers with per-tab filters |
| Staff onboarding | Modal form with optional login email; auto-provisions Auth user + profile for field roles |
| Staff / truck / customer edit | Edit button opens prefilled modal; identity, salary, fleet, and billing fields (Sprint 8) |
| Staff login management | Create login for existing staff; send password reset email; one-time temp password modal |
| Truck onboarding | Modal form: registration, zone, make/model/year, status; activate/deactivate |
| Customer onboarding | Modal form: zone, address, type, monthly rate, service status; suspend/reactivate |
| Staff roles | Includes `loader` (crew) separate from `driver` (migration `0034`) |
| Login indicator | `hasLoginProfile` + `loginEmail` on staff rows |
| Inline errors | Per-form and per-row error messages (not global banner only) |

**Pending**

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
| Role routing | Profile role opens Driver, Collection Agent, or Resident workspace |
| Assigned route | Fetches today's route with stops when driver is assigned |
| Empty assignment | Live session with no route shows “Waiting for assignment” (no silent pilot stop list) |
| Start shift | Transitions route to `in_progress` |
| Stop actions | Complete or skip stops with optional note/reason; Complete disabled when customer suspended |
| Make-good | `isMakeGood` surfaced on stop cards |
| Wrap-up | Driver route wrap-up without auto-completing pending stops (migration `0050`) |
| Fuel log entry | Litres, cost, station name logged against assigned route truck |
| Dumpsite run logging | Depart → arrive → cleared timestamps with optional tipping fee and notes |
| Incident reporting | Type, optional stop, title, description; syncs to `incident_reports` |
| Offline queue | Failed stop actions queued in AsyncStorage |
| Incident offline queue | Failed incidents also persisted and retried |
| Sync controls | Settings toggle for sync on/off; manual sync; last-sync timestamp |
| Sign out | Per-app chrome + settings; switch user returns to sign-in |
| Safe area layout | `react-native-safe-area-context` |
| Network resilience | LAN IP config, backend diagnostics; pilot only when explicitly offline/pilot mode |

**Pending**

- Phone OTP auth
- GPS capture on stop completion
- Photo proof / Storage upload
- MMKV for faster durable queue (AsyncStorage in use; MMKV in deps but not wired)
- Multi-route list (single assigned route only)
- Push notifications for route changes / handoffs

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

### 9. Resident surfaces (Web + Mobile) — shipped foundation

**Location:** `apps/web` → `ResidentApp`; `apps/mobile` → `ResidentApp` (+ Pay / Issues screens)  
**Backend:** migrations `0053`–`0059` — `get_resident_home`, complaints RPCs, Paystack Edge Functions, notifications inbox/outbox

**Functional spec (delivered)**

| Capability | Detail |
|------------|--------|
| Resident auth | Customer-linked `resident` role; Admin provisions logins |
| Know Your PSP | Brand, operator, LAWMA ref, zone trucks |
| Schedule | Preferred weekdays + recovery note (`makeGood.targetDate`) when active |
| Account | Outstanding, monthly rate, paid-this-month, last payment |
| Paystack checkout | `resident-paystack-checkout` + verify; mobile `cleanops://paystack-return` callback |
| Complaints | Submit + history with 24h SLA copy |
| Inbox | `resident_notifications` list + mark-read |
| Push foundation | `resident_push_devices` + `notification_outbox` + `dispatch-resident-notifications`; Expo Go safely skips remote push (SDK 53+) |

**Pending**

- Real Expo push on physical device via development/production build + `EXPO_PUBLIC_EAS_PROJECT_ID`
- Tap deep-link routing from push payload
- Self-serve resident registration / onboarding outside Admin provision

---

### 10. Incident Reporting (Cross-surface)

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

### 11. Backend RPC Inventory (Built — selected)

Core Phase 1 RPCs remain as below. **Also shipped:** `finalize_route_with_unserviced`, `enqueue_collection_make_good`, `resolve_linked_make_goods`, `get_resident_home`, resident complaint/payment helpers, `register_resident_push_device`, `list_my_resident_notifications`, `claim_notification_outbox` / `complete_notification_outbox` (service_role), LAWMA compliance RPCs (`0049`), operation calendar / timezone helpers (`0051`–`0052`).

| RPC | Purpose |
|-----|---------|
| `operator_dashboard_snapshot` | Dashboard metrics + summaries (+ make-good / stale-route alerts) |
| `plan_daily_routes` | Frequency-aware plan + recovery merge |
| `route_planning_options` | Zones, trucks, drivers, customers for planner |
| `update_route_plan_assignment` | Change truck/driver on scheduled route |
| `add/remove/move_route_plan_stop` | Stop CRUD on scheduled routes |
| `update_route_stop_status` | Stop status updates (driver + operator); enqueues/resolves make-good |
| `finalize_route_with_unserviced` | Supervisor close incomplete → next-day recoveries |
| `transition_route_status` | Route lifecycle transitions |
| `driver_assigned_route` | Driver's route for a date (`isMakeGood` on stops) |
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
| `get_resident_home` | Resident portal home payload |

---

## Modules Still Pending

| Module | Priority | Notes |
|--------|----------|-------|
| **CI / quality gate** | P0 | Typecheck, migration checks, browser smoke, Android QA |
| **Hosted deploy** | P0 | Apply `0058`/`0059` (+ peers) to hosted Supabase; deploy Edge Functions; real secrets |
| **Make-good / Coverage board** | P1 | Operator list of open recoveries (#143 slim; map later) |
| **Real Expo push** | P0/P1 | Dev build + EAS credentials; Expo Go cannot receive remote push on SDK 53+ |
| **Fleet operations UI** | P1 | Operator web fuel/dumpsite/maintenance calendar (#142/#144 proximity/capacity) |
| **Twilio WhatsApp** | P2 | `send-reminders` Edge Function stub only |
| **Termii SMS** | P2 | Not started |
| **Phone OTP auth** | P2 | Email/password + Admin provisioned staff/residents in place |
| **Field proof** | P2 | GPS + photo on stops; loader assignment; multi-route driver |
| **Exportable reports / incidents / audit / Realtime** | P2 | Still open |
| **Multi-tenant polish / i18n / LAWMA reporting API** | P3 | Platform admin basics exist; scale work remains |

---

## Schema vs UI Gap

- `fuel_logs` — driver RPC + mobile UI delivered; no operator web view yet
- `dumpsite_runs` — driver RPC + mobile UI delivered; no operator web view yet
- `maintenance_events` — schema only; no fleet maintenance calendar
- `collection_make_goods` / `route_stop_make_goods` — backend + alerts + badges shipped; dedicated coverage board UI pending
- `resident_notifications` / outbox / push devices — inbox shipped; live push needs dev build

---

## Immediate Next Action Steps

Ordered by impact after recovery + resident parity (`2eac133`):

### 1. Production quality gate

Add CI (`typecheck` + migration lint), smoke coverage for close-incomplete / resident login / Paystack, and Android device QA.

### 2. Make-good / Coverage operator board

List open recoveries with target date, due_by, attempt count, skip reason; due-today vs completed coverage (#143 without map).

### 3. Real Expo push

EAS project id, platform credentials, development build, physical-device token + delivery + tap deep-link.

### 4. Hosted Supabase deploy

Migrations through `0059` were applied locally via Docker/`psql`; hosted project still needs proper migration + function deploy.

### 5. Deferred messaging

Twilio WhatsApp / Termii SMS receipts and reminders after quality gate.

---

## How to Run Today

```bash
npm install
supabase start          # or supabase db reset for fresh seed
supabase migration up   # apply migrations through 0059 locally
npm run dev:web         # http://localhost:5173
npm run dev:mobile      # npx expo start -c; set LAN IP in apps/mobile/.env.local
```

Recovery smoke (local DB):

```bash
# via docker exec into supabase_db_cleanops, or psql against local DB
# scripts/smoke_make_good.sql
# scripts/smoke_unserviced_recovery.sql
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
| Resident | Admin-provisioned customer login |
| Newly onboarded staff | Temp password shown once in Admin credentials modal |

---

## Summary

CleanOps now covers **operator command**, **driver/agent field apps**, **frequency + next-day recovery**, and a **resident portal on web and mobile** (schedule, account, Paystack, complaints, inbox). Push infrastructure exists but live remote delivery needs a development build.

Highest-leverage next work: **CI/smoke quality gate**, **make-good/coverage board**, **real Expo push**, then fleet/dumpsite operator UI and hosted deploy.

See [agent-handover.md](./agent-handover.md) and [build-plan.md](./build-plan.md) for sequencing.
