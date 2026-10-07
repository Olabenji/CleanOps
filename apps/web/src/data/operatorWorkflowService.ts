import {
  adminMasterDataSchema,
  attendanceOverrideSchema,
  customerOnboardingInputSchema,
  customerUpdateInputSchema,
  customerLedgerItemSchema,
  incidentReportSchema,
  operatorAgentCollectionsSnapshotSchema,
  monthlyStaffSummarySchema,
  paymentLedgerItemSchema,
  paymentEntrySchema,
  proposeRouteTruckHandoffInputSchema,
  routeDetailSchema,
  routePlanningOptionsSchema,
  routeStopStatuses,
  routeTruckHandoffSchema,
  routeCoverSummarySchema,
  saveRouteAsTemplateInputSchema,
  saveRouteAsTemplateResultSchema,
  ensureDailyRoutesResultSchema,
  finalizeRouteWithUnservicedResultSchema,
  getOperationDate,
  getOperationMonth,
  staffOnboardingInputSchema,
  staffOnboardingResultSchema,
  staffLoginProvisionInputSchema,
  staffPasswordResetTargetSchema,
  customerLoginProvisionInputSchema,
  customerLoginProvisionResultSchema,
  customerPasswordResetTargetSchema,
  staffAttendanceRowSchema,
  staffUpdateInputSchema,
  truckOnboardingInputSchema,
  truckUpdateInputSchema,
  type AdminMasterData,
  type AttendanceOverride,
  type CustomerLedgerItem,
  type CustomerOnboardingInput,
  type CustomerUpdateInput,
  type EnsureDailyRoutesResult,
  type FinalizeRouteWithUnservicedResult,
  type IncidentReport,
  type MonthlyStaffSummary,
  type OperatorAgentCollectionsSnapshot,
  type PaymentEntry,
  type PaymentLedgerItem,
  type ProposeRouteTruckHandoffInput,
  type RouteCoverSummary,
  type RouteDetail,
  type RoutePlanningOptions,
  type RouteStatus,
  type RouteStopStatus,
  type RouteTruckHandoff,
  type SaveRouteAsTemplateInput,
  type SaveRouteAsTemplateResult,
  type StaffOnboardingInput,
  type StaffOnboardingResult,
  type StaffLoginProvisionInput,
  type CustomerLoginProvisionInput,
  type CustomerLoginProvisionResult,
  type StaffAttendanceRow,
  type StaffUpdateInput,
  type TruckOnboardingInput,
  type TruckUpdateInput
} from "@cleanops/shared";
import { deriveRouteProgress } from "../lib/routeProgress";
import { formatAppError } from "../lib/errors";
import { supabase } from "../lib/supabase";
import { requestPasswordReset } from "./authService";
import {
  applyPilotAttendanceOverride,
  getPilotMonthlyStaffSummary,
  getPilotOperatorAgentCollections,
  getPilotPaymentHistory,
  pilotIncidentReports,
  pilotCustomerLedger,
  pilotPayments,
  pilotRouteDetails,
  pilotStaffAttendance,
  recordPilotPayment,
  updatePilotCustomerStatus,
  updatePilotRouteStatus,
  updatePilotStopStatus
} from "./pilotWorkflows";

type RawRouteStop = {
  id: string;
  stop_sequence: number;
  status: string;
  completed_at: string | null;
  notes: string | null;
  skip_reason: string | null;
  is_make_good?: boolean | null;
  proof_photo_path?: string | null;
  customers:
    | {
        display_name?: string;
        id?: string;
        address?: string;
        service_status?: string;
      }
    | Array<{
        display_name?: string;
        id?: string;
        address?: string;
        service_status?: string;
      }>
    | null;
};

