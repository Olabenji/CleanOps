import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import type {
  ResidentHome,
  ResidentNotification,
  ResidentPayment,
  ServiceComplaint
} from "@cleanops/shared";
import type { FieldSession } from "../data/fieldSessionService";
import {
  formatCollectionFrequency,
  getResidentHome,
  listResidentComplaints,
  listResidentNotifications,
  listResidentPayments,
  markResidentNotificationRead
} from "../data/residentService";
import {
  attachResidentPushResponseHandler,
  clearResidentPushRegistration,
  ensureResidentPushRegistration,
  formatPushError,
  isExpoGoRuntime,
  isResidentPushSupported
} from "../lib/residentPush";
import { colors } from "../theme";
import ProfileSettingsCard from "../components/ProfileSettingsCard";
import ResidentTabBar, { type ResidentTabId } from "../components/ResidentTabBar";
import ResidentComplaintsScreen from "./ResidentComplaintsScreen";
import ResidentPaymentsScreen from "./ResidentPaymentsScreen";

export default function ResidentApp({
  session,
  onSignOut,
  onSessionUpdated
}: {
  session: FieldSession;
  onSignOut: () => void;
  onSessionUpdated: (next: Partial<FieldSession>) => void;
}) {
  const [tab, setTab] = useState<ResidentTabId>("home");
  const [home, setHome] = useState<ResidentHome | null>(null);
  const [notifications, setNotifications] = useState<ResidentNotification[]>([]);
  const [payments, setPayments] = useState<ResidentPayment[]>([]);
  const [complaints, setComplaints] = useState<ServiceComplaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [installationId, setInstallationId] = useState<string | null>(null);
  const [focusNotificationId, setFocusNotificationId] = useState<string | null>(null);

  async function load(isRefresh = false) {
    if (session.mode === "pilot") {
      setHome({
        customerId: "00000000-0000-4000-8000-000000000401",
        displayName: session.fullName,
        address: "12 Admiralty Way, Lekki Phase 1",
        phone: session.phone ?? null,
        email: null,
        customerType: "residential",
        zoneName: "Ward A",
        serviceStatus: "active",
        collectionsPerWeek: 1,
        preferredWeekdays: [1],
        monthlyRateKobo: 1500000,
        paidThisMonthKobo: 0,
        outstandingKobo: 1500000,
        lastPaymentAt: null,
        lastPaymentAmountKobo: null,
        lastPaymentChannel: null,
        psp: {
          operatorName: "CleanOps Pilot PSP",
          brandName: "CleanOps",
          primaryContactPhone: "+2348000000001",
          lawmaReference: null,
          timezone: "Africa/Lagos"
        },
        zoneTrucks: [],
        makeGood: null
      });
      setNotifications([]);
      setPayments([]);
      setComplaints([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const [nextHome, nextNotifications, nextPayments, nextComplaints] = await Promise.all([
        getResidentHome(),
        listResidentNotifications(),
        listResidentPayments(),
        listResidentComplaints()
      ]);
      setHome(nextHome);
      setNotifications(nextNotifications);
      setPayments(nextPayments);
      setComplaints(nextComplaints);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load resident account");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load();
  }, [session.mode]);

  useEffect(() => {
    if (session.mode !== "supabase") {
      return;
    }

    if (isExpoGoRuntime()) {
      setMessage("In-app messages available. Push alerts need a development build (not Expo Go).");
      return;
    }

    void ensureResidentPushRegistration("0.1.0")
      .then((id) => {
        setInstallationId(id);
        if (id) {
          setMessage("Push alerts enabled for collection updates.");
        } else {
          setMessage("In-app messages available. Push permission was not granted.");
        }
      })
      .catch((error) => {
        const detail = formatPushError(error);
        console.warn("[resident-push] registration failed", detail);
        setMessage(`In-app messages available. Push registration failed: ${detail}`);
      });
  }, [session.mode]);

  useEffect(() => {
    if (session.mode !== "supabase" || !isResidentPushSupported()) {
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    void attachResidentPushResponseHandler(({ notificationId }) => {
      if (cancelled) {
        return;
      }

      setTab("messages");
      if (!notificationId) {
        return;
      }

      setFocusNotificationId(notificationId);
      void markResidentNotificationRead(notificationId)
        .then(() => {
          setNotifications((current) =>
            current.map((item) =>
              item.id === notificationId
                ? { ...item, status: "read", readAt: new Date().toISOString() }
                : item
            )
          );
        })
        .catch(() => {
          // Inbox still opens even if mark-read fails.
        });
    })
      .then((cleanup) => {
        if (cancelled) {
          cleanup();
          return;
        }
        unsubscribe = cleanup;
      })
      .catch((error) => {
        console.warn("[resident-push] response handler failed", formatPushError(error));
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [session.mode]);

  const unreadCount = notifications.filter((item) => item.status === "unread").length;

  async function handleMarkRead(notification: ResidentNotification) {
    if (notification.status !== "unread") {
      setFocusNotificationId(notification.id);
      return;
    }

    try {
      await markResidentNotificationRead(notification.id);
      setNotifications((current) =>
        current.map((item) =>
          item.id === notification.id
            ? { ...item, status: "read", readAt: new Date().toISOString() }
            : item
        )
      );
      setFocusNotificationId(notification.id);
    } catch (markError) {
      setError(markError instanceof Error ? markError.message : "Unable to mark notification read");
    }
  }

  async function handleSignOut() {
    await clearResidentPushRegistration(installationId);
    onSignOut();
  }

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.muted}>Loading your account...</Text>
      </View>
    );
  }

  return (
    <View style={styles.shell}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl onRefresh={() => void load(true)} refreshing={refreshing} />}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>Resident</Text>
            <Text style={styles.title}>{session.fullName}</Text>
          </View>
          <Pressable onPress={() => void handleSignOut()}>
            <Text style={styles.signOut}>Sign out</Text>
          </Pressable>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {message ? <Text style={styles.notice}>{message}</Text> : null}

        {tab === "home" && home ? (
          <View style={styles.stack}>
            <View style={styles.quickActions}>
              <Pressable onPress={() => setTab("payments")} style={styles.quickAction}>
                <Text style={styles.quickActionTitle}>Pay bill</Text>
                <Text style={styles.quickActionCopy}>
                  ₦{Math.round(home.outstandingKobo / 100).toLocaleString("en-NG")} due
                </Text>
              </Pressable>
              <Pressable onPress={() => setTab("issues")} style={styles.quickAction}>
                <Text style={styles.quickActionTitle}>Report issue</Text>
                <Text style={styles.quickActionCopy}>24h response SLA</Text>
              </Pressable>
              <Pressable onPress={() => setTab("messages")} style={styles.quickAction}>
                <Text style={styles.quickActionTitle}>Inbox</Text>
                <Text style={styles.quickActionCopy}>{unreadCount} unread</Text>
              </Pressable>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardEyebrow}>Your PSP</Text>
              <Text style={styles.cardTitle}>{home.psp.brandName ?? home.psp.operatorName}</Text>
              <Text style={styles.muted}>{home.psp.operatorName}</Text>
              {home.psp.lawmaReference ? (
                <Text style={styles.muted}>LAWMA: {home.psp.lawmaReference}</Text>
              ) : null}
              {home.psp.primaryContactPhone ? (
                <Text style={styles.body}>Contact: {home.psp.primaryContactPhone}</Text>
              ) : null}
              {home.zoneTrucks.length > 0 ? (
                <View style={styles.truckList}>
                  {home.zoneTrucks.map((truck) => (
                    <Text key={truck.registrationNumber} style={styles.truck}>
                      {truck.registrationNumber} · {truck.status}
                    </Text>
                  ))}
                </View>
              ) : (
                <Text style={styles.muted}>No ward trucks listed.</Text>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardEyebrow}>Collection schedule</Text>
              <Text style={styles.cardTitle}>{home.zoneName}</Text>
              <Text style={styles.body}>
                {formatCollectionFrequency(home.collectionsPerWeek, home.preferredWeekdays)}
              </Text>
              <Text style={styles.muted}>{home.address}</Text>
              <Text style={home.serviceStatus === "suspended" ? styles.warn : styles.serviceActive}>
                Service {home.serviceStatus}
                {home.suspensionReason ? ` · ${home.suspensionReason}` : ""}
              </Text>
              {home.makeGood?.active ? (
                <Text style={styles.warn}>
                  Missed collection on{" "}
                  {new Date(home.makeGood.sourceDate).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short"
                  })}
                  . Subsequent collection planned
                  {home.makeGood.targetDate
                    ? ` for ${new Date(home.makeGood.targetDate).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short"
                      })}`
                    : ""}
                  .
                  This recovery does not change your regular SLA collection day.
                </Text>
              ) : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardEyebrow}>Account</Text>
              <Text style={styles.cardTitle}>
                Outstanding ₦{Math.round(home.outstandingKobo / 100).toLocaleString("en-NG")}
              </Text>
              <Text style={styles.muted}>
                Monthly rate ₦{Math.round(home.monthlyRateKobo / 100).toLocaleString("en-NG")} · Paid this
                month ₦{Math.round(home.paidThisMonthKobo / 100).toLocaleString("en-NG")}
              </Text>
              {home.lastPaymentAt ? (
                <Text style={styles.muted}>
                  Last payment ₦{Math.round((home.lastPaymentAmountKobo ?? 0) / 100).toLocaleString("en-NG")} via{" "}
                  {(home.lastPaymentChannel ?? "unknown").replace(/_/g, " ")} ·{" "}
                  {new Date(home.lastPaymentAt).toLocaleDateString("en-GB")}
                </Text>
              ) : null}
              <Pressable onPress={() => setTab("payments")} style={styles.inlineButton}>
                <Text style={styles.inlineButtonText}>View account and payments</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {tab === "payments" && home ? (
          <ResidentPaymentsScreen
            home={home}
            payments={payments}
            onPaymentConfirmed={() => load(true)}
          />
        ) : null}

        {tab === "issues" ? (
          <ResidentComplaintsScreen complaints={complaints} onSubmitted={() => load(true)} />
        ) : null}

        {tab === "messages" ? (
          <View style={styles.stack}>
            {notifications.length === 0 ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>No messages yet</Text>
                <Text style={styles.muted}>
                  You will see collection recovery notices here when a stop is missed.
                </Text>
              </View>
            ) : (
              notifications.map((notification) => (
                <Pressable
                  key={notification.id}
                  onPress={() => void handleMarkRead(notification)}
                  style={[
                    styles.card,
                    notification.status === "unread" && styles.unreadCard,
                    focusNotificationId === notification.id && styles.focusedCard
                  ]}
                >
                  <Text style={styles.cardEyebrow}>
                    {notification.status.replace("_", " ")} ·{" "}
                    {new Date(notification.createdAt).toLocaleString("en-GB")}
                  </Text>
                  <Text style={styles.cardTitle}>{notification.title}</Text>
                  <Text style={styles.body}>{notification.body}</Text>
                </Pressable>
              ))
            )}
          </View>
        ) : null}

        {tab === "profile" ? (
          <View style={styles.stack}>
            <ProfileSettingsCard
              onProfileUpdated={(next) => onSessionUpdated(next)}
              session={session}
            />
            <Pressable onPress={() => void handleSignOut()} style={styles.card}>
              <Text style={styles.signOut}>Sign out and switch user</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      <ResidentTabBar activeTab={tab} unreadCount={unreadCount} onChange={setTab} />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    minHeight: 0
  },
  content: {
    gap: 14,
    padding: 16,
    paddingBottom: 28
  },
  loading: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    gap: 12
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase"
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.6
  },
  signOut: {
    color: colors.accent,
    fontWeight: "800"
  },
  stack: {
    gap: 14
  },
  quickActions: {
    flexDirection: "row",
    gap: 10
  },
  quickAction: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    elevation: 1,
    flex: 1,
    gap: 4,
    minHeight: 84,
    padding: 12,
    shadowColor: colors.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6
  },
  quickActionTitle: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: "800"
  },
  quickActionCopy: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    elevation: 1,
    gap: 8,
    padding: 16,
    shadowColor: colors.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8
  },
  unreadCard: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft
  },
  focusedCard: {
    borderColor: colors.accent
  },
  cardEyebrow: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  cardTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800"
  },
  body: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 21
  },
  serviceActive: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 4,
    textTransform: "capitalize"
  },
  truckList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4
  },
  truck: {
    backgroundColor: colors.accentSoft,
    borderRadius: 12,
    color: colors.accent,
    fontSize: 11,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 5
  },
  inlineButton: {
    alignItems: "center",
    borderColor: colors.accent,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 5,
    padding: 11
  },
  inlineButtonText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: "800"
  },
  muted: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20
  },
  warn: {
    color: colors.warn,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6
  },
  error: {
    backgroundColor: colors.dangerSoft,
    borderRadius: 12,
    color: colors.danger,
    padding: 12
  },
  notice: {
    backgroundColor: colors.cardSoft,
    borderRadius: 12,
    color: colors.text,
    padding: 12
  }
});
