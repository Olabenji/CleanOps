import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AgentPaymentAction } from "@cleanops/shared";

const PAYMENT_QUEUE_KEY = "cleanops.agent.paymentQueue";
const LAST_SYNC_KEY = "cleanops.agent.lastSyncAt";
const SYNC_ENABLED_KEY = "cleanops.agent.syncEnabled";

export async function loadAgentPaymentQueue(): Promise<AgentPaymentAction[]> {
  const raw = await AsyncStorage.getItem(PAYMENT_QUEUE_KEY);

  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as AgentPaymentAction[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveAgentPaymentQueue(queue: AgentPaymentAction[]) {
  await AsyncStorage.setItem(PAYMENT_QUEUE_KEY, JSON.stringify(queue));
}

export async function loadAgentLastSyncAt(): Promise<string | null> {
  return AsyncStorage.getItem(LAST_SYNC_KEY);
}

export async function saveAgentLastSyncAt(syncedAt: string) {
  await AsyncStorage.setItem(LAST_SYNC_KEY, syncedAt);
}

export async function loadAgentSyncEnabled(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(SYNC_ENABLED_KEY);
  return raw !== "false";
}

export async function saveAgentSyncEnabled(enabled: boolean) {
  await AsyncStorage.setItem(SYNC_ENABLED_KEY, enabled ? "true" : "false");
}
