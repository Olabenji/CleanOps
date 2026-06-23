# CleanOps Architecture

## Product Surfaces

CleanOps will ship as a TypeScript monorepo with three main runtime surfaces:

- Operator web dashboard built with React, Vite, and Supabase.
- Mobile app built with React Native and Expo for drivers, collection agents, and residents.
- Supabase backend with PostgreSQL, Auth, Realtime, Storage, Row-Level Security, and Edge Functions.

## Backend Boundary

Business state belongs in PostgreSQL. Client apps should call Supabase directly for scoped CRUD operations protected by Row-Level Security. Sensitive operations belong in Edge Functions:

- Paystack webhook verification and payment posting.
- WhatsApp/SMS reminder dispatch.
- Monthly invoice generation.
- Supervisor-approved service suspension/resumption.
- Admin-only SaaS operations.

## Offline Strategy

Driver and agent workflows must work during intermittent Lagos network conditions. The mobile app will queue route stop updates, attendance check-ins, fuel logs, and agent cash entries locally, then sync when connectivity returns. Server-side idempotency keys will prevent duplicate route or payment records.

## Multi-Tenant Model

The schema is multi-operator from day one. Tenant-owned tables include `operator_id`, and RLS policies will scope reads/writes through authenticated user profiles. Phase 1 will operate with one PSP operator, but the data model should not require a rewrite for Phase 3 SaaS onboarding.
