# AGENTS.md

## Cursor Cloud specific instructions

CleanOps is an npm-workspaces monorepo (Node 22). Surfaces: `apps/web` (Vite/React operator
dashboard, port 5173), `apps/mobile` (Expo app), `packages/shared` (types + vitest), and
`supabase` (Postgres migrations, seed, Edge Functions). Standard scripts live in the root
`package.json` and are documented in `README.md`; prefer those instead of re-deriving commands.

The update script installs npm dependencies. The items below are the non-obvious startup/run
caveats that are NOT handled automatically.

### Local Supabase requires Docker (start it yourself each session)
- The web app and all DB/smoke/browser tests talk to a local Supabase stack that runs in Docker.
- If `docker ps` fails with a socket permission error, the daemon isn't running or the socket
  isn't group-accessible. Start it and grant access:
  - `sudo dockerd &` (needs `fuse-overlayfs` storage driver + `iptables-legacy`, already configured)
  - `sudo chmod 666 /var/run/docker.sock` (the `ubuntu` user is in the `docker` group, but the
    socket may come up root-only after a fresh `dockerd` start)
- Start the stack: `npx supabase start` (first run pulls images and applies migrations 0000–0075
  plus `supabase/seed.sql`). This is service startup — do NOT put it in the update script.
- Get credentials any time with: `npx supabase status -o env`.

### Root `.env` is required for the web app and Node smoke scripts
- Vite reads env from the repo root (`envDir: "../.."`, `envPrefix: ["VITE_","EXPO_PUBLIC_"]`),
  not from `apps/web`. Copy `.env.example` to `.env` and fill the local Supabase values:
  - `EXPO_PUBLIC_SUPABASE_URL` / `SUPABASE_URL` = `http://127.0.0.1:54321`
  - `EXPO_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_ANON_KEY` = the local `ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` = the local `SERVICE_ROLE_KEY`
- `.env` is gitignored (do not commit it). Node smoke scripts read `SUPABASE_URL`/`ANON_KEY`/
  `SUPABASE_SERVICE_ROLE_KEY` from the shell, so `set -a; . ./.env; set +a` before running them
  (also export `SUPABASE_ANON_KEY="$EXPO_PUBLIC_SUPABASE_ANON_KEY"` for the resident smoke).

### Web dev server binds to IPv6 `localhost` only (Playwright gotcha)
- `npm run dev:web` serves on `http://localhost:5173` (IPv6 `::1`) but NOT `127.0.0.1:5173`.
- `npm run test:browser` (Playwright) starts its own `webServer` bound to `127.0.0.1:5173` and,
  because it can't reach an already-running IPv6-only dev server, tries to bind 5173 itself and
  times out. Stop any manual `dev:web` server before running `test:browser`, and let Playwright
  manage the server.

### Other notes
- `npm run lint` is currently a no-op — no workspace defines a `lint` script (root just fans out
  `--if-present`). There is no configured linter.
- `npm install` prints an `EBADENGINE` warning (engines want npm >= 11; node 22 ships npm 10.9.7).
  It is only a warning; install and all scripts work.
- DB smoke tests (`npm run test:recovery`) `docker exec` into the `supabase_db_cleanops` container
  directly, so Supabase must be running first.
- Full CI equivalent is `.github/workflows/quality-gate.yml`: env:check, typecheck, test, build,
  supabase start, db:lint, test:recovery, test:resident, paystack webhook smoke, test:browser.
- Demo logins (from seed): operator `owner@cleanops.local` / `cleanops-demo-password`; resident
  `resident@cleanops.local` / `cleanops-resident-password` (see `README.md` for driver/agent).
