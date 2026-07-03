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
import {
  addTournamentCustomSlot,
  clearTournamentDayAvailability,
  createEmptyTournamentAvailability,
  getTournamentAvailabilitySummaryItems,
  getTournamentDayLabel,
  normalizeTournamentAvailability,
  removeTournamentCustomSlot,
  toggleTournamentQuickSlot,
} from "../services/tournamentAvailabilityService";
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
  dayOptions = null,
  initialAvailability,
  loading,
  onClose,
  onSave,
  saveSuccessMessage,
  subtitle,
  summaryEmptyText,
  title,
  visible,
}) {
  const customDayOptions = Array.isArray(dayOptions) && dayOptions.length > 0 ? dayOptions : null;
  const days = useMemo(() => customDayOptions || getDayDefinitions(), [customDayOptions]);
  const normalizeCurrentAvailability = (value) =>
    customDayOptions
      ? normalizeTournamentAvailability(value, customDayOptions)
      : normalizeAvailability(value);
  const toggleCurrentQuickSlot = (value, dayKey, slotKey) =>
    customDayOptions
      ? toggleTournamentQuickSlot(value, dayKey, slotKey, customDayOptions)
      : toggleQuickSlot(value, dayKey, slotKey);
  const addCurrentCustomSlot = (value, dayKey, slot) =>
    customDayOptions
      ? addTournamentCustomSlot(value, dayKey, slot, customDayOptions)
      : addCustomSlot(value, dayKey, slot);
  const removeCurrentCustomSlot = (value, dayKey, targetIndex) =>
    customDayOptions
      ? removeTournamentCustomSlot(value, dayKey, targetIndex, customDayOptions)
      : removeCustomSlot(value, dayKey, targetIndex);
  const clearCurrentDayAvailability = (value, dayKey) =>
    customDayOptions
      ? clearTournamentDayAvailability(value, dayKey, customDayOptions)
      : clearDayAvailability(value, dayKey);
  const createEmptyCurrentAvailability = () =>
    customDayOptions
      ? createEmptyTournamentAvailability(customDayOptions)
      : createEmptyAvailability();
  const getSummaryItems = (value) =>
    customDayOptions
      ? getTournamentAvailabilitySummaryItems(value, customDayOptions)
      : getAvailabilitySummaryItems(value);
  const resolveDayLabel = (dayKey) =>
    customDayOptions
      ? getTournamentDayLabel(dayKey, customDayOptions, "full")
      : getDayLabel(dayKey);
  const resolvedTitle = title || "Tu disponibilidad";
  const resolvedSubtitle =
    subtitle ||
    (customDayOptions
      ? "Selecciona fechas reales del torneo y agrega uno o mas horarios posibles."
      : "Indica los dias y horarios en los que soles jugar");
  const resolvedSaveMessage =
    saveSuccessMessage ||
    (customDayOptions
      ? "Tu disponibilidad para el torneo ya quedo actualizada."
      : "Tu disponibilidad semanal ya quedo actualizada.");
  const resolvedCustomButtonLabel = customDayOptions ? "Agregar horario" : "Personalizar";
  const defaultDayKey = days[0]?.key || "monday";
  const [availability, setAvailability] = useState(() => createEmptyCurrentAvailability());
  const [selectedDayKey, setSelectedDayKey] = useState(defaultDayKey);
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
  const quickSlots = useMemo(() => getQuickSlotDefinitions(), []);
  const selectedDay = availability[selectedDayKey] || { quickSlots: [], customSlots: [] };
  const summaryItems = getSummaryItems(availability);
  const activeDayKeys = useMemo(() => summaryItems.map((item) => item.key), [summaryItems]);
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

    const nextAvailability = normalizeCurrentAvailability(initialAvailability);
    setAvailability(nextAvailability);
    setSelectedDayKey(Object.keys(nextAvailability)[0] || defaultDayKey);
    setPreferredSlotKey(null);
  }, [defaultDayKey, initialAvailability, visible]);

  useEffect(() => {
    if (!days.some((day) => day.key === selectedDayKey)) {
      setSelectedDayKey(defaultDayKey);
    }
  }, [days, defaultDayKey, selectedDayKey]);

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

    setAvailability((current) => toggleCurrentQuickSlot(current, selectedDayKey, slotKey));
  };

  const handleOpenCustomSheet = () => {
    if (customDayOptions) {
      setCustomFrom(DEFAULT_FROM);
      setCustomTo(DEFAULT_TO);
    } else {
      const selectedQuickSlotKey =
        preferredSlotKey || selectedDay.quickSlots[selectedDay.quickSlots.length - 1] || null;
      const quickSlots = [
        { key: "morning", from: "08:00", to: "12:00" },
        { key: "afternoon", from: "12:00", to: "18:00" },
        { key: "night", from: "18:00", to: "23:00" },
        { key: "late_night", from: "23:00", to: "02:00" },
      ];
      const selectedQuickSlot = quickSlots.find((slot) => slot.key === selectedQuickSlotKey);

      if (selectedQuickSlot) {
        setCustomFrom(selectedQuickSlot.from);
        setCustomTo(selectedQuickSlot.to);
      }
    }

    setIsCustomSheetVisible(true);
  };

  const handleAddCustomSlot = () => {
    const validation = validateCustomSlot(customFrom, customTo);

    if (!validation.valid) {
      showFeedback("Horario no valido", validation.message, "danger");
      return;
    }

    setAvailability((current) => addCurrentCustomSlot(current, selectedDayKey, validation.slot));
    setIsCustomSheetVisible(false);
  };

  const handleSave = async () => {
    try {
      await onSave(normalizeCurrentAvailability(availability));
      showFeedback("Disponibilidad guardada", resolvedSaveMessage);
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
            <Text style={styles.title}>{resolvedTitle}</Text>
            <Text style={styles.subtitle}>{resolvedSubtitle}</Text>

            <ScrollView
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              <DaySelector
                activeDayKeys={activeDayKeys}
                days={days}
                onSelect={setSelectedDayKey}
                selectedDayKey={selectedDayKey}
              />

              {!customDayOptions ? (
                <QuickTimeSlots
                  displayRanges={quickSlotVisualState.displayRanges}
                  onToggle={handleToggleQuickSlot}
                  selectedSlots={quickSlotVisualState.selectedSlots}
                  slots={quickSlots}
                />
              ) : null}

              <View style={styles.dayCard}>
                {days.some((day) => (availability[day.key]?.customSlots || []).length > 0) ? (
                  <View style={styles.allSlotsWrap}>
                    {days.flatMap((day) =>
                      (availability[day.key]?.customSlots || []).map((slot, slotIndex) => (
                        <View key={`${day.key}-${slot.from}-${slot.to}-${slotIndex}`} style={styles.allSlotRow}>
                          <Text numberOfLines={1} style={styles.allSlotDay}>
                            {resolveDayLabel(day.key)}
                          </Text>
                          <Text style={styles.allSlotTime}>{slot.from} - {slot.to}</Text>
                          <Pressable
                            onPress={() =>
                              setAvailability((current) =>
                                removeCurrentCustomSlot(current, day.key, slotIndex)
                              )
                            }
                          >
                            <Text style={styles.customSlotRemove}>Quitar</Text>
                          </Pressable>
                        </View>
                      ))
                    )}
                  </View>
                ) : null}

                <Pressable
                  onPress={handleOpenCustomSheet}
                  style={({ pressed }) => [
                    styles.customButtonInline,
                    pressed && styles.customButtonPressed,
                  ]}
                >
                  <Text style={styles.customButtonInlineText}>{resolvedCustomButtonLabel}</Text>
                </Pressable>
              </View>

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
        dayLabel={resolveDayLabel(selectedDayKey)}
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
    paddingBottom: spacing.xl + 28,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  scrollContent: {
    paddingBottom: spacing.xl + 8,
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
    color: "#0EA5E9",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  dayCard: {
    backgroundColor: "transparent",
    marginTop: spacing.sm,
    paddingHorizontal: 0,
    paddingVertical: 4,
  },
  allSlotsWrap: {
    gap: 6,
    marginBottom: 4,
  },
  allSlotRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    paddingVertical: 6,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  allSlotDay: {
    color: colors.primaryDark,
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
  },
  allSlotTime: {
    color: colors.text,
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
  customButtonInline: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "transparent",
    borderColor: "#D3E5DD",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: 10,
    minHeight: 28,
    paddingHorizontal: 12,
  },
  customButtonPressed: {
    opacity: 0.92,
  },
  customButtonInlineText: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "800",
  },
  customSlotRemove: {
    color: "#B44B4B",
    fontSize: 12,
    fontWeight: "800",
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
  confirmOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  confirmBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  confirmCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    padding: spacing.lg,
    width: "100%",
  },
  confirmTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
  },
  confirmMessage: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  confirmActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  confirmSecondaryButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
  },
  confirmSecondaryButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
  },
  confirmDangerButton: {
    alignItems: "center",
    backgroundColor: colors.danger,
    borderRadius: 16,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
  },
  confirmDangerButtonText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: "800",
  },
});

