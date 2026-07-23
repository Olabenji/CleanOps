# CleanOps Device & Browser QA Checklist

**Purpose:** Manual verification gate for browser and Android field builds after automated CI passes.  
**Last updated:** 22 July 2026

## Prerequisites

- Local or hosted Supabase with migrations through `0063`
- Seeded demo accounts available
- Web: `npm run dev:web`
- Mobile: Expo Go for UI smoke; development build for push (`docs/expo-push-dev-build.md`)
- `EXPO_PUBLIC_EAS_PROJECT_ID=0f45aaf0-43ab-47c4-9358-61ace5da1f58`

## Demo credentials

| Role | Email | Password |
|------|-------|----------|
| Operator | `owner@cleanops.local` | `cleanops-demo-password` |
| Driver | `driver@cleanops.local` | `cleanops-driver-password` |
| Agent | `agent@cleanops.local` | `cleanops-agent-password` |
| Resident | `resident@cleanops.local` | `cleanops-resident-password` |

## Browser QA (Chromium / Edge)

- [ ] Operator sign-in loads dashboard metrics and alerts
- [ ] Routes: plan day, open stop detail, skip with reason, complete
- [ ] Close incomplete route creates next-day recovery notice
- [ ] Payments ledger refresh shows recorded payments
- [ ] Admin can open customer frequency fields
- [ ] Resident sign-in lands on resident portal (not operator shell)
- [ ] Resident sees schedule, outstanding balance, complaint form, Pay outstanding CTA
- [ ] Paystack return URL handling does not crash the portal (reference query params)
- [ ] Sign out returns to account login

Automated coverage: `npm run test:browser`

## Android QA (driver / agent / resident)

### Shared

- [ ] Cold start with LAN Supabase URL succeeds
- [ ] Wrong password shows an actionable error
- [ ] Sign out / switch user returns to Account login copy

### Driver

- [ ] Assigned route loads stops with make-good badges when present
- [ ] Complete disabled for suspended customers; Skip still works
- [ ] Wrap-up does not auto-complete pending stops
- [ ] Offline: queue a stop action with network off, sync after reconnect

### Collection agent

- [ ] Customer search returns ledger rows
- [ ] Record cash payment and share receipt reference
- [ ] Daily summary totals update

### Resident (Expo Go)

- [ ] Home quick actions open Pay / Issues / Inbox tabs
- [ ] Recovery note appears when make-good is active
- [ ] Inbox lists notifications and mark-read works
- [ ] Banner states that remote push needs a development build

### Resident (development build only)

- [ ] Push permission prompt appears
- [ ] Device token registers in `resident_push_devices`
- [ ] Outbox dispatch delivers notification
- [ ] Notification tap opens the expected resident surface

## Sign-off

| Area | Tester | Date | Result |
|------|--------|------|--------|
| Browser | | | |
| Android driver/agent | | | |
| Android resident Expo Go | | | |
| Android resident push (dev build) | | | |
