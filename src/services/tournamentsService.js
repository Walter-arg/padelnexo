import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "../../services/firebaseFirestore";
import { getDownloadURL, ref, uploadBytes } from "../../services/firebaseStorage";

import { db, storage } from "../../services/firebaseConfig";
import {
  buildLeagueCategoryLabel,
  getLeagueCategoryOption,
  LEAGUE_BRANCH_OPTIONS,
  LEAGUE_CATEGORY_FORMAT_OPTIONS,
  LEAGUE_CATEGORY_OPTIONS,
  LEAGUE_SUM_RULE_OPTIONS,
  LEAGUE_SUM_TARGET_OPTIONS,
} from "./leaguesService";
import { buildTournamentDayOptions, normalizeTournamentAvailability } from "./tournamentAvailabilityService";

export const TOURNAMENT_STATUS_OPTIONS = [
  { label: "Borrador", value: "draft" },
  { label: "Publicado", value: "published" },
  { label: "Inscripcion abierta", value: "registration_open" },
  { label: "Inscripcion cerrada", value: "registration_closed" },
  { label: "Armando torneo", value: "building" },
  { label: "En juego", value: "in_progress" },
  { label: "Finalizado", value: "finished" },
  { label: "Cancelado", value: "cancelled" },
];

export const TOURNAMENT_REGISTRATION_STATUS_OPTIONS = [
  { label: "Pendiente", value: "pending" },
  { label: "En revision", value: "in_review" },
  { label: "Confirmada", value: "confirmed" },
  { label: "Rechazada", value: "rejected" },
];

export const TOURNAMENT_WITHDRAWAL_STATUS_OPTIONS = [
  { label: "Sin baja", value: "none" },
  { label: "Baja solicitada", value: "requested" },
  { label: "Baja confirmada", value: "confirmed" },
];

export const TOURNAMENT_PAYMENT_STATUS_OPTIONS = [
  { label: "Pendiente", value: "pending" },
  { label: "En revision", value: "in_review" },
  { label: "Aprobado", value: "approved" },
  { label: "Rechazado", value: "rejected" },
];

export const TOURNAMENT_PAIR_CONFIRMATION_OPTIONS = [
  { label: "Deben pagar ambos", value: "both_paid" },
  { label: "Alcanza con un pago", value: "one_paid" },
  { label: "Confirmacion manual", value: "manual" },
];

export const TOURNAMENT_BUILD_MODE_OPTIONS = [
  { label: "Automatico", value: "automatic" },
  { label: "Semiautomatico", value: "semiautomatic" },
  { label: "Manual", value: "manual" },
];

export const TOURNAMENT_REGISTRATION_MODE_OPTIONS = [
  { label: "En pareja", value: "pair_only" },
];

export const TOURNAMENT_GROUP_SIZE_OPTIONS = [
  { label: "2 parejas", value: 2 },
  { label: "3 parejas", value: 3 },
  { label: "4 parejas", value: 4 },
];

const DEFAULT_MATCH_FORMAT = "best_of_3";
const DEFAULT_THIRD_SET_MODE = "super_tiebreak";
const DEFAULT_RECOMMENDED_GROUP_SIZE = 3;
const DEFAULT_PAYMENT_METHODS = ["transferencia"];

const DAY_KEYS = new Set([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

function resolveTimestampMillis(value) {
  if (!value) {
    return 0;
  }

  if (typeof value?.toMillis === "function") {
    return value.toMillis();
  }

  if (typeof value === "number") {
    return value;
  }

  return 0;
}

function normalizeString(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return fallback;
}

function normalizeCount(value, fallback = 0) {
  const parsedValue = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isNaN(parsedValue) ? fallback : parsedValue;
}

function normalizeMoneyValue(value, fallback = 0) {
  const parsedValue = Number.parseFloat(String(value ?? "").trim().replace(",", "."));

  if (Number.isNaN(parsedValue) || parsedValue < 0) {
    return fallback;
  }

  return Math.round(parsedValue * 100) / 100;
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function buildClientTimestampMillis() {
  return Date.now();
}

function buildGeneratedId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatSex(value = "") {
  const normalized = String(value).trim().toLowerCase();

  if (normalized === "femenino" || normalized === "dama" || normalized === "damas") {
    return "Femenino";
  }

  if (normalized === "mixto" || normalized === "mixta") {
    return "Mixto";
  }

  return "Masculino";
}

function normalizeCategoryValue(value) {
  const normalized = String(value || "").trim().toLowerCase();

  if (
    normalized === "iniciante" ||
    normalized === "iniciantes" ||
    normalized === "principiante" ||
    normalized === "principiantes"
  ) {
    return "9na";
  }

  const option = LEAGUE_CATEGORY_OPTIONS.find((item) => item.value === value);
  return option ? option.value : "";
}

function normalizeSumTarget(value) {
  const option = LEAGUE_SUM_TARGET_OPTIONS.find((item) => item.value === String(value));
  return option ? option.value : "";
}

function normalizeTournamentStatus(value, fallback = "draft") {
  const normalized = String(value || "").trim().toLowerCase();
  return TOURNAMENT_STATUS_OPTIONS.some((item) => item.value === normalized) ? normalized : fallback;
}

function normalizeRegistrationStatus(value, fallback = "closed") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "open" ? "open" : fallback;
}

function normalizePairConfirmationMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return TOURNAMENT_PAIR_CONFIRMATION_OPTIONS.some((item) => item.value === normalized)
    ? normalized
    : "both_paid";
}

function normalizeBuildMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return TOURNAMENT_BUILD_MODE_OPTIONS.some((item) => item.value === normalized)
    ? normalized
    : "automatic";
}

function normalizeTournamentRuleSet(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "apa" ? "apa" : "fap";
}

function normalizeMatchFormat(value) {
  const normalized = String(value || "").trim().toLowerCase();

  if (normalized === "single_set") {
    return "single_set";
  }

  if (normalized === "best_of_1") {
    return "best_of_1";
  }

  if (normalized === "best_of_3") {
    return "best_of_3";
  }

  return DEFAULT_MATCH_FORMAT;
}

function normalizeThirdSetMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "full_set" ? "full_set" : DEFAULT_THIRD_SET_MODE;
}

function normalizeBranch(value) {
  const normalized = formatSex(value);
  return LEAGUE_BRANCH_OPTIONS.some((item) => item.value === normalized) ? normalized : "Masculino";
}

function normalizeCategoryFormat(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return LEAGUE_CATEGORY_FORMAT_OPTIONS.some((item) => item.value === normalized)
    ? normalized
    : "libre";
}

function normalizeSumRule(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return LEAGUE_SUM_RULE_OPTIONS.some((item) => item.value === normalized) ? normalized : "open";
}

function normalizePaymentMethods(values = []) {
  const normalized = uniqueStrings(Array.isArray(values) && values.length ? values : DEFAULT_PAYMENT_METHODS)
    .map((value) => value.toLowerCase());

  return normalized.length ? normalized : [...DEFAULT_PAYMENT_METHODS];
}

function normalizeDayKeys(values = []) {
  return uniqueStrings(values).filter((value) => DAY_KEYS.has(value));
}

function normalizeVenueEntry(venue = {}, index = 0) {
  return {
    id: normalizeString(venue.id, `venue-${index + 1}`),
    name: normalizeString(venue.name || venue.nombre, `Sede ${index + 1}`),
    address: normalizeString(venue.address || venue.direccion),
    complexId: normalizeString(venue.complexId || venue.idComplejo),
    city: normalizeString(venue.city || venue.ciudad),
    province: normalizeString(venue.province || venue.provincia),
    coordinates: venue.coordinates || venue.location || null,
    isTemporary: normalizeBoolean(venue.isTemporary, false),
  };
}

function normalizeTemporaryVenueEntry(venue = {}, index = 0) {
  return {
    id: normalizeString(venue.id, `temporary-venue-${index + 1}`),
    name: normalizeString(venue.name || venue.nombre, `Sede temporal ${index + 1}`),
    address: normalizeString(venue.address || venue.direccion),
    city: normalizeString(venue.city || venue.ciudad),
    province: normalizeString(venue.province || venue.provincia),
    coordinates: venue.coordinates || venue.location || null,
    isTemporary: true,
  };
}

function normalizeTournamentDefaults(payload = {}) {
  const branch = normalizeBranch(payload.branch || payload.compositionConfig?.branch);
  const categoryFormat = normalizeCategoryFormat(
    payload.categoryFormat || payload.compositionConfig?.categoryFormat
  );
  const sumTarget = normalizeSumTarget(payload.sumTarget || payload.compositionConfig?.sumTarget);
  const sumRule = normalizeSumRule(payload.sumRule || payload.compositionConfig?.sumRule);
  const fixedCategoryA = normalizeCategoryValue(
    payload.fixedCategoryA || payload.compositionConfig?.fixedCategoryA
  );
  const fixedCategoryB = normalizeCategoryValue(
    payload.fixedCategoryB || payload.compositionConfig?.fixedCategoryB
  );

  return {
    branch,
    categoryFormat,
    sumTarget,
    sumRule,
    fixedCategoryA,
    fixedCategoryB,
    label: buildLeagueCategoryLabel(
      branch,
      categoryFormat,
      sumTarget,
      sumRule,
      fixedCategoryA,
      fixedCategoryB
    ),
  };
}

function buildTournamentCompositionValue(payload = {}) {
  const composition = normalizeTournamentDefaults(payload);

  return {
    compositionType: composition.categoryFormat === "suma" ? "sum" : "single_category",
    compositionConfig: {
      branch: composition.branch,
      categoryFormat: composition.categoryFormat,
      sumTarget: composition.sumTarget,
      sumRule: composition.sumRule,
      fixedCategoryA: composition.fixedCategoryA,
      fixedCategoryB: composition.fixedCategoryB,
      label: composition.label,
    },
    compositionLabel: composition.label,
  };
}

function normalizeTournamentAvailabilityDay(dayKey, dayValue = {}) {
  const normalizedDay = {
    quickSlots: uniqueStrings(dayValue.quickSlots || []),
    customSlots: (Array.isArray(dayValue.customSlots) ? dayValue.customSlots : [])
      .map((slot) => ({
        from: normalizeString(slot?.from),
        to: normalizeString(slot?.to),
      }))
      .filter((slot) => slot.from && slot.to && slot.from !== slot.to),
  };

  if (!normalizedDay.quickSlots.length && !normalizedDay.customSlots.length) {
    return null;
  }

  return normalizedDay;
}

export function normalizeTournamentPairAvailability(rawAvailability = {}, tournament = {}) {
  const tournamentDayOptions = buildTournamentDayOptions(tournament);
  const hasTournamentDates = tournamentDayOptions.length > 0;
  const availability = hasTournamentDates
    ? normalizeTournamentAvailability(rawAvailability, tournamentDayOptions)
    : rawAvailability;
  const activeDayEntries = Object.entries(availability || {})
    .filter(([dayKey]) => (hasTournamentDates ? true : DAY_KEYS.has(dayKey)))
    .map(([dayKey, dayValue]) => [dayKey, normalizeTournamentAvailabilityDay(dayKey, dayValue)])
    .filter(([, dayValue]) => Boolean(dayValue));

  return activeDayEntries.reduce((accumulator, [dayKey, dayValue]) => {
    accumulator[dayKey] = dayValue;
    return accumulator;
  }, {});
}

