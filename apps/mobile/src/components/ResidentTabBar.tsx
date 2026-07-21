import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";

export type ResidentTabId = "home" | "payments" | "issues" | "messages" | "profile";

const tabs: Array<{ id: ResidentTabId; label: string }> = [
  { id: "home", label: "Home" },
  { id: "payments", label: "Pay" },
  { id: "issues", label: "Issues" },
  { id: "messages", label: "Inbox" },
  { id: "profile", label: "Profile" }
];

export default function ResidentTabBar({
  activeTab,
  unreadCount,
  onChange
}: {
  activeTab: ResidentTabId;
  unreadCount?: number;
  onChange: (tab: ResidentTabId) => void;
}) {
  return (
    <View style={styles.bar}>
      {tabs.map((tab) => {
        const active = tab.id === activeTab;
        const badge = tab.id === "messages" && (unreadCount ?? 0) > 0 ? unreadCount : 0;
        return (
          <Pressable key={tab.id} onPress={() => onChange(tab.id)} style={styles.tab}>
            <View style={[styles.iconDot, active && styles.iconDotActive]} />
            <Text style={[styles.label, active && styles.labelActive]}>
              {tab.label}
              {badge ? ` (${badge})` : ""}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.card,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    paddingBottom: 10,
    paddingTop: 8
  },
  tab: {
    alignItems: "center",
    flex: 1,
    gap: 4
  },
  iconDot: {
    backgroundColor: colors.border,
    borderRadius: 4,
    height: 8,
    width: 8
  },
  iconDotActive: {
    backgroundColor: colors.accent
  },
  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "600"
  },
  labelActive: {
    color: colors.accent
  }
});
