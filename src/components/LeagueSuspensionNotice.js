import { StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "../config/theme";

export default function LeagueSuspensionNotice({ notice = null, compact = false }) {
  if (!notice) {
    return null;
  }

  return (
    <View style={[styles.wrap, compact ? styles.wrapCompact : null]}>
      <Text style={[styles.text, compact ? styles.textCompact : null]} numberOfLines={compact ? 1 : 2}>
        {notice.label || "LIGA SUSPENDIDA"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: "transparent",
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    marginTop: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  wrapCompact: {
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  text: {
    color: "#B51F1F",
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.4,
    textAlign: "center",
  },
  textCompact: {
    fontSize: 10,
  },
});

