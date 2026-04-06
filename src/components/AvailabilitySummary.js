import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "../config/theme";

export default function AvailabilitySummary({ items, onRemoveDay }) {
  if (!items.length) {
    return (
      <View style={styles.emptyCard}>
        <Text style={styles.emptyText}>Todavia no configuraste disponibilidad semanal.</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {items.map((item) => (
        <View key={item.key} style={styles.itemCard}>
          <View style={styles.itemCopy}>
            <Text numberOfLines={2} style={styles.itemText}>
              {item.dayShortLabel} - {item.text}
            </Text>
          </View>
          {onRemoveDay ? (
            <Pressable onPress={() => onRemoveDay(item.key)} style={styles.removeButton}>
              <Text style={styles.removeButtonText}>Quitar</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  emptyCard: {
    backgroundColor: "#F7FAFB",
    borderColor: "#DCE6EA",
    borderRadius: 18,
    borderWidth: 1,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
  itemCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 46,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  itemCopy: {
    flex: 1,
    paddingRight: spacing.xs,
  },
  itemText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  removeButton: {
    alignItems: "center",
    backgroundColor: "#FFF1F1",
    borderColor: "#E8C8C8",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 26,
    paddingHorizontal: 10,
  },
  removeButtonText: {
    color: "#B44B4B",
    fontSize: 11,
    fontWeight: "800",
  },
});
