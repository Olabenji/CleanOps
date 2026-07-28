# CleanOps User Manual

**Product:** CleanOps — Lagos LAWMA PSP waste-collection operations platform  
**Surfaces:** Operator web · Driver / Collection agent / Resident mobile · Resident web  
**Audience:** Operators, supervisors, drivers, collection agents, residents, platform admins

---

## 1. What CleanOps is

CleanOps connects the people who run a Lagos waste ward:

| Role | Where they work | Main job |
|------|-----------------|----------|
| Operator owner / supervisor | Web command centre | Plan routes, watch coverage, reconcile cash, manage staff & fleet |
| Driver | Mobile (CleanOps Field) | Run today’s stops, log fuel & dumpsite, report incidents |
| Collection agent | Mobile (Collect) | Door-to-door payments with searchable ledger |
| Resident | Web + mobile | See schedule, pay fees, complain, read notices |
| Platform admin | Web (platform console) | Onboard / suspend PSP tenants |

Tagline: **Routes. Collections. Cash. One system.**

---

## 2. Getting started

### 2.1 Sign in (demo / pilot)

| Role | Typical login |
|------|----------------|
| Operator (web) | `owner@cleanops.local` / `cleanops-demo-password` |
| Driver (mobile) | `driver@cleanops.local` / `cleanops-driver-password` |
| Collection agent | `agent@cleanops.local` / `cleanops-agent-password` |
| Platform admin | `platform@cleanops.local` / `cleanops-platform-password` |
| Resident | Provisioned by Admin from a customer record |

Production staff and residents use email/password accounts created by the operator Admin tab (or platform onboarding for new PSP owners). Password reset emails are available from Admin.

### 2.2 Morning checklist (operator)

1. Open **Dashboard** and set the **operations date** (defaults to today).
2. Confirm **alerts** (stale routes, overdue make-goods).
3. Open **Routes** → plan from ward templates if the day is empty.
4. Assign trucks / drivers; adjust stops before crews leave the yard.
5. Open **Coverage** for open recoveries due today.
6. Check **Fleet** for workshop / standby trucks and active dumpsite runs.
7. Brief drivers; agents start **Collect** when doors open.

---

## 3. Operator web — command centre

Navigation (sidebar):

Dashboard · Routes · Coverage · Fleet · Payments · Reports · Comms · Staff · Compliance · Admin · Settings

### 3.1 Dashboard

- Daily metrics: route progress, payments (NGN), attendance, fleet.
- Route cards by ward, recent payments, incidents, operational alerts.
- Use the date control to review a past day without changing live field data.

### 3.2 Routes

**Plan the day**

1. Choose the operations date.
2. **Plan selected date from templates** (uses ward default templates + preferred weekdays; merges open recoveries).
3. On a **scheduled** route (not yet started): change truck/driver, add/remove/reorder stops.
4. When you edit a plan, CleanOps may ask whether to save changes to the **zone/ward default**, keep them temporary, or discard.

**During / after the shift**

- Drivers start and complete routes from mobile (field-only lifecycle).
- Operators can **correct stop status** or **cancel** a route.
- **Complete** is blocked for **suspended** customers; **Skip** remains allowed (with reason).
- Supervisor can **finalize incomplete** routes → creates next-calendar-day **make-good** recoveries and resident notices.

**Make-good stops** appear with a badge on the stop list.

### 3.3 Coverage

Coverage board for recovery work:

| Filter | Meaning |
|--------|---------|
| Active / open | Still to serve |
| Due today | Target date is the operations date |
| Overdue | Past due |
| Scheduled / completed | Lifecycle views |

Use this board every afternoon to confirm tomorrow’s recovery load.

### 3.4 Fleet

- Truck list with status (active, standby, workshop) and ward context.
- Dumpsite runs (depart → arrive → cleared) mirrored from driver mobile.
- Fuel and maintenance visibility; map markers when GPS/field proof is available.
- Truck handoffs / float: reassign capacity across wards (Growth+ packaging).

### 3.5 Payments

Two areas:

1. **Customer ledger** — balance, paid-this-month, outstanding, service status, history. Record manual payments (cash, bank transfer, OPay, etc.). Suspend / reactivate service.
2. **Agent collections** — reconcile field agent cash for the operations date; drill into per-agent totals.

**Rules of thumb**

- Full monthly payment can **auto-reactivate** a suspended customer.
- Paystack online payments post via webhook into the same ledger (Pro).
- Payments view refreshes while open so webhook rows appear without a full reload.

### 3.6 Reports

Date-range packs with CSV export:

| Tab | Contents |
|-----|----------|
| Finance | Revenue / collections summaries |
| Coverage | Ward coverage %, make-goods |
| Disposal | Dumpsite tips / tonnage where recorded |
| Service | Complaints and service quality |

Use LAWMA-oriented sections when preparing regulator evidence.

### 3.7 Comms

Resident messaging via **Twilio WhatsApp** (primary) and **Termii SMS** (fallback):

- Queue payment reminders (e.g. 5 days / 2 days before due).
- Flush the outbox when provider secrets are configured.
- Track queued / sent / failed; review recent messages.

### 3.8 Staff

- Daily attendance (present / absent) with supervisor override + reason.
- Monthly summary with estimated payroll from days present.

### 3.9 Compliance

LAWMA P1 compliance evidence — case status and supporting operational proof for the selected period.

### 3.10 Admin (master data)

Sub-tabs: **Staff · Trucks · Customers**

