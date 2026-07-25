import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl =
  Deno.env.get("SUPABASE_URL") ?? Deno.env.get("EXPO_PUBLIC_SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("EXPO_PUBLIC_SUPABASE_ANON_KEY") ?? "";

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
    }
  });
}

type ReminderRequest = {
  operatorId?: string;
  daysBeforeDue?: 2 | 5;
  force?: boolean;
  asOf?: string;
  dispatch?: boolean;
  limit?: number;
};

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

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Supabase service credentials are not configured" }, 500);
  }

  const body = (await request.json().catch(() => ({}))) as ReminderRequest;
  const daysBeforeDue = body.daysBeforeDue === 2 || body.daysBeforeDue === 5 ? body.daysBeforeDue : null;
  if (!daysBeforeDue) {
    return jsonResponse({ error: "daysBeforeDue must be 2 or 5" }, 400);
  }

  const force = Boolean(body.force);
  const asOf = typeof body.asOf === "string" ? body.asOf : undefined;
  const shouldDispatch = body.dispatch !== false;
  const limit = typeof body.limit === "number" ? Math.min(Math.max(body.limit, 1), 100) : 50;

  const authHeader = request.headers.get("Authorization");
  let queueResult: Record<string, unknown> | null = null;

  // Prefer caller JWT so RLS/operator scoping applies; fall back to service role + operatorId for cron.
  if (authHeader && anonKey) {
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

    const { data, error } = await userClient.rpc("queue_payment_reminders", {
      input_days_before_due: daysBeforeDue,
      input_force: force,
      input_as_of: asOf ?? undefined
    });

    if (error) {
      return jsonResponse({ error: error.message }, 400);
    }
    queueResult = (data ?? {}) as Record<string, unknown>;
  } else if (body.operatorId) {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    // Resolve an owner profile for the operator so set_config-style RPCs aren't required.
    const { data: owner, error: ownerError } = await admin
      .from("profiles")
      .select("id")
      .eq("operator_id", body.operatorId)
      .in("role", ["operator_owner", "operations_supervisor", "platform_admin"])
      .limit(1)
      .maybeSingle();

    if (ownerError || !owner?.id) {
      return jsonResponse(
        { error: ownerError?.message ?? "No operator manager profile found for operatorId" },
        400
      );
    }

    // Queue via SQL function using a security-definer path: call through service role after
    // temporarily impersonating is not available; instead use direct insert helper via RPC
    // that accepts operator id for service role only.
    const { data, error } = await admin.rpc("queue_payment_reminders_for_operator", {
      input_operator_id: body.operatorId,
      input_days_before_due: daysBeforeDue,
      input_force: force,
      input_as_of: asOf ?? undefined
    });

    if (error) {
      return jsonResponse({ error: error.message }, 400);
    }
    queueResult = (data ?? {}) as Record<string, unknown>;
  } else {
    return jsonResponse(
      { error: "Provide Authorization bearer token, or operatorId for service-role cron" },
      401
    );
  }

  let dispatchResult: Record<string, unknown> | null = null;
  if (shouldDispatch) {
    const dispatchUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/dispatch-resident-comms`;
    const response = await fetch(dispatchUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ limit })
    });
    dispatchResult = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      return jsonResponse(
        {
          queued: queueResult,
          dispatchError: dispatchResult?.error ?? `Dispatch failed (${response.status})`
        },
        502
      );
    }
  }

  return jsonResponse({
    queued: true,
    daysBeforeDue,
    queue: queueResult,
    dispatch: dispatchResult
  });
});
