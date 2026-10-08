import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMMS_CRON_SECRET_HEADER,
  RESIDENT_COMMS_TEMPLATES,
  buildTwilioTemplateParams,
  classifyCommsCaller,
  planResidentDelivery,
  renderResidentCommsBody,
  resolveDispatchOperatorId,
  selectEnqueueChannel,
  termiiSmsRequest,
  timingSafeEqualString
} from "./residentComms";

const repoRoot = resolve(import.meta.dirname, "../../..");

describe("classifyCommsCaller", () => {
  it("rejects a request with no Authorization header and no cron secret", () => {
    expect(
      classifyCommsCaller({
        configuredSecret: "cron-secret",
        presentedSecret: null,
        authorizationHeader: null
      })
    ).toEqual({ kind: "rejected", status: 401, error: "Unauthorized" });
  });

  it("rejects operatorId-only callers when the cron secret is wrong", () => {
    expect(
      classifyCommsCaller({
        configuredSecret: "cron-secret",
        presentedSecret: "not-the-secret",
        authorizationHeader: null
      })
    ).toEqual({ kind: "rejected", status: 401, error: "Unauthorized" });
  });

  it("rejects a presented secret when the server secret is unset", () => {
    expect(
      classifyCommsCaller({
        configuredSecret: "",
        presentedSecret: "cron-secret",
        authorizationHeader: "Bearer staff-jwt"
      })
    ).toEqual({ kind: "rejected", status: 401, error: "Unauthorized" });
  });

  it("does not fall through to a staff JWT when the cron secret is wrong", () => {
    expect(
      classifyCommsCaller({
        configuredSecret: "cron-secret",
        presentedSecret: "cron-secret-x",
        authorizationHeader: "Bearer staff-jwt"
      }).kind
    ).toBe("rejected");
  });

  it("accepts the cron secret in constant time and ignores a missing JWT", () => {
    expect(
      classifyCommsCaller({
        configuredSecret: "cron-secret",
        presentedSecret: "cron-secret",
        authorizationHeader: null
      })
    ).toEqual({ kind: "cron" });
  });

  it("treats a bearer token without a cron header as a staff caller", () => {
    expect(
      classifyCommsCaller({
        configuredSecret: "cron-secret",
        presentedSecret: "  ",
        authorizationHeader: "Bearer staff-jwt"
      })
    ).toEqual({ kind: "staff", authorization: "Bearer staff-jwt" });
  });

  it("keeps a staff dispatch inside that staff member's operator", () => {
    expect(
      resolveDispatchOperatorId({
        caller: "staff",
        staffOperatorId: "operator-a",
        requestedOperatorId: "operator-b"
      })
    ).toEqual({ operatorId: "operator-a" });
    expect(
      resolveDispatchOperatorId({
        caller: "staff",
        staffOperatorId: null,
        requestedOperatorId: "operator-b"
      })
    ).toEqual({ error: "Operator context is required", status: 403 });
  });

  it("rejects an empty bearer token", () => {
    expect(
      classifyCommsCaller({
        configuredSecret: "cron-secret",
        presentedSecret: null,
        authorizationHeader: "Bearer"
      }).kind
    ).toBe("rejected");
  });
});

describe("timingSafeEqualString", () => {
  it("matches equal strings and rejects different lengths", () => {
    expect(timingSafeEqualString("cron-secret", "cron-secret")).toBe(true);
    expect(timingSafeEqualString("cron-secret", "cron-secret-extra")).toBe(false);
    expect(timingSafeEqualString("cron-secret", "cron-secreT")).toBe(false);
  });
});

