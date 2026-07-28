# CleanOps Technical Information

**Audience:** Engineering diligence, deploy partners, technical co-founders  
**Repo:** TypeScript monorepo (`apps/web`, `apps/mobile`, `packages/shared`, `supabase/`)  
**Related:** [architecture.md](../architecture.md) · [deployment-readiness.md](../deployment-readiness.md) · [saas-packaging.md](../saas-packaging.md)

---

## 1. System overview

CleanOps is a multi-tenant operations platform for Lagos LAWMA Private Sector Participant (PSP) waste collection.

```text
┌────────────────────┐   ┌─────────────────────┐
│  apps/web (Vite)   │   │  apps/mobile (Expo) │
│  Operator +        │   │  Driver / Agent /   │
│  Resident +        │   │  Resident           │
│  Platform admin    │   │                     │
└─────────┬──────────┘   └──────────┬──────────┘
          │  Supabase JS client     │
          └────────────┬────────────┘
                       ▼
        ┌──────────────────────────────┐
        │  Supabase                     │
        │  Postgres + RLS + Auth        │
        │  Realtime / Storage           │
        │  Edge Functions               │
        └──────────────┬───────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   Paystack      Twilio WA      Termii SMS
   (checkout +   (reminders,    (fallback)
    webhooks)     receipts)
```

**Design rules**

- Business state lives in **PostgreSQL**.
- Clients call Supabase directly for scoped CRUD/RPCs under **Row-Level Security**.
- Privileged work (webhooks, provider dispatch, auth provisioning helpers) runs in **security-definer RPCs** or **Edge Functions**.
- Field clients are **offline-tolerant** with client queues + server **idempotency keys**.

---

## 2. Repository map

| Path | Purpose |
|------|---------|
| `apps/web` | React + Vite operator command centre, resident web, platform admin |
| `apps/mobile` | Expo / React Native — role-routed Driver, Agent, Resident apps |
| `packages/shared` | Shared TypeScript types + Zod validation |
| `supabase/migrations` | Schema, RLS, RPCs (through `0075+`) |
| `supabase/functions` | Edge Functions (Paystack, notifications, comms, reminders, staff-auth) |
| `supabase/seed.sql` | Pilot operators, wards, trucks, demo users |
| `docs/` | Architecture, status, GTM pack, QA checklists |
| `scripts/` | Smoke SQL, Paystack test helpers, quality scripts |

---

## 3. Runtime stack

| Layer | Choice |
|-------|--------|
| Language | TypeScript (strict monorepo) |
| Operator / resident web | React, Vite |
| Field apps | React Native, Expo (EAS project `@olabenji/cleanops`) |
| Backend | Supabase (Postgres 15+, Auth, Storage, Edge Functions on Deno) |
| Validation | Zod in `@cleanops/shared` |
| Payments | Paystack (HMAC webhook + initialize/verify Edge Functions) |
| Messaging | Twilio WhatsApp primary; Termii SMS fallback |
| Push | Expo push devices + `notification_outbox` + `dispatch-resident-notifications` |
| Money | Integer **kobo** everywhere; UI formats as NGN |
| Tests | Vitest (shared helpers), SQL smoke scripts, Playwright config present |

---

## 4. Multi-tenancy & auth

### 4.1 Tenants

- Table `operators` is the tenant root (`plan_code`: `basic` | `growth` | `pro`).
- Tenant-owned tables carry `operator_id`.
- Helpers: `current_operator_id()`, `current_app_role()`.
- RLS policies scope reads/writes through authenticated profiles.

### 4.2 Roles

`operator_owner` · `operations_supervisor` · `driver` · `collection_agent` · `loader` · `resident` · `platform_admin`

### 4.3 Auth model

- Email/password via Supabase Auth (phone OTP on roadmap).
- Staff logins provisioned from Admin (`provision_staff_member_login`, password-reset targeting RPCs).
- Residents linked to customer rows; Admin provisions resident role logins.
- Auth emails are **globally unique** across tenants.
- Platform admin can create/suspend tenants; suspended owners cannot sign in.

---

## 5. Domain modules (data + behaviour)

