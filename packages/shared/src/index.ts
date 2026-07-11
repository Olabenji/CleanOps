import { z } from "zod";

export const userRoles = [
  "operator_owner",
  "operations_supervisor",
  "driver",
  "loader",
  "collection_agent",
  "resident",
  "platform_admin"
] as const;

export const customerTypes = [
  "residential",
  "small_business",
  "restaurant",
  "estate"
] as const;

export const paymentChannels = [
  "paystack",
  "bank_transfer",
  "opay",
  "palmpay",
  "moniepoint",
  "agent_cash"
] as const;

export const routeStopStatuses = [
  "pending",
  "completed",
  "skipped",
  "missed_reported"
] as const;

export const routeStatuses = [
  "scheduled",
  "in_progress",
  "completed",
  "cancelled"
] as const;

export const incidentTypes = [
  "blocked_access",
  "customer_dispute",
  "truck_issue",
  "missed_pickup",
  "illegal_dumping",
  "safety_concern",
  "other"
] as const;

export const truckStatuses = [
  "operational",
  "standby",
  "workshop"
] as const;

export const dumpsiteRunPhases = ["depart", "arrive", "clear"] as const;

export const routeTruckHandoffStatuses = [
  "awaiting_confirmation",
  "confirmed",
  "rejected",
  "cancelled",
  "expired"
] as const;

export const routeTruckHandoffReasons = [
  "breakdown",
  "dumpsite_delay",
  "unable_to_start",
  "cross_route_support",
  "driver_sick",
  "driver_unavailable",
  "other"
] as const;

export const routeReassignmentKinds = ["truck", "driver", "both"] as const;

export const routeTruckHandoffSourceOutcomes = ["leave_unassigned", "cancel_route"] as const;

export const fuelLogInputSchema = z.object({
  routeId: z.string().uuid(),
  litres: z.number().positive(),
  costKobo: z.number().int().positive(),
  stationName: z.string().min(2),
  loggedAt: z.string().optional()
});

export const fuelLogRecordSchema = z.object({
  id: z.string().uuid(),
  routeId: z.string().uuid(),
  truckRegistration: z.string(),
  litres: z.number(),
  costKobo: z.number().int().positive(),
  stationName: z.string(),
  loggedAt: z.string()
});

export const dumpsiteRunInputSchema = z.object({
  routeId: z.string().uuid(),
  phase: z.enum(dumpsiteRunPhases),
  tippingFeeKobo: z.number().int().nonnegative().optional(),
  notes: z.string().optional()
});

export const dumpsiteRunRecordSchema = z.object({
  id: z.string().uuid(),
  routeId: z.string().uuid(),
  departedAt: z.string().nullable(),
  arrivedAt: z.string().nullable(),
  clearedAt: z.string().nullable(),
  tippingFeeKobo: z.number().int().nonnegative(),
  notes: z.string().nullable()
});

export const routeTruckHandoffSchema = z.object({
  id: z.string().uuid(),
  routeId: z.string().uuid(),
  routeZoneName: z.string(),
  routeStatus: z.enum(routeStatuses),
  scheduledDate: z.string(),
  pendingStops: z.number().int().nonnegative(),
  changeKind: z.enum(routeReassignmentKinds).default("both"),
  fromTruckId: z.string().uuid().nullable(),
  fromTruckRegistration: z.string().nullable(),
  toTruckId: z.string().uuid(),
  toTruckRegistration: z.string(),
  fromDriverId: z.string().uuid().nullable(),
  fromDriverName: z.string().nullable(),
  toDriverId: z.string().uuid(),
  toDriverName: z.string().nullable(),
  sourceRouteId: z.string().uuid().nullable(),
  sourceRouteZoneName: z.string().nullable(),
  sourceOutcome: z.enum(routeTruckHandoffSourceOutcomes).nullable(),
  reason: z.enum(routeTruckHandoffReasons),
  notes: z.string().nullable(),
  status: z.enum(routeTruckHandoffStatuses),
  requiresOutgoingConfirmation: z.boolean(),
  incomingConfirmed: z.boolean(),
  outgoingConfirmed: z.boolean(),
  expiresAt: z.string(),
  createdAt: z.string(),
  confirmedAt: z.string().nullable(),
  rejectedAt: z.string().nullable(),
  cancelledAt: z.string().nullable()
});

