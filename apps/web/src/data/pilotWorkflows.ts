import type {
  AttendanceOverride,
  CustomerLedgerItem,
  IncidentReport,
  MonthlyStaffSummary,
  OperatorAgentCollectionsSnapshot,
  OperatorDashboard,
  OperatorProfile,
  PaymentChannel,
  PaymentEntry,
  PaymentLedgerItem,
  RouteDetail,
  RouteStop,
  RouteStopStatus,
  StaffAttendanceRow
} from "@cleanops/shared";
import { defaultOperatorBannerConfig, getOperationDate, getOperationMonth } from "@cleanops/shared";
import { pilotDashboard } from "./pilotDashboard";
import { deriveRouteProgress } from "../lib/routeProgress";

export const pilotProfile: OperatorProfile = {
  id: "00000000-0000-4000-8000-000000000011",
  operatorId: "00000000-0000-4000-8000-000000000001",
  operatorName: "Demo Waste Co (Fictional)",
  brandName: "Demo Waste Co (Fictional)",
  operatorStatus: "active",
  planCode: "pro",
  timezone: "Africa/Lagos",
  bannerConfig: defaultOperatorBannerConfig,
  fullName: "Lanre Operator",
  phone: "+2348000000011",
  role: "operator_owner"
};

export let pilotRouteDetails: RouteDetail[] = pilotDashboard.routes.map((route, routeIndex) => {
  const stops: RouteStop[] = Array.from({ length: 5 }, (_, stopIndex) => {
    const completed = stopIndex < Math.max(1, Math.floor(route.completedStops / 6));

    return {
      id: `${route.id.slice(0, 24)}${String(stopIndex + 1).padStart(12, "0")}`,
      customerName: [
        "Mrs. Folake Adebayo",
        "Mr. Tunde Lawal",
        "Tasty Bites Eatery",
        "Blue Gate Mini Mart",
        "Block C Residents Association"
      ][(routeIndex + stopIndex) % 5],
      address: `${14 + stopIndex} PSP Pilot Street, Surulere`,
      stopSequence: stopIndex + 1,
      status: completed ? "completed" : stopIndex === 3 ? "skipped" : "pending",
      completedAt: completed ? new Date().toISOString() : null,
      notes: stopIndex === 3 ? "Skipped pending service status review." : null,
      skipReason: stopIndex === 3 ? "Customer suspended for unpaid tag." : null,
      serviceStatus: stopIndex === 3 ? "suspended" : "active"
    };
  });

  return reconcilePilotRoute({
    ...route,
    scheduledDate: getOperationDate(),
    startedAt: route.status === "scheduled" ? null : new Date().toISOString(),
    completedAt: route.status === "completed" ? new Date().toISOString() : null,
    stops
  });
});

export const pilotIncidentReports: IncidentReport[] = [
  {
    id: "00000000-0000-4000-8000-000000000801",
    routeId: "00000000-0000-4000-8000-000000000502",
    routeLabel: "Ward B",
    truckRegistration: "LAG-002-PSP",
    reportedBy: "Chinedu Okafor",
    title: "Ward B running behind expected pace",
    description: "[other] Traffic delay around Market Road has slowed stop completion.",
    resolvedAt: null,
    createdAt: new Date().toISOString()
  }
];

type PilotPaymentLedgerItem = PaymentLedgerItem & { customerId: string };

export let pilotPayments: PilotPaymentLedgerItem[] = pilotDashboard.recentPayments.map((payment, index) => ({
  ...payment,
  customerId: [
    "00000000-0000-4000-8000-000000000401",
    "00000000-0000-4000-8000-000000000402",
    "00000000-0000-4000-8000-000000000405"
  ][index] ?? "00000000-0000-4000-8000-000000000401",
  address: [
    "14 Akinwunmi Street, Surulere",
    "22 Market Road, Surulere",
    "Block C Estate, Surulere"
  ][index] ?? "Ward 7, Surulere",
  customerType: index === 1 ? "restaurant" : index === 2 ? "estate" : "residential",
  serviceStatus: "active"
}));

