import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  restoreFieldSession,
  signInFieldUser,
  signOutFieldUser,
  type FieldSession
} from "./src/data/fieldSessionService";
import AgentApp from "./src/screens/AgentApp";
import DriverApp from "./src/screens/DriverApp";
import SignInScreen from "./src/screens/SignInScreen";

export default function App() {
  return (
    <SafeAreaProvider>
      <FieldApp />
    </SafeAreaProvider>
  );
}

function FieldApp() {
  const [session, setSession] = useState<FieldSession | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const restored = await restoreFieldSession();
        setSession(restored);
      } catch (restoreError) {
        setError(restoreError instanceof Error ? restoreError.message : "Unable to restore session");
      } finally {
        setBootstrapping(false);
      }
    })();
  }, []);

  async function handleSignIn(role: FieldSession["role"]) {
    setSigningIn(true);
    setError(null);

    try {
      const nextSession = await signInFieldUser(role);
      setSession(nextSession);
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : "Unable to sign in");
    } finally {
      setSigningIn(false);
    }
  }
  async function handleSignOut() {
    await signOutFieldUser();
    setSession(null);
    setError(null);
  }

  if (bootstrapping) {
    return (
      <SafeAreaView style={styles.loadingShell}>
        <StatusBar style="dark" />
        <ActivityIndicator color="#1a7f45" size="large" />
        <Text style={styles.loadingText}>Loading CleanOps field app...</Text>
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={styles.shell}>
        <StatusBar style="dark" />
        <SignInScreen error={error} loading={signingIn} onSignIn={(role) => void handleSignIn(role)} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.shell} edges={["top", "left", "right"]}>
      <StatusBar style="dark" />
      <View style={styles.topBar}>
        <Text style={styles.topBarLabel}>
          {session.role === "driver" ? "Driver workspace" : "Collection agent workspace"} · {session.mode}
        </Text>
        <Pressable onPress={() => void handleSignOut()}>
          <Text style={styles.signOut}>Switch role</Text>
        </Pressable>
      </View>
      <View style={styles.workspace}>
        {session.connectionNotice ? (
          <View style={styles.connectionNotice}>
            <Text style={styles.connectionNoticeText}>{session.connectionNotice}</Text>
          </View>
        ) : null}
        {session.role === "driver" ? <DriverApp session={session} /> : <AgentApp session={session} />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: "#f3f7f1",
    flex: 1
  },
  workspace: {
    flex: 1,
    minHeight: 0
  },
  connectionNotice: {
    backgroundColor: "#fff1df",
    borderBottomColor: "#f0d2a5",
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10
  },
  connectionNoticeText: {
    color: "#a8550b",
    fontSize: 13,
    lineHeight: 18
  },
  loadingShell: {
    alignItems: "center",
    backgroundColor: "#f3f7f1",
    flex: 1,
    justifyContent: "center"
  },
  loadingText: {
    color: "#637466",
    fontSize: 16,
    marginTop: 16
  },
  topBar: {
    alignItems: "center",
    borderBottomColor: "#dbe7dd",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingVertical: 10
  },
  topBarLabel: {
    color: "#637466",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  signOut: {
    color: "#1a7f45",
    fontSize: 14,
    fontWeight: "700"
  }
});
