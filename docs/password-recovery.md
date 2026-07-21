# Password recovery smoke checklist

Self-serve **Forgot password** uses Supabase Auth `resetPasswordForEmail`. The email link opens the **operator web** app, which shows `PasswordRecoveryScreen` and then signs the user out so they can sign in again (web dashboard or mobile field app).

## Redirect URL (`redirectTo`)

| Surface | Redirect target |
|---|---|
| Operator / platform web Forgot password | Current origin + path (`window.location.origin` + `pathname`) |
| Admin “Send reset email” for staff | Same as web (shared `requestPasswordReset`) |
| Mobile driver / agent Forgot password | `EXPO_PUBLIC_WEB_APP_URL` (trailing slash normalized), default `http://localhost:5173/` |

On a physical phone, set `EXPO_PUBLIC_WEB_APP_URL` to the **LAN** web URL (for example `http://192.168.1.20:5173`), not `localhost`.

## Local (Inbucket)

1. Start Supabase local (`npx supabase start`) and the web app (`npm run dev -w @cleanops/web`).
2. Open Inbucket / Mailpit (local Auth mail UI — typically http://localhost:54324).
3. On web login, choose **Forgot password?**, enter a known seed email (e.g. `driver@cleanops.local` or an operator email).
4. Confirm the generic success message (does not reveal whether the account exists).
5. Open the email in Inbucket → follow the recovery link → set a new password → **Continue to sign in**.
6. Sign in with the new password on web and/or mobile.
7. Repeat from mobile Sign in → **Forgot password?** with `EXPO_PUBLIC_WEB_APP_URL` pointing at the web app.

## Production / hosted Supabase

1. Configure project **SMTP** (or Supabase default email) so reset mail is delivered.
2. **Authentication → URL configuration**
   - **Site URL**: production operator web origin.
   - **Redirect URLs allow-list**: include the production web origin (and staging if used). Mobile reset must redirect to a listed web URL.
3. Set hosted web env so operators hit the same origin used in redirect allow-list.
4. Set mobile `EXPO_PUBLIC_WEB_APP_URL` to that production web origin.
5. Smoke: request reset for a real staff login, complete link, sign in on web and mobile.

## Notes

- Generic success copy avoids account enumeration.
- Admin-assisted staff reset remains available in Admin; it uses the same reset helper.
- Resident Auth login (Feature B) will reuse this path once customer profiles exist — no separate reset mechanism.

Resident provisioning and session gate details: [resident-auth.md](./resident-auth.md).