describe("WhatsApp template payloads", () => {
  it("keeps the 0075 variable order and uses NGN in the approved wording", () => {
    expect(RESIDENT_COMMS_TEMPLATES.payment_reminder.variableOrder).toEqual([
      "name",
      "period",
      "amount",
      "due date"
    ]);
    expect(RESIDENT_COMMS_TEMPLATES.payment_receipt.variableOrder).toEqual([
      "name",
      "amount",
      "method",
      "date",
      "reference"
    ]);
    expect(RESIDENT_COMMS_TEMPLATES.suspension_notice.variableOrder).toEqual(["name", "reason"]);

    expect(RESIDENT_COMMS_TEMPLATES.payment_reminder.body).toBe(
      "Hi {{1}}, your CleanOps waste collection tag for {{2}} has NGN {{3}} outstanding. Please pay by {{4}} to keep service active."
    );
    expect(RESIDENT_COMMS_TEMPLATES.payment_receipt.body).toBe(
      "Hi {{1}}, we received NGN {{2}} via {{3}} on {{4}}. Ref: {{5}}. Thank you for keeping your CleanOps service current."
    );
    expect(RESIDENT_COMMS_TEMPLATES.suspension_notice.body).toBe(
      "Hi {{1}}, your CleanOps waste collection service has been suspended. Reason: {{2}}. Pay your outstanding tag to restore collection."
    );
    expect(JSON.stringify(RESIDENT_COMMS_TEMPLATES)).not.toContain("₦");
  });

  it("renders SMS text from the same template and variable order", () => {
    expect(
      renderResidentCommsBody("payment_reminder", ["Ada Obi", "October 2026", "5,000", "31 Oct 2026"])
    ).toBe(
      "Hi Ada Obi, your CleanOps waste collection tag for October 2026 has NGN 5,000 outstanding. Please pay by 31 Oct 2026 to keep service active."
    );
    expect(
      renderResidentCommsBody("payment_receipt", [
        "Ada Obi",
        "5,000",
        "paystack",
        "08 Oct 2026 14:30",
        "PAY-123"
      ])
    ).toContain("NGN 5,000 via paystack");
    expect(renderResidentCommsBody("suspension_notice", ["Ada Obi", "Outstanding balance"])).toContain(
      "Reason: Outstanding balance"
    );
  });

  it("sends ContentSid and ContentVariables and never free-form Body", () => {
    const built = buildTwilioTemplateParams({
      from: "+14155550100",
      toE164: "+2348031234567",
      kind: "payment_reminder",
      variables: ["Ada Obi", "October 2026", "5,000", "31 Oct 2026"],
      contentSid: "HXreminder"
    });

    expect(built.ok).toBe(true);
    if (!built.ok) {
      return;
    }
    expect(built.params.From).toBe("whatsapp:+14155550100");
    expect(built.params.To).toBe("whatsapp:+2348031234567");
    expect(built.params.ContentSid).toBe("HXreminder");
    expect(JSON.parse(built.params.ContentVariables)).toEqual({
      "1": "Ada Obi",
      "2": "October 2026",
      "3": "5,000",
      "4": "31 Oct 2026"
    });
    expect(built.params).not.toHaveProperty("Body");
  });

  it("skips WhatsApp when the template SID is missing", () => {
    const built = buildTwilioTemplateParams({
      from: "whatsapp:+14155550100",
      toE164: "whatsapp:+2348031234567",
      kind: "payment_receipt",
      variables: ["Ada", "5,000", "paystack", "08 Oct 2026 14:30", "PAY-123"],
      contentSid: "  "
    });

    expect(built).toEqual({ ok: false, reason: "skipped_whatsapp: template SID missing" });
  });

  it("skips WhatsApp when template variables are missing", () => {
    const built = buildTwilioTemplateParams({
      from: "+14155550100",
      toE164: "+2348031234567",
      kind: "suspension_notice",
      variables: ["Ada"],
      contentSid: "HXsuspend"
    });

    expect(built.ok).toBe(false);
  });
});

describe("Termii transactional route", () => {
  it("uses the dnd channel and the default Nigeria base URL", () => {
    const request = termiiSmsRequest({
      baseUrl: null,
      toE164: "+2348031234567",
      senderId: "CleanOps",
      sms: "CleanOps code: 123456. Expires in 10 minutes. Do not share this code.",
      apiKey: "termii-key"
    });

    expect(request.url).toBe("https://api.ng.termii.com/api/sms/send");
    expect(request.body.channel).toBe("dnd");
    expect(request.body.type).toBe("plain");
    expect(request.body.to).toBe("2348031234567");
    expect(request.body.from).toBe("CleanOps");
    expect(request.body.api_key).toBe("termii-key");
  });

  it("uses TERMII_BASE_URL when it is set and strips a trailing slash", () => {
    const request = termiiSmsRequest({
      baseUrl: "https://api.termii.com/",
      toE164: "2348031234567",
      senderId: "CleanOps",
      sms: "Hello",
      apiKey: "termii-key"
    });

    expect(request.url).toBe("https://api.termii.com/api/sms/send");
    expect(request.body.channel).toBe("dnd");
  });
});

