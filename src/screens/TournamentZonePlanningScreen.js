import { Fragment, useCallback, useMemo, useRef, useState } from "react";
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
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import BottomQuickActionsBar, {
  BOTTOM_QUICK_ACTIONS_SPACE,
} from "../components/BottomQuickActionsBar";
import FeedbackModal from "../components/FeedbackModal";
import SectionHeader from "../components/SectionHeader";
import TournamentHeaderCard from "../components/TournamentHeaderCard";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import { getQuickSlotDefinitions } from "../services/availabilityService";
import {
  buildTournamentDayOptions,
} from "../services/tournamentAvailabilityService";
import {
  getTournamentById,
  listTournamentRegistrations,
  updateTournament,
} from "../services/tournamentsService";

const ZONE_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
const PAIR_COLORS = [
  { bg: "#E8F5EE", border: "#9FD0B6", fill: "#BFE8D0", text: "#0F5F37" },
  { bg: "#EAF3FF", border: "#A9C8EA", fill: "#C7DFFF", text: "#1F5B99" },
  { bg: "#FFF4E3", border: "#E7C27E", fill: "#F7D89A", text: "#895A00" },
  { bg: "#F3EEFF", border: "#C8B8EA", fill: "#D9CCFF", text: "#5B3EA0" },
  { bg: "#E8FAFA", border: "#9CD4D1", fill: "#BCE9E7", text: "#146C68" },
  { bg: "#FFF0F4", border: "#E7A9B8", fill: "#F7C7D2", text: "#9B314B" },
];
const TIME_SLOTS = Array.from({ length: 18 }, (_, index) => {
  const hour = index + 7;
  const normalizedHour = hour === 24 ? 0 : hour;
  return {
    label: `${String(normalizedHour).padStart(2, "0")}:00`,
    minutes: hour * 60,
  };
});

const ZONE_MATCH_DURATION_MINUTES = 75;

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

