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

| Role | Demo login |
|------|------------|
| Operator (web) | `owner@cleanops.local` / `cleanops-demo-password` |
| Driver (mobile) | `driver@cleanops.local` / `cleanops-driver-password` |
| Collection agent (mobile) | `agent@cleanops.local` / `cleanops-agent-password` |

Copy `.env.example` to `.env` and fill in Supabase, Paystack, Twilio, Termii, and Sentry values before connecting live services.

See [docs/status-report.md](./docs/status-report.md) and [docs/build-plan.md](./docs/build-plan.md) for current module status and sprint plan.
