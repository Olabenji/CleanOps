import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  incidentTypes,
  type DriverStopAction,
  type IncidentReportInput,
  type IncidentType,
  type RouteDetail,
  type RouteStop,
  type RouteStopStatus
} from "@cleanops/shared";
import { createStopAction, pilotDriver, pilotDriverRoute } from "./src/data/driverPilot";
import {
  driverCredentials,
  fetchAssignedRoute,
  reportDriverIncident,
  signInDriver,
  syncStopAction,
  transitionAssignedRoute,
  type DriverSession
} from "./src/data/driverService";
import {
  loadIncidentQueue,
  loadLastSyncAt,
  loadOfflineQueue,
  loadSyncEnabled,
  saveIncidentQueue,
  saveLastSyncAt,
  saveOfflineQueue,
  saveSyncEnabled
} from "./src/data/offlineQueueStore";

const incidentTypeLabels: Record<IncidentType, string> = {
  blocked_access: "Blocked access",
  customer_dispute: "Customer dispute",
  truck_issue: "Truck issue",
  missed_pickup: "Missed pickup",
  illegal_dumping: "Illegal dumping",
  safety_concern: "Safety concern",
  other: "Other"
};

function updateStop(route: RouteDetail, stopId: string, status: RouteStopStatus, note?: string, skipReason?: string) {
  const nextStops = route.stops.map((stop) =>
    stop.id === stopId
      ? {
          ...stop,
          status,
          completedAt: status === "completed" ? new Date().toISOString() : null,
          notes: note?.trim() || stop.notes,
          skipReason: status === "skipped" ? skipReason?.trim() || "Skipped by driver" : null
        }
      : stop
  );
  const completedStops = nextStops.filter((stop) => stop.status === "completed").length;

  return {
    ...route,
    completedStops,
    stops: nextStops
  };
}

