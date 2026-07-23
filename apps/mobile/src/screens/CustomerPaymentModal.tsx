import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import type {
  AgentPaymentReceipt,
  CustomerLedgerItem,
  PaymentChannel,
  PaymentLedgerItem
} from "@cleanops/shared";
import { getCustomerPaymentHistory } from "../data/agentService";

const paymentChannels: PaymentChannel[] = [
  "agent_cash",
  "bank_transfer",
  "opay",
  "palmpay",
  "moniepoint"
];

function formatNaira(amountKobo: number) {
  return `₦${(amountKobo / 100).toLocaleString("en-NG")}`;
}

function formatChannel(channel: PaymentChannel) {
  return channel.replace("_", " ");
}

function formatPaymentDate(paidAt: string) {
  return new Date(paidAt).toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export default function CustomerPaymentModal({
  customer,
  visible,
  amountNaira,
  channel,
  reference,
  submitting,
  lastReceipt,
  onAmountChange,
  onChannelChange,
  onReferenceChange,
  onClose,
  onSubmit
}: {
  customer: CustomerLedgerItem | null;
  visible: boolean;
  amountNaira: string;
  channel: PaymentChannel;
  reference: string;
  submitting: boolean;
  lastReceipt: AgentPaymentReceipt | null;
  onAmountChange: (value: string) => void;
  onChannelChange: (value: PaymentChannel) => void;
  onReferenceChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const [history, setHistory] = useState<PaymentLedgerItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    if (!visible || !customer) {
      return;
    }

    void (async () => {
      setHistoryLoading(true);

      try {
        setHistory(await getCustomerPaymentHistory(customer.customerId));
      } finally {
        setHistoryLoading(false);
      }
    })();
  }, [visible, customer?.customerId, lastReceipt?.paymentId]);

  if (!customer) {
    return null;
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.backdrop}>
        <Pressable onPress={onClose} style={styles.backdropDismiss} />
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeaderText}>
              <Text style={styles.sheetEyebrow}>Record payment for</Text>
              <Text style={styles.sheetTitle}>{customer.displayName}</Text>
              <Text style={styles.sheetMeta}>
                {customer.zoneName} · {customer.address}
              </Text>
              {customer.serviceStatus === "suspended" && customer.suspensionReason ? (
                <Text style={styles.suspensionNote}>{customer.suspensionReason}</Text>
              ) : null}
            </View>
            <Pressable onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>Close</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
            <View style={styles.summaryStrip}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Monthly</Text>
                <Text style={styles.summaryValue}>{formatNaira(customer.monthlyRateKobo)}</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Paid this month</Text>
                <Text style={styles.summaryValue}>{formatNaira(customer.paidThisMonthKobo)}</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Outstanding</Text>
                <Text style={[styles.summaryValue, styles.summaryValueAccent]}>
                  {formatNaira(customer.outstandingKobo)}
                </Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Transaction history</Text>
              {historyLoading ? (
                <ActivityIndicator color="#1a7f45" size="small" />
              ) : history.length === 0 ? (
                <Text style={styles.emptyCopy}>No previous payments recorded for this customer.</Text>
              ) : (
                history.map((payment) => (
                  <View key={payment.id} style={styles.historyItem}>
                    <View style={styles.historyRow}>
                      <Text style={styles.historyAmount}>{formatNaira(payment.amountKobo)}</Text>
                      <Text style={styles.historyChannel}>{formatChannel(payment.channel)}</Text>
                    </View>
                    <Text style={styles.historyDate}>{formatPaymentDate(payment.paidAt)}</Text>
                  </View>
                ))
              )}
            </View>

            {lastReceipt && lastReceipt.customerName === customer.displayName ? (
              <View style={styles.receiptBanner}>
                <Text style={styles.receiptTitle}>Payment recorded</Text>
                <Text style={styles.receiptReference}>{lastReceipt.receiptReference}</Text>
                <Text style={styles.receiptMeta}>
                  {formatNaira(lastReceipt.amountKobo)} · Outstanding after payment{" "}
                  {formatNaira(lastReceipt.outstandingKobo)}
                </Text>
                <Pressable
                  onPress={() =>
                    void Share.share({
                      message: `Clean Ops receipt ${lastReceipt.receiptReference}\nCustomer: ${lastReceipt.customerName}\nAmount: ${formatNaira(lastReceipt.amountKobo)}\nOutstanding: ${formatNaira(lastReceipt.outstandingKobo)}`
                    })
                  }
                  style={styles.shareButton}
                >
                  <Text style={styles.shareButtonText}>Share receipt reference</Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>New payment</Text>
              <TextInput
                keyboardType="decimal-pad"
                onChangeText={onAmountChange}
                placeholder="Amount in naira"
                style={styles.input}
                value={amountNaira}
              />
              <View style={styles.channelRow}>
                {paymentChannels.map((paymentChannel) => (
                  <Pressable
                    key={paymentChannel}
                    onPress={() => onChannelChange(paymentChannel)}
                    style={[styles.channelPill, channel === paymentChannel && styles.channelPillActive]}
                  >
                    <Text style={[styles.channelText, channel === paymentChannel && styles.channelTextActive]}>
                      {formatChannel(paymentChannel)}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                onChangeText={onReferenceChange}
                placeholder="Receipt reference (optional)"
                style={styles.input}
                value={reference}
              />
              <Pressable
                disabled={submitting}
                onPress={onSubmit}
                style={[styles.primaryButton, submitting && styles.buttonDisabled]}
              >
                <Text style={styles.primaryButtonText}>
                  {submitting ? "Recording..." : `Record payment for ${customer.displayName}`}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: "rgba(16, 32, 23, 0.45)",
    flex: 1,
    justifyContent: "flex-end"
  },
  backdropDismiss: {
    flex: 1
  },
  sheet: {
    backgroundColor: "#f3f7f1",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "92%"
  },
  sheetHeader: {
    alignItems: "flex-start",
    borderBottomColor: "#dbe7dd",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14
  },
  sheetHeaderText: {
    flex: 1
  },
  sheetEyebrow: {
    color: "#1a7f45",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase"
  },
  sheetTitle: {
    color: "#102017",
    fontSize: 24,
    fontWeight: "800",
    marginTop: 4
  },
  sheetMeta: {
    color: "#637466",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6
  },
  suspensionNote: {
    color: "#a8550b",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6
  },
  closeButton: {
    backgroundColor: "#ffffff",
    borderColor: "#dbe7dd",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8
  },
  closeButtonText: {
    color: "#637466",
    fontSize: 14,
    fontWeight: "700"
  },
  sheetContent: {
    padding: 20,
    paddingBottom: 32
  },
  summaryStrip: {
    backgroundColor: "#ffffff",
    borderColor: "#dbe7dd",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    padding: 14
  },
  summaryItem: {
    minWidth: "28%"
  },
  summaryLabel: {
    color: "#637466",
    fontSize: 12
  },
  summaryValue: {
    color: "#102017",
    fontSize: 16,
    fontWeight: "800",
    marginTop: 4
  },
  summaryValueAccent: {
    color: "#1a7f45"
  },
  section: {
    backgroundColor: "#ffffff",
    borderColor: "#dbe7dd",
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 16,
    padding: 16
  },
  sectionTitle: {
    color: "#102017",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 12
  },
  emptyCopy: {
    color: "#637466",
    fontSize: 14,
    lineHeight: 20
  },
  historyItem: {
    borderTopColor: "#edf3ee",
    borderTopWidth: 1,
    paddingTop: 10,
    marginTop: 10
  },
  historyRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  historyAmount: {
    color: "#102017",
    fontSize: 16,
    fontWeight: "700"
  },
  historyChannel: {
    color: "#1a7f45",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "capitalize"
  },
  historyDate: {
    color: "#637466",
    fontSize: 13,
    marginTop: 4
  },
  receiptBanner: {
    backgroundColor: "#e7f7ed",
    borderColor: "#8ecfaa",
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 16,
    padding: 14
  },
  receiptTitle: {
    color: "#145c32",
    fontSize: 14,
    fontWeight: "800"
  },
  receiptReference: {
    color: "#145c32",
    fontSize: 22,
    fontWeight: "800",
    marginTop: 4
  },
  receiptMeta: {
    color: "#4b5f52",
    fontSize: 14,
    marginTop: 6
  },
  shareButton: {
    alignSelf: "flex-start",
    backgroundColor: "#ffffff",
    borderColor: "#8ecfaa",
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 8
  },
  shareButtonText: {
    color: "#145c32",
    fontSize: 13,
    fontWeight: "700"
  },
  input: {
    backgroundColor: "#f8fbf7",
    borderColor: "#dbe7dd",
    borderRadius: 12,
    borderWidth: 1,
    color: "#102017",
    marginBottom: 12,
    padding: 12
  },
  channelRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12
  },
  channelPill: {
    backgroundColor: "#f3f7f1",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  channelPillActive: {
    backgroundColor: "#1a7f45"
  },
  channelText: {
    color: "#1a7f45",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "capitalize"
  },
  channelTextActive: {
    color: "#ffffff"
  },
  primaryButton: {
    backgroundColor: "#1a7f45",
    borderRadius: 14,
    elevation: 3,
    paddingHorizontal: 16,
    paddingVertical: 15,
    shadowColor: "#1a7f45",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center"
  },
  buttonDisabled: {
    opacity: 0.5
  }
});
