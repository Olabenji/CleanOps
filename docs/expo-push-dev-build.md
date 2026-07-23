# Expo Push Development Build

**Last updated:** 23 July 2026  
**EAS project:** [@olabenji/cleanops](https://expo.dev/accounts/olabenji/projects/cleanops)  
**Project ID:** `0f45aaf0-43ab-47c4-9358-61ace5da1f58`  
**Android package / iOS bundle:** `com.cleanops.app`

Push registration and dispatch are already in the app/DB. Android remote push also needs **Firebase / FCM**.

## Blocker you just hit

```
Unable to get Firebase Messaging instance.
Did you configure googleServicesFile path in app config?
```

That means the development APK was built **without** `google-services.json`. Metro reload cannot fix this — you must add Firebase files and **rebuild** the Android app.

## One-time Firebase + EAS setup

### A. Firebase Console (you do this in the browser)

1. Open [Firebase Console](https://console.firebase.google.com/) → create (or open) a project for CleanOps.
2. Add an **Android** app with package name exactly: `com.cleanops.app`  
   (SaaS product id — not a single PSP brand. Operator names stay in app data/UI.)
3. Download **`google-services.json`** and save it as:

```text
apps/mobile/google-services.json
```

(`app.json` already points at `./google-services.json`.)

4. Project settings → **Service accounts** → **Generate new private key**  
   Save under `apps/mobile/` (already gitignored). Local copies on this machine:

   - `apps/mobile/clean-ops-aaec8-firebase-adminsdk-fbsvc-6396efd488.json` (Firebase download name)
   - `apps/mobile/fcm-service-account.json` (stable alias)

   Do **not** commit either file. Upload to EAS only (step B).

### B. Upload FCM V1 key to EAS

```bash
cd apps/mobile
npx eas-cli credentials -p android
```

Choose: Google Service Account → Manage FCM V1 → Upload the private-key JSON from step A4.

Or upload in the dashboard:  
[Expo credentials](https://expo.dev/accounts/olabenji/projects/cleanops/credentials)

### C. Rebuild + reinstall

```bash
cd apps/mobile
npm run eas:build:android
```

Install the new APK, then:

```bash
npm run start -- --dev-client
```

Sign in (Tasty Bites / resident), grant notification permission.  
Banner should say **Push alerts enabled**. Confirm a row in `resident_push_devices`.

## Env

```bash
EXPO_PUBLIC_EAS_PROJECT_ID=0f45aaf0-43ab-47c4-9358-61ace5da1f58
```

Already in `apps/mobile/.env.local`.

## Verify delivery

1. Token registered in `resident_push_devices`
2. Operator **Close incomplete** (or enqueue) → `notification_outbox`
3. Dispatch:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/dispatch-resident-notifications" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"limit\":20}"
```

4. Device receives push; tap opens Inbox.

See also: `docs/device-qa-checklist.md` → Resident (development build only).  
Expo guide: https://docs.expo.dev/push-notifications/fcm-credentials/
