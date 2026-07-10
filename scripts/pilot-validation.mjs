#!/usr/bin/env node
/**
 * Supabase-only pilot validation — exercises Phase 1 flows via live RPCs.
 * No hardcoded pilot TS data; all assertions target seed UUIDs / DB state.
 *
 * Usage:
 *   node scripts/pilot-validation.mjs
 *   node scripts/pilot-validation.mjs --cleanup   # remove validation payments only
 *
 * Env (defaults for local Supabase):
 *   SUPABASE_URL=http://127.0.0.1:54321
 *   SUPABASE_ANON_KEY=<from supabase status -o env>
 */

import { createHmac, randomBytes } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const OPERATOR_ID = "00000000-0000-4000-8000-000000000001";
const PILOT_FAKE_ROUTE_PREFIX = "11111111-1111-4111-8111";

const CREDS = {
  operator: { email: "owner@cleanops.local", password: "cleanops-demo-password" },
  driver: { email: "driver@cleanops.local", password: "cleanops-driver-password" },
  agent: { email: "agent@cleanops.local", password: "cleanops-agent-password" }
};

const results = [];
let passed = 0;
let failed = 0;

function tomorrowIso() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (ok) passed += 1;
  else failed += 1;
  const mark = ok ? "PASS" : "FAIL";
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function signIn(role) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(CREDS[role])
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Sign-in failed for ${role}: ${response.status} ${text}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function rpc(token, fn, args = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(args)
  });

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  return { ok: response.ok, status: response.status, body, text };
}

async function getPendingStopId(token) {
  const route = await rpc(token, "driver_assigned_route", { input_date: todayIso() });
  if (!route.ok || !route.body?.stops) {
    return null;
  }
  const pending = route.body.stops.find((s) => s.status === "pending");
  return pending?.id ?? null;
}

async function cleanupValidationPayments() {
  const { execSync } = await import("node:child_process");
  const sql = `
    delete from public.payments
    where idempotency_key like 'pilot-val:%' or external_reference like 'PILOT_VAL_%';
  `;
  execSync(
    `psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "${sql.replace(/\n/g, " ")}"`,
    { env: { ...process.env, PGPASSWORD: "postgres" }, stdio: "inherit" }
  );
}

