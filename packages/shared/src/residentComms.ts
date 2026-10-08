export const COMMS_CRON_SECRET_HEADER = "x-cleanops-cron-secret";

export const DEFAULT_TERMII_BASE_URL = "https://api.ng.termii.com";

export const COMMS_STAFF_ROLES = [
  "operator_owner",
  "operations_supervisor",
  "platform_admin"
] as const;

const NO_CONSENT_REASON = "skipped: no consent for whatsapp or sms";

export const RESIDENT_COMMS_TEMPLATES = {
  payment_reminder: {
    body: "Hi {{1}}, your CleanOps waste collection tag for {{2}} has NGN {{3}} outstanding. Please pay by {{4}} to keep service active.",
    variableOrder: ["name", "period", "amount", "due date"],
    contentSidEnv: "TWILIO_CONTENT_SID_PAYMENT_REMINDER"
  },
  payment_receipt: {
    body: "Hi {{1}}, we received NGN {{2}} via {{3}} on {{4}}. Ref: {{5}}. Thank you for keeping your CleanOps service current.",
    variableOrder: ["name", "amount", "method", "date", "reference"],
    contentSidEnv: "TWILIO_CONTENT_SID_PAYMENT_RECEIPT"
  },
  suspension_notice: {
    body: "Hi {{1}}, your CleanOps waste collection service has been suspended. Reason: {{2}}. Pay your outstanding tag to restore collection.",
    variableOrder: ["name", "reason"],
    contentSidEnv: "TWILIO_CONTENT_SID_SUSPENSION_NOTICE"
  }
} as const;

export type ResidentCommsKind = keyof typeof RESIDENT_COMMS_TEMPLATES;

export type CommsCaller =
  | { kind: "cron" }
  | { kind: "staff"; authorization: string }
  | { kind: "rejected"; status: 401; error: string };

export class CommsSkipError extends Error {
  readonly terminal: boolean;

  constructor(message: string, terminal: boolean) {
    super(message);
    this.name = "CommsSkipError";
    this.terminal = terminal;
  }
}

export function timingSafeEqualString(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const length = Math.max(a.length, b.length, 1);
  let mismatch = a.length === b.length ? 0 : 1;

  for (let index = 0; index < length; index += 1) {
    mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }

  return mismatch === 0;
}

export function classifyCommsCaller(input: {
  configuredSecret: string;
  presentedSecret: string | null;
  authorizationHeader: string | null;
}): CommsCaller {
  const presented = (input.presentedSecret ?? "").trim();
  if (presented.length > 0) {
    const configured = input.configuredSecret ?? "";
    const matches = configured.length > 0 && timingSafeEqualString(presented, configured);
    if (!matches) {
      return { kind: "rejected", status: 401, error: "Unauthorized" };
    }
    return { kind: "cron" };
  }

  const authorization = input.authorizationHeader?.trim() ?? "";
  if (!authorization || authorization.toLowerCase() === "bearer") {
    return { kind: "rejected", status: 401, error: "Unauthorized" };
  }

  return { kind: "staff", authorization };
}

export function assertCommsStaffRole(
  role: string | null | undefined
): { ok: true } | { ok: false; status: 403; error: string } {
  if (!role || !COMMS_STAFF_ROLES.includes(role as (typeof COMMS_STAFF_ROLES)[number])) {
    return { ok: false, status: 403, error: "Comms is not permitted for this role" };
  }
  return { ok: true };
}

export function resolveDispatchOperatorId(input: {
  caller: "cron" | "staff";
  staffOperatorId: string | null;
  requestedOperatorId: string | null;
}): { operatorId: string | null } | { error: string; status: 403 } {
  if (input.caller === "staff") {
    if (!input.staffOperatorId) {
      return { error: "Operator context is required", status: 403 };
    }
    return { operatorId: input.staffOperatorId };
  }

  return { operatorId: input.requestedOperatorId };
}

