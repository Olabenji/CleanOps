import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { FieldRole } from "../data/fieldSessionService";
import { formatConnectionProbe, probeSupabaseConnection } from "../lib/supabaseDiagnostics";

export default function SignInScreen({
  loading,
  error,
  onSignIn
}: {
  loading: boolean;
  error: string | null;
  onSignIn: (role: FieldRole) => void;
}) {
  const [connectionStatus, setConnectionStatus] = useState("Checking backend connection...");
  const [checkingConnection, setCheckingConnection] = useState(true);

  useEffect(() => {
    void (async () => {
      setCheckingConnection(true);
      const probe = await probeSupabaseConnection();
      setConnectionStatus(formatConnectionProbe(probe));
      setCheckingConnection(false);
    })();
  }, []);

  async function handleRetryConnection() {
    setCheckingConnection(true);
    const probe = await probeSupabaseConnection();
    setConnectionStatus(formatConnectionProbe(probe));
    setCheckingConnection(false);
  }

  return (
    <ScrollView contentContainerStyle={styles.container} style={styles.scroll}>
      <Text style={styles.eyebrow}>CleanOps Field</Text>
      <Text style={styles.heading}>Choose your workflow</Text>
      <Text style={styles.copy}>Sign in as a driver or collection agent to open the right mobile workspace.</Text>
      <Text style={styles.hint}>
        Live sync needs your phone on the same Wi‑Fi as the dev machine, with Supabase running on port 54321.
      </Text>

      <View style={styles.connectionCard}>
        <Text style={styles.connectionTitle}>Backend check</Text>
        {checkingConnection ? <ActivityIndicator color="#1a7f45" size="small" /> : null}
        <Text style={styles.connectionCopy}>{connectionStatus}</Text>
        <Pressable disabled={checkingConnection} onPress={() => void handleRetryConnection()} style={styles.retryButton}>
          <Text style={styles.retryButtonText}>Retry connection</Text>
        </Pressable>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        disabled={loading}
        onPress={() => onSignIn("driver")}
        style={[styles.card, styles.driverCard, loading && styles.disabled]}
      >
        <Text style={styles.cardTitle}>Driver</Text>
        <Text style={styles.cardCopy}>Assigned routes, stop updates, incidents, and offline sync.</Text>
      </Pressable>

      <Pressable
        disabled={loading}
        onPress={() => onSignIn("collection_agent")}
        style={[styles.card, styles.agentCard, loading && styles.disabled]}
      >
        <Text style={styles.cardTitle}>Collection Agent</Text>
        <Text style={styles.cardCopy}>Customer lookup, cash collection, receipts, and daily reconciliation.</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    backgroundColor: "#f3f7f1",
    flex: 1
  },
  container: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 24
  },
  eyebrow: {
    color: "#1a7f45",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase"
  },
  heading: {
    color: "#102017",
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -1.2,
    marginTop: 8
  },
  copy: {
    color: "#4b5f52",
    fontSize: 16,
    lineHeight: 24,
    marginTop: 12
  },
  hint: {
    color: "#637466",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8
  },
  connectionCard: {
    backgroundColor: "#ffffff",
    borderColor: "#dbe7dd",
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
    marginBottom: 16,
    marginTop: 16,
    padding: 14
  },
  connectionTitle: {
    color: "#102017",
    fontSize: 14,
    fontWeight: "800"
  },
  connectionCopy: {
    color: "#4b5f52",
    fontSize: 13,
    lineHeight: 18
  },
  retryButton: {
    alignSelf: "flex-start"
  },
  retryButtonText: {
    color: "#1a7f45",
    fontSize: 13,
    fontWeight: "700"
  },
  error: {
    backgroundColor: "#fff1df",
    borderRadius: 12,
    color: "#a8550b",
    marginBottom: 16,
    padding: 12
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 14,
    padding: 18
  },
  driverCard: {
    backgroundColor: "#ffffff",
    borderColor: "#dbe7dd"
  },
  agentCard: {
    backgroundColor: "#eef4fb",
    borderColor: "#b8cce6"
  },
  cardTitle: {
    color: "#102017",
    fontSize: 20,
    fontWeight: "800"
  },
  cardCopy: {
    color: "#637466",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8
  },
  disabled: {
    opacity: 0.6
  }
});
