import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radii } from "../theme";

export type AgentTabId = "collect" | "history" | "profile";

const tabs: Array<{ id: AgentTabId; label: string }> = [
  { id: "collect", label: "Collect" },
  { id: "history", label: "History" },
  { id: "profile", label: "Profile" }
];

export default function AgentTabBar({
  activeTab,
  onChange
}: {
  activeTab: AgentTabId;
  onChange: (tab: AgentTabId) => void;
}) {
  return (
    <View style={styles.bar}>
      {tabs.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <Pressable
            key={tab.id}
            onPress={() => onChange(tab.id)}
            style={[styles.tab, active && styles.tabActive]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{tab.label}</Text>
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
    gap: 6,
    paddingBottom: 12,
    paddingHorizontal: 10,
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
    fontSize: 13,
    fontWeight: "700"
  },
  labelActive: {
    color: colors.white
  }
});
