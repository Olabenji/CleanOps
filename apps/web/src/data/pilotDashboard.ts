import type { OperatorDashboard } from "@cleanops/shared";

export const pilotDashboard: OperatorDashboard = {
  operatorName: "Next to Godliness Ventures",
  metrics: [
    {
      label: "Route Progress",
      value: "42 / 90 stops",
      helper: "3 trucks active across Zones A-C"
    },
    {
      label: "Payments Today",
      value: "₦184,500",
      helper: "Paystack, transfers, and agent cash"
    },
    {
      label: "Staff Checked In",
      value: "14 / 16",
      helper: "2 unresolved absences"
    },
    {
      label: "Fleet Alerts",
      value: "1 open",
      helper: "Quarterly service due in 7 days"
    }
  ],
  routes: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      zoneName: "Zone A",
      truckRegistration: "LAG-001-PSP",
      driverName: "Adewale Johnson",
      status: "in_progress",
      completedStops: 18,
      totalStops: 30,
      delayed: false
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      zoneName: "Zone B",
      truckRegistration: "LAG-002-PSP",
      driverName: "Chinedu Okafor",
      status: "in_progress",
      completedStops: 14,
      totalStops: 30,
      delayed: true
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      zoneName: "Zone C",
      truckRegistration: "LAG-003-PSP",
      driverName: "Musa Balogun",
      status: "scheduled",
      completedStops: 10,
      totalStops: 30,
      delayed: false
    }
  ],
  recentPayments: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      customerName: "Mrs. Folake Adebayo",
      channel: "paystack",
      amountKobo: 500000,
      paidAt: new Date().toISOString()
    },
    {
      id: "55555555-5555-4555-8555-555555555555",
      customerName: "Tasty Bites Eatery",
      channel: "bank_transfer",
      amountKobo: 2500000,
      paidAt: new Date().toISOString()
    },
    {
      id: "66666666-6666-4666-8666-666666666666",
      customerName: "Block C Residents Association",
      channel: "agent_cash",
      amountKobo: 7500000,
      paidAt: new Date().toISOString()
    }
  ],
  staffAttendance: {
    totalStaff: 16,
    checkedIn: 14,
    absent: 2
  },
  fleet: [
    {
      registrationNumber: "LAG-001-PSP",
      zoneName: "Zone A",
      status: "operational",
      reserveRemainingKobo: 14500000
    },
    {
      registrationNumber: "LAG-002-PSP",
      zoneName: "Zone B",
      status: "operational",
      reserveRemainingKobo: 9800000
    },
    {
      registrationNumber: "LAG-003-PSP",
      zoneName: "Zone C",
      status: "standby",
      reserveRemainingKobo: 20000000
    }
  ],
  alerts: [
    "Zone B is more than 20% behind expected route pace.",
    "Two staff members have not checked in for today's shift.",
    "LAG-002-PSP quarterly service is due within seven days."
  ]
};
