import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from "react-native";
import type {
  AgentDailyCollectionSummary,
  AgentPaymentAction,
  AgentPaymentReceipt,
  CustomerLedgerItem,
  PaymentChannel
} from "@cleanops/shared";
import { addOperationDays, DEFAULT_OPERATION_TIME_ZONE, getOperationDate } from "@cleanops/shared";
import { getAgentDailySummary, recordAgentPayment, searchCustomers } from "../data/agentService";
import CustomerPaymentModal from "./CustomerPaymentModal";
import {
  loadAgentLastSyncAt,
  loadAgentPaymentQueue,
  loadAgentSyncEnabled,
  saveAgentLastSyncAt,
  saveAgentPaymentQueue,
  saveAgentSyncEnabled
} from "../data/agentOfflineQueueStore";
import type { FieldSession } from "../data/fieldSessionService";
import ProfileSettingsCard from "../components/ProfileSettingsCard";
import AgentTabBar, { type AgentTabId } from "../components/AgentTabBar";
import { colors } from "../theme";

function formatNaira(amountKobo: number) {
  return `₦${(amountKobo / 100).toLocaleString("en-NG")}`;
}

function createPaymentAction(
  customer: CustomerLedgerItem,
  amountKobo: number,
  channel: PaymentChannel,
  externalReference?: string
): AgentPaymentAction {
  const queuedAt = new Date().toISOString();

  return {
    id: `${customer.customerId}-${queuedAt}`,
    customerId: customer.customerId,
    customerName: customer.displayName,
    channel,
    amountKobo,
    externalReference,
    idempotencyKey: `agent-mobile:${customer.customerId}:${queuedAt}`,
    queuedAt,
    syncedAt: null
  };
}

