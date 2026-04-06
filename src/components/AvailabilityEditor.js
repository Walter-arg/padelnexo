import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "../config/theme";
import {
  addCustomSlot,
  clearDayAvailability,
  createEmptyAvailability,
  getAvailabilitySummaryItems,
  getDayDefinitions,
  getDayLabel,
  getQuickSlotDefinitions,
  normalizeAvailability,
  removeCustomSlot,
  toggleQuickSlot,
  validateCustomSlot,
} from "../services/availabilityService";
import AvailabilitySummary from "./AvailabilitySummary";
import CustomTimeSheet from "./CustomTimeSheet";
import DaySelector from "./DaySelector";
import FeedbackModal from "./FeedbackModal";
import QuickTimeSlots from "./QuickTimeSlots";

const DEFAULT_FROM = "19:00";
const DEFAULT_TO = "22:00";

function parseMinutes(value = "") {
  const [hour = "0", minute = "0"] = String(value).split(":");
  return Number.parseInt(hour, 10) * 60 + Number.parseInt(minute, 10);
}

function getQuickSlotKeyForCustomSlot(slot) {
  const fromMinutes = parseMinutes(slot?.from);

  if (fromMinutes >= 8 * 60 && fromMinutes < 12 * 60) {
    return "morning";
  }

  if (fromMinutes >= 12 * 60 && fromMinutes < 18 * 60) {
    return "afternoon";
  }

  if (fromMinutes >= 18 * 60 && fromMinutes < 23 * 60) {
    return "night";
  }

  return "late_night";
}

