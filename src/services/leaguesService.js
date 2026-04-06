import {
  addDoc,
  collection,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { db } from "../../services/firebaseConfig";

export const LEAGUE_BRANCH_OPTIONS = [
  { label: "Caballeros", value: "Masculino" },
  { label: "Damas", value: "Femenino" },
  { label: "Mixta", value: "Mixto" },
];

export const LEAGUE_TEAM_TYPE_OPTIONS = [
  { label: "En pareja", value: "pair" },
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
];

export const LEAGUE_CATEGORY_OPTIONS = [
  { label: "8va", value: "8va", numericValue: 8 },
  { label: "7ma", value: "7ma", numericValue: 7 },
  { label: "6ta", value: "6ta", numericValue: 6 },
  { label: "5ta", value: "5ta", numericValue: 5 },
  { label: "4ta", value: "4ta", numericValue: 4 },
  { label: "3ra", value: "3ra", numericValue: 3 },
  { label: "2da", value: "2da", numericValue: 2 },
  { label: "1era", value: "1era", numericValue: 1 },
];

export const LEAGUE_SUM_TARGET_OPTIONS = Array.from({ length: 15 }, (_, index) => {
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

export function normalizeLeagueDefaults(defaults = {}) {
  return {
    branch: formatSex(defaults.branch || defaults.sexo),
    teamType: defaults.teamType === "individual" ? "individual" : "pair",
    categoryFormat: defaults.categoryFormat === "suma" ? "suma" : "libre",
    sumTarget: normalizeSumTarget(defaults.sumTarget),
    sumRule: defaults.sumRule === "fixed" ? "fixed" : "open",
    fixedCategoryA: normalizeCategoryValue(defaults.fixedCategoryA),
    fixedCategoryB: normalizeCategoryValue(defaults.fixedCategoryB),
    matchFormat:
      defaults.matchFormat === "two_sets_super_tiebreak"
        ? "two_sets_super_tiebreak"
        : "three_full_sets",
    allowWalkover: defaults.allowWalkover !== false,
    pointsWin: normalizeCount(defaults.pointsWin, 3),
    pointsLoss: normalizeCount(defaults.pointsLoss, 1),
    pointsWalkoverWin: normalizeCount(defaults.pointsWalkoverWin, 3),
    replacementPenalty: normalizeCount(defaults.replacementPenalty, 1),
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

export function buildLeaguePayload({
  organizer,
  name,
  complex,
  branch,
  teamType,
  categoryFormat,
  sumTarget,
  sumRule,
  fixedCategoryA,
  fixedCategoryB,
  matchFormat,
  allowWalkover,
  pointsWin,
  pointsLoss,
  pointsWalkoverWin,
  replacementPenalty,
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
    allowWalkover,
    pointsWin,
    pointsLoss,
    pointsWalkoverWin,
    replacementPenalty,
  });
  const localidad = organizer?.localidad || {
    nombre: organizer?.city || "",
    provincia: organizer?.province || "",
    pais: organizer?.country || "Argentina",
  };
  const categoryLabel =
    normalizedDefaults.categoryFormat === "suma"
      ? buildFixedSumLabel(
          normalizedDefaults.branch,
          normalizedDefaults.sumTarget,
          normalizedDefaults.sumRule,
          normalizedDefaults.fixedCategoryA,
          normalizedDefaults.fixedCategoryB
        )
      : `Libre ${formatBranchLabel(normalizedDefaults.branch)}`;

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
    tieBreakMode:
      normalizedDefaults.matchFormat === "two_sets_super_tiebreak"
        ? "super_tiebreak"
        : "third_full_set",
    scoringSettings: {
      allowWalkover: normalizedDefaults.allowWalkover !== false,
      walkoverScore: DEFAULT_WALKOVER_SCORE,
      pointsWin: normalizedDefaults.pointsWin,
      pointsLoss: normalizedDefaults.pointsLoss,
      pointsWalkoverWin: normalizedDefaults.pointsWalkoverWin,
      replacementPenalty: normalizedDefaults.replacementPenalty,
      standings: buildStandingsConfig(normalizedDefaults.teamType),
    },
    complejo: {
      nombre: complex?.nombre || "Complejo sin definir",
      direccion: complex?.direccion || "",
    },
    complejoNombre: complex?.nombre || "Complejo sin definir",
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

  return {
    id: docSnapshot.id,
    nombre: data.nombre || data.name || "Liga sin nombre",
    complejoNombre:
      complejo.nombre ||
      data.complejoNombre ||
      data.complexName ||
      "Complejo sin definir",
    localidad: localidad.nombre || data.ciudad || data.city || "",
    provincia: localidad.provincia || data.provincia || data.province || "",
    sexo: formatSex(data.sexo || data.sex),
    categoria: sumLabel || data.categoria || data.category || "Libre",
    teamType: data.teamType || "pair",
    modalidadCategoria: data.modalidadCategoria || "libre",
    sumTarget: data.sumTarget || "",
    sumRule: data.sumRule || "open",
    categoriaA: data.categoriaA || "",
    categoriaB: data.categoriaB || "",
    sumaLabel: sumLabel,
    matchFormat: data.matchFormat || "three_full_sets",
    scoringSettings: data.scoringSettings || {
      allowWalkover: true,
      walkoverScore: DEFAULT_WALKOVER_SCORE,
      pointsWin: 3,
      pointsLoss: 1,
      pointsWalkoverWin: 3,
      replacementPenalty: 1,
      standings: buildStandingsConfig(data.teamType || "pair"),
    },
    organizerId: data.organizerId || data.createdBy || "",
    organizerName: data.organizerName || data.createdByName || "",
    createdAt: data.createdAt || null,
    createdAtMillis: resolveTimestampMillis(data.createdAt),
    esMiLiga: false,
  };
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
          String(league.localidad || "")
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