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
npm run typecheck
npm run dev:web
```

For mobile development:

```bash
npm run dev:mobile
```

Copy `.env.example` to `.env` and fill in Supabase, Paystack, Twilio, Termii, and Sentry values before connecting live services.
