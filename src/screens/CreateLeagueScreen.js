import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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

import AppButton from "../components/AppButton";
import AppInput from "../components/AppInput";
import FeedbackModal from "../components/FeedbackModal";
import LocationPicker from "../components/LocationPicker";
import OrganizerRequestModal from "../components/OrganizerRequestModal";
import SectionHeader from "../components/SectionHeader";
import SelectField from "../components/SelectField";
import { canAccessAdminPanel } from "../config/admin";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import {
  buildLeagueCategoryLabel,
  createLeague,
  getLeagueById,
  LEAGUE_BRANCH_OPTIONS,
  LEAGUE_CATEGORY_OPTIONS,
  LEAGUE_SUM_TARGET_OPTIONS,
  LEAGUE_TEAM_TYPE_OPTIONS,
  MATCH_FORMAT_OPTIONS,
  normalizeLeagueDefaults,
  updateLeague,
} from "../services/leaguesService";
import { isApprovedOrganizer } from "../services/roleService";

const CATEGORY_FORMAT_OPTIONS = [
  { label: "Categoria unica", value: "single" },
  { label: "Suma fija", value: "sum_fixed" },
  { label: "Suma libre", value: "sum_open" },
];

const MATCH_DAY_MODE_OPTIONS = [
  { label: "Dia fijo", value: "fixed_day" },
  { label: "A coordinar", value: "weekly_coordination" },
];

const FIXTURE_ROUND_MODE_OPTIONS = [
  { label: "Ida", value: "single" },
  { label: "Ida y vuelta", value: "double" },
];

const REGISTRATION_FEE_OPTIONS = [
  { label: "Sin inscripcion", value: "no" },
  { label: "Con inscripcion inicial", value: "yes" },
];

const MATCH_DAY_OPTIONS = [
  { label: "Lunes", value: "monday" },
  { label: "Martes", value: "tuesday" },
  { label: "Miercoles", value: "wednesday" },
  { label: "Jueves", value: "thursday" },
  { label: "Viernes", value: "friday" },
  { label: "Sabado", value: "saturday" },
  { label: "Domingo", value: "sunday" },
];

function getGameModeValue(form) {
  if (form.categoryFormat !== "suma") {
    return "single";
  }

  return form.sumRule === "fixed" ? "sum_fixed" : "sum_open";
}

function normalizePaymentDefaults(paymentDefaults = {}) {
  const registrationFeeEnabled = paymentDefaults.registrationFeeEnabled === true;
  const registrationFeeAmount = Number.parseFloat(
    String(paymentDefaults.registrationFeeAmount ?? "").replace(",", ".")
  );
  const roundPricePerPlayer = Number.parseFloat(
    String(paymentDefaults.roundPricePerPlayer ?? "").replace(",", ".")
  );

  return {
    currency: paymentDefaults.currency || "ARS",
    registrationFeeEnabled,
    registrationFeeAmount:
      registrationFeeEnabled && Number.isFinite(registrationFeeAmount) && registrationFeeAmount > 0
        ? Math.round(registrationFeeAmount * 100) / 100
        : 0,
    roundPricePerPlayer:
      Number.isFinite(roundPricePerPlayer) && roundPricePerPlayer > 0
        ? Math.round(roundPricePerPlayer * 100) / 100
        : 0,
  };
}

function buildPaymentDefaultsFromForm(form = {}) {
  return normalizePaymentDefaults({
    currency: "ARS",
    registrationFeeEnabled: form.registrationFeeMode === "yes",
    registrationFeeAmount: form.registrationFeeMode === "yes" ? form.registrationFeeAmount : "0",
    roundPricePerPlayer: form.roundPricePerPlayer,
  });
}

function buildInitialForm(userData) {
  const hasLeagueDefaults = Boolean(userData?.leagueDefaults);
  const defaults = normalizeLeagueDefaults(userData?.leagueDefaults || {});
  const paymentDefaults = normalizePaymentDefaults(userData?.leaguePaymentDefaults || {});
  const firstComplex = Array.isArray(userData?.complejos) ? userData.complejos[0] : null;

  return {
    name: "",
    complexName: firstComplex?.nombre || "",
    matchDayMode: "fixed_day",
    matchDay: "tuesday",
    matchTimeSlots: [""],
    fixtureRoundMode: "single",
    fixtureDatesCount: calculateRecommendedFixtureDates(defaults.teamType, "8", "single") || "6",
    fixtureMinPlayersCount: "8",
    registrationFeeMode: paymentDefaults.registrationFeeEnabled ? "yes" : "no",
    registrationFeeAmount:
      paymentDefaults.registrationFeeAmount > 0 ? String(paymentDefaults.registrationFeeAmount) : "",
    roundPricePerPlayer:
      paymentDefaults.roundPricePerPlayer > 0 ? String(paymentDefaults.roundPricePerPlayer) : "",
    branch: defaults.branch,
    teamType: defaults.teamType,
    categoryFormat: defaults.categoryFormat,
    sumTarget: defaults.sumTarget,
    sumRule: defaults.sumRule,
    fixedCategoryA: defaults.fixedCategoryA,
    fixedCategoryB: defaults.fixedCategoryB,
    matchFormat: defaults.matchFormat,
    singleSetPoints: String(defaults.singleSetPoints),
    singleSetWinByTwo: defaults.singleSetWinByTwo,
    superTieBreakPoints: String(defaults.superTieBreakPoints),
    superTieBreakWinByTwo: defaults.superTieBreakWinByTwo,
    allowWalkover: defaults.allowWalkover,
    pointsWin: hasLeagueDefaults ? String(defaults.pointsWin) : "",
    pointsLoss: hasLeagueDefaults ? String(defaults.pointsLoss) : "",
    replacementPenalty: hasLeagueDefaults ? String(defaults.replacementPenalty) : "",
    replacementPenaltyMode: defaults.replacementPenaltyMode || "individual",
    replacementQuota: hasLeagueDefaults ? String(defaults.replacementQuota || 0) : "",
  };
}

function buildFormFromLeague(league, userData) {
  const defaults = normalizeLeagueDefaults({
    branch: league?.sexo,
    teamType: league?.teamType,
    categoryFormat: league?.modalidadCategoria,
    sumTarget: league?.sumTarget,
    sumRule: league?.sumRule,
    fixedCategoryA: league?.categoriaA,
    fixedCategoryB: league?.categoriaB,
    matchFormat: league?.matchFormat,
    singleSetPoints: league?.singleSetSettings?.pointsToWin,
    singleSetWinByTwo: league?.singleSetSettings?.winByTwo,
    superTieBreakPoints: league?.superTieBreakSettings?.pointsToWin,
    superTieBreakWinByTwo: league?.superTieBreakSettings?.winByTwo,
    allowWalkover: league?.scoringSettings?.allowWalkover,
    pointsWin: league?.scoringSettings?.pointsWin,
    pointsLoss: league?.scoringSettings?.pointsLoss,
    replacementPenalty: league?.scoringSettings?.replacementPenalty,
    replacementPenaltyMode: league?.scoringSettings?.replacementPenaltyMode,
    replacementQuota: league?.scoringSettings?.replacementQuota,
  });
  const paymentDefaults = normalizePaymentDefaults(userData?.leaguePaymentDefaults || {});
  const leagueRoundPrice = Number.parseFloat(
    String(league?.paymentConfig?.roundPricePerPlayer ?? "").replace(",", ".")
  );
  const resolvedRoundPrice =
    Number.isFinite(leagueRoundPrice) && leagueRoundPrice > 0
      ? leagueRoundPrice
      : paymentDefaults.roundPricePerPlayer;

  return {
    name: league?.nombre || "",
    complexName: league?.complejoNombre || "",
    matchDayMode: league?.scheduleConfig?.mode || "fixed_day",
    matchDay: league?.scheduleConfig?.dayKey || "tuesday",
    matchTimeSlots:
      Array.isArray(league?.scheduleConfig?.timeSlots) && league.scheduleConfig.timeSlots.length > 0
        ? [...league.scheduleConfig.timeSlots]
        : [""],
    fixtureRoundMode: league?.fixtureConfig?.roundMode === "double" ? "double" : "single",
    fixtureDatesCount: String(league?.fixtureConfig?.roundsCount || 6),
    fixtureMinPlayersCount: String(league?.fixtureConfig?.minPlayersCount || 8),
    registrationFeeMode: league?.paymentConfig?.registrationFeeEnabled ? "yes" : "no",
    registrationFeeAmount:
      league?.paymentConfig?.registrationFeeAmount > 0
        ? String(league.paymentConfig.registrationFeeAmount)
        : "",
    roundPricePerPlayer: resolvedRoundPrice > 0 ? String(resolvedRoundPrice) : "",
    branch: defaults.branch,
    teamType: defaults.teamType,
    categoryFormat: defaults.categoryFormat,
    sumTarget: defaults.sumTarget,
    sumRule: defaults.sumRule,
    fixedCategoryA: defaults.fixedCategoryA,
    fixedCategoryB: defaults.fixedCategoryB,
    matchFormat: defaults.matchFormat,
    singleSetPoints: String(defaults.singleSetPoints),
    singleSetWinByTwo: defaults.singleSetWinByTwo,
    superTieBreakPoints: String(defaults.superTieBreakPoints),
    superTieBreakWinByTwo: defaults.superTieBreakWinByTwo,
    allowWalkover: defaults.allowWalkover,
    pointsWin: String(defaults.pointsWin),
    pointsLoss: String(defaults.pointsLoss),
    replacementPenalty: String(defaults.replacementPenalty),
    replacementPenaltyMode: defaults.replacementPenaltyMode || "individual",
    replacementQuota: String(defaults.replacementQuota || 0),
  };
}

