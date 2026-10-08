import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { COMMS_CRON_SECRET_HEADER, classifyCommsCaller } from "../../../packages/shared/src/residentComms.ts";

const supabaseUrl =
  Deno.env.get("SUPABASE_URL") ?? Deno.env.get("EXPO_PUBLIC_SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("EXPO_PUBLIC_SUPABASE_ANON_KEY") ?? "";
const cronSecret = Deno.env.get("COMMS_CRON_SECRET") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cleanops-cron-secret"
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, {
    status,
    headers: corsHeaders
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
    return new Response("ok", { headers: corsHeaders });
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

  const caller = classifyCommsCaller({
    configuredSecret: cronSecret,
    presentedSecret: request.headers.get(COMMS_CRON_SECRET_HEADER),
    authorizationHeader: request.headers.get("Authorization")
  });
  if (caller.kind === "rejected") {
    return jsonResponse({ error: caller.error }, caller.status);
  }

  const force = Boolean(body.force);
  const asOf = typeof body.asOf === "string" ? body.asOf : undefined;
  const shouldDispatch = body.dispatch !== false;
  const limit = typeof body.limit === "number" ? Math.min(Math.max(body.limit, 1), 100) : 50;

  let queueResult: Record<string, unknown> | null = null;
  let dispatchOperatorId: string | null = null;

  if (caller.kind === "staff") {
    if (!anonKey) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: caller.authorization } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const {
      data: { user },
      error: userError
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const { data: context, error: contextError } = await userClient.rpc("comms_caller_context");
    if (contextError || !context || typeof context !== "object") {
      const message = contextError?.message ?? "Unauthorized";
      const status = /not permitted|Operator context/i.test(message) ? 403 : 401;
      return jsonResponse({ error: message }, status);
    }

    dispatchOperatorId = (context as { operatorId?: string }).operatorId ?? null;
    if (!dispatchOperatorId) {
      return jsonResponse({ error: "Operator context is required" }, 403);
    }

    const { data, error } = await userClient.rpc("queue_payment_reminders", {
      input_days_before_due: daysBeforeDue,
      input_force: force,
      input_as_of: asOf ?? undefined
    });

    if (error) {
      const status = /not permitted/i.test(error.message) ? 403 : 400;
      return jsonResponse({ error: error.message }, status);
    }
    queueResult = (data ?? {}) as Record<string, unknown>;
  } else {
    if (!body.operatorId) {
      return jsonResponse({ error: "operatorId is required for cron reminder runs" }, 400);
    }

    dispatchOperatorId = body.operatorId;
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
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
  }

  let dispatchResult: Record<string, unknown> | null = null;
  if (shouldDispatch) {
    const dispatchUrl = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/dispatch-resident-comms`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      apikey: anonKey || serviceRoleKey
    };
    const dispatchBody: Record<string, unknown> = { limit };

    if (caller.kind === "cron") {
      headers[COMMS_CRON_SECRET_HEADER] = cronSecret;
      headers.Authorization = `Bearer ${anonKey || serviceRoleKey}`;
      dispatchBody.operatorId = dispatchOperatorId;
    } else {
      headers.Authorization = caller.authorization;
    }

    const response = await fetch(dispatchUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(dispatchBody)
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
