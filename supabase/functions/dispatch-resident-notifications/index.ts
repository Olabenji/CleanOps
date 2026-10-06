import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl =
  Deno.env.get("SUPABASE_URL") ?? Deno.env.get("EXPO_PUBLIC_SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

type OutboxItem = {
  id: string;
  operatorId: string;
  customerId: string;
  notificationId: string | null;
  payload: {
    title?: string;
    body?: string;
    data?: Record<string, unknown>;
  };
  attemptCount: number;
  tokens: Array<{ deviceId: string; token: string; platform: string }>;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status });
}

async function sendExpoPush(
  messages: Array<{ to: string; title: string; body: string; data?: Record<string, unknown> }>
) {
  if (messages.length === 0) {
    return [] as Array<{ status: string; id?: string; message?: string; details?: { error?: string } }>;
  }

  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json"
    },
    body: JSON.stringify(messages)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Expo push failed (${response.status}): ${text}`);
  }

  const payload = await response.json();
  return (payload?.data ?? []) as Array<{
    status: string;
    id?: string;
    message?: string;
    details?: { error?: string };
  }>;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Supabase service credentials are not configured" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const body = await request.json().catch(() => ({}));
  const limit = typeof body?.limit === "number" ? Math.min(Math.max(body.limit, 1), 100) : 50;

  const { data: claimed, error: claimError } = await supabase.rpc("claim_notification_outbox", {
    input_limit: limit
  });

  if (claimError) {
    return jsonResponse({ error: claimError.message }, 500);
  }

  const items = (claimed ?? []) as OutboxItem[];
  let sent = 0;
  let failed = 0;
  let skippedNoToken = 0;

  for (const item of items) {
    const title = item.payload?.title ?? "CleanOps";
    const bodyText = item.payload?.body ?? "";
    const data = {
      ...(item.payload?.data ?? {}),
      notificationId: item.notificationId
    };

    if (!item.tokens || item.tokens.length === 0) {
      skippedNoToken += 1;
      await supabase.rpc("complete_notification_outbox", {
        input_outbox_id: item.id,
        input_success: true,
        input_provider_ticket_id: null,
        input_error: "No registered push devices",
        input_disable_device_ids: null
      });
      continue;
    }

    try {
      const messages = item.tokens.map((token) => ({
        to: token.token,
        title,
        body: bodyText,
        data,
        sound: "default",
        channelId: "resident-default"
      }));

      const results = await sendExpoPush(messages);
      const disableDeviceIds: string[] = [];
      let ticketId: string | null = null;
      let anyError: string | null = null;

      results.forEach((result, index) => {
        if (result.status === "ok") {
          ticketId = result.id ?? ticketId;
          return;
        }

        anyError = result.message ?? result.details?.error ?? "Expo push ticket error";
        if (result.details?.error === "DeviceNotRegistered") {
          disableDeviceIds.push(item.tokens[index].deviceId);
        }
      });

      const success = !anyError;
      if (success) {
        sent += 1;
      } else {
        failed += 1;
      }

      await supabase.rpc("complete_notification_outbox", {
        input_outbox_id: item.id,
        input_success: success,
        input_provider_ticket_id: ticketId,
        input_error: anyError,
        input_disable_device_ids: disableDeviceIds.length > 0 ? disableDeviceIds : null
      });
    } catch (error) {
      failed += 1;
      await supabase.rpc("complete_notification_outbox", {
        input_outbox_id: item.id,
        input_success: false,
        input_provider_ticket_id: null,
        input_error: error instanceof Error ? error.message : "Push dispatch failed",
        input_disable_device_ids: null
      });
    }
  }

  return jsonResponse({
    claimed: items.length,
    sent,
    failed,
    skippedNoToken
  });
});