export const proposeRouteTruckHandoffInputSchema = z.object({
  routeId: z.string().uuid(),
  changeKind: z.enum(routeReassignmentKinds).default("both"),
  toTruckId: z.string().uuid().optional(),
  toDriverId: z.string().uuid(),
  reason: z.enum(routeTruckHandoffReasons),
  notes: z.string().optional(),
  sourceRouteId: z.string().uuid().optional(),
  sourceOutcome: z.enum(routeTruckHandoffSourceOutcomes).optional()
});

export const staffMemberSchema = z.object({
  id: z.string().uuid(),
  operatorId: z.string().uuid(),
  fullName: z.string().min(2),
  phone: z.string().min(7),
  role: z.enum(userRoles),
  active: z.boolean()
});

export const operatorProfileSchema = z.object({
  id: z.string().uuid(),
  operatorId: z.string().uuid().nullable(),
  operatorName: z.string().nullable(),
  fullName: z.string(),
  phone: z.string(),
  role: z.enum(userRoles)
});

export const updateOwnProfileInputSchema = z.object({
  fullName: z.string().min(2),
  phone: z.string().min(7)
});

export const ownAccountProfileSchema = z.object({
  profileId: z.string().uuid(),
  operatorId: z.string().uuid().nullable(),
  fullName: z.string(),
  phone: z.string(),
  role: z.enum(userRoles),
  staffId: z.string().uuid().nullable(),
  licenceExpiresOn: z.string().nullable(),
  licenceImageUrl: z.string().nullable()
});

export const setStaffLicenceInputSchema = z.object({
  staffId: z.string().uuid(),
  licenceExpiresOn: z.string().min(8),
  licenceImageUrl: z.string().min(1)
});

export const staffLicenceResultSchema = z.object({
  staffId: z.string().uuid(),
  fullName: z.string(),
  licenceExpiresOn: z.string().nullable(),
  licenceImageUrl: z.string().nullable()
});

export const customerSchema = z.object({
  id: z.string().uuid(),
  operatorId: z.string().uuid(),
  zoneId: z.string().uuid(),
  displayName: z.string().min(2),
  phone: z.string().min(7).optional(),
  address: z.string().min(5),
  customerType: z.enum(customerTypes),
  monthlyRateKobo: z.number().int().nonnegative(),
  serviceStatus: z.enum(["active", "suspended"])
});

export const dashboardMetricSchema = z.object({
  label: z.string(),
  value: z.string(),
  helper: z.string()
});

export const routeSummarySchema = z.object({
  id: z.string().uuid(),
  zoneId: z.string().uuid().nullable().optional(),
  zoneName: z.string(),
  truckId: z.string().uuid().nullable().optional(),
  truckRegistration: z.string(),
  driverId: z.string().uuid().nullable().optional(),
  driverName: z.string(),
  status: z.enum(routeStatuses),
  completedStops: z.number().int().nonnegative(),
  totalStops: z.number().int().positive(),
  delayed: z.boolean()
});

export const routeStopSchema = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid().optional(),
  customerName: z.string(),
  address: z.string(),
  stopSequence: z.number().int().positive(),
  status: z.enum(routeStopStatuses),
  completedAt: z.string().nullable(),
  notes: z.string().nullable(),
  skipReason: z.string().nullable(),
  serviceStatus: z.enum(["active", "suspended"])
});

export const routeDetailSchema = routeSummarySchema.extend({
  scheduledDate: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  stops: z.array(routeStopSchema)
});

export const driverStopActionSchema = z.object({
  id: z.string(),
  routeId: z.string().uuid(),
  stopId: z.string().uuid(),
  status: z.enum(routeStopStatuses),
  note: z.string().optional(),
  skipReason: z.string().optional(),
  queuedAt: z.string(),
  syncedAt: z.string().nullable(),
  errorMessage: z.string().optional()
});

