import {
  agentDailyCollectionSummarySchema,
  agentPaymentReceiptSchema,
  customerLedgerItemSchema,
  getOperationDate,
  paymentLedgerItemSchema,
  type AgentDailyCollectionSummary,
  type AgentPaymentEntry,
  type AgentPaymentReceipt,
  type CustomerLedgerItem,
  type PaymentLedgerItem
} from "@cleanops/shared";
import { supabase } from "../lib/supabase";
import { withTimeout } from "../lib/withTimeout";
import {
  filterPilotCustomers,
  getPilotAgentDailySummary,
  getPilotCustomerPaymentHistory,
  recordPilotAgentPayment
} from "./agentPilot";

const REQUEST_TIMEOUT_MS = 15_000;

export async function searchCustomers(query = ""): Promise<CustomerLedgerItem[]> {
  if (!supabase) {
    return filterPilotCustomers(query);
  }

  const { data, error } = await withTimeout(
    supabase.rpc("search_customers", {
      input_query: query.trim() || null
    }),
    REQUEST_TIMEOUT_MS,
    "Timed out while searching customers"
  );

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return [];
  }

  return customerLedgerItemSchema.array().parse(data);
}

export async function recordAgentPayment(entry: AgentPaymentEntry): Promise<AgentPaymentReceipt> {
  if (!supabase) {
    return agentPaymentReceiptSchema.parse(
      recordPilotAgentPayment({
        customerId: entry.customerId,
        amountKobo: entry.amountKobo,
        externalReference: entry.externalReference
      })
    );
  }

  const { data: sessionData } = await supabase.auth.getSession();

  if (!sessionData.session) {
    throw new Error("Collection agent is not signed in to Supabase");
  }

  const { data, error } = await supabase.rpc("record_agent_payment", {
    input_customer_id: entry.customerId,
    input_amount_kobo: entry.amountKobo,
    input_channel: entry.channel,
    input_external_reference: entry.externalReference ?? null,
    input_idempotency_key: entry.idempotencyKey ?? null
  });

  if (error) {
    throw new Error(error.message);
  }

  return agentPaymentReceiptSchema.parse(data);
}

export async function getCustomerPaymentHistory(customerId: string): Promise<PaymentLedgerItem[]> {
  if (!supabase) {
    return getPilotCustomerPaymentHistory(customerId);
  }

  const { data, error } = await withTimeout(
    supabase.rpc("customer_payment_history", {
      input_customer_id: customerId
    }),
    REQUEST_TIMEOUT_MS,
    "Timed out while loading payment history"
  );

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return [];
  }

  return paymentLedgerItemSchema.array().parse(data);
}

export async function getAgentDailySummary(
  collectionDate = getOperationDate()
): Promise<AgentDailyCollectionSummary> {
  if (!supabase) {
    return agentDailyCollectionSummarySchema.parse(getPilotAgentDailySummary(collectionDate));
  }

  const { data, error } = await withTimeout(
    supabase.rpc("agent_daily_collection_summary", {
      input_date: collectionDate
    }),
    REQUEST_TIMEOUT_MS,
    "Timed out while loading collection summary"
  );

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return {
      collectionDate,
      agentName: "Collection agent",
      totalCollectedKobo: 0,
      paymentCount: 0,
      payments: []
    };
  }

  return agentDailyCollectionSummarySchema.parse(data);
}
