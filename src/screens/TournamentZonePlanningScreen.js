import { Fragment, memo, useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import BottomQuickActionsBar, {
  BOTTOM_QUICK_ACTIONS_SPACE,
} from "../components/BottomQuickActionsBar";
import FeedbackModal from "../components/FeedbackModal";
import NumericKeyboardDoneBar from "../components/NumericKeyboardDoneBar";
import SectionHeader from "../components/SectionHeader";
import TournamentHeaderCard from "../components/TournamentHeaderCard";
import useTournamentCategorySwitcher from "../hooks/useTournamentCategorySwitcher";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import { getQuickSlotDefinitions } from "../services/availabilityService";
import {
  addTournamentCustomSlot,
  buildTournamentDayOptions,
  normalizeTournamentAvailability,
} from "../services/tournamentAvailabilityService";
import {
  getTournamentById,
  getTournamentEventVenueSchedules,
  listTournamentRegistrations,
  listTournamentsByBatchId,
  updateTournament,
  updateTournamentRegistration,
} from "../services/tournamentsService";
import {
  DEFAULT_MATCH_DURATION_MINUTES,
  DEFAULT_REST_MINUTES,
  buildScheduleOccupancy,
  validateMatchSlot,
} from "../utils/scheduleValidation";

const NUMERIC_KEYBOARD_ACCESSORY_ID = "tournamentZonePlanningNumericDone";

const ZONE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const PAIR_COLORS = [
  { bg: "#E8F5EE", border: "#9FD0B6", fill: "#BFE8D0", text: "#0F5F37" },
  { bg: "#EAF3FF", border: "#A9C8EA", fill: "#C7DFFF", text: "#1F5B99" },
  { bg: "#FFF4E3", border: "#E7C27E", fill: "#F7D89A", text: "#895A00" },
  { bg: "#F3EEFF", border: "#C8B8EA", fill: "#D9CCFF", text: "#5B3EA0" },
  { bg: "#E8FAFA", border: "#9CD4D1", fill: "#BCE9E7", text: "#146C68" },
  { bg: "#FFF0F4", border: "#E7A9B8", fill: "#F7C7D2", text: "#9B314B" },
];
function parseMinutes(value = "") {
  const [hour = "0", minute = "0"] = String(value || "").split(":");
  return Number.parseInt(hour, 10) * 60 + Number.parseInt(minute, 10);
}

function formatTwoDigits(value) {
  return String(value).padStart(2, "0");
}

function areJsonEqual(firstValue, secondValue) {
  return JSON.stringify(firstValue || null) === JSON.stringify(secondValue || null);
}

function buildDateFromTime(value = "") {
  const baseDate = new Date();
  const normalizedValue = /^\d{2}:\d{2}$/.test(String(value || "")) ? value : "19:00";
  const [hours, minutes] = String(normalizedValue)
    .split(":")
    .map((part) => Number.parseInt(part, 10));
  const nextDate = new Date(baseDate);
  nextDate.setHours(hours, minutes, 0, 0);
  return nextDate;
}

function formatMinutesToTime(totalMinutes = 0) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function getMaxCourtsForVenue(venueSchedules = [], venueId = "") {
  const schedules = venueSchedules.filter((s) => s.venueId === venueId && s.useForZones);
  if (!schedules.length) return 4;
  return Math.max(...schedules.map((s) => Number(s.courts || 1)));
}

function buildZoneMatchSchedulingSlots(schedules = [], durationMinutes = DEFAULT_MATCH_DURATION_MINUTES) {
  const slots = [];
  (Array.isArray(schedules) ? schedules : []).forEach((schedule) => {
    const startMinutes = parseMinutes(schedule.from);
    const endMinutes = parseMinutes(schedule.to);
    if (endMinutes - startMinutes < durationMinutes) return;
    const courtIndices = Array.isArray(schedule.selectedCourtIndices) && schedule.selectedCourtIndices.length
      ? schedule.selectedCourtIndices
      : Array.from({ length: Number(schedule.courts || 1) }, (_, i) => i + 1);
    for (let cur = startMinutes; cur + durationMinutes <= endMinutes; cur += durationMinutes) {
      for (const courtIndex of courtIndices) {
        slots.push({
          id: `${schedule.id}-${courtIndex}-${cur}`,
          venueId: schedule.venueId,
          venueName: schedule.venueName,
          courtIndex,
          dayKey: schedule.dayKey,
          startMinutes: cur,
        });
      }
    }
  });
  const seen = new Set();
  return slots
    .filter((slot) => {
      const key = `${slot.dayKey}|${slot.startMinutes}|${slot.venueId}|${slot.courtIndex}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      if (a.dayKey !== b.dayKey) return a.dayKey.localeCompare(b.dayKey, "es");
      if (a.startMinutes !== b.startMinutes) return a.startMinutes - b.startMinutes;
      if (a.venueName !== b.venueName) return a.venueName.localeCompare(b.venueName, "es");
      return a.courtIndex - b.courtIndex;
    });
}

function buildZoneMatchRows(pairCount = 0) {
  if (pairCount === 2) {
    return ["1 vs 2"];
  }

  if (pairCount === 3) {
    return ["1 vs 2", "1 vs 3", "2 vs 3"];
  }

  if (pairCount === 4) {
    return ["1 vs 2", "3 vs 4", "G vs G", "P vs P"];
  }

  return [];
}

function getWeekdayLabel(dayKey = "") {
  const date = new Date(`${dayKey}T12:00:00`);

  if (Number.isNaN(date.getTime())) {
    return "DIA";
  }

  return date
    .toLocaleDateString("es-AR", { weekday: "long" })
    .replace(".", "")
    .toUpperCase();
}

function getDayNumberMonthLabel(dayKey = "") {
  const date = new Date(`${dayKey}T12:00:00`);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
  });
}

function buildTournamentVenueOptions(tournament = {}) {
  return [
    ...(Array.isArray(tournament?.venues) ? tournament.venues : []),
    ...(Array.isArray(tournament?.temporaryVenues) ? tournament.temporaryVenues : []),
  ]
    .map((venue, index) => ({
      id: String(venue?.id || venue?.complexId || venue?.name || `venue-${index}`),
      label: String(venue?.name || venue?.nombre || `Complejo ${index + 1}`),
    }))
    .filter((venue) => venue.id && venue.label);
}

function isActiveRegistration(registration = {}) {
  return (
    registration.withdrawalStatus !== "confirmed" &&
    registration.status !== "rejected" &&
    Boolean(registration.id)
  );
}

function getPairLabel(registration = {}, index = 0) {
  return (
    registration.pairLabel ||
    [registration.player1Name, registration.player2Name].filter(Boolean).join(" / ") ||
    `Pareja ${index + 1}`
  );
}

// Para ordenar categorias de menor a mayor numero (5ta antes que 7ma antes
// que 8va) en la vista combinada multi-categoria.
function extractCategoryOrderNumber(label = "") {
  const match = String(label || "").match(/(\d+)/);
  return match ? Number(match[1]) : 999;
}

// Color fijo por categoria (barra de encabezado + casilleros), distinto de
// PAIR_COLORS que es por pareja dentro de una categoria.
const CATEGORY_BAR_COLORS = ["#1B5D92", "#0F5F37", "#895A00", "#5B3EA0", "#146C68", "#9B314B"];

function getCategoryColor(index = 0) {
  return CATEGORY_BAR_COLORS[index % CATEGORY_BAR_COLORS.length];
}

// Columnas de hora de la grilla nueva: salen de la disponibilidad de sedes
// configurada para el dia elegido (no de un rango fijo). Si hay mas de una
// franja sin pisarse, se toma el rango que va desde la mas temprana a la mas
// tardia (las horas intermedias sin cancha configurada quedan igual como
// columna, simplemente no van a tener partidos ahi).
function getHourColumnsForDay(venueSchedules = [], dayKey = "") {
  const daySchedules = (Array.isArray(venueSchedules) ? venueSchedules : []).filter(
    (schedule) => schedule.dayKey === dayKey
  );

  if (!daySchedules.length) {
    return [];
  }

  const minFrom = Math.min(...daySchedules.map((schedule) => parseMinutes(schedule.from)));
  const maxTo = Math.max(...daySchedules.map((schedule) => parseMinutes(schedule.to)));
  const startHour = Math.floor(minFrom / 60);
  const endHour = Math.max(startHour + 1, Math.ceil(maxTo / 60));
  const columns = [];

  for (let hour = startHour; hour < endHour; hour += 1) {
    const normalizedHour = ((hour % 24) + 24) % 24;
    columns.push({
      minutes: hour * 60,
      label: `${String(normalizedHour).padStart(2, "0")}:00`,
    });
  }

  return columns;
}

// Horas totales cargadas por una pareja, sumando TODOS los dias (no solo el
// dia seleccionado), para el diagnostico "Sin horario / < 4h / >= 4h".
function getTotalLoadedHours(registration = {}) {
  const availability = registration?.availability || {};
  const quickSlotDefinitions = getQuickSlotDefinitions();
  let totalMinutes = 0;

  Object.values(availability).forEach((dayValue) => {
    (dayValue?.quickSlots || []).forEach((slotKey) => {
      const definition = quickSlotDefinitions.find((slot) => slot.key === slotKey);
      if (!definition) return;
      const from = parseMinutes(definition.from);
      let to = parseMinutes(definition.to);
      if (to <= from) to += 24 * 60;
      totalMinutes += to - from;
    });

    (Array.isArray(dayValue?.customSlots) ? dayValue.customSlots : []).forEach((slot) => {
      const from = parseMinutes(slot.from);
      let to = parseMinutes(slot.to);
      if (to <= from) to += 24 * 60;
      totalMinutes += Math.max(0, to - from);
    });
  });

  return totalMinutes / 60;
}

function getHoursStatusTag(totalHours = 0) {
  if (totalHours <= 0) {
    return { tone: "danger", label: "Sin horario" };
  }

  if (totalHours < 4) {
    return { tone: "warning", label: `${totalHours % 1 === 0 ? totalHours : totalHours.toFixed(1)} h` };
  }

  return { tone: "success", label: `${totalHours % 1 === 0 ? totalHours : totalHours.toFixed(1)} h` };
}

function buildZoneLetterMapForZones(zones = []) {
  const map = new Map();

  zones.forEach((zone, zoneIndex) => {
    const label = String(zone?.label || "").trim();
    const letterMatch = label.match(/zona\s+([a-z0-9]+)/i);
    const letter = (letterMatch?.[1] || ZONE_LETTERS[zoneIndex] || `${zoneIndex + 1}`).toUpperCase();

    (zone.registrationIds || []).forEach((registrationId) => {
      map.set(String(registrationId), letter);
    });
  });

  return map;
}

// Parejas sin zona primero, luego las asignadas agrupadas por letra de zona
// (igual criterio que la pantalla usaba antes de la grilla nueva).
function sortRegistrationsUnassignedFirst(registrations = [], assignedIds, zoneLetterMap) {
  return [...registrations].sort((first, second) => {
    const firstAssigned = assignedIds.has(first.id);
    const secondAssigned = assignedIds.has(second.id);

    if (firstAssigned !== secondAssigned) {
      return firstAssigned ? 1 : -1;
    }

    if (firstAssigned && secondAssigned) {
      const firstLetter = zoneLetterMap.get(String(first.id)) || "";
      const secondLetter = zoneLetterMap.get(String(second.id)) || "";
      const comparison = firstLetter.localeCompare(secondLetter, "es", { numeric: true, sensitivity: "base" });
      if (comparison !== 0) {
        return comparison;
      }
    }

    return 0;
  });
}

// Pinta o despinta una hora puntual en la disponibilidad de una pareja,
// partiendo cualquier franja (rapida o personalizada) que la cubra, para no
// perder el resto de esa franja. Usa normalizeTournamentAvailability /
// addTournamentCustomSlot, que ya son las funciones del servicio existente.
function buildAvailabilityAfterCellToggle(registration, dayKey, hourMinutes, tournamentDayOptions) {
  const availability = registration?.availability || {};
  const wasAvailable = isSlotAvailable(registration, dayKey, hourMinutes);

  if (!wasAvailable) {
    return addTournamentCustomSlot(
      availability,
      dayKey,
      { from: formatMinutesToTime(hourMinutes), to: formatMinutesToTime(hourMinutes + 60) },
      tournamentDayOptions
    );
  }

  const normalized = normalizeTournamentAvailability(availability, tournamentDayOptions);
  const currentDay = normalized[dayKey] || { quickSlots: [], customSlots: [] };
  const quickSlotDefinitions = getQuickSlotDefinitions();
  const hourEnd = hourMinutes + 60;
  const remainingQuickSlots = [];
  const splitCustomSlots = [];

  const touchesHour = (fromMinutes, toMinutes) => {
    let normalizedTo = toMinutes;
    if (normalizedTo <= fromMinutes) normalizedTo += 24 * 60;
    return hourMinutes < normalizedTo && hourEnd > fromMinutes;
  };

  currentDay.quickSlots.forEach((slotKey) => {
    const definition = quickSlotDefinitions.find((slot) => slot.key === slotKey);
    if (!definition) return;
    const from = parseMinutes(definition.from);
    const to = parseMinutes(definition.to);

    if (!touchesHour(from, to)) {
      remainingQuickSlots.push(slotKey);
      return;
    }

    if (from < hourMinutes) {
      splitCustomSlots.push({ from: definition.from, to: formatMinutesToTime(hourMinutes) });
    }
    if (parseMinutes(definition.to) > hourEnd || to <= from) {
      splitCustomSlots.push({ from: formatMinutesToTime(hourEnd), to: definition.to });
    }
  });

  const remainingCustomSlots = [];

  currentDay.customSlots.forEach((slot) => {
    const from = parseMinutes(slot.from);
    const to = parseMinutes(slot.to);

    if (!touchesHour(from, to)) {
      remainingCustomSlots.push(slot);
      return;
    }

    if (from < hourMinutes) {
      splitCustomSlots.push({ from: slot.from, to: formatMinutesToTime(hourMinutes) });
    }
    if (to > hourEnd || to <= from) {
      splitCustomSlots.push({ from: formatMinutesToTime(hourEnd), to: slot.to });
    }
  });

  normalized[dayKey] = {
    quickSlots: remainingQuickSlots,
    customSlots: [...remainingCustomSlots, ...splitCustomSlots],
  };

  return normalizeTournamentAvailability(normalized, tournamentDayOptions);
}

function getShortPersonName(rawName = "") {
  const parts = String(rawName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) {
    return "";
  }

  if (parts.length === 1) {
    return parts[0];
  }

  const firstName = parts[0];
  const lastName = parts.slice(1).join(" ");
  return `${lastName} ${firstName.charAt(0).toUpperCase()}.`;
}

function getShortPairLabel(registration = {}, index = 0) {
  const explicitNames = [registration.player1Name, registration.player2Name]
    .filter(Boolean)
    .map(getShortPersonName)
    .filter(Boolean);

  if (explicitNames.length) {
    return explicitNames.join(" / ");
  }

  const label = getPairLabel(registration, index);
  const splitLabel = String(label || "")
    .split(/\s+\/\s+/)
    .map(getShortPersonName)
    .filter(Boolean);

  return splitLabel.length ? splitLabel.join(" / ") : label;
}

function buildEmptyZone(index = 0) {
  const letter = ZONE_LETTERS[index] || `${index + 1}`;

  return {
    id: `zone-${letter.toLowerCase()}-${Date.now()}-${index}`,
    label: `Zona ${letter}`,
    registrationIds: [],
  };
}

function normalizeZonePlanning(rawPlanning = {}, registrations = []) {
  const validIds = new Set(registrations.map((registration) => String(registration.id)));
  const usedIds = new Set();
  const zones = (Array.isArray(rawPlanning?.zones) ? rawPlanning.zones : [])
    .map((zone, index) => {
      const registrationIds = (Array.isArray(zone?.registrationIds) ? zone.registrationIds : [])
        .map((id) => String(id || ""))
        .filter((id) => validIds.has(id) && !usedIds.has(id));

      registrationIds.forEach((id) => usedIds.add(id));

      return {
        id: String(zone?.id || buildEmptyZone(index).id),
        label: String(zone?.label || `Zona ${ZONE_LETTERS[index] || index + 1}`),
        matchSchedules:
          zone?.matchSchedules && typeof zone.matchSchedules === "object"
            ? zone.matchSchedules
            : {},
        legacyDayKey: String(zone?.dayKey || ""),
        legacyStartTime: String(zone?.startTime || ""),
        legacyVenueId: String(zone?.venueId || ""),
        registrationIds,
      };
    })
    .filter((zone) => zone.id);

  return {
    confirmed: Boolean(rawPlanning?.confirmed),
    zones,
  };
}

function isSlotAvailable(registration = {}, dayKey = "", slotMinutes = 0) {
  const availability = registration?.availability?.[dayKey] || {};
  const quickSlots = getQuickSlotDefinitions();
  const quickRanges = (availability.quickSlots || [])
    .map((slotKey) => quickSlots.find((slot) => slot.key === slotKey))
    .filter(Boolean)
    .map((slot) => ({ from: slot.from, to: slot.to }));
  const customRanges = Array.isArray(availability.customSlots) ? availability.customSlots : [];

  return [...quickRanges, ...customRanges].some((range) => {
    const fromMinutes = parseMinutes(range.from);
    let toMinutes = parseMinutes(range.to);

    if (toMinutes <= fromMinutes) {
      toMinutes += 24 * 60;
    }

    return slotMinutes >= fromMinutes && slotMinutes < toMinutes;
  });
}

function getAvailabilityRangesForDay(registration = {}, dayKey = "") {
  const availability = registration?.availability?.[dayKey] || {};
  const quickSlots = getQuickSlotDefinitions();
  const quickRanges = (availability.quickSlots || [])
    .map((slotKey) => quickSlots.find((slot) => slot.key === slotKey))
    .filter(Boolean)
    .map((slot) => `${slot.from}-${slot.to}`);
  const customRanges = (Array.isArray(availability.customSlots) ? availability.customSlots : [])
    .map((slot) => `${slot.from}-${slot.to}`);

  return [...quickRanges, ...customRanges];
}

function normalizeZoneResultSets(sets = []) {
  return [0, 1, 2].map((index) => ({
    teamA: String(sets?.[index]?.teamA || ""),
    teamB: String(sets?.[index]?.teamB || ""),
  }));
}

function buildZoneResultText(result = {}) {
  const sets = normalizeZoneResultSets(result?.sets);
  return sets
    .filter((set) => set.teamA || set.teamB)
    .map((set) => `${set.teamA || "-"}-${set.teamB || "-"}`)
    .join(" ");
}

function getZoneMatchParticipants(zoneRegistrations = [], matchLabel = "") {
  const parts = String(matchLabel || "").match(/^(\d+)\s+vs\s+(\d+)$/i);

  if (!parts) {
    return [];
  }

  const firstIndex = Number.parseInt(parts[1], 10) - 1;
  const secondIndex = Number.parseInt(parts[2], 10) - 1;

  return [zoneRegistrations[firstIndex], zoneRegistrations[secondIndex]].filter(Boolean);
}

function getZoneMatchPairNumbers(zone = {}, zoneRegistrations = [], matchLabel = "") {
  const directParts = String(matchLabel || "").match(/^(\d+)\s+vs\s+(\d+)$/i);

  if (directParts) {
    return [directParts[1], directParts[2]];
  }

  if (zoneRegistrations.length !== 4 || !["G vs G", "P vs P"].includes(matchLabel)) {
    return [];
  }

  const openingMatches = ["1 vs 2", "3 vs 4"].map((openingMatchLabel) => {
    const openingParticipants = getZoneMatchParticipants(zoneRegistrations, openingMatchLabel);
    const openingResult = zone.matchSchedules?.[openingMatchLabel]?.result || {};
    const winnerIndex = openingParticipants.findIndex(
      (participant) => String(participant?.id || "") === String(openingResult.winnerRegistrationId || "")
    );
    const openingNumbers = openingMatchLabel.match(/^(\d+)\s+vs\s+(\d+)$/i);

    if (winnerIndex < 0 || !openingNumbers) {
      return null;
    }

    return {
      loser: openingNumbers[winnerIndex === 0 ? 2 : 1],
      winner: openingNumbers[winnerIndex + 1],
    };
  });

  if (openingMatches.some((entry) => !entry)) {
    return [];
  }

  return matchLabel === "G vs G"
    ? openingMatches.map((entry) => entry.winner)
    : openingMatches.map((entry) => entry.loser);
}

function getResolvedZoneMatchLabel(zone = {}, zoneRegistrations = [], matchLabel = "") {
  const pairNumbers = getZoneMatchPairNumbers(zone, zoneRegistrations, matchLabel);
  return pairNumbers.length === 2 ? `${pairNumbers[0]} vs ${pairNumbers[1]}` : matchLabel;
}

function getZoneMatchParticipantsForZone(zone = {}, zoneRegistrations = [], matchLabel = "") {
  const pairNumbers = getZoneMatchPairNumbers(zone, zoneRegistrations, matchLabel);

  if (pairNumbers.length !== 2) {
    return [];
  }

  return pairNumbers
    .map((pairNumber) => zoneRegistrations[Number.parseInt(pairNumber, 10) - 1])
    .filter(Boolean);
}

function getWinningPairNumber(zone = {}, zoneRegistrations = [], matchLabel = "", result = {}) {
  const participants = getZoneMatchParticipantsForZone(zone, zoneRegistrations, matchLabel);
  const winnerIndex = participants.findIndex(
    (participant) => String(participant?.id || "") === String(result?.winnerRegistrationId || "")
  );

  if (winnerIndex < 0) {
    return "";
  }

  return getZoneMatchPairNumbers(zone, zoneRegistrations, matchLabel)[winnerIndex] || "";
}

function getTournamentZoneMatchFormat(tournament = {}) {
  const value = tournament?.fixtureSetup?.matchFormat?.zones || tournament?.matchFormat?.zones;
  return ["third_set", "super_tiebreak", "single_set"].includes(value) ? value : "third_set";
}

function getTournamentRuleSet(tournament = {}) {
  const value = String(tournament?.tournamentRuleSet || tournament?.ruleSet || "fap").trim().toLowerCase();
  return value === "apa" ? "apa" : "fap";
}

function getZoneQualifiersCount(ruleSet = "fap", pairCount = 0) {
  if (ruleSet === "fap" && pairCount === 4) {
    return 3;
  }

  return Math.min(2, pairCount);
}

function parseSetNumber(value = "") {
  const numericValue = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function formatSignedValue(value = 0) {
  const numericValue = Number(value || 0);
  return numericValue > 0 ? `+${numericValue}` : String(numericValue);
}

function getSetWinnerSide(set = {}) {
  const teamA = parseSetNumber(set.teamA);
  const teamB = parseSetNumber(set.teamB);

  if (teamA === null || teamB === null || teamA === teamB) {
    return "";
  }

  return teamA > teamB ? "teamA" : "teamB";
}

function hasAnySetScore(sets = []) {
  return normalizeZoneResultSets(sets).some((set) => set.teamA || set.teamB);
}

function hasMatchResultData(schedule = {}) {
  return Boolean(
    schedule?.result?.winnerRegistrationId ||
      schedule?.resultText ||
      hasAnySetScore(schedule?.result?.sets || [])
  );
}

function pruneZoneMatchSchedulesForPairCount(matchSchedules = {}, pairCount = 0) {
  const allowedMatchKeys = new Set(buildZoneMatchRows(pairCount));

  return Object.entries(matchSchedules || {}).reduce((accumulator, [matchKey, schedule]) => {
    if (allowedMatchKeys.has(matchKey)) {
      accumulator[matchKey] = schedule;
    }

    return accumulator;
  }, {});
}

function getRemovedMatchKeysForPairCount(matchSchedules = {}, pairCount = 0) {
  const allowedMatchKeys = new Set(buildZoneMatchRows(pairCount));

  return Object.keys(matchSchedules || {}).filter((matchKey) => !allowedMatchKeys.has(matchKey));
}

function pairHasPlayedResult(zone = {}, zoneRegistrations = [], registrationId = "") {
  const pairNumber = String(
    zoneRegistrations.findIndex((registration) => String(registration.id) === String(registrationId)) + 1
  );

  if (pairNumber === "0") {
    return false;
  }

  return buildZoneMatchRows(zoneRegistrations.length).some((matchLabel) => {
    const resolvedPairNumbers = getZoneMatchPairNumbers(zone, zoneRegistrations, matchLabel);

    if (!resolvedPairNumbers.includes(pairNumber)) {
      return false;
    }

    return hasMatchResultData(zone.matchSchedules?.[matchLabel]);
  });
}

function buildZoneStandings(zone = {}, zoneRegistrations = [], matchFormat = "third_set") {
  const rowsById = zoneRegistrations.reduce((accumulator, registration) => {
    accumulator[registration.id] = {
      DG: 0,
      DIF: 0,
      name: registration.displayLabel,
      shortName: registration.shortDisplayLabel || registration.displayLabel,
      PJ: 0,
      PG: 0,
      PP: 0,
      registration,
      SC: 0,
      SF: 0,
    };
    return accumulator;
  }, {});

  buildZoneMatchRows(zoneRegistrations.length).forEach((matchLabel) => {
    const participants = getZoneMatchParticipantsForZone(zone, zoneRegistrations, matchLabel);
    const [teamARegistration, teamBRegistration] = participants;

    if (!teamARegistration || !teamBRegistration) {
      return;
    }

    const result = zone.matchSchedules?.[matchLabel]?.result || {};
    const sets = normalizeZoneResultSets(result.sets);
    const winnerId = String(result.winnerRegistrationId || "");

    if (!winnerId || !hasAnySetScore(sets)) {
      return;
    }

    const loserId = winnerId === String(teamARegistration.id)
      ? String(teamBRegistration.id)
      : String(teamARegistration.id);
    const winnerRow = rowsById[winnerId];
    const loserRow = rowsById[loserId];

    if (!winnerRow || !loserRow) {
      return;
    }

    winnerRow.PJ += 1;
    loserRow.PJ += 1;
    winnerRow.PG += 1;
    loserRow.PP += 1;

    sets.forEach((set, setIndex) => {
      const teamAScore = parseSetNumber(set.teamA);
      const teamBScore = parseSetNumber(set.teamB);
      const setWinnerSide = getSetWinnerSide(set);
      const isSuperTieBreakSet = matchFormat === "super_tiebreak" && setIndex === 2;

      if (teamAScore === null || teamBScore === null || !setWinnerSide) {
        return;
      }

      const teamARow = rowsById[String(teamARegistration.id)];
      const teamBRow = rowsById[String(teamBRegistration.id)];
      const teamAWonSet = setWinnerSide === "teamA";

      teamARow.SF += teamAWonSet ? 1 : 0;
      teamARow.SC += teamAWonSet ? 0 : 1;
      teamBRow.SF += teamAWonSet ? 0 : 1;
      teamBRow.SC += teamAWonSet ? 1 : 0;

      if (!isSuperTieBreakSet) {
        teamARow.DG += teamAScore - teamBScore;
        teamBRow.DG += teamBScore - teamAScore;
      }
    });
  });

  return Object.values(rowsById)
    .map((row) => ({ ...row, DIF: row.SF - row.SC }))
    .sort((first, second) => {
      if (second.PG !== first.PG) return second.PG - first.PG;
      if (second.PJ !== first.PJ) return second.PJ - first.PJ;
      if (second.DIF !== first.DIF) return second.DIF - first.DIF;
      if (second.DG !== first.DG) return second.DG - first.DG;
      if (second.SF !== first.SF) return second.SF - first.SF;
      return first.name.localeCompare(second.name);
    });
}

// Celda fija de la izquierda con el nombre de la pareja (columna que no se
// desplaza horizontalmente). Memoizada: al pintar/despintar una celda de
// disponibilidad solo cambia el objeto `registration` de ESA pareja (el
// resto conserva su referencia), asi que las demas filas no se re-renderizan.
const PairNameCell = memo(function PairNameCell({
  registration,
  isEditable,
  isSelected,
  zoneLetter,
  hoursStatus,
  onPress,
}) {
  const statusColor =
    hoursStatus.tone === "danger" ? colors.danger : hoursStatus.tone === "warning" ? "#B8860B" : "#0F5F37";

  return (
    <Pressable
      disabled={!isEditable}
      onPress={isEditable ? () => onPress(registration.id) : undefined}
      style={[
        styles.pairNameCell,
        { backgroundColor: registration.color?.bg || "#F6FBF8", borderColor: registration.color?.border || colors.border },
        !isEditable ? styles.pairNameCellReadOnly : null,
        isSelected ? styles.pairNameCellSelected : null,
      ]}
    >
      <View style={styles.pairNameCellTopRow}>
        <Text numberOfLines={2} style={[styles.pairNameCellText, { color: registration.color?.text || colors.text }]}>
          {registration.shortDisplayLabel || registration.displayLabel}
        </Text>
        {zoneLetter ? (
          <View style={styles.pairNameZoneBadge}>
            <Text style={styles.pairNameZoneBadgeText}>{zoneLetter}</Text>
          </View>
        ) : null}
      </View>
      <Text numberOfLines={1} style={[styles.pairNameStatusText, { color: statusColor }]}>
        {hoursStatus.label}
      </Text>
      {isSelected ? (
        <View style={styles.pairNameSelectedBadge}>
          <Ionicons color={colors.surface} name="checkmark" size={10} />
        </View>
      ) : null}
    </Pressable>
  );
},
(prev, next) =>
  prev.registration.id === next.registration.id &&
  prev.registration.availability === next.registration.availability &&
  prev.registration.color === next.registration.color &&
  prev.isEditable === next.isEditable &&
  prev.isSelected === next.isSelected &&
  prev.zoneLetter === next.zoneLetter &&
  prev.hoursStatus.label === next.hoursStatus.label &&
  prev.hoursStatus.tone === next.hoursStatus.tone
);

// Fila de celdas de disponibilidad de una pareja (dentro del ScrollView
// horizontal). Tambien memoizada por la misma razon que PairNameCell.
const PairCellsRow = memo(function PairCellsRow({ registration, hourColumns, selectedDayKey, isEditable, onToggleCell }) {
  return (
    <View style={styles.pairCellsRow}>
      {hourColumns.map((hour) => {
        const available = isSlotAvailable(registration, selectedDayKey, hour.minutes);
        return (
          <Pressable
            disabled={!isEditable}
            key={hour.minutes}
            onPress={isEditable ? () => onToggleCell(registration, hour.minutes) : undefined}
            style={[
              styles.hourCell,
              available
                ? { backgroundColor: registration.color?.fill || "#BFE8D0", borderColor: registration.color?.border || colors.border }
                : null,
              !isEditable ? styles.hourCellReadOnly : null,
            ]}
          />
        );
      })}
    </View>
  );
},
(prev, next) =>
  prev.registration.id === next.registration.id &&
  prev.registration.availability === next.registration.availability &&
  prev.registration.color === next.registration.color &&
  prev.hourColumns === next.hourColumns &&
  prev.selectedDayKey === next.selectedDayKey &&
  prev.isEditable === next.isEditable
);

export default function TournamentZonePlanningScreen({ navigation, route }) {
  const { userData } = useAuth();
  const tournamentId = route?.params?.tournamentId || "";
  const fallbackTournamentName = route?.params?.tournamentName || "Torneo";
  const [tournament, setTournament] = useState(null);
  const [registrations, setRegistrations] = useState([]);
  const [zonePlanning, setZonePlanning] = useState({ confirmed: false, zones: [] });
  const [selectedDayKey, setSelectedDayKey] = useState("");
  const [selectedRegistrationIds, setSelectedRegistrationIds] = useState([]);
  const [zoneDayPickerTarget, setZoneDayPickerTarget] = useState(null);
  const [zoneTimePickerTarget, setZoneTimePickerTarget] = useState(null);
  const [slotPickerTarget, setSlotPickerTarget] = useState(null);
  const [slotPickerActiveDay, setSlotPickerActiveDay] = useState("");
  const [slotPickerActiveVenueId, setSlotPickerActiveVenueId] = useState("");
  const [customTimeContext, setCustomTimeContext] = useState(null);
  const [customScheduleModal, setCustomScheduleModal] = useState(null);
  const insets = useSafeAreaInsets();
  const [resultEditor, setResultEditor] = useState(null);
  const [zoneDeleteTarget, setZoneDeleteTarget] = useState(null);
  const [confirmArmadoPrompt, setConfirmArmadoPrompt] = useState(null);
  // Datos completos (torneo + parejas + zonas) de TODAS las categorias
  // hermanas del evento, para mostrarlas en solo lectura debajo de la
  // categoria activa en la grilla. Para armar zonas de otra categoria hay que
  // cambiarla como categoria activa con el selector que ya existe
  // (onSelectCategory), esto es solo para mirar.
  const [siblingCategoriesData, setSiblingCategoriesData] = useState({});
  const [collapsedSiblingIds, setCollapsedSiblingIds] = useState(() => new Set());
  const [gridFilter, setGridFilter] = useState({ type: "all" });
  const { categoryOptions, onSelectCategory } = useTournamentCategorySwitcher(tournament, navigation);
  const [standingsModalZoneId, setStandingsModalZoneId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const savedPlanningRef = useRef({ confirmed: false, zones: [] });
  const [feedback, setFeedback] = useState({
    visible: false,
    title: "",
    message: "",
    tone: "default",
  });

  const loadScreen = useCallback(async () => {
    const [tournamentResponse, registrationsResponse] = await Promise.all([
      getTournamentById(tournamentId),
      listTournamentRegistrations(tournamentId),
    ]);
    const confirmedRegistrations = registrationsResponse.filter(isActiveRegistration);
    const dayOptions = buildTournamentDayOptions(tournamentResponse || {});

    setTournament(tournamentResponse);
    setRegistrations(registrationsResponse);
    const nextPlanning = normalizeZonePlanning(
      tournamentResponse?.zonePlanning || tournamentResponse?.fixtureSetup?.zonePlanning || {},
      confirmedRegistrations
    );
    savedPlanningRef.current = nextPlanning;
    setZonePlanning(nextPlanning);
    setSelectedDayKey((current) => current || dayOptions[0]?.key || "");
  }, [tournamentId]);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      const sync = async () => {
        try {
          setLoading(true);
          await loadScreen();
        } catch (error) {
          if (isMounted) {
            setFeedback({
              visible: true,
              title: "No pudimos cargar el armado",
              message: error?.message || "Intenta nuevamente en unos instantes.",
              tone: "danger",
            });
          }
        } finally {
          if (isMounted) {
            setLoading(false);
          }
        }
      };

      sync();

      return () => {
        isMounted = false;
      };
    }, [loadScreen])
  );

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      const siblingIds = categoryOptions.map((option) => option.value).filter((id) => id && id !== tournamentId);

      if (!siblingIds.length) {
        setSiblingCategoriesData({});
        return () => {
          isMounted = false;
        };
      }

      (async () => {
        try {
          const entries = await Promise.all(
            siblingIds.map(async (id) => {
              const [tournamentResponse, registrationsResponse] = await Promise.all([
                getTournamentById(id),
                listTournamentRegistrations(id),
              ]);
              const confirmedRegs = registrationsResponse
                .filter(isActiveRegistration)
                .map((registration, index) => ({
                  ...registration,
                  color: PAIR_COLORS[index % PAIR_COLORS.length],
                  displayLabel: getPairLabel(registration, index),
                  shortDisplayLabel: getShortPairLabel(registration, index),
                }));
              const planning = normalizeZonePlanning(
                tournamentResponse?.zonePlanning || tournamentResponse?.fixtureSetup?.zonePlanning || {},
                confirmedRegs
              );

              return [
                id,
                {
                  tournament: tournamentResponse,
                  confirmedRegistrations: confirmedRegs,
                  zonePlanning: planning,
                },
              ];
            })
          );

          if (isMounted) {
            setSiblingCategoriesData(Object.fromEntries(entries));
          }
        } catch {
          // Si falla, la grilla sigue mostrando solo la categoria activa.
          if (isMounted) {
            setSiblingCategoriesData({});
          }
        }
      })();

      return () => {
        isMounted = false;
      };
    }, [categoryOptions, tournamentId])
  );

  // Zonas (con sus matchSchedules) de TODAS las categorias hermanas del
  // evento, solo para saber que canchas ya estan ocupadas por otras
  // categorias (una pareja nunca puede estar en 2 categorias del mismo
  // evento, asi que las hermanas nunca aportan ocupacion por pareja, solo por
  // cancha). Es un fetch liviano (solo zonas), separado de
  // siblingCategoriesData (que trae ademas las parejas, para la grilla).
  const [siblingZonesForOccupancy, setSiblingZonesForOccupancy] = useState([]);
  const [eventVenueSchedules, setEventVenueSchedules] = useState([]);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      const batchId = tournament?.creationBatchId || "";

      if (!batchId) {
        setSiblingZonesForOccupancy([]);
        setEventVenueSchedules([]);
        return () => {
          isMounted = false;
        };
      }

      (async () => {
        try {
          const [siblings, venueSchedules] = await Promise.all([
            listTournamentsByBatchId(batchId),
            getTournamentEventVenueSchedules(batchId),
          ]);

          if (!isMounted) return;

          setSiblingZonesForOccupancy(
            siblings
              .filter((sibling) => sibling.id !== tournament?.id)
              .map((sibling) => ({
                tournamentId: sibling.id,
                categoryLabel:
                  sibling.compositionConfig?.label || sibling.compositionLabel || sibling.name || "",
                zones: Array.isArray(sibling.fixtureSetup?.zonePlanning?.zones)
                  ? sibling.fixtureSetup.zonePlanning.zones
                  : [],
              }))
          );
          setEventVenueSchedules(Array.isArray(venueSchedules) ? venueSchedules : []);
        } catch {
          // Si falla, se sigue validando solo contra la propia categoria.
          if (isMounted) {
            setSiblingZonesForOccupancy([]);
            setEventVenueSchedules([]);
          }
        }
      })();

      return () => {
        isMounted = false;
      };
    }, [tournament?.creationBatchId, tournament?.id])
  );

  const tournamentDayOptions = useMemo(() => buildTournamentDayOptions(tournament || {}), [tournament]);
  const tournamentVenueOptions = useMemo(() => buildTournamentVenueOptions(tournament || {}), [tournament]);
  const effectiveMatchDurationMinutes = useMemo(
    () => Number(tournament?.fixtureSetup?.matchDurationMinutes) || DEFAULT_MATCH_DURATION_MINUTES,
    [tournament?.fixtureSetup?.matchDurationMinutes]
  );
  const effectiveVenueSchedules = useMemo(() => {
    const schedules = tournament?.creationBatchId
      ? eventVenueSchedules
      : tournament?.fixtureSetup?.zoneVenueSchedules || [];
    return (Array.isArray(schedules) ? schedules : []).filter((schedule) => schedule.useForZones);
  }, [tournament?.creationBatchId, tournament?.fixtureSetup?.zoneVenueSchedules, eventVenueSchedules]);
  const tournamentRuleSet = useMemo(() => getTournamentRuleSet(tournament || {}), [tournament]);
  const zoneMatchFormat = useMemo(() => getTournamentZoneMatchFormat(tournament || {}), [tournament]);
  const usesSuperTieBreak = zoneMatchFormat === "super_tiebreak";
  const confirmedRegistrations = useMemo(
    () =>
      registrations
        .filter(isActiveRegistration)
        .map((registration, index) => ({
          ...registration,
          color: PAIR_COLORS[index % PAIR_COLORS.length],
          displayLabel: getPairLabel(registration, index),
          shortDisplayLabel: getShortPairLabel(registration, index),
        })),
    [registrations]
  );
  const registrationById = useMemo(
    () =>
      confirmedRegistrations.reduce((accumulator, registration) => {
        accumulator[registration.id] = registration;
        return accumulator;
      }, {}),
    [confirmedRegistrations]
  );
  const selectedRegistrations = selectedRegistrationIds
    .map((id) => registrationById[id])
    .filter(Boolean);
  const standingsModalZone = (zonePlanning.zones || []).find((zone) => zone.id === standingsModalZoneId);
  const standingsModalRegistrations = standingsModalZone
    ? (standingsModalZone.registrationIds || []).map((id) => registrationById[id]).filter(Boolean)
    : [];
  const standingsModalRows = standingsModalZone
    ? buildZoneStandings(standingsModalZone, standingsModalRegistrations, zoneMatchFormat)
    : [];
  const tournamentCategoryLabel =
    tournament?.compositionConfig?.label || tournament?.compositionLabel || tournament?.categoryLabel || "";

  const pairLabelsById = useMemo(() => {
    const map = {};
    confirmedRegistrations.forEach((registration) => {
      map[registration.id] = registration.shortDisplayLabel || registration.displayLabel;
    });
    return map;
  }, [confirmedRegistrations]);

  // Partidos ya agendados (propia categoria + hermanas del evento) para la
  // ocupacion de cancha/pareja que usa el modulo de validacion. Las hermanas
  // solo pueden pisar cancha, nunca pareja: un jugador no puede estar
  // inscripto en 2 categorias del mismo evento, asi que sus partidos van con
  // participantIds vacio (no aportan a la ocupacion por pareja).
  const scheduledMatchesForOccupancy = useMemo(() => {
    const ownMatches = [];

    (zonePlanning.zones || []).forEach((zone) => {
      const zoneRegistrations = (zone.registrationIds || [])
        .map((id) => registrationById[id])
        .filter(Boolean);

      Object.entries(zone.matchSchedules || {}).forEach(([matchKey, schedule]) => {
        if (!schedule?.startTime || !schedule?.dayKey) return;

        const participantIds = getZoneMatchParticipantsForZone(zone, zoneRegistrations, matchKey).map(
          (registration) => registration.id
        );

        ownMatches.push({
          tournamentId: tournament?.id || "",
          zoneId: zone.id,
          matchKey,
          categoryLabel: tournamentCategoryLabel,
          zoneLabel: zone.label,
          dayKey: schedule.dayKey,
          startMinutes: parseMinutes(schedule.startTime),
          venueId: schedule.venueId || "",
          courtIndex: Number(schedule.courtIndex || 0),
          participantIds,
        });
      });
    });

    const siblingMatches = [];

    siblingZonesForOccupancy.forEach((sibling) => {
      (sibling.zones || []).forEach((zone) => {
        Object.entries(zone.matchSchedules || {}).forEach(([matchKey, schedule]) => {
          if (!schedule?.startTime || !schedule?.dayKey) return;

          siblingMatches.push({
            tournamentId: sibling.tournamentId,
            zoneId: zone.id,
            matchKey,
            categoryLabel: sibling.categoryLabel,
            zoneLabel: zone.label,
            dayKey: schedule.dayKey,
            startMinutes: parseMinutes(schedule.startTime),
            venueId: schedule.venueId || "",
            courtIndex: Number(schedule.courtIndex || 0),
            participantIds: [],
          });
        });
      });
    });

    return [...ownMatches, ...siblingMatches];
  }, [zonePlanning.zones, registrationById, tournament?.id, tournamentCategoryLabel, siblingZonesForOccupancy]);

  const scheduleOccupancy = useMemo(
    () => buildScheduleOccupancy(scheduledMatchesForOccupancy, effectiveMatchDurationMinutes),
    [scheduledMatchesForOccupancy, effectiveMatchDurationMinutes]
  );

  // Para zonas de 4: en que horario terminan (si ya lo tienen) los partidos
  // de ida de esa zona, para que G vs G / P vs P no puedan empezar antes.
  const getZoneOpeningMatchesEndTimes = useCallback(
    (zone) => {
      if ((zone?.registrationIds || []).length !== 4) return [];

      return ["1 vs 2", "3 vs 4"]
        .map((openingMatchKey) => {
          const schedule = zone.matchSchedules?.[openingMatchKey];
          if (!schedule?.startTime || !schedule?.dayKey) return null;
          return {
            dayKey: schedule.dayKey,
            endMinutes: parseMinutes(schedule.startTime) + effectiveMatchDurationMinutes,
          };
        })
        .filter(Boolean);
    },
    [effectiveMatchDurationMinutes]
  );

  const slotsByDay = useMemo(() => {
    if (!slotPickerTarget) return [];
    const { zoneId, matchKey } = slotPickerTarget;
    const targetZone = (zonePlanning.zones || []).find((zone) => zone.id === zoneId);
    if (!targetZone) return [];

    const zoneRegistrations = (targetZone.registrationIds || [])
      .map((id) => registrationById[id])
      .filter(Boolean);
    const participantIds = getZoneMatchParticipantsForZone(targetZone, zoneRegistrations, matchKey).map(
      (registration) => registration.id
    );
    const dependsOn = ["G vs G", "P vs P"].includes(matchKey)
      ? getZoneOpeningMatchesEndTimes(targetZone)
      : [];

    const allSlots = buildZoneMatchSchedulingSlots(effectiveVenueSchedules, effectiveMatchDurationMinutes);
    const annotated = allSlots.map((slot) => {
      const result = validateMatchSlot({
        dayKey: slot.dayKey,
        startMinutes: slot.startMinutes,
        venueId: slot.venueId,
        courtIndex: slot.courtIndex,
        participantIds,
        excludeKey: { tournamentId: tournament?.id || "", zoneId, matchKey },
        occupancy: scheduleOccupancy,
        matchDurationMinutes: effectiveMatchDurationMinutes,
        restMinutes: DEFAULT_REST_MINUTES,
        dependsOn,
        pairLabelsById,
        availabilityWarning: participantIds.some(
          (pairId) => !isSlotAvailable(registrationById[pairId], slot.dayKey, slot.startMinutes)
        )
          ? "Este horario esta fuera de la disponibilidad cargada por alguna de las parejas."
          : "",
      });

      return {
        ...slot,
        hasConflict: result.hasConflict,
        conflictReason: result.conflictReason || "",
        availabilityWarning: result.availabilityWarning || "",
      };
    });

    const grouped = {};
    annotated.forEach((slot) => {
      if (!grouped[slot.dayKey]) grouped[slot.dayKey] = [];
      grouped[slot.dayKey].push(slot);
    });
    return tournamentDayOptions.filter((day) => grouped[day.key]).map((day) => ({
      dayKey: day.key,
      dayLabel: day.label,
      slots: grouped[day.key],
    }));
  }, [
    slotPickerTarget,
    zonePlanning.zones,
    registrationById,
    effectiveVenueSchedules,
    effectiveMatchDurationMinutes,
    scheduleOccupancy,
    pairLabelsById,
    getZoneOpeningMatchesEndTimes,
    tournament?.id,
    tournamentDayOptions,
  ]);

  const assignedIds = useMemo(
    () => new Set((zonePlanning.zones || []).flatMap((zone) => zone.registrationIds || [])),
    [zonePlanning.zones]
  );

  // Bloques por categoria para la grilla (activa + TODAS las hermanas, en
  // solo lectura), ordenados por el numero de la categoria (5ta antes que
  // 7ma antes que 8va). A diferencia de la version anterior, las hermanas ya
  // no son opcionales: se muestran siempre que existan, plegables.
  const allCategoryBlocks = useMemo(() => {
    const activeZones = zonePlanning.zones || [];
    const activeBlock = {
      tournamentId,
      categoryLabel: tournamentCategoryLabel,
      isActive: true,
      confirmedRegistrations: sortRegistrationsUnassignedFirst(
        confirmedRegistrations,
        assignedIds,
        buildZoneLetterMapForZones(activeZones)
      ),
      zones: activeZones,
      assignedIds,
    };

    const siblingBlocks = Object.entries(siblingCategoriesData).map(([id, data]) => {
      const label =
        data.tournament?.compositionConfig?.label ||
        data.tournament?.compositionLabel ||
        data.tournament?.categoryLabel ||
        "";
      const siblingZones = data.zonePlanning.zones || [];
      const siblingAssignedIds = new Set(siblingZones.flatMap((zone) => zone.registrationIds || []));

      return {
        tournamentId: id,
        categoryLabel: label,
        isActive: false,
        confirmedRegistrations: sortRegistrationsUnassignedFirst(
          data.confirmedRegistrations,
          siblingAssignedIds,
          buildZoneLetterMapForZones(siblingZones)
        ),
        zones: siblingZones,
        assignedIds: siblingAssignedIds,
      };
    });

    return [activeBlock, ...siblingBlocks].sort(
      (first, second) =>
        extractCategoryOrderNumber(first.categoryLabel) - extractCategoryOrderNumber(second.categoryLabel)
    );
  }, [tournamentId, tournamentCategoryLabel, confirmedRegistrations, zonePlanning.zones, assignedIds, siblingCategoriesData]);

  // ── Grilla nueva (filas = pareja, columnas = hora) ─────────────────────────
  const hourColumns = useMemo(
    () => getHourColumnsForDay(effectiveVenueSchedules, selectedDayKey),
    [effectiveVenueSchedules, selectedDayKey]
  );

  const zoneLetterMapsByBlock = useMemo(() => {
    const map = new Map();
    allCategoryBlocks.forEach((block) => {
      map.set(block.tournamentId, buildZoneLetterMapForZones(block.zones));
    });
    return map;
  }, [allCategoryBlocks]);

  const categoryFilterOptions = useMemo(
    () =>
      allCategoryBlocks.map((block, index) => ({
        tournamentId: block.tournamentId,
        label: block.categoryLabel || (block.isActive ? "Esta categoria" : "Categoria"),
        count: block.confirmedRegistrations.length,
        colorIndex: index,
      })),
    [allCategoryBlocks]
  );

  const gridRows = useMemo(() => {
    const rows = [];

    allCategoryBlocks.forEach((block, blockIndex) => {
      if (gridFilter.type === "category" && block.tournamentId !== gridFilter.tournamentId) {
        return;
      }

      const isCollapsed = !block.isActive && collapsedSiblingIds.has(block.tournamentId);
      rows.push({
        block,
        colorIndex: blockIndex,
        isCollapsed,
        key: `header:${block.tournamentId}`,
        type: "category-header",
      });

      if (isCollapsed) {
        return;
      }

      const zoneLetterMap = zoneLetterMapsByBlock.get(block.tournamentId) || new Map();

      block.confirmedRegistrations
        .filter((registration) => {
          if (gridFilter.type === "problems") {
            return getTotalLoadedHours(registration) < 4;
          }
          if (gridFilter.type === "unassigned") {
            return !block.assignedIds.has(registration.id);
          }
          return true;
        })
        .forEach((registration) => {
          rows.push({
            block,
            colorIndex: blockIndex,
            key: `pair:${block.tournamentId}:${registration.id}`,
            registration,
            type: "pair",
            zoneLetter: zoneLetterMap.get(String(registration.id)) || "",
          });
        });

      rows.push({ block, colorIndex: blockIndex, key: `coinciden:${block.tournamentId}`, type: "coinciden" });
    });

    if (rows.length) {
      rows.push({ key: "canchas-ocupadas", type: "canchas-ocupadas" });
    }

    return rows;
  }, [allCategoryBlocks, gridFilter, collapsedSiblingIds, zoneLetterMapsByBlock]);

  const toggleSiblingCollapsed = useCallback((siblingTournamentId) => {
    setCollapsedSiblingIds((current) => {
      const next = new Set(current);
      if (next.has(siblingTournamentId)) {
        next.delete(siblingTournamentId);
      } else {
        next.add(siblingTournamentId);
      }
      return next;
    });
  }, []);

  const countPairsAvailableAtHour = useCallback(
    (block, hourMinutes) =>
      block.confirmedRegistrations.filter((registration) => isSlotAvailable(registration, selectedDayKey, hourMinutes))
        .length,
    [selectedDayKey]
  );

  const getCourtsAvailableAtHour = useCallback(
    (hourMinutes) => {
      let total = 0;
      effectiveVenueSchedules
        .filter((schedule) => schedule.dayKey === selectedDayKey)
        .forEach((schedule) => {
          const from = parseMinutes(schedule.from);
          const to = parseMinutes(schedule.to);
          if (hourMinutes >= from && hourMinutes < to) {
            total += Array.isArray(schedule.selectedCourtIndices) && schedule.selectedCourtIndices.length
              ? schedule.selectedCourtIndices.length
              : Number(schedule.courts || 1);
          }
        });
      return total;
    },
    [effectiveVenueSchedules, selectedDayKey]
  );

  const countMatchesAtHour = useCallback(
    (hourMinutes) =>
      scheduledMatchesForOccupancy.filter(
        (match) =>
          match.dayKey === selectedDayKey &&
          match.startMinutes < hourMinutes + 60 &&
          match.startMinutes + effectiveMatchDurationMinutes > hourMinutes
      ).length,
    [scheduledMatchesForOccupancy, selectedDayKey, effectiveMatchDurationMinutes]
  );

  const handleToggleAvailabilityCell = useCallback(
    (registration, hourMinutes) => {
      const wasAvailable = isSlotAvailable(registration, selectedDayKey, hourMinutes);
      const hasAssignedMatchHere = (scheduleOccupancy.byPair.get(registration.id) || []).some(
        (entry) =>
          entry.dayKey === selectedDayKey &&
          hourMinutes < entry.endMinutes &&
          hourMinutes + 60 > entry.startMinutes
      );

      const applyToggle = async () => {
        const previousAvailability = registration.availability;
        const nextAvailability = buildAvailabilityAfterCellToggle(
          registration,
          selectedDayKey,
          hourMinutes,
          tournamentDayOptions
        );

        setRegistrations((current) =>
          current.map((entry) =>
            entry.id === registration.id ? { ...entry, availability: nextAvailability } : entry
          )
        );

        try {
          await updateTournamentRegistration(tournamentId, registration.id, { availability: nextAvailability });
        } catch (error) {
          setRegistrations((current) =>
            current.map((entry) =>
              entry.id === registration.id ? { ...entry, availability: previousAvailability } : entry
            )
          );
          setFeedback({
            visible: true,
            title: "No pudimos guardar la disponibilidad",
            message: error?.message || "El cambio se deshizo, intenta nuevamente.",
            tone: "danger",
          });
        }
      };

      if (wasAvailable && hasAssignedMatchHere) {
        Alert.alert(
          "Tiene un partido asignado",
          `${registration.shortDisplayLabel || registration.displayLabel} tiene un partido asignado el ${getWeekdayLabel(
            selectedDayKey
          )} ${formatMinutesToTime(hourMinutes)}. ¿Quitar igual esta disponibilidad?`,
          [
            { style: "cancel", text: "Cancelar" },
            { onPress: () => applyToggle(), text: "Quitar igual" },
          ]
        );
        return;
      }

      applyToggle();
    },
    [selectedDayKey, scheduleOccupancy, tournamentDayOptions, tournamentId]
  );

  const hasUnsavedChanges = useMemo(
    () => !areJsonEqual(zonePlanning, savedPlanningRef.current),
    [zonePlanning]
  );
  const unassignedRegistrations = useMemo(
    () => confirmedRegistrations.filter((registration) => !assignedIds.has(registration.id)),
    [assignedIds, confirmedRegistrations]
  );

  const getZonePlanningChangeType = (previousPlanning = {}, nextPlanning = {}) => {
    const previousZones = previousPlanning?.zones || [];
    const nextZones = nextPlanning?.zones || [];

    if (!previousZones.length) {
      return nextZones.length ? "additive" : "none";
    }

    if (areJsonEqual(previousPlanning, nextPlanning)) {
      return "none";
    }

    const nextZoneById = new Map(nextZones.map((zone) => [String(zone.id), zone]));

    for (const previousZone of previousZones) {
      const nextZone = nextZoneById.get(String(previousZone.id));

      if (!nextZone) {
        return "structural";
      }

      const previousRegistrationIds = (previousZone.registrationIds || []).map(String);
      const nextRegistrationIds = (nextZone.registrationIds || []).map(String);

      if (nextRegistrationIds.length < previousRegistrationIds.length) {
        return "structural";
      }

      const preservesExistingOrder = previousRegistrationIds.every(
        (registrationId, index) => nextRegistrationIds[index] === registrationId
      );

      if (!preservesExistingOrder) {
        return "structural";
      }

      const previousSchedules = previousZone.matchSchedules || {};
      const nextSchedules = nextZone.matchSchedules || {};
      const schedulesChanged = Object.keys(previousSchedules).some(
        (matchKey) => !areJsonEqual(previousSchedules[matchKey], nextSchedules[matchKey])
      );

      if (schedulesChanged) {
        return "structural";
      }
    }

    return "additive";
  };

  const toggleRegistrationSelection = (registrationId) => {
    setSelectedRegistrationIds((current) =>
      current.includes(registrationId)
        ? current.filter((id) => id !== registrationId)
        : [...current, registrationId]
    );
  };

  const createZoneFromSelection = () => {
    const selectedIds = selectedRegistrationIds.filter((id) => registrationById[id]);
    const alreadyAssignedPairs = selectedIds
      .filter((id) => assignedIds.has(id))
      .map((id) => registrationById[id]?.displayLabel || "Pareja");

    if (alreadyAssignedPairs.length) {
      setFeedback({
        visible: true,
        title: "Pareja ya asignada",
        message: `${alreadyAssignedPairs.join(" / ")} ya esta en una zona prearmada. Para usarla en otra zona, primero quitala de su zona actual o agregala a una zona existente.`,
        tone: "danger",
      });
      return;
    }

    if (selectedIds.length < 2 || selectedIds.length > 4) {
      setFeedback({
        visible: true,
        title: "Seleccion invalida",
        message: "Selecciona 2, 3 o 4 parejas para armar una zona.",
        tone: "danger",
      });
      return;
    }

    setZonePlanning((current) => {
      const cleanZones = (current.zones || []).map((zone) => ({
        ...zone,
        registrationIds: (zone.registrationIds || []).filter((id) => !selectedIds.includes(id)),
      }));
      const nextZone = {
        ...buildEmptyZone(cleanZones.length),
        matchSchedules: {},
        registrationIds: selectedIds,
      };

      return {
        ...current,
        confirmed: false,
        zones: [...cleanZones, nextZone],
      };
    });
    setSelectedRegistrationIds([]);
  };

  const validateAddPairToZone = (zone = {}, selectedId = "") => {
    if (!selectedId || !zone?.id) {
      return { ok: false, message: "Selecciona una pareja para agregar." };
    }

    if ((zone.registrationIds || []).includes(selectedId)) {
      return { ok: false, message: "Esa pareja ya esta en esta zona." };
    }

    const nextPairCount = (zone.registrationIds || []).length + 1;

    if (nextPairCount > 4) {
      return { ok: false, message: "Cada zona puede tener hasta 4 parejas." };
    }

    const removedMatchKeys = getRemovedMatchKeysForPairCount(zone.matchSchedules, nextPairCount);
    const removedMatchWithResult = removedMatchKeys.find((matchKey) =>
      hasMatchResultData(zone.matchSchedules?.[matchKey])
    );

    if (removedMatchWithResult) {
      return {
        ok: false,
        message: `No se puede agregar porque el cruce ${removedMatchWithResult} ya tiene resultado cargado y dejaria de existir con la nueva logica.`,
      };
    }

    const sourceZone = (zonePlanning.zones || []).find(
      (entry) => entry.id !== zone.id && (entry.registrationIds || []).includes(selectedId)
    );

    if (sourceZone) {
      const sourceRegistrations = (sourceZone.registrationIds || [])
        .map((id) => registrationById[id])
        .filter(Boolean);

      if (pairHasPlayedResult(sourceZone, sourceRegistrations, selectedId)) {
        return {
          ok: false,
          message: "No se puede mover esta pareja porque ya tiene un resultado cargado en su zona actual.",
        };
      }
    }

    return { ok: true };
  };

  const addSelectedPairToZone = (zoneId) => {
    const selectedId = selectedRegistrationIds.find((id) => registrationById[id]);

    if (!selectedId) {
      return;
    }

    const targetZone = (zonePlanning.zones || []).find((zone) => zone.id === zoneId);
    const validation = validateAddPairToZone(targetZone, selectedId);

    if (!validation.ok) {
      setFeedback({
        visible: true,
        title: "No se puede agregar",
        message: validation.message,
        tone: "warning",
      });
      return;
    }

    setZonePlanning((current) => ({
      ...current,
      confirmed: false,
      zones: (current.zones || []).map((zone) => {
        const nextRegistrationIds =
          zone.id === zoneId
            ? [...(zone.registrationIds || []).filter((id) => id !== selectedId), selectedId]
            : (zone.registrationIds || []).filter((id) => id !== selectedId);

        return {
          ...zone,
          matchSchedules: pruneZoneMatchSchedulesForPairCount(
            zone.matchSchedules,
            nextRegistrationIds.length
          ),
          registrationIds: nextRegistrationIds,
        };
      }),
    }));
    setSelectedRegistrationIds([]);
  };

  const validateRemovePairFromZone = (zone = {}, zoneRegistrations = [], registrationId = "") => {
    if (pairHasPlayedResult(zone, zoneRegistrations, registrationId)) {
      return {
        ok: false,
        message: "Esta pareja ya tiene un resultado cargado en la zona. Para quitarla, primero elimina el resultado del partido.",
      };
    }

    const removedIndex = (zone.registrationIds || []).findIndex(
      (id) => String(id) === String(registrationId)
    );
    const currentPairCount = (zone.registrationIds || []).length;
    const nextPairCount = Math.max(currentPairCount - 1, 0);
    const zoneHasAnyResult = Object.values(zone.matchSchedules || {}).some(hasMatchResultData);

    if (removedIndex >= 0 && removedIndex < currentPairCount - 1 && zoneHasAnyResult) {
      return {
        ok: false,
        message: "No se puede quitar porque hay resultados cargados y se reordenaria la numeracion de las parejas.",
      };
    }

    const removedMatchKeys = getRemovedMatchKeysForPairCount(zone.matchSchedules, nextPairCount);
    const removedMatchWithResult = removedMatchKeys.find((matchKey) =>
      hasMatchResultData(zone.matchSchedules?.[matchKey])
    );

    if (removedMatchWithResult) {
      return {
        ok: false,
        message: `No se puede quitar porque el cruce ${removedMatchWithResult} ya tiene resultado cargado.`,
      };
    }

    return { ok: true };
  };

  const removePairFromZone = (zoneId, registrationId) => {
    const targetZone = (zonePlanning.zones || []).find((zone) => zone.id === zoneId);
    const zoneRegistrations = (targetZone?.registrationIds || [])
      .map((id) => registrationById[id])
      .filter(Boolean);
    const validation = validateRemovePairFromZone(targetZone, zoneRegistrations, registrationId);

    if (!validation.ok) {
      setFeedback({
        visible: true,
        title: "No se puede quitar",
        message: validation.message,
        tone: "warning",
      });
      return;
    }

    setZonePlanning((current) => ({
      ...current,
      confirmed: false,
      zones: (current.zones || []).map((zone) =>
        zone.id === zoneId
          ? (() => {
              const removedIndex = (zone.registrationIds || []).findIndex(
                (id) => String(id) === String(registrationId)
              );
              const nextRegistrationIds = (zone.registrationIds || []).filter(
                (id) => id !== registrationId
              );
              const shouldPreserveSchedules = removedIndex === (zone.registrationIds || []).length - 1;

              return {
              ...zone,
                matchSchedules: shouldPreserveSchedules
                  ? pruneZoneMatchSchedulesForPairCount(zone.matchSchedules, nextRegistrationIds.length)
                  : {},
                registrationIds: nextRegistrationIds,
              };
            })()
          : zone
      ),
    }));
  };

  const updateZoneMatchSchedule = (zoneId, matchKey, patch = {}) => {
    setZonePlanning((current) => ({
      ...current,
      confirmed: false,
      zones: (current.zones || []).map((zone) =>
        zone.id === zoneId
          ? {
              ...zone,
              matchSchedules: {
                ...(zone.matchSchedules || {}),
                [matchKey]: {
                  ...(zone.matchSchedules?.[matchKey] || {}),
                  ...patch,
                },
              },
            }
          : zone
      ),
    }));
  };

  const handleZoneTimePickerChange = (_, selectedDate) => {
    if (zoneTimePickerTarget?.zoneId && zoneTimePickerTarget?.matchKey && selectedDate) {
      const nextTime = `${formatTwoDigits(selectedDate.getHours())}:${formatTwoDigits(
        selectedDate.getMinutes()
      )}`;
      if (customTimeContext) {
        setCustomScheduleModal({
          zoneId: zoneTimePickerTarget.zoneId,
          matchKey: zoneTimePickerTarget.matchKey,
          dayKey: customTimeContext.dayKey,
          startTime: nextTime,
          venueId: customTimeContext.venueId,
          courtIndex: customTimeContext.courtIndex || 1,
        });
        setCustomTimeContext(null);
      } else {
        updateZoneMatchSchedule(zoneTimePickerTarget.zoneId, zoneTimePickerTarget.matchKey, {
          startTime: nextTime,
        });
      }
    }

    if (Platform.OS !== "ios") {
      setZoneTimePickerTarget(null);
    }
  };

  // Conflicto EN VIVO de un partido YA guardado (para marcarlo en rojo en la
  // tabla de cruces), contra el resto de la ocupacion (propia + hermanas). Se
  // recalcula en cada render a partir de zonePlanning/siblingZonesForOccupancy,
  // asi que se resuelve solo apenas se cambia cualquiera de los partidos
  // involucrados. No mira disponibilidad cargada (eso es solo al elegir un
  // horario nuevo, no una marca persistente).
  const getMatchConflict = useCallback(
    (zone, matchKey) => {
      const schedule = getZoneMatchSchedule(zone, matchKey);
      if (!schedule.startTime || !schedule.dayKey) {
        return { hasConflict: false, conflictReason: "" };
      }

      const zoneRegistrations = (zone.registrationIds || [])
        .map((id) => registrationById[id])
        .filter(Boolean);
      const participantIds = getZoneMatchParticipantsForZone(zone, zoneRegistrations, matchKey).map(
        (registration) => registration.id
      );
      const dependsOn = ["G vs G", "P vs P"].includes(matchKey) ? getZoneOpeningMatchesEndTimes(zone) : [];

      const result = validateMatchSlot({
        dayKey: schedule.dayKey,
        startMinutes: parseMinutes(schedule.startTime),
        venueId: schedule.venueId || "",
        courtIndex: Number(schedule.courtIndex || 0),
        participantIds,
        excludeKey: { tournamentId: tournament?.id || "", zoneId: zone.id, matchKey },
        occupancy: scheduleOccupancy,
        matchDurationMinutes: effectiveMatchDurationMinutes,
        restMinutes: DEFAULT_REST_MINUTES,
        dependsOn,
        pairLabelsById,
      });

      return { hasConflict: result.hasConflict, conflictReason: result.conflictReason || "" };
    },
    [registrationById, getZoneOpeningMatchesEndTimes, tournament?.id, scheduleOccupancy, effectiveMatchDurationMinutes, pairLabelsById]
  );

  const validateCustomSchedule = (zoneId, matchKey, dayKey, startTime, venueId, courtIndex) => {
    const targetZone = (zonePlanning.zones || []).find((zone) => zone.id === zoneId);
    if (!targetZone) return { hasConflict: false, conflictReason: "", availabilityWarning: "" };

    const zoneRegistrations = (targetZone.registrationIds || [])
      .map((id) => registrationById[id])
      .filter(Boolean);
    const participantIds = getZoneMatchParticipantsForZone(targetZone, zoneRegistrations, matchKey).map(
      (registration) => registration.id
    );
    const dependsOn = ["G vs G", "P vs P"].includes(matchKey)
      ? getZoneOpeningMatchesEndTimes(targetZone)
      : [];
    const startMinutes = parseMinutes(startTime);

    const result = validateMatchSlot({
      dayKey,
      startMinutes,
      venueId,
      courtIndex,
      participantIds,
      excludeKey: { tournamentId: tournament?.id || "", zoneId, matchKey },
      occupancy: scheduleOccupancy,
      matchDurationMinutes: effectiveMatchDurationMinutes,
      restMinutes: DEFAULT_REST_MINUTES,
      dependsOn,
      pairLabelsById,
      availabilityWarning: participantIds.some(
        (pairId) => !isSlotAvailable(registrationById[pairId], dayKey, startMinutes)
      )
        ? "Este horario esta fuera de la disponibilidad cargada por alguna de las parejas."
        : "",
    });

    return {
      hasConflict: result.hasConflict,
      conflictReason: result.conflictReason || "",
      availabilityWarning: result.availabilityWarning || "",
    };
  };

  const handleConfirmCustomSchedule = () => {
    if (!customScheduleModal) return;
    updateZoneMatchSchedule(customScheduleModal.zoneId, customScheduleModal.matchKey, {
      startTime: customScheduleModal.startTime,
      dayKey: customScheduleModal.dayKey,
      venueId: customScheduleModal.venueId,
      courtIndex: customScheduleModal.courtIndex,
    });
    setCustomScheduleModal(null);
  };

  const closeSlotPicker = () => {
    setSlotPickerTarget(null);
    setSlotPickerActiveDay("");
    setSlotPickerActiveVenueId("");
  };

  const openSlotPicker = (target) => {
    setSlotPickerTarget(target);
    setSlotPickerActiveDay(target.currentDayKey || "");
    setSlotPickerActiveVenueId(target.currentVenueId || "");
  };

  const applySelectedSlot = (slot) => {
    if (!slotPickerTarget) return;
    updateZoneMatchSchedule(slotPickerTarget.zoneId, slotPickerTarget.matchKey, {
      startTime: formatMinutesToTime(slot.startMinutes),
      dayKey: slot.dayKey,
      venueId: slot.venueId,
      courtIndex: slot.courtIndex,
    });
    closeSlotPicker();
  };

  const handleSelectSlot = (slot) => {
    if (!slotPickerTarget) return;

    const reason = slot.conflictReason || slot.availabilityWarning;

    if (reason) {
      Alert.alert("Horario con conflicto", `${reason}. ¿Asignar igual?`, [
        { style: "cancel", text: "Cancelar" },
        { onPress: () => applySelectedSlot(slot), text: "Asignar igual" },
      ]);
      return;
    }

    applySelectedSlot(slot);
  };

  const handleClearSlot = () => {
    if (!slotPickerTarget) return;
    updateZoneMatchSchedule(slotPickerTarget.zoneId, slotPickerTarget.matchKey, {
      startTime: "",
      dayKey: "",
      venueId: "",
      courtIndex: 0,
    });
    closeSlotPicker();
  };

  const getZoneMatchSchedule = (zone = {}, matchKey = "") => {
    const schedule = zone.matchSchedules?.[matchKey] || {};
    const defaultVenueId = tournamentVenueOptions.length === 1 ? tournamentVenueOptions[0].id : "";

    return {
      dayKey: schedule.dayKey || zone.legacyDayKey || selectedDayKey || tournamentDayOptions[0]?.key || "",
      result: schedule.result && typeof schedule.result === "object" ? schedule.result : {},
      resultText: String(schedule.resultText || buildZoneResultText(schedule.result || {})),
      startTime: schedule.startTime || zone.legacyStartTime || "",
      venueId: schedule.venueId || zone.legacyVenueId || defaultVenueId,
    };
  };

  const openResultEditor = (zone, matchKey, currentSchedule = {}, zoneRegistrations = []) => {
    const currentResult = currentSchedule.result || {};
    setResultEditor({
      matchKey,
      participants: getZoneMatchParticipantsForZone(zone, zoneRegistrations, matchKey),
      sets: normalizeZoneResultSets(currentResult.sets),
      winnerRegistrationId: String(currentResult.winnerRegistrationId || ""),
      zoneId: zone.id,
    });
  };

  const validateResultEditor = (editor = resultEditor) => {
    if (!editor?.zoneId || !editor?.matchKey) {
      return { ok: true };
    }

    const sets = normalizeZoneResultSets(editor.sets);
    const hasScore = hasAnySetScore(sets);
    const winner = (editor.participants || []).find(
      (participant) => String(participant.id) === editor.winnerRegistrationId
    );

    if ((hasScore || editor.winnerRegistrationId) && !winner) {
      return {
        message: "Para guardar o salir de un resultado cargado, selecciona la pareja ganadora.",
        ok: false,
        title: "Falta seleccionar ganador",
      };
    }

    if (hasScore || winner) {
      const firstTwoSetsAreComplete = [0, 1].every((index) => Boolean(getSetWinnerSide(sets[index])));
      const thirdSetHasScore = Boolean(sets[2]?.teamA || sets[2]?.teamB);
      const thirdSetIsComplete = !thirdSetHasScore || Boolean(getSetWinnerSide(sets[2]));

      if (!firstTwoSetsAreComplete || !thirdSetIsComplete) {
        return {
          message: usesSuperTieBreak
            ? "SET 1, SET 2 y SUPER TIE BREAK, si se carga, deben tener ganador."
            : "SET 1 y SET 2 deben tener ganador. Si cargas SET 3, tambien debe tener ganador.",
          ok: false,
          title: "Resultado incompleto",
        };
      }
    }

    return { ok: true, sets, winner };
  };

  const showResultValidationFeedback = (validation) => {
    setFeedback({
      visible: true,
      title: validation.title || "Resultado incompleto",
      message: validation.message || "Completa el resultado para continuar.",
      tone: "danger",
    });
  };

  const closeResultEditor = () => {
    const validation = validateResultEditor();

    if (!validation.ok) {
      showResultValidationFeedback(validation);
      return;
    }

    setResultEditor(null);
  };

  const saveResultEditor = () => {
    if (!resultEditor?.zoneId || !resultEditor?.matchKey) {
      closeResultEditor();
      return;
    }

    const validation = validateResultEditor();

    if (!validation.ok) {
      showResultValidationFeedback(validation);
      return;
    }

    const sets = validation.sets || normalizeZoneResultSets(resultEditor.sets);
    const winner = validation.winner;
    const result = {
      score: buildZoneResultText({ sets }),
      sets,
      winnerLabel: winner?.displayLabel || "",
      winnerRegistrationId: resultEditor.winnerRegistrationId || "",
    };

    updateZoneMatchSchedule(resultEditor.zoneId, resultEditor.matchKey, {
      result,
      resultText: result.score,
    });
    closeResultEditor();
  };

  const updateResultSetScore = (setIndex, value) => {
    setResultEditor((current) =>
      current
        ? (() => {
            const sets = normalizeZoneResultSets(current.sets);
            const currentSet = sets[setIndex] || {};
            const rawValue = String(value || "");
            const isSuperTieBreakSet = usesSuperTieBreak && setIndex === 2;
            const currentValue = isSuperTieBreakSet
              ? `${currentSet.teamA}${currentSet.teamA.length >= 2 ? "/" : ""}${currentSet.teamB}`
              : `${currentSet.teamA}${currentSet.teamA ? "/" : ""}${currentSet.teamB}`;
            const maxDigits = isSuperTieBreakSet ? 4 : 2;
            const digits =
              rawValue === currentSet.teamA && currentSet.teamA && !currentSet.teamB && currentValue.endsWith("/")
                ? ""
                : rawValue.replace(/[^\d]/g, "").slice(0, maxDigits);
            const teamA = isSuperTieBreakSet ? digits.slice(0, 2) : digits[0] || "";
            const teamB = isSuperTieBreakSet ? digits.slice(2, 4) : digits[1] || "";

            return {
              ...current,
              sets: sets.map((set, index) =>
                index === setIndex
                  ? {
                      ...set,
                      teamA,
                      teamB,
                    }
                  : set
              ),
            };
          })()
        : current
    );
  };

  const sortZoneMatchRows = (zone = {}, matchRows = []) => {
    const dayIndexByKey = tournamentDayOptions.reduce((accumulator, day, index) => {
      accumulator[day.key] = index;
      return accumulator;
    }, {});

    return [...matchRows].sort((first, second) => {
      const firstSchedule = getZoneMatchSchedule(zone, first);
      const secondSchedule = getZoneMatchSchedule(zone, second);
      const firstDayIndex = dayIndexByKey[firstSchedule.dayKey] ?? Number.MAX_SAFE_INTEGER;
      const secondDayIndex = dayIndexByKey[secondSchedule.dayKey] ?? Number.MAX_SAFE_INTEGER;

      if (firstDayIndex !== secondDayIndex) {
        return firstDayIndex - secondDayIndex;
      }

      const firstTime = firstSchedule.startTime ? parseMinutes(firstSchedule.startTime) : Number.MAX_SAFE_INTEGER;
      const secondTime = secondSchedule.startTime ? parseMinutes(secondSchedule.startTime) : Number.MAX_SAFE_INTEGER;

      return firstTime - secondTime;
    });
  };

  const openZoneDayPicker = (zone, matchKey) => {
    if (!zone?.id || !matchKey || !tournamentDayOptions.length) {
      return;
    }

    const zoneRegistrations = (zone.registrationIds || [])
      .map((id) => registrationById[id])
      .filter(Boolean);
    const pairNumbers = getZoneMatchPairNumbers(zone, zoneRegistrations, matchKey);
    const participants = getZoneMatchParticipantsForZone(zone, zoneRegistrations, matchKey).map(
      (registration, index) => ({
        color: registration.color || PAIR_COLORS[index % PAIR_COLORS.length],
        id: registration.id,
        name: registration.shortDisplayLabel || registration.displayLabel || `Pareja ${pairNumbers[index] || index + 1}`,
        number: pairNumbers[index] || index + 1,
      })
    );
    const schedule = getZoneMatchSchedule(zone, matchKey);
    setZoneDayPickerTarget({
      currentDayKey: schedule.dayKey,
      matchKey,
      participants,
      zoneId: zone.id,
    });
  };

  const closeZoneDayPicker = () => {
    setZoneDayPickerTarget(null);
  };

  const selectZoneMatchDay = (dayKey) => {
    if (!zoneDayPickerTarget?.zoneId || !zoneDayPickerTarget?.matchKey || !dayKey) {
      closeZoneDayPicker();
      return;
    }

    updateZoneMatchSchedule(zoneDayPickerTarget.zoneId, zoneDayPickerTarget.matchKey, {
      dayKey,
      startTime: "",
    });
    closeZoneDayPicker();
  };

  // Antes esto iba rotando de sede con cada toque, sin avisar si la sede
  // nueva generaba conflicto. Ahora abre el mismo cartel de "Definir
  // horario" (con sus chips de sede/cancha y el aviso de conflicto), para
  // elegir en vez de ir rotando a ciegas.
  const openZoneVenuePicker = (zone, matchKey) => {
    const schedule = getZoneMatchSchedule(zone, matchKey);
    setCustomScheduleModal({
      zoneId: zone.id,
      matchKey,
      dayKey: schedule.dayKey || tournamentDayOptions[0]?.key || "",
      startTime: schedule.startTime || "19:00",
      venueId: schedule.venueId || tournamentVenueOptions[0]?.id || "",
      courtIndex: schedule.courtIndex || 1,
    });
  };

  const removeZone = (zoneId) => {
    setZonePlanning((current) => ({
      ...current,
      confirmed: false,
      zones: (current.zones || []).filter((zone) => zone.id !== zoneId),
    }));
    setZoneDeleteTarget(null);
  };

  const handleSave = async (confirmed = false) => {
    if (!tournament?.id) {
      return;
    }

    try {
      setSaving(true);
      const nextPlanning = {
        confirmed,
        updatedAtMillis: Date.now(),
        zones: (zonePlanning.zones || []).map((zone, index) => {
          const registrationIds = (zone.registrationIds || []).filter((id) => registrationById[id]);
          const matchSchedules = buildZoneMatchRows(registrationIds.length).reduce(
            (accumulator, matchKey) => {
              const schedule = getZoneMatchSchedule(zone, matchKey);

              accumulator[matchKey] = {
                dayKey: schedule.dayKey || "",
                result: schedule.result || {},
                resultText: schedule.resultText || "",
                startTime: schedule.startTime || "",
                venueId: schedule.venueId || "",
              };

              return accumulator;
            },
            {}
          );

          return {
            id: zone.id,
            label: zone.label || `Zona ${ZONE_LETTERS[index] || index + 1}`,
            matchSchedules,
            registrationIds,
          };
        }),
      };
      const nextFixtureSetup = confirmed
        ? {
            ...(tournament?.fixtureSetup || {}),
            lastViewedSection: "newzones",
            zonePlanning: nextPlanning,
          }
        : tournament?.fixtureSetup;

      await updateTournament(
        tournament.id,
        { uid: userData?.uid || "", name: userData?.name || "Organizador" },
        confirmed
          ? {
              fixtureSetup: nextFixtureSetup,
              zonePlanning: nextPlanning,
            }
          : { zonePlanning: nextPlanning },
        tournament
      );
      savedPlanningRef.current = nextPlanning;
      setZonePlanning(nextPlanning);
      setTournament((current) =>
        current
          ? {
              ...current,
              ...(confirmed ? { fixtureSetup: nextFixtureSetup } : null),
              zonePlanning: nextPlanning,
            }
          : current
      );

      if (confirmed) {
        navigation.goBack();
        return;
      }

      setFeedback({
        visible: true,
        title: confirmed ? "Armado confirmado" : "Armado guardado",
        message: confirmed
          ? "El armado manual quedo guardado como base para pasar luego al fixture."
          : "El armado quedo guardado sin modificar el fixture actual.",
        tone: "success",
      });
    } catch (error) {
      setFeedback({
        visible: true,
        title: "No pudimos guardar el armado",
        message: error?.message || "Intenta nuevamente en unos instantes.",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  const countConflictedMatches = () => {
    let count = 0;
    (zonePlanning.zones || []).forEach((zone) => {
      buildZoneMatchRows((zone.registrationIds || []).length).forEach((matchLabel) => {
        if (getMatchConflict(zone, matchLabel).hasConflict) {
          count += 1;
        }
      });
    });
    return count;
  };

  const buildSavePrompt = (confirmed = false) => {
    const changeType = getZonePlanningChangeType(savedPlanningRef.current, zonePlanning);
    const unassignedNames = unassignedRegistrations.map(
      (registration) => registration.shortDisplayLabel || registration.displayLabel || "Pareja"
    );
    const hasUnassignedPairs = unassignedNames.length > 0;
    const conflictCount = confirmed ? countConflictedMatches() : 0;
    const conflictMessage =
      conflictCount > 0
        ? `Hay ${conflictCount} partido${conflictCount === 1 ? "" : "s"} con conflicto de horario. ¿Guardar igual?\n\n`
        : "";

    if (changeType === "none" && !hasUnassignedPairs && !conflictCount) {
      return null;
    }

    const unassignedMessage = hasUnassignedPairs
      ? `\n\nQuedan ${unassignedNames.length} pareja${unassignedNames.length === 1 ? "" : "s"} sin zona: ${unassignedNames.join(" / ")}.`
      : "";

    if (changeType === "none") {
      return {
        confirmed,
        confirmLabel: "Guardar igual",
        message: `${conflictMessage}No hay cambios en el armado respecto al ultimo guardado.${unassignedMessage}\n\n¿Queres guardar de todos modos?`,
        title: conflictCount > 0 ? "Hay conflictos de horario" : "Sin cambios nuevos",
      };
    }

    if (changeType === "additive") {
      return {
        confirmed,
        confirmLabel: confirmed ? "Sí, establecer" : "Sí, guardar",
        message: `${conflictMessage}Estás agregando nuevas parejas o zonas al armado existente. Las zonas ya guardadas no se van a modificar.${unassignedMessage}`,
        title: conflictCount > 0 ? "Hay conflictos de horario" : confirmed ? "Agregar al fixture" : "Guardar borrador",
      };
    }

    return {
      confirmed,
      confirmLabel: confirmed ? "Sí, aplicar cambios" : "Sí, guardar",
      message: confirmed
        ? `${conflictMessage}Modificaste horarios, parejas o la configuración de zonas ya guardadas. Al confirmar, el fixture del torneo se va a actualizar y volverás a la pantalla anterior.${unassignedMessage}`
        : `Modificaste horarios, parejas o la configuración de zonas ya guardadas. Al guardar, los cambios quedan como borrador sin afectar el fixture actual.${unassignedMessage}`,
      title: conflictCount > 0 ? "Hay conflictos de horario" : confirmed ? "Aplicar cambios al fixture" : "Guardar borrador",
    };
  };

  const requestSaveArmado = (confirmed = false) => {
    const prompt = buildSavePrompt(confirmed);

    if (prompt) {
      setConfirmArmadoPrompt(prompt);
      return;
    }

    handleSave(confirmed);
  };

  const confirmPromptArmado = () => {
    const confirmed = Boolean(confirmArmadoPrompt?.confirmed);
    setConfirmArmadoPrompt(null);
    handleSave(confirmed);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader onBack={() => navigation.goBack()} subtitle="Armado de zonas" />

      <View style={styles.container}>
        {loading ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator color={colors.primaryDark} />
            <Text style={styles.loaderText}>Cargando disponibilidad...</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <TournamentHeaderCard
              activeTournamentId={tournament?.id || ""}
              category={tournamentCategoryLabel}
              categoryOptions={categoryOptions}
              compactFriendly
              endDateMillis={tournament?.endDateMillis || 0}
              onSelectCategory={onSelectCategory}
              organizerLogoUrl={
                tournament?.organizerLogoUrl ||
                ((tournament?.organizerId === userData?.uid || tournament?.createdBy === userData?.uid)
                  ? userData?.organizerLogoUrl
                  : "")
              }
              startDateMillis={tournament?.startDateMillis || 0}
              status={tournament?.status || "draft"}
              title={tournament?.name || fallbackTournamentName}
              titleColorSeed={[tournament?.creationBatchId, tournament?.name]
                .map((value) => String(value || "").trim())
                .filter(Boolean)
                .join(":")}
              venue={tournament?.venueLabel || ""}
            >
              <Text style={styles.helperText}>
                Selecciona las parejas y arma las zonas manualmente.
              </Text>
            </TournamentHeaderCard>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.dayScrollContent}
            >
              <View style={styles.dayRow}>
                {tournamentDayOptions.map((day) => {
                  const isActive = selectedDayKey === day.key;

                  return (
                    <Pressable
                      key={day.key}
                      onPress={() => setSelectedDayKey(day.key)}
                      style={[styles.dayChip, isActive ? styles.dayChipActive : null]}
                    >
                      <Text style={[styles.dayChipText, isActive ? styles.dayChipTextActive : null]}>
                        {getWeekdayLabel(day.key)}
                      </Text>
                      <Text style={[styles.dayChipDateText, isActive ? styles.dayChipTextActive : null]}>
                        {getDayNumberMonthLabel(day.key)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>

            <Text style={styles.instantSaveNote}>
              Los cambios de horario se guardan al instante.
            </Text>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterChipsContent}
            >
              <View style={styles.filterChipsRow}>
                <Pressable
                  onPress={() => setGridFilter({ type: "all" })}
                  style={[styles.filterChip, gridFilter.type === "all" ? styles.filterChipActive : null]}
                >
                  <Text style={[styles.filterChipText, gridFilter.type === "all" ? styles.filterChipTextActive : null]}>
                    Todas
                  </Text>
                </Pressable>
                {categoryFilterOptions.map((option) => {
                  const isActive = gridFilter.type === "category" && gridFilter.tournamentId === option.tournamentId;

                  return (
                    <Pressable
                      key={option.tournamentId}
                      onPress={() => setGridFilter({ tournamentId: option.tournamentId, type: "category" })}
                      style={[
                        styles.filterChip,
                        { borderColor: getCategoryColor(option.colorIndex) },
                        isActive ? styles.filterChipActive : null,
                      ]}
                    >
                      <Text style={[styles.filterChipText, isActive ? styles.filterChipTextActive : null]}>
                        {option.label} ({option.count})
                      </Text>
                    </Pressable>
                  );
                })}
                <Pressable
                  onPress={() => setGridFilter({ type: "problems" })}
                  style={[styles.filterChip, gridFilter.type === "problems" ? styles.filterChipActive : null]}
                >
                  <Text style={[styles.filterChipText, gridFilter.type === "problems" ? styles.filterChipTextActive : null]}>
                    Con problemas
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setGridFilter({ type: "unassigned" })}
                  style={[styles.filterChip, gridFilter.type === "unassigned" ? styles.filterChipActive : null]}
                >
                  <Text style={[styles.filterChipText, gridFilter.type === "unassigned" ? styles.filterChipTextActive : null]}>
                    Sin zona
                  </Text>
                </Pressable>
              </View>
            </ScrollView>

            {!selectedDayKey ? null : hourColumns.length === 0 ? (
              <View style={styles.gridEmptyWrap}>
                <Text style={styles.gridEmptyText}>
                  Configura la disponibilidad de sedes/canchas para este dia en Preferencias para ver la grilla.
                </Text>
              </View>
            ) : (
              <View style={styles.newGridCard}>
                <View style={styles.newGridRow}>
                  <View style={styles.newGridFixedColumn}>
                    <View style={styles.newGridCornerCell}>
                      <Text style={styles.newGridCornerText}>PAREJA</Text>
                    </View>
                    {gridRows.map((row) => {
                      if (row.type === "category-header") {
                        return (
                          <Pressable
                            disabled={row.block.isActive}
                            key={row.key}
                            onPress={() => toggleSiblingCollapsed(row.block.tournamentId)}
                            style={[styles.categoryHeaderFixedCell, { borderLeftColor: getCategoryColor(row.colorIndex) }]}
                          >
                            <View style={[styles.categoryHeaderBar, { backgroundColor: getCategoryColor(row.colorIndex) }]} />
                            <View style={styles.categoryHeaderTextWrap}>
                              <Text numberOfLines={1} style={styles.categoryHeaderTitle}>
                                {row.block.categoryLabel || (row.block.isActive ? "Esta categoria" : "Categoria")}
                              </Text>
                              <Text numberOfLines={1} style={styles.categoryHeaderSubtitle}>
                                {row.block.confirmedRegistrations.length} pareja
                                {row.block.confirmedRegistrations.length === 1 ? "" : "s"}
                                {!row.block.isActive ? " · Solo lectura" : ""}
                              </Text>
                            </View>
                            {!row.block.isActive ? (
                              <Ionicons
                                color={colors.muted}
                                name={row.isCollapsed ? "chevron-down" : "chevron-up"}
                                size={16}
                              />
                            ) : null}
                          </Pressable>
                        );
                      }

                      if (row.type === "pair") {
                        return (
                          <PairNameCell
                            hoursStatus={getHoursStatusTag(getTotalLoadedHours(row.registration))}
                            isEditable={row.block.isActive}
                            isSelected={row.block.isActive && selectedRegistrationIds.includes(row.registration.id)}
                            key={row.key}
                            onPress={toggleRegistrationSelection}
                            registration={row.registration}
                            zoneLetter={row.zoneLetter}
                          />
                        );
                      }

                      if (row.type === "coinciden") {
                        return (
                          <View key={row.key} style={styles.coincidenFixedCell}>
                            <Text numberOfLines={1} style={styles.coincidenFixedText}>
                              Coinciden
                            </Text>
                          </View>
                        );
                      }

                      return (
                        <View key={row.key} style={styles.canchasOcupadasFixedCell}>
                          <Text numberOfLines={1} style={styles.canchasOcupadasFixedText}>
                            Canchas ocupadas
                          </Text>
                        </View>
                      );
                    })}
                  </View>

                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View>
                      <View style={styles.hourHeaderRow}>
                        {hourColumns.map((hour) => (
                          <View key={hour.minutes} style={styles.hourHeaderCell}>
                            <Text style={styles.hourHeaderText}>{hour.label}</Text>
                          </View>
                        ))}
                      </View>

                      {gridRows.map((row) => {
                        if (row.type === "category-header") {
                          return <View key={row.key} style={styles.categoryHeaderScrollSpacer} />;
                        }

                        if (row.type === "pair") {
                          return (
                            <PairCellsRow
                              hourColumns={hourColumns}
                              isEditable={row.block.isActive}
                              key={row.key}
                              onToggleCell={handleToggleAvailabilityCell}
                              registration={row.registration}
                              selectedDayKey={selectedDayKey}
                            />
                          );
                        }

                        if (row.type === "coinciden") {
                          const total = row.block.confirmedRegistrations.length || 1;

                          return (
                            <View key={row.key} style={styles.coincidenCellsRow}>
                              {hourColumns.map((hour) => {
                                const count = countPairsAvailableAtHour(row.block, hour.minutes);
                                const ratio = count / total;

                                return (
                                  <View
                                    key={hour.minutes}
                                    style={[
                                      styles.coincidenCell,
                                      count > 0
                                        ? { backgroundColor: getCategoryColor(row.colorIndex), opacity: 0.25 + ratio * 0.75 }
                                        : null,
                                    ]}
                                  >
                                    <Text style={styles.coincidenCellText}>{count || ""}</Text>
                                  </View>
                                );
                              })}
                            </View>
                          );
                        }

                        return (
                          <View key={row.key} style={styles.canchasOcupadasCellsRow}>
                            {hourColumns.map((hour) => {
                              const courts = getCourtsAvailableAtHour(hour.minutes);
                              const matches = countMatchesAtHour(hour.minutes);
                              const isFull = courts > 0 && matches >= courts;

                              return (
                                <View
                                  key={hour.minutes}
                                  style={[styles.canchasOcupadasCell, isFull ? styles.canchasOcupadasCellFull : null]}
                                >
                                  <Text
                                    style={[
                                      styles.canchasOcupadasCellText,
                                      isFull ? styles.canchasOcupadasCellTextFull : null,
                                    ]}
                                  >
                                    {matches}/{courts}
                                  </Text>
                                </View>
                              );
                            })}
                          </View>
                        );
                      })}
                    </View>
                  </ScrollView>
                </View>
              </View>
            )}

            <View style={styles.selectionCard}>
              <Text style={styles.selectionTitle}>
                {selectedRegistrations.length
                  ? `${selectedRegistrations.length} pareja${selectedRegistrations.length === 1 ? "" : "s"} seleccionada${selectedRegistrations.length === 1 ? "" : "s"}`
                  : "Sin parejas seleccionadas"}
              </Text>
              {selectedRegistrations.length ? (
                <Text style={styles.selectionText}>
                  {selectedRegistrations
                    .map((registration) => registration.shortDisplayLabel || registration.displayLabel)
                    .join(" / ")}
                </Text>
              ) : null}
              <View style={styles.actionRow}>
                <Pressable onPress={createZoneFromSelection} style={styles.primaryAction}>
                  <Ionicons color={colors.surface} name="layers-outline" size={17} />
                  <Text style={styles.primaryActionText}>Armar zona</Text>
                </Pressable>
                <Pressable
                  onPress={() => setSelectedRegistrationIds([])}
                  style={styles.secondaryAction}
                >
                  <Text style={styles.secondaryActionText}>Limpiar</Text>
                </Pressable>
              </View>
              {selectedRegistrations.length === 1 && (zonePlanning.zones || []).length ? (
                <View style={styles.addToZoneWrap}>
                  <Text style={styles.addToZoneLabel}>Agregar a zona existente</Text>
                  <View style={styles.addToZoneRow}>
                    {(zonePlanning.zones || []).map((zone, zoneIndex) => {
                      const selectedId = selectedRegistrationIds.find((id) => registrationById[id]);
                      const validation = validateAddPairToZone(zone, selectedId);

                      return (
                        <Pressable
                          disabled={!validation.ok}
                          key={`add-${zone.id}`}
                          onPress={() => addSelectedPairToZone(zone.id)}
                          style={[
                            styles.addToZoneChip,
                            !validation.ok ? styles.addToZoneChipDisabled : null,
                          ]}
                        >
                          <Text
                            style={[
                              styles.addToZoneChipText,
                              !validation.ok ? styles.addToZoneChipTextDisabled : null,
                            ]}
                          >
                            {zone.label || `Zona ${ZONE_LETTERS[zoneIndex] || zoneIndex + 1}`}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}
            </View>

            <View style={styles.zoneStack}>
              {(zonePlanning.zones || []).length ? (
                (zonePlanning.zones || []).map((zone, zoneIndex) => {
                  const zoneRegistrations = (zone.registrationIds || [])
                    .map((id) => registrationById[id])
                    .filter(Boolean);
                  const zoneMatchRows = sortZoneMatchRows(
                    zone,
                    buildZoneMatchRows(zoneRegistrations.length)
                  );
                  const qualifiers = [];
                  const hasUnscheduledMatches = zoneMatchRows.length > 0 && zoneMatchRows.some((ml) => !getZoneMatchSchedule(zone, ml).startTime);
                  return (
                    <View key={zone.id} style={[styles.zoneCard, hasUnscheduledMatches ? styles.zoneCardUnscheduled : null]}>
                      {hasUnscheduledMatches ? (
                        <View style={styles.zoneUnscheduledBanner}>
                          <Ionicons color={colors.danger} name="warning-outline" size={13} />
                          <Text style={styles.zoneUnscheduledBannerText}>Atención: hay partidos sin horario designado</Text>
                        </View>
                      ) : null}
                      <View style={styles.zoneHeader}>
                        <View style={styles.zoneHeaderMain}>
                          {tournamentCategoryLabel ? (
                            <View style={styles.zoneCategoryBadge}>
                              <Text style={styles.zoneCategoryBadgeText}>{tournamentCategoryLabel}</Text>
                            </View>
                          ) : null}
                          <Text style={styles.zoneTitle}>
                            {zone.label || `Zona ${ZONE_LETTERS[zoneIndex] || zoneIndex + 1}`}
                          </Text>
                          <View style={styles.zoneCompactPairs}>
                            {zoneRegistrations.map((registration, registrationIndex) => (
                              <View key={`${zone.id}-compact-${registration.id}`} style={styles.zoneCompactPairRow}>
                                <View
                                  style={[
                                    styles.zoneCompactPairNumber,
                                    {
                                      backgroundColor: registration.color.bg,
                                      borderColor: registration.color.border,
                                    },
                                  ]}
                                >
                                  <Text style={[styles.zoneCompactPairNumberText, { color: registration.color.text }]}>
                                    {registrationIndex + 1}
                                  </Text>
                                </View>
                                <Text
                                  numberOfLines={1}
                                  style={[styles.zoneCompactPairName, { color: registration.color.text }]}
                                >
                                  {registration.shortDisplayLabel}
                                </Text>
                                <Pressable
                                  onPress={() => removePairFromZone(zone.id, registration.id)}
                                  style={styles.zoneCompactPairRemove}
                                >
                                  <Ionicons color={registration.color.text} name="close" size={12} />
                                </Pressable>
                              </View>
                            ))}
                          </View>
                        </View>
                        <Pressable onPress={() => setZoneDeleteTarget(zone)} style={styles.removeZoneButton}>
                          <Ionicons color="#9A6A6A" name="trash-outline" size={13} />
                        </Pressable>
                      </View>
                      <View style={styles.zoneMatchTable}>
                        <View style={styles.zoneMatchTableHeader}>
                          <Text style={[styles.zoneMatchTableHeaderText, styles.zoneMatchPairColumn]}>PAREJAS</Text>
                          <Text style={[styles.zoneMatchTableHeaderText, styles.zoneMatchDayColumn]}>DIA</Text>
                          <Text style={[styles.zoneMatchTableHeaderText, styles.zoneMatchTimeColumn]}>HORARIO</Text>
                          <Text style={[styles.zoneMatchTableHeaderText, styles.zoneMatchPlaceColumn]}>LUGAR</Text>
                        </View>
                        {zoneMatchRows.length ? (
                          zoneMatchRows.map((matchLabel) => {
                            const matchSchedule = getZoneMatchSchedule(zone, matchLabel);
                            const displayMatchLabel = getResolvedZoneMatchLabel(
                              zone,
                              zoneRegistrations,
                              matchLabel
                            );
                            const matchVenue = tournamentVenueOptions.find(
                              (venue) => venue.id === matchSchedule.venueId
                            );
                            const matchCourtIndex = Number(matchSchedule.courtIndex || 0);
                            const matchPlaceLabel = matchVenue?.label
                              ? matchCourtIndex > 0
                                ? `${matchVenue.label} · C${matchCourtIndex}`
                                : matchVenue.label
                              : tournamentVenueOptions.length
                              ? "Elegir"
                              : "Sin sede";
                            const matchConflict = getMatchConflict(zone, matchLabel);

                            return (
                              <View key={`${zone.id}-${matchLabel}`}>
                                <View
                                  style={[
                                    styles.zoneMatchTableRow,
                                    matchConflict.hasConflict ? styles.zoneMatchTableRowConflict : null,
                                  ]}
                                >
                                  <View style={[styles.zoneMatchPairsCell, styles.zoneMatchPairColumn]}>
                                    {String(displayMatchLabel || "")
                                      .split(/(\s+vs\s+)/i)
                                      .map((part, index) => (
                                        <Text
                                          key={`${matchLabel}-${part}-${index}`}
                                          style={styles.zoneMatchTableCellText}
                                        >
                                          {part}
                                        </Text>
                                      ))}
                                  </View>
                                  <Pressable
                                    onPress={() => openZoneDayPicker(zone, matchLabel)}
                                    style={[styles.zoneMatchDayButton, styles.zoneMatchDayColumn]}
                                  >
                                    <Text style={styles.zoneMatchDayButtonText}>
                                      {getWeekdayLabel(matchSchedule.dayKey)}
                                    </Text>
                                  </Pressable>
                                  <Pressable
                                    onPress={() =>
                                      openSlotPicker({
                                        matchKey: matchLabel,
                                        zoneId: zone.id,
                                        currentStartTime: matchSchedule.startTime || "",
                                        currentDayKey: matchSchedule.dayKey || "",
                                        currentVenueId: matchSchedule.venueId || "",
                                        currentCourtIndex: matchSchedule.courtIndex || 0,
                                      })
                                    }
                                    style={[styles.zoneMatchTimeButton, styles.zoneMatchTimeColumn]}
                                  >
                                    <Text style={styles.zoneMatchTimeButtonText}>
                                      {matchSchedule.startTime || "Hora"}
                                    </Text>
                                  </Pressable>
                                  <Pressable
                                    onPress={() => openZoneVenuePicker(zone, matchLabel)}
                                    style={[styles.zoneMatchPlaceButton, styles.zoneMatchPlaceColumn]}
                                  >
                                    <Text numberOfLines={1} style={styles.zoneMatchPlaceButtonText}>
                                      {matchPlaceLabel}
                                    </Text>
                                  </Pressable>
                                </View>
                                {matchConflict.hasConflict ? (
                                  <View style={styles.zoneMatchConflictRow}>
                                    <Ionicons color={colors.danger} name="warning-outline" size={12} />
                                    <Text numberOfLines={2} style={styles.zoneMatchConflictText}>
                                      {matchConflict.conflictReason}
                                    </Text>
                                  </View>
                                ) : null}
                              </View>
                            );
                          })
                        ) : (
                          <Text style={styles.zoneMatchTableEmpty}>
                            Agrega 2, 3 o 4 parejas para ver los cruces de la zona.
                          </Text>
                        )}
                      </View>
                      <View style={styles.hiddenSection}>
                        <View style={styles.zoneQualifiersTextWrap}>
                          {qualifiers.map((qualifier, qualifierIndex) => (
                            <Text
                              key={`${zone.id}-qualifier-${qualifierIndex}`}
                              style={styles.zoneQualifierText}
                              numberOfLines={1}
                            >
                              {qualifierIndex + 1}° {qualifier ? qualifier.shortName : "Pendiente"}
                            </Text>
                          ))}
                        </View>
                        <Pressable
                          onPress={() => setStandingsModalZoneId(zone.id)}
                          style={styles.zoneStandingsButton}
                        >
                          <Text style={styles.zoneStandingsButtonText}>PUNTAJES</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })
              ) : (
                <View style={styles.zoneCard}>
                  <Text style={styles.emptyText}>Todavia no armaste zonas.</Text>
                </View>
              )}
            </View>

            <View style={styles.bottomActions}>
              <Pressable
                disabled={saving}
                onPress={() => requestSaveArmado(false)}
                style={[styles.saveAction, saving ? styles.actionDisabled : null]}
              >
                <Text style={styles.saveActionText}>{saving ? "Guardando..." : "Guardar Borrador"}</Text>
              </Pressable>
              <Pressable
                disabled={saving}
                onPress={() => requestSaveArmado(true)}
                style={[styles.confirmAction, saving ? styles.actionDisabled : null]}
              >
                <Text style={styles.confirmActionText}>Establecer Cambios</Text>
              </Pressable>
            </View>
            <View style={styles.quickPairAddWrap}>
              <Pressable
                accessibilityLabel="Inscribir nueva pareja"
                onPress={() =>
                  navigation.navigate("TournamentRegistration", {
                    editorRole: "organizer_create",
                    tournamentId: tournament?.id || tournamentId,
                    tournamentName: tournament?.name || fallbackTournamentName,
                  })
                }
                style={({ pressed }) => [
                  styles.quickPairAddButton,
                  pressed ? styles.quickPairAddButtonPressed : null,
                ]}
              >
                <Ionicons color={colors.primaryDark} name="people-outline" size={20} />
                <View style={styles.quickPairAddBadge}>
                  <Ionicons color={colors.surface} name="add" size={12} />
                </View>
              </Pressable>
            </View>
          </ScrollView>
        )}
      </View>

      {zoneTimePickerTarget ? (
        <View style={styles.timePickerOverlayWrap}>
          <DateTimePicker
            display={Platform.OS === "ios" ? "spinner" : "clock"}
            is24Hour
            mode="time"
            onChange={handleZoneTimePickerChange}
            value={buildDateFromTime(zoneTimePickerTarget.currentValue)}
          />
          {Platform.OS === "ios" ? (
            <Pressable
              onPress={() => setZoneTimePickerTarget(null)}
              style={styles.timePickerDoneButton}
            >
              <Text style={styles.timePickerDoneButtonText}>Listo</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <Modal
        animationType="slide"
        onRequestClose={closeSlotPicker}
        transparent
        visible={Boolean(slotPickerTarget)}
      >
        <View style={styles.slotPickerOverlay}>
          <Pressable onPress={closeSlotPicker} style={styles.slotPickerBackdrop} />
          <View style={[styles.slotPickerCard, { paddingBottom: Math.max(28, insets.bottom + 16) }]}>
            <Text style={styles.slotPickerTitle}>Horarios disponibles</Text>
            <Text style={styles.slotPickerSubtitle}>Seleccionar</Text>

            {slotsByDay.length === 0 ? (
              <Text style={styles.slotPickerEmptyText}>
                No hay horarios disponibles. Configurá franjas horarias en las preferencias del fixture para verlos acá.
              </Text>
            ) : (() => {
              const effectiveDay = slotPickerActiveDay || slotsByDay[0]?.dayKey || "";
              const dayGroup = slotsByDay.find((g) => g.dayKey === effectiveDay);
              const daySlots = dayGroup?.slots || [];
              const uniqueVenues = [...new Map(daySlots.map((s) => [s.venueId, { id: s.venueId, name: s.venueName }])).values()];
              const effectiveVenueId = uniqueVenues.length > 1 ? slotPickerActiveVenueId : "";
              const visibleSlots = effectiveVenueId ? daySlots.filter((s) => s.venueId === effectiveVenueId) : daySlots;

              return (
                <>
                  {/* Day chips */}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.slotPickerDayRow} contentContainerStyle={styles.slotPickerDayRowContent}>
                    {slotsByDay.map((group) => {
                      const isActive = group.dayKey === effectiveDay;
                      return (
                        <Pressable
                          key={group.dayKey}
                          onPress={() => { setSlotPickerActiveDay(group.dayKey); setSlotPickerActiveVenueId(""); }}
                          style={[styles.slotPickerDayChip, isActive ? styles.slotPickerDayChipActive : null]}
                        >
                          <Text style={[styles.slotPickerDayChipText, isActive ? styles.slotPickerDayChipTextActive : null]}>
                            {group.dayLabel}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  {/* Venue: single chip or filter chips */}
                  {uniqueVenues.length === 1 ? (
                    <View style={styles.slotPickerSingleVenueRow}>
                      <Ionicons color={colors.primaryDark} name="location-outline" size={13} />
                      <Text style={styles.slotPickerSingleVenueText} numberOfLines={1}>{uniqueVenues[0].name}</Text>
                    </View>
                  ) : uniqueVenues.length > 1 ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.slotPickerVenueRow} contentContainerStyle={styles.slotPickerVenueRowContent}>
                      <Pressable
                        onPress={() => setSlotPickerActiveVenueId("")}
                        style={[styles.slotPickerVenueChip, !effectiveVenueId ? styles.slotPickerVenueChipActive : null]}
                      >
                        <Text style={[styles.slotPickerVenueChipText, !effectiveVenueId ? styles.slotPickerVenueChipTextActive : null]}>Todos</Text>
                      </Pressable>
                      {uniqueVenues.map((venue) => {
                        const isVenueActive = effectiveVenueId === venue.id;
                        return (
                          <Pressable
                            key={venue.id}
                            onPress={() => setSlotPickerActiveVenueId(venue.id)}
                            style={[styles.slotPickerVenueChip, isVenueActive ? styles.slotPickerVenueChipActive : null]}
                          >
                            <Text style={[styles.slotPickerVenueChipText, isVenueActive ? styles.slotPickerVenueChipTextActive : null]} numberOfLines={1}>{venue.name}</Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  ) : null}

                  {/* Slots label */}
                  <Text style={styles.slotPickerSlotsLabel}>Tocá un horario para asignarlo</Text>

                  {/* Slots list */}
                  <ScrollView showsVerticalScrollIndicator={false} style={styles.slotPickerSlotsScroll}>
                    {visibleSlots.length === 0 ? (
                      <Text style={styles.slotPickerEmptyText}>No hay horarios disponibles para este filtro.</Text>
                    ) : (
                      visibleSlots.map((slot) => {
                        const isSelected =
                          slotPickerTarget &&
                          slot.dayKey === slotPickerTarget.currentDayKey &&
                          formatMinutesToTime(slot.startMinutes) === slotPickerTarget.currentStartTime &&
                          slot.venueId === slotPickerTarget.currentVenueId &&
                          slot.courtIndex === slotPickerTarget.currentCourtIndex;
                        const slotReason = slot.conflictReason || slot.availabilityWarning;
                        return (
                          <Pressable
                            key={slot.id}
                            onPress={() => handleSelectSlot(slot)}
                            style={[
                              styles.slotPickerSlot,
                              slotReason ? styles.slotPickerSlotWithConflict : null,
                              isSelected ? styles.slotPickerSlotSelected : null,
                            ]}
                          >
                            <View style={styles.slotPickerSlotMainRow}>
                              {slotReason ? (
                                <Ionicons color={colors.danger} name="warning-outline" size={13} />
                              ) : null}
                              <Text style={[styles.slotPickerSlotTime, isSelected ? styles.slotPickerSlotTimeSelected : null]}>
                                {formatMinutesToTime(slot.startMinutes)} hs
                              </Text>
                              <Text style={[styles.slotPickerSlotCourt, isSelected ? styles.slotPickerSlotCourtSelected : null]}>
                                Cancha {slot.courtIndex}
                              </Text>
                              {isSelected ? <Ionicons color="#1B5D92" name="checkmark-circle" size={17} /> : null}
                            </View>
                            {slotReason ? (
                              <Text numberOfLines={2} style={styles.slotPickerSlotReasonText}>
                                {slotReason}
                              </Text>
                            ) : null}
                          </Pressable>
                        );
                      })
                    )}
                  </ScrollView>
                </>
              );
            })()}

            {/* Footer */}
            <View style={styles.slotPickerFooter}>
              <Pressable onPress={handleClearSlot} style={styles.slotPickerClearButton}>
                <Ionicons color="#B04040" name="close-circle-outline" size={14} />
                <Text style={styles.slotPickerClearButtonText}>Sin horario</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const target = slotPickerTarget;
                  const capturedDay = slotPickerActiveDay || slotsByDay[0]?.dayKey || "";
                  const capturedVenueId = slotPickerActiveVenueId || tournamentVenueOptions[0]?.id || "";
                  const capturedCourt = target?.currentCourtIndex || 1;
                  setCustomTimeContext({ dayKey: capturedDay, venueId: capturedVenueId, courtIndex: capturedCourt });
                  closeSlotPicker();
                  if (target) {
                    setZoneTimePickerTarget({
                      currentValue: target.currentStartTime || "19:00",
                      matchKey: target.matchKey,
                      zoneId: target.zoneId,
                    });
                  }
                }}
                style={styles.slotPickerDefineButton}
              >
                <Ionicons color={colors.surface} name="time-outline" size={14} />
                <Text style={styles.slotPickerDefineButtonText}>Definir horario</Text>
              </Pressable>
              <Pressable onPress={closeSlotPicker} style={styles.slotPickerCancelButton}>
                <Text style={styles.slotPickerCancelText}>Cancelar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      {customScheduleModal ? (() => {
        const effectiveVenueId = customScheduleModal.venueId || tournamentVenueOptions[0]?.id || "";
        const maxCourts = getMaxCourtsForVenue(effectiveVenueSchedules, effectiveVenueId);
        const dayOption = tournamentDayOptions.find((d) => d.key === customScheduleModal.dayKey);
        const validation = validateCustomSchedule(
          customScheduleModal.zoneId,
          customScheduleModal.matchKey,
          customScheduleModal.dayKey,
          customScheduleModal.startTime,
          effectiveVenueId,
          customScheduleModal.courtIndex
        );
        const conflictOrWarning = validation.conflictReason || validation.availabilityWarning;
        return (
          <Modal animationType="fade" onRequestClose={() => setCustomScheduleModal(null)} transparent visible>
            <View style={styles.customScheduleOverlay}>
              <Pressable onPress={() => setCustomScheduleModal(null)} style={styles.slotPickerBackdrop} />
              <View style={[styles.customScheduleCard, { paddingBottom: Math.max(20, insets.bottom + 12) }]}>
                <Text style={styles.customScheduleTitle}>Definir horario</Text>
                <View style={styles.customScheduleSummary}>
                  <Text style={styles.customScheduleDayText}>{dayOption?.fullLabel || customScheduleModal.dayKey || "Sin dia"}</Text>
                  <Text style={styles.customScheduleTimeText}>{customScheduleModal.startTime} hs</Text>
                </View>
                {tournamentVenueOptions.length > 1 ? (
                  <View>
                    <Text style={styles.customScheduleLabel}>Sede</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.customScheduleChipRow}>
                      {tournamentVenueOptions.map((venue) => {
                        const isActive = effectiveVenueId === venue.id;
                        return (
                          <Pressable
                            key={venue.id}
                            onPress={() => setCustomScheduleModal((prev) => ({ ...prev, venueId: venue.id, courtIndex: 1 }))}
                            style={[styles.customScheduleChip, isActive ? styles.customScheduleChipActive : null]}
                          >
                            <Text style={[styles.customScheduleChipText, isActive ? styles.customScheduleChipTextActive : null]} numberOfLines={1}>{venue.label}</Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  </View>
                ) : tournamentVenueOptions.length === 1 ? (
                  <View style={styles.slotPickerSingleVenueRow}>
                    <Ionicons color={colors.primaryDark} name="location-outline" size={13} />
                    <Text style={styles.slotPickerSingleVenueText} numberOfLines={1}>{tournamentVenueOptions[0].label}</Text>
                  </View>
                ) : null}
                <View>
                  <Text style={styles.customScheduleLabel}>Cancha</Text>
                  <View style={styles.customScheduleCourtRow}>
                    {Array.from({ length: maxCourts }, (_, i) => i + 1).map((n) => {
                      const isActive = customScheduleModal.courtIndex === n;
                      return (
                        <Pressable
                          key={n}
                          onPress={() => setCustomScheduleModal((prev) => ({ ...prev, courtIndex: n }))}
                          style={[styles.customScheduleCourtChip, isActive ? styles.customScheduleCourtChipActive : null]}
                        >
                          <Text style={[styles.customScheduleCourtText, isActive ? styles.customScheduleCourtTextActive : null]}>{n}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
                {conflictOrWarning ? (
                  <View style={styles.customScheduleConflictRow}>
                    <Ionicons color={colors.danger} name="warning-outline" size={15} />
                    <Text style={styles.customScheduleConflictText}>{conflictOrWarning}</Text>
                  </View>
                ) : null}
                <View style={styles.customScheduleActions}>
                  <Pressable onPress={() => setCustomScheduleModal(null)} style={styles.customScheduleCancelButton}>
                    <Text style={styles.customScheduleCancelText}>Cancelar</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleConfirmCustomSchedule}
                    style={[
                      styles.customScheduleConfirmButton,
                      conflictOrWarning ? styles.customScheduleConfirmWarning : null,
                    ]}
                  >
                    <Text style={styles.customScheduleConfirmText}>
                      {conflictOrWarning ? "Asignar igual" : "Confirmar"}
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>
        );
      })() : null}
      <Modal animationType="fade" onRequestClose={closeZoneDayPicker} transparent visible={Boolean(zoneDayPickerTarget)}>
        <View style={styles.dayPickerModalOverlay}>
          <Pressable onPress={closeZoneDayPicker} style={styles.resultModalBackdrop} />
          <View style={styles.dayPickerModalCard}>
            <Text style={styles.dayPickerModalTitle}>Seleccionar dia</Text>
            {zoneDayPickerTarget?.participants?.length ? (
              <View style={styles.dayPickerMatchPreview}>
                {zoneDayPickerTarget.participants.map((participant, index) => (
                  <Fragment key={`day-picker-participant-${participant.id}-${index}`}>
                    {index > 0 ? <Text style={styles.dayPickerVsText}>vs</Text> : null}
                    <View
                      style={[
                        styles.dayPickerParticipantRow,
                        {
                          backgroundColor: participant.color?.bg || "#F7FAF8",
                          borderColor: participant.color?.border || colors.border,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.dayPickerParticipantNumber,
                          {
                            backgroundColor: colors.surface,
                            borderColor: participant.color?.border || colors.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.dayPickerParticipantNumberText,
                            { color: participant.color?.text || colors.primaryDark },
                          ]}
                        >
                          {participant.number}
                        </Text>
                      </View>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.dayPickerParticipantName,
                          { color: participant.color?.text || colors.primaryDark },
                        ]}
                      >
                        {participant.name}
                      </Text>
                    </View>
                  </Fragment>
                ))}
              </View>
            ) : null}
            <View style={styles.dayPickerOptions}>
              {tournamentDayOptions.map((day) => {
                const isSelected = day.key === zoneDayPickerTarget?.currentDayKey;

                return (
                  <Pressable
                    key={`zone-day-picker-${day.key}`}
                    onPress={() => selectZoneMatchDay(day.key)}
                    style={[styles.dayPickerOption, isSelected ? styles.dayPickerOptionSelected : null]}
                  >
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.dayPickerOptionText,
                        isSelected ? styles.dayPickerOptionTextSelected : null,
                      ]}
                    >
                      {getWeekdayLabel(day.key)}
                    </Text>
                    <Text
                      style={[
                        styles.dayPickerOptionMeta,
                        isSelected ? styles.dayPickerOptionTextSelected : null,
                      ]}
                    >
                      {getDayNumberMonthLabel(day.key)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable onPress={closeZoneDayPicker} style={styles.dayPickerCancelButton}>
              <Text style={styles.dayPickerCancelButtonText}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal animationType="fade" onRequestClose={closeResultEditor} transparent visible={Boolean(resultEditor)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.resultModalOverlay}
        >
          <Pressable onPress={closeResultEditor} style={styles.resultModalBackdrop} />
          <ScrollView
            contentContainerStyle={styles.resultModalScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.resultModalCard}>
              <Text style={styles.resultModalTitle}>Resultado</Text>
              <Text style={styles.resultModalSubtitle}>
                Selecciona ganador y carga los sets del partido.
              </Text>
              {(resultEditor?.participants || []).length ? (
                <View style={styles.winnerOptions}>
                  {(resultEditor?.participants || []).map((participant, index) => {
                    const isSelected = resultEditor?.winnerRegistrationId === String(participant.id);

                    return (
                      <Pressable
                        key={`winner-${participant.id}`}
                        onPress={() =>
                          setResultEditor((current) =>
                            current
                              ? {
                                  ...current,
                                  winnerRegistrationId: isSelected ? "" : String(participant.id),
                                }
                              : current
                          )
                        }
                        style={[
                          styles.winnerOption,
                          isSelected ? styles.winnerOptionSelected : null,
                        ]}
                      >
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.winnerOptionText,
                            isSelected ? styles.winnerOptionTextSelected : null,
                          ]}
                        >
                          {index + 1}. {participant.shortDisplayLabel || participant.displayLabel}
                        </Text>
                        {isSelected ? (
                          <Text style={styles.winnerBadgeText}>GANADOR</Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <Text style={styles.resultNoWinnerText}>
                  Este cruce no permite seleccionar ganador directo todavia.
                </Text>
              )}
              <View style={styles.setsGrid}>
                {[0, 1, 2].map((setIndex) => {
                  const set = normalizeZoneResultSets(resultEditor?.sets)[setIndex];
                  const isSuperTieBreakSet = usesSuperTieBreak && setIndex === 2;
                  const setValue = isSuperTieBreakSet
                    ? `${set.teamA}${set.teamA.length >= 2 ? "/" : ""}${set.teamB}`
                    : `${set.teamA}${set.teamA ? "/" : ""}${set.teamB}`;

                  return (
                    <View key={`set-${setIndex}`} style={styles.setRow}>
                      <Text style={[styles.setLabel, isSuperTieBreakSet ? styles.superTieBreakSetLabel : null]}>
                        {isSuperTieBreakSet ? "SUPER TIE BREAK" : `SET ${setIndex + 1}`}
                      </Text>
                      <TextInput
                        inputAccessoryViewID={
                          Platform.OS === "ios" ? NUMERIC_KEYBOARD_ACCESSORY_ID : undefined
                        }
                        keyboardType="number-pad"
                        maxLength={isSuperTieBreakSet ? 5 : 3}
                        onChangeText={(value) => updateResultSetScore(setIndex, value)}
                        style={[styles.setInput, isSuperTieBreakSet ? styles.superTieBreakSetInput : null]}
                        value={setValue}
                      />
                    </View>
                  );
                })}
              </View>
              <View style={styles.resultModalActions}>
                <Pressable onPress={closeResultEditor} style={styles.resultCancelButton}>
                  <Text style={styles.resultCancelButtonText}>Cancelar</Text>
                </Pressable>
                <Pressable onPress={saveResultEditor} style={styles.resultSaveButton}>
                  <Text style={styles.resultSaveButtonText}>Guardar</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
          {/* TEMPORAL: iOS no puede presentar un <Modal> nativo arriba de
          otro ya abierto (queda invisible). El editor se mantiene abierto a
          proposito cuando la validacion falla, asi que el aviso va embebido
          aca en vez de depender del FeedbackModal de nivel de pantalla. */}
          <FeedbackModal
            embedded
            message={feedback.message}
            onClose={() => setFeedback((current) => ({ ...current, visible: false }))}
            tone={feedback.tone}
            title={feedback.title}
            visible={Boolean(resultEditor) && feedback.visible}
          />
        </KeyboardAvoidingView>
      </Modal>
      <Modal
        animationType="fade"
        onRequestClose={() => setStandingsModalZoneId("")}
        transparent
        visible={Boolean(standingsModalZone)}
      >
        <View style={styles.standingsModalOverlay}>
          <Pressable onPress={() => setStandingsModalZoneId("")} style={styles.resultModalBackdrop} />
          <View style={styles.standingsModalCard}>
            <Text style={styles.standingsModalTitle}>
              Puntajes {standingsModalZone?.label || ""}
            </Text>
            <View style={styles.standingsTable}>
              <View style={styles.standingsHeaderRow}>
                <Text style={[styles.standingsHeaderText, styles.standingsPairColumn]}>PAREJA</Text>
                {["PJ", "PG", "PP", "SF", "SC", "DIF", "DG"].map((label) => (
                  <Text key={label} style={styles.standingsHeaderText}>{label}</Text>
                ))}
              </View>
              {standingsModalRows.map((row, index) => (
                <View key={`standings-${row.registration.id}`} style={styles.standingsRow}>
                  <Text
                    numberOfLines={1}
                    style={[styles.standingsCellText, styles.standingsPairColumn]}
                  >
                    {index + 1}. {row.shortName}
                  </Text>
                  <Text style={styles.standingsCellText}>{row.PJ}</Text>
                  <Text style={styles.standingsCellText}>{row.PG}</Text>
                  <Text style={styles.standingsCellText}>{row.PP}</Text>
                  <Text style={styles.standingsCellText}>{row.SF}</Text>
                  <Text style={styles.standingsCellText}>{row.SC}</Text>
                  <Text style={styles.standingsCellText}>{formatSignedValue(row.DIF)}</Text>
                  <Text style={styles.standingsCellText}>{formatSignedValue(row.DG)}</Text>
                </View>
              ))}
            </View>
            <View style={styles.standingsLegendCard}>
              <Text style={styles.standingsLegendTitle}>Referencias</Text>
              <View style={styles.standingsLegendGrid}>
                {[
                  "PJ: Partido jugado",
                  "PG: Partido ganado",
                  "PP: Partido perdido",
                  "SF: Sets a favor",
                  "SC: Sets en contra",
                  "DIF: Diferencia de sets",
                  "DG: Diferencia de games",
                ].map((item) => (
                  <Text key={item} style={styles.standingsLegendItem}>
                    {item}
                  </Text>
                ))}
              </View>
            </View>
            <Pressable onPress={() => setStandingsModalZoneId("")} style={styles.standingsCloseButton}>
              <Text style={styles.standingsCloseButtonText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="fade"
        onRequestClose={() => setZoneDeleteTarget(null)}
        transparent
        visible={Boolean(zoneDeleteTarget)}
      >
        <View style={styles.deleteModalOverlay}>
          <Pressable onPress={() => setZoneDeleteTarget(null)} style={styles.resultModalBackdrop} />
          <View style={styles.deleteModalCard}>
            <Text style={styles.deleteModalTitle}>Eliminar zona</Text>
            <Text style={styles.deleteModalText}>
              ¿Estas seguro de eliminar {zoneDeleteTarget?.label || "esta zona"}?
            </Text>
            <View style={styles.deleteModalActions}>
              <Pressable onPress={() => setZoneDeleteTarget(null)} style={styles.deleteCancelButton}>
                <Text style={styles.deleteCancelButtonText}>Cancelar</Text>
              </Pressable>
              <Pressable onPress={() => removeZone(zoneDeleteTarget?.id)} style={styles.deleteConfirmButton}>
                <Text style={styles.deleteConfirmButtonText}>Eliminar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="fade"
        onRequestClose={() => setConfirmArmadoPrompt(null)}
        transparent
        visible={Boolean(confirmArmadoPrompt)}
      >
        <View style={styles.deleteModalOverlay}>
          <Pressable onPress={() => setConfirmArmadoPrompt(null)} style={styles.resultModalBackdrop} />
          <View style={styles.deleteModalCard}>
            <Text style={styles.deleteModalTitle}>{confirmArmadoPrompt?.title || "Establecer Cambios"}</Text>
            <Text style={styles.deleteModalText}>
              {confirmArmadoPrompt?.message || "¿Queres continuar?"}
            </Text>
            <View style={styles.deleteModalActions}>
              <Pressable onPress={() => setConfirmArmadoPrompt(null)} style={styles.deleteCancelButton}>
                <Text style={styles.deleteCancelButtonText}>Cancelar</Text>
              </Pressable>
              <Pressable onPress={confirmPromptArmado} style={styles.deleteConfirmButton}>
                <Text style={styles.deleteConfirmButtonText}>{confirmArmadoPrompt?.confirmLabel || "Confirmar"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <FeedbackModal
        message={feedback.message}
        onClose={() => setFeedback((current) => ({ ...current, visible: false }))}
        tone={feedback.tone}
        title={feedback.title}
        visible={feedback.visible && !resultEditor}
      />
      <BottomQuickActionsBar />
      {hasUnsavedChanges ? (
        <View style={[styles.unsavedChangesBanner, { bottom: BOTTOM_QUICK_ACTIONS_SPACE + Math.max(insets.bottom, 6) + 16 }]}>
          <Ionicons color="#A84F00" name="alert-circle" size={15} />
          <Text style={styles.unsavedChangesText}>Hay cambios sin guardar</Text>
        </View>
      ) : null}
      {Platform.OS === "ios" ? (
        <NumericKeyboardDoneBar nativeID={NUMERIC_KEYBOARD_ACCESSORY_ID} />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  timePickerOverlayWrap: {
    elevation: 200,
    zIndex: 200,
  },
  timePickerDoneButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 14,
    justifyContent: "center",
    marginHorizontal: spacing.lg,
    marginTop: spacing.xs,
    minHeight: 42,
  },
  timePickerDoneButtonText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "Inter_700Bold",
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    gap: spacing.md,
    paddingBottom: spacing.lg + BOTTOM_QUICK_ACTIONS_SPACE,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  loaderWrap: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  loaderText: {
    color: colors.muted,
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    marginTop: spacing.sm,
    textAlign: "center",
  },
  helperText: {
    color: colors.muted,
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    lineHeight: 15,
    marginTop: 3,
    textAlign: "center",
  },
  unsavedChangesBanner: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#FFF1DE",
    borderColor: "#FFB357",
    borderRadius: 999,
    borderWidth: 1,
    elevation: 6,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    left: 32,
    minHeight: 32,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    position: "absolute",
    right: 32,
    shadowColor: "#A84F00",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    zIndex: 20,
  },
  unsavedChangesText: {
    color: "#A84F00",
    fontSize: 11,
    fontFamily: "Inter_900Black",
    textTransform: "uppercase",
  },
  dayRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    paddingRight: spacing.lg,
  },
  dayScrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  dayChip: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    minWidth: 92,
    paddingHorizontal: spacing.sm,
  },
  dayChipActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  dayChipText: {
    color: colors.primaryDark,
    fontSize: 11,
    fontFamily: "Inter_900Black",
    textAlign: "center",
  },
  dayChipDateText: {
    color: colors.primaryDark,
    fontSize: 11,
    fontFamily: "Inter_800ExtraBold",
    marginTop: 2,
    textAlign: "center",
  },
  dayChipTextActive: {
    color: colors.surface,
  },
  extraCategoriesWrap: {
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  extraCategoriesLabel: {
    color: colors.muted,
    fontSize: 11,
    fontFamily: "Inter_700Bold",
  },
  extraCategoriesRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    paddingRight: spacing.lg,
  },
  extraCategoryChip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  extraCategoryChipActive: {
    backgroundColor: colors.secondary,
    borderColor: colors.primaryDark,
  },
  extraCategoryChipText: {
    color: colors.muted,
    fontSize: 11,
    fontFamily: "Inter_700Bold",
  },
  extraCategoryChipTextActive: {
    color: colors.primaryDark,
  },
  instantSaveNote: {
    color: colors.muted,
    fontFamily: "Inter_600SemiBold",
    fontSize: 11,
    marginBottom: spacing.sm,
  },
  filterChipsContent: {
    paddingRight: spacing.sm,
  },
  filterChipsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: spacing.sm,
  },
  filterChip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  filterChipActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  filterChipText: {
    color: colors.text,
    fontFamily: "Inter_700Bold",
    fontSize: 11,
  },
  filterChipTextActive: {
    color: colors.surface,
  },
  gridEmptyWrap: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  gridEmptyText: {
    color: colors.muted,
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    textAlign: "center",
  },
  newGridCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: spacing.sm,
    overflow: "hidden",
  },
  newGridRow: {
    flexDirection: "row",
  },
  newGridFixedColumn: {
    borderRightColor: colors.border,
    borderRightWidth: 1,
    width: 152,
  },
  newGridCornerCell: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    height: 40,
    justifyContent: "center",
  },
  newGridCornerText: {
    color: colors.muted,
    fontFamily: "Inter_900Black",
    fontSize: 10,
  },
  categoryHeaderFixedCell: {
    alignItems: "center",
    backgroundColor: colors.surfaceAlt || "#F6FBF8",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    borderLeftWidth: 4,
    flexDirection: "row",
    gap: 6,
    height: 40,
    paddingHorizontal: 8,
  },
  categoryHeaderBar: {
    borderRadius: 3,
    height: 20,
    width: 4,
  },
  categoryHeaderTextWrap: {
    flex: 1,
  },
  categoryHeaderTitle: {
    color: colors.text,
    fontFamily: "Inter_900Black",
    fontSize: 11,
  },
  categoryHeaderSubtitle: {
    color: colors.muted,
    fontFamily: "Inter_600SemiBold",
    fontSize: 9,
  },
  categoryHeaderScrollSpacer: {
    backgroundColor: colors.surfaceAlt || "#F6FBF8",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    height: 40,
  },
  pairNameCell: {
    borderBottomWidth: 1,
    borderRightWidth: 3,
    height: 56,
    justifyContent: "center",
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  pairNameCellReadOnly: {
    opacity: 0.75,
  },
  pairNameCellSelected: {
    borderColor: colors.primaryDark,
    borderRightWidth: 3,
  },
  pairNameCellTopRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  pairNameCellText: {
    flex: 1,
    fontFamily: "Inter_800ExtraBold",
    fontSize: 11,
    lineHeight: 13,
  },
  pairNameZoneBadge: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.85)",
    borderColor: "rgba(31,93,146,0.36)",
    borderRadius: 999,
    borderWidth: 1,
    height: 16,
    justifyContent: "center",
    width: 16,
  },
  pairNameZoneBadgeText: {
    color: "#1B5D92",
    fontFamily: "Inter_900Black",
    fontSize: 9,
  },
  pairNameStatusText: {
    fontFamily: "Inter_800ExtraBold",
    fontSize: 10,
    marginTop: 2,
  },
  pairNameSelectedBadge: {
    alignItems: "center",
    backgroundColor: colors.primaryDark,
    borderRadius: 999,
    height: 14,
    justifyContent: "center",
    position: "absolute",
    right: 4,
    top: 4,
    width: 14,
  },
  coincidenFixedCell: {
    alignItems: "center",
    backgroundColor: colors.surfaceAlt || "#F6FBF8",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    height: 30,
    justifyContent: "center",
  },
  coincidenFixedText: {
    color: colors.muted,
    fontFamily: "Inter_800ExtraBold",
    fontSize: 9,
  },
  canchasOcupadasFixedCell: {
    alignItems: "center",
    backgroundColor: colors.surfaceAlt || "#F6FBF8",
    height: 30,
    justifyContent: "center",
  },
  canchasOcupadasFixedText: {
    color: colors.muted,
    fontFamily: "Inter_800ExtraBold",
    fontSize: 9,
  },
  hourHeaderRow: {
    flexDirection: "row",
  },
  hourHeaderCell: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    borderRightColor: colors.border,
    borderRightWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 56,
  },
  hourHeaderText: {
    color: colors.muted,
    fontFamily: "Inter_900Black",
    fontSize: 10,
  },
  pairCellsRow: {
    flexDirection: "row",
  },
  hourCell: {
    backgroundColor: "#F7FAF8",
    borderBottomColor: "#E6ECE8",
    borderBottomWidth: 1,
    borderRightColor: "#E6ECE8",
    borderRightWidth: 1,
    height: 56,
    width: 56,
  },
  hourCellReadOnly: {
    opacity: 0.75,
  },
  coincidenCellsRow: {
    flexDirection: "row",
  },
  coincidenCell: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    borderRightColor: "#E6ECE8",
    borderRightWidth: 1,
    height: 30,
    justifyContent: "center",
    width: 56,
  },
  coincidenCellText: {
    color: colors.text,
    fontFamily: "Inter_800ExtraBold",
    fontSize: 10,
  },
  canchasOcupadasCellsRow: {
    flexDirection: "row",
  },
  canchasOcupadasCell: {
    alignItems: "center",
    borderRightColor: "#E6ECE8",
    borderRightWidth: 1,
    height: 30,
    justifyContent: "center",
    width: 56,
  },
  canchasOcupadasCellFull: {
    backgroundColor: "rgba(176,64,64,0.14)",
  },
  canchasOcupadasCellText: {
    color: colors.muted,
    fontFamily: "Inter_800ExtraBold",
    fontSize: 9,
  },
  canchasOcupadasCellTextFull: {
    color: colors.danger,
  },
  gridCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  combinedHeaderCell: {
    alignItems: "center",
    borderBottomWidth: 1,
    borderRightWidth: 1,
    height: 74,
    justifyContent: "center",
    paddingHorizontal: 4,
    paddingTop: 4,
    width: 74,
  },
  combinedHeaderCellInactive: {
    opacity: 0.85,
  },
  combinedCategoryBadge: {
    backgroundColor: "rgba(255,255,255,0.88)",
    borderRadius: 6,
    marginBottom: 2,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  combinedCategoryBadgeInactive: {
    backgroundColor: "rgba(120,120,120,0.18)",
  },
  combinedCategoryBadgeText: {
    color: colors.primaryDark,
    fontSize: 8,
    fontFamily: "Inter_900Black",
  },
  combinedCategoryBadgeTextInactive: {
    color: colors.muted,
  },
  combinedZoneLabelText: {
    color: colors.text,
    fontSize: 13,
    fontFamily: "Inter_900Black",
  },
  combinedTimeCell: {
    alignItems: "center",
    borderBottomColor: "#E6ECE8",
    borderBottomWidth: 1,
    borderRightColor: colors.border,
    borderRightWidth: 1,
    height: 88,
    justifyContent: "center",
  },
  combinedSlotCell: {
    borderBottomColor: "#E6ECE8",
    borderBottomWidth: 1,
    borderRightColor: "#E6ECE8",
    borderRightWidth: 1,
    height: 88,
    justifyContent: "center",
  },
  combinedMiniCell: {
    backgroundColor: "#F7FAF8",
    height: 22,
    width: "100%",
  },
  gridHeader: {
    flexDirection: "row",
  },
  timeHeaderCell: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    borderRightColor: colors.border,
    borderRightWidth: 1,
    height: 62,
    justifyContent: "center",
    width: 58,
  },
  timeHeaderText: {
    color: colors.muted,
    fontSize: 11,
    fontFamily: "Inter_900Black",
  },
  pairHeaderRow: {
    flexDirection: "row",
  },
  pairHeaderCell: {
    alignItems: "center",
    borderBottomWidth: 1,
    borderRightWidth: 1,
    height: 62,
    justifyContent: "center",
    paddingHorizontal: 4,
    width: 74,
  },
  pairHeaderCellSelected: {
    borderColor: colors.primaryDark,
    borderWidth: 3,
    elevation: 3,
    shadowColor: colors.primaryDark,
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  pairHeaderCellAssigned: {
    opacity: 0.72,
  },
  selectedBadge: {
    alignItems: "center",
    backgroundColor: colors.primaryDark,
    borderRadius: 999,
    height: 16,
    justifyContent: "center",
    position: "absolute",
    right: 4,
    top: 4,
    width: 16,
    zIndex: 2,
  },
  zoneLetterBadge: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.88)",
    borderColor: "rgba(31,93,146,0.36)",
    borderRadius: 999,
    borderWidth: 1,
    height: 17,
    justifyContent: "center",
    left: 4,
    position: "absolute",
    top: 4,
    width: 17,
    zIndex: 2,
  },
  zoneLetterBadgeText: {
    color: "#1B5D92",
    fontSize: 10,
    fontFamily: "Inter_900Black",
    lineHeight: 12,
    textAlign: "center",
  },
  pairHeaderText: {
    fontSize: 9,
    fontFamily: "Inter_900Black",
    lineHeight: 10,
    textAlign: "center",
  },
  pairHeaderTextSelected: {
    paddingHorizontal: 8,
  },
  pairHeaderAvailabilityText: {
    fontSize: 7,
    fontFamily: "Inter_800ExtraBold",
    lineHeight: 8,
    marginTop: 2,
    opacity: 0.82,
    textAlign: "center",
  },
  gridBody: {
    flexDirection: "row",
  },
  timeColumn: {
    width: 58,
  },
  timeCell: {
    alignItems: "center",
    borderBottomColor: "#E6ECE8",
    borderBottomWidth: 1,
    borderRightColor: colors.border,
    borderRightWidth: 1,
    height: 22,
    justifyContent: "center",
  },
  timeText: {
    color: colors.text,
    fontSize: 9,
    fontFamily: "Inter_800ExtraBold",
  },
  availabilityColumns: {
    flexDirection: "row",
  },
  availabilityColumn: {
    width: 74,
  },
  availabilityCell: {
    backgroundColor: "#F7FAF8",
    borderBottomColor: "#E6ECE8",
    borderBottomWidth: 1,
    borderRightColor: "#E6ECE8",
    borderRightWidth: 1,
    height: 22,
  },
  selectionCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  selectionTitle: {
    color: colors.primaryDark,
    fontSize: 12,
    fontFamily: "Inter_900Black",
    textAlign: "center",
  },
  selectionText: {
    color: colors.muted,
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    lineHeight: 13,
    marginTop: 3,
    textAlign: "center",
  },
  actionRow: {
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: 6,
  },
  addToZoneWrap: {
    marginTop: spacing.sm,
  },
  addToZoneLabel: {
    color: colors.muted,
    fontSize: 11,
    fontFamily: "Inter_900Black",
    textAlign: "center",
    textTransform: "uppercase",
  },
  addToZoneRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    justifyContent: "center",
    marginTop: spacing.xs,
  },
  addToZoneChip: {
    backgroundColor: "#EDF7F2",
    borderColor: "#C9E5D8",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  addToZoneChipDisabled: {
    backgroundColor: "#F1F3F2",
    borderColor: "#DDE4E1",
    opacity: 0.55,
  },
  addToZoneChipText: {
    color: colors.primaryDark,
    fontSize: 11,
    fontFamily: "Inter_900Black",
  },
  addToZoneChipTextDisabled: {
    color: colors.muted,
  },
  primaryAction: {
    alignItems: "center",
    backgroundColor: colors.primaryDark,
    borderRadius: 10,
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 32,
  },
  primaryActionText: {
    color: colors.surface,
    fontSize: 11,
    fontFamily: "Inter_900Black",
    textTransform: "uppercase",
  },
  secondaryAction: {
    alignItems: "center",
    backgroundColor: "#F3F6F8",
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 32,
    width: 78,
  },
  secondaryActionText: {
    color: colors.primaryDark,
    fontSize: 11,
    fontFamily: "Inter_900Black",
  },
  zoneStack: {
    gap: spacing.sm,
  },
  zoneCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
  },
  zoneCardUnscheduled: {
    borderColor: colors.danger,
    borderWidth: 2,
  },
  zoneUnscheduledBanner: {
    alignItems: "center",
    backgroundColor: "#FFF0F0",
    borderColor: colors.danger,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    marginBottom: spacing.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  zoneUnscheduledBannerText: {
    color: colors.danger,
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  hiddenSection: {
    display: "none",
  },
  zoneHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  zoneHeaderMain: {
    flex: 1,
  },
  zoneTitle: {
    color: colors.primaryDark,
    fontSize: 15,
    fontFamily: "Inter_900Black",
    textTransform: "uppercase",
  },
  zoneCategoryBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.secondary,
    borderRadius: 999,
    marginBottom: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  zoneCategoryBadgeText: {
    color: colors.primaryDark,
    fontSize: 10,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  zoneCompactPairs: {
    gap: 4,
    marginTop: spacing.xs,
  },
  zoneCompactPairRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  zoneCompactPairNumber: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    height: 20,
    justifyContent: "center",
    width: 20,
  },
  zoneCompactPairNumberText: {
    fontSize: 11,
    fontFamily: "Inter_900Black",
  },
  zoneCompactPairName: {
    flex: 1,
    fontSize: 11,
    fontFamily: "Inter_900Black",
  },
  zoneCompactPairRemove: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 20,
    minWidth: 20,
  },
  zoneSubtitle: {
    color: colors.muted,
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    marginTop: 2,
  },
  removeZoneButton: {
    alignItems: "center",
    backgroundColor: "#F7F2F2",
    borderColor: "#E8DCDC",
    borderRadius: 999,
    borderWidth: 1,
    height: 26,
    justifyContent: "center",
    opacity: 0.78,
    width: 26,
  },
  zonePairsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  zonePairChip: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    maxWidth: "100%",
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  zonePairChipText: {
    fontSize: 11,
    fontFamily: "Inter_900Black",
  },
  zonePairRemoveButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 18,
    minWidth: 18,
  },
  zoneMatchTable: {
    alignSelf: "stretch",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: spacing.sm,
    overflow: "hidden",
  },
  zoneMatchTableHeader: {
    backgroundColor: "#F3F6F8",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: 28,
  },
  zoneMatchTableHeaderText: {
    color: colors.primaryDark,
    fontSize: 9,
    fontFamily: "Inter_900Black",
    paddingHorizontal: 5,
    paddingVertical: 7,
    textAlign: "center",
  },
  zoneMatchTableRow: {
    alignItems: "center",
    borderBottomColor: "#E6ECE8",
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: 30,
  },
  zoneMatchTableRowConflict: {
    backgroundColor: "rgba(176,64,64,0.08)",
  },
  zoneMatchConflictRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    paddingBottom: 6,
    paddingHorizontal: 4,
  },
  zoneMatchConflictText: {
    color: colors.danger,
    flex: 1,
    fontSize: 10,
    fontFamily: "Inter_700Bold",
  },
  zoneMatchTableCellText: {
    color: colors.text,
    fontSize: 10,
    fontFamily: "Inter_800ExtraBold",
    paddingHorizontal: 5,
    textAlign: "center",
  },
  zoneMatchPairsCell: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    minHeight: 30,
    paddingHorizontal: 3,
  },
  zoneMatchWinnerNumberText: {
    color: "#39FF14",
    fontSize: 12,
    fontFamily: "Inter_900Black",
  },
  zoneMatchDayButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 30,
    paddingHorizontal: 4,
  },
  zoneMatchDayButtonText: {
    color: colors.primaryDark,
    fontSize: 9,
    fontFamily: "Inter_900Black",
    textAlign: "center",
  },
  zoneMatchPairColumn: {
    flex: 1.12,
  },
  zoneMatchResultColumn: {
    flex: 1.22,
  },
  zoneMatchDayColumn: {
    flex: 0.72,
  },
  zoneMatchTimeColumn: {
    flex: 0.78,
  },
  zoneMatchPlaceColumn: {
    flex: 1,
  },
  zoneMatchResultButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 30,
    paddingHorizontal: 3,
  },
  zoneMatchResultButtonText: {
    color: colors.muted,
    fontSize: 8,
    fontFamily: "Inter_900Black",
    textAlign: "center",
  },
  zoneMatchResultButtonTextLoaded: {
    color: colors.primaryDark,
    fontSize: 8.5,
  },
  zoneMatchTimeButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 30,
    paddingHorizontal: 4,
  },
  zoneMatchTimeButtonText: {
    color: "#214A84",
    fontSize: 10,
    fontFamily: "Inter_900Black",
  },
  zoneMatchPlaceButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 30,
    paddingHorizontal: 4,
  },
  zoneMatchPlaceButtonText: {
    color: colors.text,
    fontSize: 9,
    fontFamily: "Inter_900Black",
    textAlign: "center",
  },
  zoneMatchTableEmpty: {
    color: colors.muted,
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    lineHeight: 17,
    padding: spacing.sm,
    textAlign: "center",
  },
  zoneQualifiersRow: {
    alignItems: "center",
    backgroundColor: "#F7FAF8",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
  },
  zoneQualifiersTextWrap: {
    flex: 1,
    gap: 2,
  },
  zoneQualifierText: {
    color: colors.text,
    fontSize: 10,
    fontFamily: "Inter_900Black",
  },
  zoneStandingsButton: {
    alignItems: "center",
    backgroundColor: "#E7F4F1",
    borderColor: "#B7DED5",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 30,
    paddingHorizontal: 10,
  },
  zoneStandingsButtonText: {
    color: "#176B5B",
    fontSize: 10,
    fontFamily: "Inter_900Black",
  },
  resultModalOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
  },
  resultModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  dayPickerModalOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  dayPickerModalCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    padding: spacing.lg,
    width: "100%",
  },
  dayPickerModalTitle: {
    color: colors.primaryDark,
    fontSize: 18,
    fontFamily: "Inter_900Black",
    textAlign: "center",
  },
  dayPickerMatchPreview: {
    gap: 5,
    marginTop: spacing.md,
  },
  dayPickerParticipantRow: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: spacing.sm,
  },
  dayPickerParticipantNumber: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    height: 24,
    justifyContent: "center",
    marginRight: spacing.xs,
    width: 24,
  },
  dayPickerParticipantNumberText: {
    fontSize: 11,
    fontFamily: "Inter_900Black",
  },
  dayPickerParticipantName: {
    fontSize: 12,
    fontFamily: "Inter_900Black",
    textAlign: "center",
  },
  dayPickerVsText: {
    color: colors.muted,
    fontSize: 10,
    fontFamily: "Inter_900Black",
    lineHeight: 12,
    textAlign: "center",
    textTransform: "uppercase",
  },
  dayPickerOptions: {
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  dayPickerOption: {
    alignItems: "center",
    backgroundColor: "#F7FAF8",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  dayPickerOptionSelected: {
    backgroundColor: "#DDF6EF",
    borderColor: "#89D9C4",
  },
  dayPickerOptionText: {
    color: colors.primaryDark,
    fontSize: 13,
    fontFamily: "Inter_900Black",
  },
  dayPickerOptionMeta: {
    color: colors.muted,
    fontSize: 12,
    fontFamily: "Inter_800ExtraBold",
  },
  dayPickerOptionTextSelected: {
    color: "#176B5B",
  },
  dayPickerCancelButton: {
    alignItems: "center",
    backgroundColor: "#F3F6F5",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: spacing.md,
    minHeight: 40,
  },
  dayPickerCancelButtonText: {
    color: colors.muted,
    fontSize: 12,
    fontFamily: "Inter_900Black",
  },
  resultModalCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    padding: spacing.lg,
    width: "100%",
  },
  resultModalScrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  resultModalTitle: {
    color: colors.primaryDark,
    fontSize: 20,
    fontFamily: "Inter_900Black",
    textAlign: "center",
  },
  resultModalSubtitle: {
    color: colors.muted,
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    lineHeight: 17,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  winnerOptions: {
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  winnerOption: {
    alignItems: "center",
    backgroundColor: "#F7FAF8",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: spacing.sm,
  },
  winnerOptionSelected: {
    backgroundColor: "#DDF6EF",
    borderColor: "#89D9C4",
  },
  winnerOptionText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontFamily: "Inter_900Black",
    textAlign: "center",
  },
  winnerOptionTextSelected: {
    color: "#176B5B",
  },
  winnerBadgeText: {
    color: "#176B5B",
    fontSize: 9,
    fontFamily: "Inter_900Black",
    marginTop: 2,
    textAlign: "center",
  },
  resultNoWinnerText: {
    color: colors.muted,
    fontSize: 12,
    fontFamily: "Inter_800ExtraBold",
    lineHeight: 16,
    marginTop: spacing.md,
    textAlign: "center",
  },
  setsGrid: {
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  setRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
  },
  setLabel: {
    color: colors.primaryDark,
    fontSize: 11,
    fontFamily: "Inter_900Black",
    textAlign: "right",
    width: 102,
  },
  superTieBreakSetLabel: {
    fontSize: 10,
    lineHeight: 12,
  },
  setInput: {
    backgroundColor: "#F7FAF8",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    fontFamily: "Inter_900Black",
    height: 42,
    paddingHorizontal: spacing.sm,
    textAlign: "center",
    width: 86,
  },
  superTieBreakSetInput: {
    width: 86,
  },
  resultModalActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  resultCancelButton: {
    alignItems: "center",
    backgroundColor: "#EEF3F2",
    borderRadius: 14,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
  },
  resultCancelButtonText: {
    color: colors.primaryDark,
    fontSize: 13,
    fontFamily: "Inter_900Black",
  },
  resultSaveButton: {
    alignItems: "center",
    backgroundColor: colors.primaryDark,
    borderRadius: 14,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
  },
  resultSaveButtonText: {
    color: colors.surface,
    fontSize: 13,
    fontFamily: "Inter_900Black",
  },
  standingsModalOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  standingsModalCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    padding: spacing.md,
    width: "100%",
  },
  standingsModalTitle: {
    color: colors.primaryDark,
    fontSize: 18,
    fontFamily: "Inter_900Black",
    textAlign: "center",
    textTransform: "uppercase",
  },
  standingsTable: {
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: spacing.md,
    overflow: "hidden",
  },
  standingsHeaderRow: {
    backgroundColor: "#F3F6F8",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: 30,
  },
  standingsRow: {
    alignItems: "center",
    borderBottomColor: "#E6ECE8",
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: 30,
  },
  standingsHeaderText: {
    color: colors.primaryDark,
    flex: 0.48,
    fontSize: 9,
    fontFamily: "Inter_900Black",
    paddingVertical: 8,
    textAlign: "center",
  },
  standingsCellText: {
    color: colors.text,
    flex: 0.48,
    fontSize: 10,
    fontFamily: "Inter_900Black",
    textAlign: "center",
  },
  standingsPairColumn: {
    flex: 1.9,
    paddingHorizontal: 6,
    textAlign: "left",
  },
  standingsLegendCard: {
    backgroundColor: "#F7FAF8",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  standingsLegendTitle: {
    color: colors.primaryDark,
    fontSize: 11,
    fontFamily: "Inter_900Black",
    marginBottom: 5,
    textAlign: "center",
    textTransform: "uppercase",
  },
  standingsLegendGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 3,
  },
  standingsLegendItem: {
    color: colors.muted,
    fontSize: 9,
    fontFamily: "Inter_800ExtraBold",
    lineHeight: 13,
    width: "50%",
    textAlign: "left",
  },
  standingsCloseButton: {
    alignItems: "center",
    backgroundColor: colors.primaryDark,
    borderRadius: 14,
    justifyContent: "center",
    marginTop: spacing.md,
    minHeight: 42,
  },
  standingsCloseButtonText: {
    color: colors.surface,
    fontSize: 13,
    fontFamily: "Inter_900Black",
  },
  deleteModalOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  deleteModalCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    padding: spacing.lg,
    width: "100%",
  },
  deleteModalTitle: {
    color: colors.text,
    fontSize: 20,
    fontFamily: "Inter_900Black",
    textAlign: "center",
  },
  deleteModalText: {
    color: colors.muted,
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    lineHeight: 20,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  deleteModalActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  deleteCancelButton: {
    alignItems: "center",
    backgroundColor: "#EEF3F2",
    borderRadius: 14,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
  },
  deleteCancelButtonText: {
    color: colors.primaryDark,
    fontSize: 13,
    fontFamily: "Inter_900Black",
  },
  deleteConfirmButton: {
    alignItems: "center",
    backgroundColor: "#B95555",
    borderRadius: 14,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
  },
  deleteConfirmButtonText: {
    color: colors.surface,
    fontSize: 13,
    fontFamily: "Inter_900Black",
  },
  emptyText: {
    color: colors.muted,
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  bottomActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  quickPairAddWrap: {
    alignItems: "center",
    marginTop: spacing.sm,
  },
  quickPairAddButton: {
    alignItems: "center",
    backgroundColor: "#F7FAF8",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    position: "relative",
    width: 42,
  },
  quickPairAddButtonPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.97 }],
  },
  quickPairAddBadge: {
    alignItems: "center",
    backgroundColor: colors.primaryDark,
    borderColor: colors.surface,
    borderRadius: 999,
    borderWidth: 1,
    height: 18,
    justifyContent: "center",
    position: "absolute",
    right: -2,
    top: -3,
    width: 18,
  },
  saveAction: {
    alignItems: "center",
    backgroundColor: "#EDF7F2",
    borderColor: "#C9E5D8",
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
  },
  saveActionText: {
    color: colors.primaryDark,
    fontSize: 13,
    fontFamily: "Inter_900Black",
  },
  confirmAction: {
    alignItems: "center",
    backgroundColor: "#2563A8",
    borderRadius: 14,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
  },
  confirmActionText: {
    color: colors.surface,
    fontSize: 13,
    fontFamily: "Inter_900Black",
  },
  actionDisabled: {
    opacity: 0.65,
  },
  customScheduleOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  customScheduleCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
    width: "100%",
  },
  customScheduleTitle: {
    color: colors.text,
    fontSize: 17,
    fontFamily: "Inter_900Black",
    textAlign: "center",
  },
  customScheduleSummary: {
    alignItems: "center",
    backgroundColor: "#F4F8FF",
    borderColor: "#D0E3F8",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
    paddingVertical: 10,
  },
  customScheduleDayText: {
    color: colors.muted,
    fontSize: 13,
    fontFamily: "Inter_700Bold",
  },
  customScheduleTimeText: {
    color: colors.primaryDark,
    fontSize: 22,
    fontFamily: "Inter_900Black",
  },
  customScheduleLabel: {
    color: colors.muted,
    fontSize: 11,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 0.4,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  customScheduleChipRow: {
    gap: 6,
    paddingVertical: 2,
  },
  customScheduleChip: {
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1.5,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  customScheduleChipActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  customScheduleChipText: {
    color: colors.muted,
    fontSize: 13,
    fontFamily: "Inter_700Bold",
  },
  customScheduleChipTextActive: {
    color: colors.surface,
  },
  customScheduleCourtRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  customScheduleCourtChip: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1.5,
    height: 44,
    justifyContent: "center",
    minWidth: 44,
    paddingHorizontal: 12,
  },
  customScheduleCourtChipActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  customScheduleCourtText: {
    color: colors.text,
    fontSize: 16,
    fontFamily: "Inter_800ExtraBold",
  },
  customScheduleCourtTextActive: {
    color: colors.surface,
  },
  customScheduleConflictRow: {
    alignItems: "center",
    backgroundColor: "#FFF4F4",
    borderColor: "#F0BCBC",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  customScheduleConflictText: {
    color: colors.danger,
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_700Bold",
  },
  customScheduleActions: {
    flexDirection: "row",
    gap: 8,
  },
  customScheduleCancelButton: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    paddingVertical: 11,
  },
  customScheduleCancelText: {
    color: colors.muted,
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  customScheduleConfirmButton: {
    alignItems: "center",
    backgroundColor: colors.primaryDark,
    borderRadius: 12,
    flex: 2,
    justifyContent: "center",
    paddingVertical: 11,
  },
  customScheduleConfirmWarning: {
    backgroundColor: "#B95555",
  },
  customScheduleConfirmText: {
    color: colors.surface,
    fontSize: 13,
    fontFamily: "Inter_900Black",
  },
  slotPickerOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
  },
  slotPickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  slotPickerCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "85%",
    paddingBottom: 28,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  slotPickerTitle: {
    color: colors.text,
    fontSize: 20,
    fontFamily: "Inter_900Black",
    marginBottom: 2,
    textAlign: "center",
  },
  slotPickerSubtitle: {
    color: colors.muted,
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    marginBottom: spacing.md,
    textAlign: "center",
  },
  slotPickerEmptyText: {
    color: colors.muted,
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    paddingVertical: spacing.lg,
    textAlign: "center",
  },
  slotPickerDayRow: {
    flexGrow: 0,
    marginBottom: spacing.sm,
  },
  slotPickerDayRowContent: {
    gap: 8,
    paddingHorizontal: 2,
  },
  slotPickerDayChip: {
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  slotPickerDayChipActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  slotPickerDayChipText: {
    color: colors.muted,
    fontSize: 13,
    fontFamily: "Inter_700Bold",
  },
  slotPickerDayChipTextActive: {
    color: colors.surface,
  },
  slotPickerSingleVenueRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    marginBottom: spacing.sm,
    paddingHorizontal: 2,
  },
  slotPickerSingleVenueText: {
    color: colors.primaryDark,
    fontSize: 13,
    fontFamily: "Inter_700Bold",
  },
  slotPickerVenueRow: {
    flexGrow: 0,
    marginBottom: spacing.sm,
  },
  slotPickerVenueRowContent: {
    gap: 6,
    paddingHorizontal: 2,
  },
  slotPickerVenueChip: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  slotPickerVenueChipActive: {
    backgroundColor: "#EAF3FF",
    borderColor: "#1B5D92",
  },
  slotPickerVenueChipText: {
    color: colors.muted,
    fontSize: 12,
    fontFamily: "Inter_700Bold",
  },
  slotPickerVenueChipTextActive: {
    color: "#1B5D92",
  },
  slotPickerSlotsLabel: {
    color: colors.muted,
    fontSize: 11,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 0.4,
    marginBottom: 6,
    marginTop: spacing.sm,
    textTransform: "uppercase",
  },
  slotPickerSlotsScroll: {
    maxHeight: 260,
  },
  slotPickerSlot: {
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
    marginBottom: 6,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  slotPickerSlotMainRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  slotPickerSlotWithConflict: {
    backgroundColor: "rgba(176,64,64,0.06)",
    borderColor: "rgba(176,64,64,0.4)",
  },
  slotPickerSlotReasonText: {
    color: colors.danger,
    fontSize: 11,
    fontFamily: "Inter_700Bold",
  },
  slotPickerSlotSelected: {
    backgroundColor: "#EAF3FF",
    borderColor: "#1B5D92",
    borderWidth: 1.5,
  },
  slotPickerSlotTime: {
    color: colors.text,
    fontSize: 16,
    fontFamily: "Inter_800ExtraBold",
    minWidth: 60,
  },
  slotPickerSlotTimeSelected: {
    color: "#1B5D92",
  },
  slotPickerSlotCourt: {
    color: colors.muted,
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  slotPickerSlotCourtSelected: {
    color: "#1B5D92",
  },
  slotPickerFooter: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 8,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
  },
  slotPickerClearButton: {
    alignItems: "center",
    backgroundColor: "#FEF4F4",
    borderColor: "#D9A8A8",
    borderRadius: 10,
    borderWidth: 1.5,
    flex: 1,
    flexDirection: "row",
    gap: 4,
    justifyContent: "center",
    paddingVertical: 9,
  },
  slotPickerClearButtonText: {
    color: "#B04040",
    fontSize: 12,
    fontFamily: "Inter_700Bold",
  },
  slotPickerDefineButton: {
    alignItems: "center",
    backgroundColor: "#2563A8",
    borderRadius: 10,
    flex: 1,
    flexDirection: "row",
    gap: 4,
    justifyContent: "center",
    paddingVertical: 9,
  },
  slotPickerDefineButtonText: {
    color: colors.surface,
    fontSize: 12,
    fontFamily: "Inter_800ExtraBold",
  },
  slotPickerCancelButton: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingVertical: 9,
  },
  slotPickerCancelText: {
    color: colors.muted,
    fontSize: 12,
    fontFamily: "Inter_700Bold",
  },
});