export async function getRoutes(operationDate?: string): Promise<RouteDetail[]> {
  if (!supabase) {
    return filterPilotRoutesByDate(operationDate).map(deriveRouteProgress);
  }

  if (operationDate) {
    const { error: reconcileError } = await supabase.rpc("reconcile_routes_for_date", {
      input_date: operationDate
    });

    if (reconcileError) {
      console.warn("Route reconcile skipped:", reconcileError.message);
    }
  }

  let query = supabase
    .from("routes")
    .select(
      `
      id,
      zone_id,
      truck_id,
      driver_id,
      scheduled_date,
      started_at,
      completed_at,
      status,
      zones(name),
      trucks(registration_number),
      staff_members(full_name),
      route_stops(
        id,
        stop_sequence,
        status,
        completed_at,
        notes,
        skip_reason,
        is_make_good,
        proof_photo_path,
        customers(id, display_name, address, service_status)
      )
    `
    )
    .order("scheduled_date", { ascending: false });

  if (operationDate) {
    query = query.eq("scheduled_date", operationDate);
  }

  query = query.neq("status", "cancelled");

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  if (!data || data.length === 0) {
    return [];
  }

  return (data.map(mapRoute).filter(Boolean) as RouteDetail[]).map(deriveRouteProgress);
}

export async function updateRouteStopStatus(
  routeId: string,
  stopId: string,
  status: RouteStopStatus,
  notes?: string,
  skipReason?: string,
  operationDate?: string
): Promise<RouteDetail[]> {
  if (!routeStopStatuses.includes(status)) {
    throw new Error(`Unsupported stop status: ${status}`);
  }

  if (!supabase) {
    updatePilotStopStatus(routeId, stopId, status, notes, skipReason);
    return filterPilotRoutesByDate(operationDate);
  }

  const { error } = await supabase.rpc("update_route_stop_status", {
    input_stop_id: stopId,
    next_status: status,
    input_notes: notes ?? null,
    input_skip_reason: skipReason ?? null
  });

  if (error) {
    throw new Error(error.message);
  }

  return getRoutes(operationDate);
}

export async function transitionRouteStatus(routeId: string, status: RouteStatus, operationDate?: string): Promise<RouteDetail[]> {
  if (!supabase) {
    updatePilotRouteStatus(routeId, status);
    return filterPilotRoutesByDate(operationDate);
  }

  const { error } = await supabase.rpc("transition_route_status", {
    input_route_id: routeId,
    next_status: status
  });

  if (error) {
    throw new Error(error.message);
  }

  return getRoutes(operationDate);
}

export async function finalizeRouteWithUnserviced(
  routeId: string,
  note?: string,
  operationDate?: string
): Promise<{ routes: RouteDetail[]; result: FinalizeRouteWithUnservicedResult }> {
  if (!supabase) {
    throw new Error("Closing incomplete routes requires Supabase");
  }

  const { data, error } = await supabase.rpc("finalize_route_with_unserviced", {
    input_route_id: routeId,
    input_note: note ?? null
  });

  if (error || !data) {
    throw new Error(error?.message ?? "Unable to close incomplete route");
  }

  return {
    result: finalizeRouteWithUnservicedResultSchema.parse(data),
    routes: await getRoutes(operationDate)
  };
}

export async function getPaymentLedger(): Promise<PaymentLedgerItem[]> {
  if (!supabase) {
    return pilotPayments;
  }

  const { data, error } = await supabase
    .from("payments")
    .select(
      `
      id,
      channel,
      amount_kobo,
      paid_at,
      customers(display_name, customer_type, address, service_status)
    `
    )
    .order("paid_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new Error(error.message);
  }

  if (!data || data.length === 0) {
    return [];
  }

  return data.map((payment) => {
    const customer = Array.isArray(payment.customers) ? payment.customers[0] : payment.customers;

    return paymentLedgerItemSchema.parse({
      id: payment.id,
      customerName: customer?.display_name ?? "Unknown customer",
      channel: payment.channel,
      amountKobo: payment.amount_kobo,
      paidAt: payment.paid_at,
      customerType: customer?.customer_type ?? "residential",
      address: customer?.address ?? "No address",
      serviceStatus: customer?.service_status ?? "active"
    });
  });
}

export async function getCustomerLedger(): Promise<CustomerLedgerItem[]> {
  if (!supabase) {
    return pilotCustomerLedger;
  }

  const { data, error } = await supabase.rpc("customer_ledger_snapshot");

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return [];
  }

  return customerLedgerItemSchema.array().parse(data);
}

