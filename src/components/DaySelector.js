import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "../config/theme";

export default function DaySelector({ activeDayKeys = [], days, selectedDayKey, onSelect }) {
  const activeDays = new Set(activeDayKeys);

  return (
    <View style={styles.wrap}>
      {days.map((day) => {
        const isSelected = day.key === selectedDayKey;
        const hasAvailability = activeDays.has(day.key);

        return (
          <Pressable
            key={day.key}
            onPress={() => onSelect(day.key)}
            style={({ pressed }) => [
              styles.dayChip,
              hasAvailability && styles.dayChipMarked,
              isSelected && styles.dayChipActive,
              pressed && styles.dayChipPressed,
            ]}
          >
            <Text
              style={[
                styles.dayText,
                hasAvailability && styles.dayTextMarked,
                isSelected && styles.dayTextActive,
              ]}
            >
              {day.label}
            </Text>
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
  dayChipMarked: {
    backgroundColor: "#E6F3F7",
    borderColor: "#7EB7C9",
    shadowColor: "rgba(63, 127, 152, 0.18)",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 1,
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
  dayTextMarked: {
    color: "#245B6A",
  },
});