async function run() {
  if (process.argv.includes("--cleanup")) {
    console.log("Cleaning up pilot validation payments...");
    await cleanupValidationPayments();
    return;
  }

  console.log(`\nCleanOps pilot validation (Supabase only)`);
  console.log(`URL: ${SUPABASE_URL}\n`);

  let operatorToken;
  let driverToken;
  let agentToken;

  try {
    operatorToken = await signIn("operator");
    record("Operator sign-in", true, CREDS.operator.email);
  } catch (error) {
    record("Operator sign-in", false, error.message);
    return printSummary();
  }

  try {
    driverToken = await signIn("driver");
    record("Driver sign-in", true, CREDS.driver.email);
  } catch (error) {
    record("Driver sign-in", false, error.message);
  }

  try {
    agentToken = await signIn("agent");
    record("Agent sign-in", true, CREDS.agent.email);
  } catch (error) {
    record("Agent sign-in", false, error.message);
  }

  // Ensure today has planned routes (seed current_date drifts after db reset)
  const today = todayIso();
  const routesToday = await rpc(operatorToken, "operator_dashboard_snapshot", { input_date: today });
  if (routesToday.ok && (routesToday.body?.routes?.length ?? 0) === 0) {
    const planToday = await rpc(operatorToken, "plan_daily_routes", { input_scheduled_date: today });
    record(
      "Plan daily routes for today (seed gap fill)",
      planToday.ok,
      planToday.ok ? `planned=${planToday.body}` : String(planToday.text).slice(0, 120)
    );
  }

  // Dashboard — live operator name + no pilot fake route IDs
  const dashboard = await rpc(operatorToken, "operator_dashboard_snapshot", {
    input_date: today
  });
  const dashJson = JSON.stringify(dashboard.body ?? {});
  const dashOk =
    dashboard.ok &&
    dashboard.body?.operatorName === "Next to Godliness Ventures" &&
    !dashJson.includes(PILOT_FAKE_ROUTE_PREFIX);
  record(
    "Operator dashboard snapshot (live seed data)",
    dashOk,
    dashOk
      ? `${dashboard.body.routes?.length ?? 0} routes, operator=${dashboard.body.operatorName}`
      : dashboard.text?.slice(0, 120)
  );

  // Plan tomorrow's routes
  const tomorrow = tomorrowIso();
  const plan = await rpc(operatorToken, "plan_daily_routes", { input_scheduled_date: tomorrow });
  record(
    "Plan daily routes for tomorrow",
    plan.ok,
    plan.ok ? `date=${tomorrow}` : String(plan.body?.message ?? plan.text).slice(0, 120)
  );

  // Customer ledger
  const ledger = await rpc(operatorToken, "customer_ledger_snapshot");
  const ledgerOk =
    ledger.ok &&
    Array.isArray(ledger.body) &&
    ledger.body.length >= 5 &&
    ledger.body.some((c) => c.displayName === "Mrs. Folake Adebayo");
  record(
    "Customer ledger snapshot",
    ledgerOk,
    ledgerOk ? `${ledger.body.length} customers` : String(ledger.text).slice(0, 120)
  );

  // Driver assigned route
  if (driverToken) {
    const assigned = await rpc(driverToken, "driver_assigned_route", { input_date: today });
    const assignedOk =
      assigned.ok &&
      assigned.body?.id &&
      assigned.body?.driverName === "Adewale Johnson" &&
      Array.isArray(assigned.body?.stops) &&
      assigned.body.stops.length >= 1 &&
      !String(assigned.body.id).startsWith(PILOT_FAKE_ROUTE_PREFIX);
    record(
      "Driver assigned route",
      assignedOk,
      assignedOk
        ? `${assigned.body.scheduledDate} · ${assigned.body.completedStops}/${assigned.body.totalStops} stops`
        : String(assigned.body?.message ?? assigned.text).slice(0, 120)
    );

    const stopId = assigned.body?.stops?.find((s) => s.status === "pending")?.id ?? null;
    if (stopId) {
      const stopAction = await rpc(driverToken, "sync_driver_stop_action", {
        input_stop_id: stopId,
        next_status: "completed",
        input_notes: "Pilot validation stop"
      });
      record(
        "Driver complete pending stop",
        stopAction.ok && stopAction.body?.stopId === stopId,
        stopAction.ok ? `stop ${stopId.slice(0, 8)}…` : String(stopAction.text).slice(0, 120)
      );
    } else if (assigned.body?.status === "scheduled") {
      record(
        "Driver complete pending stop",
        false,
        "Route is scheduled — operator or driver must start shift (transition_route_status) before stop actions"
      );
    } else {
      record("Driver complete pending stop", false, "No pending stop found on assigned route");
    }
  }

  // Agent customer search + payment
  if (agentToken) {
    const search = await rpc(agentToken, "search_customers", { input_query: "Folake" });
    const searchOk =
      search.ok &&
      Array.isArray(search.body) &&
      search.body.some((c) => c.displayName?.includes("Folake"));
    record(
      "Agent customer search",
      searchOk,
      searchOk ? `found ${search.body.length}` : String(search.text).slice(0, 120)
    );

    const ref = `PILOT_VAL_${randomBytes(3).toString("hex").toUpperCase()}`;
    const customerId = "00000000-0000-4000-8000-000000000401";
    const payment = await rpc(agentToken, "record_agent_payment", {
      input_customer_id: customerId,
      input_amount_kobo: 100000,
      input_channel: "agent_cash",
      input_external_reference: ref,
      input_idempotency_key: `pilot-val:agent:${ref}`
    });
    record(
      "Agent record cash payment",
      payment.ok && payment.body?.receiptReference,
      payment.ok ? `ref=${ref}` : String(payment.text).slice(0, 120)
    );

    const collections = await rpc(operatorToken, "operator_agent_collections_snapshot", {
      input_date: today
    });
    const collectionsOk =
      collections.ok &&
      collections.body?.paymentCount >= 1 &&
      collections.body?.agents?.some((a) => a.agentName === "Kunle Martins");
    record(
      "Operator agent collections reconciliation",
      collectionsOk,
      collectionsOk
        ? `${collections.body.paymentCount} payments today`
        : String(collections.text).slice(0, 120)
    );
  }

  // Operator manual payment
  const manualRef = `PILOT_VAL_MANUAL_${randomBytes(2).toString("hex").toUpperCase()}`;
  const manual = await rpc(operatorToken, "record_operator_payment", {
    input_customer_id: "00000000-0000-4000-8000-000000000403",
    input_channel: "bank_transfer",
    input_amount_kobo: 50000,
    input_external_reference: manualRef
  });
  record(
    "Operator record manual payment",
    manual.ok && typeof manual.body === "string",
    manual.ok ? `paymentId=${String(manual.body).slice(0, 8)}…` : String(manual.text).slice(0, 120)
  );

  // Staff onboarding (unique email each run)
  const staffEmail = `pilot.val.${Date.now()}@cleanops.local`;
  const staffPhone = `+2348000${String(Date.now()).slice(-6)}`;
  const onboard = await rpc(operatorToken, "onboard_staff_member", {
    input_full_name: "Pilot Validation Staff",
    input_phone: staffPhone,
    input_role: "driver",
    input_monthly_salary_kobo: 15000000,
    input_login_email: staffEmail,
    input_provision_login: true
  });
  record(
    "Admin onboard staff with login",
    onboard.ok && onboard.body?.loginProvisioned && onboard.body?.temporaryPassword,
    onboard.ok ? staffEmail : String(onboard.text).slice(0, 120)
  );

  // New staff can sign in
  if (onboard.ok && onboard.body?.temporaryPassword) {
    try {
      const newStaffToken = await signInWithEmail(staffEmail, onboard.body.temporaryPassword);
      const newRoute = await rpc(newStaffToken, "driver_assigned_route", { input_date: today });
      record(
        "Newly provisioned staff sign-in",
        Boolean(newStaffToken),
        staffEmail
      );
      record(
        "New staff driver workspace (no silent pilot route)",
        newRoute.ok && (newRoute.body === null || newRoute.body?.id?.startsWith("00000000")),
        newRoute.body?.id ? `route ${newRoute.body.id.slice(0, 8)}…` : "no assignment (expected OK)"
      );
    } catch (error) {
      record("Newly provisioned staff sign-in", false, error.message);
    }
  }

  // Paystack webhook path (optional — needs functions serve + PAYSTACK_SECRET_KEY)
  const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
  if (paystackSecret) {
    const pskRef = `PILOT_VAL_PSK_${randomBytes(3).toString("hex").toUpperCase()}`;
    const payload = {
      event: "charge.success",
      data: {
        amount: 50000,
        reference: pskRef,
        paid_at: new Date().toISOString(),
        metadata: {
          operator_id: OPERATOR_ID,
          customer_id: "00000000-0000-4000-8000-000000000402"
        }
      }
    };
    const rawBody = JSON.stringify(payload);
    const signature = createHmac("sha512", paystackSecret).update(rawBody).digest("hex");
    const webhook = await fetch(`${SUPABASE_URL}/functions/v1/paystack-webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-paystack-signature": signature
      },
      body: rawBody
    });
    const webhookBody = await webhook.json().catch(() => ({}));
    record(
      "Paystack webhook → ledger",
      webhook.ok && webhookBody.received === true,
      webhook.ok ? `ref=${pskRef}` : JSON.stringify(webhookBody).slice(0, 120)
    );
  } else {
    record("Paystack webhook → ledger", true, "skipped (set PAYSTACK_SECRET_KEY to include)");
  }

  // Verify no pilot fake route IDs in dashboard after mutations
  const dashAfter = await rpc(operatorToken, "operator_dashboard_snapshot", { input_date: today });
  const noPilotIds = !JSON.stringify(dashAfter.body).includes("11111111-1111-4111-8111");
  record("No hardcoded pilot route IDs in live snapshot", noPilotIds);

  // Floating trucks — cross-zone assignment must succeed (home zone is soft preference only)
  {
    const floatDate = (() => {
      const d = new Date();
      d.setDate(d.getDate() + 21);
      return d.toISOString().slice(0, 10);
    })();
    const ZONE_A = "00000000-0000-4000-8000-000000000101";
    const TRUCK_ZONE_A = "00000000-0000-4000-8000-000000000301";
    const TRUCK_ZONE_C = "00000000-0000-4000-8000-000000000303";

    await rpc(operatorToken, "plan_daily_routes", { input_scheduled_date: floatDate });
    const floatDash = await rpc(operatorToken, "operator_dashboard_snapshot", { input_date: floatDate });
    const floatRoutes = floatDash.body?.routes ?? [];
    const zoneARoute = floatRoutes.find((r) => r.zoneName === "Zone A");
    const zoneCRoute = floatRoutes.find((r) => r.zoneName === "Zone C");

    const options = await rpc(operatorToken, "route_planning_options");
    const truckIds = (options.body?.trucks ?? []).map((t) => t.id);
    record(
      "Planner lists trucks from all home zones",
      options.ok && truckIds.includes(TRUCK_ZONE_A) && truckIds.includes(TRUCK_ZONE_C),
      options.ok ? `${truckIds.length} trucks` : String(options.text).slice(0, 120)
    );

    if (zoneARoute?.id && zoneCRoute?.id) {
      const cancelC = await rpc(operatorToken, "transition_route_status", {
        input_route_id: zoneCRoute.id,
        next_status: "cancelled"
      });

      if (!cancelC.ok) {
        record(
          "Floating truck: free Zone C truck for cross-zone test",
          false,
          String(cancelC.body?.message ?? cancelC.text).slice(0, 160)
        );
      } else {
        const cross = await rpc(operatorToken, "update_route_plan_assignment", {
          input_route_id: zoneARoute.id,
          input_zone_id: ZONE_A,
          input_truck_id: TRUCK_ZONE_C,
          input_driver_id: null
        });
        record(
          "Assign Zone C home truck to Zone A route",
          cross.ok,
          cross.ok
            ? `date=${floatDate} truck=LAG-003-PSP`
            : String(cross.body?.message ?? cross.text).slice(0, 160)
        );

        await rpc(operatorToken, "update_route_plan_assignment", {
          input_route_id: zoneARoute.id,
          input_zone_id: ZONE_A,
          input_truck_id: TRUCK_ZONE_A,
          input_driver_id: null
        });
      }
    } else {
      record(
        "Assign Zone C home truck to Zone A route",
        false,
        `Missing float-date routes for ${floatDate} (A=${Boolean(zoneARoute)} C=${Boolean(zoneCRoute)})`
      );
    }
  }

  printSummary();
}

async function signInWithEmail(email, password) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json();
  return data.access_token;
}

function printSummary() {
  console.log(`\n---`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(`\nFailed checks:`);
    results.filter((r) => !r.ok).forEach((r) => console.log(`  - ${r.name}: ${r.detail}`));
    process.exit(1);
  }
  console.log(`\nPilot validation complete. All flows used live Supabase RPCs.`);
  console.log(`Cleanup test payments: node scripts/pilot-validation.mjs --cleanup`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