function buildZoneMatchSchedulingSlots(schedules = [], durationMinutes = ZONE_MATCH_DURATION_MINUTES) {
  const slots = [];
  (Array.isArray(schedules) ? schedules : []).forEach((schedule) => {
    const startMinutes = parseMinutes(schedule.from);
    const endMinutes = parseMinutes(schedule.to);
    if (endMinutes - startMinutes < durationMinutes) return;
    for (let cur = startMinutes; cur + durationMinutes <= endMinutes; cur += durationMinutes) {
      for (let courtIndex = 1; courtIndex <= Number(schedule.courts || 1); courtIndex += 1) {
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
  const [standingsModalZoneId, setStandingsModalZoneId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const headerScrollRef = useRef(null);
  const bodyScrollRef = useRef(null);
  const savedPlanningRef = useRef({ confirmed: false, zones: [] });
  const syncingHorizontalScrollRef = useRef(false);
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

  const tournamentDayOptions = useMemo(() => buildTournamentDayOptions(tournament || {}), [tournament]);
  const tournamentVenueOptions = useMemo(() => buildTournamentVenueOptions(tournament || {}), [tournament]);

  const slotsByDay = useMemo(() => {
    if (!slotPickerTarget) return [];
    const { zoneId, matchKey } = slotPickerTarget;
    const venueSchedules = (tournament?.fixtureSetup?.zoneVenueSchedules || []).filter((s) => s.useForZones);
    const occupiedKeys = new Set();
    (zonePlanning.zones || []).forEach((zone) => {
      Object.entries(zone.matchSchedules || {}).forEach(([mk, schedule]) => {
        if (zone.id === zoneId && mk === matchKey) return;
        if (!schedule.startTime || !schedule.dayKey) return;
        occupiedKeys.add(`${schedule.dayKey}|${schedule.startTime}|${schedule.venueId || ""}|${schedule.courtIndex || 0}`);
      });
    });
    const allSlots = buildZoneMatchSchedulingSlots(venueSchedules);
    const available = allSlots.filter((slot) => {
      const key = `${slot.dayKey}|${formatMinutesToTime(slot.startMinutes)}|${slot.venueId}|${slot.courtIndex}`;
      return !occupiedKeys.has(key);
    });
    const grouped = {};
    available.forEach((slot) => {
      if (!grouped[slot.dayKey]) grouped[slot.dayKey] = [];
      grouped[slot.dayKey].push(slot);
    });
    return tournamentDayOptions.filter((day) => grouped[day.key]).map((day) => ({
      dayKey: day.key,
      dayLabel: day.label,
      slots: grouped[day.key],
    }));
  }, [slotPickerTarget, zonePlanning, tournament, tournamentDayOptions]);
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
  const assignedIds = useMemo(
    () => new Set((zonePlanning.zones || []).flatMap((zone) => zone.registrationIds || [])),
    [zonePlanning.zones]
  );
  const assignedZoneLetterByRegistrationId = useMemo(() => {
    const nextMap = new Map();

    (zonePlanning.zones || []).forEach((zone, zoneIndex) => {
      const label = String(zone?.label || "").trim();
      const labelLetterMatch = label.match(/zona\s+([a-z])/i);
      const zoneLetter = (labelLetterMatch?.[1] || ZONE_LETTERS[zoneIndex] || `${zoneIndex + 1}`).toUpperCase();

      (zone.registrationIds || []).forEach((registrationId) => {
        nextMap.set(String(registrationId), zoneLetter);
      });
    });

    return nextMap;
  }, [zonePlanning.zones]);
  const orderedRegistrations = useMemo(
    () =>
      [...confirmedRegistrations].sort((first, second) => {
        const firstAssigned = assignedIds.has(first.id);
        const secondAssigned = assignedIds.has(second.id);

        if (firstAssigned !== secondAssigned) {
          return firstAssigned ? 1 : -1;
        }

        if (firstAssigned && secondAssigned) {
          const firstZoneLetter = assignedZoneLetterByRegistrationId.get(String(first.id)) || "";
          const secondZoneLetter = assignedZoneLetterByRegistrationId.get(String(second.id)) || "";
          const zoneComparison = firstZoneLetter.localeCompare(secondZoneLetter, "es", {
            numeric: true,
            sensitivity: "base",
          });

          if (zoneComparison !== 0) {
            return zoneComparison;
          }
        }

        return 0;
      }),
    [assignedIds, assignedZoneLetterByRegistrationId, confirmedRegistrations]
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

  const syncHorizontalScroll = (source, offsetX) => {
    if (syncingHorizontalScrollRef.current) {
      return;
    }

    syncingHorizontalScrollRef.current = true;
    const targetRef = source === "header" ? bodyScrollRef : headerScrollRef;
    targetRef.current?.scrollTo({ animated: false, x: offsetX });
    requestAnimationFrame(() => {
      syncingHorizontalScrollRef.current = false;
    });
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

  const findScheduleConflict = (zoneId, matchKey, dayKey, startTime, venueId, courtIndex) => {
    const proposedStart = parseMinutes(startTime);
    const proposedEnd = proposedStart + ZONE_MATCH_DURATION_MINUTES;
    for (const zone of (zonePlanning.zones || [])) {
      for (const [mk, schedule] of Object.entries(zone.matchSchedules || {})) {
        if (zone.id === zoneId && mk === matchKey) continue;
        if (schedule.dayKey !== dayKey) continue;
        if (!schedule.startTime) continue;
        if (String(schedule.venueId || "") !== String(venueId || "")) continue;
        if ((Number(schedule.courtIndex) || 0) !== (Number(courtIndex) || 0)) continue;
        const existingStart = parseMinutes(schedule.startTime);
        const existingEnd = existingStart + ZONE_MATCH_DURATION_MINUTES;
        if (proposedStart < existingEnd && proposedEnd > existingStart) {
          return { conflictTime: schedule.startTime };
        }
      }
    }
    return null;
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

  const handleSelectSlot = (slot) => {
    if (!slotPickerTarget) return;
    updateZoneMatchSchedule(slotPickerTarget.zoneId, slotPickerTarget.matchKey, {
      startTime: formatMinutesToTime(slot.startMinutes),
      dayKey: slot.dayKey,
      venueId: slot.venueId,
      courtIndex: slot.courtIndex,
    });
    closeSlotPicker();
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

  const cycleZoneMatchVenue = (zone, matchKey) => {
    if (!tournamentVenueOptions.length) {
      return;
    }

    const schedule = getZoneMatchSchedule(zone, matchKey);
    const currentIndex = tournamentVenueOptions.findIndex((venue) => venue.id === schedule.venueId);
    const nextVenue = tournamentVenueOptions[(currentIndex + 1) % tournamentVenueOptions.length];
    updateZoneMatchSchedule(zone.id, matchKey, { venueId: nextVenue.id });
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

  const buildSavePrompt = (confirmed = false) => {
    const changeType = getZonePlanningChangeType(savedPlanningRef.current, zonePlanning);
    const unassignedNames = unassignedRegistrations.map(
      (registration) => registration.shortDisplayLabel || registration.displayLabel || "Pareja"
    );
    const hasUnassignedPairs = unassignedNames.length > 0;

    if (changeType === "none" && !hasUnassignedPairs) {
      return null;
    }

    const unassignedMessage = hasUnassignedPairs
      ? `\n\nQuedan ${unassignedNames.length} pareja${unassignedNames.length === 1 ? "" : "s"} sin zona: ${unassignedNames.join(" / ")}.`
      : "";

    if (changeType === "none") {
      return {
        confirmed,
        confirmLabel: "Guardar igual",
        message: `No hay cambios en el armado respecto al ultimo guardado.${unassignedMessage}\n\n¿Queres guardar de todos modos?`,
        title: "Sin cambios nuevos",
      };
    }

    if (changeType === "additive") {
      return {
        confirmed,
        confirmLabel: confirmed ? "Sí, establecer" : "Sí, guardar",
        message: `Estás agregando nuevas parejas o zonas al armado existente. Las zonas ya guardadas no se van a modificar.${unassignedMessage}`,
        title: confirmed ? "Agregar al fixture" : "Guardar borrador",
      };
    }

    return {
      confirmed,
      confirmLabel: confirmed ? "Sí, aplicar cambios" : "Sí, guardar",
      message: confirmed
        ? `Modificaste horarios, parejas o la configuración de zonas ya guardadas. Al confirmar, el fixture del torneo se va a actualizar y volverás a la pantalla anterior.${unassignedMessage}`
        : `Modificaste horarios, parejas o la configuración de zonas ya guardadas. Al guardar, los cambios quedan como borrador sin afectar el fixture actual.${unassignedMessage}`,
      title: confirmed ? "Aplicar cambios al fixture" : "Guardar borrador",
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
              category={tournamentCategoryLabel}
              compactFriendly
              endDateMillis={tournament?.endDateMillis || 0}
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

            <View style={styles.gridCard}>
              <View style={styles.gridHeader}>
                <View style={styles.timeHeaderCell}>
                  <Text style={styles.timeHeaderText}>Hora</Text>
                </View>
                <ScrollView
                  horizontal
                  onScroll={(event) =>
                    syncHorizontalScroll("header", event.nativeEvent.contentOffset.x)
                  }
                  ref={headerScrollRef}
                  scrollEventThrottle={16}
                  showsHorizontalScrollIndicator={false}
                >
                  <View style={styles.pairHeaderRow}>
                    {orderedRegistrations.map((registration) => {
                      const isSelected = selectedRegistrationIds.includes(registration.id);
                      const availabilityRanges = getAvailabilityRangesForDay(registration, selectedDayKey);
                      const assignedZoneLetter = assignedZoneLetterByRegistrationId.get(String(registration.id));

                      return (
                        <Pressable
                          key={registration.id}
                          onPress={() => toggleRegistrationSelection(registration.id)}
                          style={[
                            styles.pairHeaderCell,
                            {
                              backgroundColor: registration.color.bg,
                              borderColor: registration.color.border,
                            },
                            assignedIds.has(registration.id) ? styles.pairHeaderCellAssigned : null,
                            isSelected ? styles.pairHeaderCellSelected : null,
                          ]}
                        >
                          {assignedZoneLetter ? (
                            <View style={styles.zoneLetterBadge}>
                              <Text style={styles.zoneLetterBadgeText}>{assignedZoneLetter}</Text>
                            </View>
                          ) : null}
                          {isSelected ? (
                            <View style={styles.selectedBadge}>
                              <Ionicons color={colors.surface} name="checkmark" size={11} />
                            </View>
                          ) : null}
                          <Text
                            numberOfLines={2}
                            style={[
                              styles.pairHeaderText,
                              { color: registration.color.text },
                              isSelected ? styles.pairHeaderTextSelected : null,
                            ]}
                          >
                            {registration.shortDisplayLabel || registration.displayLabel}
                          </Text>
                          <Text
                            numberOfLines={2}
                            style={[styles.pairHeaderAvailabilityText, { color: registration.color.text }]}
                          >
                            {availabilityRanges.length ? availabilityRanges.join(" / ") : "Sin horario"}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </ScrollView>
              </View>

              <View style={styles.gridBody}>
                <View style={styles.timeColumn}>
                  {TIME_SLOTS.map((slot) => (
                    <View key={slot.label} style={styles.timeCell}>
                      <Text style={styles.timeText}>{slot.label}</Text>
                    </View>
                  ))}
                </View>
                <ScrollView
                  horizontal
                  onScroll={(event) =>
                    syncHorizontalScroll("body", event.nativeEvent.contentOffset.x)
                  }
                  ref={bodyScrollRef}
                  scrollEventThrottle={16}
                  showsHorizontalScrollIndicator={false}
                >
                  <View style={styles.availabilityColumns}>
                    {orderedRegistrations.map((registration) => (
                      <View key={registration.id} style={styles.availabilityColumn}>
                        {TIME_SLOTS.map((slot) => {
                          const available = isSlotAvailable(registration, selectedDayKey, slot.minutes);

                          return (
                            <View
                              key={`${registration.id}-${slot.label}`}
                              style={[
                                styles.availabilityCell,
                                available
                                  ? {
                                      backgroundColor: registration.color.fill,
                                      borderColor: registration.color.border,
                                    }
                                  : null,
                              ]}
                            />
                          );
                        })}
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>
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

                            return (
                              <View key={`${zone.id}-${matchLabel}`} style={styles.zoneMatchTableRow}>
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
                                  onPress={() => cycleZoneMatchVenue(zone, matchLabel)}
                                  style={[styles.zoneMatchPlaceButton, styles.zoneMatchPlaceColumn]}
                                >
                                  <Text style={styles.zoneMatchPlaceButtonText}>
                                    {matchVenue?.label || (tournamentVenueOptions.length ? "Elegir" : "Sin sede")}
                                  </Text>
                                </Pressable>
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
        <DateTimePicker
          display={Platform.OS === "ios" ? "spinner" : "clock"}
          is24Hour
          mode="time"
          onChange={handleZoneTimePickerChange}
          value={buildDateFromTime(zoneTimePickerTarget.currentValue)}
        />
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
                        return (
                          <Pressable
                            key={slot.id}
                            onPress={() => handleSelectSlot(slot)}
                            style={[styles.slotPickerSlot, isSelected ? styles.slotPickerSlotSelected : null]}
                          >
                            <Text style={[styles.slotPickerSlotTime, isSelected ? styles.slotPickerSlotTimeSelected : null]}>
                              {formatMinutesToTime(slot.startMinutes)} hs
                            </Text>
                            <Text style={[styles.slotPickerSlotCourt, isSelected ? styles.slotPickerSlotCourtSelected : null]}>
                              Cancha {slot.courtIndex}
                            </Text>
                            {isSelected ? <Ionicons color="#1B5D92" name="checkmark-circle" size={17} /> : null}
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
        const venueSchedules = tournament?.fixtureSetup?.zoneVenueSchedules || [];
        const effectiveVenueId = customScheduleModal.venueId || tournamentVenueOptions[0]?.id || "";
        const maxCourts = getMaxCourtsForVenue(venueSchedules, effectiveVenueId);
        const dayOption = tournamentDayOptions.find((d) => d.key === customScheduleModal.dayKey);
        const conflict = findScheduleConflict(
          customScheduleModal.zoneId,
          customScheduleModal.matchKey,
          customScheduleModal.dayKey,
          customScheduleModal.startTime,
          effectiveVenueId,
          customScheduleModal.courtIndex
        );
        const hasConflict = Boolean(conflict);
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
                {hasConflict ? (
                  <View style={styles.customScheduleConflictRow}>
                    <Ionicons color={colors.danger} name="warning-outline" size={15} />
                    <Text style={styles.customScheduleConflictText}>{conflict?.conflictTime ? `Se pisa con el partido que comienza a las ${conflict.conflictTime} hs` : "Ya hay un partido en esta cancha y horario"}</Text>
                  </View>
                ) : null}
                <View style={styles.customScheduleActions}>
                  <Pressable onPress={() => setCustomScheduleModal(null)} style={styles.customScheduleCancelButton}>
                    <Text style={styles.customScheduleCancelText}>Cancelar</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleConfirmCustomSchedule}
                    style={[styles.customScheduleConfirmButton, hasConflict ? styles.customScheduleConfirmWarning : null]}
                  >
                    <Text style={styles.customScheduleConfirmText}>{hasConflict ? "Establecer de todos modos" : "Confirmar"}</Text>
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
        visible={feedback.visible}
      />
      <BottomQuickActionsBar />
      {hasUnsavedChanges ? (
        <View style={[styles.unsavedChangesBanner, { bottom: BOTTOM_QUICK_ACTIONS_SPACE + Math.max(insets.bottom, 6) + 16 }]}>
          <Ionicons color="#A84F00" name="alert-circle" size={15} />
          <Text style={styles.unsavedChangesText}>Hay cambios sin guardar</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
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
    fontWeight: "700",
    marginTop: spacing.sm,
    textAlign: "center",
  },
  helperText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
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
    fontWeight: "900",
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
    fontWeight: "900",
    textAlign: "center",
  },
  dayChipDateText: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 2,
    textAlign: "center",
  },
  dayChipTextActive: {
    color: colors.surface,
  },
  gridCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
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
    fontWeight: "900",
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
    fontWeight: "900",
    lineHeight: 12,
    textAlign: "center",
  },
  pairHeaderText: {
    fontSize: 9,
    fontWeight: "900",
    lineHeight: 10,
    textAlign: "center",
  },
  pairHeaderTextSelected: {
    paddingHorizontal: 8,
  },
  pairHeaderAvailabilityText: {
    fontSize: 7,
    fontWeight: "800",
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
    fontWeight: "800",
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
    fontWeight: "900",
    textAlign: "center",
  },
  selectionText: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "700",
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
    fontWeight: "900",
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
    fontWeight: "900",
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
    fontWeight: "900",
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
    fontWeight: "900",
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
    fontWeight: "600",
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
    fontWeight: "900",
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
    fontWeight: "900",
  },
  zoneCompactPairName: {
    flex: 1,
    fontSize: 11,
    fontWeight: "900",
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
    fontWeight: "700",
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
    fontWeight: "900",
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
    fontWeight: "900",
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
  zoneMatchTableCellText: {
    color: colors.text,
    fontSize: 10,
    fontWeight: "800",
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
    fontWeight: "900",
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
    fontWeight: "900",
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
    fontWeight: "900",
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
    fontWeight: "900",
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
    fontWeight: "900",
    textAlign: "center",
  },
  zoneMatchTableEmpty: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
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
    fontWeight: "900",
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
    fontWeight: "900",
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
    fontWeight: "900",
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
    fontWeight: "900",
  },
  dayPickerParticipantName: {
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
  },
  dayPickerVsText: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "900",
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
    fontWeight: "900",
  },
  dayPickerOptionMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
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
    fontWeight: "900",
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
    fontWeight: "900",
    textAlign: "center",
  },
  resultModalSubtitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
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
    fontWeight: "900",
    textAlign: "center",
  },
  winnerOptionTextSelected: {
    color: "#176B5B",
  },
  winnerBadgeText: {
    color: "#176B5B",
    fontSize: 9,
    fontWeight: "900",
    marginTop: 2,
    textAlign: "center",
  },
  resultNoWinnerText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
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
    fontWeight: "900",
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
    fontWeight: "900",
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
    fontWeight: "900",
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
    fontWeight: "900",
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
    fontWeight: "900",
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
    fontWeight: "900",
    paddingVertical: 8,
    textAlign: "center",
  },
  standingsCellText: {
    color: colors.text,
    flex: 0.48,
    fontSize: 10,
    fontWeight: "900",
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
    fontWeight: "900",
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
    fontWeight: "800",
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
    fontWeight: "900",
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
    fontWeight: "900",
    textAlign: "center",
  },
  deleteModalText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "700",
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
    fontWeight: "900",
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
    fontWeight: "900",
  },
  emptyText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
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
    fontWeight: "900",
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
    fontWeight: "900",
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
    fontWeight: "900",
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
    fontWeight: "700",
  },
  customScheduleTimeText: {
    color: colors.primaryDark,
    fontSize: 22,
    fontWeight: "900",
  },
  customScheduleLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
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
    fontWeight: "700",
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
    fontWeight: "800",
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
    fontWeight: "700",
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
    fontWeight: "700",
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
    fontWeight: "900",
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
    fontWeight: "900",
    marginBottom: 2,
    textAlign: "center",
  },
  slotPickerSubtitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "500",
    marginBottom: spacing.md,
    textAlign: "center",
  },
  slotPickerEmptyText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
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
    fontWeight: "700",
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
    fontWeight: "700",
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
    fontWeight: "700",
  },
  slotPickerVenueChipTextActive: {
    color: "#1B5D92",
  },
  slotPickerSlotsLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.4,
    marginBottom: 6,
    marginTop: spacing.sm,
    textTransform: "uppercase",
  },
  slotPickerSlotsScroll: {
    maxHeight: 260,
  },
  slotPickerSlot: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    marginBottom: 6,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  slotPickerSlotSelected: {
    backgroundColor: "#EAF3FF",
    borderColor: "#1B5D92",
    borderWidth: 1.5,
  },
  slotPickerSlotTime: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
    minWidth: 60,
  },
  slotPickerSlotTimeSelected: {
    color: "#1B5D92",
  },
  slotPickerSlotCourt: {
    color: colors.muted,
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
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
    fontWeight: "700",
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
    fontWeight: "800",
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
    fontWeight: "700",
  },
});
