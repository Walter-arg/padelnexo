import { useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing } from "../config/theme";

function buildDateFromTime(value = "") {
  const baseDate = new Date();
  const [hours = "19", minutes = "00"] = String(value || "19:00").split(":");
  const nextDate = new Date(baseDate);
  nextDate.setHours(Number.parseInt(hours, 10), Number.parseInt(minutes, 10), 0, 0);
  return nextDate;
}

function formatTimeValue(date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

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
  const [pickerTarget, setPickerTarget] = useState("");

  const closePicker = () => setPickerTarget("");

  const handlePickerChange = (_, selectedDate) => {
    if (!selectedDate) {
      closePicker();
      return;
    }

    const nextValue = formatTimeValue(selectedDate);

    if (pickerTarget === "from") {
      onChangeFrom(nextValue);
    }

    if (pickerTarget === "to") {
      onChangeTo(nextValue);
    }

    if (Platform.OS !== "ios") {
      closePicker();
    }
  };

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
              <Pressable
                onPress={() => setPickerTarget("from")}
                style={({ pressed }) => [
                  styles.timeButton,
                  pressed ? styles.optionChipPressed : null,
                ]}
              >
                <Text style={styles.timeButtonText}>{from}</Text>
                <Ionicons color={colors.primaryDark} name="time-outline" size={18} />
              </Pressable>
            </View>

            <View style={styles.column}>
              <Text style={styles.columnLabel}>Hasta</Text>
              <Pressable
                onPress={() => setPickerTarget("to")}
                style={({ pressed }) => [
                  styles.timeButton,
                  pressed ? styles.optionChipPressed : null,
                ]}
              >
                <Text style={styles.timeButtonText}>{to}</Text>
                <Ionicons color={colors.primaryDark} name="time-outline" size={18} />
              </Pressable>
            </View>
          </View>

          {pickerTarget ? (
            <DateTimePicker
              display={Platform.OS === "ios" ? "spinner" : "clock"}
              is24Hour
              mode="time"
              onChange={handlePickerChange}
              value={buildDateFromTime(pickerTarget === "from" ? from : to)}
            />
          ) : null}

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
    paddingBottom: spacing.xl + 28,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
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
  columnLabel: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
    marginBottom: spacing.sm,
    textAlign: "center",
    textTransform: "uppercase",
  },
  timeButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  optionChipPressed: {
    opacity: 0.92,
  },
  timeButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
    left: 9,
    position: "absolute",
    right: 9,
    textAlign: "center",
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
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