export default function App() {
  const [session, setSession] = useState<DriverSession | null>(null);
  const [route, setRoute] = useState<RouteDetail>(pilotDriverRoute);
  const [shiftStarted, setShiftStarted] = useState(Boolean(pilotDriverRoute.startedAt));
  const [queue, setQueue] = useState<DriverStopAction[]>([]);
  const [incidentQueue, setIncidentQueue] = useState<IncidentReportInput[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [skipReasons, setSkipReasons] = useState<Record<string, string>>({});
  const [incidentType, setIncidentType] = useState<IncidentType>("blocked_access");
  const [incidentStopId, setIncidentStopId] = useState<string>("");
  const [incidentTitle, setIncidentTitle] = useState("");
  const [incidentDescription, setIncidentDescription] = useState("");
  const [syncingStopIds, setSyncingStopIds] = useState<Record<string, boolean>>({});
  const [queueHydrated, setQueueHydrated] = useState(false);
  const [queueSyncing, setQueueSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [incidentFormOpen, setIncidentFormOpen] = useState(false);
  const [submittingIncident, setSubmittingIncident] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("Loading driver workspace...");
  const progress = useMemo(
    () => Math.round((route.completedStops / route.totalStops) * 100),
    [route.completedStops, route.totalStops]
  );
  const pendingActions = useMemo(() => queue.filter((item) => !item.syncedAt), [queue]);
  const pendingActionByStop = useMemo(
    () =>
      pendingActions.reduce<Record<string, DriverStopAction>>((actions, item) => {
        actions[item.stopId] = item;
        return actions;
      }, {}),
    [pendingActions]
  );
  const pendingQueue = pendingActions.length + incidentQueue.length;

  useEffect(() => {
    void bootstrapDriver();
    void hydrateOfflineQueue();
  }, []);

  useEffect(() => {
    if (!queueHydrated) {
      return;
    }

    void saveOfflineQueue(queue);
  }, [queue, queueHydrated]);

  useEffect(() => {
    if (!queueHydrated) {
      return;
    }

    void saveIncidentQueue(incidentQueue);
  }, [incidentQueue, queueHydrated]);

  async function hydrateOfflineQueue() {
    try {
      const [storedQueue, storedIncidentQueue, storedLastSyncAt, storedSyncEnabled] = await Promise.all([
        loadOfflineQueue(),
        loadIncidentQueue(),
        loadLastSyncAt(),
        loadSyncEnabled()
      ]);
      setQueue(storedQueue);
      setIncidentQueue(storedIncidentQueue);
      setLastSyncAt(storedLastSyncAt);
      setSyncEnabled(storedSyncEnabled);
    } catch (error) {
      setMessage(error instanceof Error ? `Offline queue unavailable: ${error.message}` : "Offline queue unavailable");
    } finally {
      setQueueHydrated(true);
    }
  }

  async function handleSyncSettingChange(enabled: boolean) {
    setSyncEnabled(enabled);
    await saveSyncEnabled(enabled);
    setMessage(
      enabled
        ? "Offline queue and sync status enabled."
        : "Offline queue disabled. Connectivity failures will show an alert."
    );
  }

  async function bootstrapDriver() {
    setLoading(true);

    try {
      const nextSession = await signInDriver();
      const assignedRoute = await fetchAssignedRoute();
      setSession(nextSession);
      setRoute(assignedRoute);
      setShiftStarted(assignedRoute.status === "in_progress" || Boolean(assignedRoute.startedAt));
      setMessage(`Signed in as ${nextSession.fullName} (${nextSession.mode})`);
    } catch (error) {
      setSession({
        fullName: pilotDriver.fullName,
        mode: "pilot"
      });
      setRoute(pilotDriverRoute);
      setMessage(error instanceof Error ? `Using pilot route: ${error.message}` : "Using pilot route");
    } finally {
      setLoading(false);
    }
  }

  async function handleStartShift() {
    setShiftStarted(true);

    if (session?.mode === "pilot") {
      setMessage("Shift started locally in pilot mode.");
      return;
    }

    try {
      await transitionAssignedRoute(route.id, "in_progress");
      setRoute(await fetchAssignedRoute());
      setMessage("Shift started and synced.");
    } catch (error) {
      setMessage(error instanceof Error ? `Shift started locally: ${error.message}` : "Shift started locally");
    }
  }

  async function handleStopAction(stop: RouteStop, status: RouteStopStatus) {
    const note = notes[stop.id];
    const skipReason = skipReasons[stop.id];

    if (status === "skipped" && !skipReason?.trim()) {
      setSkipReasons((current) => ({
        ...current,
        [stop.id]: "Gate locked / customer unavailable"
      }));
      return;
    }

    if (session?.mode === "pilot") {
      setRoute((current) => updateStop(current, stop.id, status, note, skipReason));
      setMessage("Pilot route updated locally. Supabase sync is disabled in pilot mode.");
      return;
    }

    const action = createStopAction(route.id, stop.id, status, note, skipReason);
    setSyncingStopIds((current) => ({ ...current, [stop.id]: true }));

    try {
      const syncResult = await syncStopAction(stop.id, status as "completed" | "skipped", note, skipReason);
      const syncedAt = syncResult.syncedAt ?? new Date().toISOString();
      setLastSyncAt(syncedAt);
      await saveLastSyncAt(syncedAt);
      setRoute(await fetchAssignedRoute());
      setMessage("Stop update synced.");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown sync error";

      if (!syncEnabled) {
        Alert.alert(
          "Connectivity error",
          `This stop could not be saved to Supabase. Please check your connection and try again.\n\n${errorMessage}`
        );
        setMessage(`Connectivity error: ${errorMessage}`);
        return;
      }

      setRoute((current) => updateStop(current, stop.id, status, note, skipReason));
      setQueue((current) => [
        {
          ...action,
          errorMessage
        },
        ...current.filter((item) => item.stopId !== stop.id || item.syncedAt)
      ]);
      setMessage(`Queued offline: ${errorMessage}`);
    } finally {
      setSyncingStopIds((current) => ({ ...current, [stop.id]: false }));
    }
  }

  async function handleIncidentSubmit() {
    const trimmedTitle = incidentTitle.trim();
    const trimmedDescription = incidentDescription.trim();

    if (trimmedTitle.length < 3 || trimmedDescription.length < 5) {
      Alert.alert("Incident details required", "Please enter a short title and a useful description.");
      return;
    }

    const incident: IncidentReportInput = {
      routeId: route.id,
      stopId: incidentStopId || undefined,
      incidentType,
      title: trimmedTitle,
      description: trimmedDescription,
      queuedAt: new Date().toISOString()
    };

    setSubmittingIncident(true);

    try {
      if (session?.mode === "pilot") {
        setMessage("Pilot incident captured locally.");
      } else {
        const result = await reportDriverIncident(incident);
        setLastSyncAt(result.createdAt);
        await saveLastSyncAt(result.createdAt);
        setMessage("Incident report submitted.");
      }

      setIncidentTitle("");
      setIncidentDescription("");
      setIncidentStopId("");
      setIncidentFormOpen(false);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown incident sync error";

      if (!syncEnabled) {
        Alert.alert(
          "Connectivity error",
          `This incident could not be saved to Supabase. Please check your connection and try again.\n\n${errorMessage}`
        );
        setMessage(`Connectivity error: ${errorMessage}`);
        return;
      }

      setIncidentQueue((current) => [
        {
          ...incident,
          errorMessage
        },
        ...current
      ]);
      setIncidentTitle("");
      setIncidentDescription("");
      setIncidentStopId("");
      setIncidentFormOpen(false);
      setMessage(`Incident queued offline: ${errorMessage}`);
    } finally {
      setSubmittingIncident(false);
    }
  }

  async function syncQueue() {
    if (pendingActions.length === 0 && incidentQueue.length === 0) {
      setMessage("No pending updates to sync.");
      return;
    }

    const syncedIds: string[] = [];
    const failedErrors: Record<string, string> = {};
    const syncedIncidentKeys: string[] = [];
    const failedIncidentErrors: Record<string, string> = {};
    let latestSyncAt: string | null = null;
    setQueueSyncing(true);

    try {
      for (const item of pendingActions) {
        try {
          const syncResult = await syncStopAction(item.stopId, item.status as "completed" | "skipped", item.note, item.skipReason);
          latestSyncAt = syncResult.syncedAt ?? new Date().toISOString();
          syncedIds.push(item.id);
        } catch (error) {
          failedErrors[item.id] = error instanceof Error ? error.message : "Unknown sync error";
          // Keep failed items pending for the next retry.
        }
      }

      for (const item of incidentQueue) {
        const incidentKey = `${item.queuedAt}-${item.title}`;

        try {
          const syncResult = await reportDriverIncident(item);
          latestSyncAt = syncResult.createdAt ?? new Date().toISOString();
          syncedIncidentKeys.push(incidentKey);
        } catch (error) {
          failedIncidentErrors[incidentKey] = error instanceof Error ? error.message : "Unknown incident sync error";
        }
      }

      setQueue((current) =>
        current
          .filter((item) => !syncedIds.includes(item.id))
          .map((item) => ({
            ...item,
            errorMessage: failedErrors[item.id] ?? item.errorMessage
          }))
      );
      setIncidentQueue((current) =>
        current
          .filter((item) => !syncedIncidentKeys.includes(`${item.queuedAt}-${item.title}`))
          .map((item) => ({
            ...item,
            errorMessage: failedIncidentErrors[`${item.queuedAt}-${item.title}`] ?? item.errorMessage
          }))
      );

      if (syncedIds.length > 0 || syncedIncidentKeys.length > 0) {
        if (latestSyncAt) {
          setLastSyncAt(latestSyncAt);
          await saveLastSyncAt(latestSyncAt);
        }
        setRoute(await fetchAssignedRoute());
      }
      setMessage(
        `${syncedIds.length}/${pendingActions.length} stop updates and ${syncedIncidentKeys.length}/${incidentQueue.length} incidents synced.`
      );
    } finally {
      setQueueSyncing(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <StatusBar style="dark" />
        <Text style={styles.eyebrow}>CleanOps Driver</Text>
        <Text style={styles.heading}>{route.zoneName} collection run</Text>
        <Text style={styles.copy}>
          {(session?.fullName ?? pilotDriver.fullName)} · {route.truckRegistration} · {shiftStarted ? "Shift active" : "Shift not started"}
        </Text>
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{loading ? "Loading..." : message}</Text>
          <Text style={styles.noticeSubtext}>
            Demo login: {driverCredentials.email} / {driverCredentials.password}
          </Text>
        </View>

        <Pressable onPress={() => setSettingsOpen((current) => !current)} style={styles.settingsButton}>
          <Text style={styles.settingsButtonText}>{settingsOpen ? "Hide app settings" : "App settings"}</Text>
        </Pressable>

        {settingsOpen ? (
          <View style={styles.settingsCard}>
            <View style={styles.settingsRow}>
              <View style={styles.settingsTextBlock}>
                <Text style={styles.cardTitle}>Offline queue and sync status</Text>
                <Text style={styles.cardCopy}>
                  {syncEnabled
                    ? "Failed stop updates will be saved locally and retried later."
                    : "Failed stop updates will not be queued. Drivers will see a connectivity alert."}
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
            <Text style={styles.summaryLabel}>Progress</Text>
            <Text style={styles.summaryValue}>{progress}%</Text>
            <Text style={styles.summaryCopy}>
              {route.completedStops}/{route.totalStops} stops completed
            </Text>
          </View>
          {syncEnabled ? (
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Sync Queue</Text>
              <Text style={styles.summaryValue}>{pendingQueue}</Text>
              <Text style={styles.summaryCopy}>
                {queueHydrated ? "unsynced offline updates" : "loading saved queue"}
              </Text>
              <Text style={styles.summaryCopy}>
                Last sync: {lastSyncAt ? new Date(lastSyncAt).toLocaleTimeString() : "not yet"}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.actionRow}>
          <Pressable
            onPress={handleStartShift}
            style={[styles.primaryButton, shiftStarted && styles.disabledButton]}
          >
            <Text style={styles.primaryButtonText}>{shiftStarted ? "Shift started" : "Start shift"}</Text>
          </Pressable>
          {syncEnabled ? (
            <Pressable
              disabled={queueSyncing}
              onPress={syncQueue}
              style={[styles.secondaryButton, queueSyncing && styles.disabledButton]}
            >
              <Text style={styles.secondaryButtonText}>{queueSyncing ? "Syncing queue..." : "Sync queue"}</Text>
            </Pressable>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>Incident Reporting</Text>
        <View style={styles.card}>
          <Pressable onPress={() => setIncidentFormOpen((current) => !current)} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>
              {incidentFormOpen ? "Hide incident form" : "Report incident"}
            </Text>
          </Pressable>

          {incidentFormOpen ? (
            <View style={styles.formBlock}>
              <Text style={styles.summaryLabel}>Incident type</Text>
              <View style={styles.optionGrid}>
                {incidentTypes.map((type) => (
                  <Pressable
                    key={type}
                    onPress={() => setIncidentType(type)}
                    style={[styles.optionPill, incidentType === type && styles.optionPillActive]}
                  >
                    <Text style={[styles.optionText, incidentType === type && styles.optionTextActive]}>
                      {incidentTypeLabels[type]}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.summaryLabel}>Attach to stop</Text>
              <View style={styles.optionGrid}>
                <Pressable
                  onPress={() => setIncidentStopId("")}
                  style={[styles.optionPill, incidentStopId === "" && styles.optionPillActive]}
                >
                  <Text style={[styles.optionText, incidentStopId === "" && styles.optionTextActive]}>
                    Route level
                  </Text>
                </Pressable>
                {route.stops.map((stop) => (
                  <Pressable
                    key={stop.id}
                    onPress={() => setIncidentStopId(stop.id)}
                    style={[styles.optionPill, incidentStopId === stop.id && styles.optionPillActive]}
                  >
                    <Text style={[styles.optionText, incidentStopId === stop.id && styles.optionTextActive]}>
                      #{stop.stopSequence} {stop.customerName}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <TextInput
                onChangeText={setIncidentTitle}
                placeholder="Incident title"
                placeholderTextColor="#829086"
                style={styles.input}
                value={incidentTitle}
              />
              <TextInput
                multiline
                onChangeText={setIncidentDescription}
                placeholder="Describe what happened"
                placeholderTextColor="#829086"
                style={[styles.input, styles.multilineInput]}
                value={incidentDescription}
              />
              <Pressable
                disabled={submittingIncident}
                onPress={handleIncidentSubmit}
                style={[styles.primaryButton, submittingIncident && styles.disabledButton]}
              >
                <Text style={styles.primaryButtonText}>
                  {submittingIncident ? "Submitting..." : syncEnabled ? "Submit incident" : "Submit directly"}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>Assigned Stops</Text>
        <View style={styles.stopList}>
          {route.stops.map((stop) => {
            const pendingAction = syncEnabled ? pendingActionByStop[stop.id] : undefined;
            const effectiveStatus = pendingAction?.status ?? stop.status;
            const isSyncing = Boolean(syncingStopIds[stop.id]);
            const actionDisabled = effectiveStatus !== "pending" || isSyncing || queueSyncing;

            return (
              <View key={stop.id} style={[styles.stopCard, effectiveStatus !== "pending" && styles.stopCardDone]}>
                <View style={styles.stopHeader}>
                  <View>
                    <Text style={styles.stopTitle}>
                      #{stop.stopSequence} {stop.customerName}
                    </Text>
                    <Text style={styles.stopAddress}>{stop.address}</Text>
                  </View>
                  <Text
                    style={[
                      styles.statusPill,
                      effectiveStatus === "skipped" && styles.warningPill,
                      pendingAction && styles.queuePill
                    ]}
                  >
                    {pendingAction ? `queued ${pendingAction.status}` : effectiveStatus.replace("_", " ")}
                  </Text>
                </View>

                {pendingAction ? (
                  <Text style={styles.queueNotice}>
                    Pending offline sync from {new Date(pendingAction.queuedAt).toLocaleTimeString()}
                    {pendingAction.errorMessage ? `: ${pendingAction.errorMessage}` : "."}
                  </Text>
                ) : null}
                {stop.serviceStatus === "suspended" ? (
                  <Text style={styles.warningText}>Service suspended: verify tag before pickup.</Text>
                ) : null}
                {pendingAction?.skipReason || stop.skipReason ? (
                  <Text style={styles.stopMeta}>Skip reason: {pendingAction?.skipReason ?? stop.skipReason}</Text>
                ) : null}
                {pendingAction?.note || stop.notes ? (
                  <Text style={styles.stopMeta}>Note: {pendingAction?.note ?? stop.notes}</Text>
                ) : null}

                <TextInput
                  editable={!actionDisabled}
                  onChangeText={(value) => setNotes((current) => ({ ...current, [stop.id]: value }))}
                  placeholder="Optional stop note"
                  placeholderTextColor="#829086"
                  style={[styles.input, actionDisabled && styles.disabledInput]}
                  value={notes[stop.id] ?? ""}
                />
                <TextInput
                  editable={!actionDisabled}
                  onChangeText={(value) => setSkipReasons((current) => ({ ...current, [stop.id]: value }))}
                  placeholder="Skip reason required to skip"
                  placeholderTextColor="#829086"
                  style={[styles.input, actionDisabled && styles.disabledInput]}
                  value={skipReasons[stop.id] ?? ""}
                />

                <View style={styles.actionRow}>
                  <Pressable
                    disabled={actionDisabled}
                    onPress={() => handleStopAction(stop, "completed")}
                    style={[styles.primaryButton, actionDisabled && styles.disabledButton]}
                  >
                    <Text style={styles.primaryButtonText}>
                      {isSyncing ? "Syncing..." : pendingAction ? "Queued" : "Complete"}
                    </Text>
                  </Pressable>
                  <Pressable
                    disabled={actionDisabled}
                    onPress={() => handleStopAction(stop, "skipped")}
                    style={[styles.secondaryButton, actionDisabled && styles.disabledButton]}
                  >
                    <Text style={styles.secondaryButtonText}>Skip</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>

        {syncEnabled ? (
          <>
            <Text style={styles.sectionTitle}>Offline Queue</Text>
            <View style={styles.card}>
              {queue.length === 0 && incidentQueue.length === 0 ? (
                <Text style={styles.cardCopy}>No pending offline updates.</Text>
              ) : (
                <>
                  {queue.map((item) => (
                    <View key={item.id} style={styles.queueItem}>
                      <Text style={styles.cardCopy}>
                        Stop {item.status} · pending · {new Date(item.queuedAt).toLocaleTimeString()}
                      </Text>
                      {item.errorMessage ? <Text style={styles.queueError}>{item.errorMessage}</Text> : null}
                    </View>
                  ))}
                  {incidentQueue.map((item) => (
                    <View key={`${item.queuedAt}-${item.title}`} style={styles.queueItem}>
                      <Text style={styles.cardCopy}>
                        Incident · {incidentTypeLabels[item.incidentType]} · {new Date(item.queuedAt ?? "").toLocaleTimeString()}
                      </Text>
                      <Text style={styles.queueError}>{item.title}</Text>
                      {item.errorMessage ? <Text style={styles.queueError}>{item.errorMessage}</Text> : null}
                    </View>
                  ))}
                </>
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: "#f3f7f1",
    flex: 1
  },
  container: {
    padding: 24,
    paddingTop: 56
  },
  eyebrow: {
    color: "#1a7f45",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.4,
    marginBottom: 12,
    textTransform: "uppercase"
  },
  heading: {
    color: "#102017",
    fontSize: 38,
    fontWeight: "800",
    letterSpacing: -1.4,
    lineHeight: 42
  },
  copy: {
    color: "#4b5f52",
    fontSize: 17,
    lineHeight: 27,
    marginTop: 16
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
    fontSize: 15,
    fontWeight: "800"
  },
  noticeSubtext: {
    color: "#637466",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4
  },
  settingsButton: {
    alignSelf: "flex-start",
    backgroundColor: "#102017",
    borderRadius: 999,
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  settingsButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900"
  },
  settingsCard: {
    backgroundColor: "#ffffff",
    borderColor: "#dbe7dd",
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 12,
    padding: 16
  },
  settingsRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 16,
    justifyContent: "space-between"
  },
  settingsTextBlock: {
    flex: 1
  },
  summaryGrid: {
    flexDirection: "row",
    gap: 16,
    marginTop: 32
  },
  summaryCard: {
    backgroundColor: "#ffffff",
    borderColor: "#dbe7dd",
    borderRadius: 24,
    borderWidth: 1,
    flex: 1,
    padding: 18
  },
  summaryLabel: {
    color: "#637466",
    fontSize: 13,
    fontWeight: "700"
  },
  summaryValue: {
    color: "#102017",
    fontSize: 34,
    fontWeight: "900",
    marginTop: 8
  },
  summaryCopy: {
    color: "#637466",
    fontSize: 14,
    marginTop: 4
  },
  card: {
    backgroundColor: "#ffffff",
    borderColor: "#dbe7dd",
    borderRadius: 24,
    borderWidth: 1,
    padding: 22
  },
  cardTitle: {
    color: "#102017",
    fontSize: 20,
    fontWeight: "800"
  },
  cardCopy: {
    color: "#637466",
    fontSize: 16,
    lineHeight: 24,
    marginTop: 8
  },
  formBlock: {
    gap: 12,
    marginTop: 16
  },
  optionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 4,
    marginTop: 8
  },
  optionPill: {
    backgroundColor: "#f3f7f1",
    borderColor: "#dbe7dd",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  optionPillActive: {
    backgroundColor: "#102017",
    borderColor: "#102017"
  },
  optionText: {
    color: "#4b5f52",
    fontSize: 12,
    fontWeight: "800"
  },
  optionTextActive: {
    color: "#ffffff"
  },
  queueItem: {
    borderBottomColor: "#edf3ee",
    borderBottomWidth: 1,
    paddingBottom: 10
  },
  queueError: {
    color: "#a8550b",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4
  },
  queueNotice: {
    backgroundColor: "#eef6ff",
    borderRadius: 12,
    color: "#1d4f7a",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 18,
    marginTop: 12,
    padding: 10
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#1a7f45",
    borderRadius: 999,
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "900"
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#e7f7ed",
    borderRadius: 999,
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12
  },
  secondaryButtonText: {
    color: "#1a7f45",
    fontWeight: "900"
  },
  disabledButton: {
    opacity: 0.55
  },
  sectionTitle: {
    color: "#102017",
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 12,
    marginTop: 32
  },
  stopList: {
    gap: 16
  },
  stopCard: {
    backgroundColor: "#ffffff",
    borderColor: "#dbe7dd",
    borderRadius: 24,
    borderWidth: 1,
    padding: 18
  },
  stopCardDone: {
    opacity: 0.76
  },
  stopHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between"
  },
  stopTitle: {
    color: "#102017",
    fontSize: 18,
    fontWeight: "900"
  },
  stopAddress: {
    color: "#637466",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 4
  },
  statusPill: {
    backgroundColor: "#e7f7ed",
    borderRadius: 999,
    color: "#1a7f45",
    fontSize: 12,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 6,
    textTransform: "capitalize"
  },
  warningPill: {
    backgroundColor: "#fff1df",
    color: "#a8550b"
  },
  queuePill: {
    backgroundColor: "#eef6ff",
    color: "#1d4f7a"
  },
  warningText: {
    backgroundColor: "#fff1df",
    borderRadius: 12,
    color: "#a8550b",
    fontSize: 14,
    fontWeight: "800",
    marginTop: 12,
    padding: 10
  },
  stopMeta: {
    color: "#637466",
    fontSize: 14,
    marginTop: 10
  },
  input: {
    backgroundColor: "#f8fbf7",
    borderColor: "#dbe7dd",
    borderRadius: 14,
    borderWidth: 1,
    color: "#102017",
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 11
  },
  multilineInput: {
    minHeight: 96,
    textAlignVertical: "top"
  },
  disabledInput: {
    opacity: 0.6
  }
});
