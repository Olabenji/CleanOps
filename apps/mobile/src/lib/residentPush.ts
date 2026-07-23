import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { registerResidentPushDevice, unregisterResidentPushDevice } from "../data/residentService";

const INSTALLATION_KEY = "cleanops.resident.installationId";

export type ResidentPushOpenPayload = {
  notificationId?: string;
};

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

  return undefined;
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

async function loadNotifications() {
  // Dynamic import keeps Expo Go from crashing on module load (SDK 53+).
  return import("expo-notifications");
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
    await Notifications.setNotificationChannelAsync("resident-default", {
      name: "Collection updates",
      importance: Notifications.AndroidImportance.DEFAULT
    });
  }

  const projectId = resolveProjectId();
  if (!projectId) {
    throw new Error("EXPO_PUBLIC_EAS_PROJECT_ID (or app.json extra.eas.projectId) is required for push");
  }

  const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });

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

  const coldStart = await Notifications.getLastNotificationResponseAsync();
  openFromResponse(coldStart);

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

export { INSTALLATION_KEY };
