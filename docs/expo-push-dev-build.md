# Expo Push Development Build

**Last updated:** 29 July 2026  
**EAS project:** [@olabenji/cleanops](https://expo.dev/accounts/olabenji/projects/cleanops)  
**Project ID:** `0f45aaf0-43ab-47c4-9358-61ace5da1f58`  
**Android package / iOS bundle:** `com.cleanops.app`

Push registration, outbox, and `dispatch-resident-notifications` are in the app/DB. Android remote push needs **Firebase / FCM** on the device build **and** FCM V1 credentials on Expo.

## Status (29 July 2026)

| Gate | Status |
|------|--------|
| EAS project + `eas.json` + `app.json` plugins | Done |
| Logged-in EAS CLI (`olabenji`) | Done on this machine |
| `google-services.json` in repo (`com.cleanops.app`) | Done |
| Local FCM service-account JSON (gitignored) | Done (`apps/mobile/fcm-service-account.json`) |
| FCM V1 linked on Expo | **Done** — verify: `npm run eas:fcm:ensure -w @cleanops/mobile` |
| Android `POST_NOTIFICATIONS` permission in `app.json` | Done |
| In-app **Send test push** (resident Profile) | Done |
| CLI test send | Done — `npm run test:push` / `npm run push:test -w @cleanops/mobile` |
| Physical device install + permission + Profile test push | **PASSED** (Tunde Lawal / Android) |
| Close-incomplete → outbox → dispatch (`sent` + Expo ticket) | **PASSED** 29 Jul |
| Tap notification → Inbox | **PASSED** 29 Jul |
| iOS APNs credentials + device | Optional / later (needs Apple Developer) |

### Latest Android development build

**Finished** 27 July 2026 (includes `POST_NOTIFICATIONS` + test-push UI) — install from:

https://expo.dev/accounts/olabenji/projects/cleanops/builds/d02995c7-721d-4363-9428-1cfa90f0f2e6

Prior build (25 July, with `google-services.json`):  
https://expo.dev/accounts/olabenji/projects/cleanops/builds/97d00bed-7124-4169-9a3f-0857a5007f32

## Blocker you may still hit

```
Unable to get Firebase Messaging instance.
Did you configure googleServicesFile path in app config?
```

That means the installed APK was built **without** `google-services.json`. Metro reload cannot fix this — install a newer development APK (links above).

## One-time Firebase + EAS setup

### A. Firebase Console (already done for CleanOps)

1. Firebase project `clean-ops-aaec8` with Android app package `com.cleanops.app`
2. `apps/mobile/google-services.json` (committed — public client config)
3. Service account private key under `apps/mobile/` (gitignored):

   - `apps/mobile/clean-ops-aaec8-firebase-adminsdk-*.json`
   - `apps/mobile/fcm-service-account.json` (stable alias)

### B. Upload / verify FCM V1 on EAS

Non-interactive (preferred):

```bash
cd apps/mobile
npm run eas:fcm:ensure
```

Interactive fallback:

```bash
npx eas-cli credentials -p android
```

Choose: Google Service Account → Manage FCM V1 → Upload the private-key JSON.  
Dashboard: [Expo credentials](https://expo.dev/accounts/olabenji/projects/cleanops/credentials)

### C. Rebuild + reinstall

```bash
cd apps/mobile
npm run eas:build:android
```

Install the new APK on a **physical** Android phone (USB or download from Expo), then:

```bash
npm run start -- --dev-client
```

Sign in as a resident, grant notification permission.  
Banner should say **Push alerts enabled**. Confirm a row in `resident_push_devices`.

## Env

```bash
EXPO_PUBLIC_EAS_PROJECT_ID=0f45aaf0-43ab-47c4-9358-61ace5da1f58
```

Already in `apps/mobile/.env.local`. For LAN Supabase, keep `EXPO_PUBLIC_SUPABASE_URL` pointed at the machine the phone can reach.

## Human device QA checklist (Australia / AU)

Prefer **Android** for this P0 (FCM already linked). iOS needs Apple Developer + APNs + a Mac for signing.

1. Wait for the EAS build above to finish; download the APK from Expo (or `eas build:list`).
2. Install on a physical Android phone (not emulator-only for final sign-off).
3. Connect phone to the same LAN as local Supabase **or** point `.env.local` at hosted Supabase.
4. Start Metro: `cd apps/mobile && npm run start -- --dev-client`
5. Open the CleanOps development client; sign in as resident (`resident@cleanops.local` / `cleanops-resident-password` when seeded).
6. Grant notification permission when prompted.
7. Confirm banner: **Push alerts enabled for collection updates.**
8. SQL / Studio: row in `resident_push_devices` with this customer + Expo token.
9. Profile → **Send test push** — notification appears in the tray.
10. Optional full path: operator **Close incomplete** → outbox row → auto-dispatch from the web UI.

Close-incomplete already enqueues `unserviced_recovery` inbox + `notification_outbox` rows, then the operator web app calls `dispatch-resident-notifications`. Profile **Send test push** bypasses the outbox (direct Expo) — so a working test push does **not** prove outbox dispatch.

Local requirement: Edge Runtime must be running (`npx supabase functions serve` or full `npx supabase start` with edge up). If edge is stopped, close still queues notices but push stays `queued` until you flush:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/dispatch-resident-notifications" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"limit\":20}"
```

Or from a machine with env loaded:

```bash
npm run test:push
# flush queued recovery/outbox pushes (also loads .env.local):
node scripts/send-test-resident-push.mjs --dispatch
# flush only (no direct Expo test send):
node scripts/send-test-resident-push.mjs --dispatch-only
```

### Safe retest (Tunde only, no full route close)

Already used 29 Jul: enqueue one `unserviced_recovery` via `enqueue_resident_notification` for customer `00000000-0000-4000-8000-000000000402`, then dispatch. Outbox `915466ce-…` → `status=sent`, ticket `019fae1c-8479-762d-a378-ef4c183863a3`. Title on device: **Close to outbox E2E QA**.

### Live operator close (optional full path)

1. Keep Edge up: `npm run dev:functions` (local) or hosted function deployed.
2. Operator web → pick a route that includes **Mr. Tunde Lawal** with at least one pending stop → **Close incomplete**.
3. Status should mention push dispatched (or surface dispatch error if Edge is down).
4. Phone: tray shows recovery title; tap → Inbox.

11. Tap notification → resident Inbox opens.

## Verify delivery (pass criteria)

1. Token registered in `resident_push_devices`
2. Test push (Profile button or `npm run test:push`) arrives on device
3. Operator close-incomplete (or enqueue) → `notification_outbox` → dispatch delivers
4. Tap opens Inbox (and focuses notification when `notificationId` is present)

**P0 is done** — physical Android: token + test push + outbox tray + tap→Inbox (29 Jul, Tunde Lawal).

## iOS note

`eas.json` development profile builds a device IPA (`simulator: false`). Needs Apple credentials via interactive `eas credentials -p ios`. Defer until Android P0 is green unless an iPhone is the only available device.

See also: `docs/device-qa-checklist.md` → Resident (development build only).  
Expo guide: https://docs.expo.dev/push-notifications/fcm-credentials/
