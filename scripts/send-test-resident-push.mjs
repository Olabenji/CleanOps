#!/usr/bin/env node
/**
 * Send a one-off Expo push for device QA.
 *
 * Modes:
 *   1) Direct token:  EXPO_PUSH_TOKEN=ExponentPushToken[...] node scripts/send-test-resident-push.mjs
 *   2) From DB:       uses SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to pick the newest
 *                     active resident_push_devices row (optional CUSTOMER_ID filter).
 *   3) Dispatch outbox: --dispatch also POSTs dispatch-resident-notifications (needs service role).
 *   4) Dispatch only:   --dispatch-only flushes notification_outbox without a direct Expo test send.
 *
 * Usage:
 *   node scripts/send-test-resident-push.mjs
 *   node scripts/send-test-resident-push.mjs --dispatch
 *   node scripts/send-test-resident-push.mjs --dispatch-only
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = new Set(process.argv.slice(2));
const wantDispatch = args.has("--dispatch") || args.has("--dispatch-only");
const dispatchOnly = args.has("--dispatch-only");

function loadEnvFiles() {
  for (const name of [".env.local", ".env.functions.local", ".env"]) {
    const path = resolve(process.cwd(), name);
    if (!existsSync(path)) continue;
    for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

loadEnvFiles();

const supabaseUrl =
  process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const directToken = process.env.EXPO_PUSH_TOKEN?.trim() ?? "";
const customerId = process.env.CUSTOMER_ID?.trim() ?? "";

async function sendExpoPush(token, title, body, data) {
  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json"
    },
    body: JSON.stringify([
      {
        to: token,
        title,
        body,
        data,
        sound: "default",
        channelId: "resident-default"
      }
    ])
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Expo push HTTP ${response.status}: ${text}`);
  }

  const payload = JSON.parse(text);
  return payload?.data ?? payload;
}

async function resolveTokenFromDb() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Set EXPO_PUSH_TOKEN, or SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to look up a device token."
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  let query = supabase
    .from("resident_push_devices")
    .select("id, customer_id, expo_push_token, platform, last_seen_at, disabled_at")
    .is("disabled_at", null)
    .order("last_seen_at", { ascending: false })
    .limit(1);

  if (customerId) {
    query = query.eq("customer_id", customerId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Token lookup failed: ${error.message}`);
  }
  const row = data?.[0];
  if (!row?.expo_push_token) {
    throw new Error(
      "No active resident_push_devices row. Sign in on a development build and grant notification permission first."
    );
  }

  console.log(
    `Using device ${row.id} (${row.platform}) customer=${row.customer_id} last_seen=${row.last_seen_at}`
  );
  return row.expo_push_token;
}

async function dispatchOutbox() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Outbox dispatch needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  }

  const response = await fetch(
    `${supabaseUrl.replace(/\/$/, "")}/functions/v1/dispatch-resident-notifications`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ limit: 20 })
    }
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`dispatch-resident-notifications ${response.status}: ${text}`);
  }
  console.log("Dispatch result:", text);
}

async function main() {
  if (dispatchOnly) {
    await dispatchOutbox();
    console.log("OK — outbox flush finished. Check notification_outbox status=sent and the device tray.");
    return;
  }

  const token = directToken || (await resolveTokenFromDb());
  const title = "CleanOps push QA";
  const body = `Test push at ${new Date().toISOString()}`;
  const data = { kind: "push_qa", notificationId: null };

  console.log(`Sending Expo push to ${token.slice(0, 28)}…`);
  const tickets = await sendExpoPush(token, title, body, data);
  console.log("Expo tickets:", JSON.stringify(tickets, null, 2));

  const failed = (Array.isArray(tickets) ? tickets : []).filter(
    (t) => t?.status && t.status !== "ok"
  );
  if (failed.length > 0) {
    throw new Error(
      `Expo rejected ticket(s): ${failed.map((t) => t.message ?? t.details?.error).join("; ")}`
    );
  }

  if (wantDispatch) {
    await dispatchOutbox();
  }

  console.log("OK — if FCM/APNs credentials are linked, the device should show the notification.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
