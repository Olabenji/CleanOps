import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { FieldRole } from "../data/fieldSessionService";
import { formatConnectionProbe, probeSupabaseConnection } from "../lib/supabaseDiagnostics";

export default function SignInScreen({
  loading,
  error,
  onSignIn,
  onDemoSignIn
}: {
  loading: boolean;
  error: string | null;
  onSignIn: (credentials: { email: string; password: string }) => void;
  onDemoSignIn: (role: FieldRole) => void;
}) {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [connectionStatus, setConnectionStatus] = useState("Checking backend connection...");
  const [checkingConnection, setCheckingConnection] = useState(true);
  const [showDemoAccounts, setShowDemoAccounts] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);

  useEffect(() => {
    void (async () => {
      setCheckingConnection(true);
      const probe = await probeSupabaseConnection();
      setConnectionStatus(formatConnectionProbe(probe));
      setCheckingConnection(false);
    })();
  }, []);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const showSubscription = Keyboard.addListener(showEvent, (event) => {
      setKeyboardInset(event.endCoordinates.height);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      setKeyboardInset(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  async function handleRetryConnection() {
    setCheckingConnection(true);
    const probe = await probeSupabaseConnection();
    setConnectionStatus(formatConnectionProbe(probe));
    setCheckingConnection(false);
  }

  function handleSubmit() {
    Keyboard.dismiss();
    onSignIn({ email, password });
  }

  function scrollToInput(offsetY: number) {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ animated: true, y: offsetY });
    });
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}
      style={styles.flex}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.container,
          {
            paddingBottom: Math.max(insets.bottom + 32, keyboardInset + 24),
            paddingTop: insets.top + 16
          }
        ]}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        showsVerticalScrollIndicator
        style={styles.scroll}
      >
        <Text style={styles.eyebrow}>CleanOps Field</Text>
        <Text style={styles.heading}>Sign in</Text>
        <Text style={styles.copy}>
          Use the login email and password from Admin onboarding, or the demo accounts below.
        </Text>
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

        <View style={styles.formCard}>
          <Text style={styles.formTitle}>Staff login</Text>
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            editable={!loading}
            keyboardType="email-address"
            onChangeText={setEmail}
            onFocus={() => scrollToInput(180)}
            placeholder="Email"
            returnKeyType="next"
            style={styles.input}
            textContentType="username"
            value={email}
          />
          <View style={styles.passwordField}>
            <TextInput
              editable={!loading}
              onChangeText={setPassword}
              onFocus={() => scrollToInput(260)}
              onSubmitEditing={handleSubmit}
              placeholder="Password"
              returnKeyType="done"
              secureTextEntry={!showPassword}
              style={styles.passwordInput}
              textContentType="password"
              value={password}
            />
            <Pressable
              accessibilityLabel={showPassword ? "Hide password" : "Show password"}
              accessibilityRole="button"
              disabled={loading}
              hitSlop={8}
              onPress={() => setShowPassword((current) => !current)}
              style={styles.passwordToggle}
            >
              <Text style={styles.passwordToggleText}>{showPassword ? "Hide" : "Show"}</Text>
            </Pressable>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable
            disabled={loading || !email.trim() || !password}
            onPress={handleSubmit}
            style={[styles.primaryButton, (loading || !email.trim() || !password) && styles.disabled]}
          >
            <Text style={styles.primaryButtonText}>{loading ? "Signing in..." : "Sign in"}</Text>
          </Pressable>
        </View>

        <Pressable onPress={() => setShowDemoAccounts((current) => !current)} style={styles.demoToggle}>
          <Text style={styles.demoToggleText}>{showDemoAccounts ? "Hide demo accounts" : "Use demo accounts"}</Text>
        </Pressable>

        {showDemoAccounts ? (
          <View style={styles.demoSection}>
            <Pressable
              disabled={loading}
              onPress={() => onDemoSignIn("driver")}
              style={[styles.card, styles.driverCard, loading && styles.disabled]}
            >
              <Text style={styles.cardTitle}>Demo driver</Text>
              <Text style={styles.cardCopy}>driver@cleanops.local</Text>
            </Pressable>

            <Pressable
              disabled={loading}
              onPress={() => onDemoSignIn("collection_agent")}
              style={[styles.card, styles.agentCard, loading && styles.disabled]}
            >
              <Text style={styles.cardTitle}>Demo collection agent</Text>
              <Text style={styles.cardCopy}>agent@cleanops.local</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1
  },
  scroll: {
    backgroundColor: "#f3f7f1",
    flex: 1
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 24
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
  formCard: {
    backgroundColor: "#ffffff",
    borderColor: "#dbe7dd",
    borderRadius: 18,
    borderWidth: 1,
    padding: 18
  },
  formTitle: {
    color: "#102017",
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 12
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
  passwordField: {
    alignItems: "center",
    backgroundColor: "#f8fbf7",
    borderColor: "#dbe7dd",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    marginBottom: 12
  },
  passwordInput: {
    color: "#102017",
    flex: 1,
    padding: 12
  },
  passwordToggle: {
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  passwordToggleText: {
    color: "#1a7f45",
    fontSize: 14,
    fontWeight: "700"
  },
  error: {
    backgroundColor: "#fff1df",
    borderRadius: 12,
    color: "#a8550b",
    marginBottom: 12,
    padding: 12
  },
  primaryButton: {
    backgroundColor: "#1a7f45",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center"
  },
  demoToggle: {
    alignSelf: "center",
    marginTop: 18,
    paddingVertical: 8
  },
  demoToggleText: {
    color: "#1a7f45",
    fontSize: 14,
    fontWeight: "700"
  },
  demoSection: {
    marginTop: 8
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
    fontSize: 18,
    fontWeight: "800"
  },
  cardCopy: {
    color: "#637466",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6
  },
  disabled: {
    opacity: 0.6
  }
});
