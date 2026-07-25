import type {
  AdminMasterData,
  AttendanceOverride,
  BillDelivery,
  ComplianceCase,
  CreateComplianceCaseInput,
  CreateServiceComplaintInput,
  CustomerLedgerItem,
  CustomerOnboardingInput,
  CustomerUpdateInput,
  IncidentReport,
  MonthlyStaffSummary,
  OperatorCoverageSnapshot,
  OperatorDashboard,
  OperatorFleetSnapshot,
  OperatorCommsSnapshot,
  OperatorReportsSnapshot,
  RecordMaintenanceEventInput,
  OperatorZoneTemplatesSnapshot,
  UpsertDumpsiteSiteInput,
  OperatorProfile,
  PaymentChannel,
  PaymentEntry,
  PaymentLedgerItem,
  ProposeRouteTruckHandoffInput,
  PlatformOperator,
  RecordBillDeliveryInput,
  RecordVehicleBrandingChecklistInput,
  RouteDetail,
  RoutePlanningOptions,
  RouteCoverSummary,
  RouteStatus,
  RouteStopStatus,
  RouteTruckHandoff,
  ServiceComplaint,
  StaffOnboardingInput,
  StaffOnboardingResult,
  StaffLoginProvisionInput,
  CustomerLoginProvisionInput,
  StaffAttendanceRow,
  StaffUpdateInput,
  TruckOnboardingInput,
  TruckUpdateInput,
  VehicleBrandingChecklist
} from "@cleanops/shared";
import { formatCollectionFrequency, DEFAULT_OPERATION_TIME_ZONE, getOperationDate, getOperationMonth } from "@cleanops/shared";
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
import ComplianceView from "./components/ComplianceView";
import CoverageView from "./components/CoverageView";
import DashboardRouteMonitor, { DashboardBrandFooter } from "./components/DashboardRouteMonitor";
import FleetView from "./components/FleetView";
import CommsView from "./components/CommsView";
import OperatorSidebar from "./components/OperatorSidebar";
import ReportsView from "./components/ReportsView";
import SettingsView from "./components/SettingsView";
import PasswordRecoveryScreen from "./components/PasswordRecoveryScreen";
import PlatformAdminView from "./components/PlatformAdminView";
import ProfileModal from "./components/ProfileModal";
import ResidentApp from "./components/ResidentApp";
import TemplateSavePrompt, { TemplatePendingBanner } from "./components/TemplateSavePrompt";
import TruckHandoffPanel from "./components/TruckHandoffPanel";
import WorkspaceHeader from "./components/WorkspaceHeader";
import {
  getCurrentOperatorProfile,
  getPasswordRecoveryContext,
  requestPasswordReset,
  signInOperator,
  signOutOperator,
  subscribeToPasswordRecovery,
  type AuthState
} from "./data/authService";
import { getOperatorDashboard } from "./data/dashboardService";
import { initWebMonitoring } from "./lib/monitoring";
import { dispatchResidentNotifications } from "./data/residentService";
import { createOperatorTenant, listOperators, setOperatorStatus } from "./data/platformService";
import { updateOwnProfile } from "./data/profileService";
import {
  createComplianceCase,
  createServiceComplaint,
  listBillDeliveries,
  listComplianceCases,
  listServiceComplaints,
  listVehicleBrandingChecklists,
  recordBillDelivery,
  recordVehicleBrandingChecklist,
  updateComplianceCaseStatus,
  updateServiceComplaintStatus
} from "./data/lawmaComplianceService";
import { getOperatorCoverage } from "./data/coverageService";
import { getOperatorFleet, recordMaintenanceEvent, upsertDumpsiteSite } from "./data/fleetService";
import {
  dispatchResidentComms,
  getOperatorComms,
  queuePaymentReminders,
  sendPaymentReminders
} from "./data/commsService";
import { getOperatorReports } from "./data/reportsService";
import { getOperatorZoneTemplates, importCustomersBulk, saveZoneDefaultTemplate } from "./data/settingsService";
import {
  addRoutePlanStop,
  cancelRouteTruckHandoff,
  ensureDailyRoutesLoaded,
  finalizeRouteWithUnserviced,
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
  provisionCustomerLogin,
  requestCustomerPasswordReset,
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
import { filterCustomerLedger } from "./lib/adminFilters";
import { formatAppError, parseAmountNairaToKobo } from "./lib/errors";
import { deriveRouteProgress } from "./lib/routeProgress";

const metricIcons = [Truck, WalletCards, Users, AlertTriangle];
type View = "dashboard" | "routes" | "coverage" | "fleet" | "payments" | "reports" | "comms" | "staff" | "compliance" | "admin" | "settings";

const workspaceTitles: Record<View, string> = {
  dashboard: "Operations overview",
  routes: "Route operations",
  coverage: "Make-good & coverage",
  fleet: "Fleet, fuel & dumpsite",
  payments: "Payments & ledger",
  reports: "Ops & LAWMA reports",
  comms: "WhatsApp & SMS",
  staff: "Staff attendance",
  compliance: "Compliance",
  admin: "Admin master data",
  settings: "Operator settings"
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
  const todayIso = getOperationDate(auth?.profile.timezone ?? DEFAULT_OPERATION_TIME_ZONE);
  const [dashboard, setDashboard] = useState<OperatorDashboard | null>(null);
  const [routes, setRoutes] = useState<RouteDetail[]>([]);
  const [routeHandoffs, setRouteHandoffs] = useState<RouteTruckHandoff[]>([]);
  const [routeCovers, setRouteCovers] = useState<RouteCoverSummary[]>([]);
  const [payments, setPayments] = useState<PaymentLedgerItem[]>([]);
  const [incidents, setIncidents] = useState<IncidentReport[]>([]);
  const [serviceComplaints, setServiceComplaints] = useState<ServiceComplaint[]>([]);
  const [complianceCases, setComplianceCases] = useState<ComplianceCase[]>([]);
  const [billDeliveries, setBillDeliveries] = useState<BillDelivery[]>([]);
  const [coverage, setCoverage] = useState<OperatorCoverageSnapshot | null>(null);
  const [fleet, setFleet] = useState<OperatorFleetSnapshot | null>(null);
  const [reports, setReports] = useState<OperatorReportsSnapshot | null>(null);
  const [comms, setComms] = useState<OperatorCommsSnapshot | null>(null);
  const [zoneTemplates, setZoneTemplates] = useState<OperatorZoneTemplatesSnapshot | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsImporting, setSettingsImporting] = useState(false);
  const [fleetSaving, setFleetSaving] = useState(false);
  const [reportsRefreshing, setReportsRefreshing] = useState(false);
  const [commsBusy, setCommsBusy] = useState(false);
  const [vehicleChecklists, setVehicleChecklists] = useState<VehicleBrandingChecklist[]>([]);
  const [customerLedger, setCustomerLedger] = useState<CustomerLedgerItem[]>([]);
  const [adminData, setAdminData] = useState<AdminMasterData>(emptyAdminData);
  const [planningOptions, setPlanningOptions] = useState<RoutePlanningOptions>(emptyPlanningOptions);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [staffAttendance, setStaffAttendance] = useState<StaffAttendanceRow[]>([]);
  const [monthlyStaffSummary, setMonthlyStaffSummary] = useState<MonthlyStaffSummary[]>([]);
  const [operationDate, setOperationDate] = useState(() => getOperationDate());
  const [attendanceDate, setAttendanceDate] = useState(() => getOperationDate());
  const [summaryMonth, setSummaryMonth] = useState(() => getOperationMonth());
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
  const [platformOperators, setPlatformOperators] = useState<PlatformOperator[]>([]);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    initWebMonitoring();
  }, []);

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
    if (!auth?.profile.timezone) {
      return;
    }

    const tz = auth.profile.timezone;
    const nextToday = getOperationDate(tz);
    setOperationDate(nextToday);
    setAttendanceDate(nextToday);
    setSummaryMonth(getOperationMonth(tz));
  }, [auth?.profile.operatorId, auth?.profile.timezone]);

  useEffect(() => {
    if (!statusMessage) {
      return;
    }

    const timeoutId = setTimeout(() => setStatusMessage(null), 5000);
    return () => clearTimeout(timeoutId);
  }, [statusMessage]);

  useEffect(() => {
    if (!error) {
      return;
    }

    const timeoutId = setTimeout(() => setError(null), 8000);
    return () => clearTimeout(timeoutId);
  }, [error]);

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
        if (currentAuth.profile.role === "platform_admin") {
          setPlatformOperators(await listOperators());
        } else if (currentAuth.profile.role !== "resident") {
          await loadWorkspace(operationDate);
        }
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

    // Auto-load ward templates at start of day when nothing is planned yet.
    if (targetDate === todayIso && routesData.length === 0) {
      try {
        const ensured = await ensureDailyRoutesLoaded(targetDate);
        if (ensured.plannedCount > 0) {
          routesData = await getRoutes(targetDate);
          setStatusMessage(
            `Auto-loaded ${ensured.plannedCount} ward route template${ensured.plannedCount === 1 ? "" : "s"} for today.`
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
      nextAdminData,
      complaintData,
      complianceData,
      billDeliveryData,
      checklistData,
      coverageData,
      fleetData,
      zoneTemplatesData
    ] = await Promise.all([
      getOperatorDashboard(targetDate),
      getRouteTruckHandoffs(targetDate),
      getRouteCoverSummaries(targetDate),
      getPaymentLedger(),
      getCustomerLedger(),
      getStaffAttendance(targetDate),
      getMonthlyStaffSummary(summaryMonth),
      getRecentIncidentReports(targetDate),
      getRoutePlanningOptions(targetDate),
      getAdminMasterData(),
      listServiceComplaints(targetDate),
      listComplianceCases(),
      listBillDeliveries(`${targetDate.slice(0, 8)}01`),
      listVehicleBrandingChecklists(targetDate),
      getOperatorCoverage(targetDate),
      getOperatorFleet(targetDate),
      getOperatorZoneTemplates()
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
    setServiceComplaints(complaintData);
    setComplianceCases(complianceData);
    setBillDeliveries(billDeliveryData);
    setVehicleChecklists(checklistData);
    setCoverage(coverageData);
    setFleet(fleetData);
    setZoneTemplates(zoneTemplatesData);
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
          ? `Saved ${results.length} ward default template${results.length === 1 ? "" : "s"}.`
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

    setStatusMessage(null);
    setError(null);
    setActiveView(nextView);
    if (nextView === "comms") {
      void handleLoadComms();
    }
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
    setStatusMessage(null);
    setError(null);
    setPlatformOperators([]);
    setDashboard(null);
    setRoutes([]);
    setPayments([]);
    setIncidents([]);
    setServiceComplaints([]);
    setComplianceCases([]);
    setBillDeliveries([]);
    setCoverage(null);
    setFleet(null);
    setZoneTemplates(null);
    setVehicleChecklists([]);
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

  async function handleSignIn(email: string, password: string) {
    setLoading(true);
    setError(null);

    try {
      const signedIn = await signInOperator(email, password);
      setAuth(signedIn);
      if (signedIn.profile.role === "platform_admin") {
        setPlatformOperators(await listOperators());
      } else if (signedIn.profile.role !== "resident") {
        await loadWorkspace(operationDate);
      }
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

  async function handleFinalizeRouteWithUnserviced(routeId: string) {
    setStatusMessage(null);
    setError(null);
    setRouteInlineError(null);

    const note = window.prompt(
      "Close this incomplete route? Remaining pending stops become missed and recover tomorrow. Optional note:",
      "Unserviced at supervisor route close"
    );

    if (note === null) {
      return;
    }

    try {
      const { routes: nextRoutes, result } = await finalizeRouteWithUnserviced(
        routeId,
        note.trim() || undefined,
        operationDate
      );
      setRoutes(nextRoutes);
      await getOperatorDashboard(operationDate).then(setDashboard);
      void dispatchResidentNotifications().catch(() => undefined);
      setStatusMessage(
        `Route closed (${result.outcome.replace("_", " ")}). ${result.recoveredStops} stop${
          result.recoveredStops === 1 ? "" : "s"
        } queued for next-day recovery.`
      );
    } catch (err) {
      setRouteInlineError({
        area: "routeAction",
        message: err instanceof Error ? err.message : "Unable to close incomplete route"
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
      const { routes: nextRoutes, warning } = await addRoutePlanStop(routeId, customerId, operationDate);
      await refreshRoutesForSelectedDate(nextRoutes);
      setStatusMessage(warning ? `Stop added to route plan. ${warning}` : "Stop added to route plan.");
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
      getRoutePlanningOptions(operationDate),
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

  async function handleProvisionCustomerLogin(input: CustomerLoginProvisionInput) {
    setStatusMessage(null);
    const result = await provisionCustomerLogin(input);
    await refreshAdminData();
    setStatusMessage(`Resident login created for ${result.loginEmail}.`);
    return result;
  }

  async function handleRequestStaffPasswordReset(staffId: string) {
    setStatusMessage(null);
    const result = await requestStaffPasswordReset(staffId);
    setStatusMessage(`Password reset email sent to ${result.loginEmail}. Check Inbucket locally.`);
    return result;
  }

  async function handleRequestCustomerPasswordReset(customerId: string) {
    setStatusMessage(null);
    const result = await requestCustomerPasswordReset(customerId);
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

  async function refreshComplianceData(targetDate = operationDate) {
    const [complaintData, complianceData, billDeliveryData, checklistData] = await Promise.all([
      listServiceComplaints(targetDate),
      listComplianceCases(),
      listBillDeliveries(`${targetDate.slice(0, 8)}01`),
      listVehicleBrandingChecklists(targetDate)
    ]);
    setServiceComplaints(complaintData);
    setComplianceCases(complianceData);
    setBillDeliveries(billDeliveryData);
    setVehicleChecklists(checklistData);
  }

  async function handleCreateServiceComplaint(input: CreateServiceComplaintInput) {
    setStatusMessage(null);
    await createServiceComplaint(input);
    await refreshComplianceData();
    setStatusMessage("Complaint logged. 24h SLA clock started.");
  }

  async function handleUpdateServiceComplaint(
    id: string,
    status: ServiceComplaint["status"],
    notes?: string
  ) {
    setStatusMessage(null);
    await updateServiceComplaintStatus(id, status, notes);
    await refreshComplianceData();
    setStatusMessage(`Complaint marked ${status}.`);
  }

  async function handleCreateComplianceCase(input: CreateComplianceCaseInput) {
    setStatusMessage(null);
    await createComplianceCase(input);
    await refreshComplianceData();
    setStatusMessage("Compliance case opened.");
  }

  async function handleUpdateComplianceCase(
    id: string,
    status: ComplianceCase["status"],
    notes?: string
  ) {
    setStatusMessage(null);
    await updateComplianceCaseStatus(id, status, notes);
    await refreshComplianceData();
    setStatusMessage(`Compliance case marked ${status}.`);
  }

  async function handleRecordBillDelivery(input: RecordBillDeliveryInput) {
    setStatusMessage(null);
    await recordBillDelivery(input);
    await refreshComplianceData();
    setStatusMessage("Bill delivery recorded.");
  }

  async function handleRecordVehicleChecklist(input: RecordVehicleBrandingChecklistInput) {
    setStatusMessage(null);
    await recordVehicleBrandingChecklist(input);
    await refreshComplianceData();
    setStatusMessage("Vehicle branding / PPE checklist saved.");
  }

  async function handleSaveZoneTemplate(input: {
    zoneId: string;
    truckId: string;
    driverId: string | null;
    customerIds: string[];
  }) {
    setSettingsSaving(true);
    setError(null);
    setStatusMessage(null);
    try {
      const result = await saveZoneDefaultTemplate(input);
      const nextTemplates = await getOperatorZoneTemplates();
      setZoneTemplates(nextTemplates);
      setStatusMessage(
        `Saved ${result.zoneName} template with ${result.stopCount} stop${result.stopCount === 1 ? "" : "s"}.`
      );
    } finally {
      setSettingsSaving(false);
    }
  }

  async function handleImportCustomers(input: {
    rows: Parameters<typeof importCustomersBulk>[0]["rows"];
    addToZoneTemplates: boolean;
  }) {
    setSettingsImporting(true);
    setError(null);
    setStatusMessage(null);
    try {
      const result = await importCustomersBulk({
        rows: input.rows,
        addToZoneTemplates: input.addToZoneTemplates,
        importMarker: "bulk-import"
      });
      const [nextTemplates, nextAdminData, nextLedger] = await Promise.all([
        getOperatorZoneTemplates(),
        getAdminMasterData(),
        getCustomerLedger()
      ]);
      setZoneTemplates(nextTemplates);
      setAdminData(nextAdminData);
      setCustomerLedger(nextLedger);
      setStatusMessage(
        `Imported ${result.inserted} customer${result.inserted === 1 ? "" : "s"}` +
          (result.skippedDuplicates > 0
            ? ` (${result.skippedDuplicates} duplicate phone${result.skippedDuplicates === 1 ? "" : "s"} skipped)`
            : "") +
          "."
      );
      return result;
    } finally {
      setSettingsImporting(false);
    }
  }

  async function handleRecordMaintenance(input: RecordMaintenanceEventInput) {
    setFleetSaving(true);
    setError(null);
    setStatusMessage(null);
    try {
      const result = await recordMaintenanceEvent(input);
      setFleet(await getOperatorFleet(operationDate));
      setStatusMessage(`Recorded maintenance for ${result.truckRegistration}.`);
    } finally {
      setFleetSaving(false);
    }
  }

  async function handleUpsertDumpsiteSite(input: UpsertDumpsiteSiteInput) {
    setFleetSaving(true);
    setError(null);
    setStatusMessage(null);
    try {
      const result = await upsertDumpsiteSite(input);
      setFleet(await getOperatorFleet(operationDate));
      setStatusMessage(`Saved dumpsite site ${result.name}.`);
    } finally {
      setFleetSaving(false);
    }
  }

  async function handleLoadReports(fromDate: string, toDate: string) {
    setReportsRefreshing(true);
    setError(null);
    try {
      setReports(await getOperatorReports(fromDate, toDate));
    } finally {
      setReportsRefreshing(false);
    }
  }

  async function handleLoadComms() {
    setCommsBusy(true);
    setError(null);
    try {
      setComms(await getOperatorComms());
    } finally {
      setCommsBusy(false);
    }
  }

  async function handleQueueReminders(daysBeforeDue: 2 | 5, force: boolean) {
    setCommsBusy(true);
    setError(null);
    setStatusMessage(null);
    try {
      const result = await queuePaymentReminders(daysBeforeDue, force);
      setComms(await getOperatorComms());
      if (result.message && result.queued === 0) {
        setStatusMessage(result.message);
      } else {
        setStatusMessage(
          `Queued ${result.queued} ${daysBeforeDue}-day reminder${result.queued === 1 ? "" : "s"}.`
        );
      }
    } catch (queueError) {
      setError(queueError instanceof Error ? queueError.message : "Failed to queue reminders");
    } finally {
      setCommsBusy(false);
    }
  }

  async function handleSendReminders(daysBeforeDue: 2 | 5, force: boolean) {
    setCommsBusy(true);
    setError(null);
    setStatusMessage(null);
    try {
      const result = await sendPaymentReminders(daysBeforeDue, { force, dispatch: true });
      setComms(await getOperatorComms());
      const queued = result.queue.queued ?? 0;
      const sent = result.dispatch?.sent ?? 0;
      const failed = result.dispatch?.failed ?? 0;
      if (result.queue.message && queued === 0) {
        setStatusMessage(result.queue.message);
      } else {
        setStatusMessage(
          `Queued ${queued} reminder${queued === 1 ? "" : "s"}; sent ${sent}, failed ${failed}.`
        );
      }
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Failed to send reminders");
    } finally {
      setCommsBusy(false);
    }
  }

  async function handleDispatchComms() {
    setCommsBusy(true);
    setError(null);
    setStatusMessage(null);
    try {
      const result = await dispatchResidentComms();
      setComms(await getOperatorComms());
      setStatusMessage(
        `Flushed queue: claimed ${result.claimed ?? 0}, sent ${result.sent ?? 0}, failed ${result.failed ?? 0}.`
      );
    } catch (dispatchError) {
      setError(dispatchError instanceof Error ? dispatchError.message : "Failed to flush message queue");
    } finally {
      setCommsBusy(false);
    }
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
    return <LoginScreen error={error} onSignIn={(email, password) => void handleSignIn(email, password)} statusMessage={statusMessage} />;
  }

  if (auth.profile.role === "platform_admin") {
    return (
      <PlatformAdminView
        operators={platformOperators}
        platformName={auth.profile.fullName.split(" ")[0] || auth.profile.fullName}
        onCreateOperator={async (input) => {
          const result = await createOperatorTenant({
            ...input,
            status: "trial"
          });
          setStatusMessage(`Onboarded ${result.brandName}.`);
          return result;
        }}
        onRefresh={async () => {
          setPlatformOperators(await listOperators());
        }}
        onSetStatus={async (operatorId, status) => {
          await setOperatorStatus({ operatorId, status });
          setStatusMessage(`Operator marked ${status}.`);
        }}
        onSignOut={() => void handleSignOut()}
      />
    );
  }

  if (auth.profile.role === "resident") {
    return <ResidentApp fullName={auth.profile.fullName} onSignOut={() => void handleSignOut()} />;
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
        brandName={auth.profile.brandName ?? auth.profile.operatorName}
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

      <div className="toast-stack" aria-live="polite">
        {error ? <p className="notice error">{error}</p> : null}
        {statusMessage ? <p className="notice">{statusMessage}</p> : null}
      </div>

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
          brandName={auth.profile.brandName ?? auth.profile.operatorName}
          dashboard={dashboard}
          incidents={incidents}
          operationDate={operationDate}
          routes={routes}
          todayIso={todayIso}
          onOpenRoutes={(routeId) => {
            if (routeId) {
              setSelectedRouteId(routeId);
            }
            requestViewChange("routes");
          }}
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
          onFinalizeRouteWithUnserviced={handleFinalizeRouteWithUnserviced}
          onUpdateStop={handleStopStatus}
        />
      ) : null}
      {activeView === "coverage" ? (
        <CoverageView
          coverage={coverage}
          operationDate={operationDate}
          onRefresh={() => void handleRefresh()}
          refreshing={refreshing}
        />
      ) : null}
      {activeView === "fleet" ? (
        <FleetView
          fleet={fleet}
          operationDate={operationDate}
          onRefresh={() => void handleRefresh()}
          onRecordMaintenance={handleRecordMaintenance}
          onUpsertDumpsiteSite={handleUpsertDumpsiteSite}
          refreshing={refreshing}
          saving={fleetSaving}
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
      {activeView === "reports" ? (
        <ReportsView
          operationDate={operationDate}
          onLoad={handleLoadReports}
          refreshing={reportsRefreshing}
          reports={reports}
        />
      ) : null}
      {activeView === "comms" ? (
        <CommsView
          busy={commsBusy}
          comms={comms}
          onDispatch={handleDispatchComms}
          onQueueReminders={handleQueueReminders}
          onRefresh={handleLoadComms}
          onSendReminders={handleSendReminders}
          refreshing={commsBusy}
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
      {activeView === "compliance" ? (
        <ComplianceView
          billDeliveries={billDeliveries}
          billPeriodStart={`${operationDate.slice(0, 8)}01`}
          checklists={vehicleChecklists}
          complaints={serviceComplaints}
          complianceCases={complianceCases}
          customerLedger={customerLedger}
          onCreateComplaint={handleCreateServiceComplaint}
          onCreateComplianceCase={handleCreateComplianceCase}
          onRecordBillDelivery={handleRecordBillDelivery}
          onRecordChecklist={handleRecordVehicleChecklist}
          onUpdateComplaintStatus={handleUpdateServiceComplaint}
          onUpdateComplianceStatus={handleUpdateComplianceCase}
          trucks={adminData.trucks.map((truck) => ({
            id: truck.id,
            registrationNumber: truck.registrationNumber
          }))}
        />
      ) : null}
      {activeView === "admin" ? (
        <AdminView
          adminData={adminData}
          operatorId={auth.profile.operatorId}
          onOnboardCustomer={handleOnboardCustomer}
          onOnboardStaff={handleOnboardStaff}
          onOnboardTruck={handleOnboardTruck}
          onProvisionCustomerLogin={handleProvisionCustomerLogin}
          onProvisionStaffLogin={handleProvisionStaffLogin}
          onRequestCustomerPasswordReset={handleRequestCustomerPasswordReset}
          onRequestStaffPasswordReset={handleRequestStaffPasswordReset}
          onSetCustomerServiceStatus={handleSetCustomerServiceStatus}
          onSetStaffActive={handleSetStaffActive}
          onSetTruckActive={handleSetTruckActive}
          onUpdateCustomer={handleUpdateCustomer}
          onUpdateStaff={handleUpdateStaff}
          onUpdateTruck={handleUpdateTruck}
        />
      ) : null}
      {activeView === "settings" ? (
        <SettingsView
          templates={zoneTemplates}
          onRefresh={() => void handleRefresh()}
          onSaveZoneTemplate={handleSaveZoneTemplate}
          onImportCustomers={handleImportCustomers}
          refreshing={refreshing}
          saving={settingsSaving}
          importing={settingsImporting}
        />
      ) : null}
      </div>
    </main>
  );
}

function LoginScreen({
  error,
  onSignIn,
  statusMessage
}: {
  error: string | null;
  onSignIn: (email: string, password: string) => void;
  statusMessage?: string | null;
}) {
  const [email, setEmail] = useState(demoCredentials.email);
  const [password, setPassword] = useState(demoCredentials.password);
  const [mode, setMode] = useState<"signIn" | "forgot">("signIn");
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotMessage, setForgotMessage] = useState<string | null>(null);
  const [forgotError, setForgotError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSignIn(email, password);
  }

  async function handleForgotSubmit(event: FormEvent) {
    event.preventDefault();
    setForgotBusy(true);
    setForgotError(null);
    setForgotMessage(null);

    try {
      const result = await requestPasswordReset(email);
      setForgotMessage(result.message);
    } catch (err) {
      setForgotError(err instanceof Error ? err.message : "Unable to send reset email.");
    } finally {
      setForgotBusy(false);
    }
  }

  if (mode === "forgot") {
    return (
      <main className="app-shell login-shell">
        <section className="login-card">
          <p className="eyebrow">CleanOps</p>
          <h1>Forgot password</h1>
          <p>Enter the login email for your operator, platform, or staff account. We will email a reset link if that account exists.</p>
          {forgotMessage ? <p className="notice">{forgotMessage}</p> : null}
          {forgotError ? <p className="notice error">{forgotError}</p> : null}
          <form className="login-form" onSubmit={(event) => void handleForgotSubmit(event)}>
            <label>
              Email
              <input
                autoComplete="username"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </label>
            <button className="primary-button" disabled={forgotBusy} type="submit">
              {forgotBusy ? "Sending..." : "Send reset link"}
            </button>
          </form>
          <button
            className="ghost-button"
            onClick={() => {
              setMode("signIn");
              setForgotError(null);
              setForgotMessage(null);
            }}
            style={{ marginTop: 12 }}
            type="button"
          >
            Back to sign in
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell login-shell">
      <section className="login-card">
        <p className="eyebrow">CleanOps</p>
        <h1>Operator workspace</h1>
        <p>Sign in to manage routes, payments, attendance, and admin for your operator.</p>
        {statusMessage ? <p className="notice">{statusMessage}</p> : null}
        {error ? <p className="notice error">{error}</p> : null}
        <form className="login-form" onSubmit={handleSubmit}>
          <label>
            Email
            <input
              autoComplete="username"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label>
            Password
            <input
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          <button className="primary-button" type="submit">
            Sign in
          </button>
        </form>
        <button
          className="ghost-button"
          onClick={() => {
            setMode("forgot");
            setForgotError(null);
            setForgotMessage(null);
          }}
          style={{ marginTop: 12 }}
          type="button"
        >
          Forgot password?
        </button>
        <p className="login-demo-hint">
          Local demo: {demoCredentials.email} / {demoCredentials.password}. Use a provisioned staff login, or{" "}
          platform@cleanops.local / cleanops-platform-password for the platform console.
        </p>
      </section>
    </main>
  );
}

function parseRouteProgress(value: string): { completed: number; total: number; pct: number } | null {
  const match = value.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) {
    return null;
  }

  const completed = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0) {
    return null;
  }

  return {
    completed,
    total,
    pct: Math.round((completed / total) * 100)
  };
}

function DashboardView({
  brandName,
  dashboard,
  incidents,
  operationDate,
  routes,
  todayIso,
  onOpenRoutes
}: {
  brandName?: string | null;
  dashboard: OperatorDashboard;
  incidents: IncidentReport[];
  operationDate: string;
  routes: RouteDetail[];
  todayIso: string;
  onOpenRoutes: (routeId?: string) => void;
}) {
  const openIncidents = incidents.filter((incident) => !incident.resolvedAt).length;
  const activeVehicleCount = dashboard.fleet.filter((truck) => truck.status === "operational").length;
  const zoneHint = routes[0]?.zoneName ?? null;

  return (
    <>
      <section className="metric-grid" aria-label="Operational metrics">
        {dashboard.metrics.map((metric, index) => {
          const Icon = metricIcons[index] ?? CheckCircle2;
          const isIncidents = metric.label.toLowerCase().includes("incident");
          const displayValue =
            metric.label === "Payments" ? metric.value.replace(/^[?\uFFFD₦]+/, "NGN ") : metric.value;
          const routeProgress =
            metric.label === "Route Progress" ? parseRouteProgress(metric.value) : null;

          return (
            <article
              className={isIncidents && openIncidents > 0 ? "metric-card tone-danger" : "metric-card"}
              key={metric.label}
            >
              <div className="metric-card-head">
                <Icon aria-hidden="true" size={20} />
                {routeProgress ? (
                  <span
                    aria-hidden="true"
                    className="metric-ring"
                    style={{ ["--ring-progress" as string]: `${routeProgress.pct * 3.6}deg` }}
                  >
                    {routeProgress.pct}%
                  </span>
                ) : null}
              </div>
              <span className="metric-label">{metric.label}</span>
              <strong>{displayValue}</strong>
              <small className="metric-helper">{metric.helper}</small>
            </article>
          );
        })}
      </section>

      <DashboardRouteMonitor
        activeVehicleCount={activeVehicleCount}
        routes={routes}
        onOpenRoutes={onOpenRoutes}
      />

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

      <DashboardBrandFooter
        brandName={brandName}
        operatorName={dashboard.operatorName}
        zoneHint={zoneHint}
      />
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
  onFinalizeRouteWithUnserviced,
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
  onFinalizeRouteWithUnserviced: (routeId: string) => void;
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
  const availableCustomers = planningOptions.customers
    .filter((customer) => customer.zoneId === selectedRoute?.zoneId && !customersAlreadyPlanned.has(customer.id))
    .sort((a, b) => {
      const dueDelta = Number(Boolean(b.dueToday)) - Number(Boolean(a.dueToday));
      if (dueDelta !== 0) {
        return dueDelta;
      }
      return a.label.localeCompare(b.label);
    });
  // Floating fleet: any active truck can be assigned; soft-sort home-ward matches first.
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
            Plan selected date from ward templates
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
                  <>
                    {pendingStops > 0 ? (
                      <button onClick={() => onFinalizeRouteWithUnserviced(selectedRoute.id)} type="button">
                        Close incomplete (recover tomorrow)
                      </button>
                    ) : null}
                    <button onClick={() => onUpdateRouteStatus(selectedRoute.id, "cancelled")} type="button">
                      Cancel route
                    </button>
                  </>
                ) : (
                  <small>No route-level operator actions available.</small>
                )}
              </div>
              {routeInlineError?.area === "routeAction" ? (
                <p className="inline-error">{routeInlineError.message}</p>
              ) : null}
            </div>
            <p className="panel-subtitle">
              Route start and completion are field actions. Supervisors can close an incomplete route to queue
              remaining due stops for next-day recovery, cancel a route, reassign trucks with driver confirmation, or
              correct individual stops when driver updates fail to transmit.
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
                    can cover this ward. Home ward trucks are listed first.
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
                          {customer.dueToday ? "Due today · " : ""}
                          {customer.label}
                          {customer.helper ? ` — ${customer.helper}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    disabled={!selectedCustomerToAdd}
                    onClick={() => {
                      if (!selectedCustomerToAdd) {
                        return;
                      }
                      const customer = availableCustomers.find((entry) => entry.id === selectedCustomerToAdd);
                      if (customer && !customer.dueToday) {
                        const confirmed = window.confirm(
                          `${customer.label} is not due on this preferred weekday. Add them as a manual override?`
                        );
                        if (!confirmed) {
                          return;
                        }
                      }
                      onAddRouteStop(selectedRoute.id, selectedCustomerToAdd);
                      setSelectedCustomerToAdd("");
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
                const isSuspended = stop.serviceStatus === "suspended";
                const completeDisabled = routeFinalized || (isSuspended && !stopIsCompleted);

                return (
                  <div className="stop-row stop-row-detailed" key={stop.id}>
                    <div>
                      <strong>
                        #{stop.stopSequence} {stop.customerName}
                        {stop.isMakeGood ? (
                          <span className="pill" style={{ marginLeft: 8 }}>
                            Make-good
                          </span>
                        ) : null}
                        {isSuspended ? (
                          <span className="pill danger" style={{ marginLeft: 8 }}>
                            Suspended
                          </span>
                        ) : null}
                      </strong>
                      <span>{stop.address}</span>
                      {isSuspended ? (
                        <p className="field-skip-reason">
                          <strong>Service suspended</strong>
                          Do not mark complete — skip with a reason if the truck reached this stop.
                        </p>
                      ) : null}
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
                    <span className={`pill ${stop.status === "skipped" || isSuspended ? "danger" : ""}`}>
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
                          disabled={completeDisabled}
                          onClick={() =>
                            onUpdateStop(selectedRoute.id, stop.id, nextCompleteStatus, notes[stop.id])
                          }
                          title={
                            isSuspended && !stopIsCompleted
                              ? "Cannot complete a suspended customer stop"
                              : undefined
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
  const [customerSearch, setCustomerSearch] = useState("");
  const [amountNaira, setAmountNaira] = useState("");
  const [channel, setChannel] = useState<PaymentChannel>("agent_cash");
  const [externalReference, setExternalReference] = useState("");
  const [tagMonth, setTagMonth] = useState(getOperationMonth);
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

  const filteredCustomerLedger = filterCustomerLedger(customerLedger, customerSearch);
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

        <div className="admin-toolbar">
          <div className="admin-toolbar-filters">
            <label>
              Search customers
              <input
                onChange={(event) => setCustomerSearch(event.target.value)}
                placeholder="Name, phone, address, or ward"
                type="search"
                value={customerSearch}
              />
            </label>
          </div>
          <span className="admin-result-count">
            Showing {filteredCustomerLedger.length} of {customerLedger.length}
          </span>
        </div>

        <div className="stack-list">
          {filteredCustomerLedger.length === 0 ? (
            <p className="admin-empty">
              {customerLedger.length === 0
                ? "No customers in the ledger yet."
                : "No customers match your search."}
            </p>
          ) : (
            filteredCustomerLedger.map((customer) => (
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
                <span>
                  {formatCollectionFrequency(customer.collectionsPerWeek, customer.preferredWeekdays)}
                </span>
                <span className={`pill ${customer.serviceStatus === "suspended" ? "danger" : ""}`}>
                  {customer.serviceStatus}
                </span>
                {customer.serviceStatus === "suspended" && customer.suspensionReason ? (
                  <span className="suspension-note">{customer.suspensionReason}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </article>

      <article className="panel payment-detail-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Account Detail</p>
            <h2>{selectedCustomer?.displayName ?? "No customer selected"}</h2>
            {selectedCustomer ? (
              <p className="panel-subtitle">
                {selectedCustomer.address} · {selectedCustomer.customerType.replace("_", " ")} ·{" "}
                {formatCollectionFrequency(
                  selectedCustomer.collectionsPerWeek,
                  selectedCustomer.preferredWeekdays
                )}
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
