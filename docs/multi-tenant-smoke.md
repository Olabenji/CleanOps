# Multi-tenant smoke test

See [saas-packaging.md](./saas-packaging.md) for the full checklist and credentials.

Quick path after `npx supabase db reset` and `npm run demo:passwords` (passwords live in gitignored `.env.demo.local`, see `demo.env.example`):

1. Platform admin email from `.env.demo.local` → Platform console
2. Operator email from `.env.demo.local` → Demo Waste Co (Fictional)
3. Island owner email from `.env.demo.local` → Island Clean (empty tenant)

## LAWMA collection frequency

After reset, Demo Waste Co (Fictional) customers should show frequency on Admin / ledger (e.g. residential `1×/week · Mon`, Tasty Bites `3×/week · Mon,Wed,Fri`). On Routes for a Monday/Wednesday/Friday ops date, Tasty Bites should be marked **Due today**. Dashboard alerts include overdue residential/commercial SLA summaries when completed stops fall outside the frequency window.
