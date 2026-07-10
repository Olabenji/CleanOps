import type {
  AdminMasterData,
  AttendanceOverride,
  CustomerLedgerItem,
  CustomerOnboardingInput,
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
  RouteStatus,
  RouteStopStatus,
  RouteTruckHandoff,
  StaffOnboardingInput,
  StaffOnboardingResult,
  StaffLoginProvisionInput,
  StaffAttendanceRow,
  TruckOnboardingInput
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
import PasswordRecoveryScreen from "./components/PasswordRecoveryScreen";
import TruckHandoffPanel from "./components/TruckHandoffPanel";
import {
  getCurrentOperatorProfile,
  getPasswordRecoveryContext,
  signInOperator,
  signOutOperator,
  subscribeToPasswordRecovery,
  type AuthState
} from "./data/authService";
import { getOperatorDashboard } from "./data/dashboardService";
import {
  addRoutePlanStop,
  cancelRouteTruckHandoff,
  getAdminMasterData,
  getCustomerLedger,
  getCustomerPaymentHistory,
  getMonthlyStaffSummary,
  getPaymentLedger,
  getRouteTruckHandoffs,
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
  setCustomerServiceStatus,
  setStaffActive,
  setTruckActive,
  transitionRouteStatus,
  updateRoutePlanAssignment,
  updateCustomerAccountStatus,
  updateRouteStopStatus
} from "./data/operatorWorkflowService";
import { demoCredentials } from "./data/pilotWorkflows";
import { formatAppError, parseAmountNairaToKobo } from "./lib/errors";
import { deriveRouteProgress } from "./lib/routeProgress";

const metricIcons = [Truck, WalletCards, Users, Wrench];
type View = "dashboard" | "routes" | "payments" | "staff" | "admin";
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

function formatKobo(amountKobo: number) {
  return currencyFormatter.format(amountKobo / 100);
}

export function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [dashboard, setDashboard] = useState<OperatorDashboard | null>(null);
  const [routes, setRoutes] = useState<RouteDetail[]>([]);
  const [routeHandoffs, setRouteHandoffs] = useState<RouteTruckHandoff[]>([]);
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
  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState<string | null>(null);

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
    const [
      dashboardData,
      routesData,
      handoffData,
      paymentData,
      ledgerData,
      staffData,
      monthlyStaffData,
      incidentData,
      routePlanningOptions,
      nextAdminData
    ] = await Promise.all([
      getOperatorDashboard(targetDate),
      getRoutes(targetDate),
      getRouteTruckHandoffs(targetDate),
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

  async function handleSignOut() {
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
    setOperationDate(nextDate);
    setAttendanceDate(nextDate);
    setError(null);
    setRouteInlineError(null);
    setStatusMessage(null);

    try {
      await loadWorkspace(nextDate);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load selected operations date");
    }
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
    const [nextRoutes, nextHandoffs] = await Promise.all([
      getRoutes(operationDate),
      getRouteTruckHandoffs(operationDate)
    ]);
    await refreshRoutesForSelectedDate(nextRoutes);
    setRouteHandoffs(nextHandoffs);
    setStatusMessage("Truck handoff sent for driver confirmation.");
  }

  async function handleCancelTruckHandoff(handoffId: string) {
    setStatusMessage(null);
    setError(null);
    setRouteInlineError(null);
    await cancelRouteTruckHandoff(handoffId);
    setRouteHandoffs(await getRouteTruckHandoffs(operationDate));
    setStatusMessage("Truck handoff cancelled.");
  }

  async function handleAddRoutePlanStop(routeId: string, customerId: string) {
    setStatusMessage(null);
    setError(null);
    setRouteInlineError(null);

    try {
      const nextRoutes = await addRoutePlanStop(routeId, customerId, operationDate);
      await refreshRoutesForSelectedDate(nextRoutes);
      setStatusMessage("Stop added to route plan.");
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

  async function handleOnboardTruck(input: TruckOnboardingInput) {
    setStatusMessage(null);
    await onboardTruck(input);
    await refreshAdminData();
    setStatusMessage("Truck onboarded.");
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

  return (
    <main className="app-shell">
      <TopBar auth={auth} onSignOut={handleSignOut} />

      {error ? <p className="notice error">{error}</p> : null}
      {statusMessage ? <p className="notice">{statusMessage}</p> : null}

      <section className="date-control-panel" aria-label="Operations date control">
        <div>
          <p className="eyebrow">Operations Date</p>
          <h2>{operationDate === todayIso ? "Today" : new Date(`${operationDate}T00:00:00`).toLocaleDateString()}</h2>
          <p>View daily route, attendance, payment, and incident state. Plan future routes from recent templates.</p>
          {operationDate === todayIso && (activeView === "dashboard" || activeView === "routes") ? (
            <p className="live-refresh-hint">Dashboard and routes auto-refresh every 45 seconds while this tab is open.</p>
          ) : null}
          {activeView === "payments" ? (
            <p className="live-refresh-hint">
              Payment ledger auto-refresh every 20 seconds so Paystack webhooks show without a manual reload.
            </p>
          ) : null}
        </div>
        <div className="date-control-actions">
          <label>
            Select date
            <input
              onChange={(event) => void handleOperationDateChange(event.target.value)}
              type="date"
              value={operationDate}
            />
          </label>
          <button
            className="primary-button refresh-button"
            disabled={refreshing}
            onClick={() => void handleRefresh()}
            type="button"
          >
            <RefreshCw aria-hidden="true" className={refreshing ? "spinning" : undefined} />
            {refreshing ? "Refreshing..." : "Refresh data"}
          </button>
        </div>
      </section>

      <nav className="workspace-tabs" aria-label="Operator workflow sections">
        {(["dashboard", "routes", "payments", "staff", "admin"] as View[]).map((view) => (
          <button
            className={activeView === view ? "active" : ""}
            key={view}
            onClick={() => setActiveView(view)}
            type="button"
          >
            {view}
          </button>
        ))}
      </nav>

      {activeView === "dashboard" && dashboard ? (
        <DashboardView dashboard={dashboard} incidents={incidents} operationDate={operationDate} todayIso={todayIso} />
      ) : null}
      {activeView === "routes" ? (
        <RoutesView
          routes={routes}
          routeHandoffs={routeHandoffs}
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
          onOnboardCustomer={handleOnboardCustomer}
          onOnboardStaff={handleOnboardStaff}
          onOnboardTruck={handleOnboardTruck}
          onProvisionStaffLogin={handleProvisionStaffLogin}
          onRequestStaffPasswordReset={handleRequestStaffPasswordReset}
          onSetCustomerServiceStatus={handleSetCustomerServiceStatus}
          onSetStaffActive={handleSetStaffActive}
          onSetTruckActive={handleSetTruckActive}
        />
      ) : null}
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
        <p className="eyebrow">CleanOps Operator Login</p>
        <h1>Start the Phase 1 pilot workspace.</h1>
        <p>
          Use the seeded local demo owner to exercise operator routes, payment ledger,
          and attendance workflows.
        </p>
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

function TopBar({
  auth,
  onSignOut
}: {
  auth: AuthState;
  onSignOut: () => void;
}) {
  const profile: OperatorProfile = auth.profile;

  return (
    <header className="top-bar">
      <div>
        <p className="eyebrow">CleanOps Command Centre</p>
        <h1>{profile.operatorName ?? "CleanOps Operator"}</h1>
        <p>
          {profile.fullName} · {profile.role.replace("_", " ")} · {auth.mode} mode
        </p>
      </div>
      <button className="ghost-button" onClick={onSignOut} type="button">
        <LogOut aria-hidden="true" />
        Sign out
      </button>
    </header>
  );
}

function DashboardView({
  dashboard,
  incidents,
  operationDate,
  todayIso
}: {
  dashboard: OperatorDashboard;
  incidents: IncidentReport[];
  operationDate: string;
  todayIso: string;
}) {
  return (
    <>
      <section className="metric-grid" aria-label="Operational metrics">
        {dashboard.metrics.map((metric, index) => {
          const Icon = metricIcons[index] ?? CheckCircle2;

          return (
            <article className="metric-card" key={metric.label}>
              <Icon aria-hidden="true" />
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <small>{metric.helper}</small>
            </article>
          );
        })}
      </section>
      <section className="dashboard-grid">
        <article className="panel panel-wide">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Live Routes</p>
              <h2>{operationDate === todayIso ? "Today's Collection Runs" : "Selected Date Collection Runs"}</h2>
            </div>
            <Clock aria-hidden="true" />
          </div>

          <div className="stack-list">
            {dashboard.routes.map((route) => {
              const progress = Math.round((route.completedStops / route.totalStops) * 100);

              return (
                <div className="route-row" key={route.id}>
                  <div>
                    <strong>{route.zoneName}</strong>
                    <span>
                      {route.truckRegistration} · {route.driverName}
                    </span>
                  </div>
                  <div className="progress-group">
                    <div className="progress-bar">
                      <span style={{ width: `${progress}%` }} />
                    </div>
                    <small>
                      {route.completedStops}/{route.totalStops} stops · {progress}%
                    </small>
                  </div>
                  <span className={route.delayed ? "pill danger" : "pill"}>
                    {route.delayed ? "Delayed" : route.status.replace("_", " ")}
                  </span>
                </div>
              );
            })}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Payments</p>
              <h2>Recent Receipts</h2>
            </div>
            <WalletCards aria-hidden="true" />
          </div>

          <div className="stack-list">
            {dashboard.recentPayments.map((payment) => (
              <div className="stack-row" key={payment.id}>
                <div>
                  <strong>{payment.customerName}</strong>
                  <span>{channelLabels[payment.channel]}</span>
                </div>
                <strong>{formatKobo(payment.amountKobo)}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Staff</p>
              <h2>Attendance</h2>
            </div>
            <Users aria-hidden="true" />
          </div>

          <div className="attendance-card">
            <strong>
              {dashboard.staffAttendance.checkedIn}/{dashboard.staffAttendance.totalStaff}
            </strong>
            <span>checked in for today&apos;s shift</span>
            <p>{dashboard.staffAttendance.absent} unresolved absence alerts.</p>
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Fleet</p>
              <h2>Maintenance Reserve</h2>
            </div>
            <Wrench aria-hidden="true" />
          </div>

          <div className="stack-list">
            {dashboard.fleet.map((truck) => (
              <div className="stack-row" key={truck.registrationNumber}>
                <div>
                  <strong>{truck.registrationNumber}</strong>
                  <span>
                    {truck.zoneName} · {truck.status}
                  </span>
                </div>
                <strong>{formatKobo(truck.reserveRemainingKobo)}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="panel alert-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Alerts</p>
              <h2>Action Required</h2>
            </div>
            <AlertTriangle aria-hidden="true" />
          </div>

          <ul>
            {dashboard.alerts.map((alert) => (
              <li key={alert}>{alert}</li>
            ))}
          </ul>
        </article>

        <article className="panel panel-wide">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Incidents</p>
              <h2>Recent Driver Reports</h2>
            </div>
            <AlertTriangle aria-hidden="true" />
          </div>

          <div className="stack-list">
            {incidents.length === 0 ? (
              <p className="panel-subtitle">No recent incidents reported.</p>
            ) : (
              incidents.map((incident) => (
                <div
                  className={`incident-row ${incident.resolvedAt ? "" : "incident-row-open"}`}
                  key={incident.id}
                >
                  <div>
                    <strong>{incident.title}</strong>
                    <span>
                      {incident.routeLabel ?? "Route"} · {incident.truckRegistration ?? "Truck"} ·{" "}
                      {incident.reportedBy ?? "Unknown reporter"}
                    </span>
                    <p className="incident-description">{incident.description}</p>
                  </div>
                  <span className={incident.resolvedAt ? "pill" : "pill danger"}>
                    {incident.resolvedAt ? "Resolved" : "Open"}
                  </span>
                </div>
              ))
            )}
          </div>
        </article>
      </section>
    </>
  );
}

function RoutesView({
  routes,
  routeHandoffs,
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
  const availableTrucks = planningOptions.trucks.filter((truck) => truck.zoneId === selectedRoute?.zoneId);

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
            Plan selected date from templates
          </button>
        </div>
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
                  <p>Change driver or truck before field work starts. Select the route zone from the list on the left.</p>
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
