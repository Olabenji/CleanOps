import {
  residentHomeSchema,
  residentNotificationSchema,
  residentPaymentSchema,
  residentPaystackCheckoutInputSchema,
  residentPaystackCheckoutResultSchema,
  residentPaystackVerifyResultSchema,
  registerResidentPushDeviceInputSchema,
  serviceComplaintSchema,
  submitResidentComplaintInputSchema,
  type ResidentHome,
  type ResidentNotification,
  type ResidentPayment,
  type ResidentPaystackCheckoutInput,
  type ResidentPaystackCheckoutResult,
  type ResidentPaystackVerifyResult,
  type RegisterResidentPushDeviceInput,
  type ServiceComplaint,
  type SubmitResidentComplaintInput
} from "@cleanops/shared";
import { z } from "zod";
import { supabase } from "../lib/supabase";

export async function getResidentHome(): Promise<ResidentHome> {
  if (!supabase) {
    throw new Error("Resident home requires a live Supabase connection.");
  }

  const { data, error } = await supabase.rpc("get_resident_home");

  if (error || !data) {
    throw new Error(error?.message ?? "Unable to load resident home");
  }

  return residentHomeSchema.parse(data);
}

export async function listMyServiceComplaints(): Promise<ServiceComplaint[]> {
  if (!supabase) {
    throw new Error("Resident complaints require a live Supabase connection.");
  }

  const { data, error } = await supabase.rpc("list_my_service_complaints");

  if (error) {
    throw new Error(error.message);
  }

  return z.array(serviceComplaintSchema).parse(data ?? []);
}

export async function submitResidentComplaint(
  input: SubmitResidentComplaintInput
): Promise<string> {
  if (!supabase) {
    throw new Error("Resident complaints require a live Supabase connection.");
  }

  const payload = submitResidentComplaintInputSchema.parse(input);
  const { data, error } = await supabase.rpc("submit_resident_service_complaint", {
    input_title: payload.title,
    input_description: payload.description,
    input_category: payload.category
  });

  if (error || !data) {
    throw new Error(error?.message ?? "Unable to submit complaint");
  }

  return z.string().uuid().parse(data);
}

export async function listMyPayments(): Promise<ResidentPayment[]> {
  if (!supabase) {
    throw new Error("Resident payments require a live Supabase connection.");
  }

  const { data, error } = await supabase.rpc("list_my_payments");

  if (error) {
    throw new Error(error.message);
  }

  return z.array(residentPaymentSchema).parse(data ?? []);
}

export async function startResidentPaystackCheckout(
  input: ResidentPaystackCheckoutInput = {}
): Promise<ResidentPaystackCheckoutResult> {
  if (!supabase) {
    throw new Error("Paystack checkout requires a live Supabase connection.");
  }

  const payload = residentPaystackCheckoutInputSchema.parse(input);
  const { data, error } = await supabase.functions.invoke("resident-paystack-checkout", {
    body: payload
  });

  if (error) {
    throw new Error(await readFunctionsError(error, "Unable to start Paystack checkout"));
  }

  if (data && typeof data === "object" && "error" in data && data.error) {
    throw new Error(String(data.error));
  }

  return residentPaystackCheckoutResultSchema.parse(data);
}

export async function verifyResidentPaystackPayment(
  reference: string
): Promise<ResidentPaystackVerifyResult> {
  if (!supabase) {
    throw new Error("Paystack verification requires a live Supabase connection.");
  }

  const { data, error } = await supabase.functions.invoke("resident-paystack-verify", {
    body: { reference }
  });

  if (error) {
    throw new Error(await readFunctionsError(error, "Unable to confirm Paystack payment"));
  }

  if (data && typeof data === "object" && "error" in data && data.error) {
    throw new Error(String(data.error));
  }

  return residentPaystackVerifyResultSchema.parse(data);
}

async function readFunctionsError(
  error: { message: string; context?: Response },
  fallbackLabel: string
): Promise<string> {
  const fallback = error.message || fallbackLabel;
  const context = error.context;

  if (!context || typeof context.json !== "function") {
    return fallback;
  }

  try {
    const body = await context.json();
    if (body && typeof body === "object" && "error" in body && body.error) {
      return String(body.error);
    }
    if (typeof body === "string" && body.trim()) {
      return body;
    }
  } catch {
    try {
      const text = await context.text();
      if (text.trim()) {
        return text.trim();
      }
    } catch {
      // keep fallback
    }
  }

  if (/non-2xx/i.test(fallback)) {
    return `${fallbackLabel}. Ensure edge functions are serving with a real PAYSTACK_SECRET_KEY.`;
  }

  return fallback;
}

export async function listMyResidentNotifications(limit = 50): Promise<ResidentNotification[]> {
  if (!supabase) {
    throw new Error("Resident notifications require a live Supabase connection.");
  }

  const { data, error } = await supabase.rpc("list_my_resident_notifications", {
    input_limit: limit
  });

  if (error) {
    throw new Error(error.message);
  }

  return z.array(residentNotificationSchema).parse(data ?? []);
}

export async function markResidentNotificationRead(notificationId: string): Promise<void> {
  if (!supabase) {
    throw new Error("Resident notifications require a live Supabase connection.");
  }

  const { error } = await supabase.rpc("mark_resident_notification_read", {
    input_notification_id: notificationId
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function registerResidentPushDevice(input: RegisterResidentPushDeviceInput): Promise<string> {
  if (!supabase) {
    throw new Error("Push registration requires a live Supabase connection.");
  }

  const payload = registerResidentPushDeviceInputSchema.parse(input);
  const { data, error } = await supabase.rpc("register_resident_push_device", {
    input_installation_id: payload.installationId,
    input_expo_push_token: payload.expoPushToken,
    input_platform: payload.platform,
    input_app_version: payload.appVersion ?? null
  });

  if (error || !data) {
    throw new Error(error?.message ?? "Unable to register push device");
  }

  return z.string().uuid().parse(data);
}

export type DispatchResidentNotificationsResult = {
  claimed: number;
  sent: number;
  failed: number;
  skippedNoToken: number;
};

export async function dispatchResidentNotifications(
  limit = 50
): Promise<DispatchResidentNotificationsResult | null> {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.functions.invoke("dispatch-resident-notifications", {
    body: { limit }
  });

  if (error) {
    throw new Error(error.message ?? "Unable to dispatch resident notifications");
  }

  const payload = (data ?? {}) as Partial<DispatchResidentNotificationsResult>;
  return {
    claimed: Number(payload.claimed ?? 0),
    sent: Number(payload.sent ?? 0),
    failed: Number(payload.failed ?? 0),
    skippedNoToken: Number(payload.skippedNoToken ?? 0)
  };
}