| Task | How |
|------|-----|
| Onboard staff | Add identity, role (driver, collection agent, loader, supervisor…), optional login email |
| Create / reset login | Provision Auth user; one-time temp password shown once; send reset email |
| Onboard truck | Registration, make/model/year, status, home ward (optional — trucks can float) |
| Onboard customer | Ward, address, type, monthly rate, service status |
| Bulk import customers | CSV import path (bulk customer import) |
| Suspend / reactivate | Service status controls on customer rows |
| Licence vault | Upload / track driver licences (Growth+) |

### 3.11 Settings

Operator settings including ward/zone route **templates** and workspace preferences. Profile (self-service) is available from the sidebar user control.

### 3.12 Platform admin (platform login only)

- List / create / suspend PSP operators (tenants).
- Issue owner credentials for a new operator.
- Never exposed inside a normal tenant workspace.

---

## 4. Driver mobile (CleanOps Field)

### 4.1 Daily flow

1. Sign in → Driver workspace opens from your profile role.
2. Review **today’s assigned route** and stops.
3. **Start shift** (route → in progress).
4. For each stop: **Complete** or **Skip** (reason required for skip).
5. Capture **field proof** when prompted (GPS / photo) where enabled.
6. Log **fuel** (litres, cost, station) and **dumpsite** (depart / arrive / cleared, tipping fee).
7. **Wrap up** without forcing remaining stops complete — supervisor may finalize leftovers as make-goods.
8. Report **incidents** anytime (type, optional stop, title, description).

### 4.2 Offline behaviour

- If the network drops, stop actions and incidents queue locally.
- When connectivity returns, open Settings → sync (or rely on auto-sync when enabled).
- Live sessions never invent a fake pilot route — empty assignment shows **Waiting for assignment**.

### 4.3 Suspended customers

Complete is disabled; skip remains available so the truck can move on.

---

## 5. Collection agent mobile (Collect)

1. Sign in → Agent workspace.
2. **Search** customers by name, phone, or address.
3. Open a customer → see balance / suspension reason.
4. **Record payment** — amount, channel, optional receipt reference.
5. Confirm on-screen receipt; share via the phone share sheet if needed.
6. Check **daily summary** (count + total) before handing cash to the office.

Offline: payments queue and sync later. Full payment can clear suspension automatically.

---

## 6. Resident (web + mobile)

### 6.1 Home

- **Know your PSP** — brand, operator, LAWMA reference, ward context.
- **Schedule** — preferred collection weekdays; recovery / make-good note when a missed stop is being recovered.
- **Account** — outstanding balance, monthly rate, paid-this-month, last payment.

### 6.2 Pay

- Start **Paystack checkout** from web or mobile.
- Mobile returns via app deep link after payment; verify completes the ledger update.
- Keep the receipt/reference from Paystack for your records.

### 6.3 Issues / complaints

- Submit a complaint; history shows prior cases.
- Product copy targets a **24-hour SLA** acknowledgment window for operators.

### 6.4 Inbox

- Missed-collection / recovery notices and other operator messages.
- Mark items read; enable push on a development/production build (Expo Go may skip remote push).

---

## 7. Roles & permissions (practical)

| Action | Owner | Supervisor | Driver | Agent | Resident |
|--------|-------|------------|--------|-------|----------|
| Plan / edit routes | ✓ | ✓ | — | — | — |
| Start / complete route in field | — | — | ✓ | — | — |
| Record agent cash | ✓ (ledger) | ✓ | — | ✓ | — |
| Pay own bill (Paystack) | — | — | — | — | ✓ |
| Admin master data | ✓ | limited* | — | — | — |
| Platform tenants | Platform only | — | — | — | — |

\*Exact supervisor rights follow RLS / role checks in the live deployment.

---

## 8. Everyday tips

- Always set the correct **operations date** before editing historical days.
- Enter a **skip reason** — it feeds coverage and resident recovery messaging.
- Reconcile **agent collections** the same day cash hits the office.
- Use **Coverage** before publishing tomorrow’s plan so recoveries are not forgotten.
- For WhatsApp/SMS, confirm Comms **queued → sent** after changing provider keys.
- Never share one-time Admin passwords over public chat; prefer the in-app credentials modal once.

---

## 9. Troubleshooting

| Symptom | What to try |
|---------|-------------|
| Driver sees “Waiting for assignment” | Operator must plan the date and assign that driver on a scheduled route |
| Payment missing after Paystack | Wait ~20s on Payments tab or Refresh; confirm webhook secrets on server |
| Mobile cannot reach backend | Confirm LAN IP / `EXPO_PUBLIC_SUPABASE_URL` on device network |
| Offline actions stuck | Settings → sync; check last-sync time |
| Resident cannot sign in | Admin must provision login on the customer record |
| Operator sign-in rejected | Tenant may be suspended — contact platform admin |

---

## 10. Training outline (1 hour)

| Minutes | Activity |
|---------|----------|
| 0–10 | Dashboard walkthrough + date control |
| 10–25 | Plan a route, edit stops, explain make-good |
| 25–35 | Driver complete/skip + agent payment demo |
| 35–45 | Ledger, suspension, Paystack (if Pro) |
| 45–55 | Coverage board + reports export |
| 55–60 | Q&A / credentials handoff |

For deeper engineering detail, see [technical-information.md](./technical-information.md).  
For investor narrative slides, open [pitch-deck.html](./pitch-deck.html).
