import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl =
  Deno.env.get("SUPABASE_URL") ?? Deno.env.get("EXPO_PUBLIC_SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const twilioAccountSid = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const twilioAuthToken = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const twilioWhatsAppFrom = Deno.env.get("TWILIO_WHATSAPP_FROM") ?? "";

const termiiApiKey = Deno.env.get("TERMII_API_KEY") ?? "";
const termiiSenderId = Deno.env.get("TERMII_SENDER_ID") ?? "CleanOps";

type CommsOutboxItem = {
  id: string;
  operatorId: string;
  customerId: string;
  notificationId: string | null;
  channel: string;
  payload: {
    title?: string;
    body?: string;
    phoneE164?: string;
    fallbackChannel?: string;
  };
  attemptCount: number;
  phoneE164?: string | null;
  fallbackChannel?: string | null;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status });
}

function hasTwilio() {
  return Boolean(twilioAccountSid && twilioAuthToken && twilioWhatsAppFrom);
}

function hasTermii() {
  return Boolean(termiiApiKey);
}

async function sendTwilioWhatsApp(toE164: string, body: string) {
  const from = twilioWhatsAppFrom.startsWith("whatsapp:")
    ? twilioWhatsAppFrom
    : `whatsapp:${twilioWhatsAppFrom}`;
  const to = toE164.startsWith("whatsapp:") ? toE164 : `whatsapp:${toE164}`;
  const credentials = btoa(`${twilioAccountSid}:${twilioAuthToken}`);
  const params = new URLSearchParams({
    From: from,
    To: to,
    Body: body
  });

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    }
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      typeof payload?.message === "string"
        ? payload.message
        : `Twilio WhatsApp failed (${response.status})`
    );
  }

  return {
    channel: "whatsapp" as const,
    ticketId: typeof payload?.sid === "string" ? payload.sid : null
  };
}

async function sendTermiiSms(toE164: string, body: string) {
  const to = toE164.replace(/^\+/, "");
  const response = await fetch("https://api.ng.termii.com/api/sms/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to,
      from: termiiSenderId,
      sms: body,
      type: "plain",
      channel: "generic",
      api_key: termiiApiKey
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.code === "error") {
    throw new Error(
      typeof payload?.message === "string"
        ? payload.message
        : `Termii SMS failed (${response.status})`
    );
  }

  return {
    channel: "sms" as const,
    ticketId:
      typeof payload?.message_id === "string"
        ? payload.message_id
        : typeof payload?.messageId === "string"
          ? payload.messageId
          : null
  };
}

async function deliverMessage(item: CommsOutboxItem) {
  const phone = item.phoneE164 ?? item.payload?.phoneE164 ?? null;
  const body = item.payload?.body ?? item.payload?.title ?? "CleanOps notice";
  if (!phone) {
    throw new Error("Missing phoneE164 on comms outbox payload");
  }

  const preferWhatsApp = item.channel !== "sms";
  const allowSmsFallback = (item.fallbackChannel ?? item.payload?.fallbackChannel ?? "sms") === "sms";

  const errors: string[] = [];

  if (preferWhatsApp && hasTwilio()) {
    try {
      return await sendTwilioWhatsApp(phone, body);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Twilio failed");
      if (!allowSmsFallback) {
        throw error;
      }
    }
  } else if (preferWhatsApp && !hasTwilio()) {
    errors.push("Twilio WhatsApp credentials are not configured");
  }

  if (allowSmsFallback || item.channel === "sms") {
    if (!hasTermii()) {
      errors.push("Termii SMS credentials are not configured");
      throw new Error(errors.join("; "));
    }
    return await sendTermiiSms(phone, body);
  }

  throw new Error(errors.join("; ") || "No messaging provider available");
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

  const { data: claimed, error: claimError } = await supabase.rpc("claim_comms_outbox", {
    input_limit: limit
  });

  if (claimError) {
    return jsonResponse({ error: claimError.message }, 500);
  }

  const items = (claimed ?? []) as CommsOutboxItem[];
  let sent = 0;
  let failed = 0;
  let viaWhatsApp = 0;
  let viaSms = 0;

  for (const item of items) {
    try {
      const result = await deliverMessage(item);
      if (result.channel === "whatsapp") {
        viaWhatsApp += 1;
      } else {
        viaSms += 1;
      }
      sent += 1;
      await supabase.rpc("complete_comms_outbox", {
        input_outbox_id: item.id,
        input_success: true,
        input_channel_used: result.channel,
        input_provider_ticket_id: result.ticketId,
        input_error: null
      });
    } catch (error) {
      failed += 1;
      await supabase.rpc("complete_comms_outbox", {
        input_outbox_id: item.id,
        input_success: false,
        input_channel_used: null,
        input_provider_ticket_id: null,
        input_error: error instanceof Error ? error.message : "Comms dispatch failed"
      });
    }
  }

  return jsonResponse({
    claimed: items.length,
    sent,
    failed,
    viaWhatsApp,
    viaSms,
    providers: {
      twilioConfigured: hasTwilio(),
      termiiConfigured: hasTermii()
    }
  });
});
