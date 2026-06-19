import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { SafeAreaView } from "react-native-safe-area-context";
import { getDownloadURL, ref, uploadBytes } from "../../services/firebaseStorage";

import BottomQuickActionsBar, {
  BOTTOM_QUICK_ACTIONS_SPACE,
} from "../components/BottomQuickActionsBar";
import FeedbackModal from "../components/FeedbackModal";
import PadelNexoLoadingOverlay from "../components/PadelNexoLoadingOverlay";
import SectionFilterBar from "../components/SectionFilterBar";
import SectionHeader from "../components/SectionHeader";
import { getMercadoPagoReturnUrls } from "../config/mercadoPago";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import {
  buildPublicationMercadoPagoConfig,
  isMercadoPagoCategoryEnabled,
  normalizeMercadoPagoConfig,
} from "../services/mercadoPagoConfigService";
import {
  createTurnoMercadoPagoPreference,
  persistPendingTurnoCheckout,
} from "../services/mercadoPagoCheckoutService";
import { sendChatMessage } from "../services/chatService";
import {
  calculateDistanceKm,
  geocodeAddress,
  getCoordinatesFromObject,
  requestCurrentLocation,
} from "../services/locationService";
import { listPlayers } from "../services/playersService";
import { isApprovedOrganizer } from "../services/roleService";
import {
  addTurnoReservationPayment,
  createTurnoReservation,
  getOrganizerTurnosConfig,
  listOrganizerTurnoReservations,
  listBookableComplexes,
  saveOrganizerTurnosConfig,
  updateTurnoReservationStatus,
} from "../services/turnosService";
import { sendTurnoReservationStatusMessage } from "../services/turnosNotificationsService";
import { storage } from "../../services/firebaseConfig";

const DURATIONS = [60, 90];
const BASE_PAYMENT_METHODS = [
  { key: "efectivo", label: "Efectivo" },
  { key: "transferencia", label: "Transferencia" },
];
const ASSIGNMENT_PAYMENT_METHODS = [
  { key: "a_confirmar", label: "A confirmar" },
  ...BASE_PAYMENT_METHODS,
];
const HALF_HOUR_SLOTS = Array.from({ length: 32 }, (_, index) => {
  const totalMinutes = 8 * 60 + index * 30;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
});
const SLOT_ROW_SIZE = 4;
const SAME_DAY_BOOKING_TOLERANCE_MINUTES = 15;
const COMPLEX_MANAGEMENT_COLORS = [
  { background: "#EEF6FF", border: "#8FC6EC", text: "#155B86" },
  { background: "#F1FBFF", border: "#9EDCF3", text: "#2095BD" },
];
const COMPLEX_AVAILABILITY_COLORS = [
  { background: "#EAF8F3", border: "#92D4BE", text: "#12624E" },
  { background: "#F0FBF7", border: "#B5E5D5", text: "#2F9478" },
];
const PROXIMITY_RADIUS_OPTIONS = [5, 10, 20, 50];

function buildComplexDistanceKey(complex = {}) {
  return `${complex.organizerId || "organizer"}|${complex.complexKey || complex.name || "complex"}`;
}

function buildComplexGeocodeCandidates(complex = {}) {
  const city = complex.city || complex.organizerCity || "";
  const province = complex.province || complex.organizerProvince || "";

  return [
    [complex.address, city, province, "Argentina"].filter(Boolean).join(", "),
    [complex.name, city, province, "Argentina"].filter(Boolean).join(", "),
    [city, province, "Argentina"].filter(Boolean).join(", "),
  ].filter(Boolean);
}

function normalizeText(value = "") {
  return String(value || "").trim().toLowerCase();
}

function buildNextSevenDays() {
  const formatterDay = new Intl.DateTimeFormat("es-AR", { weekday: "short" });
  const formatterMonth = new Intl.DateTimeFormat("es-AR", { month: "short" });
  const today = new Date();

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() + index);
    date.setHours(0, 0, 0, 0);

    return {
      id: String(date.getTime()),
      dayKey: String(date.getDay()),
      dayName: formatterDay.format(date).replace(".", "").toUpperCase(),
      dayNumber: date.getDate(),
      monthName: formatterMonth.format(date).replace(".", "").toUpperCase(),
      dateMillis: date.getTime(),
      compact: date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }),
      fullLabel: date.toLocaleDateString("es-AR", {
        day: "2-digit",
        month: "long",
        weekday: "long",
      }),
    };
  });
}

function buildCalendarDays(daysAhead = 35) {
  const formatterDay = new Intl.DateTimeFormat("es-AR", { weekday: "short" });
  const formatterMonth = new Intl.DateTimeFormat("es-AR", { month: "short" });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekStartsOnMondayOffset = (today.getDay() + 6) % 7;
  const firstCalendarDay = new Date(today);
  firstCalendarDay.setDate(today.getDate() - weekStartsOnMondayOffset);

  return Array.from({ length: daysAhead }, (_, index) => {
    const date = new Date(firstCalendarDay);
    date.setDate(firstCalendarDay.getDate() + index);
    date.setHours(0, 0, 0, 0);
    const dateMillis = date.getTime();

    return {
      id: String(dateMillis),
      dayKey: String(date.getDay()),
      dayName: formatterDay.format(date).replace(".", "").toUpperCase(),
      dayNumber: date.getDate(),
      isDisabled: dateMillis < today.getTime(),
      isToday: dateMillis === today.getTime(),
      monthName: formatterMonth.format(date).replace(".", "").toUpperCase(),
    };
  });
}

function formatCurrency(value = 0) {
  const amount = Number(value || 0);

  return amount.toLocaleString("es-AR", {
    currency: "ARS",
    maximumFractionDigits: 0,
    style: "currency",
  });
}

function formatTurnoPaymentMethodLabel(method = "") {
  if (method === "transferencia") {
    return "Transferencia";
  }

  if (method === "mercado_pago") {
    return "Mercado Pago";
  }

  if (method === "a_confirmar") {
    return "A confirmar";
  }

  return "Efectivo";
}

function getTurnoReservationPaymentSummary(reservation = {}) {
  const totalAmount = Number(reservation?.paymentTotalAmount || reservation?.price || 0);
  const paidAmount = Math.min(
    totalAmount,
    Number(reservation?.paymentPaidAmount || 0)
  );
  const pendingAmount = Math.max(
    0,
    Math.round((totalAmount - paidAmount) * 100) / 100
  );
  const paymentMovements = Array.isArray(reservation?.paymentMovements)
    ? [...reservation.paymentMovements].sort(
        (first, second) => Number(second?.createdAtMillis || 0) - Number(first?.createdAtMillis || 0)
      )
    : [];

  return {
    paymentMovements,
    paidAmount,
    pendingAmount,
    totalAmount,
  };
}

function getTurnoReservationPaymentStatusLabel(reservation = {}) {
  const summary = getTurnoReservationPaymentSummary(reservation);

  if (summary.pendingAmount <= 0 && summary.totalAmount > 0) {
    return "Pagado";
  }

  if (summary.paidAmount > 0) {
    return "Pago parcial";
  }

  if (reservation?.paymentStatus === "in_review") {
    return "Transferencia";
  }

  if (reservation?.paymentStatus === "to_be_defined" || reservation?.paymentMethod === "a_confirmar") {
    return "A confirmar";
  }

  return "Pendiente";
}

