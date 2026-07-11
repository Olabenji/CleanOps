import type {
  AdminMasterData,
  AttendanceOverride,
  CustomerLedgerItem,
  CustomerOnboardingInput,
  CustomerUpdateInput,
  IncidentReport,
  MonthlyStaffSummary,
  OperatorDashboard,
  OperatorProfile,
  PaymentChannel,
  PaymentEntry,
  PaymentLedgerItem,
  ProposeRouteTruckHandoffInput,
  RouteDetail,
  RoutePlanningOptions,
  RouteCoverSummary,
  RouteStatus,
  RouteStopStatus,
  RouteTruckHandoff,
  StaffOnboardingInput,
  StaffOnboardingResult,
  StaffLoginProvisionInput,
  StaffAttendanceRow,
  StaffUpdateInput,
  TruckOnboardingInput,
  TruckUpdateInput
} from "@cleanops/shared";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  LogOut,
  RefreshCw,
  Route,
  Truck,
  Users,
  WalletCards,
  Wrench
} from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import AdminView from "./components/AdminView";
import AgentCollectionsView from "./components/AgentCollectionsView";
import OperatorSidebar from "./components/OperatorSidebar";
import PasswordRecoveryScreen from "./components/PasswordRecoveryScreen";
import ProfileModal from "./components/ProfileModal";
import TemplateSavePrompt, { TemplatePendingBanner } from "./components/TemplateSavePrompt";
import TruckHandoffPanel from "./components/TruckHandoffPanel";
import WorkspaceHeader from "./components/WorkspaceHeader";
import {
  getCurrentOperatorProfile,
  getPasswordRecoveryContext,
  signInOperator,
  signOutOperator,
  subscribeToPasswordRecovery,
  type AuthState
} from "./data/authService";
import { getOperatorDashboard } from "./data/dashboardService";
import { updateOwnProfile } from "./data/profileService";
import {
  addRoutePlanStop,
  cancelRouteTruckHandoff,
  ensureDailyRoutesLoaded,
  getAdminMasterData,
  getCustomerLedger,
  getCustomerPaymentHistory,
  getMonthlyStaffSummary,
  getPaymentLedger,
  getRouteTruckHandoffs,
  getRouteCoverSummaries,
  planDailyRoutes,
  getRecentIncidentReports,
  getRoutePlanningOptions,
  getRoutes,
  getStaffAttendance,
  moveRoutePlanStop,
  onboardCustomer,
  onboardStaffMember,
  proposeRouteTruckHandoff,
  provisionStaffMemberLogin,
  requestStaffPasswordReset,
  onboardTruck,
  recordAttendanceOverride,
  recordPayment,
  removeRoutePlanStop,
  saveRouteAsTemplate,
  setCustomerServiceStatus,
  setStaffActive,
  setTruckActive,
  transitionRouteStatus,
  updateCustomer,
  updateRoutePlanAssignment,
  updateCustomerAccountStatus,
  updateRouteStopStatus,
  updateStaffMember,
  updateTruck
} from "./data/operatorWorkflowService";
import { demoCredentials } from "./data/pilotWorkflows";
import { formatAppError, parseAmountNairaToKobo } from "./lib/errors";
import { deriveRouteProgress } from "./lib/routeProgress";

const metricIcons = [Truck, WalletCards, Users, AlertTriangle];
type View = "dashboard" | "routes" | "payments" | "staff" | "admin";

const workspaceTitles: Record<View, string> = {
  dashboard: "Operations overview",
  routes: "Route operations",
  payments: "Payments & ledger",
  staff: "Staff attendance",
  admin: "Admin master data"
};
type RouteInlineError = {
  area: "assignment" | "addStop" | "stopCorrection" | "routeAction";
  message: string;
} | null;

const currencyFormatter = new Intl.NumberFormat("en-NG", {
  currency: "NGN",
  maximumFractionDigits: 0,
  style: "currency"
});

const channelLabels: Record<PaymentChannel, string> = {
  agent_cash: "Agent cash",
  bank_transfer: "Bank transfer",
  moniepoint: "Moniepoint",
  opay: "Opay",
  palmpay: "PalmPay",
  paystack: "Paystack"
};

const operatorPaymentChannels: PaymentChannel[] = [
  "agent_cash",
  "bank_transfer",
  "opay",
  "palmpay",
  "moniepoint",
  "paystack"
];

const todayIso = new Date().toISOString().slice(0, 10);
const LIVE_POLL_MS = 45_000;
const PAYMENTS_POLL_MS = 20_000;

const emptyPlanningOptions: RoutePlanningOptions = {
  zones: [],
  trucks: [],
  drivers: [],
  customers: []
};

const emptyAdminData: AdminMasterData = {
  zones: [],
  staff: [],
  trucks: [],
  customers: []
};

