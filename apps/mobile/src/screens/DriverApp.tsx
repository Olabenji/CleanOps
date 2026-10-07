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
import {
  DEFAULT_OPERATION_TIME_ZONE,
  getOperationDate,
  incidentTypes,
  type DriverRouteNotice,
  type DriverShiftJob,
  type DriverStopAction,
  type DumpsiteRunRecord,
  type IncidentReportInput,
  type IncidentType,
  type RouteDetail,
  type RouteStop,
  type RouteStopStatus,
  type RouteTruckHandoff
} from "@cleanops/shared";
import { createStopAction, pilotDriver, pilotDriverRoute } from "../data/driverPilot";
import {
  acknowledgeRouteNotice,
  confirmTruckHandoff,
  driverEnsureDailyRoutesLoaded,
  fetchAssignedRoute,
  fetchDriverTodayPlanningStatus,
  fetchDriverTodayShiftSummary,
  fetchDumpsiteRunForRoute,
  fetchPendingHandoffs,
  fetchPendingRouteNotices,
  recordDumpsiteRun,
  recordFuelLog,
  rejectTruckHandoff,
  reportDriverIncident,
  syncStopAction,
  transitionAssignedRoute
} from "../data/driverService";
import type { FieldSession } from "../data/fieldSessionService";
import { startTruckLiveGpsPublisher } from "../data/truckLiveGps";
import ProfileSettingsCard from "../components/ProfileSettingsCard";
import DriverTabBar, { type DriverTabId } from "../components/DriverTabBar";
import DriverHistoryScreen from "./DriverHistoryScreen";
import { colors } from "../theme";
import {
  loadIncidentQueue,
  loadLastSyncAt,
  loadOfflineQueue,
  loadSyncEnabled,
  offlineStoreBackend,
  saveIncidentQueue,
  saveLastSyncAt,
  saveOfflineQueue,
  saveSyncEnabled
} from "../data/offlineQueueStore";
import { captureStopGps, captureStopProofPhoto, warmStopProofPermissions } from "../data/fieldProof";

const incidentTypeLabels: Record<IncidentType, string> = {
  blocked_access: "Blocked access",
  customer_dispute: "Customer dispute",
  truck_issue: "Truck issue",
  missed_pickup: "Missed pickup",
  illegal_dumping: "Illegal dumping",
  safety_concern: "Safety concern",
  other: "Other"
};