describe("consent filtering", () => {
  it("cancels enqueue when neither WhatsApp nor SMS consent is granted", () => {
    expect(selectEnqueueChannel({ whatsapp: false, sms: false })).toEqual({
      status: "cancelled",
      channel: "whatsapp",
      fallbackChannel: null,
      skipReason: "skipped: no consent for whatsapp or sms"
    });
  });

  it("queues WhatsApp with SMS fallback only when both are granted", () => {
    expect(selectEnqueueChannel({ whatsapp: true, sms: true })).toEqual({
      status: "queued",
      channel: "whatsapp",
      fallbackChannel: "sms",
      skipReason: null
    });
  });

  it("does not fall back to SMS when only WhatsApp consent is granted", () => {
    expect(selectEnqueueChannel({ whatsapp: true, sms: false })).toEqual({
      status: "queued",
      channel: "whatsapp",
      fallbackChannel: null,
      skipReason: null
    });
  });

  it("queues SMS directly when only SMS consent is granted", () => {
    expect(selectEnqueueChannel({ whatsapp: false, sms: true })).toEqual({
      status: "queued",
      channel: "sms",
      fallbackChannel: null,
      skipReason: null
    });
  });

  it("falls back to SMS when the WhatsApp template SID is missing and SMS consent exists", () => {
    expect(
      planResidentDelivery({
        requestedChannel: "whatsapp",
        fallbackChannel: "sms",
        whatsappConsent: true,
        smsConsent: true,
        twilioConfigured: true,
        contentSid: null,
        hasTemplateVariables: true,
        termiiConfigured: true
      })
    ).toEqual({ action: "sms" });
  });

  it("does not send when consent was withdrawn before dispatch", () => {
    expect(
      planResidentDelivery({
        requestedChannel: "whatsapp",
        fallbackChannel: "sms",
        whatsappConsent: false,
        smsConsent: false,
        twilioConfigured: true,
        contentSid: "HXreminder",
        hasTemplateVariables: true,
        termiiConfigured: true
      })
    ).toEqual({
      action: "skip",
      terminal: true,
      reason: "skipped_whatsapp: no resident consent; skipped_sms: no resident consent"
    });
  });

  it("sends SMS when WhatsApp consent is withdrawn but SMS consent remains", () => {
    expect(
      planResidentDelivery({
        requestedChannel: "whatsapp",
        fallbackChannel: "sms",
        whatsappConsent: false,
        smsConsent: true,
        twilioConfigured: true,
        contentSid: "HXreminder",
        hasTemplateVariables: true,
        termiiConfigured: true
      })
    ).toEqual({ action: "sms" });
  });

  it("keeps a missing template SID retryable when SMS consent is absent", () => {
    const plan = planResidentDelivery({
      requestedChannel: "whatsapp",
      fallbackChannel: null,
      whatsappConsent: true,
      smsConsent: false,
      twilioConfigured: true,
      contentSid: "",
      hasTemplateVariables: true,
      termiiConfigured: true
    });

    expect(plan).toMatchObject({ action: "skip", terminal: false });
  });
});

describe("function wiring", () => {
  it("documents the cron header and keeps phone OTP off the consent gate", () => {
    expect(COMMS_CRON_SECRET_HEADER).toBe("x-cleanops-cron-secret");

    const phoneOtp = readFileSync(
      resolve(repoRoot, "supabase/functions/phone-otp/index.ts"),
      "utf8"
    );
    const dispatcher = readFileSync(
      resolve(repoRoot, "supabase/functions/dispatch-resident-comms/index.ts"),
      "utf8"
    );
    const reminders = readFileSync(
      resolve(repoRoot, "supabase/functions/send-reminders/index.ts"),
      "utf8"
    );
    const migration = readFileSync(
      resolve(repoRoot, "supabase/migrations/0083_resident_comms_consent_and_templates.sql"),
      "utf8"
    );

    expect(phoneOtp).toContain("termiiSmsRequest");
    expect(phoneOtp).not.toContain('channel: "generic"');
    expect(phoneOtp).not.toContain("resident_message_consent");

    expect(dispatcher).toContain("classifyCommsCaller");
    expect(dispatcher).toContain("planResidentDelivery");
    expect(dispatcher).toContain("termiiSmsRequest");
    expect(dispatcher).not.toContain('channel: "generic"');
    expect(dispatcher).not.toContain("Body: body");

    expect(reminders).toContain("classifyCommsCaller");
    expect(reminders).not.toContain("service-role cron");

    for (const template of Object.values(RESIDENT_COMMS_TEMPLATES)) {
      expect(migration).toContain(template.body);
      expect(migration).toContain(template.body.replace(/\{\{(\d+)\}\}/g, "%s"));
    }
    expect(migration).not.toContain("₦");
    expect(migration).toContain("skipped: no consent for whatsapp or sms");
  });
});
