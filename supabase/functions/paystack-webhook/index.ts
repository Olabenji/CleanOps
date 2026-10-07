import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl =
  Deno.env.get("SUPABASE_URL") ?? Deno.env.get("EXPO_PUBLIC_SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const paystackSecretKey = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status });
}

function timingSafeEqualString(left: string, right: string) {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let mismatch = leftBytes.length === rightBytes.length ? 0 : 1;

  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return mismatch === 0;
}

async function verifyPaystackSignature(rawBody: string, signatureHeader: string | null) {
  if (!paystackSecretKey) {
    return { ok: false as const, error: "PAYSTACK_SECRET_KEY is not configured" };
  }

  if (!signatureHeader) {
    return { ok: false as const, error: "Missing x-paystack-signature header" };
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(paystackSecretKey),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );

  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody)
  );

  const computed = Array.from(new Uint8Array(signatureBytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  if (!timingSafeEqualString(computed, signatureHeader.toLowerCase())) {
    return { ok: false as const, error: "Invalid Paystack signature" };
  }

  return { ok: true as const };
}

function readMetadataUuid(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    return null;
  }
  return value;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Supabase service credentials are not configured" }, 500);
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-paystack-signature");
  const verification = await verifyPaystackSignature(rawBody, signature);

  if (!verification.ok) {
    return jsonResponse({ error: verification.error }, 401);
  }

  let payload: {
    event?: string;
    data?: {
      amount?: number;
      reference?: string;
      paid_at?: string;
      metadata?: Record<string, unknown>;
    };
  };

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "Invalid JSON payload" }, 400);
  }

  const event = payload.event;
  if (event !== "charge.success") {
    return jsonResponse({ received: true, ignored: event ?? null });
  }

  const data = payload.data;
  if (!data) {
    return jsonResponse({ error: "Missing charge data" }, 400);
  }

  const reference = typeof data.reference === "string" ? data.reference.trim() : "";
  if (!reference) {
    return jsonResponse({ error: "Missing payment reference" }, 400);
  }

  const amountKobo = typeof data.amount === "number" ? data.amount : Number.NaN;
  if (!Number.isInteger(amountKobo) || amountKobo <= 0) {
    return jsonResponse({ error: "Invalid payment amount" }, 400);
  }

  const metadata = data.metadata ?? {};
  const operatorId = readMetadataUuid(metadata, "operator_id");
  const customerId = readMetadataUuid(metadata, "customer_id");

  if (!operatorId || !customerId) {
    return jsonResponse(
      {
        error:
          "charge.success metadata must include operator_id and customer_id UUID fields"
      },
      400
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: result, error } = await supabase.rpc("record_paystack_payment", {
    input_operator_id: operatorId,
    input_customer_id: customerId,
    input_amount_kobo: amountKobo,
    input_external_reference: reference,
    input_paid_at: data.paid_at ?? new Date().toISOString()
  });

  if (error) {
    return jsonResponse({ error: error.message }, 500);
  }

  return jsonResponse({
    received: true,
    paymentId: result?.paymentId ?? null,
    alreadyPosted: Boolean(result?.alreadyPosted),
    outstandingKobo: result?.outstandingKobo ?? null
  });
});
