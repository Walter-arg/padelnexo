import { useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import { phoneCountryOptions } from "../data/phoneCountryOptions";
import AppButton from "./AppButton";
import AppInput from "./AppInput";
import CountryCodeSelector from "./CountryCodeSelector";
import FeedbackModal from "./FeedbackModal";

const NAME_REGEX = /^[A-Za-z\u00c0-\u00ff\s]+$/;

function sanitizeDigits(value) {
  return value.replace(/[^0-9]/g, "");
}

function sanitizeOrganizerName(value) {
  return value.replace(/[^A-Za-z\u00c0-\u00ff\s]/g, "").slice(0, 25);
}

function sanitizeComplexText(value) {
  return value.slice(0, 30);
}

function createEmptyComplexForm() {
  return {
    nombre: "",
    blindex: "",
    cesped: "",
    cemento: "",
    direccion: "",
  };
}

function mapComplexToForm(complex = createEmptyComplexForm()) {
  return {
    nombre: complex.nombre || "",
    blindex: String(complex.blindex ?? ""),
    cesped: String(complex.cesped ?? ""),
    cemento: String(complex.cemento ?? ""),
    direccion: complex.direccion || "",
  };
}

function buildInitialState(user, mode) {
  const complejos =
    mode === "edit" && Array.isArray(user?.complejos) && user.complejos.length > 0
      ? user.complejos.map(mapComplexToForm)
      : [createEmptyComplexForm()];

  return {
    nombre: user?.name || "",
    dni: "",
    telefono: user?.phone || "",
    countryCode: user?.countryCode || "+54",
    phoneCountry: user?.phoneCountry || "Argentina",
    complejos,
  };
}

export default function OrganizerRequestModal({
  mode = "request",
  onClose,
  onSaved,
  user,
  visible,
}) {
  const {
    submitComplexRequest,
    submitOrganizerRequest,
    updateOrganizerComplexes,
  } = useAuth();
  const [form, setForm] = useState(buildInitialState(user, mode));
  const [pendingSavedProfile, setPendingSavedProfile] = useState(null);
  const [feedback, setFeedback] = useState({
    visible: false,
    title: "",
    message: "",
    tone: "default",
  });

  useEffect(() => {
    if (visible) {
      setForm(buildInitialState(user, mode));
      setPendingSavedProfile(null);
      setFeedback({
        visible: false,
        title: "",
        message: "",
        tone: "default",
      });
    }
  }, [mode, user?.uid, visible]);

  const isEditMode = mode === "edit";
  const isAddComplexRequestMode = mode === "add-complex-request";

  const title = isEditMode
    ? "Editar complejos"
    : isAddComplexRequestMode
      ? "Solicitar complejo"
      : "Solicitud de organizador";
  const subtitle = isEditMode
    ? "Actualiza tus complejos y la cantidad de canchas sin salir del perfil."
    : isAddComplexRequestMode
      ? "Carga el nuevo complejo para que el administrador lo revise antes de habilitarlo."
      : "Completa tus datos y registra tus complejos para que el equipo revise tu solicitud.";

  const complexesWithTotals = useMemo(
    () =>
      form.complejos.map((complex) => {
        const blindex = Number.parseInt(complex.blindex || "0", 10) || 0;
        const cesped = Number.parseInt(complex.cesped || "0", 10) || 0;
        const cemento = Number.parseInt(complex.cemento || "0", 10) || 0;

        return {
          ...complex,
          totalCanchas: blindex + cesped + cemento,
        };
      }),
    [form.complejos]
  );

  const totalGeneralCanchas = useMemo(
    () =>
      complexesWithTotals.reduce(
        (accumulator, complex) => accumulator + (complex.totalCanchas || 0),
        0
      ),
    [complexesWithTotals]
  );

  const updateField = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const showFeedback = (title, message, tone = "default") => {
    setFeedback({
      visible: true,
      title,
      message,
      tone,
    });
  };

  const handleComplejoChange = (index, field, value) => {
    setForm((current) => {
      const nuevosComplejos = [...current.complejos];
      nuevosComplejos[index] = {
        ...nuevosComplejos[index],
        [field]:
          field === "blindex" || field === "cesped" || field === "cemento"
            ? sanitizeDigits(value)
            : value,
      };

      return {
        ...current,
        complejos: nuevosComplejos,
      };
    });
  };

  const agregarComplejo = () => {
    setForm((current) => ({
      ...current,
      complejos: [...current.complejos, createEmptyComplexForm()],
    }));
  };

  const removeComplex = (index) => {
    setForm((current) => ({
      ...current,
      complejos: current.complejos.filter((_, complexIndex) => complexIndex !== index),
    }));
  };

  const validateForm = () => {
    if (!isEditMode && !isAddComplexRequestMode) {
      if (!form.nombre.trim()) {
        showFeedback("Falta tu nombre", "Ingresa nombre y apellido para continuar.", "danger");
        return false;
      }

      if (!NAME_REGEX.test(form.nombre.trim())) {
        showFeedback("Nombre invalido", "Usa solo letras y espacios.", "danger");
        return false;
      }

      if (!form.dni.trim()) {
        showFeedback("Falta el DNI", "Ingresa tu DNI para continuar.", "danger");
        return false;
      }

      if (!form.telefono.trim()) {
        showFeedback("Falta el celular", "Ingresa un celular de contacto.", "danger");
        return false;
      }
    }

    for (let index = 0; index < complexesWithTotals.length; index += 1) {
      const complex = complexesWithTotals[index];

      if (!complex.nombre.trim()) {
        showFeedback(
          "Falta un complejo",
          `Completa el nombre del complejo ${index + 1}.`,
          "danger"
        );
        return false;
      }

      if (!complex.direccion.trim()) {
        showFeedback(
          "Falta la direccion",
          `Completa la direccion del complejo ${index + 1}.`,
          "danger"
        );
        return false;
      }

      if (complex.totalCanchas <= 0) {
        showFeedback(
          "Cantidad invalida",
          `El complejo ${index + 1} debe tener al menos una cancha.`,
          "danger"
        );
        return false;
      }
    }

    return true;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    const complejos = complexesWithTotals.map((complex) => ({
      nombre: complex.nombre.trim(),
      blindex: Number.parseInt(complex.blindex || "0", 10) || 0,
      cesped: Number.parseInt(complex.cesped || "0", 10) || 0,
      cemento: Number.parseInt(complex.cemento || "0", 10) || 0,
      totalCanchas: complex.totalCanchas,
      direccion: complex.direccion.trim(),
    }));

    try {
      const profile = isEditMode
        ? await updateOrganizerComplexes(complejos)
        : isAddComplexRequestMode
          ? await submitComplexRequest(complejos)
          : await submitOrganizerRequest({
              nombre: form.nombre,
              dni: form.dni,
              telefono: form.telefono,
              countryCode: form.countryCode,
              phoneCountry: form.phoneCountry,
              complejos,
            });

      showFeedback(
        isEditMode
          ? "Complejos actualizados"
          : isAddComplexRequestMode
            ? "Solicitud enviada"
            : "Solicitud enviada",
        isEditMode
          ? "Tus complejos fueron actualizados correctamente."
          : isAddComplexRequestMode
            ? "El nuevo complejo quedo pendiente de revision. Solo aparecera cuando el administrador lo apruebe."
            : "Tu solicitud fue enviada y esta en revision por el equipo de PadelNexo",
        "success"
      );
      setPendingSavedProfile(profile);
    } catch (error) {
      showFeedback(
        isEditMode
          ? "No pudimos guardar los complejos"
          : "No pudimos enviar la solicitud",
        error.message,
        "danger"
      );
    }
  };

  return (
    <Modal animationType="slide" transparent visible={visible}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.overlay}
      >
        <Pressable onPress={onClose} style={styles.backdrop} />
        <View style={styles.card}>
          <View style={styles.handle} />
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>

          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {!isEditMode && !isAddComplexRequestMode ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>DATOS PERSONALES</Text>
                <AppInput
                  autoCapitalize="words"
                  label="Nombre y Apellido"
                  labelStyle={styles.centeredLabel}
                  onChangeText={(value) => updateField("nombre", sanitizeOrganizerName(value))}
                  placeholder="Tu nombre completo"
                  value={form.nombre}
                />
                <AppInput
                  keyboardType="number-pad"
                  label="DNI"
                  labelStyle={styles.centeredLabel}
                  onChangeText={(value) => updateField("dni", sanitizeDigits(value))}
                  placeholder="Solo numeros"
                  value={form.dni}
                />
                <AppInput
                  keyboardType="phone-pad"
                  label="Celular"
                  labelStyle={styles.centeredLabel}
                  leftElement={
                    <CountryCodeSelector
                      onChange={(option) => {
                        updateField("countryCode", option.code);
                        updateField("phoneCountry", option.country);
                      }}
                      options={phoneCountryOptions}
                      value={form.phoneCountry}
                    />
                  }
                  onChangeText={(value) => updateField("telefono", sanitizeDigits(value))}
                  placeholder="1155555555"
                  value={form.telefono}
                />
              </View>
            ) : null}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>CANCHAS DE PADEL</Text>

              {complexesWithTotals.map((complex, index) => (
                <View key={`complex-${index}`} style={styles.complexCard}>
                  <View style={styles.complexHeader}>
                    <Text style={styles.complexTitle}>Complejo {index + 1}</Text>
                    {form.complejos.length > 1 ? (
                      <Pressable onPress={() => removeComplex(index)}>
                        <Text style={styles.removeText}>Eliminar</Text>
                      </Pressable>
                    ) : null}
                  </View>

                  <AppInput
                    autoCapitalize="words"
                    label="Nombre del complejo"
                    labelStyle={styles.centeredLabel}
                    onChangeText={(value) =>
                      handleComplejoChange(index, "nombre", sanitizeComplexText(value))
                    }
                    placeholder="Nombre del complejo"
                    value={complex.nombre}
                  />
                  <AppInput
                    keyboardType="number-pad"
                    label="Canchas Blindex"
                    labelStyle={styles.centeredLabel}
                    onChangeText={(value) => handleComplejoChange(index, "blindex", value)}
                    placeholder="0"
                    value={complex.blindex}
                  />
                  <AppInput
                    keyboardType="number-pad"
                    label="Cemento con cesped sintetico"
                    labelStyle={styles.centeredLabel}
                    onChangeText={(value) => handleComplejoChange(index, "cesped", value)}
                    placeholder="0"
                    value={complex.cesped}
                  />
                  <AppInput
                    keyboardType="number-pad"
                    label="Cemento piso de cemento"
                    labelStyle={styles.centeredLabel}
                    onChangeText={(value) => handleComplejoChange(index, "cemento", value)}
                    placeholder="0"
                    value={complex.cemento}
                  />

                  <View style={styles.totalCard}>
                    <Text style={styles.totalLabel}>Total de canchas</Text>
                    <Text style={styles.totalValue}>{complex.totalCanchas}</Text>
                  </View>

                  <AppInput
                    autoCapitalize="words"
                    label="Direccion del complejo"
                    labelStyle={styles.centeredLabel}
                    onChangeText={(value) =>
                      handleComplejoChange(index, "direccion", sanitizeComplexText(value))
                    }
                    placeholder="Direccion"
                    value={complex.direccion}
                  />
                </View>
              ))}

              <AppButton
                title="Agregar otro complejo"
                onPress={agregarComplejo}
                style={styles.addComplexButton}
                variant="secondary"
              />

              <View style={styles.globalTotalCard}>
                <Text style={styles.totalLabel}>Total de canchas disponibles</Text>
                <Text style={styles.totalValue}>{totalGeneralCanchas}</Text>
              </View>
            </View>

            <View style={styles.actionsBlock}>
              <AppButton
                title={
                  isEditMode
                    ? "Guardar complejos"
                    : isAddComplexRequestMode
                      ? "Enviar para aprobacion"
                      : "Enviar solicitud"
                }
                onPress={handleSubmit}
                style={styles.compactButton}
              />
              <AppButton
                title="Cancelar"
                onPress={onClose}
                style={[styles.compactButton, styles.compactSecondaryButton]}
                variant="secondary"
              />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
      <FeedbackModal
        confirmLabel={feedback.tone === "success" ? "Continuar" : "Entendido"}
        message={feedback.message}
        onClose={() => {
          const shouldClose = feedback.tone === "success";
          setFeedback((current) => ({ ...current, visible: false }));
          if (shouldClose) {
            onSaved?.(pendingSavedProfile);
            onClose?.();
          }
        }}
        title={feedback.title}
        tone={feedback.tone}
        visible={feedback.visible}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  card: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    maxHeight: "92%",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  handle: {
    alignSelf: "center",
    backgroundColor: colors.border,
    borderRadius: 999,
    height: 5,
    marginBottom: spacing.md,
    width: 52,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "800",
  },
  subtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: spacing.lg,
    marginTop: spacing.xs,
  },
  content: {
    paddingBottom: spacing.md,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  complexCard: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  complexHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  complexTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
  },
  removeText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "700",
  },
  totalCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 18,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  totalLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 4,
    textTransform: "uppercase",
  },
  totalValue: {
    color: colors.primaryDark,
    fontSize: 24,
    fontWeight: "800",
  },
  addComplexButton: {
    paddingVertical: 12,
  },
  globalTotalCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  actionsBlock: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  compactButton: {
    marginBottom: 0,
    minHeight: 48,
    paddingVertical: 12,
  },
  compactSecondaryButton: {
    marginTop: 0,
  },
  centeredLabel: {
    textAlign: "center",
  },
});

