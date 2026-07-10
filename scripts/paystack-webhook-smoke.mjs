#!/usr/bin/env node
/**
 * Local Paystack webhook smoke helpers.
 *
 * Usage:
 *   node scripts/paystack-webhook-smoke.mjs sign
 *   node scripts/paystack-webhook-smoke.mjs post
 *   node scripts/paystack-webhook-smoke.mjs post-duplicate
 *
 * Env:
 *   PAYSTACK_SECRET_KEY   (required) — same secret used by the Edge Function
 *   PAYSTACK_WEBHOOK_URL  (optional) — default http://127.0.0.1:54321/functions/v1/paystack-webhook
 *   OPERATOR_ID           (optional) — default pilot operator UUID
 *   CUSTOMER_ID           (optional) — default Blue Gate Mini Mart (suspended) UUID
 *   AMOUNT_KOBO           (optional) — default 1500000 (monthly rate for Blue Gate)
 *   REFERENCE             (optional) — default generated smoke reference
 */

import { createHmac, randomBytes } from "node:crypto";

const secret = process.env.PAYSTACK_SECRET_KEY ?? "";
const webhookUrl =
  process.env.PAYSTACK_WEBHOOK_URL ?? "http://127.0.0.1:54321/functions/v1/paystack-webhook";
const operatorId =
  process.env.OPERATOR_ID ?? "00000000-0000-4000-8000-000000000001";
const customerId =
  process.env.CUSTOMER_ID ?? "00000000-0000-4000-8000-000000000404";
const amountKobo = Number(process.env.AMOUNT_KOBO ?? "1500000");
const reference =
  process.env.REFERENCE ?? `PSK_SMOKE_${randomBytes(4).toString("hex").toUpperCase()}`;

function buildPayload() {
  return {
    event: "charge.success",
    data: {
      amount: amountKobo,
      reference,
      paid_at: new Date().toISOString(),
      metadata: {
        operator_id: operatorId,
        customer_id: customerId
      }
    }
  };
}

function sign(rawBody) {
  if (!secret) {
    throw new Error("Set PAYSTACK_SECRET_KEY before running this script.");
  }
  return createHmac("sha512", secret).update(rawBody).digest("hex");
}

async function postOnce(label) {
  const payload = buildPayload();
  const rawBody = JSON.stringify(payload);
  const signature = sign(rawBody);

  console.log(`[${label}] POST ${webhookUrl}`);
  console.log(`[${label}] reference=${reference} amount_kobo=${amountKobo}`);

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-paystack-signature": signature
    },
    body: rawBody
  });

  const text = await response.text();
  console.log(`[${label}] status=${response.status}`);
  console.log(`[${label}] body=${text}`);
  return { status: response.status, text };
}

const command = process.argv[2] ?? "help";

if (command === "sign") {
  const rawBody = JSON.stringify(buildPayload());
  console.log(JSON.stringify({ rawBody, signature: sign(rawBody), reference }, null, 2));
} else if (command === "post") {
  await postOnce("post");
} else if (command === "post-duplicate") {
  await postOnce("first");
  await postOnce("duplicate");
} else {
  console.log(`Unknown or missing command: ${command}

Commands:
  sign             Print signed payload JSON (for manual curl)
  post             POST one signed charge.success event
  post-duplicate   POST the same reference twice (idempotency check)
`);
  process.exit(command === "help" ? 0 : 1);
}