function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function formatWorkspaceDateLabel(operationDate: string, todayIso: string) {
  const formatted = new Date(`${operationDate}T12:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });

  return operationDate === todayIso ? `Today · ${formatted}` : formatted;
}

function formatKobo(amountKobo: number) {
  return currencyFormatter.format(amountKobo / 100);
}

export function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [dashboard, setDashboard] = useState<OperatorDashboard | null>(null);
  const [routes, setRoutes] = useState<RouteDetail[]>([]);
  const [routeHandoffs, setRouteHandoffs] = useState<RouteTruckHandoff[]>([]);
  const [routeCovers, setRouteCovers] = useState<RouteCoverSummary[]>([]);
  const [payments, setPayments] = useState<PaymentLedgerItem[]>([]);
  const [incidents, setIncidents] = useState<IncidentReport[]>([]);
  const [customerLedger, setCustomerLedger] = useState<CustomerLedgerItem[]>([]);
  const [adminData, setAdminData] = useState<AdminMasterData>(emptyAdminData);
  const [planningOptions, setPlanningOptions] = useState<RoutePlanningOptions>(emptyPlanningOptions);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [staffAttendance, setStaffAttendance] = useState<StaffAttendanceRow[]>([]);
  const [monthlyStaffSummary, setMonthlyStaffSummary] = useState<MonthlyStaffSummary[]>([]);
  const [operationDate, setOperationDate] = useState(todayIso);
  const [attendanceDate, setAttendanceDate] = useState(todayIso);
  const [summaryMonth, setSummaryMonth] = useState(todayIso);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<View>("dashboard");
  const [routeInlineError, setRouteInlineError] = useState<RouteInlineError>(null);
  const [templatePendingRouteIds, setTemplatePendingRouteIds] = useState<string[]>([]);
  const [templateTempName, setTemplateTempName] = useState("");
  const [templateSaveBusy, setTemplateSaveBusy] = useState(false);
  const [templateLeavePrompt, setTemplateLeavePrompt] = useState<null | {
    reason: "signout" | "navigate" | "date";
    nextView?: View;
    nextDate?: string;
  }>(null);
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    return subscribeToPasswordRecovery((email) => {
      setRecoveryEmail(email);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    void getPasswordRecoveryContext().then((email) => {
      if (email) {
        setRecoveryEmail(email);
        setLoading(false);
      }
    });
  }, []);

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!auth || operationDate !== todayIso) {
      return;
    }

    if (activeView !== "dashboard" && activeView !== "routes") {
      return;
    }

    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function refreshLiveOperations() {
      try {
        const [dashboardData, routesData, incidentData] = await Promise.all([
          getOperatorDashboard(operationDate),
          getRoutes(operationDate),
          getRecentIncidentReports(operationDate)
        ]);
        setDashboard(dashboardData);
        setRoutes(routesData);
        setIncidents(incidentData);
        setSelectedRouteId((current) =>
          routesData.some((route) => route.id === current) ? current : routesData[0]?.id ?? null
        );
      } catch {
        // Keep the last good snapshot during background refresh failures.
      }
    }

    function startPolling() {
      if (document.visibilityState === "hidden") {
        return;
      }

      intervalId = setInterval(() => {
        void refreshLiveOperations();
      }, LIVE_POLL_MS);
    }

    function handleVisibilityChange() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }

      if (document.visibilityState === "visible") {
        void refreshLiveOperations();
        startPolling();
      }
    }

    void refreshLiveOperations();
    startPolling();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [auth, activeView, operationDate, todayIso]);

  useEffect(() => {
    if (!auth || activeView !== "payments") {
      return;
    }

    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function refreshPaymentsLedger() {
      try {
        const [paymentData, ledgerData, dashboardData] = await Promise.all([
          getPaymentLedger(),
          getCustomerLedger(),
          getOperatorDashboard(operationDate)
        ]);
        setPayments(paymentData);
        setCustomerLedger(ledgerData);
        setDashboard(dashboardData);
      } catch {
        // Keep the last good ledger snapshot during background refresh failures.
      }
    }

    function startPolling() {
      if (document.visibilityState === "hidden") {
        return;
      }

      intervalId = setInterval(() => {
        void refreshPaymentsLedger();
      }, PAYMENTS_POLL_MS);
    }

    function handleVisibilityChange() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }

      if (document.visibilityState === "visible") {
        void refreshPaymentsLedger();
        startPolling();
      }
    }

    void refreshPaymentsLedger();
    startPolling();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [auth, activeView, operationDate]);

  async function bootstrap() {
    setLoading(true);
    setError(null);

    try {
      const recovery = await getPasswordRecoveryContext();
      if (recovery) {
        setRecoveryEmail(recovery);
        return;
      }

      const currentAuth = await getCurrentOperatorProfile();

      if (currentAuth) {
        setAuth(currentAuth);
        await loadWorkspace(operationDate);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load operator profile");
    } finally {
      setLoading(false);
    }
  }

  function handleRecoveryComplete() {
    setRecoveryEmail(null);
    setAuth(null);
    setError(null);
    setStatusMessage("Password updated. Sign in with your new password.");
  }

  async function loadWorkspace(targetDate = operationDate) {
    let routesData = await getRoutes(targetDate);

    // Auto-load zone templates at start of day when nothing is planned yet.
    if (targetDate === todayIso && routesData.length === 0) {
      try {
        const ensured = await ensureDailyRoutesLoaded(targetDate);
        if (ensured.plannedCount > 0) {
          routesData = await getRoutes(targetDate);
          setStatusMessage(
            `Auto-loaded ${ensured.plannedCount} zone route template${ensured.plannedCount === 1 ? "" : "s"} for today.`
          );
        }
      } catch (autoLoadError) {
        console.warn("Daily template auto-load skipped:", autoLoadError);
      }
    }

    const [
      dashboardData,
      handoffData,
      coverData,
      paymentData,
      ledgerData,
      staffData,
      monthlyStaffData,
      incidentData,
      routePlanningOptions,
      nextAdminData
    ] = await Promise.all([
      getOperatorDashboard(targetDate),
      getRouteTruckHandoffs(targetDate),
      getRouteCoverSummaries(targetDate),
      getPaymentLedger(),
      getCustomerLedger(),
      getStaffAttendance(targetDate),
      getMonthlyStaffSummary(summaryMonth),
      getRecentIncidentReports(targetDate),
      getRoutePlanningOptions(),
      getAdminMasterData()
    ]);

    setDashboard(dashboardData);
    setRoutes(routesData);
    setRouteHandoffs(handoffData);
    setRouteCovers(coverData);
    setPayments(paymentData);
    setCustomerLedger(ledgerData);
    setAdminData(nextAdminData);
    setPlanningOptions(routePlanningOptions);
    setStaffAttendance(staffData);
    setMonthlyStaffSummary(monthlyStaffData);
    setIncidents(incidentData);
    setSelectedRouteId((current) => (routesData.some((route) => route.id === current) ? current : routesData[0]?.id ?? null));
    setSelectedCustomerId((current) => current ?? ledgerData[0]?.customerId ?? null);
  }

  function markTemplatePending(routeId: string) {
    setTemplatePendingRouteIds((current) => (current.includes(routeId) ? current : [...current, routeId]));
  }

  function clearTemplatePending() {
    setTemplatePendingRouteIds([]);
    setTemplateTempName("");
    setTemplateLeavePrompt(null);
  }

  async function handleSaveTemplate(kind: "zone_default" | "temporary", andContinue = false) {
    if (templatePendingRouteIds.length === 0) {
      return;
    }

    setTemplateSaveBusy(true);
    setError(null);

    try {
      const results = [];
      for (const routeId of templatePendingRouteIds) {
        results.push(
          await saveRouteAsTemplate({
            routeId,
            kind,
            name: kind === "temporary" ? templateTempName || undefined : undefined
          })
        );
      }

      const leave = templateLeavePrompt;
      clearTemplatePending();
      setStatusMessage(
        kind === "zone_default"
          ? `Saved ${results.length} zone default template${results.length === 1 ? "" : "s"}.`
          : `Saved ${results.length} temporary template${results.length === 1 ? "" : "s"}.`
      );

      if (andContinue && leave) {
        await completeLeaveAction(leave);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save route template");
    } finally {
      setTemplateSaveBusy(false);
    }
  }

  async function completeLeaveAction(leave: {
    reason: "signout" | "navigate" | "date";
    nextView?: View;
    nextDate?: string;
  }) {
    if (leave.reason === "signout") {
      await performSignOut();
      return;
    }

    if (leave.reason === "navigate" && leave.nextView) {
      setActiveView(leave.nextView);
      return;
    }

    if (leave.reason === "date" && leave.nextDate) {
      await applyOperationDateChange(leave.nextDate);
    }
  }

  async function handleDiscardTemplatePending(andContinue = false) {
    const leave = templateLeavePrompt;
    clearTemplatePending();
    setStatusMessage("Discarded pending template updates. Day route plans are unchanged.");

    if (andContinue && leave) {
      await completeLeaveAction(leave);
    }
  }

  function requestViewChange(nextView: View) {
    if (nextView === activeView) {
      return;
    }

    if (templatePendingRouteIds.length > 0) {
      setTemplateLeavePrompt({ reason: "navigate", nextView });
      return;
    }

    setActiveView(nextView);
  }

  async function handleSignOut() {
    if (templatePendingRouteIds.length > 0) {
      setTemplateLeavePrompt({ reason: "signout" });
      return;
    }

    await performSignOut();
  }

  async function performSignOut() {
    await signOutOperator();
    setAuth(null);
    setDashboard(null);
    setRoutes([]);
    setPayments([]);
    setIncidents([]);
    setCustomerLedger([]);
    setAdminData(emptyAdminData);
    setPlanningOptions(emptyPlanningOptions);
    setSelectedCustomerId(null);
    setStaffAttendance([]);
    setMonthlyStaffSummary([]);
    setSelectedRouteId(null);
    clearTemplatePending();
  }

  async function applyOperationDateChange(nextDate: string) {
    setOperationDate(nextDate);
    setAttendanceDate(nextDate);
    setError(null);
    setRouteInlineError(null);

    try {
      await loadWorkspace(nextDate);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load selected operations date");
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    setError(null);
    setRouteInlineError(null);

    try {
      await loadWorkspace(operationDate);
      setStatusMessage(`Refreshed at ${new Date().toLocaleTimeString()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to refresh workspace");
    } finally {
      setRefreshing(false);
    }
  }

  async function handleDemoSignIn() {
    setLoading(true);
    setError(null);

    try {
      const signedIn = await signInOperator();
      setAuth(signedIn);
      await loadWorkspace(operationDate);
      setStatusMessage(`Signed in as ${signedIn.profile.fullName}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in");
    } finally {
      setLoading(false);
    }
  }

  async function handleStopStatus(
    routeId: string,
    stopId: string,
    status: RouteStopStatus,
    notes?: string,
    skipReason?: string
  ) {
    setStatusMessage(null);
    setError(null);
    setRouteInlineError(null);

    const route = routes.find((routeItem) => routeItem.id === routeId);
    const stop = route?.stops.find((routeStop) => routeStop.id === stopId);

    if (route?.status === "completed" || route?.status === "cancelled") {
      setRouteInlineError({
        area: "stopCorrection",
        message: "Stops cannot be corrected once a route is completed or cancelled."
      });
      return;
    }

    if (stop?.status === "completed" && status === "pending") {
      const confirmed = window.confirm(
        `Reopen ${stop.customerName}? This should only be used to correct a mistaken field update.`
      );

      if (!confirmed) {
        return;
      }
    }

    try {
      const nextRoutes = await updateRouteStopStatus(routeId, stopId, status, notes, skipReason, operationDate);
      setRoutes(nextRoutes.map(deriveRouteProgress));
      await getOperatorDashboard(operationDate).then(setDashboard);
      setStatusMessage("Stop status updated.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to update stop status";
      setRouteInlineError({
        area: "stopCorrection",
        message:
          message === "Route stop not found"
            ? "This stop is not in the database for the selected date. Use “Plan selected date from templates” on the left, then try again."
            : message
      });
    }
  }

  async function handleRouteStatus(routeId: string, status: RouteStatus) {
    setStatusMessage(null);
    setError(null);
    setRouteInlineError(null);

    if (status !== "cancelled") {
      setRouteInlineError({
        area: "routeAction",
        message: "Operators can only cancel route-level status from this view. Start and complete are field actions."
      });
      return;
    }

    if (!window.confirm("Cancel this route? Field workers will no longer be able to progress this route normally.")) {
      return;
    }

    try {
      const nextRoutes = await transitionRouteStatus(routeId, status, operationDate);
      setRoutes(nextRoutes);
      await getOperatorDashboard(operationDate).then(setDashboard);
      setStatusMessage(`Route marked ${status.replace("_", " ")}.`);
    } catch (err) {
      setRouteInlineError({
        area: "routeAction",
        message: err instanceof Error ? err.message : "Unable to update route status"
      });
    }
  }

  async function handleRecordPayment(entry: PaymentEntry) {
    setStatusMessage(null);
    setError(null);

    const nextLedger = await recordPayment(entry);
    const [nextPayments, nextDashboard] = await Promise.all([getPaymentLedger(), getOperatorDashboard(operationDate)]);
    setCustomerLedger(nextLedger);
    setPayments(nextPayments);
    setDashboard(nextDashboard);
    setSelectedCustomerId(entry.customerId);
    setStatusMessage("Payment recorded.");
  }

  async function handleCustomerStatus(
    customerId: string,
    status: CustomerLedgerItem["serviceStatus"],
    tagMonth?: string,
    suspensionReason?: string
  ) {
    setStatusMessage(null);
    const nextLedger = await updateCustomerAccountStatus(customerId, status, tagMonth, suspensionReason);
    setCustomerLedger(nextLedger);
    setSelectedCustomerId(customerId);
    setStatusMessage(`Customer marked ${status}.`);
  }

  async function handleAttendanceDateChange(nextDate: string) {
    setAttendanceDate(nextDate);
    setError(null);

    try {
      setStaffAttendance(await getStaffAttendance(nextDate));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load attendance");
    }
  }

  async function handleSummaryMonthChange(nextMonth: string) {
    setSummaryMonth(nextMonth);
    setError(null);

    try {
      setMonthlyStaffSummary(await getMonthlyStaffSummary(nextMonth));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load monthly summary");
    }
  }

  async function handleAttendanceOverride(override: AttendanceOverride) {
    setStatusMessage(null);
    setError(null);

    try {
      const nextAttendance = await recordAttendanceOverride(override);
      const nextSummary = await getMonthlyStaffSummary(summaryMonth);
      const nextDashboard = await getOperatorDashboard(operationDate);
      setStaffAttendance(nextAttendance);
      setMonthlyStaffSummary(nextSummary);
      setDashboard(nextDashboard);
      setStatusMessage("Attendance override recorded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to record attendance override");
    }
  }

  async function handleOperationDateChange(nextDate: string) {
    if (nextDate === operationDate) {
      return;
    }

    if (templatePendingRouteIds.length > 0) {
      setTemplateLeavePrompt({ reason: "date", nextDate });
      return;
    }

    setStatusMessage(null);
    await applyOperationDateChange(nextDate);
  }

  async function handlePlanDailyRoutes() {
    setStatusMessage(null);
    setError(null);
    setRouteInlineError(null);

    try {
      const plannedCount = await planDailyRoutes(operationDate);
      await loadWorkspace(operationDate);
      setStatusMessage(
        plannedCount > 0
          ? `${plannedCount} route plan${plannedCount === 1 ? "" : "s"} created for ${operationDate}.`
          : `No new route plans were needed for ${operationDate}.`
      );
    } catch (err) {
      setRouteInlineError({
        area: "routeAction",
        message: err instanceof Error ? err.message : "Unable to plan routes for selected date"
      });
    }
  }

  async function refreshRoutesForSelectedDate(nextRoutes: RouteDetail[]) {
    setRoutes(nextRoutes);
    setSelectedRouteId((current) =>
      nextRoutes.some((route) => route.id === current) ? current : nextRoutes[0]?.id ?? null
    );
    await getOperatorDashboard(operationDate).then(setDashboard);
  }

  async function handleUpdateRoutePlanAssignment(routeId: string, zoneId: string, truckId: string, driverId: string | null) {
    setStatusMessage(null);
    setError(null);
    setRouteInlineError(null);

    try {
      const nextRoutes = await updateRoutePlanAssignment(routeId, zoneId, truckId, driverId, operationDate);
      await refreshRoutesForSelectedDate(nextRoutes);
      setStatusMessage("Route plan assignment updated.");
      markTemplatePending(routeId);
    } catch (err) {
      setRouteInlineError({
        area: "assignment",
        message: err instanceof Error ? err.message : "Unable to update route plan assignment"
      });
    }
  }

  async function handleProposeTruckHandoff(input: ProposeRouteTruckHandoffInput) {
    setStatusMessage(null);
    setError(null);
    setRouteInlineError(null);
    await proposeRouteTruckHandoff(input);
    const [nextRoutes, nextHandoffs, nextCovers] = await Promise.all([
      getRoutes(operationDate),
      getRouteTruckHandoffs(operationDate),
      getRouteCoverSummaries(operationDate)
    ]);
    await refreshRoutesForSelectedDate(nextRoutes);
    setRouteHandoffs(nextHandoffs);
    setRouteCovers(nextCovers);
    setStatusMessage("Reassignment sent for driver confirmation.");
  }

  async function handleCancelTruckHandoff(handoffId: string) {
    setStatusMessage(null);
    setError(null);
    setRouteInlineError(null);
    await cancelRouteTruckHandoff(handoffId);
    const [nextHandoffs, nextCovers] = await Promise.all([
      getRouteTruckHandoffs(operationDate),
      getRouteCoverSummaries(operationDate)
    ]);
    setRouteHandoffs(nextHandoffs);
    setRouteCovers(nextCovers);
    setStatusMessage("Reassignment cancelled.");
  }

  async function handleAddRoutePlanStop(routeId: string, customerId: string) {
    setStatusMessage(null);
    setError(null);
    setRouteInlineError(null);

    try {
      const nextRoutes = await addRoutePlanStop(routeId, customerId, operationDate);
      await refreshRoutesForSelectedDate(nextRoutes);
      setStatusMessage("Stop added to route plan.");
      markTemplatePending(routeId);
    } catch (err) {
      setRouteInlineError({
        area: "addStop",
        message: err instanceof Error ? err.message : "Unable to add stop to route plan"
      });
    }
  }

  async function handleRemoveRoutePlanStop(stopId: string) {
    if (!window.confirm("Remove this stop from the planned route?")) {
      return;
    }

    setStatusMessage(null);
    setError(null);
    setRouteInlineError(null);

    try {
      const nextRoutes = await removeRoutePlanStop(stopId, operationDate);
      await refreshRoutesForSelectedDate(nextRoutes);
      setStatusMessage("Stop removed from route plan.");
      if (selectedRouteId) {
        markTemplatePending(selectedRouteId);
      }
    } catch (err) {
      setRouteInlineError({
        area: "stopCorrection",
        message: err instanceof Error ? err.message : "Unable to remove stop from route plan"
      });
    }
  }

  async function handleMoveRoutePlanStop(stopId: string, direction: "up" | "down") {
    setStatusMessage(null);
    setError(null);
    setRouteInlineError(null);

    try {
      const nextRoutes = await moveRoutePlanStop(stopId, direction, operationDate);
      await refreshRoutesForSelectedDate(nextRoutes);
      setStatusMessage("Stop order updated.");
      if (selectedRouteId) {
        markTemplatePending(selectedRouteId);
      }
    } catch (err) {
      setRouteInlineError({
        area: "stopCorrection",
        message: err instanceof Error ? err.message : "Unable to reorder route stop"
      });
    }
  }

  async function refreshAdminData() {
    const [nextAdminData, nextPlanningOptions, nextLedger] = await Promise.all([
      getAdminMasterData(),
      getRoutePlanningOptions(),
      getCustomerLedger()
    ]);
    setAdminData(nextAdminData);
    setPlanningOptions(nextPlanningOptions);
    setCustomerLedger(nextLedger);
  }

  async function handleOnboardStaff(input: StaffOnboardingInput): Promise<StaffOnboardingResult> {
    setStatusMessage(null);
    const result = await onboardStaffMember(input);
    await refreshAdminData();
    setStatusMessage(
      result.loginProvisioned
        ? `Staff member onboarded. Login created for ${result.loginEmail}.`
        : "Staff member onboarded."
    );
    return result;
  }

  async function handleProvisionStaffLogin(input: StaffLoginProvisionInput): Promise<StaffOnboardingResult> {
    setStatusMessage(null);
    const result = await provisionStaffMemberLogin(input);
    await refreshAdminData();
    setStatusMessage(`Login created for ${result.loginEmail}.`);
    return result;
  }

  async function handleRequestStaffPasswordReset(staffId: string) {
    setStatusMessage(null);
    const result = await requestStaffPasswordReset(staffId);
    setStatusMessage(`Password reset email sent to ${result.loginEmail}. Check Inbucket locally.`);
    return result;
  }

  async function handleSetStaffActive(staffId: string, active: boolean) {
    setStatusMessage(null);
    await setStaffActive(staffId, active);
    await refreshAdminData();
    setStatusMessage(active ? "Staff member reactivated." : "Staff member deactivated.");
  }

  async function handleUpdateStaff(input: StaffUpdateInput) {
    setStatusMessage(null);
    await updateStaffMember(input);
    await refreshAdminData();
    setStatusMessage("Staff member updated.");
  }

  async function handleOnboardTruck(input: TruckOnboardingInput) {
    setStatusMessage(null);
    await onboardTruck(input);
    await refreshAdminData();
    setStatusMessage("Truck onboarded.");
  }

  async function handleUpdateTruck(input: TruckUpdateInput) {
    setStatusMessage(null);
    await updateTruck(input);
    await refreshAdminData();
    setStatusMessage("Truck updated.");
  }

  async function handleSetTruckActive(truckId: string, active: boolean) {
    setStatusMessage(null);
    await setTruckActive(truckId, active);
    await refreshAdminData();
    setStatusMessage(active ? "Truck reactivated." : "Truck deactivated.");
  }

  async function handleOnboardCustomer(input: CustomerOnboardingInput) {
    setStatusMessage(null);
    await onboardCustomer(input);
    await refreshAdminData();
    setStatusMessage("Customer onboarded.");
  }

  async function handleUpdateCustomer(input: CustomerUpdateInput) {
    setStatusMessage(null);
    await updateCustomer(input);
    await refreshAdminData();
    setStatusMessage("Customer updated.");
  }

  async function handleSetCustomerServiceStatus(
    customerId: string,
    serviceStatus: CustomerLedgerItem["serviceStatus"]
  ) {
    setStatusMessage(null);
    await setCustomerServiceStatus(
      customerId,
      serviceStatus,
      serviceStatus === "suspended" ? "Suspended by operator" : undefined
    );
    await refreshAdminData();
    setStatusMessage(`Customer marked ${serviceStatus}.`);
  }

  async function handleUpdateOwnProfile(input: { fullName: string; phone: string }) {
    setStatusMessage(null);
    const updated = await updateOwnProfile(input);
    setAuth((current) =>
      current
        ? {
            ...current,
            profile: {
              ...current.profile,
              fullName: updated.fullName,
              phone: updated.phone
            }
          }
        : current
    );
    setStatusMessage("Profile updated.");
  }

  if (loading && !recoveryEmail) {
    return <main className="app-shell">Loading CleanOps command centre...</main>;
  }

  if (recoveryEmail) {
    return <PasswordRecoveryScreen email={recoveryEmail} onComplete={handleRecoveryComplete} />;
  }

  if (!auth) {
    return <LoginScreen error={error} onDemoSignIn={handleDemoSignIn} statusMessage={statusMessage} />;
  }

  const selectedRoute = routes.find((routeItem) => routeItem.id === selectedRouteId) ?? routes[0];
  const selectedCustomer =
    customerLedger.find((customer) => customer.customerId === selectedCustomerId) ?? customerLedger[0];
  const pendingTemplateLabels = templatePendingRouteIds
    .map((routeId) => routes.find((route) => route.id === routeId)?.zoneName)
    .filter((label): label is string => Boolean(label));

  return (
    <main className="app-shell app-shell-saas">
      <OperatorSidebar
        activeView={activeView}
        fullName={auth.profile.fullName}
        onOpenProfile={() => setProfileOpen(true)}
        onSelectView={requestViewChange}
        onSignOut={() => void handleSignOut()}
        role={auth.profile.role}
      />

      <div className="workspace-main">
        <WorkspaceHeader
          dateLabel={formatWorkspaceDateLabel(operationDate, todayIso)}
          onDateChange={(nextDate) => void handleOperationDateChange(nextDate)}
          onRefresh={() => void handleRefresh()}
          operationDate={operationDate}
          refreshing={refreshing}
          title={workspaceTitles[activeView]}
        />

      {error ? <p className="notice error">{error}</p> : null}
      {statusMessage ? <p className="notice">{statusMessage}</p> : null}

      <ProfileModal
        initialFullName={auth.profile.fullName}
        initialPhone={auth.profile.phone}
        onClose={() => setProfileOpen(false)}
        onSave={handleUpdateOwnProfile}
        open={profileOpen}
        roleLabel={auth.profile.role.replace("_", " ")}
      />

      <TemplatePendingBanner
        busy={templateSaveBusy}
        labels={pendingTemplateLabels}
        tempName={templateTempName}
        onDiscard={() => void handleDiscardTemplatePending(false)}
        onTempNameChange={setTemplateTempName}
        onSaveTemporary={() => void handleSaveTemplate("temporary", false)}
        onSaveZoneDefault={() => void handleSaveTemplate("zone_default", false)}
      />

      <TemplateSavePrompt
        busy={templateSaveBusy}
        labels={pendingTemplateLabels}
        leaveReason={templateLeavePrompt?.reason ?? "navigate"}
        open={Boolean(templateLeavePrompt)}
        tempName={templateTempName}
        onDiscardAndContinue={() => void handleDiscardTemplatePending(true)}
        onStay={() => setTemplateLeavePrompt(null)}
        onTempNameChange={setTemplateTempName}
        onSaveTemporary={() => void handleSaveTemplate("temporary", true)}
        onSaveZoneDefault={() => void handleSaveTemplate("zone_default", true)}
      />

      {activeView === "dashboard" && dashboard ? (
        <DashboardView
          adminStaff={adminData.staff}
          dashboard={dashboard}
          incidents={incidents}
          onDeactivateStaff={(staffId) => void handleSetStaffActive(staffId, false)}
          onEditStaff={() => requestViewChange("admin")}
          operationDate={operationDate}
          todayIso={todayIso}
        />
      ) : null}
      {activeView === "routes" ? (
        <RoutesView
          routes={routes}
          routeHandoffs={routeHandoffs}
          routeCovers={routeCovers}
          selectedRoute={selectedRoute}
          operationDate={operationDate}
          planningOptions={planningOptions}
          routeInlineError={routeInlineError}
          todayIso={todayIso}
          onAddRouteStop={handleAddRoutePlanStop}
          onCancelTruckHandoff={handleCancelTruckHandoff}
          onMoveRouteStop={handleMoveRoutePlanStop}
          onPlanDailyRoutes={handlePlanDailyRoutes}
          onProposeTruckHandoff={handleProposeTruckHandoff}
          onRemoveRouteStop={handleRemoveRoutePlanStop}
          onSelectRoute={setSelectedRouteId}
          onUpdateRoutePlanAssignment={handleUpdateRoutePlanAssignment}
          onUpdateRouteStatus={handleRouteStatus}
          onUpdateStop={handleStopStatus}
        />
      ) : null}
      {activeView === "payments" ? (
        <PaymentsView
          customerLedger={customerLedger}
          operationDate={operationDate}
          payments={payments}
          selectedCustomer={selectedCustomer}
          onRecordPayment={handleRecordPayment}
          onSelectCustomer={setSelectedCustomerId}
          onUpdateCustomerStatus={handleCustomerStatus}
        />
      ) : null}
      {activeView === "staff" ? (
        <StaffView
          attendanceDate={attendanceDate}
          monthlyStaffSummary={monthlyStaffSummary}
          staffAttendance={staffAttendance}
          summaryMonth={summaryMonth}
          onAttendanceDateChange={handleAttendanceDateChange}
          onRecordOverride={handleAttendanceOverride}
          onSummaryMonthChange={handleSummaryMonthChange}
        />
      ) : null}
      {activeView === "admin" ? (
        <AdminView
          adminData={adminData}
          operatorId={auth.profile.operatorId}
          onOnboardCustomer={handleOnboardCustomer}
          onOnboardStaff={handleOnboardStaff}
          onOnboardTruck={handleOnboardTruck}
          onProvisionStaffLogin={handleProvisionStaffLogin}
          onRequestStaffPasswordReset={handleRequestStaffPasswordReset}
          onSetCustomerServiceStatus={handleSetCustomerServiceStatus}
          onSetStaffActive={handleSetStaffActive}
          onSetTruckActive={handleSetTruckActive}
          onUpdateCustomer={handleUpdateCustomer}
          onUpdateStaff={handleUpdateStaff}
          onUpdateTruck={handleUpdateTruck}
        />
      ) : null}
      </div>
    </main>
  );
}

function LoginScreen({
  error,
  onDemoSignIn,
  statusMessage
}: {
  error: string | null;
  onDemoSignIn: () => void;
  statusMessage?: string | null;
}) {
  return (
    <main className="app-shell login-shell">
      <section className="login-card">
        <p className="eyebrow">CleanOps</p>
        <h1>Operator workspace</h1>
        <p>Sign in to run routes, payments, attendance, and admin for your ward pilot.</p>
        {statusMessage ? <p className="notice">{statusMessage}</p> : null}
        {error ? <p className="notice error">{error}</p> : null}
        <div className="credential-box">
          <span>{demoCredentials.email}</span>
          <span>{demoCredentials.password}</span>
        </div>
        <button className="primary-button" onClick={onDemoSignIn} type="button">
          Sign in as demo operator
        </button>
      </section>
    </main>
  );
}

function DashboardView({
  adminStaff,
  dashboard,
  incidents,
  onDeactivateStaff,
  onEditStaff,
  operationDate,
  todayIso
}: {
  adminStaff: AdminMasterData["staff"];
  dashboard: OperatorDashboard;
  incidents: IncidentReport[];
  onDeactivateStaff: (staffId: string) => void;
  onEditStaff: () => void;
  operationDate: string;
  todayIso: string;
}) {
  const fieldWorkers = adminStaff.filter((staff) => staff.active).slice(0, 8);
  const openIncidents = incidents.filter((incident) => !incident.resolvedAt).length;

  return (
    <>
      <section className="metric-grid" aria-label="Operational metrics">
        {dashboard.metrics.map((metric, index) => {
          const Icon = metricIcons[index] ?? CheckCircle2;
          const isIncidents = metric.label.toLowerCase().includes("incident");

          return (
            <article className={isIncidents && openIncidents > 0 ? "metric-card tone-danger" : "metric-card"} key={metric.label}>
              <Icon aria-hidden="true" size={20} />
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <small>{metric.helper}</small>
            </article>
          );
        })}
      </section>

      <section className="saas-section" aria-label="Collection runs">
        <h2 className="saas-section-title">
          {operationDate === todayIso ? "Today's collection runs" : "Collection runs"}
        </h2>
        <div className="saas-list">
          {dashboard.routes.length === 0 ? (
            <div className="saas-row">
              <div className="saas-row-copy">
                <strong>No routes loaded</strong>
                <span>Plan routes for this date from the Routes tab.</span>
              </div>
            </div>
          ) : (
            dashboard.routes.map((route) => (
              <div className="saas-row" key={route.id}>
                <span className="avatar-chip lg" aria-hidden="true">
                  {initialsFromName(route.driverName)}
                </span>
                <div className="saas-row-copy">
                  <strong>
                    {route.zoneName} · {route.driverName}
                  </strong>
                  <span>
                    {route.completedStops}/{route.totalStops} stops · {route.truckRegistration}
                  </span>
                </div>
                <span className={`status-pill ${route.delayed ? "danger" : route.status}`}>
                  {route.delayed ? "Delayed" : route.status.replace("_", " ")}
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="saas-section" aria-label="Field workers">
        <h2 className="saas-section-title">Field workers</h2>
        <div className="saas-list">
          {fieldWorkers.length === 0 ? (
            <div className="saas-row">
              <div className="saas-row-copy">
                <strong>No active staff</strong>
                <span>Onboard drivers and crew from Admin.</span>
              </div>
            </div>
          ) : (
            fieldWorkers.map((staff) => (
              <div className="saas-row" key={staff.id}>
                <span className="avatar-chip lg" aria-hidden="true">
                  {initialsFromName(staff.fullName)}
                </span>
                <div className="saas-row-copy">
                  <strong>{staff.fullName}</strong>
                  <span>
                    {staff.role.replace("_", " ")} · {formatKobo(staff.monthlySalaryKobo)}
                  </span>
                </div>
                <div className="saas-row-actions">
                  <button className="link-button" onClick={onEditStaff} type="button">
                    Edit
                  </button>
                  <button className="danger-outline" onClick={() => onDeactivateStaff(staff.id)} type="button">
                    Deactivate
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {(dashboard.alerts.length > 0 || incidents.length > 0) && (
        <section className="dashboard-grid" aria-label="Secondary operations">
          {dashboard.alerts.length > 0 ? (
            <article className="panel alert-panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Alerts</p>
                  <h2>Action required</h2>
                </div>
                <AlertTriangle aria-hidden="true" />
              </div>
              <ul>
                {dashboard.alerts.map((alert) => (
                  <li key={alert}>{alert}</li>
                ))}
              </ul>
            </article>
          ) : null}
          <article className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Incidents</p>
                <h2>Recent reports</h2>
              </div>
              <AlertTriangle aria-hidden="true" />
            </div>
            <div className="stack-list">
              {incidents.length === 0 ? (
                <p className="panel-subtitle">No recent incidents.</p>
              ) : (
                incidents.slice(0, 5).map((incident) => (
                  <div className={`incident-row ${incident.resolvedAt ? "" : "incident-row-open"}`} key={incident.id}>
                    <div>
                      <strong>{incident.title}</strong>
                      <span>{incident.routeLabel ?? "Route"} · {incident.reportedBy ?? "Reporter"}</span>
                    </div>
                    <span className={incident.resolvedAt ? "status-pill completed" : "status-pill danger"}>
                      {incident.resolvedAt ? "Resolved" : "Open"}
                    </span>
                  </div>
                ))
              )}
            </div>
          </article>
        </section>
      )}
    </>
  );
}

function RoutesView({
  routes,
  routeHandoffs,
  routeCovers,
  selectedRoute,
  operationDate,
  planningOptions,
  routeInlineError,
  todayIso,
  onAddRouteStop,
  onCancelTruckHandoff,
  onMoveRouteStop,
  onPlanDailyRoutes,
  onProposeTruckHandoff,
  onRemoveRouteStop,
  onSelectRoute,
  onUpdateRoutePlanAssignment,
  onUpdateRouteStatus,
  onUpdateStop
}: {
  routes: RouteDetail[];
  routeHandoffs: RouteTruckHandoff[];
  routeCovers: RouteCoverSummary[];
  selectedRoute?: RouteDetail;
  operationDate: string;
  planningOptions: RoutePlanningOptions;
  routeInlineError: RouteInlineError;
  todayIso: string;
  onAddRouteStop: (routeId: string, customerId: string) => void;
  onCancelTruckHandoff: (handoffId: string) => Promise<void>;
  onMoveRouteStop: (stopId: string, direction: "up" | "down") => void;
  onPlanDailyRoutes: () => void;
  onProposeTruckHandoff: (input: ProposeRouteTruckHandoffInput) => Promise<void>;
  onRemoveRouteStop: (stopId: string) => void;
  onSelectRoute: (routeId: string) => void;
  onUpdateRoutePlanAssignment: (routeId: string, zoneId: string, truckId: string, driverId: string | null) => void;
  onUpdateRouteStatus: (routeId: string, status: RouteStatus) => void;
  onUpdateStop: (
    routeId: string,
    stopId: string,
    status: RouteStopStatus,
    notes?: string,
    skipReason?: string
  ) => void;
}) {
  const [skipReasons, setSkipReasons] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [selectedCustomerToAdd, setSelectedCustomerToAdd] = useState("");
  const pendingStops = selectedRoute?.stops.filter((stop) => stop.status === "pending").length ?? 0;
  const resolvedStops = selectedRoute ? selectedRoute.stops.length - pendingStops : 0;
  const routeFinalized = selectedRoute?.status === "completed" || selectedRoute?.status === "cancelled";
  const routePlanEditable = selectedRoute?.status === "scheduled" && !selectedRoute.startedAt && !selectedRoute.completedAt;
  const customersAlreadyPlanned = new Set(selectedRoute?.stops.map((stop) => stop.customerId).filter(Boolean));
  const availableCustomers = planningOptions.customers.filter(
    (customer) => customer.zoneId === selectedRoute?.zoneId && !customersAlreadyPlanned.has(customer.id)
  );
  // Floating fleet: any active truck can be assigned; soft-sort home-zone matches first.
  const availableTrucks = [...planningOptions.trucks].sort((a, b) => {
    const aHome = a.zoneId === selectedRoute?.zoneId ? 0 : 1;
    const bHome = b.zoneId === selectedRoute?.zoneId ? 0 : 1;
    if (aHome !== bHome) {
      return aHome - bHome;
    }
    return a.label.localeCompare(b.label);
  });
  const selectedCover = routeCovers.find((cover) => cover.routeId === selectedRoute?.id);

  return (
    <section className="workflow-grid routes-workflow">
      <article className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Routes</p>
            <h2>{operationDate === todayIso ? "Today's Runs" : "Selected Date Runs"}</h2>
          </div>
          <Route aria-hidden="true" />
        </div>
        <div className="planning-card">
          <strong>{operationDate}</strong>
          <span>
            {routes.length > 0
              ? `${routes.length} route plan${routes.length === 1 ? "" : "s"} loaded.`
              : "No routes planned for this date yet."}
          </span>
          <button className="primary-button" onClick={onPlanDailyRoutes} type="button">
            Plan selected date from zone templates
          </button>
        </div>
        {routeCovers.length > 0 ? (
          <div className="cover-board">
            <strong>Confirmed covers / reassignments</strong>
            {routeCovers.slice(0, 6).map((cover) => (
              <button
                className="cover-board-item"
                key={cover.handoffId}
                onClick={() => onSelectRoute(cover.routeId)}
                type="button"
              >
                <span>{cover.headline}</span>
                <small>
                  {cover.routeStatus.replace("_", " ")}
                  {cover.confirmedAt ? ` · ${new Date(cover.confirmedAt).toLocaleTimeString()}` : ""}
                </small>
              </button>
            ))}
          </div>
        ) : null}
        <div className="stack-list">
          {routes.length === 0 ? (
            <p className="panel-subtitle">
              No routes exist in Supabase for this date. Use the planning button above to create route plans from recent
              templates, or choose a date that already has routes.
            </p>
          ) : (
            routes.map((routeItem) => (
              <button
                className={`route-selector ${selectedRoute?.id === routeItem.id ? "active" : ""}`}
                key={routeItem.id}
                onClick={() => onSelectRoute(routeItem.id)}
                type="button"
              >
                <strong>{routeItem.zoneName}</strong>
                <span>
                  {routeItem.truckRegistration} · {routeItem.completedStops}/{routeItem.totalStops} stops ·{" "}
                  {routeItem.status.replace("_", " ")}
                </span>
                {!routeItem.truckId ? <span className="pill danger">Needs truck</span> : null}
                {routeCovers.some((cover) => cover.routeId === routeItem.id && cover.changeKind === "driver") ? (
                  <span className="pill">Driver cover</span>
                ) : null}
                {routeCovers.some(
                  (cover) => cover.routeId === routeItem.id && cover.changeKind !== "driver"
                ) ? (
                  <span className="pill">Reassigned</span>
                ) : null}
                {routeHandoffs.some(
                  (handoff) => handoff.routeId === routeItem.id && handoff.status === "awaiting_confirmation"
                ) ? (
                  <span className="pill">Handoff pending</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </article>

      <article className="panel route-detail-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Route Detail</p>
            <h2>{selectedRoute?.zoneName ?? "No route selected"}</h2>
            {selectedRoute ? (
              <p className="panel-subtitle">
                {selectedRoute.truckRegistration} · {selectedRoute.driverName} ·{" "}
                {selectedRoute.status.replace("_", " ")}
              </p>
            ) : null}
            {selectedCover ? (
              <p className="cover-detail-note">{selectedCover.headline}</p>
            ) : null}
          </div>
          <Truck aria-hidden="true" />
        </div>

        {selectedRoute ? (
          <>
            <div className={`route-operations route-operations--${selectedRoute.status}`}>
              <div>
                <span>Route status</span>
                <strong className={`route-status-pill route-status-pill--${selectedRoute.status}`}>
                  {selectedRoute.status.replace("_", " ")}
                </strong>
              </div>
              <div>
                <span>Started</span>
                <strong>
                  {selectedRoute.startedAt
                    ? new Date(selectedRoute.startedAt).toLocaleTimeString()
                    : selectedRoute.status === "completed"
                      ? "At completion"
                      : selectedRoute.status === "in_progress"
                        ? "In progress"
                        : "Not started"}
                </strong>
              </div>
              <div>
                <span>Completed</span>
                <strong>
                  {selectedRoute.completedAt
                    ? new Date(selectedRoute.completedAt).toLocaleTimeString()
                    : pendingStops === 0 && selectedRoute.stops.length > 0
                      ? "All stops resolved"
                      : "Open"}
                </strong>
              </div>
              <div>
                <span>Stops resolved</span>
                <strong>
                  {resolvedStops}/{selectedRoute.stops.length}
                </strong>
              </div>
              <div>
                <span>Pending stops</span>
                <strong>{pendingStops}</strong>
              </div>
              <div className="button-row">
                {selectedRoute.status !== "completed" && selectedRoute.status !== "cancelled" ? (
                  <button onClick={() => onUpdateRouteStatus(selectedRoute.id, "cancelled")} type="button">
                    Cancel route
                  </button>
                ) : (
                  <small>No route-level operator actions available.</small>
                )}
              </div>
              {routeInlineError?.area === "routeAction" ? (
                <p className="inline-error">{routeInlineError.message}</p>
              ) : null}
            </div>
            <p className="panel-subtitle">
              Route start and completion are field actions. Operators can cancel a route, reassign trucks with driver
              confirmation, or correct individual stops when driver updates fail to transmit.
            </p>

            <TruckHandoffPanel
              handoffs={routeHandoffs}
              planningOptions={planningOptions}
              routes={routes}
              selectedRoute={selectedRoute}
              onCancel={onCancelTruckHandoff}
              onPropose={onProposeTruckHandoff}
            />

            {routePlanEditable ? (
              <div className="planner-panel" key={selectedRoute.id}>
                <div>
                  <h3>Plan Assignment</h3>
                  <p>
                    Change driver or truck before field work starts. Trucks and drivers are floaters — any available unit
                    can cover this zone. Home-zone trucks are listed first.
                  </p>
                </div>
                <div className="planner-grid">
                  <label>
                    Truck
                    <select
                      value={selectedRoute.truckId ?? ""}
                      onChange={(event) => {
                        const truckId = event.target.value;
                        if (selectedRoute.zoneId && truckId) {
                          onUpdateRoutePlanAssignment(
                            selectedRoute.id,
                            selectedRoute.zoneId,
                            truckId,
                            selectedRoute.driverId ?? null
                          );
                        }
                      }}
                    >
                      <option value="">Select truck</option>
                      {availableTrucks.map((truck) => (
                        <option key={truck.id} value={truck.id}>
                          {truck.label} {truck.helper ? `- ${truck.helper}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Driver
                    <select
                      value={selectedRoute.driverId ?? ""}
                      onChange={(event) => {
                        if (selectedRoute.zoneId && selectedRoute.truckId) {
                          onUpdateRoutePlanAssignment(
                            selectedRoute.id,
                            selectedRoute.zoneId,
                            selectedRoute.truckId,
                            event.target.value || null
                          );
                        }
                      }}
                    >
                      <option value="">Unassigned</option>
                      {planningOptions.drivers.map((driver) => (
                        <option key={driver.id} value={driver.id}>
                          {driver.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {routeInlineError?.area === "assignment" ? (
                  <p className="inline-error">{routeInlineError.message}</p>
                ) : null}

                <div className="planner-add-stop">
                  <label>
                    Add stop
                    <select onChange={(event) => setSelectedCustomerToAdd(event.target.value)} value={selectedCustomerToAdd}>
                      <option value="">Select customer</option>
                      {availableCustomers.map((customer) => (
                        <option key={customer.id} value={customer.id}>
                          {customer.label} {customer.helper ? `- ${customer.helper}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    disabled={!selectedCustomerToAdd}
                    onClick={() => {
                      if (selectedCustomerToAdd) {
                        onAddRouteStop(selectedRoute.id, selectedCustomerToAdd);
                        setSelectedCustomerToAdd("");
                      }
                    }}
                    type="button"
                  >
                    Add to route
                  </button>
                </div>
                {routeInlineError?.area === "addStop" ? (
                  <p className="inline-error">{routeInlineError.message}</p>
                ) : null}
              </div>
            ) : selectedRoute.status === "scheduled" ? (
              <p className="notice error">This scheduled route cannot be edited because field work has already started.</p>
            ) : null}

            <div className="table-like">
              {routeInlineError?.area === "stopCorrection" ? (
                <p className="inline-error">{routeInlineError.message}</p>
              ) : null}
              {selectedRoute.stops.map((stop) => {
                const currentSkipReason = skipReasons[stop.id] ?? stop.skipReason ?? "";
                const stopIsCompleted = stop.status === "completed";
                const nextCompleteStatus: RouteStopStatus = stopIsCompleted ? "pending" : "completed";

                return (
                  <div className="stop-row stop-row-detailed" key={stop.id}>
                    <div>
                      <strong>
                        #{stop.stopSequence} {stop.customerName}
                      </strong>
                      <span>{stop.address}</span>
                      {stop.notes ? (
                        <p className="field-note">
                          <strong>Note</strong>
                          {stop.notes}
                        </p>
                      ) : null}
                      {stop.skipReason ? (
                        <p className="field-skip-reason">
                          <strong>Skip reason</strong>
                          {stop.skipReason}
                        </p>
                      ) : null}
                    </div>
                    <span className={`pill ${stop.status === "skipped" ? "danger" : ""}`}>
                      {stop.status.replace("_", " ")}
                    </span>
                    <div className="stop-controls">
                      <input
                        aria-label={`Note for ${stop.customerName}`}
                        disabled={routeFinalized}
                        onChange={(event) => setNotes((current) => ({ ...current, [stop.id]: event.target.value }))}
                        placeholder="Optional stop note"
                        type="text"
                        value={notes[stop.id] ?? ""}
                      />
                      <input
                        aria-label={`Skip reason for ${stop.customerName}`}
                        disabled={routeFinalized}
                        onChange={(event) =>
                          setSkipReasons((current) => ({ ...current, [stop.id]: event.target.value }))
                        }
                        placeholder="Required to skip"
                        required
                        type="text"
                        value={currentSkipReason}
                      />
                      <div className="button-row">
                        {routePlanEditable ? (
                          <>
                            <button
                              disabled={stop.stopSequence === 1}
                              onClick={() => onMoveRouteStop(stop.id, "up")}
                              type="button"
                            >
                              Move up
                            </button>
                            <button
                              disabled={stop.stopSequence === selectedRoute.stops.length}
                              onClick={() => onMoveRouteStop(stop.id, "down")}
                              type="button"
                            >
                              Move down
                            </button>
                            <button onClick={() => onRemoveRouteStop(stop.id)} type="button">
                              Remove
                            </button>
                          </>
                        ) : null}
                        <button
                          disabled={routeFinalized}
                          onClick={() =>
                            onUpdateStop(selectedRoute.id, stop.id, nextCompleteStatus, notes[stop.id])
                          }
                          type="button"
                        >
                          {stopIsCompleted ? "Reopen stop" : "Mark complete"}
                        </button>
                        <button
                          disabled={routeFinalized || !currentSkipReason.trim()}
                          onClick={() =>
                            onUpdateStop(
                              selectedRoute.id,
                              stop.id,
                              "skipped",
                              notes[stop.id],
                              currentSkipReason.trim()
                            )
                          }
                          type="button"
                          title={!currentSkipReason.trim() ? "Enter a skip reason first" : undefined}
                        >
                          Skip
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <p>No route is scheduled for today.</p>
        )}
      </article>
    </section>
  );
}

function PaymentsView({
  customerLedger,
  operationDate,
  payments,
  selectedCustomer,
  onRecordPayment,
  onSelectCustomer,
  onUpdateCustomerStatus
}: {
  customerLedger: CustomerLedgerItem[];
  operationDate: string;
  payments: PaymentLedgerItem[];
  selectedCustomer?: CustomerLedgerItem;
  onRecordPayment: (entry: PaymentEntry) => Promise<void>;
  onSelectCustomer: (customerId: string) => void;
  onUpdateCustomerStatus: (
    customerId: string,
    status: CustomerLedgerItem["serviceStatus"],
    tagMonth?: string,
    suspensionReason?: string
  ) => Promise<void>;
}) {
  const [activeSection, setActiveSection] = useState<"ledger" | "agents">("ledger");
  const [amountNaira, setAmountNaira] = useState("");
  const [channel, setChannel] = useState<PaymentChannel>("agent_cash");
  const [externalReference, setExternalReference] = useState("");
  const [tagMonth, setTagMonth] = useState(new Date().toISOString().slice(0, 10));
  const [history, setHistory] = useState<PaymentLedgerItem[]>([]);
  const [paymentFormError, setPaymentFormError] = useState<string | null>(null);
  const [customerStatusError, setCustomerStatusError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedCustomer) {
      setHistory([]);
      return;
    }

    void getCustomerPaymentHistory(selectedCustomer.customerId).then(setHistory);
  }, [
    selectedCustomer?.customerId,
    selectedCustomer?.lastPaymentAt,
    selectedCustomer?.paidThisMonthKobo,
    payments
  ]);

  const totalOutstanding = customerLedger.reduce((sum, customer) => sum + customer.outstandingKobo, 0);
  const suspendedCount = customerLedger.filter((customer) => customer.serviceStatus === "suspended").length;

  async function submitPayment() {
    if (!selectedCustomer) {
      return;
    }

    const amountKobo = parseAmountNairaToKobo(amountNaira);
    if (amountKobo === null) {
      setPaymentFormError("Enter a payment amount greater than zero.");
      return;
    }

    setPaymentFormError(null);

    try {
      await onRecordPayment({
        customerId: selectedCustomer.customerId,
        channel,
        amountKobo,
        externalReference: externalReference.trim() || undefined
      });
      setHistory(await getCustomerPaymentHistory(selectedCustomer.customerId));
      setAmountNaira("");
      setExternalReference("");
    } catch (err) {
      setPaymentFormError(formatAppError(err, "Unable to record payment."));
    }
  }

  async function submitCustomerStatus(
    status: CustomerLedgerItem["serviceStatus"],
    tagMonth?: string,
    suspensionReason?: string
  ) {
    if (!selectedCustomer) {
      return;
    }

    setCustomerStatusError(null);

    try {
      await onUpdateCustomerStatus(selectedCustomer.customerId, status, tagMonth, suspensionReason);
    } catch (err) {
      setCustomerStatusError(err instanceof Error ? err.message : "Unable to update customer status");
    }
  }

  const parsedAmountKobo = parseAmountNairaToKobo(amountNaira);
  const canSubmitPayment = Boolean(selectedCustomer) && parsedAmountKobo !== null;

  return (
    <>
      <nav aria-label="Payments sections" className="admin-tabs payment-subtabs">
        <button
          className={activeSection === "ledger" ? "active" : ""}
          onClick={() => setActiveSection("ledger")}
          type="button"
        >
          Customer ledger
        </button>
        <button
          className={activeSection === "agents" ? "active" : ""}
          onClick={() => setActiveSection("agents")}
          type="button"
        >
          Agent collections
        </button>
      </nav>

      {activeSection === "agents" ? (
        <AgentCollectionsView collectionDate={operationDate} />
      ) : (
    <section className="workflow-grid payment-workflow">
      <article className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Customer Ledger</p>
            <h2>Balances & Tags</h2>
            <p className="panel-subtitle">
              {formatKobo(totalOutstanding)} outstanding · {suspendedCount} suspended
            </p>
          </div>
          <WalletCards aria-hidden="true" />
        </div>

        <div className="stack-list">
          {customerLedger.map((customer) => (
            <button
              className={`route-selector ${selectedCustomer?.customerId === customer.customerId ? "active" : ""}`}
              key={customer.customerId}
              onClick={() => onSelectCustomer(customer.customerId)}
              type="button"
            >
              <strong>{customer.displayName}</strong>
              <span>
                {customer.zoneName} · {formatKobo(customer.outstandingKobo)} outstanding
              </span>
              <span className={`pill ${customer.serviceStatus === "suspended" ? "danger" : ""}`}>
                {customer.serviceStatus}
              </span>
              {customer.serviceStatus === "suspended" && customer.suspensionReason ? (
                <span className="suspension-note">{customer.suspensionReason}</span>
              ) : null}
            </button>
          ))}
        </div>
      </article>

      <article className="panel payment-detail-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Account Detail</p>
            <h2>{selectedCustomer?.displayName ?? "No customer selected"}</h2>
            {selectedCustomer ? (
              <p className="panel-subtitle">
                {selectedCustomer.address} · {selectedCustomer.customerType.replace("_", " ")}
              </p>
            ) : null}
            {selectedCustomer?.serviceStatus === "suspended" && selectedCustomer.suspensionReason ? (
              <p className="suspension-note">{selectedCustomer.suspensionReason}</p>
            ) : null}
          </div>
          <WalletCards aria-hidden="true" />
        </div>

        {selectedCustomer ? (
          <>
            <div className="route-operations">
              <div>
                <span>Monthly rate</span>
                <strong>{formatKobo(selectedCustomer.monthlyRateKobo)}</strong>
              </div>
              <div>
                <span>Paid this month</span>
                <strong>{formatKobo(selectedCustomer.paidThisMonthKobo)}</strong>
              </div>
              <div>
                <span>Outstanding</span>
                <strong>{formatKobo(selectedCustomer.outstandingKobo)}</strong>
              </div>
              <div>
                <span>Current tag</span>
                <strong>{selectedCustomer.currentTagMonth ?? "No active tag"}</strong>
              </div>
            </div>

            <div className="payment-detail-grid">
              <div className="entry-card">
                <h3>Record Payment</h3>
                {paymentFormError ? <p className="inline-error">{paymentFormError}</p> : null}
                <label>
                  Amount in naira
                  <input
                    min="1"
                    onChange={(event) => {
                      setAmountNaira(event.target.value);
                      setPaymentFormError(null);
                    }}
                    placeholder="5000"
                    required
                    step="0.01"
                    type="number"
                    value={amountNaira}
                  />
                </label>
                <label>
                  Channel
                  <select onChange={(event) => setChannel(event.target.value as PaymentChannel)} value={channel}>
                    {operatorPaymentChannels.map((paymentChannel) => (
                      <option key={paymentChannel} value={paymentChannel}>
                        {channelLabels[paymentChannel]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Reference
                  <input
                    onChange={(event) => setExternalReference(event.target.value)}
                    placeholder="Receipt or transfer ref"
                    type="text"
                    value={externalReference}
                  />
                </label>
                <button
                  className="primary-button"
                  disabled={!canSubmitPayment}
                  onClick={() => void submitPayment()}
                  type="button"
                >
                  Record payment
                </button>
              </div>

              <div className="entry-card">
                <h3>Manual Service Override</h3>
                <p>
                  Use this only when approving service outside the automatic payment rule.
                  Full payment will activate the customer automatically.
                </p>
                {customerStatusError ? <p className="inline-error">{customerStatusError}</p> : null}
                <label>
                  Service tag date
                  <input onChange={(event) => setTagMonth(event.target.value)} type="date" value={tagMonth} />
                </label>
                <div className="button-row">
                  <button
                    onClick={() => void submitCustomerStatus("active", tagMonth)}
                    type="button"
                  >
                    Activate tag
                  </button>
                  <button
                    onClick={() => void submitCustomerStatus("suspended", undefined, "Suspended by operator")}
                    type="button"
                  >
                    Suspend
                  </button>
                </div>
              </div>
            </div>

            <div className="table-like payment-history">
              <h3>Payment History</h3>
              {(history.length ? history : payments.filter((payment) => payment.customerName === selectedCustomer.displayName)).map(
                (payment) => (
                  <div className="ledger-row" key={payment.id}>
                    <div>
                      <strong>{payment.customerName}</strong>
                      <span>{new Date(payment.paidAt).toLocaleString()}</span>
                    </div>
                    <span>{channelLabels[payment.channel]}</span>
                    <strong>{formatKobo(payment.amountKobo)}</strong>
                  </div>
                )
              )}
            </div>
          </>
        ) : (
          <p>No customer account selected.</p>
        )}
      </article>
    </section>
      )}
    </>
  );
}

function StaffView({
  attendanceDate,
  monthlyStaffSummary,
  staffAttendance,
  summaryMonth,
  onAttendanceDateChange,
  onRecordOverride,
  onSummaryMonthChange
}: {
  attendanceDate: string;
  monthlyStaffSummary: MonthlyStaffSummary[];
  staffAttendance: StaffAttendanceRow[];
  summaryMonth: string;
  onAttendanceDateChange: (nextDate: string) => void;
  onRecordOverride: (override: AttendanceOverride) => void;
  onSummaryMonthChange: (nextMonth: string) => void;
}) {
  const [absenceReasons, setAbsenceReasons] = useState<Record<string, string>>({});
  const [overrideNotes, setOverrideNotes] = useState<Record<string, string>>({});
  const checkedInCount = staffAttendance.filter((staff) => staff.status === "checked_in").length;
  const absentCount = staffAttendance.length - checkedInCount;
  const estimatedPayroll = monthlyStaffSummary.reduce((sum, staff) => sum + staff.estimatedPayrollKobo, 0);

  return (
    <section className="staff-workflow">
      <article className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Attendance</p>
            <h2>Daily Check-ins</h2>
            <p className="panel-subtitle">
              {checkedInCount} checked in · {absentCount} absent
            </p>
          </div>
          <Users aria-hidden="true" />
        </div>

        <div className="entry-card compact-controls">
          <label>
            Attendance date
            <input
              onChange={(event) => onAttendanceDateChange(event.target.value)}
              type="date"
              value={attendanceDate}
            />
          </label>
        </div>

        <div className="table-like">
          {staffAttendance.map((staff) => (
            <div className="staff-row" key={staff.staffMemberId}>
              <div>
                <strong>{staff.fullName}</strong>
                <span>
                  {staff.phone} · {staff.role.replace("_", " ")} · {formatKobo(staff.monthlySalaryKobo)}
                </span>
                {staff.absenceReason ? <small>Absence: {staff.absenceReason}</small> : null}
                {staff.attendanceNote ? <small>Note: {staff.attendanceNote}</small> : null}
              </div>
              <span className={`pill ${staff.status === "absent" ? "danger" : ""}`}>
                {staff.status.replace("_", " ")}
              </span>
              <span>{staff.checkedInAt ? new Date(staff.checkedInAt).toLocaleTimeString() : "No check-in"}</span>
              <div className="staff-controls">
                <input
                  onChange={(event) =>
                    setOverrideNotes((current) => ({ ...current, [staff.staffMemberId]: event.target.value }))
                  }
                  placeholder="Override note"
                  type="text"
                  value={overrideNotes[staff.staffMemberId] ?? ""}
                />
                <input
                  onChange={(event) =>
                    setAbsenceReasons((current) => ({ ...current, [staff.staffMemberId]: event.target.value }))
                  }
                  placeholder="Absence reason"
                  type="text"
                  value={absenceReasons[staff.staffMemberId] ?? ""}
                />
                <div className="button-row">
                  <button
                    onClick={() =>
                      onRecordOverride({
                        staffMemberId: staff.staffMemberId,
                        attendanceDate,
                        checkedIn: true,
                        note: overrideNotes[staff.staffMemberId]
                      })
                    }
                    type="button"
                  >
                    Override present
                  </button>
                  <button
                    onClick={() =>
                      onRecordOverride({
                        staffMemberId: staff.staffMemberId,
                        attendanceDate,
                        checkedIn: false,
                        reason: absenceReasons[staff.staffMemberId],
                        note: overrideNotes[staff.staffMemberId]
                      })
                    }
                    type="button"
                  >
                    Mark absent
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </article>

      <article className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Payroll Summary</p>
            <h2>Monthly Staff Rollup</h2>
            <p className="panel-subtitle">{formatKobo(estimatedPayroll)} estimated payroll</p>
          </div>
          <Users aria-hidden="true" />
        </div>

        <div className="entry-card compact-controls">
          <label>
            Summary month
            <input
              onChange={(event) => onSummaryMonthChange(event.target.value)}
              type="date"
              value={summaryMonth}
            />
          </label>
        </div>

        <div className="table-like">
          {monthlyStaffSummary.map((staff) => (
            <div className="ledger-row" key={staff.staffMemberId}>
              <div>
                <strong>{staff.fullName}</strong>
                <span>{staff.role.replace("_", " ")}</span>
              </div>
              <span>
                {staff.daysCheckedIn} present · {staff.daysAbsent} absent
              </span>
              <strong>{formatKobo(staff.estimatedPayrollKobo)}</strong>
            </div>
          ))}
        </div>
      </article>
    </section>
  );
}
