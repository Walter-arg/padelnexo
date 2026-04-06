import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "../config/theme";

export default function QuickTimeSlots({ displayRanges = {}, selectedSlots, slots, onToggle }) {
  return (
    <View style={styles.grid}>
      {slots.map((slot) => {
        const isSelected = selectedSlots.includes(slot.key);
        const rangeLabel = displayRanges[slot.key] || `${slot.from} - ${slot.to}`;

        return (
          <Pressable
            key={slot.key}
            onPress={() => onToggle(slot.key)}
            style={({ pressed }) => [
              styles.slotCard,
              isSelected && styles.slotCardActive,
              pressed && styles.slotCardPressed,
            ]}
          >
            <Text style={[styles.slotTitle, isSelected && styles.slotTitleActive]}>
              {slot.label}
            </Text>
            <Text style={[styles.slotRange, isSelected && styles.slotRangeActive]}>
              {rangeLabel}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "center",
    marginTop: spacing.md,
  },
  slotCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    minHeight: 78,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    width: "47%",
  },
  slotCardActive: {
    backgroundColor: "#EAF6F1",
    borderColor: "#8CC7AE",
  },
  slotCardPressed: {
    opacity: 0.92,
  },
  slotTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
    textAlign: "center",
  },
  slotTitleActive: {
    color: colors.primaryDark,
  },
  slotRange: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4,
    textAlign: "center",
  },
  slotRangeActive: {
    color: colors.primaryDark,
  },
});