| Domain | Key entities / behaviours |
|--------|---------------------------|
| Geography | Wards (zones), customers with `preferred_weekdays`, monthly rates |
| Fleet | Trucks (floaters), fuel logs, dumpsite sites/runs, maintenance events, map positions |
| Routing | Route templates, daily routes, stops, status lifecycle `scheduled → in_progress → completed/cancelled` |
| Recovery | `collection_make_goods` / `route_stop_make_goods`; `finalize_route_with_unserviced`; coverage board RPC |
| Field proof | GPS / photo metadata on stop completion (`0071_stop_field_proof`) |
| Payments | Payments ledger, agent collections, Paystack idempotent posting, suspension / auto-reactivation |
| People | Staff, attendance overrides, monthly payroll estimate, licence vault |
| Residents | Home payload, complaints (24h SLA copy), inbox, push devices, comms outbox |
| Compliance | LAWMA P1 evidence / case status |
| Reporting | Exportable finance, coverage, disposal, service packs (`0070`, `0074`) |
| Comms | Reminder previews, Twilio/Termii dispatch (`0075`, `dispatch-resident-comms`, `send-reminders`) |
| SaaS | Platform console, plan codes, branding fields |

---

## 6. Edge Functions

| Function | Responsibility |
|----------|----------------|
| `paystack-webhook` | Verify HMAC; call `record_paystack_payment` (service_role); idempotent on reference |
| `resident-paystack-checkout` | Initialize Paystack transaction; callback via `SITE_URL` / mobile deep link |
| `resident-paystack-verify` | Confirm transaction and post payment if needed |
| `dispatch-resident-notifications` | Flush push/inbox outbox (`claim` / `complete` outbox RPCs) |
| `dispatch-resident-comms` | WhatsApp / SMS delivery for receipts, suspensions, related notices |
| `send-reminders` | Queue/send payment reminders (Twilio → Termii fallback) |
| `staff-auth` | Privileged staff auth helpers where not covered by SQL RPCs |

Deploy notes and secrets: [deployment-readiness.md](../deployment-readiness.md).

---

## 7. Selected RPC catalogue

Operational RPCs (non-exhaustive; see migrations for signatures):

| RPC | Purpose |
|-----|---------|
| `operator_dashboard_snapshot` | Metrics, routes, alerts for a date |
| `plan_daily_routes` / `ensure_daily_routes_loaded` | Frequency-aware planning + recovery merge |
| `route_planning_options` | Planner pick-lists |
| `update_route_plan_assignment` | Truck/driver on scheduled route |
| `add/remove/move_route_plan_stop` | Stop editing |
| `update_route_stop_status` | Driver/operator stop updates; make-good side effects |
| `finalize_route_with_unserviced` | Supervisor close → next-day recoveries |
| `transition_route_status` | Route lifecycle |
| `driver_assigned_route` / `sync_driver_stop_action` | Driver day + idempotent sync |
| `report_driver_incident` / `record_fuel_log` / `record_dumpsite_run` | Field logs |
| `customer_ledger_snapshot` / `record_operator_payment` / `record_agent_payment` | Money |
| `record_paystack_payment` | Webhook posting (service_role) |
| `operator_agent_collections_snapshot` | Agent reconciliation |
| `attendance_snapshot` / `monthly_staff_summary` | Staff |
| `admin_master_data` / `onboard_*` / `provision_staff_member_login` | Master data |
| `get_resident_home` + complaint / notification RPCs | Resident portal |
| Coverage / fleet / reports / comms snapshots | Operator boards (migrations `0061+`) |

---

## 8. Offline & idempotency

**Mobile**

- Failed stop actions, incidents, and agent payments persist (AsyncStorage queue).
- Settings expose sync toggle, manual sync, last-sync timestamp.
- Authenticated empty assignment must **not** fall back to pilot demo routes.

**Server**

- Agent and Paystack posts use idempotency keys (`paystack:<reference>`, agent client keys).
- Duplicate webhook delivery returns already-posted semantics without double-counting balances.

---

## 9. Environment & secrets

See `.env.example`. Critical keys:

| Variable | Used by |
|----------|---------|
| `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Web + mobile clients |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions / privileged scripts |
| `PAYSTACK_SECRET_KEY` / `EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY` | Webhook HMAC + checkout |
| `SITE_URL` | Checkout callback base |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_WHATSAPP_FROM` | WhatsApp |
| `TERMII_API_KEY` / `TERMII_SENDER_ID` | SMS fallback |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | Push (dev/prod builds) |
| `SENTRY_DSN` / `EXPO_PUBLIC_SENTRY_DSN` | Error tracking (optional) |