export const incidentReportInputSchema = z.object({
  routeId: z.string().uuid(),
  stopId: z.string().uuid().optional(),
  incidentType: z.enum(incidentTypes),
  title: z.string().min(3),
  description: z.string().min(5),
  queuedAt: z.string().optional(),
  errorMessage: z.string().optional()
});

export const incidentReportSchema = z.object({
  id: z.string().uuid(),
  routeId: z.string().uuid().nullable(),
  routeLabel: z.string().nullable(),
  truckRegistration: z.string().nullable(),
  reportedBy: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  resolvedAt: z.string().nullable(),
  createdAt: z.string()
});

export const routePlanningOptionSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  zoneId: z.string().uuid().nullable().optional(),
  helper: z.string().nullable().optional()
});

export const routePlanningOptionsSchema = z.object({
  zones: z.array(routePlanningOptionSchema),
  trucks: z.array(routePlanningOptionSchema),
  drivers: z.array(routePlanningOptionSchema),
  customers: z.array(routePlanningOptionSchema.extend({ zoneId: z.string().uuid() }))
});

export const adminZoneSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable()
});

export const adminStaffSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  phone: z.string(),
  role: z.enum(userRoles),
  monthlySalaryKobo: z.number().int().nonnegative(),
  active: z.boolean(),
  hasLoginProfile: z.boolean(),
  loginEmail: z.string().nullable(),
  licenceExpiresOn: z.string().nullable().optional(),
  licenceImageUrl: z.string().nullable().optional()
});

export const adminTruckSchema = z.object({
  id: z.string().uuid(),
  zoneId: z.string().uuid().nullable(),
  zoneName: z.string().nullable(),
  registrationNumber: z.string(),
  make: z.string().nullable(),
  model: z.string().nullable(),
  year: z.number().int().nullable(),
  status: z.enum(truckStatuses),
  active: z.boolean()
});

export const adminCustomerSchema = z.object({
  id: z.string().uuid(),
  zoneId: z.string().uuid(),
  zoneName: z.string(),
  displayName: z.string(),
  phone: z.string().nullable(),
  address: z.string(),
  customerType: z.enum(customerTypes),
  monthlyRateKobo: z.number().int().nonnegative(),
  serviceStatus: z.enum(["active", "suspended"])
});

export const adminMasterDataSchema = z.object({
  zones: z.array(adminZoneSchema),
  staff: z.array(adminStaffSchema),
  trucks: z.array(adminTruckSchema),
  customers: z.array(adminCustomerSchema)
});

export const staffOnboardingInputSchema = z.object({
  fullName: z.string().min(2),
  phone: z.string().min(7),
  role: z.enum(userRoles),
  monthlySalaryKobo: z.number().int().nonnegative(),
  loginEmail: z.string().email().optional(),
  provisionLogin: z.boolean().default(true),
  licenceExpiresOn: z.string().optional().nullable(),
  licenceImageUrl: z.string().optional().nullable()
});

export const staffOnboardingResultSchema = z.object({
  staffId: z.string().uuid(),
  profileId: z.string().uuid().nullable(),
  loginEmail: z.string().nullable(),
  temporaryPassword: z.string().nullable(),
  loginProvisioned: z.boolean()
});

export const staffLoginProvisionInputSchema = z.object({
  staffId: z.string().uuid(),
  loginEmail: z.string().email()
});

export const staffPasswordResetTargetSchema = z.object({
  loginEmail: z.string().email(),
  staffName: z.string()
});

export const truckOnboardingInputSchema = z.object({
  /** Optional home/preferred zone — trucks float across routes. */
  zoneId: z.string().uuid().optional().nullable(),
  registrationNumber: z.string().min(3),
  make: z.string().optional(),
  model: z.string().optional(),
  year: z.number().int().min(1980).max(2100).optional(),
  status: z.enum(truckStatuses)
});

export const customerOnboardingInputSchema = z.object({
  zoneId: z.string().uuid(),
  displayName: z.string().min(2),
  phone: z.string().optional(),
  address: z.string().min(5),
  customerType: z.enum(customerTypes),
  monthlyRateKobo: z.number().int().nonnegative(),
  serviceStatus: z.enum(["active", "suspended"])
});

