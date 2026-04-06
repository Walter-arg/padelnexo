import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "../config/theme";

export default function DaySelector({ days, selectedDayKey, onSelect }) {
  return (
    <View style={styles.wrap}>
      {days.map((day) => {
        const isSelected = day.key === selectedDayKey;

        return (
          <Pressable
            key={day.key}
            onPress={() => onSelect(day.key)}
            style={({ pressed }) => [
              styles.dayChip,
              isSelected && styles.dayChipActive,
              pressed && styles.dayChipPressed,
            ]}
          >
            <Text style={[styles.dayText, isSelected && styles.dayTextActive]}>{day.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    justifyContent: "center",
    marginTop: spacing.md,
  },
  dayChip: {
    alignItems: "center",
    backgroundColor: "#EEF5F2",
    borderColor: "#D3E5DD",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 36,
    minWidth: 88,
    paddingHorizontal: spacing.md,
  },
  dayChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  dayChipPressed: {
    opacity: 0.92,
  },
  dayText: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
  dayTextActive: {
    color: colors.surface,
  },
});
