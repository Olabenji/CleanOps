import {
  formatCollectionFrequency,
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
import { withTimeout } from "../lib/withTimeout";

const REQUEST_TIMEOUT_MS = 15_000;

export { formatCollectionFrequency };

export async function getResidentHome(): Promise<ResidentHome> {
  if (!supabase) {
    throw new Error("Resident home requires Supabase");
  }

  const { data, error } = await withTimeout(
    supabase.rpc("get_resident_home"),
    REQUEST_TIMEOUT_MS,
    "Timed out while loading resident home"
  );

  if (error || !data) {
    throw new Error(error?.message ?? "Unable to load resident home");
  }

  return residentHomeSchema.parse(data);
}

export async function listResidentNotifications(limit = 50): Promise<ResidentNotification[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await withTimeout(
    supabase.rpc("list_my_resident_notifications", { input_limit: limit }),
    REQUEST_TIMEOUT_MS,
    "Timed out while loading notifications"
  );

  if (error) {
    throw new Error(error.message);
  }

  // Per-item safe parse: unknown/future kinds must not wipe Pay/Home/Inbox.
  const rows = Array.isArray(data) ? data : [];
  const notifications: ResidentNotification[] = [];
  for (const row of rows) {
    const parsed = residentNotificationSchema.safeParse(row);
    if (parsed.success) {
      notifications.push(parsed.data);
    }
  }
  return notifications;
}

export async function markResidentNotificationRead(notificationId: string): Promise<void> {
  if (!supabase) {
    return;
  }

  const { error } = await withTimeout(
    supabase.rpc("mark_resident_notification_read", {
      input_notification_id: notificationId
    }),
    REQUEST_TIMEOUT_MS,
    "Timed out while marking notification read"
  );

  if (error) {
    throw new Error(error.message);
  }
}

export async function listResidentPayments(): Promise<ResidentPayment[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await withTimeout(
    supabase.rpc("list_my_payments"),
    REQUEST_TIMEOUT_MS,
    "Timed out while loading payment history"
  );

  if (error) {
    throw new Error(error.message);
  }

  return z.array(residentPaymentSchema).parse(data ?? []);
}

export async function startResidentPaystackCheckout(
  input: ResidentPaystackCheckoutInput = {}
): Promise<ResidentPaystackCheckoutResult> {
  if (!supabase) {
    throw new Error("Paystack checkout requires Supabase");
  }

  const payload = residentPaystackCheckoutInputSchema.parse(input);
  const { data, error } = await withTimeout(
    supabase.functions.invoke("resident-paystack-checkout", { body: payload }),
    REQUEST_TIMEOUT_MS,
    "Timed out while starting Paystack checkout"
  );

  if (error) {
    throw new Error(error.message);
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
    throw new Error("Paystack verification requires Supabase");
  }

  const { data, error } = await withTimeout(
    supabase.functions.invoke("resident-paystack-verify", {
      body: { reference }
    }),
    REQUEST_TIMEOUT_MS,
    "Timed out while verifying Paystack payment"
  );

  if (error) {
    throw new Error(error.message);
  }
  if (data && typeof data === "object" && "error" in data && data.error) {
    throw new Error(String(data.error));
  }

  return residentPaystackVerifyResultSchema.parse(data);
}

export async function listResidentComplaints(): Promise<ServiceComplaint[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await withTimeout(
    supabase.rpc("list_my_service_complaints"),
    REQUEST_TIMEOUT_MS,
    "Timed out while loading complaint history"
  );

  if (error) {
    throw new Error(error.message);
  }

  return z.array(serviceComplaintSchema).parse(data ?? []);
}

export async function submitResidentComplaint(
  input: SubmitResidentComplaintInput
): Promise<string> {
  if (!supabase) {
    throw new Error("Resident complaints require Supabase");
  }

  const payload = submitResidentComplaintInputSchema.parse(input);
  const { data, error } = await withTimeout(
    supabase.rpc("submit_resident_service_complaint", {
      input_title: payload.title,
      input_description: payload.description,
      input_category: payload.category
    }),
    REQUEST_TIMEOUT_MS,
    "Timed out while submitting complaint"
  );

  if (error || !data) {
    throw new Error(error?.message ?? "Unable to submit complaint");
  }

  return z.string().uuid().parse(data);
}

export async function registerResidentPushDevice(input: RegisterResidentPushDeviceInput): Promise<string> {
  if (!supabase) {
    throw new Error("Push registration requires Supabase");
  }

  const payload = registerResidentPushDeviceInputSchema.parse(input);
  const { data, error } = await withTimeout(
    supabase.rpc("register_resident_push_device", {
      input_installation_id: payload.installationId,
      input_expo_push_token: payload.expoPushToken,
      input_platform: payload.platform,
      input_app_version: payload.appVersion ?? null
    }),
    REQUEST_TIMEOUT_MS,
    "Timed out while registering push device"
  );

  if (error || !data) {
    throw new Error(error?.message ?? "Unable to register push device");
  }

  return z.string().uuid().parse(data);
}

export async function unregisterResidentPushDevice(installationId: string): Promise<void> {
  if (!supabase) {
    return;
  }

  await supabase.rpc("unregister_resident_push_device", {
    input_installation_id: installationId
  });
}