Never commit secrets. Prefer `npx supabase secrets set …` for function env.

Production check helper: `npm run env:check:production`.

---

## 10. Local development

```bash
npm install
supabase start                 # local Postgres + Auth
supabase migration up          # or supabase db reset for seed
npm run typecheck
npm run dev:web                # http://localhost:5173
npm run dev:mobile             # npx expo start -c
```

Mobile devices need the machine LAN IP in `apps/mobile/.env.local` to reach local Supabase.

Useful smoke:

```bash
npm test                       # shared Vitest (Paystack helpers, etc.)
npm run test:paystack:idempotent
# SQL: scripts/smoke_make_good.sql, scripts/smoke_unserviced_recovery.sql
```

Local Auth emails: Inbucket/Mailpit typically at `http://localhost:54324`.

---

## 11. Hosted deploy checklist (summary)

1. `npx supabase link` → `db push` (migrations through latest, including fleet/reports/comms).
2. Deploy Edge Functions listed in §6.
3. Set Paystack, Twilio, Termii, `SITE_URL` secrets.
4. Configure web hosting env (`EXPO_PUBLIC_*` / Vite env as applicable).
5. EAS development/production build for real Expo push (Expo Go cannot receive remote push on recent SDK).
6. Run hosted smoke: resident auth, Paystack idempotent post, close-incomplete → recovery notice.

Full gate: [deployment-readiness.md](../deployment-readiness.md).

---

## 12. Security notes

- RLS is mandatory for tenant isolation; service_role only inside Edge Functions / admin SQL.
- Paystack webhooks must verify signature before posting.
- Driver licence objects use private storage + signed URLs.
- Do not log raw provider secrets or full card/PAN data (Paystack keeps card vaulting off-platform).
- Suspended tenants fail closed at sign-in.
- Prefer least-privilege roles for supervisors vs owners when extending policies.

---

## 13. SaaS packaging (engineering view)

Feature intent is stored on `operators.plan_code`. Module matrix (product truth):

| Module | Basic | Growth | Pro |
|--------|-------|--------|-----|
| Core ops + field apps | Yes | Yes | Yes |
| Reassignment, templates, float, licence vault | — | Yes | Yes |
| Paystack + custom branding | — | — | Yes |

UI/RPC enforcement of every gate is progressive — treat plan codes as the source of packaging truth when adding new modules. Details: [saas-packaging.md](../saas-packaging.md).

---

## 14. Quality & known gaps

**In place**

- Shared Zod contracts, selected unit tests, SQL smoke scripts, CI quality-gate work started.
- Demo-ready local stack for operator / driver / agent / resident paths.

**Typical remaining production risks**

- Hosted migration + function deploy still required per environment.
- Live Expo push needs EAS credentials and a non–Expo Go build.
- Broader automated E2E coverage and Sentry wiring incomplete.
- Phone OTP auth not yet shipped.

Track live status in [status-report.md](../status-report.md) (may lag latest migrations — prefer `supabase/migrations` and git history when they disagree).

---

## 15. Integration contracts (quick reference)

**Paystack webhook**

- Endpoint: `/functions/v1/paystack-webhook`
- Auth: Paystack signature header vs `PAYSTACK_SECRET_KEY`
- Effect: idempotent `payments` row + balance/suspension reconcile

**Resident checkout**

- `resident-paystack-checkout` → Paystack initialize  
- Return: web `SITE_URL` or mobile `cleanops://paystack-return`  
- `resident-paystack-verify` finalizes

**Comms**

- Outbox rows claimed by dispatch functions  
- Channel preference: WhatsApp (Twilio) → SMS (Termii) on failure/absent Twilio

---

## 16. Document control

| Item | Value |
|------|-------|
| Product | CleanOps |
| Pack | `docs/go-to-market/` |
| Pitch | [pitch-deck.html](./pitch-deck.html) |
| End-user guide | [user-manual.md](./user-manual.md) |
| This file | Technical information for diligence & deploy |
