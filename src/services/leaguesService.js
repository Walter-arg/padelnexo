import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "../../services/firebaseFirestore";

import { db } from "../../services/firebaseConfig";
import { canAccessAdminPanel } from "../config/admin";
import { buildPublicationMercadoPagoConfig } from "./mercadoPagoConfigService";
import { formatPlayerShortName, formatTeamShortLabel } from "../utils/playerDisplayName";

export const LEAGUE_BRANCH_OPTIONS = [
  { label: "Caballeros", value: "Masculino" },
  { label: "Damas", value: "Femenino" },
  { label: "Mixta", value: "Mixto" },
];

export const LEAGUE_TEAM_TYPE_OPTIONS = [
  { label: "Pareja fija", value: "pair" },
  { label: "Individual", value: "individual" },
];

export const LEAGUE_CATEGORY_FORMAT_OPTIONS = [
  { label: "Libre", value: "libre" },
  { label: "Suma", value: "suma" },
];

export const LEAGUE_SUM_RULE_OPTIONS = [
  { label: "Categorias fijas", value: "fixed" },
  { label: "Libre", value: "open" },
];

export const MATCH_FORMAT_OPTIONS = [
  {
    label: "3 sets completos",
    value: "three_full_sets",
    description: "Se juega completo el tercer set.",
  },
  {
    label: "2 sets + super tie break",
    value: "two_sets_super_tiebreak",
    description: "Si empatan en sets, define un super tie break.",
  },
  {
    label: "1 Solo Set",
    value: "single_set",
    description: "Se juega un solo set con puntos configurables.",
  },
];

export const LEAGUE_CATEGORY_OPTIONS = [
  { label: "9na (Iniciantes)", value: "9na", numericValue: 9 },
  { label: "8va", value: "8va", numericValue: 8 },
  { label: "7ma", value: "7ma", numericValue: 7 },
  { label: "6ta", value: "6ta", numericValue: 6 },
  { label: "5ta", value: "5ta", numericValue: 5 },
  { label: "4ta", value: "4ta", numericValue: 4 },
  { label: "3ra", value: "3ra", numericValue: 3 },
  { label: "2da", value: "2da", numericValue: 2 },
  { label: "1era", value: "1era", numericValue: 1 },
];

export const LEAGUE_SUM_TARGET_OPTIONS = Array.from({ length: 17 }, (_, index) => {
  const value = index + 2;

  return {
    label: `Suma ${value}`,
    value: String(value),
    numericValue: value,
  };
});

const DEFAULT_WALKOVER_SCORE = [
  { own: 6, rival: 0 },
  { own: 6, rival: 0 },
];

const DEFAULT_FIXTURE_DATES_COUNT = 6;
const DEFAULT_MIN_PLAYERS_COUNT = 8;
const SCORING_SETTINGS_VERSION = 2;

const DAY_LABELS = {
  monday: "Lunes",
  tuesday: "Martes",
  wednesday: "Miercoles",
  thursday: "Jueves",
  friday: "Viernes",
  saturday: "Sabado",
  sunday: "Domingo",
};

export const LEAGUE_PAYMENT_STATUS_OPTIONS = [
  { label: "No pago", value: "pendiente" },
  { label: "Transfirio", value: "informo_transferencia" },
  { label: "Pagado", value: "pagado" },
];

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

function normalizePlayerSex(value = "") {
  const normalized = String(value).trim().toLowerCase();

  if (normalized.startsWith("masculino") || normalized.startsWith("cab")) {
    return "masculino";
  }

  if (normalized.startsWith("femenino") || normalized.startsWith("dam")) {
    return "femenino";
  }

  return "";
}

function formatBranchLabel(value = "") {
  const normalizedSex = formatSex(value);

  if (normalizedSex === "Femenino") {
    return "Damas";
  }

  if (normalizedSex === "Mixto") {
    return "Mixta";
  }

  return "Caballeros";
}

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

function shouldIncludeLeague(data = {}) {
  const status = String(data.status || "active").trim().toLowerCase();

  return status !== "deleted" && status !== "archived";
}

function normalizeCount(value, fallback = 0) {
  const parsedValue = Number.parseInt(String(value ?? "").trim(), 10);

  return Number.isNaN(parsedValue) ? fallback : parsedValue;
}

function normalizeScoreValue(value, fallback = 0) {
  const parsedValue = Number.parseFloat(String(value ?? "").trim().replace(",", "."));

  return Number.isNaN(parsedValue) ? fallback : parsedValue;
}

