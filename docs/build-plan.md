# CleanOps Build Plan

**Last updated:** 9 July 2026  
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

## Upcoming Sprints (ordered)

### Sprint 3 — Paystack webhook

- Signature verification on `paystack-webhook` Edge Function
- Idempotent payment posting
- Ledger refresh on operator web

### Sprint 4 — Driver field completeness

- Dumpsite run logging (`dumpsite_runs` table)
- Fuel log entry (`fuel_logs` table)
- GPS / photo proof on stops (stretch)

### Sprint 5 — Admin edit flows

- Edit existing staff, trucks, customers (not only create + deactivate)

### Sprint 6 — Quality gate

- CI: typecheck + migration lint
- Smoke tests for sign-in, plan routes, record payment
- Android device QA for driver + agent offline sync

### Sprint 7 — Resident mobile (Phase 2 start)

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
