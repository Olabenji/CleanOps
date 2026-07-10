# CleanOps Build Plan

**Last updated:** 10 July 2026  
**Reference:** [status-report.md](./status-report.md), [roadmap.md](./roadmap.md), [backlog.md](./backlog.md)

---

## Sprint 1 — Collection Agent Mobile — **complete**

Phase 1 critical path. Agents collect cash in the field; operators reconcile those payments in the ledger without manual web entry.

### Delivered

| Capability | Deliverable |
|------------|-------------|
| Agent auth | Seed login `agent@cleanops.local`; staff `profile_id` link |
| Customer lookup | Search by name, phone, or address via RPC |
| Payment entry | Record payment with `agent_cash` (or other channels); auto receipt reference |
| Receipt | On-screen confirmation + share receipt reference (mobile) |
| Daily reconciliation | Agent end-of-day summary (count, total kobo, payment list) |
| Offline queue | AsyncStorage queue + manual sync (driver pattern) |
| Mobile shell | Role-based router: driver vs collection agent |
| Operator reconciliation | Web Payments → Agent collections; `operator_agent_collections_snapshot` RPC |

### Backend (migrations `0016`–`0021`)

- `search_customers(input_query)` — lightweight customer search
- `record_agent_payment(...)` — idempotent insert with `collected_by_staff_id` + receipt payload
- `agent_daily_collection_summary(input_date)` — per-agent daily totals
- `operator_agent_collections_snapshot(input_date)` — all agents’ daily totals for operators
- `reconcile_customer_service_after_payment` — auto-activate on full payment (migration `0019`)
- Update `record_operator_payment` to set `collected_by_staff_id` when caller has a staff profile

### Deferred (post Sprint 1)

- Paystack checkout from agent app
- WhatsApp/SMS receipt delivery
- Printed PDF receipts

---

## Sprint 2 — Staff auth provisioning — **complete**

Operators can create staff logins from Admin without manual database work.

### Delivered

| Capability | Deliverable |
|------------|-------------|
| Onboard + login | `onboard_staff_member` creates Auth user, profile, and links `staff_members.profile_id` |
| Login email | Stored on `staff_members.login_email`; shown in Admin list |
| Temp password | Generated on create; shown once in credentials modal |
| Existing staff | `provision_staff_member_login` for staff without login |
| Password reset | Admin “Send reset email” via `get_staff_password_reset_target` + `auth.resetPasswordForEmail` (Inbucket locally) |
| Admin UI | Login email field, provision toggle, Create login + Send reset email actions |
| Mobile sign-in | Email/password login for any provisioned staff; demo accounts still available |

### Backend (migrations `0022`–`0024`)

- `create_staff_auth_profile(...)` — security definer Auth user + profile creation
- `generate_staff_temporary_password()` — one-time credential generator
- `onboard_staff_member(...)` — returns `{ staffId, profileId, loginEmail, temporaryPassword, loginProvisioned }`
- `provision_staff_member_login(staff_id, login_email)` — backfill login for existing staff
- `get_staff_password_reset_target(staff_id)` — operator-scoped login email for reset
- `staff_members.login_email` column + operator-scoped unique index + auth user backfill
- Optional Edge Function `staff-auth` remains in repo; web reset path no longer depends on it

### Deferred (post Sprint 2)

- Invite-only flow with forced password change on first login
- Deactivate Auth user when staff is deactivated

---

## Post–Sprint 2 polish (shipped with Sprint 2 commit)

| Item | Detail |
|------|--------|
| Mobile keyboard UX | Sign-in scrolls above keyboard; Android resize mode |
| Show/hide password | Toggle on staff login field |
| Driver empty assignment | Live drivers with no route for today see “Waiting for assignment” instead of silent pilot fallback |

---

## Sprint 3 — Paystack webhook — **complete**

Paystack `charge.success` posts into the payments ledger with signature verification and operator-web refresh.

### Delivered

| Capability | Deliverable |
|------------|-------------|
| Signature verification | HMAC SHA-512 check of `x-paystack-signature` using `PAYSTACK_SECRET_KEY` |
| Idempotent posting | `record_paystack_payment` RPC upserts on `paystack:{reference}` |
| Service reconcile | Full-month Paystack payments auto-activate suspended customers |
| JWT bypass | `[functions.paystack-webhook] verify_jwt = false` so Paystack can POST |
| Ledger refresh | Payments tab polls ledger/dashboard every 20s; customer history reloads on new rows |
| Shared helpers + unit tests | `@cleanops/shared` Paystack schemas, signature helpers, Vitest coverage |
| Smoke script | `scripts/paystack-webhook-smoke.mjs` for local signed POST / idempotency |

### Backend (migration `0025`)

- `record_paystack_payment(operator_id, customer_id, amount_kobo, external_reference, paid_at)` — security definer, **service_role only**
- Calls `reconcile_customer_service_after_payment` after post / replay

### Deferred (post Sprint 3)

- Paystack checkout initialize from web/mobile (webhook still requires `metadata.operator_id` + `metadata.customer_id`)
- Dedicated virtual account / transfer handling
- Supabase Realtime subscription (polling is sufficient for pilot)

---

## Sprint 4 — Driver field completeness — **complete**

Drivers can log fuel purchases and dumpsite depart/arrive/clear timestamps from mobile against their assigned route.

### Delivered

