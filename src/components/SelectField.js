import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "../config/theme";

export default function SelectField({
  label,
  value,
  placeholder,
  options,
  visible,
  onOpen,
  onClose,
  onSelect,
  containerStyle,
  fieldStyle,
  labelStyle,
}) {
  const selectedOption = options.find((option) => option.value === value);
  const displayValue = selectedOption?.label || value || placeholder;

  return (
    <>
      <View style={[styles.wrapper, containerStyle]}>
        <Text style={[styles.label, labelStyle]}>{label}</Text>
        <Pressable onPress={onOpen} style={[styles.field, fieldStyle]}>
          <Text style={[styles.value, !selectedOption && styles.placeholder]}>
            {displayValue}
          </Text>
          <Text style={styles.chevron}>+</Text>
        </Pressable>
      </View>

      <Modal animationType="fade" transparent visible={visible}>
        <View style={styles.modalOverlay}>
          <Pressable onPress={onClose} style={styles.modalBackdrop} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{label}</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {options.map((option) => {
                const isSelected = option.value === value;

                return (
                  <Pressable
                    key={option.value}
                    onPress={() => {
                      onSelect(option.value);
                      onClose();
                    }}
                    style={[styles.optionRow, isSelected && styles.optionRowSelected]}
                  >
                    <Text
                      style={[styles.optionText, isSelected && styles.optionTextSelected]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: 6,
  },
  label: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 2,
  },
  field: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 42,
    paddingHorizontal: spacing.md,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  value: {
    color: colors.text,
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
  },
  placeholder: {
    color: colors.muted,
    fontWeight: "500",
  },
  chevron: {
    color: colors.primary,
    fontSize: 22,
    fontWeight: "700",
    marginLeft: spacing.sm,
    transform: [{ rotate: "45deg" }],
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: "65%",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    marginBottom: spacing.md,
    textAlign: "center",
  },
  optionRow: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 16,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  optionRowSelected: {
    backgroundColor: colors.secondary,
    borderColor: colors.primary,
    borderWidth: 1,
  },
  optionText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
  },
  optionTextSelected: {
    color: colors.primaryDark,
  },
});
