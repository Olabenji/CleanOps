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
import { requestPasswordReset } from "../data/passwordResetService";
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
  const [mode, setMode] = useState<"signIn" | "forgot">("signIn");
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotMessage, setForgotMessage] = useState<string | null>(null);
  const [forgotError, setForgotError] = useState<string | null>(null);

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

  async function handleForgotSubmit() {
    Keyboard.dismiss();
    setForgotBusy(true);
    setForgotError(null);
    setForgotMessage(null);

    try {
      const result = await requestPasswordReset(email);
      setForgotMessage(result.message);
    } catch (resetError) {
      setForgotError(resetError instanceof Error ? resetError.message : "Unable to send reset email.");
    } finally {
      setForgotBusy(false);
    }
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
        <Text style={styles.eyebrow}>CleanOps</Text>
        <Text style={styles.heading}>{mode === "forgot" ? "Forgot password" : "Sign in"}</Text>
        <Text style={styles.copy}>
          {mode === "forgot"
            ? "Enter your account email. We will send a reset link that opens in the browser. After you set a new password, return here to sign in."
            : "Staff and residents can sign in with the email and password provided for their CleanOps account."}
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
          <Text style={styles.formTitle}>{mode === "forgot" ? "Reset by email" : "Account login"}</Text>
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            editable={!loading && !forgotBusy}
            keyboardType="email-address"
            onChangeText={setEmail}
            onFocus={() => scrollToInput(180)}
            placeholder="Email"
            returnKeyType={mode === "forgot" ? "done" : "next"}
            style={styles.input}
            textContentType="username"
            value={email}
          />
          {mode === "signIn" ? (
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
          ) : null}
          {mode === "signIn" && error ? <Text style={styles.error}>{error}</Text> : null}
          {mode === "forgot" && forgotError ? <Text style={styles.error}>{forgotError}</Text> : null}
          {mode === "forgot" && forgotMessage ? <Text style={styles.success}>{forgotMessage}</Text> : null}
          {mode === "signIn" ? (
            <Pressable
              disabled={loading || !email.trim() || !password}
              onPress={handleSubmit}
              style={[styles.primaryButton, (loading || !email.trim() || !password) && styles.disabled]}
            >
              <Text style={styles.primaryButtonText}>{loading ? "Signing in..." : "Sign in"}</Text>
            </Pressable>
          ) : (
            <Pressable
              disabled={forgotBusy || !email.trim()}
              onPress={() => void handleForgotSubmit()}
              style={[styles.primaryButton, (forgotBusy || !email.trim()) && styles.disabled]}
            >
              <Text style={styles.primaryButtonText}>{forgotBusy ? "Sending..." : "Send reset link"}</Text>
            </Pressable>
          )}
          <Pressable
            disabled={loading || forgotBusy}
            onPress={() => {
              setMode((current) => (current === "signIn" ? "forgot" : "signIn"));
              setForgotError(null);
              setForgotMessage(null);
            }}
            style={styles.forgotLink}
          >
            <Text style={styles.forgotLinkText}>
              {mode === "signIn" ? "Forgot password?" : "Back to sign in"}
            </Text>
          </Pressable>
        </View>

        {mode === "signIn" ? (
          <>
            <Pressable onPress={() => setShowDemoAccounts((current) => !current)} style={styles.demoToggle}>
              <Text style={styles.demoToggleText}>
                {showDemoAccounts ? "Hide demo accounts" : "Use demo accounts"}
              </Text>
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

                <Pressable
                  disabled={loading}
                  onPress={() => onDemoSignIn("resident")}
                  style={[styles.card, loading && styles.disabled]}
                >
                  <Text style={styles.cardTitle}>Demo resident (offline)</Text>
                  <Text style={styles.cardCopy}>Pilot inbox / schedule preview</Text>
                </Pressable>
              </View>
            ) : null}
          </>
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
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase"
  },
  heading: {
    color: "#102017",
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: -1,
    marginTop: 8
  },
  copy: {
    color: "#637466",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10
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
  success: {
    backgroundColor: "#e8f7ee",
    borderRadius: 12,
    color: "#14532d",
    marginBottom: 12,
    padding: 12
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
  forgotLink: {
    alignSelf: "center",
    marginTop: 14,
    paddingVertical: 6
  },
  forgotLinkText: {
    color: "#1a7f45",
    fontSize: 14,
    fontWeight: "700"
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