export const staffUpdateInputSchema = z.object({
  staffId: z.string().uuid(),
  fullName: z.string().min(2),
  phone: z.string().min(7),
  role: z.enum(userRoles),
  monthlySalaryKobo: z.number().int().nonnegative(),
  licenceExpiresOn: z.string().optional().nullable(),
  licenceImageUrl: z.string().optional().nullable()
});

export const truckUpdateInputSchema = z.object({
  truckId: z.string().uuid(),
  /** Optional home/preferred zone — trucks float across routes. */
  zoneId: z.string().uuid().optional().nullable(),
  registrationNumber: z.string().min(3),
  make: z.string().optional(),
  model: z.string().optional(),
  year: z.number().int().min(1980).max(2100).optional().nullable(),
  status: z.enum(truckStatuses)
});

export const customerUpdateInputSchema = z.object({
  customerId: z.string().uuid(),
  zoneId: z.string().uuid(),
  displayName: z.string().min(2),
  phone: z.string().optional(),
  address: z.string().min(5),
  customerType: z.enum(customerTypes),
  monthlyRateKobo: z.number().int().nonnegative()
});

export const paymentSummarySchema = z.object({
  id: z.string().uuid(),
  customerName: z.string(),
  channel: z.enum(paymentChannels),
  amountKobo: z.number().int().positive(),
  paidAt: z.string()
});

export const paymentLedgerItemSchema = paymentSummarySchema.extend({
  customerType: z.enum(customerTypes),
  address: z.string(),
  serviceStatus: z.enum(["active", "suspended"])
});

export const customerLedgerItemSchema = z.object({
  customerId: z.string().uuid(),
  displayName: z.string(),
  phone: z.string().nullable(),
  address: z.string(),
  customerType: z.enum(customerTypes),
  zoneName: z.string(),
  monthlyRateKobo: z.number().int().nonnegative(),
  paidThisMonthKobo: z.number().int().nonnegative(),
  outstandingKobo: z.number().int().nonnegative(),
  serviceStatus: z.enum(["active", "suspended"]),
  suspensionReason: z.string().nullable(),
  currentTagMonth: z.string().nullable(),
  lastPaymentAt: z.string().nullable(),
  lastPaymentAmountKobo: z.number().int().positive().nullable(),
  lastPaymentChannel: z.enum(paymentChannels).nullable()
});

export const paymentEntrySchema = z.object({
  customerId: z.string().uuid(),
  channel: z.enum(paymentChannels),
  amountKobo: z.number().int().positive(),
  externalReference: z.string().optional()
});

export const agentPaymentEntrySchema = z.object({
  customerId: z.string().uuid(),
  channel: z.enum(paymentChannels),
  amountKobo: z.number().int().positive(),
  externalReference: z.string().optional(),
  idempotencyKey: z.string().optional()
});

export const agentPaymentReceiptSchema = z.object({
  paymentId: z.string().uuid(),
  receiptReference: z.string(),
  customerName: z.string(),
  amountKobo: z.number().int().positive(),
  channel: z.enum(paymentChannels),
  paidAt: z.string(),
  outstandingKobo: z.number().int().nonnegative()
});

export const agentCollectionPaymentSchema = z.object({
  paymentId: z.string().uuid(),
  customerName: z.string(),
  amountKobo: z.number().int().positive(),
  channel: z.enum(paymentChannels),
  receiptReference: z.string().nullable(),
  paidAt: z.string()
});

export const agentDailyCollectionSummarySchema = z.object({
  collectionDate: z.string(),
  agentName: z.string(),
  totalCollectedKobo: z.number().int().nonnegative(),
  paymentCount: z.number().int().nonnegative(),
  payments: z.array(agentCollectionPaymentSchema)
});

export const operatorAgentCollectionAgentSchema = z.object({
  agentStaffId: z.string().uuid(),
  agentName: z.string(),
  totalCollectedKobo: z.number().int().nonnegative(),
  paymentCount: z.number().int().nonnegative(),
  payments: z.array(agentCollectionPaymentSchema)
});

