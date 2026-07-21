import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const paystackSecretKey = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
    }
  });
}

function readMetadataUuid(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    return null;
  }
  return value;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
      }
    });
  }

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Supabase credentials are not configured" }, 500);
  }

  if (!paystackSecretKey || paystackSecretKey === "sk_test_local_cleanops") {
    return jsonResponse({ error: "PAYSTACK_SECRET_KEY is not configured" }, 500);
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } }
  });

  const {
    data: { user },
    error: userError
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const { data: context, error: contextError } = await userClient.rpc(
    "get_resident_checkout_context"
  );

  if (contextError || !context) {
    return jsonResponse(
      { error: contextError?.message ?? "Unable to load resident checkout context" },
      403
    );
  }

  const customerId = context.customerId as string | undefined;
  const operatorId = context.operatorId as string | undefined;

  if (!customerId || !operatorId) {
    return jsonResponse({ error: "Resident account is not linked to a customer" }, 400);
  }

  let body: { reference?: string } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const reference = typeof body.reference === "string" ? body.reference.trim() : "";
  if (!reference) {
    return jsonResponse({ error: "Payment reference is required" }, 400);
  }

  const verifyResponse = await fetch(
    `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
    {
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`
      }
    }
  );

  const verifyPayload = await verifyResponse.json().catch(() => null);
  if (!verifyResponse.ok || !verifyPayload?.status || !verifyPayload?.data) {
    return jsonResponse(
      { error: verifyPayload?.message ?? "Unable to verify Paystack payment" },
      502
    );
  }

  const charge = verifyPayload.data as {
    status?: string;
    amount?: number;
    paid_at?: string;
    reference?: string;
    metadata?: Record<string, unknown>;
  };

  if (charge.status !== "success") {
    return jsonResponse({ error: `Payment status is ${charge.status ?? "unknown"}` }, 400);
  }

  const amountKobo = typeof charge.amount === "number" ? charge.amount : Number.NaN;
  if (!Number.isInteger(amountKobo) || amountKobo <= 0) {
    return jsonResponse({ error: "Invalid verified payment amount" }, 400);
  }

  const metadata = charge.metadata ?? {};
  const metaOperatorId = readMetadataUuid(metadata, "operator_id");
  const metaCustomerId = readMetadataUuid(metadata, "customer_id");

  if (metaOperatorId !== operatorId || metaCustomerId !== customerId) {
    return jsonResponse({ error: "Payment does not belong to this resident account" }, 403);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: result, error: recordError } = await admin.rpc("record_paystack_payment", {
    input_operator_id: operatorId,
    input_customer_id: customerId,
    input_amount_kobo: amountKobo,
    input_external_reference: charge.reference ?? reference,
    input_paid_at: charge.paid_at ?? new Date().toISOString()
  });

  if (recordError) {
    return jsonResponse({ error: recordError.message }, 500);
  }

  return jsonResponse({
    posted: true,
    alreadyPosted: Boolean(result?.alreadyPosted),
    paymentId: result?.paymentId ?? null,
    outstandingKobo: result?.outstandingKobo ?? null,
    amountKobo,
    reference: charge.reference ?? reference
  });
});
