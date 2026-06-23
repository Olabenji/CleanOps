import type {
  AttendanceOverride,
  CustomerLedgerItem,
  IncidentReport,
  MonthlyStaffSummary,
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
import { pilotDashboard } from "./pilotDashboard";

export const demoCredentials = {
  email: "owner@cleanops.local",
  password: "cleanops-demo-password"
};

export const pilotProfile: OperatorProfile = {
  id: "00000000-0000-4000-8000-000000000011",
  operatorId: "00000000-0000-4000-8000-000000000001",
  operatorName: "Next to Godliness Ventures",
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
    scheduledDate: new Date().toISOString().slice(0, 10),
    startedAt: route.status === "scheduled" ? null : new Date().toISOString(),
    completedAt: route.status === "completed" ? new Date().toISOString() : null,
    stops
  });
});

export const pilotIncidentReports: IncidentReport[] = [
  {
    id: "00000000-0000-4000-8000-000000000801",
    routeId: "00000000-0000-4000-8000-000000000502",
    routeLabel: "Zone B",
    truckRegistration: "LAG-002-PSP",
    reportedBy: "Chinedu Okafor",
    title: "Zone B running behind expected pace",
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
    zoneName: "Zone A",
    monthlyRateKobo: 500000,
    paidThisMonthKobo: 500000,
    outstandingKobo: 0,
    serviceStatus: "active",
    currentTagMonth: new Date().toISOString().slice(0, 10),
    lastPaymentAt: new Date().toISOString(),
    lastPaymentAmountKobo: 500000,
    lastPaymentChannel: "paystack"
  },
  {
    customerId: "00000000-0000-4000-8000-000000000404",
    displayName: "Blue Gate Mini Mart",
    phone: "+2348000000404",
    address: "25 Market Road, Surulere",
    customerType: "small_business",
    zoneName: "Zone B",
    monthlyRateKobo: 1500000,
    paidThisMonthKobo: 0,
    outstandingKobo: 1500000,
    serviceStatus: "suspended",
    currentTagMonth: null,
    lastPaymentAt: null,
    lastPaymentAmountKobo: null,
    lastPaymentChannel: null
  },
  {
    customerId: "00000000-0000-4000-8000-000000000405",
    displayName: "Block C Residents Association",
    phone: "+2348000000405",
    address: "Block C Estate, Surulere",
    customerType: "estate",
    zoneName: "Zone C",
    monthlyRateKobo: 7500000,
    paidThisMonthKobo: 7500000,
    outstandingKobo: 0,
    serviceStatus: "active",
    currentTagMonth: new Date().toISOString().slice(0, 10),
    lastPaymentAt: new Date().toISOString(),
    lastPaymentAmountKobo: 7500000,
    lastPaymentChannel: "agent_cash"
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
].map((fullName, index) => ({
  staffMemberId: `00000000-0000-4000-8000-${String(201 + index).padStart(12, "0")}`,
  fullName,
  phone: `+23480000002${String(index + 1).padStart(2, "0")}`,
  role: index < 3 || index === 6 || index >= 7 ? "driver" : index < 6 ? "collection_agent" : "operations_supervisor",
  monthlySalaryKobo: index < 3 || index === 6 ? 18000000 : index < 6 ? 14000000 : 9000000,
  checkedInAt: index < 14 ? new Date().toISOString() : null,
  supervisorOverride: false,
  status: index < 14 ? "checked_in" : "absent",
  absenceReason: index >= 14 ? "Awaiting supervisor review" : null,
  attendanceNote: null
}));

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

function reconcilePilotRoute(route: RouteDetail): RouteDetail {
  const resolvedStops = route.stops.filter((stop) => stop.status !== "pending").length;

  return {
    ...route,
    completedStops: resolvedStops,
    totalStops: route.stops.length,
    delayed: route.status === "in_progress" && resolvedStops / Math.max(route.stops.length, 1) < 0.35
  };
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
      currentTagMonth: shouldReactivate ? new Date().toISOString().slice(0, 10) : customer.currentTagMonth,
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
  tagMonth?: string
): CustomerLedgerItem[] {
  pilotCustomerLedger = pilotCustomerLedger.map((customer) =>
    customer.customerId === customerId
      ? {
          ...customer,
          serviceStatus: status,
          currentTagMonth: status === "active" ? tagMonth ?? customer.currentTagMonth : null
        }
      : customer
  );

  return pilotCustomerLedger;
}

export function getPilotPaymentHistory(customerId: string): PaymentLedgerItem[] {
  return pilotPayments.filter((payment) => payment.customerId === customerId);
}