export const operatorAgentCollectionsSnapshotSchema = z.object({
  collectionDate: z.string(),
  totalCollectedKobo: z.number().int().nonnegative(),
  paymentCount: z.number().int().nonnegative(),
  agents: z.array(operatorAgentCollectionAgentSchema)
});

export const agentPaymentActionSchema = z.object({
  id: z.string(),
  customerId: z.string().uuid(),
  customerName: z.string(),
  channel: z.enum(paymentChannels),
  amountKobo: z.number().int().positive(),
  externalReference: z.string().optional(),
  idempotencyKey: z.string(),
  queuedAt: z.string(),
  syncedAt: z.string().nullable(),
  errorMessage: z.string().optional()
});

export const staffAttendanceRowSchema = z.object({
  staffMemberId: z.string().uuid(),
  fullName: z.string(),
  phone: z.string(),
  role: z.enum(userRoles),
  monthlySalaryKobo: z.number().int().nonnegative(),
  checkedInAt: z.string().nullable(),
  supervisorOverride: z.boolean(),
  status: z.enum(["checked_in", "absent"]),
  absenceReason: z.string().nullable(),
  attendanceNote: z.string().nullable()
});

export const attendanceOverrideSchema = z.object({
  staffMemberId: z.string().uuid(),
  attendanceDate: z.string(),
  checkedIn: z.boolean(),
  reason: z.string().optional(),
  note: z.string().optional()
});

export const monthlyStaffSummarySchema = z.object({
  staffMemberId: z.string().uuid(),
  fullName: z.string(),
  role: z.enum(userRoles),
  monthlySalaryKobo: z.number().int().nonnegative(),
  daysCheckedIn: z.number().int().nonnegative(),
  daysAbsent: z.number().int().nonnegative(),
  estimatedPayrollKobo: z.number().int().nonnegative()
});

export const staffAttendanceSummarySchema = z.object({
  totalStaff: z.number().int().nonnegative(),
  checkedIn: z.number().int().nonnegative(),
  absent: z.number().int().nonnegative()
});

export const fleetSummarySchema = z.object({
  registrationNumber: z.string(),
  zoneName: z.string(),
  status: z.enum(truckStatuses),
  reserveRemainingKobo: z.number().int().nonnegative()
});

export const operatorDashboardSchema = z.object({
  operatorName: z.string(),
  metrics: z.array(dashboardMetricSchema),
  routes: z.array(routeSummarySchema),
  recentPayments: z.array(paymentSummarySchema),
  staffAttendance: staffAttendanceSummarySchema,
  fleet: z.array(fleetSummarySchema),
  alerts: z.array(z.string())
});

