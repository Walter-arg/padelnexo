import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "../config/theme";
import AppButton from "./AppButton";
import AppInput from "./AppInput";
import FeedbackModal from "./FeedbackModal";
import LocationPicker from "./LocationPicker";
import { geocodeAddress, getCoordinatesFromObject } from "../services/locationService";
import { normalizeComplex } from "../services/organizerService";

const COURT_STRUCTURE_OPTIONS = [
  { key: "blindex", label: "Blindex" },
  { key: "cemento", label: "Cemento" },
];
const COURT_FLOOR_OPTIONS = [
  { key: "sintetico", label: "Sintetico" },
  { key: "cemento", label: "Piso cemento" },
];
const COURT_ENVIRONMENT_OPTIONS = [
  { key: "cubierta", label: "Cubierta" },
  { key: "aire_libre", label: "Aire libre" },
];

function sanitizeComplexText(value) {
  return value.slice(0, 30);
}

function sanitizeAddressText(value) {
  return value.slice(0, 80);
}

function createEmptyCourtForm(index = 0) {
  return {
    id: `court-${Date.now()}-${index}`,
    nombre: "",
    estructura: "blindex",
    piso: "sintetico",
    ambiente: "aire_libre",
  };
}

function createEmptyComplexForm() {
  return {
    nombre: "",
    canchaAmbiente: "descubierta",
    canchas: [createEmptyCourtForm()],
    coordinates: null,
    direccion: "",
    localidad: { nombre: "", provincia: "" },
  };
}

function buildGeocodeCandidates(complex) {
  const locationParts = [complex.localidad?.nombre, complex.localidad?.provincia, "Argentina"].filter(
    Boolean
  );

  return [
    [complex.direccion, ...locationParts].filter(Boolean).join(", "),
    [complex.nombre, ...locationParts].filter(Boolean).join(", "),
    [complex.direccion, "Argentina"].filter(Boolean).join(", "),
  ].filter(Boolean);
}

async function geocodeComplexIfNeeded(complex) {
  const coordinates = getCoordinatesFromObject(complex);

  if (coordinates) {
    return { ...complex, coordinates };
  }

  for (const address of buildGeocodeCandidates(complex)) {
    try {
      const nextCoordinates = await geocodeAddress(address);

      if (nextCoordinates) {
        return { ...complex, coordinates: nextCoordinates };
      }
    } catch (error) {
      // Seguimos probando con el siguiente dato disponible.
    }
  }

  return complex;
}

