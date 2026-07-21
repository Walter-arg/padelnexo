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
import {
  geocodeAddress,
  getCoordinatesFromObject,
  requestCurrentLocation,
} from "../services/locationService";

const NAME_REGEX = /^[A-Za-z\u00c0-\u00ff\s]+$/;
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

function sanitizeDigits(value) {
  return value.replace(/[^0-9]/g, "");
}

function sanitizeOrganizerName(value) {
  return value.replace(/[^A-Za-z\u00c0-\u00ff\s]/g, "").slice(0, 25);
}

function sanitizeComplexText(value) {
  return value.slice(0, 30);
}

function sanitizeAddressText(value) {
  return value.slice(0, 80);
}

function buildUserLocationParts(user = {}) {
  return [
    user?.localidad?.nombre || user?.city || "",
    user?.localidad?.provincia || user?.province || user?.location?.provincia || "",
    user?.localidad?.pais || user?.country || user?.location?.pais || "Argentina",
  ].filter(Boolean);
}

function buildComplexGeocodeCandidates(complex = {}, user = {}) {
  const locationParts = complex.localidad?.nombre
    ? [complex.localidad.nombre, complex.localidad.provincia || "", "Argentina"].filter(Boolean)
    : buildUserLocationParts(user);

  return [
    [complex.direccion, ...locationParts].filter(Boolean).join(", "),
    [complex.nombre, ...locationParts].filter(Boolean).join(", "),
    [complex.direccion, "Argentina"].filter(Boolean).join(", "),
  ].filter(Boolean);
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

function createEmptyCourtForm(index = 0) {
  return {
    id: `court-${Date.now()}-${index}`,
    nombre: "",
    estructura: "blindex",
    piso: "sintetico",
    ambiente: "aire_libre",
  };
}

function mapLegacyCourts(complex = {}) {
  const courts = [];
  const ambiente = complex.canchaAmbiente === "cubierta" ? "cubierta" : "aire_libre";
  const addCourts = (count, template) => {
    Array.from({ length: Number.parseInt(String(count || "0"), 10) || 0 }).forEach(() => {
      courts.push({
        ...createEmptyCourtForm(courts.length),
        ...template,
        ambiente,
        id: `court-${courts.length + 1}`,
      });
    });
  };

  addCourts(complex.blindex, { estructura: "blindex", piso: "sintetico" });
  addCourts(complex.cesped, { estructura: "cemento", piso: "sintetico" });
  addCourts(complex.cemento, { estructura: "cemento", piso: "cemento" });

  return courts.length ? courts : [createEmptyCourtForm()];
}

function mapComplexToForm(complex = createEmptyComplexForm()) {
  return {
    nombre: complex.nombre || "",
    canchaAmbiente: complex.canchaAmbiente || "descubierta",
    canchas: Array.isArray(complex.canchas) && complex.canchas.length
      ? complex.canchas.map((court, index) => ({
          id: court.id || `court-${index + 1}`,
          nombre: court.nombre || "",
          estructura: court.estructura === "cemento" ? "cemento" : "blindex",
          piso: court.piso === "cemento" ? "cemento" : "sintetico",
          ambiente: court.ambiente === "cubierta" ? "cubierta" : "aire_libre",
        }))
      : mapLegacyCourts(complex),
    direccion: complex.direccion || "",
    coordinates: getCoordinatesFromObject(complex),
    localidad: {
      nombre: complex.localidad?.nombre || "",
      provincia: complex.localidad?.provincia || "",
    },
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
  const [expandedComplexes, setExpandedComplexes] = useState({ 0: true });
  const [pendingSavedProfile, setPendingSavedProfile] = useState(null);
  const [locatingComplexIndex, setLocatingComplexIndex] = useState(null);
  const [feedback, setFeedback] = useState({
    visible: false,
    title: "",
    message: "",
    tone: "default",
  });

  useEffect(() => {
    if (visible) {
      setForm(buildInitialState(user, mode));
      setExpandedComplexes({ 0: true });
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
        const canchas = Array.isArray(complex.canchas) ? complex.canchas : [];
        const totals = canchas.reduce(
          (counts, court) => {
            if (court.estructura === "blindex") {
              counts.blindex += 1;
            } else if (court.piso === "sintetico") {
              counts.cesped += 1;
            } else {
              counts.cemento += 1;
            }

            return counts;
          },
          { blindex: 0, cemento: 0, cesped: 0 }
        );

        return {
          ...complex,
          ...totals,
          totalCanchas: canchas.length,
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
        [field]: value,
        ...(field === "direccion" ? { coordinates: null } : {}),
      };

      return {
        ...current,
        complejos: nuevosComplejos,
      };
    });
  };

  const handleComplejoLocalidadChange = (index, subfield, value) => {
    setForm((current) => {
      const nuevosComplejos = [...current.complejos];
      nuevosComplejos[index] = {
        ...nuevosComplejos[index],
        localidad: {
          ...nuevosComplejos[index].localidad,
          [subfield]: value,
        },
      };
      return { ...current, complejos: nuevosComplejos };
    });
  };

  const handleSetComplexCurrentLocation = async (index) => {
    try {
      setLocatingComplexIndex(index);
      const coordinates = await requestCurrentLocation();

      setForm((current) => {
        const complejos = [...current.complejos];
        complejos[index] = {
          ...complejos[index],
          coordinates,
        };

        return {
          ...current,
          complejos,
        };
      });

      showFeedback(
        "Ubicacion guardada",
        `El complejo ${index + 1} ya tiene ubicacion exacta cargada.`,
        "success"
      );
    } catch (error) {
      showFeedback(
        "No pudimos obtener ubicacion",
        error?.message || "Revisa el permiso de ubicacion del telefono.",
        "danger"
      );
    } finally {
      setLocatingComplexIndex(null);
    }
  };

  const geocodeComplexIfNeeded = async (complex) => {
    const coordinates = getCoordinatesFromObject(complex);

    if (coordinates) {
      return {
        ...complex,
        coordinates,
      };
    }

    for (const address of buildComplexGeocodeCandidates(complex, user)) {
      try {
        const nextCoordinates = await geocodeAddress(address);

        if (nextCoordinates) {
          return {
            ...complex,
            coordinates: nextCoordinates,
          };
        }
      } catch (error) {
        // Intentamos con el siguiente dato disponible.
      }
    }

    return complex;
  };

  const handleCourtChange = (complexIndex, courtIndex, field, value) => {
    setForm((current) => {
      const complejos = [...current.complejos];
      const canchas = [...(complejos[complexIndex].canchas || [])];
      canchas[courtIndex] = {
        ...canchas[courtIndex],
        [field]: field === "nombre" ? sanitizeComplexText(value) : value,
      };
      complejos[complexIndex] = {
        ...complejos[complexIndex],
        canchas,
      };

      return {
        ...current,
        complejos,
      };
    });
  };

  const addCourt = (complexIndex) => {
    setForm((current) => {
      const complejos = [...current.complejos];
      const canchas = [...(complejos[complexIndex].canchas || [])];
      canchas.push(createEmptyCourtForm(canchas.length));
      complejos[complexIndex] = {
        ...complejos[complexIndex],
        canchas,
      };

      return {
        ...current,
        complejos,
      };
    });
  };

  const removeCourt = (complexIndex, courtIndex) => {
    setForm((current) => {
      const complejos = [...current.complejos];
      const canchas = (complejos[complexIndex].canchas || []).filter(
        (_, index) => index !== courtIndex
      );
      complejos[complexIndex] = {
        ...complejos[complexIndex],
        canchas: canchas.length ? canchas : [createEmptyCourtForm()],
      };

      return {
        ...current,
        complejos,
      };
    });
  };

  const agregarComplejo = () => {
    setForm((current) => ({
      ...current,
      complejos: [...current.complejos, createEmptyComplexForm()],
    }));
    setExpandedComplexes((current) => ({ ...current, [form.complejos.length]: true }));
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

      if (!complex.localidad?.nombre?.trim()) {
        showFeedback(
          "Falta la localidad",
          `Completa la localidad del complejo ${index + 1}.`,
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

      const invalidCourtIndex = (complex.canchas || []).findIndex(
        (court) => !court.estructura || !court.piso || !court.ambiente
      );

      if (invalidCourtIndex >= 0) {
        showFeedback(
          "Faltan datos de cancha",
          `Revisa la cancha ${invalidCourtIndex + 1} del complejo ${index + 1}.`,
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

    try {
      const complejos = await Promise.all(
        complexesWithTotals.map((complex) =>
          geocodeComplexIfNeeded({
            nombre: complex.nombre.trim(),
            canchaAmbiente: complex.canchaAmbiente || "descubierta",
            canchas: (complex.canchas || []).map((court, courtIndex) => ({
              id: court.id || `court-${courtIndex + 1}`,
              nombre: court.nombre?.trim() || "",
              estructura: court.estructura,
              piso: court.piso,
              ambiente: court.ambiente,
            })),
            coordinates: complex.coordinates || null,
            blindex: complex.blindex,
            cesped: complex.cesped,
            cemento: complex.cemento,
            totalCanchas: complex.totalCanchas,
            direccion: complex.direccion.trim(),
            localidad: {
              nombre: complex.localidad?.nombre?.trim() || "",
              provincia: complex.localidad?.provincia?.trim() || "",
              pais: "Argentina",
            },
          })
        )
      );
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
                  <Pressable
                    onPress={() =>
                      setExpandedComplexes((current) => ({
                        ...current,
                        [index]: !current[index],
                      }))
                    }
                    style={styles.complexHeader}
                  >
                    <View>
                      <Text style={styles.complexTitle}>Complejo {index + 1}</Text>
                      <Text style={styles.complexSummary}>
                        {complex.nombre || "Sin nombre"} - {complex.totalCanchas} cancha(s)
                      </Text>
                    </View>
                    {form.complejos.length > 1 ? (
                      <Pressable onPress={() => removeComplex(index)}>
                        <Text style={styles.removeText}>Eliminar</Text>
                      </Pressable>
                    ) : null}
                  </Pressable>

                  {expandedComplexes[index] ? (
                    <>
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
                        autoCapitalize="words"
                        label="Direccion del complejo"
                        labelStyle={styles.centeredLabel}
                        onChangeText={(value) =>
                          handleComplejoChange(index, "direccion", sanitizeAddressText(value))
                        }
                        placeholder="Direccion"
                        value={complex.direccion}
                      />

                      <AppInput
                        autoCapitalize="words"
                        label="Localidad"
                        labelStyle={styles.centeredLabel}
                        onChangeText={(value) =>
                          handleComplejoLocalidadChange(index, "nombre", value)
                        }
                        placeholder="Ej. Córdoba"
                        value={complex.localidad?.nombre || ""}
                      />

                      <AppInput
                        autoCapitalize="words"
                        label="Provincia"
                        labelStyle={styles.centeredLabel}
                        onChangeText={(value) =>
                          handleComplejoLocalidadChange(index, "provincia", value)
                        }
                        placeholder="Ej. Córdoba"
                        value={complex.localidad?.provincia || ""}
                      />

                      <View style={styles.locationStatusRow}>
                        <Text
                          style={[
                            styles.locationStatusText,
                            complex.coordinates ? styles.locationStatusTextReady : null,
                          ]}
                        >
                          {complex.coordinates
                            ? "Ubicacion exacta cargada"
                            : "Ubicacion exacta pendiente"}
                        </Text>
                        <Pressable
                          disabled={locatingComplexIndex !== null}
                          onPress={() => handleSetComplexCurrentLocation(index)}
                          style={[
                            styles.locationButton,
                            locatingComplexIndex === index ? styles.locationButtonDisabled : null,
                          ]}
                        >
                          <Text style={styles.locationButtonText}>
                            {locatingComplexIndex === index ? "Buscando..." : "Usar ubicacion actual"}
                          </Text>
                        </Pressable>
                      </View>

                      <View style={styles.totalCard}>
                        <Text style={styles.totalLabel}>Total de canchas</Text>
                        <Text style={styles.totalValue}>{complex.totalCanchas}</Text>
                      </View>

                      {(complex.canchas || []).map((court, courtIndex) => (
                        <View key={court.id || `court-${courtIndex}`} style={styles.courtFormCard}>
                          <View style={styles.courtFormHeader}>
                            <Text style={styles.courtFormTitle}>Cancha {courtIndex + 1}</Text>
                            {(complex.canchas || []).length > 1 ? (
                              <Pressable onPress={() => removeCourt(index, courtIndex)}>
                                <Text style={styles.removeText}>Quitar</Text>
                              </Pressable>
                            ) : null}
                          </View>

                          <AppInput
                            autoCapitalize="characters"
                            label="Nombre de cancha (opcional)"
                            labelStyle={styles.centeredLabel}
                            onChangeText={(value) =>
                              handleCourtChange(index, courtIndex, "nombre", value)
                            }
                            placeholder={`Cancha ${courtIndex + 1}`}
                            value={court.nombre}
                          />

                          <Text style={styles.centeredLabelText}>Tipo de cancha</Text>
                          <View style={styles.optionRow}>
                            {COURT_STRUCTURE_OPTIONS.map((option) => {
                              const isSelected = court.estructura === option.key;

                              return (
                                <Pressable
                                  key={option.key}
                                  onPress={() =>
                                    handleCourtChange(index, courtIndex, "estructura", option.key)
                                  }
                                  style={[
                                    styles.environmentOption,
                                    isSelected ? styles.environmentOptionActive : null,
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.environmentOptionText,
                                      isSelected ? styles.environmentOptionTextActive : null,
                                    ]}
                                  >
                                    {option.label}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>

                          <Text style={styles.centeredLabelText}>Tipo de piso</Text>
                          <View style={styles.optionRow}>
                            {COURT_FLOOR_OPTIONS.map((option) => {
                              const isSelected = court.piso === option.key;

                              return (
                                <Pressable
                                  key={option.key}
                                  onPress={() =>
                                    handleCourtChange(index, courtIndex, "piso", option.key)
                                  }
                                  style={[
                                    styles.environmentOption,
                                    isSelected ? styles.environmentOptionActive : null,
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.environmentOptionText,
                                      isSelected ? styles.environmentOptionTextActive : null,
                                    ]}
                                  >
                                    {option.label}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>

                          <Text style={styles.centeredLabelText}>Ambiente</Text>
                          <View style={styles.optionRow}>
                            {COURT_ENVIRONMENT_OPTIONS.map((option) => {
                              const isSelected = court.ambiente === option.key;

                              return (
                                <Pressable
                                  key={option.key}
                                  onPress={() =>
                                    handleCourtChange(index, courtIndex, "ambiente", option.key)
                                  }
                                  style={[
                                    styles.environmentOption,
                                    isSelected ? styles.environmentOptionActive : null,
                                  ]}
                                >
                                  <Text
                                    style={[
                                      styles.environmentOptionText,
                                      isSelected ? styles.environmentOptionTextActive : null,
                                    ]}
                                  >
                                    {option.label}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        </View>
                      ))}

                      <AppButton
                        title="Agregar cancha"
                        onPress={() => addCourt(index)}
                        style={styles.addCourtButton}
                        variant="secondary"
                      />
                    </>
                  ) : null}
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
  complexSummary: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  removeText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "700",
  },
  courtFormCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: spacing.sm,
    padding: spacing.sm,
  },
  courtFormHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },
  courtFormTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  totalCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 18,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  locationStatusRow: {
    alignItems: "center",
    backgroundColor: "#F6FBF8",
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.sm,
    marginTop: -spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  locationStatusText: {
    color: colors.muted,
    flex: 1,
    fontSize: 12,
    fontWeight: "800",
  },
  locationStatusTextReady: {
    color: colors.primaryDark,
  },
  locationButton: {
    backgroundColor: colors.primaryDark,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  locationButtonDisabled: {
    opacity: 0.65,
  },
  locationButtonText: {
    color: colors.surface,
    fontSize: 10,
    fontWeight: "900",
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
  addCourtButton: {
    marginBottom: spacing.sm,
    minHeight: 42,
    paddingVertical: 10,
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
  centeredLabelText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    marginBottom: spacing.xs,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  optionRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  environmentOption: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  environmentOptionActive: {
    backgroundColor: "#E5F7EE",
    borderColor: "#91D7B2",
  },
  environmentOptionText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
  },
  environmentOptionTextActive: {
    color: "#1E6B45",
  },
});

