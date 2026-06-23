import type {
  AdminMasterData,
  AttendanceOverride,
  CustomerLedgerItem,
  CustomerOnboardingInput,
  CustomerType,
  IncidentReport,
  MonthlyStaffSummary,
  OperatorDashboard,
  OperatorProfile,
  PaymentChannel,
  PaymentEntry,
  PaymentLedgerItem,
  RouteDetail,
  RoutePlanningOptions,
  RouteStatus,
  RouteStopStatus,
  StaffOnboardingInput,
  StaffAttendanceRow,
  TruckOnboardingInput,
  TruckStatus,
  UserRole
} from "@cleanops/shared";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  LogOut,
  Route,
  Truck,
  Users,
  WalletCards,
  Wrench
} from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import {
  getCurrentOperatorProfile,
  signInOperator,
  signOutOperator,
  type AuthState
} from "./data/authService";
import { getOperatorDashboard } from "./data/dashboardService";
import {
  addRoutePlanStop,
  getAdminMasterData,
  getCustomerLedger,
  getCustomerPaymentHistory,
  getMonthlyStaffSummary,
  getPaymentLedger,
  planDailyRoutes,
  getRecentIncidentReports,
  getRoutePlanningOptions,
  getRoutes,
  getStaffAttendance,
  moveRoutePlanStop,
  onboardCustomer,
  onboardStaffMember,
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

const adminStaffRoles: UserRole[] = ["driver", "collection_agent", "operations_supervisor"];
const adminCustomerTypes: CustomerType[] = ["residential", "small_business", "restaurant", "estate"];
const adminTruckStatuses: TruckStatus[] = ["operational", "standby", "workshop"];

const todayIso = new Date().toISOString().slice(0, 10);

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

  useEffect(() => {
    void bootstrap();
  }, []);

  async function bootstrap() {
    setLoading(true);
    setError(null);

    try {
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

  async function loadWorkspace(targetDate = operationDate) {
    const [
      dashboardData,
      routesData,
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
      setRoutes(nextRoutes);
      await getOperatorDashboard(operationDate).then(setDashboard);
      setStatusMessage("Stop status updated.");
    } catch (err) {
      setRouteInlineError({
        area: "stopCorrection",
        message: err instanceof Error ? err.message : "Unable to update stop status"
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

    try {
      const nextLedger = await recordPayment(entry);
      const [nextPayments, nextDashboard] = await Promise.all([getPaymentLedger(), getOperatorDashboard(operationDate)]);
      setCustomerLedger(nextLedger);
      setPayments(nextPayments);
      setDashboard(nextDashboard);
      setSelectedCustomerId(entry.customerId);
      setStatusMessage("Payment recorded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to record payment");
    }
  }

  async function handleCustomerStatus(
    customerId: string,
    status: CustomerLedgerItem["serviceStatus"],
    tagMonth?: string
  ) {
    setStatusMessage(null);
    setError(null);

    try {
      const nextLedger = await updateCustomerAccountStatus(customerId, status, tagMonth);
      setCustomerLedger(nextLedger);
      setSelectedCustomerId(customerId);
      setStatusMessage(`Customer marked ${status}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update customer status");
    }
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

  async function handleOnboardStaff(input: StaffOnboardingInput) {
    setStatusMessage(null);
    setError(null);

    try {
      await onboardStaffMember(input);
      await refreshAdminData();
      setStatusMessage("Staff member onboarded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to onboard staff member");
    }
  }

  async function handleSetStaffActive(staffId: string, active: boolean) {
    setStatusMessage(null);
    setError(null);

    try {
      await setStaffActive(staffId, active);
      await refreshAdminData();
      setStatusMessage(active ? "Staff member reactivated." : "Staff member deactivated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update staff status");
    }
  }

  async function handleOnboardTruck(input: TruckOnboardingInput) {
    setStatusMessage(null);
    setError(null);

    try {
      await onboardTruck(input);
      await refreshAdminData();
      setStatusMessage("Truck onboarded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to onboard truck");
    }
  }

  async function handleSetTruckActive(truckId: string, active: boolean) {
    setStatusMessage(null);
    setError(null);

    try {
      await setTruckActive(truckId, active);
      await refreshAdminData();
      setStatusMessage(active ? "Truck reactivated." : "Truck deactivated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update truck status");
    }
  }

  async function handleOnboardCustomer(input: CustomerOnboardingInput) {
    setStatusMessage(null);
    setError(null);

    try {
      await onboardCustomer(input);
      await refreshAdminData();
      setStatusMessage("Customer onboarded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to onboard customer");
    }
  }

  async function handleSetCustomerServiceStatus(customerId: string, serviceStatus: CustomerLedgerItem["serviceStatus"]) {
    setStatusMessage(null);
    setError(null);

    try {
      await setCustomerServiceStatus(customerId, serviceStatus);
      await refreshAdminData();
      setStatusMessage(`Customer marked ${serviceStatus}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update customer status");
    }
  }

  if (loading) {
    return <main className="app-shell">Loading CleanOps command centre...</main>;
  }

  if (!auth) {
    return <LoginScreen error={error} onDemoSignIn={handleDemoSignIn} />;
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
        </div>
        <label>
          Select date
          <input
            onChange={(event) => void handleOperationDateChange(event.target.value)}
            type="date"
            value={operationDate}
          />
        </label>
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
          selectedRoute={selectedRoute}
          operationDate={operationDate}
          planningOptions={planningOptions}
          routeInlineError={routeInlineError}
          todayIso={todayIso}
          onAddRouteStop={handleAddRoutePlanStop}
          onMoveRouteStop={handleMoveRoutePlanStop}
          onPlanDailyRoutes={handlePlanDailyRoutes}
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
  onDemoSignIn
}: {
  error: string | null;
  onDemoSignIn: () => void;
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
                <div className="incident-row" key={incident.id}>
                  <div>
                    <strong>{incident.title}</strong>
                    <span>
                      {incident.routeLabel ?? "Route"} · {incident.truckRegistration ?? "Truck"} ·{" "}
                      {incident.reportedBy ?? "Unknown reporter"}
                    </span>
                    <p>{incident.description}</p>
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
  selectedRoute,
  operationDate,
  planningOptions,
  routeInlineError,
  todayIso,
  onAddRouteStop,
  onMoveRouteStop,
  onPlanDailyRoutes,
  onRemoveRouteStop,
  onSelectRoute,
  onUpdateRoutePlanAssignment,
  onUpdateRouteStatus,
  onUpdateStop
}: {
  routes: RouteDetail[];
  selectedRoute?: RouteDetail;
  operationDate: string;
  planningOptions: RoutePlanningOptions;
  routeInlineError: RouteInlineError;
  todayIso: string;
  onAddRouteStop: (routeId: string, customerId: string) => void;
  onMoveRouteStop: (stopId: string, direction: "up" | "down") => void;
  onPlanDailyRoutes: () => void;
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
  const routeFinalized = selectedRoute?.status === "completed" || selectedRoute?.status === "cancelled";
  const routePlanEditable = selectedRoute?.status === "scheduled" && !selectedRoute.startedAt && !selectedRoute.completedAt;
  const customersAlreadyPlanned = new Set(selectedRoute?.stops.map((stop) => stop.customerId).filter(Boolean));
  const availableCustomers = planningOptions.customers.filter((customer) => !customersAlreadyPlanned.has(customer.id));
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
            <p className="panel-subtitle">Use the planning button above to create future route plans.</p>
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
                  {routeItem.completedStops}/{routeItem.totalStops} stops · {routeItem.status.replace("_", " ")}
                </span>
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
            <div className="route-operations">
              <div>
                <span>Started</span>
                <strong>{selectedRoute.startedAt ? new Date(selectedRoute.startedAt).toLocaleTimeString() : "Not started"}</strong>
              </div>
              <div>
                <span>Completed</span>
                <strong>{selectedRoute.completedAt ? new Date(selectedRoute.completedAt).toLocaleTimeString() : "Open"}</strong>
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
              Route start and completion are field actions. Operators can cancel a route or correct individual
              stops when driver updates fail to transmit.
            </p>

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
                      {stop.notes ? <small>Note: {stop.notes}</small> : null}
                      {stop.skipReason ? <small>Skip reason: {stop.skipReason}</small> : null}
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
  payments,
  selectedCustomer,
  onRecordPayment,
  onSelectCustomer,
  onUpdateCustomerStatus
}: {
  customerLedger: CustomerLedgerItem[];
  payments: PaymentLedgerItem[];
  selectedCustomer?: CustomerLedgerItem;
  onRecordPayment: (entry: PaymentEntry) => Promise<void>;
  onSelectCustomer: (customerId: string) => void;
  onUpdateCustomerStatus: (
    customerId: string,
    status: CustomerLedgerItem["serviceStatus"],
    tagMonth?: string
  ) => void;
}) {
  const [amountNaira, setAmountNaira] = useState("");
  const [channel, setChannel] = useState<PaymentChannel>("agent_cash");
  const [externalReference, setExternalReference] = useState("");
  const [tagMonth, setTagMonth] = useState(new Date().toISOString().slice(0, 10));
  const [history, setHistory] = useState<PaymentLedgerItem[]>([]);

  useEffect(() => {
    if (!selectedCustomer) {
      setHistory([]);
      return;
    }

    void getCustomerPaymentHistory(selectedCustomer.customerId).then(setHistory);
  }, [selectedCustomer?.customerId]);

  const totalOutstanding = customerLedger.reduce((sum, customer) => sum + customer.outstandingKobo, 0);
  const suspendedCount = customerLedger.filter((customer) => customer.serviceStatus === "suspended").length;

  async function submitPayment() {
    if (!selectedCustomer) {
      return;
    }

    const amountKobo = Math.round(Number(amountNaira) * 100);

    await onRecordPayment({
      customerId: selectedCustomer.customerId,
      channel,
      amountKobo,
      externalReference: externalReference.trim() || undefined
    });
    setHistory(await getCustomerPaymentHistory(selectedCustomer.customerId));
    setAmountNaira("");
    setExternalReference("");
  }

  return (
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
                <label>
                  Amount in naira
                  <input
                    min="1"
                    onChange={(event) => setAmountNaira(event.target.value)}
                    placeholder="5000"
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
                <button className="primary-button" onClick={submitPayment} type="button">
                  Record payment
                </button>
              </div>

              <div className="entry-card">
                <h3>Manual Service Override</h3>
                <p>
                  Use this only when approving service outside the automatic payment rule.
                  Full payment will activate the customer automatically.
                </p>
                <label>
                  Service tag date
                  <input onChange={(event) => setTagMonth(event.target.value)} type="date" value={tagMonth} />
                </label>
                <div className="button-row">
                  <button
                    onClick={() => onUpdateCustomerStatus(selectedCustomer.customerId, "active", tagMonth)}
                    type="button"
                  >
                    Activate tag
                  </button>
                  <button
                    onClick={() => onUpdateCustomerStatus(selectedCustomer.customerId, "suspended")}
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
  );
}

function AdminView({
  adminData,
  onOnboardCustomer,
  onOnboardStaff,
  onOnboardTruck,
  onSetCustomerServiceStatus,
  onSetStaffActive,
  onSetTruckActive
}: {
  adminData: AdminMasterData;
  onOnboardCustomer: (input: CustomerOnboardingInput) => Promise<void>;
  onOnboardStaff: (input: StaffOnboardingInput) => Promise<void>;
  onOnboardTruck: (input: TruckOnboardingInput) => Promise<void>;
  onSetCustomerServiceStatus: (customerId: string, serviceStatus: CustomerLedgerItem["serviceStatus"]) => Promise<void>;
  onSetStaffActive: (staffId: string, active: boolean) => Promise<void>;
  onSetTruckActive: (truckId: string, active: boolean) => Promise<void>;
}) {
  const defaultZoneId = adminData.zones[0]?.id ?? "";
  const [staffForm, setStaffForm] = useState({
    fullName: "",
    monthlySalaryNaira: "",
    phone: "",
    role: "driver" as UserRole
  });
  const [truckForm, setTruckForm] = useState({
    make: "",
    model: "",
    registrationNumber: "",
    status: "operational" as TruckStatus,
    year: "",
    zoneId: defaultZoneId
  });
  const [customerForm, setCustomerForm] = useState({
    address: "",
    customerType: "residential" as CustomerType,
    displayName: "",
    monthlyRateNaira: "",
    phone: "",
    serviceStatus: "active" as CustomerLedgerItem["serviceStatus"],
    zoneId: defaultZoneId
  });

  useEffect(() => {
    if (!defaultZoneId) {
      return;
    }

    setTruckForm((current) => ({ ...current, zoneId: current.zoneId || defaultZoneId }));
    setCustomerForm((current) => ({ ...current, zoneId: current.zoneId || defaultZoneId }));
  }, [defaultZoneId]);

  async function submitStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onOnboardStaff({
      fullName: staffForm.fullName,
      monthlySalaryKobo: Math.round(Number(staffForm.monthlySalaryNaira || 0) * 100),
      phone: staffForm.phone,
      role: staffForm.role
    });
    setStaffForm({ fullName: "", monthlySalaryNaira: "", phone: "", role: "driver" });
  }

  async function submitTruck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onOnboardTruck({
      make: truckForm.make || undefined,
      model: truckForm.model || undefined,
      registrationNumber: truckForm.registrationNumber,
      status: truckForm.status,
      year: truckForm.year ? Number(truckForm.year) : undefined,
      zoneId: truckForm.zoneId
    });
    setTruckForm({
      make: "",
      model: "",
      registrationNumber: "",
      status: "operational",
      year: "",
      zoneId: defaultZoneId
    });
  }

  async function submitCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onOnboardCustomer({
      address: customerForm.address,
      customerType: customerForm.customerType,
      displayName: customerForm.displayName,
      monthlyRateKobo: Math.round(Number(customerForm.monthlyRateNaira || 0) * 100),
      phone: customerForm.phone || undefined,
      serviceStatus: customerForm.serviceStatus,
      zoneId: customerForm.zoneId
    });
    setCustomerForm({
      address: "",
      customerType: "residential",
      displayName: "",
      monthlyRateNaira: "",
      phone: "",
      serviceStatus: "active",
      zoneId: defaultZoneId
    });
  }

  return (
    <section className="admin-workflow">
      <article className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Admin</p>
            <h2>Drivers & Staff</h2>
            <p className="panel-subtitle">Onboard field workers and deactivate records without losing history.</p>
          </div>
          <Users aria-hidden="true" />
        </div>
        <form className="entry-card admin-form" onSubmit={(event) => void submitStaff(event)}>
          <label>
            Full name
            <input
              onChange={(event) => setStaffForm((current) => ({ ...current, fullName: event.target.value }))}
              required
              value={staffForm.fullName}
            />
          </label>
          <label>
            Phone
            <input
              onChange={(event) => setStaffForm((current) => ({ ...current, phone: event.target.value }))}
              required
              value={staffForm.phone}
            />
          </label>
          <label>
            Role
            <select
              onChange={(event) => setStaffForm((current) => ({ ...current, role: event.target.value as UserRole }))}
              value={staffForm.role}
            >
              {adminStaffRoles.map((role) => (
                <option key={role} value={role}>
                  {role.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            Monthly salary (naira)
            <input
              min="0"
              onChange={(event) => setStaffForm((current) => ({ ...current, monthlySalaryNaira: event.target.value }))}
              type="number"
              value={staffForm.monthlySalaryNaira}
            />
          </label>
          <button className="primary-button" type="submit">Add staff</button>
        </form>
        <div className="admin-list">
          {adminData.staff.map((staff) => (
            <div className="admin-row" key={staff.id}>
              <div>
                <strong>{staff.fullName}</strong>
                <span>{staff.phone} · {staff.role.replace("_", " ")} · {formatKobo(staff.monthlySalaryKobo)}</span>
                <small>{staff.hasLoginProfile ? "Login linked" : "No login profile yet"}</small>
              </div>
              <span className={`pill ${staff.active ? "" : "danger"}`}>{staff.active ? "active" : "inactive"}</span>
              <button onClick={() => void onSetStaffActive(staff.id, !staff.active)} type="button">
                {staff.active ? "Deactivate" : "Reactivate"}
              </button>
            </div>
          ))}
        </div>
      </article>

      <article className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Admin</p>
            <h2>Trucks</h2>
            <p className="panel-subtitle">Register fleet assets and bind them to operating zones.</p>
          </div>
          <Truck aria-hidden="true" />
        </div>
        <form className="entry-card admin-form" onSubmit={(event) => void submitTruck(event)}>
          <label>
            Zone
            <select
              onChange={(event) => setTruckForm((current) => ({ ...current, zoneId: event.target.value }))}
              required
              value={truckForm.zoneId}
            >
              <option value="">Select zone</option>
              {adminData.zones.map((zone) => (
                <option key={zone.id} value={zone.id}>{zone.name}</option>
              ))}
            </select>
          </label>
          <label>
            Registration
            <input
              onChange={(event) => setTruckForm((current) => ({ ...current, registrationNumber: event.target.value }))}
              required
              value={truckForm.registrationNumber}
            />
          </label>
          <label>
            Make
            <input onChange={(event) => setTruckForm((current) => ({ ...current, make: event.target.value }))} value={truckForm.make} />
          </label>
          <label>
            Model
            <input onChange={(event) => setTruckForm((current) => ({ ...current, model: event.target.value }))} value={truckForm.model} />
          </label>
          <label>
            Year
            <input
              onChange={(event) => setTruckForm((current) => ({ ...current, year: event.target.value }))}
              type="number"
              value={truckForm.year}
            />
          </label>
          <label>
            Status
            <select
              onChange={(event) => setTruckForm((current) => ({ ...current, status: event.target.value as TruckStatus }))}
              value={truckForm.status}
            >
              {adminTruckStatuses.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </label>
          <button className="primary-button" type="submit">Add truck</button>
        </form>
        <div className="admin-list">
          {adminData.trucks.map((truck) => (
            <div className="admin-row" key={truck.id}>
              <div>
                <strong>{truck.registrationNumber}</strong>
                <span>{truck.zoneName ?? "No zone"} · {truck.status} · {[truck.make, truck.model, truck.year].filter(Boolean).join(" ") || "No vehicle details"}</span>
              </div>
              <span className={`pill ${truck.active ? "" : "danger"}`}>{truck.active ? "active" : "inactive"}</span>
              <button onClick={() => void onSetTruckActive(truck.id, !truck.active)} type="button">
                {truck.active ? "Deactivate" : "Reactivate"}
              </button>
            </div>
          ))}
        </div>
      </article>

      <article className="panel panel-wide">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Admin</p>
            <h2>Customers</h2>
            <p className="panel-subtitle">Create customer accounts used by billing, route planning, and stop lists.</p>
          </div>
          <WalletCards aria-hidden="true" />
        </div>
        <form className="entry-card admin-form customer-admin-form" onSubmit={(event) => void submitCustomer(event)}>
          <label>
            Zone
            <select
              onChange={(event) => setCustomerForm((current) => ({ ...current, zoneId: event.target.value }))}
              required
              value={customerForm.zoneId}
            >
              <option value="">Select zone</option>
              {adminData.zones.map((zone) => (
                <option key={zone.id} value={zone.id}>{zone.name}</option>
              ))}
            </select>
          </label>
          <label>
            Customer name
            <input
              onChange={(event) => setCustomerForm((current) => ({ ...current, displayName: event.target.value }))}
              required
              value={customerForm.displayName}
            />
          </label>
          <label>
            Phone
            <input onChange={(event) => setCustomerForm((current) => ({ ...current, phone: event.target.value }))} value={customerForm.phone} />
          </label>
          <label>
            Address
            <input
              onChange={(event) => setCustomerForm((current) => ({ ...current, address: event.target.value }))}
              required
              value={customerForm.address}
            />
          </label>
          <label>
            Type
            <select
              onChange={(event) => setCustomerForm((current) => ({ ...current, customerType: event.target.value as CustomerType }))}
              value={customerForm.customerType}
            >
              {adminCustomerTypes.map((type) => (
                <option key={type} value={type}>{type.replace("_", " ")}</option>
              ))}
            </select>
          </label>
          <label>
            Monthly rate (naira)
            <input
              min="0"
              onChange={(event) => setCustomerForm((current) => ({ ...current, monthlyRateNaira: event.target.value }))}
              required
              type="number"
              value={customerForm.monthlyRateNaira}
            />
          </label>
          <label>
            Service status
            <select
              onChange={(event) =>
                setCustomerForm((current) => ({
                  ...current,
                  serviceStatus: event.target.value as CustomerLedgerItem["serviceStatus"]
                }))
              }
              value={customerForm.serviceStatus}
            >
              <option value="active">active</option>
              <option value="suspended">suspended</option>
            </select>
          </label>
          <button className="primary-button" type="submit">Add customer</button>
        </form>
        <div className="admin-list">
          {adminData.customers.map((customer) => (
            <div className="admin-row" key={customer.id}>
              <div>
                <strong>{customer.displayName}</strong>
                <span>{customer.zoneName} · {customer.address} · {formatKobo(customer.monthlyRateKobo)}</span>
                <small>{customer.phone ?? "No phone"} · {customer.customerType.replace("_", " ")}</small>
              </div>
              <span className={`pill ${customer.serviceStatus === "suspended" ? "danger" : ""}`}>{customer.serviceStatus}</span>
              <button
                onClick={() =>
                  void onSetCustomerServiceStatus(
                    customer.id,
                    customer.serviceStatus === "active" ? "suspended" : "active"
                  )
                }
                type="button"
              >
                {customer.serviceStatus === "active" ? "Suspend" : "Reactivate"}
              </button>
            </div>
          ))}
        </div>
      </article>
    </section>
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
