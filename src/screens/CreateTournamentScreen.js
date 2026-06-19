import { useEffect, useMemo, useState } from "react";
import {
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";

import AppButton from "../components/AppButton";
import AppInput from "../components/AppInput";
import FeedbackModal from "../components/FeedbackModal";
import SectionHeader from "../components/SectionHeader";
import SelectField from "../components/SelectField";
import { canAccessAdminPanel } from "../config/admin";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import {
  buildPublicationMercadoPagoConfig,
  normalizeMercadoPagoConfig,
} from "../services/mercadoPagoConfigService";
import { isApprovedOrganizer } from "../services/roleService";
import {
  createMultipleTournaments,
  createTournament,
  TOURNAMENT_BUILD_MODE_OPTIONS,
  TOURNAMENT_GROUP_SIZE_OPTIONS,
  TOURNAMENT_PAIR_CONFIRMATION_OPTIONS,
  uploadTournamentCoverImage,
  updateTournament,
} from "../services/tournamentsService";
import {
  LEAGUE_BRANCH_OPTIONS,
  LEAGUE_CATEGORY_OPTIONS,
  LEAGUE_SUM_TARGET_OPTIONS,
} from "../services/leaguesService";
import { createEmptyComplex, normalizeComplex } from "../services/organizerService";
import { auth } from "../../services/firebaseConfig";

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

const TOURNAMENT_RULESET_OPTIONS = [
  {
    label: "TORNEO FAP",
    value: "fap",
    subtitle: "Federacion Argentina de Padel",
    description: "3 clasificados por zona de 4. Modalidad mas extensa.",
  },
  {
    label: "TORNEO APA",
    value: "apa",
    subtitle: "Asociacion Padel Argentina",
    description: "2 clasificados por zona de 4. Modalidad mas corta.",
  },
];

function sanitizeInteger(value, maxLength = 2) {
  return String(value || "")
    .replace(/[^0-9]/g, "")
    .slice(0, maxLength);
}

function sanitizeMoneyInput(value) {
  return String(value || "").replace(/[^0-9]/g, "");
}

function formatMoneyInput(value) {
  const digits = sanitizeMoneyInput(value);

  if (!digits) {
    return "";
  }

  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function parseMoneyInput(value) {
  const digits = sanitizeMoneyInput(value);
  return Number.parseInt(digits || "0", 10) || 0;
}

function getCategoryModeValue(form) {
  if (form.categoryFormat !== "suma") {
    return "single";
  }

  return form.sumRule === "fixed" ? "sum_fixed" : "sum_open";
}

function normalizeDateStartMillis(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function formatDateLabel(value) {
  if (!value) {
    return "Seleccionar fecha";
  }

  return new Date(value).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function buildInitialForm(userData = {}) {
  const firstComplex = Array.isArray(userData?.complejos) ? userData.complejos[0] : null;
  const fixtureDefaults = userData?.tournamentFixtureDefaults || {};

  return {
    creationMode: "single",
    quantity: "2",
    coverImage: "",
    name: "",
    description: "",
    venueMode: "single",
    selectedVenueNames: firstComplex?.nombre ? [firstComplex.nombre] : [],
    entryFee: "",
    paymentAlias: "",
    tournamentRuleSet: fixtureDefaults.tournamentRuleSet || "fap",
    branch: "Masculino",
    categoryFormat: "libre",
    sumRule: "open",
    sumTarget: "",
    fixedCategoryA: "",
    fixedCategoryB: "",
    pairConfirmationMode: "both_paid",
    buildMode: fixtureDefaults.mode || "automatic",
    recommendedGroupSize: 3,
    startDateMillis: "",
    endDateMillis: "",
    minPairs: "",
    maxPairs: "",
  };
}

function normalizeTournamentFixtureDefaults(defaults = {}) {
  const matchFormat = defaults?.matchFormat || {};
  const zones = ["third_set", "super_tiebreak", "single_set"].includes(matchFormat.zones)
    ? matchFormat.zones
    : "third_set";
  const bracket = ["third_set", "super_tiebreak", "single_set"].includes(matchFormat.bracket)
    ? matchFormat.bracket
    : "third_set";
  const zonesPoints = Math.max(
    1,
    Number.parseInt(String(matchFormat.zonesSuperTieBreakPoints || ""), 10) || (zones === "single_set" ? 9 : 11)
  );
  const bracketPoints = Math.max(
    1,
    Number.parseInt(String(matchFormat.bracketSuperTieBreakPoints || ""), 10) || (bracket === "single_set" ? 9 : 11)
  );
  const matchDurationMinutes = Math.max(
    15,
    Number.parseInt(String(defaults?.matchDurationMinutes || ""), 10) || 75
  );

  return {
    mode: defaults?.mode || "automatic",
    pathType: defaults?.pathType || "strict",
    manualBracketMode: defaults?.manualBracketMode || "automatic",
    matchDurationMinutes,
    matchFormat: {
      zones,
      bracket,
      zonesSuperTieBreakPoints: zonesPoints,
      bracketSuperTieBreakPoints: bracketPoints,
      bracketFinalStagesOverride:
        defaults?.matchFormat?.bracketFinalStagesOverride || "none",
    },
  };
}

function buildInitialMultipleConfig() {
  return {
    branch: "Masculino",
    categoryFormat: "libre",
    sumRule: "open",
    sumTarget: "",
    fixedCategoryA: "",
    fixedCategoryB: "",
  };
}

function getTournamentCategoryMode(config = {}) {
  if (config.categoryFormat !== "suma") {
    return "single";
  }

  return config.sumRule === "fixed" ? "sum_fixed" : "sum_open";
}

function buildCategorySuffix(config = {}) {
  const mode = getTournamentCategoryMode(config);

  if (mode === "single") {
    return String(config.fixedCategoryA || "").trim();
  }

  if (mode === "sum_fixed") {
    const categories = [config.fixedCategoryA, config.fixedCategoryB].filter(Boolean).join(" + ");
    return `Suma ${config.sumTarget}${categories ? ` ${categories}` : ""}`;
  }

  return config.sumTarget ? `Suma ${config.sumTarget}` : "Suma";
}

function buildTournamentNameWithCategory(baseName = "", config = {}) {
  const normalizedBaseName = String(baseName || "").trim();
  const suffix = buildCategorySuffix(config);

  if (!normalizedBaseName) {
    return suffix;
  }

  if (!suffix) {
    return normalizedBaseName;
  }

  return `${normalizedBaseName} ${suffix}`.trim();
}

function syncMultipleConfigs(currentConfigs = [], quantity = 0) {
  return Array.from({ length: quantity }, (_, index) => ({
    ...buildInitialMultipleConfig(),
    ...(currentConfigs[index] || {}),
  }));
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
      coordinates: complex.coordinates || complex.location || null,
      complexId: complex.id || "",
      totalCanchas: Number(complex.totalCanchas || 0) || 0,
      blindex: Number(complex.blindex || 0) || 0,
      cesped: Number(complex.cesped || 0) || 0,
      cemento: Number(complex.cemento || 0) || 0,
    }));
}

function buildPayloadFromForm(
  form,
  organizer,
  allVenues = [],
  categoryOverride = null,
  tournamentFixtureDefaults = null
) {
  const categorySource = categoryOverride || form;
  const categoryMode = categoryOverride
    ? getTournamentCategoryMode(categorySource)
    : getCategoryModeValue(form);
  const selectedVenues = buildSelectedVenueEntries(allVenues, form.selectedVenueNames);
  const startDateMillis = Number(form.startDateMillis || 0) || 0;
  const endDateMillis = Number(form.endDateMillis || 0) || 0;
  const maxPairs = Math.max(Number.parseInt(form.maxPairs || "0", 10) || 0, 2);
  const minPairs = Math.max(
    Math.min(Number.parseInt(form.minPairs || "0", 10) || 0, maxPairs),
    2
  );

  return {
    organizerId: organizer?.uid || "",
    organizerName: organizer?.name || "Organizador",
    coverImage: String(form.coverImage || "").trim(),
    name: String(form.name || "").trim(),
    description: String(form.description || "").trim(),
    venueMode: form.venueMode,
    venues: selectedVenues,
    temporaryVenues: [],
    branch: categorySource.branch,
    categoryFormat: categoryMode === "single" ? "libre" : "suma",
    sumRule: categoryMode === "sum_fixed" ? "fixed" : "open",
    sumTarget: categoryMode === "single" ? "" : categorySource.sumTarget,
    fixedCategoryA: categorySource.fixedCategoryA,
    fixedCategoryB: categoryMode === "sum_fixed" ? categorySource.fixedCategoryB : "",
    pairConfirmationMode: form.pairConfirmationMode,
    paymentMethods: parseMoneyInput(form.entryFee) > 0 ? ["transferencia"] : [],
    mercadoPagoConfig: form.mercadoPagoConfig || organizer?.mercadoPagoConfig || {},
    paymentAlias: String(form.paymentAlias || "").trim(),
    tournamentRuleSet: form.tournamentRuleSet || "fap",
    entryFee: parseMoneyInput(form.entryFee),
    playDays: [],
    groupStageDays: [],
    knockoutDays: [],
    startDateMillis,
    endDateMillis,
    buildMode: form.buildMode,
    recommendedGroupSize: Number(form.recommendedGroupSize || 3),
    allowManualCorrection: true,
    tournamentFormat: "groups_knockout",
    matchFormat: "best_of_3",
    thirdSetMode: "super_tiebreak",
    fixtureSetup: normalizeTournamentFixtureDefaults(tournamentFixtureDefaults || {}),
    status: "draft",
    registrationStatus: "closed",
    maxPairs,
    minPairs,
  };
}

function buildMultipleTournamentPayloads(basePayload, configs = []) {
  return configs.map((config) => ({
    ...basePayload,
    branch: config.branch,
    categoryFormat: config.categoryFormat,
    sumRule: config.sumRule,
    sumTarget: config.sumTarget,
    fixedCategoryA: config.fixedCategoryA,
    fixedCategoryB: config.fixedCategoryB,
    name: buildTournamentNameWithCategory(basePayload.name, config),
  }));
}

function buildFormFromTournament(tournament = {}, userData = {}) {
  const baseForm = buildInitialForm(userData);
  const composition = tournament?.compositionConfig || {};
  const selectedVenueNames = [
    ...(Array.isArray(tournament?.venues) ? tournament.venues : []),
    ...(Array.isArray(tournament?.temporaryVenues) ? tournament.temporaryVenues : []),
  ]
    .map((venue) => venue?.name || venue?.nombre || "")
    .filter(Boolean);

  return {
    ...baseForm,
    creationMode: "single",
    coverImage: tournament?.coverImage || "",
    name: tournament?.name || "",
    description: tournament?.description || "",
    venueMode: tournament?.venueMode || "single",
    selectedVenueNames,
    entryFee: tournament?.entryFee ? formatMoneyInput(tournament.entryFee) : "",
    paymentAlias: tournament?.paymentAlias || "",
    tournamentRuleSet: tournament?.tournamentRuleSet || tournament?.ruleSet || "fap",
    branch: composition.branch || "Masculino",
    categoryFormat: composition.categoryFormat || "libre",
    sumRule: composition.sumRule || "open",
    sumTarget: composition.sumTarget || "",
    fixedCategoryA: composition.fixedCategoryA || "",
    fixedCategoryB: composition.fixedCategoryB || "",
    pairConfirmationMode: tournament?.pairConfirmationMode || "both_paid",
    buildMode: tournament?.buildMode || "automatic",
    recommendedGroupSize: Number(tournament?.recommendedGroupSize || 3),
    startDateMillis: tournament?.startDateMillis || "",
    endDateMillis: tournament?.endDateMillis || "",
    minPairs: tournament?.minPairs ? String(tournament.minPairs) : "4",
    maxPairs: tournament?.maxPairs ? String(tournament.maxPairs) : "16",
  };
}

function buildComparableTournamentFormState(form = {}) {
  return {
    ...form,
    selectedVenueNames: [...(Array.isArray(form.selectedVenueNames) ? form.selectedVenueNames : [])].sort(),
  };
}

function ToggleCard({ active, compact = false, description, label, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.toggleCard,
        compact && styles.toggleCardCompact,
        active && styles.toggleCardActive,
      ]}
    >
      <Text
        style={[
          styles.toggleCardTitle,
          compact && styles.toggleCardTitleCompact,
          active && styles.toggleCardTitleActive,
        ]}
      >
        {label}
      </Text>
      <Text
        numberOfLines={compact ? 1 : undefined}
        style={[
          styles.toggleCardDescription,
          compact && styles.toggleCardDescriptionCompact,
          active && styles.toggleCardDescriptionActive,
        ]}
      >
        {description}
      </Text>
    </Pressable>
  );
}

