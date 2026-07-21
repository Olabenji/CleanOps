import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const paystackSecretKey = Deno.env.get("PAYSTACK_SECRET_KEY") ?? "";
const siteUrl = (Deno.env.get("SITE_URL") ?? "http://localhost:5173").replace(/\/$/, "");

const MAX_AMOUNT_KOBO = 5_000_000_00; // ₦5,000,000

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
    }
  });
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

  if (!supabaseUrl || !anonKey) {
    return jsonResponse({ error: "Supabase credentials are not configured" }, 500);
  }

  if (!paystackSecretKey) {
    return jsonResponse({ error: "PAYSTACK_SECRET_KEY is not configured" }, 500);
  }

  if (
    paystackSecretKey === "sk_test_local_cleanops" ||
    !paystackSecretKey.startsWith("sk_")
  ) {
    return jsonResponse(
      {
        error:
          "Set a real Paystack test secret (sk_test_...) via supabase secrets / .env.functions.local. sk_test_local_cleanops is only for webhook smoke tests."
      },
      500
    );
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
  const email = (context.email as string | null | undefined)?.trim().toLowerCase();
  const outstandingKobo = Number(context.outstandingKobo ?? 0);

  if (!customerId || !operatorId) {
    return jsonResponse({ error: "Resident account is not linked to a customer" }, 400);
  }

  if (!email) {
    return jsonResponse(
      { error: "Add an email on your customer account before paying online" },
      400
    );
  }

  let body: { amountKobo?: number; callbackUrl?: string } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const requestedAmount =
    typeof body.amountKobo === "number" && Number.isFinite(body.amountKobo)
      ? Math.round(body.amountKobo)
      : outstandingKobo;

  const requestedCallbackUrl =
    typeof body.callbackUrl === "string" ? body.callbackUrl.trim() : "";
  const callbackUrl =
    requestedCallbackUrl.startsWith("cleanops://") ||
    requestedCallbackUrl.startsWith(`${siteUrl}/`)
      ? requestedCallbackUrl
      : `${siteUrl}/?paystack=return`;

  if (!Number.isInteger(requestedAmount) || requestedAmount < 100) {
    return jsonResponse({ error: "Minimum payment is ₦1.00" }, 400);
  }

  if (requestedAmount > MAX_AMOUNT_KOBO) {
    return jsonResponse({ error: "Amount exceeds the online payment limit" }, 400);
  }

  const reference = `rsp_${customerId.replace(/-/g, "").slice(-12)}_${Date.now()}`;

  const initializeResponse = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${paystackSecretKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      email,
      amount: requestedAmount,
      currency: "NGN",
      reference,
      callback_url: callbackUrl,
      metadata: {
        operator_id: operatorId,
        customer_id: customerId,
        source: requestedCallbackUrl.startsWith("cleanops://")
          ? "resident_mobile"
          : "resident_portal"
      }
    })
  });

  const initializePayload = await initializeResponse.json().catch(() => null);

  if (!initializeResponse.ok || !initializePayload?.status || !initializePayload?.data) {
    const message =
      initializePayload?.message ??
      initializePayload?.data?.message ??
      "Unable to start Paystack checkout";
    return jsonResponse({ error: message }, 502);
  }

  return jsonResponse({
    authorizationUrl: initializePayload.data.authorization_url,
    accessCode: initializePayload.data.access_code,
    reference: initializePayload.data.reference,
    amountKobo: requestedAmount
  });
});