// Permite al admin cargar el primer complejo de un organizador en el mismo
// paso en que le otorga el rol, para que el organizador no tenga que repetir
// ese trabajo. Va embebido (sin <Modal> propio) porque siempre se abre desde
// dentro del Modal "Gestionar usuario" de AdminScreen, y iOS no puede
// presentar un <Modal> nativo arriba de otro ya abierto.
export default function AdminGrantOrganizerModal({ targetUser, visible, onClose, onGranted, grantOrganizerAccess }) {
  const [complex, setComplex] = useState(createEmptyComplexForm());
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState({ visible: false, title: "", message: "", tone: "default" });

  useEffect(() => {
    if (visible) {
      setComplex(createEmptyComplexForm());
      setSubmitting(false);
    }
  }, [visible]);

  if (!visible) {
    return null;
  }

  const showFeedback = (title, message, tone = "default") => {
    setFeedback({ visible: true, title, message, tone });
  };

  const handleComplexChange = (field, value) => {
    setComplex((current) => ({
      ...current,
      [field]: value,
      ...(field === "direccion" ? { coordinates: null } : {}),
    }));
  };

  const handleLocalidadChange = (subfield, value) => {
    setComplex((current) => ({
      ...current,
      localidad: { ...current.localidad, [subfield]: value },
    }));
  };

  const handleLocalidadSelect = (location) => {
    setComplex((current) => ({
      ...current,
      localidad: location
        ? { nombre: location.nombre || "", provincia: location.provincia || "" }
        : { ...current.localidad, provincia: "" },
    }));
  };

  const handleCourtChange = (courtIndex, field, value) => {
    setComplex((current) => {
      const canchas = [...(current.canchas || [])];
      canchas[courtIndex] = {
        ...canchas[courtIndex],
        [field]: field === "nombre" ? sanitizeComplexText(value) : value,
      };

      return { ...current, canchas };
    });
  };

  const addCourt = () => {
    setComplex((current) => ({
      ...current,
      canchas: [...(current.canchas || []), createEmptyCourtForm((current.canchas || []).length)],
    }));
  };

  const removeCourt = (courtIndex) => {
    setComplex((current) => {
      const canchas = (current.canchas || []).filter((_, index) => index !== courtIndex);

      return { ...current, canchas: canchas.length ? canchas : [createEmptyCourtForm()] };
    });
  };

  const validate = () => {
    if (!complex.nombre.trim()) {
      showFeedback("Falta el complejo", "Completa el nombre del complejo.", "danger");
      return false;
    }

    if (!complex.direccion.trim()) {
      showFeedback("Falta la direccion", "Completa la direccion del complejo.", "danger");
      return false;
    }

    if (!complex.localidad?.nombre?.trim()) {
      showFeedback("Falta la localidad", "Completa la localidad del complejo.", "danger");
      return false;
    }

    const invalidCourtIndex = (complex.canchas || []).findIndex(
      (court) => !court.estructura || !court.piso || !court.ambiente
    );

    if (!complex.canchas?.length || invalidCourtIndex >= 0) {
      showFeedback(
        "Faltan datos de cancha",
        `Revisa la cancha ${invalidCourtIndex + 1} del complejo.`,
        "danger"
      );
      return false;
    }

    return true;
  };

  const handleSubmit = async () => {
    if (!validate()) {
      return;
    }

    setSubmitting(true);

    try {
      const geocoded = await geocodeComplexIfNeeded({
        ...complex,
        nombre: complex.nombre.trim(),
        direccion: complex.direccion.trim(),
        localidad: {
          nombre: complex.localidad.nombre.trim(),
          provincia: complex.localidad.provincia?.trim() || "",
          pais: "Argentina",
        },
      });
      const normalized = normalizeComplex(geocoded);

      await grantOrganizerAccess(targetUser.id, normalized);
      onGranted();
    } catch (error) {
      showFeedback(
        "No pudimos completar la accion",
        error?.message || "Intenta de nuevo en unos segundos.",
        "danger"
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.overlay}>
      <Pressable onPress={onClose} style={styles.backdrop} />
      <View style={styles.card}>
        <Text style={styles.title}>Hacer organizador</Text>
        <Text style={styles.subtitle}>
          Carga el primer complejo de {targetUser?.name || targetUser?.nombre || "este usuario"} para
          que no tenga que hacerlo el.
        </Text>

        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          <AppInput
            autoCapitalize="words"
            label="Nombre del complejo"
            onChangeText={(value) => handleComplexChange("nombre", sanitizeComplexText(value))}
            placeholder="Nombre del complejo"
            value={complex.nombre}
          />

          <AppInput
            autoCapitalize="words"
            label="Direccion del complejo"
            onChangeText={(value) => handleComplexChange("direccion", sanitizeAddressText(value))}
            placeholder="Direccion"
            value={complex.direccion}
          />

          <LocationPicker
            label="Localidad"
            onChangeText={(value) => handleLocalidadChange("nombre", value)}
            onSelect={handleLocalidadSelect}
            placeholder="Ej. Cordoba"
            selectedLocation={
              complex.localidad?.nombre && complex.localidad?.provincia ? complex.localidad : null
            }
            value={complex.localidad?.nombre || ""}
          />

          <AppInput
            autoCapitalize="words"
            editable={false}
            label="Provincia"
            placeholder="Se completa al elegir la localidad"
            value={complex.localidad?.provincia || ""}
          />

          {(complex.canchas || []).map((court, courtIndex) => (
            <View key={court.id || `court-${courtIndex}`} style={styles.courtCard}>
              <View style={styles.courtHeader}>
                <Text style={styles.courtTitle}>Cancha {courtIndex + 1}</Text>
                {(complex.canchas || []).length > 1 ? (
                  <Pressable onPress={() => removeCourt(courtIndex)}>
                    <Text style={styles.removeText}>Quitar</Text>
                  </Pressable>
                ) : null}
              </View>

              <AppInput
                autoCapitalize="characters"
                label="Nombre de cancha (opcional)"
                onChangeText={(value) => handleCourtChange(courtIndex, "nombre", value)}
                placeholder={`Cancha ${courtIndex + 1}`}
                value={court.nombre}
              />

              <Text style={styles.optionLabel}>Tipo de cancha</Text>
              <View style={styles.optionRow}>
                {COURT_STRUCTURE_OPTIONS.map((option) => {
                  const isSelected = court.estructura === option.key;

                  return (
                    <Pressable
                      key={option.key}
                      onPress={() => handleCourtChange(courtIndex, "estructura", option.key)}
                      style={[styles.option, isSelected && styles.optionActive]}
                    >
                      <Text style={[styles.optionText, isSelected && styles.optionTextActive]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.optionLabel}>Tipo de piso</Text>
              <View style={styles.optionRow}>
                {COURT_FLOOR_OPTIONS.map((option) => {
                  const isSelected = court.piso === option.key;

                  return (
                    <Pressable
                      key={option.key}
                      onPress={() => handleCourtChange(courtIndex, "piso", option.key)}
                      style={[styles.option, isSelected && styles.optionActive]}
                    >
                      <Text style={[styles.optionText, isSelected && styles.optionTextActive]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={styles.optionLabel}>Ambiente</Text>
              <View style={styles.optionRow}>
                {COURT_ENVIRONMENT_OPTIONS.map((option) => {
                  const isSelected = court.ambiente === option.key;

                  return (
                    <Pressable
                      key={option.key}
                      onPress={() => handleCourtChange(courtIndex, "ambiente", option.key)}
                      style={[styles.option, isSelected && styles.optionActive]}
                    >
                      <Text style={[styles.optionText, isSelected && styles.optionTextActive]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}

          <AppButton title="Agregar cancha" onPress={addCourt} variant="secondary" style={styles.addCourtButton} />
        </ScrollView>

        <View style={styles.actions}>
          <AppButton
            disabled={submitting}
            onPress={onClose}
            style={styles.actionButton}
            title="Cancelar"
            variant="secondary"
          />
          <AppButton
            disabled={submitting}
            onPress={handleSubmit}
            style={styles.actionButton}
            title={submitting ? "Guardando..." : "Confirmar y hacer organizador"}
          />
        </View>
      </View>

      <FeedbackModal
        embedded
        message={feedback.message}
        onClose={() => setFeedback((current) => ({ ...current, visible: false }))}
        title={feedback.title}
        tone={feedback.tone}
        visible={feedback.visible}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    maxHeight: "88%",
    padding: spacing.lg,
    width: "100%",
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center",
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    textAlign: "center",
  },
  scroll: {
    marginBottom: spacing.md,
  },
  courtCard: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  courtHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  courtTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  removeText: {
    color: "#C53B3B",
    fontSize: 13,
    fontWeight: "700",
  },
  optionLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  optionRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  option: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: spacing.sm,
  },
  optionActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  optionText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "600",
  },
  optionTextActive: {
    color: "#FFFFFF",
  },
  addCourtButton: {
    marginTop: spacing.md,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
  },
});