function getPairConfirmationOptionMeta(value = "") {
  if (value === "both_paid") {
    return {
      description: "La pareja se confirma cuando se aprueban los pagos de ambos. (ESTRICTO)",
      label: "PAGO DE AMBOS JUGADORES",
    };
  }

  if (value === "one_paid") {
    return {
      description: "La pareja se confirma cuando se aprueba el pago de uno de los dos. (INTERMEDIO)",
      label: "PAGO DE UNO DE LOS 2 JUGADORES",
    };
  }

  return {
    description: "El organizador confirma manualmente la inscripcion. (FLEXIBLE)",
    label: "CONFIRMACION MANUAL",
  };
}

function getCategoryModeOptionMeta(value = "") {
  if (value === "sum_fixed") {
    return {
      description: "Suma con combinacion exacta.",
      label: "SUMA FIJA",
    };
  }

  if (value === "sum_open") {
    return {
      description: "Suma abierta dentro del objetivo.",
      label: "SUMA LIBRE",
    };
  }

  return {
    description: "Una categoria fija para toda la pareja.",
    label: "CATEGORIA UNICA",
  };
}

function getVenueModeOptionMeta(value = "") {
  if (value === "multiple") {
    return {
      description: "Permite mas de un lugar de juego.",
      label: "MULTIPLES SEDES",
    };
  }

  return {
    description: "Usa una sede principal.",
    label: "SEDE UNICA",
  };
}

