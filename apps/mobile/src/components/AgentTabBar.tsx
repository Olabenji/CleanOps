import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";

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
          <Pressable key={tab.id} onPress={() => onChange(tab.id)} style={styles.tab}>
            <View style={[styles.iconDot, active && styles.iconDotActive]} />
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
    paddingBottom: 10,
    paddingTop: 10
  },
  tab: {
    alignItems: "center",
    flex: 1,
    gap: 6
  },
  iconDot: {
    borderColor: colors.muted,
    borderRadius: 999,
    borderWidth: 2,
    height: 18,
    width: 18
  },
  iconDotActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent
  },
  label: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700"
  },
  labelActive: {
    color: colors.accent
  }
});
