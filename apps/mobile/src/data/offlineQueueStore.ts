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

type StringStore = {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
  delete: (key: string) => void;
};

let mmkvStore: StringStore | null | undefined;

function getMmkvStore(): StringStore | null {
  if (mmkvStore !== undefined) {
    return mmkvStore;
  }

  try {
    // Optional native store — falls back to AsyncStorage when unavailable (Expo Go / web).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { MMKV } = require("react-native-mmkv") as {
      MMKV: new (options?: { id?: string }) => StringStore;
    };
    mmkvStore = new MMKV({ id: "cleanops-driver-offline" });
  } catch {
    mmkvStore = null;
  }

  return mmkvStore;
}

async function readValue(key: string): Promise<string | null> {
  const mmkv = getMmkvStore();
  if (mmkv) {
    return mmkv.getString(key) ?? null;
  }
  return AsyncStorage.getItem(key);
}

async function writeValue(key: string, value: string): Promise<void> {
  const mmkv = getMmkvStore();
  if (mmkv) {
    mmkv.set(key, value);
    return;
  }
  await AsyncStorage.setItem(key, value);
}

async function removeValue(key: string): Promise<void> {
  const mmkv = getMmkvStore();
  if (mmkv) {
    mmkv.delete(key);
    return;
  }
  await AsyncStorage.removeItem(key);
}

async function migrateKeyFromAsyncStorage(key: string) {
  const mmkv = getMmkvStore();
  if (!mmkv || mmkv.getString(key) != null) {
    return;
  }

  const legacy = await AsyncStorage.getItem(key);
  if (legacy != null) {
    mmkv.set(key, legacy);
    await AsyncStorage.removeItem(key);
  }
}

export async function loadOfflineQueue(): Promise<DriverStopAction[]> {
  await migrateKeyFromAsyncStorage(queueStorageKey);
  const rawQueue = await readValue(queueStorageKey);

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
  await writeValue(queueStorageKey, JSON.stringify(queue));
}

export async function clearOfflineQueue() {
  await removeValue(queueStorageKey);
}

export async function loadIncidentQueue(): Promise<IncidentReportInput[]> {
  await migrateKeyFromAsyncStorage(incidentQueueStorageKey);
  const rawQueue = await readValue(incidentQueueStorageKey);

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
  await writeValue(incidentQueueStorageKey, JSON.stringify(queue));
}

export async function loadLastSyncAt() {
  await migrateKeyFromAsyncStorage(lastSyncStorageKey);
  return readValue(lastSyncStorageKey);
}

export async function saveLastSyncAt(syncedAt: string) {
  await writeValue(lastSyncStorageKey, syncedAt);
}

export async function loadSyncEnabled() {
  await migrateKeyFromAsyncStorage(syncEnabledStorageKey);
  const storedValue = await readValue(syncEnabledStorageKey);
  // Default ON so connectivity failures queue instead of only alerting.
  return storedValue == null ? true : storedValue === "true";
}

export async function saveSyncEnabled(enabled: boolean) {
  await writeValue(syncEnabledStorageKey, String(enabled));
}

export function offlineStoreBackend(): "mmkv" | "async-storage" {
  return getMmkvStore() ? "mmkv" : "async-storage";
}