export default function AgentApp({
  session,
  onSignOut,
  onSessionUpdated
}: {
  session: FieldSession;
  onSignOut: () => void;
  onSessionUpdated?: (next: Pick<FieldSession, "fullName" | "phone">) => void;
}) {
  const operationTimezone = session.timezone ?? DEFAULT_OPERATION_TIME_ZONE;
  const [customers, setCustomers] = useState<CustomerLedgerItem[]>([]);
  const [paymentModalCustomerId, setPaymentModalCustomerId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [amountNaira, setAmountNaira] = useState("");
  const [channel, setChannel] = useState<PaymentChannel>("agent_cash");
  const [reference, setReference] = useState("");
  const [summary, setSummary] = useState<AgentDailyCollectionSummary | null>(null);
  const [lastReceipt, setLastReceipt] = useState<AgentPaymentReceipt | null>(null);
  const [queue, setQueue] = useState<AgentPaymentAction[]>([]);
  const [queueHydrated, setQueueHydrated] = useState(false);
  const [queueSyncing, setQueueSyncing] = useState(false);
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<AgentTabId>("collect");
  const [historyDate, setHistoryDate] = useState(() => getOperationDate(operationTimezone));
  const [historySummary, setHistorySummary] = useState<AgentDailyCollectionSummary | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("Loading collection workspace...");

  const paymentModalCustomer =
    customers.find((customer) => customer.customerId === paymentModalCustomerId) ?? null;
  const pendingQueue = useMemo(() => queue.filter((item) => !item.syncedAt), [queue]);
  const collectionDate = getOperationDate(operationTimezone);

  useEffect(() => {
    void bootstrapAgent();
    void hydrateQueue();
  }, [session.fullName, session.mode]);

  useEffect(() => {
    if (!queueHydrated) {
      return;
    }

    void saveAgentPaymentQueue(queue);
  }, [queue, queueHydrated]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      void loadCustomers(searchQuery);
    }, 250);

    return () => clearTimeout(timeout);
  }, [searchQuery, session.mode]);

  async function hydrateQueue() {
    try {
      const [storedQueue, storedLastSyncAt, storedSyncEnabled] = await Promise.all([
        loadAgentPaymentQueue(),
        loadAgentLastSyncAt(),
        loadAgentSyncEnabled()
      ]);
      setQueue(storedQueue);
      setLastSyncAt(storedLastSyncAt);
      setSyncEnabled(storedSyncEnabled);
    } catch (error) {
      setMessage(error instanceof Error ? `Offline queue unavailable: ${error.message}` : "Offline queue unavailable");
    } finally {
      setQueueHydrated(true);
    }
  }

  async function bootstrapAgent() {
    setLoading(true);

    try {
      await Promise.all([loadCustomers(""), refreshSummary()]);
      setMessage(`Signed in as ${session.fullName} (${session.mode})`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load collection workspace");
    } finally {
      setLoading(false);
    }
  }

  async function loadCustomers(query: string) {
    const results = await searchCustomers(query);
    setCustomers(results);
    setPaymentModalCustomerId((current) =>
      current && results.some((customer) => customer.customerId === current) ? current : null
    );
  }

  function openPaymentModal(customerId: string) {
    setPaymentModalCustomerId(customerId);
    setAmountNaira("");
    setReference("");
    setChannel("agent_cash");
    setLastReceipt(null);
  }

  function closePaymentModal() {
    setPaymentModalCustomerId(null);
    setAmountNaira("");
    setReference("");
    setChannel("agent_cash");
  }

  async function refreshSummary() {
    setSummary(await getAgentDailySummary(collectionDate));
  }

  async function handleSyncSettingChange(enabled: boolean) {
    setSyncEnabled(enabled);
    await saveAgentSyncEnabled(enabled);
    setMessage(enabled ? "Offline payment queue enabled." : "Offline queue disabled.");
  }

  async function handleRecordPayment() {
    if (!paymentModalCustomer) {
      return;
    }

    const amountKobo = Math.round(Number(amountNaira.replace(/,/g, "")) * 100);

    if (!Number.isFinite(amountKobo) || amountKobo <= 0) {
      setMessage("Enter a payment amount greater than zero.");
      return;
    }

    setSubmitting(true);
    setMessage("");

    const paymentAction = createPaymentAction(
      paymentModalCustomer,
      amountKobo,
      channel,
      reference.trim() || undefined
    );

    try {
      if (session.mode === "pilot") {
        const receipt = await recordAgentPayment({
          customerId: paymentModalCustomer.customerId,
          amountKobo,
          channel,
          externalReference: reference.trim() || undefined,
          idempotencyKey: paymentAction.idempotencyKey
        });
        setLastReceipt(receipt);
        setAmountNaira("");
        setReference("");
        await Promise.all([loadCustomers(searchQuery), refreshSummary()]);
        setMessage(`Payment recorded. Receipt ${receipt.receiptReference}`);
        return;
      }

      const receipt = await recordAgentPayment({
        customerId: paymentModalCustomer.customerId,
        amountKobo,
        channel,
        externalReference: reference.trim() || undefined,
        idempotencyKey: paymentAction.idempotencyKey
      });
      const syncedAt = new Date().toISOString();
      setLastSyncAt(syncedAt);
      await saveAgentLastSyncAt(syncedAt);
      setLastReceipt(receipt);
      setAmountNaira("");
      setReference("");
      await Promise.all([loadCustomers(searchQuery), refreshSummary()]);
      setMessage(`Payment synced. Receipt ${receipt.receiptReference}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown sync error";

      if (!syncEnabled) {
        Alert.alert("Connectivity error", errorMessage);
        setMessage(`Connectivity error: ${errorMessage}`);
        return;
      }

      setQueue((current) => [
        ...current,
        {
          ...paymentAction,
          errorMessage
        }
      ]);
      setMessage(`Payment queued offline: ${errorMessage}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function syncQueue() {
    if (pendingQueue.length === 0) {
      setMessage("No pending offline payments.");
      return;
    }

    setQueueSyncing(true);
    const syncedIds: string[] = [];
    const failedErrors: Record<string, string> = {};

    for (const item of pendingQueue) {
      try {
        await recordAgentPayment({
          customerId: item.customerId,
          amountKobo: item.amountKobo,
          channel: item.channel,
          externalReference: item.externalReference,
          idempotencyKey: item.idempotencyKey
        });
        syncedIds.push(item.id);
      } catch (error) {
        failedErrors[item.id] = error instanceof Error ? error.message : "Unknown sync error";
      }
    }

    const syncedAt = new Date().toISOString();
    setQueue((current) =>
      current.map((item) =>
        syncedIds.includes(item.id)
          ? { ...item, syncedAt, errorMessage: undefined }
          : { ...item, errorMessage: failedErrors[item.id] ?? item.errorMessage }
      )
    );
    setLastSyncAt(syncedAt);
    await saveAgentLastSyncAt(syncedAt);
    await Promise.all([loadCustomers(searchQuery), refreshSummary()]);
    setQueueSyncing(false);
    setMessage(`${syncedIds.length}/${pendingQueue.length} offline payments synced.`);
  }

  async function handleRefresh() {
    setRefreshing(true);

    try {
      await Promise.all([loadCustomers(searchQuery), refreshSummary()]);
      if (pendingQueue.length > 0) {
        await syncQueue();
      } else {
        setMessage(`Refreshed at ${new Date().toLocaleTimeString()}`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to refresh collection workspace");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (activeTab !== "history") {
      return;
    }

    let cancelled = false;
    void (async () => {
      setHistoryLoading(true);
      try {
        const next = await getAgentDailySummary(historyDate);
        if (!cancelled) {
          setHistorySummary(next);
        }
      } catch {
        if (!cancelled) {
          setHistorySummary(null);
        }
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTab, historyDate]);

  if (activeTab === "history") {
    const dayOptions = [0, 1, 2, 3, 4, 5, 6].map((days) =>
      addOperationDays(getOperationDate(operationTimezone), -days)
    );

    return (
      <View style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.container} style={styles.scrollView}>
          <Text style={styles.eyebrow}>CLEANOPS AGENT</Text>
          <Text style={styles.heading}>History</Text>
          <Text style={styles.copy}>Daily collection totals by day.</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }}>
            {dayOptions.map((day) => (
              <Pressable
                key={day}
                onPress={() => setHistoryDate(day)}
                style={[styles.channelPill, historyDate === day && styles.channelPillActive, { marginRight: 8 }]}
              >
                <Text style={[styles.channelText, historyDate === day && styles.channelTextActive]}>
                  {day === collectionDate
                    ? "Today"
                    : new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          {historyLoading ? <Text style={styles.copy}>Loading...</Text> : null}
          {historySummary ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Collected {formatNaira(historySummary.totalCollectedKobo)}</Text>
              <Text style={styles.settingsCopy}>{historySummary.paymentCount} payments</Text>
              {(historySummary.payments ?? []).map((payment) => (
                <View key={payment.paymentId} style={styles.queueItem}>
                  <Text style={styles.customerName}>
                    {payment.customerName} · {formatNaira(payment.amountKobo)}
                  </Text>
                  <Text style={styles.customerMeta}>{new Date(payment.paidAt).toLocaleTimeString()}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
        <AgentTabBar activeTab={activeTab} onChange={setActiveTab} />
      </View>
    );
  }

  if (activeTab === "profile") {
    return (
      <View style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.container} style={styles.scrollView}>
          <Text style={styles.eyebrow}>CLEANOPS AGENT</Text>
          <Text style={styles.heading}>Profile</Text>
          <ProfileSettingsCard
            onProfileUpdated={(next) => onSessionUpdated?.(next)}
            session={session}
          />
          <Pressable onPress={onSignOut} style={styles.signOutSettingsButton}>
            <Text style={styles.signOutSettingsText}>Sign out and switch user</Text>
          </Pressable>
        </ScrollView>
        <AgentTabBar activeTab={activeTab} onChange={setActiveTab} />
      </View>
    );
  }

  return (
    <View style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.container}
        style={styles.scrollView}
        refreshControl={
          <RefreshControl
            colors={["#1a7f45"]}
            onRefresh={() => void handleRefresh()}
            refreshing={refreshing}
            tintColor="#1a7f45"
          />
        }
      >
        <StatusBar style="dark" />
        <Text style={styles.eyebrow}>CLEANOPS AGENT</Text>
        <Text style={styles.heading}>Collect</Text>
        <Text style={styles.copy}>
          {session.fullName} · Collect payments and reconcile today&apos;s cash.
        </Text>

        <View style={styles.notice}>
          <Text style={styles.noticeText}>{loading ? "Loading..." : message}</Text>
          {lastSyncAt ? <Text style={styles.noticeMeta}>Last sync {new Date(lastSyncAt).toLocaleTimeString()}</Text> : null}
        </View>

        <Pressable onPress={() => setSettingsOpen((current) => !current)} style={styles.settingsButton}>
          <Text style={styles.settingsButtonText}>{settingsOpen ? "Hide sync settings" : "Sync settings"}</Text>
        </Pressable>

        {settingsOpen ? (
          <View style={styles.settingsCard}>
            <View style={styles.settingsRow}>
              <View style={styles.settingsTextBlock}>
                <Text style={styles.settingsTitle}>Offline payment queue</Text>
                <Text style={styles.settingsCopy}>
                  Queue failed payments locally and sync when connectivity returns.
                </Text>
              </View>
              <Switch
                onValueChange={(value) => {
                  void handleSyncSettingChange(value);
                }}
                value={syncEnabled}
              />
            </View>
          </View>
        ) : null}

        <View style={styles.summaryGrid}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Collected today</Text>
            <Text style={styles.summaryValue}>{formatNaira(summary?.totalCollectedKobo ?? 0)}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Payments today</Text>
            <Text style={styles.summaryValue}>{summary?.paymentCount ?? 0}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Offline queue</Text>
            <Text style={styles.summaryValue}>{queueHydrated ? pendingQueue.length : "..."}</Text>
          </View>
        </View>

        <View style={styles.actionRow}>
          <Pressable onPress={() => void refreshSummary()} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Refresh summary</Text>
          </Pressable>
          <Pressable
            disabled={queueSyncing || pendingQueue.length === 0}
            onPress={() => void syncQueue()}
            style={[styles.primaryButton, (queueSyncing || pendingQueue.length === 0) && styles.buttonDisabled]}
          >
            <Text style={styles.primaryButtonText}>{queueSyncing ? "Syncing..." : "Sync queue"}</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Customer lookup</Text>
          <Text style={styles.cardHint}>Tap a customer to open payment recording and view their transaction history.</Text>
          <TextInput
            onChangeText={setSearchQuery}
            placeholder="Search name, phone, or address"
            style={styles.input}
            value={searchQuery}
          />
          <View style={styles.customerList}>
            {customers.map((customer) => (
              <Pressable
                key={customer.customerId}
                onPress={() => openPaymentModal(customer.customerId)}
                style={[
                  styles.customerCard,
                  paymentModalCustomerId === customer.customerId && styles.customerCardActive
                ]}
              >
                <Text style={styles.customerName}>{customer.displayName}</Text>
                <Text style={styles.customerMeta}>
                  {customer.zoneName} · {formatNaira(customer.outstandingKobo)} outstanding
                </Text>
                <Text style={styles.customerMeta}>{customer.address}</Text>
                {customer.serviceStatus === "suspended" && customer.suspensionReason ? (
                  <Text style={styles.suspensionNote}>{customer.suspensionReason}</Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        </View>

        {lastReceipt ? (
          <View style={styles.receiptCard}>
            <Text style={styles.cardTitle}>Latest receipt</Text>
            <Text style={styles.receiptReference}>{lastReceipt.receiptReference}</Text>
            <Text style={styles.customerMeta}>
              {lastReceipt.customerName} · {formatNaira(lastReceipt.amountKobo)} ·{" "}
              {lastReceipt.channel.replace("_", " ")}
            </Text>
            <Text style={styles.customerMeta}>
              Outstanding after payment: {formatNaira(lastReceipt.outstandingKobo)}
            </Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Today&apos;s reconciliation</Text>
          {(summary?.payments ?? []).length === 0 ? (
            <Text style={styles.customerMeta}>No payments recorded today yet.</Text>
          ) : (
            summary?.payments.map((payment) => (
              <View key={payment.paymentId} style={styles.queueItem}>
                <Text style={styles.customerName}>{payment.customerName}</Text>
                <Text style={styles.customerMeta}>
                  {formatNaira(payment.amountKobo)} · {payment.receiptReference ?? "No reference"} ·{" "}
                  {new Date(payment.paidAt).toLocaleTimeString()}
                </Text>
              </View>
            ))
          )}
        </View>

        {pendingQueue.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Pending offline payments</Text>
            {pendingQueue.map((item) => (
              <View key={item.id} style={styles.queueItem}>
                <Text style={styles.customerName}>
                  {item.customerName} · {formatNaira(item.amountKobo)}
                </Text>
                <Text style={styles.customerMeta}>{new Date(item.queuedAt).toLocaleTimeString()}</Text>
                {item.errorMessage ? <Text style={styles.queueError}>{item.errorMessage}</Text> : null}
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <CustomerPaymentModal
        amountNaira={amountNaira}
        channel={channel}
        customer={paymentModalCustomer}
        lastReceipt={lastReceipt}
        onAmountChange={setAmountNaira}
        onChannelChange={setChannel}
        onClose={closePaymentModal}
        onReferenceChange={setReference}
        onSubmit={() => void handleRecordPayment()}
        reference={reference}
        submitting={submitting}
        visible={paymentModalCustomer !== null}
      />
      <AgentTabBar activeTab={activeTab} onChange={setActiveTab} />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.bg,
    flex: 1
  },
  scrollView: {
    flex: 1
  },
  container: {
    padding: 24,
    paddingTop: 16
  },
  eyebrow: {
    color: "#1a7f45",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase"
  },
  heading: {
    color: "#102017",
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -1.2,
    marginTop: 8
  },
  copy: {
    color: "#4b5f52",
    fontSize: 16,
    lineHeight: 24,
    marginTop: 12
  },
  notice: {
    backgroundColor: "#ffffff",
    borderColor: "#dbe7dd",
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 18,
    padding: 14
  },
  noticeText: {
    color: "#102017",
    fontSize: 15
  },
  noticeMeta: {
    color: "#637466",
    fontSize: 13,
    marginTop: 6
  },
  settingsButton: {
    marginTop: 16
  },
  settingsButtonText: {
    color: "#1a7f45",
    fontSize: 15,
    fontWeight: "700"
  },
  settingsCard: {
    backgroundColor: "#ffffff",
    borderColor: "#dbe7dd",
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 12,
    padding: 16
  },
  settingsRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between"
  },
  settingsTextBlock: {
    flex: 1
  },
  signOutSettingsButton: {
    borderColor: "#dbe7dd",
    borderRadius: 12,
    borderTopWidth: 1,
    marginTop: 16,
    paddingTop: 16
  },
  signOutSettingsText: {
    color: "#a8550b",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center"
  },
  settingsTitle: {
    color: "#102017",
    fontSize: 16,
    fontWeight: "700"
  },
  settingsCopy: {
    color: "#637466",
    fontSize: 14,
    marginTop: 4
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 18
  },
  summaryCard: {
    backgroundColor: "#ffffff",
    borderColor: "#dbe7dd",
    borderRadius: 18,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: "30%",
    padding: 14
  },
  summaryLabel: {
    color: "#637466",
    fontSize: 13
  },
  summaryValue: {
    color: "#102017",
    fontSize: 22,
    fontWeight: "800",
    marginTop: 6
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 16
  },
  primaryButton: {
    backgroundColor: "#1a7f45",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center"
  },
  secondaryButton: {
    backgroundColor: "#ffffff",
    borderColor: "#dbe7dd",
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  secondaryButtonText: {
    color: "#1a7f45",
    fontSize: 15,
    fontWeight: "700"
  },
  buttonDisabled: {
    opacity: 0.5
  },
  card: {
    backgroundColor: "#ffffff",
    borderColor: "#dbe7dd",
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 18,
    padding: 16
  },
  cardTitle: {
    color: "#102017",
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 8
  },
  cardHint: {
    color: "#637466",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12
  },
  input: {
    backgroundColor: "#f8fbf7",
    borderColor: "#dbe7dd",
    borderRadius: 12,
    borderWidth: 1,
    color: "#102017",
    marginBottom: 12,
    padding: 12
  },
  customerList: {
    gap: 10
  },
  customerCard: {
    backgroundColor: "#f8fbf7",
    borderColor: "#edf3ee",
    borderRadius: 14,
    borderWidth: 1,
    padding: 12
  },
  customerCardActive: {
    backgroundColor: "#e7f7ed",
    borderColor: "#a9dbbb"
  },
  customerName: {
    color: "#102017",
    fontSize: 16,
    fontWeight: "700"
  },
  customerMeta: {
    color: "#637466",
    fontSize: 14,
    marginTop: 4
  },
  suspensionNote: {
    color: "#a8550b",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6
  },
  channelRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12
  },
  channelPill: {
    backgroundColor: "#f3f7f1",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  channelPillActive: {
    backgroundColor: "#1a7f45"
  },
  channelText: {
    color: "#1a7f45",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "capitalize"
  },
  channelTextActive: {
    color: "#ffffff"
  },
  receiptCard: {
    backgroundColor: "#e7f7ed",
    borderColor: "#8ecfaa",
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 18,
    padding: 16
  },
  receiptReference: {
    color: "#145c32",
    fontSize: 24,
    fontWeight: "800",
    marginBottom: 8
  },
  queueItem: {
    borderTopColor: "#edf3ee",
    borderTopWidth: 1,
    marginTop: 10,
    paddingTop: 10
  },
  queueError: {
    color: "#a8550b",
    fontSize: 13,
    marginTop: 4
  }
});
