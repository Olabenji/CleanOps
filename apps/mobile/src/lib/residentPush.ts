import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { registerResidentPushDevice, unregisterResidentPushDevice } from "../data/residentService";

const INSTALLATION_KEY = "cleanops.resident.installationId";

/** Expo Go removed remote push in SDK 53+. Push only works in a development/production build. */
export function isExpoGoRuntime(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

export function isResidentPushSupported(): boolean {
  return Device.isDevice && !isExpoGoRuntime();
}

function readInstallationId(): string {
  try {
    const deviceId = Device.osInternalBuildId || Device.modelId || Device.deviceName;
    if (deviceId) {
      return `device:${String(deviceId)}`;
    }
  } catch {
    // ignore
  }

  return `install:${Date.now()}`;
}

async function loadNotifications() {
  // Dynamic import keeps Expo Go from crashing on module load (SDK 53+).
  return import("expo-notifications");
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

  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  const tokenResponse = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined
  );

  const installationId = readInstallationId();
  await registerResidentPushDevice({
    installationId,
    expoPushToken: tokenResponse.data,
    platform: Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "unknown",
    appVersion
  });

  return installationId;
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
