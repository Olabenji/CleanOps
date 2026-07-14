# Multi-tenant smoke test

See [saas-packaging.md](./saas-packaging.md) for the full checklist and credentials.

Quick path after `npx supabase db reset`:

1. `platform@cleanops.local` / `cleanops-platform-password` → Platform console
2. `owner@cleanops.local` / `cleanops-demo-password` → Next to Godliness
3. `island.owner@cleanops.local` / `cleanops-island-password` → Island Clean (empty tenant)

## LAWMA collection frequency

After reset, Next to Godliness customers should show frequency on Admin / ledger (e.g. residential `1×/week · Mon`, Tasty Bites `3×/week · Mon,Wed,Fri`). On Routes for a Monday/Wednesday/Friday ops date, Tasty Bites should be marked **Due today**. Dashboard alerts include overdue residential/commercial SLA summaries when completed stops fall outside the frequency window.