export let pilotCustomerLedger: CustomerLedgerItem[] = [
  {
    customerId: "00000000-0000-4000-8000-000000000401",
    displayName: "Mrs. Folake Adebayo",
    phone: "+2348000000401",
    address: "14 Akinwunmi Street, Surulere",
    customerType: "residential",
    zoneName: "Ward A",
    monthlyRateKobo: 500000,
    paidThisMonthKobo: 500000,
    outstandingKobo: 0,
    serviceStatus: "active",
    suspensionReason: null,
    currentTagMonth: getOperationMonth(),
    lastPaymentAt: new Date().toISOString(),
    lastPaymentAmountKobo: 500000,
    lastPaymentChannel: "paystack",
    collectionsPerWeek: 1,
    preferredWeekdays: [1],
    frequencyNotes: null
  },
  {
    customerId: "00000000-0000-4000-8000-000000000404",
    displayName: "Blue Gate Mini Mart",
    phone: "+2348000000404",
    address: "25 Market Road, Surulere",
    customerType: "small_business",
    zoneName: "Ward B",
    monthlyRateKobo: 1500000,
    paidThisMonthKobo: 0,
    outstandingKobo: 1500000,
    serviceStatus: "suspended",
    suspensionReason: "Outstanding monthly balance unpaid",
    currentTagMonth: null,
    lastPaymentAt: null,
    lastPaymentAmountKobo: null,
    lastPaymentChannel: null,
    collectionsPerWeek: 1,
    preferredWeekdays: [2],
    frequencyNotes: null
  },
  {
    customerId: "00000000-0000-4000-8000-000000000405",
    displayName: "Block C Residents Association",
    phone: "+2348000000405",
    address: "Block C Estate, Surulere",
    customerType: "estate",
    zoneName: "Ward C",
    monthlyRateKobo: 7500000,
    paidThisMonthKobo: 7500000,
    outstandingKobo: 0,
    serviceStatus: "active",
    suspensionReason: null,
    currentTagMonth: getOperationMonth(),
    lastPaymentAt: new Date().toISOString(),
    lastPaymentAmountKobo: 7500000,
    lastPaymentChannel: "agent_cash",
    collectionsPerWeek: 1,
    preferredWeekdays: [3],
    frequencyNotes: null
  }
];

export let pilotStaffAttendance: StaffAttendanceRow[] = [
  "Adewale Johnson",
  "Chinedu Okafor",
  "Musa Balogun",
  "Grace Edet",
  "Kunle Martins",
  "Blessing Nwosu",
  "Samuel Ibitoye",
  "Loader Team A1",
  "Loader Team A2",
  "Loader Team B1",
  "Loader Team B2",
  "Loader Team C1",
  "Loader Team C2",
  "Fleet Officer",
  "Admin Officer",
  "Relief Loader"
].map((fullName, index) => {
  const isDriver = ["Adewale Johnson", "Chinedu Okafor", "Musa Balogun", "Samuel Ibitoye"].includes(fullName);
  const isLoader = fullName.startsWith("Loader Team") || fullName === "Relief Loader";
  const isAgent = ["Kunle Martins", "Blessing Nwosu"].includes(fullName);

  return {
    staffMemberId: `00000000-0000-4000-8000-${String(201 + index).padStart(12, "0")}`,
    fullName,
    phone: `+23480000002${String(index + 1).padStart(2, "0")}`,
    role: isDriver ? "driver" : isLoader ? "loader" : isAgent ? "collection_agent" : "operations_supervisor",
    monthlySalaryKobo: isDriver ? 18000000 : isAgent ? 14000000 : isLoader ? 9000000 : 16000000,
    checkedInAt: index < 14 ? new Date().toISOString() : null,
    supervisorOverride: false,
    status: index < 14 ? "checked_in" : "absent",
    absenceReason: index >= 14 ? "Awaiting supervisor review" : null,
    attendanceNote: null
  };
});

export function applyPilotAttendanceOverride(override: AttendanceOverride): StaffAttendanceRow[] {
  pilotStaffAttendance = pilotStaffAttendance.map((staff) =>
    staff.staffMemberId === override.staffMemberId
      ? {
          ...staff,
          checkedInAt: override.checkedIn ? `${override.attendanceDate}T08:00:00.000Z` : null,
          supervisorOverride: override.checkedIn,
          status: override.checkedIn ? "checked_in" : "absent",
          absenceReason: override.checkedIn ? null : override.reason ?? "No reason provided",
          attendanceNote: override.note ?? null
        }
      : staff
  );

  return pilotStaffAttendance;
}

export function updatePilotStopStatus(
  routeId: string,
  stopId: string,
  status: RouteStopStatus,
  notes?: string,
  skipReason?: string
): RouteDetail[] {
  const trimmedSkipReason = skipReason?.trim();

  if (status === "skipped" && !trimmedSkipReason) {
    throw new Error("Skip reason is required");
  }

  pilotRouteDetails = pilotRouteDetails.map((route) => {
    if (route.id !== routeId) {
      return route;
    }

    return reconcilePilotRoute({
      ...route,
      stops: route.stops.map((stop) =>
        stop.id === stopId
          ? {
              ...stop,
              status,
              completedAt: status === "completed" ? new Date().toISOString() : null,
              notes: notes?.trim() || stop.notes,
              skipReason: status === "skipped" ? trimmedSkipReason ?? null : null
            }
          : stop
      )
    });
  });

  return pilotRouteDetails;
}

export function updatePilotRouteStatus(routeId: string, status: RouteDetail["status"]): RouteDetail[] {
  pilotRouteDetails = pilotRouteDetails.map((route) => {
    if (route.id !== routeId) {
      return route;
    }

    return reconcilePilotRoute({
      ...route,
      status,
      startedAt: status === "in_progress" ? new Date().toISOString() : route.startedAt,
      completedAt: status === "completed" || status === "cancelled" ? new Date().toISOString() : route.completedAt
    });
  });

  return pilotRouteDetails;
}

