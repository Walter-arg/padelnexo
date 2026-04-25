import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "../config/theme";

export default function OptionChips({
  label,
  options,
  selectedValue,
  onSelect,
  compact = false,
}) {
  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        {options.map((option) => {
          const value = typeof option === "string" ? option : option.value;
          const labelText = typeof option === "string" ? option : option.label;
          const isActive = selectedValue === value;

          return (
            <Pressable
              key={value}
              onPress={() => onSelect(value)}
              style={[
                styles.chip,
                compact && styles.chipCompact,
                isActive && styles.chipActive,
              ]}
            >
              <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                {labelText}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: spacing.md,
  },
  label: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "600",
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  chip: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  chipCompact: {
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  chipTextActive: {
    color: colors.surface,
  },
});