function parseNairaToKobo(value: string): number | null {
  const parsed = Number.parseFloat(value.replace(/,/g, "").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.round(parsed * 100);
}

function formatKobo(amountKobo: number) {
  return new Intl.NumberFormat("en-NG", {
    currency: "NGN",
    maximumFractionDigits: 0,
    style: "currency"
  }).format(amountKobo / 100);
}

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

export default function DriverApp({
  session,
  onSignOut,
  onSessionUpdated
}: {
  session: FieldSession;
  onSignOut: () => void;
  onSessionUpdated?: (next: Pick<FieldSession, "fullName" | "phone">) => void;
}) {
  const operationDate = getOperationDate(session.timezone ?? DEFAULT_OPERATION_TIME_ZONE);
  const [route, setRoute] = useState<RouteDetail | null>(session.mode === "pilot" ? pilotDriverRoute : null);
  const [shiftStarted, setShiftStarted] = useState(
    session.mode === "pilot" ? Boolean(pilotDriverRoute.startedAt) : false
  );
  const [queue, setQueue] = useState<DriverStopAction[]>([]);
  const [incidentQueue, setIncidentQueue] = useState<IncidentReportInput[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [skipReasons, setSkipReasons] = useState<Record<string, string>>({});
  const [skipReasonOpen, setSkipReasonOpen] = useState<Record<string, boolean>>({});
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
  const [activeTab, setActiveTab] = useState<DriverTabId>("today");
  const [incidentFormOpen, setIncidentFormOpen] = useState(false);
  const [fuelFormOpen, setFuelFormOpen] = useState(false);
  const [dumpsiteFormOpen, setDumpsiteFormOpen] = useState(false);
  const [fuelLitres, setFuelLitres] = useState("");
  const [fuelCostNaira, setFuelCostNaira] = useState("");
  const [fuelStation, setFuelStation] = useState("");
  const [dumpsiteNotes, setDumpsiteNotes] = useState("");
  const [dumpsiteTippingNaira, setDumpsiteTippingNaira] = useState("");
  const [dumpsiteSiteName, setDumpsiteSiteName] = useState("");
  const [dumpsiteDocketNumber, setDumpsiteDocketNumber] = useState("");
  const [dumpsiteTonnes, setDumpsiteTonnes] = useState("");
  const [dumpsiteRun, setDumpsiteRun] = useState<DumpsiteRunRecord | null>(null);
  const [pendingHandoffs, setPendingHandoffs] = useState<RouteTruckHandoff[]>([]);
  const [shiftJobs, setShiftJobs] = useState<DriverShiftJob[]>([]);
  const [canLoadDefaults, setCanLoadDefaults] = useState(false);
  const [loadingDefaults, setLoadingDefaults] = useState(false);
  const [defaultPromptShown, setDefaultPromptShown] = useState(false);
  const [handoffActionId, setHandoffActionId] = useState<string | null>(null);
  const [submittingFuel, setSubmittingFuel] = useState(false);
  const [submittingDumpsitePhase, setSubmittingDumpsitePhase] = useState<string | null>(null);
  const [endingRoute, setEndingRoute] = useState(false);
  const [submittingIncident, setSubmittingIncident] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("Loading driver workspace...");
  const progress = useMemo(() => {
    if (!route || route.totalStops === 0) {
      return 0;
    }

    return Math.round((route.completedStops / route.totalStops) * 100);
  }, [route]);
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
  const pendingStopCount = useMemo(
    () => route?.stops.filter((stop) => stop.status === "pending").length ?? 0,
    [route]
  );
  const wrapUpReady = Boolean(
    route && route.status === "in_progress" && route.stops.length > 0 && pendingStopCount === 0
  );
  const skippedStopCount = useMemo(
    () => route?.stops.filter((stop) => stop.status === "skipped" || stop.status === "missed_reported").length ?? 0,
    [route]
  );
  const completedStopCount = useMemo(
    () => route?.stops.filter((stop) => stop.status === "completed").length ?? 0,
    [route]
  );

  useEffect(() => {
    if (wrapUpReady) {
      setDumpsiteFormOpen(true);
      setMessage("Collection stops done. Review, log dumpsite if needed, then end route.");
    }
  }, [wrapUpReady, route?.id]);

  useEffect(() => {
    if (session.mode !== "supabase" || !route || route.status !== "in_progress") {
      return;
    }

    const handle = startTruckLiveGpsPublisher(route.id, {
      onStatus: (status) => {
        if (status) {
          setMessage(status);
        }
      }
    });

    return () => handle.stop();
  }, [session.mode, route?.id, route?.status]);

  useEffect(() => {
    void bootstrapDriver();
    void hydrateOfflineQueue();
  }, [session.fullName, session.mode]);

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

  async function presentRouteNotices(notices: DriverRouteNotice[]) {
    for (const notice of notices) {
      await new Promise<void>((resolve) => {
        Alert.alert(notice.title, notice.body, [
          {
            text: "OK",
            onPress: () => {
              void acknowledgeRouteNotice(notice.id).finally(() => resolve());
            }
          }
        ]);
      });
    }
  }

  async function bootstrapDriver(isRefresh = false) {
    if (!isRefresh) {
      setLoading(true);
    }

    if (session.mode === "pilot") {
      setRoute(pilotDriverRoute);
      setShiftStarted(Boolean(pilotDriverRoute.startedAt));
      setCanLoadDefaults(false);
      setMessage(`Signed in as ${session.fullName} (pilot)`);
      if (!isRefresh) {
        setLoading(false);
      }
      return;
    }

    try {
      const assignedRoute = await fetchAssignedRoute(operationDate);
      if (assignedRoute) {
        setRoute(assignedRoute);
        setShiftStarted(assignedRoute.status === "in_progress" || Boolean(assignedRoute.startedAt));
        setCanLoadDefaults(false);
        setShiftJobs([]);
        setMessage(`Signed in as ${session.fullName} (supabase)`);
        if (assignedRoute.status === "in_progress") {
          void warmStopProofPermissions();
        }
        await refreshDumpsiteRun(assignedRoute.id);
        setPendingHandoffs(await fetchPendingHandoffs());
        const notices = await fetchPendingRouteNotices();
        if (notices.length > 0) {
          await presentRouteNotices(notices);
        }
        return;
      }

      setRoute(null);
      setShiftStarted(false);
      setDumpsiteRun(null);
      setPendingHandoffs(await fetchPendingHandoffs().catch(() => []));
      const summary = await fetchDriverTodayShiftSummary(operationDate).catch(() => ({ jobs: [] as DriverShiftJob[] }));
      setShiftJobs(summary.jobs);

      const planning = await fetchDriverTodayPlanningStatus();
      setCanLoadDefaults(planning.canLoadDefaults);

      if (summary.jobs.length > 0) {
        const covers = summary.jobs.filter((job) => job.jobType === "cover_completed" || job.jobType === "reassignment_completed");
        setMessage(
          covers.length > 0
            ? `Shift wrap-up: ${covers.length} cover/reassignment job${covers.length === 1 ? "" : "s"} completed today.`
            : `Shift wrap-up: ${summary.jobs.length} finished item${summary.jobs.length === 1 ? "" : "s"} today.`
        );
      } else if (planning.canLoadDefaults) {
        setMessage("Today's route is yet to be loaded by the operator.");
        if (!defaultPromptShown) {
          setDefaultPromptShown(true);
          Alert.alert(
            "Load default route?",
            "Today's route is yet to be loaded in by the operator. Click OK to load default route to get you started.",
            [
              { text: "Not now", style: "cancel" },
              {
                text: "OK",
                onPress: () => {
                  void handleLoadDefaultRoutes();
                }
              }
            ]
          );
        }
      } else {
        setMessage("No route assigned today. Ask an operator to assign you on Routes.");
      }
    } catch (error) {
      setRoute(null);
      setShiftStarted(false);
      setDumpsiteRun(null);
      setCanLoadDefaults(false);
      try {
        setPendingHandoffs(await fetchPendingHandoffs());
      } catch {
        setPendingHandoffs([]);
      }
      setMessage(
        error instanceof Error
          ? error.message
          : "No route assigned today. Ask an operator to assign you on Routes."
      );
    } finally {
      if (!isRefresh) {
        setLoading(false);
      }
    }
  }

  async function handleLoadDefaultRoutes() {
    setLoadingDefaults(true);
    try {
      const result = await driverEnsureDailyRoutesLoaded();
      setMessage(
        result.plannedCount > 0
          ? `Loaded ${result.plannedCount} default ward route${result.plannedCount === 1 ? "" : "s"}.`
          : result.hasAssignedRoute
            ? "Default routes were already available."
            : "Default routes loaded, but you are not assigned yet. Ask the operator to assign you."
      );
      await bootstrapDriver(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load default routes");
      Alert.alert("Unable to load defaults", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setLoadingDefaults(false);
    }
  }

  async function handleStartShift() {
    if (!route) {
      setMessage("No route assigned today. Ask an operator to assign you on Routes.");
      return;
    }

    setShiftStarted(true);

    if (session?.mode === "pilot") {
      setMessage("Shift started locally in pilot mode.");
      return;
    }

    try {
      await transitionAssignedRoute(route.id, "in_progress");
      const nextRoute = await fetchAssignedRoute(operationDate);
      if (nextRoute) {
        setRoute(nextRoute);
      }
      setMessage("Shift started and synced.");
      void warmStopProofPermissions();
    } catch (error) {
      setMessage(error instanceof Error ? `Shift started locally: ${error.message}` : "Shift started locally");
      void warmStopProofPermissions();
    }
  }

  async function handleStopAction(stop: RouteStop, status: RouteStopStatus) {
    if (!route) {
      return;
    }

    if (status === "completed" && stop.serviceStatus === "suspended") {
      setMessage("Service is suspended for this customer — use Skip instead of Complete.");
      return;
    }

    const note = notes[stop.id];
    const skipReason = skipReasons[stop.id];

    if (status === "skipped") {
      if (!skipReasonOpen[stop.id]) {
        setSkipReasonOpen((current) => ({ ...current, [stop.id]: true }));
        setMessage("Enter a skip reason, then tap Confirm skip.");
        return;
      }
      if (!skipReason?.trim()) {
        setMessage("Skip reason is required.");
        return;
      }
    }

    if (session?.mode === "pilot") {
      setRoute((current) => {
        if (!current) {
          return current;
        }
        const next = updateStop(current, stop.id, status, note, skipReason);
        const remaining = next.stops.filter((item) => item.status === "pending").length;
        setMessage(
          remaining === 0
            ? "All stops finished. Review, log dumpsite if needed, then end route."
            : "Pilot route updated locally. Supabase sync is disabled in pilot mode."
        );
        return next;
      });
      return;
    }

    setSyncingStopIds((current) => ({ ...current, [stop.id]: true }));

    let wantPhoto: false | "camera" | "library" = false;
    if (status === "completed") {
      wantPhoto = await new Promise<false | "camera" | "library">((resolve) => {
        Alert.alert(
          "Complete stop",
          "Stop is saved first. Proof photo is optional — Gallery is fastest; Camera can feel slow on some phones.",
          [
            { text: "Save only", style: "cancel", onPress: () => resolve(false) },
            { text: "Gallery", onPress: () => resolve("library") },
            { text: "Camera", onPress: () => resolve("camera") }
          ]
        );
      });
    }

    // GPS only up front — never open the camera before the stop is durable.
    let gps: { latitude: number | null; longitude: number | null } = {
      latitude: null,
      longitude: null
    };
    try {
      gps = await captureStopGps();
    } catch {
      gps = { latitude: null, longitude: null };
    }

    const action = createStopAction(route.id, stop.id, status, note, skipReason, {
      latitude: gps.latitude,
      longitude: gps.longitude
    });

    // Persist locally before any camera / network work so a crash cannot lose the completion.
    setRoute((current) => (current ? updateStop(current, stop.id, status, note, skipReason) : current));
    const durableQueue = [
      action,
      ...queue.filter((item) => item.stopId !== stop.id || item.syncedAt)
    ];
    setQueue(durableQueue);
    try {
      await saveOfflineQueue(durableQueue);
    } catch {
      // Still continue — in-memory queue + UI already reflect the stop.
    }

    let synced = false;
    let proofNote = "";

    try {
      const syncResult = await syncStopAction(stop.id, status as "completed" | "skipped", note, skipReason, {
        latitude: gps.latitude,
        longitude: gps.longitude
      });
      synced = true;
      const syncedAt = syncResult.syncedAt ?? new Date().toISOString();
      setLastSyncAt(syncedAt);
      await saveLastSyncAt(syncedAt);
      setQueue((current) =>
        current.map((item) =>
          item.stopId === stop.id && !item.syncedAt ? { ...item, syncedAt, errorMessage: undefined } : item
        )
      );
      const bits: string[] = [];
      if (gps.latitude != null) {
        bits.push("GPS saved");
      }
      proofNote = bits.length > 0 ? ` ${bits.join(" · ")}.` : "";
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown sync error";

      if (!syncEnabled) {
        Alert.alert(
          "Connectivity error",
          `This stop is kept on the device queue. Check your connection and sync later.\n\n${errorMessage}`
        );
        setMessage(`Queued offline: ${errorMessage}`);
      } else {
        setQueue((current) =>
          current.map((item) =>
            item.stopId === stop.id && !item.syncedAt ? { ...item, errorMessage } : item
          )
        );
        setMessage(`Queued offline: ${errorMessage}`);
      }
    }

    // Optional photo AFTER the stop is saved/queued — crash here must not lose completion.
    if (wantPhoto) {
      setMessage(wantPhoto === "library" ? "Opening gallery…" : "Opening camera…");
      try {
        const photo = await captureStopProofPhoto(wantPhoto);
        if (photo) {
          try {
            const photoSync = await syncStopAction(
              stop.id,
              status as "completed" | "skipped",
              note,
              skipReason,
              {
                latitude: gps.latitude,
                longitude: gps.longitude,
                localPhotoUri: photo.uri,
                mimeType: photo.mimeType
              }
            );
            const syncedAt = photoSync.syncedAt ?? new Date().toISOString();
            setLastSyncAt(syncedAt);
            await saveLastSyncAt(syncedAt);
            proofNote = `${proofNote} Photo saved.`.replace(/\.\s+Photo/, ". Photo");
            if (!synced) {
              synced = true;
              setQueue((current) =>
                current.map((item) =>
                  item.stopId === stop.id && !item.syncedAt
                    ? { ...item, syncedAt, localPhotoUri: photo.uri, errorMessage: undefined }
                    : item
                )
              );
            }
          } catch (photoError) {
            const msg = photoError instanceof Error ? photoError.message : "photo upload failed";
            proofNote = `${proofNote} Stop saved — photo failed (${msg}).`;
          }
        } else {
          proofNote = `${proofNote} Stop saved without photo.`;
        }
      } catch {
        proofNote = `${proofNote} Stop saved — photo picker unavailable.`;
      }
    }

    try {
      const refreshed = (await fetchAssignedRoute(operationDate)) ?? route;
      setRoute(refreshed);
      const remainingPending = refreshed.stops.filter((item) => item.status === "pending").length;
      setMessage(
        remainingPending === 0
          ? `All stops finished. Use wrap-up below for dumpsite / end route.${proofNote}`
          : synced
            ? `Stop update synced.${proofNote}`
            : `Stop saved on device (will sync).${proofNote}`
      );
    } catch {
      setMessage(
        synced
          ? `Stop update synced.${proofNote}`
          : `Stop saved on device (will sync).${proofNote}`
      );
    } finally {
      setSyncingStopIds((current) => ({ ...current, [stop.id]: false }));
    }
  }

  async function refreshDumpsiteRun(routeId: string) {
    try {
      const run = await fetchDumpsiteRunForRoute(routeId);
      setDumpsiteRun(run);
    } catch {
      setDumpsiteRun(null);
    }
  }

  async function handleHandoffConfirm(handoffId: string) {
    setHandoffActionId(handoffId);
    try {
      const result = await confirmTruckHandoff(handoffId);
      setPendingHandoffs(await fetchPendingHandoffs());
      await bootstrapDriver(true);
      setMessage(
        result.status === "confirmed"
          ? `Handoff confirmed. Now on ${result.toTruckRegistration}.`
          : "Confirmation recorded. Waiting for the other driver."
      );
    } catch (error) {
      Alert.alert("Unable to confirm handoff", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setHandoffActionId(null);
    }
  }

  async function handleHandoffReject(handoffId: string) {
    setHandoffActionId(handoffId);
    try {
      await rejectTruckHandoff(handoffId, "Declined from driver app");
      setPendingHandoffs(await fetchPendingHandoffs());
      setMessage("Handoff declined. Route assignment unchanged.");
    } catch (error) {
      Alert.alert("Unable to decline handoff", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setHandoffActionId(null);
    }
  }

  async function handleFuelSubmit() {
    if (!route) {
      Alert.alert("No route assigned", "Fuel logs must be linked to your assigned route.");
      return;
    }

    const litres = Number.parseFloat(fuelLitres.trim());
    const costKobo = parseNairaToKobo(fuelCostNaira);
    const stationName = fuelStation.trim();

    if (!Number.isFinite(litres) || litres <= 0) {
      Alert.alert("Fuel details required", "Enter litres purchased.");
      return;
    }

    if (costKobo === null) {
      Alert.alert("Fuel details required", "Enter total cost in naira.");
      return;
    }

    if (stationName.length < 2) {
      Alert.alert("Fuel details required", "Enter the station name.");
      return;
    }

    setSubmittingFuel(true);

    try {
      const record = await recordFuelLog({
        routeId: route.id,
        litres,
        costKobo,
        stationName
      });
      setFuelLitres("");
      setFuelCostNaira("");
      setFuelStation("");
      setFuelFormOpen(false);
      setMessage(`Fuel logged: ${record.litres}L at ${record.stationName} (${formatKobo(record.costKobo)}).`);
    } catch (error) {
      Alert.alert("Unable to log fuel", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setSubmittingFuel(false);
    }
  }

  async function handleDumpsitePhase(phase: "depart" | "arrive" | "clear") {
    if (!route) {
      Alert.alert("No route assigned", "Dumpsite runs must be linked to your assigned route.");
      return;
    }

    const tippingFeeKobo = phase === "clear" ? parseNairaToKobo(dumpsiteTippingNaira) ?? 0 : undefined;
    const weighbridgeTonnes =
      phase === "clear" && dumpsiteTonnes.trim()
        ? Number(dumpsiteTonnes.replace(/,/g, ""))
        : undefined;

    setSubmittingDumpsitePhase(phase);

    try {
      const record = await recordDumpsiteRun({
        routeId: route.id,
        phase,
        tippingFeeKobo,
        notes: dumpsiteNotes.trim() || undefined,
        dumpsiteSiteName: dumpsiteSiteName.trim() || undefined,
        docketNumber: phase === "clear" ? dumpsiteDocketNumber.trim() || undefined : undefined,
        weighbridgeTonnes:
          weighbridgeTonnes !== undefined && Number.isFinite(weighbridgeTonnes)
            ? weighbridgeTonnes
            : undefined
      });
      setDumpsiteRun(record);
      if (phase === "clear") {
        setDumpsiteNotes("");
        setDumpsiteTippingNaira("");
        setDumpsiteDocketNumber("");
        setDumpsiteTonnes("");
      }
      setMessage(
        phase === "depart"
          ? "Departed for dumpsite."
          : phase === "arrive"
            ? "Arrived at dumpsite."
            : "Dumpsite clearance recorded with disposal evidence."
      );
    } catch (error) {
      Alert.alert("Unable to record dumpsite run", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setSubmittingDumpsitePhase(null);
    }
  }

  function confirmEndRoute() {
    if (!route || !wrapUpReady) {
      return;
    }

    const dumpsiteDone = Boolean(dumpsiteRun?.clearedAt);
    Alert.alert(
      "End route?",
      dumpsiteDone
        ? "This closes the collection run. You can still review finished jobs on the shift wrap-up screen."
        : "Dumpsite clearance has not been logged yet. End route anyway, or cancel and log dumpsite first?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: dumpsiteDone ? "End route" : "End without dumpsite",
          style: dumpsiteDone ? "default" : "destructive",
          onPress: () => {
            void handleEndRoute();
          }
        }
      ]
    );
  }

  async function handleEndRoute() {
    if (!route) {
      return;
    }

    setEndingRoute(true);
    try {
      if (session.mode === "pilot") {
        setRoute(null);
        setDumpsiteRun(null);
        setShiftJobs([]);
        setMessage(`Route ended · ${route.zoneName}. Pilot wrap-up complete.`);
        return;
      }

      await transitionAssignedRoute(route.id, "completed");
      setRoute(null);
      setDumpsiteRun(null);
      await bootstrapDriver(true);
      setMessage("Route ended. Review today's work below, or wait for your next assignment.");
    } catch (error) {
      Alert.alert("Unable to end route", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setEndingRoute(false);
    }
  }

  async function handleIncidentSubmit() {
    if (!route) {
      Alert.alert("No route assigned", "Incidents can only be reported against an assigned route.");
      return;
    }

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
          const syncResult = await syncStopAction(
            item.stopId,
            item.status as "completed" | "skipped",
            item.note,
            item.skipReason,
            {
              latitude: item.latitude,
              longitude: item.longitude,
              proofPhotoPath: item.proofPhotoPath,
              localPhotoUri: item.localPhotoUri
            }
          );
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
        const nextRoute = await fetchAssignedRoute(operationDate);
        if (nextRoute) {
          setRoute(nextRoute);
        }
      }
      setMessage(
        `${syncedIds.length}/${pendingActions.length} stop updates and ${syncedIncidentKeys.length}/${incidentQueue.length} incidents synced.`
      );
    } finally {
      setQueueSyncing(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);

    try {
      await bootstrapDriver(true);
      if (pendingQueue > 0) {
        await syncQueue();
      } else {
        setMessage(`Refreshed at ${new Date().toLocaleTimeString()}`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to refresh driver workspace");
    } finally {
      setRefreshing(false);
    }
  }

  if (activeTab === "history") {
    return (
      <View style={styles.safeArea}>
        <DriverHistoryScreen
          operationTimezone={session.timezone ?? DEFAULT_OPERATION_TIME_ZONE}
          renderJob={(job) => <ShiftJobCard job={job} />}
        />
        <DriverTabBar activeTab={activeTab} onChange={setActiveTab} />
      </View>
    );
  }

  if (activeTab === "profile") {
    return (
      <View style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.container} style={styles.scrollView}>
          <Text style={styles.eyebrow}>CLEANOPS DRIVER</Text>
          <Text style={styles.heading}>Profile</Text>
          <Text style={styles.copy}>Update your account and licence documents.</Text>
          <ProfileSettingsCard
            onProfileUpdated={(next) => onSessionUpdated?.(next)}
            session={session}
          />
          <Pressable onPress={onSignOut} style={styles.signOutSettingsButton}>
            <Text style={styles.signOutSettingsText}>Sign out and switch user</Text>
          </Pressable>
        </ScrollView>
        <DriverTabBar activeTab={activeTab} onChange={setActiveTab} />
      </View>
    );
  }

  if (!route) {
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
          <View style={styles.todayHeader}>
            <View style={styles.todayHeaderCopy}>
              <Text style={styles.eyebrow}>CLEANOPS DRIVER</Text>
              <Text style={styles.heading}>{shiftJobs.length > 0 ? "Shift wrap-up" : "No route assigned"}</Text>
              <Text style={styles.copy}>
                {session?.fullName ?? pilotDriver.fullName} ·{" "}
                {shiftJobs.length > 0 ? "Today's field work" : "Shift not started"}
              </Text>
              <Text style={styles.noticeSubtext}>
                {loading ? "Loading..." : message}
                {session.mode === "supabase" ? " · Connected" : " · Pilot"}
              </Text>
            </View>
            <Pressable onPress={() => setSettingsOpen((current) => !current)} style={styles.gearButton}>
              <Text style={styles.gearGlyph}>⚙</Text>
            </Pressable>
          </View>

          {pendingHandoffs.map((handoff) => (
            <HandoffCard
              key={handoff.id}
              handoff={handoff}
              busy={handoffActionId === handoff.id}
              onAccept={() => void handleHandoffConfirm(handoff.id)}
              onDecline={() => void handleHandoffReject(handoff.id)}
            />
          ))}
          {shiftJobs.map((job) => (
            <ShiftJobCard key={job.id} job={job} />
          ))}
          {shiftJobs.length === 0 ? (
            <View style={styles.emptyRouteCard}>
              <Text style={styles.cardTitle}>
                {canLoadDefaults ? "Today's route not loaded" : "Waiting for assignment"}
              </Text>
              <Text style={styles.cardCopy}>
                {canLoadDefaults
                  ? "The operator has not loaded today's ward templates yet. Load the default routes to get started, then pull to refresh."
                  : "You are signed in live, but no route is assigned to you for today. Ask the operator to set you as the driver on a scheduled route, then pull down to refresh."}
              </Text>
              {canLoadDefaults ? (
                <Pressable
                  disabled={loadingDefaults}
                  onPress={() => void handleLoadDefaultRoutes()}
                  style={styles.primaryButton}
                >
                  <Text style={styles.primaryButtonText}>
                    {loadingDefaults ? "Loading defaults…" : "Load default route"}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <View style={styles.emptyRouteCard}>
              <Text style={styles.cardTitle}>No active assignment</Text>
              <Text style={styles.cardCopy}>
                You have no open route right now. Completed cover jobs and handoffs for today are listed above.
              </Text>
            </View>
          )}

          {settingsOpen ? (
            <View style={styles.settingsCard}>
              <View style={styles.settingsRow}>
                <View style={styles.settingsTextBlock}>
                  <Text style={styles.cardTitle}>Offline queue and sync</Text>
                  <Text style={styles.cardCopy}>
                    Store: {offlineStoreBackend()}.{" "}
                    {syncEnabled
                      ? "Failed stop updates will be saved locally and retried later."
                      : "Failed stop updates will not be queued."}
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

          <Pressable onPress={onSignOut} style={styles.settingsButton}>
            <Text style={styles.settingsButtonText}>Sign out and switch user</Text>
          </Pressable>
        </ScrollView>
        <DriverTabBar activeTab={activeTab} onChange={setActiveTab} />
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
        <View style={styles.todayHeader}>
          <View style={styles.todayHeaderCopy}>
            <Text style={styles.eyebrow}>CLEANOPS DRIVER</Text>
            <Text style={styles.heading}>
              {wrapUpReady ? `${route.zoneName} wrap-up` : `${route.zoneName} collection run`}
            </Text>
            <Text style={styles.copy}>
              {session?.fullName ?? pilotDriver.fullName} · {route.truckRegistration} ·{" "}
              {shiftStarted ? "Shift active" : "Shift not started"}
            </Text>
            <Text style={styles.noticeSubtext}>
              {loading ? "Loading..." : message}
              {session.mode === "supabase" ? " · Connected" : " · Pilot"}
            </Text>
          </View>
          <Pressable onPress={() => setSettingsOpen((current) => !current)} style={styles.gearButton}>
            <Text style={styles.gearGlyph}>⚙</Text>
          </Pressable>
        </View>

        {pendingHandoffs.map((handoff) => (
          <HandoffCard
            key={handoff.id}
            handoff={handoff}
            busy={handoffActionId === handoff.id}
            onAccept={() => void handleHandoffConfirm(handoff.id)}
            onDecline={() => void handleHandoffReject(handoff.id)}
          />
        ))}

        {settingsOpen ? (
          <View style={styles.settingsCard}>
            <View style={styles.settingsRow}>
              <View style={styles.settingsTextBlock}>
                <Text style={styles.cardTitle}>Offline queue and sync</Text>
                <Text style={styles.cardCopy}>
                  Store: {offlineStoreBackend()}.{" "}
                  {syncEnabled
                    ? "Failed stop updates will be saved locally and retried later."
                    : "Failed stop updates will not be queued."}
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

        {wrapUpReady ? (
          <View style={styles.wrapUpCard}>
            <Text style={styles.cardTitle}>Route wrap-up</Text>
            <Text style={styles.cardCopy}>
              All collection stops are done. Review the day, log dumpsite if needed, then end the route
              when you are ready to close out.
            </Text>
            <Text style={styles.stopMeta}>
              Completed {completedStopCount} · Skipped {skippedStopCount} · Total {route.totalStops}
            </Text>
            <Text style={styles.stopMeta}>
              Dumpsite:{" "}
              {dumpsiteRun?.clearedAt
                ? "cleared"
                : dumpsiteRun?.arrivedAt
                  ? "arrived — clear still needed"
                  : dumpsiteRun?.departedAt
                    ? "departed — arrive/clear still needed"
                    : "not logged yet"}
            </Text>
            <View style={styles.actionRow}>
              <Pressable
                onPress={() => setDumpsiteFormOpen(true)}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryButtonText}>
                  {dumpsiteRun?.clearedAt ? "Review dumpsite log" : "Begin dumpsite run"}
                </Text>
              </Pressable>
              <Pressable
                disabled={endingRoute}
                onPress={confirmEndRoute}
                style={[styles.primaryButton, endingRoute && styles.disabledButton]}
              >
                <Text style={styles.primaryButtonText}>{endingRoute ? "Ending..." : "End route"}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

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

        <Text style={styles.sectionTitle}>Fleet logging</Text>
        <View style={styles.card}>
          <Pressable onPress={() => setFuelFormOpen((current) => !current)} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>
              {fuelFormOpen ? "Hide fuel log form" : "Log fuel purchase"}
            </Text>
          </Pressable>

          {fuelFormOpen ? (
            <View style={styles.formBlock}>
              <Text style={styles.summaryLabel}>Litres purchased</Text>
              <TextInput
                keyboardType="decimal-pad"
                onChangeText={setFuelLitres}
                placeholder="45"
                style={styles.input}
                value={fuelLitres}
              />
              <Text style={styles.summaryLabel}>Total cost in naira</Text>
              <TextInput
                keyboardType="decimal-pad"
                onChangeText={setFuelCostNaira}
                placeholder="35000"
                style={styles.input}
                value={fuelCostNaira}
              />
              <Text style={styles.summaryLabel}>Station name</Text>
              <TextInput
                onChangeText={setFuelStation}
                placeholder="Mobil Surulere"
                style={styles.input}
                value={fuelStation}
              />
              <Pressable
                disabled={submittingFuel}
                onPress={() => void handleFuelSubmit()}
                style={[styles.primaryButton, submittingFuel && styles.disabledButton]}
              >
                <Text style={styles.primaryButtonText}>{submittingFuel ? "Saving..." : "Save fuel log"}</Text>
              </Pressable>
            </View>
          ) : null}

          <Pressable
            onPress={() => setDumpsiteFormOpen((current) => !current)}
            style={[styles.secondaryButton, { marginTop: 12 }]}
          >
            <Text style={styles.secondaryButtonText}>
              {dumpsiteFormOpen ? "Hide dumpsite run" : "Log dumpsite run"}
            </Text>
          </Pressable>

          {dumpsiteFormOpen ? (
            <View style={styles.formBlock}>
              <Text style={styles.summaryCopy}>
                Record depart → arrive → cleared timestamps for today&apos;s route.
              </Text>
              {dumpsiteRun?.departedAt ? (
                <Text style={styles.stopMeta}>Departed: {new Date(dumpsiteRun.departedAt).toLocaleString()}</Text>
              ) : null}
              {dumpsiteRun?.arrivedAt ? (
                <Text style={styles.stopMeta}>Arrived: {new Date(dumpsiteRun.arrivedAt).toLocaleString()}</Text>
              ) : null}
              {dumpsiteRun?.clearedAt ? (
                <Text style={styles.stopMeta}>Cleared: {new Date(dumpsiteRun.clearedAt).toLocaleString()}</Text>
              ) : null}

              <View style={styles.actionRow}>
                <Pressable
                  disabled={Boolean(dumpsiteRun?.departedAt) || submittingDumpsitePhase !== null}
                  onPress={() => void handleDumpsitePhase("depart")}
                  style={[
                    styles.secondaryButton,
                    (Boolean(dumpsiteRun?.departedAt) || submittingDumpsitePhase !== null) && styles.disabledButton
                  ]}
                >
                  <Text style={styles.secondaryButtonText}>
                    {submittingDumpsitePhase === "depart" ? "Saving..." : "Depart"}
                  </Text>
                </Pressable>
                <Pressable
                  disabled={
                    !dumpsiteRun?.departedAt ||
                    Boolean(dumpsiteRun?.arrivedAt) ||
                    submittingDumpsitePhase !== null
                  }
                  onPress={() => void handleDumpsitePhase("arrive")}
                  style={[
                    styles.secondaryButton,
                    (!dumpsiteRun?.departedAt ||
                      Boolean(dumpsiteRun?.arrivedAt) ||
                      submittingDumpsitePhase !== null) &&
                      styles.disabledButton
                  ]}
                >
                  <Text style={styles.secondaryButtonText}>
                    {submittingDumpsitePhase === "arrive" ? "Saving..." : "Arrive"}
                  </Text>
                </Pressable>
                <Pressable
                  disabled={
                    !dumpsiteRun?.arrivedAt ||
                    Boolean(dumpsiteRun?.clearedAt) ||
                    submittingDumpsitePhase !== null
                  }
                  onPress={() => void handleDumpsitePhase("clear")}
                  style={[
                    styles.secondaryButton,
                    (!dumpsiteRun?.arrivedAt ||
                      Boolean(dumpsiteRun?.clearedAt) ||
                      submittingDumpsitePhase !== null) &&
                      styles.disabledButton
                  ]}
                >
                  <Text style={styles.secondaryButtonText}>
                    {submittingDumpsitePhase === "clear" ? "Saving..." : "Cleared"}
                  </Text>
                </Pressable>
              </View>

              {!dumpsiteRun?.clearedAt ? (
                <>
                  <Text style={styles.summaryLabel}>Landfill / site name (optional)</Text>
                  <TextInput
                    onChangeText={setDumpsiteSiteName}
                    placeholder="e.g. Olusosun"
                    style={styles.input}
                    value={dumpsiteSiteName}
                  />
                  <Text style={styles.summaryLabel}>Notes (optional)</Text>
                  <TextInput
                    multiline
                    onChangeText={setDumpsiteNotes}
                    placeholder="Queue time, site name, truck issue..."
                    style={[styles.input, styles.multilineInput]}
                    value={dumpsiteNotes}
                  />
                  {dumpsiteRun?.arrivedAt && !dumpsiteRun.clearedAt ? (
                    <>
                      <Text style={styles.summaryLabel}>Docket / receipt number</Text>
                      <TextInput
                        onChangeText={setDumpsiteDocketNumber}
                        placeholder="Weighbridge docket #"
                        style={styles.input}
                        value={dumpsiteDocketNumber}
                      />
                      <Text style={styles.summaryLabel}>Weighbridge tonnes</Text>
                      <TextInput
                        keyboardType="decimal-pad"
                        onChangeText={setDumpsiteTonnes}
                        placeholder="e.g. 4.250"
                        style={styles.input}
                        value={dumpsiteTonnes}
                      />
                      <Text style={styles.summaryLabel}>Tipping fee in naira (optional)</Text>
                      <TextInput
                        keyboardType="decimal-pad"
                        onChangeText={setDumpsiteTippingNaira}
                        placeholder="5000"
                        style={styles.input}
                        value={dumpsiteTippingNaira}
                      />
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  {dumpsiteRun.docketNumber ? (
                    <Text style={styles.stopMeta}>Docket: {dumpsiteRun.docketNumber}</Text>
                  ) : null}
                  {dumpsiteRun.weighbridgeTonnes != null ? (
                    <Text style={styles.stopMeta}>Tonnes: {dumpsiteRun.weighbridgeTonnes}</Text>
                  ) : null}
                  {dumpsiteRun.dumpsiteSiteName ? (
                    <Text style={styles.stopMeta}>Site: {dumpsiteRun.dumpsiteSiteName}</Text>
                  ) : null}
                  {dumpsiteRun.tippingFeeKobo > 0 ? (
                    <Text style={styles.stopMeta}>Tipping fee: {formatKobo(dumpsiteRun.tippingFeeKobo)}</Text>
                  ) : null}
                </>
              )}
            </View>
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
            const isSuspended = stop.serviceStatus === "suspended";
            const actionDisabled = effectiveStatus !== "pending" || isSyncing || queueSyncing;
            const completeDisabled = actionDisabled || isSuspended;

            return (
              <View key={stop.id} style={[styles.stopCard, effectiveStatus !== "pending" && styles.stopCardDone]}>
                <View style={styles.stopHeader}>
                  <View>
                    <Text style={styles.stopTitle}>
                      #{stop.stopSequence} {stop.customerName}
                      {stop.isMakeGood ? " · Make-good" : ""}
                      {isSuspended ? " · Suspended" : ""}
                    </Text>
                    <Text style={styles.stopAddress}>{stop.address}</Text>
                  </View>
                  <Text
                    style={[
                      styles.statusPill,
                      effectiveStatus === "skipped" && styles.warningPill,
                      isSuspended && styles.warningPill,
                      pendingAction && styles.queuePill
                    ]}
                  >
                    {pendingAction
                      ? `queued ${pendingAction.status}`
                      : isSuspended && effectiveStatus === "pending"
                        ? "suspended"
                        : effectiveStatus.replace("_", " ")}
                  </Text>
                </View>

                {pendingAction ? (
                  <Text style={styles.queueNotice}>
                    Pending offline sync from {new Date(pendingAction.queuedAt).toLocaleTimeString()}
                    {pendingAction.errorMessage ? `: ${pendingAction.errorMessage}` : "."}
                  </Text>
                ) : null}
                {isSuspended ? (
                  <Text style={styles.warningText}>
                    Service suspended — do not collect. Use Skip with a reason (e.g. suspended / unpaid).
                  </Text>
                ) : null}
                {pendingAction?.skipReason || stop.skipReason ? (
                  <View style={styles.fieldSkipReason}>
                    <Text style={styles.fieldLabel}>Skip reason</Text>
                    <Text style={styles.fieldValue}>{pendingAction?.skipReason ?? stop.skipReason}</Text>
                  </View>
                ) : null}
                {pendingAction?.note || stop.notes ? (
                  <View style={styles.fieldNote}>
                    <Text style={styles.fieldLabel}>Note</Text>
                    <Text style={styles.fieldValue}>{pendingAction?.note ?? stop.notes}</Text>
                  </View>
                ) : null}

                <TextInput
                  editable={!actionDisabled}
                  onChangeText={(value) => setNotes((current) => ({ ...current, [stop.id]: value }))}
                  placeholder="Optional stop note"
                  placeholderTextColor="#829086"
                  style={[styles.input, actionDisabled && styles.disabledInput]}
                  value={notes[stop.id] ?? ""}
                />

                <View style={styles.actionRow}>
                  <Pressable
                    disabled={completeDisabled}
                    onPress={() => handleStopAction(stop, "completed")}
                    style={[styles.primaryButton, completeDisabled && styles.disabledButton]}
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
                    <Text style={styles.secondaryButtonText}>
                      {skipReasonOpen[stop.id] && !pendingAction ? "Confirm skip" : "Skip"}
                    </Text>
                  </Pressable>
                </View>

                {skipReasonOpen[stop.id] && effectiveStatus === "pending" && !pendingAction ? (
                  <View style={styles.skipReasonPanel}>
                    <Text style={styles.fieldLabel}>Skip reason</Text>
                    <TextInput
                      autoFocus
                      editable={!actionDisabled}
                      onChangeText={(value) => setSkipReasons((current) => ({ ...current, [stop.id]: value }))}
                      placeholder="Why was this stop skipped?"
                      placeholderTextColor="#829086"
                      style={[styles.input, styles.skipReasonInput, actionDisabled && styles.disabledInput]}
                      value={skipReasons[stop.id] ?? ""}
                    />
                    <Pressable
                      disabled={actionDisabled}
                      onPress={() => {
                        setSkipReasonOpen((current) => ({ ...current, [stop.id]: false }));
                        setSkipReasons((current) => {
                          const next = { ...current };
                          delete next[stop.id];
                          return next;
                        });
                      }}
                      style={styles.skipCancelButton}
                    >
                      <Text style={styles.skipCancelButtonText}>Cancel skip</Text>
                    </Pressable>
                  </View>
                ) : null}
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
                      <View style={styles.incidentNote}>
                        <Text style={styles.fieldLabel}>Incident</Text>
                        <Text style={styles.fieldValue}>{item.title}</Text>
                        {item.description ? <Text style={styles.incidentDescription}>{item.description}</Text> : null}
                      </View>
                      {item.errorMessage ? <Text style={styles.queueError}>{item.errorMessage}</Text> : null}
                    </View>
                  ))}
                </>
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
        <DriverTabBar activeTab={activeTab} onChange={setActiveTab} />
    </View>
  );
}

function ShiftJobCard({ job }: { job: DriverShiftJob }) {
  const toneStyle =
    job.jobType === "cover_released"
      ? styles.shiftJobCardReleased
      : job.jobType === "cover_completed" || job.jobType === "reassignment_completed"
        ? styles.shiftJobCardCover
        : styles.shiftJobCardDone;

  return (
    <View style={[styles.shiftJobCard, toneStyle]}>
      <Text style={styles.cardTitle}>{job.headline}</Text>
      <Text style={styles.cardCopy}>{job.detail}</Text>
      <Text style={styles.summaryCopy}>
        {job.truckRegistration} · {job.completedStops}/{job.totalStops} stops ·{" "}
        {job.status.replace(/_/g, " ")}
        {job.completedAt ? ` · Done ${new Date(job.completedAt).toLocaleTimeString()}` : ""}
      </Text>
    </View>
  );
}

function HandoffCard({
  handoff,
  busy,
  onAccept,
  onDecline
}: {
  handoff: RouteTruckHandoff;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const kind = handoff.changeKind ?? "both";
  const title =
    kind === "driver" ? "Driver cover request" : kind === "truck" ? "Truck handoff" : "Route reassignment";

  const body =
    kind === "driver"
      ? `Take over from ${handoff.fromDriverName ?? "the current driver"} on ${handoff.routeZoneName} with ${handoff.toTruckRegistration}. ${handoff.pendingStops} stop(s) left. Reason: ${handoff.reason.replace(/_/g, " ")}.`
      : kind === "truck"
        ? `Truck changes ${handoff.fromTruckRegistration ?? "current"} → ${handoff.toTruckRegistration} on ${handoff.routeZoneName}. You remain the driver. ${handoff.pendingStops} stop(s) left.`
        : handoff.requiresOutgoingConfirmation
          ? `${handoff.fromTruckRegistration ?? "Current truck"} → ${handoff.toTruckRegistration} on ${handoff.routeZoneName}. ${handoff.pendingStops} stop(s) left. Incoming ${handoff.incomingConfirmed ? "confirmed" : "pending"}; outgoing ${handoff.outgoingConfirmed ? "confirmed" : "pending"}.`
          : `Operator assigned ${handoff.toTruckRegistration} / ${handoff.toDriverName} to ${handoff.routeZoneName} (${handoff.pendingStops} stop(s) left). Reason: ${handoff.reason.replace(/_/g, " ")}.`;

  return (
    <View style={styles.handoffCard}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardCopy}>{body}</Text>
      <Text style={styles.summaryCopy}>Expires {new Date(handoff.expiresAt).toLocaleTimeString()}</Text>
      <View style={styles.actionRow}>
        <Pressable
          disabled={busy}
          onPress={onAccept}
          style={[styles.primaryButton, busy && styles.disabledButton]}
        >
          <Text style={styles.primaryButtonText}>{busy ? "Saving..." : "Confirm"}</Text>
        </Pressable>
        <Pressable
          disabled={busy}
          onPress={onDecline}
          style={[styles.secondaryButton, busy && styles.disabledButton]}
        >
          <Text style={styles.secondaryButtonText}>Decline</Text>
        </Pressable>
      </View>
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
    padding: 20,
    paddingBottom: 28,
    paddingTop: 12
  },
  todayHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    marginBottom: 4
  },
  todayHeaderCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0
  },
  gearButton: {
    alignItems: "center",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40
  },
  gearGlyph: {
    color: colors.muted,
    fontSize: 18
  },
  handoffCard: {
    backgroundColor: "#fff8e8",
    borderColor: "#f0d48a",
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    marginBottom: 16,
    padding: 16
  },
  wrapUpCard: {
    backgroundColor: "#e8f7ee",
    borderColor: "#9fd4b0",
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    marginBottom: 16,
    marginTop: 8,
    padding: 16
  },
  shiftJobCard: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    marginBottom: 16,
    padding: 16
  },
  shiftJobCardCover: {
    backgroundColor: "#e8f7ee",
    borderColor: "#9fd4b0"
  },
  shiftJobCardDone: {
    backgroundColor: "#eef3f8",
    borderColor: "#c5d4e4"
  },
  shiftJobCardReleased: {
    backgroundColor: "#f7f1e8",
    borderColor: "#e0c9a8"
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase"
  },
  heading: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.8
  },
  copy: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: 6
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
  emptyRouteCard: {
    backgroundColor: "#ffffff",
    borderColor: "#dbe7dd",
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 16,
    padding: 16
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
  skipReasonPanel: {
    backgroundColor: "#fff8ef",
    borderColor: "#f0d2a8",
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
    marginTop: 12,
    padding: 12
  },
  skipReasonInput: {
    marginTop: 0
  },
  skipCancelButton: {
    alignSelf: "flex-start",
    paddingVertical: 4
  },
  skipCancelButtonText: {
    color: "#8a5a2b",
    fontSize: 13,
    fontWeight: "700"
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 14,
    elevation: 3,
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: colors.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10
  },
  primaryButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: "800"
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.accentSoft,
    borderRadius: 14,
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14
  },
  secondaryButtonText: {
    color: colors.accent,
    fontSize: 16,
    fontWeight: "800"
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
  fieldNote: {
    backgroundColor: "#fff8e8",
    borderColor: "#f0d48a",
    borderLeftColor: "#c9850a",
    borderLeftWidth: 4,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 10,
    padding: 10
  },
  fieldSkipReason: {
    backgroundColor: "#fdeeed",
    borderColor: "#f0c4c0",
    borderLeftColor: "#c45c4c",
    borderLeftWidth: 4,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 10,
    padding: 10
  },
  incidentNote: {
    backgroundColor: "#eef4fb",
    borderColor: "#c5d9f0",
    borderLeftColor: "#1d4f7c",
    borderLeftWidth: 4,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
    padding: 10
  },
  fieldLabel: {
    color: "#637466",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    marginBottom: 4,
    textTransform: "uppercase"
  },
  fieldValue: {
    color: "#102017",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 22
  },
  incidentDescription: {
    color: "#1d3550",
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 21,
    marginTop: 6
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
