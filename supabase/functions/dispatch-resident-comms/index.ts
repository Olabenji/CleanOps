import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  COMMS_CRON_SECRET_HEADER,
  CommsSkipError,
  buildTwilioTemplateParams,
  classifyCommsCaller,
  contentSidEnvForKind,
  planResidentDelivery,
  termiiSmsRequest
} from "../../../packages/shared/src/residentComms.ts";

const supabaseUrl =
  Deno.env.get("SUPABASE_URL") ?? Deno.env.get("EXPO_PUBLIC_SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const anonKey =
  Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("EXPO_PUBLIC_SUPABASE_ANON_KEY") ?? "";
const cronSecret = Deno.env.get("COMMS_CRON_SECRET") ?? "";

const twilioAccountSid = Deno.env.get("TWILIO_ACCOUNT_SID") ?? "";
const twilioAuthToken = Deno.env.get("TWILIO_AUTH_TOKEN") ?? "";
const twilioWhatsAppFrom = Deno.env.get("TWILIO_WHATSAPP_FROM") ?? "";

const termiiApiKey = Deno.env.get("TERMII_API_KEY") ?? "";
const termiiSenderId = Deno.env.get("TERMII_SENDER_ID") ?? "CleanOps";

type TemplatePayload = {
  name?: string;
  variables?: unknown;
};

type CommsOutboxItem = {
  id: string;
  operatorId: string;
  customerId: string;
  notificationId: string | null;
  channel: string;
  payload: {
    title?: string;
    body?: string;
    kind?: string;
    phoneE164?: string;
    fallbackChannel?: string | null;
    template?: TemplatePayload;
  };
  attemptCount: number;
  phoneE164?: string | null;
  fallbackChannel?: string | null;
  whatsappConsent?: boolean;
  smsConsent?: boolean;
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

function templateVariables(item: CommsOutboxItem): string[] | null {
  const raw = item.payload?.template?.variables;
  if (!Array.isArray(raw) || raw.some((value) => typeof value !== "string")) {
    return null;
  }
  return raw;
}

function contentSidFor(kind: string) {
  const envName = contentSidEnvForKind(kind);
  if (!envName) {
    return "";
  }
  return (Deno.env.get(envName) ?? "").trim();
}

async function sendTwilioWhatsAppTemplate(toE164: string, kind: string, variables: string[]) {
  const built = buildTwilioTemplateParams({
    from: twilioWhatsAppFrom,
    toE164,
    kind,
    variables,
    contentSid: contentSidFor(kind)
  });
  if (!built.ok) {
    throw new Error(built.reason);
  }

  const credentials = btoa(`${twilioAccountSid}:${twilioAuthToken}`);
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams(built.params).toString()
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
  const request = termiiSmsRequest({
    baseUrl: Deno.env.get("TERMII_BASE_URL"),
    toE164,
    senderId: termiiSenderId,
    sms: body,
    apiKey: termiiApiKey
  });
  const response = await fetch(request.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request.body)
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

  const kind = item.payload?.template?.name ?? item.payload?.kind ?? "";
  const variables = templateVariables(item);
  const fallbackChannel = item.fallbackChannel ?? item.payload?.fallbackChannel ?? null;
  const plan = planResidentDelivery({
    requestedChannel: item.channel,
    fallbackChannel: fallbackChannel === "sms" ? "sms" : null,
    whatsappConsent: item.whatsappConsent === true,
    smsConsent: item.smsConsent === true,
    twilioConfigured: hasTwilio(),
    contentSid: contentSidFor(kind),
    hasTemplateVariables: variables !== null,
    termiiConfigured: hasTermii()
  });

  if (plan.action === "skip") {
    throw new CommsSkipError(plan.reason, plan.terminal);
  }

  if (plan.action === "whatsapp") {
    try {
      return await sendTwilioWhatsAppTemplate(phone, kind, variables ?? []);
    } catch (error) {
      const smsAllowed = fallbackChannel === "sms" && item.smsConsent === true;
      if (!smsAllowed || !hasTermii()) {
        throw error;
      }
    }
    return await sendTermiiSms(phone, body);
  }

  return await sendTermiiSms(phone, body);
}

async function resolveStaffOperatorId(
  authorization: string
): Promise<{ operatorId: string } | { error: string; status: number }> {
  if (!anonKey) {
    return { error: "Unauthorized", status: 401 };
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const {
    data: { user },
    error: userError
  } = await userClient.auth.getUser();

  if (userError || !user) {
    return { error: "Unauthorized", status: 401 };
  }

  const { data, error } = await userClient.rpc("comms_caller_context");
  if (error || !data || typeof data !== "object") {
    const message = error?.message ?? "Unauthorized";
    const status = /not permitted|Operator context/i.test(message) ? 403 : 401;
    return { error: message, status };
  }

  const operatorId = (data as { operatorId?: string }).operatorId;
  if (!operatorId) {
    return { error: "Operator context is required", status: 403 };
  }

  return { operatorId };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Supabase service credentials are not configured" }, 500);
  }

  const caller = classifyCommsCaller({
    configuredSecret: cronSecret,
    presentedSecret: request.headers.get(COMMS_CRON_SECRET_HEADER),
    authorizationHeader: request.headers.get("Authorization")
  });
  if (caller.kind === "rejected") {
    return jsonResponse({ error: caller.error }, caller.status);
  }

  const body = await request.json().catch(() => ({}));
  const limit = typeof body?.limit === "number" ? Math.min(Math.max(body.limit, 1), 100) : 50;
  let operatorId: string | null = null;

  if (caller.kind === "staff") {
    const staff = await resolveStaffOperatorId(caller.authorization);
    if ("error" in staff) {
      return jsonResponse({ error: staff.error }, staff.status);
    }
    operatorId = staff.operatorId;
  } else if (typeof body?.operatorId === "string" && body.operatorId) {
    operatorId = body.operatorId;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: claimed, error: claimError } = await supabase.rpc("claim_comms_outbox", {
    input_limit: limit,
    input_operator_id: operatorId
  });

  if (claimError) {
    return jsonResponse({ error: claimError.message }, 500);
  }

  const items = (claimed ?? []) as CommsOutboxItem[];
  let sent = 0;
  let failed = 0;
  let skipped = 0;
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
        input_error: null,
        input_skip: false
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Comms dispatch failed";
      const terminal = error instanceof CommsSkipError && error.terminal;
      if (terminal) {
        skipped += 1;
      } else {
        failed += 1;
      }
      await supabase.rpc("complete_comms_outbox", {
        input_outbox_id: item.id,
        input_success: false,
        input_channel_used: null,
        input_provider_ticket_id: null,
        input_error: message,
        input_skip: terminal
      });
    }
  }

  return jsonResponse({
    claimed: items.length,
    sent,
    failed,
    skipped,
    viaWhatsApp,
    viaSms,
    providers: {
      twilioConfigured: hasTwilio(),
      termiiConfigured: hasTermii()
    }
  });
});
