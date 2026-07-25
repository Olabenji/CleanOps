import type { CustomerLedgerItem, PaymentLedgerItem } from "@cleanops/shared";
import { getOperationDate, getOperationMonth } from "@cleanops/shared";

export const pilotAgent = {
  fullName: "Kunle Martins",
  operatorName: "Next to Godliness Ventures"
};

export const pilotAgentCustomers: CustomerLedgerItem[] = [
  {
    customerId: "00000000-0000-4000-8000-000000000401",
    displayName: "Mrs. Folake Adebayo",
    phone: "+2348000000401",
    address: "14 Akinwunmi Street, Surulere",
    customerType: "residential",
    zoneName: "Ward A",
    monthlyRateKobo: 500000,
    paidThisMonthKobo: 0,
    outstandingKobo: 500000,
    serviceStatus: "active",
    suspensionReason: null,
    currentTagMonth: null,
    lastPaymentAt: null,
    lastPaymentAmountKobo: null,
    lastPaymentChannel: null,
    collectionsPerWeek: 1,
    preferredWeekdays: [1],
    frequencyNotes: null
  },
  {
    customerId: "00000000-0000-4000-8000-000000000402",
    displayName: "Mr. Tunde Lawal",
    phone: "+2348000000402",
    address: "16 Akinwunmi Street, Surulere",
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
    lastPaymentChannel: "agent_cash",
    collectionsPerWeek: 1,
    preferredWeekdays: [1],
    frequencyNotes: null
  },
  {
    customerId: "00000000-0000-4000-8000-000000000403",
    displayName: "Tasty Bites Eatery",
    phone: "+2348000000403",
    address: "22 Market Road, Surulere",
    customerType: "restaurant",
    zoneName: "Ward B",
    monthlyRateKobo: 2500000,
    paidThisMonthKobo: 1000000,
    outstandingKobo: 1500000,
    serviceStatus: "active",
    suspensionReason: null,
    currentTagMonth: null,
    lastPaymentAt: new Date().toISOString(),
    lastPaymentAmountKobo: 1000000,
    lastPaymentChannel: "agent_cash",
    collectionsPerWeek: 3,
    preferredWeekdays: [1, 3, 5],
    frequencyNotes: "Seed: restaurant multi-day cadence (Mon/Wed/Fri)"
  }
];

export let pilotAgentCollections: Array<{
  paymentId: string;
  customerId: string;
  customerName: string;
  amountKobo: number;
  channel: "agent_cash";
  receiptReference: string;
  paidAt: string;
}> = [];

export function filterPilotCustomers(query: string) {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return pilotAgentCustomers;
  }

  return pilotAgentCustomers.filter(
    (customer) =>
      customer.displayName.toLowerCase().includes(normalized) ||
      customer.address.toLowerCase().includes(normalized) ||
      (customer.phone ?? "").toLowerCase().includes(normalized)
  );
}

export function recordPilotAgentPayment(input: {
  customerId: string;
  amountKobo: number;
  externalReference?: string;
}) {
  const customer = pilotAgentCustomers.find((item) => item.customerId === input.customerId);

  if (!customer) {
    throw new Error("Customer not found");
  }

  const receiptReference =
    input.externalReference?.trim() ||
    `RCP-PILOT-${Date.now().toString().slice(-6)}`;
  const paidAt = new Date().toISOString();
  const paymentId = `00000000-0000-4000-8000-${String(900 + pilotAgentCollections.length).padStart(12, "0")}`;
  const paidThisMonthKobo = customer.paidThisMonthKobo + input.amountKobo;
  const outstandingKobo = Math.max(customer.monthlyRateKobo - paidThisMonthKobo, 0);

  customer.paidThisMonthKobo = paidThisMonthKobo;
  customer.outstandingKobo = outstandingKobo;
  customer.lastPaymentAt = paidAt;
  customer.lastPaymentAmountKobo = input.amountKobo;
  customer.lastPaymentChannel = "agent_cash";

  if (outstandingKobo === 0) {
    customer.serviceStatus = "active";
    customer.suspensionReason = null;
    customer.currentTagMonth = new Date().toISOString().slice(0, 7) + "-01";
  }

  pilotAgentCollections = [
    {
      paymentId,
      customerId: input.customerId,
      customerName: customer.displayName,
      amountKobo: input.amountKobo,
      channel: "agent_cash",
      receiptReference,
      paidAt
    },
    ...pilotAgentCollections
  ];

  return {
    paymentId,
    receiptReference,
    customerName: customer.displayName,
    amountKobo: input.amountKobo,
    channel: "agent_cash" as const,
    paidAt,
    outstandingKobo
  };
}

export function getPilotAgentDailySummary(collectionDate = getOperationDate()) {
  const payments = pilotAgentCollections.filter((payment) => payment.paidAt.slice(0, 10) === collectionDate);

  return {
    collectionDate,
    agentName: pilotAgent.fullName,
    totalCollectedKobo: payments.reduce((sum, payment) => sum + payment.amountKobo, 0),
    paymentCount: payments.length,
    payments: payments.map(({ customerId: _customerId, ...payment }) => payment)
  };
}

export function getPilotCustomerPaymentHistory(customerId: string): PaymentLedgerItem[] {
  const customer = pilotAgentCustomers.find((item) => item.customerId === customerId);

  if (!customer) {
    return [];
  }

  const recorded = pilotAgentCollections
    .filter((payment) => payment.customerId === customerId)
    .map((payment) => ({
      id: payment.paymentId,
      customerName: payment.customerName,
      channel: payment.channel,
      amountKobo: payment.amountKobo,
      paidAt: payment.paidAt,
      customerType: customer.customerType,
      address: customer.address,
      serviceStatus: customer.serviceStatus
    }));

  const seeded =
    customer.lastPaymentAt && customer.lastPaymentAmountKobo && customer.lastPaymentChannel
      ? [
          {
            id: `00000000-0000-4000-8000-${customerId.slice(-12)}`,
            customerName: customer.displayName,
            channel: customer.lastPaymentChannel,
            amountKobo: customer.lastPaymentAmountKobo,
            paidAt: customer.lastPaymentAt,
            customerType: customer.customerType,
            address: customer.address,
            serviceStatus: customer.serviceStatus
          }
        ]
      : [];

  const seen = new Set<string>();

  return [...recorded, ...seeded]
    .filter((payment) => {
      const key = `${payment.paidAt}:${payment.amountKobo}`;
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .sort((left, right) => new Date(right.paidAt).getTime() - new Date(left.paidAt).getTime());
}
