import { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import LocationPicker from "./LocationPicker";
import { colors, spacing } from "../config/theme";
import {
  areSameFilterLocations,
  buildGlobalFilterLocations,
  loadSectionFilterPreferences,
  saveSectionFilterPreferences,
} from "../services/sectionFilterPreferences";

const MAX_LOCATIONS = 5;

function LocationChip({ location, onRemove, removable = true }) {
  return (
    <View style={styles.locationChip}>
      <Ionicons
        color={colors.primaryDark}
        name="location"
        size={12}
        style={styles.locationChipIcon}
      />
      <Text numberOfLines={1} style={styles.locationChipText}>
        {location.nombre}
      </Text>
      {removable ? (
        <Pressable hitSlop={8} onPress={onRemove} style={styles.locationChipRemove}>
          <Ionicons color={colors.primaryDark} name="close" size={14} />
        </Pressable>
      ) : null}
    </View>
  );
}

export default function SectionFilterBar({
  extraSummary,
  onChange,
  onApply,
  onModalClose,
  onModalOpen,
  renderExtraContent,
  userLocation,
}) {
  const [isVisible, setIsVisible] = useState(false);
  const [rememberByDefault, setRememberByDefault] = useState(false);
  const [includeBaseLocation, setIncludeBaseLocation] = useState(true);
  const [extraLocations, setExtraLocations] = useState([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [draftExtraLocations, setDraftExtraLocations] = useState([]);
  const [draftRememberByDefault, setDraftRememberByDefault] = useState(false);
  const [draftIncludeBaseLocation, setDraftIncludeBaseLocation] = useState(true);
  const [locationInput, setLocationInput] = useState("");
  const [draftSelectedLocation, setDraftSelectedLocation] = useState(null);
  const onChangeRef = useRef(onChange);
  const lastEmittedPayloadRef = useRef("");

  const activeLocations = useMemo(
    () =>
      buildGlobalFilterLocations(userLocation, extraLocations, MAX_LOCATIONS, {
        includeBaseLocation,
      }),
    [extraLocations, includeBaseLocation, userLocation]
  );

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let isMounted = true;

    const hydratePreferences = async () => {
      const preferences = await loadSectionFilterPreferences();

      if (!isMounted) {
        return;
      }

      setIncludeBaseLocation(preferences.includeBaseLocation);
      setRememberByDefault(preferences.rememberByDefault);
      setExtraLocations(preferences.extraLocations);
      setIsHydrated(true);
    };

    hydratePreferences();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    const payload = {
      locations: activeLocations,
      includeBaseLocation,
      rememberByDefault,
    };
    const serializedPayload = JSON.stringify(payload);

    if (lastEmittedPayloadRef.current === serializedPayload) {
      return;
    }

    lastEmittedPayloadRef.current = serializedPayload;
    onChangeRef.current?.(payload);
  }, [activeLocations, includeBaseLocation, isHydrated, rememberByDefault]);

  const openModal = () => {
    setDraftExtraLocations(extraLocations);
    setDraftIncludeBaseLocation(includeBaseLocation);
    setDraftRememberByDefault(rememberByDefault);
    setDraftSelectedLocation(null);
    setLocationInput("");
    onModalOpen?.();
    setIsVisible(true);
  };

  const handleClose = () => {
    onModalClose?.();
    setIsVisible(false);
  };

  const handleAddLocation = () => {
    if (!draftSelectedLocation) {
      return;
    }

    const nextLocations = buildGlobalFilterLocations(
      userLocation,
      [...draftExtraLocations, draftSelectedLocation],
      MAX_LOCATIONS,
      { includeBaseLocation: draftIncludeBaseLocation }
    );

    if (nextLocations.length > MAX_LOCATIONS) {
      return;
    }

    setDraftExtraLocations(
      nextLocations.filter((location) => !areSameFilterLocations(location, userLocation))
    );
    setDraftSelectedLocation(null);
    setLocationInput("");
  };

  const handleApply = async () => {
    await onApply?.();
    setExtraLocations(draftExtraLocations);
    setIncludeBaseLocation(draftIncludeBaseLocation);
    setRememberByDefault(draftRememberByDefault);
    setIsVisible(false);

    await saveSectionFilterPreferences({
      includeBaseLocation: draftIncludeBaseLocation,
      rememberByDefault: draftRememberByDefault,
      extraLocations: draftExtraLocations,
    });
  };

  const canAddMoreLocations =
    buildGlobalFilterLocations(userLocation, draftExtraLocations, MAX_LOCATIONS, {
      includeBaseLocation: draftIncludeBaseLocation,
    }).length < MAX_LOCATIONS;
  const draftLocations = buildGlobalFilterLocations(userLocation, draftExtraLocations, MAX_LOCATIONS, {
    includeBaseLocation: draftIncludeBaseLocation,
  });
  const compactLocationSummary =
    activeLocations.length > 0
      ? `${activeLocations[0].nombre}${activeLocations.length > 1 ? ` +${activeLocations.length - 1}` : ""}`
      : "Todas las localidades";

  return (
    <>
      <Pressable
        onPress={openModal}
        style={({ pressed }) => [styles.filterBar, pressed && styles.filterBarPressed]}
      >
        <View style={styles.filterBarHeader}>
          <View style={styles.filterBarTitleWrap}>
            <View style={styles.filterBarIconWrap}>
              <Ionicons color={colors.primaryDark} name="location-outline" size={18} />
            </View>
            <View style={styles.filterBarTextWrap}>
              <Text style={styles.filterBarEyebrow}>Ajustar filtros</Text>
              <Text numberOfLines={1} style={styles.filterBarTitle}>
                {compactLocationSummary}
              </Text>
            </View>
          </View>
          {extraSummary ? (
            <View style={styles.summaryChipSecondary}>
              <Text numberOfLines={1} style={styles.summaryChipSecondaryText}>
                {extraSummary}
              </Text>
            </View>
          ) : (
            <Ionicons color={colors.primaryDark} name="options-outline" size={18} />
          )}
        </View>
      </Pressable>

      <Modal animationType="slide" transparent visible={isVisible}>
        <View style={styles.modalOverlay}>
          <Pressable onPress={handleClose} style={styles.modalBackdrop} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Filtros</Text>

            <View style={styles.locationsSection}>
              <View style={styles.locationsHeader}>
                <Text style={styles.sectionLabel}>Localidades activas</Text>
                <View style={styles.inlineRememberRow}>
                  <Text style={styles.inlineRememberTitle}>Mantener por defecto</Text>
                  <Switch
                    onValueChange={setDraftRememberByDefault}
                    thumbColor={draftRememberByDefault ? colors.surface : "#F4F4F5"}
                    trackColor={{ false: "#D9E4DE", true: colors.primary }}
                    value={draftRememberByDefault}
                  />
                </View>
              </View>
              <View style={styles.locationsWrap}>
                {draftLocations.map((location, index) => (
                  <LocationChip
                    key={`${location.nombre}-${location.provincia}-${index}`}
                    location={location}
                    onRemove={() => {
                      if (areSameFilterLocations(location, userLocation)) {
                        setDraftIncludeBaseLocation(false);
                        return;
                      }

                      setDraftExtraLocations((current) =>
                        current.filter((item) => !areSameFilterLocations(item, location))
                      );
                    }}
                    removable
                  />
                ))}
              </View>
            </View>

            <View style={styles.addLocationCard}>
              <Text style={styles.sectionLabel}>Agregar otra localidad</Text>
              <View style={styles.addLocationRow}>
                <LocationPicker
                  containerStyle={styles.locationPicker}
                  inputStyle={styles.locationPickerInput}
                  label=""
                  labelStyle={styles.hiddenLabel}
                  onChangeText={setLocationInput}
                  onSelect={(location) => setDraftSelectedLocation(location)}
                  placeholder={
                    canAddMoreLocations
                      ? "Buscar localidad"
                      : "Maximo alcanzado"
                  }
                  selectedLocation={draftSelectedLocation}
                  value={locationInput}
                />
                <Pressable
                  disabled={!draftSelectedLocation || !canAddMoreLocations}
                  onPress={handleAddLocation}
                  style={[
                    styles.addLocationButton,
                    (!draftSelectedLocation || !canAddMoreLocations) &&
                      styles.addLocationButtonDisabled,
                  ]}
                >
                  <Ionicons color={colors.surface} name="add" size={18} />
                  <Text style={styles.addLocationButtonText}>Agregar</Text>
                </Pressable>
              </View>
            </View>

            {renderExtraContent ? (
              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                style={styles.extraContent}
              >
                {renderExtraContent({
                  activeLocations,
                  draftLocations,
                })}
              </ScrollView>
            ) : null}

            <View style={styles.actionsRow}>
              <Pressable onPress={handleClose} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Cerrar</Text>
              </Pressable>
              <Pressable onPress={handleApply} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>Aplicar filtros</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  filterBar: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    marginHorizontal: spacing.lg,
    marginTop: -4,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 3,
  },
  filterBarPressed: {
    opacity: 0.95,
  },
  filterBarHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  filterBarTitleWrap: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
  },
  filterBarIconWrap: {
    alignItems: "center",
    backgroundColor: "#EAF6F1",
    borderRadius: 12,
    height: 32,
    justifyContent: "center",
    marginRight: 10,
    width: 32,
  },
  filterBarTextWrap: {
    flex: 1,
  },
  filterBarEyebrow: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.2,
    textTransform: "uppercase",
  },
  filterBarTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 1,
  },
  summaryChipSecondary: {
    alignItems: "center",
    backgroundColor: "#E8F3FF",
    borderRadius: 999,
    justifyContent: "center",
    marginLeft: spacing.sm,
    minHeight: 28,
    paddingHorizontal: 10,
  },
  summaryChipSecondaryText: {
    color: "#24537D",
    fontSize: 11,
    fontWeight: "700",
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
    maxHeight: "88%",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
    textAlign: "left",
  },
  locationsSection: {
    marginTop: spacing.sm,
  },
  locationsHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  sectionLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  inlineRememberRow: {
    alignItems: "center",
    flexDirection: "row",
    marginLeft: spacing.sm,
  },
  inlineRememberTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700",
    marginRight: 6,
  },
  locationsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  locationChip: {
    alignItems: "center",
    backgroundColor: "#EDF7F2",
    borderColor: "#C9E5D8",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    maxWidth: "100%",
    minHeight: 34,
    paddingHorizontal: 9,
  },
  locationChipIcon: {
    marginRight: 6,
  },
  locationChipText: {
    color: colors.text,
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "700",
  },
  locationChipRemove: {
    marginLeft: 4,
  },
  addLocationCard: {
    marginTop: spacing.sm,
  },
  addLocationRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 8,
  },
  locationPicker: {
    flex: 1,
    marginBottom: 0,
  },
  hiddenLabel: {
    display: "none",
  },
  locationPickerInput: {
    minHeight: 40,
  },
  addLocationButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 16,
    flexDirection: "row",
    justifyContent: "center",
    minHeight: 40,
    minWidth: 118,
    paddingHorizontal: 14,
  },
  addLocationButtonDisabled: {
    backgroundColor: "#A9C9BC",
  },
  addLocationButtonText: {
    color: colors.surface,
    fontSize: 13,
    fontWeight: "800",
    marginLeft: 6,
  },
  extraContent: {
    marginTop: spacing.sm,
  },
  actionsRow: {
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