function normalizeMoneyValue(value, fallback = 0) {
  const parsedValue = Number.parseFloat(String(value ?? "").trim().replace(",", "."));

  if (Number.isNaN(parsedValue) || parsedValue < 0) {
    return fallback;
  }

  return Math.round(parsedValue * 100) / 100;
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

function normalizeCategoryValue(value) {
  const option = LEAGUE_CATEGORY_OPTIONS.find((item) => item.value === value);

  if (option) {
    return option.value;
  }

  return "";
}

function normalizeSumTarget(value) {
  const option = LEAGUE_SUM_TARGET_OPTIONS.find((item) => item.value === String(value));

  return option ? option.value : "";
}

function normalizePlayerSide(value = "") {
  const normalized = String(value).trim().toLowerCase();

  if (normalized === "drive") {
    return "drive";
  }

  if (normalized === "reves" || normalized === "revés") {
    return "reves";
  }

  return "ambos";
}

function formatPlayerSideLabel(value = "") {
  const normalized = normalizePlayerSide(value);

  if (normalized === "drive") {
    return "Drive";
  }

  if (normalized === "reves") {
    return "Reves";
  }

  return "Ambos lados";
}

function uniqueBy(items = [], keyBuilder) {
  const seen = new Set();

  return items.filter((item) => {
    const key = keyBuilder(item);

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function rotateList(items = [], offset = 0) {
  if (!items.length) {
    return [];
  }

  const normalizedOffset = ((offset % items.length) + items.length) % items.length;
  return [...items.slice(normalizedOffset), ...items.slice(0, normalizedOffset)];
}

function createEmptyFixture() {
  return {
    generatedAtMillis: 0,
    rounds: [],
  };
}
function createEmptyRoundPayments() {
  return [];
}

export function getLeagueCategoryOption(value) {
  return LEAGUE_CATEGORY_OPTIONS.find((item) => item.value === value) || null;
}

export function getSumTargetOption(value) {
  return LEAGUE_SUM_TARGET_OPTIONS.find((item) => item.value === String(value)) || null;
}

export function buildFixedSumLabel(branch, sumTarget, sumRule, categoryA, categoryB) {
  const branchLabel = formatBranchLabel(branch);

  if (!sumTarget) {
    return "";
  }

  if (sumRule === "fixed") {
    const firstCategory = getLeagueCategoryOption(categoryA);
    const secondCategory = getLeagueCategoryOption(categoryB);

    if (!firstCategory || !secondCategory) {
      return `Suma ${sumTarget} ${branchLabel}`;
    }

    return `Suma ${sumTarget} ${branchLabel} · ${firstCategory.label} + ${secondCategory.label}`;
  }

  return `Suma ${sumTarget} ${branchLabel} · libre`;
}

export function buildLeagueCategoryLabel(branch, categoryFormat, sumTarget, sumRule, categoryA, categoryB) {
  if (categoryFormat === "suma") {
    return buildFixedSumLabel(branch, sumTarget, sumRule, categoryA, categoryB);
  }

  const selectedCategory = getLeagueCategoryOption(categoryA);

  if (!selectedCategory) {
    return `Categoria unica ${formatBranchLabel(branch)}`;
  }

  return `${selectedCategory.label} ${formatBranchLabel(branch)}`;
}

export function normalizeLeagueDefaults(defaults = {}) {
  const matchFormat =
    defaults.matchFormat === "single_set"
      ? "single_set"
      : defaults.matchFormat === "two_sets_super_tiebreak"
      ? "two_sets_super_tiebreak"
      : "three_full_sets";

  return {
    branch: formatSex(defaults.branch || defaults.sexo),
    teamType: defaults.teamType === "individual" ? "individual" : "pair",
    categoryFormat: defaults.categoryFormat === "suma" ? "suma" : "libre",
    sumTarget: normalizeSumTarget(defaults.sumTarget),
    sumRule: defaults.sumRule === "fixed" ? "fixed" : "open",
    fixedCategoryA: normalizeCategoryValue(defaults.fixedCategoryA),
    fixedCategoryB: normalizeCategoryValue(defaults.fixedCategoryB),
    matchFormat,
    singleSetPoints: normalizeCount(defaults.singleSetPoints, 6),
    singleSetWinByTwo: normalizeBoolean(defaults.singleSetWinByTwo, false),
    superTieBreakPoints: normalizeCount(defaults.superTieBreakPoints, 11),
    superTieBreakWinByTwo: normalizeBoolean(defaults.superTieBreakWinByTwo, false),
    allowWalkover: defaults.allowWalkover !== false,
    pointsWin: normalizeScoreValue(defaults.pointsWin, 3),
    pointsLoss: normalizeScoreValue(defaults.pointsLoss, 1),
    pointsWalkoverWin: normalizeScoreValue(defaults.pointsWalkoverWin, 3),
    replacementPenalty: normalizeScoreValue(defaults.replacementPenalty, 1),
    replacementPenaltyMode:
      defaults.replacementPenaltyMode === "pair" ? "pair" : "individual",
    replacementQuota: normalizeCount(defaults.replacementQuota, 0),
    publishReplacementRequests: defaults.publishReplacementRequests === true,
  };
}

function buildStandingsConfig(teamType) {
  if (teamType === "individual") {
    return {
      mode: "drive_reves",
      tables: ["Drive", "Reves"],
    };
  }

  return {
    mode: "pair",
    tables: ["Parejas"],
  };
}

function normalizeScoringSettings(scoringSettings, teamType) {
  if (!scoringSettings) {
    return {
      version: SCORING_SETTINGS_VERSION,
      allowWalkover: true,
      walkoverScore: DEFAULT_WALKOVER_SCORE,
      pointsWin: 3,
      pointsLoss: 1,
      pointsWalkoverWin: 3,
      replacementPenalty: 1,
      replacementPenaltyMode: "individual",
      replacementQuota: 0,
      publishReplacementRequests: false,
      standings: buildStandingsConfig(teamType),
    };
  }

  const version = normalizeCount(scoringSettings.version, SCORING_SETTINGS_VERSION);
  const storedPointsWin = normalizeScoreValue(scoringSettings.pointsWin, 3);
  const storedPointsLoss = normalizeScoreValue(scoringSettings.pointsLoss, 1);
  const pointsWin = Math.max(storedPointsWin, storedPointsLoss);
  const pointsLoss = Math.min(storedPointsWin, storedPointsLoss);

  return {
    ...scoringSettings,
    version: Math.max(version, SCORING_SETTINGS_VERSION),
    allowWalkover: scoringSettings.allowWalkover !== false,
    walkoverScore: Array.isArray(scoringSettings.walkoverScore)
      ? scoringSettings.walkoverScore
      : DEFAULT_WALKOVER_SCORE,
    pointsWin,
    pointsLoss,
    pointsWalkoverWin: normalizeScoreValue(scoringSettings.pointsWalkoverWin, pointsWin),
    replacementPenalty: normalizeScoreValue(scoringSettings.replacementPenalty, 1),
    replacementPenaltyMode:
      scoringSettings.replacementPenaltyMode === "pair" ? "pair" : "individual",
    replacementQuota: normalizeCount(scoringSettings.replacementQuota, 0),
    publishReplacementRequests: scoringSettings.publishReplacementRequests === true,
    standings: scoringSettings.standings || buildStandingsConfig(teamType),
  };
}

function normalizeScheduleConfig({
  matchDayMode,
  matchDay,
  matchTimeSlots,
  scheduleConfig,
} = {}) {
  const sourceConfig = scheduleConfig || {};
  const mode =
    (matchDayMode || sourceConfig.mode) === "weekly_coordination"
      ? "weekly_coordination"
      : "fixed_day";
  const dayKey = mode === "fixed_day" ? matchDay || sourceConfig.dayKey || "tuesday" : "";
  const timeSlotsSource = Array.isArray(matchTimeSlots)
    ? matchTimeSlots
    : Array.isArray(sourceConfig.timeSlots)
    ? sourceConfig.timeSlots
    : [];

  return {
    mode,
    dayKey,
    timeSlots: uniqueBy(
      timeSlotsSource
        .map((slot) => String(slot || "").trim())
        .filter(Boolean),
      (slot) => slot
    ),
  };
}

function normalizeFixtureConfig({
  fixtureRoundMode,
  fixtureDatesCount,
  fixtureMinPlayersCount,
  fixtureConfig,
} = {}) {
  const currentConfig = fixtureConfig || {};
  const roundModeSource = fixtureRoundMode || currentConfig.roundMode;

  return {
    roundMode: roundModeSource === "double" ? "double" : "single",
    roundsCount: normalizeCount(
      fixtureDatesCount ?? currentConfig.roundsCount,
      DEFAULT_FIXTURE_DATES_COUNT
    ),
    minPlayersCount: normalizeCount(
      fixtureMinPlayersCount ?? currentConfig.minPlayersCount,
      DEFAULT_MIN_PLAYERS_COUNT
    ),
    manualTeams: Array.isArray(currentConfig.manualTeams) ? currentConfig.manualTeams : [],
  };
}

function normalizePaymentConfig({
  registrationFeeEnabled,
  registrationFeeAmount,
  roundPricePerPlayer,
  paymentConfig,
  organizerMercadoPagoConfig,
} = {}) {
  const currentConfig = paymentConfig || {};
  const hasRegistrationFee =
    registrationFeeEnabled === true ||
    registrationFeeEnabled === "true" ||
    currentConfig.registrationFeeEnabled === true;

  return {
    currency: currentConfig.currency || "ARS",
    registrationFeeEnabled: hasRegistrationFee,
    registrationFeeAmount: hasRegistrationFee
      ? normalizeMoneyValue(registrationFeeAmount ?? currentConfig.registrationFeeAmount, 0)
      : 0,
    roundPricePerPlayer: normalizeMoneyValue(
      roundPricePerPlayer ?? currentConfig.roundPricePerPlayer,
      0
    ),
    mercadoPago: {
      ...buildPublicationMercadoPagoConfig(organizerMercadoPagoConfig),
      ...(currentConfig.mercadoPago && typeof currentConfig.mercadoPago === "object"
        ? currentConfig.mercadoPago
        : {}),
      enabled:
        currentConfig?.mercadoPago?.enabled === true ||
        buildPublicationMercadoPagoConfig(organizerMercadoPagoConfig).enabled,
    },
  };
}

function normalizePlayerEntry(player = {}) {
  return {
    id: player.id || player.linkedUserId || `player-${Date.now()}-${Math.random()}`,
    type: player.type || (player.linkedUserId ? "registered" : "guest"),
    linkedUserId: player.linkedUserId || "",
    nombre: player.nombre || "Jugador",
    apellido: player.apellido || player.lastName || "",
    telefono: player.telefono || player.celular || player.phone || player.whatsapp || "",
    categoria: player.categoria || "",
    sexo: player.sexo || "",
    ciudad: player.ciudad || "",
    provincia: player.provincia || "",
    foto: player.foto || player.avatarUrl || player.fotoURL || "",
    ladoJuego: normalizePlayerSide(player.ladoJuego),
    ladoPreferido: player.ladoPreferido || formatPlayerSideLabel(player.ladoJuego),
    pairNumber: normalizeCount(player.pairNumber, 0),
  };
}

function normalizeTeam(team = {}, fallbackIndex = 0) {
  const players = Array.isArray(team.players) ? team.players.map(normalizePlayerEntry) : [];

  return {
    id: team.id || `team-${fallbackIndex + 1}`,
    label:
      team.label ||
      players.map((player) => player.nombre).join(" / ") ||
      `Pareja ${fallbackIndex + 1}`,
    players,
  };
}

function normalizeReplacementPerson(player = {}) {
  return {
    id: player.id || "",
    type: player.type || (player.linkedUserId ? "registered" : "guest"),
    linkedUserId: player.linkedUserId || "",
    nombre: player.nombre || player.name || "Jugador",
    apellido: player.apellido || player.lastName || "",
    categoria: player.categoria || "",
    sexo: player.sexo || "",
  };
}

function normalizeReplacementCandidate(candidate = {}) {
  return {
    id: candidate.id || "",
    linkedUserId: candidate.linkedUserId || candidate.id || "",
    nombre: candidate.nombre || candidate.name || "Jugador",
    apellido: candidate.apellido || candidate.lastName || "",
    categoria: candidate.categoria || "",
    sexo: candidate.sexo || "",
    phone: candidate.phone || candidate.telefono || "",
    avatarUrl: candidate.avatarUrl || candidate.foto || "",
    requestedAtMillis: normalizeCount(candidate.requestedAtMillis, 0),
  };
}

function normalizeMatchReplacements(replacements = {}) {
  if (!replacements || typeof replacements !== "object" || Array.isArray(replacements)) {
    return {};
  }

  return Object.entries(replacements).reduce((normalizedReplacements, [key, replacement]) => {
    if (!key || !replacement?.requested) {
      return normalizedReplacements;
    }

    normalizedReplacements[key] = {
      requested: true,
      titular: normalizeReplacementPerson(replacement.titular || {}),
      replacement:
        replacement.replacement &&
        [
          replacement.replacement.id,
          replacement.replacement.linkedUserId,
          replacement.replacement.nombre,
          replacement.replacement.name,
        ].some((value) => String(value || "").trim().length > 0)
          ? normalizeReplacementPerson(replacement.replacement)
          : null,
      requestedBy: replacement.requestedBy || "",
      requestedByName: replacement.requestedByName || "",
      requestedAtMillis: normalizeCount(replacement.requestedAtMillis, 0),
      penaltySnapshot:
        replacement.penaltySnapshot === undefined ? null : replacement.penaltySnapshot,
      penaltyModeSnapshot: replacement.penaltyModeSnapshot || "",
      quotaSnapshot: replacement.quotaSnapshot === undefined ? null : replacement.quotaSnapshot,
      candidates: Array.isArray(replacement.candidates)
        ? replacement.candidates.map(normalizeReplacementCandidate).filter((candidate) => candidate.id)
        : [],
      rejectedCandidates: Array.isArray(replacement.rejectedCandidates)
        ? replacement.rejectedCandidates
            .map(normalizeReplacementCandidate)
            .filter((candidate) => candidate.id)
        : [],
    };

    return normalizedReplacements;
  }, {});
}

function normalizeMatch(match = {}, fallbackIndex = 0) {
  return {
    id: match.id || `match-${fallbackIndex + 1}`,
    order: normalizeCount(match.order, fallbackIndex + 1),
    timeSlot: match.timeSlot || "",
    scheduledAtMillis: normalizeCount(match.scheduledAtMillis, 0),
    completedAtMillis: normalizeCount(match.completedAtMillis, 0),
    suspendedAtMillis: normalizeCount(match.suspendedAtMillis, 0),
    suspensionReason: match.suspensionReason || "",
    suspensionMode: match.suspensionMode || "",
    rescheduledDateMillis: normalizeCount(match.rescheduledDateMillis, 0),
    teamA: normalizeTeam(match.teamA, fallbackIndex * 2),
    teamB: normalizeTeam(match.teamB, fallbackIndex * 2 + 1),
    result: {
      winner: match?.result?.winner || "",
      score: match?.result?.score || "",
      reason: match?.result?.reason || "",
      sets: Array.isArray(match?.result?.sets)
        ? match.result.sets.map((set) => ({
            own: String(set?.own ?? ""),
            rival: String(set?.rival ?? ""),
          }))
        : [],
    },
    replacements: normalizeMatchReplacements(match.replacements),
  };
}

function normalizeRound(round = {}, fallbackIndex = 0) {
  return {
    id: round.id || `round-${fallbackIndex + 1}`,
    number: normalizeCount(round.number, fallbackIndex + 1),
    title: round.title || `Fecha ${fallbackIndex + 1}`,
    scheduleLabel: round.scheduleLabel || "",
    scheduledDateMillis: normalizeCount(round.scheduledDateMillis, 0),
    suspendedAtMillis: normalizeCount(round.suspendedAtMillis, 0),
    suspensionReason: round.suspensionReason || "",
    suspensionMode: round.suspensionMode || "",
    rescheduledDateMillis: normalizeCount(round.rescheduledDateMillis, 0),
    completedAtMillis: normalizeCount(round.completedAtMillis, 0),
    byeLabels: Array.isArray(round.byeLabels) ? round.byeLabels.filter(Boolean) : [],
    matches: Array.isArray(round.matches)
      ? round.matches.map((match, index) => normalizeMatch(match, index))
      : [],
  };
}

function normalizeFixture(fixture = {}) {
  return {
    generatedAtMillis: normalizeCount(fixture.generatedAtMillis, 0),
    rounds: Array.isArray(fixture.rounds)
      ? fixture.rounds.map((round, index) => normalizeRound(round, index))
      : [],
  };
}

function normalizeRoundPayments(roundPayments = []) {
  if (!Array.isArray(roundPayments)) {
    return [];
  }

  return roundPayments.map((roundPayment) => ({
    roundId: roundPayment?.roundId || "",
    entries: Array.isArray(roundPayment?.entries)
      ? roundPayment.entries.map((entry) => ({
          participantId: entry?.participantId || "",
          participantType: entry?.participantType || "player",
          participantLabel: entry?.participantLabel || "Jugador",
          pairId: entry?.pairId || "",
          pairLabel: entry?.pairLabel || "",
          playerIds: Array.isArray(entry?.playerIds) ? entry.playerIds.filter(Boolean) : [],
          paymentStatus: entry?.paymentStatus || "pendiente",
          paymentMethod: entry?.paymentMethod || "",
          proofUrl: entry?.proofUrl || "",
          proofFileName: entry?.proofFileName || "",
          proofUploadedAtMillis: normalizeCount(entry?.proofUploadedAtMillis, 0),
          proofUploadedBy: entry?.proofUploadedBy || "",
          proofUploadedByName: entry?.proofUploadedByName || "",
          confirmedAtMillis: normalizeCount(entry?.confirmedAtMillis, 0),
          confirmedBy: entry?.confirmedBy || "",
          confirmedByName: entry?.confirmedByName || "",
          rejectedAtMillis: normalizeCount(entry?.rejectedAtMillis, 0),
          rejectedBy: entry?.rejectedBy || "",
          rejectedByName: entry?.rejectedByName || "",
          reminder4hSentAtMillis: normalizeCount(entry?.reminder4hSentAtMillis, 0),
          reminder4hSentBy: entry?.reminder4hSentBy || "",
          reminder4hSentByName: entry?.reminder4hSentByName || "",
          reminder24hSentAtMillis: normalizeCount(entry?.reminder24hSentAtMillis, 0),
          reminder24hSentBy: entry?.reminder24hSentBy || "",
          reminder24hSentByName: entry?.reminder24hSentByName || "",
          updatedAtMillis: normalizeCount(entry?.updatedAtMillis, 0),
          updatedBy: entry?.updatedBy || "",
          updatedByName: entry?.updatedByName || "",
        }))
      : [],
  }));
}

export function buildLeaguePayload({
  organizer,
  name,
  complex,
  baseLocation,
  matchDayMode,
  matchDay,
  matchTimeSlots,
  fixtureRoundMode,
  fixtureDatesCount,
  fixtureMinPlayersCount,
  registrationFeeEnabled,
  registrationFeeAmount,
  roundPricePerPlayer,
  branch,
  teamType,
  categoryFormat,
  sumTarget,
  sumRule,
  fixedCategoryA,
  fixedCategoryB,
  matchFormat,
  singleSetPoints,
  singleSetWinByTwo,
  superTieBreakPoints,
  superTieBreakWinByTwo,
  allowWalkover,
  pointsWin,
  pointsLoss,
  pointsWalkoverWin,
  replacementPenalty,
  replacementPenaltyMode,
  replacementQuota,
  publishReplacementRequests,
}) {
  const normalizedDefaults = normalizeLeagueDefaults({
    branch,
    teamType,
    categoryFormat,
    sumTarget,
    sumRule,
    fixedCategoryA,
    fixedCategoryB,
    matchFormat,
    singleSetPoints,
    singleSetWinByTwo,
    superTieBreakPoints,
    superTieBreakWinByTwo,
    allowWalkover,
    pointsWin,
    pointsLoss,
    pointsWalkoverWin,
    replacementPenalty,
    replacementPenaltyMode,
    replacementQuota,
    publishReplacementRequests,
  });
  const localidad = baseLocation || organizer?.localidad || {
    nombre: organizer?.city || "",
    provincia: organizer?.province || "",
    pais: organizer?.country || "Argentina",
  };
  const categoryLabel = buildLeagueCategoryLabel(
    normalizedDefaults.branch,
    normalizedDefaults.categoryFormat,
    normalizedDefaults.sumTarget,
    normalizedDefaults.sumRule,
    normalizedDefaults.fixedCategoryA,
    normalizedDefaults.fixedCategoryB
  );
  const scheduleConfig = normalizeScheduleConfig({
    matchDayMode,
    matchDay,
    matchTimeSlots,
  });
  const fixtureConfig = normalizeFixtureConfig({
    fixtureRoundMode,
    fixtureDatesCount,
    fixtureMinPlayersCount,
  });
  const paymentConfig = normalizePaymentConfig({
    registrationFeeEnabled,
    registrationFeeAmount,
    roundPricePerPlayer,
    paymentConfig,
    organizerMercadoPagoConfig: organizer?.mercadoPagoConfig,
  });

  return {
    nombre: String(name || "").trim(),
    organizerId: organizer?.uid || "",
    organizerName: organizer?.name || "Organizador",
    sexo: normalizedDefaults.branch,
    teamType: normalizedDefaults.teamType,
    modalidadCategoria: normalizedDefaults.categoryFormat,
    sumTarget: normalizedDefaults.sumTarget,
    sumRule: normalizedDefaults.sumRule,
    categoria: categoryLabel,
    categoriaA: normalizedDefaults.fixedCategoryA || "",
    categoriaB: normalizedDefaults.fixedCategoryB || "",
    sumaLabel: categoryLabel,
    matchFormat: normalizedDefaults.matchFormat,
    scheduleConfig,
    fixtureConfig,
    paymentConfig,
    fixture: createEmptyFixture(),
    players: [],
    roundPayments: createEmptyRoundPayments(),
    tieBreakMode:
      normalizedDefaults.matchFormat === "two_sets_super_tiebreak"
        ? "super_tiebreak"
        : "third_full_set",
    singleSetSettings: {
      pointsToWin: normalizedDefaults.singleSetPoints,
      winByTwo: normalizedDefaults.singleSetWinByTwo,
    },
    superTieBreakSettings: {
      pointsToWin: normalizedDefaults.superTieBreakPoints,
      winByTwo: normalizedDefaults.superTieBreakWinByTwo,
    },
    scoringSettings: {
      version: SCORING_SETTINGS_VERSION,
      allowWalkover: normalizedDefaults.allowWalkover !== false,
      walkoverScore: DEFAULT_WALKOVER_SCORE,
      pointsWin: normalizedDefaults.pointsWin,
      pointsLoss: normalizedDefaults.pointsLoss,
      pointsWalkoverWin: normalizedDefaults.pointsWalkoverWin,
      replacementPenalty: normalizedDefaults.replacementPenalty,
      replacementPenaltyMode: normalizedDefaults.replacementPenaltyMode,
      replacementQuota: normalizedDefaults.replacementQuota,
      publishReplacementRequests: normalizedDefaults.publishReplacementRequests,
      standings: buildStandingsConfig(normalizedDefaults.teamType),
    },
    complejo: {
      nombre: complex?.nombre || "Complejo sin definir",
      direccion: complex?.direccion || "",
      coordinates: complex?.coordinates || complex?.location || null,
      organizerLogoUrl:
        complex?.organizerLogoUrl || complex?.organizerLogoURL || organizer?.organizerLogoUrl || "",
    },
    complejoNombre: complex?.nombre || "Complejo sin definir",
    organizerLogoUrl: organizer?.organizerLogoUrl || "",
    localidad: {
      nombre: localidad?.nombre || "",
      provincia: localidad?.provincia || "",
      pais: localidad?.pais || "Argentina",
    },
    provincia: localidad?.provincia || "",
    status: "active",
    createdBy: organizer?.uid || "",
    createdByName: organizer?.name || "Organizador",
    createdAt: serverTimestamp(),
  };
}

export function resolveWalkoverResult(teamWithWalkover = "teamA") {
  if (teamWithWalkover === "teamB") {
    return {
      winner: "teamA",
      loser: "teamB",
      reason: "walkover",
      sets: DEFAULT_WALKOVER_SCORE,
    };
  }

  return {
    winner: "teamB",
    loser: "teamA",
    reason: "walkover",
    sets: DEFAULT_WALKOVER_SCORE.map((set) => ({
      own: set.rival,
      rival: set.own,
    })),
  };
}

export async function createLeague(organizer, payload) {
  const leaguePayload = buildLeaguePayload({
    organizer,
    ...payload,
  });
  const createdRef = await addDoc(collection(db, "leagues"), leaguePayload);

  return {
    id: createdRef.id,
    ...leaguePayload,
  };
}

export async function updateLeague(leagueId, organizer, payload, currentLeague = null) {
  if (!leagueId) {
    throw new Error("No encontramos la liga que queres editar.");
  }

  const current = currentLeague || (await getLeagueById(leagueId));
  const nextPayload = buildLeaguePayload({
    organizer,
    ...payload,
  });

  await updateDoc(doc(db, "leagues", leagueId), {
    nombre: nextPayload.nombre,
    sexo: nextPayload.sexo,
    teamType: nextPayload.teamType,
    modalidadCategoria: nextPayload.modalidadCategoria,
    sumTarget: nextPayload.sumTarget,
    sumRule: nextPayload.sumRule,
    categoria: nextPayload.categoria,
    categoriaA: nextPayload.categoriaA,
    categoriaB: nextPayload.categoriaB,
    sumaLabel: nextPayload.sumaLabel,
    matchFormat: nextPayload.matchFormat,
    tieBreakMode: nextPayload.tieBreakMode,
    singleSetSettings: nextPayload.singleSetSettings,
    superTieBreakSettings: nextPayload.superTieBreakSettings,
    scoringSettings: nextPayload.scoringSettings,
    complejo: nextPayload.complejo,
    complejoNombre: nextPayload.complejoNombre,
    localidad: nextPayload.localidad,
    provincia: nextPayload.provincia,
    scheduleConfig: nextPayload.scheduleConfig,
    fixtureConfig: {
      ...nextPayload.fixtureConfig,
      manualTeams: Array.isArray(current?.fixtureConfig?.manualTeams)
        ? current.fixtureConfig.manualTeams
        : [],
    },
    paymentConfig: nextPayload.paymentConfig,
    updatedAt: serverTimestamp(),
    updatedBy: organizer?.uid || "",
    updatedByName: organizer?.name || "Organizador",
  });
}

export async function archiveLeague(leagueId) {
  if (!leagueId) {
    throw new Error("No encontramos la liga que queres eliminar.");
  }

  await updateDoc(doc(db, "leagues", leagueId), {
    status: "archived",
    archivedAt: serverTimestamp(),
  });
}

export function mapLeagueDoc(docSnapshot) {
  const data = docSnapshot.data() || {};
  const localidad = data.localidad || {};
  const complejo = data.complejo || {};
  const sumLabel = data.sumaLabel || data.sumLabel || "";
  const scheduleConfig = normalizeScheduleConfig({ scheduleConfig: data.scheduleConfig || {} });
  const fixtureConfig = normalizeFixtureConfig({ fixtureConfig: data.fixtureConfig || {} });
  const teamType = data.teamType || "pair";

  return {
    id: docSnapshot.id,
    nombre: data.nombre || data.name || "Liga sin nombre",
    complejo: {
      nombre:
        complejo.nombre ||
        data.complejoNombre ||
        data.complexName ||
        "Complejo sin definir",
      direccion: complejo.direccion || "",
      coordinates: complejo.coordinates || complejo.location || data.coordinates || null,
      organizerLogoUrl:
        complejo.organizerLogoUrl ||
        complejo.organizerLogoURL ||
        data.organizerLogoUrl ||
        data.organizerLogoURL ||
        "",
    },
    complejoNombre:
      complejo.nombre ||
      data.complejoNombre ||
      data.complexName ||
      "Complejo sin definir",
    organizerLogoUrl:
      data.organizerLogoUrl ||
      data.organizerLogoURL ||
      complejo.organizerLogoUrl ||
      complejo.organizerLogoURL ||
      "",
    localidad: localidad.nombre || data.ciudad || data.city || "",
    provincia: localidad.provincia || data.provincia || data.province || "",
    sexo: formatSex(data.sexo || data.sex),
    categoria: sumLabel || data.categoria || data.category || "Libre",
    teamType,
    modalidadCategoria: data.modalidadCategoria || "libre",
    sumTarget: data.sumTarget || "",
    sumRule: data.sumRule || "open",
    categoriaA: data.categoriaA || "",
    categoriaB: data.categoriaB || "",
    sumaLabel: sumLabel,
    matchFormat: data.matchFormat || "three_full_sets",
    tieBreakMode: data.tieBreakMode || "third_full_set",
    scheduleConfig,
    fixtureConfig: {
      ...fixtureConfig,
      manualTeams: Array.isArray(data?.fixtureConfig?.manualTeams)
        ? data.fixtureConfig.manualTeams.map((team, index) => normalizeTeam(team, index))
        : [],
    },
    players: Array.isArray(data.players) ? data.players.map(normalizePlayerEntry) : [],
    fixture: normalizeFixture(data.fixture || {}),
    roundPayments: normalizeRoundPayments(data.roundPayments),
    singleSetSettings: {
      pointsToWin: normalizeCount(data?.singleSetSettings?.pointsToWin, 6),
      winByTwo: normalizeBoolean(data?.singleSetSettings?.winByTwo, false),
    },
    superTieBreakSettings: {
      pointsToWin: normalizeCount(data?.superTieBreakSettings?.pointsToWin, 11),
      winByTwo: normalizeBoolean(data?.superTieBreakSettings?.winByTwo, false),
    },
    scoringSettings: normalizeScoringSettings(data.scoringSettings, teamType),
    organizerId: data.organizerId || data.createdBy || "",
    organizerName: data.organizerName || data.createdByName || "",
    createdAt: data.createdAt || null,
    createdAtMillis: resolveTimestampMillis(data.createdAt),
    updatedAtMillis: resolveTimestampMillis(data.updatedAt),
    esMiLiga: false,
    status: data.status || "active",
  };
}

export async function getLeagueById(leagueId) {
  if (!leagueId) {
    throw new Error("No encontramos la liga solicitada.");
  }

  const snapshot = await getDoc(doc(db, "leagues", leagueId));

  if (!snapshot.exists()) {
    throw new Error("La liga ya no esta disponible.");
  }

  return mapLeagueDoc(snapshot);
}

export async function listLeagues() {
  const snapshot = await getDocs(collection(db, "leagues"));

  return snapshot.docs
    .filter((docSnapshot) => docSnapshot.exists() && shouldIncludeLeague(docSnapshot.data()))
    .map(mapLeagueDoc)
    .sort((first, second) => second.createdAtMillis - first.createdAtMillis);
}

export function getLeagueComplexOptions(leagues = [], selectedLocations = []) {
  const normalizedSelectedCities = Array.isArray(selectedLocations)
    ? selectedLocations
        .map((location) => String(location?.nombre || "").trim().toLowerCase())
        .filter(Boolean)
    : [];

  const filteredLeagues = normalizedSelectedCities.length
    ? leagues.filter((league) =>
        normalizedSelectedCities.includes(
          String(league?.localidad || "")
            .trim()
            .toLowerCase()
        )
      )
    : leagues;

  return [...new Set(filteredLeagues.map((league) => league.complejoNombre).filter(Boolean))]
    .sort((first, second) => first.localeCompare(second, "es"))
    .map((name) => ({
      label: name,
      value: name,
    }));
}

export function canManageLeague(league = {}, userData = {}) {
  const currentUserId = userData?.uid || userData?.id || "";
  const currentEmail = userData?.email || "";

  return Boolean(
    currentUserId &&
      (league?.organizerId === currentUserId ||
        league?.createdBy === currentUserId ||
        canAccessAdminPanel(userData))
  );
}

export function isLeagueParticipant(league = {}, userData = {}) {
  const currentUserId = String(userData?.uid || userData?.id || "").trim().toLowerCase();

  if (!currentUserId) {
    return false;
  }

  return (Array.isArray(league?.players) ? league.players : []).some((player) =>
    [player?.linkedUserId, player?.id]
      .filter(Boolean)
      .some((playerId) => String(playerId).trim().toLowerCase() === currentUserId)
  );
}

export async function updateLeaguePlayers(leagueId, players = []) {
  if (!leagueId) {
    throw new Error("No encontramos la liga para actualizar sus jugadores.");
  }

  await updateDoc(doc(db, "leagues", leagueId), {
    players: players.map(normalizePlayerEntry),
    updatedAt: serverTimestamp(),
  });
}

function buildScheduleLabel(scheduleConfig = {}) {
  const timeSlots = Array.isArray(scheduleConfig.timeSlots) ? scheduleConfig.timeSlots.filter(Boolean) : [];
  const timeLabel = timeSlots.join(" / ");

  if (scheduleConfig.mode === "weekly_coordination") {
    return timeLabel ? `A coordinar · ${timeLabel}` : "A coordinar";
  }

  const dayLabel = DAY_LABELS[scheduleConfig.dayKey] || "Dia a definir";
  return timeLabel ? `${dayLabel} ${timeLabel}` : dayLabel;
}

function buildPlayerKey(player = {}) {
  return player.linkedUserId || player.id || player.nombre || "";
}

function buildTeamLabelFromPlayers(players = []) {
  return formatTeamShortLabel(players);
}

function buildTeamKey(team = {}) {
  if (team.id) {
    return team.id;
  }

  const playerKey = buildTeamPlayersKey(team.players || []);
  return playerKey || team.label || "";
}

function buildTeamPlayersKey(players = []) {
  return players.map(buildPlayerKey).filter(Boolean).sort().join("|");
}

function buildPairStandingsKey(team = {}) {
  const pairNumbers = (team.players || [])
    .map((player) => normalizeCount(player?.pairNumber, 0))
    .filter((pairNumber) => pairNumber > 0);
  const firstPairNumber = pairNumbers[0] || 0;
  const allPlayersSharePairNumber =
    pairNumbers.length > 0 && pairNumbers.every((pairNumber) => pairNumber === firstPairNumber);

  if (allPlayersSharePairNumber) {
    return `pair-number-${firstPairNumber}`;
  }

  const playerKey = buildTeamPlayersKey(team.players || []);
  return playerKey || buildTeamKey(team);
}

function splitIndividualPlayers(players = []) {
  const drivePlayers = [];
  const revesPlayers = [];
  const ambosPlayers = [];

  players.forEach((player) => {
    const normalizedPlayer = normalizePlayerEntry(player);

    if (normalizedPlayer.ladoJuego === "drive") {
      drivePlayers.push(normalizedPlayer);
      return;
    }

    if (normalizedPlayer.ladoJuego === "reves") {
      revesPlayers.push(normalizedPlayer);
      return;
    }

    ambosPlayers.push(normalizedPlayer);
  });

  ambosPlayers.forEach((player) => {
    if (drivePlayers.length <= revesPlayers.length) {
      drivePlayers.push({ ...player, ladoJuego: "drive", ladoPreferido: "Drive" });
    } else {
      revesPlayers.push({ ...player, ladoJuego: "reves", ladoPreferido: "Reves" });
    }
  });

  return { drivePlayers, revesPlayers };
}

function buildPairTeams(league = {}) {
  const manualTeams = Array.isArray(league?.fixtureConfig?.manualTeams)
    ? league.fixtureConfig.manualTeams.map((team, index) => normalizeTeam(team, index))
    : [];
  const players = Array.isArray(league?.players) ? league.players.map(normalizePlayerEntry) : [];
  const groupedPlayers = players.reduce((groups, player) => {
    const pairNumber = normalizeCount(player.pairNumber, 0);

    if (pairNumber > 0) {
      groups[pairNumber] = [...(groups[pairNumber] || []), player];
    }

    return groups;
  }, {});
  const groupedTeams = Object.entries(groupedPlayers)
    .sort(([first], [second]) => Number(first) - Number(second))
    .filter(([, teamPlayers]) => teamPlayers.length >= 2)
    .map(([pairNumber, teamPlayers]) => ({
      id: `pair-team-${pairNumber}`,
      label: buildTeamLabelFromPlayers(teamPlayers.slice(0, 2)),
      players: teamPlayers.slice(0, 2),
    }));

  if (Object.keys(groupedPlayers).length > 0) {
    return groupedTeams;
  }

  if (manualTeams.length) {
    return manualTeams;
  }

  const teams = [];

  for (let index = 0; index + 1 < players.length; index += 2) {
    const teamPlayers = [players[index], players[index + 1]];
    teams.push({
      id: `pair-team-${teams.length + 1}`,
      label: buildTeamLabelFromPlayers(teamPlayers),
      players: teamPlayers,
    });
  }

  return teams;
}

function buildRoundRobinRounds(teams = []) {
  if (!teams.length) {
    return [];
  }

  const byeTeam = { id: "__bye__", label: "Libre", players: [] };
  const rotation = teams.length % 2 === 0 ? [...teams] : [...teams, byeTeam];
  const rounds = [];

  for (let roundIndex = 0; roundIndex < rotation.length - 1; roundIndex += 1) {
    const matches = [];
    const byeLabels = [];

    for (let index = 0; index < rotation.length / 2; index += 1) {
      const teamA = rotation[index];
      const teamB = rotation[rotation.length - 1 - index];

      if (teamA.id === "__bye__" || teamB.id === "__bye__") {
        const teamWithBye = teamA.id === "__bye__" ? teamB : teamA;
        byeLabels.push(teamWithBye.label);
        continue;
      }

      matches.push({ teamA, teamB });
    }

    rounds.push({ matches, byeLabels });

    const fixed = rotation[0];
    const rotating = rotation.slice(1);
    rotating.unshift(rotating.pop());
    rotation.splice(0, rotation.length, fixed, ...rotating);
  }

  return rounds;
}

function createRoundMatch(match, roundIndex, matchIndex, timeSlot = "") {
  return {
    id: `round-${roundIndex + 1}-match-${matchIndex + 1}`,
    order: matchIndex + 1,
    timeSlot,
    teamA: normalizeTeam(match.teamA, matchIndex * 2),
    teamB: normalizeTeam(match.teamB, matchIndex * 2 + 1),
    result: {
      winner: "",
      score: "",
      reason: "",
      sets: [],
    },
  };
}

function generatePairLeagueFixture(league = {}) {
  const teams = buildPairTeams(league);
  const roundsCount = normalizeCount(league?.fixtureConfig?.roundsCount, DEFAULT_FIXTURE_DATES_COUNT);
  const scheduleConfig = league?.scheduleConfig || {};
  const baseRounds = buildRoundRobinRounds(teams);
  const timeSlots = Array.isArray(scheduleConfig.timeSlots) ? scheduleConfig.timeSlots : [];

  return {
    generatedAtMillis: Date.now(),
    rounds: Array.from({ length: roundsCount }, (_, roundIndex) => {
      const roundBase = baseRounds[roundIndex % Math.max(baseRounds.length, 1)] || {
        matches: [],
        byeLabels: [],
      };

      return {
        id: `round-${roundIndex + 1}`,
        number: roundIndex + 1,
        title: `Fecha ${roundIndex + 1}`,
        scheduleLabel: buildScheduleLabel(scheduleConfig),
        completedAtMillis: 0,
        byeLabels: roundBase.byeLabels,
        matches: roundBase.matches.map((match, matchIndex) =>
          createRoundMatch(
            match,
            roundIndex,
            matchIndex,
            timeSlots.length ? timeSlots[matchIndex % timeSlots.length] : ""
          )
        ),
      };
    }),
  };
}

function generateIndividualLeagueFixture(league = {}) {
  const players = Array.isArray(league?.players) ? league.players.map(normalizePlayerEntry) : [];
  const { drivePlayers, revesPlayers } = splitIndividualPlayers(players);
  const pairsCount = Math.min(drivePlayers.length, revesPlayers.length);
  const roundsCount = normalizeCount(league?.fixtureConfig?.roundsCount, DEFAULT_FIXTURE_DATES_COUNT);
  const scheduleConfig = league?.scheduleConfig || {};
  const timeSlots = Array.isArray(scheduleConfig.timeSlots) ? scheduleConfig.timeSlots : [];

  return {
    generatedAtMillis: Date.now(),
    rounds: Array.from({ length: roundsCount }, (_, roundIndex) => {
      const rotatedReves = rotateList(revesPlayers, roundIndex);
      const teams = Array.from({ length: pairsCount }, (_, pairIndex) => {
        const teamPlayers = [drivePlayers[pairIndex], rotatedReves[pairIndex]];
        return {
          id: `round-${roundIndex + 1}-team-${pairIndex + 1}`,
          label: buildTeamLabelFromPlayers(teamPlayers),
          players: teamPlayers,
        };
      });
      const rotatedTeams = rotateList(teams, roundIndex);
      const matches = [];
      const byeLabels = [];

      for (let index = 0; index < rotatedTeams.length; index += 2) {
        const teamA = rotatedTeams[index];
        const teamB = rotatedTeams[index + 1];

        if (!teamB) {
          byeLabels.push(teamA.label);
          continue;
        }

        matches.push(
          createRoundMatch(
            { teamA, teamB },
            roundIndex,
            matches.length,
            timeSlots.length ? timeSlots[matches.length % timeSlots.length] : ""
          )
        );
      }

      return {
        id: `round-${roundIndex + 1}`,
        number: roundIndex + 1,
        title: `Fecha ${roundIndex + 1}`,
        scheduleLabel: buildScheduleLabel(scheduleConfig),
        completedAtMillis: 0,
        byeLabels,
        matches,
      };
    }),
  };
}

function countSetsWon(sets = [], side = "own", includeSuperTieBreak = true) {
  return sets.reduce((total, set, index) => {
    if (!includeSuperTieBreak && index === 2) {
      return total;
    }

    const ownValue = Number.parseInt(String(set?.own ?? "").trim(), 10);
    const rivalValue = Number.parseInt(String(set?.rival ?? "").trim(), 10);

    if (Number.isNaN(ownValue) || Number.isNaN(rivalValue) || ownValue === rivalValue) {
      return total;
    }

    if (side === "own") {
      return ownValue > rivalValue ? total + 1 : total;
    }

    return rivalValue > ownValue ? total + 1 : total;
  }, 0);
}

function countGames(sets = [], side = "own", includeSuperTieBreak = false) {
  return sets.reduce((total, set, index) => {
    if (!includeSuperTieBreak && index === 2) {
      return total;
    }

    const ownValue = Number.parseInt(String(set?.own ?? "").trim(), 10);
    const rivalValue = Number.parseInt(String(set?.rival ?? "").trim(), 10);

    if (Number.isNaN(ownValue) || Number.isNaN(rivalValue)) {
      return total;
    }

    return total + (side === "own" ? ownValue : rivalValue);
  }, 0);
}

function createStandingsRow(id, name) {
  return {
    id,
    name,
    played: 0,
    won: 0,
    lost: 0,
    setsFor: 0,
    setsAgainst: 0,
    setDiff: 0,
    gamesFor: 0,
    gamesAgainst: 0,
    gameDiff: 0,
    points: 0,
    replacements: 0,
  };
}

function applyResultToRow(row, isWinner, setsWon, setsLost, gamesFor, gamesAgainst, pointsToAdd) {
  row.played += 1;
  row.won += isWinner ? 1 : 0;
  row.lost += isWinner ? 0 : 1;
  row.setsFor += setsWon;
  row.setsAgainst += setsLost;
  row.setDiff = row.setsFor - row.setsAgainst;
  row.gamesFor += gamesFor;
  row.gamesAgainst += gamesAgainst;
  row.gameDiff = row.gamesFor - row.gamesAgainst;
  row.points += pointsToAdd;
}

function sortStandingsRows(rows = []) {
  return [...rows].sort((first, second) => {
    if (second.points !== first.points) return second.points - first.points;
    if (second.setDiff !== first.setDiff) return second.setDiff - first.setDiff;
    if (second.setsFor !== first.setsFor) return second.setsFor - first.setsFor;
    if (second.gameDiff !== first.gameDiff) return second.gameDiff - first.gameDiff;
    return String(first.name).localeCompare(String(second.name), "es");
  });
}

function getMatchReplacementEntries(match = {}) {
  return Object.entries(match.replacements || {}).map(([key, value]) => ({
    key,
    ...(value || {}),
  }));
}

function getAssignedReplacementEntriesForTeam(match = {}, teamKey = "") {
  return getMatchReplacementEntries(match).filter(
    (entry) => entry.key.startsWith(`${teamKey}:`) && entry.requested && entry.replacement
  );
}

function shouldApplyReplacementPenalty(counterMap, counterKey, replacementQuota) {
  if (!counterKey) {
    return false;
  }

  const nextCount = (counterMap.get(counterKey) || 0) + 1;
  counterMap.set(counterKey, nextCount);

  return nextCount > replacementQuota;
}

function applyReplacementPenaltyToRow(row, counterMap, counterKey, replacementQuota, replacementPenalty) {
  if (!row) {
    return;
  }

  row.replacements += 1;

  if (replacementPenalty <= 0) {
    return;
  }

  if (shouldApplyReplacementPenalty(counterMap, counterKey, replacementQuota)) {
    row.points -= replacementPenalty;
  }
}

function resolveReplacementPenalty(entry = {}, fallbackPenalty = 0) {
  const snapshotPenalty =
    entry.penaltySnapshot === null || entry.penaltySnapshot === undefined
      ? fallbackPenalty
      : entry.penaltySnapshot;

  return normalizeScoreValue(snapshotPenalty, fallbackPenalty);
}

function findIndividualRowByPlayerKey(driveRowsMap, revesRowsMap, playerKey) {
  return driveRowsMap.get(playerKey) || revesRowsMap.get(playerKey) || null;
}

function getPaymentParticipantId(teamType, participant) {
  return teamType === "pair" ? buildTeamKey(participant) : buildPlayerKey(participant);
}

function getPaymentParticipantLabel(teamType, participant) {
  if (teamType === "pair") {
    return participant.label || buildTeamLabelFromPlayers(participant.players || []);
  }

  return participant.nombre || "Jugador";
}

function buildLeagueRegistrationPlayer(user = {}) {
  return {
    id: user?.uid || user?.id || "",
    linkedUserId: user?.uid || user?.id || "",
    nombre: user?.nombre || user?.name || "Jugador",
    apellido: user?.apellido || user?.lastName || "",
    categoria: user?.categoria || user?.category || "",
    sexo: user?.sexo || user?.sex || "",
    ciudad: user?.ciudad || user?.city || user?.localidad?.nombre || "",
    provincia: user?.provincia || user?.province || user?.localidad?.provincia || "",
    foto: user?.foto || user?.fotoURL || user?.avatarUrl || "",
    ladoJuego: user?.ladoJuego || "ambos",
    ladoPreferido: user?.ladoPreferido || "Ambos lados",
  };
}

function mapLeagueRegistrationRequest(docSnapshot) {
  const data = docSnapshot.data() || {};

  return {
    id: docSnapshot.id,
    leagueId: data.leagueId || "",
    leagueName: data.leagueName || "Liga",
    organizerId: data.organizerId || "",
    organizerName: data.organizerName || "Organizador",
    requester: data.requester || {},
    partner: data.partner || null,
    status: data.status || "pending",
    teamType: data.teamType || "pair",
    createdAtMillis: data.createdAtMillis || 0,
  };
}

export async function createLeagueRegistrationRequest({ league = {}, requester = {}, partner = null } = {}) {
  if (!league?.id || !requester?.uid && !requester?.id) {
    throw new Error("No encontramos los datos para solicitar la inscripcion.");
  }

  const requesterPlayer = buildLeagueRegistrationPlayer(requester);
  const partnerPlayer = partner ? buildLeagueRegistrationPlayer(partner) : null;
  const status = league.teamType === "pair" && partnerPlayer ? "awaiting_partner" : "pending";

  const createdRef = await addDoc(collection(db, "leagueRegistrationRequests"), {
    leagueId: league.id,
    leagueName: league.nombre || "Liga",
    organizerId: league.organizerId || league.createdBy || "",
    organizerName: league.organizerName || league.createdByName || "Organizador",
    requester: requesterPlayer,
    partner: partnerPlayer,
    status,
    teamType: league.teamType || "pair",
    createdAt: serverTimestamp(),
    createdAtMillis: Date.now(),
    updatedAt: serverTimestamp(),
  });

  return {
    id: createdRef.id,
    leagueId: league.id,
    leagueName: league.nombre || "Liga",
    organizerId: league.organizerId || league.createdBy || "",
    organizerName: league.organizerName || league.createdByName || "Organizador",
    requester: requesterPlayer,
    partner: partnerPlayer,
    status,
    teamType: league.teamType || "pair",
  };
}

export async function listLeagueRegistrationRequests(leagueId) {
  if (!leagueId) {
    return [];
  }

  const snapshot = await getDocs(
    query(collection(db, "leagueRegistrationRequests"), where("leagueId", "==", leagueId))
  );

  return snapshot.docs.map(mapLeagueRegistrationRequest).sort(
    (first, second) => second.createdAtMillis - first.createdAtMillis
  );
}

export async function updateLeagueRegistrationRequestStatus(requestId, status) {
  if (!requestId) {
    return;
  }

  await updateDoc(doc(db, "leagueRegistrationRequests", requestId), {
    status,
    updatedAt: serverTimestamp(),
  });
}

function getMatchCompletedAtMillis(match = {}, fallbackMillis = 0) {
  return normalizeCount(match.completedAtMillis, 0) || normalizeCount(fallbackMillis, 0);
}

function teamHasPlayer(team = {}, playerKey = "") {
  if (!playerKey) {
    return false;
  }

  return (team.players || []).some((player) => buildPlayerKey(player) === playerKey);
}

function getPlayerCompletedAtMillisFromMatches(matches = [], playerKey = "", fallbackMillis = 0) {
  const completedValues = matches
    .filter((match) => teamHasPlayer(match.teamA, playerKey) || teamHasPlayer(match.teamB, playerKey))
    .map((match) => getMatchCompletedAtMillis(match, fallbackMillis))
    .filter((value) => value > 0);

  return completedValues.length ? Math.max(...completedValues) : normalizeCount(fallbackMillis, 0);
}

function isMatchAvailableForPayment(match = {}) {
  if (!match) {
    return false;
  }

  if (match?.suspensionMode && !match?.result?.winner) {
    return false;
  }

  return Boolean((match?.teamA?.players || []).length || (match?.teamB?.players || []).length);
}

function resolveRoundPaymentParticipants(league = {}, round = {}) {
  const matches = Array.isArray(round?.matches) ? round.matches : [];
  const paymentMatches = matches.filter(isMatchAvailableForPayment);
  const completedMatches = paymentMatches.filter((match) => match?.result?.winner);
  const fallbackCompletedAtMillis = normalizeCount(round?.completedAtMillis, 0);

  if (league?.teamType === "pair") {
    const teams = paymentMatches.flatMap((match) => [match.teamA, match.teamB]).filter(Boolean);

    const uniqueTeams = uniqueBy(
      teams.map((team, index) => normalizeTeam(team, index)),
      (team) => getPaymentParticipantId("pair", team)
    );

    return uniqueTeams.flatMap((team) => {
      const pairId = getPaymentParticipantId("pair", team);
      const pairLabel = getPaymentParticipantLabel("pair", team);
      const teamPlayers = Array.isArray(team.players) ? team.players.map(normalizePlayerEntry) : [];

      return teamPlayers.map((player) => {
        const playerId = buildPlayerKey(player);

        return {
          id: playerId,
          type: "player",
          label: getPaymentParticipantLabel("individual", player),
          pairId,
          pairLabel,
          players: [player],
          playerIds: [playerId].filter(Boolean),
          completedAtMillis: getPlayerCompletedAtMillisFromMatches(
            completedMatches,
            playerId,
            fallbackCompletedAtMillis
          ),
        };
      });
    });
  }

  const players = paymentMatches.flatMap((match) => [
    ...(match?.teamA?.players || []),
    ...(match?.teamB?.players || []),
  ]);

  return uniqueBy(
    players.map(normalizePlayerEntry),
    (player) => getPaymentParticipantId("individual", player)
  ).map((player) => ({
    id: getPaymentParticipantId("individual", player),
    type: "player",
    label: getPaymentParticipantLabel("individual", player),
    players: [player],
    playerIds: [buildPlayerKey(player)].filter(Boolean),
    completedAtMillis: getPlayerCompletedAtMillisFromMatches(
      completedMatches,
      buildPlayerKey(player),
      fallbackCompletedAtMillis
    ),
  }));
}

export function validateFixtureGeneration(league = {}) {
  const players = Array.isArray(league?.players) ? league.players : [];

  if (!players.length) {
    return { valid: false, message: "Primero debes cargar jugadores dentro de la liga." };
  }

  if (league?.teamType === "pair") {
    const numberedPairs = players.reduce((groups, player) => {
      const normalizedPlayer = normalizePlayerEntry(player);
      const pairNumber = normalizeCount(normalizedPlayer.pairNumber, 0);

      if (pairNumber > 0) {
        groups[pairNumber] = [...(groups[pairNumber] || []), normalizedPlayer];
      }

      return groups;
    }, {});

    if (Object.values(numberedPairs).some((teamPlayers) => teamPlayers.length !== 2)) {
      return {
        valid: false,
        message: "Todas las parejas fijas deben tener dos jugadores para generar el fixture.",
      };
    }

    if (formatSex(league?.sexo) === "Mixto") {
      const sameSexPair = Object.values(numberedPairs).find((teamPlayers) => {
        const sexValues = teamPlayers.map((player) => normalizePlayerSex(player.sexo));

        return sexValues[0] && sexValues[1] && sexValues[0] === sexValues[1];
      });

      if (sameSexPair) {
        return {
          valid: false,
          message: "En una liga mixta cada pareja debe tener un jugador masculino y una jugadora femenina.",
        };
      }
    }

    const manualTeams = Array.isArray(league?.fixtureConfig?.manualTeams)
      ? league.fixtureConfig.manualTeams
      : [];

    if (!Object.keys(numberedPairs).length && manualTeams.length) {
      const assignedCount = manualTeams.reduce(
        (total, team) => total + (Array.isArray(team?.players) ? team.players.length : 0),
        0
      );

      if (assignedCount !== players.length) {
        return {
          valid: false,
          message: "Todas las personas de la liga deben quedar dentro de una pareja.",
        };
      }

      if (formatSex(league?.sexo) === "Mixto") {
        const sameSexManualTeam = manualTeams.find((team) => {
          const teamPlayers = Array.isArray(team?.players) ? team.players : [];
          const sexValues = teamPlayers.map((player) => normalizePlayerSex(player.sexo));

          return sexValues[0] && sexValues[1] && sexValues[0] === sexValues[1];
        });

        if (sameSexManualTeam) {
          return {
            valid: false,
            message: "En una liga mixta cada pareja debe tener un jugador masculino y una jugadora femenina.",
          };
        }
      }
    }

    if (buildPairTeams(league).length < 2) {
      return { valid: false, message: "Necesitas al menos dos parejas para generar el fixture." };
    }

    return { valid: true, message: "" };
  }

  const { drivePlayers, revesPlayers } = splitIndividualPlayers(players);

  if (drivePlayers.length < 2 || revesPlayers.length < 2) {
    return {
      valid: false,
      message: "Necesitas al menos dos Drive y dos Reves para generar el fixture individual.",
    };
  }

  return { valid: true, message: "" };
}

export function generateLeagueFixture(league = {}) {
  const validation = validateFixtureGeneration(league);

  if (!validation.valid) {
    throw new Error(validation.message);
  }

  return league?.teamType === "individual"
    ? generateIndividualLeagueFixture(league)
    : generatePairLeagueFixture(league);
}

export async function updateLeagueFixture(leagueId, fixture = createEmptyFixture()) {
  await updateDoc(doc(db, "leagues", leagueId), {
    fixture,
    updatedAt: serverTimestamp(),
  });
}

export async function updateLeagueFixtureConfig(leagueId, fixtureConfig = {}, fixture = null) {
  const payload = {
    fixtureConfig,
    updatedAt: serverTimestamp(),
  };

  if (fixture) {
    payload.fixture = fixture;
  }

  await updateDoc(doc(db, "leagues", leagueId), payload);
}

export function resolveLeaguePaymentRounds(league = {}) {
  const fixtureRounds = Array.isArray(league?.fixture?.rounds) ? league.fixture.rounds : [];
  const storedRoundPayments = normalizeRoundPayments(league?.roundPayments);

  return fixtureRounds.map((round, index) => {
    const roundMatches = Array.isArray(round?.matches) ? round.matches : [];
    const pendingReprogrammedMatchesCount = roundMatches.filter(
      (match) => match?.suspensionMode && !match?.result?.winner
    ).length;
    const roundParticipants = resolveRoundPaymentParticipants(league, round);
    const storedRound = storedRoundPayments.find((entry) => entry.roundId === round.id) || {
      roundId: round.id,
      entries: [],
    };

    return {
      roundId: round.id,
      roundNumber: round.number || index + 1,
      title: round.title || `Fecha ${index + 1}`,
      scheduleLabel: round.scheduleLabel || "",
      scheduledDateMillis: normalizeCount(round.scheduledDateMillis, 0),
      suspendedAtMillis: normalizeCount(round.suspendedAtMillis, 0),
      suspensionReason: round.suspensionReason || "",
      suspensionMode: round.suspensionMode || "",
      rescheduledDateMillis: normalizeCount(round.rescheduledDateMillis, 0),
      completedAtMillis: normalizeCount(round.completedAtMillis, 0),
      pendingReprogrammedMatchesCount,
      entries: roundParticipants.map((participant) => {
        const storedEntry =
          storedRound.entries.find((entry) => entry.participantId === participant.id) ||
          storedRound.entries.find(
            (entry) => participant.pairId && entry.participantId === participant.pairId
          ) ||
          null;

        return {
          participantId: participant.id,
          participantType: participant.type,
          participantLabel: participant.label,
          pairId: participant.pairId || "",
          pairLabel: participant.pairLabel || "",
          playerIds: participant.playerIds,
          completedAtMillis: normalizeCount(participant.completedAtMillis, 0),
          paymentStatus: storedEntry?.paymentStatus || "pendiente",
          paymentMethod: storedEntry?.paymentMethod || "",
          proofUrl: storedEntry?.proofUrl || "",
          proofFileName: storedEntry?.proofFileName || "",
          proofUploadedAtMillis: normalizeCount(storedEntry?.proofUploadedAtMillis, 0),
          proofUploadedBy: storedEntry?.proofUploadedBy || "",
          proofUploadedByName: storedEntry?.proofUploadedByName || "",
          confirmedAtMillis: normalizeCount(storedEntry?.confirmedAtMillis, 0),
          confirmedBy: storedEntry?.confirmedBy || "",
          confirmedByName: storedEntry?.confirmedByName || "",
          rejectedAtMillis: normalizeCount(storedEntry?.rejectedAtMillis, 0),
          rejectedBy: storedEntry?.rejectedBy || "",
          rejectedByName: storedEntry?.rejectedByName || "",
          reminder4hSentAtMillis: normalizeCount(storedEntry?.reminder4hSentAtMillis, 0),
          reminder4hSentBy: storedEntry?.reminder4hSentBy || "",
          reminder4hSentByName: storedEntry?.reminder4hSentByName || "",
          reminder24hSentAtMillis: normalizeCount(storedEntry?.reminder24hSentAtMillis, 0),
          reminder24hSentBy: storedEntry?.reminder24hSentBy || "",
          reminder24hSentByName: storedEntry?.reminder24hSentByName || "",
          updatedAtMillis: normalizeCount(storedEntry?.updatedAtMillis, 0),
          updatedBy: storedEntry?.updatedBy || "",
          updatedByName: storedEntry?.updatedByName || "",
          players: participant.players || [],
        };
      }),
    };
  });
}

export function getLeaguePaymentRoundSummary(roundPayments = {}) {
  return (roundPayments.entries || []).reduce(
    (summary, entry) => {
      summary.total += 1;

      if (entry.paymentStatus === "pagado") {
        summary.paid += 1;
      } else if (entry.paymentStatus === "informo_transferencia") {
        summary.transfer += 1;
      } else if (normalizeCount(entry.completedAtMillis, 0) > 0) {
        summary.pending += 1;
      }

      return summary;
    },
    { total: 0, paid: 0, transfer: 0, pending: 0 }
  );
}

export async function updateLeagueRoundPayments(leagueId, roundPayments = []) {
  await updateDoc(doc(db, "leagues", leagueId), {
    roundPayments,
    updatedAt: serverTimestamp(),
  });
}

function formatSuspensionDateLabel(value = 0) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function isDateStillInSuspensionDay(value = 0, now = Date.now()) {
  if (!value) {
    return false;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return false;
  }

  date.setHours(23, 59, 59, 999);
  return now <= date.getTime();
}

export function getActiveLeagueSuspensionNotice(league = {}, now = Date.now()) {
  const rounds = Array.isArray(league?.fixture?.rounds) ? league.fixture.rounds : [];
  const activeRound = rounds.find((round) => {
    const roundIsSuspended = round?.suspensionMode === "suspended";
    const hasSuspendedMatches = (round?.matches || []).some(
      (match) => match?.suspensionMode && !match?.result?.winner
    );

    return (roundIsSuspended || hasSuspendedMatches) && isDateStillInSuspensionDay(round?.scheduledDateMillis, now);
  });

  if (!activeRound) {
    return null;
  }

  const suspendedMatches = (activeRound.matches || []).filter(
    (match) => match?.suspensionMode && !match?.result?.winner
  );
  const sourceMatches = suspendedMatches.length ? suspendedMatches : activeRound.matches || [];
  const timeSlots = [...new Set(sourceMatches.map((match) => match?.timeSlot).filter(Boolean))];
  const dateLabel = formatSuspensionDateLabel(activeRound.scheduledDateMillis);
  const timeLabel = timeSlots.length ? `${timeSlots.join(" / ")} hs` : activeRound.scheduleLabel || "";

  return {
    roundId: activeRound.id || "",
    roundTitle: activeRound.title || "Fecha",
    dateLabel,
    timeLabel,
    label: "!! LIGA SUSPENDIDA !!",
  };
}

export function buildLeagueStandings(league = {}) {
  const fixtureRounds = Array.isArray(league?.fixture?.rounds) ? league.fixture.rounds : [];
  const scoringSettings = normalizeScoringSettings(league?.scoringSettings, league?.teamType);
  const pointsWin = normalizeScoreValue(scoringSettings.pointsWin, 3);
  const pointsLoss = normalizeScoreValue(scoringSettings.pointsLoss, 1);
  const pointsWalkoverWin = normalizeScoreValue(scoringSettings.pointsWalkoverWin, pointsWin);
  const replacementPenalty = normalizeScoreValue(scoringSettings.replacementPenalty, 0);
  const replacementPenaltyMode =
    scoringSettings.replacementPenaltyMode === "pair" ? "pair" : "individual";
  const replacementQuota = Math.max(0, normalizeCount(scoringSettings.replacementQuota, 0));
  const replacementUsageCounters = new Map();
  const countSuperTieBreakAsSet = league?.matchFormat !== "two_sets_super_tiebreak";

  if (league?.teamType === "individual") {
    const driveRowsMap = new Map();
    const revesRowsMap = new Map();
    const { drivePlayers, revesPlayers } = splitIndividualPlayers(league?.players || []);

    drivePlayers.forEach((player) => {
      const playerKey = buildPlayerKey(player);

      if (playerKey && !driveRowsMap.has(playerKey)) {
        driveRowsMap.set(playerKey, createStandingsRow(playerKey, formatPlayerShortName(player)));
      }
    });

    revesPlayers.forEach((player) => {
      const playerKey = buildPlayerKey(player);

      if (playerKey && !revesRowsMap.has(playerKey)) {
        revesRowsMap.set(playerKey, createStandingsRow(playerKey, formatPlayerShortName(player)));
      }
    });

    fixtureRounds.forEach((round) => {
      (round.matches || []).forEach((match) => {
        getAssignedReplacementEntriesForTeam(match, "teamA").forEach((entry) => {
          const titularKey = buildPlayerKey(entry.titular || {});
          const row = findIndividualRowByPlayerKey(driveRowsMap, revesRowsMap, titularKey);

          applyReplacementPenaltyToRow(
            row,
            replacementUsageCounters,
            titularKey,
            replacementQuota,
            resolveReplacementPenalty(entry, replacementPenalty)
          );
        });

        getAssignedReplacementEntriesForTeam(match, "teamB").forEach((entry) => {
          const titularKey = buildPlayerKey(entry.titular || {});
          const row = findIndividualRowByPlayerKey(driveRowsMap, revesRowsMap, titularKey);

          applyReplacementPenaltyToRow(
            row,
            replacementUsageCounters,
            titularKey,
            replacementQuota,
            resolveReplacementPenalty(entry, replacementPenalty)
          );
        });

        if (!match?.result?.winner) return;

        const teamAWon = match.result.winner === "teamA";
        const teamAPlayers = Array.isArray(match?.teamA?.players) ? match.teamA.players : [];
        const teamBPlayers = Array.isArray(match?.teamB?.players) ? match.teamB.players : [];
        const teamASetsWon = match.result.reason === "walkover"
          ? 2
          : countSetsWon(match?.result?.sets || [], "own", countSuperTieBreakAsSet);
        const teamBSetsWon = match.result.reason === "walkover"
          ? 0
          : countSetsWon(match?.result?.sets || [], "rival", countSuperTieBreakAsSet);
        const teamAGames = match.result.reason === "walkover" ? 12 : countGames(match?.result?.sets || [], "own", false);
        const teamBGames = match.result.reason === "walkover" ? 0 : countGames(match?.result?.sets || [], "rival", false);
        const winnerPoints = match.result.reason === "walkover" ? pointsWalkoverWin : pointsWin;
        const teamAPoints = teamAWon ? winnerPoints : teamASetsWon * pointsLoss;
        const teamBPoints = teamAWon ? teamBSetsWon * pointsLoss : winnerPoints;

        [...teamAPlayers, ...teamBPlayers].forEach((player) => {
          const playerKey = buildPlayerKey(player);
          const targetMap =
            normalizePlayerSide(player?.ladoJuego) === "reves" ? revesRowsMap : driveRowsMap;

          if (!targetMap.has(playerKey)) {
            targetMap.set(playerKey, createStandingsRow(playerKey, formatPlayerShortName(player)));
          }
        });

        teamAPlayers.forEach((player) => {
          const row = driveRowsMap.get(buildPlayerKey(player)) || revesRowsMap.get(buildPlayerKey(player));
          if (!row) return;
          applyResultToRow(row, teamAWon, teamASetsWon, teamBSetsWon, teamAGames, teamBGames, teamAPoints);
        });

        teamBPlayers.forEach((player) => {
          const row = driveRowsMap.get(buildPlayerKey(player)) || revesRowsMap.get(buildPlayerKey(player));
          if (!row) return;
          applyResultToRow(row, !teamAWon, teamBSetsWon, teamASetsWon, teamBGames, teamAGames, teamBPoints);
        });
      });
    });

    return {
      tables: [
        { key: "drive", title: "Drive", rows: sortStandingsRows([...driveRowsMap.values()]) },
        { key: "reves", title: "Reves", rows: sortStandingsRows([...revesRowsMap.values()]) },
      ],
    };
  }

  const rowsMap = new Map();
  const pairTeams = buildPairTeams(league);
  const pairStandingsAliases = new Map();

  pairTeams.forEach((team) => {
    const teamKey = buildPairStandingsKey(team);
    const playersKey = buildTeamPlayersKey(team.players || []);

    if (teamKey && !rowsMap.has(teamKey)) {
      rowsMap.set(teamKey, createStandingsRow(teamKey, formatTeamShortLabel(team.players || [], team.label)));
    }

    if (playersKey) {
      pairStandingsAliases.set(playersKey, teamKey);
    }
  });

  fixtureRounds.forEach((round) => {
    (round.matches || []).forEach((match) => {
      const teamAKey =
        pairStandingsAliases.get(buildTeamPlayersKey(match.teamA?.players || [])) ||
        buildPairStandingsKey(match.teamA);
      const teamBKey =
        pairStandingsAliases.get(buildTeamPlayersKey(match.teamB?.players || [])) ||
        buildPairStandingsKey(match.teamB);

      if (!rowsMap.has(teamAKey)) {
        rowsMap.set(teamAKey, createStandingsRow(teamAKey, formatTeamShortLabel(match.teamA?.players || [], match.teamA?.label)));
      }

      if (!rowsMap.has(teamBKey)) {
        rowsMap.set(teamBKey, createStandingsRow(teamBKey, formatTeamShortLabel(match.teamB?.players || [], match.teamB?.label)));
      }

      const rowA = rowsMap.get(teamAKey);
      const rowB = rowsMap.get(teamBKey);
      const teamAReplacements = getAssignedReplacementEntriesForTeam(match, "teamA");
      const teamBReplacements = getAssignedReplacementEntriesForTeam(match, "teamB");

      if (replacementPenaltyMode === "pair") {
        if (teamAReplacements.length) {
          const teamAPenalty = Math.max(
            ...teamAReplacements.map((entry) => resolveReplacementPenalty(entry, replacementPenalty))
          );

          applyReplacementPenaltyToRow(
            rowA,
            replacementUsageCounters,
            teamAKey,
            replacementQuota,
            teamAPenalty
          );
        }

        if (teamBReplacements.length) {
          const teamBPenalty = Math.max(
            ...teamBReplacements.map((entry) => resolveReplacementPenalty(entry, replacementPenalty))
          );

          applyReplacementPenaltyToRow(
            rowB,
            replacementUsageCounters,
            teamBKey,
            replacementQuota,
            teamBPenalty
          );
        }
      } else {
        teamAReplacements.forEach((entry) =>
          applyReplacementPenaltyToRow(
            rowA,
            replacementUsageCounters,
            buildPlayerKey(entry.titular || {}),
            replacementQuota,
            resolveReplacementPenalty(entry, replacementPenalty)
          )
        );
        teamBReplacements.forEach((entry) =>
          applyReplacementPenaltyToRow(
            rowB,
            replacementUsageCounters,
            buildPlayerKey(entry.titular || {}),
            replacementQuota,
            resolveReplacementPenalty(entry, replacementPenalty)
          )
        );
      }

      if (!match?.result?.winner) return;

      const teamAWon = match.result.winner === "teamA";
      const teamASetsWon = match.result.reason === "walkover"
        ? 2
        : countSetsWon(match?.result?.sets || [], "own", countSuperTieBreakAsSet);
      const teamBSetsWon = match.result.reason === "walkover"
        ? 0
        : countSetsWon(match?.result?.sets || [], "rival", countSuperTieBreakAsSet);
      const teamAGames = match.result.reason === "walkover" ? 12 : countGames(match?.result?.sets || [], "own", false);
      const teamBGames = match.result.reason === "walkover" ? 0 : countGames(match?.result?.sets || [], "rival", false);
      const winnerPoints = match.result.reason === "walkover" ? pointsWalkoverWin : pointsWin;
      const teamAPoints = teamAWon ? winnerPoints : teamASetsWon * pointsLoss;
      const teamBPoints = teamAWon ? teamBSetsWon * pointsLoss : winnerPoints;

      applyResultToRow(rowA, teamAWon, teamASetsWon, teamBSetsWon, teamAGames, teamBGames, teamAPoints);
      applyResultToRow(rowB, !teamAWon, teamBSetsWon, teamASetsWon, teamBGames, teamAGames, teamBPoints);
    });
  });

  return {
    tables: [
      { key: "pair", title: "Parejas", rows: sortStandingsRows([...rowsMap.values()]) },
    ],
  };
}