export async function getCustomerPaymentHistory(customerId: string): Promise<PaymentLedgerItem[]> {
  if (!supabase) {
    return getPilotPaymentHistory(customerId);
  }

  const { data, error } = await supabase.rpc("customer_payment_history", {
    input_customer_id: customerId
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return [];
  }

  return paymentLedgerItemSchema.array().parse(data);
}

export async function recordPayment(entry: PaymentEntry): Promise<CustomerLedgerItem[]> {
  const parsed = paymentEntrySchema.safeParse(entry);
  if (!parsed.success) {
    throw new Error(formatAppError(parsed.error, "Enter a valid payment amount greater than zero."));
  }

  if (!supabase) {
    return recordPilotPayment(parsed.data);
  }

  const { error } = await supabase.rpc("record_operator_payment", {
    input_customer_id: parsed.data.customerId,
    input_channel: parsed.data.channel,
    input_amount_kobo: parsed.data.amountKobo,
    input_external_reference: parsed.data.externalReference ?? null
  });

  if (error) {
    throw new Error(error.message);
  }

  return getCustomerLedger();
}

export async function updateCustomerAccountStatus(
  customerId: string,
  status: CustomerLedgerItem["serviceStatus"],
  tagMonth?: string,
  suspensionReason?: string
): Promise<CustomerLedgerItem[]> {
  if (!supabase) {
    return updatePilotCustomerStatus(customerId, status, tagMonth, suspensionReason);
  }

  const { error } = await supabase.rpc("update_customer_account_status", {
    input_customer_id: customerId,
    next_status: status,
    next_tag_month: tagMonth ?? null,
    input_suspension_reason: suspensionReason ?? null
  });

  if (error) {
    throw new Error(error.message);
  }

  return getCustomerLedger();
}

export async function getOperatorAgentCollections(
  collectionDate = getOperationDate()
): Promise<OperatorAgentCollectionsSnapshot> {
  if (!supabase) {
    return getPilotOperatorAgentCollections(collectionDate);
  }

  const { data, error } = await supabase.rpc("operator_agent_collections_snapshot", {
    input_date: collectionDate
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return {
      collectionDate,
      agents: [],
      totalCollectedKobo: 0,
      paymentCount: 0
    };
  }

  return operatorAgentCollectionsSnapshotSchema.parse(data);
}

export async function getStaffAttendance(
  attendanceDate = getOperationDate()
): Promise<StaffAttendanceRow[]> {
  if (!supabase) {
    return pilotStaffAttendance;
  }

  const { data, error } = await supabase.rpc("attendance_snapshot", {
    input_date: attendanceDate
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return [];
  }

  return staffAttendanceRowSchema.array().parse(data);
}

export async function recordAttendanceOverride(override: AttendanceOverride): Promise<StaffAttendanceRow[]> {
  const parsed = attendanceOverrideSchema.parse(override);

  if (!supabase) {
    return applyPilotAttendanceOverride(parsed);
  }

  const { error } = await supabase.rpc("record_attendance_override", {
    input_staff_member_id: parsed.staffMemberId,
    input_attendance_date: parsed.attendanceDate,
    input_checked_in: parsed.checkedIn,
    input_reason: parsed.reason ?? null,
    input_note: parsed.note ?? null
  });

  if (error) {
    throw new Error(error.message);
  }

  return getStaffAttendance(parsed.attendanceDate);
}

export async function getMonthlyStaffSummary(
  month = getOperationMonth()
): Promise<MonthlyStaffSummary[]> {
  if (!supabase) {
    return getPilotMonthlyStaffSummary();
  }

  const { data, error } = await supabase.rpc("monthly_staff_summary", {
    input_month: month
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return [];
  }

  return monthlyStaffSummarySchema.array().parse(data);
}

export async function getRecentIncidentReports(operationDate?: string): Promise<IncidentReport[]> {
  if (!supabase) {
    return filterPilotIncidentsByDate(operationDate);
  }

  const { data, error } = await supabase.rpc("recent_incident_reports", {
    input_limit: 10,
    input_date: operationDate ?? null
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return [];
  }

  return incidentReportSchema.array().parse(data);
}

export async function planDailyRoutes(operationDate: string): Promise<number> {
  if (!supabase) {
    return 0;
  }

  const { data, error } = await supabase.rpc("plan_daily_routes", {
    input_scheduled_date: operationDate
  });

  if (error) {
    throw new Error(error.message);
  }

  return Number(data ?? 0);
}

export async function ensureDailyRoutesLoaded(operationDate: string): Promise<EnsureDailyRoutesResult> {
  if (!supabase) {
    return {
      scheduledDate: operationDate,
      alreadyLoaded: true,
      plannedCount: 0,
      routeCount: 0
    };
  }

  const { data, error } = await supabase.rpc("ensure_daily_routes_loaded", {
    input_scheduled_date: operationDate
  });

  if (error) {
    throw new Error(error.message);
  }

  return ensureDailyRoutesResultSchema.parse(data);
}

export async function saveRouteAsTemplate(input: SaveRouteAsTemplateInput): Promise<SaveRouteAsTemplateResult> {
  const parsed = saveRouteAsTemplateInputSchema.parse(input);

  if (!supabase) {
    throw new Error("Saving route templates requires Supabase.");
  }

  const { data, error } = await supabase.rpc("save_route_as_template", {
    input_route_id: parsed.routeId,
    input_kind: parsed.kind,
    input_name: parsed.name ?? null
  });

  if (error) {
    throw new Error(error.message);
  }

  return saveRouteAsTemplateResultSchema.parse(data);
}

export async function getRoutePlanningOptions(operationDate?: string): Promise<RoutePlanningOptions> {
  if (!supabase) {
    return {
      zones: [],
      trucks: [],
      drivers: [],
      customers: []
    };
  }

  const { data, error } = await supabase.rpc("route_planning_options", {
    input_date: operationDate ?? getOperationDate()
  });

  if (error || !data) {
    throw new Error(error?.message ?? "Unable to load route planning options");
  }

  return routePlanningOptionsSchema.parse(data);
}

export async function updateRoutePlanAssignment(
  routeId: string,
  zoneId: string,
  truckId: string,
  driverId: string | null,
  operationDate?: string
): Promise<RouteDetail[]> {
  if (!supabase) {
    return filterPilotRoutesByDate(operationDate);
  }

  const { error } = await supabase.rpc("update_route_plan_assignment", {
    input_route_id: routeId,
    input_zone_id: zoneId,
    input_truck_id: truckId,
    input_driver_id: driverId
  });

  if (error) {
    throw new Error(error.message);
  }

  return getRoutes(operationDate);
}

export async function getRouteTruckHandoffs(operationDate: string): Promise<RouteTruckHandoff[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase.rpc("route_truck_handoffs_for_date", {
    input_date: operationDate
  });

  if (error) {
    throw new Error(error.message);
  }

  return routeTruckHandoffSchema.array().parse(data ?? []);
}

export async function getRouteCoverSummaries(operationDate: string): Promise<RouteCoverSummary[]> {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase.rpc("route_cover_summaries_for_date", {
    input_date: operationDate
  });

  if (error) {
    throw new Error(error.message);
  }

  return routeCoverSummarySchema.array().parse(data ?? []);
}

export async function proposeRouteTruckHandoff(
  input: ProposeRouteTruckHandoffInput
): Promise<RouteTruckHandoff> {
  const parsed = proposeRouteTruckHandoffInputSchema.parse(input);

  if (!supabase) {
    throw new Error("Route reassignments require Supabase.");
  }

  if (parsed.changeKind !== "driver" && !parsed.toTruckId) {
    throw new Error("Replacement truck is required for this reassignment.");
  }

  const { data, error } = await supabase.rpc("propose_route_truck_handoff", {
    input_route_id: parsed.routeId,
    input_to_truck_id: parsed.toTruckId,
    input_to_driver_id: parsed.toDriverId,
    input_reason: parsed.reason,
    input_notes: parsed.notes ?? null,
    input_source_route_id: parsed.sourceRouteId ?? null,
    input_source_outcome: parsed.sourceOutcome ?? null,
    input_change_kind: parsed.changeKind
  });

  if (error) {
    throw new Error(error.message);
  }

  return routeTruckHandoffSchema.parse(data);
}

export async function cancelRouteTruckHandoff(handoffId: string): Promise<RouteTruckHandoff> {
  if (!supabase) {
    throw new Error("Truck handoffs require Supabase.");
  }

  const { data, error } = await supabase.rpc("cancel_route_truck_handoff", {
    input_handoff_id: handoffId
  });

  if (error) {
    throw new Error(error.message);
  }

  return routeTruckHandoffSchema.parse(data);
}

export async function rejectRouteTruckHandoff(
  handoffId: string,
  note?: string
): Promise<RouteTruckHandoff> {
  if (!supabase) {
    throw new Error("Truck handoffs require Supabase.");
  }

  const { data, error } = await supabase.rpc("reject_route_truck_handoff", {
    input_handoff_id: handoffId,
    input_note: note ?? null
  });

  if (error) {
    throw new Error(error.message);
  }

  return routeTruckHandoffSchema.parse(data);
}

export async function addRoutePlanStop(
  routeId: string,
  customerId: string,
  operationDate?: string
): Promise<{ routes: RouteDetail[]; warning: string | null }> {
  if (!supabase) {
    return { routes: filterPilotRoutesByDate(operationDate), warning: null };
  }

  const { data, error } = await supabase.rpc("add_route_plan_stop", {
    input_route_id: routeId,
    input_customer_id: customerId
  });

  if (error) {
    throw new Error(error.message);
  }

  const warning =
    data && typeof data === "object" && "warning" in data && typeof (data as { warning: unknown }).warning === "string"
      ? (data as { warning: string }).warning
      : null;

  return { routes: await getRoutes(operationDate), warning };
}

export async function removeRoutePlanStop(stopId: string, operationDate?: string): Promise<RouteDetail[]> {
  if (!supabase) {
    return filterPilotRoutesByDate(operationDate);
  }

  const { error } = await supabase.rpc("remove_route_plan_stop", {
    input_stop_id: stopId
  });

  if (error) {
    throw new Error(error.message);
  }

  return getRoutes(operationDate);
}

export async function moveRoutePlanStop(
  stopId: string,
  direction: "up" | "down",
  operationDate?: string
): Promise<RouteDetail[]> {
  if (!supabase) {
    return filterPilotRoutesByDate(operationDate);
  }

  const { error } = await supabase.rpc("move_route_plan_stop", {
    input_stop_id: stopId,
    input_direction: direction
  });

  if (error) {
    throw new Error(error.message);
  }

  return getRoutes(operationDate);
}

export async function getAdminMasterData(): Promise<AdminMasterData> {
  if (!supabase) {
    return {
      zones: [],
      staff: [],
      trucks: [],
      customers: []
    };
  }

  const { data, error } = await supabase.rpc("admin_master_data");

  if (error || !data) {
    throw new Error(error?.message ?? "Unable to load admin master data");
  }

  return adminMasterDataSchema.parse(data);
}

export async function onboardStaffMember(input: StaffOnboardingInput): Promise<StaffOnboardingResult> {
  const parsed = staffOnboardingInputSchema.parse(input);

  if (!supabase) {
    return staffOnboardingResultSchema.parse({
      staffId: crypto.randomUUID(),
      profileId: null,
      loginEmail: null,
      temporaryPassword: null,
      loginProvisioned: false
    });
  }

  const { data, error } = await supabase.rpc("onboard_staff_member", {
    input_full_name: parsed.fullName,
    input_phone: parsed.phone,
    input_role: parsed.role,
    input_monthly_salary_kobo: parsed.monthlySalaryKobo,
    input_login_email: parsed.loginEmail ?? null,
    input_provision_login: parsed.provisionLogin,
    input_licence_expires_on: parsed.role === "driver" ? parsed.licenceExpiresOn ?? null : null,
    input_licence_image_url: parsed.role === "driver" ? parsed.licenceImageUrl ?? null : null
  });

  if (error) {
    throw new Error(error.message);
  }

  return staffOnboardingResultSchema.parse(data);
}

export async function provisionStaffMemberLogin(
  input: StaffLoginProvisionInput
): Promise<StaffOnboardingResult> {
  const parsed = staffLoginProvisionInputSchema.parse(input);

  if (!supabase) {
    throw new Error("Staff login provisioning requires Supabase.");
  }

  const { data, error } = await supabase.rpc("provision_staff_member_login", {
    input_staff_id: parsed.staffId,
    input_login_email: parsed.loginEmail
  });

  if (error) {
    throw new Error(error.message);
  }

  return staffOnboardingResultSchema.parse(data);
}

export async function provisionCustomerLogin(
  input: CustomerLoginProvisionInput
): Promise<CustomerLoginProvisionResult> {
  const parsed = customerLoginProvisionInputSchema.parse(input);

  if (!supabase) {
    throw new Error("Customer login provisioning requires Supabase.");
  }

  const { data, error } = await supabase.rpc("provision_customer_login", {
    input_customer_id: parsed.customerId,
    input_login_email: parsed.loginEmail
  });

  if (error) {
    throw new Error(error.message);
  }

  return customerLoginProvisionResultSchema.parse(data);
}

export async function requestCustomerPasswordReset(customerId: string) {
  if (!supabase) {
    throw new Error("Password reset requires Supabase.");
  }

  const { data, error } = await supabase.rpc("get_customer_password_reset_target", {
    input_customer_id: customerId
  });

  if (error) {
    throw new Error(error.message);
  }

  const target = customerPasswordResetTargetSchema.parse(data);
  await requestPasswordReset(target.loginEmail);

  return {
    sent: true as const,
    loginEmail: target.loginEmail,
    customerName: target.customerName
  };
}

export async function requestStaffPasswordReset(staffId: string) {
  if (!supabase) {
    throw new Error("Password reset requires Supabase.");
  }

  const { data, error } = await supabase.rpc("get_staff_password_reset_target", {
    input_staff_id: staffId
  });

  if (error) {
    throw new Error(error.message);
  }

  const target = staffPasswordResetTargetSchema.parse(data);
  await requestPasswordReset(target.loginEmail);

  return {
    sent: true as const,
    loginEmail: target.loginEmail,
    staffName: target.staffName
  };
}

export async function setStaffActive(staffId: string, active: boolean) {
  if (!supabase) {
    return;
  }

  const { error } = await supabase.rpc("set_staff_active", {
    input_staff_id: staffId,
    next_active: active
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function updateStaffMember(input: StaffUpdateInput) {
  const parsed = staffUpdateInputSchema.parse(input);

  if (!supabase) {
    return;
  }

  const { error } = await supabase.rpc("update_staff_member", {
    input_staff_id: parsed.staffId,
    input_full_name: parsed.fullName,
    input_phone: parsed.phone,
    input_role: parsed.role,
    input_monthly_salary_kobo: parsed.monthlySalaryKobo,
    input_licence_expires_on: parsed.role === "driver" ? parsed.licenceExpiresOn ?? null : null,
    input_licence_image_url: parsed.role === "driver" ? parsed.licenceImageUrl ?? null : null
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function onboardTruck(input: TruckOnboardingInput) {
  const parsed = truckOnboardingInputSchema.parse(input);

  if (!supabase) {
    return;
  }

  const { error } = await supabase.rpc("onboard_truck", {
    input_zone_id: parsed.zoneId ?? null,
    input_registration_number: parsed.registrationNumber,
    input_make: parsed.make ?? null,
    input_model: parsed.model ?? null,
    input_year: parsed.year ?? null,
    input_status: parsed.status
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function updateTruck(input: TruckUpdateInput) {
  const parsed = truckUpdateInputSchema.parse(input);

  if (!supabase) {
    return;
  }

  const { error } = await supabase.rpc("update_truck", {
    input_truck_id: parsed.truckId,
    input_zone_id: parsed.zoneId ?? null,
    input_registration_number: parsed.registrationNumber,
    input_make: parsed.make ?? null,
    input_model: parsed.model ?? null,
    input_year: parsed.year ?? null,
    input_status: parsed.status
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function setTruckActive(truckId: string, active: boolean) {
  if (!supabase) {
    return;
  }

  const { error } = await supabase.rpc("set_truck_active", {
    input_truck_id: truckId,
    next_active: active
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function onboardCustomer(input: CustomerOnboardingInput) {
  const parsed = customerOnboardingInputSchema.parse(input);

  if (!supabase) {
    return;
  }

  const { error } = await supabase.rpc("onboard_customer", {
    input_zone_id: parsed.zoneId,
    input_display_name: parsed.displayName,
    input_phone: parsed.phone ?? null,
    input_address: parsed.address,
    input_customer_type: parsed.customerType,
    input_monthly_rate_kobo: parsed.monthlyRateKobo,
    input_service_status: parsed.serviceStatus,
    input_collections_per_week: parsed.collectionsPerWeek,
    input_preferred_weekdays: parsed.preferredWeekdays,
    input_frequency_notes: parsed.frequencyNotes ?? null
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function updateCustomer(input: CustomerUpdateInput) {
  const parsed = customerUpdateInputSchema.parse(input);

  if (!supabase) {
    return;
  }

  const { error } = await supabase.rpc("update_customer", {
    input_customer_id: parsed.customerId,
    input_zone_id: parsed.zoneId,
    input_display_name: parsed.displayName,
    input_phone: parsed.phone ?? null,
    input_address: parsed.address,
    input_customer_type: parsed.customerType,
    input_monthly_rate_kobo: parsed.monthlyRateKobo,
    input_collections_per_week: parsed.collectionsPerWeek,
    input_preferred_weekdays: parsed.preferredWeekdays,
    input_frequency_notes: parsed.frequencyNotes ?? null
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function setCustomerServiceStatus(
  customerId: string,
  serviceStatus: CustomerLedgerItem["serviceStatus"],
  suspensionReason?: string
) {
  if (!supabase) {
    return;
  }

  const { error } = await supabase.rpc("set_customer_service_status", {
    input_customer_id: customerId,
    next_status: serviceStatus,
    input_suspension_reason:
      serviceStatus === "suspended" ? suspensionReason ?? "Suspended by operator" : null
  });

  if (error) {
    throw new Error(error.message);
  }
}

function filterPilotRoutesByDate(operationDate?: string) {
  if (!operationDate) {
    return pilotRouteDetails;
  }

  const filtered = pilotRouteDetails.filter((route) => route.scheduledDate === operationDate);

  return filtered.length > 0 ? filtered : [];
}

function filterPilotIncidentsByDate(operationDate?: string) {
  if (!operationDate) {
    return pilotIncidentReports;
  }

  return pilotIncidentReports.filter((incident) => incident.createdAt.slice(0, 10) === operationDate);
}

function mapRoute(route: any): RouteDetail | null {
  const zone = Array.isArray(route.zones) ? route.zones[0] : route.zones;
  const truck = Array.isArray(route.trucks) ? route.trucks[0] : route.trucks;
  const driver = Array.isArray(route.staff_members) ? route.staff_members[0] : route.staff_members;
  const stops: RawRouteStop[] = Array.isArray(route.route_stops) ? route.route_stops : [];
  const completedStops = stops.filter((stop) => stop.status !== "pending").length;

  const parsed = routeDetailSchema.safeParse({
    id: route.id,
    zoneId: route.zone_id,
    zoneName: zone?.name ?? "Unassigned ward",
    truckId: route.truck_id,
    truckRegistration: truck?.registration_number ?? "Unassigned truck",
    driverId: route.driver_id,
    driverName: driver?.full_name ?? "Unassigned driver",
    status: route.status,
    completedStops,
    totalStops: Math.max(stops.length, 1),
    delayed: route.status === "in_progress" && completedStops / Math.max(stops.length, 1) < 0.35,
    scheduledDate: route.scheduled_date,
    startedAt: route.started_at,
    completedAt: route.completed_at,
    stops: stops
      .sort((a: RawRouteStop, b: RawRouteStop) => a.stop_sequence - b.stop_sequence)
      .map((stop) => {
        const customer = Array.isArray(stop.customers) ? stop.customers[0] : stop.customers;

        return {
          id: stop.id,
          customerId: customer?.id,
          customerName: customer?.display_name ?? "Unknown customer",
          address: customer?.address ?? "No address",
          stopSequence: stop.stop_sequence,
          status: stop.status,
          completedAt: stop.completed_at,
          notes: stop.notes,
          skipReason: stop.skip_reason,
          serviceStatus: customer?.service_status ?? "active",
          isMakeGood: Boolean(stop.is_make_good),
          proofPhotoPath: stop.proof_photo_path ?? null
        };
      })
  });

  return parsed.success ? parsed.data : null;
}

const STOP_PROOF_BUCKET = "stop-proofs";

/** Signed URL so operators can open driver stop proof photos in a new tab. */
export async function getStopProofSignedUrl(proofPhotoPath: string, expiresInSeconds = 3600): Promise<string> {
  if (!supabase) {
    throw new Error("Stop proof viewing requires a live Supabase connection.");
  }

  const path = proofPhotoPath.trim();
  if (!path) {
    throw new Error("No proof photo path");
  }

  const { data, error } = await supabase.storage.from(STOP_PROOF_BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Unable to create proof photo link");
  }

  return data.signedUrl;
}
