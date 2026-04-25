import { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import AppButton from "../components/AppButton";
import AppInput from "../components/AppInput";
import FeedbackModal from "../components/FeedbackModal";
import SectionHeader from "../components/SectionHeader";
import SelectField from "../components/SelectField";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import { isApprovedOrganizer } from "../services/roleService";
import {
  createMultipleTournaments,
  createTournament,
  TOURNAMENT_BUILD_MODE_OPTIONS,
  TOURNAMENT_GROUP_SIZE_OPTIONS,
  TOURNAMENT_PAIR_CONFIRMATION_OPTIONS,
} from "../services/tournamentsService";
import {
  LEAGUE_BRANCH_OPTIONS,
  LEAGUE_CATEGORY_OPTIONS,
  LEAGUE_SUM_TARGET_OPTIONS,
} from "../services/leaguesService";
import { createEmptyComplex, normalizeComplex } from "../services/organizerService";

const CREATION_MODE_OPTIONS = [
  {
    label: "Crear uno",
    value: "single",
    description: "Crea un torneo independiente.",
  },
  {
    label: "Crear varios",
    value: "multiple",
    description: "Crea varios torneos iguales en una sola accion.",
  },
];

const CATEGORY_MODE_OPTIONS = [
  {
    label: "Categoria unica",
    value: "single",
    description: "Una categoria fija para toda la pareja.",
  },
  {
    label: "Suma fija",
    value: "sum_fixed",
    description: "Suma con combinacion exacta.",
  },
  {
    label: "Suma libre",
    value: "sum_open",
    description: "Suma abierta dentro del objetivo.",
  },
];

const VENUE_MODE_OPTIONS = [
  {
    label: "Sede unica",
    value: "single",
    description: "Usa una sede principal.",
  },
  {
    label: "Multiples sedes",
    value: "multiple",
    description: "Permite mas de un lugar de juego.",
  },
];

const PLAY_DAY_OPTIONS = [
  { label: "Lunes", value: "monday" },
  { label: "Martes", value: "tuesday" },
  { label: "Miercoles", value: "wednesday" },
  { label: "Jueves", value: "thursday" },
  { label: "Viernes", value: "friday" },
  { label: "Sabado", value: "saturday" },
  { label: "Domingo", value: "sunday" },
];

function sanitizeInteger(value, maxLength = 2) {
  return String(value || "")
    .replace(/[^0-9]/g, "")
    .slice(0, maxLength);
}

function sanitizeDecimal(value) {
  const normalized = String(value || "").replace(",", ".").replace(/[^0-9.]/g, "");
  const [integerPart = "", ...decimalParts] = normalized.split(".");
  const decimalPart = decimalParts.join("");

  if (!normalized.includes(".")) {
    return integerPart;
  }

  return `${integerPart || "0"}.${decimalPart.slice(0, 2)}`;
}

function getCategoryModeValue(form) {
  if (form.categoryFormat !== "suma") {
    return "single";
  }

  return form.sumRule === "fixed" ? "sum_fixed" : "sum_open";
}

function buildInitialForm(userData = {}) {
  const firstComplex = Array.isArray(userData?.complejos) ? userData.complejos[0] : null;

  return {
    creationMode: "single",
    quantity: "2",
    name: "",
    description: "",
    venueMode: "single",
    selectedVenueNames: firstComplex?.nombre ? [firstComplex.nombre] : [],
    entryFee: "",
    paymentAlias: "",
    branch: "Masculino",
    categoryFormat: "libre",
    sumRule: "open",
    sumTarget: "",
    fixedCategoryA: "",
    fixedCategoryB: "",
    pairConfirmationMode: "both_paid",
    buildMode: "automatic",
    recommendedGroupSize: 3,
    groupStageDays: [],
    knockoutDays: [],
  };
}

function buildSelectedVenueEntries(complejos = [], selectedVenueNames = []) {
  return complejos
    .filter((complex) => selectedVenueNames.includes(complex.nombre))
    .map((complex, index) => ({
      id: complex.id || complex.nombre || `complex-${index + 1}`,
      name: complex.nombre,
      address: complex.direccion || "",
      city: complex.ciudad || complex.localidad?.nombre || "",
      province: complex.provincia || complex.localidad?.provincia || "",
      complexId: complex.id || "",
    }));
}

function buildPayloadFromForm(form, organizer, allVenues = []) {
  const categoryMode = getCategoryModeValue(form);
  const selectedVenues = buildSelectedVenueEntries(allVenues, form.selectedVenueNames);
  const playDays = [...new Set([...(form.groupStageDays || []), ...(form.knockoutDays || [])])];

  return {
    organizerId: organizer?.uid || "",
    organizerName: organizer?.name || "Organizador",
    name: String(form.name || "").trim(),
    description: String(form.description || "").trim(),
    venueMode: form.venueMode,
    venues: selectedVenues,
    temporaryVenues: [],
    branch: form.branch,
    categoryFormat: categoryMode === "single" ? "libre" : "suma",
    sumRule: categoryMode === "sum_fixed" ? "fixed" : "open",
    sumTarget: categoryMode === "single" ? "" : form.sumTarget,
    fixedCategoryA: form.fixedCategoryA,
    fixedCategoryB: categoryMode === "sum_fixed" ? form.fixedCategoryB : "",
    pairConfirmationMode: form.pairConfirmationMode,
    paymentMethods: Number(form.entryFee || 0) > 0 ? ["transferencia"] : [],
    paymentAlias: String(form.paymentAlias || "").trim(),
    entryFee: Number.parseFloat(form.entryFee || "0") || 0,
    playDays,
    groupStageDays: form.groupStageDays,
    knockoutDays: form.knockoutDays,
    buildMode: form.buildMode,
    recommendedGroupSize: Number(form.recommendedGroupSize || 3),
    allowManualCorrection: true,
    tournamentFormat: "groups_knockout",
    matchFormat: "best_of_3",
    thirdSetMode: "super_tiebreak",
    status: "draft",
    registrationStatus: "closed",
    maxPairs: 16,
    minPairs: 4,
  };
}

function buildMultipleTournamentPayloads(basePayload, quantity) {
  return Array.from({ length: quantity }, (_, index) => ({
    ...basePayload,
    name: `${basePayload.name} ${index + 1}`,
  }));
}

function ToggleCard({ active, description, label, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.toggleCard, active && styles.toggleCardActive]}>
      <Text style={[styles.toggleCardTitle, active && styles.toggleCardTitleActive]}>{label}</Text>
      <Text style={[styles.toggleCardDescription, active && styles.toggleCardDescriptionActive]}>
        {description}
      </Text>
    </Pressable>
  );
}