export function getPilotDashboard(): OperatorDashboard {
  const checkedIn = pilotStaffAttendance.filter((staff) => staff.status === "checked_in").length;

  return {
    ...pilotDashboard,
    metrics: pilotDashboard.metrics.map((metric) =>
      metric.label === "Staff Checked In"
        ? {
            ...metric,
            value: `${checkedIn} / ${pilotStaffAttendance.length}`,
            helper: `${pilotStaffAttendance.length - checkedIn} unresolved absences`
          }
        : metric
    ),
    recentPayments: pilotPayments.slice(0, 3).map(({ customerId, ...payment }) => payment),
    staffAttendance: {
      totalStaff: pilotStaffAttendance.length,
      checkedIn,
      absent: pilotStaffAttendance.length - checkedIn
    },
    routes: pilotRouteDetails.map(({ id, zoneName, truckRegistration, driverName, status, completedStops, totalStops, delayed }) => ({
      id,
      zoneName,
      truckRegistration,
      driverName,
      status,
      completedStops,
      totalStops,
      delayed
    }))
  };
}

export function getPilotMonthlyStaffSummary(): MonthlyStaffSummary[] {
  return pilotStaffAttendance.map((staff) => ({
    staffMemberId: staff.staffMemberId,
    fullName: staff.fullName,
    role: staff.role,
    monthlySalaryKobo: staff.monthlySalaryKobo,
    daysCheckedIn: staff.status === "checked_in" ? 1 : 0,
    daysAbsent: staff.status === "absent" ? 1 : 0,
    estimatedPayrollKobo: staff.monthlySalaryKobo
  }));
}

export function getPilotOperatorAgentCollections(collectionDate: string): OperatorAgentCollectionsSnapshot {
  const agentPayments = pilotPayments
    .filter((payment) => payment.channel === "agent_cash")
    .map((payment) => ({
      paymentId: payment.id,
      customerName: payment.customerName,
      amountKobo: payment.amountKobo,
      channel: payment.channel,
      receiptReference: null,
      paidAt: payment.paidAt
    }));

  const totalCollectedKobo = agentPayments.reduce((sum, payment) => sum + payment.amountKobo, 0);

  return {
    collectionDate,
    totalCollectedKobo,
    paymentCount: agentPayments.length,
    agents: [
      {
        agentStaffId: "00000000-0000-4000-8000-000000000205",
        agentName: "Kunle Martins",
        totalCollectedKobo,
        paymentCount: agentPayments.length,
        payments: agentPayments
      }
    ]
  };
}

function reconcilePilotRoute(route: RouteDetail): RouteDetail {
  return deriveRouteProgress(route);
}

export function recordPilotPayment(entry: PaymentEntry): CustomerLedgerItem[] {
  const customer = pilotCustomerLedger.find((ledgerItem) => ledgerItem.customerId === entry.customerId);

  if (!customer) {
    throw new Error("Customer not found");
  }

  const paidThisMonthKobo = customer.paidThisMonthKobo + entry.amountKobo;
  const outstandingKobo = Math.max(customer.monthlyRateKobo - paidThisMonthKobo, 0);
  const paidAt = new Date().toISOString();
  const shouldReactivate = outstandingKobo === 0;

  pilotPayments = [
    {
      id: crypto.randomUUID(),
      customerId: customer.customerId,
      customerName: customer.displayName,
      channel: entry.channel,
      amountKobo: entry.amountKobo,
      paidAt,
      customerType: customer.customerType,
      address: customer.address,
      serviceStatus: shouldReactivate ? "active" : customer.serviceStatus
    },
    ...pilotPayments
  ];

  pilotCustomerLedger = pilotCustomerLedger.map((customer) => {
    if (customer.customerId !== entry.customerId) {
      return customer;
    }

    return {
      ...customer,
      paidThisMonthKobo,
      outstandingKobo,
      serviceStatus: shouldReactivate ? "active" : customer.serviceStatus,
      suspensionReason: shouldReactivate ? null : customer.suspensionReason,
      currentTagMonth: shouldReactivate ? getOperationMonth() : customer.currentTagMonth,
      lastPaymentAt: paidAt,
      lastPaymentAmountKobo: entry.amountKobo,
      lastPaymentChannel: entry.channel
    };
  });

  return pilotCustomerLedger;
}

export function updatePilotCustomerStatus(
  customerId: string,
  status: CustomerLedgerItem["serviceStatus"],
  tagMonth?: string,
  suspensionReason?: string
): CustomerLedgerItem[] {
  pilotCustomerLedger = pilotCustomerLedger.map((customer) =>
    customer.customerId === customerId
      ? {
          ...customer,
          serviceStatus: status,
          suspensionReason:
            status === "suspended"
              ? suspensionReason ?? "Suspended by operator"
              : null,
          currentTagMonth: status === "active" ? tagMonth ?? customer.currentTagMonth : null
        }
      : customer
  );

  return pilotCustomerLedger;
}

export function getPilotPaymentHistory(customerId: string): PaymentLedgerItem[] {
  return pilotPayments.filter((payment) => payment.customerId === customerId);
}
