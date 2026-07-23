import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radii } from "../theme";

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
          <Pressable
            key={tab.id}
            onPress={() => onChange(tab.id)}
            style={[styles.tab, active && styles.tabActive]}
          >
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
    gap: 4,
    paddingBottom: 12,
    paddingHorizontal: 8,
    paddingTop: 10
  },
  tab: {
    alignItems: "center",
    borderRadius: radii.md,
    flex: 1,
    paddingVertical: 10
  },
  tabActive: {
    backgroundColor: colors.accent
  },
  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700"
  },
  labelActive: {
    color: colors.white
  }
});
