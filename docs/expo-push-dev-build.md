# Expo Push Development Build

**Last updated:** 22 July 2026  
**EAS project:** [@olabenji/cleanops](https://expo.dev/accounts/olabenji/projects/cleanops)  
**Project ID:** `0f45aaf0-43ab-47c4-9358-61ace5da1f58`

Push registration and dispatch are already in the app/DB. Remote delivery requires a **development build** (not Expo Go).

## One-time setup

1. Confirm login: `npx eas-cli whoami` (account `olabenji`).
2. Project is linked in `apps/mobile/app.json` (`extra.eas.projectId`).
3. Set env (also in `apps/mobile/.env.local`):

```bash
EXPO_PUBLIC_EAS_PROJECT_ID=0f45aaf0-43ab-47c4-9358-61ace5da1f58
```

4. Configure store credentials when prompted:

```bash
cd apps/mobile
npx eas-cli credentials -p android
# optional iOS:
npx eas-cli credentials -p ios
```

Android needs an FCM / Google service account for Expo push. iOS needs an APNs key.

## Build & install (physical device)

Latest Android development build (22 Jul 2026):

https://expo.dev/accounts/olabenji/projects/cleanops/builds/bb817c13-9087-4cd4-9e95-dada129b56e5

From `apps/mobile`:

```bash
# Rebuild when native deps change
npm run eas:build:android

# iOS (requires Apple team + device UDID registered)
npm run eas:build:ios
```

Install the APK from the Expo build page, then on the same LAN as Metro:

```bash
npm run start -- --dev-client
```

Sign in as `resident@cleanops.local` / `cleanops-resident-password`.

If pushes register but never arrive on Android, upload an FCM V1 service account via `npx eas-cli credentials -p android` (Expo Push needs FCM for Android delivery).

## Verify delivery

1. Grant notification permission → row appears in `resident_push_devices`.
2. Operator **Close incomplete** on a missed stop (or enqueue a test notification) so `notification_outbox` fills.
3. Invoke dispatcher:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/dispatch-resident-notifications" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"limit\":20}"
```

4. Device receives push; tap opens **Inbox** and focuses `notificationId`.

See also: `docs/device-qa-checklist.md` → Resident (development build only).