| Capability | Deliverable |
|------------|-------------|
| Fuel log entry | `record_fuel_log` RPC + mobile form (litres, cost, station) |
| Dumpsite run logging | `record_dumpsite_run` RPC with depart → arrive → clear phases |
| Run state | `driver_dumpsite_run_for_route` loads current timestamps on driver screen |
| Shared types | `fuelLogInputSchema`, `dumpsiteRunInputSchema`, record schemas in `@cleanops/shared` |
| RLS | Driver-scoped INSERT/UPDATE policies on `dumpsite_runs` |

### Backend (migration `0026`)

- `record_fuel_log(route_id, litres, cost_kobo, station_name, logged_at?)`
- `record_dumpsite_run(route_id, phase, tipping_fee_kobo?, notes?)`
- `driver_dumpsite_run_for_route(route_id)` — latest open or completed run

### Deferred (post Sprint 4)

- GPS stamp on dumpsite events
- Photo proof on stops
- Operator web fleet fuel/dumpsite views

---

## Sprint 5 — Truck reassignment & route takeover — **complete**

Operator-initiated truck handoffs with driver confirmation for breakdowns, dumpsite delays, unable-to-start, and cross-route borrows.

### Delivered

| Capability | Deliverable |
|------------|-------------|
| Propose handoff | Operator Routes → Reassign truck (reason, truck, driver, borrow outcome) |
| Driver confirm | Mobile banner with Confirm / Decline; no silent assignment change |
| Dual confirmation | Mid-route different drivers: incoming + outgoing must confirm |
| Cross-route borrow | Source route left unassigned or cancelled on confirm |
| Breakdown | Original truck status → `workshop` when reason is breakdown |
| Expiry | Pending handoffs expire after 30 minutes |
| History | Per-route handoff history on operator Routes panel |

### Backend (migration `0028`)

- Table `route_truck_handoffs` + enums for status / reason / source outcome
- `routes.truck_id` nullable (needs-truck after borrow)
- RPCs: `propose_route_truck_handoff`, `confirm_route_truck_handoff`, `reject_route_truck_handoff`, `cancel_route_truck_handoff`, `pending_driver_handoffs`, `route_truck_handoffs_for_date`
- `driver_assigned_route` tolerates missing truck

### Deferred (post Sprint 5)

- Push notifications for pending handoffs
- Operator force-confirm after timeout
- Dashboard alert strip for open handoffs (Routes panel covers pilot)

---

## Upcoming Sprints (ordered)

### Sprint 6 — Floating trucks (fleet unhook from zones) — **complete**

- Remove hard truck↔zone assignment guard; keep optional home zone for display/sort only
- Planner lists all active operational/standby trucks (home-zone matches sorted first)
- Admin truck onboarding: home zone optional
- Regression: cross-zone truck assign in `test:pilot` (migration `0030`)

### Sprint 7 — Zone templates & daily auto-load

- Keep clone-from-prior-route as the default zone template source
- After operator edits a day’s route, prompt: save to zone template vs create temp template
- Auto-load zone templates at start of day for operator and drivers
- Driver login fallback when today’s routes are missing (“Click OK to load default route”)
- Route-change prompts / notifications for affected drivers (push may follow)

### Sprint 8 — Admin edit flows

- Edit existing staff, trucks, customers (not only create + deactivate)

### Sprint 9 — Quality gate

- CI: typecheck + migration lint
- Smoke tests for sign-in, plan routes, record payment, truck handoff confirm
- Android device QA for driver + agent offline sync

### Sprint 10 — Resident mobile (Phase 2 start)

- Registration, schedule, balance, Paystack payments, missed collection reports

---

## Future Module — Dumpsite Visibility & Planning (not started)

**Status:** Planned — do not build until after core Phase 1 go-live and initial operator feedback.

### Problem

PSP operators need to know which LAWMA-approved dumpsites are open, how far they are from each collection zone, and where to send trucks when primary sites are closed or congested.

### Proposed capabilities

| Area | Features |
|------|----------|
| Master data | Dumpsite registry: name, address, GPS (`geography(point)`), operator/LAWMA reference, capacity tier |
| Status | Real-time or manual status: `open`, `congested`, `closed`, `maintenance` |
| Zone proximity | Distance/travel time from each PSP zone to each dumpsite; nearest-open-site recommendations |
| Route planning | Suggest dumpsite per route based on zone, truck capacity, and site status |
| Driver mobile | Log dumpsite arrival/departure (`dumpsite_runs` — table exists) with GPS stamp |
| Operator web | Map view (Lagos dumpsites), status board, zone–site matrix, alert when preferred site closes |
| Integrations | LAWMA site data API (Phase 3); traffic/ETA optional |

### Technical notes

- PostGIS already enabled in `0001_initial_schema.sql`
- `dumpsite_runs` table exists; no UI/RPC yet
- New tables likely: `dumpsites`, `dumpsite_status_logs`, `zone_dumpsite_preferences`
- Map layer: consider Mapbox or Google Maps React; seed with pilot Lagos sites for demo

### Dependencies

- Stable route + zone model (done)
- Driver mobile dumpsite run logging (Sprint 4 partial overlap)
- Accurate zone centroids or truck GPS history for proximity scoring

### Go-live trigger for this module

Operator requests dumpsite planning during ward pilot, or repeated incidents tagged `illegal_dumping` / `truck_issue` tied to site closures.

---

## Phase 2+ (reminder)

- Resident platform, fleet maintenance UI, exportable reports
- Multi-tenant SaaS, payroll automation, i18n, LAWMA reporting API

See [roadmap.md](./roadmap.md) for full timeline.