function ChipGroup({ onToggle, options, selectedValues }) {
  return (
    <View style={styles.chipRow}>
      {options.map((option) => {
        const isActive = selectedValues.includes(option.value);

        return (
          <Pressable
            key={option.value}
            onPress={() => onToggle(option.value)}
            style={[styles.chip, isActive && styles.chipActive]}
          >
            <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function VenueChip({ active, label, onPress, tint = "default" }) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.venueChip,
        active && styles.venueChipActive,
        tint === "temporary" ? styles.venueChipTemporary : null,
        active && tint === "temporary" ? styles.venueChipTemporaryActive : null,
      ]}
    >
      <Text
        style={[
          styles.venueChipText,
          active && styles.venueChipTextActive,
          tint === "temporary" ? styles.venueChipTemporaryText : null,
          active && tint === "temporary" ? styles.venueChipTemporaryTextActive : null,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function TemporaryComplexModal({
  onClose,
  onSave,
  saving,
  setTemporaryComplex,
  temporaryComplex,
  visible,
}) {
  const updateComplexField = (field, value) => {
    setTemporaryComplex((current) => ({
      ...current,
      [field]: value,
    }));
  };

  return (
    <Modal animationType="slide" transparent visible={visible}>
      <View style={styles.modalOverlay}>
        <Pressable onPress={onClose} style={styles.modalBackdrop} />
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Agregar lugar temporal</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            <AppInput
              label="Nombre del complejo"
              labelStyle={styles.centeredFieldLabel}
              onChangeText={(value) => updateComplexField("nombre", value)}
              placeholder="Nombre del complejo"
              value={temporaryComplex.nombre}
            />
            <AppInput
              keyboardType="number-pad"
              label="Canchas blindex"
              labelStyle={styles.centeredFieldLabel}
              onChangeText={(value) => updateComplexField("blindex", sanitizeInteger(value))}
              placeholder="0"
              value={String(temporaryComplex.blindex || "")}
            />
            <AppInput
              keyboardType="number-pad"
              label="Canchas de cesped"
              labelStyle={styles.centeredFieldLabel}
              onChangeText={(value) => updateComplexField("cesped", sanitizeInteger(value))}
              placeholder="0"
              value={String(temporaryComplex.cesped || "")}
            />
            <AppInput
              keyboardType="number-pad"
              label="Canchas de cemento"
              labelStyle={styles.centeredFieldLabel}
              onChangeText={(value) => updateComplexField("cemento", sanitizeInteger(value))}
              placeholder="0"
              value={String(temporaryComplex.cemento || "")}
            />
            <AppInput
              label="Direccion"
              labelStyle={styles.centeredFieldLabel}
              onChangeText={(value) => updateComplexField("direccion", value)}
              placeholder="Direccion"
              value={temporaryComplex.direccion}
            />
            <AppButton
              disabled={saving}
              onPress={onSave}
              title={saving ? "GUARDANDO..." : "GUARDAR LUGAR"}
            />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export default function CreateTournamentScreen({ navigation }) {
  const { updateProfile, userData } = useAuth();
  const [form, setForm] = useState(() => buildInitialForm(userData));
  const [submitting, setSubmitting] = useState(false);
  const [savingTemporaryComplex, setSavingTemporaryComplex] = useState(false);
  const [feedback, setFeedback] = useState({
    visible: false,
    title: "",
    message: "",
    tone: "default",
  });
  const [branchVisible, setBranchVisible] = useState(false);
  const [sumTargetVisible, setSumTargetVisible] = useState(false);
  const [categoryAVisible, setCategoryAVisible] = useState(false);
  const [categoryBVisible, setCategoryBVisible] = useState(false);
  const [temporaryComplexVisible, setTemporaryComplexVisible] = useState(false);
  const [temporaryComplex, setTemporaryComplex] = useState(() => createEmptyComplex());

  const canCreateTournament = isApprovedOrganizer(userData);
  const organizerComplexes = Array.isArray(userData?.complejos) ? userData.complejos : [];
  const tournamentComplexes = Array.isArray(userData?.tournamentComplexes)
    ? userData.tournamentComplexes
    : [];
  const allVenueOptions = useMemo(
    () => [...organizerComplexes, ...tournamentComplexes],
    [organizerComplexes, tournamentComplexes]
  );
  const categoryMode = getCategoryModeValue(form);

  const filteredFirstCategoryOptions = useMemo(() => {
    if (categoryMode !== "sum_fixed" || !form.sumTarget) {
      return LEAGUE_CATEGORY_OPTIONS;
    }

    const targetValue = Number.parseInt(form.sumTarget, 10);

    return LEAGUE_CATEGORY_OPTIONS.filter((option) => {
      const complement = targetValue - option.numericValue;

      return LEAGUE_CATEGORY_OPTIONS.some((candidate) => candidate.numericValue === complement);
    });
  }, [categoryMode, form.sumTarget]);

  const filteredSecondCategoryOptions = useMemo(() => {
    if (categoryMode !== "sum_fixed" || !form.sumTarget || !form.fixedCategoryA) {
      return LEAGUE_CATEGORY_OPTIONS;
    }

    const firstCategory = LEAGUE_CATEGORY_OPTIONS.find(
      (option) => option.value === form.fixedCategoryA
    );
    const targetValue = Number.parseInt(form.sumTarget, 10);

    if (!firstCategory || Number.isNaN(targetValue)) {
      return LEAGUE_CATEGORY_OPTIONS;
    }

    const complement = targetValue - firstCategory.numericValue;
    return LEAGUE_CATEGORY_OPTIONS.filter((option) => option.numericValue === complement);
  }, [categoryMode, form.fixedCategoryA, form.sumTarget]);

  const selectedVenueNames = useMemo(
    () => new Set(form.selectedVenueNames),
    [form.selectedVenueNames]
  );

  const multiplePreviewNames = useMemo(() => {
    const quantity = Math.max(Number.parseInt(form.quantity || "0", 10) || 0, 0);

    if (form.creationMode !== "multiple" || !form.name.trim() || quantity < 2) {
      return [];
    }

    return buildMultipleTournamentPayloads({ name: form.name.trim() }, quantity).map(
      (item) => item.name
    );
  }, [form.creationMode, form.name, form.quantity]);

  const updateField = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const toggleDay = (field, dayKey, maxItems = 3) => {
    setForm((current) => {
      const currentValues = Array.isArray(current[field]) ? current[field] : [];
      const nextValues = currentValues.includes(dayKey)
        ? currentValues.filter((value) => value !== dayKey)
        : currentValues.length < maxItems
        ? [...currentValues, dayKey]
        : currentValues;

      return {
        ...current,
        [field]: nextValues,
      };
    });
  };

  const toggleVenueSelection = (venueName) => {
    setForm((current) => {
      const selected = Array.isArray(current.selectedVenueNames) ? current.selectedVenueNames : [];

      return {
        ...current,
        selectedVenueNames: selected.includes(venueName)
          ? selected.filter((value) => value !== venueName)
          : current.venueMode === "single"
          ? [venueName]
          : [...selected, venueName],
      };
    });
  };

  const showFeedback = (title, message, tone = "default") => {
    setFeedback({
      visible: true,
      title,
      message,
      tone,
    });
  };

  const validateTemporaryComplex = () => {
    const normalized = normalizeComplex(temporaryComplex);

    if (!normalized.nombre) {
      return "Escribe el nombre del complejo temporal.";
    }

    if (!normalized.totalCanchas) {
      return "Carga al menos una cancha para guardar el lugar.";
    }

    return "";
  };

  const handleSaveTemporaryComplex = async () => {
    const validationMessage = validateTemporaryComplex();

    if (validationMessage) {
      showFeedback("Faltan datos", validationMessage, "danger");
      return;
    }

    try {
      setSavingTemporaryComplex(true);
      const normalized = normalizeComplex(temporaryComplex);
      const currentTournamentComplexes = Array.isArray(userData?.tournamentComplexes)
        ? userData.tournamentComplexes.map(normalizeComplex)
        : [];
      const alreadyExists = currentTournamentComplexes.some(
        (complex) => complex.nombre.toLowerCase() === normalized.nombre.toLowerCase()
      );
      const nextTournamentComplexes = alreadyExists
        ? currentTournamentComplexes.map((complex) =>
            complex.nombre.toLowerCase() === normalized.nombre.toLowerCase() ? normalized : complex
          )
        : [...currentTournamentComplexes, normalized];

      await updateProfile({
        tournamentComplexes: nextTournamentComplexes,
      });

      setForm((current) => ({
        ...current,
        selectedVenueNames:
          current.venueMode === "single"
            ? [normalized.nombre]
            : current.selectedVenueNames.includes(normalized.nombre)
            ? current.selectedVenueNames
            : [...current.selectedVenueNames, normalized.nombre],
      }));
      setTemporaryComplex(createEmptyComplex());
      setTemporaryComplexVisible(false);
      showFeedback(
        "Lugar guardado",
        "El complejo temporal ya quedo disponible para futuros torneos.",
        "success"
      );
    } catch (error) {
      showFeedback(
        "No pudimos guardar el lugar",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setSavingTemporaryComplex(false);
    }
  };

  const validateForm = () => {
    if (!form.name.trim()) {
      return "Escribe el nombre del torneo.";
    }

    if (!form.selectedVenueNames.length) {
      return "Selecciona al menos un lugar de juego.";
    }

    if (!form.fixedCategoryA) {
      return "Selecciona al menos una categoria.";
    }

    if (categoryMode !== "single" && !form.sumTarget) {
      return "Selecciona la suma objetivo del torneo.";
    }

    if (categoryMode === "sum_fixed" && !form.fixedCategoryB) {
      return "Selecciona la segunda categoria de la suma fija.";
    }

    if (!form.groupStageDays.length) {
      return "Selecciona al menos un dia para jugar zonas.";
    }

    if (!form.knockoutDays.length) {
      return "Selecciona al menos un dia para jugar llaves y cruces.";
    }

    if (Number(form.entryFee || 0) > 0 && !String(form.paymentAlias || "").trim()) {
      return "Si el torneo cobra inscripcion, necesitamos el alias de transferencia.";
    }

    if (form.creationMode === "multiple") {
      const quantity = Number.parseInt(form.quantity || "0", 10) || 0;

      if (quantity < 2) {
        return "Para crear varios torneos, la cantidad debe ser de al menos 2.";
      }
    }

    return "";
  };

  const handleSubmit = async () => {
    if (!canCreateTournament) {
      showFeedback(
        "Acceso restringido",
        "Solo los perfiles organizadores pueden crear torneos.",
        "danger"
      );
      return;
    }

    const validationMessage = validateForm();

    if (validationMessage) {
      showFeedback("Faltan datos", validationMessage, "danger");
      return;
    }

    try {
      setSubmitting(true);

      const organizer = {
        uid: userData?.uid || "",
        name: userData?.name || "Organizador",
      };
      const basePayload = buildPayloadFromForm(form, organizer, allVenueOptions);

      if (form.creationMode === "multiple") {
        const quantity = Number.parseInt(form.quantity || "0", 10) || 0;
        await createMultipleTournaments(
          organizer,
          buildMultipleTournamentPayloads(basePayload, quantity)
        );
      } else {
        await createTournament(organizer, basePayload);
      }

      navigation.navigate("Torneos");
    } catch (error) {
      showFeedback(
        "No pudimos crear el torneo",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!canCreateTournament) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <SectionHeader onBack={() => navigation.goBack()} subtitle="Crear torneo" />
        <View style={styles.restrictedWrap}>
          <Text style={styles.restrictedTitle}>Acceso restringido</Text>
          <Text style={styles.restrictedText}>
            Esta pantalla esta disponible solo para perfiles organizadores.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader onBack={() => navigation.goBack()} subtitle="Crear torneo" />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>MODO DE ARMADO</Text>
          <View style={styles.toggleGrid}>
            {CREATION_MODE_OPTIONS.map((option) => (
              <ToggleCard
                key={option.value}
                active={form.creationMode === option.value}
                description={option.description}
                label={option.label}
                onPress={() => updateField("creationMode", option.value)}
              />
            ))}
          </View>

          {form.creationMode === "multiple" ? (
            <AppInput
              keyboardType="number-pad"
              label="Cantidad de torneos"
              labelStyle={styles.centeredFieldLabel}
              onChangeText={(value) => updateField("quantity", sanitizeInteger(value))}
              placeholder="2"
              value={form.quantity}
            />
          ) : null}
        </View>

        <View style={styles.sectionCard}>
          <AppInput
            label={form.creationMode === "multiple" ? "Nombre base" : "Nombre del torneo"}
            labelStyle={styles.centeredFieldLabel}
            onChangeText={(value) => updateField("name", value)}
            placeholder={
              form.creationMode === "multiple" ? "Torneo Apertura" : "Torneo de invierno"
            }
            value={form.name}
          />
          <AppInput
            label="Descripcion"
            labelStyle={styles.centeredFieldLabel}
            multiline
            numberOfLines={4}
            onChangeText={(value) => updateField("description", value)}
            placeholder="Detalle breve para que los jugadores entiendan de que se trata."
            value={form.description}
          />

          {multiplePreviewNames.length ? (
            <View style={styles.previewCard}>
              <Text style={styles.previewTitle}>Se van a crear</Text>
              {multiplePreviewNames.map((name) => (
                <Text key={name} style={styles.previewItem}>
                  {name}
                </Text>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>SELECCIONAR LUGARES DE JUEGO</Text>
          <View style={styles.toggleGrid}>
            {VENUE_MODE_OPTIONS.map((option) => (
              <ToggleCard
                key={option.value}
                active={form.venueMode === option.value}
                description={option.description}
                label={option.label}
                onPress={() =>
                  setForm((current) => ({
                    ...current,
                    selectedVenueNames:
                      option.value === "single"
                        ? current.selectedVenueNames.slice(0, 1)
                        : current.selectedVenueNames,
                    venueMode: option.value,
                  }))
                }
              />
            ))}
          </View>

          <Text style={styles.inputLabel}>Complejos aprobados</Text>
          <View style={styles.chipRow}>
            {organizerComplexes.map((complex) => (
              <VenueChip
                key={`main-${complex.nombre}`}
                active={selectedVenueNames.has(complex.nombre)}
                label={complex.nombre}
                onPress={() => toggleVenueSelection(complex.nombre)}
              />
            ))}
          </View>

          <Text style={[styles.inputLabel, styles.secondLabel]}>Lugares temporales</Text>
          <View style={styles.chipRow}>
            {tournamentComplexes.map((complex) => (
              <VenueChip
                key={`temporary-${complex.nombre}`}
                active={selectedVenueNames.has(complex.nombre)}
                label={complex.nombre}
                onPress={() => toggleVenueSelection(complex.nombre)}
                tint="temporary"
              />
            ))}
          </View>

          <AppButton
            onPress={() => {
              setTemporaryComplex(createEmptyComplex());
              setTemporaryComplexVisible(true);
            }}
            style={styles.sectionButton}
            title="AGREGAR LUGAR TEMPORAL"
            variant="secondary"
          />
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>SELECCIONE CATEGORIAS</Text>
          <SelectField
            label="Sexo"
            labelStyle={styles.centeredFieldLabel}
            onClose={() => setBranchVisible(false)}
            onOpen={() => setBranchVisible(true)}
            onSelect={(value) => updateField("branch", value)}
            options={LEAGUE_BRANCH_OPTIONS.map((option) => ({
              ...option,
              label: option.value === "Masculino" ? "Caballeros" : option.label,
            }))}
            placeholder="Seleccionar sexo"
            value={form.branch}
            visible={branchVisible}
          />

          <View style={styles.toggleGrid}>
            {CATEGORY_MODE_OPTIONS.map((option) => (
              <ToggleCard
                key={option.value}
                active={categoryMode === option.value}
                description={option.description}
                label={option.label}
                onPress={() =>
                  setForm((current) => ({
                    ...current,
                    categoryFormat: option.value === "single" ? "libre" : "suma",
                    sumRule: option.value === "sum_fixed" ? "fixed" : "open",
                    sumTarget: option.value === "single" ? "" : current.sumTarget,
                    fixedCategoryB: option.value === "sum_fixed" ? current.fixedCategoryB : "",
                  }))
                }
              />
            ))}
          </View>

          {categoryMode !== "single" ? (
            <SelectField
              label="Suma"
              labelStyle={styles.centeredFieldLabel}
              onClose={() => setSumTargetVisible(false)}
              onOpen={() => setSumTargetVisible(true)}
              onSelect={(value) => updateField("sumTarget", value)}
              options={LEAGUE_SUM_TARGET_OPTIONS}
              placeholder="Seleccionar suma"
              value={form.sumTarget}
              visible={sumTargetVisible}
            />
          ) : null}

          <SelectField
            label={categoryMode === "single" ? "Categoria" : "Categoria A"}
            labelStyle={styles.centeredFieldLabel}
            onClose={() => setCategoryAVisible(false)}
            onOpen={() => setCategoryAVisible(true)}
            onSelect={(value) => updateField("fixedCategoryA", value)}
            options={filteredFirstCategoryOptions}
            placeholder="Seleccionar categoria"
            value={form.fixedCategoryA}
            visible={categoryAVisible}
          />

          {categoryMode === "sum_fixed" ? (
            <SelectField
              label="Categoria B"
              labelStyle={styles.centeredFieldLabel}
              onClose={() => setCategoryBVisible(false)}
              onOpen={() => setCategoryBVisible(true)}
              onSelect={(value) => updateField("fixedCategoryB", value)}
              options={filteredSecondCategoryOptions}
              placeholder="Seleccionar categoria"
              value={form.fixedCategoryB}
              visible={categoryBVisible}
            />
          ) : null}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>DEFINIR COSTO Y MODALIDAD</Text>

          <Text style={styles.inputLabel}>CONFIRMAR INSCRIPCION</Text>
          <View style={styles.toggleList}>
            {TOURNAMENT_PAIR_CONFIRMATION_OPTIONS.map((option) => (
              <ToggleCard
                key={option.value}
                active={form.pairConfirmationMode === option.value}
                description={
                  option.value === "both_paid"
                    ? "La pareja se confirma cuando se aprueban los pagos de ambos."
                    : option.value === "one_paid"
                    ? "La pareja se confirma cuando se aprueba el pago de uno de los dos."
                    : "El organizador confirma manualmente la inscripcion."
                }
                label={
                  option.value === "both_paid"
                    ? "PAGO DE AMBOS JUGADORES"
                    : option.value === "one_paid"
                    ? "PAGO DE UNO DE LOS 2 JUGADORES"
                    : "CONFIRMACION MANUAL"
                }
                onPress={() => updateField("pairConfirmationMode", option.value)}
              />
            ))}
          </View>

          <AppInput
            keyboardType="decimal-pad"
            label="Costo por jugador"
            labelStyle={styles.centeredFieldLabel}
            onChangeText={(value) => updateField("entryFee", sanitizeDecimal(value))}
            placeholder="0"
            value={form.entryFee}
          />
          <AppInput
            label="Alias de transferencia"
            labelStyle={styles.centeredFieldLabel}
            onChangeText={(value) => updateField("paymentAlias", value)}
            placeholder="padelnexo.torneo"
            value={form.paymentAlias}
          />
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>DIAS DE JUEGO</Text>

          <Text style={styles.inputLabel}>Dias para jugar zonas</Text>
          <ChipGroup
            onToggle={(dayKey) => toggleDay("groupStageDays", dayKey, 2)}
            options={PLAY_DAY_OPTIONS}
            selectedValues={form.groupStageDays}
          />

          <Text style={[styles.inputLabel, styles.secondLabel]}>
            Dias para jugar llaves y cruces
          </Text>
          <ChipGroup
            onToggle={(dayKey) => toggleDay("knockoutDays", dayKey, 3)}
            options={PLAY_DAY_OPTIONS}
            selectedValues={form.knockoutDays}
          />

          <Text style={[styles.inputLabel, styles.secondLabel]}>Modo de armado</Text>
          <View style={styles.toggleGrid}>
            {TOURNAMENT_BUILD_MODE_OPTIONS.map((option) => (
              <ToggleCard
                key={option.value}
                active={form.buildMode === option.value}
                description={
                  option.value === "automatic"
                    ? "Prioriza compatibilidad horaria."
                    : "Permite definir grupos a mano."
                }
                label={option.label}
                onPress={() => updateField("buildMode", option.value)}
              />
            ))}
          </View>

          <Text style={[styles.inputLabel, styles.secondLabel]}>
            CANTIDAD DE PAREJAS POR ZONA
          </Text>
          <View style={styles.chipRow}>
            {TOURNAMENT_GROUP_SIZE_OPTIONS.map((option) => {
              const isActive = Number(form.recommendedGroupSize) === Number(option.value);

              return (
                <Pressable
                  key={option.value}
                  onPress={() => updateField("recommendedGroupSize", option.value)}
                  style={[styles.chip, isActive && styles.chipActive]}
                >
                  <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <AppButton
          disabled={submitting}
          onPress={handleSubmit}
          title={
            submitting
              ? "GUARDANDO..."
              : form.creationMode === "multiple"
              ? "CREAR TORNEOS"
              : "CREAR TORNEO"
          }
        />
      </ScrollView>

      <TemporaryComplexModal
        onClose={() => setTemporaryComplexVisible(false)}
        onSave={handleSaveTemporaryComplex}
        saving={savingTemporaryComplex}
        setTemporaryComplex={setTemporaryComplex}
        temporaryComplex={temporaryComplex}
        visible={temporaryComplexVisible}
      />

      <FeedbackModal
        message={feedback.message}
        onClose={() => setFeedback((current) => ({ ...current, visible: false }))}
        tone={feedback.tone}
        title={feedback.title}
        visible={feedback.visible}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  restrictedWrap: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  restrictedTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "900",
    textAlign: "center",
  },
  restrictedText: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 22,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  sectionCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "900",
    marginBottom: spacing.sm,
    textAlign: "center",
    textTransform: "uppercase",
  },
  centeredFieldLabel: {
    textAlign: "center",
  },
  toggleGrid: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  toggleList: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  toggleCard: {
    backgroundColor: "#F4FAF7",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  toggleCardActive: {
    backgroundColor: "#E8F5EE",
    borderColor: colors.primaryLight,
  },
  toggleCardTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
    textTransform: "uppercase",
  },
  toggleCardTitleActive: {
    color: colors.primaryDark,
  },
  toggleCardDescription: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 18,
    marginTop: 4,
    textAlign: "center",
  },
  toggleCardDescriptionActive: {
    color: colors.primaryDark,
  },
  previewCard: {
    backgroundColor: "#F4FAF7",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  previewTitle: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
    marginBottom: spacing.xs,
    textAlign: "center",
    textTransform: "uppercase",
  },
  previewItem: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 20,
    textAlign: "center",
  },
  inputLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
    marginBottom: spacing.xs,
    textAlign: "center",
  },
  secondLabel: {
    marginTop: spacing.sm,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "center",
  },
  chip: {
    backgroundColor: "#EFF6F2",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: spacing.md,
  },
  chipActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  chipText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
    textTransform: "uppercase",
  },
  chipTextActive: {
    color: colors.surface,
  },
  venueChip: {
    backgroundColor: "#EEF6F2",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: spacing.md,
  },
  venueChipActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  venueChipTemporary: {
    backgroundColor: "#F4F2FF",
    borderColor: "#D9D1FF",
  },
  venueChipTemporaryActive: {
    backgroundColor: "#6751B6",
    borderColor: "#6751B6",
  },
  venueChipText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  venueChipTextActive: {
    color: colors.surface,
  },
  venueChipTemporaryText: {
    color: "#6751B6",
  },
  venueChipTemporaryTextActive: {
    color: colors.surface,
  },
  sectionButton: {
    marginBottom: 0,
    marginTop: spacing.md,
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
    maxHeight: "82%",
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "900",
    marginBottom: spacing.md,
    textAlign: "center",
  },
});

