import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { registerResidentPushDevice, unregisterResidentPushDevice } from "../data/residentService";

const INSTALLATION_KEY = "cleanops.resident.installationId";

export type ResidentPushOpenPayload = {
  notificationId?: string;
};

type NotificationsModule = typeof import("expo-notifications");

/** Expo Go removed remote push in SDK 53+. Push only works in a development/production build. */
export function isExpoGoRuntime(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

export function isResidentPushSupported(): boolean {
  return Device.isDevice && !isExpoGoRuntime();
}

function resolveProjectId(): string | undefined {
  const fromEnv = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  const fromExtra = Constants.expoConfig?.extra?.eas?.projectId;
  if (typeof fromExtra === "string" && fromExtra.trim()) {
    return fromExtra.trim();
  }

  const fromEasConfig = Constants.easConfig?.projectId;
  if (typeof fromEasConfig === "string" && fromEasConfig.trim()) {
    return fromEasConfig.trim();
  }

  return undefined;
}

function formatPushError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function readInstallationId(): Promise<string> {
  const stored = await AsyncStorage.getItem(INSTALLATION_KEY);
  if (stored) {
    return stored;
  }

  let generated = `install:${Date.now()}`;
  try {
    const deviceId = Device.osInternalBuildId || Device.modelId || Device.deviceName;
    if (deviceId) {
      generated = `device:${String(deviceId)}`;
    }
  } catch {
    // Keep timestamp fallback.
  }

  await AsyncStorage.setItem(INSTALLATION_KEY, generated);
  return generated;
}

async function loadNotifications(): Promise<NotificationsModule> {
  // Dynamic import keeps Expo Go from crashing on module load (SDK 53+).
  const mod = await import("expo-notifications");
  const resolved = (mod as { default?: NotificationsModule }).default ?? mod;
  if (typeof resolved.setNotificationHandler !== "function") {
    throw new Error("expo-notifications module failed to load in this build");
  }
  return resolved;
}

function readNotificationId(data: unknown): string | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }

  const value = (data as { notificationId?: unknown }).notificationId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export async function ensureResidentPushRegistration(appVersion?: string): Promise<string | null> {
  if (!isResidentPushSupported()) {
    return null;
  }

  const Notifications = await loadNotifications();

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: false,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true
    })
  });

  const permissions = await Notifications.getPermissionsAsync();
  let finalStatus = permissions.status;

  if (finalStatus !== "granted") {
    const requested = await Notifications.requestPermissionsAsync();
    finalStatus = requested.status;
  }

  if (finalStatus !== "granted") {
    return null;
  }

  if (Platform.OS === "android") {
    const importance = Notifications.AndroidImportance?.DEFAULT ?? 5;
    await Notifications.setNotificationChannelAsync("resident-default", {
      name: "Collection updates",
      importance
    });
  }

  const projectId = resolveProjectId();
  if (!projectId) {
    throw new Error("Missing EAS projectId for Expo push");
  }

  const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
  if (!tokenResponse?.data) {
    throw new Error("Expo push token was empty");
  }

  const installationId = await readInstallationId();
  await registerResidentPushDevice({
    installationId,
    expoPushToken: tokenResponse.data,
    platform: Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "unknown",
    appVersion
  });

  return installationId;
}

/**
 * Routes notification taps (foreground/background/cold start) into the resident inbox.
 * Returns an unsubscribe function.
 */
export async function attachResidentPushResponseHandler(
  onOpen: (payload: ResidentPushOpenPayload) => void
): Promise<() => void> {
  if (!isResidentPushSupported()) {
    return () => undefined;
  }

  const Notifications = await loadNotifications();

  const openFromResponse = (response: {
    notification: { request: { content: { data?: unknown } } };
  } | null) => {
    if (!response) {
      return;
    }

    onOpen({
      notificationId: readNotificationId(response.notification.request.content.data)
    });
  };

  try {
    const coldStart = await Notifications.getLastNotificationResponseAsync();
    openFromResponse(coldStart);
  } catch {
    // Cold-start lookup is best-effort.
  }

  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    openFromResponse(response);
  });

  return () => {
    subscription.remove();
  };
}

export async function clearResidentPushRegistration(installationId: string | null) {
  if (!installationId) {
    return;
  }

  try {
    await unregisterResidentPushDevice(installationId);
  } catch {
    // Best-effort unregister.
  }
}

/**
 * Sends a one-off Expo push to this device (QA only).
 * Verifies Expo → FCM/APNs delivery without operator close-incomplete.
 */
export async function sendResidentTestPush(): Promise<void> {
  if (!isResidentPushSupported()) {
    throw new Error("Test push requires a physical development/production build (not Expo Go)");
  }

  const Notifications = await loadNotifications();
  const permissions = await Notifications.getPermissionsAsync();
  if (permissions.status !== "granted") {
    throw new Error("Notification permission is not granted");
  }

  const projectId = resolveProjectId();
  if (!projectId) {
    throw new Error("Missing EAS projectId for Expo push");
  }

  const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
  const token = tokenResponse?.data;
  if (!token) {
    throw new Error("Expo push token was empty");
  }

  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify([
      {
        to: token,
        title: "CleanOps push QA",
        body: `Test push at ${new Date().toISOString()}`,
        data: { kind: "push_qa" },
        sound: "default",
        channelId: "resident-default"
      }
    ])
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Expo push HTTP ${response.status}: ${text}`);
  }

  let tickets: Array<{ status?: string; message?: string; details?: { error?: string } }> = [];
  try {
    const payload = JSON.parse(text) as { data?: typeof tickets };
    tickets = payload.data ?? [];
  } catch {
    throw new Error(`Expo push returned non-JSON: ${text}`);
  }

  const failed = tickets.filter((ticket) => ticket.status && ticket.status !== "ok");
  if (failed.length > 0) {
    throw new Error(
      failed.map((ticket) => ticket.message ?? ticket.details?.error ?? "push failed").join("; ")
    );
  }
}

export { INSTALLATION_KEY, formatPushError };