export type DumpsiteRunPhase = (typeof dumpsiteRunPhases)[number];
export type FuelLogInput = z.infer<typeof fuelLogInputSchema>;
export type FuelLogRecord = z.infer<typeof fuelLogRecordSchema>;
export type DumpsiteRunInput = z.infer<typeof dumpsiteRunInputSchema>;
export type DumpsiteRunRecord = z.infer<typeof dumpsiteRunRecordSchema>;
export type RouteTruckHandoffStatus = (typeof routeTruckHandoffStatuses)[number];
export type RouteTruckHandoffReason = (typeof routeTruckHandoffReasons)[number];
export type RouteTruckHandoffSourceOutcome = (typeof routeTruckHandoffSourceOutcomes)[number];
export type RouteReassignmentKind = (typeof routeReassignmentKinds)[number];
export type RouteTruckHandoff = z.infer<typeof routeTruckHandoffSchema>;
export type ProposeRouteTruckHandoffInput = z.infer<typeof proposeRouteTruckHandoffInputSchema>;
export type UserRole = (typeof userRoles)[number];
export type CustomerType = (typeof customerTypes)[number];
export type PaymentChannel = (typeof paymentChannels)[number];
export type RouteStopStatus = (typeof routeStopStatuses)[number];
export type RouteStatus = (typeof routeStatuses)[number];
export type TruckStatus = (typeof truckStatuses)[number];
export type IncidentType = (typeof incidentTypes)[number];
export type OperatorProfile = z.infer<typeof operatorProfileSchema>;
export type UpdateOwnProfileInput = z.infer<typeof updateOwnProfileInputSchema>;
export type OwnAccountProfile = z.infer<typeof ownAccountProfileSchema>;
export type SetStaffLicenceInput = z.infer<typeof setStaffLicenceInputSchema>;
export type StaffLicenceResult = z.infer<typeof staffLicenceResultSchema>;
export type StaffMember = z.infer<typeof staffMemberSchema>;
export type Customer = z.infer<typeof customerSchema>;
export type DashboardMetric = z.infer<typeof dashboardMetricSchema>;
export type RouteSummary = z.infer<typeof routeSummarySchema>;
export type RouteStop = z.infer<typeof routeStopSchema>;
export type RouteDetail = z.infer<typeof routeDetailSchema>;
export type DriverStopAction = z.infer<typeof driverStopActionSchema>;
export type IncidentReportInput = z.infer<typeof incidentReportInputSchema>;
export type IncidentReport = z.infer<typeof incidentReportSchema>;
export type RoutePlanningOption = z.infer<typeof routePlanningOptionSchema>;
export type RoutePlanningOptions = z.infer<typeof routePlanningOptionsSchema>;
export type AdminZone = z.infer<typeof adminZoneSchema>;
export type AdminStaff = z.infer<typeof adminStaffSchema>;
export type AdminTruck = z.infer<typeof adminTruckSchema>;
export type AdminCustomer = z.infer<typeof adminCustomerSchema>;
export type AdminMasterData = z.infer<typeof adminMasterDataSchema>;
export type StaffOnboardingInput = z.infer<typeof staffOnboardingInputSchema>;
export type StaffOnboardingResult = z.infer<typeof staffOnboardingResultSchema>;
export type StaffLoginProvisionInput = z.infer<typeof staffLoginProvisionInputSchema>;
export type StaffPasswordResetTarget = z.infer<typeof staffPasswordResetTargetSchema>;
export const routeTemplateKinds = ["zone_default", "temporary"] as const;

export const routeTemplateKindSchema = z.enum(routeTemplateKinds);

export const saveRouteAsTemplateInputSchema = z.object({
  routeId: z.string().uuid(),
  kind: routeTemplateKindSchema,
  name: z.string().min(1).max(120).optional()
});

export const saveRouteAsTemplateResultSchema = z.object({
  id: z.string().uuid(),
  kind: routeTemplateKindSchema,
  zoneId: z.string().uuid(),
  zoneName: z.string().nullable(),
  stopCount: z.number().int().nonnegative()
});

export const ensureDailyRoutesResultSchema = z.object({
  scheduledDate: z.string(),
  alreadyLoaded: z.boolean(),
  plannedCount: z.number().int().nonnegative(),
  routeCount: z.number().int().nonnegative(),
  hasAssignedRoute: z.boolean().optional()
});

export const driverTodayPlanningStatusSchema = z.object({
  hasAssignedRoute: z.boolean(),
  operatorRoutesExist: z.boolean(),
  canLoadDefaults: z.boolean(),
  isTemplateDefaultDriver: z.boolean().optional()
});

export const driverShiftJobTypes = [
  "route_completed",
  "cover_completed",
  "reassignment_completed",
  "cover_released"
] as const;