function getCreationModeOptionMeta(value = "") {
  if (value === "multiple") {
    return {
      description: "Crea varios torneos iguales en una sola accion.",
      label: "CREAR VARIOS",
    };
  }

  return {
    description: "Crea un torneo independiente.",
    label: "CREAR UNO",
  };
}

function getTournamentRuleSetOptionMeta(value = "") {
  return (
    TOURNAMENT_RULESET_OPTIONS.find((option) => option.value === value) ||
    TOURNAMENT_RULESET_OPTIONS[0]
  );
}

function isLocalAssetUri(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return (
    normalized.startsWith("file:") ||
    normalized.startsWith("content:") ||
    normalized.startsWith("ph:")
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

export default function CreateTournamentScreen({ navigation, route }) {
  const { updateProfile, user, userData } = useAuth();
  const editingTournament = route?.params?.tournament || null;
  const isEditingDraft = Boolean(editingTournament?.id);
  const organizerMercadoPagoConfig = useMemo(
    () => normalizeMercadoPagoConfig(userData?.mercadoPagoConfig),
    [userData?.mercadoPagoConfig]
  );
  const tournamentMercadoPagoConfig = useMemo(
    () =>
      isEditingDraft
        ? {
            ...buildPublicationMercadoPagoConfig(organizerMercadoPagoConfig, "torneos"),
            ...(editingTournament?.mercadoPagoConfig || {}),
          }
        : buildPublicationMercadoPagoConfig(organizerMercadoPagoConfig, "torneos"),
    [editingTournament?.mercadoPagoConfig, isEditingDraft, organizerMercadoPagoConfig]
  );
  const returnToTournamentDetail = Boolean(route?.params?.returnToTournamentDetail);
  const [form, setForm] = useState(() =>
    isEditingDraft ? buildFormFromTournament(editingTournament, userData) : buildInitialForm(userData)
  );
  const [multipleConfigs, setMultipleConfigs] = useState(() => syncMultipleConfigs([], 2));
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
  const [multiplePickerState, setMultiplePickerState] = useState({
    field: "",
    index: -1,
  });
  const [temporaryComplexVisible, setTemporaryComplexVisible] = useState(false);
  const [temporaryComplex, setTemporaryComplex] = useState(() => createEmptyComplex());
  const [datePickerTarget, setDatePickerTarget] = useState("");

  const canCreateTournament = isApprovedOrganizer(userData) || canAccessAdminPanel(userData);
  const organizerComplexes = Array.isArray(userData?.complejos) ? userData.complejos : [];
  const tournamentComplexes = Array.isArray(userData?.tournamentComplexes)
    ? userData.tournamentComplexes
    : [];
  const allVenueOptions = useMemo(
    () => [...organizerComplexes, ...tournamentComplexes],
    [organizerComplexes, tournamentComplexes]
  );
  const categoryMode = getCategoryModeValue(form);
  const originalEditingForm = useMemo(
    () => (isEditingDraft ? buildFormFromTournament(editingTournament, userData) : null),
    [editingTournament, isEditingDraft, userData]
  );
  const hasUnsavedChanges = useMemo(() => {
    if (!isEditingDraft || !originalEditingForm) {
      return false;
    }

    return (
      JSON.stringify(buildComparableTournamentFormState(form)) !==
      JSON.stringify(buildComparableTournamentFormState(originalEditingForm))
    );
  }, [form, isEditingDraft, originalEditingForm]);

  useEffect(() => {
    if (form.creationMode !== "multiple" || isEditingDraft) {
      return;
    }

    const quantity = Math.max(Number.parseInt(form.quantity || "0", 10) || 0, 0);
    setMultipleConfigs((current) => syncMultipleConfigs(current, quantity));
  }, [form.creationMode, form.quantity, isEditingDraft]);

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

    return buildMultipleTournamentPayloads(
      { name: form.name.trim() },
      multipleConfigs.slice(0, quantity)
    ).map(
      (item) => item.name
    );
  }, [form.creationMode, form.name, form.quantity, multipleConfigs]);

  const updateField = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const updateMultipleConfigField = (index, field, value) => {
    setMultipleConfigs((current) =>
      current.map((item, itemIndex) =>
        itemIndex !== index
          ? item
          : {
              ...item,
              [field]: value,
            }
      )
    );
  };

  const getFirstCategoryOptionsForConfig = (config = {}) => {
    const categoryModeValue = getTournamentCategoryMode(config);

    if (categoryModeValue !== "sum_fixed" || !config.sumTarget) {
      return LEAGUE_CATEGORY_OPTIONS;
    }

    const targetValue = Number.parseInt(config.sumTarget, 10);

    return LEAGUE_CATEGORY_OPTIONS.filter((option) => {
      const complement = targetValue - option.numericValue;
      return LEAGUE_CATEGORY_OPTIONS.some((candidate) => candidate.numericValue === complement);
    });
  };

  const getSecondCategoryOptionsForConfig = (config = {}) => {
    const categoryModeValue = getTournamentCategoryMode(config);

    if (categoryModeValue !== "sum_fixed" || !config.sumTarget || !config.fixedCategoryA) {
      return LEAGUE_CATEGORY_OPTIONS;
    }

    const firstCategory = LEAGUE_CATEGORY_OPTIONS.find(
      (option) => option.value === config.fixedCategoryA
    );
    const targetValue = Number.parseInt(config.sumTarget, 10);

    if (!firstCategory || Number.isNaN(targetValue)) {
      return LEAGUE_CATEGORY_OPTIONS;
    }

    const complement = targetValue - firstCategory.numericValue;
    return LEAGUE_CATEGORY_OPTIONS.filter((option) => option.numericValue === complement);
  };

  const closeDatePicker = () => {
    setDatePickerTarget("");
  };

  const handleDateChange = (_, selectedDate) => {
    if (!selectedDate) {
      closeDatePicker();
      return;
    }

    const normalizedMillis = normalizeDateStartMillis(selectedDate.getTime());

    setForm((current) => {
      if (datePickerTarget === "startDateMillis") {
        const nextEndDate =
          Number(current.endDateMillis || 0) > 0 &&
          Number(current.endDateMillis || 0) < normalizedMillis
            ? normalizedMillis
            : current.endDateMillis;

        return {
          ...current,
          startDateMillis: normalizedMillis,
          endDateMillis: nextEndDate,
        };
      }

      return {
        ...current,
        endDateMillis: normalizedMillis,
      };
    });

    if (Platform.OS !== "ios") {
      closeDatePicker();
    }
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

    if (form.creationMode !== "multiple" && !form.fixedCategoryA) {
      return "Selecciona al menos una categoria.";
    }

    if (form.creationMode !== "multiple" && categoryMode !== "single" && !form.sumTarget) {
      return "Selecciona la suma objetivo del torneo.";
    }

    if (form.creationMode !== "multiple" && categoryMode === "sum_fixed" && !form.fixedCategoryB) {
      return "Selecciona la segunda categoria de la suma fija.";
    }

    if (!form.startDateMillis) {
      return "Selecciona la fecha de inicio.";
    }

    if (!form.endDateMillis) {
      return "Selecciona la fecha de finalizacion.";
    }

    if (Number(form.endDateMillis) < Number(form.startDateMillis)) {
      return "La fecha de finalizacion no puede ser anterior al inicio.";
    }

    if ((Number.parseInt(form.minPairs || "0", 10) || 0) < 2) {
      return "El minimo de parejas debe ser al menos 2.";
    }

    if ((Number.parseInt(form.maxPairs || "0", 10) || 0) < 2) {
      return "El maximo de parejas debe ser al menos 2.";
    }

    if ((Number.parseInt(form.minPairs || "0", 10) || 0) > (Number.parseInt(form.maxPairs || "0", 10) || 0)) {
      return "El minimo de parejas no puede superar al maximo.";
    }

    if (parseMoneyInput(form.entryFee) > 0 && !String(form.paymentAlias || "").trim()) {
      return "Si el torneo cobra inscripcion, necesitamos el alias de transferencia.";
    }

    if (form.creationMode === "multiple") {
      const quantity = Number.parseInt(form.quantity || "0", 10) || 0;

      if (quantity < 2) {
        return "Para crear varios torneos, la cantidad debe ser de al menos 2.";
      }

      for (let index = 0; index < quantity; index += 1) {
        const config = multipleConfigs[index] || buildInitialMultipleConfig();
        const categoryModeValue = getTournamentCategoryMode(config);

        if (!config.fixedCategoryA) {
          return `Selecciona la categoria del torneo ${index + 1}.`;
        }

        if (categoryModeValue !== "single" && !config.sumTarget) {
          return `Selecciona la suma del torneo ${index + 1}.`;
        }

        if (categoryModeValue === "sum_fixed" && !config.fixedCategoryB) {
          return `Selecciona la Categoria B del torneo ${index + 1}.`;
        }
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

      const organizerUid = userData?.uid || user?.uid || auth?.currentUser?.uid || "";

      if (!organizerUid) {
        throw new Error("No encontramos tu sesion de organizador. Volve a iniciar sesion.");
      }

      const organizer = {
        uid: organizerUid,
        name: userData?.name || "Organizador",
        organizerLogoUrl: userData?.organizerLogoUrl || "",
        mercadoPagoConfig: organizerMercadoPagoConfig,
      };
      let nextCoverImage = String(form.coverImage || "").trim();

      if (isLocalAssetUri(nextCoverImage)) {
        nextCoverImage = await uploadTournamentCoverImage(organizerUid, nextCoverImage);
      }

      const basePayload = buildPayloadFromForm(
        {
          ...form,
          coverImage: nextCoverImage,
          mercadoPagoConfig: tournamentMercadoPagoConfig,
        },
        organizer,
        allVenueOptions,
        null,
        userData?.tournamentFixtureDefaults || null
      );
      let createdTournamentId = "";
      let createdTournament = null;

      if (isEditingDraft) {
        createdTournament = await updateTournament(
          editingTournament.id,
          organizer,
          basePayload,
          editingTournament
        );
        createdTournamentId = createdTournament?.id || "";
      } else if (form.creationMode === "multiple") {
        const quantity = Number.parseInt(form.quantity || "0", 10) || 0;
        const createdTournaments = await createMultipleTournaments(
          organizer,
          buildMultipleTournamentPayloads(basePayload, multipleConfigs.slice(0, quantity))
        );
        createdTournamentId = createdTournaments[0]?.id || "";
        createdTournament = createdTournaments[0] || null;
      } else {
        createdTournament = await createTournament(organizer, basePayload);
        createdTournamentId = createdTournament?.id || "";
      }

      const navigationPayload = {
        organizerView: "active",
        resetOrganizerFilters: true,
        createdTournamentId,
        createdTournament,
      };

      if (isEditingDraft && returnToTournamentDetail) {
        const detailPayload = {
          initialTab: "management",
          tournamentId: createdTournamentId || editingTournament.id,
          tournamentName: createdTournament?.name || form.name || "Torneo",
        };

        if (typeof navigation.replace === "function") {
          navigation.replace("TournamentDetail", detailPayload);
        } else {
          navigation.navigate("TournamentDetail", detailPayload);
        }
        return;
      }

      if (typeof navigation.replace === "function") {
        navigation.replace("Torneos", navigationPayload);
      } else {
        navigation.navigate("Torneos", navigationPayload);
      }
    } catch (error) {
      showFeedback(
        isEditingDraft ? "No pudimos guardar los cambios" : "No pudimos crear el torneo",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handlePickCoverImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        showFeedback(
          "Permiso necesario",
          "Necesitamos acceso a tus fotos para cargar el afiche.",
          "danger"
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
      });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      updateField("coverImage", result.assets[0]?.uri || "");
    } catch (error) {
      showFeedback(
        "No pudimos cargar el afiche",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    }
  };

  if (!canCreateTournament) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <SectionHeader
          onBack={() => navigation.goBack()}
          subtitle={isEditingDraft ? "Editar torneo" : "Crear torneo"}
        />
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
      <SectionHeader
        onBack={() => navigation.goBack()}
        subtitle={isEditingDraft ? "Editar torneo" : "Crear torneo"}
      />

      {hasUnsavedChanges ? (
        <Text style={styles.unsavedChangesText}>
          Hay cambios sin guardar en los detalles del torneo.
        </Text>
      ) : null}

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.sectionCard}>
          <View style={styles.posterPickerHeader}>
            <Text style={styles.posterPickerTitle}>SUBIR AFICHE O FLYER</Text>
            <Pressable
              onPress={handlePickCoverImage}
              style={({ pressed }) => [
                styles.posterPickerIconButton,
                pressed && styles.posterPickerCardPressed,
              ]}
            >
              <Ionicons color={colors.primaryDark} name="image-outline" size={22} />
            </Pressable>
          </View>

          {form.coverImage ? (
            <View style={styles.posterPreviewCard}>
              <Image source={{ uri: form.coverImage }} style={styles.posterPreviewImage} />
              <View style={styles.posterPreviewActions}>
                <Text style={styles.posterPreviewLabel}>Afiche cargado</Text>
                <Pressable onPress={() => updateField("coverImage", "")} hitSlop={8}>
                  <Text style={styles.posterRemoveText}>Quitar</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>TIPO DE TORNEO</Text>
          <View style={styles.confirmationList}>
            {TOURNAMENT_RULESET_OPTIONS.map((option) => {
              const isActive = form.tournamentRuleSet === option.value;

              return (
                <Pressable
                  key={option.value}
                  onPress={() => updateField("tournamentRuleSet", option.value)}
                  style={[
                    styles.confirmationOption,
                    styles.ruleSetOption,
                    isActive && styles.confirmationOptionActive,
                  ]}
                >
                  <View
                    style={[
                      styles.confirmationBullet,
                      isActive && styles.confirmationBulletActive,
                    ]}
                  />
                  <View style={styles.ruleSetCopy}>
                    <Text
                      style={[
                        styles.confirmationOptionText,
                        isActive && styles.confirmationOptionTextActive,
                      ]}
                    >
                      {option.label}
                    </Text>
                    <Text style={styles.ruleSetSubtitle}>{option.subtitle}</Text>
                    <Text style={styles.ruleSetDescription}>{option.description}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.confirmationDescription}>
            {getTournamentRuleSetOptionMeta(form.tournamentRuleSet).description}
          </Text>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>MODO DE ARMADO</Text>
          <View style={styles.confirmationList}>
            {CREATION_MODE_OPTIONS.map((option) => {
              const optionMeta = getCreationModeOptionMeta(option.value);
              const isActive = form.creationMode === option.value;

              return (
                <Pressable
                  key={option.value}
                  onPress={() => updateField("creationMode", option.value)}
                  style={[
                    styles.confirmationOption,
                    isActive && styles.confirmationOptionActive,
                  ]}
                >
                  <View
                    style={[
                      styles.confirmationBullet,
                      isActive && styles.confirmationBulletActive,
                    ]}
                  />
                  <Text
                    style={[
                      styles.confirmationOptionText,
                      isActive && styles.confirmationOptionTextActive,
                    ]}
                  >
                    {optionMeta.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.confirmationDescription}>
            {getCreationModeOptionMeta(form.creationMode).description}
          </Text>

          {form.creationMode === "multiple" && !isEditingDraft ? (
            <View style={styles.inlineQuantityRow}>
              <Text style={styles.inlineQuantityLabel}>Cantidad de torneos</Text>
              <TextInput
                keyboardType="number-pad"
                maxLength={1}
                onChangeText={(value) =>
                  updateField("quantity", sanitizeInteger(value).slice(0, 1))
                }
                placeholder="2"
                placeholderTextColor={colors.muted}
                style={styles.inlineQuantityInput}
                value={String(form.quantity || "").slice(0, 1)}
              />
            </View>
          ) : null}
        </View>

        <View style={styles.sectionCard}>
          <AppInput
            label="Nombre del torneo"
            labelStyle={styles.centeredFieldLabel}
            onChangeText={(value) => updateField("name", value)}
            placeholder={
              form.creationMode === "multiple" && !isEditingDraft ? "Torneo Apertura" : "Torneo de invierno"
            }
            value={form.name}
          />
          <AppInput
            label="Descripcion"
            labelStyle={styles.centeredFieldLabel}
            multiline
            numberOfLines={4}
            onChangeText={(value) => updateField("description", value)}
            placeholder="Esta descripcion es Opcional"
            value={form.description}
          />

          {multiplePreviewNames.length ? (
            <View style={styles.previewCard}>
              <Text style={styles.previewTitle}>Se van a crear</Text>
              {multiplePreviewNames.map((name, index) => (
                <Text key={`${name}-${index + 1}`} style={styles.previewItem}>
                  {name}
                </Text>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>SELECCIONAR LUGARES DE JUEGO</Text>
          <View style={styles.confirmationList}>
            {VENUE_MODE_OPTIONS.map((option) => {
              const optionMeta = getVenueModeOptionMeta(option.value);
              const isActive = form.venueMode === option.value;

              return (
                <Pressable
                  key={option.value}
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
                  style={[
                    styles.confirmationOption,
                    isActive && styles.confirmationOptionActive,
                  ]}
                >
                  <View
                    style={[
                      styles.confirmationBullet,
                      isActive && styles.confirmationBulletActive,
                    ]}
                  />
                  <Text
                    style={[
                      styles.confirmationOptionText,
                      isActive && styles.confirmationOptionTextActive,
                    ]}
                  >
                    {optionMeta.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.confirmationDescription}>
            {getVenueModeOptionMeta(form.venueMode).description}
          </Text>

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
            textStyle={styles.sectionButtonText}
            title="AGREGAR LUGAR TEMPORAL"
            variant="secondary"
          />
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>SELECCIONE CATEGORIAS</Text>

          {form.creationMode === "multiple" && !isEditingDraft ? (
            <View style={styles.multipleTournamentConfigsWrap}>
              {multipleConfigs.map((config, index) => {
                const configCategoryMode = getTournamentCategoryMode(config);

                return (
                  <View key={`config-${index + 1}`} style={styles.multipleTournamentCard}>
                    <Text style={styles.multipleTournamentTitle}>{`TORNEO ${index + 1}`}</Text>
                    {form.name.trim() ? (
                      <Text style={styles.multipleTournamentNamePreview}>
                        {buildTournamentNameWithCategory(form.name, config)}
                      </Text>
                    ) : null}

                    <View style={styles.confirmationList}>
                      {CATEGORY_MODE_OPTIONS.map((option) => {
                        const optionMeta = getCategoryModeOptionMeta(option.value);
                        const isActive = configCategoryMode === option.value;

                        return (
                          <Pressable
                            key={`${option.value}-${index}`}
                            onPress={() =>
                              setMultipleConfigs((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex !== index
                                    ? item
                                    : {
                                        ...item,
                                        categoryFormat: option.value === "single" ? "libre" : "suma",
                                        sumRule: option.value === "sum_fixed" ? "fixed" : "open",
                                        sumTarget: option.value === "single" ? "" : item.sumTarget,
                                        fixedCategoryB:
                                          option.value === "sum_fixed" ? item.fixedCategoryB : "",
                                      }
                                )
                              )
                            }
                            style={[
                              styles.confirmationOption,
                              isActive && styles.confirmationOptionActive,
                            ]}
                          >
                            <View
                              style={[
                                styles.confirmationBullet,
                                isActive && styles.confirmationBulletActive,
                              ]}
                            />
                            <Text
                              style={[
                                styles.confirmationOptionText,
                                isActive && styles.confirmationOptionTextActive,
                              ]}
                            >
                              {optionMeta.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text style={styles.confirmationDescription}>
                      {getCategoryModeOptionMeta(configCategoryMode).description}
                    </Text>

                    <SelectField
                      label="Sexo"
                      labelStyle={styles.centeredFieldLabel}
                      onClose={() => setMultiplePickerState({ field: "", index: -1 })}
                      onOpen={() => setMultiplePickerState({ field: "branch", index })}
                      onSelect={(value) => updateMultipleConfigField(index, "branch", value)}
                      options={LEAGUE_BRANCH_OPTIONS.map((option) => ({
                        ...option,
                        label: option.value === "Masculino" ? "Caballeros" : option.label,
                      }))}
                      placeholder="Seleccionar sexo"
                      value={config.branch}
                      visible={
                        multiplePickerState.field === "branch" &&
                        multiplePickerState.index === index
                      }
                    />

                    {configCategoryMode !== "single" ? (
                      <SelectField
                        label="Suma"
                        labelStyle={styles.centeredFieldLabel}
                        onClose={() => setMultiplePickerState({ field: "", index: -1 })}
                        onOpen={() => setMultiplePickerState({ field: "sumTarget", index })}
                        onSelect={(value) => updateMultipleConfigField(index, "sumTarget", value)}
                        options={LEAGUE_SUM_TARGET_OPTIONS}
                        placeholder="Seleccionar suma"
                        value={config.sumTarget}
                        visible={
                          multiplePickerState.field === "sumTarget" &&
                          multiplePickerState.index === index
                        }
                      />
                    ) : null}

                    <SelectField
                      label={configCategoryMode === "single" ? "Categoria" : "Categoria A"}
                      labelStyle={styles.centeredFieldLabel}
                      onClose={() => setMultiplePickerState({ field: "", index: -1 })}
                      onOpen={() => setMultiplePickerState({ field: "fixedCategoryA", index })}
                      onSelect={(value) => updateMultipleConfigField(index, "fixedCategoryA", value)}
                      options={getFirstCategoryOptionsForConfig(config)}
                      placeholder="Seleccionar categoria"
                      value={config.fixedCategoryA}
                      visible={
                        multiplePickerState.field === "fixedCategoryA" &&
                        multiplePickerState.index === index
                      }
                    />

                    {configCategoryMode === "sum_fixed" ? (
                      <SelectField
                        label="Categoria B"
                        labelStyle={styles.centeredFieldLabel}
                        onClose={() => setMultiplePickerState({ field: "", index: -1 })}
                        onOpen={() => setMultiplePickerState({ field: "fixedCategoryB", index })}
                        onSelect={(value) => updateMultipleConfigField(index, "fixedCategoryB", value)}
                        options={getSecondCategoryOptionsForConfig(config)}
                        placeholder="Seleccionar categoria"
                        value={config.fixedCategoryB}
                        visible={
                          multiplePickerState.field === "fixedCategoryB" &&
                          multiplePickerState.index === index
                        }
                      />
                    ) : null}
                  </View>
                );
              })}
            </View>
          ) : (
            <>
              <View style={styles.confirmationList}>
                {CATEGORY_MODE_OPTIONS.map((option) => {
                  const optionMeta = getCategoryModeOptionMeta(option.value);
                  const isActive = categoryMode === option.value;

                  return (
                    <Pressable
                      key={option.value}
                      onPress={() =>
                        setForm((current) => ({
                          ...current,
                          categoryFormat: option.value === "single" ? "libre" : "suma",
                          sumRule: option.value === "sum_fixed" ? "fixed" : "open",
                          sumTarget: option.value === "single" ? "" : current.sumTarget,
                          fixedCategoryB: option.value === "sum_fixed" ? current.fixedCategoryB : "",
                        }))
                      }
                      style={[
                        styles.confirmationOption,
                        isActive && styles.confirmationOptionActive,
                      ]}
                    >
                      <View
                        style={[
                          styles.confirmationBullet,
                          isActive && styles.confirmationBulletActive,
                        ]}
                      />
                      <Text
                        style={[
                          styles.confirmationOptionText,
                          isActive && styles.confirmationOptionTextActive,
                        ]}
                      >
                        {optionMeta.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.confirmationDescription}>
                {getCategoryModeOptionMeta(categoryMode).description}
              </Text>

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
            </>
          )}
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>DEFINIR COSTO Y MODALIDAD</Text>

          <Text style={styles.inputLabel}>¿CUANDO SE CONFIRMA LA INSCRIPCION?</Text>
          <View style={styles.confirmationList}>
            {TOURNAMENT_PAIR_CONFIRMATION_OPTIONS.map((option) => {
              const optionMeta = getPairConfirmationOptionMeta(option.value);
              const isActive = form.pairConfirmationMode === option.value;

              return (
                <Pressable
                  key={option.value}
                  onPress={() => updateField("pairConfirmationMode", option.value)}
                  style={[
                    styles.confirmationOption,
                    isActive && styles.confirmationOptionActive,
                  ]}
                >
                  <View style={[styles.confirmationBullet, isActive && styles.confirmationBulletActive]} />
                  <Text
                    style={[
                      styles.confirmationOptionText,
                      isActive && styles.confirmationOptionTextActive,
                    ]}
                  >
                    {optionMeta.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.confirmationDescription}>
            {getPairConfirmationOptionMeta(form.pairConfirmationMode).description}
          </Text>

          <AppInput
            keyboardType="decimal-pad"
            label="VALOR DE INSCRIPCION POR JUGADOR"
            labelStyle={styles.centeredFieldLabel}
            inputStyle={styles.centeredMoneyInput}
            onChangeText={(value) => updateField("entryFee", formatMoneyInput(value))}
            placeholder="0"
            value={form.entryFee}
          />
          <AppInput
            label="Alias de transferencia"
            labelStyle={styles.centeredFieldLabel}
            inputStyle={styles.centeredMoneyInput}
            onChangeText={(value) => updateField("paymentAlias", value)}
            placeholder="padelnexo.torneo"
            value={form.paymentAlias}
          />
          <View style={styles.mercadoPagoStatusCard}>
            <View style={styles.mercadoPagoStatusHeader}>
              <Ionicons
                color={tournamentMercadoPagoConfig.enabled ? "#1A7F5A" : "#7B8794"}
                name="wallet-outline"
                size={18}
              />
              <Text style={styles.mercadoPagoStatusTitle}>Mercado Pago</Text>
            </View>
            <Text style={styles.mercadoPagoStatusText}>
              {tournamentMercadoPagoConfig.enabled
                ? isEditingDraft
                  ? "Este torneo queda preparado para cobrar tambien con Mercado Pago."
                  : "Tus proximos torneos pueden quedar preparados para cobrar tambien con Mercado Pago."
                : "Activalo desde el perfil del organizador para cobrar tambien con Mercado Pago en torneos nuevos."}
            </Text>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>FECHAS Y CUPOS</Text>

          <Text style={styles.inputLabel}>TORNEO COMIENZA:</Text>
          <Pressable
            onPress={() => setDatePickerTarget("startDateMillis")}
            style={({ pressed }) => [styles.dateField, pressed && styles.dateFieldPressed]}
          >
            <Ionicons color={colors.primaryDark} name="calendar-outline" size={18} />
            <Text style={styles.dateFieldText}>{formatDateLabel(form.startDateMillis)}</Text>
          </Pressable>

          <Text style={[styles.inputLabel, styles.secondLabel]}>EL TORNEO FINALIZA:</Text>
          <Pressable
            onPress={() => setDatePickerTarget("endDateMillis")}
            style={({ pressed }) => [styles.dateField, pressed && styles.dateFieldPressed]}
          >
            <Ionicons color={colors.primaryDark} name="calendar-outline" size={18} />
            <Text style={styles.dateFieldText}>{formatDateLabel(form.endDateMillis)}</Text>
          </Pressable>

          <View style={styles.pairsRow}>
            <View style={styles.pairsField}>
              <AppInput
                keyboardType="number-pad"
                label="Minimo de parejas"
                labelStyle={styles.centeredFieldLabel}
                inputStyle={styles.centeredMoneyInput}
                maxLength={2}
                onChangeText={(value) => updateField("minPairs", sanitizeInteger(value, 2))}
                placeholder="4"
                value={form.minPairs}
              />
            </View>
            <View style={styles.pairsField}>
              <AppInput
                keyboardType="number-pad"
                label="Maximo de parejas"
                labelStyle={styles.centeredFieldLabel}
                inputStyle={styles.centeredMoneyInput}
                maxLength={2}
                onChangeText={(value) => updateField("maxPairs", sanitizeInteger(value, 2))}
                placeholder="16"
                value={form.maxPairs}
              />
            </View>
          </View>
        </View>

        <AppButton
          disabled={submitting}
          onPress={handleSubmit}
          title={
            submitting
              ? "GUARDANDO..."
              : isEditingDraft
              ? "GUARDAR CAMBIOS"
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

      {datePickerTarget ? (
        <DateTimePicker
          display="default"
          mode="date"
          onChange={handleDateChange}
          value={new Date(Number(form[datePickerTarget] || 0) || Date.now())}
        />
      ) : null}

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
  posterPickerHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
  },
  posterPickerTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "900",
    lineHeight: 20,
    textAlign: "center",
    textTransform: "uppercase",
  },
  posterPickerCard: {
    alignItems: "center",
    backgroundColor: "#F4FAF7",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  posterPickerIconButton: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#F4FAF7",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  posterPickerCardPressed: {
    backgroundColor: "#E8F5EE",
    borderColor: colors.primaryLight,
  },
  posterPickerIconWrap: {
    alignItems: "center",
    backgroundColor: "#E6F2EC",
    borderRadius: 999,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  posterPickerCopy: {
    flex: 1,
  },
  posterPickerTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  posterPickerIconText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  posterPickerText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
    marginTop: 2,
  },
  posterPreviewCard: {
    backgroundColor: "#F7FBF8",
    borderColor: "#DCE9E1",
    borderRadius: 12,
    borderWidth: 1,
    marginTop: spacing.sm,
    overflow: "hidden",
  },
  posterPreviewImage: {
    height: 170,
    resizeMode: "cover",
    width: "100%",
  },
  posterPreviewActions: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  posterPreviewLabel: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  posterRemoveText: {
    color: "#B24343",
    fontSize: 12,
    fontWeight: "800",
  },
  centeredFieldLabel: {
    textAlign: "center",
  },
  inlineQuantityRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    marginTop: spacing.xs,
  },
  inlineQuantityLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  inlineQuantityInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    minHeight: 40,
    paddingHorizontal: spacing.sm,
    paddingVertical: 0,
    textAlign: "center",
    width: 52,
  },
  centeredMoneyInput: {
    textAlign: "center",
  },
  toggleGrid: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  toggleCard: {
    backgroundColor: "#F4FAF7",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  toggleCardCompact: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
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
  toggleCardTitleCompact: {
    fontSize: 12,
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
  toggleCardDescriptionCompact: {
    fontSize: 11,
    lineHeight: 14,
    marginTop: 2,
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
  multipleTournamentConfigsWrap: {
    gap: spacing.md,
  },
  multipleTournamentCard: {
    backgroundColor: "#F7FBF8",
    borderColor: "#DCE9E1",
    borderRadius: 18,
    borderWidth: 1,
    padding: spacing.md,
  },
  multipleTournamentTitle: {
    color: colors.primaryDark,
    fontSize: 14,
    fontWeight: "900",
    marginBottom: spacing.xs,
    textAlign: "center",
    textTransform: "uppercase",
  },
  multipleTournamentNamePreview: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  inputLabel: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
    marginBottom: spacing.xs,
    textAlign: "center",
  },
  confirmationList: {
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  confirmationOption: {
    alignItems: "center",
    backgroundColor: "#F4FAF7",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  confirmationOptionActive: {
    backgroundColor: "#E8F5EE",
    borderColor: colors.primaryLight,
  },
  confirmationBullet: {
    backgroundColor: colors.surface,
    borderColor: "#9EB7AA",
    borderRadius: 999,
    borderWidth: 1.5,
    height: 16,
    width: 16,
  },
  confirmationBulletActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  confirmationOptionText: {
    color: colors.text,
    flex: 1,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  confirmationOptionTextActive: {
    color: colors.primaryDark,
  },
  ruleSetOption: {
    alignItems: "flex-start",
    paddingVertical: spacing.sm,
  },
  ruleSetCopy: {
    flex: 1,
  },
  ruleSetSubtitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 2,
  },
  ruleSetDescription: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
    marginTop: 3,
  },
  confirmationDescription: {
    color: "#1E88C8",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 18,
    marginBottom: spacing.md,
    textAlign: "center",
  },
  mercadoPagoStatusCard: {
    backgroundColor: "#F7FAFD",
    borderColor: "#D8E4EC",
    borderRadius: 14,
    borderWidth: 1,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  mercadoPagoStatusHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    marginBottom: 6,
  },
  mercadoPagoStatusTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
    marginLeft: 6,
  },
  mercadoPagoStatusText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 18,
    textAlign: "center",
  },
  dateField: {
    alignItems: "center",
    backgroundColor: "#F4FAF7",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  dateFieldPressed: {
    backgroundColor: "#E8F5EE",
    borderColor: colors.primaryLight,
  },
  dateFieldText: {
    color: colors.primaryDark,
    fontSize: 14,
    fontWeight: "700",
  },
  secondLabel: {
    marginTop: spacing.sm,
  },
  pairsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  pairsField: {
    flex: 1,
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
    alignSelf: "center",
    borderRadius: 12,
    marginBottom: 0,
    marginTop: spacing.md,
    minHeight: 0,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  sectionButtonText: {
    fontSize: 13,
    fontWeight: "700",
  },
  unsavedChangesText: {
    color: "#D98A00",
    fontSize: 12,
    fontWeight: "800",
    marginBottom: spacing.sm,
    textAlign: "center",
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