export function sanitizeTemplateVariable(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

export function renderResidentCommsBody(kind: string, variables: string[]): string | null {
  const template = RESIDENT_COMMS_TEMPLATES[kind as ResidentCommsKind];
  if (!template || variables.length !== template.variableOrder.length) {
    return null;
  }

  return template.body.replace(/\{\{(\d+)\}\}/g, (_match, index: string) => {
    return sanitizeTemplateVariable(variables[Number(index) - 1] ?? "");
  });
}

export function buildTwilioTemplateParams(input: {
  from: string;
  toE164: string;
  kind: string;
  variables: string[] | null;
  contentSid: string | null;
}): { ok: true; params: Record<string, string> } | { ok: false; reason: string } {
  const template = RESIDENT_COMMS_TEMPLATES[input.kind as ResidentCommsKind];
  const contentSid = input.contentSid?.trim() ?? "";
  if (!template) {
    return { ok: false, reason: "skipped_whatsapp: unknown template" };
  }
  if (!contentSid) {
    return { ok: false, reason: "skipped_whatsapp: template SID missing" };
  }

  const variables = input.variables ?? [];
  if (variables.length !== template.variableOrder.length) {
    return { ok: false, reason: "skipped_whatsapp: template variables missing" };
  }

  const contentVariables: Record<string, string> = {};
  variables.forEach((value, index) => {
    contentVariables[String(index + 1)] = sanitizeTemplateVariable(value);
  });

  const from = input.from.startsWith("whatsapp:") ? input.from : `whatsapp:${input.from}`;
  const to = input.toE164.startsWith("whatsapp:") ? input.toE164 : `whatsapp:${input.toE164}`;

  return {
    ok: true,
    params: {
      From: from,
      To: to,
      ContentSid: contentSid,
      ContentVariables: JSON.stringify(contentVariables)
    }
  };
}

export function contentSidEnvForKind(kind: string): string | null {
  return RESIDENT_COMMS_TEMPLATES[kind as ResidentCommsKind]?.contentSidEnv ?? null;
}

export function termiiSmsRequest(input: {
  baseUrl?: string | null;
  toE164: string;
  senderId: string;
  sms: string;
  apiKey: string;
}): { url: string; body: Record<string, string> } {
  const base = (input.baseUrl?.trim() || DEFAULT_TERMII_BASE_URL).replace(/\/+$/, "");
  return {
    url: `${base}/api/sms/send`,
    body: {
      to: input.toE164.replace(/^\+/, ""),
      from: input.senderId,
      sms: input.sms,
      type: "plain",
      channel: "dnd",
      api_key: input.apiKey
    }
  };
}

export function selectEnqueueChannel(consent: { whatsapp: boolean; sms: boolean }): {
  status: "queued" | "cancelled";
  channel: "whatsapp" | "sms";
  fallbackChannel: "sms" | null;
  skipReason: string | null;
} {
  if (consent.whatsapp && consent.sms) {
    return { status: "queued", channel: "whatsapp", fallbackChannel: "sms", skipReason: null };
  }
  if (consent.whatsapp) {
    return { status: "queued", channel: "whatsapp", fallbackChannel: null, skipReason: null };
  }
  if (consent.sms) {
    return { status: "queued", channel: "sms", fallbackChannel: null, skipReason: null };
  }
  return {
    status: "cancelled",
    channel: "whatsapp",
    fallbackChannel: null,
    skipReason: NO_CONSENT_REASON
  };
}

export function planResidentDelivery(input: {
  requestedChannel: string;
  fallbackChannel: string | null;
  whatsappConsent: boolean;
  smsConsent: boolean;
  twilioConfigured: boolean;
  contentSid: string | null;
  hasTemplateVariables: boolean;
  termiiConfigured: boolean;
}): { action: "whatsapp" } | { action: "sms" } | { action: "skip"; reason: string; terminal: boolean } {
  const notes: string[] = [];
  const whatsappWanted = input.requestedChannel !== "sms";
  const smsWanted = input.requestedChannel === "sms" || input.fallbackChannel === "sms";
  let whatsappBlockedByConsent = false;
  let smsBlockedByConsent = false;

  if (whatsappWanted) {
    if (!input.whatsappConsent) {
      notes.push("skipped_whatsapp: no resident consent");
      whatsappBlockedByConsent = true;
    } else if (!input.twilioConfigured) {
      notes.push("skipped_whatsapp: Twilio is not configured");
    } else if (!input.contentSid?.trim()) {
      notes.push("skipped_whatsapp: template SID missing");
    } else if (!input.hasTemplateVariables) {
      notes.push("skipped_whatsapp: template variables missing");
    } else {
      return { action: "whatsapp" };
    }
  }

  if (smsWanted) {
    if (!input.smsConsent) {
      notes.push("skipped_sms: no resident consent");
      smsBlockedByConsent = true;
    } else if (!input.termiiConfigured) {
      notes.push("skipped_sms: Termii is not configured");
    } else {
      return { action: "sms" };
    }
  }

  const wantedCount = Number(whatsappWanted) + Number(smsWanted);
  const consentBlocks =
    Number(whatsappWanted && whatsappBlockedByConsent) + Number(smsWanted && smsBlockedByConsent);

  return {
    action: "skip",
    reason: notes.join("; ") || "No messaging channel available",
    terminal: wantedCount > 0 && consentBlocks === wantedCount
  };
}
