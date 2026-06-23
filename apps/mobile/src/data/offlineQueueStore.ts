import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  driverStopActionSchema,
  incidentReportInputSchema,
  type DriverStopAction,
  type IncidentReportInput
} from "@cleanops/shared";

const queueStorageKey = "cleanops.driver.offlineQueue.v1";
const incidentQueueStorageKey = "cleanops.driver.incidentQueue.v1";
const lastSyncStorageKey = "cleanops.driver.lastSyncAt.v1";
const syncEnabledStorageKey = "cleanops.driver.syncEnabled.v1";

export async function loadOfflineQueue(): Promise<DriverStopAction[]> {
  const rawQueue = await AsyncStorage.getItem(queueStorageKey);

  if (!rawQueue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawQueue);
    const result = driverStopActionSchema.array().safeParse(parsed);

    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

export async function saveOfflineQueue(queue: DriverStopAction[]) {
  await AsyncStorage.setItem(queueStorageKey, JSON.stringify(queue));
}

export async function clearOfflineQueue() {
  await AsyncStorage.removeItem(queueStorageKey);
}

export async function loadIncidentQueue(): Promise<IncidentReportInput[]> {
  const rawQueue = await AsyncStorage.getItem(incidentQueueStorageKey);

  if (!rawQueue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawQueue);
    const result = incidentReportInputSchema.array().safeParse(parsed);

    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

export async function saveIncidentQueue(queue: IncidentReportInput[]) {
  await AsyncStorage.setItem(incidentQueueStorageKey, JSON.stringify(queue));
}

export async function loadLastSyncAt(): Promise<string | null> {
  return AsyncStorage.getItem(lastSyncStorageKey);
}

export async function saveLastSyncAt(syncedAt: string) {
  await AsyncStorage.setItem(lastSyncStorageKey, syncedAt);
}

export async function loadSyncEnabled(): Promise<boolean> {
  const storedValue = await AsyncStorage.getItem(syncEnabledStorageKey);

  return storedValue === null ? true : storedValue === "true";
}

export async function saveSyncEnabled(enabled: boolean) {
  await AsyncStorage.setItem(syncEnabledStorageKey, String(enabled));
}
