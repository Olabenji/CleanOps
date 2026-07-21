import type { ResidentHome, ResidentPayment } from "@cleanops/shared";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import {
  startResidentPaystackCheckout,
  verifyResidentPaystackPayment
} from "../data/residentService";
import { colors } from "../theme";

function formatKobo(amountKobo: number) {
  return `₦${Math.round(amountKobo / 100).toLocaleString("en-NG")}`;
}

function referenceFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get("reference") ?? parsed.searchParams.get("trxref");
  } catch {
    return null;
  }
}

export default function ResidentPaymentsScreen({
  home,
  payments,
  onPaymentConfirmed
}: {
  home: ResidentHome;
  payments: ResidentPayment[];
  onPaymentConfirmed: () => Promise<void>;
}) {
  const [amountNaira, setAmountNaira] = useState(
    home.outstandingKobo > 0 ? String(Math.round(home.outstandingKobo / 100)) : ""
  );
  const [pendingReference, setPendingReference] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function confirmPayment(reference: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await verifyResidentPaystackPayment(reference);
      setMessage(
        `${result.alreadyPosted ? "Payment was already recorded" : "Payment confirmed"}: ${formatKobo(
          result.amountKobo
        )}.`
      );
      setPendingReference(null);
      await onPaymentConfirmed();
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "Unable to confirm payment");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const subscription = Linking.addEventListener("url", ({ url }) => {
      if (!url.startsWith("cleanops://paystack-return")) {
        return;
      }
      const reference = referenceFromUrl(url) ?? pendingReference;
      if (reference) {
        void confirmPayment(reference);
      }
    });
    return () => subscription.remove();
  }, [pendingReference]);

  async function startCheckout() {
    const amount = Number(amountNaira.replace(/,/g, "").trim());
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a valid payment amount.");
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const checkout = await startResidentPaystackCheckout({
        amountKobo: Math.round(amount * 100),
        callbackUrl: "cleanops://paystack-return"
      });
      setPendingReference(checkout.reference);
      await Linking.openURL(checkout.authorizationUrl);
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : "Unable to start payment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>This month&apos;s account</Text>
        <Text style={styles.amount}>{formatKobo(home.outstandingKobo)}</Text>
        <Text style={styles.muted}>
          Monthly rate {formatKobo(home.monthlyRateKobo)} · Paid {formatKobo(home.paidThisMonthKobo)}
        </Text>
        {home.lastPaymentAt ? (
          <Text style={styles.muted}>
            Last payment {formatKobo(home.lastPaymentAmountKobo ?? 0)} via{" "}
            {(home.lastPaymentChannel ?? "unknown").replace(/_/g, " ")} ·{" "}
            {new Date(home.lastPaymentAt).toLocaleDateString("en-GB")}
          </Text>
        ) : null}

        <Text style={styles.label}>Amount (naira)</Text>
        <TextInput
          editable={!busy}
          keyboardType="numeric"
          onChangeText={setAmountNaira}
          placeholder="e.g. 5000"
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={amountNaira}
        />
        <Pressable
          disabled={busy || home.outstandingKobo === 0}
          onPress={() => void startCheckout()}
          style={[styles.primaryButton, (busy || home.outstandingKobo === 0) && styles.disabled]}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Pay with Paystack</Text>}
        </Pressable>
        {pendingReference ? (
          <Pressable disabled={busy} onPress={() => void confirmPayment(pendingReference)} style={styles.secondaryButton}>
            <Text style={styles.secondaryText}>I completed payment — verify</Text>
          </Pressable>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {message ? <Text style={styles.success}>{message}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.eyebrow}>Payment history</Text>
        {payments.length === 0 ? (
          <Text style={styles.muted}>No payments recorded on this account yet.</Text>
        ) : (
          payments.map((payment) => (
            <View key={payment.id} style={styles.historyRow}>
              <View style={styles.historyCopy}>
                <Text style={styles.historyAmount}>{formatKobo(payment.amountKobo)}</Text>
                <Text style={styles.muted}>
                  {payment.channel.replace(/_/g, " ")} · {new Date(payment.paidAt).toLocaleString("en-GB")}
                </Text>
              </View>
              {payment.externalReference ? (
                <Text numberOfLines={1} style={styles.reference}>
                  {payment.externalReference}
                </Text>
              ) : null}
            </View>
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
    padding: 16
  },
  eyebrow: { color: colors.accent, fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
  amount: { color: colors.text, fontSize: 28, fontWeight: "800" },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  label: { color: colors.text, fontSize: 13, fontWeight: "700", marginTop: 4 },
  input: {
    backgroundColor: "#f8fbf7",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    padding: 13
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: 12,
    minHeight: 48,
    justifyContent: "center",
    padding: 13
  },
  primaryText: { color: "#fff", fontWeight: "800" },
  secondaryButton: {
    alignItems: "center",
    borderColor: colors.accent,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12
  },
  secondaryText: { color: colors.accent, fontWeight: "700" },
  disabled: { opacity: 0.45 },
  error: { color: colors.danger, lineHeight: 19 },
  success: { color: colors.accent, lineHeight: 19 },
  historyRow: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: 4,
    paddingTop: 12
  },
  historyCopy: { gap: 2 },
  historyAmount: { color: colors.text, fontSize: 16, fontWeight: "800" },
  reference: { color: colors.muted, fontSize: 11 }
});