export default function AvailabilityEditor({
  initialAvailability,
  loading,
  onClose,
  onSave,
  visible,
}) {
  const [availability, setAvailability] = useState(createEmptyAvailability());
  const [selectedDayKey, setSelectedDayKey] = useState("monday");
  const [isCustomSheetVisible, setIsCustomSheetVisible] = useState(false);
  const [customFrom, setCustomFrom] = useState(DEFAULT_FROM);
  const [customTo, setCustomTo] = useState(DEFAULT_TO);
  const [preferredSlotKey, setPreferredSlotKey] = useState(null);
  const [feedback, setFeedback] = useState({
    visible: false,
    title: "",
    message: "",
    tone: "default",
  });

  const days = useMemo(() => getDayDefinitions(), []);
  const quickSlots = useMemo(() => getQuickSlotDefinitions(), []);
  const selectedDay = availability[selectedDayKey] || { quickSlots: [], customSlots: [] };
  const summaryItems = getAvailabilitySummaryItems(availability);
  const quickSlotVisualState = useMemo(() => {
    const selectedSlotKeys = new Set(selectedDay.quickSlots || []);
    const customRangesBySlot = {};

    (selectedDay.customSlots || []).forEach((slot) => {
      const slotKey = getQuickSlotKeyForCustomSlot(slot);
      selectedSlotKeys.add(slotKey);
      customRangesBySlot[slotKey] = customRangesBySlot[slotKey] || [];
      customRangesBySlot[slotKey].push(`${slot.from} - ${slot.to}`);
    });

    const displayRanges = quickSlots.reduce((accumulator, slot) => {
      const customRanges = customRangesBySlot[slot.key] || [];

      accumulator[slot.key] =
        customRanges.length === 0
          ? `${slot.from} - ${slot.to}`
          : customRanges.length === 1
            ? customRanges[0]
            : `${customRanges[0]} +${customRanges.length - 1}`;

      return accumulator;
    }, {});

    return {
      displayRanges,
      selectedSlots: [...selectedSlotKeys],
    };
  }, [quickSlots, selectedDay.customSlots, selectedDay.quickSlots]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    setAvailability(normalizeAvailability(initialAvailability));
    setPreferredSlotKey(null);
  }, [initialAvailability, visible]);

  const showFeedback = (title, message, tone = "default") => {
    setFeedback({
      visible: true,
      title,
      message,
      tone,
    });
  };

  const handleToggleQuickSlot = (slotKey) => {
    const slotDefinition = quickSlots.find((slot) => slot.key === slotKey);

    if (slotDefinition) {
      setPreferredSlotKey(slotKey);
      setCustomFrom(slotDefinition.from);
      setCustomTo(slotDefinition.to);
    }

    setAvailability((current) => toggleQuickSlot(current, selectedDayKey, slotKey));
  };

  const handleOpenCustomSheet = () => {
    const selectedQuickSlotKey =
      preferredSlotKey || selectedDay.quickSlots[selectedDay.quickSlots.length - 1] || null;
    const selectedQuickSlot = quickSlots.find((slot) => slot.key === selectedQuickSlotKey);

    if (selectedQuickSlot) {
      setCustomFrom(selectedQuickSlot.from);
      setCustomTo(selectedQuickSlot.to);
    }

    setIsCustomSheetVisible(true);
  };

  const handleAddCustomSlot = () => {
    const validation = validateCustomSlot(customFrom, customTo);

    if (!validation.valid) {
      showFeedback("Horario no valido", validation.message, "danger");
      return;
    }

    setAvailability((current) => addCustomSlot(current, selectedDayKey, validation.slot));
    setIsCustomSheetVisible(false);
  };

  const handleSave = async () => {
    try {
      await onSave(normalizeAvailability(availability));
      showFeedback("Disponibilidad guardada", "Tu disponibilidad semanal ya quedo actualizada.");
    } catch (error) {
      showFeedback(
        "No pudimos guardar la disponibilidad",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    }
  };

  return (
    <>
      <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
        <View style={styles.overlay}>
          <Pressable onPress={onClose} style={styles.backdrop} />
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <Text style={styles.title}>Tu disponibilidad</Text>
            <Text style={styles.subtitle}>
              Indica los dias y horarios en los que soles jugar
            </Text>

            <ScrollView showsVerticalScrollIndicator={false}>
              <DaySelector
                days={days}
                onSelect={setSelectedDayKey}
                selectedDayKey={selectedDayKey}
              />

              <QuickTimeSlots
                displayRanges={quickSlotVisualState.displayRanges}
                onToggle={handleToggleQuickSlot}
                selectedSlots={quickSlotVisualState.selectedSlots}
                slots={quickSlots}
              />

              <View style={styles.dayCard}>
                <View style={styles.dayCardHeader}>
                  <Text style={styles.dayCardTitle}>{getDayLabel(selectedDayKey)}</Text>
                  {(selectedDay.quickSlots.length > 0 || selectedDay.customSlots.length > 0) ? (
                    <Pressable
                      onPress={() =>
                        setAvailability((current) => clearDayAvailability(current, selectedDayKey))
                      }
                      style={styles.clearDayButton}
                    >
                      <Text style={styles.clearDayButtonText}>Limpiar dia</Text>
                    </Pressable>
                  ) : null}
                </View>

                <Pressable
                  onPress={handleOpenCustomSheet}
                  style={({ pressed }) => [
                    styles.customButton,
                    pressed && styles.customButtonPressed,
                  ]}
                >
                  <Text style={styles.customButtonText}>Personalizar horario</Text>
                </Pressable>

                {selectedDay.customSlots.length > 0 ? (
                  <View style={styles.customSlotsWrap}>
                    {selectedDay.customSlots.map((slot, index) => (
                      <View key={`${slot.from}-${slot.to}`} style={styles.customSlotCard}>
                        <Text style={styles.customSlotText}>
                          {slot.from} a {slot.to}
                        </Text>
                        <Pressable
                          onPress={() =>
                            setAvailability((current) =>
                              removeCustomSlot(current, selectedDayKey, index)
                            )
                          }
                        >
                          <Text style={styles.customSlotRemove}>Quitar</Text>
                        </Pressable>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>

              <Text style={styles.summaryTitle}>Resumen semanal</Text>
              <AvailabilitySummary
                items={summaryItems}
                onRemoveDay={(dayKey) =>
                  setAvailability((current) => clearDayAvailability(current, dayKey))
                }
              />

              <View style={styles.actions}>
                <Pressable onPress={onClose} style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>Cancelar</Text>
                </Pressable>
                <Pressable
                  disabled={loading}
                  onPress={handleSave}
                  style={[styles.primaryButton, loading && styles.primaryButtonDisabled]}
                >
                  <Text style={styles.primaryButtonText}>
                    {loading ? "Guardando..." : "Guardar"}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <CustomTimeSheet
        dayLabel={getDayLabel(selectedDayKey)}
        from={customFrom}
        onChangeFrom={setCustomFrom}
        onChangeTo={setCustomTo}
        onClose={() => setIsCustomSheetVisible(false)}
        onConfirm={handleAddCustomSlot}
        to={customTo}
        visible={isCustomSheetVisible}
      />

      <FeedbackModal
        message={feedback.message}
        onClose={() =>
          setFeedback((current) => ({
            ...current,
            visible: false,
          }))
        }
        title={feedback.title}
        tone={feedback.tone}
        visible={feedback.visible}
      />
    </>
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
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    maxHeight: "92%",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  handle: {
    alignSelf: "center",
    backgroundColor: colors.border,
    borderRadius: 999,
    height: 5,
    marginBottom: spacing.md,
    width: 56,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "800",
    textAlign: "center",
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  dayCard: {
    backgroundColor: "#F7FAFB",
    borderColor: "#DCE6EA",
    borderRadius: 22,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  dayCardHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  dayCardTitle: {
    color: colors.primaryDark,
    fontSize: 14,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  clearDayButton: {
    alignItems: "center",
    backgroundColor: "#FFF1F1",
    borderColor: "#E8C8C8",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 28,
    paddingHorizontal: 10,
  },
  clearDayButtonText: {
    color: "#B44B4B",
    fontSize: 12,
    fontWeight: "800",
  },
  customButton: {
    alignItems: "center",
    backgroundColor: "#EEF5F2",
    borderColor: "#D3E5DD",
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: spacing.md,
    minHeight: 44,
  },
  customButtonPressed: {
    opacity: 0.92,
  },
  customButtonText: {
    color: colors.primaryDark,
    fontSize: 14,
    fontWeight: "800",
  },
  customSlotsWrap: {
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  customSlotCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  customSlotText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  customSlotRemove: {
    color: "#B44B4B",
    fontSize: 12,
    fontWeight: "800",
  },
  summaryTitle: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "800",
    marginTop: spacing.lg,
    textTransform: "uppercase",
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
  primaryButtonDisabled: {
    opacity: 0.65,
  },
  primaryButtonText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: "800",
  },
});
