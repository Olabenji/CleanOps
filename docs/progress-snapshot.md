# CleanOps Progress Snapshot

**As of:** 19 September 2026  
**Canonical detail:** [agent-handover.md](./agent-handover.md) · [backlog.md](./backlog.md) · [deployment-readiness.md](./deployment-readiness.md)

---

## Verdict

Past “demo stack” and into **pilot-ready / near production**. Phase 1 and most of Phase 2 are built. Hosted Supabase is through **0079** (Edge Functions redeployed); local includes **0080** (live truck GPS). Biggest remaining work is **secrets, first live ward, and polish** — not core product invention.

**Go-live trigger (unchanged):** one PSP, one ward, ~3 trucks, full staff team on hosted.

---

## Progress

| Area | Status |
|------|--------|
| Operator web | Dashboard, Routes, Payments, Staff, Coverage, Compliance, Fleet, Reports, Comms, Settings, Admin |
| Field mobile | Driver (routes, handoffs, fuel/dumpsite, GPS/photo proof, live GPS ping) + agent collections |
| Resident | Web + mobile: schedule, Paystack, complaints, inbox; Android push E2E done (29 Jul) |
| Backend | Migrations **0001–0080** locally; hosted **through 0079** + Edge Functions redeployed |
| Auth | Email/password + **phone OTP** code shipped (`0078` / `phone-otp`); live SMS QA parked on Termii |
| Quality | Local quality-gate green (typecheck, tests, build, smokes, Playwright) |
| SaaS shape | Multi-tenant + platform admin basics; `plan_code` `basic` / `growth` / `pro` (full gating follow-on) |

Latest notable commit on `main`: `5df9593` (fleet / reports / field proof / bulk import / Twilio–Termii comms). Local uncommitted work may include banner config, phone OTP, truck live GPS, and related docs — sync before treating cloud as source of truth.

---

## What’s left

### Block production polish (do first)

1. Set **Termii** (+ **Twilio** if live WhatsApp) secrets — OTP / SMS / Comms are coded but parked on keys  
2. Confirm **0080** (live truck GPS) is pushed to hosted if not already  
3. Commit / push local diff so remote matches this machine  
4. Optional: `gh auth login` so CI quality-gate runs are visible remotely  
5. Sentry + stricter production env checks  

### Product gaps (not blocking a 1-ward pilot)

- Multi-route driver view  
- Driver / agent device QA beyond resident push  
- Incident resolution polish / Realtime  
- Virtual accounts / USSD  
- Full `plan_code` UI / RPC enforcement  
- Phase 3: multi-PSP scale, i18n, LAWMA API, payroll automation  

---

## What you can do now

| Goal | Action |
|------|--------|
| Sell / pilot | Full ward-day on hosted: plan routes → driver stops + proof → close incomplete → resident inbox/push → agent/Paystack payment |
| Unblock OTP / Comms | Add `TERMII_API_KEY` (and Twilio), then walk [phone-otp-auth.md](./phone-otp-auth.md) |
| Demo Fleet GPS | Driver live ping (`0080`); Lagos demo remap is for AU testing |
| Onboard a PSP | Settings → bulk CSV customer load + ward templates + staff logins |
| Stabilize the repo | Review and commit uncommitted local work; sync hosted to **0080** |
| Commercial next | Soft-launch 1 design-partner PSP on Growth; meter WhatsApp / SMS |

---

## Azure DevOps

- Epic **#127** — LAWMA build order (primary tracking)  
- Feature **#166** — frequency + make-good; stories **#167–#170**  
- Coverage list **#143**  
- Sync helper: `node scripts/ado-sync-pilot-status.js` (requires a valid `.env_PAT.local`)  
- Snapshots: `docs/ado-snapshots/`; other helpers under `scripts/ado-*.js`  