function getAvailabilityWindowCount(availability = {}) {
  return Object.values(availability).reduce((total, dayValue) => {
    const quickSlots = Array.isArray(dayValue?.quickSlots) ? dayValue.quickSlots.length : 0;
    const customSlots = Array.isArray(dayValue?.customSlots) ? dayValue.customSlots.length : 0;
    return total + quickSlots + customSlots;
  }, 0);
}

function buildTournamentPayload(organizer, payload = {}, batchId = "") {
  const composition = buildTournamentCompositionValue(payload);
  const venues = (Array.isArray(payload.venues) ? payload.venues : []).map(normalizeVenueEntry);
  const temporaryVenues = (Array.isArray(payload.temporaryVenues) ? payload.temporaryVenues : []).map(
    normalizeTemporaryVenueEntry
  );
  const allVenues = [...venues, ...temporaryVenues];
  const venueMode =
    payload.venueMode === "multiple" || allVenues.length > 1 ? "multiple" : "single";
  const playDays = normalizeDayKeys(payload.playDays || []);
  const groupStageDays = normalizeDayKeys(payload.groupStageDays || playDays);
  const knockoutDays = normalizeDayKeys(payload.knockoutDays || playDays);
  const startDateMillis = Math.max(normalizeCount(payload.startDateMillis, 0), 0);
  const endDateMillis = Math.max(normalizeCount(payload.endDateMillis, startDateMillis), 0);
  const maxPairs = Math.max(normalizeCount(payload.maxPairs, 8), 2);
  const minPairs = Math.max(Math.min(normalizeCount(payload.minPairs, 4), maxPairs), 2);
  const entryFee = normalizeMoneyValue(payload.entryFee, 0);

  return {
    name: normalizeString(payload.name, "Torneo sin nombre"),
    organizerId: organizer?.uid || payload.organizerId || "",
    organizerName: organizer?.name || payload.organizerName || "Organizador",
    organizerLogoUrl: normalizeString(organizer?.organizerLogoUrl || payload.organizerLogoUrl),
    status: normalizeTournamentStatus(payload.status, "draft"),
    description: normalizeString(payload.description),
    coverImage: normalizeString(payload.coverImage),
    tournamentRuleSet: normalizeTournamentRuleSet(payload.tournamentRuleSet || payload.ruleSet),
    venueMode,
    venues,
    temporaryVenues,
    ...composition,
    tournamentFormat: normalizeString(payload.tournamentFormat, "groups_knockout"),
    matchFormat: normalizeMatchFormat(payload.matchFormat),
    thirdSetMode: normalizeThirdSetMode(payload.thirdSetMode),
    maxPairs,
    minPairs,
    registrationStatus: normalizeRegistrationStatus(payload.registrationStatus, "closed"),
    registrationMode: "pair_only",
    pairConfirmationMode: normalizePairConfirmationMode(payload.pairConfirmationMode),
    entryFee,
    paymentMethods: normalizePaymentMethods(payload.paymentMethods),
    paymentAlias: normalizeString(payload.paymentAlias),
    playDays,
    groupStageDays,
    knockoutDays,
    startDateMillis,
    endDateMillis,
    buildMode: normalizeBuildMode(payload.buildMode),
    recommendedGroupSize: [2, 3, 4].includes(Number(payload.recommendedGroupSize))
      ? Number(payload.recommendedGroupSize)
      : DEFAULT_RECOMMENDED_GROUP_SIZE,
    allowManualCorrection: normalizeBoolean(payload.allowManualCorrection, true),
    championPairId: normalizeString(payload.championPairId),
    runnerUpPairId: normalizeString(payload.runnerUpPairId),
    creationBatchId: normalizeString(payload.creationBatchId || batchId),
    createdBy: organizer?.uid || payload.organizerId || "",
    createdByName: organizer?.name || payload.organizerName || "Organizador",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function mapVenueDisplayName(tournament = {}) {
  const namedVenues = [...(tournament.venues || []), ...(tournament.temporaryVenues || [])]
    .map((venue) => venue?.name)
    .filter(Boolean);

  if (!namedVenues.length) {
    return "Sede a confirmar";
  }

  if (namedVenues.length === 1) {
    return namedVenues[0];
  }

  return `${namedVenues[0]} +${namedVenues.length - 1}`;
}

function mapTournamentDoc(docSnapshot) {
  const data = docSnapshot.data() || {};

  return {
    id: docSnapshot.id,
    ...data,
    venueLabel: mapVenueDisplayName(data),
    createdAtMillis: resolveTimestampMillis(data.createdAt),
    updatedAtMillis: resolveTimestampMillis(data.updatedAt),
  };
}

function normalizePlayerRegistrationSide(player = {}, index = 0) {
  const userId = normalizeString(player.userId || player.linkedUserId || player.id);
  const fallbackName = userId ? `Jugador ${index + 1}` : "";

  return {
    playerId: normalizeString(player.playerId || player.id, `player-${index + 1}`),
    userId,
    name: normalizeString(player.name || player.nombre, fallbackName),
    category: normalizeCategoryValue(player.category || player.categoria),
    sex: normalizeBranch(player.sex || player.sexo),
  };
}

function buildPaymentEntry(player = {}, entryFee = 0) {
  return {
    playerId: player.playerId,
    userId: player.userId,
    playerName: player.name,
    amount: entryFee,
    status: entryFee > 0 ? "pending" : "approved",
    method: "",
    receiptUrl: "",
    receiptPath: "",
    receiptFileName: "",
    uploadedAt: null,
    reviewedAt: null,
    reviewedBy: "",
    reviewedByName: "",
  };
}

function normalizePaymentMethod(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return ["efectivo", "transferencia"].includes(normalized) ? normalized : "";
}

function applyPaymentDraft(basePayment = {}, draft = {}) {
  const nextMethod = normalizePaymentMethod(draft?.method || basePayment.method);

  return {
    ...basePayment,
    method: nextMethod,
  };
}

function buildRegistrationPairLabel(registration = {}) {
  return [registration.player1Name, registration.player2Name].filter(Boolean).join(" / ");
}

function resolveRegistrationSidePlayerId(data = {}, payments = [], side = "player1") {
  const directId = normalizeString(data?.[`${side}Id`]);

  if (directId) {
    return directId;
  }

  const sideName = normalizeString(data?.[`${side}Name`]);

  if (!sideName) {
    return "";
  }

  const paymentMatch = payments.find(
    (payment) =>
      normalizeString(payment?.playerName) === sideName && normalizeString(payment?.playerId)
  );

  return normalizeString(paymentMatch?.playerId);
}

function normalizeWithdrawalStatus(value = "") {
  const normalized = String(value || "").trim().toLowerCase();

  if (normalized === "requested" || normalized === "confirmed") {
    return normalized;
  }

  return "none";
}

function isRegistrationWithdrawnConfirmed(registration = {}) {
  return normalizeWithdrawalStatus(registration?.withdrawalStatus) === "confirmed";
}

function normalizeRegistrationDoc(docSnapshot) {
  const data = docSnapshot.data() || {};
  const payments = Array.isArray(data.payments) ? data.payments : [];
  const player1Id = resolveRegistrationSidePlayerId(data, payments, "player1");
  const player2Id = resolveRegistrationSidePlayerId(data, payments, "player2");

  return {
    id: docSnapshot.id,
    ...data,
    player1Id,
    player2Id,
    createdAtMillis: resolveTimestampMillis(data.createdAt),
    updatedAtMillis: resolveTimestampMillis(data.updatedAt),
    withdrawalRequestedAtMillis: resolveTimestampMillis(data.withdrawalRequestedAt),
    withdrawalConfirmedAtMillis: resolveTimestampMillis(data.withdrawalConfirmedAt),
    withdrawalStatus: normalizeWithdrawalStatus(data.withdrawalStatus),
    payments,
    pairLabel:
      data.pairLabel ||
      [data.player1Name || "Jugador 1", data.player2Name || "Jugador 2"].join(" / "),
  };
}

function normalizeGroupDoc(docSnapshot) {
  const data = docSnapshot.data() || {};

  return {
    id: docSnapshot.id,
    ...data,
    createdAtMillis: resolveTimestampMillis(data.createdAt),
    updatedAtMillis: resolveTimestampMillis(data.updatedAt),
  };
}

function normalizeMatchDoc(docSnapshot) {
  const data = docSnapshot.data() || {};

  return {
    id: docSnapshot.id,
    ...data,
    createdAtMillis: resolveTimestampMillis(data.createdAt),
    updatedAtMillis: resolveTimestampMillis(data.updatedAt),
    completedAtMillis: resolveTimestampMillis(data.completedAt),
  };
}

async function listRegistrationDocs(tournamentId) {
  const snapshot = await getDocs(collection(db, "tournaments", tournamentId, "registrations"));
  return snapshot.docs.map(normalizeRegistrationDoc);
}

async function listGroupDocs(tournamentId) {
  const snapshot = await getDocs(collection(db, "tournaments", tournamentId, "groups"));
  return snapshot.docs.map(normalizeGroupDoc);
}

async function listMatchDocs(tournamentId) {
  const snapshot = await getDocs(collection(db, "tournaments", tournamentId, "matches"));
  return snapshot.docs.map(normalizeMatchDoc);
}

function getRegistrationStatusFromPayments(tournament = {}, payments = [], forceManual = false) {
  const approvedCount = payments.filter((payment) => payment.status === "approved").length;
  const inReviewCount = payments.filter((payment) => payment.status === "in_review").length;
  const rejectedCount = payments.filter((payment) => payment.status === "rejected").length;
  const requiresPayment = Number(tournament.entryFee || 0) > 0;

  if (forceManual) {
    return "confirmed";
  }

  if (!requiresPayment) {
    return tournament.pairConfirmationMode === "manual" ? "pending" : "confirmed";
  }

  if (tournament.pairConfirmationMode === "manual") {
    if (rejectedCount > 0) {
      return "rejected";
    }

    return inReviewCount > 0 ? "in_review" : "pending";
  }

  if (tournament.pairConfirmationMode === "one_paid" && approvedCount >= 1) {
    return "confirmed";
  }

  if (tournament.pairConfirmationMode === "both_paid" && approvedCount >= payments.length) {
    return "confirmed";
  }

  if (rejectedCount > 0) {
    return "rejected";
  }

  return inReviewCount > 0 ? "in_review" : "pending";
}

function getRegistrationStatusMeta(tournament = {}, payments = [], currentRegistration = {}) {
  const status = getRegistrationStatusFromPayments(tournament, payments, false);

  return {
    status,
    confirmedAt: status === "confirmed" ? serverTimestamp() : currentRegistration.confirmedAt || null,
    rejectedAt: status === "rejected" ? serverTimestamp() : null,
  };
}

function getPlayerCategoryNumericValue(value = "") {
  return getLeagueCategoryOption(value)?.numericValue || 0;
}

export function validateTournamentRegistrationPair(tournament = {}, registration = {}) {
  const allowGuestPlayers = Boolean(registration?.allowGuestPlayers);
  const player1 = normalizePlayerRegistrationSide(registration.player1, 0);
  const player2 = normalizePlayerRegistrationSide(registration.player2, 1);

  if (!player1.userId && !allowGuestPlayers) {
    return { valid: false, message: "Necesitamos al menos un jugador registrado para la solicitud." };
  }

  if (allowGuestPlayers && !player1.name) {
    return { valid: false, message: "Completa al menos el nombre del jugador principal." };
  }

  if (!player2.userId) {
    const composition = tournament.compositionConfig || {};
    const branch = normalizeBranch(composition.branch);

    if (branch === "Femenino" && player1.sex !== "Femenino") {
      return { valid: false, message: "Este torneo es de damas." };
    }

    return { valid: true, message: "" };
  }

  if (player1.userId === player2.userId) {
    return { valid: false, message: "No podes inscribirte dos veces dentro de la misma pareja." };
  }

  const composition = tournament.compositionConfig || {};
  const branch = normalizeBranch(composition.branch);

  if (branch === "Mixto") {
    const sexes = [player1.sex, player2.sex].sort();

    if (!(sexes[0] === "Femenino" && sexes[1] === "Masculino")) {
      return {
        valid: false,
        message: "En un torneo mixto la pareja debe tener un jugador y una jugadora.",
      };
    }
  }

  if (branch === "Femenino" && [player1.sex, player2.sex].some((value) => value !== "Femenino")) {
    return { valid: false, message: "Este torneo es de damas." };
  }

  if (composition.categoryFormat !== "suma") {
    return { valid: true, message: "" };
  }

  return { valid: true, message: "" };
}

function ensureTournamentCanOpenRegistration(tournament = {}) {
  const allowedStatuses = new Set(["published", "registration_closed"]);

  if (!allowedStatuses.has(tournament.status)) {
    throw new Error("Primero tenes que publicar el torneo para abrir la inscripcion.");
  }
}

function ensureTournamentCanBuild(tournament = {}) {
  if (tournament.status === "cancelled") {
    throw new Error("No podes armar un torneo cancelado.");
  }

  if (tournament.status === "finished") {
    throw new Error("El torneo ya esta finalizado.");
  }
}

function normalizeRegistrationAvailability(availability = {}, tournament = {}) {
  const normalized = normalizeTournamentPairAvailability(availability, tournament);
  return Object.keys(normalized).length ? normalized : {};
}

function getAvailabilityCompatibilityScore(firstAvailability = {}, secondAvailability = {}) {
  const firstEntries = Object.entries(firstAvailability);
  const secondEntries = Object.entries(secondAvailability);

  if (!firstEntries.length || !secondEntries.length) {
    return 0;
  }

  let score = 0;

  firstEntries.forEach(([dayKey, firstDay]) => {
    const secondDay = secondAvailability[dayKey];

    if (!secondDay) {
      return;
    }

    const firstQuickSlots = new Set(firstDay.quickSlots || []);
    const secondQuickSlots = new Set(secondDay.quickSlots || []);
    firstQuickSlots.forEach((slotKey) => {
      if (secondQuickSlots.has(slotKey)) {
        score += 3;
      }
    });

    const firstCustomSlots = Array.isArray(firstDay.customSlots) ? firstDay.customSlots : [];
    const secondCustomSlots = Array.isArray(secondDay.customSlots) ? secondDay.customSlots : [];

    firstCustomSlots.forEach((firstSlot) => {
      secondCustomSlots.forEach((secondSlot) => {
        if (firstSlot.from === secondSlot.from && firstSlot.to === secondSlot.to) {
          score += 2;
        }
      });
    });
  });

  return score;
}

function sortRegistrationsForAutoBuild(registrations = []) {
  return [...registrations].sort((first, second) => {
    const secondWindows = getAvailabilityWindowCount(second.availability);
    const firstWindows = getAvailabilityWindowCount(first.availability);

    if (secondWindows !== firstWindows) {
      return secondWindows - firstWindows;
    }

    return first.pairLabel.localeCompare(second.pairLabel, "es");
  });
}

function resolveAutomaticGroupSizes(totalPairs, preferredSize) {
  if (totalPairs < 2) {
    throw new Error("Necesitas al menos dos parejas confirmadas para armar el torneo.");
  }

  const safePreferredSize = [2, 3, 4].includes(preferredSize)
    ? preferredSize
    : DEFAULT_RECOMMENDED_GROUP_SIZE;
  const sizes = [];
  let remaining = totalPairs;

  while (remaining > 0) {
    if (remaining <= 4) {
      if (remaining === 1) {
        const lastIndex = sizes.length - 1;

        if (lastIndex < 0) {
          throw new Error("No pudimos repartir las parejas en grupos validos.");
        }

        sizes[lastIndex] += 1;
        remaining = 0;
        break;
      }

      sizes.push(remaining);
      break;
    }

    if (safePreferredSize === 4 && remaining % 4 === 1) {
      sizes.push(3);
      remaining -= 3;
      continue;
    }

    if (safePreferredSize === 3 && remaining % 3 === 1) {
      sizes.push(4);
      remaining -= 4;
      continue;
    }

    if (safePreferredSize === 2 && remaining % 2 === 1 && remaining >= 3) {
      sizes.push(3);
      remaining -= 3;
      continue;
    }

    sizes.push(Math.min(safePreferredSize, remaining));
    remaining -= Math.min(safePreferredSize, remaining);
  }

  return sizes;
}

function buildAutoGroups(registrations = [], preferredSize = DEFAULT_RECOMMENDED_GROUP_SIZE) {
  const sortedRegistrations = sortRegistrationsForAutoBuild(registrations);
  const sizes = resolveAutomaticGroupSizes(sortedRegistrations.length, preferredSize);
  const groups = [];

  sizes.forEach((size, groupIndex) => {
    if (groupIndex === 0) {
      groups.push(sortedRegistrations.splice(0, size));
      return;
    }

    const currentGroup = [];

    while (currentGroup.length < size && sortedRegistrations.length > 0) {
      if (!currentGroup.length) {
        currentGroup.push(sortedRegistrations.shift());
        continue;
      }

      let bestIndex = 0;
      let bestScore = -1;

      sortedRegistrations.forEach((candidate, candidateIndex) => {
        const score = currentGroup.reduce((total, entry) => {
          return total + getAvailabilityCompatibilityScore(entry.availability, candidate.availability);
        }, 0);

        if (score > bestScore) {
          bestScore = score;
          bestIndex = candidateIndex;
        }
      });

      currentGroup.push(sortedRegistrations.splice(bestIndex, 1)[0]);
    }

    groups.push(currentGroup);
  });

  return groups;
}

function getAlphabetLabel(index) {
  return String.fromCharCode(65 + index);
}

function buildGroupStandingEntry(registration = {}, position = 0, qualifiedCount = 2) {
  return {
    pairId: registration.id,
    pairLabel: registration.pairLabel,
    played: 0,
    won: 0,
    lost: 0,
    setsWon: 0,
    setsLost: 0,
    gamesWon: 0,
    gamesLost: 0,
    points: 0,
    position: position + 1,
    qualified: position < qualifiedCount,
  };
}

function buildGroupDocument({ groupIndex, registrations, createdByMode }) {
  const size = registrations.length;
  const qualifiedCount = size === 4 ? 3 : Math.min(2, size);
  const groupId = buildGeneratedId(`group-${groupIndex + 1}`);

  return {
    id: groupId,
    name: getAlphabetLabel(groupIndex),
    size,
    stage: "groups",
    createdByMode,
    pairIds: registrations.map((registration) => registration.id),
    qualifiedCount,
    matchesPlayed: 0,
    standings: registrations.map((registration, index) =>
      buildGroupStandingEntry(registration, index, qualifiedCount)
    ),
    format: size === 4 ? "progressive_four" : "round_robin",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function buildMatchBase({
  tournamentId,
  groupId = "",
  stage,
  roundOrder,
  matchOrder,
  sideAType,
  sideARef,
  sideALabel,
  sideBType,
  sideBRef,
  sideBLabel,
  nextMatchId = "",
  nextMatchSlot = "",
}) {
  const isReady = sideAType === "pair" && sideBType === "pair";

  return {
    id: buildGeneratedId(`match-${stage}-${roundOrder}-${matchOrder}`),
    tournamentId,
    stage,
    groupId,
    roundOrder,
    matchOrder,
    sideAType,
    sideARef,
    sideALabel,
    sideBType,
    sideBRef,
    sideBLabel,
    status: isReady ? "scheduled" : "pending",
    winnerPairId: "",
    scoreText: "",
    sets: [],
    scheduledDay: "",
    scheduledDate: "",
    scheduledTime: "",
    venueId: "",
    courtName: "",
    nextMatchId,
    nextMatchSlot,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

function buildGroupMatchesForRoundRobin(tournamentId, group = {}, registrationsById = new Map()) {
  const pairIds = group.pairIds || [];
  const combinations = [];

  for (let index = 0; index < pairIds.length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < pairIds.length; compareIndex += 1) {
      combinations.push([pairIds[index], pairIds[compareIndex]]);
    }
  }

  return combinations.map(([pairAId, pairBId], index) => {
    const pairA = registrationsById.get(pairAId);
    const pairB = registrationsById.get(pairBId);

    return buildMatchBase({
      tournamentId,
      groupId: group.id,
      stage: "groups",
      roundOrder: 1,
      matchOrder: index + 1,
      sideAType: "pair",
      sideARef: pairA?.id || "",
      sideALabel: pairA?.pairLabel || "Pareja A",
      sideBType: "pair",
      sideBRef: pairB?.id || "",
      sideBLabel: pairB?.pairLabel || "Pareja B",
    });
  });
}

function buildGroupMatchesForProgressiveFour(tournamentId, group = {}, registrationsById = new Map()) {
  const pairIds = group.pairIds || [];
  const registrations = pairIds.map((pairId) => registrationsById.get(pairId)).filter(Boolean);

  if (registrations.length !== 4) {
    throw new Error("La zona especial de 4 parejas necesita exactamente cuatro parejas.");
  }

  const firstMatchId = buildGeneratedId(`match-groups-1-1`);
  const secondMatchId = buildGeneratedId(`match-groups-1-2`);
  const thirdMatchId = buildGeneratedId(`match-groups-2-1`);
  const fourthMatchId = buildGeneratedId(`match-groups-2-2`);

  return [
    {
      ...buildMatchBase({
        tournamentId,
        groupId: group.id,
        stage: "groups",
        roundOrder: 1,
        matchOrder: 1,
        sideAType: "pair",
        sideARef: registrations[0].id,
        sideALabel: registrations[0].pairLabel,
        sideBType: "pair",
        sideBRef: registrations[1].id,
        sideBLabel: registrations[1].pairLabel,
        nextMatchId: thirdMatchId,
        nextMatchSlot: "winnerA",
      }),
      id: firstMatchId,
    },
    {
      ...buildMatchBase({
        tournamentId,
        groupId: group.id,
        stage: "groups",
        roundOrder: 1,
        matchOrder: 2,
        sideAType: "pair",
        sideARef: registrations[2].id,
        sideALabel: registrations[2].pairLabel,
        sideBType: "pair",
        sideBRef: registrations[3].id,
        sideBLabel: registrations[3].pairLabel,
        nextMatchId: thirdMatchId,
        nextMatchSlot: "winnerB",
      }),
      id: secondMatchId,
    },
    {
      ...buildMatchBase({
        tournamentId,
        groupId: group.id,
        stage: "groups",
        roundOrder: 2,
        matchOrder: 1,
        sideAType: "placeholder",
        sideARef: { sourceMatchId: firstMatchId, outcome: "winner" },
        sideALabel: `Ganador ${group.name} 1`,
        sideBType: "placeholder",
        sideBRef: { sourceMatchId: secondMatchId, outcome: "winner" },
        sideBLabel: `Ganador ${group.name} 2`,
      }),
      id: thirdMatchId,
    },
    {
      ...buildMatchBase({
        tournamentId,
        groupId: group.id,
        stage: "groups",
        roundOrder: 2,
        matchOrder: 2,
        sideAType: "placeholder",
        sideARef: { sourceMatchId: firstMatchId, outcome: "loser" },
        sideALabel: `Perdedor ${group.name} 1`,
        sideBType: "placeholder",
        sideBRef: { sourceMatchId: secondMatchId, outcome: "loser" },
        sideBLabel: `Perdedor ${group.name} 2`,
      }),
      id: fourthMatchId,
    },
  ];
}

function buildQualifiedPlaceholderEntries(groups = []) {
  const entries = [];

  groups
    .slice()
    .sort((first, second) => first.name.localeCompare(second.name, "es"))
    .forEach((group) => {
      for (let position = 1; position <= Number(group.qualifiedCount || 0); position += 1) {
        entries.push({
          groupId: group.id,
          groupName: group.name,
          position,
          label: `${position}${group.name}`,
        });
      }
    });

  return entries;
}

function buildKnockoutSeedOrder(groups = [], placeholders = []) {
  if (groups.length === 2 && placeholders.length === 4) {
    const placeholderByLabel = new Map(placeholders.map((entry) => [entry.label, entry]));
    return ["1A", "2B", "1B", "2A"].map((label) => placeholderByLabel.get(label)).filter(Boolean);
  }

  if (groups.length === 4 && placeholders.length === 8) {
    const placeholderByLabel = new Map(placeholders.map((entry) => [entry.label, entry]));
    return ["1A", "2D", "1B", "2C", "1C", "2B", "1D", "2A"]
      .map((label) => placeholderByLabel.get(label))
      .filter(Boolean);
  }

  return placeholders;
}

function nextPowerOfTwo(value) {
  let power = 1;

  while (power < value) {
    power *= 2;
  }

  return power;
}

function buildKnockoutMatches(tournamentId, groups = []) {
  const placeholderEntries = buildQualifiedPlaceholderEntries(groups).map((entry) => ({
    type: "group_position",
    sourceGroupId: entry.groupId,
    sourcePosition: entry.position,
    label: entry.label,
  }));

  if (placeholderEntries.length < 2) {
    return [];
  }

  const seedOrder = buildKnockoutSeedOrder(groups, placeholderEntries);
  const bracketSize = nextPowerOfTwo(seedOrder.length);
  const seededEntries = [...seedOrder];

  while (seededEntries.length < bracketSize) {
    seededEntries.push(null);
  }

  const roundMatches = [];
  let roundEntries = seededEntries;
  let roundOrder = 1;
  let stageLabel = bracketSize === 2 ? "final" : "knockout";

  while (roundEntries.length > 1) {
    const nextRoundEntries = [];
    const currentRoundMatches = [];
    const roundName =
      roundEntries.length === 2
        ? "final"
        : roundEntries.length === 4
        ? "semifinal"
        : roundEntries.length === 8
        ? "quarterfinal"
        : stageLabel;

    for (let index = 0; index < roundEntries.length / 2; index += 1) {
      const sideA = roundEntries[index];
      const sideB = roundEntries[roundEntries.length - 1 - index];
      const matchId = buildGeneratedId(`match-${roundName}-${roundOrder}-${index + 1}`);
      const match = buildMatchBase({
        tournamentId,
        stage: roundName,
        roundOrder,
        matchOrder: index + 1,
        sideAType: sideA ? "placeholder" : "bye",
        sideARef: sideA
          ? sideA.type === "group_position"
            ? {
                sourceGroupId: sideA.sourceGroupId,
                sourcePosition: sideA.sourcePosition,
                label: sideA.label,
              }
            : {
                sourceMatchId: sideA.sourceMatchId,
                outcome: "winner",
                label: sideA.label,
              }
          : "",
        sideALabel: sideA?.label || "BYE",
        sideBType: sideB ? "placeholder" : "bye",
        sideBRef: sideB
          ? sideB.type === "group_position"
            ? {
                sourceGroupId: sideB.sourceGroupId,
                sourcePosition: sideB.sourcePosition,
                label: sideB.label,
              }
            : {
                sourceMatchId: sideB.sourceMatchId,
                outcome: "winner",
                label: sideB.label,
              }
          : "",
        sideBLabel: sideB?.label || "BYE",
      });

      currentRoundMatches.push({ ...match, id: matchId });
      nextRoundEntries.push({
        type: "match_winner",
        sourceMatchId: matchId,
        label: `Ganador ${roundName} ${index + 1}`,
      });
    }

    roundMatches.push(...currentRoundMatches);
    roundEntries = nextRoundEntries;
    roundOrder += 1;
    stageLabel = "knockout";
  }

  return roundMatches.map((match, index, matches) => {
    const nextRoundMatch = matches.find(
      (candidate) =>
        candidate.roundOrder === match.roundOrder + 1 &&
        (candidate.sideARef?.sourceMatchId === match.id || candidate.sideBRef?.sourceMatchId === match.id)
    );

    if (!nextRoundMatch) {
      return match;
    }

    return {
      ...match,
      nextMatchId: nextRoundMatch.id,
      nextMatchSlot:
        nextRoundMatch.sideARef?.sourceMatchId === match.id ? "sideA" : "sideB",
    };
  });
}

function buildEmptyStandingsFromGroup(group = {}, registrationsById = new Map()) {
  return (group.pairIds || []).map((pairId, index) =>
    buildGroupStandingEntry(registrationsById.get(pairId) || { id: pairId, pairLabel: pairId }, index, group.qualifiedCount)
  );
}

function normalizeSets(sets = []) {
  return (Array.isArray(sets) ? sets : [])
    .map((set) => ({
      sideA: normalizeCount(set?.sideA, 0),
      sideB: normalizeCount(set?.sideB, 0),
    }))
    .filter((set) => set.sideA !== 0 || set.sideB !== 0);
}

function getMatchWinnerAndLoser(match = {}) {
  if (!match.winnerPairId) {
    return { winnerPairId: "", loserPairId: "" };
  }

  const sideAId = typeof match.sideARef === "string" ? match.sideARef : "";
  const sideBId = typeof match.sideBRef === "string" ? match.sideBRef : "";

  return {
    winnerPairId: match.winnerPairId,
    loserPairId: match.winnerPairId === sideAId ? sideBId : sideAId,
  };
}

function buildRoundRobinStandings(group = {}, matches = [], registrationsById = new Map()) {
  const rows = new Map();

  buildEmptyStandingsFromGroup(group, registrationsById).forEach((row) => {
    rows.set(row.pairId, { ...row, qualified: false, position: 0 });
  });

  matches
    .filter((match) => match.status === "completed" && match.winnerPairId)
    .forEach((match) => {
      const { winnerPairId, loserPairId } = getMatchWinnerAndLoser(match);
      const winnerRow = rows.get(winnerPairId);
      const loserRow = rows.get(loserPairId);

      if (!winnerRow || !loserRow) {
        return;
      }

      winnerRow.played += 1;
      winnerRow.won += 1;
      winnerRow.points += 2;
      loserRow.played += 1;
      loserRow.lost += 1;
      loserRow.points += 1;

      normalizeSets(match.sets).forEach((set) => {
        const winnerIsSideA = winnerPairId === match.sideARef;
        const winnerGames = winnerIsSideA ? set.sideA : set.sideB;
        const loserGames = winnerIsSideA ? set.sideB : set.sideA;

        winnerRow.gamesWon += winnerGames;
        winnerRow.gamesLost += loserGames;
        loserRow.gamesWon += loserGames;
        loserRow.gamesLost += winnerGames;

        if (winnerGames > loserGames) {
          winnerRow.setsWon += 1;
          loserRow.setsLost += 1;
        } else if (loserGames > winnerGames) {
          loserRow.setsWon += 1;
          winnerRow.setsLost += 1;
        }
      });
    });

  const rowsList = [...rows.values()].sort((first, second) => {
    if (second.points !== first.points) {
      return second.points - first.points;
    }

    const secondSetDiff = second.setsWon - second.setsLost;
    const firstSetDiff = first.setsWon - first.setsLost;

    if (secondSetDiff !== firstSetDiff) {
      return secondSetDiff - firstSetDiff;
    }

    const secondGameDiff = second.gamesWon - second.gamesLost;
    const firstGameDiff = first.gamesWon - first.gamesLost;

    if (secondGameDiff !== firstGameDiff) {
      return secondGameDiff - firstGameDiff;
    }

    return first.pairLabel.localeCompare(second.pairLabel, "es");
  });

  return rowsList.map((row, index) => ({
    ...row,
    position: index + 1,
    qualified: index < Number(group.qualifiedCount || 0),
  }));
}

function buildProgressiveFourStandings(group = {}, matches = [], registrationsById = new Map()) {
  const baseRows = buildEmptyStandingsFromGroup(group, registrationsById);
  const rowsById = new Map(baseRows.map((row) => [row.pairId, { ...row, qualified: false, position: 0 }]));
  const firstRoundMatches = matches.filter((match) => match.roundOrder === 1);
  const secondRoundMatches = matches.filter((match) => match.roundOrder === 2);

  [...firstRoundMatches, ...secondRoundMatches]
    .filter((match) => match.status === "completed" && match.winnerPairId)
    .forEach((match) => {
      const { winnerPairId, loserPairId } = getMatchWinnerAndLoser(match);
      const winnerRow = rowsById.get(winnerPairId);
      const loserRow = rowsById.get(loserPairId);

      if (!winnerRow || !loserRow) {
        return;
      }

      winnerRow.played += 1;
      winnerRow.won += 1;
      loserRow.played += 1;
      loserRow.lost += 1;
    });

  const winnersMatch = secondRoundMatches.find((match) => match.matchOrder === 1);
  const losersMatch = secondRoundMatches.find((match) => match.matchOrder === 2);
  const ranking = [];

  if (winnersMatch?.winnerPairId) {
    ranking.push(winnersMatch.winnerPairId);
    const finalistLoser =
      winnersMatch.winnerPairId === winnersMatch.sideARef ? winnersMatch.sideBRef : winnersMatch.sideARef;
    if (finalistLoser) {
      ranking.push(finalistLoser);
    }
  }

  if (losersMatch?.winnerPairId) {
    ranking.push(losersMatch.winnerPairId);
    const eliminatedPairId =
      losersMatch.winnerPairId === losersMatch.sideARef ? losersMatch.sideBRef : losersMatch.sideARef;
    if (eliminatedPairId) {
      ranking.push(eliminatedPairId);
    }
  }

  const unresolvedRows = [...rowsById.values()].filter((row) => !ranking.includes(row.pairId));
  unresolvedRows.forEach((row) => ranking.push(row.pairId));

  return ranking.map((pairId, index) => ({
    ...rowsById.get(pairId),
    position: index + 1,
    qualified: index < Number(group.qualifiedCount || 0),
  }));
}

function buildGroupStandings(group = {}, matches = [], registrationsById = new Map()) {
  if (group.format === "progressive_four") {
    return buildProgressiveFourStandings(group, matches, registrationsById);
  }

  return buildRoundRobinStandings(group, matches, registrationsById);
}

async function hydrateDependentMatches(tournamentId) {
  const [groups, matches, registrations] = await Promise.all([
    listGroupDocs(tournamentId),
    listMatchDocs(tournamentId),
    listRegistrationDocs(tournamentId),
  ]);
  const registrationsById = new Map(registrations.map((registration) => [registration.id, registration]));
  const matchesById = new Map(matches.map((match) => [match.id, match]));
  const updatedMatches = matches
    .filter((match) => match.status !== "completed")
    .map((match) => {
      let changed = false;
      const nextMatch = { ...match };

      ["A", "B"].forEach((sideKey) => {
        const typeKey = `side${sideKey}Type`;
        const refKey = `side${sideKey}Ref`;
        const labelKey = `side${sideKey}Label`;
        const refValue = nextMatch[refKey];

        if (nextMatch[typeKey] !== "placeholder") {
          return;
        }

        let resolvedPairId = "";
        let resolvedPairLabel = "";

        if (refValue?.sourceGroupId && refValue?.sourcePosition) {
          const group = groups.find((groupEntry) => groupEntry.id === refValue.sourceGroupId);
          const standing = group?.standings?.find(
            (row) => Number(row.position || 0) === Number(refValue.sourcePosition || 0)
          );

          resolvedPairId = standing?.pairId || "";
          resolvedPairLabel = standing?.pairLabel || refValue.label || "";
        } else if (refValue?.sourceMatchId && refValue?.outcome) {
          const sourceMatch = matchesById.get(refValue.sourceMatchId);

          if (!sourceMatch?.winnerPairId) {
            return;
          }

          resolvedPairId =
            refValue.outcome === "winner"
              ? sourceMatch.winnerPairId
              : sourceMatch.winnerPairId === sourceMatch.sideARef
              ? sourceMatch.sideBRef
              : sourceMatch.sideARef;
          resolvedPairLabel = registrationsById.get(resolvedPairId)?.pairLabel || refValue.label || "";
        }

        if (!resolvedPairId) {
          return;
        }

        nextMatch[typeKey] = "pair";
        nextMatch[refKey] = resolvedPairId;
        nextMatch[labelKey] = resolvedPairLabel || nextMatch[labelKey];
        changed = true;
      });

      if (!changed) {
        return null;
      }

      const ready = nextMatch.sideAType === "pair" && nextMatch.sideBType === "pair";
      nextMatch.status = ready && nextMatch.status === "pending" ? "scheduled" : nextMatch.status;
      return nextMatch;
    })
    .filter(Boolean);

  if (!updatedMatches.length) {
    return;
  }

  const batch = writeBatch(db);

  updatedMatches.forEach((match) => {
    batch.update(doc(db, "tournaments", tournamentId, "matches", match.id), {
      sideAType: match.sideAType,
      sideARef: match.sideARef,
      sideALabel: match.sideALabel,
      sideBType: match.sideBType,
      sideBRef: match.sideBRef,
      sideBLabel: match.sideBLabel,
      status: match.status,
      updatedAt: serverTimestamp(),
    });
  });

  await batch.commit();
}

async function advanceWinnerToNextMatch(tournamentId, match = {}) {
  if (!match.nextMatchId || !match.winnerPairId) {
    return;
  }

  const nextMatchRef = doc(db, "tournaments", tournamentId, "matches", match.nextMatchId);
  const nextMatchSnapshot = await getDoc(nextMatchRef);

  if (!nextMatchSnapshot.exists()) {
    return;
  }

  const nextMatch = normalizeMatchDoc(nextMatchSnapshot);
  const updatePayload = {
    updatedAt: serverTimestamp(),
  };

  if (match.nextMatchSlot === "winnerA" || match.nextMatchSlot === "sideA") {
    updatePayload.sideAType = "pair";
    updatePayload.sideARef = match.winnerPairId;
    updatePayload.sideALabel = match.winnerPairLabel || nextMatch.sideALabel || "Ganador";
  }

  if (match.nextMatchSlot === "winnerB" || match.nextMatchSlot === "sideB") {
    updatePayload.sideBType = "pair";
    updatePayload.sideBRef = match.winnerPairId;
    updatePayload.sideBLabel = match.winnerPairLabel || nextMatch.sideBLabel || "Ganador";
  }

  if (match.nextMatchSlot === "loserA") {
    updatePayload.sideAType = "pair";
    updatePayload.sideARef = match.loserPairId;
    updatePayload.sideALabel = match.loserPairLabel || nextMatch.sideALabel || "Perdedor";
  }

  if (match.nextMatchSlot === "loserB") {
    updatePayload.sideBType = "pair";
    updatePayload.sideBRef = match.loserPairId;
    updatePayload.sideBLabel = match.loserPairLabel || nextMatch.sideBLabel || "Perdedor";
  }

  const sideAReady = updatePayload.sideAType ? updatePayload.sideAType === "pair" : nextMatch.sideAType === "pair";
  const sideBReady = updatePayload.sideBType ? updatePayload.sideBType === "pair" : nextMatch.sideBType === "pair";

  if (sideAReady && sideBReady && nextMatch.status === "pending") {
    updatePayload.status = "scheduled";
  }

  await updateDoc(nextMatchRef, updatePayload);
}

export async function createTournament(organizer, payload) {
  const tournamentPayload = buildTournamentPayload(organizer, payload);
  const createdRef = await addDoc(collection(db, "tournaments"), tournamentPayload);

  return {
    id: createdRef.id,
    ...tournamentPayload,
    createdAtMillis: buildClientTimestampMillis(),
    updatedAtMillis: buildClientTimestampMillis(),
  };
}

export async function createMultipleTournaments(organizer, payloads = []) {
  const normalizedPayloads = Array.isArray(payloads) ? payloads : [];

  if (!normalizedPayloads.length) {
    return [];
  }

  const batchId = buildGeneratedId("tournament-batch");
  const batch = writeBatch(db);
  const createdTournaments = [];

  normalizedPayloads.forEach((payload) => {
    const tournamentRef = doc(collection(db, "tournaments"));
    const tournamentPayload = buildTournamentPayload(organizer, payload, batchId);
    batch.set(tournamentRef, tournamentPayload);
    createdTournaments.push({
      id: tournamentRef.id,
      ...tournamentPayload,
      createdAtMillis: buildClientTimestampMillis(),
      updatedAtMillis: buildClientTimestampMillis(),
    });
  });

  await batch.commit();
  return createdTournaments;
}

export async function getTournamentById(tournamentId) {
  const snapshot = await getDoc(doc(db, "tournaments", tournamentId));

  if (!snapshot.exists()) {
    return null;
  }

  return mapTournamentDoc(snapshot);
}

export async function listTournaments() {
  const snapshot = await getDocs(collection(db, "tournaments"));
  return snapshot.docs.map(mapTournamentDoc);
}

export async function listTournamentsWithRegistrationCounts() {
  const tournaments = await listTournaments();

  const tournamentsWithCounts = await Promise.all(
    tournaments.map(async (tournament) => {
      const registrations = await listRegistrationDocs(tournament.id);

      return {
        ...tournament,
        registrationsCount: registrations.filter(
          (registration) =>
            registration.status !== "rejected" && !isRegistrationWithdrawnConfirmed(registration)
        ).length,
        confirmedRegistrationsCount: registrations.filter(
          (registration) =>
            registration.status === "confirmed" && !isRegistrationWithdrawnConfirmed(registration)
        ).length,
      };
    })
  );

  return tournamentsWithCounts;
}

export async function listTournamentRegistrations(tournamentId) {
  return listRegistrationDocs(tournamentId);
}

export async function listTournamentGroups(tournamentId) {
  return listGroupDocs(tournamentId);
}

export async function listTournamentMatches(tournamentId) {
  return listMatchDocs(tournamentId);
}

export async function updateTournament(tournamentId, organizer, payload, currentTournament = null) {
  if (!tournamentId) {
    throw new Error("No encontramos el torneo que queres editar.");
  }

  const tournament = currentTournament || (await getTournamentById(tournamentId));

  if (!tournament) {
    throw new Error("No encontramos el torneo que queres editar.");
  }

  const currentComposition = tournament.compositionConfig || {};
  const mergedPayload = {
    ...tournament,
    ...payload,
    branch: payload?.branch ?? currentComposition.branch,
    categoryFormat: payload?.categoryFormat ?? currentComposition.categoryFormat,
    sumTarget: payload?.sumTarget ?? currentComposition.sumTarget,
    sumRule: payload?.sumRule ?? currentComposition.sumRule,
    fixedCategoryA: payload?.fixedCategoryA ?? currentComposition.fixedCategoryA,
    fixedCategoryB: payload?.fixedCategoryB ?? currentComposition.fixedCategoryB,
  };
  const normalizedPayload = buildTournamentPayload(
    organizer || { uid: tournament.organizerId, name: tournament.organizerName },
    {
      ...mergedPayload,
      status: payload?.status || tournament.status,
      registrationStatus: payload?.registrationStatus || tournament.registrationStatus,
      championPairId: tournament.championPairId,
      runnerUpPairId: tournament.runnerUpPairId,
      creationBatchId: tournament.creationBatchId || "",
    }
  );

  await updateDoc(doc(db, "tournaments", tournamentId), {
    name: normalizedPayload.name,
    description: normalizedPayload.description,
    coverImage: normalizedPayload.coverImage,
    tournamentRuleSet: normalizedPayload.tournamentRuleSet,
    venueMode: normalizedPayload.venueMode,
    venues: normalizedPayload.venues,
    temporaryVenues: normalizedPayload.temporaryVenues,
    compositionType: normalizedPayload.compositionType,
    compositionConfig: normalizedPayload.compositionConfig,
    compositionLabel: normalizedPayload.compositionLabel,
    tournamentFormat: normalizedPayload.tournamentFormat,
    matchFormat: normalizedPayload.matchFormat,
    thirdSetMode: normalizedPayload.thirdSetMode,
    maxPairs: normalizedPayload.maxPairs,
    minPairs: normalizedPayload.minPairs,
    registrationMode: normalizedPayload.registrationMode,
    pairConfirmationMode: normalizedPayload.pairConfirmationMode,
    entryFee: normalizedPayload.entryFee,
    paymentMethods: normalizedPayload.paymentMethods,
    paymentAlias: normalizedPayload.paymentAlias,
    playDays: normalizedPayload.playDays,
    groupStageDays: normalizedPayload.groupStageDays,
    knockoutDays: normalizedPayload.knockoutDays,
    startDateMillis: normalizedPayload.startDateMillis,
    endDateMillis: normalizedPayload.endDateMillis,
    buildMode: normalizedPayload.buildMode,
    recommendedGroupSize: normalizedPayload.recommendedGroupSize,
    allowManualCorrection: normalizedPayload.allowManualCorrection,
    fixtureSetup:
      payload?.fixtureSetup !== undefined
        ? payload.fixtureSetup
        : tournament.fixtureSetup || null,
    zonePlanning:
      payload?.zonePlanning !== undefined
        ? payload.zonePlanning
        : tournament.zonePlanning || null,
    updatedAt: serverTimestamp(),
  });

  return {
    ...tournament,
    ...normalizedPayload,
    fixtureSetup:
      payload?.fixtureSetup !== undefined
        ? payload.fixtureSetup
        : tournament.fixtureSetup || null,
    zonePlanning:
      payload?.zonePlanning !== undefined
        ? payload.zonePlanning
        : tournament.zonePlanning || null,
    id: tournamentId,
  };
}

export async function publishTournament(tournamentId) {
  const tournament = await getTournamentById(tournamentId);

  if (!tournament) {
    throw new Error("No encontramos el torneo para publicarlo.");
  }

  if (tournament.status === "cancelled") {
    throw new Error("No podes publicar un torneo cancelado.");
  }

  await updateDoc(doc(db, "tournaments", tournamentId), {
    status: "published",
    updatedAt: serverTimestamp(),
  });
}

export async function openTournamentRegistration(tournamentId) {
  const tournament = await getTournamentById(tournamentId);

  if (!tournament) {
    throw new Error("No encontramos el torneo.");
  }

  ensureTournamentCanOpenRegistration(tournament);

  await updateDoc(doc(db, "tournaments", tournamentId), {
    status: "registration_open",
    registrationStatus: "open",
    updatedAt: serverTimestamp(),
  });
}

export async function closeTournamentRegistration(tournamentId) {
  const tournament = await getTournamentById(tournamentId);

  if (!tournament) {
    throw new Error("No encontramos el torneo.");
  }

  await updateDoc(doc(db, "tournaments", tournamentId), {
    status: tournament.status === "in_progress" ? "in_progress" : "registration_closed",
    registrationStatus: "closed",
    updatedAt: serverTimestamp(),
  });
}

export async function registerPairToTournament(tournamentId, payload = {}) {
  const tournament = await getTournamentById(tournamentId);

  if (!tournament) {
    throw new Error("No encontramos el torneo.");
  }

  if (!["published", "registration_open"].includes(tournament.status)) {
    throw new Error("La inscripcion del torneo todavia no esta disponible.");
  }

  const registrations = await listRegistrationDocs(tournamentId);
  const player1 = normalizePlayerRegistrationSide(payload.player1, 0);
  const player2 = normalizePlayerRegistrationSide(payload.player2, 1);
  const allowGuestPlayers = Boolean(payload.allowGuestPlayers);
  const validation = validateTournamentRegistrationPair(tournament, {
    allowGuestPlayers,
    player1,
    player2,
  });

  if (!validation.valid) {
    throw new Error(validation.message);
  }

  const playerIdsToCheck = new Set([player1.userId, player2.userId].filter(Boolean));
  const alreadyRegistered = registrations.find((registration) =>
    !isRegistrationWithdrawnConfirmed(registration) &&
    [registration.player1Id, registration.player2Id].some((playerId) => playerIdsToCheck.has(playerId))
  );

  if (alreadyRegistered) {
    throw new Error("Uno de los jugadores ya esta inscripto en este torneo.");
  }

  const activeRegistrationsCount = registrations.filter(
    (registration) =>
      registration.status !== "rejected" && !isRegistrationWithdrawnConfirmed(registration)
  ).length;

  if (activeRegistrationsCount >= Number(tournament.maxPairs || 0)) {
    throw new Error("El torneo ya alcanzo el cupo maximo de parejas.");
  }

  const availability = normalizeRegistrationAvailability(payload.availability || {}, tournament);
  const paymentDrafts = Array.isArray(payload.paymentsOverride) ? payload.paymentsOverride : [];
  const findPaymentDraft = (player) =>
    paymentDrafts.find(
      (draft) =>
        draft?.playerId === player.playerId ||
        (draft?.userId && draft.userId === player.userId)
    );
  const payments = [player1, player2]
    .filter((player) => player?.playerId)
    .map((player) => applyPaymentDraft(buildPaymentEntry(player, tournament.entryFee), findPaymentDraft(player)));
  const organizerConfirmed = Boolean(payload.organizerConfirmed);
  const registrationStatus = organizerConfirmed
    ? "confirmed"
    : getRegistrationStatusFromPayments(tournament, payments, false);
  const registrationPayload = {
    player1Id: player1.userId || player1.playerId,
    player1Name: player1.name,
    player2Id: player2.userId || player2.playerId,
    player2Name: player2.name,
    pairLabel: [player1.name, player2.name].filter(Boolean).join(" / "),
    status: registrationStatus,
    availability,
    payments,
    groupId: "",
    groupPosition: 0,
    qualifiedToKnockout: false,
    withdrawalStatus: "none",
    withdrawalRequestedAt: null,
    withdrawalRequestedBy: "",
    withdrawalRequestedByName: "",
    withdrawalConfirmedAt: null,
    withdrawalConfirmedBy: "",
    withdrawalConfirmedByName: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    confirmedAt: registrationStatus === "confirmed" ? serverTimestamp() : null,
    rejectedAt: null,
  };

  const createdRef = await addDoc(
    collection(db, "tournaments", tournamentId, "registrations"),
    registrationPayload
  );

  return {
    id: createdRef.id,
    ...registrationPayload,
  };
}

export async function updateTournamentRegistration(tournamentId, registrationId, payload = {}) {
  const tournament = await getTournamentById(tournamentId);

  if (!tournament) {
    throw new Error("No encontramos el torneo.");
  }

  if (!["published", "registration_open"].includes(tournament.status)) {
    throw new Error("La inscripcion del torneo ya no esta disponible para editar.");
  }

  const registrationRef = doc(db, "tournaments", tournamentId, "registrations", registrationId);
  const registrationSnapshot = await getDoc(registrationRef);

  if (!registrationSnapshot.exists()) {
    throw new Error("No encontramos la inscripcion.");
  }

  const currentRegistration = normalizeRegistrationDoc(registrationSnapshot);
  const registrations = await listRegistrationDocs(tournamentId);
  const player1 = normalizePlayerRegistrationSide(payload.player1, 0);
  const player2 = normalizePlayerRegistrationSide(payload.player2, 1);
  const allowGuestPlayers = Boolean(payload.allowGuestPlayers);
  const validation = validateTournamentRegistrationPair(tournament, {
    allowGuestPlayers,
    player1,
    player2,
  });

  if (!validation.valid) {
    throw new Error(validation.message);
  }

  const playerIdsToCheck = new Set([player1.userId, player2.userId].filter(Boolean));
  const conflictingRegistration = registrations.find((registration) => {
    if (registration.id === registrationId) {
      return false;
    }

    if (isRegistrationWithdrawnConfirmed(registration)) {
      return false;
    }

    return [registration.player1Id, registration.player2Id].some((playerId) =>
      playerIdsToCheck.has(playerId)
    );
  });

  if (conflictingRegistration) {
    throw new Error("Uno de los jugadores ya esta inscripto en este torneo.");
  }

  const availability = normalizeRegistrationAvailability(payload.availability || {}, tournament);
  const currentPayments = Array.isArray(currentRegistration.payments) ? currentRegistration.payments : [];
  const findExistingPayment = (player) =>
    currentPayments.find(
      (payment) =>
        (player.userId && (payment.userId === player.userId || payment.playerId === player.userId)) ||
        payment.playerId === player.playerId
    );
  const paymentDrafts = Array.isArray(payload.paymentsOverride) ? payload.paymentsOverride : [];
  const findPaymentDraft = (player) =>
    paymentDrafts.find(
      (draft) =>
        draft?.playerId === player.playerId ||
        (draft?.userId && draft.userId === player.userId)
    );
  const nextPayments = [player1, player2]
    .filter((player) => player?.playerId)
    .map((player) => {
      const existingPayment = findExistingPayment(player);
      const nextPayment = existingPayment
        ? {
            ...existingPayment,
            userId: player.userId,
            playerId: player.playerId,
            playerName: player.name,
          }
        : buildPaymentEntry(player, tournament.entryFee);

      return applyPaymentDraft(nextPayment, findPaymentDraft(player));
    });
  const statusMeta = getRegistrationStatusMeta(tournament, nextPayments, currentRegistration);

  await updateDoc(registrationRef, {
    player1Id: player1.userId || player1.playerId,
    player1Name: player1.name,
    player2Id: player2.userId || player2.playerId,
    player2Name: player2.name,
    pairLabel: [player1.name, player2.name].filter(Boolean).join(" / "),
    availability,
    payments: nextPayments,
    status: statusMeta.status,
    confirmedAt: statusMeta.confirmedAt,
    rejectedAt: statusMeta.rejectedAt,
    updatedAt: serverTimestamp(),
  });

  return {
    ...currentRegistration,
    player1Id: player1.userId || player1.playerId,
    player1Name: player1.name,
    player2Id: player2.userId || player2.playerId,
    player2Name: player2.name,
    pairLabel: [player1.name, player2.name].filter(Boolean).join(" / "),
    availability,
    payments: nextPayments,
    status: statusMeta.status,
  };
}

export async function uploadTournamentPaymentReceipt({
  tournamentId,
  registrationId,
  playerId,
  receiptUri,
  fileName,
  method = "transferencia",
  uploadedBy,
  uploadedByName,
}) {
  if (!receiptUri) {
    throw new Error("Necesitamos el comprobante para subirlo.");
  }

  const registrationRef = doc(db, "tournaments", tournamentId, "registrations", registrationId);
  const registrationSnapshot = await getDoc(registrationRef);

  if (!registrationSnapshot.exists()) {
    throw new Error("No encontramos la inscripcion.");
  }

  const registration = normalizeRegistrationDoc(registrationSnapshot);
  const tournament = await getTournamentById(tournamentId);
  const targetPayment = registration.payments.find(
    (payment) => payment.playerId === playerId || payment.userId === playerId
  );

  if (!targetPayment) {
    throw new Error("No encontramos el pago del jugador dentro de esta inscripcion.");
  }

  const response = await fetch(receiptUri);
  const blob = await response.blob();
  const extension = String(fileName || "comprobante.jpg").split(".").pop() || "jpg";
  const receiptContentType =
    blob.type ||
    (extension.toLowerCase() === "pdf" ? "application/pdf" : "image/jpeg");
  const receiptPath = `tournaments/${tournamentId}/registrations/${registrationId}/${targetPayment.userId || targetPayment.playerId}-${Date.now()}.${extension}`;
  const receiptRef = ref(storage, receiptPath);
  const uploadedAtMillis = buildClientTimestampMillis();

  await uploadBytes(receiptRef, blob, {
    contentType: receiptContentType,
  });

  const receiptUrl = await getDownloadURL(receiptRef);
  const nextPayments = registration.payments.map((payment) =>
    payment.playerId === playerId || payment.userId === playerId
      ? {
          ...payment,
          status: "in_review",
          method,
          receiptUrl,
          receiptPath,
          receiptFileName: normalizeString(fileName, "comprobante"),
          uploadedAt: uploadedAtMillis,
          reviewedAt: null,
          reviewedBy: "",
          reviewedByName: "",
        }
      : payment
  );
  const statusMeta = getRegistrationStatusMeta(tournament, nextPayments, registration);

  await updateDoc(registrationRef, {
    payments: nextPayments,
    status: statusMeta.status,
    updatedAt: serverTimestamp(),
  });

  return {
    receiptUrl,
    payments: nextPayments,
    status: statusMeta.status,
  };
}

export async function uploadTournamentCoverImage(organizerId, imageUri, fileName = "afiche.jpg") {
  if (!imageUri) {
    throw new Error("Necesitamos una imagen para cargar el afiche.");
  }

  const response = await fetch(imageUri);
  const blob = await response.blob();
  const extension = String(fileName || "afiche.jpg").split(".").pop() || "jpg";
  const coverPath = `tournaments/covers/${organizerId || "organizer"}/${Date.now()}.${extension}`;
  const coverRef = ref(storage, coverPath);

  await uploadBytes(coverRef, blob, {
    contentType: blob.type || "image/jpeg",
  });

  return getDownloadURL(coverRef);
}

export async function reviewTournamentPayment({
  tournamentId,
  registrationId,
  playerId,
  reviewerId,
  reviewerName,
  approved,
}) {
  const tournament = await getTournamentById(tournamentId);
  const registrationRef = doc(db, "tournaments", tournamentId, "registrations", registrationId);
  const registrationSnapshot = await getDoc(registrationRef);

  if (!tournament || !registrationSnapshot.exists()) {
    throw new Error("No encontramos el pago que queres revisar.");
  }

  const registration = normalizeRegistrationDoc(registrationSnapshot);
  const reviewedAtMillis = buildClientTimestampMillis();
  const nextPayments = registration.payments.map((payment) =>
    payment.playerId === playerId || payment.userId === playerId
      ? {
          ...payment,
          status: approved ? "approved" : "rejected",
          reviewedAt: reviewedAtMillis,
          reviewedBy: reviewerId || "",
          reviewedByName: reviewerName || "Organizador",
        }
      : payment
  );
  const statusMeta = getRegistrationStatusMeta(tournament, nextPayments, registration);

  await updateDoc(registrationRef, {
    payments: nextPayments,
    status: statusMeta.status,
    confirmedAt: statusMeta.status === "confirmed" ? serverTimestamp() : null,
    rejectedAt: statusMeta.status === "rejected" ? serverTimestamp() : null,
    updatedAt: serverTimestamp(),
  });

  return {
    status: statusMeta.status,
    payments: nextPayments,
  };
}

export async function recordTournamentOrganizerPayment({
  tournamentId,
  registrationId,
  playerId,
  organizerId,
  organizerName,
  method = "",
}) {
  const tournament = await getTournamentById(tournamentId);
  const registrationRef = doc(db, "tournaments", tournamentId, "registrations", registrationId);
  const registrationSnapshot = await getDoc(registrationRef);

  if (!tournament || !registrationSnapshot.exists()) {
    throw new Error("No encontramos el pago que queres actualizar.");
  }

  const registration = normalizeRegistrationDoc(registrationSnapshot);
  const normalizedMethod = normalizePaymentMethod(method);
  const reviewedAtMillis = buildClientTimestampMillis();
  const nextPayments = registration.payments.map((payment) => {
    if (payment.playerId !== playerId && payment.userId !== playerId) {
      return payment;
    }

    return {
      ...payment,
      method: normalizedMethod,
      status: normalizedMethod ? "approved" : payment.amount > 0 ? "pending" : "approved",
      reviewedAt: normalizedMethod ? reviewedAtMillis : null,
      reviewedBy: normalizedMethod ? organizerId || "" : "",
      reviewedByName: normalizedMethod ? organizerName || "Organizador" : "",
    };
  });
  const statusMeta = getRegistrationStatusMeta(tournament, nextPayments, registration);

  await updateDoc(registrationRef, {
    payments: nextPayments,
    status: statusMeta.status,
    confirmedAt: statusMeta.status === "confirmed" ? serverTimestamp() : null,
    rejectedAt: statusMeta.status === "rejected" ? serverTimestamp() : null,
    updatedAt: serverTimestamp(),
  });

  return {
    status: statusMeta.status,
    payments: nextPayments,
  };
}

export async function confirmTournamentRegistration({
  tournamentId,
  registrationId,
  organizerId,
  organizerName,
  force = false,
}) {
  const [tournament, registrationSnapshot, registrations] = await Promise.all([
    getTournamentById(tournamentId),
    getDoc(doc(db, "tournaments", tournamentId, "registrations", registrationId)),
    listRegistrationDocs(tournamentId),
  ]);

  if (!tournament || !registrationSnapshot.exists()) {
    throw new Error("No encontramos la inscripcion para confirmarla.");
  }

  const registration = normalizeRegistrationDoc(registrationSnapshot);
  const currentConfirmedCount = registrations.filter(
    (entry) =>
      entry.status === "confirmed" &&
      entry.id !== registrationId &&
      !isRegistrationWithdrawnConfirmed(entry)
  ).length;

  if (currentConfirmedCount >= Number(tournament.maxPairs || 0)) {
    throw new Error("El torneo ya alcanzo el cupo maximo de parejas confirmadas.");
  }

  const statusByPayments = getRegistrationStatusFromPayments(tournament, registration.payments, false);
  const canConfirmAutomatically = statusByPayments === "confirmed";
  const canConfirmManually = force || tournament.pairConfirmationMode === "manual";

  if (!canConfirmAutomatically && !canConfirmManually) {
    throw new Error("Esta pareja todavia no cumple las condiciones para quedar confirmada.");
  }

  await updateDoc(doc(db, "tournaments", tournamentId, "registrations", registrationId), {
    status: "confirmed",
    confirmedAt: serverTimestamp(),
    confirmedBy: organizerId || "",
    confirmedByName: organizerName || "Organizador",
    updatedAt: serverTimestamp(),
  });
}

export async function requestTournamentRegistrationWithdrawal({
  tournamentId,
  registrationId,
  requestedById,
  requestedByName,
}) {
  if (!tournamentId || !registrationId) {
    throw new Error("No encontramos la inscripcion para solicitar la baja.");
  }

  const registrationRef = doc(db, "tournaments", tournamentId, "registrations", registrationId);
  const registrationSnapshot = await getDoc(registrationRef);

  if (!registrationSnapshot.exists()) {
    throw new Error("No encontramos la inscripcion para solicitar la baja.");
  }

  const registration = normalizeRegistrationDoc(registrationSnapshot);

  if (registration.withdrawalStatus === "confirmed") {
    throw new Error("La baja de esta inscripcion ya fue confirmada.");
  }

  await updateDoc(registrationRef, {
    withdrawalStatus: "requested",
    withdrawalRequestedAt: serverTimestamp(),
    withdrawalRequestedBy: requestedById || "",
    withdrawalRequestedByName: requestedByName || "Jugador",
    updatedAt: serverTimestamp(),
  });
}

export async function cancelTournamentRegistrationWithdrawal({
  tournamentId,
  registrationId,
}) {
  if (!tournamentId || !registrationId) {
    throw new Error("No encontramos la inscripcion para cancelar la baja.");
  }

  const registrationRef = doc(db, "tournaments", tournamentId, "registrations", registrationId);
  const registrationSnapshot = await getDoc(registrationRef);

  if (!registrationSnapshot.exists()) {
    throw new Error("No encontramos la inscripcion para cancelar la baja.");
  }

  const registration = normalizeRegistrationDoc(registrationSnapshot);

  if (registration.withdrawalStatus !== "requested") {
    throw new Error("La baja ya no se puede cancelar.");
  }

  await updateDoc(registrationRef, {
    withdrawalStatus: "none",
    withdrawalRequestedAt: null,
    withdrawalRequestedBy: "",
    withdrawalRequestedByName: "",
    updatedAt: serverTimestamp(),
  });
}

export async function confirmTournamentRegistrationWithdrawal({
  tournamentId,
  registrationId,
  organizerId,
  organizerName,
}) {
  if (!tournamentId || !registrationId) {
    throw new Error("No encontramos la inscripcion para confirmar la baja.");
  }

  const registrationRef = doc(db, "tournaments", tournamentId, "registrations", registrationId);
  const registrationSnapshot = await getDoc(registrationRef);

  if (!registrationSnapshot.exists()) {
    throw new Error("No encontramos la inscripcion para confirmar la baja.");
  }

  const registration = normalizeRegistrationDoc(registrationSnapshot);

  if (registration.withdrawalStatus !== "requested") {
    throw new Error("La pareja todavia no solicito la baja.");
  }

  await updateDoc(registrationRef, {
    withdrawalStatus: "confirmed",
    withdrawalConfirmedAt: serverTimestamp(),
    withdrawalConfirmedBy: organizerId || "",
    withdrawalConfirmedByName: organizerName || "Organizador",
    updatedAt: serverTimestamp(),
  });
}

export async function deleteTournamentRegistration({
  tournamentId,
  registrationId,
}) {
  if (!tournamentId || !registrationId) {
    throw new Error("No encontramos la inscripcion que queres eliminar.");
  }

  await deleteDoc(doc(db, "tournaments", tournamentId, "registrations", registrationId));

  return { success: true };
}

export async function buildTournamentGroups(tournamentId, options = {}) {
  const tournament = await getTournamentById(tournamentId);

  if (!tournament) {
    throw new Error("No encontramos el torneo.");
  }

  ensureTournamentCanBuild(tournament);

  const registrations = (await listRegistrationDocs(tournamentId)).filter(
    (registration) =>
      registration.status === "confirmed" && !isRegistrationWithdrawnConfirmed(registration)
  );

  if (registrations.length < Number(tournament.minPairs || 2)) {
    throw new Error("Todavia no hay suficientes parejas confirmadas para armar el torneo.");
  }

  let groupedRegistrations = [];
  const createdByMode = options.mode || tournament.buildMode || "automatic";

  if (createdByMode === "manual" || createdByMode === "semiautomatic") {
    const manualGroups = Array.isArray(options.manualGroups) ? options.manualGroups : [];

    if (!manualGroups.length) {
      throw new Error("Necesitamos los grupos manuales para continuar.");
    }

    const registrationsById = new Map(registrations.map((registration) => [registration.id, registration]));
    groupedRegistrations = manualGroups.map((group) => {
      const pairIds = Array.isArray(group?.pairIds) ? group.pairIds : [];
      const pairs = pairIds.map((pairId) => registrationsById.get(pairId)).filter(Boolean);

      if (pairs.length < 2 || pairs.length > 4) {
        throw new Error("Cada grupo manual debe tener entre 2 y 4 parejas.");
      }

      return pairs;
    });
  } else {
    groupedRegistrations = buildAutoGroups(
      registrations,
      Number(options.recommendedGroupSize || tournament.recommendedGroupSize || DEFAULT_RECOMMENDED_GROUP_SIZE)
    );
  }

  const groups = groupedRegistrations.map((groupRegistrations, index) =>
    buildGroupDocument({
      groupIndex: index,
      registrations: groupRegistrations,
      createdByMode,
    })
  );
  const batch = writeBatch(db);
  const existingGroups = await listGroupDocs(tournamentId);
  const existingMatches = await listMatchDocs(tournamentId);

  existingGroups.forEach((group) => {
    batch.delete(doc(db, "tournaments", tournamentId, "groups", group.id));
  });

  existingMatches.forEach((match) => {
    batch.delete(doc(db, "tournaments", tournamentId, "matches", match.id));
  });

  groups.forEach((group) => {
    batch.set(doc(db, "tournaments", tournamentId, "groups", group.id), group);
  });

  const groupByPairId = new Map();
  groups.forEach((group) => {
    group.pairIds.forEach((pairId, index) => {
      groupByPairId.set(pairId, { groupId: group.id, groupPosition: index + 1 });
    });
  });

  registrations.forEach((registration) => {
    const groupMeta = groupByPairId.get(registration.id) || { groupId: "", groupPosition: 0 };
    batch.update(doc(db, "tournaments", tournamentId, "registrations", registration.id), {
      groupId: groupMeta.groupId,
      groupPosition: groupMeta.groupPosition,
      qualifiedToKnockout: false,
      updatedAt: serverTimestamp(),
    });
  });

  batch.update(doc(db, "tournaments", tournamentId), {
    status: "building",
    buildMode: createdByMode,
    recommendedGroupSize: Number(
      options.recommendedGroupSize || tournament.recommendedGroupSize || DEFAULT_RECOMMENDED_GROUP_SIZE
    ),
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
  return groups;
}

export async function generateTournamentMatches(tournamentId) {
  const [tournament, registrations, groups, existingMatches] = await Promise.all([
    getTournamentById(tournamentId),
    listRegistrationDocs(tournamentId),
    listGroupDocs(tournamentId),
    listMatchDocs(tournamentId),
  ]);

  if (!tournament) {
    throw new Error("No encontramos el torneo.");
  }

  if (!groups.length) {
    throw new Error("Primero necesitas armar los grupos del torneo.");
  }

  const registrationsById = new Map(registrations.map((registration) => [registration.id, registration]));
  const nextMatches = groups.flatMap((group) =>
    group.format === "progressive_four"
      ? buildGroupMatchesForProgressiveFour(tournamentId, group, registrationsById)
      : buildGroupMatchesForRoundRobin(tournamentId, group, registrationsById)
  );
  const knockoutMatches = buildKnockoutMatches(tournamentId, groups);
  const batch = writeBatch(db);

  existingMatches.forEach((match) => {
    batch.delete(doc(db, "tournaments", tournamentId, "matches", match.id));
  });

  [...nextMatches, ...knockoutMatches].forEach((match) => {
    batch.set(doc(db, "tournaments", tournamentId, "matches", match.id), match);
  });

  batch.update(doc(db, "tournaments", tournamentId), {
    status: "building",
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
  return [...nextMatches, ...knockoutMatches];
}

export async function submitTournamentMatchResult({
  tournamentId,
  matchId,
  winnerPairId,
  scoreText = "",
  sets = [],
}) {
  const matchRef = doc(db, "tournaments", tournamentId, "matches", matchId);
  const matchSnapshot = await getDoc(matchRef);

  if (!matchSnapshot.exists()) {
    throw new Error("No encontramos el partido.");
  }

  const match = normalizeMatchDoc(matchSnapshot);

  if (match.sideAType !== "pair" || match.sideBType !== "pair") {
    throw new Error("Todavia faltan definir las parejas de este partido.");
  }

  if (![match.sideARef, match.sideBRef].includes(winnerPairId)) {
    throw new Error("El ganador seleccionado no coincide con las parejas del partido.");
  }

  const registrations = await listRegistrationDocs(tournamentId);
  const registrationsById = new Map(registrations.map((registration) => [registration.id, registration]));
  const loserPairId = winnerPairId === match.sideARef ? match.sideBRef : match.sideARef;

  await updateDoc(matchRef, {
    status: "completed",
    winnerPairId,
    scoreText: normalizeString(scoreText),
    sets: normalizeSets(sets),
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  if (match.groupId) {
    const [groupSnapshot, matches] = await Promise.all([
      getDoc(doc(db, "tournaments", tournamentId, "groups", match.groupId)),
      listMatchDocs(tournamentId),
    ]);

    if (groupSnapshot.exists()) {
      const group = normalizeGroupDoc(groupSnapshot);
      const groupMatches = matches
        .map((entry) => (entry.id === matchId ? { ...entry, winnerPairId, scoreText, sets: normalizeSets(sets), status: "completed" } : entry))
        .filter((entry) => entry.groupId === match.groupId);
      const standings = buildGroupStandings(group, groupMatches, registrationsById);

      await updateDoc(doc(db, "tournaments", tournamentId, "groups", match.groupId), {
        matchesPlayed: groupMatches.filter((entry) => entry.status === "completed").length,
        standings,
        updatedAt: serverTimestamp(),
      });

      const qualifiedPairIds = standings.filter((row) => row.qualified).map((row) => row.pairId);
      const batch = writeBatch(db);

      group.pairIds.forEach((pairId) => {
        batch.update(doc(db, "tournaments", tournamentId, "registrations", pairId), {
          qualifiedToKnockout: qualifiedPairIds.includes(pairId),
          updatedAt: serverTimestamp(),
        });
      });

      await batch.commit();
      await hydrateDependentMatches(tournamentId);
    }
  }

  await advanceWinnerToNextMatch(tournamentId, {
    ...match,
    winnerPairId,
    winnerPairLabel: registrationsById.get(winnerPairId)?.pairLabel || "Ganador",
    loserPairId,
    loserPairLabel: registrationsById.get(loserPairId)?.pairLabel || "Perdedor",
  });
  await hydrateDependentMatches(tournamentId);

  const allMatches = await listMatchDocs(tournamentId);
  const hasStarted = allMatches.some((entry) => entry.status === "completed");

  if (hasStarted) {
    await updateDoc(doc(db, "tournaments", tournamentId), {
      status: "in_progress",
      updatedAt: serverTimestamp(),
    });
  }
}

export async function finalizeTournament({
  tournamentId,
  championPairId = "",
  runnerUpPairId = "",
}) {
  const [tournament, matches] = await Promise.all([getTournamentById(tournamentId), listMatchDocs(tournamentId)]);

  if (!tournament) {
    throw new Error("No encontramos el torneo.");
  }

  const finalMatch =
    matches.find((match) => match.stage === "final" && match.status === "completed") || null;
  const resolvedChampionPairId = championPairId || finalMatch?.winnerPairId || "";
  const resolvedRunnerUpPairId =
    runnerUpPairId ||
    (finalMatch?.winnerPairId === finalMatch?.sideARef ? finalMatch?.sideBRef : finalMatch?.sideARef) ||
    "";

  if (!resolvedChampionPairId) {
    throw new Error("Necesitamos un campeon para finalizar el torneo.");
  }

  await updateDoc(doc(db, "tournaments", tournamentId), {
    status: "finished",
    championPairId: resolvedChampionPairId,
    runnerUpPairId: resolvedRunnerUpPairId,
    registrationStatus: "closed",
    updatedAt: serverTimestamp(),
  });
}

export async function cancelTournament({
  tournamentId,
  reason = "",
  organizerId = "",
  organizerName = "",
}) {
  const tournament = await getTournamentById(tournamentId);

  if (!tournament) {
    throw new Error("No encontramos el torneo.");
  }

  await updateDoc(doc(db, "tournaments", tournamentId), {
    status: "cancelled",
    registrationStatus: "closed",
    cancellationReason: normalizeString(reason),
    cancelledAt: serverTimestamp(),
    cancelledBy: organizerId,
    cancelledByName: organizerName || "Organizador",
    updatedAt: serverTimestamp(),
  });
}

export async function deleteDraftTournament({ tournamentId, organizerId = "" }) {
  if (!tournamentId) {
    throw new Error("No encontramos el borrador que queres eliminar.");
  }

  const tournament = await getTournamentById(tournamentId);

  if (!tournament) {
    throw new Error("No encontramos el torneo.");
  }

  const isOwner =
    normalizeString(tournament.organizerId) === normalizeString(organizerId) ||
    normalizeString(tournament.createdBy) === normalizeString(organizerId);

  if (!isOwner) {
    throw new Error("Solo el organizador del borrador puede eliminarlo.");
  }

  if (normalizeTournamentStatus(tournament.status) !== "draft") {
    throw new Error("Solo se pueden eliminar torneos en borrador.");
  }

  await deleteDoc(doc(db, "tournaments", tournamentId));
}

export async function deleteCancelledTournament({ tournamentId, organizerId = "" }) {
  if (!tournamentId) {
    throw new Error("No encontramos el torneo que queres eliminar.");
  }

  const tournament = await getTournamentById(tournamentId);

  if (!tournament) {
    throw new Error("No encontramos el torneo.");
  }

  const isOwner =
    normalizeString(tournament.organizerId) === normalizeString(organizerId) ||
    normalizeString(tournament.createdBy) === normalizeString(organizerId);

  if (!isOwner) {
    throw new Error("Solo el organizador del torneo puede eliminarlo.");
  }

  if (normalizeTournamentStatus(tournament.status) !== "cancelled") {
    throw new Error("Solo se pueden eliminar definitivamente torneos cancelados.");
  }

  await deleteDoc(doc(db, "tournaments", tournamentId));
}

export async function findTournamentRegistrationsByPlayer(playerId) {
  if (!playerId) {
    return [];
  }

  const tournaments = await listTournaments();
  const results = [];

  for (const tournament of tournaments) {
    const registrationsRef = collection(db, "tournaments", tournament.id, "registrations");
    const [player1Snapshot, player2Snapshot] = await Promise.all([
      getDocs(query(registrationsRef, where("player1Id", "==", playerId))),
      getDocs(query(registrationsRef, where("player2Id", "==", playerId))),
    ]);
    const registrations = [...player1Snapshot.docs, ...player2Snapshot.docs]
      .map(normalizeRegistrationDoc)
      .filter(
        (registration, index, items) => items.findIndex((item) => item.id === registration.id) === index
      );

    registrations.forEach((registration) => {
      results.push({
        tournament,
        registration,
      });
    });
  }

  return results;
}

