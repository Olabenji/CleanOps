# CleanOps

CleanOps is a PSP operator and resident platform for Lagos State waste collection operations.

The product supports two connected surfaces:

- Operator tools for routes, staff, fleet, payments, P&L, and operational alerts.
- Field and resident mobile workflows for drivers, collection agents, and residents.

## Workspace

```text
apps/web        Operator dashboard
apps/mobile     Expo mobile app for driver, agent, and resident workflows
packages/shared Shared TypeScript types and validation
supabase        Database migrations and Edge Functions
docs            Architecture, roadmap, and implementation backlog
```

## Quick Start

```bash
npm install
supabase start          # local Postgres + Auth; use supabase db reset for fresh seed
supabase migration up
npm run typecheck
npm run dev:web         # http://localhost:5173
```

For mobile development (driver + collection agent):

```bash
npm run dev:mobile      # uses npx expo start -c
```

Set your machine's LAN IP in `apps/mobile/.env.local` so physical devices can reach local Supabase.

Local demo accounts are created only by `supabase/seed.sql` (local `supabase start` / `db reset`). Their passwords are not in the repo. After the database is up:

```bash
npm run demo:passwords
```

That writes gitignored `.env.demo.local` (see `demo.env.example`) and copies the field-app passwords into `apps/mobile/.env.local`. Sign in with those values. Migrations do not create these users on hosted Supabase.

Copy `.env.example` to `.env` and fill in Supabase, Paystack, Twilio, Termii, and Sentry values before connecting live services.

**Where we are:** pilot-ready / near production — see [docs/progress-snapshot.md](./docs/progress-snapshot.md). Detail: [docs/agent-handover.md](./docs/agent-handover.md), [docs/status-report.md](./docs/status-report.md), [docs/roadmap.md](./docs/roadmap.md).
