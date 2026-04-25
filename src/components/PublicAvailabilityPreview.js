import { StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "../config/theme";
import {
  getDayDefinitions,
  getQuickSlotDefinitions,
  normalizeAvailability,
} from "../services/availabilityService";

export default function PublicAvailabilityPreview({ availability }) {
  const days = getDayDefinitions();
  const slotMap = getQuickSlotDefinitions().reduce((accumulator, slot) => {
    accumulator[slot.key] = `${slot.from} a ${slot.to}`;
    return accumulator;
  }, {});
  const normalizedAvailability = normalizeAvailability(availability);
  const summaryItems = days
    .map((day) => {
      const dayAvailability = normalizedAvailability[day.key] || {};
      const quickRanges = (dayAvailability.quickSlots || [])
        .map((slotKey) => slotMap[slotKey])
        .filter(Boolean);
      const customRanges = (dayAvailability.customSlots || []).map(
        (slot) => `${slot.from} a ${slot.to}`
      );
      const ranges = [...quickRanges, ...customRanges];

      if (ranges.length === 0) {
        return null;
      }

      return {
        key: day.key,
        label: `${day.shortLabel} - ${ranges.join(" y ")}`,
      };
    })
    .filter(Boolean);

  if (summaryItems.length === 0) {
    return <Text style={styles.emptyText}>Coordinar por chat</Text>;
  }

  return (
    <View style={styles.wrap}>
      {summaryItems.map((item) => (
        <View key={item.key} style={styles.chip}>
          <Text style={styles.chipText}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  chip: {
    backgroundColor: "#EEF5F2",
    borderColor: "#D3E5DD",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "700",
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
  },
});

