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
    gap: spacing.xs,
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  slotCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 48,
    paddingHorizontal: 10,
    paddingVertical: 6,
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
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },
  slotTitleActive: {
    color: colors.primaryDark,
  },
  slotRange: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "600",
    marginTop: 1,
    textAlign: "center",
  },
  slotRangeActive: {
    color: colors.primaryDark,
  },
});

