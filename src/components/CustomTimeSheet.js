import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "../config/theme";
import { TIME_OPTIONS } from "../services/availabilityService";

export default function CustomTimeSheet({
  dayLabel,
  from,
  onChangeFrom,
  onChangeTo,
  onClose,
  onConfirm,
  to,
  visible,
}) {
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.overlay}>
        <Pressable onPress={onClose} style={styles.backdrop} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Personalizar horario</Text>
          <Text style={styles.subtitle}>{dayLabel}</Text>

          <View style={styles.columns}>
            <View style={styles.column}>
              <Text style={styles.columnLabel}>Desde</Text>
              <ScrollView
                style={styles.optionsList}
                contentContainerStyle={styles.optionsWrap}
                showsVerticalScrollIndicator={false}
              >
                {TIME_OPTIONS.map((value) => (
                  <Pressable
                    key={`from-${value}`}
                    onPress={() => onChangeFrom(value)}
                    style={({ pressed }) => [
                      styles.optionChip,
                      from === value && styles.optionChipActive,
                      pressed && styles.optionChipPressed,
                    ]}
                  >
                    <Text style={[styles.optionText, from === value && styles.optionTextActive]}>
                      {value}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>

            <View style={styles.column}>
              <Text style={styles.columnLabel}>Hasta</Text>
              <ScrollView
                style={styles.optionsList}
                contentContainerStyle={styles.optionsWrap}
                showsVerticalScrollIndicator={false}
              >
                {TIME_OPTIONS.map((value) => (
                  <Pressable
                    key={`to-${value}`}
                    onPress={() => onChangeTo(value)}
                    style={({ pressed }) => [
                      styles.optionChip,
                      to === value && styles.optionChipActive,
                      pressed && styles.optionChipPressed,
                    ]}
                  >
                    <Text style={[styles.optionText, to === value && styles.optionTextActive]}>
                      {value}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </View>

          <View style={styles.actions}>
            <Pressable onPress={onClose} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>Cancelar</Text>
            </Pressable>
            <Pressable onPress={onConfirm} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Agregar</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: "82%",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  handle: {
    alignSelf: "center",
    backgroundColor: colors.border,
    borderRadius: 999,
    height: 5,
    marginBottom: spacing.md,
    width: 54,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    marginTop: 4,
    textAlign: "center",
  },
  columns: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  column: {
    flex: 1,
  },
  optionsList: {
    maxHeight: 320,
  },
  columnLabel: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
    marginBottom: spacing.sm,
    textAlign: "center",
    textTransform: "uppercase",
  },
  optionsWrap: {
    gap: spacing.xs,
    paddingBottom: spacing.sm,
  },
  optionChip: {
    alignItems: "center",
    backgroundColor: "#F4F7F8",
    borderColor: "#D8E1E5",
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 38,
  },
  optionChipActive: {
    backgroundColor: "#2F7F96",
    borderColor: "#2F7F96",
  },
  optionChipPressed: {
    opacity: 0.92,
  },
  optionText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  optionTextActive: {
    color: colors.surface,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 16,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
  },
  primaryButtonText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: "800",
  },
});