function formatReservationPaymentMovementDate(millis = 0) {
  const value = Number(millis || 0);

  if (!value) {
    return "";
  }

  return new Date(value).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizePhoneNumber(value = "") {
  return String(value || "").replace(/[^\d]/g, "");
}

function buildWhatsAppPhoneNumber(phone = "", countryCode = "+54") {
  const phoneDigits = normalizePhoneNumber(phone);
  const countryDigits = normalizePhoneNumber(countryCode || "+54") || "54";

  if (!phoneDigits) {
    return "";
  }

  if (phoneDigits.startsWith(countryDigits)) {
    return countryDigits === "54" && !phoneDigits.startsWith("549")
      ? `549${phoneDigits.slice(2)}`
      : phoneDigits;
  }

  if (countryDigits === "54") {
    const localDigits = phoneDigits.replace(/^0+/, "").replace(/^15/, "");

    return localDigits.startsWith("9") ? `54${localDigits}` : `549${localDigits}`;
  }

  return `${countryDigits}${phoneDigits.replace(/^0+/, "")}`;
}

function buildReservationContactMessage(reservation = {}) {
  return encodeURIComponent(buildReservationConfirmationText(reservation));
}

function buildReservationConfirmationText(reservation = {}, options = {}) {
  const safeReservation = reservation || {};
  const title = options.boldTitle ? "**Tu reserva fue confirmada.**" : "Tu reserva fue confirmada.";

  return [
    title,
    "",
    `Complejo: ${safeReservation.complexName || "A confirmar"}`,
    `Cancha: ${safeReservation.courtName || "A confirmar"}`,
    `Fecha: ${safeReservation.dateLabel || "A confirmar"}`,
    `Horario: ${safeReservation.time || "A confirmar"} hs`,
    `Duracion: ${safeReservation.durationMinutes || 60} min`,
  ].join("\n");
}

function buildReservationCancellationText(reservation = {}, options = {}) {
  const safeReservation = reservation || {};
  const title = options.boldTitle ? "**Tu reserva fue cancelada.**" : "Tu reserva fue cancelada.";

  return [
    title,
    "",
    `Complejo: ${safeReservation.complexName || "A confirmar"}`,
    `Cancha: ${safeReservation.courtName || "A confirmar"}`,
    `Fecha: ${safeReservation.dateLabel || "A confirmar"}`,
    `Horario: ${safeReservation.time || "A confirmar"} hs`,
    `Duracion: ${safeReservation.durationMinutes || 60} min`,
  ].join("\n");
}

function buildReservationCancellationWhatsAppMessage(reservation = {}) {
  return encodeURIComponent(buildReservationCancellationText(reservation));
}

function isReservationActive(reservation = {}) {
  const safeReservation = reservation || {};

  return !["cancelled", "rejected"].includes(String(safeReservation.status || ""));
}

function getReservationStatusLabel(reservation = {}) {
  const safeReservation = reservation || {};

  if (safeReservation.status === "cancelled") {
    return "CANCELADA";
  }

  if (safeReservation.status === "rejected") {
    return "RECHAZADA";
  }

  if (safeReservation.status === "pending_organizer_confirmation") {
    return "PENDIENTE";
  }

  return "CONFIRMADA";
}

function getCourtSlots(court = {}, dayKey = "") {
  const slots = court?.slotsByDay?.[dayKey] || [];

  return Array.isArray(slots) ? slots : [];
}

function getCourtSlotsForDate(court = {}, day = {}) {
  const dateSlots = court?.slotsByDate?.[String(day.dateMillis)] || null;

  return Array.isArray(dateSlots) ? dateSlots : getCourtSlots(court, day.dayKey);
}

function isPastSlotForDay(day = {}, slot = "") {
  const slotMinutes = parseSlotToMinutes(slot);

  if (slotMinutes === null || !day?.dateMillis) {
    return false;
  }

  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  if (Number(day.dateMillis) !== today.getTime()) {
    return false;
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  return currentMinutes > slotMinutes + SAME_DAY_BOOKING_TOLERANCE_MINUTES;
}

function getReservableCourtSlots(court = {}, day = {}) {
  return getCourtSlotsForDate(court, day).filter((slot) => !isPastSlotForDay(day, slot));
}

function getAvailableCourtSlots(court = {}, day = {}) {
  const reservedSlots = new Set(court?.reservedSlotsByDate?.[String(day.dateMillis)] || []);

  return getReservableCourtSlots(court, day).filter((slot) => !reservedSlots.has(slot));
}

function parseSlotToMinutes(slot = "") {
  const [hours, minutes] = String(slot || "")
    .split(":")
    .map((part) => Number.parseInt(part, 10));

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }

  return hours * 60 + minutes;
}

function formatSlotFromMinutes(totalMinutes = 0) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function buildSlotBlocks(slot = "", durationMinutes = 60) {
  const startMinutes = parseSlotToMinutes(slot);
  const blockCount = Math.max(1, Math.ceil(Number(durationMinutes || 60) / 30));

  if (startMinutes === null) {
    return [];
  }

  return Array.from({ length: blockCount }, (_, index) =>
    formatSlotFromMinutes(startMinutes + index * 30)
  );
}

function isDurationAvailable(court = {}, day = {}, slot = "", durationMinutes = 60) {
  const configuredSlotSet = new Set(getReservableCourtSlots(court, day));
  const reservedSlotSet = new Set(court?.reservedSlotsByDate?.[String(day.dateMillis)] || []);

  return (
    configuredSlotSet.has(slot) &&
    buildSlotBlocks(slot, durationMinutes).every((slotBlock) => !reservedSlotSet.has(slotBlock))
  );
}

function getCourtEnvironmentLabel(court = {}) {
  const rawValue =
    court.environment ||
    court.coverage ||
    court.tipoAmbiente ||
    court.ambiente ||
    court.cubierta ||
    court.techada ||
    "";
  const normalizedValue = normalizeText(rawValue);

  if (court.isIndoor === true || court.indoor === true || normalizedValue.includes("cub")) {
    return "Cubierta";
  }

  if (
    normalizedValue.includes("descub") ||
    court.isOutdoor === true ||
    court.outdoor === true ||
    normalizedValue.includes("aire") ||
    normalizedValue.includes("libre")
  ) {
    return "Aire libre";
  }

  return "Ambiente a confirmar";
}

function getCourtManagementDetails(court = {}) {
  const detailLabels = [
    ...(Array.isArray(court.features) ? court.features : []),
    court.structure,
    court.floor === "cemento" ? "Piso cemento" : court.floor,
    getCourtEnvironmentLabel(court),
  ]
    .flatMap((label) => String(label || "").split(/\n|-/))
    .map((label) => label.trim())
    .filter(Boolean)
    .filter((label) => normalizeText(label) !== "ambiente a confirmar");

  return Array.from(
    new Map(detailLabels.map((label) => [normalizeText(label), label.toUpperCase()])).values()
  );
}

function getCourtPrice(court = null, duration = 60) {
  if (!court) {
    return 0;
  }

  return duration === 90 ? Number(court.price90 || 0) : Number(court.price60 || 0);
}

function hasAvailableTurnosForComplex(complex = {}, day = {}) {
  return (complex.availableCourts || []).some(
    (court) => getAvailableCourtSlots(court, day).length > 0
  );
}

function chunkSlots(slots = [], size = SLOT_ROW_SIZE) {
  return Array.from({ length: Math.ceil(slots.length / size) }, (_, index) =>
    slots.slice(index * size, index * size + size)
  );
}

function buildSavedPriceByCourt(config = {}) {
  return Object.fromEntries(
    (config?.complexes || []).flatMap((complex) =>
      (complex.courts || []).map((court) => [
        `${complex.complexKey}|${court.id}`,
        {
          price60: String(court.price60 || ""),
          price90: String(court.price90 || ""),
        },
      ])
    )
  );
}

function getSavedConfigDateIdsForCourt(court = {}) {
  if (Array.isArray(court.selectedDateIds) && court.selectedDateIds.length) {
    return court.selectedDateIds.map(String);
  }

  return Object.entries(court.slotsByDate || {})
    .filter(([, slots]) => Array.isArray(slots) && slots.length > 0)
    .map(([dateId]) => String(dateId));
}

async function uploadTurnoProof(asset = {}, playerId = "") {
  if (!asset?.uri) {
    return { proofFileName: "", proofUrl: "" };
  }

  const response = await fetch(asset.uri);
  const blob = await response.blob();
  const originalName = asset.name || asset.fileName || "";
  const extension = originalName.split(".").pop() || "jpg";
  const fileName = `${playerId || "jugador"}-${Date.now()}.${extension}`;
  const proofRef = ref(storage, `turno-payment-proofs/${playerId || "sin-usuario"}/${fileName}`);

  await uploadBytes(proofRef, blob, {
    contentType: blob.type || asset.mimeType || "application/octet-stream",
  });

  return {
    proofFileName: fileName,
    proofUrl: await getDownloadURL(proofRef),
  };
}

export default function TurnosScreen({ navigation, route }) {
  const { userData } = useAuth();
  const canManageTurnos = isApprovedOrganizer(userData);
  const organizerMercadoPagoConfig = useMemo(
    () => normalizeMercadoPagoConfig(userData?.mercadoPagoConfig),
    [userData?.mercadoPagoConfig]
  );
  const currentUserId = userData?.uid || userData?.id || "";
  const [activeLocations, setActiveLocations] = useState([]);
  const [complexes, setComplexes] = useState([]);
  const [organizerConfig, setOrganizerConfig] = useState(null);
  const [organizerReservations, setOrganizerReservations] = useState([]);
  const [savedOrganizerConfigSignature, setSavedOrganizerConfigSignature] = useState("");
  const [savedPriceByCourt, setSavedPriceByCourt] = useState({});
  const [hasLocalConfigChanges, setHasLocalConfigChanges] = useState(false);
  const [selectedConfigCourtByComplex, setSelectedConfigCourtByComplex] = useState({});
  const [selectedPriceCourtIdsByComplex, setSelectedPriceCourtIdsByComplex] = useState({});
  const [priceApplyContext, setPriceApplyContext] = useState(null);
  const [selectedConfigDateIds, setSelectedConfigDateIds] = useState([]);
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [assignmentModeOpen, setAssignmentModeOpen] = useState(false);
  const [playersDirectory, setPlayersDirectory] = useState([]);
  const [playerPickerVisible, setPlayerPickerVisible] = useState(false);
  const [playerQuery, setPlayerQuery] = useState("");
  const [selectedReservationPlayer, setSelectedReservationPlayer] = useState(null);
  const [guestReservationName, setGuestReservationName] = useState("");
  const [guestReservationLastName, setGuestReservationLastName] = useState("");
  const [guestReservationPhone, setGuestReservationPhone] = useState("");
  const [reservationsModalVisible, setReservationsModalVisible] = useState(canManageTurnos);
  const [reservationDetail, setReservationDetail] = useState(null);
  const [paymentEntryVisible, setPaymentEntryVisible] = useState(false);
  const [paymentEntryAmount, setPaymentEntryAmount] = useState("");
  const [paymentEntryMethod, setPaymentEntryMethod] = useState("efectivo");
  const [paymentEntryReceiptAsset, setPaymentEntryReceiptAsset] = useState(null);
  const [paymentEntryReturnToPrevious, setPaymentEntryReturnToPrevious] = useState(false);
  const [savingReservationPayment, setSavingReservationPayment] = useState(false);
  const [whatsAppConfirmationReservation, setWhatsAppConfirmationReservation] = useState(null);
  const [runningReservationActionId, setRunningReservationActionId] = useState("");
  const [selectedOrganizerComplexKey, setSelectedOrganizerComplexKey] = useState("");
  const [isOrganizerComplexPickerOpen, setIsOrganizerComplexPickerOpen] = useState(false);
  const [selectedComplexId, setSelectedComplexId] = useState("");
  const [selectedCourtId, setSelectedCourtId] = useState("");
  const [selectedDayId, setSelectedDayId] = useState("");
  const [selectedSlot, setSelectedSlot] = useState("");
  const [selectedDuration, setSelectedDuration] = useState(90);
  const [paymentMethod, setPaymentMethod] = useState("efectivo");
  const [receiptAsset, setReceiptAsset] = useState(null);
  const [summaryVisible, setSummaryVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingFocusedReservation, setLoadingFocusedReservation] = useState(
    Boolean(route?.params?.focusReservationId)
  );
  const [savingConfig, setSavingConfig] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [locationActionsVisible, setLocationActionsVisible] = useState(false);
  const [locatingUser, setLocatingUser] = useState(false);
  const [proximityFilter, setProximityFilter] = useState({
    enabled: false,
    radiusKm: 10,
    userCoordinates: null,
  });
  const [complexCoordinatesByKey, setComplexCoordinatesByKey] = useState({});
  const [feedback, setFeedback] = useState({
    visible: false,
    title: "",
    message: "",
    tone: "default",
  });

  const days = useMemo(buildNextSevenDays, []);
  const calendarDays = useMemo(buildCalendarDays, []);
  const calendarRows = useMemo(() => chunkSlots(calendarDays, 7), [calendarDays]);
  const today = days[0];
  const organizerComplexes = organizerConfig?.complexes || [];
  const selectedOrganizerComplex = useMemo(
    () =>
      organizerComplexes.find((complex) => complex.complexKey === selectedOrganizerComplexKey) ||
      organizerComplexes[0] ||
      null,
    [organizerComplexes, selectedOrganizerComplexKey]
  );
  const selectedOrganizerComplexIndex = Math.max(
    0,
    organizerComplexes.findIndex(
      (complex) => complex.complexKey === selectedOrganizerComplex?.complexKey
    )
  );
  const priceApplyComplex = useMemo(
    () =>
      organizerComplexes.find((complex) => complex.complexKey === priceApplyContext?.complexKey) ||
      null,
    [organizerComplexes, priceApplyContext]
  );
  const priceApplyCourt = useMemo(
    () =>
      (priceApplyComplex?.courts || []).find(
        (court) => court.id === priceApplyContext?.sourceCourtId
      ) || null,
    [priceApplyComplex, priceApplyContext]
  );

  const userLocalidad = useMemo(() => {
    const name = userData?.localidad?.nombre || userData?.city || "";

    if (!name) {
      return null;
    }

    return {
      nombre: name,
      provincia:
        userData?.localidad?.provincia || userData?.province || userData?.location?.provincia || "",
      pais: userData?.localidad?.pais || userData?.location?.pais || "Argentina",
    };
  }, [userData]);

  useEffect(() => {
    if (!proximityFilter.enabled || !proximityFilter.userCoordinates || !complexes.length) {
      return undefined;
    }

    let isCancelled = false;

    const geocodeMissingComplexes = async () => {
      const missingComplexes = complexes.filter((complex) => {
        const key = buildComplexDistanceKey(complex);
        return !getCoordinatesFromObject(complex) && !complexCoordinatesByKey[key];
      });

      for (const complex of missingComplexes) {
        const key = buildComplexDistanceKey(complex);
        const addressCandidates = buildComplexGeocodeCandidates(complex);

        for (const address of addressCandidates) {
          try {
            const coordinates = await geocodeAddress(address);

            if (isCancelled) {
              return;
            }

            if (coordinates) {
              setComplexCoordinatesByKey((current) => ({
                ...current,
                [key]: coordinates,
              }));
              break;
            }
          } catch (error) {
            // Intentamos con el siguiente dato disponible de la sede.
          }
        }
      }
    };

    geocodeMissingComplexes();

    return () => {
      isCancelled = true;
    };
  }, [
    complexes,
    complexCoordinatesByKey,
    proximityFilter.enabled,
    proximityFilter.userCoordinates,
  ]);

  const complexesWithDistance = useMemo(
    () =>
      complexes.map((complex) => {
        const key = buildComplexDistanceKey(complex);
        const coordinates = getCoordinatesFromObject(complex) || complexCoordinatesByKey[key];
        const distanceKm = proximityFilter.userCoordinates
          ? calculateDistanceKm(proximityFilter.userCoordinates, coordinates)
          : null;

        return {
          ...complex,
          distanceKm,
        };
      }),
    [complexCoordinatesByKey, complexes, proximityFilter.userCoordinates]
  );

  const filteredComplexes = useMemo(() => {
    if (proximityFilter.enabled && proximityFilter.userCoordinates) {
      return [...complexesWithDistance].sort((first, second) => {
        const firstDistance = Number.isFinite(first.distanceKm)
          ? first.distanceKm
          : Number.MAX_SAFE_INTEGER;
        const secondDistance = Number.isFinite(second.distanceKm)
          ? second.distanceKm
          : Number.MAX_SAFE_INTEGER;
        const firstIsInsideRadius = firstDistance <= proximityFilter.radiusKm;
        const secondIsInsideRadius = secondDistance <= proximityFilter.radiusKm;

        if (firstIsInsideRadius !== secondIsInsideRadius) {
          return firstIsInsideRadius ? -1 : 1;
        }

        return firstDistance - secondDistance;
      });
    }

    if (!activeLocations.length) {
      return complexesWithDistance;
    }

    const locationNames = activeLocations.map((location) => normalizeText(location.nombre));

    return complexesWithDistance.filter((complex) =>
      locationNames.some((locationName) => {
        const searchableLocation = normalizeText(
          [
            complex.name,
            complex.address,
            complex.city,
            complex.province,
            complex.organizerCity,
            complex.organizerProvince,
          ].join(" ")
        );

        return searchableLocation.includes(locationName);
      })
    );
  }, [activeLocations, complexesWithDistance, proximityFilter]);
  const visibleComplexes = useMemo(
    () =>
      !proximityFilter.enabled &&
      activeLocations.length > 0 &&
      filteredComplexes.length === 0 &&
      complexes.length > 0
        ? complexes
        : filteredComplexes,
    [activeLocations.length, complexes, filteredComplexes, proximityFilter.enabled]
  );
  const reservationComplexes = useMemo(
    () => {
      if (canManageTurnos) {
        return complexes.filter((complex) => complex.organizerId === currentUserId);
      }

      if (visibleComplexes.length) {
        return visibleComplexes;
      }

      return complexesWithDistance.length ? complexesWithDistance : complexes;
    },
    [canManageTurnos, complexes, complexesWithDistance, currentUserId, visibleComplexes]
  );

  const selectedComplex = useMemo(
    () => reservationComplexes.find((complex) => complex.complexKey === selectedComplexId) || null,
    [reservationComplexes, selectedComplexId]
  );
  const selectedCourt = useMemo(
    () => selectedComplex?.availableCourts?.find((court) => court.id === selectedCourtId) || null,
    [selectedComplex, selectedCourtId]
  );
  const selectedComplexMercadoPagoConfig = useMemo(
    () =>
      selectedComplex?.mercadoPagoConfig
        ? {
            ...buildPublicationMercadoPagoConfig(organizerMercadoPagoConfig, "turnos"),
            ...selectedComplex.mercadoPagoConfig,
          }
        : buildPublicationMercadoPagoConfig(organizerMercadoPagoConfig, "turnos"),
    [organizerMercadoPagoConfig, selectedComplex?.mercadoPagoConfig]
  );
  const paymentMethods = useMemo(() => {
    if (canManageTurnos) {
      return ASSIGNMENT_PAYMENT_METHODS;
    }

    if (!canManageTurnos && isMercadoPagoCategoryEnabled(selectedComplexMercadoPagoConfig, "turnos")) {
      return [
        ...BASE_PAYMENT_METHODS,
        { key: "mercado_pago", label: "Mercado Pago" },
      ];
    }

    return BASE_PAYMENT_METHODS;
  }, [canManageTurnos, selectedComplexMercadoPagoConfig]);
  const selectedDay = useMemo(
    () => days.find((day) => day.id === selectedDayId) || days[0],
    [days, selectedDayId]
  );
  const availableSlots = useMemo(
    () => getAvailableCourtSlots(selectedCourt, selectedDay),
    [selectedCourt, selectedDay]
  );
  const allCourtSlots = useMemo(
    () => getReservableCourtSlots(selectedCourt, selectedDay),
    [selectedCourt, selectedDay]
  );
  const complexAvailabilityByDay = useMemo(
    () =>
      Object.fromEntries(
        reservationComplexes.map((complex) => [
          complex.complexKey,
          hasAvailableTurnosForComplex(complex, selectedDay),
        ])
      ),
    [reservationComplexes, selectedDay]
  );
  const availableSlotSet = useMemo(() => new Set(availableSlots), [availableSlots]);
  const selectedPrice = getCourtPrice(selectedCourt, selectedDuration);
  const showReservationFlow = !canManageTurnos || assignmentModeOpen;
  const filteredPlayersDirectory = useMemo(() => {
    const normalizedQuery = normalizeText(playerQuery);

    if (!normalizedQuery) {
      return playersDirectory;
    }

    return playersDirectory.filter((player) =>
      normalizeText(
        [
          player.nombre,
          player.apellido,
          player.categoria,
          player.ciudad,
          player.provincia,
        ].join(" ")
      ).includes(normalizedQuery)
    );
  }, [playerQuery, playersDirectory]);
  const organizerConfigSignature = useMemo(
    () => JSON.stringify(organizerConfig || {}),
    [organizerConfig]
  );
  const hasUnsavedConfigChanges =
    canManageTurnos &&
    Boolean(organizerConfig) &&
    (hasLocalConfigChanges ||
      (Boolean(savedOrganizerConfigSignature) &&
        organizerConfigSignature !== savedOrganizerConfigSignature));

  const showFeedback = (title, message, tone = "default") => {
    setFeedback({
      visible: true,
      title,
      message,
      tone,
    });
  };

  const handleUseCurrentLocation = async () => {
    try {
      setLocatingUser(true);
      const userCoordinates = await requestCurrentLocation();

      setProximityFilter((current) => ({
        ...current,
        enabled: true,
        userCoordinates,
      }));
      setLocationActionsVisible(false);
      showFeedback(
        "Ubicacion activada",
        `Vamos a mostrar complejos dentro de ${proximityFilter.radiusKm} km.`,
        "success"
      );
    } catch (error) {
      showFeedback(
        "No pudimos usar tu ubicacion",
        error?.message || "Revisa los permisos de ubicacion del telefono.",
        "danger"
      );
    } finally {
      setLocatingUser(false);
    }
  };

  const handleDisableProximityFilter = () => {
    setProximityFilter((current) => ({
      ...current,
      enabled: false,
      userCoordinates: null,
    }));
    setLocationActionsVisible(false);
  };

  const renderLocationFilterRow = () => (
    <View style={styles.filterLocationRow}>
      <SectionFilterBar
        containerStyle={styles.headerFilterBar}
        hideLeadingIcon
        onChange={({ locations }) => setActiveLocations(locations)}
        renderExtraContent={() => (
          <View>
            <Text style={styles.modalLabel}>Complejo</Text>
            <View style={styles.placeholderField}>
              <Ionicons color={colors.muted} name="business-outline" size={16} />
              <Text style={styles.placeholderFieldText}>
                Primero elegi un complejo y luego una cancha disponible.
              </Text>
            </View>
          </View>
        )}
        userLocation={userLocalidad}
      />
      <Pressable
        onPress={() => setLocationActionsVisible(true)}
        style={({ pressed }) => [
          styles.locationActionButton,
          proximityFilter.enabled ? styles.locationActionButtonActive : null,
          pressed ? styles.pressedState : null,
        ]}
      >
        <Ionicons
          color={proximityFilter.enabled ? colors.surface : colors.primaryDark}
          name="location-outline"
          size={20}
        />
      </Pressable>
    </View>
  );

  const loadData = async () => {
    try {
      setLoading(true);
      const [nextComplexes, nextOrganizerConfig, nextOrganizerReservations] = await Promise.all([
        listBookableComplexes(),
        canManageTurnos
          ? getOrganizerTurnosConfig(currentUserId, userData)
          : Promise.resolve(null),
        canManageTurnos ? listOrganizerTurnoReservations(currentUserId) : Promise.resolve([]),
      ]);
      const nextPlayersDirectory = canManageTurnos ? await listPlayers() : [];

      setComplexes(nextComplexes);
      setOrganizerReservations(nextOrganizerReservations);
      setReservationDetail((current) =>
        current
          ? nextOrganizerReservations.find((reservation) => reservation.id === current.id) || current
          : current
      );
      setPlayersDirectory(nextPlayersDirectory);
      setOrganizerConfig(nextOrganizerConfig);
      setSavedOrganizerConfigSignature(JSON.stringify(nextOrganizerConfig || {}));
      setSavedPriceByCourt(buildSavedPriceByCourt(nextOrganizerConfig || {}));
      setHasLocalConfigChanges(false);
      setSelectedDayId((current) => current || days[0]?.id || "");
      setSelectedConfigDateIds((current) => {
        if (current.length) {
          return current;
        }

        const firstCourt = nextOrganizerConfig?.complexes?.[0]?.courts?.[0];
        const savedDateIds = getSavedConfigDateIdsForCourt(firstCourt);

        return savedDateIds.length ? savedDateIds : days[0]?.id ? [days[0].id] : [];
      });
      setSelectedOrganizerComplexKey((current) =>
        current || nextOrganizerConfig?.complexes?.[0]?.complexKey || ""
      );
    } catch (error) {
      showFeedback(
        "No pudimos cargar turnos",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageTurnos, currentUserId]);

  useEffect(() => {
    if (route?.params?.focusReservationId) {
      setLoadingFocusedReservation(true);
    }
  }, [route?.params?.focusReservationId]);

  useEffect(() => {
    const focusReservationId = route?.params?.focusReservationId;
    const shouldOpenPaymentEntry = route?.params?.openPaymentEntry === true;

    if (!canManageTurnos || !focusReservationId || !organizerReservations.length) {
      if (!focusReservationId) {
        setLoadingFocusedReservation(false);
      }
      return;
    }

    const targetReservation = organizerReservations.find(
      (reservation) => reservation.id === focusReservationId
    );

    if (!targetReservation) {
      setLoadingFocusedReservation(false);
      navigation.setParams({ focusReservationId: undefined, openPaymentEntry: undefined });
      return;
    }

    setReservationsModalVisible(true);
    setAssignmentModeOpen(false);
    setSelectedOrganizerComplexKey(targetReservation.complexKey || "");
    setSelectedDayId(String(targetReservation.dateMillis || ""));
    if (shouldOpenPaymentEntry) {
      setPaymentEntryReturnToPrevious(true);
      openReservationPaymentEntry(targetReservation);
    } else {
      setPaymentEntryReturnToPrevious(false);
      setReservationDetail(targetReservation);
    }
    setLoadingFocusedReservation(false);
    navigation.setParams({ focusReservationId: undefined, openPaymentEntry: undefined });
  }, [
    canManageTurnos,
    navigation,
    organizerReservations,
    route?.params?.focusReservationId,
    route?.params?.openPaymentEntry,
  ]);

  useEffect(() => {
    if (!canManageTurnos || !assignmentModeOpen || reservationComplexes.length !== 1) {
      return;
    }

    const [onlyComplex] = reservationComplexes;

    if (onlyComplex?.complexKey && selectedComplexId !== onlyComplex.complexKey) {
      handleSelectComplex(onlyComplex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentModeOpen, canManageTurnos, reservationComplexes.length, selectedComplexId]);

  const handleSelectComplex = (complex) => {
    setSelectedComplexId(complex.complexKey);
    setSelectedCourtId("");
    setSelectedSlot("");
    setSelectedDuration(90);
    setSummaryVisible(false);
  };

  const resetAssignmentFlow = () => {
    setSelectedComplexId("");
    setSelectedCourtId("");
    setSelectedSlot("");
    setSelectedDuration(90);
    setSelectedReservationPlayer(null);
    setSummaryVisible(false);
  };

  const closeReservationsManagement = () => {
    setReservationsModalVisible(false);
    setAssignmentModeOpen(false);
    resetAssignmentFlow();
  };

  const handleToggleAssignmentMode = () => {
    if (assignmentModeOpen) {
      setAssignmentModeOpen(false);
      resetAssignmentFlow();
      return;
    }

    setReservationsModalVisible(true);
    setAssignmentModeOpen(true);
  };

  const handleSelectCourt = (court) => {
    setSelectedCourtId(court.id);
    setSelectedSlot("");
    setSelectedDuration(90);
    setSummaryVisible(false);
  };

  const handleSelectSlot = (slot) => {
    setSelectedSlot(slot);
    const nextDuration = isDurationAvailable(selectedCourt, selectedDay, slot, 90)
      ? 90
      : DURATIONS.find((duration) => isDurationAvailable(selectedCourt, selectedDay, slot, duration));

    setSelectedDuration(nextDuration || 90);
    setSummaryVisible(false);
  };

  const updateCourtConfig = (complexKey, courtId, patch) => {
    setHasLocalConfigChanges(true);
    setOrganizerConfig((current) => ({
      ...current,
      complexes: (current?.complexes || []).map((complex) =>
        complex.complexKey !== complexKey
          ? complex
          : {
              ...complex,
              courts: (complex.courts || []).map((court) =>
                court.id === courtId ? { ...court, ...patch } : court
              ),
            }
      ),
    }));
  };

  const updateOrganizerApprovalConfig = (requiresOrganizerApproval) => {
    setHasLocalConfigChanges(true);
    setOrganizerConfig((current) => ({
      ...(current || {}),
      requiresOrganizerApproval,
    }));
  };

  const getSelectedConfigCourt = (complex = {}) => {
    const courts = Array.isArray(complex.courts) ? complex.courts : [];
    const selectedCourtId = selectedConfigCourtByComplex[complex.complexKey] || courts[0]?.id || "";

    return courts.find((court) => court.id === selectedCourtId) || courts[0] || null;
  };

  useEffect(() => {
    if (!canManageTurnos || !selectedOrganizerComplex) {
      return;
    }

    const selectedCourt = getSelectedConfigCourt(selectedOrganizerComplex);
    const savedDateIds = getSavedConfigDateIdsForCourt(selectedCourt);

    setSelectedConfigDateIds(savedDateIds.length ? savedDateIds : days[0]?.id ? [days[0].id] : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    canManageTurnos,
    selectedOrganizerComplexKey,
    selectedConfigCourtByComplex[selectedOrganizerComplexKey],
  ]);

  const getSelectedPriceCourtIds = (complex = {}, fallbackCourtId = "") => {
    const selectedIds = selectedPriceCourtIdsByComplex[complex.complexKey] || [];

    return selectedIds.length ? selectedIds : fallbackCourtId ? [fallbackCourtId] : [];
  };

  const togglePriceCourt = (complex = {}, courtId = "") => {
    if (!courtId) {
      return;
    }

    setSelectedPriceCourtIdsByComplex((current) => {
      const currentIds = current[complex.complexKey] || [];
      const nextIds = currentIds.includes(courtId)
        ? currentIds.filter((selectedCourtId) => selectedCourtId !== courtId)
        : [...currentIds, courtId];

      return {
        ...current,
        [complex.complexKey]: nextIds,
      };
    });
  };

  const openPriceApplyModal = (complex = {}, sourceCourt = {}) => {
    setSelectedPriceCourtIdsByComplex((current) => ({
      ...current,
      [complex.complexKey]: current[complex.complexKey]?.length
        ? current[complex.complexKey]
        : sourceCourt.id
          ? [sourceCourt.id]
          : [],
    }));
    setPriceApplyContext({
      complexKey: complex.complexKey,
      sourceCourtId: sourceCourt.id,
    });
  };

  const applyPriceToSelectedCourts = () => {
    const complex = organizerComplexes.find(
      (item) => item.complexKey === priceApplyContext?.complexKey
    );
    const sourceCourt = (complex?.courts || []).find(
      (court) => court.id === priceApplyContext?.sourceCourtId
    );
    const selectedCourtIds = getSelectedPriceCourtIds(complex, sourceCourt?.id);

    if (!complex || !sourceCourt || !selectedCourtIds.length) {
      showFeedback(
        "Selecciona canchas",
        "Marca al menos una cancha para aplicar el precio.",
        "danger"
      );
      return;
    }

    setHasLocalConfigChanges(true);
    setOrganizerConfig((current) => ({
      ...current,
      complexes: (current?.complexes || []).map((currentComplex) =>
        currentComplex.complexKey !== complex.complexKey
          ? currentComplex
          : {
              ...currentComplex,
              courts: (currentComplex.courts || []).map((court) =>
                selectedCourtIds.includes(court.id)
                  ? {
                      ...court,
                      price60: sourceCourt.price60,
                      price90: sourceCourt.price90,
                    }
                  : court
              ),
            }
      ),
    }));

    showFeedback(
      "Precios aplicados",
      "Los precios se copiaron a las canchas seleccionadas. Guarda para confirmarlos.",
      "success"
    );
    setPriceApplyContext(null);
  };

  const toggleConfigDate = (dateId = "") => {
    if (!dateId) {
      return;
    }

    const nextDateIds = selectedConfigDateIds.includes(dateId)
      ? selectedConfigDateIds.filter((currentDateId) => currentDateId !== dateId)
      : [...selectedConfigDateIds, dateId];
    const selectedCourt = getSelectedConfigCourt(selectedOrganizerComplex || {});

    setSelectedConfigDateIds(nextDateIds);
    if (selectedOrganizerComplex?.complexKey && selectedCourt?.id) {
      updateCourtConfig(selectedOrganizerComplex.complexKey, selectedCourt.id, {
        selectedDateIds: nextDateIds,
      });
    }
  };

  const setConfigDateSelection = (nextDateIds = []) => {
    const selectedCourt = getSelectedConfigCourt(selectedOrganizerComplex || {});
    const uniqueDateIds = [...new Set(nextDateIds.map(String))];

    setSelectedConfigDateIds(uniqueDateIds);
    if (selectedOrganizerComplex?.complexKey && selectedCourt?.id) {
      updateCourtConfig(selectedOrganizerComplex.complexKey, selectedCourt.id, {
        selectedDateIds: uniqueDateIds,
      });
    }
  };

  const toggleConfigDateRow = (dateIds = []) => {
    const rowIsComplete = dateIds.every((dateId) => selectedConfigDateIds.includes(dateId));

    setConfigDateSelection(
      rowIsComplete
        ? selectedConfigDateIds.filter((dateId) => !dateIds.includes(dateId))
        : [...selectedConfigDateIds, ...dateIds]
    );
  };

  const getCalendarColumnDateIds = (columnIndex = 0) =>
    calendarRows
      .map((calendarRow) => calendarRow[columnIndex])
      .filter((calendarDay) => calendarDay && !calendarDay.isDisabled)
      .map((calendarDay) => calendarDay.id);

  const toggleConfigSlot = (complexKey, court = {}, slot = "") => {
    const selectedDateKey = String(selectedDay.dateMillis);
    const currentSlots = Array.isArray(court.slotsByDate?.[selectedDateKey])
      ? court.slotsByDate[selectedDateKey]
      : [];
    const nextSlots = currentSlots.includes(slot)
      ? currentSlots.filter((currentSlot) => currentSlot !== slot)
      : [...currentSlots, slot].sort();

    updateCourtConfig(complexKey, court.id, {
      slotsByDate: {
        ...(court.slotsByDate || {}),
        [selectedDateKey]: nextSlots,
      },
    });
  };

  const toggleConfigSlotRow = (complexKey, court = {}, rowSlots = []) => {
    const selectedDateKey = String(selectedDay.dateMillis);
    const currentSlots = Array.isArray(court.slotsByDate?.[selectedDateKey])
      ? court.slotsByDate[selectedDateKey]
      : [];
    const currentSet = new Set(currentSlots);
    const rowIsComplete = rowSlots.every((slot) => currentSet.has(slot));
    const nextSet = new Set(currentSlots);

    rowSlots.forEach((slot) => {
      if (rowIsComplete) {
        nextSet.delete(slot);
      } else {
        nextSet.add(slot);
      }
    });

    updateCourtConfig(complexKey, court.id, {
      slotsByDate: {
        ...(court.slotsByDate || {}),
        [selectedDateKey]: [...nextSet].sort(),
      },
    });
  };

  const applyCurrentSlotsToSelectedDays = (complexKey, court = {}) => {
    if (!selectedConfigDateIds.length) {
      showFeedback(
        "Selecciona dias",
        "Marca al menos un dia debajo del calendario para aplicar estos horarios.",
        "danger"
      );
      return;
    }

    const currentSlots = getCourtSlotsForDate(court, selectedDay);
    const nextSlotsByDate = {
      ...(court.slotsByDate || {}),
    };

    selectedConfigDateIds.forEach((dateId) => {
      nextSlotsByDate[String(dateId)] = [...currentSlots];
    });

    updateCourtConfig(complexKey, court.id, {
      selectedDateIds: selectedConfigDateIds,
      slotsByDate: nextSlotsByDate,
    });

    showFeedback(
      "Horarios aplicados",
      "Los horarios de esta cancha se copiaron a los dias seleccionados. Guarda para confirmarlos.",
      "success"
    );
  };

  const handleSaveConfig = async () => {
    try {
      setSavingConfig(true);
      await saveOrganizerTurnosConfig(currentUserId, organizerConfig);
      await loadData();
      showFeedback(
        "Turnos configurados",
        "Las canchas habilitadas ya pueden aparecer en el listado de reservas.",
        "success"
      );
    } catch (error) {
      showFeedback(
        "No pudimos guardar",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setSavingConfig(false);
    }
  };

  const handlePickReceipt = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      type: ["image/*", "application/pdf"],
    });

    if (result.canceled) {
      return;
    }

    setReceiptAsset(result.assets?.[0] || null);
  };

  const handlePickReservationPaymentReceipt = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      type: ["image/*", "application/pdf"],
    });

    if (result.canceled) {
      return;
    }

    setPaymentEntryReceiptAsset(result.assets?.[0] || null);
  };

  const handleOpenMercadoPagoInfo = () => {
    showFeedback(
      "Mercado Pago disponible",
      "Esta sede ya quedo preparada para cobrar con Checkout Pro usando credenciales de prueba.",
      "default"
    );
  };

  const getReservationPlayer = () => {
    if (canManageTurnos) {
      return selectedReservationPlayer;
    }

    return {
      countryCode: userData.countryCode || "+54",
      id: currentUserId,
      name: userData.name || "Jugador",
      phone: userData.phone || userData.telefono || "",
      type: "registered",
    };
  };

  const handleSelectRegisteredReservationPlayer = (player) => {
    setSelectedReservationPlayer({
      countryCode: player.countryCode || "+54",
      id: player.id,
      name: [player.nombre, player.apellido].filter(Boolean).join(" ") || "Jugador",
      phone: player.phone || player.telefono || "",
      type: "registered",
    });
    setPlayerPickerVisible(false);
    setPlayerQuery("");
  };

  const handleCreateGuestReservationPlayer = () => {
    const normalizedName = String(guestReservationName || "").trim();
    const normalizedLastName = String(guestReservationLastName || "").trim();

    if (!normalizedName || !normalizedLastName) {
      showFeedback("Faltan datos", "Carga nombre y apellido para asignar la reserva.", "danger");
      return;
    }

    setSelectedReservationPlayer({
      countryCode: "",
      id: "",
      name: `${normalizedName} ${normalizedLastName}`.trim(),
      phone: guestReservationPhone.trim(),
      type: "guest",
    });
    setGuestReservationName("");
    setGuestReservationLastName("");
    setGuestReservationPhone("");
    setPlayerPickerVisible(false);
  };

  const handleOpenReservationMessage = (reservation = {}) => {
    if (!reservation.playerId) {
      showFeedback(
        "No hay chat disponible",
        "Esta reserva fue asignada a una persona no registrada.",
        "danger"
      );
      return;
    }

    navigation.navigate("Mensajes", {
      playerId: reservation.playerId,
      playerName: reservation.playerName || "Jugador",
    });
    setReservationsModalVisible(false);
  };

  const handleOpenReservationWhatsApp = async (reservation = {}) => {
    const phone = buildWhatsAppPhoneNumber(reservation.playerPhone, reservation.playerCountryCode);

    if (!phone) {
      showFeedback(
        "Falta telefono",
        "Esta reserva no tiene un telefono cargado para WhatsApp.",
        "danger"
      );
      return;
    }

    try {
      await Linking.openURL(`https://wa.me/${phone}?text=${buildReservationContactMessage(reservation)}`);
    } catch (error) {
      showFeedback(
        "No pudimos abrir WhatsApp",
        "Revisa si WhatsApp esta disponible en este dispositivo.",
        "danger"
      );
    }
  };

  const handleNotifyReservationConfirmationWhatsApp = async () => {
    const reservation = whatsAppConfirmationReservation || {};
    const phone = buildWhatsAppPhoneNumber(reservation.playerPhone, reservation.playerCountryCode);

    setWhatsAppConfirmationReservation(null);

    if (!phone) {
      showFeedback(
        "Falta telefono",
        "La reserva quedo confirmada, pero no hay un telefono valido para WhatsApp.",
        "warning"
      );
      return;
    }

    try {
      await Linking.openURL(`https://wa.me/${phone}?text=${buildReservationContactMessage(reservation)}`);
    } catch (error) {
      showFeedback(
        "No pudimos abrir WhatsApp",
        "La reserva quedo confirmada, pero no pudimos abrir WhatsApp en este dispositivo.",
        "danger"
      );
    }
  };

  const handleCancelReservation = async (reservation = {}) => {
    if (!reservation.id || !isReservationActive(reservation)) {
      return;
    }

    let notificationMessage = "El horario vuelve a quedar disponible para nuevas reservas.";

    try {
      setRunningReservationActionId(reservation.id);
      await updateTurnoReservationStatus(reservation.id, "cancelled");

      if (reservation.playerId && reservation.playerType !== "guest") {
        try {
          await sendChatMessage({
            currentUserId,
            currentUserName:
              reservation.complexName || userData?.clubName || userData?.name || "Organizador",
            otherUserId: reservation.playerId,
            otherUserName: reservation.playerName || "Jugador",
            text: buildReservationCancellationText(reservation, { boldTitle: true }),
          });
          notificationMessage += "\n\n**Se notifico al jugador por mensaje interno**";
        } catch (error) {
          notificationMessage += "\n\nLa reserva se cancelo, pero no pudimos enviar el mensaje interno.";
        }
      } else {
        const phone = buildWhatsAppPhoneNumber(
          reservation.playerPhone,
          reservation.playerCountryCode
        );

        if (phone) {
          try {
            await Linking.openURL(
              `https://wa.me/${phone}?text=${buildReservationCancellationWhatsAppMessage(reservation)}`
            );
            notificationMessage += "\n\nAbrimos WhatsApp para avisar a la persona no registrada.";
          } catch (error) {
            notificationMessage += "\n\nLa reserva se cancelo, pero no pudimos abrir WhatsApp.";
          }
        } else {
          notificationMessage += "\n\nLa persona no registrada no tiene telefono cargado para avisarle.";
        }
      }

      await loadData();
      showFeedback(
        "Reserva cancelada",
        notificationMessage,
        "success"
      );
    } catch (error) {
      showFeedback(
        "No pudimos cancelar",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setRunningReservationActionId("");
    }
  };

  const openReservationDetail = (reservation = {}) => {
    setReservationDetail(reservation);
  };

  const closeReservationDetail = () => {
    setPaymentEntryVisible(false);
    setReservationDetail(null);
  };

  const openReservationPaymentEntry = (reservation = {}) => {
    const summary = getTurnoReservationPaymentSummary(reservation);

    setReservationDetail(reservation);
    setPaymentEntryAmount(summary.pendingAmount > 0 ? String(Math.round(summary.pendingAmount)) : "");
    setPaymentEntryMethod("efectivo");
    setPaymentEntryReceiptAsset(null);
    setPaymentEntryVisible(true);
  };

  const closeReservationPaymentEntry = () => {
    if (savingReservationPayment) {
      return;
    }

    const shouldReturnToPrevious = paymentEntryReturnToPrevious;

    setPaymentEntryVisible(false);
    setPaymentEntryAmount("");
    setPaymentEntryMethod("efectivo");
    setPaymentEntryReceiptAsset(null);
    setPaymentEntryReturnToPrevious(false);

    if (shouldReturnToPrevious) {
      setReservationDetail(null);
      setReservationsModalVisible(false);
      navigation.goBack();
    }
  };

  const handleSaveReservationPayment = async () => {
    if (!reservationDetail?.id) {
      showFeedback("Falta la reserva", "No encontramos la reserva a cobrar.", "danger");
      return;
    }

    const amount = Number(String(paymentEntryAmount || "0").replace(",", "."));
    const pendingAmount = getTurnoReservationPaymentSummary(reservationDetail).pendingAmount;

    if (!Number.isFinite(amount) || amount <= 0) {
      showFeedback("Falta el monto", "Ingresa un monto valido para registrar el pago.", "danger");
      return;
    }

    if (pendingAmount <= 0) {
      showFeedback("Reserva pagada", "Esta reserva ya no tiene saldo pendiente.", "warning");
      return;
    }

    if (amount > pendingAmount) {
      showFeedback(
        "Monto excedido",
        "El importe no puede superar el saldo pendiente de la reserva.",
        "danger"
      );
      return;
    }

    try {
      setSavingReservationPayment(true);
      const proofPayload =
        paymentEntryMethod === "transferencia" && paymentEntryReceiptAsset
          ? await uploadTurnoProof(paymentEntryReceiptAsset, currentUserId)
          : { proofFileName: "", proofUrl: "" };

      const paymentResult = await addTurnoReservationPayment(reservationDetail.id, {
        amount,
        createdBy: currentUserId,
        createdByName: userData?.name || userData?.displayName || "Organizador",
        method: paymentEntryMethod,
        proofFileName: proofPayload.proofFileName,
        proofUrl: proofPayload.proofUrl,
      });

      setReservationDetail((current) =>
        current && current.id === reservationDetail.id
          ? {
              ...current,
              paymentMovements: [
                paymentResult.paymentMovement,
                ...(Array.isArray(current.paymentMovements) ? current.paymentMovements : []),
              ],
              paymentPaidAmount: paymentResult.paymentPaidAmount,
              paymentPendingAmount: paymentResult.paymentPendingAmount,
              paymentStatus: paymentResult.paymentStatus,
              paymentTotalAmount: paymentResult.paymentTotalAmount,
            }
          : current
      );
      await loadData();
      closeReservationPaymentEntry();
      showFeedback(
        "Pago registrado",
        "El cobro quedo asentado en la reserva y ya puede reflejarse en el centro de cobros.",
        "success"
      );
    } catch (error) {
      showFeedback(
        "No pudimos registrar el pago",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setSavingReservationPayment(false);
    }
  };

  const getReservationForManagementSlot = (complex = {}, court = {}, slot = "") =>
    organizerReservations.find((reservation) => {
      if (
        !isReservationActive(reservation) ||
        reservation.organizerId !== currentUserId ||
        reservation.complexKey !== complex.complexKey ||
        reservation.courtId !== court.id ||
        String(reservation.dateMillis || "") !== String(selectedDay?.dateMillis || "")
      ) {
        return false;
      }

      return buildSlotBlocks(reservation.time, reservation.durationMinutes || 60).includes(slot);
    }) || null;

  const handleOpenSummary = () => {
    if (!selectedComplex || !selectedCourt || !selectedSlot) {
      return;
    }

    if (!isDurationAvailable(selectedCourt, selectedDay, selectedSlot, selectedDuration)) {
      showFeedback(
        "Turno no disponible",
        "La duracion elegida se superpone con otra reserva.",
        "danger"
      );
      return;
    }

    if (canManageTurnos && !selectedReservationPlayer) {
      showFeedback(
        "Selecciona un jugador",
        "Elige una persona registrada o crea un jugador no registrado para asignar la reserva.",
        "danger"
      );
      return;
    }

    setPaymentMethod(canManageTurnos ? "a_confirmar" : "efectivo");
    setReceiptAsset(null);
    setSummaryVisible(true);
  };

  const handleConfirmReservation = async () => {
    if (!selectedComplex || !selectedCourt || !selectedSlot || !currentUserId) {
      showFeedback("Faltan datos", "Completa la reserva antes de confirmar.", "danger");
      return;
    }

    const reservationPlayer = getReservationPlayer();

    if (!reservationPlayer?.name) {
      showFeedback("Falta jugador", "Selecciona para quien se asignara esta reserva.", "danger");
      return;
    }

    if (!isDurationAvailable(selectedCourt, selectedDay, selectedSlot, selectedDuration)) {
      showFeedback(
        "Turno no disponible",
        "La duracion elegida se superpone con otra reserva.",
        "danger"
      );
      return;
    }

    if (paymentMethod === "transferencia" && !receiptAsset) {
      showFeedback("Falta comprobante", "Adjunta el comprobante de transferencia.", "danger");
      return;
    }

    try {
      setConfirming(true);
      const proofPayload =
        paymentMethod === "transferencia"
          ? await uploadTurnoProof(receiptAsset, currentUserId)
          : { proofFileName: "", proofUrl: "" };

      const reservationPayload = {
        organizerId: selectedComplex.organizerId,
        organizerName: selectedComplex.organizerName,
        createdByOrganizer: canManageTurnos,
        requiresOrganizerApproval: canManageTurnos
          ? false
          : selectedComplex.requiresOrganizerApproval !== false,
        complexKey: selectedComplex.complexKey,
        complexName: selectedComplex.name,
        complexAddress: selectedComplex.address,
        courtId: selectedCourt.id,
        courtName: selectedCourt.name,
        dateMillis: selectedDay.dateMillis,
        dateLabel: selectedDay.fullLabel,
        time: selectedSlot,
        durationMinutes: selectedDuration,
        price: selectedPrice,
        paymentMethod,
        proofFileName: proofPayload.proofFileName,
        proofUrl: proofPayload.proofUrl,
        playerId: reservationPlayer.id || "",
        playerName: reservationPlayer.name,
        playerCountryCode: reservationPlayer.countryCode || "+54",
        playerEmail: userData?.email || "",
        playerPhone: reservationPlayer.phone || "",
        playerType: reservationPlayer.type || "registered",
      };

      const createdReservation = await createTurnoReservation(reservationPayload);
      const createdReservationWithId = {
        ...createdReservation,
        ...reservationPayload,
      };

      if (paymentMethod === "mercado_pago") {
        const returnUrls = getMercadoPagoReturnUrls();
        const checkout = await createTurnoMercadoPagoPreference({
          reservationId: createdReservation.id,
          organizerId: reservationPayload.organizerId,
          organizerName: reservationPayload.organizerName,
          complexName: reservationPayload.complexName,
          courtName: reservationPayload.courtName,
          dateLabel: reservationPayload.dateLabel,
          time: reservationPayload.time,
          amount: reservationPayload.price,
          payerEmail: reservationPayload.playerEmail,
          payerName: reservationPayload.playerName,
          successUrl: returnUrls.successUrl,
          failureUrl: returnUrls.failureUrl,
          pendingUrl: returnUrls.pendingUrl,
        });

        if (!checkout.checkoutUrl) {
          throw new Error("No pudimos obtener el link de pago de Mercado Pago.");
        }

        await persistPendingTurnoCheckout({
          preferenceId: checkout.preferenceId,
          reservationId: createdReservation.id,
          status: "pending",
        });

        setSummaryVisible(false);
        setSelectedSlot("");
        setReceiptAsset(null);
        await loadData();
        await Linking.openURL(checkout.checkoutUrl);
        return;
      }

      if (reservationPayload.playerId) {
        try {
          await sendTurnoReservationStatusMessage(createdReservationWithId, {
            organizerId: reservationPayload.organizerId,
            organizerName: reservationPayload.complexName,
          });
        } catch (error) {
          // La reserva ya quedo creada; si falla la notificacion interna no bloqueamos el flujo.
        }
      }

      setSummaryVisible(false);
      setSelectedSlot("");
      setSelectedReservationPlayer(null);
      setReceiptAsset(null);
      if (canManageTurnos) {
        setAssignmentModeOpen(false);
        await loadData();
      }
      const paymentConfirmationText =
        paymentMethod === "transferencia"
          ? "Metodo de pago: Transferencia - Pago a verificar."
          : paymentMethod === "a_confirmar"
          ? "Metodo de pago: A confirmar."
          : paymentMethod === "mercado_pago"
          ? "Metodo de pago: Mercado Pago - Reserva pendiente hasta completar el cobro."
          : "Metodo de pago: Efectivo - El pago se realizara en el complejo.";

      if (
        canManageTurnos &&
        buildWhatsAppPhoneNumber(reservationPayload.playerPhone, reservationPayload.playerCountryCode)
      ) {
        setWhatsAppConfirmationReservation(reservationPayload);
        return;
      }

      showFeedback(
        canManageTurnos || selectedComplex.requiresOrganizerApproval === false
          ? "Reserva confirmada"
          : "Reserva solicitada",
        `${
          canManageTurnos
            ? `La reserva para ${reservationPlayer.name} quedo asentada correctamente.`
            : selectedComplex.requiresOrganizerApproval === false
              ? "Tu turno quedo reservado correctamente."
            : "Tu turno quedo aguardando confirmacion del organizador del club."
        }\n\n${paymentConfirmationText}`,
        "success"
      );
    } catch (error) {
      showFeedback(
        "No pudimos confirmar",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setConfirming(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader
        onBack={() =>
          reservationsModalVisible && canManageTurnos
            ? closeReservationsManagement()
            : navigation.goBack()
        }
        subtitle={reservationsModalVisible && canManageTurnos ? "Gestion de reservas" : "Turnos"}
      >
        {showReservationFlow ? renderLocationFilterRow() : null}
      </SectionHeader>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        style={styles.contentScroller}
      >
        {canManageTurnos ? (
          <View style={styles.reservationTopActions}>
            <Pressable
              onPress={() => {
                setReservationsModalVisible(true);
                if (assignmentModeOpen) {
                  setAssignmentModeOpen(false);
                  resetAssignmentFlow();
                }
              }}
              style={({ pressed }) => [
                styles.turnosAreaButton,
                reservationsModalVisible && !assignmentModeOpen ? styles.turnosAreaButtonActive : null,
                pressed ? styles.pressedState : null,
              ]}
            >
              <Ionicons
                color={reservationsModalVisible && !assignmentModeOpen ? colors.surface : "#4F625C"}
                name="calendar-outline"
                size={18}
              />
              <Text
                style={[
                  styles.turnosAreaButtonText,
                  reservationsModalVisible && !assignmentModeOpen ? styles.turnosAreaButtonTextActive : null,
                ]}
              >
                RESERVAS CONFIRMADAS
              </Text>
            </Pressable>
            <Pressable
              onPress={handleToggleAssignmentMode}
              style={({ pressed }) => [
                styles.turnosAreaButton,
                assignmentModeOpen ? styles.turnosAreaButtonActive : null,
                pressed ? styles.pressedState : null,
              ]}
            >
              <Ionicons
                color={assignmentModeOpen ? colors.surface : "#4F625C"}
                name="person-add-outline"
                size={18}
              />
              <Text
                style={[
                  styles.turnosAreaButtonText,
                  assignmentModeOpen ? styles.turnosAreaButtonTextActive : null,
                ]}
              >
                ASIGNAR RESERVA
              </Text>
            </Pressable>
            <Pressable
              onPress={closeReservationsManagement}
              style={({ pressed }) => [
                styles.turnosAreaButton,
                !reservationsModalVisible && !assignmentModeOpen ? styles.turnosAreaButtonActive : null,
                pressed ? styles.pressedState : null,
              ]}
            >
              <Ionicons
                color={!reservationsModalVisible && !assignmentModeOpen ? colors.surface : "#4F625C"}
                name="settings-outline"
                size={18}
              />
              <Text
                style={[
                  styles.turnosAreaButtonText,
                  !reservationsModalVisible && !assignmentModeOpen ? styles.turnosAreaButtonTextActive : null,
                ]}
              >
                ASIGNAR CANCHAS DISPONIBLES
              </Text>
            </Pressable>
          </View>
        ) : null}
        {reservationsModalVisible && canManageTurnos && !assignmentModeOpen ? (
          <>
            <View style={styles.datesHeaderRow}>
              <ScrollView
                contentContainerStyle={styles.reservationDaysRow}
                horizontal
                showsHorizontalScrollIndicator={false}
              >
                {days.map((day) => {
                  const isSelected = day.id === selectedDayId;

                  return (
                    <Pressable
                      key={`management-day-${day.id}`}
                      onPress={() => {
                        setSelectedDayId(day.id);
                        setSelectedSlot("");
                      }}
                      style={({ pressed }) => [
                        styles.reservationDayPill,
                        isSelected ? styles.reservationDayPillActive : null,
                        pressed ? styles.pressedState : null,
                      ]}
                    >
                      <Text
                        style={[
                          styles.reservationDayText,
                          isSelected ? styles.reservationDayTextActive : null,
                        ]}
                      >
                        {day.dayName}
                      </Text>
                      <Text
                        style={[
                          styles.reservationDayNumber,
                          isSelected ? styles.reservationDayTextActive : null,
                        ]}
                      >
                        {day.dayNumber}
                      </Text>
                      <Text
                        style={[
                          styles.reservationDayText,
                          isSelected ? styles.reservationDayTextActive : null,
                        ]}
                      >
                        {day.monthName}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <View style={styles.todayBadge}>
                <Ionicons color={colors.primaryDark} name="calendar-outline" size={17} />
                <Text style={styles.todayBadgeText}>{today?.compact}</Text>
              </View>
            </View>

            {selectedOrganizerComplex ? (
              <>
                <Pressable
                  onPress={() => setIsOrganizerComplexPickerOpen((current) => !current)}
                  style={[styles.organizerComplexSelect, styles.managementComplexSelect]}
                >
                  <View
                    style={[
                      styles.organizerComplexSelectCopy,
                      styles.managementComplexSelectCopy,
                    ]}
                  >
                    <View
                      style={[
                        styles.organizerComplexColorDot,
                        styles.managementComplexColorDot,
                        {
                          backgroundColor:
                            COMPLEX_MANAGEMENT_COLORS[
                              selectedOrganizerComplexIndex % COMPLEX_MANAGEMENT_COLORS.length
                            ].border,
                        },
                      ]}
                    />
                    <Text style={[styles.organizerComplexLabel, styles.managementComplexLabel]}>
                      Sede:
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.organizerComplexSelectText,
                        styles.managementComplexSelectText,
                        {
                          color:
                            COMPLEX_MANAGEMENT_COLORS[
                              selectedOrganizerComplexIndex % COMPLEX_MANAGEMENT_COLORS.length
                            ].text,
                        },
                      ]}
                    >
                      {selectedOrganizerComplex.name}
                    </Text>
                  </View>
                  <Ionicons
                    color={colors.primaryDark}
                    name={isOrganizerComplexPickerOpen ? "chevron-up" : "chevron-down"}
                    size={17}
                  />
                </Pressable>
                {isOrganizerComplexPickerOpen ? (
                  <View style={styles.organizerComplexOptions}>
                    {organizerComplexes.map((complex, index) => {
                      const palette =
                        COMPLEX_MANAGEMENT_COLORS[index % COMPLEX_MANAGEMENT_COLORS.length];

                      return (
                        <Pressable
                          key={`management-complex-${complex.complexKey}`}
                          onPress={() => {
                            setSelectedOrganizerComplexKey(complex.complexKey);
                            setIsOrganizerComplexPickerOpen(false);
                          }}
                          style={[
                            styles.organizerComplexOption,
                            { backgroundColor: palette.background, borderColor: palette.border },
                          ]}
                        >
                          <View
                            style={[
                              styles.organizerComplexOptionStripe,
                              { backgroundColor: palette.border },
                            ]}
                          />
                          <Text
                            style={[
                              styles.organizerComplexOptionText,
                              styles.managementComplexOptionText,
                              { color: palette.text },
                            ]}
                          >
                            {complex.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </>
            ) : null}

            <View style={styles.managementScheduleCard}>
              {(selectedOrganizerComplex?.courts || []).map((court) => {
                const configuredSlots = getCourtSlotsForDate(court, selectedDay);
                const courtDetails = getCourtManagementDetails(court);

                return (
                  <View key={`management-court-${court.id}`} style={styles.managementCourtBlock}>
                    <View style={styles.managementCourtHeader}>
                      <View style={styles.managementCourtNameChip}>
                        <Text numberOfLines={1} style={styles.managementCourtName}>
                          {court.displayName || court.name}
                        </Text>
                      </View>
                      <View style={styles.managementCourtDetailsRow}>
                        <Text numberOfLines={2} style={styles.managementCourtDetailText}>
                          {courtDetails.join(" - ")}
                        </Text>
                      </View>
                    </View>
                    {configuredSlots.length ? (
                      <View style={styles.managementSlotsGrid}>
                        {chunkSlots(configuredSlots).map((slotRow) => (
                          <View
                            key={`management-row-${court.id}-${slotRow.join("-")}`}
                            style={styles.managementSlotRow}
                          >
                            <View style={styles.managementSlotRowTimes}>
                              {slotRow.map((slot) => {
                                const reservationForSlot = getReservationForManagementSlot(
                                  selectedOrganizerComplex,
                                  court,
                                  slot
                                );
                                const isReservationStart = reservationForSlot?.time === slot;

                                return (
                                  <View
                                    key={`management-slot-${court.id}-${slot}`}
                                    style={[
                                      styles.managementSlotChip,
                                      reservationForSlot ? styles.managementSlotChipReserved : null,
                                    ]}
                                  >
                                    <Text
                                      style={[
                                        styles.managementSlotText,
                                        reservationForSlot ? styles.managementSlotTextReserved : null,
                                      ]}
                                    >
                                      {slot}
                                    </Text>
                                    {isReservationStart ? (
                                      <Pressable
                                        onPress={() => openReservationDetail(reservationForSlot)}
                                        style={({ pressed }) => [
                                          styles.managementSlotViewButton,
                                          pressed ? styles.pressedState : null,
                                        ]}
                                      >
                                        <Text style={styles.managementSlotViewText}>VER</Text>
                                      </Pressable>
                                    ) : null}
                                  </View>
                                );
                              })}
                              {Array.from({ length: SLOT_ROW_SIZE - slotRow.length }).map((_, index) => (
                                <View
                                  key={`management-slot-spacer-${court.id}-${slotRow.join("-")}-${index}`}
                                  style={styles.managementSlotSpacer}
                                />
                              ))}
                            </View>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <Text style={styles.emptyInlineText}>
                        No hay horarios disponibles para esta cancha en este dia.
                      </Text>
                    )}
                  </View>
                );
              })}
              {!selectedOrganizerComplex?.courts?.length ? (
                <Text style={styles.emptyInlineText}>No hay canchas cargadas para esta sede.</Text>
              ) : null}
            </View>
          </>
        ) : (
          <>
        <View style={styles.datesHeaderRow}>
          <ScrollView
            contentContainerStyle={styles.daysRow}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {days.map((day) => {
              const isSelected = day.id === selectedDayId;
              const isConfigDaySelected = selectedConfigDateIds.includes(day.id);

              return (
                <Pressable
                  key={day.id}
                  onPress={() => {
                    setSelectedDayId(day.id);
                    setSelectedSlot("");
                  }}
                  style={({ pressed }) => [
                    styles.dayPill,
                    canManageTurnos && !assignmentModeOpen ? styles.dayPillManager : null,
                    isSelected ? styles.dayPillActive : null,
                    pressed ? styles.pressedState : null,
                  ]}
                >
                  <Text style={[styles.dayTop, isSelected ? styles.dayTextActive : null]}>
                    {day.dayName}
                  </Text>
                  <Text style={[styles.dayNumber, isSelected ? styles.dayTextActive : null]}>
                    {day.dayNumber}
                  </Text>
                  <Text style={[styles.dayBottom, isSelected ? styles.dayTextActive : null]}>
                    {day.monthName}
                  </Text>
                  {canManageTurnos && !assignmentModeOpen ? (
                    <Pressable
                      hitSlop={8}
                      onPress={() => toggleConfigDate(day.id)}
                      style={[
                        styles.daySelectDot,
                        isConfigDaySelected ? styles.daySelectDotActive : null,
                        isSelected && !isConfigDaySelected ? styles.daySelectDotOnActive : null,
                      ]}
                    >
                      {isConfigDaySelected ? (
                        <Ionicons color="#1E6B45" name="checkmark" size={10} />
                      ) : null}
                    </Pressable>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>

          <Pressable
            onPress={() => canManageTurnos && !assignmentModeOpen && setCalendarVisible(true)}
            style={({ pressed }) => [
              styles.todayBadge,
              canManageTurnos && !assignmentModeOpen ? styles.todayBadgeButton : null,
              pressed && canManageTurnos && !assignmentModeOpen ? styles.pressedState : null,
            ]}
          >
            <Ionicons color={colors.primaryDark} name="calendar-outline" size={17} />
            <Text style={styles.todayBadgeText}>{today?.compact}</Text>
            {canManageTurnos && !assignmentModeOpen ? (
              <Ionicons color={colors.primaryDark} name="chevron-down" size={13} />
            ) : null}
          </Pressable>
        </View>

        {canManageTurnos && organizerConfig && !assignmentModeOpen ? (
          <View style={styles.organizerCard}>
            {hasUnsavedConfigChanges ? (
              <View style={styles.unsavedChangesBanner}>
                <Ionicons color="#3F4EA8" name="sync-outline" size={17} />
                <Text style={styles.unsavedChangesText}>
                  Hay cambios sin guardar. Toca GUARDAR DISPONIBILIDAD para confirmarlos.
                </Text>
              </View>
            ) : null}
            {selectedOrganizerComplex ? (
              <>
                <Pressable
                  onPress={() => setIsOrganizerComplexPickerOpen((current) => !current)}
                  style={styles.organizerComplexSelect}
                >
                  <View
                    style={[
                      styles.organizerComplexColorDot,
                      {
                        backgroundColor:
                          COMPLEX_AVAILABILITY_COLORS[
                            selectedOrganizerComplexIndex % COMPLEX_AVAILABILITY_COLORS.length
                          ].border,
                      },
                    ]}
                  />
                  <Text style={styles.organizerComplexLabel}>Sede</Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.organizerComplexSelectText,
                      {
                        color:
                          COMPLEX_AVAILABILITY_COLORS[
                            selectedOrganizerComplexIndex % COMPLEX_AVAILABILITY_COLORS.length
                          ].text,
                      },
                    ]}
                  >
                    {selectedOrganizerComplex.name}
                  </Text>
                  <Ionicons
                    color={
                      COMPLEX_AVAILABILITY_COLORS[
                        selectedOrganizerComplexIndex % COMPLEX_AVAILABILITY_COLORS.length
                      ].text
                    }
                    name={isOrganizerComplexPickerOpen ? "chevron-up" : "chevron-down"}
                    size={17}
                  />
                </Pressable>
                {isOrganizerComplexPickerOpen ? (
                  <View style={styles.organizerComplexOptions}>
                    {organizerComplexes.map((complex, index) => {
                      const palette =
                        COMPLEX_AVAILABILITY_COLORS[index % COMPLEX_AVAILABILITY_COLORS.length];
                      const isCurrent = complex.complexKey === selectedOrganizerComplex.complexKey;

                      return (
                        <Pressable
                          key={complex.complexKey}
                          onPress={() => {
                            setSelectedOrganizerComplexKey(complex.complexKey);
                            setIsOrganizerComplexPickerOpen(false);
                          }}
                          style={[
                            styles.organizerComplexOption,
                            {
                              borderColor: isCurrent ? palette.text : palette.border,
                            },
                          ]}
                        >
                          <View
                            style={[
                              styles.organizerComplexOptionStripe,
                              { backgroundColor: palette.border },
                            ]}
                          />
                          <Text
                            numberOfLines={1}
                            style={[styles.organizerComplexOptionText, { color: palette.text }]}
                          >
                            {complex.name}
                          </Text>
                          {isCurrent ? (
                            <Ionicons color={palette.text} name="checkmark-circle" size={16} />
                          ) : null}
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </>
            ) : null}
            {selectedOrganizerComplex ? [selectedOrganizerComplex].map((complex) => {
              const selectedConfigCourt = getSelectedConfigCourt(complex);

              return (
                <View key={complex.complexKey} style={styles.configComplexCard}>
                  <Text style={styles.configComplexAddress}>{complex.address}</Text>
                  <ScrollView
                    contentContainerStyle={styles.configCourtsRow}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                  >
                    {(complex.courts || []).map((court) => {
                      const isSelected = selectedConfigCourt?.id === court.id;

                      return (
                        <Pressable
                          key={court.id}
                          onPress={() =>
                            setSelectedConfigCourtByComplex((current) => ({
                              ...current,
                              [complex.complexKey]: court.id,
                            }))
                          }
                          style={({ pressed }) => [
                            styles.configCourtSelector,
                            isSelected ? styles.configCourtSelectorActive : null,
                            pressed ? styles.pressedState : null,
                          ]}
                        >
                          <Text
                            style={[
                              styles.configCourtSelectorText,
                              isSelected ? styles.configCourtSelectorTextActive : null,
                            ]}
                          >
                            {court.name}
                          </Text>
                          <View
                            style={[
                              styles.configCourtStatusDot,
                              court.enabled ? styles.configCourtStatusDotActive : null,
                            ]}
                          />
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  {selectedConfigCourt ? (
                    <View style={styles.configCourtCard}>
                    <View style={styles.configCourtHeader}>
                      <View>
                        <Text style={styles.configCourtName}>{selectedConfigCourt.name}</Text>
                        <Text style={styles.configCourtMeta}>
                          {(selectedConfigCourt.features || []).join(" - ") || "Sin caracteristicas"}
                        </Text>
                      </View>
                      <Pressable
                        onPress={() =>
                          updateCourtConfig(complex.complexKey, selectedConfigCourt.id, {
                            enabled: !selectedConfigCourt.enabled,
                          })
                        }
                        style={[
                          styles.toggleChip,
                          selectedConfigCourt.enabled ? styles.toggleChipActive : null,
                        ]}
                      >
                        <Text
                          style={[
                            styles.toggleChipText,
                            selectedConfigCourt.enabled ? styles.toggleChipTextActive : null,
                          ]}
                        >
                          {selectedConfigCourt.enabled ? "DISPONIBLE" : "NO DISPONIBLE"}
                        </Text>
                      </Pressable>
                    </View>
                    <View style={styles.pricePanel}>
                      <View style={styles.pricePanelHeader}>
                        <Text style={styles.pricePanelTitle}>Precio del turno</Text>
                      </View>
                      <View style={styles.configInputsRow}>
                        <View style={styles.configInputWrap}>
                          <Text style={styles.priceDurationLabel}>60 min</Text>
                          <TextInput
                            keyboardType="number-pad"
                            onChangeText={(value) =>
                              updateCourtConfig(complex.complexKey, selectedConfigCourt.id, { price60: value })
                            }
                            placeholder="$"
                            placeholderTextColor={colors.muted}
                            style={styles.priceInput}
                            value={String(selectedConfigCourt.price60 || "")}
                          />
                        </View>
                        <View style={styles.configInputWrap}>
                          <Text style={styles.priceDurationLabel}>90 min</Text>
                          <TextInput
                            keyboardType="number-pad"
                            onChangeText={(value) =>
                              updateCourtConfig(complex.complexKey, selectedConfigCourt.id, { price90: value })
                            }
                            placeholder="$"
                            placeholderTextColor={colors.muted}
                            style={styles.priceInput}
                            value={String(selectedConfigCourt.price90 || "")}
                          />
                        </View>
                      </View>
                      <Pressable
                        onPress={() => openPriceApplyModal(complex, selectedConfigCourt)}
                        style={({ pressed }) => [
                          styles.applyPriceButton,
                          pressed ? styles.pressedState : null,
                        ]}
                      >
                        <Ionicons color="#1E6B45" name="albums-outline" size={14} />
                        <Text style={styles.applyPriceButtonText}>Aplicar a varias</Text>
                      </Pressable>
                    </View>
                    <Text style={styles.inputLabel}>
                      Horarios disponibles para {selectedDay.dayName} {selectedDay.dayNumber}
                    </Text>
                    <Pressable
                      onPress={() =>
                        applyCurrentSlotsToSelectedDays(complex.complexKey, selectedConfigCourt)
                      }
                      style={({ pressed }) => [
                        styles.applyDaysButton,
                        pressed ? styles.pressedState : null,
                      ]}
                    >
                      <Ionicons color={colors.primaryDark} name="copy-outline" size={16} />
                      <Text style={styles.applyDaysButtonText}>
                        Aplicar a dias seleccionados
                      </Text>
                    </Pressable>
                    <View style={styles.configSlotsGrid}>
                      {chunkSlots(HALF_HOUR_SLOTS).map((slotRow) => {
                        const selectedSlots = getCourtSlotsForDate(selectedConfigCourt, selectedDay);
                        const rowIsComplete = slotRow.every((slot) => selectedSlots.includes(slot));

                        return (
                          <View key={slotRow.join("-")} style={styles.configSlotRow}>
                            <View style={styles.configSlotRowTimes}>
                              {slotRow.map((slot) => {
                                const isAvailable = selectedSlots.includes(slot);

                                return (
                                  <Pressable
                                    key={slot}
                                    onPress={() => toggleConfigSlot(complex.complexKey, selectedConfigCourt, slot)}
                                    style={({ pressed }) => [
                                      styles.configSlotChip,
                                      isAvailable ? styles.configSlotChipActive : null,
                                      pressed ? styles.pressedState : null,
                                    ]}
                                  >
                                    <Text
                                      style={[
                                        styles.configSlotChipText,
                                        isAvailable ? styles.configSlotChipTextActive : null,
                                      ]}
                                    >
                                      {slot}
                                    </Text>
                                  </Pressable>
                                );
                              })}
                            </View>
                            <Pressable
                              onPress={() => toggleConfigSlotRow(complex.complexKey, selectedConfigCourt, slotRow)}
                              style={[
                                styles.configSlotRowAction,
                                rowIsComplete ? styles.configSlotRowActionActive : null,
                              ]}
                            >
                              <Ionicons
                                color={rowIsComplete ? "#1E6B45" : "#1E5F86"}
                                name={rowIsComplete ? "checkmark-done-outline" : "chevron-forward-outline"}
                                size={14}
                              />
                            </Pressable>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                  ) : null}
                </View>
              );
            }) : null}
            <View style={styles.approvalCard}>
              <View style={styles.approvalCopy}>
                <Text style={styles.approvalTitle}>Aprobacion del organizador</Text>
                <Text style={styles.approvalText}>
                  {organizerConfig.requiresOrganizerApproval === false
                    ? "Las reservas quedan confirmadas automaticamente."
                    : "Las reservas quedan pendientes hasta que las apruebes."}
                </Text>
              </View>
              <Pressable
                onPress={() =>
                  updateOrganizerApprovalConfig(organizerConfig.requiresOrganizerApproval === false)
                }
                style={[
                  styles.approvalToggle,
                  organizerConfig.requiresOrganizerApproval !== false
                    ? styles.approvalToggleActive
                    : null,
                ]}
              >
                <Text
                  style={[
                    styles.approvalToggleText,
                    organizerConfig.requiresOrganizerApproval !== false
                      ? styles.approvalToggleTextActive
                      : null,
                  ]}
                >
                  {organizerConfig.requiresOrganizerApproval === false ? "NO" : "SI"}
                </Text>
              </Pressable>
            </View>
            <View style={styles.mercadoPagoStatusCard}>
              <View style={styles.mercadoPagoStatusHeader}>
                <Ionicons
                  color={selectedComplexMercadoPagoConfig.enabled ? "#1A7F5A" : "#7B8794"}
                  name="wallet-outline"
                  size={18}
                />
                <Text style={styles.mercadoPagoStatusTitle}>Mercado Pago</Text>
              </View>
              <Text style={styles.mercadoPagoStatusText}>
                {selectedComplexMercadoPagoConfig.enabled
                  ? "Los turnos nuevos de esta sede ya quedan preparados para cobrar tambien con Mercado Pago."
                  : "Activalo desde el perfil del organizador para cobrar tambien con Mercado Pago en reservas nuevas."}
              </Text>
            </View>
            <Pressable
              disabled={savingConfig}
              onPress={handleSaveConfig}
              style={({ pressed }) => [
                styles.primaryButton,
                savingConfig ? styles.primaryButtonDisabled : null,
                pressed && !savingConfig ? styles.pressedState : null,
              ]}
            >
              <Text style={styles.primaryButtonText}>
                {savingConfig ? "GUARDANDO..." : "GUARDAR DISPONIBILIDAD"}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {showReservationFlow ? (
          <>
        {!(canManageTurnos && assignmentModeOpen && reservationComplexes.length === 1) ? (
          <Text style={styles.sectionLabel}>
            {canManageTurnos ? "Selecciona un complejo para asignar" : "Selecciona un complejo"}
          </Text>
        ) : null}
        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.primaryDark} />
            <Text style={styles.loadingText}>Buscando complejos...</Text>
          </View>
        ) : null}
        {!loading && !reservationComplexes.length ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Sin complejos disponibles</Text>
            <Text style={styles.emptyText}>
              {complexes.length
                ? "Hay complejos cargados, pero no pudimos prepararlos para reservar. Revisa filtros o recarga la pantalla."
                : "Cuando los organizadores activen canchas para reservas, apareceran aca."}
            </Text>
          </View>
        ) : null}
        {activeLocations.length > 0 && filteredComplexes.length === 0 && complexes.length > 0 ? (
          <Text style={styles.filterFallbackText}>
            No encontramos coincidencias exactas con el filtro. Mostramos todos los complejos con
            turnos activos.
          </Text>
        ) : null}
        {proximityFilter.enabled && proximityFilter.userCoordinates ? (
          <Text style={styles.proximityInfoText}>
            Busqueda por cercania activa: primero mostramos complejos dentro de{" "}
            {proximityFilter.radiusKm} km.
          </Text>
        ) : null}
        {!(canManageTurnos && assignmentModeOpen && reservationComplexes.length === 1)
          ? reservationComplexes.map((complex) => {
          const isSelected = selectedComplexId === complex.complexKey;
          const hasAvailableTurnos = complexAvailabilityByDay[complex.complexKey] === true;

          return (
            <Pressable
              key={`${complex.organizerId}-${complex.complexKey}`}
              onPress={() => handleSelectComplex(complex)}
              style={({ pressed }) => [
                styles.complexCard,
                isSelected ? styles.complexCardActive : null,
                pressed ? styles.pressedState : null,
              ]}
            >
              <View style={styles.complexIcon}>
                {complex.organizerLogoUrl ? (
                  <Image source={{ uri: complex.organizerLogoUrl }} style={styles.complexLogo} />
                ) : (
                  <Ionicons color={colors.primaryDark} name="business-outline" size={20} />
                )}
              </View>
              <View style={styles.complexCopy}>
                <Text numberOfLines={1} style={styles.complexName}>{complex.name}</Text>
                <Text numberOfLines={1} style={styles.complexAddress}>{complex.address}</Text>
                <Text style={styles.complexMeta}>
                  {complex.availableCourts.length} cancha(s) disponibles
                  {Number.isFinite(complex.distanceKm)
                    ? ` - ${complex.distanceKm.toFixed(1)} km`
                    : ""}
                </Text>
                <View
                  style={[
                    styles.complexAvailabilityChip,
                    hasAvailableTurnos
                      ? styles.complexAvailabilityChipAvailable
                      : styles.complexAvailabilityChipUnavailable,
                  ]}
                >
                  <Text
                    style={[
                      styles.complexAvailabilityChipText,
                      hasAvailableTurnos
                        ? styles.complexAvailabilityChipTextAvailable
                        : styles.complexAvailabilityChipTextUnavailable,
                    ]}
                  >
                    {hasAvailableTurnos
                      ? "TURNOS DISPONIBLES"
                      : "NO HAY TURNOS DISPONIBLES"}
                  </Text>
                </View>
              </View>
            </Pressable>
          );
        })
          : null}

        {selectedComplex ? (
          <>
            <Text style={styles.sectionLabel}>Selecciona una cancha</Text>
            <View style={styles.courtsGrid}>
              {selectedComplex.availableCourts.map((court) => {
                const isSelected = court.id === selectedCourtId;

                return (
                  <Pressable
                    key={court.id}
                    onPress={() => handleSelectCourt(court)}
                    style={({ pressed }) => [
                      styles.courtCard,
                      isSelected ? styles.courtCardActive : null,
                      pressed ? styles.pressedState : null,
                    ]}
                  >
                    <Text style={styles.courtName}>{court.name}</Text>
                    <Text style={styles.courtEnvironment}>{getCourtEnvironmentLabel(court)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        {selectedCourt ? (
          <>
            <View style={styles.featuresRow}>
              {(selectedCourt.features || []).map((feature) => (
                <View key={feature} style={styles.featureChip}>
                  <Text style={styles.featureChipText}>{feature}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.sectionLabel}>Elegi un turno</Text>
            <View style={styles.slotsGrid}>
              {allCourtSlots.map((slot) => {
                const isSelected = slot === selectedSlot;
                const isAvailable = availableSlotSet.has(slot);

                return (
                  <Pressable
                    disabled={!isAvailable}
                    key={slot}
                    onPress={() => handleSelectSlot(slot)}
                    style={({ pressed }) => [
                      styles.slotChip,
                      isSelected ? styles.slotChipActive : null,
                      !isAvailable ? styles.slotChipDisabled : null,
                      pressed && isAvailable ? styles.pressedState : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.slotText,
                        isSelected ? styles.slotTextActive : null,
                        !isAvailable ? styles.slotTextDisabled : null,
                      ]}
                    >
                      {slot}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {!allCourtSlots.length ? (
              <Text style={styles.emptyInlineText}>No hay horarios cargados para este dia.</Text>
            ) : null}
          </>
        ) : null}

        {selectedSlot ? (
          <View style={styles.durationCard}>
            <Text style={styles.sectionLabelInline}>Duracion del turno</Text>
            <View style={styles.durationRow}>
              {DURATIONS.map((duration) => {
                const isSelected = duration === selectedDuration;

                return (
                  <Pressable
                    key={duration}
                    onPress={() => setSelectedDuration(duration)}
                    style={[
                      styles.durationChip,
                      isSelected ? styles.durationChipActive : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.durationChipText,
                        isSelected ? styles.durationChipTextActive : null,
                      ]}
                    >
                      {duration} min
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {canManageTurnos ? (
              <Pressable
                onPress={() => setPlayerPickerVisible(true)}
                style={({ pressed }) => [
                  styles.reservationPlayerButton,
                  selectedReservationPlayer ? styles.reservationPlayerButtonActive : null,
                  pressed ? styles.pressedState : null,
                ]}
              >
                <View style={styles.reservationPlayerIcon}>
                  <Ionicons
                    color={selectedReservationPlayer ? "#1E6B45" : colors.primaryDark}
                    name={selectedReservationPlayer?.type === "guest" ? "person-outline" : "person-add-outline"}
                    size={18}
                  />
                </View>
                <View style={styles.reservationPlayerCopy}>
                  <Text style={styles.reservationPlayerLabel}>Seleccionar usuario</Text>
                  <Text numberOfLines={1} style={styles.reservationPlayerName}>
                    {selectedReservationPlayer
                      ? selectedReservationPlayer.name
                      : "Persona registrada o no registrada"}
                  </Text>
                </View>
                <Ionicons color={colors.primaryDark} name="chevron-forward" size={17} />
              </Pressable>
            ) : null}
            <Pressable onPress={handleOpenSummary} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>RESERVAR</Text>
            </Pressable>
          </View>
        ) : null}
          </>
        ) : null}
          </>
        )}
      </ScrollView>

      <Modal
        animationType="fade"
        onRequestClose={() => setSummaryVisible(false)}
        transparent
        visible={summaryVisible}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setSummaryVisible(false)} />
          <View style={styles.summaryCard}>
            <View style={styles.summaryHero}>
              <View style={styles.summaryHeroIcon}>
                <Ionicons color={colors.primaryDark} name="calendar-clear-outline" size={24} />
              </View>
              <View style={styles.summaryHeroCopy}>
                <Text style={styles.summaryEyebrow}>Reserva de turno</Text>
                <Text style={styles.summaryTitle}>Confirma los datos</Text>
              </View>
            </View>

            <View style={styles.summaryDetailsCard}>
              <View style={styles.summaryInfoRow}>
                <View style={styles.summaryInfoIcon}>
                  <Ionicons color={colors.primaryDark} name="business-outline" size={17} />
                </View>
                <View style={styles.summaryInfoCopy}>
                  <Text style={styles.summaryInfoLabel}>Complejo</Text>
                  <Text numberOfLines={1} style={styles.summaryLine}>{selectedComplex?.name}</Text>
                  <Text numberOfLines={1} style={styles.summaryMuted}>{selectedComplex?.address}</Text>
                </View>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryInfoRow}>
                <View style={styles.summaryInfoIcon}>
                  <Ionicons color={colors.primaryDark} name="tennisball-outline" size={17} />
                </View>
                <View style={styles.summaryInfoCopy}>
                  <Text style={styles.summaryInfoLabel}>Cancha</Text>
                  <Text style={styles.summaryLine}>{selectedCourt?.name}</Text>
                  <Text style={styles.summaryMuted}>
                    {selectedDay?.fullLabel} - {selectedSlot} hs - {selectedDuration} min
                  </Text>
                </View>
              </View>
              {canManageTurnos ? (
                <>
                  <View style={styles.summaryDivider} />
                  <View style={styles.summaryInfoRow}>
                    <View style={styles.summaryInfoIcon}>
                      <Ionicons color={colors.primaryDark} name="person-outline" size={17} />
                    </View>
                    <View style={styles.summaryInfoCopy}>
                      <Text style={styles.summaryInfoLabel}>Reserva para</Text>
                      <Text numberOfLines={1} style={styles.summaryLine}>
                        {selectedReservationPlayer?.name || "Jugador"}
                      </Text>
                      <Text style={styles.summaryMuted}>
                        {selectedReservationPlayer?.type === "guest"
                          ? "Jugador no registrado"
                          : "Usuario registrado"}
                      </Text>
                    </View>
                  </View>
                </>
              ) : null}
            </View>

            <View style={styles.summaryPriceBlock}>
              <Text style={styles.summaryPriceLabel}>Precio del turno</Text>
              <Text style={styles.summaryPrice}>{formatCurrency(selectedPrice)}</Text>
            </View>

            <Text style={styles.summarySectionTitle}>Metodo de pago</Text>
            <View style={styles.paymentRow}>
              {paymentMethods.map((method) => {
                const isSelected = paymentMethod === method.key;

                return (
                  <Pressable
                    key={method.key}
                    onPress={() => setPaymentMethod(method.key)}
                    style={[
                      styles.paymentChip,
                      isSelected ? styles.paymentChipActive : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.paymentChipText,
                        isSelected ? styles.paymentChipTextActive : null,
                      ]}
                    >
                      {method.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {!canManageTurnos && selectedComplexMercadoPagoConfig.enabled ? (
              <Pressable
                onPress={handleOpenMercadoPagoInfo}
                style={({ pressed }) => [
                  styles.mercadoPagoActionButton,
                  pressed ? styles.pressedState : null,
                ]}
              >
                <Ionicons color="#1A7F5A" name="wallet-outline" size={17} />
                <Text style={styles.mercadoPagoActionButtonText}>Mercado Pago</Text>
              </Pressable>
            ) : null}
            {paymentMethod === "mercado_pago" ? (
              <View style={styles.mercadoPagoCheckoutHint}>
                <Ionicons color="#1A7F5A" name="open-outline" size={16} />
                <Text style={styles.mercadoPagoCheckoutHintText}>
                  Al confirmar, se abrira Mercado Pago para completar el pago del turno.
                </Text>
              </View>
            ) : null}
            {paymentMethod === "transferencia" ? (
              <Pressable onPress={handlePickReceipt} style={styles.receiptButton}>
                <Ionicons color={colors.primaryDark} name="document-attach-outline" size={18} />
                <Text style={styles.receiptButtonText}>
                  {receiptAsset ? receiptAsset.name : "Cargar comprobante"}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              disabled={confirming}
              onPress={handleConfirmReservation}
              style={[
                styles.primaryButton,
                confirming ? styles.primaryButtonDisabled : null,
              ]}
            >
              <Text style={styles.primaryButtonText}>
                {confirming ? "CONFIRMANDO..." : "CONFIRMAR RESERVA"}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={() => setWhatsAppConfirmationReservation(null)}
        transparent
        visible={Boolean(whatsAppConfirmationReservation)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setWhatsAppConfirmationReservation(null)}
          />
          <View style={styles.whatsAppConfirmCard}>
            <View style={styles.summaryHero}>
              <View style={styles.summaryHeroIcon}>
                <Ionicons color="#1E7A43" name="logo-whatsapp" size={24} />
              </View>
              <View style={styles.summaryHeroCopy}>
                <Text style={styles.summaryEyebrow}>Reserva confirmada</Text>
                <Text style={styles.summaryTitle}>Notificar por WhatsApp</Text>
              </View>
            </View>
            {whatsAppConfirmationReservation?.playerId ? (
              <Text style={styles.whatsAppInternalNotice}>Notificacion interna enviada</Text>
            ) : null}
            <Text style={styles.whatsAppConfirmText}>
              ¿Desea notificar por WhatsApp la confirmacion de la reserva?
            </Text>
            <View style={styles.whatsAppConfirmActions}>
              <Pressable
                onPress={() => setWhatsAppConfirmationReservation(null)}
                style={({ pressed }) => [
                  styles.whatsAppConfirmButton,
                  styles.whatsAppConfirmButtonSecondary,
                  pressed ? styles.pressedState : null,
                ]}
              >
                <Text style={styles.whatsAppConfirmButtonSecondaryText}>NO</Text>
              </Pressable>
              <Pressable
                onPress={handleNotifyReservationConfirmationWhatsApp}
                style={({ pressed }) => [
                  styles.whatsAppConfirmButton,
                  styles.whatsAppConfirmButtonPrimary,
                  pressed ? styles.pressedState : null,
                ]}
              >
                <Text style={styles.whatsAppConfirmButtonPrimaryText}>SI</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={() => setPlayerPickerVisible(false)}
        transparent
        visible={playerPickerVisible}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalKeyboardAvoiding}
        >
          <View style={styles.modalOverlay}>
            <Pressable style={styles.modalBackdrop} onPress={() => setPlayerPickerVisible(false)} />
            <View style={styles.playerPickerCard}>
            <Text style={styles.summaryTitle}>Asignar reserva</Text>
            <Text style={styles.playerPickerSubtitle}>
              Selecciona una persona registrada o carga una no registrada.
            </Text>
            <View style={styles.playerSearchBox}>
              <Ionicons color={colors.muted} name="search-outline" size={17} />
              <TextInput
                onChangeText={setPlayerQuery}
                placeholder="Buscar por nombre, categoria o ciudad"
                placeholderTextColor={colors.muted}
                style={styles.playerSearchInput}
                value={playerQuery}
              />
            </View>
            <ScrollView style={styles.playerPickerList}>
              {filteredPlayersDirectory.slice(0, 25).map((player) => (
                <Pressable
                  key={player.id}
                  onPress={() => handleSelectRegisteredReservationPlayer(player)}
                  style={({ pressed }) => [
                    styles.playerPickerOption,
                    pressed ? styles.pressedState : null,
                  ]}
                >
                  <View style={styles.playerPickerAvatar}>
                    <Ionicons color={colors.primaryDark} name="person-outline" size={17} />
                  </View>
                  <View style={styles.playerPickerCopy}>
                    <Text numberOfLines={1} style={styles.playerPickerName}>
                      {[player.nombre, player.apellido].filter(Boolean).join(" ") || "Jugador"}
                    </Text>
                    <Text numberOfLines={1} style={styles.playerPickerMeta}>
                      {[player.categoria, player.ciudad].filter(Boolean).join(" - ") ||
                        "Usuario registrado"}
                    </Text>
                  </View>
                </Pressable>
              ))}
              {!filteredPlayersDirectory.length ? (
                <Text style={styles.emptyInlineText}>No encontramos jugadores registrados.</Text>
              ) : null}
            </ScrollView>
            <View style={styles.guestReservationBox}>
              <Text style={styles.summarySectionTitle}>Jugador no registrado</Text>
              <View style={styles.guestReservationInputs}>
                <TextInput
                  onChangeText={setGuestReservationName}
                  placeholder="Nombre"
                  placeholderTextColor={colors.muted}
                  style={styles.guestReservationInput}
                  value={guestReservationName}
                />
                <TextInput
                  onChangeText={setGuestReservationLastName}
                  placeholder="Apellido"
                  placeholderTextColor={colors.muted}
                  style={styles.guestReservationInput}
                  value={guestReservationLastName}
                />
              </View>
              <TextInput
                keyboardType="phone-pad"
                onChangeText={setGuestReservationPhone}
                placeholder="Telefono opcional"
                placeholderTextColor={colors.muted}
                style={styles.guestReservationInput}
                value={guestReservationPhone}
              />
              <Pressable onPress={handleCreateGuestReservationPlayer} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>CREAR NO REGISTRADO</Text>
              </Pressable>
            </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={closeReservationDetail}
        transparent
        visible={Boolean(reservationDetail)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={closeReservationDetail} />
          <View style={styles.reservationDetailCard}>
            <Text style={styles.summaryTitle}>Detalle de reserva</Text>
            <View style={styles.summaryDetailsCard}>
              <View style={styles.summaryInfoRow}>
                <View style={styles.summaryInfoIcon}>
                  <Ionicons color={colors.primaryDark} name="person-outline" size={17} />
                </View>
                <View style={styles.summaryInfoCopy}>
                  <Text style={styles.summaryInfoLabel}>Jugador</Text>
                  <Text numberOfLines={1} style={styles.summaryLine}>
                    {reservationDetail?.playerName || "Jugador"}
                  </Text>
                  <Text style={styles.summaryMuted}>
                    {reservationDetail?.playerPhone || "Sin telefono cargado"}
                  </Text>
                </View>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryInfoRow}>
                <View style={styles.summaryInfoIcon}>
                  <Ionicons color={colors.primaryDark} name="calendar-outline" size={17} />
                </View>
                <View style={styles.summaryInfoCopy}>
                  <Text style={styles.summaryInfoLabel}>Turno</Text>
                  <Text style={styles.summaryLine}>{reservationDetail?.courtName || "Cancha"}</Text>
                  <Text style={styles.summaryMuted}>
                    {reservationDetail?.dateLabel || "Fecha"} - {reservationDetail?.time || ""} hs -{" "}
                    {reservationDetail?.durationMinutes || 60} min
                  </Text>
                </View>
              </View>
            </View>
            <Pressable
              disabled={!isReservationActive(reservationDetail) || runningReservationActionId === reservationDetail?.id}
              onPress={async () => {
                await handleCancelReservation(reservationDetail);
                closeReservationDetail();
              }}
              style={[
                styles.reservationCancelWideButton,
                !isReservationActive(reservationDetail) ||
                runningReservationActionId === reservationDetail?.id
                  ? styles.reservationActionButtonDisabled
                  : null,
              ]}
            >
              <Ionicons color="#B94141" name="close-outline" size={18} />
              <Text style={styles.reservationCancelWideButtonText}>Cancelar reserva</Text>
            </Pressable>
            <View style={styles.reservationPaymentSummaryCard}>
              <View style={styles.reservationPaymentSummaryHeader}>
                <Text style={styles.reservationPaymentSummaryTitle}>Cobro del turno</Text>
                <Text style={styles.reservationPaymentSummaryStatus}>
                  {getTurnoReservationPaymentStatusLabel(reservationDetail)}
                </Text>
              </View>
              <View style={styles.reservationPaymentSummaryRow}>
                <Text style={styles.reservationPaymentSummaryLabel}>Total</Text>
                <Text style={styles.reservationPaymentSummaryValue}>
                  {formatCurrency(getTurnoReservationPaymentSummary(reservationDetail).totalAmount)}
                </Text>
              </View>
              <View style={styles.reservationPaymentSummaryRow}>
                <Text style={styles.reservationPaymentSummaryLabel}>Pagado</Text>
                <Text style={styles.reservationPaymentSummaryValue}>
                  {formatCurrency(getTurnoReservationPaymentSummary(reservationDetail).paidAmount)}
                </Text>
              </View>
              <View style={styles.reservationPaymentSummaryRow}>
                <Text style={styles.reservationPaymentSummaryLabel}>Pendiente</Text>
                <Text
                  style={[
                    styles.reservationPaymentSummaryValue,
                    getTurnoReservationPaymentSummary(reservationDetail).pendingAmount > 0
                      ? styles.reservationPaymentSummaryPending
                      : styles.reservationPaymentSummaryPaid,
                  ]}
                >
                  {formatCurrency(getTurnoReservationPaymentSummary(reservationDetail).pendingAmount)}
                </Text>
              </View>
              {getTurnoReservationPaymentSummary(reservationDetail).paymentMovements.length ? (
                <View style={styles.reservationPaymentList}>
                  {getTurnoReservationPaymentSummary(reservationDetail).paymentMovements.map((movement) => (
                    <View key={movement.id} style={styles.reservationPaymentItem}>
                      <View style={styles.reservationPaymentItemCopy}>
                        <Text style={styles.reservationPaymentItemTitle}>
                          {formatTurnoPaymentMethodLabel(movement.method)}
                          {movement.payerLabel ? ` · ${movement.payerLabel}` : ""}
                        </Text>
                        <Text style={styles.reservationPaymentItemMeta}>
                          {formatReservationPaymentMovementDate(movement.createdAtMillis)}
                          {movement.proofFileName ? " · Con comprobante" : ""}
                        </Text>
                      </View>
                      <Text style={styles.reservationPaymentItemAmount}>
                        {formatCurrency(movement.amount)}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.reservationPaymentEmpty}>
                  Todavia no se registraron pagos para esta reserva.
                </Text>
              )}
            </View>
            <View style={styles.reservationDetailActions}>
              <Pressable
                disabled={getTurnoReservationPaymentSummary(reservationDetail).pendingAmount <= 0}
                onPress={() => openReservationPaymentEntry(reservationDetail)}
                style={[
                  styles.reservationDetailAction,
                  styles.reservationDetailPayment,
                  getTurnoReservationPaymentSummary(reservationDetail).pendingAmount <= 0
                    ? styles.reservationActionButtonDisabled
                    : null,
                ]}
              >
                <Ionicons color={colors.primaryDark} name="card-outline" size={17} />
                <Text style={styles.reservationDetailActionText}>Ingresar pago</Text>
              </Pressable>
              <Pressable
                disabled={!reservationDetail?.playerId}
                onPress={() => {
                  handleOpenReservationMessage(reservationDetail);
                  closeReservationDetail();
                }}
                style={[
                  styles.reservationDetailAction,
                  !reservationDetail?.playerId ? styles.reservationActionButtonDisabled : null,
                ]}
              >
                <Ionicons color={colors.primaryDark} name="chatbubble-ellipses-outline" size={17} />
                <Text style={styles.reservationDetailActionText}>Mensaje</Text>
              </Pressable>
              <Pressable
                disabled={!buildWhatsAppPhoneNumber(reservationDetail?.playerPhone, reservationDetail?.playerCountryCode)}
                onPress={() => handleOpenReservationWhatsApp(reservationDetail)}
                style={[
                  styles.reservationDetailAction,
                  !buildWhatsAppPhoneNumber(reservationDetail?.playerPhone, reservationDetail?.playerCountryCode)
                    ? styles.reservationActionButtonDisabled
                    : null,
                ]}
              >
                <Ionicons color="#1E7A43" name="logo-whatsapp" size={17} />
                <Text style={styles.reservationDetailActionText}>WhatsApp</Text>
              </Pressable>
            </View>
            <Pressable onPress={closeReservationDetail} style={styles.reservationDetailCloseButton}>
              <Text style={styles.reservationDetailCloseButtonText}>Salir</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={() => setCalendarVisible(false)}
        transparent
        visible={calendarVisible}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setCalendarVisible(false)} />
          <View style={styles.calendarCard}>
            <Text style={styles.summaryTitle}>Aplicar disponibilidad</Text>
            <Text style={styles.calendarSubtitle}>
              Selecciona los dias que van a recibir los horarios configurados.
            </Text>
            <View style={styles.calendarRows}>
              <View style={styles.calendarColumnActionsRow}>
                <View style={styles.calendarColumnActions}>
                  {calendarRows[0]?.map((calendarDay, columnIndex) => {
                    const columnDateIds = getCalendarColumnDateIds(columnIndex);
                    const columnIsComplete =
                      columnDateIds.length > 0 &&
                      columnDateIds.every((dateId) => selectedConfigDateIds.includes(dateId));

                    return (
                      <Pressable
                        disabled={!columnDateIds.length}
                        key={`column-${columnIndex}`}
                        onPress={() => toggleConfigDateRow(columnDateIds)}
                        style={[
                          styles.calendarColumnAction,
                          columnIsComplete ? styles.calendarRowActionActive : null,
                          !columnDateIds.length ? styles.calendarColumnActionDisabled : null,
                        ]}
                      >
                        <Text
                          style={[
                            styles.calendarColumnActionText,
                            columnIsComplete ? styles.calendarColumnActionTextActive : null,
                          ]}
                        >
                          {calendarDay.dayName}
                        </Text>
                        <Ionicons
                          color={columnIsComplete ? "#1E6B45" : "#1E5F86"}
                          name={columnIsComplete ? "checkmark-done-outline" : "chevron-down-outline"}
                          size={12}
                        />
                      </Pressable>
                    );
                  })}
                </View>
                <View style={styles.calendarRowActionSpacer} />
              </View>
              {calendarRows.map((calendarRow) => {
                const rowDateIds = calendarRow
                  .filter((calendarDay) => !calendarDay.isDisabled)
                  .map((calendarDay) => calendarDay.id);
                const rowIsComplete =
                  rowDateIds.length > 0 &&
                  rowDateIds.every((dateId) => selectedConfigDateIds.includes(dateId));

                return (
                  <View key={rowDateIds.join("-")} style={styles.calendarRow}>
                    <View style={styles.calendarRowDays}>
                      {calendarRow.map((calendarDay) => {
                        const isSelected = selectedConfigDateIds.includes(calendarDay.id);

                        return (
                          <Pressable
                            disabled={calendarDay.isDisabled}
                            key={calendarDay.id}
                            onPress={() => toggleConfigDate(calendarDay.id)}
                            style={[
                              styles.calendarDay,
                              isSelected ? styles.calendarDayActive : null,
                              calendarDay.isToday ? styles.calendarDayToday : null,
                              calendarDay.isDisabled ? styles.calendarDayDisabled : null,
                            ]}
                          >
                            <Text
                              style={[
                                styles.calendarDayTop,
                                isSelected ? styles.calendarDayTextActive : null,
                                calendarDay.isDisabled ? styles.calendarDayTextDisabled : null,
                              ]}
                            >
                              {calendarDay.isToday ? "HOY" : calendarDay.dayName}
                            </Text>
                            <Text
                              style={[
                                styles.calendarDayNumber,
                                isSelected ? styles.calendarDayTextActive : null,
                                calendarDay.isDisabled ? styles.calendarDayTextDisabled : null,
                              ]}
                            >
                              {calendarDay.dayNumber}
                            </Text>
                            <Text
                              style={[
                                styles.calendarDayBottom,
                                isSelected ? styles.calendarDayTextActive : null,
                                calendarDay.isDisabled ? styles.calendarDayTextDisabled : null,
                              ]}
                            >
                              {calendarDay.monthName}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Pressable
                      onPress={() => toggleConfigDateRow(rowDateIds)}
                      style={[
                        styles.calendarRowAction,
                        rowIsComplete ? styles.calendarRowActionActive : null,
                      ]}
                    >
                      <Ionicons
                        color={rowIsComplete ? "#1E6B45" : "#1E5F86"}
                        name={rowIsComplete ? "checkmark-done-outline" : "chevron-forward-outline"}
                        size={14}
                      />
                    </Pressable>
                  </View>
                );
              })}
            </View>
            <Pressable onPress={() => setCalendarVisible(false)} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>LISTO</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={closeReservationPaymentEntry}
        transparent
        visible={paymentEntryVisible}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={closeReservationPaymentEntry} />
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "position"}
            keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 12}
            style={styles.reservationPaymentEntryKeyboard}
          >
            <View style={styles.reservationPaymentEntryCard}>
              <Text style={styles.summaryTitle}>Registrar cobro</Text>
              <Text style={styles.reservationPaymentEntryHint}>
                Carga un pago parcial o total para esta reserva.
              </Text>
              <View style={styles.reservationPaymentHeaderCard}>
                <View style={styles.reservationPaymentHeaderTop}>
                  <View style={styles.summaryInfoIcon}>
                    <Ionicons color={colors.primaryDark} name="card-outline" size={17} />
                  </View>
                  <View style={styles.reservationPaymentHeaderCopy}>
                    <Text style={styles.reservationPaymentHeaderTitle}>Cobro de la reserva</Text>
                    <Text style={styles.reservationPaymentHeaderMeta}>
                      {reservationDetail?.courtName || "Cancha"} · {reservationDetail?.time || "--:--"} hs
                    </Text>
                  </View>
                </View>
                <View style={styles.reservationPaymentQuickSummary}>
                  <View style={styles.reservationPaymentQuickItem}>
                    <Text style={styles.reservationPaymentQuickLabel}>Total</Text>
                    <Text style={styles.reservationPaymentQuickValue}>
                      {formatCurrency(getTurnoReservationPaymentSummary(reservationDetail).totalAmount)}
                    </Text>
                  </View>
                  <View style={styles.reservationPaymentQuickDivider} />
                  <View style={styles.reservationPaymentQuickItem}>
                    <Text style={styles.reservationPaymentQuickLabel}>Pagado</Text>
                    <Text style={styles.reservationPaymentQuickValue}>
                      {formatCurrency(getTurnoReservationPaymentSummary(reservationDetail).paidAmount)}
                    </Text>
                  </View>
                  <View style={styles.reservationPaymentQuickDivider} />
                  <View style={styles.reservationPaymentQuickItem}>
                    <Text style={styles.reservationPaymentQuickLabel}>Pendiente</Text>
                    <Text
                      style={[
                        styles.reservationPaymentQuickValue,
                        getTurnoReservationPaymentSummary(reservationDetail).pendingAmount > 0
                          ? styles.reservationPaymentSummaryPending
                          : styles.reservationPaymentSummaryPaid,
                      ]}
                    >
                      {formatCurrency(getTurnoReservationPaymentSummary(reservationDetail).pendingAmount)}
                    </Text>
                  </View>
                </View>
              </View>

              <Text style={styles.reservationPaymentSectionLabel}>Metodo de pago</Text>
              <View style={styles.summaryPaymentRow}>
                {BASE_PAYMENT_METHODS.map((method) => {
                  const isActive = paymentEntryMethod === method.key;

                    return (
                      <Pressable
                        key={`entry-${method.key}`}
                        onPress={() => setPaymentEntryMethod(method.key)}
                        style={[styles.summaryPaymentMethod, isActive ? styles.summaryPaymentMethodActive : null]}
                      >
                        <Text
                          style={[
                            styles.summaryPaymentMethodText,
                            isActive ? styles.summaryPaymentMethodTextActive : null,
                          ]}
                        >
                          {method.label}
                        </Text>
                      </Pressable>
                  );
                })}
              </View>

              <View style={styles.reservationPaymentAmountCard}>
                <Text style={styles.reservationPaymentSectionLabel}>Monto</Text>
                <View style={styles.reservationPaymentAmountInputWrap}>
                  <Text style={styles.reservationPaymentCurrency}>$</Text>
                  <TextInput
                    keyboardType="decimal-pad"
                    onChangeText={setPaymentEntryAmount}
                    placeholder="0"
                    placeholderTextColor={colors.muted}
                    style={styles.reservationPaymentAmountInput}
                    value={paymentEntryAmount}
                  />
                </View>
              </View>

              {paymentEntryMethod === "transferencia" ? (
                <View style={styles.reservationPaymentProofCard}>
                  <Text style={styles.reservationPaymentSectionLabel}>Comprobante opcional</Text>
                  <Pressable
                    onPress={handlePickReservationPaymentReceipt}
                    style={styles.reservationPaymentProofButton}
                  >
                    <Ionicons color={colors.primaryDark} name="document-attach-outline" size={16} />
                    <Text style={styles.reservationPaymentProofButtonText}>
                      {paymentEntryReceiptAsset ? "Cambiar comprobante" : "Adjuntar comprobante"}
                    </Text>
                  </Pressable>
                  {paymentEntryReceiptAsset ? (
                    <Text style={styles.reservationPaymentProofName}>
                      {paymentEntryReceiptAsset.name || "Archivo cargado"}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.reservationPaymentEntryActions}>
                <Pressable onPress={closeReservationPaymentEntry} style={styles.reservationPaymentSecondaryButton}>
                  <Text style={styles.reservationPaymentSecondaryButtonText}>Cerrar</Text>
                </Pressable>
                <Pressable
                  disabled={savingReservationPayment}
                  onPress={handleSaveReservationPayment}
                  style={[
                    styles.reservationPaymentPrimaryButton,
                    savingReservationPayment ? styles.primaryButtonDisabled : null,
                  ]}
                >
                  <Text style={styles.reservationPaymentPrimaryButtonText}>
                    {savingReservationPayment ? "Guardando..." : "Registrar pago"}
                  </Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={() => setPriceApplyContext(null)}
        transparent
        visible={Boolean(priceApplyContext)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setPriceApplyContext(null)} />
          <View style={styles.priceApplyCard}>
            <Text style={styles.summaryTitle}>Aplicar precio</Text>
            <Text style={styles.priceApplySubtitle}>
              {priceApplyCourt
                ? `Copiar precio de ${priceApplyCourt.name}`
                : "Selecciona las canchas destino"}
            </Text>
            <View style={styles.priceApplyList}>
              {(priceApplyComplex?.courts || []).map((court) => {
                const selectedCourtIds = getSelectedPriceCourtIds(
                  priceApplyComplex,
                  priceApplyCourt?.id
                );
                const isSelected = selectedCourtIds.includes(court.id);

                return (
                  <Pressable
                    key={court.id}
                    onPress={() => togglePriceCourt(priceApplyComplex, court.id)}
                    style={[
                      styles.priceApplyOption,
                      isSelected ? styles.priceApplyOptionActive : null,
                    ]}
                  >
                    <View
                      style={[
                        styles.priceApplyCheck,
                        isSelected ? styles.priceApplyCheckActive : null,
                      ]}
                    >
                      {isSelected ? (
                        <Ionicons color="#1E6B45" name="checkmark" size={13} />
                      ) : null}
                    </View>
                    <View style={styles.priceApplyOptionCopy}>
                      <Text style={styles.priceApplyOptionTitle}>{court.name}</Text>
                      <Text style={styles.priceApplyOptionMeta}>
                        60 min {formatCurrency(court.price60)} - 90 min {formatCurrency(court.price90)}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <Pressable onPress={applyPriceToSelectedCourts} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>APLICAR PRECIO</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={() => setLocationActionsVisible(false)}
        transparent
        visible={locationActionsVisible}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setLocationActionsVisible(false)} />
          <View style={styles.locationOptionsCard}>
            <Text style={styles.summaryTitle}>Ubicacion</Text>
            <Text style={styles.locationOptionsSubtitle}>
              Usa tu ubicacion para ordenar y filtrar complejos cercanos.
            </Text>

            <Text style={styles.locationOptionsLabel}>Radio de busqueda</Text>
            <View style={styles.radiusOptionsRow}>
              {PROXIMITY_RADIUS_OPTIONS.map((radiusKm) => {
                const isSelected = proximityFilter.radiusKm === radiusKm;

                return (
                  <Pressable
                    key={radiusKm}
                    onPress={() =>
                      setProximityFilter((current) => ({
                        ...current,
                        radiusKm,
                      }))
                    }
                    style={[
                      styles.radiusOption,
                      isSelected ? styles.radiusOptionActive : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.radiusOptionText,
                        isSelected ? styles.radiusOptionTextActive : null,
                      ]}
                    >
                      {radiusKm} km
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              disabled={locatingUser}
              onPress={handleUseCurrentLocation}
              style={[styles.primaryButton, locatingUser ? styles.primaryButtonDisabled : null]}
            >
              <Text style={styles.primaryButtonText}>
                {locatingUser ? "BUSCANDO..." : "USAR MI UBICACION"}
              </Text>
            </Pressable>
            <Pressable onPress={handleDisableProximityFilter} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonText}>VOLVER A LOCALIDAD</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <FeedbackModal
        message={feedback.message}
        onClose={() => setFeedback({ visible: false, title: "", message: "", tone: "default" })}
        title={feedback.title}
        tone={feedback.tone}
        visible={feedback.visible}
      />

      <PadelNexoLoadingOverlay
        message="Cargando..."
        visible={loadingFocusedReservation}
      />

      <BottomQuickActionsBar navigation={navigation} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: spacing.lg + BOTTOM_QUICK_ACTIONS_SPACE,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
  contentScroller: {
    marginTop: 0,
  },
  reservationTopActions: {
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  turnosAreaButton: {
    alignItems: "center",
    backgroundColor: "#F4F7F5",
    borderColor: "#CBD8D2",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  turnosAreaButtonActive: {
    backgroundColor: "#4F625C",
    borderColor: "#4F625C",
  },
  turnosAreaButtonText: {
    color: "#4F625C",
    fontSize: 12,
    fontWeight: "900",
  },
  turnosAreaButtonTextActive: {
    color: colors.surface,
  },
  headerFilterBar: {
    flex: 1,
    marginHorizontal: 0,
    marginTop: 0,
    minHeight: 38,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    shadowOpacity: 0.02,
    elevation: 1,
  },
  filterLocationRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    marginBottom: 2,
    marginHorizontal: spacing.md,
    marginTop: 0,
  },
  locationActionButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.02,
    shadowRadius: 8,
    width: 42,
    elevation: 1,
  },
  locationActionButtonActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  modalLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    marginBottom: spacing.xs,
    marginTop: spacing.xs,
    textTransform: "uppercase",
  },
  placeholderField: {
    alignItems: "center",
    backgroundColor: "#F7FBF9",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 42,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  placeholderFieldText: {
    color: colors.muted,
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    marginLeft: spacing.sm,
  },
  datesHeaderRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  daysRow: {
    gap: spacing.xs,
    paddingRight: spacing.xs,
  },
  dayPill: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    height: 76,
    justifyContent: "center",
    width: 54,
  },
  dayPillManager: {
    backgroundColor: "#EEF6FF",
    borderColor: "#BBD7F2",
    height: 86,
    paddingBottom: 5,
  },
  dayPillActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  dayTop: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
  },
  dayNumber: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "900",
    lineHeight: 26,
  },
  dayBottom: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
  },
  dayTextActive: {
    color: colors.surface,
  },
  daySelectDot: {
    alignItems: "center",
    backgroundColor: "#F3F6F4",
    borderColor: "#C8D6CE",
    borderRadius: 999,
    borderWidth: 1,
    height: 14,
    justifyContent: "center",
    marginTop: 4,
    width: 14,
  },
  daySelectDotActive: {
    backgroundColor: "#B7F23A",
    borderColor: "#6FAF16",
  },
  daySelectDotOnActive: {
    backgroundColor: "rgba(255,255,255,0.92)",
    borderColor: "rgba(255,255,255,0.95)",
  },
  todayBadge: {
    alignItems: "center",
    backgroundColor: "#EAF8F3",
    borderColor: "#B8E3D2",
    borderRadius: 14,
    borderWidth: 1,
    gap: 2,
    height: 76,
    justifyContent: "center",
    width: 58,
  },
  todayBadgeButton: {
    borderColor: colors.primaryDark,
  },
  todayBadgeText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
  },
  organizerCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.sm,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  unsavedChangesBanner: {
    alignItems: "center",
    backgroundColor: "#EEF1FF",
    borderColor: "#A9B4F5",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  unsavedChangesText: {
    color: "#263172",
    flex: 1,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
  },
  approvalCard: {
    alignItems: "center",
    backgroundColor: "#F7FBF9",
    borderColor: "#DDEAE3",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.sm,
  },
  approvalCopy: {
    flex: 1,
  },
  approvalTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  approvalText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 16,
    marginTop: 2,
  },
  approvalToggle: {
    alignItems: "center",
    backgroundColor: "#EEF3F6",
    borderColor: "#C9D6DE",
    borderRadius: 999,
    borderWidth: 1,
    minWidth: 58,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  approvalToggleActive: {
    backgroundColor: "#E7F6EF",
    borderColor: "#83CDA7",
  },
  approvalToggleText: {
    color: "#4B6472",
    fontSize: 12,
    fontWeight: "900",
  },
  approvalToggleTextActive: {
    color: "#1E6B45",
  },
  mercadoPagoStatusCard: {
    backgroundColor: "#F7FAFD",
    borderColor: "#D8E4EC",
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: spacing.sm,
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
  organizerComplexSelect: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  managementComplexSelect: {
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  organizerComplexColorDot: {
    borderRadius: 999,
    height: 10,
    width: 10,
  },
  managementComplexColorDot: {
    marginRight: 0,
  },
  organizerComplexSelectCopy: {
    flex: 1,
  },
  managementComplexSelectCopy: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    justifyContent: "center",
  },
  organizerComplexLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  managementComplexLabel: {
    textAlign: "center",
  },
  organizerComplexSelectText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "900",
    textAlign: "left",
  },
  managementComplexSelectText: {
    flex: 0,
    textAlign: "center",
  },
  managementComplexOptionText: {
    textAlign: "center",
  },
  organizerComplexOptions: {
    gap: spacing.xs,
  },
  organizerComplexOption: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 38,
    overflow: "hidden",
    paddingHorizontal: spacing.md,
  },
  organizerComplexOptionStripe: {
    bottom: 0,
    left: 0,
    position: "absolute",
    top: 0,
    width: 5,
  },
  organizerComplexOptionText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "left",
  },
  configComplexCard: {
    backgroundColor: "#F7FBF9",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.sm,
  },
  complexNameChip: {
    alignSelf: "center",
    backgroundColor: "#EEF6FF",
    borderColor: "#BBD7F2",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  complexNameChipText: {
    color: "#1E5F86",
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
  },
  configComplexAddress: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  configCourtsRow: {
    gap: spacing.xs,
    paddingVertical: 2,
  },
  configCourtSelector: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    minHeight: 38,
    paddingHorizontal: 12,
  },
  configCourtSelectorActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  configCourtSelectorText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
  },
  configCourtSelectorTextActive: {
    color: colors.surface,
  },
  configCourtStatusDot: {
    backgroundColor: "#C8D0D6",
    borderRadius: 999,
    height: 7,
    width: 7,
  },
  configCourtStatusDotActive: {
    backgroundColor: "#D9FF63",
  },
  configCourtCard: {
    backgroundColor: colors.surface,
    borderColor: "#DDEAE3",
    borderRadius: 12,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.sm,
  },
  configCourtHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  configCourtName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  configCourtMeta: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
  },
  toggleChip: {
    backgroundColor: "#F0F2F4",
    borderColor: "#D6DDE3",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  toggleChipActive: {
    backgroundColor: "#D9FF63",
    borderColor: "#A6D831",
  },
  toggleChipText: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "900",
  },
  toggleChipTextActive: {
    color: "#295400",
  },
  configInputsRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  configInputWrap: {
    flex: 1,
  },
  inputLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    marginBottom: 4,
    textTransform: "uppercase",
  },
  configInput: {
    backgroundColor: "#F7FBF9",
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    minHeight: 40,
    paddingHorizontal: spacing.sm,
  },
  pricePanel: {
    backgroundColor: "#F3FAF6",
    borderColor: "#CDE6D8",
    borderRadius: 14,
    borderWidth: 1,
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
  },
  pricePanelHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
  },
  pricePanelTitle: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "uppercase",
  },
  priceDurationLabel: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "900",
    marginBottom: 3,
    textAlign: "center",
  },
  applyPriceButton: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#E5F7EE",
    borderColor: "#91D7B2",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    minHeight: 30,
    paddingHorizontal: 12,
  },
  applyPriceButtonText: {
    color: "#1E6B45",
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  priceInput: {
    backgroundColor: colors.surface,
    borderColor: "#BFDCCD",
    borderRadius: 999,
    borderWidth: 1,
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "900",
    minHeight: 30,
    paddingHorizontal: 8,
    paddingVertical: 3,
    textAlign: "center",
  },
  configSlotsGrid: {
    gap: spacing.xs,
  },
  applyDaysButton: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: "#EEF6FF",
    borderColor: "#BBD7F2",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  applyDaysButtonText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  configSlotRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  configSlotRowTimes: {
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
  },
  configSlotChip: {
    alignItems: "center",
    backgroundColor: "#F7FBF9",
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    minWidth: 62,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  configSlotChipActive: {
    backgroundColor: "#E5F7EE",
    borderColor: "#91D7B2",
  },
  configSlotChipText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
  },
  configSlotChipTextActive: {
    color: "#1E6B45",
  },
  configSlotRowAction: {
    alignItems: "center",
    backgroundColor: "#EEF6FF",
    borderColor: "#BBD7F2",
    borderRadius: 999,
    borderWidth: 1,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  configSlotRowActionActive: {
    backgroundColor: "#E5F7EE",
    borderColor: "#91D7B2",
  },
  sectionLabel: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900",
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  sectionLabelInline: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  loadingBox: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  loadingText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    padding: spacing.md,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  emptyText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
    marginTop: 4,
  },
  emptyInlineText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    marginTop: spacing.xs,
  },
  filterFallbackText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
    marginBottom: spacing.xs,
    textAlign: "center",
  },
  proximityInfoText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
    marginBottom: spacing.xs,
    textAlign: "center",
  },
  complexCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.xs,
    padding: spacing.sm,
  },
  complexCardActive: {
    backgroundColor: "#EAF8F3",
    borderColor: "#8FD0A7",
  },
  complexIcon: {
    alignItems: "center",
    backgroundColor: "#F1FAF5",
    borderRadius: 18,
    height: 68,
    justifyContent: "center",
    overflow: "hidden",
    width: 68,
  },
  complexLogo: {
    height: "100%",
    resizeMode: "cover",
    width: "100%",
  },
  complexCopy: {
    flex: 1,
  },
  complexName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  complexAddress: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  complexMeta: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 2,
  },
  complexAvailabilityChip: {
    alignItems: "center",
    alignSelf: "center",
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 7,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  complexAvailabilityChipAvailable: {
    backgroundColor: "#EAF8F3",
    borderColor: "#91D7B2",
  },
  complexAvailabilityChipUnavailable: {
    backgroundColor: "#F4F6F8",
    borderColor: "#D6DDE3",
  },
  complexAvailabilityChipText: {
    fontSize: 10,
    fontWeight: "900",
    textAlign: "center",
  },
  complexAvailabilityChipTextAvailable: {
    color: "#1E6B45",
  },
  complexAvailabilityChipTextUnavailable: {
    color: "#6C7A86",
  },
  courtsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  courtCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 56,
    width: "31.5%",
    paddingHorizontal: 6,
    paddingVertical: 7,
  },
  courtCardActive: {
    backgroundColor: "#EAF8F3",
    borderColor: "#8FD0A7",
  },
  courtName: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
  },
  courtEnvironment: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "800",
    marginTop: 3,
    textAlign: "center",
  },
  featuresRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  featureChip: {
    backgroundColor: "#EEF6FF",
    borderColor: "#BBD7F2",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  featureChipText: {
    color: "#1E5F86",
    fontSize: 11,
    fontWeight: "900",
  },
  slotsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  slotChip: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    minWidth: 78,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  slotChipActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  slotChipDisabled: {
    backgroundColor: "#EEF1EF",
    borderColor: "#D8E0DC",
    opacity: 0.62,
  },
  slotText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  slotTextActive: {
    color: colors.surface,
  },
  slotTextDisabled: {
    color: "#9AA5A0",
  },
  durationCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  durationRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  durationChip: {
    alignItems: "center",
    backgroundColor: "#F7FBF9",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 9,
  },
  durationChipActive: {
    backgroundColor: "#EAF8F3",
    borderColor: "#92D4BE",
  },
  durationChipText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "900",
  },
  durationChipTextActive: {
    color: colors.primaryDark,
  },
  reservationPlayerButton: {
    alignItems: "center",
    backgroundColor: "#F7FBF9",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 54,
    paddingHorizontal: spacing.sm,
  },
  reservationPlayerButtonActive: {
    backgroundColor: "#EAF8F3",
    borderColor: "#91D7B2",
  },
  reservationPlayerIcon: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: "#D8EBE1",
    borderRadius: 999,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  reservationPlayerCopy: {
    flex: 1,
  },
  reservationPlayerLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  reservationPlayerName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
    marginTop: 2,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.primaryDark,
    borderRadius: 12,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  primaryButtonDisabled: {
    opacity: 0.6,
  },
  primaryButtonText: {
    color: colors.surface,
    fontSize: 13,
    fontWeight: "900",
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#EAF8F3",
    borderColor: "#91D7B2",
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  secondaryButtonText: {
    color: "#1E6B45",
    fontSize: 12,
    fontWeight: "900",
  },
  modalOverlay: {
    alignItems: "center",
    backgroundColor: colors.overlay,
    flex: 1,
    justifyContent: "center",
    padding: spacing.md,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  modalKeyboardAvoiding: {
    flex: 1,
  },
  summaryCard: {
    backgroundColor: colors.surface,
    borderColor: "#DDEAE3",
    borderRadius: 22,
    borderWidth: 1,
    gap: spacing.sm,
    overflow: "hidden",
    padding: spacing.md,
    width: "100%",
  },
  whatsAppConfirmCard: {
    backgroundColor: colors.surface,
    borderColor: "#DDEAE3",
    borderRadius: 22,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
    width: "100%",
  },
  whatsAppConfirmText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 21,
    textAlign: "center",
  },
  whatsAppInternalNotice: {
    backgroundColor: "#EAF8F3",
    borderColor: "#91D7B2",
    borderRadius: 999,
    borderWidth: 1,
    color: "#1E7A43",
    fontSize: 12,
    fontWeight: "900",
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    textAlign: "center",
  },
  whatsAppConfirmActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  whatsAppConfirmButton: {
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
  },
  whatsAppConfirmButtonPrimary: {
    backgroundColor: "#EAF8F3",
    borderColor: "#91D7B2",
  },
  whatsAppConfirmButtonSecondary: {
    backgroundColor: "#F7FBF9",
    borderColor: colors.border,
  },
  whatsAppConfirmButtonPrimaryText: {
    color: "#1E7A43",
    fontSize: 13,
    fontWeight: "900",
  },
  whatsAppConfirmButtonSecondaryText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "900",
  },
  playerPickerCard: {
    backgroundColor: colors.surface,
    borderColor: "#DDEAE3",
    borderRadius: 20,
    borderWidth: 1,
    gap: spacing.sm,
    maxHeight: "86%",
    padding: spacing.md,
    width: "100%",
  },
  reservationDetailCard: {
    backgroundColor: colors.surface,
    borderColor: "#DDEAE3",
    borderRadius: 20,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
    width: "100%",
  },
  reservationPaymentSummaryCard: {
    backgroundColor: "#FBFDFC",
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.sm,
  },
  reservationPaymentSummaryHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  reservationPaymentSummaryTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  reservationPaymentSummaryStatus: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  reservationPaymentSummaryRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  reservationPaymentSummaryLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  reservationPaymentSummaryValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  reservationPaymentSummaryPending: {
    color: "#B97818",
  },
  reservationPaymentSummaryPaid: {
    color: "#1E7A43",
  },
  reservationPaymentList: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  reservationPaymentItem: {
    alignItems: "center",
    backgroundColor: "#F7FBF9",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  reservationPaymentItemCopy: {
    flex: 1,
  },
  reservationPaymentItemTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
  },
  reservationPaymentItemMeta: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },
  reservationPaymentItemAmount: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
  },
  reservationPaymentEmpty: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
  },
  reservationDetailActions: {
    flexWrap: "wrap",
    flexDirection: "row",
    gap: spacing.xs,
  },
  reservationDetailAction: {
    alignItems: "center",
    backgroundColor: "#F7FBF9",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    gap: 3,
    minHeight: 54,
    justifyContent: "center",
    minWidth: "31%",
  },
  reservationDetailPayment: {
    backgroundColor: "#EEF7FF",
    borderColor: "#BEDCF4",
  },
  reservationCancelWideButton: {
    alignItems: "center",
    backgroundColor: "#FFF1F1",
    borderColor: "#F0B8B8",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  reservationCancelWideButtonText: {
    color: "#B94141",
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  reservationDetailCancel: {
    backgroundColor: "#FFF1F1",
    borderColor: "#F0B8B8",
  },
  reservationDetailActionText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "900",
  },
  reservationDetailCancelText: {
    color: "#B94141",
  },
  reservationDetailCloseButton: {
    alignItems: "center",
    backgroundColor: "#F7FBF9",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
  },
  reservationDetailCloseButtonText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  reservationPaymentEntryCard: {
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderColor: "#DDEAE3",
    borderRadius: 20,
    borderWidth: 1,
    elevation: 6,
    gap: spacing.sm,
    maxWidth: 430,
    padding: spacing.md,
    shadowColor: "#123B28",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    width: "100%",
  },
  reservationPaymentEntryHint: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
    marginTop: -4,
  },
  reservationPaymentHeaderCard: {
    backgroundColor: "#F8FCFA",
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  reservationPaymentHeaderTop: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  reservationPaymentHeaderCopy: {
    flex: 1,
  },
  reservationPaymentHeaderTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  reservationPaymentHeaderMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  reservationPaymentQuickSummary: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  reservationPaymentQuickItem: {
    alignItems: "center",
    flex: 1,
    gap: 2,
  },
  reservationPaymentQuickLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  reservationPaymentQuickValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  reservationPaymentQuickDivider: {
    backgroundColor: colors.border,
    height: 30,
    width: 1,
  },
  reservationPaymentEntryKeyboard: {
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    width: "100%",
  },
  reservationPaymentSectionLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  summaryPaymentRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  summaryPaymentMethod: {
    alignItems: "center",
    backgroundColor: "#FAFCFB",
    borderColor: "#DDEAE3",
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    minHeight: 40,
    paddingVertical: 8,
  },
  summaryPaymentMethodActive: {
    backgroundColor: "#EAF5FF",
    borderColor: "#B9D7F0",
  },
  summaryPaymentMethodText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
  },
  summaryPaymentMethodTextActive: {
    color: "#16537A",
  },
  reservationPaymentAmountCard: {
    backgroundColor: "#F9FCFA",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.sm,
  },
  reservationPaymentAmountInputWrap: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#D9E7DF",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "center",
    minHeight: 58,
    paddingHorizontal: spacing.sm,
  },
  reservationPaymentCurrency: {
    color: colors.primaryDark,
    fontSize: 24,
    fontWeight: "900",
    marginRight: 8,
  },
  reservationPaymentAmountInput: {
    color: colors.text,
    flex: 1,
    fontSize: 24,
    fontWeight: "900",
    minHeight: 58,
    textAlign: "center",
  },
  reservationPaymentProofCard: {
    backgroundColor: "#F9FCFA",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.sm,
  },
  reservationPaymentProofButton: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  reservationPaymentProofButtonText: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "800",
  },
  reservationPaymentProofName: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },
  reservationPaymentEntryActions: {
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  reservationPaymentSecondaryButton: {
    alignItems: "center",
    backgroundColor: "#FAFCFB",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
  },
  reservationPaymentSecondaryButtonText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800",
  },
  reservationPaymentPrimaryButton: {
    alignItems: "center",
    backgroundColor: "#1E5F86",
    borderColor: "#1E5F86",
    borderRadius: 14,
    borderWidth: 1,
    flex: 1.2,
    justifyContent: "center",
    minHeight: 46,
  },
  reservationPaymentPrimaryButtonText: {
    color: colors.surface,
    fontSize: 13,
    fontWeight: "800",
  },
  reservationDaysRow: {
    gap: spacing.xs,
    paddingVertical: 2,
  },
  reservationDayPill: {
    alignItems: "center",
    backgroundColor: "#F7FBF9",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    height: 76,
    justifyContent: "center",
    position: "relative",
    width: 54,
  },
  reservationDayPillActive: {
    backgroundColor: "#1E5F86",
    borderColor: "#1E5F86",
  },
  reservationDayText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
  },
  reservationDayNumber: {
    color: colors.text,
    fontSize: 21,
    fontWeight: "900",
    lineHeight: 25,
  },
  reservationDayTextActive: {
    color: colors.surface,
  },
  managementScheduleCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  managementCourtBlock: {
    gap: spacing.xs,
  },
  managementCourtHeader: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    justifyContent: "center",
  },
  managementCourtNameChip: {
    alignItems: "center",
    backgroundColor: "#EEF6FF",
    borderColor: "#8FC6EC",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 30,
    paddingHorizontal: 12,
  },
  managementCourtName: {
    color: "#155B86",
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
  },
  managementCourtDetailsRow: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  managementCourtDetailText: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "800",
    lineHeight: 13,
    textAlign: "left",
  },
  managementSlotsGrid: {
    gap: spacing.xs,
  },
  managementSlotRow: {
    width: "100%",
  },
  managementSlotRowTimes: {
    flexDirection: "row",
    gap: spacing.xs,
    width: "100%",
  },
  managementSlotChip: {
    alignItems: "center",
    backgroundColor: "#F7FBF9",
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    height: 52,
    justifyContent: "center",
    minWidth: 0,
    paddingHorizontal: 6,
    paddingVertical: 4,
    width: "23.5%",
  },
  managementSlotSpacer: {
    height: 52,
    minWidth: 0,
    width: "23.5%",
  },
  managementSlotChipReserved: {
    backgroundColor: "#EAF3FF",
    borderColor: "#7CB7E6",
  },
  managementSlotText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
  },
  managementSlotTextReserved: {
    color: "#155B86",
  },
  managementSlotViewButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: "#7CB7E6",
    borderRadius: 999,
    borderWidth: 1,
    marginTop: 2,
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
  managementSlotViewText: {
    color: "#155B86",
    fontSize: 9,
    fontWeight: "900",
  },
  reservationActionButtonDisabled: {
    opacity: 0.35,
  },
  playerPickerSubtitle: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
    textAlign: "center",
  },
  playerSearchBox: {
    alignItems: "center",
    backgroundColor: "#F7FBF9",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 42,
    paddingHorizontal: spacing.sm,
  },
  playerSearchInput: {
    color: colors.text,
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
  },
  playerPickerList: {
    maxHeight: 220,
  },
  playerPickerOption: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  playerPickerAvatar: {
    alignItems: "center",
    backgroundColor: "#EAF8F3",
    borderRadius: 999,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  playerPickerCopy: {
    flex: 1,
  },
  playerPickerName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  playerPickerMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  guestReservationBox: {
    backgroundColor: "#FBFDFC",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  guestReservationInputs: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  guestReservationInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.text,
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    minHeight: 40,
    paddingHorizontal: spacing.sm,
  },
  calendarCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    gap: spacing.sm,
    maxHeight: "82%",
    padding: spacing.lg,
    width: "100%",
  },
  priceApplyCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    gap: spacing.sm,
    padding: spacing.lg,
    width: "100%",
  },
  locationOptionsCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    gap: spacing.sm,
    padding: spacing.lg,
    width: "100%",
  },
  locationOptionsSubtitle: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
    textAlign: "center",
  },
  locationOptionsLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "uppercase",
  },
  radiusOptionsRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  radiusOption: {
    alignItems: "center",
    backgroundColor: "#F2F6F4",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    minHeight: 34,
    justifyContent: "center",
  },
  radiusOptionActive: {
    backgroundColor: "#E1F7EC",
    borderColor: colors.primary,
  },
  radiusOptionText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
  },
  radiusOptionTextActive: {
    color: colors.primaryDark,
  },
  priceApplySubtitle: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
  priceApplyList: {
    gap: spacing.xs,
  },
  priceApplyOption: {
    alignItems: "center",
    backgroundColor: "#F7FBF9",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 50,
    paddingHorizontal: spacing.sm,
  },
  priceApplyOptionActive: {
    backgroundColor: "#E5F7EE",
    borderColor: "#91D7B2",
  },
  priceApplyCheck: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: "#C8D6CE",
    borderRadius: 999,
    borderWidth: 1,
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  priceApplyCheckActive: {
    backgroundColor: "#B7F23A",
    borderColor: "#6FAF16",
  },
  priceApplyOptionCopy: {
    flex: 1,
  },
  priceApplyOptionTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  priceApplyOptionMeta: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
  calendarSubtitle: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
    textAlign: "center",
  },
  calendarRows: {
    gap: spacing.xs,
  },
  calendarColumnActionsRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  calendarColumnActions: {
    flex: 1,
    flexDirection: "row",
    gap: 4,
  },
  calendarColumnAction: {
    alignItems: "center",
    backgroundColor: "#EEF6FF",
    borderColor: "#BBD7F2",
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    height: 36,
    justifyContent: "center",
  },
  calendarColumnActionDisabled: {
    opacity: 0.45,
  },
  calendarColumnActionText: {
    color: "#1E5F86",
    fontSize: 8,
    fontWeight: "900",
    lineHeight: 10,
  },
  calendarColumnActionTextActive: {
    color: "#1E6B45",
  },
  calendarRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  calendarRowDays: {
    flex: 1,
    flexDirection: "row",
    gap: 4,
  },
  calendarDay: {
    alignItems: "center",
    backgroundColor: "#F7FBF9",
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    height: 56,
    justifyContent: "center",
  },
  calendarDayActive: {
    backgroundColor: "#E5F7EE",
    borderColor: "#91D7B2",
  },
  calendarDayToday: {
    borderColor: "#1D8B45",
    borderWidth: 2,
  },
  calendarDayDisabled: {
    backgroundColor: "#EEF1EF",
    borderColor: "#D8E0DC",
    opacity: 0.6,
  },
  calendarDayTop: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: "900",
  },
  calendarDayNumber: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "900",
    lineHeight: 20,
  },
  calendarDayBottom: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: "900",
  },
  calendarDayTextActive: {
    color: "#1E6B45",
  },
  calendarDayTextDisabled: {
    color: "#8B9690",
  },
  calendarRowAction: {
    alignItems: "center",
    backgroundColor: "#EEF6FF",
    borderColor: "#BBD7F2",
    borderRadius: 999,
    borderWidth: 1,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  calendarRowActionActive: {
    backgroundColor: "#E5F7EE",
    borderColor: "#91D7B2",
  },
  calendarRowActionSpacer: {
    height: 28,
    width: 28,
  },
  summaryTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  summaryHero: {
    alignItems: "center",
    backgroundColor: "#EAF8F3",
    borderColor: "#BFE5CF",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
  },
  summaryHeroIcon: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: "#A6D9BA",
    borderRadius: 16,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  summaryHeroCopy: {
    flex: 1,
  },
  summaryEyebrow: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "900",
    marginBottom: 2,
    textTransform: "uppercase",
  },
  summaryDetailsCard: {
    backgroundColor: "#FBFDFC",
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  summaryInfoRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  summaryInfoIcon: {
    alignItems: "center",
    backgroundColor: "#F2FAF6",
    borderColor: "#D8EBE1",
    borderRadius: 12,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  summaryInfoCopy: {
    flex: 1,
  },
  summaryInfoLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "900",
    marginBottom: 2,
    textTransform: "uppercase",
  },
  summaryLine: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  summaryMuted: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  summaryDivider: {
    backgroundColor: colors.border,
    height: 1,
  },
  summaryPrice: {
    color: colors.primaryDark,
    fontSize: 24,
    fontWeight: "900",
    textAlign: "center",
  },
  summaryPriceBlock: {
    alignItems: "center",
    backgroundColor: "#F6FFE5",
    borderColor: "#CBEA7A",
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: spacing.sm,
  },
  summaryPriceLabel: {
    color: "#617400",
    fontSize: 11,
    fontWeight: "900",
    marginBottom: 2,
    textTransform: "uppercase",
  },
  summarySectionTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "uppercase",
  },
  mercadoPagoSummaryHint: {
    alignItems: "center",
    backgroundColor: "#F7FAFD",
    borderColor: "#D8E4EC",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  mercadoPagoSummaryHintText: {
    color: colors.muted,
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
    marginLeft: 8,
  },
  mercadoPagoActionButton: {
    alignItems: "center",
    backgroundColor: "#F3FBF7",
    borderColor: "#BFE5CD",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  mercadoPagoActionButtonText: {
    color: "#1A7F5A",
    fontSize: 13,
    fontWeight: "800",
  },
  mercadoPagoCheckoutHint: {
    alignItems: "center",
    backgroundColor: "#F3FBF7",
    borderColor: "#BFE5CD",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  mercadoPagoCheckoutHintText: {
    color: "#1A7F5A",
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
    marginLeft: 8,
  },
  paymentRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  paymentChip: {
    alignItems: "center",
    backgroundColor: "#F7FBF9",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 9,
  },
  paymentChipActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  paymentChipText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  paymentChipTextActive: {
    color: colors.surface,
  },
  receiptButton: {
    alignItems: "center",
    backgroundColor: "#F7FBF9",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  receiptButtonText: {
    color: colors.primaryDark,
    flex: 1,
    fontSize: 13,
    fontWeight: "800",
  },
  pressedState: {
    opacity: 0.78,
  },
});