export const driverShiftJobSchema = z.object({
  id: z.string(),
  jobType: z.enum(driverShiftJobTypes),
  routeId: z.string().uuid(),
  zoneName: z.string(),
  truckRegistration: z.string(),
  status: z.enum(routeStatuses),
  completedStops: z.number().int().nonnegative(),
  totalStops: z.number().int().positive(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  changeKind: z.enum(routeReassignmentKinds).nullable().optional(),
  reason: z.enum(routeTruckHandoffReasons).nullable().optional(),
  fromDriverName: z.string().nullable().optional(),
  toDriverName: z.string().nullable().optional(),
  fromTruckRegistration: z.string().nullable().optional(),
  toTruckRegistration: z.string().nullable().optional(),
  headline: z.string(),
  detail: z.string(),
  sortAt: z.string().optional()
});

export const driverTodayShiftSummarySchema = z.object({
  jobs: z.array(driverShiftJobSchema)
});

export const routeCoverSummarySchema = z.object({
  handoffId: z.string().uuid(),
  routeId: z.string().uuid(),
  zoneName: z.string(),
  routeStatus: z.enum(routeStatuses),
  changeKind: z.enum(routeReassignmentKinds),
  reason: z.enum(routeTruckHandoffReasons),
  fromDriverName: z.string().nullable(),
  toDriverName: z.string().nullable(),
  fromTruckRegistration: z.string().nullable(),
  toTruckRegistration: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  headline: z.string()
});

export const driverRouteNoticeSchema = z.object({
  id: z.string().uuid(),
  routeId: z.string().uuid().nullable(),
  noticeType: z.enum(["route_plan_changed", "routes_auto_loaded"]),
  title: z.string(),
  body: z.string(),
  createdAt: z.string()
});

export type RouteTemplateKind = (typeof routeTemplateKinds)[number];
export type SaveRouteAsTemplateInput = z.infer<typeof saveRouteAsTemplateInputSchema>;
export type SaveRouteAsTemplateResult = z.infer<typeof saveRouteAsTemplateResultSchema>;
export type EnsureDailyRoutesResult = z.infer<typeof ensureDailyRoutesResultSchema>;
export type DriverTodayPlanningStatus = z.infer<typeof driverTodayPlanningStatusSchema>;
export type DriverShiftJob = z.infer<typeof driverShiftJobSchema>;
export type DriverTodayShiftSummary = z.infer<typeof driverTodayShiftSummarySchema>;
export type RouteCoverSummary = z.infer<typeof routeCoverSummarySchema>;
export type DriverRouteNotice = z.infer<typeof driverRouteNoticeSchema>;

export type TruckOnboardingInput = z.infer<typeof truckOnboardingInputSchema>;
export type CustomerOnboardingInput = z.infer<typeof customerOnboardingInputSchema>;
export type StaffUpdateInput = z.infer<typeof staffUpdateInputSchema>;
export type TruckUpdateInput = z.infer<typeof truckUpdateInputSchema>;
export type CustomerUpdateInput = z.infer<typeof customerUpdateInputSchema>;
export type PaymentSummary = z.infer<typeof paymentSummarySchema>;
export type PaymentLedgerItem = z.infer<typeof paymentLedgerItemSchema>;
export type CustomerLedgerItem = z.infer<typeof customerLedgerItemSchema>;
export type PaymentEntry = z.infer<typeof paymentEntrySchema>;
export type AgentPaymentEntry = z.infer<typeof agentPaymentEntrySchema>;
export type AgentPaymentReceipt = z.infer<typeof agentPaymentReceiptSchema>;
export type AgentCollectionPayment = z.infer<typeof agentCollectionPaymentSchema>;
export type AgentDailyCollectionSummary = z.infer<typeof agentDailyCollectionSummarySchema>;
export type OperatorAgentCollectionAgent = z.infer<typeof operatorAgentCollectionAgentSchema>;
export type OperatorAgentCollectionsSnapshot = z.infer<typeof operatorAgentCollectionsSnapshotSchema>;
export type AgentPaymentAction = z.infer<typeof agentPaymentActionSchema>;
export type StaffAttendanceRow = z.infer<typeof staffAttendanceRowSchema>;
export type AttendanceOverride = z.infer<typeof attendanceOverrideSchema>;
export type MonthlyStaffSummary = z.infer<typeof monthlyStaffSummarySchema>;
export type StaffAttendanceSummary = z.infer<typeof staffAttendanceSummarySchema>;
export type FleetSummary = z.infer<typeof fleetSummarySchema>;
export type OperatorDashboard = z.infer<typeof operatorDashboardSchema>;

export {
  computePaystackSignature,
  paystackChargeMetadataSchema,
  paystackChargeSuccessDataSchema,
  paystackIdempotencyKey,
  paystackWebhookEventSchema,
  verifyPaystackSignature
} from "./paystack";
export type {
  PaystackChargeMetadata,
  PaystackChargeSuccessData,
  PaystackWebhookEvent
} from "./paystack";
