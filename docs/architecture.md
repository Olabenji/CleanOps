# CleanOps Architecture

## Product Surfaces

CleanOps ships as a TypeScript monorepo with three main runtime surfaces:

- Operator web dashboard built with React, Vite, and Supabase.
- Mobile app built with React Native and Expo for drivers and collection agents (residents planned for Phase 2).
- Supabase backend with PostgreSQL, Auth, Realtime, Storage, Row-Level Security, and Edge Functions.

## Backend Boundary

Business state belongs in PostgreSQL. Client apps call Supabase directly for scoped CRUD and RPCs protected by Row-Level Security. Sensitive or privileged operations belong in security-definer RPCs / Edge Functions:

- Staff Auth user provisioning and password-reset targeting (RPCs in migrations `0022`–`0024`).
- Paystack webhook verification and payment posting (`paystack-webhook` Edge Function + `record_paystack_payment` RPC).
- WhatsApp/SMS reminder + receipt + suspension dispatch (Twilio WhatsApp, Termii SMS fallback).
- Monthly invoice generation (planned).
- Supervisor-approved service suspension/resumption (RPCs delivered).
- Admin-only SaaS operations (Phase 3).

## Offline Strategy

Driver and agent workflows must work during intermittent Lagos network conditions. The mobile app queues route stop updates and agent cash entries locally, then syncs when connectivity returns. Server-side idempotency keys prevent duplicate payment or stop records. Live authenticated sessions must not silently substitute pilot demo routes when an assignment is missing.

## Multi-Tenant Model

The schema is multi-operator from day one. Tenant-owned tables include `operator_id`, and RLS policies scope reads/writes through authenticated user profiles. Phase 1 operates with one PSP operator; the data model should not require a rewrite for Phase 3 SaaS onboarding.

## Current status

See [status-report.md](./status-report.md) and [build-plan.md](./build-plan.md).