function ChipGroup({ onChange, options, value, wrapStyle }) {
  return (
    <View style={[styles.chipRow, wrapStyle]}>
      {options.map((option) => {
        const isActive = option.value === value;

        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.chip, isActive && styles.chipActive]}
          >
            <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
              {option.label}
            </Text>
            {option.description ? (
              <Text
                style={[styles.chipDescription, isActive && styles.chipDescriptionActive]}
              >
                {option.description}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function sanitizeDecimal(value) {
  const normalizedValue = String(value || "").replace(",", ".").replace(/[^0-9.]/g, "");
  const [integerPart = "", ...decimalParts] = normalizedValue.split(".");
  const decimalPart = decimalParts.join("");

  if (!normalizedValue.includes(".")) {
    return integerPart;
  }

  return `${integerPart || "0"}.${decimalPart.slice(0, 2)}`;
}

function sanitizeInteger(value) {
  return String(value || "").replace(/[^0-9]/g, "");
}

function calculateRecommendedFixtureDates(teamType, participantsCountValue, roundMode = "single") {
  const participantsCount = Number.parseInt(String(participantsCountValue || ""), 10);

  if (!Number.isInteger(participantsCount) || participantsCount <= 1) {
    return "";
  }

  const teamsCount = teamType === "pair" ? participantsCount : Math.floor(participantsCount / 2);

  if (teamsCount <= 1) {
    return "";
  }

  const firstLegRounds = teamsCount % 2 === 0 ? teamsCount - 1 : teamsCount;
  const multiplier = roundMode === "double" ? 2 : 1;

  return String(firstLegRounds * multiplier);
}

function normalizeTimeSlots(slots = []) {
  return [...new Set(slots.map((slot) => String(slot || "").trim()).filter(Boolean))];
}

function isValidTimeValue(value = "") {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(String(value).trim());
}

function buildDateFromTime(value = "") {
  const baseDate = new Date();
  const normalizedValue = isValidTimeValue(value) ? value : "19:00";
  const [hours, minutes] = normalizedValue.split(":").map((part) => Number.parseInt(part, 10));
  const nextDate = new Date(baseDate);
  nextDate.setHours(hours, minutes, 0, 0);
  return nextDate;
}

function formatTimeValue(date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function InlineNumberField({
  label,
  value,
  onChangeText,
  placeholder = "",
  editable = true,
  keyboardType = "decimal-pad",
  rightContent = null,
  rowStyle,
  labelStyle,
  labelNumberOfLines,
  inputWrapStyle,
}) {
  return (
    <View style={[styles.inlineFieldRow, rowStyle]}>
      <Text numberOfLines={labelNumberOfLines} style={[styles.inlineFieldLabel, labelStyle]}>
        {label}
      </Text>
      {rightContent ? <View style={styles.inlineRightGroup}>{rightContent}</View> : null}
      <View
        style={[
          styles.inlineInputWrap,
          inputWrapStyle,
          !editable && styles.inlineInputWrapDisabled,
        ]}
      >
        <AppInput
          autoCapitalize="none"
          containerStyle={styles.inlineInputContainer}
          editable={editable}
          inputStyle={styles.inlineInput}
          keyboardType={keyboardType}
          label=""
          labelStyle={styles.hiddenInlineInputLabel}
          onChangeText={onChangeText}
          placeholder={placeholder}
          value={value}
        />
      </View>
    </View>
  );
}

export default function CreateLeagueScreen({ navigation, route }) {
  const { updateProfile, userData } = useAuth();
  const leagueId = route?.params?.leagueId || "";
  const isEditing = Boolean(leagueId);
  const [form, setForm] = useState(() => buildInitialForm(userData));
  const [baseLocationInput, setBaseLocationInput] = useState("");
  const [selectedBaseLocation, setSelectedBaseLocation] = useState(() => {
    const name = userData?.localidad?.nombre || userData?.city || "";

    if (!name) {
      return null;
    }

    return {
      nombre: name,
      provincia:
        userData?.localidad?.provincia ||
        userData?.province ||
        userData?.location?.provincia ||
        "",
      pais: userData?.localidad?.pais || userData?.location?.pais || "Argentina",
    };
  });
  const [submitting, setSubmitting] = useState(false);
  const [savingAdditional, setSavingAdditional] = useState(false);
  const [isComplexVisible, setIsComplexVisible] = useState(false);
  const [isComplexRequestVisible, setIsComplexRequestVisible] = useState(false);
  const [isSumVisible, setIsSumVisible] = useState(false);
  const [isCategoryAVisible, setIsCategoryAVisible] = useState(false);
  const [isCategoryBVisible, setIsCategoryBVisible] = useState(false);
  const [isAdditionalVisible, setIsAdditionalVisible] = useState(false);
  const [feedback, setFeedback] = useState({
    visible: false,
    title: "",
    message: "",
    tone: "default",
  });
  const [loadingLeague, setLoadingLeague] = useState(isEditing);
  const [editingLeague, setEditingLeague] = useState(null);
  const [activeTimeSlotIndex, setActiveTimeSlotIndex] = useState(-1);
  const [timePickerVisible, setTimePickerVisible] = useState(false);

  const organizerComplexOptions = useMemo(
    () =>
      (userData?.complejos || []).map((complex) => ({
        label: complex.nombre,
        value: complex.nombre,
      })),
    [userData?.complejos]
  );

  const selectedComplex = useMemo(
    () =>
      (userData?.complejos || []).find((complex) => complex.nombre === form.complexName) || null,
    [form.complexName, userData?.complejos]
  );
  const canCreateLeague = isApprovedOrganizer(userData) || canAccessAdminPanel(userData);
  const selectedGameMode = getGameModeValue(form);
  const filteredFirstCategoryOptions = useMemo(() => {
    if (selectedGameMode !== "sum_fixed" || !form.sumTarget) {
      return LEAGUE_CATEGORY_OPTIONS;
    }

    const targetValue = Number.parseInt(form.sumTarget, 10);

    return LEAGUE_CATEGORY_OPTIONS.filter((option) => {
      const complement = targetValue - option.numericValue;

      return LEAGUE_CATEGORY_OPTIONS.some((candidate) => candidate.numericValue === complement);
    });
  }, [form.sumTarget, selectedGameMode]);
  const filteredSecondCategoryOptions = useMemo(() => {
    if (selectedGameMode !== "sum_fixed" || !form.sumTarget || !form.fixedCategoryA) {
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
  }, [form.fixedCategoryA, form.sumTarget, selectedGameMode]);
  const sumPreview = buildLeagueCategoryLabel(
    form.branch,
    form.categoryFormat,
    form.sumTarget,
    form.sumRule,
    form.fixedCategoryA,
    form.fixedCategoryB
  );

  const showFeedback = (title, message, tone = "default") => {
    setFeedback({
      visible: true,
      title,
      message,
      tone,
    });
  };

  const updateField = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const updateFixtureRoundMode = (value) => {
    setForm((current) => ({
      ...current,
      fixtureRoundMode: value,
      fixtureDatesCount:
        calculateRecommendedFixtureDates(current.teamType, current.fixtureMinPlayersCount, value) ||
        current.fixtureDatesCount,
    }));
  };

  const updateFixtureMinPlayersCount = (value) => {
    const nextValue = sanitizeInteger(value).slice(0, 2);

    setForm((current) => ({
      ...current,
      fixtureMinPlayersCount: nextValue,
      fixtureDatesCount:
        calculateRecommendedFixtureDates(current.teamType, nextValue, current.fixtureRoundMode) ||
        current.fixtureDatesCount,
    }));
  };

  const updateTimeSlot = (index, value) => {
    setForm((current) => {
      const nextSlots = [...current.matchTimeSlots];
      nextSlots[index] = value;

      return {
        ...current,
        matchTimeSlots: nextSlots,
      };
    });
  };

  const addTimeSlot = () => {
    setForm((current) => {
      if (current.matchTimeSlots.length >= 4) {
        return current;
      }

      return {
        ...current,
        matchTimeSlots: [...current.matchTimeSlots, ""],
      };
    });
  };

  const removeTimeSlot = (index) => {
    setForm((current) => {
      if (current.matchTimeSlots.length === 1) {
        return {
          ...current,
          matchTimeSlots: [""],
        };
      }

      return {
        ...current,
        matchTimeSlots: current.matchTimeSlots.filter((_, slotIndex) => slotIndex !== index),
      };
    });
  };

  const openTimePicker = (index) => {
    setActiveTimeSlotIndex(index);
    setTimePickerVisible(true);
  };

  const closeTimePicker = () => {
    setTimePickerVisible(false);
    setActiveTimeSlotIndex(-1);
  };

  const handleTimePickerChange = (_, selectedDate) => {
    if (!selectedDate) {
      closeTimePicker();
      return;
    }

    updateTimeSlot(activeTimeSlotIndex, formatTimeValue(selectedDate));

    if (Platform.OS !== "ios") {
      closeTimePicker();
    }
  };

  const showSuperTieBreakSettings = form.matchFormat === "two_sets_super_tiebreak";
  const showSingleSetSettings = form.matchFormat === "single_set";
  const paymentDefaults = normalizePaymentDefaults(userData?.leaguePaymentDefaults || {});
  const leagueHasOwnRoundPrice = Number(editingLeague?.paymentConfig?.roundPricePerPlayer || 0) > 0;
  const isUsingDefaultRoundPrice =
    isEditing && !leagueHasOwnRoundPrice && paymentDefaults.roundPricePerPlayer > 0;

  useEffect(() => {
    const name = userData?.localidad?.nombre || userData?.city || "";

    if (!name) {
      return;
    }

    setSelectedBaseLocation((current) => {
      if (current?.nombre) {
        return current;
      }

      return {
        nombre: name,
        provincia:
          userData?.localidad?.provincia ||
          userData?.province ||
          userData?.location?.provincia ||
          "",
        pais: userData?.localidad?.pais || userData?.location?.pais || "Argentina",
      };
    });
  }, [userData]);

  useEffect(() => {
    let isMounted = true;

    if (!isEditing) {
      setLoadingLeague(false);
      return () => {
        isMounted = false;
      };
    }

    const loadLeague = async () => {
      try {
        setLoadingLeague(true);
        const league = await getLeagueById(leagueId);

        if (!isMounted) {
          return;
        }

        setEditingLeague(league);
        setForm(buildFormFromLeague(league, userData));
        setSelectedBaseLocation(
          league?.localidad
            ? {
                nombre: league.localidad,
                provincia: league.provincia || "",
                pais: "Argentina",
              }
            : null
        );
        setBaseLocationInput("");
      } catch (error) {
        if (isMounted) {
          showFeedback(
            "No pudimos cargar la liga",
            error?.message || "Intenta nuevamente en unos instantes.",
            "danger"
          );
        }
      } finally {
        if (isMounted) {
          setLoadingLeague(false);
        }
      }
    };

    loadLeague();

    return () => {
      isMounted = false;
    };
  }, [isEditing, leagueId, userData?.leaguePaymentDefaults]);

  useEffect(() => {
    if (selectedGameMode !== "sum_fixed") {
      return;
    }

    if (
      form.fixedCategoryA &&
      !filteredFirstCategoryOptions.some((option) => option.value === form.fixedCategoryA)
    ) {
      setForm((current) => ({
        ...current,
        fixedCategoryA: "",
        fixedCategoryB: "",
      }));
      return;
    }

    if (
      form.fixedCategoryB &&
      !filteredSecondCategoryOptions.some((option) => option.value === form.fixedCategoryB)
    ) {
      setForm((current) => ({
        ...current,
        fixedCategoryB: "",
      }));
    }
  }, [
    filteredFirstCategoryOptions,
    filteredSecondCategoryOptions,
    form.fixedCategoryA,
    form.fixedCategoryB,
    selectedGameMode,
  ]);

  const validateForm = () => {
    if (!canCreateLeague) {
      showFeedback(
        "Acceso restringido",
        "Solo los organizadores aprobados pueden crear ligas.",
        "danger"
      );
      return false;
    }

    if (!form.name.trim()) {
      showFeedback("Falta el nombre", "Ingresa un nombre para la liga.", "danger");
      return false;
    }

    if (!selectedComplex) {
      showFeedback("Falta el complejo", "Selecciona un complejo organizador.", "danger");
      return false;
    }

    if (!selectedBaseLocation?.nombre) {
      showFeedback(
        "Falta la localidad base",
        "Selecciona la localidad base de la liga.",
        "danger"
      );
      return false;
    }

    if (form.matchDayMode === "fixed_day" && !form.matchDay) {
      showFeedback("Falta el dia", "Selecciona el dia fijo en el que se juega la liga.", "danger");
      return false;
    }

    const normalizedTimeSlots = normalizeTimeSlots(form.matchTimeSlots);

    if (normalizedTimeSlots.length === 0) {
      showFeedback(
        "Falta el horario",
        "Agrega al menos un horario posible para los partidos de la liga.",
        "danger"
      );
      return false;
    }

    if (!form.fixtureDatesCount || Number.parseInt(form.fixtureDatesCount, 10) < 1) {
      showFeedback(
        "Faltan las fechas",
        "Indica cuantas fechas quieres que tenga la liga.",
        "danger"
      );
      return false;
    }

    if (!form.fixtureMinPlayersCount || Number.parseInt(form.fixtureMinPlayersCount, 10) < 2) {
      showFeedback(
        form.teamType === "pair" ? "Faltan parejas" : "Faltan jugadores minimos",
        form.teamType === "pair"
          ? "Indica la cantidad de parejas fijas para esta liga."
          : "Indica la cantidad minima de jugadores para esta liga.",
        "danger"
      );
      return false;
    }

    const hasInvalidTimeSlot = normalizedTimeSlots.some((slot) => !isValidTimeValue(slot));

    if (hasInvalidTimeSlot) {
      showFeedback(
        "Horario invalido",
        "Usa horarios validos en formato 24 hs, por ejemplo 19:00 o 20:30.",
        "danger"
      );
      return false;
    }

    if (form.categoryFormat === "suma") {
      if (!form.sumTarget) {
        showFeedback("Falta la suma", "Selecciona que suma va a jugar la liga.", "danger");
        return false;
      }

      if (form.sumRule === "fixed") {
        if (!form.fixedCategoryA || !form.fixedCategoryB) {
          showFeedback(
            "Faltan categorias",
            "Selecciona las dos categorias fijas de la suma.",
            "danger"
          );
          return false;
        }

        const firstValue = Number.parseInt(form.fixedCategoryA, 10) || 0;
        const secondValue = Number.parseInt(form.fixedCategoryB, 10) || 0;
        const targetValue = Number.parseInt(form.sumTarget, 10) || 0;

        if (firstValue + secondValue !== targetValue) {
          showFeedback(
            "La suma no coincide",
            "Las categorias fijas deben coincidir exactamente con la suma seleccionada.",
            "danger"
          );
          return false;
        }
      }
    }

    if (form.categoryFormat !== "suma" && !form.fixedCategoryA) {
      showFeedback("Falta la categoria", "Selecciona la categoria de la liga.", "danger");
      return false;
    }

    const roundPrice = Number.parseFloat(String(form.roundPricePerPlayer || "").replace(",", "."));

    if (!Number.isFinite(roundPrice) || roundPrice <= 0) {
      showFeedback(
        "Falta el precio por fecha",
        "Indica el precio de cada fecha por jugador.",
        "danger"
      );
      return false;
    }

    if (form.registrationFeeMode === "yes") {
      const registrationFee = Number.parseFloat(
        String(form.registrationFeeAmount || "").replace(",", ".")
      );

      if (!Number.isFinite(registrationFee) || registrationFee <= 0) {
        showFeedback(
          "Falta la inscripcion",
          "Indica el monto de la inscripcion inicial.",
          "danger"
        );
        return false;
      }
    }

    if (showSingleSetSettings) {
      const singleSetPoints = Number.parseInt(form.singleSetPoints, 10);

      if (!Number.isInteger(singleSetPoints) || singleSetPoints <= 0) {
        showFeedback(
          "Falta el set",
          "Indica con un numero entero en cuantos puntos finaliza el set unico.",
          "danger"
        );
        return false;
      }
    }

    if (showSuperTieBreakSettings) {
      const superTieBreakPoints = Number.parseInt(form.superTieBreakPoints, 10);

      if (!Number.isInteger(superTieBreakPoints) || superTieBreakPoints <= 0) {
        showFeedback(
          "Falta el super tie break",
          "Indica con un numero entero en cuantos puntos finaliza el super tie break.",
          "danger"
        );
        return false;
      }
    }

    if (!form.pointsWin) {
      showFeedback(
        "Faltan puntos",
        "Define los puntos por partido ganado para esta configuracion.",
        "danger"
      );
      return false;
    }

    if (!form.replacementPenalty) {
      showFeedback(
        "Falta descuento",
        "Define cuantos puntos se descuentan por reemplazos.",
        "danger"
      );
      return false;
    }

    return true;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      setSubmitting(true);

      const payload = {
        name: form.name,
        complex: selectedComplex,
        baseLocation: selectedBaseLocation,
        matchDayMode: form.matchDayMode,
        matchDay: form.matchDayMode === "fixed_day" ? form.matchDay : "",
        matchTimeSlots: normalizeTimeSlots(form.matchTimeSlots),
        fixtureRoundMode: form.fixtureRoundMode,
        fixtureDatesCount: form.fixtureDatesCount,
        fixtureMinPlayersCount: form.fixtureMinPlayersCount,
        registrationFeeEnabled: form.registrationFeeMode === "yes",
        registrationFeeAmount: form.registrationFeeMode === "yes" ? form.registrationFeeAmount : "0",
        roundPricePerPlayer: form.roundPricePerPlayer,
        branch: form.branch,
        teamType: form.teamType,
        categoryFormat: form.categoryFormat,
        sumTarget: form.sumTarget,
        sumRule: form.sumRule,
        fixedCategoryA: form.fixedCategoryA,
        fixedCategoryB: form.fixedCategoryB,
        matchFormat: form.matchFormat,
        singleSetPoints: form.singleSetPoints,
        singleSetWinByTwo: form.singleSetWinByTwo,
        superTieBreakPoints: form.superTieBreakPoints,
        superTieBreakWinByTwo: form.superTieBreakWinByTwo,
        allowWalkover: form.allowWalkover,
        pointsWin: form.pointsWin || "0",
        pointsLoss: form.pointsLoss,
        pointsWalkoverWin: form.pointsWin,
        replacementPenalty: form.replacementPenalty,
        replacementPenaltyMode: form.replacementPenaltyMode,
        replacementQuota: form.replacementQuota || "0",
      };

      if (isEditing) {
        await updateLeague(leagueId, userData, payload, editingLeague);
        showFeedback(
          "Liga actualizada",
          "Los cambios se guardaron solo para esta liga.",
          "success"
        );
      } else {
        await createLeague(userData, payload);

        await updateProfile({
          leagueDefaults: normalizeLeagueDefaults({
            branch: form.branch,
            teamType: form.teamType,
            categoryFormat: form.categoryFormat,
            sumTarget: form.sumTarget,
            sumRule: form.sumRule,
            fixedCategoryA: form.fixedCategoryA,
            fixedCategoryB: form.fixedCategoryB,
            matchFormat: form.matchFormat,
            singleSetPoints: form.singleSetPoints,
            singleSetWinByTwo: form.singleSetWinByTwo,
            superTieBreakPoints: form.superTieBreakPoints,
            superTieBreakWinByTwo: form.superTieBreakWinByTwo,
            allowWalkover: form.allowWalkover,
            pointsWin: form.pointsWin || "0",
            pointsLoss: form.pointsLoss,
            pointsWalkoverWin: form.pointsWin,
            replacementPenalty: form.replacementPenalty,
            replacementPenaltyMode: form.replacementPenaltyMode,
            replacementQuota: form.replacementQuota || "0",
          }),
          leaguePaymentDefaults: buildPaymentDefaultsFromForm(form),
        });

        showFeedback(
          "Liga creada",
          "La liga se guardo correctamente y esta configuracion quedo como base para la proxima.",
          "success"
        );
      }
    } catch (error) {
      showFeedback(
        isEditing ? "No pudimos actualizar la liga" : "No pudimos crear la liga",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveAdditionalSettings = async () => {
    if (showSingleSetSettings) {
      const singleSetPoints = Number.parseInt(form.singleSetPoints, 10);

      if (!Number.isInteger(singleSetPoints) || singleSetPoints <= 0) {
        showFeedback(
          "Falta el set",
          "Indica con un numero entero en cuantos puntos finaliza el set unico.",
          "danger"
        );
        return;
      }
    }

    if (showSuperTieBreakSettings) {
      const superTieBreakPoints = Number.parseInt(form.superTieBreakPoints, 10);

      if (!Number.isInteger(superTieBreakPoints) || superTieBreakPoints <= 0) {
        showFeedback(
          "Falta el super tie break",
          "Indica con un numero entero en cuantos puntos finaliza el super tie break.",
          "danger"
        );
        return;
      }
    }

    if (isEditing) {
      setIsAdditionalVisible(false);
      showFeedback(
        "Ajustes listos",
        "Estos cambios se aplicaran solo a esta liga cuando guardes la edicion.",
        "success"
      );
      return;
    }

    try {
      setSavingAdditional(true);

      await updateProfile({
        leagueDefaults: normalizeLeagueDefaults({
          branch: form.branch,
          teamType: form.teamType,
          categoryFormat: form.categoryFormat,
          sumTarget: form.sumTarget,
          sumRule: form.sumRule,
          fixedCategoryA: form.fixedCategoryA,
          fixedCategoryB: form.fixedCategoryB,
          matchFormat: form.matchFormat,
          singleSetPoints: form.singleSetPoints,
          singleSetWinByTwo: form.singleSetWinByTwo,
          superTieBreakPoints: form.superTieBreakPoints,
          superTieBreakWinByTwo: form.superTieBreakWinByTwo,
          allowWalkover: form.allowWalkover,
          pointsWin: form.pointsWin || "0",
          pointsLoss: form.pointsLoss,
          pointsWalkoverWin: form.pointsWin,
          replacementPenalty: form.replacementPenalty,
          replacementPenaltyMode: form.replacementPenaltyMode,
          replacementQuota: form.replacementQuota || "0",
        }),
      });

      setIsAdditionalVisible(false);
      showFeedback(
        "Configuracion guardada",
        "La configuracion adicional quedo guardada como base para tus proximas ligas.",
        "success"
      );
    } catch (error) {
      showFeedback(
        "No pudimos guardar la configuracion",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setSavingAdditional(false);
    }
  };

  if (!canCreateLeague) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <SectionHeader onBack={() => navigation.goBack()} subtitle="Crear liga" />
        <View style={styles.backgroundOrbTop} />
        <View style={styles.backgroundOrbBottom} />

        <View style={styles.content}>
          <View style={styles.heroCard}>
            <Text style={styles.heroTitle}>Acceso restringido</Text>
            <Text style={styles.heroText}>
              Solo los organizadores aprobados pueden crear ligas. Si corresponde, pedi acceso
              desde tu perfil.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader
        onBack={() => navigation.goBack()}
        subtitle={isEditing ? "Editar liga" : "Crear liga"}
      />
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />

      {loadingLeague ? (
        <View style={styles.loaderWrap}>
          <ActivityIndicator color={colors.primaryDark} />
          <Text style={styles.loaderText}>Cargando datos de la liga...</Text>
        </View>
      ) : (
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
        style={styles.keyboardAvoidingWrap}
      >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <AppInput
            autoCapitalize="words"
            label="Nombre de la liga"
            labelStyle={styles.centeredFieldLabel}
            onChangeText={(value) => updateField("name", value.slice(0, 40))}
            placeholder="Ej. Clausura Zona Centro"
            value={form.name}
          />
          <SelectField
            containerStyle={styles.fieldSpacing}
            label="Complejo"
            labelStyle={styles.centeredFieldLabel}
            onClose={() => setIsComplexVisible(false)}
            onOpen={() => setIsComplexVisible(true)}
            onSelect={(value) => updateField("complexName", value)}
            options={organizerComplexOptions}
            placeholder="Selecciona un complejo"
            renderModalFooter={() => (
              <Pressable
                onPress={() => {
                  setIsComplexVisible(false);
                  setIsComplexRequestVisible(true);
                }}
                style={({ pressed }) => [
                  styles.requestComplexButton,
                  pressed && styles.requestComplexButtonPressed,
                ]}
              >
                <View style={styles.requestComplexIcon}>
                  <Ionicons color={colors.primaryDark} name="add" size={16} />
                </View>
                <View style={styles.requestComplexCopy}>
                  <Text style={styles.requestComplexTitle}>Agregar complejo</Text>
                </View>
              </Pressable>
            )}
            value={form.complexName}
            visible={isComplexVisible}
          />
          <LocationPicker
            containerStyle={styles.fieldSpacing}
            inputStyle={styles.baseLocationInput}
            label="Localidad"
            labelStyle={styles.centeredFieldLabel}
            onChangeText={setBaseLocationInput}
            onSelect={setSelectedBaseLocation}
            placeholder="Buscar localidad"
            selectedLocation={selectedBaseLocation}
            value={baseLocationInput}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitleCentered}>Tipo de liga</Text>
          <ChipGroup
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                teamType: value,
                fixtureDatesCount:
                  calculateRecommendedFixtureDates(
                    value,
                    current.fixtureMinPlayersCount,
                    current.fixtureRoundMode
                  ) || current.fixtureDatesCount,
              }))
            }
            options={LEAGUE_TEAM_TYPE_OPTIONS}
            value={form.teamType}
          />

          <ChipGroup
            onChange={(value) => updateField("branch", value)}
            options={LEAGUE_BRANCH_OPTIONS}
            value={form.branch}
            wrapStyle={styles.secondaryChipGroup}
          />

          <ChipGroup
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                categoryFormat: value === "single" ? "libre" : "suma",
                sumRule: value === "sum_fixed" ? "fixed" : "open",
                sumTarget: value === "single" ? "" : current.sumTarget,
                fixedCategoryA: value === "sum_open" ? "" : current.fixedCategoryA,
                fixedCategoryB: value === "sum_fixed" ? current.fixedCategoryB : "",
              }))
            }
            options={CATEGORY_FORMAT_OPTIONS}
            value={selectedGameMode}
            wrapStyle={styles.secondaryChipGroup}
          />

          {selectedGameMode === "single" ? (
            <View style={styles.sumCard}>
              <SelectField
                label="Categoria"
                onClose={() => setIsCategoryAVisible(false)}
                onOpen={() => setIsCategoryAVisible(true)}
                onSelect={(value) => updateField("fixedCategoryA", value)}
                options={LEAGUE_CATEGORY_OPTIONS}
                placeholder="Selecciona una categoria"
                value={form.fixedCategoryA}
                visible={isCategoryAVisible}
              />
            </View>
          ) : null}

          {form.categoryFormat === "suma" ? (
            <View style={styles.sumCard}>
              <SelectField
                label=""
                onClose={() => setIsSumVisible(false)}
                onOpen={() => setIsSumVisible(true)}
                onSelect={(value) => updateField("sumTarget", value)}
                options={LEAGUE_SUM_TARGET_OPTIONS}
                placeholder="Selecciona una suma"
                value={form.sumTarget}
                visible={isSumVisible}
              />

              {selectedGameMode === "sum_fixed" ? (
                <View style={styles.sumSelectorsRow}>
                  <SelectField
                    containerStyle={styles.sumField}
                    label={form.branch === "Mixto" ? "Caballeros" : "Categoria 1"}
                    labelStyle={styles.centeredFieldLabel}
                    onClose={() => setIsCategoryAVisible(false)}
                    onOpen={() => setIsCategoryAVisible(true)}
                    onSelect={(value) =>
                      setForm((current) => ({
                        ...current,
                        fixedCategoryA: value,
                        fixedCategoryB: "",
                      }))
                    }
                    options={filteredFirstCategoryOptions}
                    placeholder="Elegir"
                    value={form.fixedCategoryA}
                    visible={isCategoryAVisible}
                  />
                  <SelectField
                    containerStyle={styles.sumField}
                    label={form.branch === "Mixto" ? "Damas" : "Categoria 2"}
                    labelStyle={styles.centeredFieldLabel}
                    onClose={() => setIsCategoryBVisible(false)}
                    onOpen={() => setIsCategoryBVisible(true)}
                    onSelect={(value) => updateField("fixedCategoryB", value)}
                    options={filteredSecondCategoryOptions}
                    placeholder="Elegir"
                    value={form.fixedCategoryB}
                    visible={isCategoryBVisible}
                  />
                </View>
              ) : (
                <Text style={styles.helperInlineText}>
                  En suma libre solo elegis la suma objetivo.
                </Text>
              )}
            </View>
          ) : null}

          <View style={styles.sumPreview}>
            <Text style={styles.sumPreviewLabel}>Como se publica</Text>
            <Text style={styles.sumPreviewValue}>{sumPreview}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitleCentered}>Dia y horarios de juego</Text>
          <ChipGroup
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                matchDayMode: value,
                matchDay: value === "fixed_day" ? current.matchDay || "tuesday" : "",
              }))
            }
            options={MATCH_DAY_MODE_OPTIONS}
            value={form.matchDayMode}
          />

          {form.matchDayMode === "fixed_day" ? (
            <>
              <Text style={styles.subsectionLabel}>Dia fijo de la semana</Text>
              <ChipGroup
                onChange={(value) => updateField("matchDay", value)}
                options={MATCH_DAY_OPTIONS}
                value={form.matchDay}
                wrapStyle={styles.secondaryChipGroup}
              />
            </>
          ) : (
            <Text style={styles.helperInlineText}>
              Cada fecha se coordina con la contra durante la semana en curso.
            </Text>
          )}

          <View style={styles.scheduleHeaderRow}>
            <Text style={styles.subsectionLabel}>Horarios posibles</Text>
            {form.matchTimeSlots.length < 4 ? (
              <Pressable
                onPress={addTimeSlot}
                style={({ pressed }) => [
                  styles.addSlotButton,
                  pressed ? styles.additionalButtonPressed : null,
                ]}
              >
                <Ionicons color={colors.primaryDark} name="add" size={15} />
                <Text style={styles.addSlotButtonText}>Agregar horario</Text>
              </Pressable>
            ) : null}
          </View>

          {form.matchTimeSlots.map((slot, index) => (
            <View key={`slot-${index}`} style={styles.scheduleSlotRow}>
              <View style={[styles.wrapperField, styles.scheduleSlotInput]}>
                <Text style={[styles.centeredFieldLabel, !index ? null : styles.hiddenFieldLabel]}>
                  Horario
                </Text>
                <Pressable
                  onPress={() => openTimePicker(index)}
                  style={({ pressed }) => [
                    styles.scheduleTimeButton,
                    pressed ? styles.additionalButtonPressed : null,
                  ]}
                >
                  <Text style={[styles.scheduleTimeButtonText, !slot ? styles.scheduleTimePlaceholder : null]}>
                    {slot || "Selecciona un horario"}
                  </Text>
                  <Ionicons color={colors.primaryDark} name="time-outline" size={18} />
                </Pressable>
              </View>
              <Pressable
                disabled={form.matchTimeSlots.length === 1}
                onPress={() => removeTimeSlot(index)}
                style={({ pressed }) => [
                  styles.removeSlotButton,
                  form.matchTimeSlots.length === 1 ? styles.removeSlotButtonDisabled : null,
                  pressed && form.matchTimeSlots.length > 1 ? styles.additionalButtonPressed : null,
                ]}
              >
                <Ionicons color="#B04343" name="trash-outline" size={16} />
              </Pressable>
            </View>
          ))}

          <Text style={styles.scheduleHelperText}>
            Puedes cargar entre 1 y 4 horarios. Ejemplos validos: 18:00, 19:30, 21:00.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitleCentered}>Duracion de la liga</Text>
          <Text style={styles.subsectionLabel}>Formato del fixture</Text>
          <ChipGroup
            onChange={updateFixtureRoundMode}
            options={FIXTURE_ROUND_MODE_OPTIONS}
            value={form.fixtureRoundMode}
            wrapStyle={styles.secondaryChipGroup}
          />
          <View style={styles.compactInlineFieldRow}>
            <Text style={styles.compactInlineFieldLabel}>
              {form.teamType === "pair"
                ? "Cantidad de Parejas fijas"
                : "Cantidad de jugadores minimos"}
            </Text>
            <TextInput
              keyboardType="number-pad"
              maxLength={2}
              onChangeText={updateFixtureMinPlayersCount}
              placeholder={form.teamType === "pair" ? "8" : "16"}
              placeholderTextColor={colors.muted}
              style={styles.compactInlineFieldInput}
              value={form.fixtureMinPlayersCount}
            />
          </View>
          <View style={styles.compactInlineFieldRow}>
            <Text style={styles.compactInlineFieldLabel}>Cantidad de fechas recomendadas</Text>
            <TextInput
              keyboardType="number-pad"
              maxLength={2}
              onChangeText={(value) => updateField("fixtureDatesCount", sanitizeInteger(value).slice(0, 2))}
              placeholder="6"
              placeholderTextColor={colors.muted}
              style={styles.compactInlineFieldInput}
              value={form.fixtureDatesCount}
            />
          </View>
          <Text style={styles.helperInlineText}>
            Al indicar la cantidad de parejas o jugadores, sugerimos las fechas para ida o ida y
            vuelta. Puedes ajustar ese numero antes de guardar.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitleCentered}>Valores de la liga</Text>
          <Text style={styles.subsectionLabel}>Inscripcion inicial</Text>
          <ChipGroup
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                registrationFeeMode: value,
                registrationFeeAmount: value === "yes" ? current.registrationFeeAmount : "",
              }))
            }
            options={REGISTRATION_FEE_OPTIONS}
            value={form.registrationFeeMode}
            wrapStyle={styles.secondaryChipGroup}
          />

          {form.registrationFeeMode === "yes" ? (
            <View style={styles.compactInlineFieldRow}>
              <Text style={styles.compactInlineFieldLabel}>Monto de inscripcion</Text>
              <TextInput
                keyboardType="decimal-pad"
                onChangeText={(value) => updateField("registrationFeeAmount", sanitizeDecimal(value))}
                placeholder="0"
                placeholderTextColor={colors.muted}
                style={styles.compactInlineFieldInput}
                value={form.registrationFeeAmount}
              />
            </View>
          ) : null}

          <View style={styles.compactInlineFieldRow}>
            <Text style={styles.compactInlineFieldLabel}>Precio por fecha por jugador</Text>
            <TextInput
              keyboardType="decimal-pad"
              onChangeText={(value) => updateField("roundPricePerPlayer", sanitizeDecimal(value))}
              placeholder="0"
              placeholderTextColor={colors.muted}
              style={styles.compactInlineFieldInput}
              value={form.roundPricePerPlayer}
            />
          </View>
          <Text style={styles.helperInlineText}>
            {isEditing
              ? isUsingDefaultRoundPrice
                ? "Este valor viene de Finanzas. Si lo modificas aca, se aplicara solo a esta liga."
                : "Estos importes se aplican solo a esta liga y no modifican tus valores predeterminados."
              : "Estos importes se guardan como predeterminados para tus proximas ligas."}
          </Text>
        </View>

        <Pressable
          onPress={() => setIsAdditionalVisible(true)}
          style={({ pressed }) => [
            styles.additionalButton,
            pressed && styles.additionalButtonPressed,
          ]}
        >
          <View style={styles.additionalButtonIcon}>
            <Ionicons color={colors.surface} name="settings-outline" size={18} />
          </View>
          <View style={styles.additionalButtonCopy}>
            <Text style={styles.additionalButtonTitle}>
              {isEditing ? "Ajustes de esta liga" : "Configuracion Adicional de Ligas"}
            </Text>
            <Text style={styles.additionalButtonText}>
              {isEditing
                ? "Edita formato y puntuacion solo para esta liga."
                : "Define formato y puntuacion base para tus proximas ligas."}
            </Text>
          </View>
          <Ionicons color={colors.primaryDark} name="chevron-forward" size={18} />
        </Pressable>

        {isEditing ? (
          <View style={styles.editActionsRow}>
            <AppButton
              disabled={submitting}
              onPress={handleSubmit}
              style={styles.editActionButton}
              textStyle={styles.editActionPrimaryText}
              title={submitting ? "Guardando..." : "Guardar cambios"}
            />
            <AppButton
              disabled={submitting}
              onPress={() => navigation.goBack()}
              style={[styles.editActionButton, styles.cancelActionButton]}
              textStyle={styles.cancelActionText}
              title="Cancelar"
              variant="secondary"
            />
          </View>
        ) : (
          <AppButton
            disabled={submitting}
            onPress={handleSubmit}
            style={styles.submitButton}
            title={submitting ? "Creando liga..." : "Crear liga"}
          />
        )}
      </ScrollView>
      </KeyboardAvoidingView>
      )}

      {timePickerVisible && activeTimeSlotIndex >= 0 ? (
        <DateTimePicker
          display={Platform.OS === "ios" ? "spinner" : "clock"}
          is24Hour
          mode="time"
          onChange={handleTimePickerChange}
          value={buildDateFromTime(form.matchTimeSlots[activeTimeSlotIndex])}
        />
      ) : null}

      <FeedbackModal
        message={feedback.message}
        onClose={() => {
          const shouldGoBack =
            feedback.title === "Liga creada" || feedback.title === "Liga actualizada";
          setFeedback((current) => ({
            ...current,
            visible: false,
          }));

          if (shouldGoBack) {
            navigation.goBack();
          }
        }}
        title={feedback.title}
        tone={feedback.tone}
        visible={feedback.visible}
      />
      <OrganizerRequestModal
        mode="add-complex-request"
        onClose={() => setIsComplexRequestVisible(false)}
        onSaved={() => setIsComplexRequestVisible(false)}
        user={userData}
        visible={isComplexRequestVisible}
      />

      <Modal
        animationType="slide"
        onRequestClose={() => setIsAdditionalVisible(false)}
        transparent
        visible={isAdditionalVisible}
      >
        <View style={styles.modalOverlay}>
          <Pressable onPress={() => setIsAdditionalVisible(false)} style={styles.modalBackdrop} />
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>
              {isEditing ? "Ajustes de esta liga" : "Configuracion Predeterminada"}
            </Text>

            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.card}>
                <Text style={styles.sectionTitleCentered}>Cantidad de Sets</Text>
                <ChipGroup
                  onChange={(value) => updateField("matchFormat", value)}
                  options={MATCH_FORMAT_OPTIONS.map(({ description, ...option }) => option)}
                  value={form.matchFormat}
                />
              </View>

              {showSingleSetSettings ? (
                <View style={[styles.card, styles.compactConfigCard]}>
                  <Text style={styles.sectionTitleCompact}>1 Solo Set</Text>
                  <InlineNumberField
                    label="Finaliza en Puntos:"
                    keyboardType="number-pad"
                    labelStyle={styles.inlineFieldLabelCompact}
                    onChangeText={(value) =>
                      updateField("singleSetPoints", sanitizeInteger(value))
                    }
                    placeholder="6"
                    rowStyle={styles.inlineFieldRowTight}
                    value={form.singleSetPoints}
                  />
                  <View style={styles.inlineFieldRowCompact}>
                    <Text style={styles.inlineFieldLabel}>Diferencia de 2</Text>
                    <View style={styles.inlinePenaltyOptions}>
                      {form.singleSetWinByTwo ? (
                        <Pressable
                          onPress={() => updateField("singleSetWinByTwo", false)}
                          style={[styles.penaltyModeChip, styles.penaltyModeChipActive]}
                        >
                          <Text style={[styles.penaltyModeChipText, styles.penaltyModeChipTextActive]}>
                            Si
                          </Text>
                        </Pressable>
                      ) : (
                        <Pressable
                          onPress={() => updateField("singleSetWinByTwo", true)}
                          style={[styles.penaltyModeChip, styles.penaltyModeChipActive]}
                        >
                          <Text style={[styles.penaltyModeChipText, styles.penaltyModeChipTextActive]}>
                            No
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                </View>
              ) : null}

              {showSuperTieBreakSettings ? (
                <View style={[styles.card, styles.compactConfigCard]}>
                  <Text style={styles.sectionTitleCompact}>Super Tie Break</Text>
                  <InlineNumberField
                    label="Finaliza en Puntos:"
                    keyboardType="number-pad"
                    labelStyle={styles.inlineFieldLabelCompact}
                    onChangeText={(value) =>
                      updateField("superTieBreakPoints", sanitizeInteger(value))
                    }
                    placeholder="10"
                    rowStyle={styles.inlineFieldRowTight}
                    value={form.superTieBreakPoints}
                  />
                  <View style={styles.inlineFieldRowCompact}>
                    <Text style={styles.inlineFieldLabel}>Diferencia de 2</Text>
                    <View style={styles.inlinePenaltyOptions}>
                      {form.superTieBreakWinByTwo ? (
                        <Pressable
                          onPress={() => updateField("superTieBreakWinByTwo", false)}
                          style={[styles.penaltyModeChip, styles.penaltyModeChipActive]}
                        >
                          <Text style={[styles.penaltyModeChipText, styles.penaltyModeChipTextActive]}>
                            Si
                          </Text>
                        </Pressable>
                      ) : (
                        <Pressable
                          onPress={() => updateField("superTieBreakWinByTwo", true)}
                          style={[styles.penaltyModeChip, styles.penaltyModeChipActive]}
                        >
                          <Text style={[styles.penaltyModeChipText, styles.penaltyModeChipTextActive]}>
                            No
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                </View>
              ) : null}

              <View style={styles.card}>
                <Text style={styles.sectionTitleCentered}>Sistema de Puntuacion</Text>
                <InlineNumberField
                  label="Partido Ganado"
                  labelStyle={[styles.inlineFieldLabelLeft, styles.inlineFieldLabelScore]}
                  rightContent={<Text style={styles.inlineFieldSuffix}>Puntos</Text>}
                  inputWrapStyle={styles.inlineInputWrapScore}
                  rowStyle={styles.inlineFieldRowScore}
                  onChangeText={(value) => updateField("pointsWin", sanitizeDecimal(value))}
                  value={form.pointsWin}
                />
                <InlineNumberField
                  label={"Perdedor suma\npor set ganado"}
                  labelStyle={[styles.inlineFieldLabelLeft, styles.inlineFieldLabelScore]}
                  rightContent={<Text style={styles.inlineFieldSuffix}>Puntos</Text>}
                  inputWrapStyle={styles.inlineInputWrapScore}
                  rowStyle={styles.inlineFieldRowScore}
                  onChangeText={(value) => updateField("pointsLoss", sanitizeDecimal(value))}
                  placeholder="0"
                  value={form.pointsLoss}
                />
                <InlineNumberField
                  label={"Descuento por\nReemplazo"}
                  labelStyle={[styles.inlineFieldLabelLeft, styles.inlineFieldLabelScore]}
                  rightContent={<Text style={styles.inlineFieldSuffix}>Puntos</Text>}
                  inputWrapStyle={styles.inlineInputWrapScore}
                  rowStyle={styles.inlineFieldRowScore}
                  onChangeText={(value) =>
                    updateField("replacementPenalty", sanitizeDecimal(value))
                  }
                  value={form.replacementPenalty}
                />
                <View style={styles.replacementModeRow}>
                  <Text style={[styles.inlineFieldLabel, styles.inlineFieldLabelLeft, styles.inlineFieldLabelScore]}>
                    Aplicar descuento por reemplazo
                  </Text>
                  <View style={styles.inlinePenaltyOptions}>
                    {form.replacementPenaltyMode === "individual" ? (
                      <Pressable
                        onPress={() => updateField("replacementPenaltyMode", "pair")}
                        style={[styles.penaltyModeChip, styles.penaltyModeChipActive]}
                      >
                        <Text style={[styles.penaltyModeChipText, styles.penaltyModeChipTextActive]}>
                          Individual
                        </Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        onPress={() => updateField("replacementPenaltyMode", "individual")}
                        style={[styles.penaltyModeChip, styles.penaltyModeChipActive]}
                      >
                        <Text style={[styles.penaltyModeChipText, styles.penaltyModeChipTextActive]}>
                          Pareja
                        </Text>
                      </Pressable>
                    )}
                  </View>
                </View>
                <Text style={styles.replacementModeHint}>
                  Individual: descuenta por cada integrante ausente. Pareja: Es indistinto si
                  falta 1 o ambos, se descuenta el mismo puntaje.
                </Text>
                <InlineNumberField
                  label="Cupo de Remplazo"
                  keyboardType="number-pad"
                  labelStyle={[styles.inlineFieldLabelLeft, styles.inlineFieldLabelScore]}
                  rightContent={<Text style={styles.inlineFieldSuffix}>Usos</Text>}
                  inputWrapStyle={styles.inlineInputWrapScore}
                  rowStyle={styles.inlineFieldRowScore}
                  onChangeText={(value) => updateField("replacementQuota", sanitizeInteger(value))}
                  placeholder="0"
                  value={form.replacementQuota}
                />
                <Text style={styles.replacementModeHint}>
                  Cantidad de reemplazos permitidos sin aplicar descuento de puntaje.
                </Text>
              </View>

              <View style={styles.modalActions}>
                <Pressable
                  onPress={() => setIsAdditionalVisible(false)}
                  style={styles.modalSecondaryButton}
                >
                  <Text style={styles.modalSecondaryButtonText}>Cerrar</Text>
                </Pressable>
                <Pressable
                  disabled={savingAdditional}
                  onPress={handleSaveAdditionalSettings}
                  style={[
                    styles.modalPrimaryButton,
                    savingAdditional && styles.modalPrimaryButtonDisabled,
                  ]}
                >
                  <Text style={styles.modalPrimaryButtonText}>
                    {savingAdditional
                      ? "Guardando..."
                      : isEditing
                      ? "Aplicar a esta liga"
                      : "Guardar configuracion"}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardAvoidingWrap: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: 4,
    paddingBottom: spacing.xl + 120,
  },
  backgroundOrbTop: {
    position: "absolute",
    top: -40,
    right: -30,
    width: 190,
    height: 190,
    borderRadius: 999,
    backgroundColor: "rgba(31,171,137,0.12)",
  },
  backgroundOrbBottom: {
    position: "absolute",
    left: -70,
    bottom: 110,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(11,132,87,0.08)",
  },
  heroCard: {
    backgroundColor: "#EAF6F1",
    borderColor: "#CDE5D8",
    borderRadius: 24,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.lg,
  },
  heroTitle: {
    color: colors.primaryDark,
    fontSize: 20,
    fontWeight: "800",
  },
  heroText: {
    color: "#3F6458",
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  loaderWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  loaderText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
    marginTop: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.md,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3,
  },
  compactConfigCard: {
    paddingTop: 12,
    paddingBottom: 10,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    marginBottom: spacing.sm,
  },
  sectionTitleCentered: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  sectionTitleCompact: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 4,
    textAlign: "center",
  },
  subsectionTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  centeredFieldLabel: {
    textAlign: "center",
  },
  hiddenFieldLabel: {
    opacity: 0,
  },
  wrapperField: {
    flex: 1,
    marginBottom: 6,
  },
  fieldSpacing: {
    marginBottom: 0,
  },
  baseLocationInput: {
    textAlign: "center",
  },
  requestComplexButton: {
    alignItems: "center",
    backgroundColor: "#EEF7F3",
    borderColor: "#CDE5D8",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "center",
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  requestComplexButtonPressed: {
    opacity: 0.92,
  },
  requestComplexIcon: {
    alignItems: "center",
    backgroundColor: "#D9EEE5",
    borderRadius: 999,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  requestComplexCopy: {
    marginLeft: spacing.sm,
  },
  requestComplexTitle: {
    color: colors.primaryDark,
    fontSize: 14,
    fontWeight: "800",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  secondaryChipGroup: {
    marginTop: spacing.xs,
  },
  chip: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minWidth: "31%",
    minHeight: 44,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  chipActive: {
    backgroundColor: "#EEF3D6",
    borderColor: "#C9D39A",
  },
  chipText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 14,
    textAlign: "center",
  },
  chipTextActive: {
    color: colors.text,
  },
  chipDescription: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 4,
  },
  chipDescriptionActive: {
    color: colors.muted,
  },
  sumCard: {
    marginTop: spacing.sm,
  },
  sumSelectorsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  sumField: {
    flex: 1,
  },
  helperInlineText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  sumPreview: {
    backgroundColor: "#F4FAF7",
    borderColor: "#D2E8DD",
    borderRadius: 18,
    borderWidth: 1,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  sumPreviewLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  sumPreviewValue: {
    color: colors.primaryDark,
    fontSize: 16,
    fontWeight: "800",
    marginTop: 4,
  },
  infoCard: {
    alignItems: "center",
    backgroundColor: "#F7FBF9",
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  infoCardText: {
    color: colors.muted,
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
    marginLeft: spacing.sm,
  },
  scoreGrid: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  scoreField: {
    flex: 1,
  },
  scoreSingleField: {
    marginTop: spacing.sm,
  },
  inlineFieldRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  inlineFieldRowTight: {
    marginTop: 6,
  },
  inlineFieldRowScore: {
    justifyContent: "flex-start",
    paddingHorizontal: 0,
  },
  inlineFieldRowCompact: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  replacementModeRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  inlineFieldLabel: {
    color: colors.text,
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 18,
    textAlign: "center",
  },
  inlineFieldLabelLeft: {
    textAlign: "left",
  },
  inlineFieldLabelScore: {
    flex: 0,
    width: 130,
  },
  inlineFieldLabelCompact: {
    lineHeight: 34,
  },
  inlineRightGroup: {
    alignItems: "center",
    justifyContent: "center",
  },
  inlineFieldSuffix: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    marginLeft: spacing.xs,
    minWidth: 48,
    textAlign: "left",
  },
  inlineInputWrap: {
    alignItems: "center",
    alignSelf: "center",
    height: 34,
    width: 112,
    justifyContent: "center",
  },
  inlineInputWrapDisabled: {
    opacity: 0.55,
  },
  inlineInputWrapScore: {
    marginLeft: 0,
  },
  inlineInputContainer: {
    marginBottom: 0,
    width: "100%",
  },
  hiddenInlineInputLabel: {
    display: "none",
  },
  inlineInput: {
    height: 34,
    width: "100%",
    paddingVertical: 0,
    textAlign: "center",
  },
  inlinePenaltyOptions: {
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    width: 112,
  },
  replacementModeHint: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
    marginTop: spacing.xs,
  },
  penaltyModeChip: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: "center",
    height: 34,
    width: 112,
    paddingHorizontal: 6,
  },
  penaltyModeChipActive: {
    backgroundColor: "#EEF3D6",
    borderColor: "#C9D39A",
  },
  penaltyModeChipText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
  },
  penaltyModeChipTextActive: {
    color: colors.text,
  },
  walkoverRow: {
    alignItems: "center",
    backgroundColor: "#FFF8E8",
    borderColor: "#F2D89C",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  walkoverTextWrap: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  walkoverTitle: {
    color: "#8A5700",
    fontSize: 15,
    fontWeight: "800",
  },
  walkoverText: {
    color: "#8A6A2A",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3,
  },
  walkoverBadge: {
    alignItems: "center",
    backgroundColor: "#F4E1B6",
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 30,
    paddingHorizontal: 10,
  },
  walkoverBadgeActive: {
    backgroundColor: "#B87407",
  },
  walkoverBadgeText: {
    color: "#8A5700",
    fontSize: 12,
    fontWeight: "800",
  },
  walkoverBadgeTextActive: {
    color: colors.surface,
  },
  submitButton: {
    marginTop: spacing.xs,
  },
  subsectionLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
    marginTop: spacing.sm,
    textAlign: "center",
  },
  scheduleHeaderRow: {
    alignItems: "center",
    flexDirection: "column",
    justifyContent: "center",
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  compactInlineFieldRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  compactInlineFieldLabel: {
    color: colors.text,
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
  },
  compactInlineFieldInput: {
    width: 54,
    minHeight: 40,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    textAlign: "center",
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
    paddingVertical: 0,
  },
  addSlotButton: {
    alignItems: "center",
    backgroundColor: "#EAF6F1",
    borderColor: "#CDE5D8",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  addSlotButtonText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
    marginLeft: 4,
  },
  scheduleSlotRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  scheduleSlotInput: {
    flex: 1,
    marginBottom: 0,
  },
  scheduleTimeButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: spacing.md,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  scheduleTimeButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  scheduleTimePlaceholder: {
    color: colors.muted,
    fontWeight: "500",
  },
  removeSlotButton: {
    alignItems: "center",
    backgroundColor: "#FFF1F1",
    borderColor: "#E9B4B4",
    borderRadius: 16,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    marginBottom: 6,
    width: 42,
  },
  removeSlotButtonDisabled: {
    opacity: 0.45,
  },
  scheduleHelperText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 18,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  editActionsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  editActionButton: {
    flex: 1,
    marginBottom: 0,
    minHeight: 46,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
  },
  editActionPrimaryText: {
    textAlign: "center",
  },
  cancelActionButton: {
    backgroundColor: "#FFF1F1",
    borderColor: "#E9B4B4",
  },
  cancelActionText: {
    color: "#B04343",
    textAlign: "center",
  },
  additionalButton: {
    alignItems: "center",
    backgroundColor: "#EAF6F1",
    borderColor: "#CDE5D8",
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: "row",
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  additionalButtonPressed: {
    opacity: 0.92,
  },
  additionalButtonIcon: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 14,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  additionalButtonCopy: {
    flex: 1,
    paddingHorizontal: spacing.sm,
  },
  additionalButtonTitle: {
    color: colors.primaryDark,
    fontSize: 15,
    fontWeight: "800",
  },
  additionalButtonText: {
    color: "#48685D",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
    marginTop: 2,
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  modalSheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: "90%",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  modalHandle: {
    alignSelf: "center",
    backgroundColor: colors.border,
    borderRadius: 999,
    height: 5,
    marginBottom: spacing.md,
    width: 56,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
  },
  modalText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    textAlign: "center",
  },
  modalActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  modalSecondaryButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
  },
  modalSecondaryButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  modalPrimaryButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 16,
    flex: 1.4,
    justifyContent: "center",
    minHeight: 46,
  },
  modalPrimaryButtonDisabled: {
    opacity: 0.7,
  },
  modalPrimaryButtonText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: "800",
  },
});

