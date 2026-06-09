import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as FileSystem from "expo-file-system/legacy";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { FontAwesome5, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import Share from "react-native-share";
import { SafeAreaView } from "react-native-safe-area-context";
import { captureRef } from "react-native-view-shot";

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
  getTournamentById,
  listTournamentRegistrations,
  updateTournament,
} from "../services/tournamentsService";
import {
  buildTournamentDayOptions,
  getTournamentDayLabel,
} from "../services/tournamentAvailabilityService";

const MATCH_FORMAT_OPTIONS = [
  {
    label: "3ER SET",
    value: "third_set",
    description: "Los partidos se definen con tercer set completo.",
  },
  {
    label: "SUPER TIE BREAK",
    value: "super_tiebreak",
    description: "Los partidos se definen con super tie break en el ultimo set.",
  },
];

const RAPID_MODE_OPTIONS = [
  {
    label: "FORMATO NORMAL",
    value: "off",
    description: "Zonas y llaves se definen con 3er set o super tie break.",
  },
  {
    label: "1 SOLO SET",
    value: "single_set",
    description: "Aplica el mismo formato relampago para zonas y llaves.",
  },
];

const BRACKET_FINAL_OVERRIDE_OPTIONS = [
  {
    label: "SIN EXCEPCIONES",
    value: "none",
    description: "Todas las llaves mantienen el mismo formato.",
  },
  {
    label: "SOLO FINAL A 3ER SET",
    value: "final_only",
    description: "La final pasa a jugarse a tercer set completo.",
  },
  {
    label: "SEMIFINAL Y FINAL A 3ER SET",
    value: "semifinal_and_final",
    description: "Semifinales y final pasan a jugarse a tercer set completo.",
  },
];

const BRACKET_HEADER_HEIGHT = 34;
const BRACKET_CARD_WIDTH = 258;
const BRACKET_CARD_HEIGHT = 150;
const BRACKET_TEAM_CARD_HEIGHT = 42;
const BRACKET_TEAMS_STACK_HEIGHT = 100;
const BRACKET_COLUMN_STEP = 282;
const BRACKET_FIRST_ROUND_GAP = 6;
const BRACKET_CONNECTOR_THICKNESS = 2;
const BRACKET_MIN_ZOOM = 0.55;
const BRACKET_FULLSCREEN_MIN_ZOOM = 0.35;
const BRACKET_DEFAULT_OVERVIEW_ZOOM = 0.8;
const BRACKET_MAX_ZOOM = 3;
const BRACKET_ROUND_BADGE_COLORS = ["#AEEBFF", "#6FCBFF", "#2E8FE8", "#0B4FB3"];
const BRACKET_SHARE_IMAGE_SCALE = 3;
const VENUE_SCHEDULE_COLOR_KEYS = ["blue", "sky", "lilac"];
const BRACKET_DOUBLE_TAP_DELAY = 280;
const CLOSE_MATCH_VENUE_GAP_MINUTES = 90;
const FIXTURE_SECTION_KEYS = ["configuration", "newzones", "bracket"];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeText(value = "") {
  return String(value || "").trim().toLowerCase();
}

function escapeHtml(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function sanitizeSharedFileName(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function areJsonEqual(firstValue, secondValue) {
  return JSON.stringify(firstValue || null) === JSON.stringify(secondValue || null);
}

function removeUndefinedFields(value) {
  if (Array.isArray(value)) {
    return value.map(removeUndefinedFields);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.entries(value).reduce((accumulator, [key, entryValue]) => {
    if (entryValue === undefined) {
      return accumulator;
    }

    accumulator[key] = removeUndefinedFields(entryValue);
    return accumulator;
  }, {});
}

function normalizeFixtureActiveSection(value = "") {
  const normalizedValue = String(value || "").trim().toLowerCase();
  return FIXTURE_SECTION_KEYS.includes(normalizedValue) ? normalizedValue : "configuration";
}

function getBracketRoundBadgeColor(roundIndex = 0, totalRounds = 1) {
  const safeTotalRounds = Math.max(Number(totalRounds || 1), 1);
  const safeRoundIndex = clamp(Number(roundIndex || 0), 0, safeTotalRounds - 1);
  const colorIndex =
    safeTotalRounds <= 1
      ? BRACKET_ROUND_BADGE_COLORS.length - 1
      : Math.round(
          (safeRoundIndex / (safeTotalRounds - 1)) *
            (BRACKET_ROUND_BADGE_COLORS.length - 1)
        );

  return BRACKET_ROUND_BADGE_COLORS[
    clamp(colorIndex, 0, BRACKET_ROUND_BADGE_COLORS.length - 1)
  ];
}

function hexToRgba(hexColor = "#FFFFFF", opacity = 1) {
  const hex = String(hexColor || "").replace("#", "").trim();

  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return `rgba(255,255,255,${opacity})`;
  }

  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);

  return `rgba(${red},${green},${blue},${opacity})`;
}

function getDistanceBetweenTouches(touches = []) {
  if (!Array.isArray(touches) || touches.length < 2) {
    return 0;
  }

  const [firstTouch, secondTouch] = touches;
  const deltaX = Number(secondTouch.pageX || 0) - Number(firstTouch.pageX || 0);
  const deltaY = Number(secondTouch.pageY || 0) - Number(firstTouch.pageY || 0);

  return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
}

const ZONE_MATCH_DURATION_MINUTES = 75;

function formatTwoDigits(value) {
  return String(value).padStart(2, "0");
}

function parseTimeToMinutes(value = "") {
  const [hours = "0", minutes = "0"] = String(value || "").split(":");
  return Number.parseInt(hours, 10) * 60 + Number.parseInt(minutes, 10);
}

function formatMinutesToTime(totalMinutes = 0) {
  const safeMinutes = Math.max(Number(totalMinutes || 0), 0);
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${formatTwoDigits(hours)}:${formatTwoDigits(minutes)}`;
}

function splitCourtLabelParts(courtLabel = "") {
  const [venueName = "", courtName = ""] = String(courtLabel || "")
    .split("·")
    .map((item) => String(item || "").trim());

  return {
    venueName,
    courtName,
  };
}

function getScaledBoardTransform(boardWidth = 0, boardHeight = 0, scale = 1) {
  const safeScale = Number(scale || 1);

  if (safeScale === 1) {
    return [{ scale: 1 }];
  }

  return [
    { translateX: -((boardWidth * (1 - safeScale)) / 2) },
    { translateY: -((boardHeight * (1 - safeScale)) / 2) },
    { scale: safeScale },
  ];
}

function splitCourtLabelPartsSafe(courtLabel = "") {
  const [venueName = "", courtName = ""] = String(courtLabel || "")
    .split(/(?:Â·|·)/)
    .map((item) => String(item || "").trim());

  return {
    venueName,
    courtName,
  };
}

function getCourtDisplayName(court = {}, index = 0) {
  return String(court?.nombre || court?.name || court?.label || "").trim() || `Cancha ${index + 1}`;
}

function buildCourtPickerOptions(venue = null, venueName = "", fallbackCourtCount = 1) {
  const venueCourts = Array.isArray(venue?.canchas)
    ? venue.canchas
    : Array.isArray(venue?.courts)
    ? venue.courts
    : [];
  const courtCount = Math.max(Number(fallbackCourtCount || 0) || Number(venue?.totalCanchas || 0) || 1, 1);
  const sourceCourts = venueCourts.length
    ? venueCourts.slice(0, courtCount)
    : Array.from({ length: courtCount }, (_, index) => ({ id: `court-${index + 1}` }));

  return sourceCourts.map((court, index) => {
    const courtName = getCourtDisplayName(court, index);
    const cleanVenueName = String(venueName || "").trim();

    return {
      courtName,
      label: courtName,
      value: cleanVenueName ? `${cleanVenueName} \u00B7 ${courtName}` : courtName,
      venueId: String(venue?.id || "").trim(),
      venueName: cleanVenueName,
    };
  });
}

function formatScheduleDayDisplay(dayKey = "", dayOptions = []) {
  const rawLabel = String(getTournamentDayLabel(dayKey, dayOptions, "full") || "").trim();

  if (!rawLabel) {
    return "Sin dia";
  }

  return rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);
}

function formatScheduleWeekdayDisplay(dayKey = "", dayOptions = []) {
  const rawLabel = String(getTournamentDayLabel(dayKey, dayOptions, "full") || "").trim();
  const weekdayLabel = rawLabel.split(",")[0].replace(/\d.*/, "").trim();

  if (!weekdayLabel) {
    return "Dia";
  }

  return weekdayLabel.charAt(0).toUpperCase() + weekdayLabel.slice(1);
}

function isValidTimeString(value = "") {
  return /^\d{2}:\d{2}$/.test(String(value || "").trim());
}

function normalizeTypedTimeInput(value = "") {
  const sanitized = String(value || "").replace(/[^\d:]/g, "").slice(0, 5);

  if (sanitized.includes(":")) {
    return sanitized;
  }

  const digitsOnly = sanitized.replace(/\D/g, "");

  if (digitsOnly.length <= 2) {
    return digitsOnly;
  }

  return `${digitsOnly.slice(0, 2)}:${digitsOnly.slice(2, 4)}`;
}

function parseMatchDurationToMinutes(value = "") {
  const trimmed = String(value || "").trim();

  if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
    const [hours, minutes] = trimmed.split(":").map((item) => Number.parseInt(item, 10));
    return Math.max(hours * 60 + minutes, 15);
  }

  const numericValue = Number.parseInt(trimmed.replace(/\D/g, ""), 10);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : ZONE_MATCH_DURATION_MINUTES;
}

function formatMatchDurationValue(totalMinutes = ZONE_MATCH_DURATION_MINUTES) {
  const safeMinutes = Math.max(Number(totalMinutes || 0), 15);
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${hours}:${formatTwoDigits(minutes)}`;
}

function normalizeZoneVenueSchedules(entries = [], tournamentDayOptions = [], venues = []) {
  const allowedDayKeys = new Set((Array.isArray(tournamentDayOptions) ? tournamentDayOptions : []).map((day) => day.key));
  const venuesById = new Map((Array.isArray(venues) ? venues : []).map((venue) => [venue.id, venue]));

  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => {
      const venueId = String(entry?.venueId || "").trim();
      const venue = venuesById.get(venueId);
      const dayKey = String(entry?.dayKey || "").trim();
      const from = String(entry?.from || "").trim();
      const to = String(entry?.to || "").trim();
      const courts = Math.max(Number.parseInt(entry?.courts || "0", 10) || 0, 1);

      if (!venueId || !venue || !allowedDayKeys.has(dayKey) || !isValidTimeString(from) || !isValidTimeString(to)) {
        return null;
      }

      if (parseTimeToMinutes(to) <= parseTimeToMinutes(from)) {
        return null;
      }

      return {
        id: String(entry?.id || `zone-schedule-${index + 1}`),
        venueId,
        venueName: venue.name || venue.nombre || `Sede ${index + 1}`,
        dayKey,
        from,
        to,
        courts,
        useForZones: Boolean(entry?.useForZones),
        useForBracket: Boolean(entry?.useForBracket),
      };
    })
    .filter(Boolean);
}

function buildDateFromTime(value = "") {
  const baseDate = new Date();
  const normalizedValue = isValidTimeString(value) ? value : "19:00";
  const [hours, minutes] = normalizedValue.split(":").map((part) => Number.parseInt(part, 10));
  const nextDate = new Date(baseDate);
  nextDate.setHours(hours, minutes, 0, 0);
  return nextDate;
}

function expandAvailabilityWindowsForDay(dayAvailability = {}) {
  const quickSlotsByKey = new Map(getQuickSlotDefinitions().map((slot) => [slot.key, slot]));
  const windows = [];

  (dayAvailability?.quickSlots || []).forEach((slotKey) => {
    const slot = quickSlotsByKey.get(slotKey);

    if (slot) {
      windows.push({ from: slot.from, to: slot.to });
    }
  });

  (dayAvailability?.customSlots || []).forEach((slot) => {
    if (isValidTimeString(slot?.from) && isValidTimeString(slot?.to)) {
      windows.push({ from: slot.from, to: slot.to });
    }
  });

  return windows;
}

function isSlotInsideWindow(slotStartMinutes, slotEndMinutes, window = {}) {
  const windowStart = parseTimeToMinutes(window.from);
  const windowEnd = parseTimeToMinutes(window.to);

  if (windowEnd <= windowStart) {
    return false;
  }

  return slotStartMinutes >= windowStart && slotEndMinutes <= windowEnd;
}

function isPairAvailableForSlot(availability = {}, dayKey = "", slotStartMinutes = 0, slotEndMinutes = 0) {
  const dayAvailability = availability?.[dayKey];

  if (!dayAvailability) {
    return true;
  }

  const windows = expandAvailabilityWindowsForDay(dayAvailability);

  if (!windows.length) {
    return true;
  }

  return windows.some((window) => isSlotInsideWindow(slotStartMinutes, slotEndMinutes, window));
}

function buildZoneMatchSchedulingSlots(schedules = [], durationMinutes = ZONE_MATCH_DURATION_MINUTES) {
  const slots = [];

  (Array.isArray(schedules) ? schedules : []).forEach((schedule) => {
    const startMinutes = parseTimeToMinutes(schedule.from);
    const endMinutes = parseTimeToMinutes(schedule.to);

    if (endMinutes - startMinutes < durationMinutes) {
      return;
    }

    for (let currentMinutes = startMinutes; currentMinutes + durationMinutes <= endMinutes; currentMinutes += durationMinutes) {
      for (let courtIndex = 1; courtIndex <= Number(schedule.courts || 1); courtIndex += 1) {
        slots.push({
          id: `${schedule.id}-${courtIndex}-${currentMinutes}`,
          scheduleId: schedule.id,
          venueId: schedule.venueId,
          venueName: schedule.venueName,
          courtIndex,
          courtLabel: `${schedule.venueName} · Cancha ${courtIndex}`,
          dayKey: schedule.dayKey,
          startMinutes: currentMinutes,
          endMinutes: currentMinutes + durationMinutes,
          timeLabel: `${formatMinutesToTime(currentMinutes)} hs`,
          scheduleLabel: `${getTournamentDayLabel(schedule.dayKey, [], "short")} · ${formatMinutesToTime(currentMinutes)} hs`,
        });
      }
    }
  });

  return slots.sort((first, second) => {
    if (first.dayKey !== second.dayKey) {
      return first.dayKey.localeCompare(second.dayKey, "es");
    }
    if (first.startMinutes !== second.startMinutes) {
      return first.startMinutes - second.startMinutes;
    }
    if (first.venueName !== second.venueName) {
      return first.venueName.localeCompare(second.venueName, "es");
    }
    return first.courtIndex - second.courtIndex;
  });
}

function isRegistrationConfirmed(registration = {}, tournament = {}) {
  if (
    registration?.withdrawalStatus === "confirmed" ||
    registration?.status === "rejected"
  ) {
    return false;
  }

  if (registration?.status === "confirmed" || registration?.confirmedAt) {
    return true;
  }

  const payments = Array.isArray(registration?.payments) ? registration.payments : [];
  const approvedCount = payments.filter((payment) => payment?.status === "approved").length;
  const pairConfirmationMode = String(tournament?.pairConfirmationMode || "").trim().toLowerCase();
  const requiresPayment = Number(tournament?.entryFee || 0) > 0;

  if (!requiresPayment && pairConfirmationMode !== "manual") {
    return true;
  }

  if (pairConfirmationMode === "one_paid") {
    return approvedCount >= 1;
  }

  if (pairConfirmationMode === "both_paid") {
    return payments.length > 0 && approvedCount >= payments.length;
  }

  return false;
}

function formatZoneLabel(zoneSizes = []) {
  if (!Array.isArray(zoneSizes) || !zoneSizes.length) {
    return "Sin recomendacion disponible";
  }

  return zoneSizes.map((size) => `${size}`).join(" / ");
}

function buildRecommendedZoneNames(zoneSizes = []) {
  return zoneSizes.map((size, index) => ({
    id: `zone-${index + 1}`,
    name: `Zona ${String.fromCharCode(65 + index)}`,
    size,
  }));
}

function buildZoneTemplates(zoneSizes = [], qualifierSizes = []) {
  return zoneSizes.map((size, index) => ({
    id: `zone-${index + 1}`,
    name: `Zona ${String.fromCharCode(65 + index)}`,
    size,
    qualifiers: Number(qualifierSizes[index] || 2),
  }));
}

function orderZoneSizesWithQualifiers(zoneSizes = [], qualifierSizes = []) {
  return (Array.isArray(zoneSizes) ? zoneSizes : [])
    .map((size, index) => ({
      originalIndex: index,
      qualifiers: Number(qualifierSizes[index] || 2),
      size: Number(size || 0),
    }))
    .sort((first, second) => {
      const firstRank = first.size === 4 ? 0 : first.size === 2 ? 2 : 1;
      const secondRank = second.size === 4 ? 0 : second.size === 2 ? 2 : 1;

      if (firstRank !== secondRank) {
        return firstRank - secondRank;
      }

      if (second.size !== first.size) {
        return second.size - first.size;
      }

      return first.originalIndex - second.originalIndex;
    });
}

function getNextPowerOfTwo(value = 0) {
  const normalizedValue = Math.max(Number(value || 0), 2);
  let power = 4;

  while (power < normalizedValue && power < 32) {
    power *= 2;
  }

  return power;
}

function buildRoundTitle(size = 0) {
  if (size <= 2) {
    return "Final";
  }

  if (size === 4) {
    return "Semifinales";
  }

  if (size === 8) {
    return "Cuartos";
  }

  if (size === 16) {
    return "Octavos";
  }

  return "16avos";
}

function normalizeMatchFormatConfig(matchFormat = {}) {
  const parsePoints = (value, fallbackValue = 11) => {
    const numericValue = Number(value || 0);
    return Number.isFinite(numericValue) && numericValue >= 1
      ? Math.round(numericValue)
      : fallbackValue;
  };
  const normalizeFormatValue = (value) =>
    ["third_set", "super_tiebreak", "single_set"].includes(value) ? value : "third_set";
  const zonesFormat = normalizeFormatValue(matchFormat?.zones);
  const bracketFormat = normalizeFormatValue(matchFormat?.bracket);

  return {
    zones: zonesFormat,
    bracket: bracketFormat,
    zonesSuperTieBreakPoints: parsePoints(
      matchFormat?.zonesSuperTieBreakPoints ?? matchFormat?.zonesSingleSetPoints,
      getDefaultPointsForMatchFormat(zonesFormat)
    ),
    bracketSuperTieBreakPoints: parsePoints(
      matchFormat?.bracketSuperTieBreakPoints ?? matchFormat?.bracketSingleSetPoints,
      getDefaultPointsForMatchFormat(bracketFormat)
    ),
    bracketFinalStagesOverride: [
      "none",
      "final_only",
      "semifinal_and_final",
    ].includes(matchFormat?.bracketFinalStagesOverride)
      ? matchFormat.bracketFinalStagesOverride
      : "none",
  };
}

function getMatchFormatLabel(value = "third_set") {
  if (value === "super_tiebreak") {
    return "Super tie break";
  }

  if (value === "single_set") {
    return "1 solo set";
  }

  return "3er set";
}

function getMatchFormatMetaLabel(value = "third_set", superTieBreakPoints = 11) {
  if (value === "single_set") {
    return `1 set a ${superTieBreakPoints}`;
  }

  if (value === "super_tiebreak") {
    return `Super tie break a ${superTieBreakPoints}`;
  }

  return "3er set";
}

function getDefaultPointsForMatchFormat(format = "third_set") {
  return format === "single_set" ? 9 : 11;
}

function shouldShowPointsInputForMatchFormat(format = "third_set") {
  return format === "single_set" || format === "super_tiebreak";
}

function getPointsInputLabelForMatchFormat(format = "third_set") {
  return format === "single_set" ? "Puntos del set" : "Puntos del super tie break";
}

function getCompactMatchFormatLabel(value = "third_set") {
  if (value === "single_set") {
    return "1 solo set";
  }

  if (value === "super_tiebreak") {
    return "Super tie break";
  }

  return "3er set";
}

function resolveBracketRoundMatchFormat(matchFormat = {}, roundTitle = "") {
  const normalizedConfig = normalizeMatchFormatConfig(matchFormat);

  if (normalizedConfig.bracket !== "super_tiebreak") {
    return "third_set";
  }

  const normalizedRoundTitle = String(roundTitle || "").trim().toLowerCase();

  if (
    normalizedConfig.bracketFinalStagesOverride === "semifinal_and_final" &&
    (normalizedRoundTitle.includes("semifinal") || normalizedRoundTitle.includes("final"))
  ) {
    return "third_set";
  }

  if (
    normalizedConfig.bracketFinalStagesOverride === "final_only" &&
    normalizedRoundTitle === "final"
  ) {
    return "third_set";
  }

  return "super_tiebreak";
}

function getZoneTeamStatusIconName(match = {}, teamKey = "") {
  const hasManualWinner =
    Boolean(match?.result?.winner) &&
    match?.result?.winnerSource !== "auto";

  if (!hasManualWinner) {
    return "thumbs-up";
  }

  return match.result.winner === teamKey ? "thumbs-up" : "thumbs-down";
}

function getZoneTeamStatusIconColor(match = {}, teamKey = "") {
  const hasManualWinner =
    Boolean(match?.result?.winner) &&
    match?.result?.winnerSource !== "auto";

  if (!hasManualWinner) {
    return colors.textMuted || colors.muted;
  }

  return match.result.winner === teamKey ? "#1E9E52" : "#C44A4A";
}

function formatShortPlayerName(value = "") {
  const cleanValue = String(value || "").trim();

  if (!cleanValue) {
    return "";
  }

  if (/[A-Za-zÁÉÍÓÚáéíóúÑñ]+\s+[A-Za-z]\.?$/.test(cleanValue)) {
    return cleanValue;
  }

  const parts = cleanValue.split(/\s+/).filter(Boolean);

  if (parts.length === 1) {
    return parts[0];
  }

  if (parts.some((part) => part.length <= 2 && part.includes("."))) {
    return cleanValue;
  }

  const firstName = parts[0];
  const lastName = parts[parts.length - 1];

  return `${lastName} ${firstName.charAt(0).toUpperCase()}.`;
}

function formatShortPairLabel(value = "") {
  const pairParts = String(value || "")
    .split("/")
    .map((item) => formatShortPlayerName(item))
    .filter(Boolean);

  return pairParts.join(" / ") || String(value || "").trim() || "Pareja";
}

function formatShortPairLines(value = "") {
  const pairParts = String(value || "")
    .split("/")
    .map((item) => formatShortPlayerName(item))
    .filter(Boolean);

  return pairParts.length ? pairParts : [String(value || "").trim() || "Pareja"];
}

function getApaZoneCount(totalPairs = 0) {
  if (totalPairs >= 6 && totalPairs <= 8) return 2;
  if (totalPairs >= 9 && totalPairs <= 11) return 3;
  if (totalPairs >= 12 && totalPairs <= 14) return 4;
  if (totalPairs >= 15 && totalPairs <= 17) return 5;
  if (totalPairs >= 18 && totalPairs <= 20) return 6;
  if (totalPairs >= 21 && totalPairs <= 23) return 7;
  if (totalPairs >= 24 && totalPairs <= 26) return 8;
  if (totalPairs >= 27 && totalPairs <= 29) return 9;
  if (totalPairs >= 30 && totalPairs <= 32) return 10;
  return 0;
}

function buildApaZoneSizes(totalPairs = 0) {
  const zoneCount = getApaZoneCount(totalPairs);

  if (!zoneCount) {
    return [];
  }

  const baseSize = Math.max(Math.floor(totalPairs / zoneCount), 2);
  let remainder = totalPairs - baseSize * zoneCount;

  return Array.from({ length: zoneCount }, (_, index) => {
    const shouldGrow = remainder > 0 && index < remainder;
    return baseSize + (shouldGrow ? 1 : 0);
  });
}

function buildFapZoneSizes(totalPairs = 0) {
  const zoneCountByPairs = {
    6: 2,
    7: 2,
    8: 2,
    9: 3,
    10: 3,
    11: 3,
    12: 4,
    13: 4,
    14: 4,
    15: 5,
    16: 5,
    17: 5,
    18: 6,
    19: 6,
    20: 6,
    21: 7,
    22: 7,
    23: 7,
    24: 8,
    25: 8,
    26: 8,
    27: 9,
    28: 9,
    29: 9,
    30: 10,
    31: 10,
    32: 10,
  };
  const zoneCount = zoneCountByPairs[Number(totalPairs || 0)] || 0;

  if (!zoneCount) {
    return [];
  }

  const baseSize = Math.max(Math.floor(totalPairs / zoneCount), 2);
  let remainder = totalPairs - baseSize * zoneCount;

  return Array.from({ length: zoneCount }, (_, index) => {
    const shouldGrow = remainder > 0 && index < remainder;
    return baseSize + (shouldGrow ? 1 : 0);
  });
}

function buildFapQualifierSizes(totalPairs = 0, zoneCount = 0) {
  const qualifierSizesByPairs = {
    6: [2, 2],
    7: [3, 2],
    8: [3, 3],
    9: [2, 2, 2],
    10: [3, 2, 2],
    11: [3, 3, 2],
    12: [2, 2, 2, 2],
    13: [3, 2, 2, 2],
    14: [3, 3, 2, 2],
    15: [2, 2, 2, 2, 2],
    16: [3, 2, 2, 2, 2],
    17: [3, 3, 2, 2, 2],
    18: [2, 2, 2, 2, 2, 2],
    19: [3, 2, 2, 2, 2, 2],
    20: [3, 3, 2, 2, 2, 2],
    21: [2, 2, 2, 2, 2, 2, 2],
    22: [3, 2, 2, 2, 2, 2, 2],
    23: [3, 3, 2, 2, 2, 2, 2],
    24: [2, 2, 2, 2, 2, 2, 2, 2],
    25: [3, 2, 2, 2, 2, 2, 2, 2],
    26: [3, 3, 2, 2, 2, 2, 2, 2],
    27: [2, 2, 2, 2, 2, 2, 2, 2, 2],
    28: [3, 2, 2, 2, 2, 2, 2, 2, 2],
    29: [3, 3, 2, 2, 2, 2, 2, 2, 2],
    30: [2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
    31: [3, 2, 2, 2, 2, 2, 2, 2, 2, 2],
    32: [3, 3, 2, 2, 2, 2, 2, 2, 2, 2],
  };

  return qualifierSizesByPairs[Number(totalPairs || 0)] || Array.from({ length: zoneCount }, () => 2);
}

function resolveFixtureRecommendation(pairCount = 0, pathType = "strict", ruleSet = "fap") {
  const path = pathType === "flex" ? "flex" : "strict";
  const totalPairs = Number(pairCount || 0);

  if (totalPairs < 6) {
    return {
      zoneSizes: [],
      zoneTemplates: [],
      qualifierSizes: [],
      qualifierCount: 0,
      bracketSize: 0,
      byeCount: 0,
      directAdvanceCount: 0,
      qualifiedSummary: "Todavia no hay suficientes parejas confirmadas para recomendar zonas.",
      bracketSummary: "Se necesitan al menos 6 parejas confirmadas.",
      note: "Completa el cupo minimo antes de crear el fixture.",
      bracketTitle: "Pendiente",
    };
  }

  if (ruleSet === "apa") {
    const rawZoneSizes = buildApaZoneSizes(totalPairs);
    const orderedZones = orderZoneSizesWithQualifiers(rawZoneSizes, rawZoneSizes.map(() => 2));
    const zoneSizes = orderedZones.map((zone) => zone.size);
    const qualifierSizes = orderedZones.map((zone) => zone.qualifiers);

    if (zoneSizes.length) {
      return {
        zoneSizes,
        qualifierSizes,
        qualifierCount: qualifierSizes.reduce((total, count) => total + Number(count || 0), 0),
        bracketSize: zoneSizes.length >= 9 ? 16 : zoneSizes.length >= 4 ? 8 : 4,
        byeCount: 0,
        directAdvanceCount: 0,
        zoneTemplates: buildZoneTemplates(zoneSizes, qualifierSizes),
        qualifiedSummary: "Clasifican 2 por zona segun molde APA.",
        bracketSummary: "La llave se arma con el molde APA correspondiente a la cantidad de parejas.",
        note: "La app respeta los cruces APA cargados para este rango de parejas.",
        bracketTitle: "Llave APA",
      };
    }
  }

  if (ruleSet === "fap") {
    const rawZoneSizes = buildFapZoneSizes(totalPairs);
    const rawQualifierSizes = buildFapQualifierSizes(totalPairs, rawZoneSizes.length);
    const orderedZones = orderZoneSizesWithQualifiers(rawZoneSizes, rawQualifierSizes);
    const zoneSizes = orderedZones.map((zone) => zone.size);
    const qualifierSizes = orderedZones.map((zone) => zone.qualifiers);

    if (zoneSizes.length) {
      return {
        zoneSizes,
        qualifierSizes,
        qualifierCount: qualifierSizes.reduce((total, count) => total + Number(count || 0), 0),
        bracketSize: 16,
        byeCount: 0,
        directAdvanceCount: 0,
        zoneTemplates: buildZoneTemplates(zoneSizes, qualifierSizes),
        qualifiedSummary: "Clasifican segun molde FAP para esta cantidad de parejas.",
        bracketSummary: "La llave se arma con el molde FAP correspondiente.",
        note: "La app respeta los cruces FAP cargados para este rango de parejas.",
        bracketTitle: "Llave FAP",
      };
    }
  }

  const presets = {
    6: {
      strict: {
        zoneSizes: [3, 3],
        qualifierSizes: [2, 2],
        qualifierCount: 4,
        bracketSize: 4,
        byeCount: 0,
        directAdvanceCount: 0,
        qualifiedSummary: "Clasifican 2 por zona.",
        bracketSummary: "Semifinales directas.",
        bracketTitle: "Semifinales",
      },
      flex: {
        zoneSizes: [3, 3],
        qualifiedSummary: "Clasifican 2 por zona.",
        bracketSummary: "Semifinales directas.",
        bracketTitle: "Semifinales",
      },
    },
    7: {
      strict: {
        zoneSizes: [4, 3],
        qualifierSizes: [2, 2],
        qualifierCount: 4,
        bracketSize: 4,
        byeCount: 0,
        directAdvanceCount: 0,
        qualifiedSummary: "Clasifican 2 por zona.",
        bracketSummary: "Semifinales directas.",
        bracketTitle: "Semifinales",
      },
      flex: {
        zoneSizes: [4, 3],
        qualifierSizes: [3, 2],
        qualifierCount: 5,
        bracketSize: 8,
        byeCount: 3,
        directAdvanceCount: 0,
        qualifiedSummary: "Clasifican 2 en la zona de 3 y 3 en la zona de 4.",
        bracketSummary: "Llave larga con bye para las mejores ubicadas.",
        bracketTitle: "Llave de 8 con bye",
      },
    },
    8: {
      strict: {
        zoneSizes: [4, 4],
        qualifierSizes: [2, 2],
        qualifierCount: 4,
        bracketSize: 4,
        byeCount: 0,
        directAdvanceCount: 0,
        qualifiedSummary: "Clasifican 2 por zona.",
        bracketSummary: "Semifinales directas.",
        bracketTitle: "Semifinales",
      },
      flex: {
        zoneSizes: [3, 3, 2],
        qualifierSizes: [2, 2, 2],
        qualifierCount: 6,
        bracketSize: 8,
        byeCount: 2,
        directAdvanceCount: 2,
        qualifiedSummary: "Clasifican 2 por zona.",
        bracketSummary: "Los 2 mejores 1ros avanzan a semifinales y las otras 4 parejas juegan cuartos.",
        bracketTitle: "Cuartos + semifinales",
      },
    },
    9: {
      strict: {
        zoneSizes: [3, 3, 3],
        qualifierSizes: [2, 2, 2],
        qualifierCount: 6,
        bracketSize: 8,
        byeCount: 2,
        directAdvanceCount: 2,
        qualifiedSummary: "Clasifican 2 por zona.",
        bracketSummary: "Los 2 mejores 1ros avanzan a semifinales y las otras 4 parejas juegan cuartos.",
        bracketTitle: "Cuartos + semifinales",
      },
      flex: {
        zoneSizes: [3, 3, 3],
        qualifierSizes: [2, 2, 2],
        qualifierCount: 6,
        bracketSize: 8,
        byeCount: 2,
        directAdvanceCount: 0,
        qualifiedSummary: "Clasifican 2 por zona.",
        bracketSummary: "Llave de 8 con bye para las mejores ubicadas.",
        bracketTitle: "Llave de 8 con bye",
      },
    },
    10: {
      strict: {
        zoneSizes: [3, 3, 4],
        qualifierSizes: [2, 2, 2],
        qualifierCount: 6,
        bracketSize: 8,
        byeCount: 2,
        directAdvanceCount: 2,
        qualifiedSummary: "Clasifican 2 por zona.",
        bracketSummary: "Los 2 mejores 1ros avanzan a semifinales y las otras 4 parejas juegan cuartos.",
        bracketTitle: "Cuartos + semifinales",
      },
      flex: {
        zoneSizes: [3, 3, 4],
        qualifierSizes: [2, 2, 3],
        qualifierCount: 7,
        bracketSize: 8,
        byeCount: 1,
        directAdvanceCount: 0,
        qualifiedSummary: "Clasifican 2 en las zonas de 3 y 3 en la zona de 4.",
        bracketSummary: "Llave de 8 con 1 bye para la mejor ubicada.",
        bracketTitle: "Llave de 8 con bye",
      },
    },
    11: {
      strict: {
        zoneSizes: [3, 3, 3, 2],
        qualifierSizes: [2, 2, 2, 2],
        qualifierCount: 8,
        bracketSize: 8,
        byeCount: 0,
        directAdvanceCount: 0,
        qualifiedSummary: "Clasifican 2 por zona. En la zona de 2 ambas parejas clasifican y el partido define 1ro y 2do.",
        bracketSummary: "Cuartos de final.",
        bracketTitle: "Cuartos",
      },
      flex: {
        zoneSizes: [3, 3, 3, 2],
        qualifierSizes: [2, 2, 2, 2],
        qualifierCount: 8,
        bracketSize: 8,
        byeCount: 0,
        directAdvanceCount: 0,
        qualifiedSummary: "Clasifican 2 por zona. En la zona de 2 ambas parejas clasifican y el partido define 1ro y 2do.",
        bracketSummary: "Cuartos de final.",
        bracketTitle: "Cuartos",
      },
    },
    12: {
      strict: {
        zoneSizes: [3, 3, 3, 3],
        qualifierSizes: [2, 2, 2, 2],
        qualifierCount: 8,
        bracketSize: 8,
        byeCount: 0,
        directAdvanceCount: 0,
        qualifiedSummary: "Clasifican 2 por zona.",
        bracketSummary: "Cuartos de final.",
        bracketTitle: "Cuartos",
      },
      flex: {
        zoneSizes: [3, 3, 3, 3],
        qualifierSizes: [2, 2, 2, 2],
        qualifierCount: 8,
        bracketSize: 8,
        byeCount: 0,
        directAdvanceCount: 0,
        qualifiedSummary: "Clasifican 2 por zona.",
        bracketSummary: "Cuartos de final.",
        bracketTitle: "Cuartos",
      },
    },
  };

  const selectedPreset = presets[totalPairs]?.[path];

  if (selectedPreset) {
    return {
      ...selectedPreset,
      zoneTemplates: buildZoneTemplates(selectedPreset.zoneSizes, selectedPreset.qualifierSizes),
      note:
        path === "strict"
          ? "La app prioriza menos cruces y una salida mas directa del torneo."
          : "La app prioriza que mas parejas sigan en competencia usando bye cuando haga falta.",
    };
  }

  const zoneSizes = [];
  let remainingPairs = totalPairs;

  while (remainingPairs > 0) {
    if (remainingPairs === 4 || remainingPairs === 2) {
      zoneSizes.push(remainingPairs);
      remainingPairs = 0;
    } else {
      zoneSizes.push(3);
      remainingPairs -= 3;
    }
  }

  return {
    zoneSizes,
    qualifierSizes: zoneSizes.map(() => 2),
    qualifierCount: path === "strict" ? Math.min(8, zoneSizes.length * 2) : Math.min(16, zoneSizes.length * 2),
    bracketSize: path === "strict" ? 8 : 16,
    byeCount: 0,
    directAdvanceCount: 0,
    zoneTemplates: buildZoneTemplates(zoneSizes, zoneSizes.map(() => 2)),
    qualifiedSummary:
      path === "strict"
        ? "Clasifican menos parejas y se prioriza una llave corta."
        : "Clasifican mas parejas y se usan bye cuando haga falta.",
    bracketSummary:
      path === "strict"
        ? "Se recomienda una llave corta con prioridad para los 1ros de zona."
        : "Se recomienda una llave larga con continuidad deportiva.",
    note:
      path === "strict"
        ? "La app prioriza zonas de 3, luego una de 4 y solo en ultimo recurso una de 2."
        : "La app prioriza que menos parejas queden eliminadas directamente.",
    bracketTitle: path === "strict" ? "Llave corta" : "Llave larga",
  };
}

function buildAutomaticZones(registrations = [], recommendation = {}) {
  const zoneTemplates = Array.isArray(recommendation.zoneTemplates) ? recommendation.zoneTemplates : [];
  const zones = [];
  let cursor = 0;

  zoneTemplates.forEach((template, index) => {
    const size = Number(template.size || 0);
    const pairs = registrations.slice(cursor, cursor + size);
    zones.push({
      id: template.id || `zone-${index + 1}`,
      name: template.name || `Zona ${String.fromCharCode(65 + index)}`,
      size,
      qualifiers: Number(template.qualifiers || 2),
      pairs: pairs.map((registration) => ({
        id: registration.id,
        label: registration.pairLabel || "Pareja",
      })),
    });
    cursor += size;
  });

  return zones;
}

function buildManualZones(recommendation = {}) {
  return (recommendation.zoneTemplates || []).map((template) => ({
    ...template,
    pairs: [],
  }));
}

function buildAutomaticZonePlanning(registrations = [], recommendation = {}) {
  const zoneTemplates = Array.isArray(recommendation.zoneTemplates) ? recommendation.zoneTemplates : [];
  let cursor = 0;

  return {
    confirmed: true,
    updatedAtMillis: Date.now(),
    zones: zoneTemplates.map((template, index) => {
      const size = Number(template.size || 0);
      const pairs = registrations.slice(cursor, cursor + size);
      cursor += size;

      return {
        id: template.id || `zone-${index + 1}`,
        label: template.name || `Zona ${String.fromCharCode(65 + index)}`,
        matchSchedules: {},
        registrationIds: pairs.map((registration) => registration.id),
      };
    }),
  };
}

function buildPlanningMatchLabels(pairCount = 0) {
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

function getZoneQualifiersCount(ruleSet = "fap", pairCount = 0) {
  if (ruleSet === "fap" && Number(pairCount || 0) === 4) {
    return 3;
  }

  return Math.min(2, Number(pairCount || 0));
}

function getPlanningMatchPairNumbers(zone = {}, registrations = [], matchLabel = "") {
  const directParts = String(matchLabel || "").match(/^(\d+)\s+vs\s+(\d+)$/i);

  if (directParts) {
    return [directParts[1], directParts[2]];
  }

  if (registrations.length !== 4 || !["G vs G", "P vs P"].includes(matchLabel)) {
    return [];
  }

  const openingMatches = ["1 vs 2", "3 vs 4"].map((openingMatchLabel) => {
    const openingParts = openingMatchLabel.match(/^(\d+)\s+vs\s+(\d+)$/i);
    const openingParticipants = openingParts
      ? [registrations[Number(openingParts[1]) - 1], registrations[Number(openingParts[2]) - 1]]
      : [];
    const winnerId = String(zone.matchSchedules?.[openingMatchLabel]?.result?.winnerRegistrationId || "");
    const winnerIndex = openingParticipants.findIndex(
      (participant) => String(participant?.id || "") === winnerId
    );

    if (!openingParts || winnerIndex < 0) {
      return null;
    }

    return {
      loser: openingParts[winnerIndex === 0 ? 2 : 1],
      winner: openingParts[winnerIndex + 1],
    };
  });

  if (openingMatches.some((entry) => !entry)) {
    return [];
  }

  return matchLabel === "G vs G"
    ? openingMatches.map((entry) => entry.winner)
    : openingMatches.map((entry) => entry.loser);
}

function buildZoneStandings(zone = {}, zoneRegistrations = [], matchFormat = "third_set") {
  const rowsById = zoneRegistrations.reduce((accumulator, registration) => {
    const pairName = registration.pairLabel || registration.displayLabel || "Pareja";

    accumulator[registration.id] = {
      DG: 0,
      DIF: 0,
      name: pairName,
      shortName: formatShortPairLabel(pairName),
      PJ: 0,
      PG: 0,
      PP: 0,
      registration,
      SC: 0,
      SF: 0,
    };
    return accumulator;
  }, {});

  buildPlanningMatchLabels(zoneRegistrations.length).forEach((matchLabel) => {
    const pairNumbers = getPlanningMatchPairNumbers(zone, zoneRegistrations, matchLabel);
    const [teamARegistration, teamBRegistration] = pairNumbers
      .map((pairNumber) => zoneRegistrations[Number.parseInt(pairNumber, 10) - 1])
      .filter(Boolean);

    if (!teamARegistration || !teamBRegistration) {
      return;
    }

    const result = zone.matchSchedules?.[matchLabel]?.result || {};
    const sets = normalizeResultSets(result.sets, matchFormat);
    const winnerId = String(result.winnerRegistrationId || "");

    if (!winnerId || !hasAnyResultSetScore(sets)) {
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

function buildQualifiedPairsFromZonePlanning(zone = {}, zoneRegistrations = [], matchFormat = "third_set", ruleSet = "fap") {
  const pairCount = zoneRegistrations.length;
  const qualifierCount = getZoneQualifiersCount(ruleSet, pairCount);
  const toQualifiedPair = (registration = null) =>
    registration
      ? {
          id: registration.id,
          label: registration.pairLabel || registration.displayLabel || "Pareja",
          pairLabel: registration.pairLabel || registration.displayLabel || "Pareja",
          registration,
          shortName: formatShortPairLabel(registration.pairLabel || registration.displayLabel || "Pareja"),
        }
      : null;
  const resolveMatchResult = (matchLabel = "") => {
    const pairNumbers = getPlanningMatchPairNumbers(zone, zoneRegistrations, matchLabel);
    const participants = pairNumbers
      .map((pairNumber) => zoneRegistrations[Number.parseInt(pairNumber, 10) - 1])
      .filter(Boolean);
    const winnerId = String(zone.matchSchedules?.[matchLabel]?.result?.winnerRegistrationId || "");

    if (participants.length !== 2 || !winnerId) {
      return null;
    }

    const winner = participants.find((participant) => String(participant?.id || "") === winnerId);
    const loser = participants.find((participant) => String(participant?.id || "") !== winnerId);

    if (!winner || !loser) {
      return null;
    }

    return { loser, winner };
  };
  const addUnique = (list, registration = null) => {
    if (!registration || list.some((entry) => String(entry?.id || "") === String(registration.id || ""))) {
      return list;
    }

    return [...list, toQualifiedPair(registration)].filter(Boolean);
  };

  if (pairCount === 2) {
    const resolved = resolveMatchResult("1 vs 2");
    let qualified = [];

    if (resolved?.winner) qualified = addUnique(qualified, resolved.winner);
    if (resolved?.loser && qualifierCount > 1) qualified = addUnique(qualified, resolved.loser);

    return qualified.slice(0, qualifierCount);
  }

  if (pairCount === 4) {
    const finalResolved = resolveMatchResult("G vs G");
    const thirdResolved = resolveMatchResult("P vs P");
    let qualified = [];

    if (finalResolved?.winner) qualified = addUnique(qualified, finalResolved.winner);
    if (finalResolved?.loser && qualifierCount > 1) qualified = addUnique(qualified, finalResolved.loser);
    if (thirdResolved?.winner && qualifierCount > 2) qualified = addUnique(qualified, thirdResolved.winner);
    if (thirdResolved?.loser && qualifierCount > 3) qualified = addUnique(qualified, thirdResolved.loser);

    return qualified.slice(0, qualifierCount);
  }

  const expectedMatchCount = buildPlanningMatchLabels(pairCount).length;
  const completedMatchCount = buildPlanningMatchLabels(pairCount).filter((matchLabel) => {
    const schedule = zone.matchSchedules?.[matchLabel] || {};
    const winnerId = String(schedule?.result?.winnerRegistrationId || "");
    const hasScore = hasAnyResultSetScore(normalizeResultSets(schedule?.result?.sets, matchFormat));

    return Boolean(winnerId && hasScore);
  }).length;

  if (expectedMatchCount && completedMatchCount < expectedMatchCount) {
    return [];
  }

  return buildZoneStandings(zone, zoneRegistrations, matchFormat)
    .filter((row) => row.PG + row.PP > 0)
    .slice(0, qualifierCount)
    .map((row) => toQualifiedPair(row.registration))
    .filter(Boolean);
}

function orderZonesForBracketRuleSet(zones = [], ruleSet = "fap") {
  const shouldUseOfficialOrder = ["apa", "fap"].includes(
    String(ruleSet || "").trim().toLowerCase()
  );

  if (!shouldUseOfficialOrder) {
    return Array.isArray(zones) ? zones : [];
  }

  return (Array.isArray(zones) ? zones : [])
    .map((zone, index) => {
      const size = Number(zone?.size || zone?.pairs?.length || 0);
      const sizeRank = size === 4 ? 0 : size === 3 ? 1 : size === 2 ? 2 : 3;

      return {
        index,
        sizeRank,
        zone,
      };
    })
    .sort((first, second) => {
      if (first.sizeRank !== second.sizeRank) {
        return first.sizeRank - second.sizeRank;
      }

      const firstSize = Number(first.zone?.size || first.zone?.pairs?.length || 0);
      const secondSize = Number(second.zone?.size || second.zone?.pairs?.length || 0);

      if (secondSize !== firstSize) {
        return secondSize - firstSize;
      }

      return first.index - second.index;
    })
    .map(({ zone }, index) => ({
      ...zone,
      bracketSourceName: zone.name,
      name: `Zona ${String.fromCharCode(65 + index)}`,
    }));
}

function buildZonesPreviewFromZonePlanning({
  matchFormat = "third_set",
  registrationsById,
  ruleSet = "fap",
  tournamentDayOptions = [],
  tournamentVenueOptions = [],
  zonePlanning = {},
} = {}) {
  const planningZones = Array.isArray(zonePlanning?.zones) ? zonePlanning.zones : [];

  const zones = planningZones
    .map((zone, zoneIndex) => {
      const registrations = (Array.isArray(zone.registrationIds) ? zone.registrationIds : [])
        .map((registrationId) => registrationsById?.get(registrationId))
        .filter(Boolean);
      const pairCount = registrations.length;
      const pairs = registrations.map((registration, registrationIndex) => ({
        id: registration.id,
        label: registration.pairLabel || `Pareja ${registrationIndex + 1}`,
      }));
      const baseZone = {
        id: zone.id || `zone-${zoneIndex + 1}`,
        name: zone.label || `Zona ${String.fromCharCode(65 + zoneIndex)}`,
        pairs,
        qualifiers: getZoneQualifiersCount(ruleSet, pairCount),
        size: pairCount,
      };
      const qualifiedPairs = buildQualifiedPairsFromZonePlanning(zone, registrations, matchFormat, ruleSet);
      const matches = buildZoneMatches(baseZone).map((match, matchIndex) => {
        const matchLabel = buildPlanningMatchLabels(pairCount)[matchIndex] || match.matchupLabel;
        const schedule = zone.matchSchedules?.[matchLabel] || {};
        const venueLabel =
          tournamentVenueOptions.find((venue) => venue.id === schedule.venueId)?.label ||
          schedule.venueLabel ||
          match.courtLabel;
        const dayLabel = schedule.dayKey
          ? formatScheduleDayDisplay(schedule.dayKey, tournamentDayOptions)
          : "";
        const pairNumbers = getPlanningMatchPairNumbers(zone, registrations, matchLabel);
        const participants = pairNumbers
          .map((pairNumber) => registrations[Number.parseInt(pairNumber, 10) - 1])
          .filter(Boolean);
        const winnerRegistrationId = String(schedule?.result?.winnerRegistrationId || "");
        const winnerIndex = participants.findIndex(
          (participant) => String(participant?.id || "") === winnerRegistrationId
        );
        const winner =
          winnerIndex === 0 ? "teamA" : winnerIndex === 1 ? "teamB" : match.result?.winner || "";

        return {
          ...match,
          courtLabel: venueLabel || match.courtLabel,
          resultLabel: formatPlanningResultText(schedule),
          scheduleLabel:
            dayLabel && schedule.startTime
              ? `${dayLabel} ${schedule.startTime}`
              : dayLabel || schedule.startTime || match.scheduleLabel,
          scheduledDayKey: schedule.dayKey || match.scheduledDayKey || "",
          scheduledTime: schedule.startTime || match.scheduledTime || "",
          venueId: schedule.venueId || match.venueId || "",
          result: {
            ...buildDefaultZoneResult(matchFormat),
            ...(match.result || {}),
            winner,
            winnerSource: winner ? "manual" : match.result?.winnerSource || "",
            sets: normalizeResultSets(schedule?.result?.sets || match.result?.sets, matchFormat),
          },
        };
      });

      return {
        ...baseZone,
        matches,
        qualifiedPairs,
      };
    })
    .filter((zone) => zone.size >= 2);

  return decorateZonesWithMatches(orderZonesForBracketRuleSet(zones, ruleSet), matchFormat);
}

function formatPlanningResultText(schedule = {}) {
  const resultText = String(schedule?.resultText || "").trim();

  if (resultText) {
    return resultText;
  }

  const sets = Array.isArray(schedule?.result?.sets) ? schedule.result.sets : [];
  const setsText = sets
    .filter((set) => set?.teamA || set?.teamB)
    .map((set) => `${set?.teamA || "-"}-${set?.teamB || "-"}`)
    .join(" ");

  return setsText || "Pendiente";
}

function getSetWinnerSide(set = {}) {
  const teamA = Number.parseInt(String(set?.teamA || ""), 10);
  const teamB = Number.parseInt(String(set?.teamB || ""), 10);

  if (!Number.isFinite(teamA) || !Number.isFinite(teamB) || teamA === teamB) {
    return "";
  }

  return teamA > teamB ? "teamA" : "teamB";
}

function parseSetNumber(value = "") {
  const numericValue = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function formatSignedValue(value = 0) {
  const numericValue = Number(value || 0);
  return numericValue > 0 ? `+${numericValue}` : String(numericValue);
}

function hasAnyResultSetScore(sets = []) {
  return (Array.isArray(sets) ? sets : []).some((set) => set?.teamA || set?.teamB);
}

function buildPlanningResultTextFromSets(sets = []) {
  return (Array.isArray(sets) ? sets : [])
    .filter((set) => set?.teamA || set?.teamB)
    .map((set) => `${set?.teamA || "-"}-${set?.teamB || "-"}`)
    .join(" ");
}

function buildZoneMatches(zone = {}) {
  const pairs = Array.isArray(zone.pairs) ? zone.pairs : [];
  const size = Number(zone.size || pairs.length || 0);
  const slots = Array.from({ length: size }, (_, index) => ({
    ...(pairs[index] || {}),
    seed: `P${index + 1}`,
    seedLabel: `P${index + 1}`,
    displayLabel: formatShortPairLabel(pairs[index]?.label || `Pareja ${index + 1}`),
    displayLines: formatShortPairLines(pairs[index]?.label || `Pareja ${index + 1}`),
  }));
  const createMatch = (index, teamA, teamB, roundLabel = "Zona") => ({
    id: `${zone.id}-match-${index + 1}`,
    title: `Partido ${index + 1}`,
    roundLabel,
    matchupLabel: `${teamA?.seedLabel || "P?"} vs ${teamB?.seedLabel || "P?"}`,
    teamAId: teamA?.id || "",
    teamASeed: teamA?.seedLabel || "P?",
    teamAName: teamA?.displayLabel || `Pareja ${teamA?.seedLabel || "A"}`,
    teamALines: teamA?.displayLines || [teamA?.displayLabel || `Pareja ${teamA?.seedLabel || "A"}`],
    teamBId: teamB?.id || "",
    teamBSeed: teamB?.seedLabel || "P?",
    teamBName: teamB?.displayLabel || `Pareja ${teamB?.seedLabel || "B"}`,
    teamBLines: teamB?.displayLines || [teamB?.displayLabel || `Pareja ${teamB?.seedLabel || "B"}`],
    courtLabel: "Cancha por asignar",
    scheduleLabel: "Horario por asignar",
    resultLabel: "Resultado pendiente",
    result: buildDefaultZoneResult(),
  });

  if (size === 2) {
    return [
      createMatch(
        0,
        { ...slots[0], seed: 1 },
        { ...slots[1], seed: 2 }
      ),
    ];
  }

  if (size === 3) {
    return [
      createMatch(0, { ...slots[0], seed: 1 }, { ...slots[1], seed: 2 }),
      createMatch(1, { ...slots[0], seed: 1 }, { ...slots[2], seed: 3 }),
      createMatch(2, { ...slots[1], seed: 2 }, { ...slots[2], seed: 3 }),
    ];
  }

  if (size === 4) {
    return [
      createMatch(0, { ...slots[0], seed: 1 }, { ...slots[1], seed: 2 }, "Apertura"),
      createMatch(1, { ...slots[2], seed: 3 }, { ...slots[3], seed: 4 }, "Apertura"),
      createMatch(
        2,
        { displayLabel: "", seedLabel: "Ganador 1", displayLines: [""] },
        { displayLabel: "", seedLabel: "Ganador 2", displayLines: [""] },
        "Definicion"
      ),
      createMatch(
        3,
        { displayLabel: "", seedLabel: "Perdedor 1", displayLines: [""] },
        { displayLabel: "", seedLabel: "Perdedor 2", displayLines: [""] },
        "Definicion"
      ),
    ];
  }

  return [];
}

function getSetDefinitionsForFormat(format = "third_set") {
  if (format === "single_set") {
    return [{ label: "SET UNICO" }];
  }

  if (format === "super_tiebreak") {
    return [{ label: "SET 1" }, { label: "SET 2" }, { label: "SET 3" }];
  }

  return [{ label: "SET 1" }, { label: "SET 2" }, { label: "SET 3" }];
}

function normalizeResultSets(resultSets = [], format = "third_set") {
  const definitions = getSetDefinitionsForFormat(format);

  return definitions.map((definition, index) => {
    const allowDoubleDigits = shouldAllowDoubleDigitSetScore(format, index);
    const teamA = String(resultSets?.[index]?.teamA || "");
    const teamB = String(resultSets?.[index]?.teamB || "");
    const fallbackInputValue = teamA && teamB ? `${teamA}/${teamB}` : teamA;

    return {
      teamA,
      teamB,
      label: definition.label,
      inputValue: sanitizeSetInputValue(
        resultSets?.[index]?.inputValue || fallbackInputValue,
        allowDoubleDigits
      ),
    };
  });
}

function buildDefaultZoneResult(format = "third_set") {
  return {
    winnerSource: "",
    winner: "",
    sets: normalizeResultSets([], format),
  };
}

function buildDefaultBracketResult(format = "third_set") {
  return {
    winnerSource: "",
    winner: "",
    sets: normalizeResultSets([], format),
  };
}

function parseCompactSetInput(value = "", allowDoubleDigits = false) {
  const cleanValue = String(value || "").replace(/[^\d/]/g, "");

  if (!allowDoubleDigits) {
    if (cleanValue.includes("/")) {
      const [firstValue = "", secondValue = ""] = cleanValue.split("/");

      return {
        teamA: firstValue.replace(/\D/g, "").slice(0, 1),
        teamB: secondValue.replace(/\D/g, "").slice(0, 1),
      };
    }

    const digits = cleanValue.replace(/\D/g, "").slice(0, 2);

    if (digits.length <= 1) {
      return {
        teamA: digits,
        teamB: "",
      };
    }

    return {
      teamA: digits.charAt(0) || "",
      teamB: digits.charAt(1) || "",
    };
  }

  if (cleanValue.includes("/")) {
    const [firstValue = "", secondValue = ""] = cleanValue.split("/");

    return {
      teamA: firstValue.replace(/\D/g, "").slice(0, 2),
      teamB: secondValue.replace(/\D/g, "").slice(0, 2),
    };
  }

  const digits = cleanValue.replace(/\D/g, "").slice(0, 4);

  if (digits.length <= 2) {
    return {
      teamA: digits,
      teamB: "",
    };
  }

  if (digits.length >= 4) {
    return {
      teamA: digits.slice(0, 2),
      teamB: digits.slice(2, 4),
    };
  }

  if (digits.length === 3) {
    const firstTwoDigits = Number(digits.slice(0, 2));

    if (firstTwoDigits >= 10) {
      return {
        teamA: digits.slice(0, 2),
        teamB: digits.slice(2, 3),
      };
    }

    return {
      teamA: digits.slice(0, 1),
      teamB: digits.slice(1, 3),
    };
  }

  return {
    teamA: digits,
    teamB: "",
  };
}

function shouldAllowDoubleDigitSetScore(format = "third_set", setIndex = 0, points = 11) {
  if (format === "super_tiebreak") {
    return setIndex === 2;
  }

  if (format === "single_set") {
    return Number(points || 0) >= 10;
  }

  return false;
}

function formatCompactSetInput(set = {}, allowDoubleDigits = false) {
  const rawInputValue = String(set?.inputValue || "").trim();
  const teamA = String(set?.teamA || "");
  const teamB = String(set?.teamB || "");

  if (allowDoubleDigits && rawInputValue) {
    return rawInputValue;
  }

  if (teamA && teamB) {
    return `${teamA}/${teamB}`;
  }

  if (teamA) {
    return teamA;
  }

  return allowDoubleDigits ? rawInputValue : "";
}

function sanitizeSetInputValue(value = "", allowDoubleDigits = false) {
  const cleanValue = String(value || "").replace(/[^\d/]/g, "");

  if (!allowDoubleDigits) {
    return cleanValue.slice(0, 3);
  }

  if (cleanValue.includes("/")) {
    const [firstValue = "", secondValue = ""] = cleanValue.split("/");
    const firstDigits = firstValue.replace(/\D/g, "").slice(0, 2);
    const secondDigits = secondValue.replace(/\D/g, "").slice(0, 2);

    return `${firstDigits}${firstDigits.length >= 2 || secondDigits ? "/" : ""}${secondDigits}`.slice(0, 5);
  }

  const digits = cleanValue.replace(/\D/g, "").slice(0, 4);

  if (digits.length <= 2) {
    return digits;
  }

  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}`;
}

function normalizeZoneSeedLabel(value = "") {
  const normalized = String(value || "").trim().toUpperCase();

  if (normalized === "G1") {
    return "Ganador 1";
  }

  if (normalized === "G2") {
    return "Ganador 2";
  }

  if (normalized === "P1") {
    return "Perdedor 1";
  }

  if (normalized === "P2") {
    return "Perdedor 2";
  }

  return String(value || "").trim();
}

function resolveZonePlaceholderMeta(match = {}, teamKey = "teamA") {
  const seedKey = teamKey === "teamA" ? "teamASeed" : "teamBSeed";
  const nameKey = teamKey === "teamA" ? "teamAName" : "teamBName";
  const linesKey = teamKey === "teamA" ? "teamALines" : "teamBLines";
  const normalizedSeed = normalizeZoneSeedLabel(match?.[seedKey]);
  const isDefinitionRound = String(match?.roundLabel || "").toLowerCase() === "definicion";
  const hasExistingName = Boolean(String(match?.[nameKey] || "").trim());
  const hasExistingLines = Array.isArray(match?.[linesKey]) && match[linesKey].some((line) => String(line || "").trim());
  const isPlaceholderSeed = ["Ganador 1", "Ganador 2", "Perdedor 1", "Perdedor 2"].includes(normalizedSeed);

  if (isDefinitionRound && isPlaceholderSeed && !hasExistingName && !hasExistingLines) {
    return {
      seed: normalizedSeed,
      name: "",
      lines: [],
    };
  }

  return {
    seed: String(match?.[seedKey] || "").trim(),
    name: match?.[nameKey] || "",
    lines: Array.isArray(match?.[linesKey]) ? match[linesKey] : [],
  };
}

function resolveZoneAdvanceEntry(match = {}, target = "winner") {
  const winnerKey = match?.result?.winner;

  if (!winnerKey || !["teamA", "teamB"].includes(winnerKey)) {
    return {
      id: "",
      name: "",
      seed: "",
      lines: [],
    };
  }

  const resolvedTeamKey =
    target === "winner" ? winnerKey : winnerKey === "teamA" ? "teamB" : "teamA";

  return {
    id: match?.[`${resolvedTeamKey}Id`] || "",
    name: match?.[`${resolvedTeamKey}Name`] || "",
    seed: match?.[`${resolvedTeamKey}Seed`] || "",
    lines: Array.isArray(match?.[`${resolvedTeamKey}Lines`]) ? match[`${resolvedTeamKey}Lines`] : [],
  };
}

function applyZoneKnockoutProgressions(zone = {}) {
  const matches = Array.isArray(zone.matches) ? [...zone.matches] : [];

  if (Number(zone.size || 0) !== 4 || matches.length < 4) {
    return zone;
  }

  const firstMatchWinner = resolveZoneAdvanceEntry(matches[0], "winner");
  const secondMatchWinner = resolveZoneAdvanceEntry(matches[1], "winner");
  const firstMatchLoser = resolveZoneAdvanceEntry(matches[0], "loser");
  const secondMatchLoser = resolveZoneAdvanceEntry(matches[1], "loser");

  matches[2] = {
    ...matches[2],
    teamAId: firstMatchWinner.id,
    teamASeed: "Ganador 1",
    teamAName: firstMatchWinner.name,
    teamALines: firstMatchWinner.lines,
    teamBId: secondMatchWinner.id,
    teamBSeed: "Ganador 2",
    teamBName: secondMatchWinner.name,
    teamBLines: secondMatchWinner.lines,
  };

  matches[3] = {
    ...matches[3],
    teamAId: firstMatchLoser.id,
    teamASeed: "Perdedor 1",
    teamAName: firstMatchLoser.name,
    teamALines: firstMatchLoser.lines,
    teamBId: secondMatchLoser.id,
    teamBSeed: "Perdedor 2",
    teamBName: secondMatchLoser.name,
    teamBLines: secondMatchLoser.lines,
  };

  return {
    ...zone,
    matches,
  };
}

function decorateZonesWithMatches(zones = [], matchFormat = "third_set") {
  return (Array.isArray(zones) ? zones : []).map((zone) =>
    applyZoneKnockoutProgressions({
      ...zone,
      matches: (Array.isArray(zone.matches) && zone.matches.length ? zone.matches : buildZoneMatches(zone)).map(
        (match, matchIndex) => {
          const teamAPlaceholder = resolveZonePlaceholderMeta(match, "teamA");
          const teamBPlaceholder = resolveZonePlaceholderMeta(match, "teamB");

          return {
            ...match,
            title: match.title || `Partido ${matchIndex + 1}`,
            roundLabel: match.roundLabel || "Zona",
            teamAId: String(match.teamAId || ""),
            teamBId: String(match.teamBId || ""),
            teamASeed: teamAPlaceholder.seed,
            teamBSeed: teamBPlaceholder.seed,
            teamAName: teamAPlaceholder.name,
            teamBName: teamBPlaceholder.name,
            teamALines: teamAPlaceholder.lines,
            teamBLines: teamBPlaceholder.lines,
            courtLabel: match.courtLabel || "Cancha por asignar",
            scheduleLabel: match.scheduleLabel || "Horario por asignar",
            resultLabel: match.resultLabel || "Resultado pendiente",
            result: {
              ...buildDefaultZoneResult(matchFormat),
              ...(match.result || {}),
              sets: normalizeResultSets(match.result?.sets, matchFormat),
            },
          };
        }
      ),
    })
  );
}

function extractAvailablePairs(registrations = [], zones = []) {
  const assignedIds = new Set(
    (Array.isArray(zones) ? zones : []).flatMap((zone) => (zone.pairs || []).map((pair) => pair.id))
  );

  return registrations
    .filter((registration) => !assignedIds.has(registration.id))
    .map((registration) => ({
      id: registration.id,
      label: registration.pairLabel || "Pareja",
    }));
}

function buildZoneQualifierPlaceholder(zone = {}, zoneLetter = "A", qualifierIndex = 0) {
  const qualifierLabel = `${qualifierIndex + 1}${zoneLetter}`;

  return {
    id: `${zone.id}-q-${qualifierIndex + 1}`,
    label: qualifierLabel,
    seedLabel: qualifierLabel,
    zoneName: zone.name,
    displayName: qualifierLabel,
    displayLines: [],
    pairLabel: "",
  };
}

function buildZoneQualifierEntry(zone = {}, zoneLetter = "A", qualifierIndex = 0, pair = {}) {
  const qualifierLabel = `${qualifierIndex + 1}${zoneLetter}`;
  const pairLabel = String(pair?.label || pair?.pairLabel || pair?.name || "").trim();
  const displayName = pairLabel ? formatShortPairLabel(pairLabel) : qualifierLabel;

  return {
    id: String(pair?.id || `${zone.id}-q-${qualifierIndex + 1}`),
    label: qualifierLabel,
    seedLabel: qualifierLabel,
    zoneName: zone.name,
    displayName,
    displayLines: pairLabel ? formatShortPairLines(pairLabel) : [],
    pairLabel,
  };
}

function resolveZoneQualifiedEntries(zone = {}, zoneLetter = "A") {
  const qualifierCount = Number(zone.qualifiers || 2);
  const pairs = Array.isArray(zone.pairs) ? zone.pairs : [];
  const matches = Array.isArray(zone.matches) ? zone.matches : [];
  const pairsById = new Map(
    pairs.map((pair) => [String(pair?.id || "").trim(), pair]).filter(([id]) => Boolean(id))
  );

  const getPairByMatchSide = (match = {}, teamKey = "teamA") => {
    const teamId = String(match?.[`${teamKey}Id`] || "").trim();
    const mappedPair = pairsById.get(teamId);

    if (mappedPair) {
      return mappedPair;
    }

    const fallbackLabel = String(match?.[`${teamKey}Name`] || "").trim();

    if (!fallbackLabel || fallbackLabel === "BYE") {
      return null;
    }

    return {
      id: teamId || `${zone.id}-${teamKey}-${fallbackLabel}`,
      label: fallbackLabel,
    };
  };

  const resolveWinnerAndLoser = (match = {}) => {
    const winnerKey = match?.result?.winner;

    if (!winnerKey || !["teamA", "teamB"].includes(winnerKey)) {
      return null;
    }

    return {
      winner: getPairByMatchSide(match, winnerKey),
      loser: getPairByMatchSide(match, winnerKey === "teamA" ? "teamB" : "teamA"),
    };
  };

  if (Number(zone.size || pairs.length || 0) === 2 && matches.length >= 1) {
    const resolved = resolveWinnerAndLoser(matches[0]);

    if (!resolved?.winner || !resolved?.loser) {
      return [];
    }

    return [
      buildZoneQualifierEntry(zone, zoneLetter, 0, resolved.winner),
      ...(qualifierCount > 1 ? [buildZoneQualifierEntry(zone, zoneLetter, 1, resolved.loser)] : []),
    ];
  }

  if (Number(zone.size || pairs.length || 0) === 4 && matches.length >= 4) {
    const finalResolved = resolveWinnerAndLoser(matches[2]);
    const thirdPlaceResolved = resolveWinnerAndLoser(matches[3]);

    if (!finalResolved?.winner || !finalResolved?.loser) {
      return [];
    }

    const qualified = [
      buildZoneQualifierEntry(zone, zoneLetter, 0, finalResolved.winner),
      ...(qualifierCount > 1 ? [buildZoneQualifierEntry(zone, zoneLetter, 1, finalResolved.loser)] : []),
    ];

    if (qualifierCount > 2 && thirdPlaceResolved?.winner) {
      qualified.push(buildZoneQualifierEntry(zone, zoneLetter, 2, thirdPlaceResolved.winner));
    }

    if (qualifierCount > 3 && thirdPlaceResolved?.loser) {
      qualified.push(buildZoneQualifierEntry(zone, zoneLetter, 3, thirdPlaceResolved.loser));
    }

    return qualified;
  }

  if (Number(zone.size || pairs.length || 0) === 3 && matches.length >= 3) {
    const allMatchesCompleted = matches.every((match) => ["teamA", "teamB"].includes(match?.result?.winner));

    if (!allMatchesCompleted) {
      return [];
    }

    const standings = pairs.map((pair, index) => ({
      id: String(pair?.id || `${zone.id}-pair-${index + 1}`),
      label: pair?.label || `Pareja ${index + 1}`,
      wins: 0,
      played: 0,
      seed: index,
    }));
    const standingsById = new Map(standings.map((entry) => [entry.id, entry]));

    matches.forEach((match) => {
      const winnerKey = match?.result?.winner;
      const teamAId = String(match?.teamAId || "").trim();
      const teamBId = String(match?.teamBId || "").trim();
      const teamAStanding = standingsById.get(teamAId);
      const teamBStanding = standingsById.get(teamBId);

      if (teamAStanding) {
        teamAStanding.played += 1;
      }
      if (teamBStanding) {
        teamBStanding.played += 1;
      }

      if (winnerKey === "teamA" && teamAStanding) {
        teamAStanding.wins += 1;
      }
      if (winnerKey === "teamB" && teamBStanding) {
        teamBStanding.wins += 1;
      }
    });

    return standings
      .sort((first, second) => {
        if (second.wins !== first.wins) {
          return second.wins - first.wins;
        }

        return first.seed - second.seed;
      })
      .slice(0, qualifierCount)
      .map((entry, index) => buildZoneQualifierEntry(zone, zoneLetter, index, entry));
  }

  return [];
}

function buildQualifiedEntriesFromZones(zonesPreview = []) {
  return (Array.isArray(zonesPreview) ? zonesPreview : []).flatMap((zone, zoneIndex) => {
    const zoneLetter = String.fromCharCode(65 + zoneIndex);
    const qualifierCount = Number(zone.qualifiers || 2);
    const qualifiedPairs = Array.isArray(zone.qualifiedPairs) ? zone.qualifiedPairs : [];

    if (qualifiedPairs.length) {
      return Array.from({ length: qualifierCount }, (_, qualifierIndex) =>
        qualifiedPairs[qualifierIndex]
          ? buildZoneQualifierEntry(zone, zoneLetter, qualifierIndex, qualifiedPairs[qualifierIndex])
          : buildZoneQualifierPlaceholder(zone, zoneLetter, qualifierIndex)
      );
    }

    const resolvedEntries = resolveZoneQualifiedEntries(zone, zoneLetter);

    return Array.from({ length: qualifierCount }, (_, qualifierIndex) =>
      resolvedEntries[qualifierIndex] || buildZoneQualifierPlaceholder(zone, zoneLetter, qualifierIndex)
    );
  });
}

function syncBracketPreviewQualifiedEntries(
  bracketPreview = null,
  zonesPreview = [],
  matchFormatResolver = null,
  ruleSet = "fap",
  recommendation = null
) {
  if (!bracketPreview || !Array.isArray(bracketPreview?.rounds) || !bracketPreview.rounds.length) {
    return bracketPreview;
  }

  const normalizedRuleSet = String(ruleSet || bracketPreview?.ruleSet || "fap").trim().toLowerCase();
  const isCustomRuleSetPreview =
    normalizedRuleSet === "apa" ||
    normalizedRuleSet === "fap" ||
    bracketPreview?.ruleSet === "apa" ||
    bracketPreview?.ruleSet === "fap";

  if (isCustomRuleSetPreview) {
    const nextCustomPreview =
      normalizedRuleSet === "apa"
        ? buildApaBracketPreview({ recommendation, zonesPreview })
        : normalizedRuleSet === "fap"
        ? buildFapBracketPreview({ recommendation, zonesPreview })
        : null;

    if (nextCustomPreview || bracketPreview?.ruleSet === "apa" || bracketPreview?.ruleSet === "fap") {
      const previousMatchesById = new Map(
        (bracketPreview.rounds || [])
          .flatMap((round) => round.matches || [])
          .map((match) => [match.id, match])
          .filter(([id]) => Boolean(id))
      );
      const mergedCustomPreview = nextCustomPreview
        ? {
            ...nextCustomPreview,
            rounds: (nextCustomPreview.rounds || []).map((round) => ({
              ...round,
              matches: (round.matches || []).map((match) => {
                const previousMatch = previousMatchesById.get(match.id);

                if (!previousMatch) {
                  return match;
                }

                return {
                  ...match,
                  courtLabel: previousMatch.courtLabel || match.courtLabel,
                  result: previousMatch.result || match.result,
                  resultLabel: previousMatch.resultLabel || match.resultLabel,
                  scheduledDayKey: previousMatch.scheduledDayKey || match.scheduledDayKey,
                  scheduledTime: previousMatch.scheduledTime || match.scheduledTime,
                  scheduleLabel: previousMatch.scheduleLabel || match.scheduleLabel,
                };
              }),
            })),
          }
        : null;

      return mergedCustomPreview
        ? applyBracketProgressions(mergedCustomPreview, matchFormatResolver)
        : bracketPreview;
    }
  }

  const firstRound = bracketPreview.rounds[0];
  const bracketSize = Math.max(((firstRound?.matches || []).length || 1) * 2, 2);
  const entries = buildBracketSlots(buildQualifiedEntriesFromZones(zonesPreview), bracketSize);
  const nextRounds = (bracketPreview.rounds || []).map((round, roundIndex) => {
    if (roundIndex !== 0) {
      return round;
    }

    return {
      ...round,
      matches: (round.matches || []).map((match, matchIndex) => {
        const teamA = entries[matchIndex * 2];
        const teamB = entries[matchIndex * 2 + 1];
        const nextTeamASeed = teamA?.seedLabel || teamA?.label || "";
        const nextTeamBSeed = teamB?.seedLabel || teamB?.label || "";
        const nextTeamAName = teamA?.displayName === "BYE" ? "" : teamA?.displayName || "";
        const nextTeamBName = teamB?.displayName === "BYE" ? "" : teamB?.displayName || "";
        const nextTeamALines = teamA?.displayLines || [];
        const nextTeamBLines = teamB?.displayLines || [];
        const nextTeamAIsBye = Boolean(teamA?.isBye);
        const nextTeamBIsBye = Boolean(teamB?.isBye);
        const teamsChanged =
          String(match?.teamASeed || "") !== String(nextTeamASeed || "") ||
          String(match?.teamBSeed || "") !== String(nextTeamBSeed || "") ||
          String(match?.teamAName || "") !== String(nextTeamAName || "") ||
          String(match?.teamBName || "") !== String(nextTeamBName || "");
        const autoWinner =
          nextTeamAIsBye && !nextTeamBIsBye ? "teamB" : nextTeamBIsBye && !nextTeamAIsBye ? "teamA" : "";

        return {
          ...match,
          teamASeed: nextTeamASeed,
          teamAId: nextTeamAIsBye ? "" : String(teamA?.id || ""),
          teamAName: nextTeamAName,
          teamALines: nextTeamALines,
          teamAIsBye: nextTeamAIsBye,
          teamBSeed: nextTeamBSeed,
          teamBId: nextTeamBIsBye ? "" : String(teamB?.id || ""),
          teamBName: nextTeamBName,
          teamBLines: nextTeamBLines,
          teamBIsBye: nextTeamBIsBye,
          resultLabel: autoWinner ? "Avanza por BYE" : teamsChanged ? "Resultado pendiente" : match.resultLabel,
          result:
            teamsChanged || autoWinner
              ? {
                  ...buildDefaultBracketResult(
                    typeof matchFormatResolver === "function" ? matchFormatResolver(round) : "third_set"
                  ),
                  winnerSource: autoWinner ? "auto" : "",
                  winner: autoWinner,
                }
              : match.result,
        };
      }),
    };
  });

  return applyBracketProgressions(
    {
      ...bracketPreview,
      rounds: nextRounds,
    },
    matchFormatResolver
  );
}

function resolveBracketAdvanceEntry(match = {}, target = "winner") {
  const winnerKey = match?.result?.winner;

  if (!winnerKey || !["teamA", "teamB"].includes(winnerKey)) {
    return null;
  }

  const teamKey = target === "winner" ? winnerKey : winnerKey === "teamA" ? "teamB" : "teamA";

  return {
    id: match?.[`${teamKey}Id`] || "",
    seed: match?.[`${teamKey}Seed`] || "",
    name: match?.[`${teamKey}Name`] || "",
    lines: Array.isArray(match?.[`${teamKey}Lines`]) ? match[`${teamKey}Lines`] : [],
    isBye: Boolean(match?.[`${teamKey}IsBye`]),
  };
}

function isBracketPendingPlaceholder(value = "") {
  const normalized = String(value || "").trim();

  return /^Ganador\s+/i.test(normalized) || /^P\d+\s*G$/i.test(normalized);
}

function isBracketSourceLinkedSlotPending(match = {}, teamKey = "teamA") {
  const sourceMatchId = String(match?.[`${teamKey}SourceMatchId`] || "").trim();
  const id = String(match?.[`${teamKey}Id`] || "").trim();
  const name = String(match?.[`${teamKey}Name`] || "").trim();
  const lines = Array.isArray(match?.[`${teamKey}Lines`]) ? match[`${teamKey}Lines`] : [];
  const hasLines = lines.some((line) => String(line || "").trim());
  const isPendingSourceId = Boolean(
    sourceMatchId &&
      (!id ||
        id === `source-${sourceMatchId}` ||
        id.toLowerCase().startsWith("source-"))
  );
  const hasRealId = Boolean(id && !isPendingSourceId);
  const hasRealName = Boolean(name && !isBracketPendingPlaceholder(name));

  return Boolean(sourceMatchId && !hasRealId && !hasRealName && !hasLines && !match?.[`${teamKey}IsBye`]);
}

function getBracketTeamSeedDisplay(match = {}, teamKey = "teamA") {
  if (isBracketSourceLinkedSlotPending(match, teamKey)) {
    return "";
  }

  const seed = String(match?.[`${teamKey}Seed`] || "").trim();

  if (isBracketPendingPlaceholder(seed)) {
    return "";
  }

  return seed;
}

function getBracketTeamDisplayLines(match = {}, teamKey = "teamA") {
  const linesKey = teamKey === "teamA" ? "teamALines" : "teamBLines";
  const nameKey = teamKey === "teamA" ? "teamAName" : "teamBName";
  const seedKey = teamKey === "teamA" ? "teamASeed" : "teamBSeed";
  const lines = Array.isArray(match?.[linesKey]) ? match[linesKey] : [];
  const visibleLines = lines.filter((line) => String(line || "").trim());
  const name = String(match?.[nameKey] || "").trim();
  const seed = String(match?.[seedKey] || "").trim();

  if (isBracketSourceLinkedSlotPending(match, teamKey)) {
    return [];
  }

  if (visibleLines.length) {
    return visibleLines;
  }

  if (!name && seed) {
    return [seed];
  }

  return formatShortPairLines(name).filter((line) => String(line || "").trim());
}

function repairBracketPreviewSourceLinks(bracketPreview = {}) {
  if (!bracketPreview || typeof bracketPreview !== "object" || !Array.isArray(bracketPreview.rounds)) {
    return bracketPreview;
  }

  const rounds = bracketPreview.rounds.map((round) => ({
    ...round,
    matches: (round.matches || []).map((match) => ({ ...match })),
  }));

  for (let roundIndex = 1; roundIndex < rounds.length; roundIndex += 1) {
    const round = rounds[roundIndex];
    const previousRound = rounds[roundIndex - 1];
    const roundTitle = String(round?.title || round?.roundTitle || "").trim().toLowerCase();
    const isFinalRound = roundTitle === "final";

    if (!isFinalRound || (round.matches || []).length !== 1 || (previousRound.matches || []).length < 2) {
      continue;
    }

    const finalMatch = round.matches[0];
    const previousMatches = previousRound.matches || [];
    const previousMatchIds = previousMatches.map((match) => String(match?.id || ""));
    const preferredTeamASource =
      previousMatchIds.includes(getFapMatchId("P61"))
        ? getFapMatchId("P61")
        : previousMatchIds.includes("apa-semi-1")
        ? "apa-semi-1"
        : previousMatches[0]?.id || "";
    const preferredTeamBSource =
      previousMatchIds.includes(getFapMatchId("P62"))
        ? getFapMatchId("P62")
        : previousMatchIds.includes("apa-semi-2")
        ? "apa-semi-2"
        : previousMatches[1]?.id || "";

    if (!finalMatch.teamASourceMatchId && preferredTeamASource) {
      finalMatch.teamASourceMatchId = preferredTeamASource;
    }
    if (!finalMatch.teamBSourceMatchId && preferredTeamBSource) {
      finalMatch.teamBSourceMatchId = preferredTeamBSource;
    }
  }

  return {
    ...bracketPreview,
    rounds,
  };
}

function buildZonePlanningSignature(zonePlanning = {}) {
  const zones = Array.isArray(zonePlanning?.zones) ? zonePlanning.zones : [];

  return JSON.stringify(
    zones.map((zone, zoneIndex) => ({
      id: String(zone?.id || `zone-${zoneIndex + 1}`),
      label: String(zone?.label || ""),
      matchSchedules: Object.keys(zone?.matchSchedules || {})
        .sort()
        .map((matchKey) => {
          const schedule = zone.matchSchedules?.[matchKey] || {};
          const result = schedule.result || {};

          return {
            key: matchKey,
            resultText: String(schedule.resultText || result.score || ""),
            sets: normalizeResultSets(result.sets || [], "third_set").map((set) => ({
              teamA: String(set.teamA || ""),
              teamB: String(set.teamB || ""),
            })),
            winnerRegistrationId: String(result.winnerRegistrationId || ""),
          };
        }),
      registrationIds: (Array.isArray(zone?.registrationIds) ? zone.registrationIds : []).map(String),
    }))
  );
}

function buildZonesPreviewSignature(zonesPreview = []) {
  return JSON.stringify(
    (Array.isArray(zonesPreview) ? zonesPreview : []).map((zone, zoneIndex) => ({
      id: String(zone?.id || `zone-${zoneIndex + 1}`),
      name: String(zone?.name || zone?.label || ""),
      qualifiedPairs: (Array.isArray(zone?.qualifiedPairs) ? zone.qualifiedPairs : []).map((pair, pairIndex) => ({
        id: String(pair?.id || pair?.pairId || `pair-${pairIndex + 1}`),
        seedLabel: String(pair?.seedLabel || pair?.seed || ""),
      })),
      qualifiers: Number(zone?.qualifiers || 0),
      size: Number(zone?.size || 0),
    }))
  );
}

function applyBracketProgressions(bracketPreview = {}, matchFormatResolver = null) {
  if (!bracketPreview || typeof bracketPreview !== "object") {
    return null;
  }

  const repairedBracketPreview = repairBracketPreviewSourceLinks(bracketPreview);
  const safeRounds = Array.isArray(repairedBracketPreview?.rounds) ? repairedBracketPreview.rounds : [];
  const rounds = safeRounds.map((round) => ({
    ...round,
    matches: (round.matches || []).map((match) => ({
      ...match,
      result: {
        ...buildDefaultBracketResult(
          typeof matchFormatResolver === "function"
            ? matchFormatResolver(round)
            : "third_set"
        ),
        ...(match.result || {}),
        sets: normalizeResultSets(
          match.result?.sets,
          typeof matchFormatResolver === "function" ? matchFormatResolver(round) : "third_set"
        ),
      },
    })),
  }));

  const resolvedMatchesById = new Map();

  for (let roundIndex = 0; roundIndex < rounds.length - 1; roundIndex += 1) {
    const currentRound = rounds[roundIndex];
    const nextRound = rounds[roundIndex + 1];

    (currentRound.matches || []).forEach((match) => {
      if (match?.id) {
        resolvedMatchesById.set(match.id, match);
      }
    });

    nextRound.matches = (nextRound.matches || []).map((match, matchIndex) => {
      const usesExplicitSources = ["apa", "fap"].includes(
        String(bracketPreview?.ruleSet || "").trim().toLowerCase()
      );
      const sourceMatchA = match.teamASourceMatchId
        ? resolvedMatchesById.get(match.teamASourceMatchId)
        : usesExplicitSources
        ? null
        : currentRound.matches?.[matchIndex * 2];
      const sourceMatchB = match.teamBSourceMatchId
        ? resolvedMatchesById.get(match.teamBSourceMatchId)
        : usesExplicitSources
        ? null
        : currentRound.matches?.[matchIndex * 2 + 1];
      const winnerA = resolveBracketAdvanceEntry(sourceMatchA, "winner");
      const winnerB = resolveBracketAdvanceEntry(sourceMatchB, "winner");
      const keepPendingSourceA = Boolean(match.teamASourceMatchId) && !winnerA;
      const keepPendingSourceB = Boolean(match.teamBSourceMatchId) && !winnerB;
      const keepCurrentTeamA = !match.teamASourceMatchId && !sourceMatchA;
      const keepCurrentTeamB = !match.teamBSourceMatchId && !sourceMatchB;
      return {
        ...match,
        teamASeed:
          keepCurrentTeamA
            ? match.teamASeed || ""
            :
          keepPendingSourceA
            ? ""
            :
          winnerA?.seed ||
          (isBracketPendingPlaceholder(match.teamASeed) ? "" : match.teamASeed) ||
          "",
        teamAId: keepCurrentTeamA || keepPendingSourceA ? match.teamAId || "" : winnerA?.id || "",
        teamAName: keepCurrentTeamA || keepPendingSourceA ? match.teamAName || "" : winnerA?.name || "",
        teamALines: keepCurrentTeamA || keepPendingSourceA ? match.teamALines || [] : winnerA?.lines || [],
        teamAIsBye: keepCurrentTeamA || keepPendingSourceA ? Boolean(match.teamAIsBye) : Boolean(winnerA?.isBye),
        teamBSeed:
          keepCurrentTeamB
            ? match.teamBSeed || ""
            :
          keepPendingSourceB
            ? ""
            :
          winnerB?.seed ||
          (isBracketPendingPlaceholder(match.teamBSeed) ? "" : match.teamBSeed) ||
          "",
        teamBId: keepCurrentTeamB || keepPendingSourceB ? match.teamBId || "" : winnerB?.id || "",
        teamBName: keepCurrentTeamB || keepPendingSourceB ? match.teamBName || "" : winnerB?.name || "",
        teamBLines: keepCurrentTeamB || keepPendingSourceB ? match.teamBLines || [] : winnerB?.lines || [],
        teamBIsBye: keepCurrentTeamB || keepPendingSourceB ? Boolean(match.teamBIsBye) : Boolean(winnerB?.isBye),
      };
    });
  }

  return {
    ...repairedBracketPreview,
    rounds,
  };
}

function normalizeBracketPreview(bracketPreview = null, matchFormatResolver = null) {
  if (!bracketPreview || typeof bracketPreview !== "object" || !Array.isArray(bracketPreview.rounds)) {
    return null;
  }

  return applyBracketProgressions(
    {
      ...bracketPreview,
      rounds: (bracketPreview.rounds || []).map((round) => ({
        ...round,
        matches: (round.matches || []).map((match) => ({
          ...match,
          courtLabel: String(match?.courtLabel || "Cancha pendiente"),
          scheduledDayKey: String(match?.scheduledDayKey || ""),
          scheduledTime: String(match?.scheduledTime || ""),
          scheduleLabel:
            String(match?.scheduledDayKey || "").trim() || String(match?.scheduledTime || "").trim()
              ? `${String(match?.scheduledDayKey || "").trim() ? "Dia cargado" : "Dia a confirmar"} · ${
                  String(match?.scheduledTime || "").trim()
                    ? `${String(match?.scheduledTime || "").trim()} hs`
                    : "Hora a confirmar"
                }`
              : "Horario pendiente",
        })),
      })),
    },
    matchFormatResolver
  );
}

function buildSeedOrder(size = 2) {
  const bracketSize = Math.max(getNextPowerOfTwo(Number(size || 2)), 2);
  let seeds = [1, 2];

  while (seeds.length < bracketSize) {
    const nextSize = seeds.length * 2;
    seeds = seeds.flatMap((seed) => [seed, nextSize + 1 - seed]);
  }

  return seeds;
}

function buildBracketSlots(entries = [], bracketSize = 2) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const safeBracketSize = Math.max(getNextPowerOfTwo(Number(bracketSize || safeEntries.length || 2)), 2);
  const seedOrder = buildSeedOrder(safeBracketSize);

  return seedOrder.map((seed) => {
    const entry = safeEntries[seed - 1];

    if (entry) {
      return entry;
    }

    return {
      id: `bye-${seed}`,
      label: "BYE",
      zoneName: "",
      displayName: "BYE",
      displayLines: [],
      isBye: true,
    };
  });
}

function buildByeEntry(seed = "bye") {
  return {
    id: `bye-${seed}`,
    label: "BYE",
    zoneName: "",
    displayName: "BYE",
    displayLines: [],
    isBye: true,
  };
}

function buildPendingSourceEntry(sourceMatchId = "", label = "Ganador") {
  return {
    id: `source-${sourceMatchId}`,
    label,
    seedLabel: label,
    zoneName: "",
    displayName: label,
    displayLines: [],
    sourceMatchId,
  };
}

function buildApaEntryMap(zonesPreview = []) {
  return buildQualifiedEntriesFromZones(zonesPreview).reduce((entriesBySeed, entry) => {
    const seed = String(entry?.seedLabel || entry?.label || "").trim().toUpperCase();

    if (seed) {
      entriesBySeed[seed] = entry;
    }

    return entriesBySeed;
  }, {});
}

function getApaSeedEntry(entriesBySeed = {}, seed = "") {
  const normalizedSeed = String(seed || "").trim().toUpperCase();

  return (
    entriesBySeed[normalizedSeed] || {
      id: `apa-placeholder-${normalizedSeed}`,
      label: normalizedSeed,
      seedLabel: normalizedSeed,
      zoneName: "",
      displayName: normalizedSeed,
      displayLines: [],
      pairLabel: "",
    }
  );
}

function buildBracketMatchFromEntries({
  id,
  roundTitle,
  title,
  teamA,
  teamB,
  teamASourceMatchId = "",
  teamBSourceMatchId = "",
  visualSlotIndex = null,
  visualSlotPair = null,
}) {
  const autoWinner =
    teamA?.isBye && !teamB?.isBye ? "teamB" : teamB?.isBye && !teamA?.isBye ? "teamA" : "";

  return {
    id,
    title,
    roundTitle,
    teamAId: teamA?.isBye ? "" : String(teamA?.id || ""),
    teamASeed: teamA?.seedLabel || teamA?.label || "",
    teamAName: teamA?.displayName === "BYE" ? "" : teamA?.displayName || "",
    teamALines: teamA?.displayLines || [],
    teamAIsBye: Boolean(teamA?.isBye),
    teamASourceMatchId,
    teamBId: teamB?.isBye ? "" : String(teamB?.id || ""),
    teamBSeed: teamB?.seedLabel || teamB?.label || "",
    teamBName: teamB?.displayName === "BYE" ? "" : teamB?.displayName || "",
    teamBLines: teamB?.displayLines || [],
    teamBIsBye: Boolean(teamB?.isBye),
    teamBSourceMatchId,
    visualSlotIndex,
    visualSlotPair,
    resultLabel: autoWinner ? "Avanza por BYE" : "Resultado pendiente",
    courtLabel: "Cancha pendiente",
    scheduledDayKey: "",
    scheduledTime: "",
    scheduleLabel: "Horario pendiente",
    result: {
      ...buildDefaultBracketResult(),
      winnerSource: autoWinner ? "auto" : "",
      winner: autoWinner,
    },
  };
}

function buildApaMatch(id, roundTitle, title, teamASeed, teamBSeed, entriesBySeed = {}) {
  return buildBracketMatchFromEntries({
    id,
    roundTitle,
    title,
    teamA: getApaSeedEntry(entriesBySeed, teamASeed),
    teamB: getApaSeedEntry(entriesBySeed, teamBSeed),
  });
}

function buildApaSourceMatch(id, roundTitle, title, teamASourceMatchId, teamBSeed, entriesBySeed = {}) {
  return buildBracketMatchFromEntries({
    id,
    roundTitle,
    title,
    teamA: buildPendingSourceEntry(teamASourceMatchId, `Ganador ${title.replace(/^Semi\s*/i, "")}`),
    teamB: getApaSeedEntry(entriesBySeed, teamBSeed),
    teamASourceMatchId,
  });
}

function buildApaSeedSourceMatch(id, roundTitle, title, teamASeed, teamBSourceMatchId, entriesBySeed = {}) {
  return buildBracketMatchFromEntries({
    id,
    roundTitle,
    title,
    teamA: getApaSeedEntry(entriesBySeed, teamASeed),
    teamB: buildPendingSourceEntry(teamBSourceMatchId, `Ganador ${title}`),
    teamBSourceMatchId,
  });
}

function buildApaDoubleSourceMatch(
  id,
  roundTitle,
  title,
  teamASourceMatchId,
  teamBSourceMatchId
) {
  return buildBracketMatchFromEntries({
    id,
    roundTitle,
    title,
    teamA: buildPendingSourceEntry(teamASourceMatchId, `Ganador ${title} A`),
    teamB: buildPendingSourceEntry(teamBSourceMatchId, `Ganador ${title} B`),
    teamASourceMatchId,
    teamBSourceMatchId,
  });
}

function buildApaFinalRound() {
  return {
    id: "round-final",
    title: "Final",
    matches: [
      buildBracketMatchFromEntries({
        id: "apa-final-1",
        roundTitle: "Final",
        title: "Final",
        teamA: buildPendingSourceEntry("apa-semi-1", "Ganador Semi 1"),
        teamB: buildPendingSourceEntry("apa-semi-2", "Ganador Semi 2"),
        teamASourceMatchId: "apa-semi-1",
        teamBSourceMatchId: "apa-semi-2",
      }),
    ],
  };
}

function buildApaSemisFromQuarterIds() {
  return {
    id: "round-semis",
    title: "Semifinales",
    matches: [
      buildApaDoubleSourceMatch("apa-semi-1", "Semifinales", "Semi 1", "apa-qf-1", "apa-qf-2"),
      buildApaDoubleSourceMatch("apa-semi-2", "Semifinales", "Semi 2", "apa-qf-3", "apa-qf-4"),
    ],
  };
}

function buildApaQuarterRoundFromSourcePairs(pairs = []) {
  return {
    id: "round-cuartos",
    title: "Cuartos",
    matches: pairs.map(([teamASourceMatchId, teamBSourceMatchId], index) =>
      buildApaDoubleSourceMatch(
        `apa-qf-${index + 1}`,
        "Cuartos",
        `Llave ${index + 1}`,
        teamASourceMatchId,
        teamBSourceMatchId
      )
    ),
  };
}

function getFapMatchId(code = "") {
  return `fap-${String(code || "").trim().toLowerCase()}`;
}

function buildFapMatch(code, roundTitle, teamASeed, teamBSeed, entriesBySeed = {}) {
  return buildBracketMatchFromEntries({
    id: getFapMatchId(code),
    roundTitle,
    title: code,
    teamA: getApaSeedEntry(entriesBySeed, teamASeed),
    teamB: getApaSeedEntry(entriesBySeed, teamBSeed),
  });
}

function buildFapSeedSourceMatch(code, roundTitle, teamASeed, teamBSourceCode, entriesBySeed = {}) {
  return buildBracketMatchFromEntries({
    id: getFapMatchId(code),
    roundTitle,
    title: code,
    teamA: getApaSeedEntry(entriesBySeed, teamASeed),
    teamB: buildPendingSourceEntry(getFapMatchId(teamBSourceCode), `Ganador ${teamBSourceCode}`),
    teamBSourceMatchId: getFapMatchId(teamBSourceCode),
  });
}

function buildFapSourceSeedMatch(code, roundTitle, teamASourceCode, teamBSeed, entriesBySeed = {}) {
  return buildBracketMatchFromEntries({
    id: getFapMatchId(code),
    roundTitle,
    title: code,
    teamA: buildPendingSourceEntry(getFapMatchId(teamASourceCode), `Ganador ${teamASourceCode}`),
    teamB: getApaSeedEntry(entriesBySeed, teamBSeed),
    teamASourceMatchId: getFapMatchId(teamASourceCode),
  });
}

function buildFapDoubleSourceMatch(code, roundTitle, teamASourceCode, teamBSourceCode) {
  return buildBracketMatchFromEntries({
    id: getFapMatchId(code),
    roundTitle,
    title: code,
    teamA: buildPendingSourceEntry(getFapMatchId(teamASourceCode), `Ganador ${teamASourceCode}`),
    teamB: buildPendingSourceEntry(getFapMatchId(teamBSourceCode), `Ganador ${teamBSourceCode}`),
    teamASourceMatchId: getFapMatchId(teamASourceCode),
    teamBSourceMatchId: getFapMatchId(teamBSourceCode),
  });
}

function buildFapFinalRound() {
  return {
    id: "round-final",
    title: "Final",
    matches: [
      buildBracketMatchFromEntries({
        id: getFapMatchId("P64"),
        roundTitle: "Final",
        title: "P64",
        teamA: buildPendingSourceEntry(getFapMatchId("P61"), "Ganador P61"),
        teamB: buildPendingSourceEntry(getFapMatchId("P62"), "Ganador P62"),
        teamASourceMatchId: getFapMatchId("P61"),
        teamBSourceMatchId: getFapMatchId("P62"),
      }),
    ],
  };
}

function buildFapTemplatePreview(totalPairs, zonesPreview = [], rounds = []) {
  return {
    mode: "automatic",
    ruleSet: "fap",
    title: "Llave FAP",
    summary: `Formato FAP: cruces oficiales para ${totalPairs} parejas.`,
    recommendation: "Cruces FAP segun posiciones de zona.",
    zonesLinked: zonesPreview.map((zone) => zone.name),
    qualifierLabels: buildQualifiedEntriesFromZones(zonesPreview),
    byeCount: 0,
    rounds,
  };
}

function buildFapSemisRound(entriesBySeed, leftA = "P57", leftB = "P58", rightA = "P59", rightB = "P60") {
  return {
    id: "round-semis",
    title: "Semifinales",
    matches: [
      buildFapDoubleSourceMatch("P61", "Semifinales", leftA, leftB),
      buildFapDoubleSourceMatch("P62", "Semifinales", rightA, rightB),
    ],
  };
}

function isFapSourceToken(value = "") {
  return /^P\d+$/i.test(String(value || "").trim());
}

function buildFapDeclarativeMatch(spec = {}, roundTitle = "", entriesBySeed = {}) {
  const code = String(spec.code || "").trim();
  const teamA = String(spec.a || "").trim();
  const teamB = String(spec.b || "").trim();
  const teamASourceMatchId = isFapSourceToken(teamA) ? getFapMatchId(teamA) : "";
  const teamBSourceMatchId = isFapSourceToken(teamB) ? getFapMatchId(teamB) : "";

  return buildBracketMatchFromEntries({
    id: getFapMatchId(code),
    roundTitle,
    title: code,
    teamA: teamASourceMatchId
      ? buildPendingSourceEntry(teamASourceMatchId, `Ganador ${teamA}`)
      : getApaSeedEntry(entriesBySeed, teamA),
    teamB: teamBSourceMatchId
      ? buildPendingSourceEntry(teamBSourceMatchId, `Ganador ${teamB}`)
      : getApaSeedEntry(entriesBySeed, teamB),
    teamASourceMatchId,
    teamBSourceMatchId,
    visualSlotIndex:
      Number.isFinite(Number(spec.visualSlotIndex)) ? Number(spec.visualSlotIndex) : null,
    visualSlotPair: Array.isArray(spec.visualSlotPair) ? spec.visualSlotPair : null,
  });
}

function getFapPreVisualSlotIndexes(totalPairs = 0, count = 0) {
  const slotsByPairs = {
    7: [1],
    8: [1, 2],
    9: [1, 2],
    10: [1, 2, 3],
    11: [0, 1, 2, 3],
    13: [1],
    14: [1, 6],
    15: [1, 6],
    16: [1, 5, 6],
    17: [1, 2, 5, 6],
    18: [1, 2, 5, 6],
    19: [1, 2, 3, 5, 6],
    20: [1, 2, 3, 4, 5, 6],
    21: [1, 2, 3, 4, 5, 6],
    22: [1, 2, 3, 4, 5, 6, 7],
    23: [0, 1, 2, 3, 4, 5, 6, 7],
    24: [0, 1, 2, 3, 4, 5, 6, 7],
  };
  const slots = slotsByPairs[Number(totalPairs || 0)];

  if (Array.isArray(slots)) {
    return slots;
  }

  return Array.from({ length: count }, (_, index) => index);
}

function getFapVisualSlotPair(key = "", matchIndex = 0) {
  if (key === "quarters") {
    return [matchIndex * 2, matchIndex * 2 + 1];
  }

  if (key === "semis") {
    return [matchIndex * 2, matchIndex * 2 + 1];
  }

  return null;
}

function getFapPreRoundTitle(totalPairs = 0) {
  const normalizedTotalPairs = Number(totalPairs || 0);

  if (normalizedTotalPairs >= 7 && normalizedTotalPairs <= 11) {
    return "Cuartos";
  }

  return "Octavos";
}

function buildFapRoundsFromSpecs(groups = {}, entriesBySeed = {}, totalPairs = 0) {
  const preRoundTitle = getFapPreRoundTitle(totalPairs);
  const roundOrder = [
    ["pre", preRoundTitle, preRoundTitle === "Cuartos" ? "round-cuartos" : "round-octavos"],
    ["integration", "Octavos", "round-octavos-integracion"],
    ["quarters", "Cuartos", "round-cuartos"],
    ["semis", "Semifinales", "round-semis"],
    ["final", "Final", "round-final"],
  ];

  return roundOrder
    .map(([key, title, id]) => {
      const specs = Array.isArray(groups[key]) ? groups[key] : [];

      if (!specs.length) {
        return null;
      }

      return {
        id,
        title,
        matches: specs.map((spec, matchIndex) => {
          const preSlots = key === "pre" ? getFapPreVisualSlotIndexes(totalPairs, specs.length) : [];
          const visualSlotIndex =
            key === "pre" ? spec.visualSlotIndex ?? preSlots[matchIndex] ?? matchIndex : spec.visualSlotIndex;
          const visualSlotPair = spec.visualSlotPair || getFapVisualSlotPair(key, matchIndex);

          return buildFapDeclarativeMatch(
            {
              ...spec,
              visualSlotIndex,
              visualSlotPair,
            },
            title,
            entriesBySeed
          );
        }),
      };
    })
    .filter(Boolean);
}

const FAP_EXTRA_TEMPLATES = {
  6: {
    semis: [
      { code: "P61", a: "1A", b: "2B" },
      { code: "P62", a: "2A", b: "1B" },
    ],
    final: [{ code: "P64", a: "P61", b: "P62" }],
  },
  7: {
    pre: [{ code: "P58", a: "3A", b: "2B" }],
    semis: [
      { code: "P61", a: "1A", b: "P58" },
      { code: "P62", a: "2A", b: "1B" },
    ],
    final: [{ code: "P64", a: "P61", b: "P62" }],
  },
  8: {
    pre: [
      { code: "P58", a: "3A", b: "2B" },
      { code: "P59", a: "2A", b: "3B" },
    ],
    semis: [
      { code: "P61", a: "1A", b: "P58" },
      { code: "P62", a: "P59", b: "1B" },
    ],
    final: [{ code: "P64", a: "P61", b: "P62" }],
  },
  9: {
    pre: [
      { code: "P58", a: "2B", b: "2C" },
      { code: "P59", a: "1C", b: "2A" },
    ],
    semis: [
      { code: "P61", a: "1A", b: "P58" },
      { code: "P62", a: "P59", b: "1B" },
    ],
    final: [{ code: "P64", a: "P61", b: "P62" }],
  },
  10: {
    pre: [
      { code: "P58", a: "2B", b: "2C" },
      { code: "P59", a: "1C", b: "2A" },
      { code: "P60", a: "3A", b: "1B" },
    ],
    semis: [
      { code: "P61", a: "1A", b: "P58" },
      { code: "P62", a: "P59", b: "P60" },
    ],
    final: [{ code: "P64", a: "P61", b: "P62" }],
  },
  11: {
    pre: [
      { code: "P57", a: "1A", b: "3B" },
      { code: "P58", a: "2B", b: "2C" },
      { code: "P59", a: "1C", b: "2A" },
      { code: "P60", a: "3A", b: "1B" },
    ],
    semis: [
      { code: "P61", a: "P57", b: "P58" },
      { code: "P62", a: "P59", b: "P60" },
    ],
    final: [{ code: "P64", a: "P61", b: "P62" }],
  },
  12: {
    quarters: [
      { code: "P57", a: "1A", b: "2B" },
      { code: "P58", a: "2C", b: "1D" },
      { code: "P59", a: "1C", b: "2D" },
      { code: "P60", a: "2A", b: "1B" },
    ],
    semis: [
      { code: "P61", a: "P57", b: "P58" },
      { code: "P62", a: "P59", b: "P60" },
    ],
    final: [{ code: "P64", a: "P61", b: "P62" }],
  },
  13: {
    pre: [{ code: "P50", a: "3A", b: "2B" }],
    quarters: [
      { code: "P57", a: "1A", b: "P50" },
      { code: "P58", a: "2C", b: "1D" },
      { code: "P59", a: "1C", b: "2D" },
      { code: "P60", a: "2A", b: "1B" },
    ],
    semis: [
      { code: "P61", a: "P57", b: "P58" },
      { code: "P62", a: "P59", b: "P60" },
    ],
    final: [{ code: "P64", a: "P61", b: "P62" }],
  },
  14: {
    pre: [
      { code: "P50", a: "3A", b: "2B" },
      { code: "P55", a: "2A", b: "3B" },
    ],
    quarters: [
      { code: "P57", a: "1A", b: "P50" },
      { code: "P58", a: "2C", b: "1D" },
      { code: "P59", a: "1C", b: "2D" },
      { code: "P60", a: "P55", b: "1B" },
    ],
    semis: [
      { code: "P61", a: "P57", b: "P58" },
      { code: "P62", a: "P59", b: "P60" },
    ],
    final: [{ code: "P64", a: "P61", b: "P62" }],
  },
  15: {
    pre: [
      { code: "P50", a: "2B", b: "2C" },
      { code: "P55", a: "2D", b: "2A" },
    ],
    quarters: [
      { code: "P57", a: "1A", b: "P50" },
      { code: "P58", a: "1E", b: "1D" },
      { code: "P59", a: "1C", b: "2E" },
      { code: "P60", a: "P55", b: "1B" },
    ],
    semis: [
      { code: "P61", a: "P57", b: "P58" },
      { code: "P62", a: "P59", b: "P60" },
    ],
    final: [{ code: "P64", a: "P61", b: "P62" }],
  },
  16: {
    pre: [
      { code: "P50", a: "2B", b: "2C" },
      { code: "P54", a: "3A", b: "2E" },
      { code: "P55", a: "2D", b: "2A" },
    ],
    quarters: [
      { code: "P57", a: "1A", b: "P50" },
      { code: "P58", a: "1E", b: "1D" },
      { code: "P59", a: "1C", b: "P54" },
      { code: "P60", a: "P55", b: "1B" },
    ],
    semis: [
      { code: "P61", a: "P57", b: "P58" },
      { code: "P62", a: "P59", b: "P60" },
    ],
    final: [{ code: "P64", a: "P61", b: "P62" }],
  },
  17: {
    pre: [
      { code: "P50", a: "2B", b: "2C" },
      { code: "P51", a: "1E", b: "3B" },
      { code: "P54", a: "3A", b: "2E" },
      { code: "P55", a: "2D", b: "2A" },
    ],
    quarters: [
      { code: "P57", a: "1A", b: "P50" },
      { code: "P58", a: "P51", b: "1D" },
      { code: "P59", a: "1C", b: "P54" },
      { code: "P60", a: "P55", b: "1B" },
    ],
    semis: [
      { code: "P61", a: "P57", b: "P58" },
      { code: "P62", a: "P59", b: "P60" },
    ],
    final: [{ code: "P64", a: "P61", b: "P62" }],
  },
  18: {
    pre: [
      { code: "P50", a: "2C", b: "2F" },
      { code: "P51", a: "1E", b: "2B" },
      { code: "P54", a: "2A", b: "1F" },
      { code: "P55", a: "2E", b: "2D" },
    ],
    quarters: [
      { code: "P57", a: "1A", b: "P50" },
      { code: "P58", a: "P51", b: "1D" },
      { code: "P59", a: "1C", b: "P54" },
      { code: "P60", a: "P55", b: "1B" },
    ],
    semis: [
      { code: "P61", a: "P57", b: "P58" },
      { code: "P62", a: "P59", b: "P60" },
    ],
    final: [{ code: "P64", a: "P61", b: "P62" }],
  },
  19: {
    pre: [
      { code: "P50", a: "2C", b: "2F" },
      { code: "P51", a: "1E", b: "2B" },
      { code: "P52", a: "3A", b: "1D" },
      { code: "P54", a: "2A", b: "1F" },
      { code: "P55", a: "2E", b: "2D" },
    ],
    quarters: [
      { code: "P57", a: "1A", b: "P50" },
      { code: "P58", a: "P51", b: "P52" },
      { code: "P59", a: "1C", b: "P54" },
      { code: "P60", a: "P55", b: "1B" },
    ],
    semis: [
      { code: "P61", a: "P57", b: "P58" },
      { code: "P62", a: "P59", b: "P60" },
    ],
    final: [{ code: "P64", a: "P61", b: "P62" }],
  },
  20: {
    pre: [
      { code: "P50", a: "2C", b: "2F" },
      { code: "P51", a: "1E", b: "2B" },
      { code: "P52", a: "3A", b: "1D" },
      { code: "P53", a: "1C", b: "3B" },
      { code: "P54", a: "2A", b: "1F" },
      { code: "P55", a: "2E", b: "2D" },
    ],
    quarters: [
      { code: "P57", a: "1A", b: "P50" },
      { code: "P58", a: "P51", b: "P52" },
      { code: "P59", a: "P53", b: "P54" },
      { code: "P60", a: "P55", b: "1B" },
    ],
    semis: [
      { code: "P61", a: "P57", b: "P58" },
      { code: "P62", a: "P59", b: "P60" },
    ],
    final: [{ code: "P64", a: "P61", b: "P62" }],
  },
  21: {
    pre: [
      { code: "P50", a: "2F", b: "2G" },
      { code: "P51", a: "1E", b: "2C" },
      { code: "P52", a: "2B", b: "1D" },
      { code: "P53", a: "1C", b: "2A" },
      { code: "P54", a: "2D", b: "1F" },
      { code: "P55", a: "1G", b: "2E" },
    ],
    quarters: [
      { code: "P57", a: "1A", b: "P50" },
      { code: "P58", a: "P51", b: "P52" },
      { code: "P59", a: "P53", b: "P54" },
      { code: "P60", a: "P55", b: "1B" },
    ],
    semis: [
      { code: "P61", a: "P57", b: "P58" },
      { code: "P62", a: "P59", b: "P60" },
    ],
    final: [{ code: "P64", a: "P61", b: "P62" }],
  },
  22: {
    pre: [
      { code: "P50", a: "2F", b: "2G" },
      { code: "P51", a: "1E", b: "2C" },
      { code: "P52", a: "2B", b: "1D" },
      { code: "P53", a: "1C", b: "2A" },
      { code: "P54", a: "2D", b: "1F" },
      { code: "P55", a: "1G", b: "2E" },
      { code: "P56", a: "3A", b: "1B" },
    ],
    quarters: [
      { code: "P57", a: "1A", b: "P50" },
      { code: "P58", a: "P51", b: "P52" },
      { code: "P59", a: "P53", b: "P54" },
      { code: "P60", a: "P55", b: "P56" },
    ],
    semis: [
      { code: "P61", a: "P57", b: "P58" },
      { code: "P62", a: "P59", b: "P60" },
    ],
    final: [{ code: "P64", a: "P61", b: "P62" }],
  },
  23: {
    pre: [
      { code: "P49", a: "1A", b: "3B" },
      { code: "P50", a: "2F", b: "2G" },
      { code: "P51", a: "1E", b: "2C" },
      { code: "P52", a: "2B", b: "1D" },
      { code: "P53", a: "1C", b: "2A" },
      { code: "P54", a: "2D", b: "1F" },
      { code: "P55", a: "1G", b: "2E" },
      { code: "P56", a: "3A", b: "1B" },
    ],
    quarters: [
      { code: "P57", a: "P49", b: "P50" },
      { code: "P58", a: "P51", b: "P52" },
      { code: "P59", a: "P53", b: "P54" },
      { code: "P60", a: "P55", b: "P56" },
    ],
    semis: [
      { code: "P61", a: "P57", b: "P58" },
      { code: "P62", a: "P59", b: "P60" },
    ],
    final: [{ code: "P64", a: "P61", b: "P62" }],
  },
  24: {
    pre: [
      { code: "P49", a: "1A", b: "2B" },
      { code: "P50", a: "2G", b: "1H" },
      { code: "P51", a: "1E", b: "2F" },
      { code: "P52", a: "2C", b: "1D" },
      { code: "P53", a: "1C", b: "2D" },
      { code: "P54", a: "2E", b: "1F" },
      { code: "P55", a: "1G", b: "2H" },
      { code: "P56", a: "2A", b: "1B" },
    ],
    quarters: [
      { code: "P57", a: "P49", b: "P50" },
      { code: "P58", a: "P51", b: "P52" },
      { code: "P59", a: "P53", b: "P54" },
      { code: "P60", a: "P55", b: "P56" },
    ],
    semis: [
      { code: "P61", a: "P57", b: "P58" },
      { code: "P62", a: "P59", b: "P60" },
    ],
    final: [{ code: "P64", a: "P61", b: "P62" }],
  },
  25: {
    pre: [
      { code: "P34", a: "3A", b: "2B" },
      { code: "P50", a: "2G", b: "1H" },
      { code: "P51", a: "1E", b: "2F" },
      { code: "P52", a: "2C", b: "1D" },
      { code: "P53", a: "1C", b: "2D" },
      { code: "P54", a: "2E", b: "1F" },
      { code: "P55", a: "1G", b: "2H" },
      { code: "P56", a: "2A", b: "1B" },
    ],
    integration: [{ code: "P49", a: "1A", b: "P34" }],
    quarters: [
      { code: "P57", a: "P49", b: "P50" },
      { code: "P58", a: "P51", b: "P52" },
      { code: "P59", a: "P53", b: "P54" },
      { code: "P60", a: "P55", b: "P56" },
    ],
    semis: [
      { code: "P61", a: "P57", b: "P58" },
      { code: "P62", a: "P59", b: "P60" },
    ],
    final: [{ code: "P64", a: "P61", b: "P62" }],
  },
  26: {
    pre: [
      { code: "P34", a: "3A", b: "2B" },
      { code: "P50", a: "2G", b: "1H" },
      { code: "P51", a: "1E", b: "2F" },
      { code: "P52", a: "2C", b: "1D" },
      { code: "P53", a: "1C", b: "2D" },
      { code: "P54", a: "2E", b: "1F" },
      { code: "P55", a: "1G", b: "2H" },
      { code: "P56", a: "2A", b: "3B" },
    ],
    integration: [{ code: "P49", a: "1A", b: "P34" }],
    quarters: [
      { code: "P57", a: "P49", b: "P50" },
      { code: "P58", a: "P51", b: "P52" },
      { code: "P59", a: "P53", b: "P54" },
      { code: "P60", a: "P55", b: "P56" },
    ],
    semis: [
      { code: "P61", a: "P57", b: "P58" },
      { code: "P62", a: "P59", b: "P60" },
    ],
    final: [{ code: "P64", a: "P61", b: "P62" }],
  },
  27: {
    pre: [
      { code: "P34", a: "2B", b: "2C" },
      { code: "P50", a: "1I", b: "1H" },
      { code: "P51", a: "1E", b: "2G" },
      { code: "P52", a: "2F", b: "1D" },
      { code: "P53", a: "1C", b: "2E" },
      { code: "P54", a: "2H", b: "1F" },
      { code: "P55", a: "1G", b: "2I" },
      { code: "P47", a: "2D", b: "2A" },
    ],
    integration: [
      { code: "P49", a: "1A", b: "P34" },
      { code: "P56", a: "P47", b: "1B" },
    ],
    quarters: [
      { code: "P57", a: "P49", b: "P50" },
      { code: "P58", a: "P51", b: "P52" },
      { code: "P59", a: "P53", b: "P54" },
      { code: "P60", a: "P55", b: "P56" },
    ],
    semis: [
      { code: "P61", a: "P57", b: "P58" },
      { code: "P62", a: "P59", b: "P60" },
    ],
    final: [{ code: "P64", a: "P61", b: "P62" }],
  },
  28: {
    pre: [
      { code: "P34", a: "2B", b: "2C" },
      { code: "P50", a: "1I", b: "1H" },
      { code: "P51", a: "1E", b: "2G" },
      { code: "P52", a: "2F", b: "1D" },
      { code: "P42", a: "3A", b: "2E" },
      { code: "P54", a: "2H", b: "1F" },
      { code: "P55", a: "1G", b: "2I" },
      { code: "P47", a: "2D", b: "2A" },
    ],
    integration: [
      { code: "P49", a: "1A", b: "P34" },
      { code: "P53", a: "1C", b: "P42" },
      { code: "P56", a: "P47", b: "1B" },
    ],
    quarters: [
      { code: "P57", a: "P49", b: "P50" },
      { code: "P58", a: "P51", b: "P52" },
      { code: "P59", a: "P53", b: "P54" },
      { code: "P60", a: "P55", b: "P56" },
    ],
    semis: [
      { code: "P61", a: "P57", b: "P58" },
      { code: "P62", a: "P59", b: "P60" },
    ],
    final: [{ code: "P64", a: "P61", b: "P62" }],
  },
  29: {
    pre: [
      { code: "P34", a: "2B", b: "2C" },
      { code: "P50", a: "1I", b: "1H" },
      { code: "P51", a: "1E", b: "2G" },
      { code: "P39", a: "2F", b: "3B" },
      { code: "P42", a: "3A", b: "2E" },
      { code: "P54", a: "2H", b: "1F" },
      { code: "P55", a: "1G", b: "2I" },
      { code: "P47", a: "2D", b: "2A" },
    ],
    integration: [
      { code: "P49", a: "1A", b: "P34" },
      { code: "P52", a: "P39", b: "1D" },
      { code: "P53", a: "1C", b: "P42" },
      { code: "P56", a: "P47", b: "1B" },
    ],
    quarters: [
      { code: "P57", a: "P49", b: "P50" },
      { code: "P58", a: "P51", b: "P52" },
      { code: "P59", a: "P53", b: "P54" },
      { code: "P60", a: "P55", b: "P56" },
    ],
    semis: [
      { code: "P61", a: "P57", b: "P58" },
      { code: "P62", a: "P59", b: "P60" },
    ],
    final: [{ code: "P64", a: "P61", b: "P62" }],
  },
  30: {
    pre: [
      { code: "P34", a: "2C", b: "2F" },
      { code: "P50", a: "1I", b: "1H" },
      { code: "P51", a: "1E", b: "2J" },
      { code: "P39", a: "2G", b: "2B" },
      { code: "P42", a: "2A", b: "2H" },
      { code: "P54", a: "2I", b: "1F" },
      { code: "P55", a: "1G", b: "1J" },
      { code: "P47", a: "2E", b: "2D" },
    ],
    integration: [
      { code: "P49", a: "1A", b: "P34" },
      { code: "P52", a: "P39", b: "1D" },
      { code: "P53", a: "1C", b: "P42" },
      { code: "P56", a: "P47", b: "1B" },
    ],
    quarters: [
      { code: "P57", a: "P49", b: "P50" },
      { code: "P58", a: "P51", b: "P52" },
      { code: "P59", a: "P53", b: "P54" },
      { code: "P60", a: "P55", b: "P56" },
    ],
    semis: [
      { code: "P61", a: "P57", b: "P58" },
      { code: "P62", a: "P59", b: "P60" },
    ],
    final: [{ code: "P64", a: "P61", b: "P62" }],
  },
  31: {
    pre: [
      { code: "P34", a: "2C", b: "2F" },
      { code: "P50", a: "1I", b: "1H" },
      { code: "P51", a: "1E", b: "2J" },
      { code: "P39", a: "2G", b: "2B" },
      { code: "P42", a: "2A", b: "2H" },
      { code: "P43", a: "2I", b: "3A" },
      { code: "P55", a: "1G", b: "1J" },
      { code: "P47", a: "2E", b: "2D" },
    ],
    integration: [
      { code: "P49", a: "1A", b: "P34" },
      { code: "P52", a: "P39", b: "1D" },
      { code: "P53", a: "1C", b: "P42" },
      { code: "P54", a: "P43", b: "1F" },
      { code: "P56", a: "P47", b: "1B" },
    ],
    quarters: [
      { code: "P57", a: "P49", b: "P50" },
      { code: "P58", a: "P51", b: "P52" },
      { code: "P59", a: "P53", b: "P54" },
      { code: "P60", a: "P55", b: "P56" },
    ],
    semis: [
      { code: "P61", a: "P57", b: "P58" },
      { code: "P62", a: "P59", b: "P60" },
    ],
    final: [{ code: "P64", a: "P61", b: "P62" }],
  },
  32: {
    pre: [
      { code: "P34", a: "2C", b: "2F" },
      { code: "P50", a: "1I", b: "1H" },
      { code: "P38", a: "3B", b: "2J" },
      { code: "P39", a: "2G", b: "2B" },
      { code: "P42", a: "2A", b: "2H" },
      { code: "P43", a: "2I", b: "3A" },
      { code: "P55", a: "1G", b: "1J" },
      { code: "P47", a: "2E", b: "2D" },
    ],
    integration: [
      { code: "P49", a: "1A", b: "P34" },
      { code: "P51", a: "1E", b: "P38" },
      { code: "P52", a: "P39", b: "1D" },
      { code: "P53", a: "1C", b: "P42" },
      { code: "P54", a: "P43", b: "1F" },
      { code: "P56", a: "P47", b: "1B" },
    ],
    quarters: [
      { code: "P57", a: "P49", b: "P50" },
      { code: "P58", a: "P51", b: "P52" },
      { code: "P59", a: "P53", b: "P54" },
      { code: "P60", a: "P55", b: "P56" },
    ],
    semis: [
      { code: "P61", a: "P57", b: "P58" },
      { code: "P62", a: "P59", b: "P60" },
    ],
    final: [{ code: "P64", a: "P61", b: "P62" }],
  },
};

function buildFapBracketPreview({ recommendation, zonesPreview = [] }) {
  const totalPairs = (Array.isArray(zonesPreview) ? zonesPreview : []).reduce(
    (total, zone) => total + Number(zone?.size || zone?.pairs?.length || 0),
    0
  );
  const entriesBySeed = buildApaEntryMap(zonesPreview);
  const finalRound = buildFapFinalRound();
  const extraTemplate = FAP_EXTRA_TEMPLATES[totalPairs];

  if (extraTemplate) {
    return buildFapTemplatePreview(
      totalPairs,
      zonesPreview,
      buildFapRoundsFromSpecs(extraTemplate, entriesBySeed, totalPairs)
    );
  }

  if (totalPairs === 6) {
    return buildFapTemplatePreview(totalPairs, zonesPreview, [
      {
        id: "round-semis",
        title: "Semifinales",
        matches: [
          buildFapMatch("P61", "Semifinales", "1A", "2B", entriesBySeed),
          buildFapMatch("P62", "Semifinales", "2A", "1B", entriesBySeed),
        ],
      },
      finalRound,
    ]);
  }

  if (totalPairs === 7) {
    return buildFapTemplatePreview(totalPairs, zonesPreview, [
      {
        id: "round-cuartos",
        title: "Cuartos",
        matches: [buildFapMatch("P58", "Cuartos", "3A", "2B", entriesBySeed)],
      },
      {
        id: "round-semis",
        title: "Semifinales",
        matches: [
          buildFapSeedSourceMatch("P61", "Semifinales", "1A", "P58", entriesBySeed),
          buildFapMatch("P62", "Semifinales", "2A", "1B", entriesBySeed),
        ],
      },
      finalRound,
    ]);
  }

  if (totalPairs === 8) {
    return buildFapTemplatePreview(totalPairs, zonesPreview, [
      {
        id: "round-cuartos",
        title: "Cuartos",
        matches: [
          buildFapMatch("P58", "Cuartos", "3A", "2B", entriesBySeed),
          buildFapMatch("P59", "Cuartos", "2A", "3B", entriesBySeed),
        ],
      },
      {
        id: "round-semis",
        title: "Semifinales",
        matches: [
          buildFapSeedSourceMatch("P61", "Semifinales", "1A", "P58", entriesBySeed),
          buildFapSourceSeedMatch("P62", "Semifinales", "P59", "1B", entriesBySeed),
        ],
      },
      finalRound,
    ]);
  }

  if (totalPairs === 9) {
    return buildFapTemplatePreview(totalPairs, zonesPreview, [
      {
        id: "round-cuartos",
        title: "Cuartos",
        matches: [
          buildFapMatch("P58", "Cuartos", "2B", "2C", entriesBySeed),
          buildFapMatch("P59", "Cuartos", "1C", "2A", entriesBySeed),
        ],
      },
      {
        id: "round-semis",
        title: "Semifinales",
        matches: [
          buildFapSeedSourceMatch("P61", "Semifinales", "1A", "P58", entriesBySeed),
          buildFapSourceSeedMatch("P62", "Semifinales", "P59", "1B", entriesBySeed),
        ],
      },
      finalRound,
    ]);
  }

  if (totalPairs === 10) {
    return buildFapTemplatePreview(totalPairs, zonesPreview, [
      {
        id: "round-cuartos",
        title: "Cuartos",
        matches: [
          buildFapMatch("P58", "Cuartos", "2B", "2C", entriesBySeed),
          buildFapMatch("P59", "Cuartos", "1C", "2A", entriesBySeed),
          buildFapMatch("P60", "Cuartos", "3A", "1B", entriesBySeed),
        ],
      },
      {
        id: "round-semis",
        title: "Semifinales",
        matches: [
          buildFapSeedSourceMatch("P61", "Semifinales", "1A", "P58", entriesBySeed),
          buildFapDoubleSourceMatch("P62", "Semifinales", "P59", "P60"),
        ],
      },
      finalRound,
    ]);
  }

  if (totalPairs === 11) {
    return buildFapTemplatePreview(totalPairs, zonesPreview, [
      {
        id: "round-cuartos",
        title: "Cuartos",
        matches: [
          buildFapMatch("P57", "Cuartos", "1A", "3B", entriesBySeed),
          buildFapMatch("P58", "Cuartos", "2B", "2C", entriesBySeed),
          buildFapMatch("P59", "Cuartos", "1C", "2A", entriesBySeed),
          buildFapMatch("P60", "Cuartos", "3A", "1B", entriesBySeed),
        ],
      },
      buildFapSemisRound(entriesBySeed),
      finalRound,
    ]);
  }

  if (totalPairs === 12) {
    return buildFapTemplatePreview(totalPairs, zonesPreview, [
      {
        id: "round-cuartos",
        title: "Cuartos",
        matches: [
          buildFapMatch("P57", "Cuartos", "1A", "2B", entriesBySeed),
          buildFapMatch("P58", "Cuartos", "2C", "1D", entriesBySeed),
          buildFapMatch("P59", "Cuartos", "1C", "2D", entriesBySeed),
          buildFapMatch("P60", "Cuartos", "2A", "1B", entriesBySeed),
        ],
      },
      buildFapSemisRound(entriesBySeed),
      finalRound,
    ]);
  }

  if (totalPairs === 14) {
    return buildFapTemplatePreview(totalPairs, zonesPreview, [
      {
        id: "round-octavos",
        title: "Octavos",
        matches: [
          buildFapMatch("P50", "Octavos", "3A", "2B", entriesBySeed),
          buildFapMatch("P55", "Octavos", "2A", "3B", entriesBySeed),
        ],
      },
      {
        id: "round-cuartos",
        title: "Cuartos",
        matches: [
          buildFapSeedSourceMatch("P57", "Cuartos", "1A", "P50", entriesBySeed),
          buildFapMatch("P58", "Cuartos", "2C", "1D", entriesBySeed),
          buildFapMatch("P59", "Cuartos", "1C", "2D", entriesBySeed),
          buildFapSourceSeedMatch("P60", "Cuartos", "P55", "1B", entriesBySeed),
        ],
      },
      buildFapSemisRound(entriesBySeed),
      finalRound,
    ]);
  }

  if (totalPairs === 15) {
    return buildFapTemplatePreview(totalPairs, zonesPreview, [
      {
        id: "round-octavos",
        title: "Octavos",
        matches: [
          buildFapMatch("P50", "Octavos", "2B", "2C", entriesBySeed),
          buildFapMatch("P55", "Octavos", "2D", "2A", entriesBySeed),
        ],
      },
      {
        id: "round-cuartos",
        title: "Cuartos",
        matches: [
          buildFapSeedSourceMatch("P57", "Cuartos", "1A", "P50", entriesBySeed),
          buildFapMatch("P58", "Cuartos", "1E", "1D", entriesBySeed),
          buildFapMatch("P59", "Cuartos", "1C", "2E", entriesBySeed),
          buildFapSourceSeedMatch("P60", "Cuartos", "P55", "1B", entriesBySeed),
        ],
      },
      buildFapSemisRound(entriesBySeed),
      finalRound,
    ]);
  }

  if (totalPairs === 16) {
    return buildFapTemplatePreview(totalPairs, zonesPreview, [
      {
        id: "round-octavos",
        title: "Octavos",
        matches: [
          buildFapMatch("P50", "Octavos", "2B", "2C", entriesBySeed),
          buildFapMatch("P54", "Octavos", "3A", "2E", entriesBySeed),
          buildFapMatch("P55", "Octavos", "2D", "2A", entriesBySeed),
        ],
      },
      {
        id: "round-cuartos",
        title: "Cuartos",
        matches: [
          buildFapSeedSourceMatch("P57", "Cuartos", "1A", "P50", entriesBySeed),
          buildFapMatch("P58", "Cuartos", "1E", "1D", entriesBySeed),
          buildFapSeedSourceMatch("P59", "Cuartos", "1C", "P54", entriesBySeed),
          buildFapSourceSeedMatch("P60", "Cuartos", "P55", "1B", entriesBySeed),
        ],
      },
      buildFapSemisRound(entriesBySeed),
      finalRound,
    ]);
  }

  if (totalPairs === 17) {
    return buildFapTemplatePreview(totalPairs, zonesPreview, [
      {
        id: "round-octavos",
        title: "Octavos",
        matches: [
          buildFapMatch("P50", "Octavos", "2B", "2C", entriesBySeed),
          buildFapMatch("P51", "Octavos", "1E", "3B", entriesBySeed),
          buildFapMatch("P54", "Octavos", "3A", "2E", entriesBySeed),
          buildFapMatch("P55", "Octavos", "2D", "2A", entriesBySeed),
        ],
      },
      {
        id: "round-cuartos",
        title: "Cuartos",
        matches: [
          buildFapSeedSourceMatch("P57", "Cuartos", "1A", "P50", entriesBySeed),
          buildFapSourceSeedMatch("P58", "Cuartos", "P51", "1D", entriesBySeed),
          buildFapSeedSourceMatch("P59", "Cuartos", "1C", "P54", entriesBySeed),
          buildFapSourceSeedMatch("P60", "Cuartos", "P55", "1B", entriesBySeed),
        ],
      },
      buildFapSemisRound(entriesBySeed),
      finalRound,
    ]);
  }

  if (totalPairs === 18) {
    return buildFapTemplatePreview(totalPairs, zonesPreview, [
      {
        id: "round-octavos",
        title: "Octavos",
        matches: [
          buildFapMatch("P50", "Octavos", "2C", "2F", entriesBySeed),
          buildFapMatch("P51", "Octavos", "1E", "2B", entriesBySeed),
          buildFapMatch("P54", "Octavos", "2A", "1F", entriesBySeed),
          buildFapMatch("P55", "Octavos", "2E", "2D", entriesBySeed),
        ],
      },
      {
        id: "round-cuartos",
        title: "Cuartos",
        matches: [
          buildFapSeedSourceMatch("P57", "Cuartos", "1A", "P50", entriesBySeed),
          buildFapSourceSeedMatch("P58", "Cuartos", "P51", "1D", entriesBySeed),
          buildFapSeedSourceMatch("P59", "Cuartos", "1C", "P54", entriesBySeed),
          buildFapSourceSeedMatch("P60", "Cuartos", "P55", "1B", entriesBySeed),
        ],
      },
      buildFapSemisRound(entriesBySeed),
      finalRound,
    ]);
  }

  if (totalPairs === 19) {
    return buildFapTemplatePreview(totalPairs, zonesPreview, [
      {
        id: "round-octavos",
        title: "Octavos",
        matches: [
          buildFapMatch("P50", "Octavos", "2C", "2F", entriesBySeed),
          buildFapMatch("P51", "Octavos", "1E", "2B", entriesBySeed),
          buildFapMatch("P52", "Octavos", "3A", "1D", entriesBySeed),
          buildFapMatch("P54", "Octavos", "2A", "1F", entriesBySeed),
          buildFapMatch("P55", "Octavos", "2E", "2D", entriesBySeed),
        ],
      },
      {
        id: "round-cuartos",
        title: "Cuartos",
        matches: [
          buildFapSeedSourceMatch("P57", "Cuartos", "1A", "P50", entriesBySeed),
          buildFapDoubleSourceMatch("P58", "Cuartos", "P51", "P52"),
          buildFapSeedSourceMatch("P59", "Cuartos", "1C", "P54", entriesBySeed),
          buildFapSourceSeedMatch("P60", "Cuartos", "P55", "1B", entriesBySeed),
        ],
      },
      buildFapSemisRound(entriesBySeed),
      finalRound,
    ]);
  }

  if (totalPairs === 20) {
    return buildFapTemplatePreview(totalPairs, zonesPreview, [
      {
        id: "round-octavos",
        title: "Octavos",
        matches: [
          buildFapMatch("P50", "Octavos", "2C", "2F", entriesBySeed),
          buildFapMatch("P51", "Octavos", "1E", "2B", entriesBySeed),
          buildFapMatch("P52", "Octavos", "3A", "1D", entriesBySeed),
          buildFapMatch("P53", "Octavos", "1C", "3B", entriesBySeed),
          buildFapMatch("P54", "Octavos", "2A", "1F", entriesBySeed),
          buildFapMatch("P55", "Octavos", "2E", "2D", entriesBySeed),
        ],
      },
      {
        id: "round-cuartos",
        title: "Cuartos",
        matches: [
          buildFapSeedSourceMatch("P57", "Cuartos", "1A", "P50", entriesBySeed),
          buildFapDoubleSourceMatch("P58", "Cuartos", "P51", "P52"),
          buildFapDoubleSourceMatch("P59", "Cuartos", "P53", "P54"),
          buildFapSourceSeedMatch("P60", "Cuartos", "P55", "1B", entriesBySeed),
        ],
      },
      buildFapSemisRound(entriesBySeed),
      finalRound,
    ]);
  }

  if (totalPairs === 21) {
    return buildFapTemplatePreview(totalPairs, zonesPreview, [
      {
        id: "round-octavos",
        title: "Octavos",
        matches: [
          buildFapMatch("P50", "Octavos", "2F", "2G", entriesBySeed),
          buildFapMatch("P51", "Octavos", "1E", "2C", entriesBySeed),
          buildFapMatch("P52", "Octavos", "2B", "1D", entriesBySeed),
          buildFapMatch("P53", "Octavos", "1C", "2A", entriesBySeed),
          buildFapMatch("P54", "Octavos", "2D", "1F", entriesBySeed),
          buildFapMatch("P55", "Octavos", "1G", "2E", entriesBySeed),
        ],
      },
      {
        id: "round-cuartos",
        title: "Cuartos",
        matches: [
          buildFapSeedSourceMatch("P57", "Cuartos", "1A", "P50", entriesBySeed),
          buildFapDoubleSourceMatch("P58", "Cuartos", "P51", "P52"),
          buildFapDoubleSourceMatch("P59", "Cuartos", "P53", "P54"),
          buildFapSourceSeedMatch("P60", "Cuartos", "P55", "1B", entriesBySeed),
        ],
      },
      buildFapSemisRound(entriesBySeed),
      finalRound,
    ]);
  }

  return null;
}

function buildApaBracketPreview({ recommendation, zonesPreview = [] }) {
  const totalPairs = (Array.isArray(zonesPreview) ? zonesPreview : []).reduce(
    (total, zone) => total + Number(zone?.size || zone?.pairs?.length || 0),
    0
  );
  const entriesBySeed = buildApaEntryMap(zonesPreview);
  const finalRound = buildApaFinalRound();

  if (totalPairs >= 6 && totalPairs <= 8) {
    return {
      mode: "automatic",
      ruleSet: "apa",
      title: "Semifinales APA",
      summary: "Formato APA: semifinales directas con 2 clasificados por zona.",
      recommendation: "Cruces APA segun posiciones de zona.",
      zonesLinked: zonesPreview.map((zone) => zone.name),
      qualifierLabels: buildQualifiedEntriesFromZones(zonesPreview),
      byeCount: 0,
      rounds: [
        {
          id: "round-semis",
          title: "Semifinales",
          matches: [
            buildApaMatch("apa-semi-1", "Semifinales", "Semifinal 1", "1A", "2B", entriesBySeed),
            buildApaMatch("apa-semi-2", "Semifinales", "Semifinal 2", "2A", "1B", entriesBySeed),
          ],
        },
        finalRound,
      ],
    };
  }

  if (totalPairs >= 9 && totalPairs <= 11) {
    return {
      mode: "automatic",
      ruleSet: "apa",
      title: "Cruces APA",
      summary: "Formato APA: cruces previos y semifinales.",
      recommendation: "Cruces APA segun posiciones de zona.",
      zonesLinked: zonesPreview.map((zone) => zone.name),
      qualifierLabels: buildQualifiedEntriesFromZones(zonesPreview),
      byeCount: 0,
      rounds: [
        {
          id: "round-cruces",
          title: "Cruces",
          matches: [
            buildApaMatch("apa-cruce-1", "Cruces", "Cruce 1", "2B", "2C", entriesBySeed),
            buildApaMatch("apa-cruce-2", "Cruces", "Cruce 2", "1C", "2A", entriesBySeed),
          ],
        },
        {
          id: "round-semis",
          title: "Semifinales",
          matches: [
            buildApaSourceMatch("apa-semi-1", "Semifinales", "Semi 1", "apa-cruce-1", "1A", entriesBySeed),
            buildApaSourceMatch("apa-semi-2", "Semifinales", "Semi 2", "apa-cruce-2", "1B", entriesBySeed),
          ],
        },
        finalRound,
      ],
    };
  }

  if (totalPairs >= 12 && totalPairs <= 14) {
    return {
      mode: "automatic",
      ruleSet: "apa",
      title: "Cuartos APA",
      summary: "Formato APA: cuartos de final con zonas A a D.",
      recommendation: "Cruces APA segun posiciones de zona.",
      zonesLinked: zonesPreview.map((zone) => zone.name),
      qualifierLabels: buildQualifiedEntriesFromZones(zonesPreview),
      byeCount: 0,
      rounds: [
        {
          id: "round-cuartos",
          title: "Cuartos",
          matches: [
            buildApaMatch("apa-qf-1", "Cuartos", "Llave 1", "1A", "2C", entriesBySeed),
            buildApaMatch("apa-qf-2", "Cuartos", "Llave 2", "2B", "1D", entriesBySeed),
            buildApaMatch("apa-qf-3", "Cuartos", "Llave 3", "1C", "2A", entriesBySeed),
            buildApaMatch("apa-qf-4", "Cuartos", "Llave 4", "2D", "1B", entriesBySeed),
          ],
        },
        {
          id: "round-semis",
          title: "Semifinales",
          matches: [
            buildBracketMatchFromEntries({
              id: "apa-semi-1",
              roundTitle: "Semifinales",
              title: "Semi 1",
              teamA: buildPendingSourceEntry("apa-qf-1", "Ganador Llave 1"),
              teamB: buildPendingSourceEntry("apa-qf-2", "Ganador Llave 2"),
              teamASourceMatchId: "apa-qf-1",
              teamBSourceMatchId: "apa-qf-2",
            }),
            buildBracketMatchFromEntries({
              id: "apa-semi-2",
              roundTitle: "Semifinales",
              title: "Semi 2",
              teamA: buildPendingSourceEntry("apa-qf-3", "Ganador Llave 3"),
              teamB: buildPendingSourceEntry("apa-qf-4", "Ganador Llave 4"),
              teamASourceMatchId: "apa-qf-3",
              teamBSourceMatchId: "apa-qf-4",
            }),
          ],
        },
        finalRound,
      ],
    };
  }

  if (totalPairs >= 15 && totalPairs <= 17) {
    return {
      mode: "automatic",
      ruleSet: "apa",
      title: "Llave APA",
      summary: "Formato APA: cruces previos y cuartos.",
      recommendation: "Cruces APA segun posiciones de zona.",
      zonesLinked: zonesPreview.map((zone) => zone.name),
      qualifierLabels: buildQualifiedEntriesFromZones(zonesPreview),
      byeCount: 0,
      rounds: [
        {
          id: "round-cruces",
          title: "Cruces",
          matches: [
            buildApaMatch("apa-cruce-1", "Cruces", "Cruce 1", "2B", "2C", entriesBySeed),
            buildApaMatch("apa-cruce-4", "Cruces", "Cruce 4", "2A", "2D", entriesBySeed),
          ],
        },
        {
          id: "round-cuartos",
          title: "Cuartos",
          matches: [
            buildApaSourceMatch("apa-qf-1", "Cuartos", "Llave 1", "apa-cruce-1", "1A", entriesBySeed),
            buildApaMatch("apa-qf-2", "Cuartos", "Llave 2", "1E", "1D", entriesBySeed),
            buildApaMatch("apa-qf-3", "Cuartos", "Llave 3", "1C", "2E", entriesBySeed),
            buildApaSourceMatch("apa-qf-4", "Cuartos", "Llave 4", "apa-cruce-4", "1B", entriesBySeed),
          ],
        },
        {
          id: "round-semis",
          title: "Semifinales",
          matches: [
            buildBracketMatchFromEntries({
              id: "apa-semi-1",
              roundTitle: "Semifinales",
              title: "Semi 1",
              teamA: buildPendingSourceEntry("apa-qf-1", "Ganador Llave 1"),
              teamB: buildPendingSourceEntry("apa-qf-2", "Ganador Llave 2"),
              teamASourceMatchId: "apa-qf-1",
              teamBSourceMatchId: "apa-qf-2",
            }),
            buildBracketMatchFromEntries({
              id: "apa-semi-2",
              roundTitle: "Semifinales",
              title: "Semi 2",
              teamA: buildPendingSourceEntry("apa-qf-3", "Ganador Llave 3"),
              teamB: buildPendingSourceEntry("apa-qf-4", "Ganador Llave 4"),
              teamASourceMatchId: "apa-qf-3",
              teamBSourceMatchId: "apa-qf-4",
            }),
          ],
        },
        finalRound,
      ],
    };
  }

  if (totalPairs >= 18 && totalPairs <= 20) {
    return {
      mode: "automatic",
      ruleSet: "apa",
      title: "Llave APA",
      summary: "Formato APA: cuatro cruces previos y cuartos.",
      recommendation: "Cruces APA segun posiciones de zona.",
      zonesLinked: zonesPreview.map((zone) => zone.name),
      qualifierLabels: buildQualifiedEntriesFromZones(zonesPreview),
      byeCount: 0,
      rounds: [
        {
          id: "round-cruces",
          title: "Cruces",
          matches: [
            buildApaMatch("apa-cruce-1", "Cruces", "Cruce 1", "2F", "2C", entriesBySeed),
            buildApaMatch("apa-cruce-2", "Cruces", "Cruce 2", "1E", "2B", entriesBySeed),
            buildApaMatch("apa-cruce-3", "Cruces", "Cruce 3", "2A", "1F", entriesBySeed),
            buildApaMatch("apa-cruce-4", "Cruces", "Cruce 4", "2E", "2D", entriesBySeed),
          ],
        },
        {
          id: "round-cuartos",
          title: "Cuartos",
          matches: [
            buildApaSourceMatch("apa-qf-1", "Cuartos", "Llave 1", "apa-cruce-1", "1A", entriesBySeed),
            buildApaSourceMatch("apa-qf-2", "Cuartos", "Llave 2", "apa-cruce-2", "1D", entriesBySeed),
            buildApaSourceMatch("apa-qf-3", "Cuartos", "Llave 3", "apa-cruce-3", "1C", entriesBySeed),
            buildApaSourceMatch("apa-qf-4", "Cuartos", "Llave 4", "apa-cruce-4", "1B", entriesBySeed),
          ],
        },
        {
          id: "round-semis",
          title: "Semifinales",
          matches: [
            buildBracketMatchFromEntries({
              id: "apa-semi-1",
              roundTitle: "Semifinales",
              title: "Semi 1",
              teamA: buildPendingSourceEntry("apa-qf-1", "Ganador Llave 1"),
              teamB: buildPendingSourceEntry("apa-qf-2", "Ganador Llave 2"),
              teamASourceMatchId: "apa-qf-1",
              teamBSourceMatchId: "apa-qf-2",
            }),
            buildBracketMatchFromEntries({
              id: "apa-semi-2",
              roundTitle: "Semifinales",
              title: "Semi 2",
              teamA: buildPendingSourceEntry("apa-qf-3", "Ganador Llave 3"),
              teamB: buildPendingSourceEntry("apa-qf-4", "Ganador Llave 4"),
              teamASourceMatchId: "apa-qf-3",
              teamBSourceMatchId: "apa-qf-4",
            }),
          ],
        },
        finalRound,
      ],
    };
  }

  if (totalPairs >= 21 && totalPairs <= 23) {
    return {
      mode: "automatic",
      ruleSet: "apa",
      title: "Llave APA",
      summary: "Formato APA: 6 cruces previos y cuartos.",
      recommendation: "Cruces APA segun posiciones de zona.",
      zonesLinked: zonesPreview.map((zone) => zone.name),
      qualifierLabels: buildQualifiedEntriesFromZones(zonesPreview),
      byeCount: 0,
      rounds: [
        {
          id: "round-cruces",
          title: "Cruces",
          matches: [
            buildApaMatch("apa-cruce-1", "Cruces", "Cruce 1", "2F", "2G", entriesBySeed),
            buildApaMatch("apa-cruce-2", "Cruces", "Cruce 2", "1E", "2C", entriesBySeed),
            buildApaMatch("apa-cruce-3", "Cruces", "Cruce 3", "2B", "1D", entriesBySeed),
            buildApaMatch("apa-cruce-4", "Cruces", "Cruce 4", "1C", "2A", entriesBySeed),
            buildApaMatch("apa-cruce-5", "Cruces", "Cruce 5", "2D", "1F", entriesBySeed),
            buildApaMatch("apa-cruce-6", "Cruces", "Cruce 6", "1G", "2E", entriesBySeed),
          ],
        },
        {
          id: "round-cuartos",
          title: "Cuartos",
          matches: [
            buildApaSeedSourceMatch("apa-qf-1", "Cuartos", "Llave 1", "1A", "apa-cruce-1", entriesBySeed),
            buildApaDoubleSourceMatch("apa-qf-2", "Cuartos", "Llave 2", "apa-cruce-2", "apa-cruce-3"),
            buildApaDoubleSourceMatch("apa-qf-3", "Cuartos", "Llave 3", "apa-cruce-4", "apa-cruce-5"),
            buildApaSourceMatch("apa-qf-4", "Cuartos", "Llave 4", "apa-cruce-6", "1B", entriesBySeed),
          ],
        },
        buildApaSemisFromQuarterIds(),
        finalRound,
      ],
    };
  }

  if (totalPairs >= 24 && totalPairs <= 26) {
    return {
      mode: "automatic",
      ruleSet: "apa",
      title: "Llave APA",
      summary: "Formato APA: 7 cruces previos y cuartos.",
      recommendation: "Cruces APA segun posiciones de zona.",
      zonesLinked: zonesPreview.map((zone) => zone.name),
      qualifierLabels: buildQualifiedEntriesFromZones(zonesPreview),
      byeCount: 0,
      rounds: [
        {
          id: "round-cruces",
          title: "Cruces",
          matches: [
            buildApaMatch("apa-cruce-1", "Cruces", "Cruce 1", "2F", "2G", entriesBySeed),
            buildApaMatch("apa-cruce-2", "Cruces", "Cruce 2", "1E", "2C", entriesBySeed),
            buildApaMatch("apa-cruce-3", "Cruces", "Cruce 3", "2B", "1D", entriesBySeed),
            buildApaMatch("apa-cruce-4", "Cruces", "Cruce 4", "1C", "2A", entriesBySeed),
            buildApaMatch("apa-cruce-5", "Cruces", "Cruce 5", "2D", "1F", entriesBySeed),
            buildApaMatch("apa-cruce-6", "Cruces", "Cruce 6", "1G", "2E", entriesBySeed),
            buildApaMatch("apa-cruce-7", "Cruces", "Cruce 7", "1H", "2H", entriesBySeed),
          ],
        },
        {
          id: "round-cuartos",
          title: "Cuartos",
          matches: [
            buildApaSeedSourceMatch("apa-qf-1", "Cuartos", "Llave 1", "1A", "apa-cruce-1", entriesBySeed),
            buildApaDoubleSourceMatch("apa-qf-2", "Cuartos", "Llave 2", "apa-cruce-2", "apa-cruce-3"),
            buildApaDoubleSourceMatch("apa-qf-3", "Cuartos", "Llave 3", "apa-cruce-4", "apa-cruce-5"),
            buildApaDoubleSourceMatch("apa-qf-4", "Cuartos", "Llave 4", "apa-cruce-6", "apa-cruce-7"),
          ],
        },
        buildApaSemisFromQuarterIds(),
        finalRound,
      ],
    };
  }

  if (totalPairs >= 27 && totalPairs <= 29) {
    return {
      mode: "automatic",
      ruleSet: "apa",
      title: "Llave APA",
      summary: "Formato APA: integracion en octavos respetando orden visual.",
      recommendation: "Cruces APA segun posiciones de zona.",
      zonesLinked: zonesPreview.map((zone) => zone.name),
      qualifierLabels: buildQualifiedEntriesFromZones(zonesPreview),
      byeCount: 0,
      rounds: [
        {
          id: "round-cruces",
          title: "Cruces",
          matches: [
            buildApaMatch("apa-cruce-1", "Cruces", "Cruce 1", "2B", "2C", entriesBySeed),
            buildApaMatch("apa-cruce-8", "Cruces", "Cruce 8", "2D", "2A", entriesBySeed),
          ],
        },
        {
          id: "round-octavos",
          title: "Octavos",
          matches: [
            buildApaSeedSourceMatch("apa-r16-1", "Octavos", "Llave 1", "1A", "apa-cruce-1", entriesBySeed),
            buildApaMatch("apa-r16-2", "Octavos", "Llave 2", "1I", "1H", entriesBySeed),
            buildApaMatch("apa-r16-3", "Octavos", "Llave 3", "1E", "2G", entriesBySeed),
            buildApaMatch("apa-r16-4", "Octavos", "Llave 4", "2F", "1D", entriesBySeed),
            buildApaMatch("apa-r16-5", "Octavos", "Llave 5", "1C", "2E", entriesBySeed),
            buildApaMatch("apa-r16-6", "Octavos", "Llave 6", "2H", "1F", entriesBySeed),
            buildApaMatch("apa-r16-7", "Octavos", "Llave 7", "1G", "2I", entriesBySeed),
            buildApaSourceMatch("apa-r16-8", "Octavos", "Llave 8", "apa-cruce-8", "1B", entriesBySeed),
          ],
        },
        buildApaQuarterRoundFromSourcePairs([
          ["apa-r16-1", "apa-r16-2"],
          ["apa-r16-3", "apa-r16-4"],
          ["apa-r16-5", "apa-r16-6"],
          ["apa-r16-7", "apa-r16-8"],
        ]),
        buildApaSemisFromQuarterIds(),
        finalRound,
      ],
    };
  }

  if (totalPairs >= 30 && totalPairs <= 32) {
    return {
      mode: "automatic",
      ruleSet: "apa",
      title: "Llave APA",
      summary: "Formato APA: integracion en octavos respetando orden visual.",
      recommendation: "Cruces APA segun posiciones de zona.",
      zonesLinked: zonesPreview.map((zone) => zone.name),
      qualifierLabels: buildQualifiedEntriesFromZones(zonesPreview),
      byeCount: 0,
      rounds: [
        {
          id: "round-cruces",
          title: "Cruces",
          matches: [
            buildApaMatch("apa-cruce-1", "Cruces", "Cruce 1", "2C", "2F", entriesBySeed),
            buildApaMatch("apa-cruce-4", "Cruces", "Cruce 4", "2G", "2B", entriesBySeed),
            buildApaMatch("apa-cruce-5", "Cruces", "Cruce 5", "2A", "2H", entriesBySeed),
            buildApaMatch("apa-cruce-8", "Cruces", "Cruce 8", "2E", "2D", entriesBySeed),
          ],
        },
        {
          id: "round-octavos",
          title: "Octavos",
          matches: [
            buildApaSeedSourceMatch("apa-r16-1", "Octavos", "Llave 1", "1A", "apa-cruce-1", entriesBySeed),
            buildApaMatch("apa-r16-2", "Octavos", "Llave 2", "1I", "1H", entriesBySeed),
            buildApaMatch("apa-r16-3", "Octavos", "Llave 3", "1E", "2J", entriesBySeed),
            buildApaSourceMatch("apa-r16-4", "Octavos", "Llave 4", "apa-cruce-4", "1D", entriesBySeed),
            buildApaSeedSourceMatch("apa-r16-5", "Octavos", "Llave 5", "1C", "apa-cruce-5", entriesBySeed),
            buildApaMatch("apa-r16-6", "Octavos", "Llave 6", "2I", "2F", entriesBySeed),
            buildApaMatch("apa-r16-7", "Octavos", "Llave 7", "1G", "1D", entriesBySeed),
            buildApaSourceMatch("apa-r16-8", "Octavos", "Llave 8", "apa-cruce-8", "1B", entriesBySeed),
          ],
        },
        buildApaQuarterRoundFromSourcePairs([
          ["apa-r16-1", "apa-r16-2"],
          ["apa-r16-3", "apa-r16-4"],
          ["apa-r16-5", "apa-r16-6"],
          ["apa-r16-7", "apa-r16-8"],
        ]),
        buildApaSemisFromQuarterIds(),
        finalRound,
      ],
    };
  }

  return null;
}

function buildBracketPreview({
  mode = "automatic",
  manualBracketMode = "automatic",
  recommendation,
  zonesPreview = [],
  ruleSet = "fap",
}) {
  const normalizedRuleSet = String(ruleSet || "fap").trim().toLowerCase();
  const officialZonesPreview = ["apa", "fap"].includes(normalizedRuleSet)
    ? orderZonesForBracketRuleSet(zonesPreview, normalizedRuleSet)
    : zonesPreview;

  if (normalizedRuleSet === "fap") {
    const fapPreview = buildFapBracketPreview({ recommendation, zonesPreview: officialZonesPreview });

    if (fapPreview) {
      return fapPreview;
    }
  }

  if (normalizedRuleSet === "apa") {
    const apaPreview = buildApaBracketPreview({ recommendation, zonesPreview: officialZonesPreview });

    if (apaPreview) {
      return apaPreview;
    }
  }

  const isManualBracket = mode === "semiautomatic" || (mode === "manual" && manualBracketMode === "manual");
  const qualifierEntries = buildQualifiedEntriesFromZones(officialZonesPreview);

  const recommendedBracketSize = Number(recommendation?.bracketSize || 0);
  const bracketSize = Math.max(
    getNextPowerOfTwo(qualifierEntries.length || 2),
    getNextPowerOfTwo(recommendedBracketSize || 2)
  );
  const entries = buildBracketSlots(qualifierEntries, bracketSize);

  const rounds = [];
  let roundSize = bracketSize;
  let currentEntries = entries;
  let roundIndex = 0;

  while (roundSize >= 2 && currentEntries.length >= 2) {
    const roundTitle = buildRoundTitle(roundSize);
    const matches = [];

    for (let index = 0; index < currentEntries.length; index += 2) {
      const teamA = currentEntries[index];
      const teamB = currentEntries[index + 1];
      const autoWinner =
        teamA?.isBye && !teamB?.isBye ? "teamB" : teamB?.isBye && !teamA?.isBye ? "teamA" : "";
      matches.push({
        id: `round-${roundIndex + 1}-match-${index / 2 + 1}`,
        title: `${roundTitle} ${index / 2 + 1}`,
        roundTitle,
        teamAId: teamA?.isBye ? "" : String(teamA?.id || ""),
        teamASeed: teamA?.seedLabel || teamA?.label || "",
        teamAName: teamA?.displayName === "BYE" ? "" : teamA?.displayName || "",
        teamALines: teamA?.displayLines || [],
        teamAIsBye: Boolean(teamA?.isBye),
        teamBId: teamB?.isBye ? "" : String(teamB?.id || ""),
        teamBSeed: teamB?.seedLabel || teamB?.label || "",
        teamBName: teamB?.displayName === "BYE" ? "" : teamB?.displayName || "",
        teamBLines: teamB?.displayLines || [],
        teamBIsBye: Boolean(teamB?.isBye),
        resultLabel: autoWinner ? "Avanza por BYE" : "Resultado pendiente",
        courtLabel: "Cancha pendiente",
        scheduledDayKey: "",
        scheduledTime: "",
        scheduleLabel: "Horario pendiente",
        result: {
          ...buildDefaultBracketResult(),
          winnerSource: autoWinner ? "auto" : "",
          winner: autoWinner,
        },
      });
    }

    rounds.push({
      id: `round-${roundIndex + 1}`,
      title: roundTitle,
      matches,
    });

    currentEntries = matches.map((match, index) => ({
      id: `next-${roundIndex + 1}-${index + 1}`,
      displayName: "",
      displayLines: [],
      label: "",
      sourceMatchId: match.id,
    }));
    roundSize /= 2;
    roundIndex += 1;
  }

  return {
    mode: isManualBracket ? "manual" : "automatic",
    title: recommendation.bracketTitle,
    summary: recommendation.bracketSummary,
    recommendation:
      "Cruce sugerido: los 1ros de zona deben cruzarse con 2dos de otra zona. Si queda un lugar vacio, la app asigna BYE automaticamente.",
    zonesLinked: officialZonesPreview.map((zone) => zone.name),
    qualifierLabels: qualifierEntries,
    byeCount: entries.filter((entry) => entry.isBye).length,
    rounds,
  };
}

function buildBracketBoardLayout(bracketPreview = null) {
  if (!bracketPreview || !Array.isArray(bracketPreview.rounds) || !bracketPreview.rounds.length) {
    return null;
  }

  const positionedRounds = [];
  const positionedMatchesById = new Map();
  const getSlotY = (slotIndex = 0) =>
    BRACKET_HEADER_HEIGHT + Math.max(Number(slotIndex || 0), 0) * (BRACKET_CARD_HEIGHT + BRACKET_FIRST_ROUND_GAP);
  const getSlotCenterY = (slotIndex = 0) => getSlotY(slotIndex) + BRACKET_CARD_HEIGHT / 2;
  const getPairY = (slotPair = []) => {
    if (!Array.isArray(slotPair) || slotPair.length < 2) {
      return null;
    }

    const firstSlot = Number(slotPair[0]);
    const secondSlot = Number(slotPair[1]);

    if (!Number.isFinite(firstSlot) || !Number.isFinite(secondSlot)) {
      return null;
    }

    return (getSlotCenterY(firstSlot) + getSlotCenterY(secondSlot)) / 2 - BRACKET_CARD_HEIGHT / 2;
  };
  const hasBracketTeamContent = (match = {}, side = "A") => {
    const prefix = side === "A" ? "teamA" : "teamB";
    const lines = Array.isArray(match[`${prefix}Lines`]) ? match[`${prefix}Lines`] : [];

    return Boolean(
      match[`${prefix}Id`] ||
        match[`${prefix}Seed`] ||
        match[`${prefix}Name`] ||
        match[`${prefix}IsBye`] ||
        lines.some((line) => String(line || "").trim())
    );
  };

  bracketPreview.rounds.forEach((round, roundIndex) => {
    const roundX = roundIndex * BRACKET_COLUMN_STEP;
    const matches = (round.matches || []).map((match, matchIndex) => {
      const fallbackY =
        BRACKET_HEADER_HEIGHT + matchIndex * (BRACKET_CARD_HEIGHT + BRACKET_FIRST_ROUND_GAP);
      let y = fallbackY;
      const visualSlotPairY = getPairY(match.visualSlotPair);

      if (roundIndex === 0) {
        y = Number.isFinite(Number(match.visualSlotIndex))
          ? getSlotY(Number(match.visualSlotIndex))
          : fallbackY;
      } else {
        const previousMatches = positionedRounds[roundIndex - 1]?.matches || [];
        const explicitSourceA = match.teamASourceMatchId
          ? positionedMatchesById.get(match.teamASourceMatchId)
          : null;
        const explicitSourceB = match.teamBSourceMatchId
          ? positionedMatchesById.get(match.teamBSourceMatchId)
          : null;
        const sourceMatchA =
          explicitSourceA ||
          (!match.teamASourceMatchId && !hasBracketTeamContent(match, "A")
            ? previousMatches[matchIndex * 2]
            : null);
        const sourceMatchB =
          explicitSourceB ||
          (!match.teamBSourceMatchId && !hasBracketTeamContent(match, "B")
            ? previousMatches[matchIndex * 2 + 1]
            : null);

        if (sourceMatchA && sourceMatchB) {
          const sourceCenterA = sourceMatchA.y + BRACKET_CARD_HEIGHT / 2;
          const sourceCenterB = sourceMatchB.y + BRACKET_CARD_HEIGHT / 2;
          y = (sourceCenterA + sourceCenterB) / 2 - BRACKET_CARD_HEIGHT / 2;
        } else if (sourceMatchA && visualSlotPairY !== null) {
          y = visualSlotPairY;
        } else if (sourceMatchA) {
          y = sourceMatchA.y;
        } else if (sourceMatchB && visualSlotPairY !== null) {
          y = visualSlotPairY;
        } else if (sourceMatchB) {
          y = sourceMatchB.y;
        } else if (visualSlotPairY !== null) {
          y = visualSlotPairY;
        } else {
          y = fallbackY;
        }
      }

      return {
        ...match,
        x: roundX,
        y,
      };
    });

    positionedRounds.push({
      ...round,
      x: roundX,
      matches,
    });
    matches.forEach((match) => {
      if (match?.id) {
        positionedMatchesById.set(match.id, match);
      }
    });
  });

  for (let roundIndex = 1; roundIndex < positionedRounds.length; roundIndex += 1) {
    const currentMatches = positionedRounds[roundIndex]?.matches || [];

    currentMatches.forEach((match) => {
      const targetCenterY = match.y + BRACKET_CARD_HEIGHT / 2;
      const sourceMatchA = match.teamASourceMatchId
        ? positionedMatchesById.get(match.teamASourceMatchId)
        : null;
      const sourceMatchB = match.teamBSourceMatchId
        ? positionedMatchesById.get(match.teamBSourceMatchId)
        : null;

      if (sourceMatchA && !sourceMatchB) {
        sourceMatchA.y = targetCenterY - BRACKET_CARD_HEIGHT;
      }

      if (!sourceMatchA && sourceMatchB) {
        sourceMatchB.y = targetCenterY;
      }
    });
  }

  const connectors = [];

  for (let roundIndex = 1; roundIndex < positionedRounds.length; roundIndex += 1) {
    const previousMatches = positionedRounds[roundIndex - 1]?.matches || [];
    const currentMatches = positionedRounds[roundIndex]?.matches || [];

    currentMatches.forEach((match, matchIndex) => {
      const explicitSourceA = match.teamASourceMatchId
        ? positionedMatchesById.get(match.teamASourceMatchId)
        : null;
      const explicitSourceB = match.teamBSourceMatchId
        ? positionedMatchesById.get(match.teamBSourceMatchId)
        : null;
      const sourceMatchA =
        explicitSourceA ||
        (!match.teamASourceMatchId && !hasBracketTeamContent(match, "A")
          ? previousMatches[matchIndex * 2]
          : null);
      const sourceMatchB =
        explicitSourceB ||
        (!match.teamBSourceMatchId && !hasBracketTeamContent(match, "B")
          ? previousMatches[matchIndex * 2 + 1]
          : null);

      const singleSourceMatch = sourceMatchA || sourceMatchB;

      if (!singleSourceMatch) {
        return;
      }

      const startX = singleSourceMatch.x + BRACKET_CARD_WIDTH;
      const endX = match.x;
      const connectorGap = Math.max(endX - startX, 0);
      const midX = startX + connectorGap / 2;
      const currentCenterY = match.y + BRACKET_CARD_HEIGHT / 2;

      if (sourceMatchA && sourceMatchB) {
        const sourceCenterA = sourceMatchA.y + BRACKET_CARD_HEIGHT / 2;
        const sourceCenterB = sourceMatchB.y + BRACKET_CARD_HEIGHT / 2;
        const sourcePairCenterY = (sourceCenterA + sourceCenterB) / 2;
        const topY = Math.min(sourceCenterA, sourceCenterB);
        const verticalHeight = Math.abs(sourceCenterB - sourceCenterA);

        connectors.push(
          {
            id: `${match.id}-left-a`,
            type: "horizontal",
            x: startX,
            y: sourceCenterA,
            width: midX - startX,
          },
          {
            id: `${match.id}-left-b`,
            type: "horizontal",
            x: startX,
            y: sourceCenterB,
            width: midX - startX,
          },
          {
            id: `${match.id}-vertical`,
            type: "vertical",
            x: midX,
            y: topY,
            height: verticalHeight,
          },
          {
            id: `${match.id}-right`,
            type: "horizontal",
            x: midX,
            y: currentCenterY,
            width: endX - midX,
          }
        );

        return;
      }

      const sourceCenterY = singleSourceMatch.y + BRACKET_CARD_HEIGHT / 2;
      const sourceIsUpperBranch = Boolean(sourceMatchA);
      const branchGap = Math.max(
        Math.abs(sourceCenterY - currentCenterY),
        BRACKET_CARD_HEIGHT / 2
      );
      const phantomCenterY = sourceIsUpperBranch
        ? currentCenterY + branchGap
        : currentCenterY - branchGap;
      const topY = Math.min(sourceCenterY, phantomCenterY);
      const verticalHeight = Math.abs(phantomCenterY - sourceCenterY);
      const singleForkX = midX;
      const phantomStartX = Math.max(singleSourceMatch.x, startX - 22);

      connectors.push(
        {
          id: `${match.id}-solo-left`,
          type: "horizontal",
          x: startX,
          y: sourceCenterY,
          width: singleForkX - startX,
        },
        {
          id: `${match.id}-solo-phantom-left`,
          type: "horizontal",
          x: phantomStartX,
          y: phantomCenterY,
          width: singleForkX - phantomStartX,
        },
        {
          id: `${match.id}-solo-vertical`,
          type: "vertical",
          x: singleForkX,
          y: topY,
          height: verticalHeight,
        },
        {
          id: `${match.id}-solo-right`,
          type: "horizontal",
          x: singleForkX,
          y: currentCenterY,
          width: endX - singleForkX,
        }
      );
    });
  }

  const maxBottom = positionedRounds.reduce((accumulator, round) => {
    const roundBottom = (round.matches || []).reduce(
      (maxValue, match) => Math.max(maxValue, match.y + BRACKET_CARD_HEIGHT),
      BRACKET_HEADER_HEIGHT
    );

    return Math.max(accumulator, roundBottom);
  }, BRACKET_HEADER_HEIGHT);

  return {
    rounds: positionedRounds,
    connectors,
    boardWidth: Math.max(
      BRACKET_CARD_WIDTH,
      positionedRounds.reduce(
        (maxValue, round) => Math.max(maxValue, (round.x || 0) + BRACKET_CARD_WIDTH),
        BRACKET_CARD_WIDTH
      )
    ),
    boardHeight: maxBottom + spacing.sm,
  };
}

function SelectionList({
  options,
  selectedValue,
  onSelect,
  showDescription = true,
  disabledValues = [],
}) {
  const selectedOption = options.find((option) => option.value === selectedValue) || null;
  const disabledSet = new Set(disabledValues);

  return (
    <View>
      <View style={styles.selectionList}>
        {options.map((option) => {
          const isActive = option.value === selectedValue;
          const isDisabled = option.disabled || disabledSet.has(option.value);

          return (
            <Pressable
              key={option.value}
              disabled={isDisabled}
              onPress={() => onSelect(option.value)}
              style={[
                styles.selectionRow,
                isActive && styles.selectionRowActive,
                isDisabled ? styles.selectionRowDisabled : null,
              ]}
            >
              <View style={styles.selectionRowIconWrap}>
                {isActive && !isDisabled ? (
                  <Ionicons color={colors.primaryDark} name="checkmark-circle" size={16} />
                ) : (
                  <Ionicons color={isDisabled ? "#C4CCD6" : "#B7C0CB"} name="ellipse-outline" size={16} />
                )}
              </View>
              <Text
                style={[
                  styles.selectionRowText,
                  isActive && styles.selectionRowTextActive,
                  isDisabled ? styles.selectionRowTextDisabled : null,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {showDescription && selectedOption?.description ? (
        <Text style={styles.selectionHelpText}>{selectedOption.description}</Text>
      ) : null}
    </View>
  );
}

export default function TournamentFixtureScreen({ navigation, route }) {
  const { updateProfile, user, userData } = useAuth();
  const { width: windowWidth } = useWindowDimensions();
  const tournamentId = route?.params?.tournamentId || "";
  const isBracketFullscreenStandalone = route?.params?.bracketFullscreenStandalone === true;
  const initialBracketPreview = route?.params?.bracketPreview || null;
  const [tournament, setTournament] = useState(null);
  const [registrations, setRegistrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState("");
  const [zonePlanningSavingKey, setZonePlanningSavingKey] = useState("");
  const [activeSection, setActiveSection] = useState("configuration");
  const [feedback, setFeedback] = useState({
    visible: false,
    title: "",
    message: "",
    tone: "default",
  });
  const [confirmFixtureAction, setConfirmFixtureAction] = useState(null);

  const currentOrganizer = useMemo(
    () => ({
      uid: userData?.uid || user?.uid || "",
      name: userData?.name || user?.displayName || "Organizador",
    }),
    [user?.displayName, user?.uid, userData]
  );
  const currentUserId = currentOrganizer.uid;
  const isOrganizer = useMemo(
    () =>
      normalizeText(tournament?.organizerId) === normalizeText(currentUserId) ||
      normalizeText(tournament?.createdBy) === normalizeText(currentUserId),
    [currentUserId, tournament?.createdBy, tournament?.organizerId]
  );
  const canEditFixture = isOrganizer;

  const fixtureSetup = tournament?.fixtureSetup || {};
  const tournamentRuleSet = String(tournament?.tournamentRuleSet || tournament?.ruleSet || "fap")
    .trim()
    .toLowerCase();
  const playerFixtureLastViewedSections = useMemo(
    () => userData?.tournamentFixtureLastViewedSections || {},
    [userData?.tournamentFixtureLastViewedSections]
  );
  const playerPreferredSection = useMemo(
    () => normalizeFixtureActiveSection(playerFixtureLastViewedSections?.[tournamentId] || ""),
    [playerFixtureLastViewedSections, tournamentId]
  );
  const [selectedMode, setSelectedMode] = useState("automatic");
  const [selectedPathType, setSelectedPathType] = useState("strict");
  const [selectedManualBracketMode, setSelectedManualBracketMode] = useState("automatic");
  const [selectedZoneMatchFormat, setSelectedZoneMatchFormat] = useState("third_set");
  const [selectedBracketMatchFormat, setSelectedBracketMatchFormat] = useState("third_set");
  const [selectedZoneSuperTieBreakPoints, setSelectedZoneSuperTieBreakPoints] = useState("11");
  const [selectedBracketSuperTieBreakPoints, setSelectedBracketSuperTieBreakPoints] = useState("11");
  const [selectedBracketFinalOverride, setSelectedBracketFinalOverride] = useState("none");
  const [selectedRapidMode, setSelectedRapidMode] = useState("off");
  const [selectedRapidModePoints, setSelectedRapidModePoints] = useState("9");
  const [selectedMatchDuration, setSelectedMatchDuration] = useState(
    formatMatchDurationValue(ZONE_MATCH_DURATION_MINUTES)
  );
  const [expandedFormatSection, setExpandedFormatSection] = useState("zones");
  const [expandedVenueScheduleIds, setExpandedVenueScheduleIds] = useState([]);
  const [zoneVenueSchedules, setZoneVenueSchedules] = useState([]);
  const [zoneMatchPickerState, setZoneMatchPickerState] = useState({
    zoneId: "",
    matchId: "",
    field: "",
  });
  const [zoneMatchTimePickerTarget, setZoneMatchTimePickerTarget] = useState(null);
  const [zonePlanningDayPickerTarget, setZonePlanningDayPickerTarget] = useState(null);
  const [zonePlanningTimePickerTarget, setZonePlanningTimePickerTarget] = useState(null);
  const [zonePlanningResultEditor, setZonePlanningResultEditor] = useState(null);
  const [bracketResultEditor, setBracketResultEditor] = useState(null);
  const [bracketProgramEditor, setBracketProgramEditor] = useState(null);
  const [zonePlanningStandingsModalZoneId, setZonePlanningStandingsModalZoneId] = useState("");
  const [zonePlanningDraft, setZonePlanningDraft] = useState(null);
  const [bracketMatchPickerState, setBracketMatchPickerState] = useState({
    roundId: "",
    matchId: "",
    field: "",
  });
  const [bracketMatchTimePickerTarget, setBracketMatchTimePickerTarget] = useState(null);
  const [scheduleVenueTimePickerTarget, setScheduleVenueTimePickerTarget] = useState(null);
  const [scheduleVenueDrafts, setScheduleVenueDrafts] = useState({});
  const [manualZonesDraft, setManualZonesDraft] = useState([]);
  const [zoneDraft, setZoneDraft] = useState([]);
  const [bracketDraft, setBracketDraft] = useState(initialBracketPreview);
  const [zoneShareModalVisible, setZoneShareModalVisible] = useState(false);
  const [zoneShareInProgress, setZoneShareInProgress] = useState(false);
  const [zoneShareIncludeBracket, setZoneShareIncludeBracket] = useState(false);
  const [selectedAvailablePairId, setSelectedAvailablePairId] = useState("");
  const [expandedZoneIds, setExpandedZoneIds] = useState([]);
  const zoneSetInputRefs = useRef({});
  const zoneSaveTimeoutRef = useRef(null);
  const workingZonesPreviewRef = useRef([]);
  const bracketSetInputRefs = useRef({});
  const bracketSaveTimeoutRef = useRef(null);
  const bracketSaveGenerationRef = useRef(0);
  const bracketShareViewRef = useRef(null);
  const zoneShareViewRefs = useRef({});
  const workingBracketPreviewRef = useRef(null);
  const pendingFixtureSetupRef = useRef(fixtureSetup);
  const bracketScale = useRef(new Animated.Value(BRACKET_DEFAULT_OVERVIEW_ZOOM)).current;
  const bracketPanX = useRef(new Animated.Value(0)).current;
  const bracketPanY = useRef(new Animated.Value(0)).current;
  const bracketScaleValueRef = useRef(BRACKET_DEFAULT_OVERVIEW_ZOOM);
  const bracketPanValueRef = useRef({ x: 0, y: 0 });
  const bracketPanStartRef = useRef({ x: 0, y: 0 });
  const bracketPinchStartDistanceRef = useRef(0);
  const bracketPinchStartScaleRef = useRef(BRACKET_DEFAULT_OVERVIEW_ZOOM);
  const bracketIsPinchingRef = useRef(false);
  const bracketLastTapRef = useRef(0);
  const [bracketZoomScale, setBracketZoomScale] = useState(BRACKET_DEFAULT_OVERVIEW_ZOOM);
  const [isBracketPinching, setIsBracketPinching] = useState(false);
  const [bracketFullscreenVisible, setBracketFullscreenVisible] = useState(false);
  const [bracketOpening, setBracketOpening] = useState(false);
  const [bracketSwapMode, setBracketSwapMode] = useState(false);
  const [bracketActionsMenuVisible, setBracketActionsMenuVisible] = useState(false);
  const [bracketSwapSelection, setBracketSwapSelection] = useState(null);
  const bracketFullscreenVisibleRef = useRef(false);
  const bracketIsFullscreenModeRef = useRef(Boolean(isBracketFullscreenStandalone));
  const bracketStandaloneLaunchHandledRef = useRef(false);

  useEffect(() => {
    bracketFullscreenVisibleRef.current = bracketFullscreenVisible;
    bracketIsFullscreenModeRef.current = Boolean(bracketFullscreenVisible || isBracketFullscreenStandalone);
  }, [bracketFullscreenVisible, isBracketFullscreenStandalone]);

  useEffect(() => {
    pendingFixtureSetupRef.current = fixtureSetup;
  }, [fixtureSetup]);

  const animateBracketZoom = useCallback(
    (nextScale) => {
      const minZoom = bracketIsFullscreenModeRef.current
        ? BRACKET_FULLSCREEN_MIN_ZOOM
        : BRACKET_MIN_ZOOM;
      const normalizedScale = clamp(nextScale, minZoom, BRACKET_MAX_ZOOM);

      bracketScaleValueRef.current = normalizedScale;
      setBracketZoomScale(normalizedScale);

      Animated.spring(bracketScale, {
        toValue: normalizedScale,
        useNativeDriver: true,
      }).start();
    },
    [bracketScale]
  );

  const resetBracketZoom = useCallback(() => {
    bracketPanValueRef.current = { x: 0, y: 0 };
    bracketPanStartRef.current = { x: 0, y: 0 };
    Animated.parallel([
      Animated.spring(bracketPanX, {
        toValue: 0,
        useNativeDriver: true,
      }),
      Animated.spring(bracketPanY, {
        toValue: 0,
        useNativeDriver: true,
      }),
    ]).start();
    animateBracketZoom(BRACKET_DEFAULT_OVERVIEW_ZOOM);
  }, [animateBracketZoom, bracketPanX, bracketPanY]);

  const openBracketFullscreen = useCallback(() => {
    const previewForFullscreen = workingBracketPreviewRef.current || currentBracketPreview || null;

    resetBracketZoom();
    setBracketMatchPickerState({ roundId: "", matchId: "", field: "" });
    setBracketMatchTimePickerTarget(null);
    bracketStandaloneLaunchHandledRef.current = true;
    navigation.navigate("TournamentBracketFullscreen", {
      bracketPreview: previewForFullscreen,
      tournamentId,
    });
  }, [currentBracketPreview, navigation, resetBracketZoom, tournamentId]);

  const handleBracketTouchStart = useCallback(
    (event) => {
      const touches = event?.nativeEvent?.touches || [];

      if (touches.length !== 1 || bracketIsPinchingRef.current) {
        return;
      }

      const now = Date.now();

      if (
        bracketIsFullscreenModeRef.current &&
        now - bracketLastTapRef.current < BRACKET_DOUBLE_TAP_DELAY
      ) {
        resetBracketZoom();
      }

      bracketLastTapRef.current = now;
    },
    [resetBracketZoom]
  );

  const handleBracketResponderGrant = useCallback((event) => {
    const touches = event?.nativeEvent?.touches || [];

    if (touches.length >= 2) {
      bracketIsPinchingRef.current = true;
      setIsBracketPinching(true);
      bracketPinchStartDistanceRef.current = getDistanceBetweenTouches(touches);
      bracketPinchStartScaleRef.current = bracketScaleValueRef.current;
      return;
    }

    bracketPanStartRef.current = bracketPanValueRef.current;
  }, []);

  const handleBracketTouchMove = useCallback(
    (event) => {
      const touches = event?.nativeEvent?.touches || [];

      if (touches.length < 2 || !bracketIsPinchingRef.current) {
        return;
      }

      const nextDistance = getDistanceBetweenTouches(touches);

      if (!bracketPinchStartDistanceRef.current || !nextDistance) {
        return;
      }

      const nextScale =
        bracketPinchStartScaleRef.current *
        (nextDistance / bracketPinchStartDistanceRef.current);
      const minZoom = bracketIsFullscreenModeRef.current
        ? BRACKET_FULLSCREEN_MIN_ZOOM
        : BRACKET_MIN_ZOOM;
      const clampedScale = clamp(nextScale, minZoom, BRACKET_MAX_ZOOM);

      bracketScaleValueRef.current = clampedScale;
      setBracketZoomScale(clampedScale);
      bracketScale.setValue(clampedScale);
    },
    [bracketScale]
  );

  const handleBracketPanMove = useCallback(
    (_, gestureState) => {
      if (bracketIsPinchingRef.current) {
        return;
      }

      const nextX = bracketPanStartRef.current.x + gestureState.dx;
      const nextY = bracketPanStartRef.current.y + gestureState.dy;

      bracketPanValueRef.current = { x: nextX, y: nextY };
      bracketPanX.setValue(nextX);
      bracketPanY.setValue(nextY);
    },
    [bracketPanX, bracketPanY]
  );

  const handleBracketTouchEnd = useCallback(() => {
    if (!bracketIsPinchingRef.current) {
      return;
    }

    bracketIsPinchingRef.current = false;
    setIsBracketPinching(false);
    bracketPinchStartDistanceRef.current = 0;
    bracketPinchStartScaleRef.current = bracketScaleValueRef.current;

    animateBracketZoom(bracketScaleValueRef.current);
  }, [animateBracketZoom]);

  const bracketPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (event) =>
          (event?.nativeEvent?.touches || []).length >= 2,
        onStartShouldSetPanResponderCapture: (event) =>
          (event?.nativeEvent?.touches || []).length >= 2,
        onMoveShouldSetPanResponder: (event, gestureState) =>
          (event?.nativeEvent?.touches || []).length >= 2 ||
          (bracketScaleValueRef.current > 1.02 &&
            (Math.abs(gestureState.dx) > 6 || Math.abs(gestureState.dy) > 6)),
        onMoveShouldSetPanResponderCapture: (event, gestureState) =>
          (event?.nativeEvent?.touches || []).length >= 2 ||
          (bracketScaleValueRef.current > 1.02 &&
            (Math.abs(gestureState.dx) > 6 || Math.abs(gestureState.dy) > 6)),
        onPanResponderGrant: handleBracketResponderGrant,
        onPanResponderMove: (event, gestureState) => {
          const touches = event?.nativeEvent?.touches || [];

          if (touches.length >= 2) {
            if (!bracketIsPinchingRef.current) {
              bracketIsPinchingRef.current = true;
              setIsBracketPinching(true);
              bracketPinchStartDistanceRef.current = getDistanceBetweenTouches(touches);
              bracketPinchStartScaleRef.current = bracketScaleValueRef.current;
            }
            handleBracketTouchMove(event);
            return;
          }

          handleBracketPanMove(event, gestureState);
        },
        onPanResponderRelease: handleBracketTouchEnd,
        onPanResponderTerminate: handleBracketTouchEnd,
        onPanResponderTerminationRequest: () => bracketScaleValueRef.current <= 1.02,
      }),
    [handleBracketPanMove, handleBracketResponderGrant, handleBracketTouchEnd, handleBracketTouchMove]
  );

  const bracketFullscreenPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (event) =>
          (event?.nativeEvent?.touches || []).length >= 2,
        onStartShouldSetPanResponderCapture: (event) =>
          (event?.nativeEvent?.touches || []).length >= 2,
        onMoveShouldSetPanResponder: (event, gestureState) =>
          (event?.nativeEvent?.touches || []).length >= 2 ||
          Math.abs(gestureState.dx) > 8 ||
          Math.abs(gestureState.dy) > 8,
        onMoveShouldSetPanResponderCapture: (event, gestureState) =>
          (event?.nativeEvent?.touches || []).length >= 2 ||
          Math.abs(gestureState.dx) > 8 ||
          Math.abs(gestureState.dy) > 8,
        onPanResponderGrant: handleBracketResponderGrant,
        onPanResponderMove: (event, gestureState) => {
          const touches = event?.nativeEvent?.touches || [];

          if (touches.length >= 2) {
            if (!bracketIsPinchingRef.current) {
              bracketIsPinchingRef.current = true;
              setIsBracketPinching(true);
              bracketPinchStartDistanceRef.current = getDistanceBetweenTouches(touches);
              bracketPinchStartScaleRef.current = bracketScaleValueRef.current;
            }
            handleBracketTouchMove(event);
            return;
          }

          handleBracketPanMove(event, gestureState);
        },
        onPanResponderRelease: handleBracketTouchEnd,
        onPanResponderTerminate: handleBracketTouchEnd,
        onPanResponderTerminationRequest: () => false,
      }),
    [handleBracketPanMove, handleBracketResponderGrant, handleBracketTouchEnd, handleBracketTouchMove]
  );

  const bracketInlinePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (event) =>
          (event?.nativeEvent?.touches || []).length >= 2,
        onStartShouldSetPanResponderCapture: (event) =>
          (event?.nativeEvent?.touches || []).length >= 2,
        onMoveShouldSetPanResponder: (event, gestureState) =>
          (event?.nativeEvent?.touches || []).length >= 2 ||
          Math.abs(gestureState.dx) > 8 ||
          Math.abs(gestureState.dy) > 8,
        onMoveShouldSetPanResponderCapture: (event, gestureState) =>
          (event?.nativeEvent?.touches || []).length >= 2 ||
          Math.abs(gestureState.dx) > 8 ||
          Math.abs(gestureState.dy) > 8,
        onPanResponderGrant: handleBracketResponderGrant,
        onPanResponderMove: (event, gestureState) => {
          const touches = event?.nativeEvent?.touches || [];

          if (touches.length >= 2) {
            if (!bracketIsPinchingRef.current) {
              bracketIsPinchingRef.current = true;
              setIsBracketPinching(true);
              bracketPinchStartDistanceRef.current = getDistanceBetweenTouches(touches);
              bracketPinchStartScaleRef.current = bracketScaleValueRef.current;
            }
            handleBracketTouchMove(event);
            return;
          }

          handleBracketPanMove(event, gestureState);
        },
        onPanResponderRelease: handleBracketTouchEnd,
        onPanResponderTerminate: handleBracketTouchEnd,
        onPanResponderTerminationRequest: () => false,
      }),
    [handleBracketPanMove, handleBracketResponderGrant, handleBracketTouchEnd, handleBracketTouchMove]
  );


  const loadScreen = useCallback(async () => {
    const [tournamentResponse, registrationsResponse] = await Promise.all([
      getTournamentById(tournamentId),
      listTournamentRegistrations(tournamentId),
    ]);

    setTournament(tournamentResponse);
    setRegistrations(registrationsResponse);
  }, [tournamentId]);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      const sync = async () => {
        try {
          setLoading(true);
          await loadScreen();
        } catch (error) {
          if (!isMounted) {
            return;
          }

          setFeedback({
            visible: true,
            title: "No pudimos cargar el fixture",
            message: error?.message || "Intenta nuevamente en unos instantes.",
            tone: "danger",
          });
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

  useEffect(() => {
    const nextMode = "automatic";
    const nextPathType = "strict";
    const nextManualBracketMode = "automatic";
    const nextMatchFormat = normalizeMatchFormatConfig(fixtureSetup.matchFormat);

    setSelectedMode((current) => (current === nextMode ? current : nextMode));
    setSelectedPathType((current) => (current === nextPathType ? current : nextPathType));
    setSelectedManualBracketMode((current) =>
      current === nextManualBracketMode ? current : nextManualBracketMode
    );
    setSelectedZoneMatchFormat((current) =>
      current === nextMatchFormat.zones ? current : nextMatchFormat.zones
    );
    setSelectedBracketMatchFormat((current) =>
      current === nextMatchFormat.bracket ? current : nextMatchFormat.bracket
    );
    setSelectedZoneSuperTieBreakPoints((current) =>
      current === String(nextMatchFormat.zonesSuperTieBreakPoints)
        ? current
        : String(nextMatchFormat.zonesSuperTieBreakPoints)
    );
    setSelectedBracketSuperTieBreakPoints((current) =>
      current === String(nextMatchFormat.bracketSuperTieBreakPoints)
        ? current
        : String(nextMatchFormat.bracketSuperTieBreakPoints)
    );
    setSelectedBracketFinalOverride((current) =>
      current === nextMatchFormat.bracketFinalStagesOverride
        ? current
        : nextMatchFormat.bracketFinalStagesOverride
    );
    setSelectedRapidMode((current) => {
      const nextRapidMode =
        nextMatchFormat.zones === "single_set" && nextMatchFormat.bracket === "single_set"
          ? "single_set"
          : "off";
      return current === nextRapidMode ? current : nextRapidMode;
    });
    setSelectedRapidModePoints((current) => {
      const nextPoints = String(
        nextMatchFormat.zones === "single_set"
          ? nextMatchFormat.zonesSuperTieBreakPoints
          : getDefaultPointsForMatchFormat("single_set")
      );
      return current === nextPoints ? current : nextPoints;
    });
    setSelectedMatchDuration((current) => {
      const nextDuration = formatMatchDurationValue(
        Number(fixtureSetup.matchDurationMinutes || ZONE_MATCH_DURATION_MINUTES)
      );
      return current === nextDuration ? current : nextDuration;
    });
  }, [
    fixtureSetup.matchFormat,
    fixtureSetup.matchDurationMinutes,
  ]);

  useEffect(() => {
    const nextZonesDraft = Array.isArray(fixtureSetup.zonesPreview)
      ? decorateZonesWithMatches(
          fixtureSetup.zonesPreview,
          normalizeMatchFormatConfig(fixtureSetup.matchFormat).zones
        )
      : [];

    setManualZonesDraft((current) => (areJsonEqual(current, nextZonesDraft) ? current : nextZonesDraft));
    setZoneDraft((current) => (areJsonEqual(current, nextZonesDraft) ? current : nextZonesDraft));
    workingZonesPreviewRef.current = nextZonesDraft;
  }, [fixtureSetup.matchFormat, fixtureSetup.zonesPreview]);

  useEffect(() => {
    const nextMatchFormat = normalizeMatchFormatConfig(fixtureSetup.matchFormat);
    const nextBracketDraft = normalizeBracketPreview(fixtureSetup?.bracketPreview, (round) =>
        resolveBracketRoundMatchFormat(nextMatchFormat, round?.title || round?.roundTitle || "")
      );

    if (!nextBracketDraft) {
      workingBracketPreviewRef.current =
        workingBracketPreviewRef.current || initialBracketPreview || null;
      return;
    }

    setBracketDraft((current) => (areJsonEqual(current, nextBracketDraft) ? current : nextBracketDraft));
    workingBracketPreviewRef.current = nextBracketDraft || workingBracketPreviewRef.current;
  }, [fixtureSetup.bracketPreview, fixtureSetup.matchFormat, initialBracketPreview]);

  useEffect(() => {
    const nextZoneVenueSchedules = normalizeZoneVenueSchedules(
      fixtureSetup.zoneVenueSchedules,
      tournamentDayOptions,
      tournamentVenueOptions
    );

    setZoneVenueSchedules((current) =>
      areJsonEqual(current, nextZoneVenueSchedules) ? current : nextZoneVenueSchedules
    );
  }, [fixtureSetup.zoneVenueSchedules, tournamentDayOptions, tournamentVenueOptions]);

  useEffect(() => {
    const defaultDayKey = tournamentDayOptions[0]?.key || "";

    setScheduleVenueDrafts((current) => {
      const nextDrafts = {};

      tournamentVenueOptions.forEach((venue) => {
        const venueId = venue.id;
        const currentDraft = current?.[venueId] || {};
        const venueSchedules = (zoneVenueSchedules || []).filter((entry) => entry.venueId === venueId);
        const lastVenueSchedule = venueSchedules[venueSchedules.length - 1] || null;
        const venueCourtCount = Math.max(Number(venue.totalCanchas || 0) || 0, 1);
        nextDrafts[venueId] = {
          selectedDayKey:
            currentDraft.selectedDayKey || lastVenueSchedule?.dayKey || defaultDayKey,
          from: currentDraft.from || lastVenueSchedule?.from || "08:00",
          to: currentDraft.to || lastVenueSchedule?.to || "23:30",
          courts:
            String(
              Math.max(
                1,
                Math.min(
                  Number.parseInt(
                    String(currentDraft.courts || lastVenueSchedule?.courts || venueCourtCount),
                    10
                  ) || venueCourtCount,
                  venueCourtCount
                )
              )
            ) || String(venueCourtCount),
          useForZones:
            venueSchedules.length
              ? venueSchedules.some((entry) => entry.useForZones)
              : typeof currentDraft.useForZones === "boolean"
              ? currentDraft.useForZones
              : false,
          useForBracket:
            venueSchedules.length
              ? venueSchedules.some((entry) => entry.useForBracket)
              : typeof currentDraft.useForBracket === "boolean"
              ? currentDraft.useForBracket
              : false,
        };
      });

      return areJsonEqual(current, nextDrafts) ? current : nextDrafts;
    });
  }, [tournamentDayOptions, tournamentVenueOptions, zoneVenueSchedules]);

  useEffect(() => {
    const zoneIds = (Array.isArray(zonesPreview) ? zonesPreview : []).map((zone) => zone.id);
    setExpandedZoneIds((current) => {
      const nextExpandedZoneIds = current.filter((zoneId) => zoneIds.includes(zoneId)).length
        ? current.filter((zoneId) => zoneIds.includes(zoneId))
        : zoneIds.slice(0, 1);

      return areJsonEqual(current, nextExpandedZoneIds) ? current : nextExpandedZoneIds;
    });
  }, [fixtureSetup.zonesPreview]);

  useEffect(() => {
    return () => {
      if (zoneSaveTimeoutRef.current) {
        clearTimeout(zoneSaveTimeoutRef.current);
      }
      if (bracketSaveTimeoutRef.current) {
        clearTimeout(bracketSaveTimeoutRef.current);
      }
    };
  }, []);

  const confirmedRegistrations = useMemo(
    () => registrations.filter((registration) => isRegistrationConfirmed(registration, tournament)),
    [registrations, tournament]
  );
  const confirmedPairCount = confirmedRegistrations.length;
  const currentMatchFormat = useMemo(
    () => {
      const isRapidMode = selectedRapidMode === "single_set";
      const rapidPoints = Number(selectedRapidModePoints || 9);

      return normalizeMatchFormatConfig({
        zones: isRapidMode ? "single_set" : selectedZoneMatchFormat,
        bracket: isRapidMode ? "single_set" : selectedBracketMatchFormat,
        zonesSuperTieBreakPoints: isRapidMode
          ? rapidPoints
          : Number(selectedZoneSuperTieBreakPoints || 11),
        bracketSuperTieBreakPoints: isRapidMode
          ? rapidPoints
          : Number(selectedBracketSuperTieBreakPoints || 11),
        bracketFinalStagesOverride: isRapidMode ? "none" : selectedBracketFinalOverride,
      });
    },
    [
      selectedRapidMode,
      selectedRapidModePoints,
      selectedBracketFinalOverride,
      selectedBracketMatchFormat,
      selectedBracketSuperTieBreakPoints,
      selectedZoneMatchFormat,
      selectedZoneSuperTieBreakPoints,
    ]
  );
  const currentZoneMatchDurationMinutes = useMemo(
    () => parseMatchDurationToMinutes(selectedMatchDuration),
    [selectedMatchDuration]
  );
  const tournamentDayOptions = useMemo(() => buildTournamentDayOptions(tournament || {}), [tournament]);
  const visibleSectionKeys = useMemo(
    () => (canEditFixture ? FIXTURE_SECTION_KEYS : ["newzones", "bracket"]),
    [canEditFixture]
  );
  const tournamentVenueOptions = useMemo(() => {
    const organizerComplexes = Array.isArray(userData?.complejos) ? userData.complejos : [];

    return [
      ...(Array.isArray(tournament?.venues) ? tournament.venues : []),
      ...(Array.isArray(tournament?.temporaryVenues) ? tournament.temporaryVenues : []),
    ]
      .map((venue, index) => {
        const venueId = String(venue?.id || venue?.complexId || `venue-${index + 1}`);
        const venueName = String(venue?.name || venue?.nombre || `Sede ${index + 1}`);
        const linkedComplex = organizerComplexes.find(
          (complex) =>
            String(complex?.id || "").trim() === String(venue?.complexId || venue?.id || "").trim() ||
            String(complex?.nombre || "").trim().toLowerCase() === venueName.trim().toLowerCase()
        );

        return {
          id: venueId,
          label: venueName,
          name: venueName,
          canchas:
            Array.isArray(venue?.canchas) && venue.canchas.length
              ? venue.canchas
              : Array.isArray(linkedComplex?.canchas)
              ? linkedComplex.canchas
              : [],
          courts:
            Array.isArray(venue?.courts) && venue.courts.length
              ? venue.courts
              : Array.isArray(linkedComplex?.courts)
              ? linkedComplex.courts
              : [],
          totalCanchas:
            Number(venue?.totalCanchas || 0) ||
            Number(linkedComplex?.totalCanchas || 0) ||
            1,
        };
      })
      .filter((venue) => venue.id && venue.name);
  }, [tournament?.temporaryVenues, tournament?.venues, userData?.complejos]);
  const activeZoneMatchPicker = useMemo(() => {
    if (!zoneMatchPickerState.zoneId || !zoneMatchPickerState.matchId || !zoneMatchPickerState.field) {
      return null;
    }

    const zone = (zonesPreview || []).find((entry) => entry.id === zoneMatchPickerState.zoneId);
    const match = (zone?.matches || []).find((entry) => entry.id === zoneMatchPickerState.matchId);

    if (!zone || !match) {
      return null;
    }

    const isDayPicker = zoneMatchPickerState.field === "scheduledDayKey";

    return {
      zoneId: zone.id,
      matchId: match.id,
      field: zoneMatchPickerState.field,
      title: "Seleccionar dia",
      value: String(match.scheduledDayKey || ""),
      options: tournamentDayOptions.map((day) => ({ label: day.label, value: day.key })),
    };
  }, [zoneMatchPickerState, zonesPreview, tournamentDayOptions]);
  const configurationHasUnsavedChanges = useMemo(() => {
    const savedMatchFormat = normalizeMatchFormatConfig(fixtureSetup.matchFormat);
    const savedRapidMode =
      savedMatchFormat.zones === "single_set" && savedMatchFormat.bracket === "single_set"
        ? "single_set"
        : "off";
    const savedRapidPoints = String(
      savedMatchFormat.zones === "single_set"
        ? savedMatchFormat.zonesSuperTieBreakPoints
        : getDefaultPointsForMatchFormat("single_set")
    );
    const savedMatchDuration = formatMatchDurationValue(
      Number(fixtureSetup.matchDurationMinutes || ZONE_MATCH_DURATION_MINUTES)
    );

    return (
      selectedRapidMode !== savedRapidMode ||
      selectedRapidModePoints !== savedRapidPoints ||
      selectedZoneMatchFormat !== savedMatchFormat.zones ||
      selectedBracketMatchFormat !== savedMatchFormat.bracket ||
      selectedZoneSuperTieBreakPoints !== String(savedMatchFormat.zonesSuperTieBreakPoints) ||
      selectedBracketSuperTieBreakPoints !== String(savedMatchFormat.bracketSuperTieBreakPoints) ||
      selectedBracketFinalOverride !== savedMatchFormat.bracketFinalStagesOverride ||
      selectedMatchDuration !== savedMatchDuration
    );
  }, [
    fixtureSetup.matchDurationMinutes,
    fixtureSetup.matchFormat,
    selectedBracketFinalOverride,
    selectedBracketMatchFormat,
    selectedBracketSuperTieBreakPoints,
    selectedMatchDuration,
    selectedRapidMode,
    selectedRapidModePoints,
    selectedZoneMatchFormat,
    selectedZoneSuperTieBreakPoints,
  ]);

  useEffect(() => {
    const preferredSection = canEditFixture
      ? normalizeFixtureActiveSection(fixtureSetup.lastViewedSection)
      : playerPreferredSection;
    setActiveSection(
      visibleSectionKeys.includes(preferredSection) ? preferredSection : visibleSectionKeys[0]
    );
  }, [
    canEditFixture,
    fixtureSetup.lastViewedSection,
    playerPreferredSection,
    tournament?.id,
    visibleSectionKeys,
  ]);

  useEffect(() => {
    if (!visibleSectionKeys.includes(activeSection)) {
      setActiveSection(visibleSectionKeys[0]);
    }
  }, [activeSection, visibleSectionKeys]);

  useEffect(() => {
    if (activeSection === "bracket" && !bracketFullscreenVisible) {
      resetBracketZoom();
    }
  }, [activeSection, bracketFullscreenVisible, resetBracketZoom]);

  const resolveCurrentBracketRoundFormat = useCallback(
    (round = {}) =>
      resolveBracketRoundMatchFormat(
        currentMatchFormat,
        round?.title || round?.roundTitle || ""
      ),
    [currentMatchFormat]
  );
  const handleSelectZoneMatchFormat = useCallback((nextFormat) => {
    setSelectedZoneMatchFormat(nextFormat);
    if (shouldShowPointsInputForMatchFormat(nextFormat)) {
      setSelectedZoneSuperTieBreakPoints((current) => {
        const trimmed = String(current || "").trim();
        if (!trimmed) {
          return String(getDefaultPointsForMatchFormat(nextFormat));
        }
        if (
          (nextFormat === "single_set" && trimmed === "11") ||
          (nextFormat === "super_tiebreak" && trimmed === "9")
        ) {
          return String(getDefaultPointsForMatchFormat(nextFormat));
        }
        return trimmed;
      });
    }
  }, []);
  const handleSelectBracketMatchFormat = useCallback((nextFormat) => {
    setSelectedBracketMatchFormat(nextFormat);
    if (nextFormat !== "super_tiebreak") {
      setSelectedBracketFinalOverride("none");
    }
    if (shouldShowPointsInputForMatchFormat(nextFormat)) {
      setSelectedBracketSuperTieBreakPoints((current) => {
        const trimmed = String(current || "").trim();
        if (!trimmed) {
          return String(getDefaultPointsForMatchFormat(nextFormat));
        }
        if (
          (nextFormat === "single_set" && trimmed === "11") ||
          (nextFormat === "super_tiebreak" && trimmed === "9")
        ) {
          return String(getDefaultPointsForMatchFormat(nextFormat));
        }
        return trimmed;
      });
    }
  }, []);
  const handleSelectRapidMode = useCallback((nextMode) => {
    setSelectedRapidMode(nextMode);
    if (nextMode === "single_set") {
      setSelectedRapidModePoints((current) => String(current || "9"));
      setSelectedBracketFinalOverride("none");
    }
  }, []);
  const updateScheduleVenueDraft = useCallback((venueId, partialDraft) => {
    setScheduleVenueDrafts((current) => ({
      ...current,
      [venueId]: {
        ...(current?.[venueId] || {}),
        ...partialDraft,
      },
    }));
  }, []);
  const toggleScheduleVenueUsage = useCallback((venueId, field) => {
    updateScheduleVenueDraft(venueId, {
      [field]: !Boolean(scheduleVenueDrafts?.[venueId]?.[field]),
    });
  }, [scheduleVenueDrafts, updateScheduleVenueDraft]);
  const toggleVenueScheduleExpanded = useCallback((venueId) => {
    setExpandedVenueScheduleIds((current) =>
      current.includes(venueId)
        ? current.filter((item) => item !== venueId)
        : [...current, venueId]
    );
  }, []);
  const selectScheduleVenueDay = useCallback((venueId, dayKey) => {
    updateScheduleVenueDraft(venueId, { selectedDayKey: dayKey });
  }, [updateScheduleVenueDraft]);
  const handleScheduleVenueTimePickerChange = useCallback(
    (_, selectedDate) => {
      if (scheduleVenueTimePickerTarget?.venueId && scheduleVenueTimePickerTarget?.field && selectedDate) {
        const nextHours = formatTwoDigits(selectedDate.getHours());
        const nextMinutes = formatTwoDigits(selectedDate.getMinutes());
        updateScheduleVenueDraft(scheduleVenueTimePickerTarget.venueId, {
          [scheduleVenueTimePickerTarget.field]: `${nextHours}:${nextMinutes}`,
        });
      }

      if (Platform.OS !== "ios") {
        setScheduleVenueTimePickerTarget(null);
      }
    },
    [scheduleVenueTimePickerTarget, updateScheduleVenueDraft]
  );
  const recommendation = useMemo(
    () => resolveFixtureRecommendation(confirmedPairCount, selectedPathType, tournamentRuleSet),
    [confirmedPairCount, selectedPathType, tournamentRuleSet]
  );
  const zonesPreview = useMemo(
    () =>
      selectedMode === "manual" && manualZonesDraft.length
        ? manualZonesDraft
        : zoneDraft.length
        ? zoneDraft
        : Array.isArray(fixtureSetup.zonesPreview)
        ? decorateZonesWithMatches(fixtureSetup.zonesPreview, currentMatchFormat.zones)
        : [],
    [currentMatchFormat.zones, fixtureSetup.zonesPreview, manualZonesDraft, selectedMode, zoneDraft]
  );
  const availablePairs = useMemo(
    () => extractAvailablePairs(confirmedRegistrations, zonesPreview),
    [confirmedRegistrations, zonesPreview]
  );
  const currentBracketPreview = useMemo(
    () =>
      normalizeBracketPreview(
        bracketDraft || fixtureSetup?.bracketPreview,
        resolveCurrentBracketRoundFormat
      ),
    [bracketDraft, fixtureSetup?.bracketPreview, resolveCurrentBracketRoundFormat]
  );
  const hasCreatedZones = Array.isArray(zonesPreview) && zonesPreview.length > 0;
  const hasCreatedBracket =
    Boolean(currentBracketPreview) &&
    Array.isArray(currentBracketPreview?.rounds) &&
    currentBracketPreview.rounds.length > 0;
  const bracketBoard = useMemo(
    () => buildBracketBoardLayout(currentBracketPreview),
    [currentBracketPreview]
  );
  const bracketInlineScale = useMemo(() => {
    if (!bracketBoard?.boardWidth || !windowWidth) {
      return 1;
    }

    const availableWidth = Math.max(windowWidth - (spacing.lg * 2) - (spacing.sm * 2) - 12, 220);
    return Math.min(1, Math.max(0.82, availableWidth / bracketBoard.boardWidth));
  }, [bracketBoard, windowWidth]);
  const bracketInlineRenderScale = useMemo(
    () => Math.max(0.72, bracketInlineScale * 0.9),
    [bracketInlineScale]
  );
  const registrationsById = useMemo(
    () => new Map(confirmedRegistrations.map((registration) => [registration.id, registration])),
    [confirmedRegistrations]
  );
  const committedZonePlanning = useMemo(
    () => fixtureSetup?.zonePlanning || tournament?.zonePlanning || {},
    [fixtureSetup?.zonePlanning, tournament?.zonePlanning]
  );
  const activeZonePlanning = useMemo(
    () => zonePlanningDraft || committedZonePlanning,
    [committedZonePlanning, zonePlanningDraft]
  );
  const activeZonePlanningSignature = useMemo(
    () => buildZonePlanningSignature(activeZonePlanning),
    [activeZonePlanning]
  );
  const bracketZonePlanningSignature = useMemo(
    () =>
      String(
        bracketDraft?.zonePlanningSignature ||
          fixtureSetup?.bracketPreview?.zonePlanningSignature ||
          ""
      ),
    [bracketDraft?.zonePlanningSignature, fixtureSetup?.bracketPreview?.zonePlanningSignature]
  );
  const bracketNeedsZoneRefresh = useMemo(
    () =>
      Boolean(bracketBoard) &&
      Boolean(bracketZonePlanningSignature) &&
      bracketZonePlanningSignature !== activeZonePlanningSignature,
    [activeZonePlanningSignature, bracketBoard, bracketZonePlanningSignature]
  );
  const hasZonePlanningUnsavedChanges = useMemo(
    () => Boolean(zonePlanningDraft) && !areJsonEqual(zonePlanningDraft, committedZonePlanning),
    [committedZonePlanning, zonePlanningDraft]
  );
  const newZonePlanningZones = useMemo(() => {
    const planningSource = activeZonePlanning || {};
    const planningZones = Array.isArray(planningSource?.zones) ? planningSource.zones : [];
    const dayOrderByKey = new Map(tournamentDayOptions.map((day, index) => [day.key, index]));
    const bracketLettersByZoneId = new Map(
      orderZonesForBracketRuleSet(
        planningZones.map((zone, zoneIndex) => {
          const registrationIds = Array.isArray(zone.registrationIds) ? zone.registrationIds : [];

          return {
            id: zone.id || `zone-${zoneIndex + 1}`,
            name: zone.label || `Zona ${String.fromCharCode(65 + zoneIndex)}`,
            pairs: registrationIds.map((registrationId) => ({ id: registrationId })),
            size: registrationIds.length,
          };
        }),
        tournamentRuleSet
      ).map((zone, index) => [String(zone.id || ""), String.fromCharCode(65 + index)])
    );

    return planningZones.map((zone, zoneIndex) => {
      const zoneId = zone.id || `zone-${zoneIndex + 1}`;
      const bracketLetter = bracketLettersByZoneId.get(String(zoneId)) || String.fromCharCode(65 + zoneIndex);
      const zoneRegistrations = (Array.isArray(zone.registrationIds) ? zone.registrationIds : [])
        .map((registrationId) => registrationsById.get(registrationId))
        .filter(Boolean);
      const matchLabels = buildPlanningMatchLabels(zoneRegistrations.length);
      const zoneStandings = buildZoneStandings(zone, zoneRegistrations, currentMatchFormat.zones);
      const qualifiersCount = getZoneQualifiersCount(tournamentRuleSet, zoneRegistrations.length);
      const resolvedQualifiers = buildQualifiedPairsFromZonePlanning(
        zone,
        zoneRegistrations,
        currentMatchFormat.zones,
        tournamentRuleSet
      );
      const qualifiers = Array.from({ length: qualifiersCount }, (_, index) =>
        resolvedQualifiers[index]
          ? {
              ...resolvedQualifiers[index],
              seedLabel: `${index + 1}${bracketLetter}`,
            }
          : null
      );
      const matchRows = matchLabels
        .map((matchLabel, matchIndex) => {
          const schedule = zone.matchSchedules?.[matchLabel] || {};
          const defaultDayKey = tournamentDayOptions[0]?.key || "";
          const defaultVenueId = tournamentVenueOptions.length === 1 ? tournamentVenueOptions[0].id : "";
          const effectiveDayKey = schedule.dayKey || defaultDayKey;
          const effectiveVenueId = schedule.venueId || zone.legacyVenueId || defaultVenueId;
          const effectiveVenue = tournamentVenueOptions.find((venue) => venue.id === effectiveVenueId);
          const pairNumbers = getPlanningMatchPairNumbers(zone, zoneRegistrations, matchLabel);
          const winnerRegistrationId = String(schedule?.result?.winnerRegistrationId || "");
          const winnerPairNumber =
            pairNumbers.find((pairNumber) => {
              const registration = zoneRegistrations[Number.parseInt(pairNumber, 10) - 1];
              return String(registration?.id || "") === winnerRegistrationId;
            }) || "";
          const venueLabel =
            effectiveVenue?.label ||
            effectiveVenue?.name ||
            schedule.venueLabel ||
            (tournamentVenueOptions.length ? "Elegir" : "Sin sede");

          return {
            dayLabel: effectiveDayKey
              ? formatScheduleWeekdayDisplay(effectiveDayKey, tournamentDayOptions)
              : "Dia",
            dayKey: effectiveDayKey,
            key: matchLabel,
            label: pairNumbers.length === 2 ? `${pairNumbers[0]} vs ${pairNumbers[1]}` : matchLabel,
            orderIndex: matchIndex,
            pairNumbers,
            resultLabel: formatPlanningResultText(schedule),
            startTime: schedule.startTime || "",
            timeLabel: schedule.startTime || "Hora",
            venueId: effectiveVenueId,
            venueLabel,
            winnerPairNumber,
          };
        })
        .sort((firstMatch, secondMatch) => {
          const firstDayOrder = dayOrderByKey.has(firstMatch.dayKey)
            ? dayOrderByKey.get(firstMatch.dayKey)
            : Number.MAX_SAFE_INTEGER;
          const secondDayOrder = dayOrderByKey.has(secondMatch.dayKey)
            ? dayOrderByKey.get(secondMatch.dayKey)
            : Number.MAX_SAFE_INTEGER;

          if (firstDayOrder !== secondDayOrder) {
            return firstDayOrder - secondDayOrder;
          }

          const firstTimeOrder = isValidTimeString(firstMatch.startTime)
            ? parseTimeToMinutes(firstMatch.startTime)
            : Number.MAX_SAFE_INTEGER;
          const secondTimeOrder = isValidTimeString(secondMatch.startTime)
            ? parseTimeToMinutes(secondMatch.startTime)
            : Number.MAX_SAFE_INTEGER;

          if (firstTimeOrder !== secondTimeOrder) {
            return firstTimeOrder - secondTimeOrder;
          }

          return firstMatch.orderIndex - secondMatch.orderIndex;
        });

      return {
        bracketLetter,
        id: zoneId,
        label: zone.label || `Zona ${String.fromCharCode(65 + zoneIndex)}`,
        matchRows,
        qualifiers,
        registrations: zoneRegistrations.map((registration, registrationIndex) => ({
          id: registration.id,
          label: formatShortPairLabel(registration.pairLabel || `Pareja ${registrationIndex + 1}`),
          number: registrationIndex + 1,
        })),
        standings: zoneStandings,
      };
    });
  }, [
    activeZonePlanning,
    currentMatchFormat.zones,
    registrationsById,
    tournamentDayOptions,
    tournamentRuleSet,
    tournamentVenueOptions,
  ]);
  const buildZonesPreviewForPlanning = useCallback(
    (zonePlanning) =>
      buildZonesPreviewFromZonePlanning({
        matchFormat: currentMatchFormat.zones,
        registrationsById,
        ruleSet: tournamentRuleSet,
        tournamentDayOptions,
        tournamentVenueOptions,
        zonePlanning,
      }),
    [
      currentMatchFormat.zones,
      registrationsById,
      tournamentDayOptions,
      tournamentRuleSet,
      tournamentVenueOptions,
    ]
  );
  const newZonesPreviewForBracket = useMemo(
    () => buildZonesPreviewForPlanning(activeZonePlanning),
    [activeZonePlanning, buildZonesPreviewForPlanning]
  );
  const zoneShareChunks = useMemo(() => {
    const chunks = [];

    for (let index = 0; index < newZonePlanningZones.length; index += 3) {
      chunks.push(newZonePlanningZones.slice(index, index + 3));
    }

    return chunks;
  }, [newZonePlanningZones]);
  const zoneShareCategoryLabel = useMemo(
    () => tournament?.compositionConfig?.label || tournament?.compositionLabel || "",
    [tournament?.compositionConfig?.label, tournament?.compositionLabel]
  );
  const zoneShareOrganizerLogoUrl = useMemo(
    () =>
      tournament?.organizerLogoUrl ||
      ((tournament?.organizerId === userData?.uid || tournament?.createdBy === userData?.uid)
        ? userData?.organizerLogoUrl
        : "") ||
      "",
    [
      tournament?.createdBy,
      tournament?.organizerId,
      tournament?.organizerLogoUrl,
      userData?.organizerLogoUrl,
      userData?.uid,
    ]
  );
  const bracketZonesPreviewChanged = useMemo(() => {
    if (!bracketBoard) {
      return false;
    }

    const savedZonesPreview = fixtureSetup?.zonesPreview || [];

    if (!Array.isArray(savedZonesPreview) || !savedZonesPreview.length) {
      return false;
    }

    return buildZonesPreviewSignature(savedZonesPreview) !== buildZonesPreviewSignature(newZonesPreviewForBracket);
  }, [bracketBoard, fixtureSetup?.zonesPreview, newZonesPreviewForBracket]);
  const shouldShowBracketZoneWarning = useMemo(
    () =>
      canEditFixture &&
      Boolean(bracketBoard) &&
      (hasZonePlanningUnsavedChanges || bracketNeedsZoneRefresh || bracketZonesPreviewChanged),
    [
      bracketBoard,
      bracketNeedsZoneRefresh,
      bracketZonesPreviewChanged,
      canEditFixture,
      hasZonePlanningUnsavedChanges,
    ]
  );
  const zonePlanningStandingsModalZone = useMemo(
    () =>
      newZonePlanningZones.find((zone) => zone.id === zonePlanningStandingsModalZoneId) || null,
    [newZonePlanningZones, zonePlanningStandingsModalZoneId]
  );
  const bracketVenueSchedulesForDisplay = useMemo(
    () =>
      normalizeZoneVenueSchedules(
        [
          ...zoneVenueSchedules,
          ...tournamentVenueOptions
            .map((venue) => {
              const venueDraft = scheduleVenueDrafts?.[venue.id] || {};

              if (!venueDraft.useForBracket) {
                return null;
              }

              return {
                id: `bracket-display-draft-${venue.id}`,
                venueId: venue.id,
                venueName: venue.name,
                dayKey: venueDraft.selectedDayKey,
                from: venueDraft.from,
                to: venueDraft.to,
                courts: venueDraft.courts,
                useForZones: Boolean(venueDraft.useForZones),
                useForBracket: true,
              };
            })
            .filter(Boolean),
        ],
        tournamentDayOptions,
        tournamentVenueOptions
      ).filter((entry) => entry.useForBracket),
    [scheduleVenueDrafts, tournamentDayOptions, tournamentVenueOptions, zoneVenueSchedules]
  );
  const bracketDisplayFallbackSchedule = useMemo(() => {
    const firstSchedule = bracketVenueSchedulesForDisplay[0];

    if (!firstSchedule) {
      return null;
    }

    return {
      courtLabel: `${firstSchedule.venueName} Â· Cancha 1`,
      dayKey: firstSchedule.dayKey,
      time: firstSchedule.from,
    };
  }, [bracketVenueSchedulesForDisplay]);
  const currentPlayerRegistration = useMemo(
    () =>
      registrations.find(
        (registration) =>
          normalizeText(registration?.player1Id) === normalizeText(currentUserId) ||
          normalizeText(registration?.player2Id) === normalizeText(currentUserId)
      ) || null,
    [currentUserId, registrations]
  );
  const highlightedPairId = !canEditFixture ? String(currentPlayerRegistration?.id || "").trim() : "";
  const highlightedZoneId = useMemo(() => {
    if (!highlightedPairId) {
      return "";
    }

    return (
      (zonesPreview || []).find((zone) =>
        (zone?.pairs || []).some((pair) => String(pair?.id || "").trim() === highlightedPairId)
      )?.id || ""
    );
  }, [highlightedPairId, zonesPreview]);
  const upcomingBracketMatches = useMemo(() => {
    const matches = (currentBracketPreview?.rounds || []).flatMap((round) =>
      (round.matches || [])
        .filter((match) => !match?.teamAIsBye && !match?.teamBIsBye)
        .map((match) => {
          const { venueName, courtName } = splitCourtLabelPartsSafe(match.courtLabel);
          const scheduledDayKey = String(match?.scheduledDayKey || "").trim();
          const scheduledTime = String(match?.scheduledTime || "").trim();
          const hasSchedule = Boolean(scheduledDayKey && scheduledTime);

          return {
            id: `${round.id}-${match.id}`,
            roundTitle: round.title || round.roundTitle || "Llave",
            matchupLabel: `${match.teamASeed || "A"} vs ${match.teamBSeed || "B"}`,
            teamALines: getBracketTeamDisplayLines(match, "teamA"),
            teamBLines: getBracketTeamDisplayLines(match, "teamB"),
            dayLabel: scheduledDayKey
              ? formatScheduleDayDisplay(scheduledDayKey, tournamentDayOptions)
              : "Dia a confirmar",
            timeLabel: scheduledTime ? `${scheduledTime} hs` : "Hora a confirmar",
            venueLabel: venueName || "Sede a confirmar",
            courtLabel: courtName || "Cancha pendiente",
            sortDayKey: scheduledDayKey,
            sortTime: scheduledTime,
            hasSchedule,
          };
        })
    );

    return matches
      .sort((first, second) => {
        if (first.hasSchedule !== second.hasSchedule) {
          return first.hasSchedule ? -1 : 1;
        }
        if (first.sortDayKey !== second.sortDayKey) {
          return first.sortDayKey.localeCompare(second.sortDayKey, "es");
        }
        return first.sortTime.localeCompare(second.sortTime, "es");
      })
      .slice(0, 4);
  }, [currentBracketPreview, tournamentDayOptions]);
  const activeBracketCourtPicker = useMemo(() => {
    if (
      bracketMatchPickerState.field !== "courtLabel" ||
      !bracketMatchPickerState.roundId ||
      !bracketMatchPickerState.matchId
    ) {
      return null;
    }

    const currentRound = (currentBracketPreview?.rounds || []).find(
      (round) => round.id === bracketMatchPickerState.roundId
    );
    const currentMatch = (currentRound?.matches || []).find(
      (match) => match.id === bracketMatchPickerState.matchId
    );

    if (!currentMatch || currentMatch.teamAIsBye || currentMatch.teamBIsBye) {
      return null;
    }

    const parsedCourt = splitCourtLabelPartsSafe(currentMatch.courtLabel);
    const currentCourtLabel = String(currentMatch.courtLabel || "").trim();
    const venueId = String(currentMatch.venueId || "").trim();
    const bracketSchedules = zoneVenueSchedules.filter((entry) => entry.useForBracket);
    const scheduledVenueIds = Array.from(
      new Set(bracketSchedules.map((entry) => String(entry.venueId || "").trim()).filter(Boolean))
    );
    const venueIdMatches = venueId
      ? tournamentVenueOptions.filter((entry) => String(entry.id || "") === venueId)
      : [];
    const selectableVenues = venueIdMatches.length
      ? venueIdMatches
      : scheduledVenueIds.length
      ? scheduledVenueIds
          .map((entryVenueId) =>
            tournamentVenueOptions.find((entry) => String(entry.id || "") === entryVenueId)
          )
          .filter(Boolean)
      : tournamentVenueOptions;
    const options = selectableVenues.flatMap((venue) => {
      const currentVenueId = String(venue?.id || "").trim();
      const scheduleCourtCount = Math.max(
        ...bracketSchedules
          .filter((entry) => String(entry.venueId || "").trim() === currentVenueId)
          .map((entry) => Number(entry.courts || 0)),
        0
      );
      const courtCount = Math.max(scheduleCourtCount || Number(venue?.totalCanchas || 0) || 1, 1);
      const venueName =
        bracketSchedules.find((entry) => String(entry.venueId || "").trim() === currentVenueId)?.venueName ||
        venue?.name ||
        venue?.label ||
        "";

      return buildCourtPickerOptions(venue, venueName, courtCount);
    });

    return {
      currentCourtName: parsedCourt.courtName,
      currentCourtLabel,
      matchId: currentMatch.id,
      options,
      roundId: currentRound.id,
    };
  }, [
    bracketMatchPickerState,
    currentBracketPreview,
    tournamentVenueOptions,
    zoneVenueSchedules,
  ]);
  const getBracketSelectableVenues = useCallback(
    (preferredVenueId = "") => {
      const cleanPreferredVenueId = String(preferredVenueId || "").trim();
      const bracketSchedules = zoneVenueSchedules.filter((entry) => entry.useForBracket);
      const scheduledVenueIds = Array.from(
        new Set(bracketSchedules.map((entry) => String(entry.venueId || "").trim()).filter(Boolean))
      );
      const venueIdMatches = cleanPreferredVenueId
        ? tournamentVenueOptions.filter((entry) => String(entry.id || "") === cleanPreferredVenueId)
        : [];

      return venueIdMatches.length
        ? venueIdMatches
        : scheduledVenueIds.length
        ? scheduledVenueIds
            .map((entryVenueId) =>
              tournamentVenueOptions.find((entry) => String(entry.id || "") === entryVenueId)
            )
            .filter(Boolean)
        : tournamentVenueOptions;
    },
    [tournamentVenueOptions, zoneVenueSchedules]
  );
  const getBracketCourtOptionsForVenue = useCallback(
    (venueId = "") => {
      const cleanVenueId = String(venueId || "").trim();
      const bracketSchedules = zoneVenueSchedules.filter((entry) => entry.useForBracket);
      const selectableVenues = getBracketSelectableVenues(cleanVenueId);
      const targetVenues = cleanVenueId
        ? selectableVenues.filter((venue) => String(venue?.id || "").trim() === cleanVenueId)
        : selectableVenues;

      return targetVenues.flatMap((venue) => {
        const currentVenueId = String(venue?.id || "").trim();
        const scheduleCourtCount = Math.max(
          ...bracketSchedules
            .filter((entry) => String(entry.venueId || "").trim() === currentVenueId)
            .map((entry) => Number(entry.courts || 0)),
          0
        );
        const courtCount = Math.max(scheduleCourtCount || Number(venue?.totalCanchas || 0) || 1, 1);
        const venueName =
          bracketSchedules.find((entry) => String(entry.venueId || "").trim() === currentVenueId)?.venueName ||
          venue?.name ||
          venue?.label ||
          "";

        return buildCourtPickerOptions(venue, venueName, courtCount);
      });
    },
    [getBracketSelectableVenues, zoneVenueSchedules]
  );
  const activeZoneCourtPicker = useMemo(() => {
    if (
      zoneMatchPickerState.field !== "courtLabel" ||
      !zoneMatchPickerState.zoneId ||
      !zoneMatchPickerState.matchId
    ) {
      return null;
    }

    const currentZone = (zonesPreview || []).find(
      (zone) => zone.id === zoneMatchPickerState.zoneId
    );
    const currentMatch = (currentZone?.matches || []).find(
      (match) => match.id === zoneMatchPickerState.matchId
    );

    if (!currentZone || !currentMatch) {
      return null;
    }

    const parsedCourt = splitCourtLabelPartsSafe(currentMatch.courtLabel);
    const venueId = String(currentMatch.venueId || "").trim();
    const schedulesForZones = zoneVenueSchedules.filter(
      (entry) => entry.useForZones && (!venueId || entry.venueId === venueId)
    );
    const scheduleCourtCount = Math.max(
      ...schedulesForZones.map((entry) => Number(entry.courts || 0)),
      0
    );
    const venue = tournamentVenueOptions.find((entry) => String(entry.id || "") === venueId);
    const courtCount = Math.max(scheduleCourtCount || Number(venue?.totalCanchas || 0) || 1, 1);
    const venueName =
      parsedCourt.venueName ||
      venue?.name ||
      schedulesForZones[0]?.venueName ||
      tournamentVenueOptions[0]?.name ||
      "";

    return {
      currentCourtName: parsedCourt.courtName,
      matchId: currentMatch.id,
      options: buildCourtPickerOptions(venue, venueName, courtCount),
      zoneId: currentZone.id,
    };
  }, [
    tournamentVenueOptions,
    zoneMatchPickerState,
    zonesPreview,
    zoneVenueSchedules,
  ]);

  const saveFixtureSetup = async (partialSetup = {}, successMessage = "") => {
    if (!tournament?.id) {
      return;
    }

    try {
      setSavingKey(partialSetup.savingKey || "saving");
      const shouldSkipReload = Boolean(partialSetup.skipReload);
      const baseFixtureSetup = pendingFixtureSetupRef.current || fixtureSetup;
      const nextSetup = {
        ...baseFixtureSetup,
        mode: selectedMode,
        pathType: selectedPathType,
        manualBracketMode: selectedManualBracketMode,
        matchFormat: currentMatchFormat,
        matchDurationMinutes: currentZoneMatchDurationMinutes,
        zoneVenueSchedules,
        configurationStatus: baseFixtureSetup.configurationStatus || "pending",
        zonesStatus: baseFixtureSetup.zonesStatus || "pending",
        bracketStatus: baseFixtureSetup.bracketStatus || "pending",
        recommendedTemplate: {
          pairCount: confirmedPairCount,
          zoneSizes: recommendation.zoneSizes,
          qualifiedSummary: recommendation.qualifiedSummary,
          bracketSummary: recommendation.bracketSummary,
          bracketTitle: recommendation.bracketTitle,
        },
        ...partialSetup,
      };
      const bracketSaveGeneration = Number(nextSetup.bracketSaveGeneration || 0);
      delete nextSetup.savingKey;
      delete nextSetup.skipReload;
      delete nextSetup.bracketSaveGeneration;

      if (
        (partialSetup.savingKey || "") === "bracket" &&
        bracketSaveGeneration < bracketSaveGenerationRef.current
      ) {
        return;
      }

      pendingFixtureSetupRef.current = nextSetup;

      const tournamentUpdatePayload = {
        buildMode: selectedMode,
        fixtureSetup: nextSetup,
      };

      if (nextSetup.zonePlanning !== undefined || tournament?.zonePlanning !== undefined) {
        tournamentUpdatePayload.zonePlanning =
          nextSetup.zonePlanning !== undefined ? nextSetup.zonePlanning : tournament?.zonePlanning || null;
      }

      const updatedTournament = await updateTournament(
        tournament.id,
        currentOrganizer,
        tournamentUpdatePayload,
        tournament
      );

      if ((partialSetup.savingKey || "") === "configuration") {
        await updateProfile({
          tournamentFixtureDefaults: {
            mode: selectedMode,
            pathType: selectedPathType,
            manualBracketMode: selectedManualBracketMode,
            matchDurationMinutes: currentZoneMatchDurationMinutes,
            matchFormat: currentMatchFormat,
          },
        });
      }

      if (
        (partialSetup.savingKey || "") === "bracket" &&
        bracketSaveGeneration < bracketSaveGenerationRef.current
      ) {
        return;
      }

      setTournament((current) =>
        current
          ? {
              ...current,
              ...updatedTournament,
              fixtureSetup: nextSetup,
              buildMode: selectedMode,
            }
          : updatedTournament
      );

      pendingFixtureSetupRef.current = nextSetup;

      if (!shouldSkipReload) {
        await loadScreen();
      }

      if (successMessage) {
        setFeedback({
          visible: true,
          title: "Preferencias guardadas",
          message: successMessage,
          tone: "success",
        });
      }
    } catch (error) {
      setFeedback({
        visible: true,
        title: "No pudimos guardar el fixture",
        message: error?.message || "Intenta nuevamente en unos instantes.",
        tone: "danger",
      });
    } finally {
      setSavingKey("");
    }
  };

  const handleChangeActiveSection = useCallback(
    async (nextSection) => {
      const normalizedSection = normalizeFixtureActiveSection(nextSection);
      setBracketMatchPickerState({ roundId: "", matchId: "", field: "" });
      setBracketMatchTimePickerTarget(null);
      setScheduleVenueTimePickerTarget(null);
      setActiveSection(normalizedSection);

      if (canEditFixture) {
        if (!tournament?.id || fixtureSetup.lastViewedSection === normalizedSection) {
          return;
        }

        try {
          const latestFixtureSetup = pendingFixtureSetupRef.current || fixtureSetup;
          const nextFixtureSetup = {
            ...latestFixtureSetup,
            lastViewedSection: normalizedSection,
          };
          const sectionUpdatePayload = {
            fixtureSetup: nextFixtureSetup,
          };

          if (nextFixtureSetup.zonePlanning !== undefined || tournament?.zonePlanning !== undefined) {
            sectionUpdatePayload.zonePlanning =
              nextFixtureSetup.zonePlanning !== undefined
                ? nextFixtureSetup.zonePlanning
                : tournament?.zonePlanning || null;
          }

          await updateTournament(
            tournament.id,
            currentOrganizer,
            sectionUpdatePayload,
            tournament
          );

          setTournament((current) =>
            current
              ? {
                  ...current,
                  fixtureSetup: nextFixtureSetup,
                  zonePlanning:
                    nextFixtureSetup.zonePlanning !== undefined
                      ? nextFixtureSetup.zonePlanning
                      : current.zonePlanning,
                }
              : current
          );
        } catch (_error) {
          // If this silent preference save fails, we keep the local section change.
        }
        return;
      }

      if (playerPreferredSection === normalizedSection) {
        return;
      }

      try {
        await updateProfile({
          tournamentFixtureLastViewedSections: {
            ...playerFixtureLastViewedSections,
            [tournamentId]: normalizedSection,
          },
        });
      } catch (_error) {
        // If this silent preference save fails, we keep the local section change.
      }
    },
    [
      canEditFixture,
      currentOrganizer,
      fixtureSetup,
      playerFixtureLastViewedSections,
      playerPreferredSection,
      tournament,
      tournamentId,
      updateProfile,
    ]
  );

  const handlePressBracketSection = useCallback(async () => {
    if (bracketOpening) {
      return;
    }

    setBracketOpening(true);

    try {
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      await handleChangeActiveSection("bracket");

      if (hasCreatedBracket) {
        openBracketFullscreen();
        await new Promise((resolve) => setTimeout(resolve, 180));
      }
    } finally {
      setBracketOpening(false);
    }
  }, [
    bracketOpening,
    handleChangeActiveSection,
    hasCreatedBracket,
    openBracketFullscreen,
  ]);

  const scheduleBracketSave = useCallback(
    (nextBracketPreview) => {
      if (bracketSaveTimeoutRef.current) {
        clearTimeout(bracketSaveTimeoutRef.current);
      }

      bracketSaveTimeoutRef.current = setTimeout(() => {
        saveFixtureSetup({
          savingKey: "bracket",
          skipReload: true,
          bracketSaveGeneration: bracketSaveGenerationRef.current,
          bracketStatus: nextBracketPreview?.mode === "manual" ? "manual_ready" : "automatic_ready",
          bracketPreview: nextBracketPreview,
        });
      }, 450);
    },
    [saveFixtureSetup]
  );

  const syncBracketFromZonePlanning = useCallback(
    (nextPlanning) => {
      const baseBracketPreview = workingBracketPreviewRef.current || currentBracketPreview;

      if (!baseBracketPreview) {
        return null;
      }

      const nextZonesPreview = buildZonesPreviewForPlanning(nextPlanning);
      const syncedBracketPreview = syncBracketPreviewQualifiedEntries(
        baseBracketPreview,
        nextZonesPreview,
        resolveCurrentBracketRoundFormat,
        tournamentRuleSet,
        recommendation
      );

      if (!syncedBracketPreview) {
        return null;
      }

      setBracketDraft(syncedBracketPreview);
      workingBracketPreviewRef.current = syncedBracketPreview;
      scheduleBracketSave(syncedBracketPreview);
      return syncedBracketPreview;
    },
    [
      buildZonesPreviewForPlanning,
      currentBracketPreview,
      recommendation,
      resolveCurrentBracketRoundFormat,
      scheduleBracketSave,
      tournamentRuleSet,
    ]
  );

  const scheduleZonesSave = useCallback(
    (nextZonesPreview) => {
      if (zoneSaveTimeoutRef.current) {
        clearTimeout(zoneSaveTimeoutRef.current);
      }

      zoneSaveTimeoutRef.current = setTimeout(() => {
        saveFixtureSetup({
          savingKey: "zones",
          skipReload: true,
          zonesStatus: "created",
          zonesPreview: nextZonesPreview,
        });

        if (currentBracketPreview) {
          const syncedBracketPreview = syncBracketPreviewQualifiedEntries(
            currentBracketPreview,
            nextZonesPreview,
            resolveCurrentBracketRoundFormat,
            tournamentRuleSet,
            recommendation
          );

          setBracketDraft(syncedBracketPreview);
          scheduleBracketSave(syncedBracketPreview);
        }
      }, 450);
    },
    [
      currentBracketPreview,
      recommendation,
      resolveCurrentBracketRoundFormat,
      saveFixtureSetup,
      scheduleBracketSave,
      tournamentRuleSet,
    ]
  );

  const handleCreateConfiguration = () => {
    saveFixtureSetup(
      {
        savingKey: "configuration",
        configurationStatus: "configured",
        mode: selectedMode,
        pathType: selectedPathType,
        manualBracketMode: selectedManualBracketMode,
        matchFormat: currentMatchFormat,
        matchDurationMinutes: currentZoneMatchDurationMinutes,
      },
      "La configuracion general del fixture ya quedo guardada."
    );
  };

  const handleAddZoneVenueSchedule = (venueId) => {
    const venueDraft = scheduleVenueDrafts?.[venueId] || {};
    const venue = tournamentVenueOptions.find((entry) => entry.id === venueId);
    const maxCourts = Math.max(Number(venue?.totalCanchas || 0) || 0, 1);
    const selectedCourts = Math.max(
      1,
      Math.min(Number.parseInt(String(venueDraft.courts || maxCourts), 10) || maxCourts, maxCourts)
    );

    if (!venueDraft.useForZones && !venueDraft.useForBracket) {
      setFeedback({
        visible: true,
        title: "Selecciona el uso de la sede",
        message: "Indica si esta sede se utilizara en zonas, en llaves o en ambas.",
        tone: "warning",
      });
      return;
    }

    if (
      !venueId ||
      !venueDraft.selectedDayKey ||
      !isValidTimeString(venueDraft.from) ||
      !isValidTimeString(venueDraft.to)
    ) {
      setFeedback({
        visible: true,
        title: "Completa la disponibilidad",
        message: "Selecciona el dia y completa el horario desde y hasta para esa sede.",
        tone: "warning",
      });
      return;
    }

    if (parseTimeToMinutes(venueDraft.to) <= parseTimeToMinutes(venueDraft.from)) {
      setFeedback({
        visible: true,
        title: "Horario invalido",
        message: "El horario de fin debe ser posterior al horario de inicio.",
        tone: "warning",
      });
      return;
    }

    const nextSchedules = normalizeZoneVenueSchedules(
      [
        ...zoneVenueSchedules,
        ...(() => {
          if (!venue) {
            return [];
          }

          return [
            {
              id: `zone-schedule-${Date.now()}-${venueId}`,
              venueId: venue.id,
              venueName: venue.name,
              dayKey: venueDraft.selectedDayKey,
              from: venueDraft.from,
              to: venueDraft.to,
              courts: selectedCourts,
              useForZones: Boolean(venueDraft.useForZones),
              useForBracket: Boolean(venueDraft.useForBracket),
            },
          ];
        })(),
      ],
      tournamentDayOptions,
      tournamentVenueOptions
    );

    setZoneVenueSchedules(nextSchedules);
    saveFixtureSetup(
      {
        savingKey: "venue-schedules",
        skipReload: true,
        zoneVenueSchedules: nextSchedules,
      },
      "La disponibilidad de sedes quedo guardada."
    );
  };

  const handleRemoveZoneVenueSchedule = (scheduleId) => {
    const nextSchedules = zoneVenueSchedules.filter((entry) => entry.id !== scheduleId);
    setZoneVenueSchedules(nextSchedules);
    saveFixtureSetup({
      savingKey: "venue-schedules",
      skipReload: true,
      zoneVenueSchedules: nextSchedules,
    });
  };

  const assignSchedulesToZoneMatches = useCallback(
    (sourceZones = []) => {
      const allSlots = buildZoneMatchSchedulingSlots(
        zoneVenueSchedules,
        currentZoneMatchDurationMinutes
      );
      const usedSlotIds = new Set();
      const pairOccupancy = new Map();
      let unassignedCount = 0;

      const nextZonesPreview = (Array.isArray(sourceZones) ? sourceZones : []).map((zone) => ({
        ...zone,
        matches: (zone.matches || []).map((match) => {
          if (!match.teamAId || !match.teamBId) {
            return match;
          }

          const pairA = registrationsById.get(match.teamAId);
          const pairB = registrationsById.get(match.teamBId);
          const pairAOccupiedSlots = pairOccupancy.get(match.teamAId) || [];
          const pairBOccupiedSlots = pairOccupancy.get(match.teamBId) || [];
          const nextSlot = allSlots
            .filter((slot) => {
              if (usedSlotIds.has(slot.id)) {
                return false;
              }

              const overlapsPairA = pairAOccupiedSlots.some(
                (entry) =>
                  entry.dayKey === slot.dayKey &&
                  !(slot.endMinutes <= entry.startMinutes || slot.startMinutes >= entry.endMinutes)
              );
              const overlapsPairB = pairBOccupiedSlots.some(
                (entry) =>
                  entry.dayKey === slot.dayKey &&
                  !(slot.endMinutes <= entry.startMinutes || slot.startMinutes >= entry.endMinutes)
              );

              if (overlapsPairA || overlapsPairB) {
                return false;
              }

              const nearMatchInOtherVenue = [...pairAOccupiedSlots, ...pairBOccupiedSlots].some(
                (entry) => {
                  if (entry.dayKey !== slot.dayKey || entry.venueId === slot.venueId) {
                    return false;
                  }

                  const gapMinutes =
                    slot.startMinutes >= entry.endMinutes
                      ? slot.startMinutes - entry.endMinutes
                      : entry.startMinutes >= slot.endMinutes
                      ? entry.startMinutes - slot.endMinutes
                      : 0;

                  return gapMinutes <= CLOSE_MATCH_VENUE_GAP_MINUTES;
                }
              );

              if (nearMatchInOtherVenue) {
                return false;
              }

              return (
                isPairAvailableForSlot(pairA?.availability, slot.dayKey, slot.startMinutes, slot.endMinutes) &&
                isPairAvailableForSlot(pairB?.availability, slot.dayKey, slot.startMinutes, slot.endMinutes)
              );
            })
            .sort((firstSlot, secondSlot) => {
              const getVenueContinuityScore = (slot) =>
                [...pairAOccupiedSlots, ...pairBOccupiedSlots].reduce((score, entry) => {
                  if (entry.dayKey !== slot.dayKey) {
                    return score;
                  }

                  return entry.venueId === slot.venueId ? score + 1 : score;
                }, 0);

              const firstScore = getVenueContinuityScore(firstSlot);
              const secondScore = getVenueContinuityScore(secondSlot);

              if (firstScore !== secondScore) {
                return secondScore - firstScore;
              }

              if (firstSlot.dayKey !== secondSlot.dayKey) {
                return String(firstSlot.dayKey).localeCompare(String(secondSlot.dayKey));
              }

              if (firstSlot.startMinutes !== secondSlot.startMinutes) {
                return firstSlot.startMinutes - secondSlot.startMinutes;
              }

              return firstSlot.courtIndex - secondSlot.courtIndex;
            })[0];

          if (!nextSlot) {
            unassignedCount += 1;
            return {
              ...match,
              distributionPending: true,
              courtLabel: "Cancha pendiente",
              scheduleLabel: "Horario pendiente",
              scheduledDayKey: "",
              scheduledTime: "",
            };
          }

          usedSlotIds.add(nextSlot.id);
          pairOccupancy.set(match.teamAId, [...pairAOccupiedSlots, nextSlot]);
          pairOccupancy.set(match.teamBId, [...pairBOccupiedSlots, nextSlot]);

          return {
            ...match,
            distributionPending: false,
            venueId: nextSlot.venueId,
            courtLabel: nextSlot.courtLabel,
            scheduleLabel: `${getTournamentDayLabel(nextSlot.dayKey, tournamentDayOptions, "short")} · ${formatMinutesToTime(nextSlot.startMinutes)} hs`,
            scheduledDayKey: nextSlot.dayKey,
            scheduledTime: formatMinutesToTime(nextSlot.startMinutes),
          };
        }),
      }));

      return { nextZonesPreview, unassignedCount };
    },
    [currentZoneMatchDurationMinutes, tournamentDayOptions, zoneVenueSchedules]
  );

  const assignSchedulesToBracketMatches = useCallback(
    (sourceBracketPreview = null, schedulesSource = zoneVenueSchedules) => {
      if (!sourceBracketPreview || !Array.isArray(sourceBracketPreview.rounds)) {
        return { nextBracketPreview: sourceBracketPreview, unassignedCount: 0 };
      }

      const bracketSchedules = (Array.isArray(schedulesSource) ? schedulesSource : []).filter(
        (entry) => entry.useForBracket
      );
      const generatedSlots = buildZoneMatchSchedulingSlots(
        bracketSchedules,
        currentZoneMatchDurationMinutes
      );
      const fallbackSlots = bracketSchedules.flatMap((schedule) =>
        Array.from({ length: Math.max(Number(schedule.courts || 1), 1) }, (_, courtIndex) => ({
          id: `${schedule.id}-fallback-${courtIndex + 1}`,
          scheduleId: schedule.id,
          venueId: schedule.venueId,
          venueName: schedule.venueName,
          courtIndex: courtIndex + 1,
          courtLabel: `${schedule.venueName} · Cancha ${courtIndex + 1}`,
          dayKey: schedule.dayKey,
          startMinutes: parseTimeToMinutes(schedule.from),
          endMinutes: parseTimeToMinutes(schedule.to),
        }))
      );
      const allSlots = generatedSlots.length ? generatedSlots : fallbackSlots;
      const usedSlotIds = new Set();
      let unassignedCount = 0;
      let slotCursor = 0;

      const nextBracketPreview = {
        ...sourceBracketPreview,
        rounds: sourceBracketPreview.rounds.map((round) => ({
          ...round,
          matches: (round.matches || []).map((match) => {
            if (match.teamAIsBye || match.teamBIsBye) {
              return {
                ...match,
                distributionPending: false,
                venueId: "",
                courtLabel: "Cancha pendiente",
                scheduleLabel: "Horario pendiente",
                scheduledDayKey: "",
                scheduledTime: "",
              };
            }

            let nextSlot = null;

            for (let index = 0; index < allSlots.length; index += 1) {
              const candidate = allSlots[(slotCursor + index) % allSlots.length];

              if (candidate && !usedSlotIds.has(candidate.id)) {
                nextSlot = candidate;
                slotCursor = (slotCursor + index + 1) % allSlots.length;
                break;
              }
            }

            if (!nextSlot && allSlots.length) {
              nextSlot = allSlots[slotCursor % allSlots.length];
              slotCursor += 1;
            }

            if (!nextSlot) {
              unassignedCount += 1;
              return {
                ...match,
                distributionPending: true,
                courtLabel: "Cancha pendiente",
                scheduleLabel: "Horario pendiente",
                scheduledDayKey: "",
                scheduledTime: "",
              };
            }

            usedSlotIds.add(nextSlot.id);

            return {
              ...match,
              distributionPending: false,
              venueId: nextSlot.venueId,
              courtLabel: nextSlot.courtLabel,
              scheduleLabel: `${getTournamentDayLabel(nextSlot.dayKey, tournamentDayOptions, "short")} · ${formatMinutesToTime(nextSlot.startMinutes)} hs`,
              scheduledDayKey: nextSlot.dayKey,
              scheduledTime: formatMinutesToTime(nextSlot.startMinutes),
            };
          }),
        })),
      };

      return { nextBracketPreview, unassignedCount };
    },
    [currentZoneMatchDurationMinutes, tournamentDayOptions, zoneVenueSchedules]
  );

  const handleAutoAssignZoneMatches = () => {
    if (!zonesPreview.length) {
      setFeedback({
        visible: true,
        title: "Primero crea las zonas",
        message: "Necesitamos zonas visibles antes de distribuir partidos.",
        tone: "warning",
      });
      return;
    }

    if (!zoneVenueSchedules.length) {
      setFeedback({
        visible: true,
        title: "Faltan horarios de sede",
        message: "Carga al menos un bloque de disponibilidad por sede para distribuir partidos.",
        tone: "warning",
      });
      return;
    }

    const { nextZonesPreview, unassignedCount } = assignSchedulesToZoneMatches(zonesPreview);
    applyWorkingZonesPreview(nextZonesPreview);
    scheduleZonesSave(nextZonesPreview);
    setFeedback({
      visible: true,
      title: "Partidos distribuidos",
      message:
        unassignedCount > 0
          ? `La app distribuyo los partidos posibles y dejo ${unassignedCount} sin horario por falta de disponibilidad.`
          : "La app propuso sede, cancha y horario para los partidos de zona con parejas definidas.",
      tone: unassignedCount > 0 ? "warning" : "success",
    });
  };

  const handleCreateZones = () => {
    if (confirmedPairCount < 6) {
      setFeedback({
        visible: true,
        title: "Faltan parejas confirmadas",
        message: "Se necesitan al menos 6 parejas confirmadas para crear zonas.",
        tone: "warning",
      });
      return;
    }

    const nextZonesPreview =
      selectedMode === "manual"
        ? buildManualZones(recommendation)
        : buildAutomaticZones(confirmedRegistrations, recommendation);
    const zonesWithMatches = decorateZonesWithMatches(nextZonesPreview, currentMatchFormat.zones);
    const scheduledZonesResult =
      selectedMode !== "manual" && zoneVenueSchedules.length
        ? assignSchedulesToZoneMatches(zonesWithMatches)
        : { nextZonesPreview: zonesWithMatches, unassignedCount: 0 };
    const finalZonesPreview = scheduledZonesResult.nextZonesPreview;

    if (selectedMode === "manual") {
      setSelectedAvailablePairId("");
    }

    applyWorkingZonesPreview(finalZonesPreview);

    saveFixtureSetup(
      {
        savingKey: "zones",
        skipReload: true,
        zonesStatus: "created",
        zonesPreview: finalZonesPreview,
      },
      selectedMode === "manual"
        ? "Se creo una base recomendada de zonas para que ahora el organizador las complete manualmente."
        : scheduledZonesResult.unassignedCount > 0
        ? `Las zonas quedaron creadas. ${scheduledZonesResult.unassignedCount} partido(s) no pudieron distribuirse y quedaron pendientes en naranja.`
        : "Las zonas ya quedaron visibles dentro del fixture."
    );
    handleChangeActiveSection("zones");
  };

  const handleCreateZonesPress = () => {
    if (!hasCreatedZones) {
      handleCreateZones();
      return;
    }

    setConfirmFixtureAction({
      title: "Volver a crear zonas",
      message:
        "Ya hay zonas creadas. Si continuas, se perderan los datos cargados y resultados de las zonas actuales.",
      confirmLabel: "Continuar",
      onConfirm: handleCreateZones,
    });
  };

  const handleCreateNewAutoZones = async () => {
    if (!tournament?.id) {
      return;
    }

    if (confirmedPairCount < 6) {
      setFeedback({
        visible: true,
        title: "Faltan parejas confirmadas",
        message: "Se necesitan al menos 6 parejas confirmadas para crear zonas automaticas.",
        tone: "warning",
      });
      return;
    }

    try {
      setSavingKey("zones");
      const nextZonePlanning = buildAutomaticZonePlanning(confirmedRegistrations, recommendation);
      const latestFixtureSetup = pendingFixtureSetupRef.current || fixtureSetup || {};
      const nextFixtureSetup = {
        ...latestFixtureSetup,
        lastViewedSection: "newzones",
        zonePlanning: nextZonePlanning,
      };

      await updateTournament(
        tournament.id,
        currentOrganizer,
        {
          fixtureSetup: nextFixtureSetup,
          zonePlanning: nextZonePlanning,
        },
        tournament
      );
      setTournament((current) =>
        current
          ? {
              ...current,
              fixtureSetup: {
                ...(current.fixtureSetup || {}),
                ...nextFixtureSetup,
              },
              zonePlanning: nextZonePlanning,
            }
          : current
      );
      pendingFixtureSetupRef.current = nextFixtureSetup;
      setZonePlanningDraft(null);
      setActiveSection("newzones");
      setFeedback({
        visible: true,
        title: "Zonas automaticas creadas",
        message: "Las zonas automaticas ya quedaron reflejadas en Nuevas zonas.",
        tone: "success",
      });
    } catch (error) {
      setFeedback({
        visible: true,
        title: "No pudimos crear las zonas",
        message: error?.message || "Intenta nuevamente en unos instantes.",
        tone: "danger",
      });
    } finally {
      setSavingKey("");
    }
  };

  const handleCreateNewAutoZonesPress = () => {
    if (!newZonePlanningZones.length) {
      handleCreateNewAutoZones();
      return;
    }

    setConfirmFixtureAction({
      title: "Volver a crear zonas automaticas",
      message:
        "Ya hay zonas en Nuevas zonas. Si continuas, se reemplazara ese armado automatico/manual guardado.",
      confirmLabel: "Continuar",
      onConfirm: handleCreateNewAutoZones,
    });
  };

  const persistZonePlanningUpdate = async (nextPlanning, options = {}) => {
    if (!tournament?.id || !nextPlanning) {
      return;
    }

    const shouldPersistFixtureSetup = Boolean(options.persistFixtureSetup);
    const latestFixtureSetup = pendingFixtureSetupRef.current || fixtureSetup || {};
    const nextFixtureSetup = {
      ...latestFixtureSetup,
      lastViewedSection: "newzones",
      zonePlanning: nextPlanning,
    };

    const updatedTournament = await updateTournament(
      tournament.id,
      currentOrganizer,
      shouldPersistFixtureSetup
        ? {
            fixtureSetup: nextFixtureSetup,
            zonePlanning: nextPlanning,
          }
        : { zonePlanning: nextPlanning },
      tournament
    );

    setTournament((current) =>
      current
        ? {
            ...current,
            ...updatedTournament,
            fixtureSetup: {
              ...(current.fixtureSetup || {}),
              ...nextFixtureSetup,
            },
            zonePlanning: nextPlanning,
          }
        : updatedTournament
    );
    pendingFixtureSetupRef.current = nextFixtureSetup;
  };

  const updateZonePlanningMatchSchedule = (zoneId, matchKey, partialSchedule = {}) => {
    const planningSource = activeZonePlanning || {};
    const nextPlanning = removeUndefinedFields({
      confirmed: Boolean(planningSource?.confirmed),
      updatedAtMillis: Date.now(),
      zones: (Array.isArray(planningSource?.zones) ? planningSource.zones : []).map((zone) =>
        zone.id !== zoneId
          ? zone
          : {
              ...zone,
              matchSchedules: {
                ...(zone.matchSchedules || {}),
                [matchKey]: {
                  ...(zone.matchSchedules?.[matchKey] || {}),
                  ...partialSchedule,
                },
              },
            }
      ),
    });

    setZonePlanningDraft(nextPlanning);
  };

  const handleSaveZonePlanningChanges = async () => {
    if (!zonePlanningDraft || !hasZonePlanningUnsavedChanges) {
      return;
    }

    const planningToSave = zonePlanningDraft;

    try {
      setSavingKey("newzones");
      await persistZonePlanningUpdate(planningToSave, { persistFixtureSetup: true });
      syncBracketFromZonePlanning(planningToSave);
      setZonePlanningDraft(null);
      setFeedback({
        visible: true,
        title: "Zonas guardadas",
        message: "Los cambios de Nuevas zonas quedaron guardados y sincronizados con Llaves.",
        tone: "success",
      });
    } catch (error) {
      console.log("[TournamentFixture] zonePlanning update error", {
        code: error?.code,
        message: error?.message,
        name: error?.name,
      });
      setFeedback({
        visible: true,
        title: "No pudimos guardar las zonas",
        message: error?.message || "Intenta nuevamente en unos instantes.",
        tone: "danger",
      });
    } finally {
      setSavingKey("");
    }
  };

  const openZonePlanningDayPicker = (zoneId, matchKey, currentDayKey = "") => {
    if (!tournamentDayOptions.length) {
      return;
    }

    setZonePlanningDayPickerTarget({
      currentDayKey,
      matchKey,
      zoneId,
    });
  };

  const closeZonePlanningDayPicker = () => {
    setZonePlanningDayPickerTarget(null);
  };

  const selectZonePlanningMatchDay = (dayKey = "") => {
    if (!zonePlanningDayPickerTarget?.zoneId || !zonePlanningDayPickerTarget?.matchKey || !dayKey) {
      return;
    }

    updateZonePlanningMatchSchedule(
      zonePlanningDayPickerTarget.zoneId,
      zonePlanningDayPickerTarget.matchKey,
      { dayKey }
    );
    closeZonePlanningDayPicker();
  };

  const cycleZonePlanningMatchVenue = (zoneId, matchKey, currentVenueId = "") => {
    if (!tournamentVenueOptions.length) {
      return;
    }

    const currentIndex = tournamentVenueOptions.findIndex((venue) => venue.id === currentVenueId);
    const nextVenue = tournamentVenueOptions[(currentIndex + 1) % tournamentVenueOptions.length];

    if (nextVenue?.id) {
      updateZonePlanningMatchSchedule(zoneId, matchKey, {
        venueId: nextVenue.id,
        venueLabel: nextVenue.label || nextVenue.name || "",
      });
    }
  };

  const handleZonePlanningTimePickerChange = (_, selectedDate) => {
    if (zonePlanningTimePickerTarget?.zoneId && zonePlanningTimePickerTarget?.matchKey && selectedDate) {
      const nextHours = formatTwoDigits(selectedDate.getHours());
      const nextMinutes = formatTwoDigits(selectedDate.getMinutes());
      updateZonePlanningMatchSchedule(
        zonePlanningTimePickerTarget.zoneId,
        zonePlanningTimePickerTarget.matchKey,
        { startTime: `${nextHours}:${nextMinutes}` }
      );
    }

    if (Platform.OS !== "ios") {
      setZonePlanningTimePickerTarget(null);
    }
  };

  const openZonePlanningResultEditor = (zoneId, matchKey) => {
    const planningSource = activeZonePlanning || {};
    const targetZone = (Array.isArray(planningSource?.zones) ? planningSource.zones : []).find(
      (zone) => zone.id === zoneId
    );

    if (!targetZone) {
      return;
    }

    const zoneRegistrations = (Array.isArray(targetZone.registrationIds) ? targetZone.registrationIds : [])
      .map((registrationId) => registrationsById.get(registrationId))
      .filter(Boolean);
    const pairNumbers = getPlanningMatchPairNumbers(targetZone, zoneRegistrations, matchKey);
    const participants = pairNumbers
      .map((pairNumber) => {
        const registration = zoneRegistrations[Number.parseInt(pairNumber, 10) - 1];

        if (!registration) {
          return null;
        }

        return {
          id: registration.id,
          label: formatShortPairLabel(registration.pairLabel || `Pareja ${pairNumber}`),
          number: pairNumber,
        };
      })
      .filter(Boolean);
    const schedule = targetZone.matchSchedules?.[matchKey] || {};

    setZonePlanningResultEditor({
      matchKey,
      participants,
      sets: normalizeResultSets(schedule?.result?.sets, currentMatchFormat.zones),
      winnerRegistrationId: String(schedule?.result?.winnerRegistrationId || ""),
      zoneId,
    });
  };

  const closeZonePlanningResultEditor = () => {
    setZonePlanningResultEditor(null);
  };

  const updateZonePlanningResultSetScore = (setIndex, value) => {
    setZonePlanningResultEditor((current) => {
      if (!current) {
        return current;
      }

      const allowDoubleDigits = shouldAllowDoubleDigitSetScore(
        currentMatchFormat.zones,
        setIndex,
        currentMatchFormat.zonesSuperTieBreakPoints
      );
      const parsedSet = parseCompactSetInput(value, allowDoubleDigits);

      return {
        ...current,
        sets: normalizeResultSets(current.sets, currentMatchFormat.zones).map((set, index) =>
          index === setIndex
            ? {
                ...set,
                ...parsedSet,
                inputValue: sanitizeSetInputValue(value, allowDoubleDigits),
              }
            : set
        ),
      };
    });
  };

  const saveZonePlanningResultEditor = () => {
    if (!zonePlanningResultEditor?.zoneId || !zonePlanningResultEditor?.matchKey) {
      closeZonePlanningResultEditor();
      return;
    }

    const sets = normalizeResultSets(zonePlanningResultEditor.sets, currentMatchFormat.zones);
    const hasScore = hasAnyResultSetScore(sets);
    const winner = (zonePlanningResultEditor.participants || []).find(
      (participant) => String(participant.id) === String(zonePlanningResultEditor.winnerRegistrationId)
    );

    if ((hasScore || zonePlanningResultEditor.winnerRegistrationId) && !winner) {
      setFeedback({
        visible: true,
        title: "Falta seleccionar ganador",
        message: "Para guardar un resultado cargado, selecciona la pareja ganadora.",
        tone: "danger",
      });
      return;
    }

    if (hasScore || winner) {
      const firstTwoSetsAreComplete = [0, 1].every((index) => Boolean(getSetWinnerSide(sets[index])));
      const thirdSetHasScore = Boolean(sets[2]?.teamA || sets[2]?.teamB);
      const thirdSetIsComplete = !thirdSetHasScore || Boolean(getSetWinnerSide(sets[2]));

      if (!firstTwoSetsAreComplete || !thirdSetIsComplete) {
        setFeedback({
          visible: true,
          title: "Resultado incompleto",
          message:
            currentMatchFormat.zones === "super_tiebreak"
              ? "SET 1, SET 2 y SUPER TIE BREAK, si se carga, deben tener ganador."
              : "SET 1 y SET 2 deben tener ganador. Si cargas SET 3, tambien debe tener ganador.",
          tone: "danger",
        });
        return;
      }
    }

    const resultText = buildPlanningResultTextFromSets(sets);
    updateZonePlanningMatchSchedule(zonePlanningResultEditor.zoneId, zonePlanningResultEditor.matchKey, {
      result: {
        score: resultText,
        sets,
        winnerLabel: winner?.label || "",
        winnerRegistrationId: winner?.id || "",
      },
      resultText,
    });
    closeZonePlanningResultEditor();
  };

  const handleCreateBracket = () => {
    if (hasZonePlanningUnsavedChanges) {
      setFeedback({
        visible: true,
        title: "Guarda las zonas",
        message: "Hay cambios sin guardar en Nuevas zonas. Guardalos antes de crear o actualizar llaves.",
        tone: "warning",
      });
      return;
    }

    const zonesForBracket = newZonesPreviewForBracket;

    if (!Array.isArray(zonesForBracket) || !zonesForBracket.length) {
      setFeedback({
        visible: true,
        title: "Primero crea las zonas",
        message: "Usa ARMADO AUTOMATICO o ARMADO MANUAL dentro de Nuevas zonas.",
        tone: "warning",
      });
      return;
    }

    if (bracketSaveTimeoutRef.current) {
      clearTimeout(bracketSaveTimeoutRef.current);
      bracketSaveTimeoutRef.current = null;
    }
    bracketSaveGenerationRef.current += 1;
    setBracketMatchPickerState({ roundId: "", matchId: "", field: "" });
    setBracketMatchTimePickerTarget(null);
    setBracketSwapSelection(null);
    bracketSetInputRefs.current = {};

    const baseBracketPreview = applyBracketProgressions(buildBracketPreview({
      mode: selectedMode,
      manualBracketMode: selectedManualBracketMode,
      recommendation,
      zonesPreview: zonesForBracket,
      ruleSet: tournamentRuleSet,
    }), resolveCurrentBracketRoundFormat);
    const draftBracketSchedules = normalizeZoneVenueSchedules(
      tournamentVenueOptions
        .map((venue) => {
          const venueDraft = scheduleVenueDrafts?.[venue.id] || {};

          if (!venueDraft.useForBracket) {
            return null;
          }

          return {
            id: `bracket-draft-schedule-${venue.id}`,
            venueId: venue.id,
            venueName: venue.name,
            dayKey: venueDraft.selectedDayKey,
            from: venueDraft.from,
            to: venueDraft.to,
            courts: venueDraft.courts,
            useForZones: Boolean(venueDraft.useForZones),
            useForBracket: true,
          };
        })
        .filter(Boolean),
      tournamentDayOptions,
      tournamentVenueOptions
    );
    const effectiveVenueSchedules = normalizeZoneVenueSchedules(
      [
        ...zoneVenueSchedules.filter((entry) => !entry.useForBracket),
        ...zoneVenueSchedules.filter((entry) => entry.useForBracket),
        ...draftBracketSchedules,
      ],
      tournamentDayOptions,
      tournamentVenueOptions
    );
    const scheduledBracketResult =
      effectiveVenueSchedules.some((entry) => entry.useForBracket)
        ? assignSchedulesToBracketMatches(baseBracketPreview, effectiveVenueSchedules)
        : { nextBracketPreview: baseBracketPreview, unassignedCount: 0 };
    const bracketPreview = {
      ...scheduledBracketResult.nextBracketPreview,
      zonePlanningSignature: buildZonePlanningSignature(activeZonePlanning),
    };
    const bracketCreationStats = (bracketPreview?.rounds || []).reduce(
      (stats, round) => {
        (round.matches || []).forEach((match) => {
          const isBye = Boolean(match.teamAIsBye || match.teamBIsBye);
          const hasSchedule = Boolean(match.scheduledDayKey && match.scheduledTime);
          const hasCourt = Boolean(
            String(match.courtLabel || "").trim() &&
              !String(match.courtLabel || "").toLowerCase().includes("pendiente")
          );
          const hasManualWinner = Boolean(match.result?.winner && match.result?.winnerSource !== "auto");
          const hasScores = (match.result?.sets || []).some(
            (set) => String(set?.teamA || "").trim() || String(set?.teamB || "").trim()
          );

          stats.total += 1;

          if (isBye) {
            stats.byes += 1;
            return;
          }

          if (hasSchedule && hasCourt) {
            stats.scheduled += 1;
          } else {
            stats.pending += 1;
          }

          if (hasManualWinner) {
            stats.manualWinners += 1;
          }
          if (hasScores) {
            stats.scoredMatches += 1;
          }
        });

        return stats;
      },
      { total: 0, byes: 0, scheduled: 0, pending: 0, manualWinners: 0, scoredMatches: 0 }
    );
    console.log("[TournamentFixture] Crear llaves", {
      tournamentId,
      ruleSet: tournamentRuleSet,
      zonesForBracket: zonesForBracket.map((zone) => ({
        bracketSourceName: zone.bracketSourceName || zone.name,
        id: zone.id,
        name: zone.name,
        qualifiedPairs: (zone.qualifiedPairs || []).map((pair) => pair.label || pair.pairLabel || pair.id),
        qualifiers: zone.qualifiers,
        size: zone.size,
      })),
      qualifierLabels: buildQualifiedEntriesFromZones(zonesForBracket).map((entry) => ({
        id: entry.id,
        seed: entry.seedLabel || entry.label,
        name: entry.displayName,
      })),
      rounds: (bracketPreview?.rounds || []).map((round) => ({
        matches: (round.matches || []).length,
        title: round.title,
      })),
      schedulesForBracket: effectiveVenueSchedules.filter((entry) => entry.useForBracket).length,
      durationMinutes: currentZoneMatchDurationMinutes,
      ...bracketCreationStats,
    });
    if (!bracketCreationStats.total) {
      setFeedback({
        visible: true,
        title: "No se crearon las llaves",
        message:
          "La app no pudo generar cruces con las zonas actuales. Revisa que las zonas tengan resultados/clasificados y vuelve a intentarlo.",
        tone: "danger",
      });
      return;
    }
    if (effectiveVenueSchedules !== zoneVenueSchedules) {
      setZoneVenueSchedules(effectiveVenueSchedules);
    }
    setBracketDraft(bracketPreview);
    workingBracketPreviewRef.current = bracketPreview;
    pendingFixtureSetupRef.current = {
      ...(pendingFixtureSetupRef.current || fixtureSetup),
      bracketPreview,
      bracketStatus: bracketPreview.mode === "manual" ? "manual_ready" : "automatic_ready",
      lastViewedSection: "bracket",
      zonesPreview: zonesForBracket,
      zoneVenueSchedules: effectiveVenueSchedules,
    };
    setTournament((current) =>
      current
        ? {
            ...current,
            buildMode: selectedMode,
            fixtureSetup: {
              ...(current.fixtureSetup || {}),
              ...(pendingFixtureSetupRef.current || {}),
            },
          }
        : current
    );

    saveFixtureSetup(
      {
        savingKey: "bracket",
        skipReload: true,
        bracketSaveGeneration: bracketSaveGenerationRef.current,
        bracketStatus: bracketPreview.mode === "manual" ? "manual_ready" : "automatic_ready",
        bracketPreview,
        lastViewedSection: "bracket",
        zonesPreview: zonesForBracket,
        zoneVenueSchedules: effectiveVenueSchedules,
      },
      bracketPreview.mode === "manual"
        ? `Llaves creadas: ${bracketCreationStats.total} partido(s). Quedaron listas para completar manualmente.`
        : `Llaves creadas: ${bracketCreationStats.total} partido(s). ${bracketCreationStats.scheduled} programado(s), ${bracketCreationStats.pending} pendiente(s) y ${bracketCreationStats.byes} BYE.`
    );
    setActiveSection("bracket");
  };

  const handleCreateBracketPress = () => {
    if (!hasCreatedBracket) {
      handleCreateBracket();
      return;
    }

    setConfirmFixtureAction({
      title: "Volver a crear llaves",
      message:
        "Ya hay llaves creadas. Si continuas, se perderan los datos cargados y resultados de las llaves actuales.",
      confirmLabel: "Continuar",
      onConfirm: handleCreateBracket,
    });
  };

  const handleConfirmFixtureAction = () => {
    const nextAction = confirmFixtureAction?.onConfirm;
    setConfirmFixtureAction(null);
    nextAction?.();
  };

  const handleToggleBracketWinner = (roundId, matchId, winnerKey) => {
    const baseBracketPreview = workingBracketPreviewRef.current || currentBracketPreview || {};
    const nextBracketPreview = applyBracketProgressions({
      ...baseBracketPreview,
      rounds: (baseBracketPreview?.rounds || []).map((round) =>
        round.id !== roundId
          ? round
          : {
              ...round,
              matches: (round.matches || []).map((match) =>
                match.id !== matchId
                  ? match
                  : {
                      ...match,
                      result: {
                        ...(match.result || buildDefaultBracketResult(resolveCurrentBracketRoundFormat(round))),
                        sets: normalizeResultSets(
                          match.result?.sets,
                          resolveCurrentBracketRoundFormat(round)
                        ),
                        winnerSource: match.result?.winner === winnerKey ? "" : "manual",
                        winner: match.result?.winner === winnerKey ? "" : winnerKey,
                      },
                    }
              ),
            }
      ),
    }, resolveCurrentBracketRoundFormat);

    setBracketDraft(nextBracketPreview);
    workingBracketPreviewRef.current = nextBracketPreview;
    scheduleBracketSave(nextBracketPreview);
  };

  const openBracketResultEditor = (roundId, matchId, renderedRound = null, renderedMatch = null) => {
    const baseBracketPreview = workingBracketPreviewRef.current || currentBracketPreview || {};
    const targetRound =
      (baseBracketPreview?.rounds || []).find((round) => round.id === roundId) ||
      renderedRound;
    const targetMatch =
      (targetRound?.matches || []).find((match) => match.id === matchId) ||
      renderedMatch;

    if (!targetRound || !targetMatch) {
      setFeedback({
        visible: true,
        title: "No pudimos abrir el resultado",
        message: "No se encontro este partido en las llaves actuales.",
        tone: "danger",
      });
      return;
    }

    if (targetMatch.teamAIsBye || targetMatch.teamBIsBye) {
      return;
    }

    const roundFormat = resolveCurrentBracketRoundFormat(targetRound);

    setBracketResultEditor({
      canClearCrossing: Boolean(targetMatch.teamASourceMatchId || targetMatch.teamBSourceMatchId),
      matchId,
      roundId,
      roundTitle: targetRound.title || targetRound.roundTitle || "Llave",
      sets: normalizeResultSets(targetMatch.result?.sets, roundFormat),
      teamASeed: getBracketTeamSeedDisplay(targetMatch, "teamA") || "A",
      teamAName:
        getBracketTeamDisplayLines(targetMatch, "teamA").join(" / ") ||
        getBracketTeamSeedDisplay(targetMatch, "teamA") ||
        "Pareja A",
      teamBSeed: getBracketTeamSeedDisplay(targetMatch, "teamB") || "B",
      teamBName:
        getBracketTeamDisplayLines(targetMatch, "teamB").join(" / ") ||
        getBracketTeamSeedDisplay(targetMatch, "teamB") ||
        "Pareja B",
      winner: String(targetMatch.result?.winner || ""),
    });
  };

  const closeBracketResultEditor = () => {
    setBracketResultEditor(null);
  };

  const updateBracketEditorMatch = (matchUpdater) => {
    if (!bracketResultEditor?.roundId || !bracketResultEditor?.matchId) {
      closeBracketResultEditor();
      return;
    }

    const baseBracketPreview = workingBracketPreviewRef.current || currentBracketPreview || {};
    const nextBracketPreview = applyBracketProgressions(
      {
        ...baseBracketPreview,
        rounds: (baseBracketPreview?.rounds || []).map((round) =>
          round.id !== bracketResultEditor.roundId
            ? round
            : {
                ...round,
                matches: (round.matches || []).map((match) =>
                  match.id === bracketResultEditor.matchId
                    ? matchUpdater(match, round)
                    : match
                ),
              }
        ),
      },
      resolveCurrentBracketRoundFormat
    );

    setBracketDraft(nextBracketPreview);
    workingBracketPreviewRef.current = nextBracketPreview;
    scheduleBracketSave(nextBracketPreview);
    closeBracketResultEditor();
  };

  const clearBracketEditorResult = () => {
    updateBracketEditorMatch((match, round) => ({
      ...match,
      result: buildDefaultBracketResult(resolveCurrentBracketRoundFormat(round)),
      resultLabel: "Resultado pendiente",
    }));
  };

  const clearBracketEditorCrossing = () => {
    if (!bracketResultEditor?.canClearCrossing) {
      setFeedback({
        visible: true,
        title: "No se puede limpiar el cruce",
        message:
          "Este cruce contiene parejas que vienen directo de Nuevas zonas. Solo se puede limpiar un cruce que espera ganadores de llaves anteriores.",
        tone: "danger",
      });
      return;
    }

    updateBracketEditorMatch((match, round) => ({
      ...match,
      ...(match.teamASourceMatchId
        ? {
            teamAId: "",
            teamASeed: "",
            teamAName: "",
            teamALines: [],
            teamAIsBye: false,
          }
        : null),
      ...(match.teamBSourceMatchId
        ? {
            teamBId: "",
            teamBSeed: "",
            teamBName: "",
            teamBLines: [],
            teamBIsBye: false,
          }
        : null),
      result: buildDefaultBracketResult(resolveCurrentBracketRoundFormat(round)),
      resultLabel: "Resultado pendiente",
    }));
  };

  const updateBracketResultEditorSetScore = (setIndex, value) => {
    const baseBracketPreview = workingBracketPreviewRef.current || currentBracketPreview || {};
    const targetRound = (baseBracketPreview?.rounds || []).find(
      (round) => round.id === bracketResultEditor?.roundId
    );
    const roundFormat = resolveCurrentBracketRoundFormat(targetRound);
    const allowDoubleDigits = shouldAllowDoubleDigitSetScore(
      roundFormat,
      setIndex,
      currentMatchFormat.bracketSuperTieBreakPoints
    );
    const parsedSet = parseCompactSetInput(value, allowDoubleDigits);
    const sanitizedValue = String(value || "").replace(/[^\d/]/g, "");
    const digitsCount = sanitizedValue.replace(/\D/g, "").length;
    const shouldAdvanceField =
      setIndex < 2 &&
      Boolean(parsedSet.teamA && parsedSet.teamB) &&
      (sanitizedValue.includes("/") || digitsCount >= (allowDoubleDigits ? 4 : 2));

    setBracketResultEditor((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        sets: normalizeResultSets(current.sets, roundFormat).map((set, index) =>
          index === setIndex
            ? {
                ...set,
                ...parsedSet,
                inputValue: sanitizeSetInputValue(value, allowDoubleDigits),
              }
            : set
        ),
      };
    });

    if (shouldAdvanceField) {
      focusBracketResultField(`bracket-result-editor-${setIndex + 1}`);
    }
  };

  const saveBracketResultEditor = () => {
    if (!bracketResultEditor?.roundId || !bracketResultEditor?.matchId) {
      closeBracketResultEditor();
      return;
    }

    const baseBracketPreview = workingBracketPreviewRef.current || currentBracketPreview || {};
    const targetRound = (baseBracketPreview?.rounds || []).find(
      (round) => round.id === bracketResultEditor.roundId
    );
    const roundFormat = resolveCurrentBracketRoundFormat(targetRound);
    const sets = normalizeResultSets(bracketResultEditor.sets, roundFormat);
    const hasScore = hasAnyResultSetScore(sets);

    if ((hasScore || bracketResultEditor.winner) && !bracketResultEditor.winner) {
      setFeedback({
        visible: true,
        title: "Falta seleccionar ganador",
        message: "Para guardar un resultado cargado, selecciona la pareja ganadora.",
        tone: "danger",
      });
      return;
    }

    if (hasScore || bracketResultEditor.winner) {
      const firstTwoSetsAreComplete = [0, 1].every((index) => Boolean(getSetWinnerSide(sets[index])));
      const thirdSetHasScore = Boolean(sets[2]?.teamA || sets[2]?.teamB);
      const thirdSetIsComplete = !thirdSetHasScore || Boolean(getSetWinnerSide(sets[2]));

      if (!firstTwoSetsAreComplete || !thirdSetIsComplete) {
        setFeedback({
          visible: true,
          title: "Resultado incompleto",
          message:
            roundFormat === "super_tiebreak"
              ? "SET 1, SET 2 y SUPER TIE BREAK, si se carga, deben tener ganador."
              : "SET 1 y SET 2 deben tener ganador. Si cargas SET 3, tambien debe tener ganador.",
          tone: "danger",
        });
        return;
      }
    }

    const nextBracketPreview = applyBracketProgressions(
      {
        ...baseBracketPreview,
        rounds: (baseBracketPreview?.rounds || []).map((round) =>
          round.id !== bracketResultEditor.roundId
            ? round
            : {
                ...round,
                matches: (round.matches || []).map((match) =>
                  match.id !== bracketResultEditor.matchId
                    ? match
                    : {
                        ...match,
                        result: {
                          ...(match.result || buildDefaultBracketResult(resolveCurrentBracketRoundFormat(round))),
                          sets,
                          winner: bracketResultEditor.winner,
                          winnerSource: bracketResultEditor.winner ? "manual" : "",
                        },
                        resultLabel: hasScore
                          ? "Resultado cargado"
                          : bracketResultEditor.winner
                          ? `Ganador marcado: ${
                              bracketResultEditor.winner === "teamA" ? match.teamASeed : match.teamBSeed
                            }`
                          : "Resultado pendiente",
                      }
                ),
              }
        ),
      },
      resolveCurrentBracketRoundFormat
    );

    setBracketDraft(nextBracketPreview);
    workingBracketPreviewRef.current = nextBracketPreview;
    scheduleBracketSave(nextBracketPreview);
    closeBracketResultEditor();
  };

  const handleBracketSetChange = (roundId, matchId, setIndex, value) => {
    const baseBracketPreview = workingBracketPreviewRef.current || currentBracketPreview || {};
    const round = (baseBracketPreview?.rounds || []).find((item) => item.id === roundId);
    const roundFormat = resolveCurrentBracketRoundFormat(round);
    const allowDoubleDigits = shouldAllowDoubleDigitSetScore(
      roundFormat,
      setIndex,
      currentMatchFormat.bracketSuperTieBreakPoints
    );
    const parsedSet = parseCompactSetInput(value, allowDoubleDigits);
    const sanitizedValue = String(value || "").replace(/[^\d/]/g, "");
    const digitsCount = sanitizedValue.replace(/\D/g, "").length;
    const isCompleteValue =
      Boolean(parsedSet.teamA && parsedSet.teamB) &&
      (sanitizedValue.includes("/") || digitsCount >= (allowDoubleDigits ? 4 : 2));
    const nextInputValue = allowDoubleDigits
      ? isCompleteValue
        ? `${parsedSet.teamA}/${parsedSet.teamB}`
        : sanitizeSetInputValue(value, allowDoubleDigits)
      : parsedSet.teamA && parsedSet.teamB
      ? `${parsedSet.teamA}/${parsedSet.teamB}`
      : parsedSet.teamA;
    const nextBracketPreview = applyBracketProgressions({
      ...baseBracketPreview,
      rounds: (baseBracketPreview?.rounds || []).map((currentRound) =>
        currentRound.id !== roundId
          ? currentRound
          : {
              ...currentRound,
              matches: (currentRound.matches || []).map((match) =>
                match.id !== matchId
                  ? match
                  : {
                      ...match,
                      result: {
                        ...(match.result || buildDefaultBracketResult(resolveCurrentBracketRoundFormat(currentRound))),
                        winnerSource: match.result?.winnerSource || "",
                        sets: normalizeResultSets(
                          match.result?.sets,
                          resolveCurrentBracketRoundFormat(currentRound)
                        ).map((set, index) =>
                          index === setIndex
                            ? {
                                ...set,
                                teamA: parsedSet.teamA,
                                teamB: parsedSet.teamB,
                                inputValue: nextInputValue,
                              }
                            : set
                        ),
                      },
                    }
              ),
            }
      ),
    }, resolveCurrentBracketRoundFormat);

    setBracketDraft(nextBracketPreview);
    workingBracketPreviewRef.current = nextBracketPreview;
    scheduleBracketSave(nextBracketPreview);

    if (
      (sanitizedValue.includes("/") && parsedSet.teamA && parsedSet.teamB) ||
      String(value || "").replace(/[^0-9]/g, "").length >= (allowDoubleDigits ? 4 : 2)
    ) {
      focusBracketResultField(`${roundId}-${matchId}-${setIndex + 1}`);
    }
  };

  const focusBracketResultField = useCallback((fieldKey) => {
    const nextRef = bracketSetInputRefs.current[fieldKey];

    if (nextRef?.focus) {
      setTimeout(() => nextRef.focus(), 0);
    }
  }, []);

  const focusZoneResultField = useCallback((fieldKey) => {
    const nextRef = zoneSetInputRefs.current[fieldKey];

    if (nextRef?.focus) {
      setTimeout(() => nextRef.focus(), 0);
    }
  }, []);

  const getNextBracketResultFieldKey = useCallback(
    (roundId, matchId, currentSetIndex, roundFormat) => {
      const nextSetIndex = Number(currentSetIndex || 0) + 1;
      const setDefinitions = getSetDefinitionsForFormat(roundFormat);

      if (nextSetIndex >= setDefinitions.length) {
        return "";
      }

      const nextSetAllowsDoubleDigits = shouldAllowDoubleDigitSetScore(
        roundFormat,
        nextSetIndex,
        currentMatchFormat.bracketSuperTieBreakPoints
      );

      return `${roundId}-${matchId}-${nextSetIndex}-a`;
    },
    [currentMatchFormat.bracketSuperTieBreakPoints]
  );

  const getNextZoneResultFieldKey = useCallback(
    (zoneId, matchId, currentSetIndex) => {
      const nextSetIndex = Number(currentSetIndex || 0) + 1;
      const setDefinitions = getSetDefinitionsForFormat(currentMatchFormat.zones);

      if (nextSetIndex >= setDefinitions.length) {
        return "";
      }

      const nextSetAllowsDoubleDigits = shouldAllowDoubleDigitSetScore(
        currentMatchFormat.zones,
        nextSetIndex,
        currentMatchFormat.zonesSuperTieBreakPoints
      );

      return nextSetAllowsDoubleDigits
        ? `${zoneId}-${matchId}-${nextSetIndex}-a`
        : `${zoneId}-${matchId}-${nextSetIndex}`;
    },
    [currentMatchFormat.zones, currentMatchFormat.zonesSuperTieBreakPoints]
  );

  const handleBracketSplitScoreChange = (roundId, matchId, setIndex, teamKey, value) => {
    const normalizedTeamKey = teamKey === "teamB" ? "teamB" : "teamA";
    const baseBracketPreview = workingBracketPreviewRef.current || currentBracketPreview || {};
    const round = (baseBracketPreview?.rounds || []).find((item) => item.id === roundId);
    const roundFormat = resolveCurrentBracketRoundFormat(round);
    const allowDoubleDigits = shouldAllowDoubleDigitSetScore(
      roundFormat,
      setIndex,
      currentMatchFormat.bracketSuperTieBreakPoints
    );
    const maxDigits = allowDoubleDigits ? 2 : 1;
    const nextValue = String(value || "").replace(/\D/g, "").slice(0, maxDigits);

    const nextBracketPreview = applyBracketProgressions(
      {
        ...baseBracketPreview,
        rounds: (baseBracketPreview?.rounds || []).map((currentRound) =>
          currentRound.id !== roundId
            ? currentRound
            : {
                ...currentRound,
                matches: (currentRound.matches || []).map((match) =>
                  match.id !== matchId
                    ? match
                    : {
                        ...match,
                        result: {
                          ...(match.result || buildDefaultBracketResult(resolveCurrentBracketRoundFormat(currentRound))),
                          winnerSource: match.result?.winnerSource || "",
                          sets: normalizeResultSets(
                            match.result?.sets,
                            resolveCurrentBracketRoundFormat(currentRound)
                          ).map((set, index) =>
                            index === setIndex
                              ? {
                                  ...set,
                                  teamA: normalizedTeamKey === "teamA" ? nextValue : String(set.teamA || ""),
                                  teamB: normalizedTeamKey === "teamB" ? nextValue : String(set.teamB || ""),
                                  inputValue: "",
                                }
                              : set
                          ),
                        },
                      }
                ),
              }
        ),
      },
      resolveCurrentBracketRoundFormat
    );

    setBracketDraft(nextBracketPreview);
    workingBracketPreviewRef.current = nextBracketPreview;
    scheduleBracketSave(nextBracketPreview);

    if (nextValue.length >= maxDigits && normalizedTeamKey === "teamA") {
      focusBracketResultField(`${roundId}-${matchId}-${setIndex}-b`);
    }

    if (nextValue.length >= maxDigits && normalizedTeamKey === "teamB") {
      const nextFieldKey = getNextBracketResultFieldKey(roundId, matchId, setIndex, roundFormat);

      if (nextFieldKey) {
        focusBracketResultField(nextFieldKey);
      }
    }
  };

  const handleAssignPairToZone = (zoneId) => {
    if (!selectedAvailablePairId) {
      return;
    }

    const selectedPair = availablePairs.find((pair) => pair.id === selectedAvailablePairId);

    if (!selectedPair) {
      return;
    }

    setManualZonesDraft((current) =>
      decorateZonesWithMatches(
        current.map((zone) => {
          if (zone.id !== zoneId || (zone.pairs || []).length >= Number(zone.size || 0)) {
            return zone;
          }

          return {
            ...zone,
            pairs: [...(zone.pairs || []), selectedPair],
          };
        }),
        currentMatchFormat.zones
      )
    );
    setSelectedAvailablePairId("");
  };

  const handleRemovePairFromZone = (zoneId, pairId) => {
    setManualZonesDraft((current) =>
      decorateZonesWithMatches(
        current.map((zone) =>
          zone.id === zoneId
            ? {
                ...zone,
                pairs: (zone.pairs || []).filter((pair) => pair.id !== pairId),
              }
            : zone
        ),
        currentMatchFormat.zones
      )
    );
  };

  const handleAddManualZone = () => {
    setManualZonesDraft((current) => decorateZonesWithMatches([
      ...current,
      {
        id: `zone-${current.length + 1}`,
        name: `Zona ${String.fromCharCode(65 + current.length)}`,
        size: 3,
        qualifiers: 2,
        pairs: [],
      },
    ], currentMatchFormat.zones));
  };

  const handleRemoveLastManualZone = () => {
    setManualZonesDraft((current) => current.slice(0, -1));
  };

  const handleSaveManualZones = () => {
    const zonesWithMatches = decorateZonesWithMatches(manualZonesDraft, currentMatchFormat.zones);
    setZoneDraft(zonesWithMatches);

    saveFixtureSetup(
      {
        savingKey: "zones",
        skipReload: true,
        zonesStatus: "created",
        zonesPreview: zonesWithMatches,
      },
      "Las zonas manuales quedaron guardadas dentro del fixture."
    );
  };

  const applyWorkingZonesPreview = useCallback(
    (nextZonesPreview) => {
      setZoneDraft(nextZonesPreview);
      workingZonesPreviewRef.current = nextZonesPreview;
      pendingFixtureSetupRef.current = {
        ...(pendingFixtureSetupRef.current || {}),
        zonesPreview: nextZonesPreview,
      };

      if (selectedMode === "manual") {
        setManualZonesDraft(nextZonesPreview);
      }

      setTournament((current) =>
        current
          ? {
              ...current,
              fixtureSetup: {
                ...(current.fixtureSetup || {}),
                zonesPreview: nextZonesPreview,
              },
            }
          : current
      );
    },
    [selectedMode]
  );

  const toggleZoneExpanded = (zoneId) => {
    setExpandedZoneIds((current) =>
      current.includes(zoneId)
        ? current.filter((item) => item !== zoneId)
        : [...current, zoneId]
    );
  };

  const handleToggleZoneMatchWinner = (zoneId, matchId, winnerKey) => {
    if (!winnerKey) {
      return;
    }

    const baseZonesPreview =
      Array.isArray(workingZonesPreviewRef.current) && workingZonesPreviewRef.current.length
        ? workingZonesPreviewRef.current
        : zonesPreview || [];
    const nextZonesPreview = baseZonesPreview.map((zone) => {
      if (zone.id !== zoneId) {
        return zone;
      }

      return {
        ...zone,
        matches: (zone.matches || []).map((match) => {
          if (match.id !== matchId) {
            return match;
          }

          const nextWinner = match.result?.winner === winnerKey ? "" : winnerKey;

          return {
            ...match,
            result: {
              ...(match.result || buildDefaultZoneResult(currentMatchFormat.zones)),
              sets: normalizeResultSets(match.result?.sets, currentMatchFormat.zones),
              winnerSource: nextWinner ? "manual" : "",
              winner: nextWinner,
            },
            resultLabel: nextWinner
              ? `Ganador marcado: ${nextWinner === "teamA" ? match.teamASeed : match.teamBSeed}`
              : "Resultado pendiente",
          };
        }),
      };
    });

    applyWorkingZonesPreview(nextZonesPreview);
    scheduleZonesSave(nextZonesPreview);
  };

  const handleZoneMatchScoreChange = (zoneId, matchId, setIndex, value) => {
    const allowDoubleDigits = shouldAllowDoubleDigitSetScore(
      currentMatchFormat.zones,
      setIndex,
      currentMatchFormat.zonesSuperTieBreakPoints
    );
    const parsedSet = parseCompactSetInput(value, allowDoubleDigits);
    const sanitizedValue = String(value || "").replace(/[^\d/]/g, "");
    const digitsCount = sanitizedValue.replace(/\D/g, "").length;
    const isCompleteValue =
      Boolean(parsedSet.teamA && parsedSet.teamB) &&
      (sanitizedValue.includes("/") || digitsCount >= (allowDoubleDigits ? 4 : 2));
    const nextInputValue = allowDoubleDigits
      ? isCompleteValue
        ? `${parsedSet.teamA}/${parsedSet.teamB}`
        : sanitizeSetInputValue(value, allowDoubleDigits)
      : parsedSet.teamA && parsedSet.teamB
      ? `${parsedSet.teamA}/${parsedSet.teamB}`
      : parsedSet.teamA;
    const baseZonesPreview =
      Array.isArray(workingZonesPreviewRef.current) && workingZonesPreviewRef.current.length
        ? workingZonesPreviewRef.current
        : zonesPreview || [];
    const nextZonesPreview = baseZonesPreview.map((zone) => {
      if (zone.id !== zoneId) {
        return zone;
      }

      return {
        ...zone,
        matches: (zone.matches || []).map((match) => {
          if (match.id !== matchId) {
            return match;
          }

          const nextSets = normalizeResultSets(match.result?.sets, currentMatchFormat.zones).map((set, index) =>
            index === setIndex
              ? {
                  ...set,
                  teamA: parsedSet.teamA,
                  teamB: parsedSet.teamB,
                  inputValue: nextInputValue,
                }
              : set
          );
          const hasScores = nextSets.some((set) => set.teamA || set.teamB);
          const nextResult = {
            ...(match.result || {}),
            winnerSource: match.result?.winnerSource || "",
            sets: nextSets,
          };

          return {
            ...match,
            result: nextResult,
            resultLabel: hasScores
              ? "Resultado cargado"
              : match.result?.winner
              ? `Ganador marcado: ${match.result.winner === "teamA" ? match.teamASeed : match.teamBSeed}`
              : "Resultado pendiente",
          };
        }),
      };
    });

    applyWorkingZonesPreview(nextZonesPreview);
    scheduleZonesSave(nextZonesPreview);

    if (
      (sanitizedValue.includes("/") && parsedSet.teamA && parsedSet.teamB) ||
      String(value || "").replace(/[^0-9]/g, "").length >= (allowDoubleDigits ? 4 : 2)
    ) {
      const nextFieldKey = getNextZoneResultFieldKey(zoneId, matchId, setIndex);

      if (nextFieldKey) {
        focusZoneResultField(nextFieldKey);
      }
    }
  };

  const handleZoneMatchSplitScoreChange = (zoneId, matchId, setIndex, teamKey, value) => {
    const normalizedTeamKey = teamKey === "teamB" ? "teamB" : "teamA";
    const nextValue = String(value || "").replace(/\D/g, "").slice(0, 2);
    const baseZonesPreview =
      Array.isArray(workingZonesPreviewRef.current) && workingZonesPreviewRef.current.length
        ? workingZonesPreviewRef.current
        : zonesPreview || [];

    const nextZonesPreview = baseZonesPreview.map((zone) => {
      if (zone.id !== zoneId) {
        return zone;
      }

      return {
        ...zone,
        matches: (zone.matches || []).map((match) => {
          if (match.id !== matchId) {
            return match;
          }

          const nextSets = normalizeResultSets(match.result?.sets, currentMatchFormat.zones).map(
            (set, index) =>
              index === setIndex
                ? {
                    ...set,
                    teamA: normalizedTeamKey === "teamA" ? nextValue : String(set.teamA || ""),
                    teamB: normalizedTeamKey === "teamB" ? nextValue : String(set.teamB || ""),
                    inputValue: "",
                  }
                : set
          );
          const hasScores = nextSets.some((set) => set.teamA || set.teamB);

          return {
            ...match,
            result: {
              ...(match.result || {}),
              winnerSource: match.result?.winnerSource || "",
              sets: nextSets,
            },
            resultLabel: hasScores
              ? "Resultado cargado"
              : match.result?.winner
              ? `Ganador marcado: ${match.result.winner === "teamA" ? match.teamASeed : match.teamBSeed}`
              : "Resultado pendiente",
          };
        }),
      };
    });

    applyWorkingZonesPreview(nextZonesPreview);
    scheduleZonesSave(nextZonesPreview);
  };

  const handleUpdateZoneMatchScheduleField = (zoneId, matchId, field, value) => {
    const baseZonesPreview =
      Array.isArray(workingZonesPreviewRef.current) && workingZonesPreviewRef.current.length
        ? workingZonesPreviewRef.current
        : zonesPreview || [];
    const nextZonesPreview = baseZonesPreview.map((zone) => {
      if (zone.id !== zoneId) {
        return zone;
      }

      return {
        ...zone,
        matches: (zone.matches || []).map((match) => {
          if (match.id !== matchId) {
            return match;
          }

          const nextScheduledDayKey =
            field === "scheduledDayKey" ? String(value || "") : String(match.scheduledDayKey || "");
          const nextScheduledTime =
            field === "scheduledTime" ? String(value || "") : String(match.scheduledTime || "");
          const nextScheduleLabel =
            nextScheduledDayKey || nextScheduledTime
              ? `${nextScheduledDayKey
                  ? formatScheduleDayDisplay(nextScheduledDayKey, tournamentDayOptions)
                  : "Sin dia"} · ${nextScheduledTime ? `${nextScheduledTime} hs` : "Sin horario"}`
              : "Horario pendiente";

          return {
            ...match,
            [field]: String(value || ""),
            scheduleLabel: nextScheduleLabel,
            distributionPending: !(nextScheduledDayKey && nextScheduledTime),
          };
        }),
      };
    });

    applyWorkingZonesPreview(nextZonesPreview);
    scheduleZonesSave(nextZonesPreview);
    setZoneMatchPickerState({ zoneId: "", matchId: "", field: "" });
  };

  const handleUpdateZoneMatchCourt = (zoneId, matchId, courtLabel) => {
    const baseZonesPreview =
      Array.isArray(workingZonesPreviewRef.current) && workingZonesPreviewRef.current.length
        ? workingZonesPreviewRef.current
        : zonesPreview || [];
    const nextZonesPreview = baseZonesPreview.map((zone) => {
      if (zone.id !== zoneId) {
        return zone;
      }

      return {
        ...zone,
        matches: (zone.matches || []).map((match) =>
          match.id !== matchId
            ? match
            : {
                ...match,
                courtLabel: String(courtLabel || ""),
              }
        ),
      };
    });

    applyWorkingZonesPreview(nextZonesPreview);
    scheduleZonesSave(nextZonesPreview);
    setZoneMatchPickerState({ zoneId: "", matchId: "", field: "" });
  };

  const handleZoneMatchTimePickerChange = useCallback(
    (_, selectedDate) => {
      if (zoneMatchTimePickerTarget?.zoneId && zoneMatchTimePickerTarget?.matchId && selectedDate) {
        const nextHours = formatTwoDigits(selectedDate.getHours());
        const nextMinutes = formatTwoDigits(selectedDate.getMinutes());
        handleUpdateZoneMatchScheduleField(
          zoneMatchTimePickerTarget.zoneId,
          zoneMatchTimePickerTarget.matchId,
          "scheduledTime",
          `${nextHours}:${nextMinutes}`
        );
      }

      if (Platform.OS !== "ios") {
        setZoneMatchTimePickerTarget(null);
      }
    },
    [zoneMatchTimePickerTarget]
  );

  const handleUpdateBracketMatchScheduleField = (roundId, matchId, field, value) => {
    const baseBracketPreview = workingBracketPreviewRef.current || currentBracketPreview || {};
    const nextBracketPreview = applyBracketProgressions(
      {
        ...baseBracketPreview,
        rounds: (baseBracketPreview?.rounds || []).map((round) =>
          round.id !== roundId
            ? round
            : {
                ...round,
                matches: (round.matches || []).map((match) => {
                  if (match.id !== matchId) {
                    return match;
                  }

                  const nextScheduledDayKey =
                    field === "scheduledDayKey"
                      ? String(value || "")
                      : String(match.scheduledDayKey || "");
                  const nextScheduledTime =
                    field === "scheduledTime" ? String(value || "") : String(match.scheduledTime || "");
                  const nextScheduleLabel =
                    nextScheduledDayKey || nextScheduledTime
                      ? `${nextScheduledDayKey
                          ? formatScheduleDayDisplay(nextScheduledDayKey, tournamentDayOptions)
                          : "Dia a confirmar"} · ${
                          nextScheduledTime ? `${nextScheduledTime} hs` : "Hora a confirmar"
                        }`
                      : "Horario pendiente";

                  return {
                    ...match,
                    [field]: String(value || ""),
                    scheduleLabel: nextScheduleLabel,
                  };
                }),
              }
        ),
      },
      resolveCurrentBracketRoundFormat
    );

    setBracketDraft(nextBracketPreview);
    workingBracketPreviewRef.current = nextBracketPreview;
    scheduleBracketSave(nextBracketPreview);
    setBracketMatchPickerState({ roundId: "", matchId: "", field: "" });
  };

  const handleUpdateBracketMatchCourt = (roundId, matchId, courtSelection) => {
    const baseBracketPreview = workingBracketPreviewRef.current || currentBracketPreview || {};
    const courtLabel =
      typeof courtSelection === "string"
        ? courtSelection
        : String(courtSelection?.value || "");
    const parsedCourt = splitCourtLabelPartsSafe(courtLabel);
    const selectedVenueId =
      typeof courtSelection === "string"
        ? ""
        : String(courtSelection?.venueId || "").trim();
    const selectedVenueName =
      typeof courtSelection === "string"
        ? parsedCourt.venueName
        : String(courtSelection?.venueName || parsedCourt.venueName || "").trim();
    const fallbackVenue = tournamentVenueOptions.find(
      (venue) =>
        String(venue.id || "").trim() === selectedVenueId ||
        String(venue.name || venue.label || "").trim().toLowerCase() ===
          selectedVenueName.trim().toLowerCase()
    );
    const nextVenueId = selectedVenueId || String(fallbackVenue?.id || "").trim();
    const nextBracketPreview = {
      ...baseBracketPreview,
      rounds: (baseBracketPreview?.rounds || []).map((round) =>
        round.id !== roundId
          ? round
          : {
              ...round,
              matches: (round.matches || []).map((match) =>
                match.id !== matchId
                  ? match
                  : {
                      ...match,
                      courtLabel: String(courtLabel || ""),
                      venueId: nextVenueId || String(match.venueId || ""),
                    }
              ),
            }
      ),
    };

    setBracketDraft(nextBracketPreview);
    workingBracketPreviewRef.current = nextBracketPreview;
    scheduleBracketSave(nextBracketPreview);
    setBracketMatchPickerState({ roundId: "", matchId: "", field: "" });
  };

  const handleClearBracketCourts = () => {
    const baseBracketPreview = workingBracketPreviewRef.current || currentBracketPreview || {};
    const venueNameById = new Map(
      tournamentVenueOptions.map((venue) => [
        String(venue.id || ""),
        String(venue.name || venue.nombre || "").trim(),
      ])
    );
    const scheduleVenueNameById = new Map(
      zoneVenueSchedules.map((entry) => [
        String(entry.venueId || ""),
        String(entry.venueName || "").trim(),
      ])
    );
    const nextBracketPreview = {
      ...baseBracketPreview,
      rounds: (baseBracketPreview?.rounds || []).map((round) => ({
        ...round,
        matches: (round.matches || []).map((match) => {
          if (match.teamAIsBye || match.teamBIsBye) {
            return match;
          }

          const parsedCourt = splitCourtLabelPartsSafe(match.courtLabel);
          const venueId = String(match.venueId || "").trim();
          const venueName =
            parsedCourt.venueName ||
            venueNameById.get(venueId) ||
            scheduleVenueNameById.get(venueId) ||
            "";

          return {
            ...match,
            courtLabel: venueName,
          };
        }),
      })),
    };

    setBracketDraft(nextBracketPreview);
    workingBracketPreviewRef.current = nextBracketPreview;
    scheduleBracketSave(nextBracketPreview);
    setBracketMatchPickerState({ roundId: "", matchId: "", field: "" });
  };

  const handleToggleBracketSwapMode = () => {
    setBracketActionsMenuVisible(false);
    setBracketSwapMode((current) => !current);
    setBracketSwapSelection(null);
  };

  const handleClearBracketCourtsFromMenu = () => {
    setBracketActionsMenuVisible(false);
    handleClearBracketCourts();
  };

  const handleShareBracketImage = async () => {
    setBracketActionsMenuVisible(false);

    if (!bracketBoard || !bracketShareViewRef.current) {
      setFeedback({
        message: "Primero abrí las llaves para generar la captura.",
        title: "No hay llaves para compartir",
        tone: "error",
        visible: true,
      });
      return;
    }

    try {
      const canShare = await Sharing.isAvailableAsync();

      if (!canShare) {
        setFeedback({
          message: "Este dispositivo no tiene disponible el panel para compartir imagenes.",
          title: "No se pudo compartir",
          tone: "error",
          visible: true,
        });
        return;
      }

      const imageUri = await captureRef(bracketShareViewRef.current, {
        format: "png",
        height: Math.ceil(
          (bracketBoard.boardHeight + spacing.lg * 2) * BRACKET_SHARE_IMAGE_SCALE
        ),
        quality: 1,
        result: "tmpfile",
        width: Math.ceil(
          (bracketBoard.boardWidth + spacing.lg * 2) * BRACKET_SHARE_IMAGE_SCALE
        ),
      });

      await Sharing.shareAsync(imageUri, {
        dialogTitle: "Compartir llaves",
        mimeType: "image/png",
        UTI: "public.png",
      });
    } catch (error) {
      setFeedback({
        message: error?.message || "No pudimos generar la imagen de las llaves.",
        title: "No se pudo compartir",
        tone: "error",
        visible: true,
      });
    }
  };

  const buildZonesPdfHtml = useCallback((bracketImageDataUrl = "") => {
    const tournamentTitle = escapeHtml(tournament?.name || "Torneo");
    const tournamentSubtitle = escapeHtml([zoneShareCategoryLabel, "Zonas"].filter(Boolean).join(" · "));
    const organizerLogoHtml = zoneShareOrganizerLogoUrl
      ? `<img class="organizer-logo" src="${escapeHtml(zoneShareOrganizerLogoUrl)}" />`
      : "";
    const chunksHtml = zoneShareChunks
      .map((chunk, chunkIndex) => {
        const zonesHtml = chunk
          .map((zone) => {
            const pairsHtml = zone.registrations
              .map(
                (registration) => `
                  <div class="pair-row">
                    <span class="pair-number">${escapeHtml(registration.number)}</span>
                    <span class="pair-name">${escapeHtml(registration.label)}</span>
                  </div>
                `
              )
              .join("");
            const matchesHtml = zone.matchRows
              .map(
                (match) => `
                  <tr>
                    <td>${escapeHtml(match.resultLabel)}</td>
                    <td>${escapeHtml(match.label)}</td>
                    <td>${escapeHtml(match.dayLabel)}</td>
                    <td>${escapeHtml(match.timeLabel)}</td>
                    <td>${escapeHtml(match.venueLabel)}</td>
                  </tr>
                `
              )
              .join("");
            const qualifiersHtml = zone.qualifiers
              .map(
                (qualifier, qualifierIndex) =>
                  `<span>${qualifierIndex + 1}&deg; ${
                    qualifier ? escapeHtml(qualifier.shortName) : "Pendiente"
                  }</span>`
              )
              .join("");

            return `
              <section class="zone-card">
                <h2>${escapeHtml(zone.label)}</h2>
                <div class="pairs">${pairsHtml}</div>
                <table>
                  <thead>
                    <tr>
                      <th>RESULT.</th>
                      <th>PAREJAS</th>
                      <th>DIA</th>
                      <th>HORA</th>
                      <th>LUGAR</th>
                    </tr>
                  </thead>
                  <tbody>${matchesHtml}</tbody>
                </table>
                <div class="qualifiers">${qualifiersHtml}</div>
              </section>
            `;
          })
          .join("");

        return `
          <div class="page ${chunkIndex > 0 ? "page-break" : ""}">
            <header>
              ${organizerLogoHtml}
              <div class="header-copy">
                <h1>${tournamentTitle}</h1>
                <p>${tournamentSubtitle}</p>
              </div>
            </header>
            ${zonesHtml}
          </div>
        `;
      })
      .join("");
    const bracketHtml = bracketImageDataUrl
      ? `
        <div class="page page-break bracket-page">
          <header>
            ${organizerLogoHtml}
            <div class="header-copy">
              <h1>${tournamentTitle}</h1>
              <p>${escapeHtml([zoneShareCategoryLabel, "Llaves"].filter(Boolean).join(" · "))}</p>
            </div>
          </header>
          <img class="bracket-image" src="${bracketImageDataUrl}" />
        </div>
      `
      : "";

    return `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            @page { margin: 22px; }
            * { box-sizing: border-box; }
            body {
              background: #F4F8F1;
              color: #1D2B22;
              font-family: Arial, Helvetica, sans-serif;
              margin: 0;
            }
            .page {
              min-height: 100%;
              padding: 8px;
            }
            .page-break {
              page-break-before: always;
            }
            header {
              align-items: center;
              display: flex;
              gap: 12px;
              justify-content: center;
              margin-bottom: 14px;
              text-align: center;
            }
            .organizer-logo {
              border-radius: 999px;
              height: 48px;
              object-fit: cover;
              width: 48px;
            }
            .header-copy {
              text-align: left;
            }
            h1 {
              color: #103A29;
              font-size: 24px;
              font-weight: 900;
              margin: 0;
            }
            header p {
              color: #66766D;
              font-size: 12px;
              font-weight: 700;
              margin: 4px 0 0;
            }
            .zone-card {
              background: #FFFFFF;
              border: 1px solid #DDE8E0;
              border-radius: 14px;
              margin-bottom: 9px;
              padding: 10px;
            }
            h2 {
              background: #E1F4F0;
              border: 1px solid #9FD6CF;
              border-radius: 999px;
              color: #1F6D69;
              display: block;
              font-size: 16px;
              font-weight: 900;
              margin: 0 auto 7px;
              padding: 5px 16px;
              text-align: center;
              text-transform: uppercase;
              width: 150px;
            }
            .pairs {
              margin-bottom: 7px;
            }
            .pair-row {
              align-items: center;
              display: flex;
              gap: 8px;
              margin-bottom: 3px;
            }
            .pair-number {
              background: #E1F4F0;
              border: 1px solid #9FD6CF;
              border-radius: 999px;
              color: #1F6D69;
              display: inline-block;
              font-size: 11px;
              font-weight: 900;
              height: 22px;
              line-height: 20px;
              text-align: center;
              width: 22px;
            }
            .pair-name {
              font-size: 12px;
              font-weight: 800;
            }
            table {
              border-collapse: collapse;
              overflow: hidden;
              table-layout: fixed;
              width: 100%;
            }
            th {
              background: #E1F4F0;
              border: 1px solid #CFE6E1;
              color: #1F6D69;
              font-size: 9px;
              font-weight: 900;
              padding: 5px 4px;
              text-align: center;
            }
            td {
              border: 1px solid #E6ECE8;
              font-size: 9px;
              font-weight: 700;
              padding: 5px 4px;
              text-align: center;
              vertical-align: middle;
              word-break: break-word;
            }
            th:nth-child(1), td:nth-child(1) { width: 21%; }
            th:nth-child(2), td:nth-child(2) { width: 18%; }
            th:nth-child(3), td:nth-child(3) { width: 16%; }
            th:nth-child(4), td:nth-child(4) { width: 14%; }
            th:nth-child(5), td:nth-child(5) { width: 31%; }
            .qualifiers {
              background: #F7FAF8;
              border: 1px solid #DDE8E0;
              border-radius: 10px;
              display: flex;
              gap: 12px;
              justify-content: center;
              margin-top: 7px;
              padding: 6px;
            }
            .qualifiers span {
              font-size: 11px;
              font-weight: 900;
            }
            .bracket-page {
              align-items: center;
              display: flex;
              flex-direction: column;
              justify-content: flex-start;
            }
            .bracket-image {
              height: auto;
              max-height: 670px;
              max-width: 100%;
              object-fit: contain;
              width: 100%;
            }
          </style>
        </head>
        <body>${chunksHtml}${bracketHtml}</body>
      </html>
    `;
  }, [tournament?.name, zoneShareCategoryLabel, zoneShareChunks, zoneShareOrganizerLogoUrl]);

  const handleShareZonesPdf = async () => {
    if (!zoneShareChunks.length) {
      setFeedback({
        message: "Primero crea o guarda zonas para poder compartirlas.",
        title: "No hay zonas para compartir",
        tone: "warning",
        visible: true,
      });
      return;
    }

    try {
      setZoneShareInProgress(true);
      const canShare = await Sharing.isAvailableAsync();

      if (!canShare) {
        setFeedback({
          message: "Este dispositivo no tiene disponible el panel para compartir PDF.",
          title: "No se pudo compartir",
          tone: "error",
          visible: true,
        });
        return;
      }

      setZoneShareModalVisible(false);

      let bracketImageDataUrl = "";

      if (zoneShareIncludeBracket && bracketBoard && bracketShareViewRef.current) {
        const bracketBase64 = await captureRef(bracketShareViewRef.current, {
          format: "png",
          quality: 1,
          result: "base64",
        });
        bracketImageDataUrl = `data:image/png;base64,${bracketBase64}`;
      }

      const { uri } = await Print.printToFileAsync({
        base64: false,
        html: buildZonesPdfHtml(bracketImageDataUrl),
      });
      const sharedFileBaseName =
        sanitizeSharedFileName(
          [tournament?.name || "Torneo", zoneShareCategoryLabel || "Zonas"].filter(Boolean).join("-")
        ) || "Torneo-Zonas";
      const sharedPdfUri = `${FileSystem.cacheDirectory}${sharedFileBaseName}.pdf`;

      await FileSystem.deleteAsync(sharedPdfUri, { idempotent: true });
      await FileSystem.copyAsync({ from: uri, to: sharedPdfUri });

      await Sharing.shareAsync(sharedPdfUri, {
        dialogTitle: "Compartir zonas",
        mimeType: "application/pdf",
        UTI: "com.adobe.pdf",
      });
    } catch (error) {
      setFeedback({
        message: error?.message || "No pudimos generar el PDF de zonas.",
        title: "No se pudo compartir",
        tone: "error",
        visible: true,
      });
    } finally {
      setZoneShareInProgress(false);
    }
  };

  const handleShareZonesImages = async () => {
    if (!zoneShareChunks.length) {
      setFeedback({
        message: "Primero crea o guarda zonas para poder compartirlas.",
        title: "No hay zonas para compartir",
        tone: "warning",
        visible: true,
      });
      return;
    }

    try {
      setZoneShareInProgress(true);
      const canShare = await Sharing.isAvailableAsync();

      if (!canShare) {
        setFeedback({
          message: "Este dispositivo no tiene disponible el panel para compartir imagenes.",
          title: "No se pudo compartir",
          tone: "error",
          visible: true,
        });
        return;
      }

      setZoneShareModalVisible(false);
      const imageUris = [];

      for (let index = 0; index < zoneShareChunks.length; index += 1) {
        const ref = zoneShareViewRefs.current[index];

        if (!ref) {
          continue;
        }

        const imageUri = await captureRef(ref, {
          format: "png",
          quality: 1,
          result: "tmpfile",
        });

        imageUris.push(imageUri);
      }

      if (zoneShareIncludeBracket && bracketBoard && bracketShareViewRef.current) {
        const bracketImageUri = await captureRef(bracketShareViewRef.current, {
          format: "png",
          height: Math.ceil(
            (bracketBoard.boardHeight + spacing.lg * 2) * BRACKET_SHARE_IMAGE_SCALE
          ),
          quality: 1,
          result: "tmpfile",
          width: Math.ceil(
            (bracketBoard.boardWidth + spacing.lg * 2) * BRACKET_SHARE_IMAGE_SCALE
          ),
        });

        imageUris.push(bracketImageUri);
      }

      if (!imageUris.length) {
        throw new Error("No pudimos generar las imagenes de zonas.");
      }

      await Share.open({
        failOnCancel: false,
        title: "Compartir zonas",
        type: "image/png",
        urls: imageUris,
      });
    } catch (error) {
      setFeedback({
        message: error?.message || "No pudimos generar las imagenes de zonas.",
        title: "No se pudo compartir",
        tone: "error",
        visible: true,
      });
    } finally {
      setZoneShareInProgress(false);
    }
  };

  const handleBracketMatchTimePickerChange = useCallback(
    (_, selectedDate) => {
      if (
        bracketMatchTimePickerTarget?.roundId &&
        bracketMatchTimePickerTarget?.matchId &&
        selectedDate
      ) {
        const nextHours = formatTwoDigits(selectedDate.getHours());
        const nextMinutes = formatTwoDigits(selectedDate.getMinutes());
        handleUpdateBracketMatchScheduleField(
          bracketMatchTimePickerTarget.roundId,
          bracketMatchTimePickerTarget.matchId,
          "scheduledTime",
          `${nextHours}:${nextMinutes}`
        );
      }

      if (Platform.OS !== "ios") {
        setBracketMatchTimePickerTarget(null);
      }
    },
    [bracketMatchTimePickerTarget]
  );


  const getBracketSwapSlotId = (slot = null) =>
    slot ? [slot.roundId, slot.matchId, slot.teamKey].filter(Boolean).join(":") : "";

  const isBracketSwapSlotSelected = (roundId, matchId, teamKey) =>
    getBracketSwapSlotId(bracketSwapSelection) === getBracketSwapSlotId({ roundId, matchId, teamKey });

  const hasBracketMatchResult = (match = {}, { ignoreAutoBye = false } = {}) => {
    const hasWinner = Boolean(match?.result?.winner);
    const hasSets = (match?.result?.sets || []).some((set) =>
      Boolean(String(set?.teamA || "").trim() || String(set?.teamB || "").trim())
    );
    const isAutoByeResult =
      ignoreAutoBye &&
      match?.result?.winnerSource === "auto" &&
      Boolean(match?.teamAIsBye || match?.teamBIsBye);

    return (hasWinner && !isAutoByeResult) || hasSets;
  };

  const canSelectBracketSwapSlot = (match = {}, teamKey = "teamA", roundIndex = 0) => {
    if (!bracketSwapMode || roundIndex !== 0) {
      return false;
    }

    if (hasBracketMatchResult(match, { ignoreAutoBye: true })) {
      return false;
    }

    const isBye = Boolean(match?.[`${teamKey}IsBye`]);
    const seed = String(match?.[`${teamKey}Seed`] || "").trim();
    const name = String(match?.[`${teamKey}Name`] || "").trim();
    const lines = Array.isArray(match?.[`${teamKey}Lines`]) ? match[`${teamKey}Lines`] : [];
    const hasVisibleTeam = Boolean(seed || name || lines.some((line) => String(line || "").trim()));

    return hasVisibleTeam || isBye;
  };

  const handleSelectBracketSwapSlot = (roundId, matchId, teamKey) => {
    const nextSlot = { roundId, matchId, teamKey };
    const nextSlotId = getBracketSwapSlotId(nextSlot);

    if (!bracketSwapSelection) {
      setBracketSwapSelection(nextSlot);
      return;
    }

    if (getBracketSwapSlotId(bracketSwapSelection) === nextSlotId) {
      setBracketSwapSelection(null);
      return;
    }

    const readTeam = (match, key) => ({
      id: match?.[`${key}Id`] || "",
      seed: match?.[`${key}Seed`] || "",
      name: match?.[`${key}Name`] || "",
      lines: Array.isArray(match?.[`${key}Lines`]) ? match[`${key}Lines`] : [],
      isBye: Boolean(match?.[`${key}IsBye`]),
    });
    const writeTeam = (match, key, team) => ({
      ...match,
      [`${key}Id`]: team.isBye ? "" : team.id,
      [`${key}Seed`]: team.seed,
      [`${key}Name`]: team.name,
      [`${key}Lines`]: team.lines,
      [`${key}IsBye`]: team.isBye,
    });
    const buildSwapMatchResult = (match, round) => {
      const autoWinner =
        match.teamAIsBye && !match.teamBIsBye
          ? "teamB"
          : match.teamBIsBye && !match.teamAIsBye
          ? "teamA"
          : "";

      return {
        ...match,
        result: {
          ...buildDefaultBracketResult(resolveCurrentBracketRoundFormat(round)),
          winnerSource: autoWinner ? "auto" : "",
          winner: autoWinner,
        },
        resultLabel: autoWinner ? "Avanza por BYE" : "Resultado pendiente",
      };
    };
    let firstTeam = null;
    let secondTeam = null;

    (currentBracketPreview?.rounds || []).forEach((round) => {
      (round.matches || []).forEach((match) => {
        if (round.id === bracketSwapSelection.roundId && match.id === bracketSwapSelection.matchId) {
          firstTeam = readTeam(match, bracketSwapSelection.teamKey);
        }
        if (round.id === roundId && match.id === matchId) {
          secondTeam = readTeam(match, teamKey);
        }
      });
    });

    if (!firstTeam || !secondTeam) {
      setBracketSwapSelection(null);
      return;
    }

    const nextBracketPreview = applyBracketProgressions({
      ...(currentBracketPreview || {}),
      rounds: (currentBracketPreview?.rounds || []).map((round) => ({
        ...round,
        matches: (round.matches || []).map((match) => {
          const isFirstMatch =
            round.id === bracketSwapSelection.roundId && match.id === bracketSwapSelection.matchId;
          const isSecondMatch = round.id === roundId && match.id === matchId;

          if (!isFirstMatch && !isSecondMatch) {
            return match;
          }

          let nextMatch = match;

          if (isFirstMatch) {
            nextMatch = writeTeam(nextMatch, bracketSwapSelection.teamKey, secondTeam);
          }
          if (isSecondMatch) {
            nextMatch = writeTeam(nextMatch, teamKey, firstTeam);
          }

          return buildSwapMatchResult(nextMatch, round);
        }),
      })),
    }, resolveCurrentBracketRoundFormat);

    setBracketDraft(nextBracketPreview);
    workingBracketPreviewRef.current = nextBracketPreview;
    scheduleBracketSave(nextBracketPreview);
    setBracketSwapSelection(null);
  };

  const openBracketProgramEditor = (round, match) => {
    if (!canEditFixture || !round?.id || !match?.id || match.teamAIsBye || match.teamBIsBye) {
      return;
    }

    const parsedCourt = splitCourtLabelPartsSafe(match.courtLabel);
    const venueIdFromName =
      tournamentVenueOptions.find(
        (venue) =>
          String(venue.name || venue.label || "").trim().toLowerCase() ===
          String(parsedCourt.venueName || "").trim().toLowerCase()
      )?.id || "";
    const availableVenues = getBracketSelectableVenues("");
    const selectedVenueId =
      String(match.venueId || venueIdFromName || "").trim() ||
      (availableVenues.length === 1 ? String(availableVenues[0]?.id || "").trim() : "");
    const courtOptions = getBracketCourtOptionsForVenue(selectedVenueId);
    const selectedCourtLabel = String(match.courtLabel || "").trim();

    setBracketProgramEditor({
      courtLabel: selectedCourtLabel,
      matchId: match.id,
      roundId: round.id,
      scheduledDayKey: String(match.scheduledDayKey || ""),
      scheduledTime: String(match.scheduledTime || ""),
      showTimePicker: false,
      venueId: selectedVenueId,
      venueName: parsedCourt.venueName || "",
      fallbackCourtLabel:
        selectedCourtLabel ||
        (courtOptions.length === 1 ? String(courtOptions[0]?.value || "") : ""),
    });
  };

  const closeBracketProgramEditor = () => {
    setBracketProgramEditor(null);
  };

  const updateBracketProgramEditor = (patch = {}) => {
    setBracketProgramEditor((current) => (current ? { ...current, ...patch } : current));
  };

  const handleBracketProgramTimeChange = (_, selectedDate) => {
    if (selectedDate) {
      updateBracketProgramEditor({
        scheduledTime: `${formatTwoDigits(selectedDate.getHours())}:${formatTwoDigits(selectedDate.getMinutes())}`,
      });
    }

    if (Platform.OS !== "ios") {
      updateBracketProgramEditor({ showTimePicker: false });
    }
  };

  const saveBracketProgramEditor = () => {
    if (!bracketProgramEditor?.roundId || !bracketProgramEditor?.matchId) {
      closeBracketProgramEditor();
      return;
    }

    const selectedCourtLabel = String(
      bracketProgramEditor.courtLabel || bracketProgramEditor.fallbackCourtLabel || ""
    ).trim();
    const parsedCourt = splitCourtLabelPartsSafe(selectedCourtLabel);
    const selectedVenueId = String(bracketProgramEditor.venueId || "").trim();
    const selectedVenue = tournamentVenueOptions.find(
      (venue) => String(venue.id || "").trim() === selectedVenueId
    );
    const selectedVenueName =
      parsedCourt.venueName ||
      String(selectedVenue?.name || selectedVenue?.label || bracketProgramEditor.venueName || "").trim();
    const nextCourtLabel =
      selectedCourtLabel ||
      (selectedVenueName ? selectedVenueName : "Cancha pendiente");
    const nextScheduledDayKey = String(bracketProgramEditor.scheduledDayKey || "");
    const nextScheduledTime = String(bracketProgramEditor.scheduledTime || "");
    const nextScheduleLabel =
      nextScheduledDayKey || nextScheduledTime
        ? `${nextScheduledDayKey
            ? formatScheduleDayDisplay(nextScheduledDayKey, tournamentDayOptions)
            : "Dia a confirmar"} · ${
            nextScheduledTime ? `${nextScheduledTime} hs` : "Hora a confirmar"
          }`
        : "Horario pendiente";
    const baseBracketPreview = workingBracketPreviewRef.current || currentBracketPreview || {};
    const nextBracketPreview = applyBracketProgressions(
      {
        ...baseBracketPreview,
        rounds: (baseBracketPreview?.rounds || []).map((round) =>
          round.id !== bracketProgramEditor.roundId
            ? round
            : {
                ...round,
                matches: (round.matches || []).map((match) =>
                  match.id !== bracketProgramEditor.matchId
                    ? match
                    : {
                        ...match,
                        courtLabel: nextCourtLabel,
                        scheduledDayKey: nextScheduledDayKey,
                        scheduledTime: nextScheduledTime,
                        scheduleLabel: nextScheduleLabel,
                        venueId: selectedVenueId || String(match.venueId || ""),
                      }
                ),
              }
        ),
      },
      resolveCurrentBracketRoundFormat
    );

    setBracketDraft(nextBracketPreview);
    workingBracketPreviewRef.current = nextBracketPreview;
    scheduleBracketSave(nextBracketPreview);
    closeBracketProgramEditor();
  };

  const renderBracketMatchScheduleHeader = (
    round,
    match,
    { isFullscreen = false, isShareCapture = false } = {}
  ) => {
    const hasBye = Boolean(match.teamAIsBye || match.teamBIsBye);
    const displayDayKey = String(hasBye ? "" : match.scheduledDayKey || bracketDisplayFallbackSchedule?.dayKey || "");
    const displayTime = String(hasBye ? "" : match.scheduledTime || bracketDisplayFallbackSchedule?.time || "");
    const dayLabel = displayDayKey
      ? formatScheduleDayDisplay(displayDayKey, tournamentDayOptions)
      : hasBye
      ? "Dia -- --"
      : "Dia a confirmar";
    const timeLabel = displayTime
      ? `${displayTime} hs`
      : hasBye
      ? "Hora -- --"
      : "Hora a confirmar";

    return (
    <>
      <View style={styles.bracketMatchHeader}>
        <View style={styles.bracketMatchScheduleWrap}>
          <View style={styles.bracketMatchScheduleLine}>
            <View style={styles.bracketMatchScheduleButton}>
              <Ionicons color="#263238" name="calendar-outline" size={11} />
              <Text style={styles.bracketMatchSchedulePill}>
                {dayLabel}
              </Text>
            </View>
            <View style={styles.bracketMatchScheduleButton}>
              <Ionicons color="#263238" name="time-outline" size={11} />
              <Text style={styles.bracketMatchSchedulePill}>
                {timeLabel}
              </Text>
            </View>
          </View>
          {renderBracketMatchLocation(round, match)}
        </View>
        {canEditFixture && !hasBye && !isShareCapture ? (
          <Pressable
            hitSlop={{ bottom: 8, left: 8, right: 8, top: 8 }}
            onPress={() => openBracketProgramEditor(round, match)}
            style={({ pressed }) => [
              styles.bracketResultModalButton,
              styles.bracketProgramButton,
              pressed ? styles.primaryButtonPressed : null,
            ]}
          >
            <Text style={styles.bracketResultModalButtonText}>Definir</Text>
          </Pressable>
        ) : null}
      </View>
      {!isFullscreen &&
      !isShareCapture &&
      bracketMatchPickerState.roundId === round.id &&
      bracketMatchPickerState.matchId === match.id &&
      bracketMatchPickerState.field === "scheduledDayKey" &&
      canEditFixture ? (
        <View style={styles.zoneInlinePickerCard}>
          <Text style={styles.zoneInlinePickerTitle}>Seleccionar dia</Text>
          <View style={styles.zoneInlinePickerOptions}>
            {tournamentDayOptions.map((option) => {
              const isSelected = option.key === String(match.scheduledDayKey || "");

              return (
                <Pressable
                  key={`${round.id}-${match.id}-${option.key}`}
                  onPress={() =>
                    handleUpdateBracketMatchScheduleField(
                      round.id,
                      match.id,
                      "scheduledDayKey",
                      option.key
                    )
                  }
                  style={[
                    styles.zoneInlinePickerOption,
                    isSelected ? styles.zoneInlinePickerOptionSelected : null,
                  ]}
                >
                  <Text
                    style={[
                      styles.zoneInlinePickerOptionText,
                      isSelected ? styles.zoneInlinePickerOptionTextSelected : null,
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable
            onPress={() =>
              setBracketMatchPickerState({
                roundId: "",
                matchId: "",
                field: "",
              })
            }
            style={({ pressed }) => [
              styles.zoneInlinePickerCloseButton,
              pressed ? styles.primaryButtonPressed : null,
            ]}
          >
            <Text style={styles.zoneInlinePickerCloseButtonText}>Cerrar</Text>
          </Pressable>
        </View>
      ) : null}
    </>
    );
  };

  const renderBracketMatchLocation = (round, match) => {
    const hasBye = Boolean(match.teamAIsBye || match.teamBIsBye);
    const rawCourtLabel = hasBye
      ? ""
      : String(match.courtLabel || "").toLowerCase().includes("pendiente")
      ? bracketDisplayFallbackSchedule?.courtLabel || match.courtLabel
      : match.courtLabel;
    const { venueName: rawVenueName, courtName: rawCourtName } = splitCourtLabelPartsSafe(rawCourtLabel);
    const normalizedVenueName = String(rawVenueName || "").trim().toLowerCase();
    const venueName =
      !rawCourtName && normalizedVenueName.includes("cancha")
        ? ""
        : rawVenueName;
    const courtName =
      !rawCourtName && normalizedVenueName.includes("cancha")
        ? rawVenueName
        : rawCourtName;

    return (
      <View
        style={[
          styles.bracketMatchLocationWrap,
          !canEditFixture || hasBye ? styles.bracketCourtChipDisabled : null,
        ]}
      >
        <Text numberOfLines={1} style={styles.bracketMatchVenueText}>
          {venueName || (hasBye ? "Sede -- --" : "Sede pendiente")}
        </Text>
        <Text numberOfLines={1} style={styles.bracketMatchCourtText}>
          {courtName || (hasBye ? "Cancha -- --" : "Cancha pendiente")}
        </Text>
      </View>
    );
  };

  const renderBracketMatchBody = (
    round,
    match,
    roundIndex,
    { isResolved = false, teamAIsBye = false, teamBIsBye = false, isHighlightedTeamA = false, isHighlightedTeamB = false, compactResults = false, isShareCapture = false } = {}
  ) => (
    <View style={styles.bracketMatchBodyRow}>
      <View style={styles.bracketSideControlsColumn}>
        <Text style={styles.zoneVsLabel}>VS</Text>
      </View>

      <View style={styles.bracketTeamsColumn}>
        <Pressable
          disabled={!canEditFixture}
          onPress={() =>
            canEditFixture
              ? canSelectBracketSwapSlot(match, "teamA", roundIndex)
                ? handleSelectBracketSwapSlot(round.id, match.id, "teamA")
                : handleToggleBracketWinner(round.id, match.id, "teamA")
              : null
          }
          style={[
            styles.bracketTeamColumn,
            isResolved ? styles.bracketTeamColumnResolved : null,
            isHighlightedTeamA ? styles.bracketTeamColumnHighlighted : null,
            isBracketSwapSlotSelected(round.id, match.id, "teamA")
              ? styles.bracketTeamColumnSwapSelected
              : null,
          ]}
        >
          <View style={styles.bracketTeamContentRow}>
            <View style={styles.bracketStatusIconLeftWrap}>
              {canSelectBracketSwapSlot(match, "teamA", roundIndex) ? (
                <View
                  style={[
                    styles.bracketSwapSelectBadge,
                    isBracketSwapSlotSelected(round.id, match.id, "teamA")
                      ? styles.bracketSwapSelectBadgeActive
                      : null,
                  ]}
                >
                  <Ionicons
                    color={colors.surface}
                    name="swap-horizontal-outline"
                    size={14}
                  />
                </View>
              ) : null}
              {!match.result?.winner ? (
                <FontAwesome5
                  color={colors.textMuted || colors.muted}
                  name="hand-rock"
                  size={12}
                  style={styles.neutralFistIcon}
                />
              ) : (
                <Ionicons
                  color={getZoneTeamStatusIconColor(match, "teamA")}
                  name={getZoneTeamStatusIconName(match, "teamA")}
                  size={12}
                />
              )}
              <Text style={styles.bracketTeamSeedSide}>
                {getBracketTeamSeedDisplay(match, "teamA") || "-"}
              </Text>
            </View>
            <View
              style={[
                styles.bracketTeamPlayersBlock,
                teamAIsBye ? styles.bracketTeamPlayersBlockBye : null,
              ]}
            >
              {teamAIsBye ? (
                <Text style={styles.bracketTeamByeText}>BYE</Text>
              ) : (
                getBracketTeamDisplayLines(match, "teamA").map((line, index) => (
                  <Text
                    key={`${match.id}-ba-${index}`}
                    style={[
                      styles.bracketTeamPrimaryName,
                      isHighlightedTeamA ? styles.highlightedPairNameText : null,
                    ]}
                  >
                    {line}
                  </Text>
                ))
              )}
            </View>
          </View>
        </Pressable>

        <Pressable
          onPress={() =>
            canEditFixture
              ? canSelectBracketSwapSlot(match, "teamB", roundIndex)
                ? handleSelectBracketSwapSlot(round.id, match.id, "teamB")
                : handleToggleBracketWinner(round.id, match.id, "teamB")
              : null
          }
          disabled={!canEditFixture}
          style={[
            styles.bracketTeamColumn,
            isResolved ? styles.bracketTeamColumnResolved : null,
            isHighlightedTeamB ? styles.bracketTeamColumnHighlighted : null,
            isBracketSwapSlotSelected(round.id, match.id, "teamB")
              ? styles.bracketTeamColumnSwapSelected
              : null,
          ]}
        >
          <View style={styles.bracketTeamContentRow}>
            <View style={styles.bracketStatusIconLeftWrap}>
              {canSelectBracketSwapSlot(match, "teamB", roundIndex) ? (
                <View
                  style={[
                    styles.bracketSwapSelectBadge,
                    isBracketSwapSlotSelected(round.id, match.id, "teamB")
                      ? styles.bracketSwapSelectBadgeActive
                      : null,
                  ]}
                >
                  <Ionicons
                    color={colors.surface}
                    name="swap-horizontal-outline"
                    size={14}
                  />
                </View>
              ) : null}
              {!match.result?.winner ? (
                <FontAwesome5
                  color={colors.textMuted || colors.muted}
                  name="hand-rock"
                  size={12}
                  style={styles.neutralFistIcon}
                />
              ) : (
                <Ionicons
                  color={getZoneTeamStatusIconColor(match, "teamB")}
                  name={getZoneTeamStatusIconName(match, "teamB")}
                  size={12}
                />
              )}
              <Text style={styles.bracketTeamSeedSide}>
                {getBracketTeamSeedDisplay(match, "teamB") || "-"}
              </Text>
            </View>
            <View
              style={[
                styles.bracketTeamPlayersBlock,
                teamBIsBye ? styles.bracketTeamPlayersBlockBye : null,
              ]}
            >
              {teamBIsBye ? (
                <Text style={styles.bracketTeamByeText}>BYE</Text>
              ) : (
                getBracketTeamDisplayLines(match, "teamB").map((line, index) => (
                  <Text
                    key={`${match.id}-bb-${index}`}
                    style={[
                      styles.bracketTeamPrimaryName,
                      isHighlightedTeamB ? styles.highlightedPairNameText : null,
                    ]}
                  >
                    {line}
                  </Text>
                ))
              )}
            </View>
          </View>
        </Pressable>

      </View>

      <View
        style={[
          styles.bracketResultsColumn,
          compactResults ? styles.bracketResultsColumnCompact : null,
          teamAIsBye || teamBIsBye ? styles.bracketResultsColumnDisabled : null,
        ]}
      >
        <View style={styles.bracketResultScoreCardsRow}>
          {Array.from({ length: 3 }, (_, setIndex) => {
            const set = normalizeResultSets(match.result?.sets, resolveCurrentBracketRoundFormat(round))[setIndex] || {};
            const hasSetScore = String(set.teamA || "").trim() || String(set.teamB || "").trim();

            return (
              <View
                key={`${match.id}-score-card-${setIndex}`}
                style={[
                  styles.bracketResultScoreCard,
                  !hasSetScore ? styles.bracketResultScoreCardEmpty : null,
                ]}
              >
                <Text
                  style={[
                    styles.bracketResultScoreValue,
                    !hasSetScore ? styles.bracketResultScoreValueEmpty : null,
                  ]}
                >
                  {set.teamA || "-"}
                </Text>
                <View style={styles.bracketResultScoreDivider} />
                <Text
                  style={[
                    styles.bracketResultScoreValue,
                    !hasSetScore ? styles.bracketResultScoreValueEmpty : null,
                  ]}
                >
                  {set.teamB || "-"}
                </Text>
              </View>
            );
          })}
        </View>
        {!isShareCapture ? (
          <Pressable
            disabled={!canEditFixture || teamAIsBye || teamBIsBye}
            hitSlop={{ bottom: 10, left: 10, right: 10, top: 10 }}
            onPressIn={() => openBracketResultEditor(round.id, match.id, round, match)}
            style={({ pressed }) => [
              styles.bracketResultModalButton,
              pressed ? styles.primaryButtonPressed : null,
              !canEditFixture || teamAIsBye || teamBIsBye ? styles.bracketResultModalButtonDisabled : null,
            ]}
          >
            <Text style={styles.bracketResultModalButtonText}>
              {hasAnyResultSetScore(
                normalizeResultSets(match.result?.sets, resolveCurrentBracketRoundFormat(round))
              ) || match.result?.winner
                ? "Editar"
                : "Cargar"}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  const renderBracketActionsMenu = ({ inHeader = false } = {}) => (
    <View
      style={[
        styles.bracketActionsMenuWrap,
        inHeader ? styles.bracketActionsMenuWrapHeader : null,
      ]}
    >
      <Pressable
        accessibilityLabel="Abrir acciones de llaves"
        onPress={() => setBracketActionsMenuVisible((current) => !current)}
        style={({ pressed }) => [
          styles.bracketActionsMenuButton,
          inHeader ? styles.bracketActionsMenuButtonHeader : null,
          bracketActionsMenuVisible || bracketSwapMode ? styles.bracketActionsMenuButtonActive : null,
          pressed ? styles.primaryButtonPressed : null,
        ]}
      >
        <Ionicons
          color={bracketActionsMenuVisible || bracketSwapMode ? colors.surface : colors.primaryDark}
          name="ellipsis-horizontal"
          size={22}
        />
      </Pressable>

      {bracketActionsMenuVisible ? (
        <View style={styles.bracketActionsMenuCard}>
          {canEditFixture ? (
            <>
              <Pressable
                onPress={handleToggleBracketSwapMode}
                style={({ pressed }) => [
                  styles.bracketActionsMenuItem,
                  pressed ? styles.bracketActionsMenuItemPressed : null,
                ]}
              >
                <Ionicons color="#1E88C8" name="swap-horizontal-outline" size={18} />
                <Text style={styles.bracketActionsMenuItemText}>
                  {bracketSwapMode ? "Salir de cambiar parejas" : "Cambiar parejas"}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleClearBracketCourtsFromMenu}
                style={({ pressed }) => [
                  styles.bracketActionsMenuItem,
                  pressed ? styles.bracketActionsMenuItemPressed : null,
                ]}
              >
                <Ionicons color={colors.danger} name="trash-outline" size={18} />
                <Text style={styles.bracketActionsMenuItemText}>Eliminar canchas</Text>
              </Pressable>
            </>
          ) : null}
          <Pressable
            onPress={handleShareBracketImage}
            style={({ pressed }) => [
              styles.bracketActionsMenuItem,
              pressed ? styles.bracketActionsMenuItemPressed : null,
            ]}
          >
            <Ionicons color={colors.primaryDark} name="share-social-outline" size={18} />
            <Text style={styles.bracketActionsMenuItemText}>Compartir</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  const renderBracketProgramEditorModal = () => {
    const selectableVenues = getBracketSelectableVenues("");
    const selectedVenueId =
      String(bracketProgramEditor?.venueId || "").trim() ||
      (selectableVenues.length === 1 ? String(selectableVenues[0]?.id || "").trim() : "");
    const courtOptions = getBracketCourtOptionsForVenue(selectedVenueId);
    const currentCourtLabel = String(bracketProgramEditor?.courtLabel || "").trim();

    return (
      <Modal
        animationType="fade"
        onRequestClose={closeBracketProgramEditor}
        transparent
        visible={Boolean(bracketProgramEditor)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.resultModalOverlay}
        >
          <Pressable onPress={closeBracketProgramEditor} style={styles.resultModalBackdrop} />
          <ScrollView
            contentContainerStyle={styles.resultModalScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.resultModalCard}>
              <Text style={styles.resultModalTitle}>Programar partido</Text>
              <Text style={styles.resultModalSubtitle}>
                Selecciona dia, hora, sede y cancha.
              </Text>

              <View style={styles.programSection}>
                <Text style={styles.programSectionTitle}>Dia</Text>
                <View style={styles.programOptionsGrid}>
                  {tournamentDayOptions.map((day) => {
                    const isSelected = day.key === bracketProgramEditor?.scheduledDayKey;

                    return (
                      <Pressable
                        key={`bracket-program-day-${day.key}`}
                        onPress={() => updateBracketProgramEditor({ scheduledDayKey: day.key })}
                        style={[
                          styles.programOptionChip,
                          isSelected ? styles.programOptionChipSelected : null,
                        ]}
                      >
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.programOptionChipText,
                            isSelected ? styles.programOptionChipTextSelected : null,
                          ]}
                        >
                          {formatScheduleDayDisplay(day.key, tournamentDayOptions)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.programSection}>
                <Text style={styles.programSectionTitle}>Hora</Text>
                <Pressable
                  onPress={() => updateBracketProgramEditor({ showTimePicker: true })}
                  style={styles.programTimeButton}
                >
                  <Ionicons color="#244A66" name="time-outline" size={18} />
                  <Text style={styles.programTimeButtonText}>
                    {bracketProgramEditor?.scheduledTime
                      ? `${bracketProgramEditor.scheduledTime} hs`
                      : "Seleccionar hora"}
                  </Text>
                </Pressable>
                {bracketProgramEditor?.showTimePicker ? (
                  <DateTimePicker
                    display={Platform.OS === "ios" ? "spinner" : "default"}
                    mode="time"
                    onChange={handleBracketProgramTimeChange}
                    value={buildDateFromTime(bracketProgramEditor?.scheduledTime)}
                  />
                ) : null}
              </View>

              <View style={styles.programSection}>
                <Text style={styles.programSectionTitle}>Sede</Text>
                <View style={styles.programOptionsStack}>
                  {selectableVenues.map((venue) => {
                    const venueId = String(venue?.id || "").trim();
                    const isSelected = venueId === selectedVenueId;
                    const venueName = String(venue?.name || venue?.label || "Sede").trim();

                    return (
                      <Pressable
                        key={`bracket-program-venue-${venueId || venueName}`}
                        onPress={() =>
                          updateBracketProgramEditor({
                            courtLabel: "",
                            fallbackCourtLabel: "",
                            venueId,
                            venueName,
                          })
                        }
                        style={[
                          styles.programOptionRow,
                          isSelected ? styles.programOptionRowSelected : null,
                        ]}
                      >
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.programOptionRowText,
                            isSelected ? styles.programOptionRowTextSelected : null,
                          ]}
                        >
                          {venueName}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.programSection}>
                <Text style={styles.programSectionTitle}>Cancha</Text>
                <View style={styles.programOptionsGrid}>
                  {courtOptions.map((court) => {
                    const isSelected = currentCourtLabel === String(court.value || "");

                    return (
                      <Pressable
                        key={`bracket-program-court-${court.value}`}
                        onPress={() =>
                          updateBracketProgramEditor({
                            courtLabel: String(court.value || ""),
                            fallbackCourtLabel: String(court.value || ""),
                            venueId: String(court.venueId || selectedVenueId || ""),
                            venueName: String(court.venueName || bracketProgramEditor?.venueName || ""),
                          })
                        }
                        style={[
                          styles.programOptionChip,
                          isSelected ? styles.programOptionChipSelected : null,
                        ]}
                      >
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.programOptionChipText,
                            isSelected ? styles.programOptionChipTextSelected : null,
                          ]}
                        >
                          {court.courtName || court.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.resultModalActions}>
                <Pressable onPress={closeBracketProgramEditor} style={styles.resultCancelButton}>
                  <Text style={styles.resultCancelButtonText}>Cancelar</Text>
                </Pressable>
                <Pressable onPress={saveBracketProgramEditor} style={styles.resultSaveButton}>
                  <Text style={styles.resultSaveButtonText}>Guardar</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    );
  };

  const renderBracketResultEditorModal = () => (
    <Modal
      animationType="fade"
      onRequestClose={closeBracketResultEditor}
      transparent
      visible={Boolean(bracketResultEditor)}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.resultModalOverlay}
      >
        <Pressable onPress={closeBracketResultEditor} style={styles.resultModalBackdrop} />
        <ScrollView
          contentContainerStyle={styles.resultModalScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.resultModalCard}>
            <Text style={styles.resultModalTitle}>Resultado</Text>
            <Text style={styles.resultModalSubtitle}>
              {bracketResultEditor?.roundTitle || "Llave"} · selecciona ganador y carga los sets.
            </Text>
            <View style={styles.winnerOptions}>
              {[
                {
                  key: "teamA",
                  label: `${bracketResultEditor?.teamASeed || "A"}. ${
                    bracketResultEditor?.teamAName || "Pareja A"
                  }`,
                },
                {
                  key: "teamB",
                  label: `${bracketResultEditor?.teamBSeed || "B"}. ${
                    bracketResultEditor?.teamBName || "Pareja B"
                  }`,
                },
              ].map((option) => {
                const isSelected = bracketResultEditor?.winner === option.key;

                return (
                  <Pressable
                    key={`bracket-winner-${option.key}`}
                    onPress={() =>
                      setBracketResultEditor((current) =>
                        current
                          ? {
                              ...current,
                              winner: isSelected ? "" : option.key,
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
                      {option.label}
                    </Text>
                    {isSelected ? <Text style={styles.winnerBadgeText}>GANADOR</Text> : null}
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.setsGrid}>
              {normalizeResultSets(
                bracketResultEditor?.sets,
                resolveCurrentBracketRoundFormat(
                  (workingBracketPreviewRef.current || currentBracketPreview || {})?.rounds?.find(
                    (round) => round.id === bracketResultEditor?.roundId
                  )
                )
              ).map((set, setIndex) => {
                const baseBracketPreview = workingBracketPreviewRef.current || currentBracketPreview || {};
                const editorRound = (baseBracketPreview?.rounds || []).find(
                  (round) => round.id === bracketResultEditor?.roundId
                );
                const roundFormat = resolveCurrentBracketRoundFormat(editorRound);
                const allowDoubleDigits = shouldAllowDoubleDigitSetScore(
                  roundFormat,
                  setIndex,
                  currentMatchFormat.bracketSuperTieBreakPoints
                );

                return (
                  <View key={`bracket-modal-set-${setIndex}`} style={styles.setRow}>
                    <Text style={[styles.setLabel, allowDoubleDigits ? styles.superTieBreakSetLabel : null]}>
                      {allowDoubleDigits ? "SUPER TIE BREAK" : set.label}
                    </Text>
                    <TextInput
                      keyboardType="number-pad"
                      maxLength={allowDoubleDigits ? 5 : 3}
                      onChangeText={(value) => updateBracketResultEditorSetScore(setIndex, value)}
                      ref={(input) => {
                        bracketSetInputRefs.current[`bracket-result-editor-${setIndex}`] = input;
                      }}
                      style={[
                        styles.setInput,
                        allowDoubleDigits ? styles.superTieBreakSetInput : null,
                      ]}
                      value={formatCompactSetInput(set, allowDoubleDigits)}
                    />
                  </View>
                );
              })}
            </View>
            <View style={styles.resultModalUtilityActions}>
              {bracketResultEditor?.canClearCrossing ? (
                <Pressable
                  onPress={clearBracketEditorCrossing}
                  style={({ pressed }) => [
                    styles.resultUtilityButton,
                    styles.resultUtilityButtonDanger,
                    pressed ? styles.primaryButtonPressed : null,
                  ]}
                >
                  <Text style={[styles.resultUtilityButtonText, styles.resultUtilityButtonTextDanger]}>
                    Limpiar cruce
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={clearBracketEditorResult}
                style={({ pressed }) => [
                  styles.resultUtilityButton,
                  pressed ? styles.primaryButtonPressed : null,
                ]}
              >
                <Text style={styles.resultUtilityButtonText}>Limpiar resultado</Text>
              </Pressable>
            </View>
            <View style={styles.resultModalActions}>
              <Pressable onPress={closeBracketResultEditor} style={styles.resultCancelButton}>
                <Text style={styles.resultCancelButtonText}>Cancelar</Text>
              </Pressable>
              <Pressable onPress={saveBracketResultEditor} style={styles.resultSaveButton}>
                <Text style={styles.resultSaveButtonText}>Guardar</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );

  const renderBracketBoard = (isFullscreen = false) => {
    if (!bracketBoard) {
      return null;
    }

    if (!isFullscreen) {
      return (
        <View
          style={[
            styles.bracketViewport,
            {
              height: 320,
            },
          ]}
        >
          <View
            {...bracketInlinePanResponder.panHandlers}
            onTouchStart={handleBracketTouchStart}
            style={[styles.bracketGestureArea, styles.bracketGestureAreaInline]}
          >
            <Animated.View
              style={[
                styles.bracketInlineAnimatedLayer,
                {
                  transform: [
                    { translateX: bracketPanX },
                    { translateY: bracketPanY },
                    { scale: bracketScale },
                  ],
                },
              ]}
            >
              <View
                style={[
                  styles.bracketBoardCanvas,
                  {
                    width: bracketBoard.boardWidth,
                    height: bracketBoard.boardHeight,
                    transform: getScaledBoardTransform(
                      bracketBoard.boardWidth,
                      bracketBoard.boardHeight,
                      bracketInlineRenderScale
                    ),
                  },
                ]}
              >
                {bracketBoard.connectors.map((connector) => (
                  <View
                    key={connector.id}
                    style={[
                      connector.type === "vertical"
                        ? styles.bracketConnectorVertical
                        : styles.bracketConnectorHorizontal,
                      connector.type === "vertical"
                        ? {
                            left: connector.x - BRACKET_CONNECTOR_THICKNESS / 2,
                            top: connector.y,
                            height: connector.height,
                          }
                        : {
                            left: connector.x,
                            top: connector.y - BRACKET_CONNECTOR_THICKNESS / 2,
                            width: connector.width,
                          },
                    ]}
                  />
                ))}

                {bracketBoard.rounds.map((round, roundIndex) => {
                  const roundBadgeColor = getBracketRoundBadgeColor(
                    roundIndex,
                    bracketBoard.rounds.length
                  );

                  return (
                    <View
                      key={`${round.id}-label`}
                      style={[
                        styles.bracketRoundBadge,
                        {
                          backgroundColor: roundBadgeColor,
                          borderColor: roundBadgeColor,
                          left: round.x,
                          shadowColor: roundBadgeColor,
                          width: BRACKET_CARD_WIDTH,
                        },
                      ]}
                    >
                      <Text style={styles.roundTitle}>{round.title}</Text>
                    </View>
                  );
                })}

                {bracketBoard.rounds.flatMap((round, roundIndex) =>
                  (round.matches || []).map((match) => (
                    <View
                      key={match.id}
                      style={[
                        styles.bracketAbsoluteMatchCard,
                        {
                          backgroundColor: hexToRgba(
                            getBracketRoundBadgeColor(roundIndex, bracketBoard.rounds.length),
                            0.14
                          ),
                          borderColor: hexToRgba(
                            getBracketRoundBadgeColor(roundIndex, bracketBoard.rounds.length),
                            0.38
                          ),
                          left: match.x,
                          top: match.y,
                          width: BRACKET_CARD_WIDTH,
                          minHeight: BRACKET_CARD_HEIGHT,
                        },
                      ]}
                    >
                    {renderBracketMatchScheduleHeader(round, match)}
                    {(() => {
                      const isResolved = Boolean(
                        match.result?.winner || match.teamAIsBye || match.teamBIsBye
                      );
                      const teamAIsBye = Boolean(match.teamAIsBye);
                      const teamBIsBye = Boolean(match.teamBIsBye);
                      const isHighlightedTeamA =
                        !canEditFixture &&
                        highlightedPairId &&
                        String(match.teamAId || "").trim() === highlightedPairId;
                      const isHighlightedTeamB =
                        !canEditFixture &&
                        highlightedPairId &&
                        String(match.teamBId || "").trim() === highlightedPairId;

                      return renderBracketMatchBody(round, match, roundIndex, {
                        isResolved,
                        teamAIsBye,
                        teamBIsBye,
                        isHighlightedTeamA,
                        isHighlightedTeamB,
                        compactResults: true,
                      });
                    })()}
                    </View>
                  ))
                )}
              </View>
            </Animated.View>
          </View>
        </View>
      );
    }

    return (
      <View style={[styles.bracketViewport, isFullscreen ? styles.bracketViewportFullscreen : null]}>
        <View
          {...(isFullscreen ? bracketFullscreenPanResponder.panHandlers : bracketPanResponder.panHandlers)}
          onTouchStart={handleBracketTouchStart}
          style={styles.bracketGestureArea}
        >
          <Animated.View
            style={[
              styles.bracketBoardCanvas,
              {
                width: bracketBoard.boardWidth,
                height: bracketBoard.boardHeight,
                transform: [
                  { translateX: bracketPanX },
                  { translateY: bracketPanY },
                  { scale: bracketScale },
                  {
                    translateX: (bracketBoard.boardWidth * (bracketZoomScale - 1)) / 2,
                  },
                  {
                    translateY: (bracketBoard.boardHeight * (bracketZoomScale - 1)) / 2,
                  },
                ],
              },
            ]}
          >
            {bracketBoard.connectors.map((connector) => (
              <View
                key={connector.id}
                style={[
                  connector.type === "vertical"
                    ? styles.bracketConnectorVertical
                    : styles.bracketConnectorHorizontal,
                  connector.type === "vertical"
                    ? {
                        left: connector.x - BRACKET_CONNECTOR_THICKNESS / 2,
                        top: connector.y,
                        height: connector.height,
                      }
                    : {
                        left: connector.x,
                        top: connector.y - BRACKET_CONNECTOR_THICKNESS / 2,
                        width: connector.width,
                      },
                ]}
              />
            ))}

            {bracketBoard.rounds.map((round, roundIndex) => {
              const roundBadgeColor = getBracketRoundBadgeColor(
                roundIndex,
                bracketBoard.rounds.length
              );

              return (
                <View
                  key={`${round.id}-label`}
                  style={[
                    styles.bracketRoundBadge,
                    {
                      backgroundColor: roundBadgeColor,
                      borderColor: roundBadgeColor,
                      left: round.x,
                      shadowColor: roundBadgeColor,
                      width: BRACKET_CARD_WIDTH,
                    },
                  ]}
                >
                  <Text style={styles.roundTitle}>{round.title}</Text>
                </View>
              );
            })}

            {bracketBoard.rounds.flatMap((round, roundIndex) =>
              (round.matches || []).map((match) => (
                <View
                  key={match.id}
                  style={[
                    styles.bracketAbsoluteMatchCard,
                    {
                      backgroundColor: hexToRgba(
                        getBracketRoundBadgeColor(roundIndex, bracketBoard.rounds.length),
                        0.14
                      ),
                      borderColor: hexToRgba(
                        getBracketRoundBadgeColor(roundIndex, bracketBoard.rounds.length),
                        0.38
                      ),
                      left: match.x,
                      top: match.y,
                      width: BRACKET_CARD_WIDTH,
                      minHeight: BRACKET_CARD_HEIGHT,
                    },
                  ]}
                >
                  {renderBracketMatchScheduleHeader(round, match, { isFullscreen: true })}
                  {(() => {
                    const isResolved = Boolean(
                      match.result?.winner || match.teamAIsBye || match.teamBIsBye
                    );
                    const teamAIsBye = Boolean(match.teamAIsBye);
                    const teamBIsBye = Boolean(match.teamBIsBye);
                    const isHighlightedTeamA =
                      !canEditFixture &&
                      highlightedPairId &&
                      String(match.teamAId || "").trim() === highlightedPairId;
                    const isHighlightedTeamB =
                      !canEditFixture &&
                      highlightedPairId &&
                      String(match.teamBId || "").trim() === highlightedPairId;

                    return renderBracketMatchBody(round, match, roundIndex, {
                      isResolved,
                      teamAIsBye,
                      teamBIsBye,
                      isHighlightedTeamA,
                      isHighlightedTeamB,
                    });
                  })()}
                </View>
              ))
            )}
          </Animated.View>
        </View>
      </View>
    );
  };

  const renderBracketShareBoard = () => {
    if (!bracketBoard) {
      return null;
    }

    return (
      <View
        collapsable={false}
        pointerEvents="none"
        ref={bracketShareViewRef}
        style={[
          styles.bracketShareCaptureWrap,
          {
            height: bracketBoard.boardHeight + spacing.lg * 2,
            width: bracketBoard.boardWidth + spacing.lg * 2,
          },
        ]}
      >
        <View
          style={[
            styles.bracketBoardCanvas,
            {
              height: bracketBoard.boardHeight,
              width: bracketBoard.boardWidth,
            },
          ]}
        >
          {bracketBoard.connectors.map((connector) => (
            <View
              key={`share-${connector.id}`}
              style={[
                connector.type === "vertical"
                  ? styles.bracketConnectorVertical
                  : styles.bracketConnectorHorizontal,
                connector.type === "vertical"
                  ? {
                      left: connector.x - BRACKET_CONNECTOR_THICKNESS / 2,
                      top: connector.y,
                      height: connector.height,
                    }
                  : {
                      left: connector.x,
                      top: connector.y - BRACKET_CONNECTOR_THICKNESS / 2,
                      width: connector.width,
                    },
              ]}
            />
          ))}

          {bracketBoard.rounds.map((round, roundIndex) => {
            const roundBadgeColor = getBracketRoundBadgeColor(
              roundIndex,
              bracketBoard.rounds.length
            );

            return (
              <View
                key={`share-${round.id}-label`}
                style={[
                  styles.bracketRoundBadge,
                  {
                    backgroundColor: roundBadgeColor,
                    borderColor: roundBadgeColor,
                    left: round.x,
                    shadowColor: roundBadgeColor,
                    width: BRACKET_CARD_WIDTH,
                  },
                ]}
              >
                <Text style={styles.roundTitle}>{round.title}</Text>
              </View>
            );
          })}

          {bracketBoard.rounds.flatMap((round, roundIndex) =>
            (round.matches || []).map((match) => {
              const teamAIsBye = Boolean(match.teamAIsBye);
              const teamBIsBye = Boolean(match.teamBIsBye);

              return (
                <View
                  key={`share-${match.id}`}
                  style={[
                    styles.bracketAbsoluteMatchCard,
                    {
                      backgroundColor: hexToRgba(
                        getBracketRoundBadgeColor(roundIndex, bracketBoard.rounds.length),
                        0.14
                      ),
                      borderColor: hexToRgba(
                        getBracketRoundBadgeColor(roundIndex, bracketBoard.rounds.length),
                        0.38
                      ),
                      left: match.x,
                      minHeight: BRACKET_CARD_HEIGHT,
                      top: match.y,
                      width: BRACKET_CARD_WIDTH,
                    },
                  ]}
                >
                  {renderBracketMatchScheduleHeader(round, match, {
                    isFullscreen: true,
                    isShareCapture: true,
                  })}
                  {renderBracketMatchBody(round, match, roundIndex, {
                    isResolved: Boolean(match.result?.winner || teamAIsBye || teamBIsBye),
                    isShareCapture: true,
                    teamAIsBye,
                    teamBIsBye,
                  })}
                </View>
              );
            })
          )}
        </View>
      </View>
    );
  };

  const renderZoneShareCaptureBoards = () => {
    if (!zoneShareChunks.length) {
      return null;
    }

    return (
      <View pointerEvents="none" style={styles.zoneShareHiddenRoot}>
        {zoneShareChunks.map((chunk, chunkIndex) => (
          <View
            collapsable={false}
            key={`zone-share-chunk-${chunkIndex}`}
            ref={(ref) => {
              zoneShareViewRefs.current[chunkIndex] = ref;
            }}
            style={styles.zoneShareCaptureCard}
          >
            <View style={styles.zoneShareHeader}>
              {zoneShareOrganizerLogoUrl ? (
                <Image source={{ uri: zoneShareOrganizerLogoUrl }} style={styles.zoneShareOrganizerLogo} />
              ) : null}
              <View style={styles.zoneShareHeaderCopy}>
              <Text style={styles.zoneShareTitle}>{tournament?.name || "Torneo"}</Text>
              <Text style={styles.zoneShareSubtitle}>
                {[
                  zoneShareCategoryLabel,
                  `Zonas ${chunkIndex * 3 + 1}-${chunkIndex * 3 + chunk.length}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              </View>
            </View>
            {chunk.map((zone) => (
              <View key={`zone-share-${zone.id}`} style={styles.zoneShareZoneCard}>
                <Text style={styles.zoneShareZoneTitle}>{zone.label}</Text>
                <View style={styles.zoneSharePairsGrid}>
                  {zone.registrations.map((registration) => (
                    <View key={`zone-share-pair-${zone.id}-${registration.id}`} style={styles.zoneSharePairRow}>
                      <Text style={styles.zoneSharePairNumber}>{registration.number}</Text>
                      <Text numberOfLines={1} style={styles.zoneSharePairName}>{registration.label}</Text>
                    </View>
                  ))}
                </View>
                <View style={styles.zoneShareMatchTable}>
                  <View style={styles.zoneShareMatchHeader}>
                    <Text style={[styles.zoneShareMatchHeaderText, styles.zoneShareResultColumn]}>RESULT.</Text>
                    <Text style={[styles.zoneShareMatchHeaderText, styles.zoneSharePairColumn]}>PAREJAS</Text>
                    <Text style={[styles.zoneShareMatchHeaderText, styles.zoneShareDayColumn]}>DIA</Text>
                    <Text style={[styles.zoneShareMatchHeaderText, styles.zoneShareTimeColumn]}>HORA</Text>
                    <Text style={[styles.zoneShareMatchHeaderText, styles.zoneSharePlaceColumn]}>LUGAR</Text>
                  </View>
                  {zone.matchRows.map((match) => (
                    <View key={`zone-share-match-${zone.id}-${match.key}`} style={styles.zoneShareMatchRow}>
                      <Text style={[styles.zoneShareMatchText, styles.zoneShareResultColumn]}>{match.resultLabel}</Text>
                      <Text style={[styles.zoneShareMatchText, styles.zoneSharePairColumn]}>{match.label}</Text>
                      <Text style={[styles.zoneShareMatchText, styles.zoneShareDayColumn]}>{match.dayLabel}</Text>
                      <Text style={[styles.zoneShareMatchText, styles.zoneShareTimeColumn]}>{match.timeLabel}</Text>
                      <Text numberOfLines={2} style={[styles.zoneShareMatchText, styles.zoneSharePlaceColumn]}>
                        {match.venueLabel}
                      </Text>
                    </View>
                  ))}
                </View>
                <View style={styles.zoneShareQualifiersRow}>
                  {zone.qualifiers.map((qualifier, qualifierIndex) => (
                    <Text
                      key={`zone-share-qualifier-${zone.id}-${qualifierIndex}`}
                      numberOfLines={1}
                      style={styles.zoneShareQualifierText}
                    >
                      {qualifierIndex + 1}° {qualifier ? qualifier.shortName : "Pendiente"}
                    </Text>
                  ))}
                </View>
              </View>
            ))}
          </View>
        ))}
      </View>
    );
  };

  if (isBracketFullscreenStandalone) {
    return (
      <SafeAreaView style={styles.bracketFullscreenSafeArea}>
        <View style={styles.bracketFullscreenHeader}>
          {bracketBoard ? renderBracketActionsMenu({ inHeader: true }) : null}
          <Text style={styles.bracketFullscreenTitle}>Llaves</Text>
          <Pressable
            accessibilityLabel="Salir de pantalla completa"
            onPress={() => {
              setBracketMatchPickerState({ roundId: "", matchId: "", field: "" });
              setBracketMatchTimePickerTarget(null);
              navigation.goBack();
            }}
            style={({ pressed }) => [
              styles.bracketFullscreenCloseButton,
              pressed ? styles.primaryButtonPressed : null,
            ]}
          >
            <Ionicons color={colors.surface} name="close" size={22} />
          </Pressable>
        </View>
        {bracketBoard ? (
          <>
            {shouldShowBracketZoneWarning ? (
              <View style={[styles.bracketWarningCard, styles.bracketFullscreenWarningCard]}>
                <Ionicons color="#1F6F78" name="alert-circle-outline" size={18} />
                <Text style={styles.bracketWarningText}>
                  Las zonas cambiaron despues de crear estas llaves. Revisa y vuelve a crear llaves para sincronizarlas.
                </Text>
              </View>
            ) : null}
            {canEditFixture && bracketSwapMode ? (
              <Text style={[styles.bracketSwapHelpText, styles.bracketFullscreenSwapHelpText]}>
                Selecciona parejas de partidos sin resultado para intercambiarlas.
              </Text>
            ) : null}
            {renderBracketBoard(true)}
          </>
        ) : loading ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator color={colors.primaryDark} />
            <Text style={styles.loaderText}>Cargando llaves...</Text>
          </View>
        ) : (
          <View style={styles.loaderWrap}>
            <Text style={styles.loaderText}>
              {canEditFixture
                ? "Todavia no hay llaves visibles. Usa `CREAR LLAVES` desde Llaves."
                : "Todavia no hay llaves visibles."}
            </Text>
          </View>
        )}
        {renderBracketShareBoard()}
        {renderBracketResultEditorModal()}
        {renderBracketProgramEditorModal()}

        <FeedbackModal
          message={feedback.message}
          onClose={() => setFeedback((current) => ({ ...current, visible: false }))}
          tone={feedback.tone}
          title={feedback.title}
          visible={feedback.visible}
        />
        {bracketMatchTimePickerTarget ? (
          <DateTimePicker
            display={Platform.OS === "ios" ? "spinner" : "clock"}
            is24Hour
            mode="time"
            onChange={handleBracketMatchTimePickerChange}
            value={buildDateFromTime(bracketMatchTimePickerTarget.currentValue)}
          />
        ) : null}
        <Modal
          animationType="fade"
          onRequestClose={() => setBracketMatchPickerState({ roundId: "", matchId: "", field: "" })}
          transparent
          visible={
            bracketMatchPickerState.field === "scheduledDayKey" &&
            Boolean(bracketMatchPickerState.roundId) &&
            Boolean(bracketMatchPickerState.matchId)
          }
        >
          <View style={styles.confirmOverlay}>
            <Pressable
              onPress={() => setBracketMatchPickerState({ roundId: "", matchId: "", field: "" })}
              style={styles.confirmBackdrop}
            />
            <View style={styles.bracketDayPickerModalCard}>
              <Text style={styles.bracketDayPickerModalTitle}>Seleccionar dia</Text>
              <View style={styles.zoneInlinePickerOptions}>
                {tournamentDayOptions.map((option) => {
                  const currentRound = (currentBracketPreview?.rounds || []).find(
                    (round) => round.id === bracketMatchPickerState.roundId
                  );
                  const currentMatch = (currentRound?.matches || []).find(
                    (match) => match.id === bracketMatchPickerState.matchId
                  );
                  const isSelected = option.key === String(currentMatch?.scheduledDayKey || "");

                  return (
                    <Pressable
                      key={`bracket-standalone-day-${option.key}`}
                      onPress={() =>
                        handleUpdateBracketMatchScheduleField(
                          bracketMatchPickerState.roundId,
                          bracketMatchPickerState.matchId,
                          "scheduledDayKey",
                          option.key
                        )
                      }
                      style={[
                        styles.zoneInlinePickerOption,
                        isSelected ? styles.zoneInlinePickerOptionSelected : null,
                      ]}
                    >
                      <Text
                        style={[
                          styles.zoneInlinePickerOptionText,
                          isSelected ? styles.zoneInlinePickerOptionTextSelected : null,
                        ]}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Pressable
                onPress={() => setBracketMatchPickerState({ roundId: "", matchId: "", field: "" })}
                style={({ pressed }) => [
                  styles.zoneInlinePickerCloseButton,
                  pressed ? styles.primaryButtonPressed : null,
                ]}
              >
                <Text style={styles.zoneInlinePickerCloseButtonText}>Cerrar</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
        <Modal
          animationType="fade"
          onRequestClose={() => setBracketMatchPickerState({ roundId: "", matchId: "", field: "" })}
          transparent
          visible={Boolean(activeBracketCourtPicker)}
        >
          <View style={styles.confirmOverlay}>
            <Pressable
              onPress={() => setBracketMatchPickerState({ roundId: "", matchId: "", field: "" })}
              style={styles.confirmBackdrop}
            />
            <View style={styles.bracketDayPickerModalCard}>
              <Text style={styles.bracketDayPickerModalTitle}>Seleccionar cancha</Text>
              <View style={styles.zoneInlinePickerOptions}>
                {(activeBracketCourtPicker?.options || []).map((option) => {
                  const isSelected =
                    option.value === activeBracketCourtPicker?.currentCourtLabel ||
                    option.label === activeBracketCourtPicker?.currentCourtName;

                  return (
                    <Pressable
                      key={`bracket-standalone-court-${option.label}`}
                      onPress={() =>
                        handleUpdateBracketMatchCourt(
                          activeBracketCourtPicker.roundId,
                          activeBracketCourtPicker.matchId,
                          option
                        )
                      }
                      style={[
                        styles.zoneInlinePickerOption,
                        isSelected ? styles.zoneInlinePickerOptionSelected : null,
                      ]}
                    >
                      <Text
                        style={[
                          styles.zoneInlinePickerOptionText,
                          isSelected ? styles.zoneInlinePickerOptionTextSelected : null,
                        ]}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Pressable
                onPress={() => setBracketMatchPickerState({ roundId: "", matchId: "", field: "" })}
                style={({ pressed }) => [
                  styles.zoneInlinePickerCloseButton,
                  pressed ? styles.primaryButtonPressed : null,
                ]}
              >
                <Text style={styles.zoneInlinePickerCloseButtonText}>Cerrar</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader onBack={() => navigation.goBack()} subtitle="Fixture torneo" />

      <View style={styles.container}>
        {loading ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator color={colors.primaryDark} />
            <Text style={styles.loaderText}>Cargando fixture...</Text>
          </View>
        ) : tournament ? (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
          >
            <TournamentHeaderCard
              category={tournament?.compositionConfig?.label || tournament?.compositionLabel || ""}
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
              title={tournament?.name || "Torneo"}
              titleColorSeed={[tournament?.creationBatchId, tournament?.name]
                .map((value) => String(value || "").trim())
                .filter(Boolean)
                .join(":")}
            />

            <View style={styles.actionsRow}>
              {canEditFixture ? (
                <Pressable
                  onPress={() => handleChangeActiveSection("configuration")}
                  style={({ pressed }) => [
                    styles.actionButton,
                    activeSection === "configuration" ? styles.actionButtonActive : null,
                    pressed ? styles.actionButtonPressed : null,
                  ]}
                >
                  <Ionicons
                    color={activeSection === "configuration" ? colors.surface : colors.primaryDark}
                    name="construct-outline"
                    size={18}
                  />
                  <Text
                    style={[
                      styles.actionButtonText,
                      styles.actionButtonTextCompact,
                      activeSection === "configuration" ? styles.actionButtonTextActive : null,
                    ]}
                  >
                    CONFIGURAR
                  </Text>
                </Pressable>
              ) : null}

              <Pressable
                onPress={() => handleChangeActiveSection("newzones")}
                style={({ pressed }) => [
                  styles.actionButton,
                  activeSection === "newzones" ? styles.actionButtonActive : null,
                  pressed ? styles.actionButtonPressed : null,
                ]}
              >
                <Ionicons
                  color={activeSection === "newzones" ? colors.surface : colors.primaryDark}
                  name="calendar-outline"
                  size={18}
                />
                <Text
                  style={[
                    styles.actionButtonText,
                    styles.actionButtonTextCompact,
                    activeSection === "newzones" ? styles.actionButtonTextActive : null,
                  ]}
                >
                  {canEditFixture ? "NUEVAS ZONAS" : "ZONAS"}
                </Text>
              </Pressable>

              <Pressable
                disabled={bracketOpening}
                onPress={handlePressBracketSection}
                style={({ pressed }) => [
                  styles.actionButton,
                  activeSection === "bracket" ? styles.actionButtonActive : null,
                  pressed ? styles.actionButtonPressed : null,
                ]}
              >
                {bracketOpening ? (
                  <ActivityIndicator
                    color={activeSection === "bracket" ? colors.surface : colors.primaryDark}
                    size="small"
                  />
                ) : (
                  <Ionicons
                    color={activeSection === "bracket" ? colors.surface : colors.primaryDark}
                    name="git-branch-outline"
                    size={18}
                    style={styles.bracketActionIcon}
                  />
                )}
                <Text
                  style={[
                    styles.actionButtonText,
                    activeSection === "bracket" ? styles.actionButtonTextActive : null,
                  ]}
                >
                  LLAVES
                </Text>
              </Pressable>
            </View>

            {canEditFixture && activeSection === "configuration" ? (
              <View style={styles.card}>
                <View style={styles.summaryInlineCard}>
                  <Text style={styles.summaryLabel}>Parejas confirmadas</Text>
                  <Text style={styles.summaryValue}>{confirmedPairCount}</Text>
                </View>

                <View style={styles.formatAccordionStack}>
                  <View
                    style={[
                      styles.formatSectionCard,
                      selectedRapidMode === "single_set" ? styles.formatSectionCardDisabled : null,
                    ]}
                  >
                    <Pressable
                      onPress={() =>
                        setExpandedFormatSection((current) => (current === "zones" ? "" : "zones"))
                      }
                      style={styles.formatSectionHeader}
                    >
                      <View style={styles.formatSectionHeaderCopy}>
                        <Text
                          style={[
                            styles.formatSectionTitle,
                            selectedRapidMode === "single_set" ? styles.formatSectionTitleDisabled : null,
                          ]}
                        >
                          Zonas
                        </Text>
                        <Text
                          style={[
                            styles.formatSectionSummary,
                            selectedRapidMode === "single_set" ? styles.formatSectionSummaryDisabled : null,
                          ]}
                        >
                          DEFINICION · {getCompactMatchFormatLabel(currentMatchFormat.zones)}
                        </Text>
                      </View>
                      <Ionicons
                        color={selectedRapidMode === "single_set" ? "#9AA6B2" : colors.primaryDark}
                        name={
                          expandedFormatSection === "zones"
                            ? "chevron-up-circle"
                            : "chevron-down-circle"
                        }
                        size={20}
                      />
                    </Pressable>
                    {expandedFormatSection === "zones" ? (
                      <View style={styles.formatSectionBody}>
                        <View style={styles.selectionList}>
                          <Pressable
                            disabled={selectedRapidMode === "single_set"}
                            onPress={() => handleSelectZoneMatchFormat("third_set")}
                            style={[
                              styles.selectionRow,
                              selectedZoneMatchFormat === "third_set" ? styles.selectionRowActive : null,
                              selectedRapidMode === "single_set" ? styles.selectionRowDisabled : null,
                            ]}
                          >
                            <View style={styles.selectionRowIconWrap}>
                              {selectedZoneMatchFormat === "third_set" && selectedRapidMode !== "single_set" ? (
                                <Ionicons color={colors.primaryDark} name="checkmark-circle" size={16} />
                              ) : (
                                <Ionicons
                                  color={selectedRapidMode === "single_set" ? "#C4CCD6" : "#B7C0CB"}
                                  name="ellipse-outline"
                                  size={16}
                                />
                              )}
                            </View>
                            <Text
                              style={[
                                styles.selectionRowText,
                                selectedZoneMatchFormat === "third_set" ? styles.selectionRowTextActive : null,
                                selectedRapidMode === "single_set" ? styles.selectionRowTextDisabled : null,
                              ]}
                            >
                              3ER SET
                            </Text>
                          </Pressable>
                          <Pressable
                            disabled={selectedRapidMode === "single_set"}
                            onPress={() => handleSelectZoneMatchFormat("super_tiebreak")}
                            style={[
                              styles.selectionRow,
                              selectedZoneMatchFormat === "super_tiebreak" ? styles.selectionRowActive : null,
                              selectedRapidMode === "single_set" ? styles.selectionRowDisabled : null,
                            ]}
                          >
                            <View style={styles.selectionRowIconWrap}>
                              {selectedZoneMatchFormat === "super_tiebreak" && selectedRapidMode !== "single_set" ? (
                                <Ionicons color={colors.primaryDark} name="checkmark-circle" size={16} />
                              ) : (
                                <Ionicons
                                  color={selectedRapidMode === "single_set" ? "#C4CCD6" : "#B7C0CB"}
                                  name="ellipse-outline"
                                  size={16}
                                />
                              )}
                            </View>
                            <View style={styles.selectionInlineRow}>
                              <Text
                                style={[
                                  styles.selectionInlineLabel,
                                  selectedZoneMatchFormat === "super_tiebreak"
                                    ? styles.selectionRowTextActive
                                    : null,
                                  selectedRapidMode === "single_set" ? styles.selectionRowTextDisabled : null,
                                ]}
                              >
                                SUPER TIE BREAK A
                              </Text>
                              <TextInput
                                editable={selectedRapidMode !== "single_set"}
                                keyboardType="number-pad"
                                maxLength={2}
                                onChangeText={(value) =>
                                  setSelectedZoneSuperTieBreakPoints(
                                    String(value || "").replace(/\D/g, "").slice(0, 2) || "11"
                                  )
                                }
                                onFocus={() => {
                                  if (selectedRapidMode !== "single_set") {
                                    handleSelectZoneMatchFormat("super_tiebreak");
                                  }
                                }}
                                placeholder="11"
                                placeholderTextColor={colors.muted}
                                style={[
                                  styles.selectionInlineInput,
                                  selectedZoneMatchFormat === "super_tiebreak"
                                    ? styles.selectionInlineInputActive
                                    : null,
                                  selectedRapidMode === "single_set"
                                    ? styles.selectionInlineInputDisabled
                                    : null,
                                ]}
                                value={selectedZoneSuperTieBreakPoints}
                              />
                              <Text
                                style={[
                                  styles.selectionInlineLabel,
                                  selectedZoneMatchFormat === "super_tiebreak"
                                    ? styles.selectionRowTextActive
                                    : null,
                                  selectedRapidMode === "single_set" ? styles.selectionRowTextDisabled : null,
                                ]}
                              >
                                PTS
                              </Text>
                            </View>
                          </Pressable>
                        </View>
                        {selectedRapidMode === "single_set" ? (
                          <Text style={styles.rapidModeInfoText}>
                            Modo relampago activo para zonas.
                          </Text>
                        ) : null}
                      </View>
                    ) : null}
                  </View>

                  <View
                    style={[
                      styles.formatSectionCard,
                      selectedRapidMode === "single_set" ? styles.formatSectionCardDisabled : null,
                    ]}
                  >
                    <Pressable
                      onPress={() =>
                        setExpandedFormatSection((current) => (current === "bracket" ? "" : "bracket"))
                      }
                      style={styles.formatSectionHeader}
                    >
                      <View style={styles.formatSectionHeaderCopy}>
                        <Text
                          style={[
                            styles.formatSectionTitle,
                            selectedRapidMode === "single_set" ? styles.formatSectionTitleDisabled : null,
                          ]}
                        >
                          Llaves
                        </Text>
                        <Text
                          style={[
                            styles.formatSectionSummary,
                            selectedRapidMode === "single_set" ? styles.formatSectionSummaryDisabled : null,
                          ]}
                        >
                          DEFINICION · {getCompactMatchFormatLabel(currentMatchFormat.bracket)}
                        </Text>
                      </View>
                      <Ionicons
                        color={selectedRapidMode === "single_set" ? "#9AA6B2" : colors.primaryDark}
                        name={
                          expandedFormatSection === "bracket"
                            ? "chevron-up-circle"
                            : "chevron-down-circle"
                        }
                        size={20}
                      />
                    </Pressable>
                    {expandedFormatSection === "bracket" ? (
                      <View style={styles.formatSectionBody}>
                        <View style={styles.selectionList}>
                          <Pressable
                            disabled={selectedRapidMode === "single_set"}
                            onPress={() => handleSelectBracketMatchFormat("third_set")}
                            style={[
                              styles.selectionRow,
                              selectedBracketMatchFormat === "third_set" ? styles.selectionRowActive : null,
                              selectedRapidMode === "single_set" ? styles.selectionRowDisabled : null,
                            ]}
                          >
                            <View style={styles.selectionRowIconWrap}>
                              {selectedBracketMatchFormat === "third_set" && selectedRapidMode !== "single_set" ? (
                                <Ionicons color={colors.primaryDark} name="checkmark-circle" size={16} />
                              ) : (
                                <Ionicons
                                  color={selectedRapidMode === "single_set" ? "#C4CCD6" : "#B7C0CB"}
                                  name="ellipse-outline"
                                  size={16}
                                />
                              )}
                            </View>
                            <Text
                              style={[
                                styles.selectionRowText,
                                selectedBracketMatchFormat === "third_set" ? styles.selectionRowTextActive : null,
                                selectedRapidMode === "single_set" ? styles.selectionRowTextDisabled : null,
                              ]}
                            >
                              3ER SET
                            </Text>
                          </Pressable>
                          <Pressable
                            disabled={selectedRapidMode === "single_set"}
                            onPress={() => handleSelectBracketMatchFormat("super_tiebreak")}
                            style={[
                              styles.selectionRow,
                              selectedBracketMatchFormat === "super_tiebreak" ? styles.selectionRowActive : null,
                              selectedRapidMode === "single_set" ? styles.selectionRowDisabled : null,
                            ]}
                          >
                            <View style={styles.selectionRowIconWrap}>
                              {selectedBracketMatchFormat === "super_tiebreak" && selectedRapidMode !== "single_set" ? (
                                <Ionicons color={colors.primaryDark} name="checkmark-circle" size={16} />
                              ) : (
                                <Ionicons
                                  color={selectedRapidMode === "single_set" ? "#C4CCD6" : "#B7C0CB"}
                                  name="ellipse-outline"
                                  size={16}
                                />
                              )}
                            </View>
                            <View style={styles.selectionInlineRow}>
                              <Text
                                style={[
                                  styles.selectionInlineLabel,
                                  selectedBracketMatchFormat === "super_tiebreak"
                                    ? styles.selectionRowTextActive
                                    : null,
                                  selectedRapidMode === "single_set" ? styles.selectionRowTextDisabled : null,
                                ]}
                              >
                                SUPER TIE BREAK A
                              </Text>
                              <TextInput
                                editable={selectedRapidMode !== "single_set"}
                                keyboardType="number-pad"
                                maxLength={2}
                                onChangeText={(value) =>
                                  setSelectedBracketSuperTieBreakPoints(
                                    String(value || "").replace(/\D/g, "").slice(0, 2) || "11"
                                  )
                                }
                                onFocus={() => {
                                  if (selectedRapidMode !== "single_set") {
                                    handleSelectBracketMatchFormat("super_tiebreak");
                                  }
                                }}
                                placeholder="11"
                                placeholderTextColor={colors.muted}
                                style={[
                                  styles.selectionInlineInput,
                                  selectedBracketMatchFormat === "super_tiebreak"
                                    ? styles.selectionInlineInputActive
                                    : null,
                                  selectedRapidMode === "single_set"
                                    ? styles.selectionInlineInputDisabled
                                    : null,
                                ]}
                                value={selectedBracketSuperTieBreakPoints}
                              />
                              <Text
                                style={[
                                  styles.selectionInlineLabel,
                                  selectedBracketMatchFormat === "super_tiebreak"
                                    ? styles.selectionRowTextActive
                                    : null,
                                  selectedRapidMode === "single_set" ? styles.selectionRowTextDisabled : null,
                                ]}
                              >
                                PTS
                              </Text>
                            </View>
                          </Pressable>
                        </View>
                        {selectedRapidMode === "single_set" ? (
                          <Text style={styles.rapidModeInfoText}>
                            Modo relampago activo para llaves.
                          </Text>
                        ) : null}
                        {selectedRapidMode !== "single_set" &&
                        selectedBracketMatchFormat === "super_tiebreak" ? (
                          <View style={styles.finalStagesCard}>
                            <Text style={styles.finalStagesTitle}>Instancias finales</Text>
                            <SelectionList
                              onSelect={setSelectedBracketFinalOverride}
                              options={BRACKET_FINAL_OVERRIDE_OPTIONS}
                              selectedValue={selectedBracketFinalOverride}
                            />
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                  </View>

                  <View style={styles.configurationModeCard}>
                    <Pressable
                      onPress={() =>
                        handleSelectRapidMode(
                          selectedRapidMode === "single_set" ? "off" : "single_set"
                        )
                      }
                      style={[
                        styles.rapidModeSimpleRow,
                        selectedRapidMode === "single_set" ? styles.rapidModeSimpleRowActive : null,
                      ]}
                    >
                      <Ionicons
                        color={selectedRapidMode === "single_set" ? colors.primaryDark : "#9AA6B2"}
                        name={
                          selectedRapidMode === "single_set"
                            ? "checkmark-circle"
                            : "radio-button-off-outline"
                        }
                        size={18}
                      />
                      <Text
                        style={[
                          styles.rapidModeSimpleLabel,
                          selectedRapidMode === "single_set" ? styles.selectionRowTextActive : null,
                        ]}
                      >
                        MODO RELAMPAGO
                      </Text>
                    </Pressable>
                    <View style={styles.rapidModeSimpleInfoRow}>
                      <Text style={styles.inlinePointsLabel}>1 SOLO SET A</Text>
                      <TextInput
                        keyboardType="number-pad"
                        maxLength={2}
                        onChangeText={(value) =>
                          setSelectedRapidModePoints(
                            String(value || "").replace(/\D/g, "").slice(0, 2) || "9"
                          )
                        }
                        placeholder="9"
                        placeholderTextColor={colors.muted}
                        style={[
                          styles.inlineRapidModeInput,
                          selectedRapidMode === "single_set"
                            ? styles.inlineRapidModeInputActive
                            : null,
                        ]}
                        value={selectedRapidModePoints}
                      />
                      <Text style={styles.inlinePointsLabel}>PTS</Text>
                    </View>
                  </View>

                  <View style={styles.superTieBreakPointsCard}>
                    <Text style={styles.superTieBreakPointsLabel}>
                      Duracion de partido promedio
                    </Text>
                    <TextInput
                      keyboardType="numbers-and-punctuation"
                      maxLength={5}
                      onChangeText={(value) => setSelectedMatchDuration(normalizeTypedTimeInput(value))}
                      placeholder="1:15"
                      placeholderTextColor={colors.muted}
                      style={styles.superTieBreakPointsInput}
                      value={selectedMatchDuration}
                    />
                  </View>
                </View>

                {configurationHasUnsavedChanges ? (
                  <Text style={styles.unsavedChangesText}>
                    Hay cambios sin guardar en la configuracion.
                  </Text>
                ) : null}

                <View style={styles.primaryButtonWrap}>
                  <Pressable
                    onPress={handleCreateConfiguration}
                    style={({ pressed }) => [
                      styles.configSaveButton,
                      pressed ? styles.primaryButtonPressed : null,
                    ]}
                  >
                    <Ionicons color={colors.primaryDark} name="construct-outline" size={15} />
                    <Text style={styles.configSaveButtonText}>
                      {savingKey === "configuration" ? "GUARDANDO..." : "GUARDAR CONFIGURACION"}
                    </Text>
                    </Pressable>
                  </View>
              </View>
            ) : null}

            {canEditFixture && activeSection === "configuration" ? (
              <View style={styles.card}>
                <View style={styles.venueScheduleCardNoMargin}>
                  <Text style={styles.venueScheduleTitle}>Disponibilidad de sedes para zonas</Text>
                  <Text style={styles.venueScheduleHelpText}>
                    Agrega las franjas horarias de canchas disponibles.
                  </Text>
                  <Text style={styles.venueScheduleMicrocopy}>
                    Franjas para llaves detectadas: {bracketVenueSchedulesForDisplay.length}
                  </Text>
                  {tournamentVenueOptions.length ? (
                    <View style={styles.venueScheduleVenueBlocks}>
                      {tournamentVenueOptions.map((venue, venueIndex) => {
                        const venueId = venue.id;
                        const venueDraft = scheduleVenueDrafts?.[venueId] || {};
                        const venueSchedules = zoneVenueSchedules.filter((schedule) => schedule.venueId === venueId);
                        const colorKey =
                          VENUE_SCHEDULE_COLOR_KEYS[
                            venueIndex % VENUE_SCHEDULE_COLOR_KEYS.length
                          ];
                        const isVenueEnabled = Boolean(venueDraft.useForZones || venueDraft.useForBracket);
                        const isExpanded = expandedVenueScheduleIds.includes(venueId);

                        return (
                          <View
                            key={venueId}
                            style={[
                              styles.venueScheduleVenueCard,
                              styles[`venueScheduleVenueCard${colorKey[0].toUpperCase()}${colorKey.slice(1)}`],
                            ]}
                          >
                            <Pressable
                              onPress={() => toggleVenueScheduleExpanded(venueId)}
                              style={styles.venueScheduleVenueHeader}
                            >
                              <View style={styles.venueScheduleVenueHeaderCopy}>
                                <Text style={styles.venueScheduleVenueTitle}>
                                  {`Sede ${venueIndex + 1}`}
                                </Text>
                                <Text style={styles.venueScheduleVenueName}>{venue.name}</Text>
                                <View style={styles.venueScheduleVenueMetaInline}>
                                  <TextInput
                                    keyboardType="number-pad"
                                    maxLength={2}
                                    onChangeText={(value) =>
                                      updateScheduleVenueDraft(venueId, {
                                        courts: String(value || "")
                                          .replace(/\D/g, "")
                                          .slice(0, 2) || "1",
                                      })
                                    }
                                    placeholder={String(Math.max(Number(venue.totalCanchas || 0) || 0, 1))}
                                    placeholderTextColor={colors.muted}
                                    style={styles.venueScheduleVenueMetaInput}
                                    value={String(venueDraft.courts || "")}
                                  />
                                  <Text style={styles.venueScheduleVenueMetaValue}>
                                    cancha{Number(venueDraft.courts || 0) === 1 ? "" : "s"} disponibles
                                  </Text>
                                </View>
                              </View>
                              <View style={styles.venueScheduleVenueHeaderAside}>
                                <View
                                  style={[
                                    styles.venueStatusBadge,
                                    isVenueEnabled
                                      ? styles.venueStatusBadgeEnabled
                                      : styles.venueStatusBadgePending,
                                  ]}
                                >
                                  <Ionicons
                                    color={isVenueEnabled ? "#167A45" : "#A86500"}
                                    name={isVenueEnabled ? "ellipse" : "ellipse-outline"}
                                    size={14}
                                  />
                                  <Text
                                    style={[
                                      styles.venueStatusBadgeText,
                                      isVenueEnabled
                                        ? styles.venueStatusBadgeTextEnabled
                                        : styles.venueStatusBadgeTextPending,
                                    ]}
                                  >
                                    {isVenueEnabled ? "Disponible" : "Sin seleccionar"}
                                  </Text>
                                </View>
                                <Ionicons
                                  color={colors.muted}
                                  name={isExpanded ? "chevron-up-outline" : "chevron-down-outline"}
                                  size={20}
                                />
                              </View>
                            </Pressable>

                            {isExpanded ? (
                              <>
                                <View style={styles.venueUsageRow}>
                                  <Pressable
                                    onPress={() => toggleScheduleVenueUsage(venueId, "useForZones")}
                                    style={[
                                      styles.inlineChip,
                                      venueDraft.useForZones ? styles.inlineChipActive : null,
                                    ]}
                                  >
                                    <Text
                                      style={[
                                        styles.inlineChipText,
                                        venueDraft.useForZones ? styles.inlineChipTextActive : null,
                                      ]}
                                    >
                                      Utilizar en Zonas
                                    </Text>
                                  </Pressable>
                                  <Pressable
                                    onPress={() => toggleScheduleVenueUsage(venueId, "useForBracket")}
                                    style={[
                                      styles.inlineChip,
                                      venueDraft.useForBracket ? styles.inlineChipActive : null,
                                    ]}
                                  >
                                    <Text
                                      style={[
                                        styles.inlineChipText,
                                        venueDraft.useForBracket ? styles.inlineChipTextActive : null,
                                      ]}
                                    >
                                      Utilizar en Llaves
                                    </Text>
                                  </Pressable>
                                </View>

                                {isVenueEnabled ? (
                                  <>
                                    <Text style={styles.inlineFieldLabel}>Horario de sede disponible</Text>

                                    <Text style={styles.inlineFieldLabel}>Dia</Text>
                                    <View style={styles.inlineChipWrap}>
                                      {tournamentDayOptions.map((day) => (
                                        <Pressable
                                          key={`${venueId}-${day.key}`}
                                          onPress={() => selectScheduleVenueDay(venueId, day.key)}
                                          style={[
                                            styles.inlineChip,
                                            venueDraft.selectedDayKey === day.key ? styles.inlineChipActive : null,
                                          ]}
                                        >
                                          <Text
                                            style={[
                                              styles.inlineChipText,
                                              venueDraft.selectedDayKey === day.key
                                                ? styles.inlineChipTextActive
                                                : null,
                                            ]}
                                          >
                                            {day.label}
                                          </Text>
                                        </Pressable>
                                      ))}
                                    </View>

                                    <View style={styles.venueScheduleRow}>
                                      <View style={styles.venueScheduleField}>
                                        <Text style={styles.inlineFieldLabel}>Desde</Text>
                                        <Pressable
                                          onPress={() =>
                                            setScheduleVenueTimePickerTarget({
                                              venueId,
                                              field: "from",
                                              currentValue: venueDraft.from || "09:00",
                                            })
                                          }
                                          style={({ pressed }) => [
                                            styles.venueScheduleInput,
                                            styles.venueScheduleTimeButton,
                                            pressed ? styles.primaryButtonPressed : null,
                                          ]}
                                        >
                                          <Ionicons color={colors.primaryDark} name="time-outline" size={15} />
                                          <Text style={styles.venueScheduleTimeButtonText}>
                                            {venueDraft.from || "09:00"}
                                          </Text>
                                        </Pressable>
                                      </View>
                                      <View style={styles.venueScheduleField}>
                                        <Text style={styles.inlineFieldLabel}>Hasta</Text>
                                        <Pressable
                                          onPress={() =>
                                            setScheduleVenueTimePickerTarget({
                                              venueId,
                                              field: "to",
                                              currentValue: venueDraft.to || "18:00",
                                            })
                                          }
                                          style={({ pressed }) => [
                                            styles.venueScheduleInput,
                                            styles.venueScheduleTimeButton,
                                            pressed ? styles.primaryButtonPressed : null,
                                          ]}
                                        >
                                          <Ionicons color={colors.primaryDark} name="time-outline" size={15} />
                                          <Text style={styles.venueScheduleTimeButtonText}>
                                            {venueDraft.to || "18:00"}
                                          </Text>
                                        </Pressable>
                                      </View>
                                    </View>

                                    <View style={styles.primaryButtonWrap}>
                                      <Pressable
                                        onPress={() => handleAddZoneVenueSchedule(venueId)}
                                        style={({ pressed }) => [
                                          styles.configSaveButton,
                                          pressed ? styles.primaryButtonPressed : null,
                                        ]}
                                      >
                                        <Ionicons color={colors.primaryDark} name="add-circle-outline" size={15} />
                                        <Text style={styles.configSaveButtonText}>
                                          {savingKey === "venue-schedules" ? "GUARDANDO..." : "GUARDAR FRANJA"}
                                        </Text>
                                      </Pressable>
                                    </View>

                                    {venueSchedules.length ? (
                                      <View style={styles.venueScheduleList}>
                                        {venueSchedules.map((schedule) => (
                                          <View key={schedule.id} style={styles.venueScheduleListCard}>
                                            <View style={styles.venueScheduleListCopy}>
                                              <Text style={styles.venueScheduleListMeta}>
                                                {formatScheduleDayDisplay(schedule.dayKey, tournamentDayOptions)} - {schedule.from} a {schedule.to}
                                              </Text>
                                            </View>
                                            <Pressable
                                              onPress={() => handleRemoveZoneVenueSchedule(schedule.id)}
                                              style={({ pressed }) => [
                                                styles.scheduleDeleteButton,
                                                pressed ? styles.primaryButtonPressed : null,
                                              ]}
                                            >
                                              <Ionicons color={colors.danger} name="trash-outline" size={18} />
                                            </Pressable>
                                          </View>
                                        ))}
                                      </View>
                                    ) : (
                                      <Text style={styles.emptyText}>
                                        Aun no cargaste franjas horarias para esta sede.
                                      </Text>
                                    )}
                                  </>
                                ) : null}
                              </>
                            ) : null}
                          </View>
                        );
                      })}
                    </View>
                  ) : (
                    <Text style={styles.emptyText}>
                      No hay sedes disponibles para cargar horarios.
                    </Text>
                  )}
                </View>

              </View>
            ) : null}

            {activeSection === "newzones" ? (
              <View style={styles.newZonesSection}>
                {canEditFixture ? (
                  <View style={styles.configurationActionsRow}>
                    <Pressable
                      onPress={handleCreateNewAutoZonesPress}
                      style={({ pressed }) => [
                        styles.secondaryActionButton,
                        styles.newZoneModeButton,
                        pressed ? styles.primaryButtonPressed : null,
                      ]}
                    >
                      <Text style={[styles.secondaryActionButtonText, styles.newZoneModeButtonText]}>
                        {savingKey === "zones" ? "CREANDO..." : "ARMADO\nAUTOMATICO"}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        navigation.navigate("TournamentZonePlanning", {
                          tournamentId: tournament.id,
                          tournamentName: tournament.name || "Torneo",
                        })
                      }
                      style={({ pressed }) => [
                        styles.secondaryActionButton,
                        styles.newZoneModeButton,
                        pressed ? styles.primaryButtonPressed : null,
                      ]}
                    >
                      <Text style={[styles.secondaryActionButtonText, styles.newZoneModeButtonText]}>
                        ARMADO{"\n"}MANUAL
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
                {hasZonePlanningUnsavedChanges ? (
                  <Text style={styles.unsavedChangesText}>
                    Hay cambios sin guardar en Nuevas zonas.
                  </Text>
                ) : null}
                {newZonePlanningZones.length ? (
                  <View style={styles.newZonesStack}>
                    {newZonePlanningZones.map((zone) => (
                      <View key={zone.id} style={styles.newZoneCard}>
                        <View style={styles.newZoneTitleWrap}>
                          <Text style={styles.newZoneTitle}>{zone.label}</Text>
                          <Text style={styles.newZoneBracketSeedText}>
                            Llaves: Zona {zone.bracketLetter}
                          </Text>
                        </View>
                        <View style={styles.newZonePairsStack}>
                          {zone.registrations.map((registration) => (
                            <View
                              key={registration.id}
                              style={[
                                styles.newZonePairRow,
                                highlightedPairId && registration.id === highlightedPairId
                                  ? styles.newZonePairRowHighlighted
                                  : null,
                              ]}
                            >
                              <View
                                style={[
                                  styles.newZonePairNumber,
                                  highlightedPairId && registration.id === highlightedPairId
                                    ? styles.newZonePairNumberHighlighted
                                    : null,
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.newZonePairNumberText,
                                    highlightedPairId && registration.id === highlightedPairId
                                      ? styles.newZonePairNumberTextHighlighted
                                      : null,
                                  ]}
                                >
                                  {registration.number}
                                </Text>
                              </View>
                              <Text
                                numberOfLines={1}
                                style={[
                                  styles.newZonePairName,
                                  highlightedPairId && registration.id === highlightedPairId
                                    ? styles.newZonePairNameHighlighted
                                    : null,
                                ]}
                              >
                                {registration.label}
                              </Text>
                            </View>
                          ))}
                        </View>
                        <View style={styles.newZoneMatchTable}>
                          <View style={styles.newZoneMatchHeader}>
                            <Text style={[styles.newZoneMatchHeaderText, styles.newZoneResultColumn]}>
                              RESULTADOS
                            </Text>
                            <Text style={[styles.newZoneMatchHeaderText, styles.newZonePairColumn]}>
                              PAREJAS
                            </Text>
                            <Text style={[styles.newZoneMatchHeaderText, styles.newZoneDayColumn]}>
                              DIA
                            </Text>
                            <Text style={[styles.newZoneMatchHeaderText, styles.newZoneTimeColumn]}>
                              HORARIO
                            </Text>
                            <Text style={[styles.newZoneMatchHeaderText, styles.newZonePlaceColumn]}>
                              LUGAR
                            </Text>
                          </View>
                          {zone.matchRows.length ? (
                            zone.matchRows.map((match) => {
                              const isSavingMatch = zonePlanningSavingKey === `${zone.id}-${match.key}`;
                              const isSavingResult = isSavingMatch && Boolean(zonePlanningResultEditor);

                              return (
                              <View key={`${zone.id}-${match.key}`} style={styles.newZoneMatchRow}>
                                <Pressable
                                  disabled={!canEditFixture}
                                  onPress={() => openZonePlanningResultEditor(zone.id, match.key)}
                                  style={[
                                    styles.newZoneEditableCell,
                                    styles.newZoneResultColumn,
                                    !canEditFixture ? styles.newZoneEditableCellDisabled : null,
                                  ]}
                                >
                                  <Text numberOfLines={1} style={styles.newZoneMatchCellText}>
                                    {isSavingResult ? "..." : match.resultLabel}
                                  </Text>
                                </Pressable>
                                <Text
                                  numberOfLines={1}
                                  style={[styles.newZoneMatchCellText, styles.newZonePairColumn]}
                                >
                                  {match.pairNumbers?.length === 2 ? (
                                    <>
                                      <Text
                                        style={
                                          String(match.winnerPairNumber) === String(match.pairNumbers[0])
                                            ? styles.newZoneWinnerPairNumber
                                            : null
                                        }
                                      >
                                        {match.pairNumbers[0]}
                                      </Text>
                                      <Text> vs </Text>
                                      <Text
                                        style={
                                          String(match.winnerPairNumber) === String(match.pairNumbers[1])
                                            ? styles.newZoneWinnerPairNumber
                                            : null
                                        }
                                      >
                                        {match.pairNumbers[1]}
                                      </Text>
                                    </>
                                  ) : (
                                    match.label
                                  )}
                                </Text>
                                <Pressable
                                  disabled={!canEditFixture}
                                  onPress={() => openZonePlanningDayPicker(zone.id, match.key, match.dayKey)}
                                  style={[
                                    styles.newZoneEditableCell,
                                    styles.newZoneDayColumn,
                                    !canEditFixture ? styles.newZoneEditableCellDisabled : null,
                                  ]}
                                >
                                  <Text numberOfLines={1} style={styles.newZoneMatchCellText}>
                                    {match.dayLabel}
                                  </Text>
                                </Pressable>
                                <Pressable
                                  disabled={!canEditFixture}
                                  onPress={() =>
                                    setZonePlanningTimePickerTarget({
                                      currentValue: match.startTime || "19:00",
                                      matchKey: match.key,
                                      zoneId: zone.id,
                                    })
                                  }
                                  style={[
                                    styles.newZoneEditableCell,
                                    styles.newZoneTimeColumn,
                                    !canEditFixture ? styles.newZoneEditableCellDisabled : null,
                                  ]}
                                >
                                  <Text numberOfLines={1} style={styles.newZoneMatchCellText}>
                                    {match.timeLabel}
                                  </Text>
                                </Pressable>
                                <Pressable
                                  disabled={!canEditFixture}
                                  onPress={() => cycleZonePlanningMatchVenue(zone.id, match.key, match.venueId)}
                                  style={[
                                    styles.newZoneEditableCell,
                                    styles.newZonePlaceColumn,
                                    !canEditFixture ? styles.newZoneEditableCellDisabled : null,
                                  ]}
                                >
                                  <Text numberOfLines={2} style={[styles.newZoneMatchCellText, styles.newZonePlaceText]}>
                                    {match.venueLabel}
                                  </Text>
                                </Pressable>
                              </View>
                              );
                            })
                          ) : (
                            <Text style={styles.newZoneEmptyText}>
                              Agrega 2, 3 o 4 parejas para ver los cruces.
                            </Text>
                          )}
                        </View>
                        <View style={styles.zoneQualifiersRow}>
                          <View style={styles.zoneQualifiersTextWrap}>
                            {zone.qualifiers.map((qualifier, qualifierIndex) => (
                              <Text
                                key={`${zone.id}-qualifier-${qualifierIndex}`}
                                numberOfLines={1}
                                style={styles.zoneQualifierText}
                              >
                                {qualifierIndex + 1}° {qualifier ? qualifier.shortName : "Pendiente"}
                              </Text>
                            ))}
                          </View>
                          <Pressable
                            onPress={() => setZonePlanningStandingsModalZoneId(zone.id)}
                            style={styles.zoneStandingsButton}
                          >
                            <Text style={styles.zoneStandingsButtonText}>PUNTAJES</Text>
                          </Pressable>
                        </View>
                      </View>
                    ))}
                    {canEditFixture ? (
                      <View style={styles.zoneShareButtonWrap}>
                        <Pressable
                          disabled={zoneShareInProgress}
                          onPress={() => setZoneShareModalVisible(true)}
                          style={({ pressed }) => [
                            styles.zoneShareButton,
                            pressed ? styles.primaryButtonPressed : null,
                            zoneShareInProgress ? styles.zoneShareButtonDisabled : null,
                          ]}
                        >
                          <Ionicons color={colors.primaryDark} name="share-social-outline" size={20} />
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                ) : (
                  <Text style={styles.emptyText}>
                    {canEditFixture
                      ? "Todavia no hay zonas manuales guardadas."
                      : "Todavia no hay zonas visibles."}
                  </Text>
                )}
              </View>
            ) : null}

            {false && activeSection === "zones" ? (
              <View style={styles.card}>
                {Array.isArray(zonesPreview) && zonesPreview.length ? (
                  <View style={styles.previewStack}>
                    {zonesPreview.map((zone) => {
                      const isExpanded = expandedZoneIds.includes(zone.id);
                      const isHighlightedZone =
                        !canEditFixture && highlightedZoneId && highlightedZoneId === zone.id;

                      return (
                        <View
                          key={zone.id}
                          style={[styles.zoneCard, isHighlightedZone ? styles.zoneCardHighlighted : null]}
                        >
                          <Pressable onPress={() => toggleZoneExpanded(zone.id)} style={styles.zoneHeaderPressable}>
                            <View style={styles.zoneHeaderRow}>
                              <View style={styles.zoneHeaderCopy}>
                                <View style={styles.zoneTitleRow}>
                                  {isHighlightedZone ? <View style={styles.zoneLedIndicator} /> : null}
                                  <Text
                                    style={[
                                      styles.zoneTitle,
                                      isHighlightedZone ? styles.zoneTitleHighlighted : null,
                                    ]}
                                  >
                                    {zone.name}
                                  </Text>
                                </View>
                                <Text style={styles.zoneMeta}>
                                  {zone.size} parejas · clasifican {zone.qualifiers || 2}
                                </Text>
                              </View>
                              <View style={styles.zoneChevronWrap}>
                                <Ionicons
                                  color={colors.primaryDark}
                                  name={isExpanded ? "chevron-up-circle" : "chevron-down-circle"}
                                  size={20}
                                />
                              </View>
                            </View>
                          </Pressable>
                          {isExpanded ? (
                            <>
                              {(zone.pairs || []).length ? (
                                (zone.pairs || []).map((pair, index) => (
                                  <View
                                    key={pair.id || `${zone.id}-${index}`}
                                    style={styles.zonePairRow}
                                  >
                                    <Text
                                      style={[
                                        styles.zonePairText,
                                        !canEditFixture && pair.id === highlightedPairId
                                          ? styles.zonePairTextHighlighted
                                          : null,
                                      ]}
                                    >
                                      P{index + 1} ({formatShortPairLabel(pair.label)})
                                    </Text>
                                  </View>
                                ))
                              ) : (
                                <Text style={styles.emptyText}>Zona vacia por ahora.</Text>
                              )}
                              {(zone.matches || []).length ? (
                                <View style={styles.zoneMatchesWrap}>
                                  {(zone.matches || []).map((match, matchIndex) => (
                                    (() => {
                                      const isHighlightedTeamA =
                                        !canEditFixture &&
                                        highlightedPairId &&
                                        String(match.teamAId || "").trim() === highlightedPairId;
                                      const isHighlightedTeamB =
                                        !canEditFixture &&
                                        highlightedPairId &&
                                        String(match.teamBId || "").trim() === highlightedPairId;

                                      return (
                                    <View
                                      key={match.id}
                                      style={[
                                        styles.zoneMatchCard,
                                        matchIndex % 2 === 0
                                          ? styles.zoneMatchCardAltA
                                          : styles.zoneMatchCardAltB,
                                        match.distributionPending ? styles.zoneMatchCardPending : null,
                                      ]}
                                    >
                                      <View style={styles.zoneMatchHeader}>
                                        <Text style={styles.zoneMatchTitlePill}>{match.title}</Text>
                                        <View style={styles.zoneMatchScheduleWrap}>
                                          <Pressable
                                            disabled={!canEditFixture}
                                            onPress={() =>
                                              canEditFixture
                                                ? setZoneMatchPickerState({
                                                    zoneId: zone.id,
                                                    matchId: match.id,
                                                    field: "scheduledDayKey",
                                                  })
                                                : null
                                            }
                                            style={({ pressed }) => [
                                              styles.zoneMatchScheduleButton,
                                              pressed ? styles.primaryButtonPressed : null,
                                            ]}
                                          >
                                            <Ionicons
                                              color="#1B5D92"
                                              name="calendar-outline"
                                              size={11}
                                            />
                                            <Text style={styles.zoneMatchSchedulePill}>
                                              {match.scheduledDayKey
                                                ? formatScheduleDayDisplay(match.scheduledDayKey, tournamentDayOptions)
                                                : "Dia a confirmar"}
                                            </Text>
                                          </Pressable>
                                          <Pressable
                                            disabled={!canEditFixture}
                                            onPress={() =>
                                              canEditFixture
                                                ? setZoneMatchTimePickerTarget({
                                                    zoneId: zone.id,
                                                    matchId: match.id,
                                                    currentValue: String(match.scheduledTime || ""),
                                                  })
                                                : null
                                            }
                                            style={({ pressed }) => [
                                              styles.zoneMatchScheduleButton,
                                              pressed ? styles.primaryButtonPressed : null,
                                            ]}
                                          >
                                            <Ionicons
                                              color="#1B5D92"
                                              name="time-outline"
                                              size={11}
                                            />
                                            <Text style={styles.zoneMatchSchedulePill}>
                                              {match.scheduledTime ? `${match.scheduledTime} hs` : "Sin horario"}
                                            </Text>
                                          </Pressable>
                                        </View>
                                      </View>
                                      <Pressable
                                        disabled={!canEditFixture}
                                        hitSlop={{ bottom: 6, left: 8, right: 8, top: 6 }}
                                        onPress={() =>
                                          canEditFixture
                                            ? setZoneMatchPickerState({
                                                zoneId: zone.id,
                                                matchId: match.id,
                                                field: "courtLabel",
                                              })
                                            : null
                                        }
                                        style={({ pressed }) => [
                                          styles.zoneMatchCourtButton,
                                          pressed ? styles.primaryButtonPressed : null,
                                          !canEditFixture ? styles.zoneMatchCourtButtonDisabled : null,
                                        ]}
                                      >
                                        <MaterialCommunityIcons color="#1B5D92" name="soccer-field" size={14} />
                                        <Text numberOfLines={1} style={styles.zoneMatchCourtText}>
                                          {match.courtLabel || "Cancha por asignar"}
                                        </Text>
                                      </Pressable>
                                      {zoneMatchPickerState.zoneId === zone.id &&
                                      zoneMatchPickerState.matchId === match.id &&
                                      zoneMatchPickerState.field === "scheduledDayKey" &&
                                      canEditFixture ? (
                                        <View style={styles.zoneInlinePickerCard}>
                                          <Text style={styles.zoneInlinePickerTitle}>Seleccionar dia</Text>
                                          <View style={styles.zoneInlinePickerOptions}>
                                            {tournamentDayOptions.map((option) => {
                                              const isSelected =
                                                option.key === String(match.scheduledDayKey || "");

                                              return (
                                                <Pressable
                                                  key={`${zone.id}-${match.id}-${option.key}`}
                                                  onPress={() =>
                                                    handleUpdateZoneMatchScheduleField(
                                                      zone.id,
                                                      match.id,
                                                      "scheduledDayKey",
                                                      option.key
                                                    )
                                                  }
                                                  style={[
                                                    styles.zoneInlinePickerOption,
                                                    isSelected
                                                      ? styles.zoneInlinePickerOptionSelected
                                                      : null,
                                                  ]}
                                                >
                                                  <Text
                                                    style={[
                                                      styles.zoneInlinePickerOptionText,
                                                      isSelected
                                                        ? styles.zoneInlinePickerOptionTextSelected
                                                        : null,
                                                    ]}
                                                  >
                                                    {option.label}
                                                  </Text>
                                                </Pressable>
                                              );
                                            })}
                                          </View>
                                          <Pressable
                                            onPress={() =>
                                              setZoneMatchPickerState({
                                                zoneId: "",
                                                matchId: "",
                                                field: "",
                                              })
                                            }
                                            style={({ pressed }) => [
                                              styles.zoneInlinePickerCloseButton,
                                              pressed ? styles.primaryButtonPressed : null,
                                            ]}
                                          >
                                            <Text style={styles.zoneInlinePickerCloseButtonText}>Cerrar</Text>
                                          </Pressable>
                                        </View>
                                      ) : null}
                                      <View style={styles.zoneTeamsRow}>
                                        <Pressable
                                          disabled={!canEditFixture}
                                          hitSlop={4}
                                          onPress={() =>
                                            canEditFixture
                                              ? handleToggleZoneMatchWinner(zone.id, match.id, "teamA")
                                              : null
                                          }
                                          style={[
                                            styles.zoneTeamColumn,
                                            match.result?.winner === "teamA"
                                              ? styles.zoneTeamColumnWinner
                                              : null,
                                            match.result?.winner === "teamB"
                                              ? styles.zoneTeamColumnLoser
                                              : null,
                                          ]}
                                        >
                                          <View style={styles.zoneTeamContentRow}>
                                            <View style={styles.bracketStatusIconLeftWrap}>
                                              {!match.result?.winner ? (
                                                <FontAwesome5
                                                  color={colors.textMuted || colors.muted}
                                                  name="hand-rock"
                                                  size={12}
                                                  style={styles.neutralFistIcon}
                                                />
                                              ) : (
                                                <Ionicons
                                                  color={getZoneTeamStatusIconColor(match, "teamA")}
                                                  name={getZoneTeamStatusIconName(match, "teamA")}
                                                  size={12}
                                                />
                                              )}
                                              <Text style={styles.bracketTeamSeedSide}>{match.teamASeed}</Text>
                                            </View>
                                            <View style={styles.zoneTeamPlayersCompactBlock}>
                                              {(Array.isArray(match.teamALines) && match.teamALines.length
                                                ? match.teamALines
                                                : formatShortPairLines(match.teamAName)
                                              )
                                                .filter((playerLine) => String(playerLine || "").trim())
                                                .map((playerLine, lineIndex) => (
                                                  <Text
                                                    key={`${match.id}-teamA-line-${lineIndex}`}
                                                    style={[
                                                      styles.bracketTeamPrimaryName,
                                                      isHighlightedTeamA
                                                        ? styles.highlightedPairNameText
                                                        : null,
                                                    ]}
                                                  >
                                                    {playerLine}
                                                  </Text>
                                                ))}
                                            </View>
                                          </View>
                                        </Pressable>
                                        <View style={styles.zoneVsWrap}>
                                          <Pressable
                                            disabled={!canEditFixture || !match.result?.winner}
                                            hitSlop={2}
                                            onPress={() =>
                                              canEditFixture
                                                ? handleToggleZoneMatchWinner(
                                                    zone.id,
                                                    match.id,
                                                    match.result?.winner
                                                  )
                                                : null
                                            }
                                            style={[
                                              styles.zoneResetWinnerButton,
                                              !match.result?.winner
                                                ? styles.zoneResetWinnerButtonDisabled
                                                : null,
                                            ]}
                                          >
                                            <FontAwesome5
                                              color={colors.textMuted || colors.muted}
                                              name="hand-rock"
                                              size={16}
                                              style={styles.neutralFistIcon}
                                            />
                                          </Pressable>
                                          <Text style={styles.zoneVsLabel}>VS</Text>
                                        </View>
                                        <Pressable
                                          disabled={!canEditFixture}
                                          hitSlop={4}
                                          onPress={() =>
                                            canEditFixture
                                              ? handleToggleZoneMatchWinner(zone.id, match.id, "teamB")
                                              : null
                                          }
                                          style={[
                                            styles.zoneTeamColumn,
                                            match.result?.winner === "teamB"
                                              ? styles.zoneTeamColumnWinner
                                              : null,
                                            match.result?.winner === "teamA"
                                              ? styles.zoneTeamColumnLoser
                                              : null,
                                          ]}
                                        >
                                          <View style={styles.zoneTeamContentRow}>
                                            <View style={styles.bracketStatusIconLeftWrap}>
                                              {!match.result?.winner ? (
                                                <FontAwesome5
                                                  color={colors.textMuted || colors.muted}
                                                  name="hand-rock"
                                                  size={12}
                                                  style={styles.neutralFistIcon}
                                                />
                                              ) : (
                                                <Ionicons
                                                  color={getZoneTeamStatusIconColor(match, "teamB")}
                                                  name={getZoneTeamStatusIconName(match, "teamB")}
                                                  size={12}
                                                />
                                              )}
                                              <Text style={styles.bracketTeamSeedSide}>{match.teamBSeed}</Text>
                                            </View>
                                            <View style={styles.zoneTeamPlayersCompactBlock}>
                                              {(Array.isArray(match.teamBLines) && match.teamBLines.length
                                                ? match.teamBLines
                                                : formatShortPairLines(match.teamBName)
                                              )
                                                .filter((playerLine) => String(playerLine || "").trim())
                                                .map((playerLine, lineIndex) => (
                                                  <Text
                                                    key={`${match.id}-teamB-line-${lineIndex}`}
                                                    style={[
                                                      styles.bracketTeamPrimaryName,
                                                      isHighlightedTeamB
                                                        ? styles.highlightedPairNameText
                                                        : null,
                                                    ]}
                                                  >
                                                    {playerLine}
                                                  </Text>
                                                ))}
                                            </View>
                                          </View>
                                        </Pressable>
                                      </View>
                                      <View style={styles.zoneSetsWrap}>
                                        {normalizeResultSets(
                                          match.result?.sets,
                                          currentMatchFormat.zones
                                        ).map((set, setIndex) => (
                                          (() => {
                                            const allowDoubleDigits = shouldAllowDoubleDigitSetScore(
                                              currentMatchFormat.zones,
                                              setIndex,
                                              currentMatchFormat.zonesSuperTieBreakPoints
                                            );

                                            return (
                                          <View key={`${match.id}-set-${setIndex}`} style={styles.zoneSetColumn}>
                                            <Text style={styles.zoneSetLabel}>{set.label}</Text>
                                            {allowDoubleDigits ? (
                                              <View style={styles.zoneSetInputsRow}>
                                                <TextInput
                                                  keyboardType="number-pad"
                                                  maxLength={2}
                                                  onChangeText={(value) => {
                                                    if (!canEditFixture) {
                                                      return;
                                                    }
                                                    const nextValue = String(value || "").replace(/\D/g, "").slice(0, 2);
                                                    handleZoneMatchSplitScoreChange(
                                                      zone.id,
                                                      match.id,
                                                      setIndex,
                                                      "teamA",
                                                      nextValue
                                                    );
                                                    if (nextValue.length >= 2) {
                                                      focusZoneResultField(`${zone.id}-${match.id}-${setIndex}-b`);
                                                    }
                                                  }}
                                                  placeholder="0"
                                                  placeholderTextColor={colors.muted}
                                                  editable={canEditFixture}
                                                  ref={(ref) => {
                                                    zoneSetInputRefs.current[`${zone.id}-${match.id}-${setIndex}-a`] = ref;
                                                  }}
                                                  style={styles.zoneSetInput}
                                                  value={String(set.teamA || "")}
                                                />
                                                <Text style={styles.zoneSetSeparator}>/</Text>
                                                <TextInput
                                                  keyboardType="number-pad"
                                                  maxLength={2}
                                                  onChangeText={(value) => {
                                                    if (!canEditFixture) {
                                                      return;
                                                    }
                                                    const nextValue = String(value || "").replace(/\D/g, "").slice(0, 2);
                                                    handleZoneMatchSplitScoreChange(
                                                      zone.id,
                                                      match.id,
                                                      setIndex,
                                                      "teamB",
                                                      nextValue
                                                    );
                                                    if (nextValue.length >= 2) {
                                                      const nextFieldKey = getNextZoneResultFieldKey(
                                                        zone.id,
                                                        match.id,
                                                        setIndex
                                                      );

                                                      if (nextFieldKey) {
                                                        focusZoneResultField(nextFieldKey);
                                                      }
                                                    }
                                                  }}
                                                  placeholder="0"
                                                  placeholderTextColor={colors.muted}
                                                  editable={canEditFixture}
                                                  ref={(ref) => {
                                                    zoneSetInputRefs.current[`${zone.id}-${match.id}-${setIndex}-b`] = ref;
                                                  }}
                                                  style={styles.zoneSetInput}
                                                  value={String(set.teamB || "")}
                                                />
                                              </View>
                                            ) : (
                                              <TextInput
                                                keyboardType="numbers-and-punctuation"
                                                maxLength={3}
                                                onChangeText={(value) =>
                                                  canEditFixture
                                                    ? handleZoneMatchScoreChange(
                                                        zone.id,
                                                        match.id,
                                                        setIndex,
                                                        value
                                                      )
                                                    : null
                                                }
                                                placeholder="0/0"
                                                placeholderTextColor={colors.muted}
                                                editable={canEditFixture}
                                                ref={(ref) => {
                                                  zoneSetInputRefs.current[
                                                    `${zone.id}-${match.id}-${setIndex}`
                                                  ] = ref;
                                                }}
                                                style={styles.zoneCompactSetInput}
                                                value={formatCompactSetInput(set, false)}
                                              />
                                            )}
                                          </View>
                                            );
                                          })()
                                        ))}
                                      </View>
                                      {match.resultLabel !== "Resultado pendiente" ? (
                                        <Text style={styles.zoneMatchMeta}>{match.resultLabel}</Text>
                                      ) : null}
                                      <Text style={styles.zoneMatchFormatMeta}>
                                        {getMatchFormatMetaLabel(
                                          currentMatchFormat.zones,
                                          Number(currentMatchFormat.zonesSuperTieBreakPoints || 11)
                                        )}
                                      </Text>
                                    </View>
                                      );
                                    })()
                                  ))}
                                </View>
                              ) : null}
                            </>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <Text style={styles.emptyText}>
                    {canEditFixture
                      ? "Todavia no hay zonas visibles. Usa `ARMADO AUTOMATICO` desde Nuevas zonas."
                      : "Todavia no hay zonas visibles."}
                  </Text>
                )}
              </View>
            ) : null}

            {activeSection === "bracket" ? (
              <View style={styles.card}>
                {canEditFixture ? (
                  <View style={styles.configurationActionsRow}>
                    <Pressable
                      onPress={handleCreateBracketPress}
                      style={({ pressed }) => [
                        styles.secondaryActionButton,
                        pressed ? styles.primaryButtonPressed : null,
                      ]}
                    >
                      <Ionicons
                        color={colors.primaryDark}
                        name="git-branch-outline"
                        size={16}
                        style={styles.bracketActionIcon}
                      />
                      <Text style={styles.secondaryActionButtonText}>
                        {savingKey === "bracket" ? "CREANDO..." : "CREAR LLAVES"}
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
                {bracketBoard ? (
                  <>
                  {shouldShowBracketZoneWarning ? (
                    <View style={styles.bracketWarningCard}>
                      <Ionicons color="#1F6F78" name="alert-circle-outline" size={18} />
                      <Text style={styles.bracketWarningText}>
                        Las zonas cambiaron despues de crear estas llaves. Revisa y vuelve a crear llaves para sincronizarlas.
                      </Text>
                    </View>
                  ) : null}
                  <View style={styles.bracketSummaryCard}>
                    <View style={styles.bracketSummaryHeader}>
                      <View style={styles.bracketSummaryHeaderCopy}>
                        <Text style={styles.bracketSummaryTitle}>Resumen de llaves</Text>
                      </View>
                    </View>

                    {upcomingBracketMatches.length ? (
                      <View style={styles.bracketUpcomingList}>
                        {upcomingBracketMatches.map((match) => (
                          <View key={match.id} style={styles.bracketUpcomingItem}>
                            <View style={styles.bracketUpcomingTopRow}>
                              <Text style={styles.bracketUpcomingRound}>{match.roundTitle}</Text>
                              <Text style={styles.bracketUpcomingSchedule}>
                                {match.dayLabel} · {match.timeLabel}
                              </Text>
                            </View>
                            <Text numberOfLines={1} style={styles.bracketUpcomingTeams}>
                              {(match.teamALines.join(" / ") || "A confirmar")} vs{" "}
                              {match.teamBLines.join(" / ") || "A confirmar"}
                            </Text>
                            <Text numberOfLines={1} style={styles.bracketUpcomingVenue}>
                              {match.venueLabel} · {match.courtLabel}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <Text style={styles.bracketSummaryEmptyText}>
                        Las llaves fueron creadas. Presiona LLAVES para abrir el cuadro.
                      </Text>
                    )}
                  </View>
                  </>
                ) : (
                  <Text style={styles.emptyText}>
                    {canEditFixture
                      ? "Todavia no hay llaves visibles. Usa `CREAR LLAVES` desde Llaves."
                      : "Todavia no hay llaves visibles."}
                  </Text>
                )}
              </View>
            ) : null}
          </ScrollView>
        ) : (
          <View style={styles.loaderWrap}>
            <Text style={styles.loaderText}>No encontramos el torneo.</Text>
          </View>
        )}
      </View>

      <Modal
        animationType="fade"
        onRequestClose={() => null}
        statusBarTranslucent
        transparent
        visible={bracketOpening}
      >
        <View style={styles.bracketOpeningOverlay}>
          <View style={styles.bracketOpeningCard}>
            <ActivityIndicator color={colors.primaryDark} size="large" />
            <Text style={styles.bracketOpeningTitle}>Abriendo llaves...</Text>
            <Text style={styles.bracketOpeningSupport}>Preparando el cuadro del torneo</Text>
          </View>
        </View>
      </Modal>

      {renderBracketShareBoard()}
      {renderZoneShareCaptureBoards()}

      <FeedbackModal
        message={feedback.message}
        onClose={() => setFeedback((current) => ({ ...current, visible: false }))}
        tone={feedback.tone}
        title={feedback.title}
        visible={feedback.visible}
      />
      <Modal
        animationType="fade"
        onRequestClose={closeZonePlanningResultEditor}
        transparent
        visible={Boolean(zonePlanningResultEditor)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.resultModalOverlay}
        >
          <Pressable onPress={closeZonePlanningResultEditor} style={styles.resultModalBackdrop} />
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
              {(zonePlanningResultEditor?.participants || []).length ? (
                <View style={styles.winnerOptions}>
                  {(zonePlanningResultEditor?.participants || []).map((participant, index) => {
                    const isSelected =
                      String(zonePlanningResultEditor?.winnerRegistrationId || "") === String(participant.id);

                    return (
                      <Pressable
                        key={`planning-winner-${participant.id}`}
                        onPress={() =>
                          setZonePlanningResultEditor((current) =>
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
                          {index + 1}. {participant.label}
                        </Text>
                        {isSelected ? <Text style={styles.winnerBadgeText}>GANADOR</Text> : null}
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <Text style={styles.resultNoWinnerText}>
                  Este cruce necesita resultados previos para seleccionar ganador.
                </Text>
              )}
              <View style={styles.setsGrid}>
                {normalizeResultSets(zonePlanningResultEditor?.sets, currentMatchFormat.zones).map((set, setIndex) => {
                  const allowDoubleDigits = shouldAllowDoubleDigitSetScore(
                    currentMatchFormat.zones,
                    setIndex,
                    currentMatchFormat.zonesSuperTieBreakPoints
                  );

                  return (
                    <View key={`planning-set-${setIndex}`} style={styles.setRow}>
                      <Text style={[styles.setLabel, allowDoubleDigits ? styles.superTieBreakSetLabel : null]}>
                        {allowDoubleDigits ? "SUPER TIE BREAK" : set.label}
                      </Text>
                      <TextInput
                        keyboardType="number-pad"
                        maxLength={allowDoubleDigits ? 5 : 3}
                        onChangeText={(value) => updateZonePlanningResultSetScore(setIndex, value)}
                        style={[
                          styles.setInput,
                          allowDoubleDigits ? styles.superTieBreakSetInput : null,
                        ]}
                        value={formatCompactSetInput(set, allowDoubleDigits)}
                      />
                    </View>
                  );
                })}
              </View>
              <View style={styles.resultModalActions}>
                <Pressable onPress={closeZonePlanningResultEditor} style={styles.resultCancelButton}>
                  <Text style={styles.resultCancelButtonText}>Cancelar</Text>
                </Pressable>
                <Pressable onPress={saveZonePlanningResultEditor} style={styles.resultSaveButton}>
                  <Text style={styles.resultSaveButtonText}>Guardar</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
      <Modal
        animationType="fade"
        onRequestClose={closeBracketResultEditor}
        transparent
        visible={Boolean(bracketResultEditor)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.resultModalOverlay}
        >
          <Pressable onPress={closeBracketResultEditor} style={styles.resultModalBackdrop} />
          <ScrollView
            contentContainerStyle={styles.resultModalScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.resultModalCard}>
              <Text style={styles.resultModalTitle}>Resultado</Text>
              <Text style={styles.resultModalSubtitle}>
                {bracketResultEditor?.roundTitle || "Llave"} · selecciona ganador y carga los sets.
              </Text>
              <View style={styles.winnerOptions}>
                {[
                  {
                    key: "teamA",
                    label: `${bracketResultEditor?.teamASeed || "A"}. ${
                      bracketResultEditor?.teamAName || "Pareja A"
                    }`,
                  },
                  {
                    key: "teamB",
                    label: `${bracketResultEditor?.teamBSeed || "B"}. ${
                      bracketResultEditor?.teamBName || "Pareja B"
                    }`,
                  },
                ].map((option) => {
                  const isSelected = bracketResultEditor?.winner === option.key;

                  return (
                    <Pressable
                      key={`bracket-winner-${option.key}`}
                      onPress={() =>
                        setBracketResultEditor((current) =>
                          current
                            ? {
                                ...current,
                                winner: isSelected ? "" : option.key,
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
                        {option.label}
                      </Text>
                      {isSelected ? <Text style={styles.winnerBadgeText}>GANADOR</Text> : null}
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.setsGrid}>
                {normalizeResultSets(
                  bracketResultEditor?.sets,
                  resolveCurrentBracketRoundFormat(
                    (workingBracketPreviewRef.current || currentBracketPreview || {})?.rounds?.find(
                      (round) => round.id === bracketResultEditor?.roundId
                    )
                  )
                ).map((set, setIndex) => {
                  const baseBracketPreview = workingBracketPreviewRef.current || currentBracketPreview || {};
                  const editorRound = (baseBracketPreview?.rounds || []).find(
                    (round) => round.id === bracketResultEditor?.roundId
                  );
                  const roundFormat = resolveCurrentBracketRoundFormat(editorRound);
                  const allowDoubleDigits = shouldAllowDoubleDigitSetScore(
                    roundFormat,
                    setIndex,
                    currentMatchFormat.bracketSuperTieBreakPoints
                  );

                  return (
                    <View key={`bracket-modal-set-${setIndex}`} style={styles.setRow}>
                      <Text style={[styles.setLabel, allowDoubleDigits ? styles.superTieBreakSetLabel : null]}>
                        {allowDoubleDigits ? "SUPER TIE BREAK" : set.label}
                      </Text>
                      <TextInput
                        keyboardType="number-pad"
                        maxLength={allowDoubleDigits ? 5 : 3}
                        onChangeText={(value) => updateBracketResultEditorSetScore(setIndex, value)}
                        ref={(input) => {
                          bracketSetInputRefs.current[`bracket-result-editor-${setIndex}`] = input;
                        }}
                        style={[
                          styles.setInput,
                          allowDoubleDigits ? styles.superTieBreakSetInput : null,
                        ]}
                        value={formatCompactSetInput(set, allowDoubleDigits)}
                      />
                    </View>
                  );
                })}
              </View>
              <View style={styles.resultModalUtilityActions}>
                {bracketResultEditor?.canClearCrossing ? (
                  <Pressable
                    onPress={clearBracketEditorCrossing}
                    style={({ pressed }) => [
                      styles.resultUtilityButton,
                      styles.resultUtilityButtonDanger,
                      pressed ? styles.primaryButtonPressed : null,
                    ]}
                  >
                    <Text style={[styles.resultUtilityButtonText, styles.resultUtilityButtonTextDanger]}>
                      Limpiar cruce
                    </Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={clearBracketEditorResult}
                  style={({ pressed }) => [
                    styles.resultUtilityButton,
                    pressed ? styles.primaryButtonPressed : null,
                  ]}
                >
                  <Text style={styles.resultUtilityButtonText}>Limpiar resultado</Text>
                </Pressable>
              </View>
              <View style={styles.resultModalActions}>
                <Pressable onPress={closeBracketResultEditor} style={styles.resultCancelButton}>
                  <Text style={styles.resultCancelButtonText}>Cancelar</Text>
                </Pressable>
                <Pressable onPress={saveBracketResultEditor} style={styles.resultSaveButton}>
                  <Text style={styles.resultSaveButtonText}>Guardar</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
      <Modal
        animationType="fade"
        onRequestClose={closeZonePlanningDayPicker}
        transparent
        visible={Boolean(zonePlanningDayPickerTarget)}
      >
        <View style={styles.dayPickerModalOverlay}>
          <Pressable onPress={closeZonePlanningDayPicker} style={styles.resultModalBackdrop} />
          <View style={styles.dayPickerModalCard}>
            <Text style={styles.dayPickerModalTitle}>Seleccionar dia</Text>
            <View style={styles.dayPickerOptions}>
              {tournamentDayOptions.map((day) => {
                const isSelected = day.key === zonePlanningDayPickerTarget?.currentDayKey;

                return (
                  <Pressable
                    key={`zone-planning-day-${day.key}`}
                    onPress={() => selectZonePlanningMatchDay(day.key)}
                    style={[
                      styles.dayPickerOption,
                      isSelected ? styles.dayPickerOptionSelected : null,
                    ]}
                  >
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.dayPickerOptionText,
                        isSelected ? styles.dayPickerOptionTextSelected : null,
                      ]}
                    >
                      {formatScheduleDayDisplay(day.key, tournamentDayOptions)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable onPress={closeZonePlanningDayPicker} style={styles.dayPickerCancelButton}>
              <Text style={styles.dayPickerCancelButtonText}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="fade"
        onRequestClose={() => setZonePlanningStandingsModalZoneId("")}
        transparent
        visible={Boolean(zonePlanningStandingsModalZone)}
      >
        <View style={styles.standingsModalOverlay}>
          <Pressable
            onPress={() => setZonePlanningStandingsModalZoneId("")}
            style={styles.resultModalBackdrop}
          />
          <View style={styles.standingsModalCard}>
            <Text style={styles.standingsModalTitle}>
              Puntajes {zonePlanningStandingsModalZone?.label || ""}
            </Text>
            <View style={styles.standingsTable}>
              <View style={styles.standingsHeaderRow}>
                <Text style={[styles.standingsHeaderText, styles.standingsPairColumn]}>PAREJA</Text>
                {["PJ", "PG", "PP", "SF", "SC", "DIF", "DG"].map((label) => (
                  <Text key={label} style={styles.standingsHeaderText}>{label}</Text>
                ))}
              </View>
              {(zonePlanningStandingsModalZone?.standings || []).map((row) => {
                const isHighlightedStanding =
                  highlightedPairId &&
                  String(row.registration?.id || "").trim() === highlightedPairId;

                return (
                <View
                  key={`standings-${row.registration.id}`}
                  style={[
                    styles.standingsRow,
                    isHighlightedStanding ? styles.standingsRowHighlighted : null,
                  ]}
                >
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.standingsCellText,
                      styles.standingsPairColumn,
                      isHighlightedStanding ? styles.standingsCellTextHighlighted : null,
                    ]}
                  >
                    {row.shortName}
                  </Text>
                  <Text style={[styles.standingsCellText, isHighlightedStanding ? styles.standingsCellTextHighlighted : null]}>{row.PJ}</Text>
                  <Text style={[styles.standingsCellText, isHighlightedStanding ? styles.standingsCellTextHighlighted : null]}>{row.PG}</Text>
                  <Text style={[styles.standingsCellText, isHighlightedStanding ? styles.standingsCellTextHighlighted : null]}>{row.PP}</Text>
                  <Text style={[styles.standingsCellText, isHighlightedStanding ? styles.standingsCellTextHighlighted : null]}>{row.SF}</Text>
                  <Text style={[styles.standingsCellText, isHighlightedStanding ? styles.standingsCellTextHighlighted : null]}>{row.SC}</Text>
                  <Text style={[styles.standingsCellText, isHighlightedStanding ? styles.standingsCellTextHighlighted : null]}>{formatSignedValue(row.DIF)}</Text>
                  <Text style={[styles.standingsCellText, isHighlightedStanding ? styles.standingsCellTextHighlighted : null]}>{formatSignedValue(row.DG)}</Text>
                </View>
                );
              })}
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
            <Pressable
              onPress={() => setZonePlanningStandingsModalZoneId("")}
              style={styles.standingsCloseButton}
            >
              <Text style={styles.standingsCloseButtonText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      {zoneMatchTimePickerTarget ? (
        <DateTimePicker
          display={Platform.OS === "ios" ? "spinner" : "clock"}
          is24Hour
          mode="time"
          onChange={handleZoneMatchTimePickerChange}
          value={buildDateFromTime(zoneMatchTimePickerTarget.currentValue)}
        />
      ) : null}
      {zonePlanningTimePickerTarget ? (
        <DateTimePicker
          display={Platform.OS === "ios" ? "spinner" : "clock"}
          is24Hour
          mode="time"
          onChange={handleZonePlanningTimePickerChange}
          value={buildDateFromTime(zonePlanningTimePickerTarget.currentValue)}
        />
      ) : null}
      {bracketMatchTimePickerTarget ? (
        <DateTimePicker
          display={Platform.OS === "ios" ? "spinner" : "clock"}
          is24Hour
          mode="time"
          onChange={handleBracketMatchTimePickerChange}
          value={buildDateFromTime(bracketMatchTimePickerTarget.currentValue)}
        />
      ) : null}
      <Modal
        animationType="fade"
        onRequestClose={() => setZoneMatchPickerState({ zoneId: "", matchId: "", field: "" })}
        transparent
        visible={Boolean(activeZoneCourtPicker)}
      >
        <View style={styles.confirmOverlay}>
          <Pressable
            onPress={() => setZoneMatchPickerState({ zoneId: "", matchId: "", field: "" })}
            style={styles.confirmBackdrop}
          />
          <View style={styles.bracketDayPickerModalCard}>
            <Text style={styles.bracketDayPickerModalTitle}>Seleccionar cancha</Text>
            <View style={styles.zoneInlinePickerOptions}>
              {(activeZoneCourtPicker?.options || []).map((option) => {
                const isSelected = option.label === activeZoneCourtPicker?.currentCourtName;

                return (
                  <Pressable
                    key={`zone-court-${activeZoneCourtPicker?.zoneId}-${activeZoneCourtPicker?.matchId}-${option.label}`}
                    onPress={() =>
                      handleUpdateZoneMatchCourt(
                        activeZoneCourtPicker.zoneId,
                        activeZoneCourtPicker.matchId,
                        option.value
                      )
                    }
                    style={[
                      styles.zoneInlinePickerOption,
                      isSelected ? styles.zoneInlinePickerOptionSelected : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.zoneInlinePickerOptionText,
                        isSelected ? styles.zoneInlinePickerOptionTextSelected : null,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              onPress={() => setZoneMatchPickerState({ zoneId: "", matchId: "", field: "" })}
              style={({ pressed }) => [
                styles.zoneInlinePickerCloseButton,
                pressed ? styles.primaryButtonPressed : null,
              ]}
            >
              <Text style={styles.zoneInlinePickerCloseButtonText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      {scheduleVenueTimePickerTarget ? (
        <DateTimePicker
          display={Platform.OS === "ios" ? "spinner" : "clock"}
          is24Hour
          mode="time"
          onChange={handleScheduleVenueTimePickerChange}
          value={buildDateFromTime(scheduleVenueTimePickerTarget.currentValue)}
        />
      ) : null}
      <Modal
        animationType="fade"
        onRequestClose={() => setBracketMatchPickerState({ roundId: "", matchId: "", field: "" })}
        transparent
        visible={
          bracketFullscreenVisible &&
          bracketMatchPickerState.field === "scheduledDayKey" &&
          Boolean(bracketMatchPickerState.roundId) &&
          Boolean(bracketMatchPickerState.matchId)
        }
      >
        <View style={styles.confirmOverlay}>
          <Pressable
            onPress={() => setBracketMatchPickerState({ roundId: "", matchId: "", field: "" })}
            style={styles.confirmBackdrop}
          />
          <View style={styles.bracketDayPickerModalCard}>
            <Text style={styles.bracketDayPickerModalTitle}>Seleccionar dia</Text>
            <View style={styles.zoneInlinePickerOptions}>
              {tournamentDayOptions.map((option) => {
                const currentRound = (currentBracketPreview?.rounds || []).find(
                  (round) => round.id === bracketMatchPickerState.roundId
                );
                const currentMatch = (currentRound?.matches || []).find(
                  (match) => match.id === bracketMatchPickerState.matchId
                );
                const isSelected = option.key === String(currentMatch?.scheduledDayKey || "");

                return (
                  <Pressable
                    key={`bracket-fullscreen-day-${option.key}`}
                    onPress={() =>
                      handleUpdateBracketMatchScheduleField(
                        bracketMatchPickerState.roundId,
                        bracketMatchPickerState.matchId,
                        "scheduledDayKey",
                        option.key
                      )
                    }
                    style={[
                      styles.zoneInlinePickerOption,
                      isSelected ? styles.zoneInlinePickerOptionSelected : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.zoneInlinePickerOptionText,
                        isSelected ? styles.zoneInlinePickerOptionTextSelected : null,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              onPress={() => setBracketMatchPickerState({ roundId: "", matchId: "", field: "" })}
              style={({ pressed }) => [
                styles.zoneInlinePickerCloseButton,
                pressed ? styles.primaryButtonPressed : null,
              ]}
            >
              <Text style={styles.zoneInlinePickerCloseButtonText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="fade"
        onRequestClose={() => setBracketMatchPickerState({ roundId: "", matchId: "", field: "" })}
        transparent
        visible={Boolean(activeBracketCourtPicker)}
      >
        <View style={styles.confirmOverlay}>
          <Pressable
            onPress={() => setBracketMatchPickerState({ roundId: "", matchId: "", field: "" })}
            style={styles.confirmBackdrop}
          />
          <View style={styles.bracketDayPickerModalCard}>
            <Text style={styles.bracketDayPickerModalTitle}>Seleccionar cancha</Text>
            <View style={styles.zoneInlinePickerOptions}>
              {(activeBracketCourtPicker?.options || []).map((option) => {
                  const isSelected =
                    option.value === activeBracketCourtPicker?.currentCourtLabel ||
                    option.label === activeBracketCourtPicker?.currentCourtName;

                return (
                  <Pressable
                    key={`bracket-court-${option.label}`}
                    onPress={() =>
                      handleUpdateBracketMatchCourt(
                          activeBracketCourtPicker.roundId,
                          activeBracketCourtPicker.matchId,
                          option
                        )
                      }
                    style={[
                      styles.zoneInlinePickerOption,
                      isSelected ? styles.zoneInlinePickerOptionSelected : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.zoneInlinePickerOptionText,
                        isSelected ? styles.zoneInlinePickerOptionTextSelected : null,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              onPress={() => setBracketMatchPickerState({ roundId: "", matchId: "", field: "" })}
              style={({ pressed }) => [
                styles.zoneInlinePickerCloseButton,
                pressed ? styles.primaryButtonPressed : null,
              ]}
            >
              <Text style={styles.zoneInlinePickerCloseButtonText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="fade"
        onRequestClose={() => {
          setBracketMatchPickerState({ roundId: "", matchId: "", field: "" });
          setBracketMatchTimePickerTarget(null);
          setBracketFullscreenVisible(false);
        }}
        visible={bracketFullscreenVisible}
      >
        <SafeAreaView style={styles.bracketFullscreenSafeArea}>
          <View style={styles.bracketFullscreenHeader}>
            {bracketBoard ? renderBracketActionsMenu({ inHeader: true }) : null}
            <Text style={styles.bracketFullscreenTitle}>Llaves</Text>
            <Pressable
              accessibilityLabel="Salir de pantalla completa"
              onPress={() => {
                setBracketMatchPickerState({ roundId: "", matchId: "", field: "" });
                setBracketMatchTimePickerTarget(null);
                setBracketFullscreenVisible(false);
              }}
              style={({ pressed }) => [
                styles.bracketFullscreenCloseButton,
                pressed ? styles.primaryButtonPressed : null,
              ]}
            >
              <Ionicons color={colors.surface} name="close" size={22} />
            </Pressable>
          </View>
          {bracketBoard ? (
            <>
              {shouldShowBracketZoneWarning ? (
                <View style={[styles.bracketWarningCard, styles.bracketFullscreenWarningCard]}>
                  <Ionicons color="#1F6F78" name="alert-circle-outline" size={18} />
                  <Text style={styles.bracketWarningText}>
                    Las zonas cambiaron despues de crear estas llaves. Revisa y vuelve a crear llaves para sincronizarlas.
                  </Text>
                </View>
              ) : null}
              {canEditFixture && bracketSwapMode ? (
                <Text style={[styles.bracketSwapHelpText, styles.bracketFullscreenSwapHelpText]}>
                  Selecciona parejas de partidos sin resultado para intercambiarlas.
                </Text>
              ) : null}
            </>
          ) : null}
          {renderBracketBoard(true)}
        </SafeAreaView>
      </Modal>

      {renderBracketProgramEditorModal()}

      <Modal
        animationType="fade"
        onRequestClose={() => setConfirmFixtureAction(null)}
        transparent
        visible={Boolean(confirmFixtureAction)}
      >
        <View style={styles.confirmOverlay}>
          <Pressable onPress={() => setConfirmFixtureAction(null)} style={styles.confirmBackdrop} />
          <View style={styles.confirmCard}>
            <View style={styles.confirmWarningIcon}>
              <Text style={styles.confirmWarningIconText}>!</Text>
            </View>
            <Text style={styles.confirmTitle}>{confirmFixtureAction?.title}</Text>
            <Text style={styles.confirmMessage}>{confirmFixtureAction?.message}</Text>
            <View style={styles.confirmActions}>
              <Pressable
                onPress={() => setConfirmFixtureAction(null)}
                style={({ pressed }) => [
                  styles.confirmModalButton,
                  styles.confirmModalButtonSecondary,
                  pressed ? styles.primaryButtonPressed : null,
                ]}
              >
                <Text style={styles.confirmModalButtonSecondaryText}>Cancelar</Text>
              </Pressable>
              <Pressable
                onPress={handleConfirmFixtureAction}
                style={({ pressed }) => [
                  styles.confirmModalButton,
                  styles.confirmModalButtonDanger,
                  pressed ? styles.primaryButtonPressed : null,
                ]}
              >
                <Text style={styles.confirmModalButtonDangerText}>
                  {confirmFixtureAction?.confirmLabel || "Continuar"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="fade"
        onRequestClose={() => (zoneShareInProgress ? null : setZoneShareModalVisible(false))}
        transparent
        visible={zoneShareModalVisible}
      >
        <View style={styles.confirmOverlay}>
          <Pressable
            onPress={() => (zoneShareInProgress ? null : setZoneShareModalVisible(false))}
            style={styles.confirmBackdrop}
          />
          <View style={styles.zoneShareModalCard}>
            <View style={styles.zoneShareModalIcon}>
              <Ionicons color={colors.primaryDark} name="share-social-outline" size={24} />
            </View>
            <Text style={styles.confirmTitle}>Compartir zonas</Text>
            <Text style={styles.confirmMessage}>
              Podes enviar el armado completo en PDF o compartir imagenes de a 3 zonas por vez.
            </Text>
            {bracketBoard ? (
              <Pressable
                disabled={zoneShareInProgress}
                onPress={() => setZoneShareIncludeBracket((current) => !current)}
                style={({ pressed }) => [
                  styles.zoneShareBracketToggle,
                  zoneShareIncludeBracket ? styles.zoneShareBracketToggleActive : null,
                  pressed ? styles.primaryButtonPressed : null,
                ]}
              >
                <Ionicons
                  color={zoneShareIncludeBracket ? colors.surface : colors.primaryDark}
                  name={zoneShareIncludeBracket ? "checkbox" : "square-outline"}
                  size={19}
                />
                <View style={styles.zoneShareBracketToggleCopy}>
                  <Text
                    style={[
                      styles.zoneShareBracketToggleTitle,
                      zoneShareIncludeBracket ? styles.zoneShareBracketToggleTextActive : null,
                    ]}
                  >
                    Incluir llaves
                  </Text>
                  <Text
                    style={[
                      styles.zoneShareBracketToggleSupport,
                      zoneShareIncludeBracket ? styles.zoneShareBracketToggleTextActive : null,
                    ]}
                  >
                    Se agregaran al PDF o a las imagenes compartidas.
                  </Text>
                </View>
              </Pressable>
            ) : null}
            <View style={styles.zoneShareModalActions}>
              <Pressable
                disabled={zoneShareInProgress}
                onPress={handleShareZonesPdf}
                style={({ pressed }) => [
                  styles.zoneShareOptionButton,
                  pressed ? styles.primaryButtonPressed : null,
                ]}
              >
                <Ionicons color={colors.primaryDark} name="document-text-outline" size={18} />
                <Text style={styles.zoneShareOptionText}>PDF completo</Text>
              </Pressable>
              <Pressable
                disabled={zoneShareInProgress}
                onPress={handleShareZonesImages}
                style={({ pressed }) => [
                  styles.zoneShareOptionButton,
                  pressed ? styles.primaryButtonPressed : null,
                ]}
              >
                <Ionicons color={colors.primaryDark} name="images-outline" size={18} />
                <Text style={styles.zoneShareOptionText}>
                  {zoneShareInProgress
                    ? "Generando..."
                    : `Imagenes (${
                        (zoneShareChunks.length || 0) +
                        (zoneShareIncludeBracket && bracketBoard ? 1 : 0)
                      })`}
                </Text>
              </Pressable>
            </View>
            <Pressable
              disabled={zoneShareInProgress}
              onPress={() => setZoneShareModalVisible(false)}
              style={styles.zoneShareCancelButton}
            >
              <Text style={styles.zoneShareCancelButtonText}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {canEditFixture && activeSection === "newzones" && hasZonePlanningUnsavedChanges ? (
        <View pointerEvents="box-none" style={styles.zonePlanningFloatingSaveWrap}>
          <Pressable
            disabled={savingKey === "newzones"}
            onPress={handleSaveZonePlanningChanges}
            style={({ pressed }) => [
              styles.zonePlanningFloatingSaveButton,
              pressed ? styles.primaryButtonPressed : null,
              savingKey === "newzones" ? styles.zonePlanningFloatingSaveButtonDisabled : null,
            ]}
          >
            <Ionicons color={colors.surface} name="save-outline" size={17} />
            <Text style={styles.zonePlanningFloatingSaveText}>
              {savingKey === "newzones" ? "GUARDANDO..." : "GUARDAR ZONAS"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <BottomQuickActionsBar />
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
  bracketOpeningOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(244, 248, 241, 0.88)",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 50,
  },
  bracketOpeningCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: "#B8DCDD",
    borderRadius: 18,
    borderWidth: 1,
    minWidth: 210,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  bracketOpeningTitle: {
    color: colors.primaryDark,
    fontSize: 15,
    fontWeight: "900",
    marginTop: spacing.sm,
  },
  bracketOpeningSupport: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 3,
  },
  confirmOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  confirmBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  confirmCard: {
    backgroundColor: colors.surface,
    borderColor: "#F2C94C",
    borderRadius: 24,
    borderWidth: 2,
    padding: spacing.lg,
    width: "100%",
  },
  confirmWarningIcon: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#FFD84D",
    borderColor: "#E0A400",
    borderRadius: 999,
    borderWidth: 2,
    height: 58,
    justifyContent: "center",
    marginBottom: spacing.sm,
    width: 58,
  },
  confirmWarningIconText: {
    color: "#7A4300",
    fontSize: 34,
    fontWeight: "900",
    lineHeight: 38,
  },
  confirmTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
  },
  confirmMessage: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  confirmActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  confirmModalButton: {
    alignItems: "center",
    borderRadius: 16,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  confirmModalButtonSecondary: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  confirmModalButtonDanger: {
    backgroundColor: colors.danger,
  },
  confirmModalButtonSecondaryText: {
    color: colors.primaryDark,
    fontSize: 15,
    fontWeight: "800",
  },
  confirmModalButtonDangerText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: "800",
  },
  zoneShareModalCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    marginHorizontal: spacing.lg,
    maxWidth: 380,
    padding: spacing.lg,
    width: "90%",
  },
  zoneShareModalIcon: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#EAF6F6",
    borderColor: "#B8DCDD",
    borderRadius: 999,
    borderWidth: 1,
    height: 54,
    justifyContent: "center",
    marginBottom: spacing.sm,
    width: 54,
  },
  zoneShareModalActions: {
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  zoneShareBracketToggle: {
    alignItems: "center",
    backgroundColor: "#F5F9F8",
    borderColor: "#B8DCDD",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  zoneShareBracketToggleActive: {
    backgroundColor: "#28777A",
    borderColor: "#28777A",
  },
  zoneShareBracketToggleCopy: {
    flex: 1,
  },
  zoneShareBracketToggleTitle: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "900",
  },
  zoneShareBracketToggleSupport: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
  zoneShareBracketToggleTextActive: {
    color: colors.surface,
  },
  zoneShareOptionButton: {
    alignItems: "center",
    backgroundColor: "#F7FBF8",
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  zoneShareOptionText: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
  },
  zoneShareCancelButton: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.md,
    minHeight: 34,
  },
  zoneShareCancelButtonText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800",
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    padding: spacing.md,
  },
  summaryLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
    textTransform: "uppercase",
  },
  summaryValue: {
    color: colors.primaryDark,
    fontSize: 26,
    fontWeight: "900",
    marginTop: 2,
    textAlign: "center",
  },
  summarySupport: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 18,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  summaryInlineCard: {
    backgroundColor: "#F7FBF8",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.sm,
  },
  selectionList: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  selectionRow: {
    alignItems: "center",
    backgroundColor: "#F7FBF8",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  selectionRowIconWrap: {
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
    width: 18,
  },
  selectionRowActive: {
    backgroundColor: "#ECF8F2",
    borderColor: "#A9D5C0",
  },
  selectionRowDisabled: {
    backgroundColor: "#F2F4F7",
    borderColor: "#D7DDE5",
    opacity: 0.7,
  },
  selectionRowText: {
    color: colors.text,
    flex: 1,
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  selectionRowTextActive: {
    color: colors.primaryDark,
  },
  selectionRowTextDisabled: {
    color: "#8A94A3",
  },
  selectionInlineRow: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    flexWrap: "nowrap",
    gap: 6,
  },
  selectionInlineLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  selectionInlineInput: {
    backgroundColor: "#F4F7F5",
    borderColor: "#D5E2DA",
    borderRadius: 10,
    borderWidth: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
    minHeight: 28,
    minWidth: 42,
    paddingHorizontal: 6,
    paddingVertical: 0,
    textAlign: "center",
  },
  selectionInlineInputActive: {
    backgroundColor: "#ECF8F2",
    borderColor: "#A9D5C0",
  },
  selectionInlineInputDisabled: {
    backgroundColor: "#F2F4F7",
    borderColor: "#D7DDE5",
    color: "#8A94A3",
  },
  selectionHelpText: {
    color: "#1E88C8",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  primaryButtonWrap: {
    alignItems: "center",
    marginTop: spacing.md,
  },
  configurationActionsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  venueScheduleCard: {
    backgroundColor: "#F7FBF8",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.sm,
  },
  venueScheduleCardNoMargin: {
    backgroundColor: "#F7FBF8",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    padding: spacing.sm,
  },
  venueScheduleTitle: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "uppercase",
  },
  venueScheduleHelpText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 18,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  venueScheduleMicrocopy: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 18,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  venueScheduleVenueBlocks: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  venueScheduleVenueCard: {
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.sm,
  },
  venueScheduleVenueCardBlue: {
    backgroundColor: "#EEF5FF",
    borderColor: "#BFD6F2",
  },
  venueScheduleVenueCardSky: {
    backgroundColor: "#EFFBFF",
    borderColor: "#B7E1EB",
  },
  venueScheduleVenueCardLilac: {
    backgroundColor: "#F5F1FF",
    borderColor: "#D6C8F3",
  },
  venueScheduleVenueHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  venueScheduleVenueHeaderAside: {
    alignItems: "flex-end",
    gap: 6,
    justifyContent: "center",
  },
  venueScheduleVenueHeaderCopy: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  venueScheduleVenueTitle: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900",
    textAlign: "left",
    textTransform: "uppercase",
  },
  venueScheduleVenueName: {
    color: colors.primaryDark,
    fontSize: 16,
    fontWeight: "900",
    marginTop: 2,
    textAlign: "left",
    textTransform: "uppercase",
  },
  venueScheduleVenueMeta: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 3,
    textAlign: "left",
  },
  venueScheduleVenueMetaInline: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  },
  venueScheduleVenueMetaInput: {
    backgroundColor: "#F7FBF8",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
    minHeight: 24,
    minWidth: 34,
    paddingHorizontal: 6,
    paddingVertical: 0,
    textAlign: "center",
  },
  venueScheduleVenueMetaValue: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
  },
  venueUsageRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  venueStatusBadge: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  venueStatusBadgeEnabled: {
    backgroundColor: "#EAF8EF",
    borderColor: "#B7E0C3",
  },
  venueStatusBadgePending: {
    backgroundColor: "#FFF5E8",
    borderColor: "#F1D2A5",
  },
  venueStatusBadgeText: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  venueStatusBadgeTextEnabled: {
    color: "#167A45",
  },
  venueStatusBadgeTextPending: {
    color: "#A86500",
  },
  venueScheduleSelect: {
    marginTop: spacing.sm,
  },
  venueScheduleInlineSelect: {
    marginBottom: 0,
  },
  venueScheduleSelectField: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    minHeight: 42,
  },
  inlineFieldLabel: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "900",
    marginTop: spacing.sm,
    marginBottom: 6,
    textAlign: "center",
    textTransform: "uppercase",
  },
  inlineChipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    justifyContent: "center",
  },
  inlineChip: {
    backgroundColor: "#FFFFFF",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
  },
  inlineChipActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  inlineChipText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  inlineChipTextActive: {
    color: colors.surface,
  },
  venueScheduleRow: {
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  venueScheduleField: {
    flex: 1,
  },
  venueScheduleCourtsField: {
    width: 88,
  },
  venueScheduleInput: {
    backgroundColor: "#FFFFFF",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
    minHeight: 42,
    paddingHorizontal: spacing.sm,
    textAlign: "center",
  },
  venueScheduleTimeButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
  },
  venueScheduleTimeButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
  },
  venueScheduleList: {
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  venueScheduleListCard: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  venueScheduleListCopy: {
    flex: 1,
  },
  venueScheduleListTitle: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  venueScheduleListMeta: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  scheduleDeleteButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 34,
    minWidth: 34,
  },
  formatAccordionStack: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  configurationModeCard: {
    backgroundColor: "#F7FBF8",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.sm,
  },
  configurationModeTitle: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "900",
    marginBottom: spacing.xs,
    textAlign: "center",
    textTransform: "uppercase",
  },
  configurationModeTitleNoMargin: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "900",
    textAlign: "left",
    textTransform: "uppercase",
  },
  rapidModeInfoText: {
    color: "#1E88C8",
    fontSize: 11,
    fontWeight: "800",
    marginTop: spacing.xs,
    textAlign: "center",
  },
  inlineRapidModeRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    marginTop: spacing.xs,
  },
  inlineRapidModeToggle: {
    flex: 1,
  },
  rapidModeSimpleRow: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 42,
    paddingHorizontal: spacing.sm,
  },
  rapidModeSimpleRowActive: {
    backgroundColor: "#ECF8F2",
    borderColor: "#A9D5C0",
  },
  rapidModeSimpleLabel: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  rapidModeSimpleInfoRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    marginTop: spacing.xs,
  },
  rapidModeHeaderRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  rapidModeHeaderToggle: {
    flex: 0,
    minHeight: 38,
    minWidth: 142,
    paddingHorizontal: spacing.sm,
  },
  rapidModeHeaderToggleText: {
    color: colors.text,
    flex: 1,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "uppercase",
  },
  rapidModeToggle: {
    alignItems: "center",
    gap: spacing.sm,
  },
  rapidModeToggleCopy: {
    flex: 1,
    paddingRight: spacing.xs,
  },
  rapidModeToggleTitle: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  rapidModeToggleTitleActive: {
    color: colors.primaryDark,
  },
  rapidModeToggleSubtitle: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 2,
    textTransform: "uppercase",
  },
  rapidModeToggleSubtitleActive: {
    color: colors.primaryDark,
  },
  inlineRapidModeInput: {
    backgroundColor: "#F4F7F5",
    borderColor: "#D5E2DA",
    borderRadius: 10,
    borderWidth: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
    minHeight: 30,
    minWidth: 42,
    paddingHorizontal: 6,
    paddingVertical: 0,
    textAlign: "center",
  },
  inlineRapidModeInputActive: {
    backgroundColor: "#ECF8F2",
    borderColor: "#A9D5C0",
  },
  inlinePointsRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    marginTop: spacing.xs,
  },
  inlinePointsLabel: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  inlinePointsInput: {
    backgroundColor: "#F7FBF8",
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
    minHeight: 34,
    minWidth: 52,
    paddingHorizontal: spacing.xs,
    textAlign: "center",
  },
  unsavedChangesText: {
    color: "#D98A00",
    fontSize: 12,
    fontWeight: "800",
    marginTop: spacing.sm,
    textAlign: "center",
  },
  zonePlanningFloatingSaveWrap: {
    bottom: BOTTOM_QUICK_ACTIONS_SPACE + spacing.md,
    left: spacing.lg,
    position: "absolute",
    right: spacing.lg,
  },
  zonePlanningFloatingSaveButton: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: colors.primaryDark,
    borderRadius: 999,
    elevation: 5,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 48,
    minWidth: 190,
    paddingHorizontal: spacing.lg,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
  },
  zonePlanningFloatingSaveButtonDisabled: {
    opacity: 0.72,
  },
  zonePlanningFloatingSaveText: {
    color: colors.surface,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
  },
  formatSectionCard: {
    backgroundColor: "#F7FBF8",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    padding: spacing.sm,
  },
  formatSectionCardDisabled: {
    backgroundColor: "#F2F4F7",
    borderColor: "#D7DDE5",
  },
  formatSectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  formatSectionHeaderCopy: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  formatSectionTitle: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "left",
    textTransform: "uppercase",
  },
  formatSectionSummary: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 3,
  },
  formatSectionTitleDisabled: {
    color: "#8A94A3",
  },
  formatSectionSummaryDisabled: {
    color: "#9AA6B2",
  },
  formatSectionBody: {
    marginTop: spacing.sm,
  },
  superTieBreakPointsCard: {
    backgroundColor: "#FFFFFF",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  superTieBreakPointsLabel: {
    color: colors.primaryDark,
    fontSize: 10,
    fontWeight: "900",
    marginBottom: 4,
    textAlign: "center",
    textTransform: "uppercase",
  },
  superTieBreakPointsInput: {
    alignSelf: "center",
    backgroundColor: "#F7FBF8",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
    minHeight: 36,
    minWidth: 72,
    paddingHorizontal: spacing.sm,
    textAlign: "center",
  },
  finalStagesCard: {
    marginTop: spacing.sm,
  },
  finalStagesTitle: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "900",
    marginBottom: spacing.xs,
    textAlign: "center",
    textTransform: "uppercase",
  },
  configSaveButton: {
    alignItems: "center",
    backgroundColor: "#F7FBF9",
    borderColor: "#D5EADF",
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 34,
    paddingHorizontal: spacing.md,
  },
  primaryButtonPressed: {
    opacity: 0.9,
  },
  configSaveButtonText: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  secondaryActionButton: {
    alignItems: "center",
    backgroundColor: "#F2FAF5",
    borderColor: "#D5EADF",
    borderRadius: 15,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: spacing.sm,
  },
  secondaryActionButtonText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  newZoneModeButton: {
    flexDirection: "column",
    gap: 3,
    minHeight: 66,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  newZoneModeButtonText: {
    fontSize: 11,
    lineHeight: 14,
    textAlign: "center",
  },
  actionsRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  actionButton: {
    alignItems: "center",
    backgroundColor: "#F2FAF5",
    borderColor: "#D5EADF",
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 56,
    paddingHorizontal: spacing.xs,
  },
  actionButtonActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  actionButtonPressed: {
    opacity: 0.9,
  },
  actionButtonText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
    marginTop: 4,
    textAlign: "center",
    textTransform: "uppercase",
  },
  actionButtonTextCompact: {
    fontSize: 9,
  },
  actionButtonTextActive: {
    color: colors.surface,
  },
  bracketActionIcon: {
    transform: [{ rotate: "90deg" }],
  },
  previewTitle: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "uppercase",
  },
  previewText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
    marginTop: spacing.sm,
    textAlign: "center",
  },
  previewBlueText: {
    color: "#1E88C8",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  previewStack: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  manualHelperText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 18,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  manualActionRow: {
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    marginTop: spacing.md,
  },
  secondaryMiniButton: {
    alignItems: "center",
    backgroundColor: "#F2FAF5",
    borderColor: "#D5EADF",
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: spacing.md,
  },
  secondaryMiniButtonPressed: {
    opacity: 0.88,
  },
  secondaryMiniButtonText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  poolTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
    marginTop: spacing.md,
    textAlign: "center",
    textTransform: "uppercase",
  },
  availablePairsWrap: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  availablePairChip: {
    backgroundColor: "#F4F7FB",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
  },
  availablePairChipActive: {
    backgroundColor: "#1E88C8",
    borderColor: "#1E88C8",
  },
  availablePairChipText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700",
  },
  availablePairChipTextActive: {
    color: colors.surface,
  },
  zoneCard: {
    backgroundColor: "#F7FBF8",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    padding: spacing.sm,
  },
  newZonesStack: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  newZonesSection: {
    gap: spacing.sm,
  },
  newZoneCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
  },
  newZoneTitleWrap: {
    alignSelf: "center",
    backgroundColor: "#E1F4F0",
    borderColor: "#9FD6CF",
    borderRadius: 999,
    borderWidth: 1,
    minWidth: 116,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  newZoneTitle: {
    color: "#1F6D69",
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "uppercase",
  },
  newZoneBracketSeedText: {
    color: "#3C7A75",
    fontSize: 9,
    fontWeight: "900",
    marginTop: 2,
    textAlign: "center",
    textTransform: "uppercase",
  },
  newZonePairsStack: {
    gap: 4,
    marginTop: spacing.sm,
  },
  zoneShareButtonWrap: {
    alignItems: "center",
    marginTop: spacing.sm,
  },
  zoneShareButton: {
    alignItems: "center",
    backgroundColor: "#F7FBF8",
    borderColor: "#B8DCDD",
    borderRadius: 999,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  zoneShareButtonDisabled: {
    opacity: 0.65,
  },
  newZonePairRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  newZonePairRowHighlighted: {
    backgroundColor: "transparent",
  },
  newZonePairNumber: {
    alignItems: "center",
    backgroundColor: "#E1F4F0",
    borderColor: "#9FD6CF",
    borderRadius: 999,
    borderWidth: 1,
    height: 20,
    justifyContent: "center",
    width: 20,
  },
  newZonePairNumberHighlighted: {
    backgroundColor: "#1F6F78",
    borderColor: "#1F6F78",
  },
  newZonePairNumberText: {
    color: "#1F6D69",
    fontSize: 11,
    fontWeight: "900",
  },
  newZonePairNumberTextHighlighted: {
    color: colors.surface,
  },
  newZonePairName: {
    color: colors.text,
    flex: 1,
    fontSize: 11,
    fontWeight: "900",
  },
  newZonePairNameHighlighted: {
    color: "#15555E",
  },
  newZoneMatchTable: {
    alignSelf: "stretch",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: spacing.sm,
    overflow: "hidden",
  },
  newZoneMatchHeader: {
    backgroundColor: "#E1F4F0",
    borderBottomColor: "#9FD6CF",
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: 28,
  },
  newZoneMatchHeaderText: {
    color: "#1F6D69",
    fontSize: 9,
    fontWeight: "900",
    paddingHorizontal: 5,
    paddingVertical: 7,
    textAlign: "center",
  },
  newZoneMatchRow: {
    alignItems: "center",
    borderBottomColor: "#E6ECE8",
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: 30,
  },
  newZoneMatchCellText: {
    color: colors.text,
    fontSize: 9,
    fontWeight: "800",
    paddingHorizontal: 3,
    textAlign: "center",
  },
  newZoneWinnerPairNumber: {
    color: "#39FF14",
    fontWeight: "900",
    textShadowColor: "rgba(57, 255, 20, 0.35)",
    textShadowRadius: 2,
  },
  newZoneEditableCell: {
    alignItems: "center",
    alignSelf: "stretch",
    justifyContent: "center",
    minHeight: 30,
  },
  newZoneEditableCellDisabled: {
    opacity: 1,
  },
  newZoneResultColumn: {
    flex: 1.04,
  },
  newZonePairColumn: {
    flex: 0.78,
  },
  newZoneDayColumn: {
    flex: 0.74,
  },
  newZoneTimeColumn: {
    flex: 0.78,
  },
  newZonePlaceColumn: {
    flex: 0.82,
  },
  newZonePlaceText: {
    lineHeight: 11,
  },
  newZoneEmptyText: {
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
    backgroundColor: "#E1F4F0",
    borderColor: "#9FD6CF",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 30,
    paddingHorizontal: 10,
  },
  zoneStandingsButtonText: {
    color: "#1F6D69",
    fontSize: 10,
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
  standingsRowHighlighted: {
    backgroundColor: "transparent",
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
  standingsCellTextHighlighted: {
    color: "#15555E",
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
    textAlign: "left",
    width: "50%",
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
  resultModalOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
  },
  resultModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
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
  resultModalUtilityActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  resultUtilityButton: {
    alignItems: "center",
    backgroundColor: "#F3F6F7",
    borderColor: "#D8E2E6",
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: spacing.xs,
  },
  resultUtilityButtonDanger: {
    backgroundColor: "#FFF4EF",
    borderColor: "#F1BCA6",
  },
  resultUtilityButtonText: {
    color: "#38515D",
    fontSize: 11,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "uppercase",
  },
  resultUtilityButtonTextDanger: {
    color: "#B0522E",
  },
  programSection: {
    marginTop: spacing.md,
  },
  programSectionTitle: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
    marginBottom: spacing.xs,
    textAlign: "center",
    textTransform: "uppercase",
  },
  programOptionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    justifyContent: "center",
  },
  programOptionsStack: {
    gap: spacing.xs,
  },
  programOptionChip: {
    alignItems: "center",
    backgroundColor: "#F3F6F7",
    borderColor: "#D8E2E6",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 36,
    minWidth: 92,
    paddingHorizontal: spacing.sm,
  },
  programOptionChipSelected: {
    backgroundColor: "#E5F5FA",
    borderColor: "#8BC6DD",
  },
  programOptionChipText: {
    color: "#38515D",
    fontSize: 11,
    fontWeight: "900",
    textAlign: "center",
  },
  programOptionChipTextSelected: {
    color: "#1E6380",
  },
  programOptionRow: {
    alignItems: "center",
    backgroundColor: "#F3F6F7",
    borderColor: "#D8E2E6",
    borderRadius: 13,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  programOptionRowSelected: {
    backgroundColor: "#E5F5FA",
    borderColor: "#8BC6DD",
  },
  programOptionRowText: {
    color: "#38515D",
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
  },
  programOptionRowTextSelected: {
    color: "#1E6380",
  },
  programTimeButton: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#F0F6FA",
    borderColor: "#B8CCE0",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 42,
    minWidth: 190,
    paddingHorizontal: spacing.md,
  },
  programTimeButtonText: {
    color: "#244A66",
    fontSize: 13,
    fontWeight: "900",
  },
  resultCancelButton: {
    alignItems: "center",
    backgroundColor: "#EEF2F4",
    borderRadius: 14,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
  },
  resultCancelButtonText: {
    color: colors.text,
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
  dayPickerModalOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  dayPickerModalCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    padding: spacing.md,
    width: "100%",
  },
  dayPickerModalTitle: {
    color: colors.primaryDark,
    fontSize: 16,
    fontWeight: "900",
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
    borderRadius: 13,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: spacing.sm,
  },
  dayPickerOptionSelected: {
    backgroundColor: "#E1F4F0",
    borderColor: "#9FD6CF",
  },
  dayPickerOptionText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
  },
  dayPickerOptionTextSelected: {
    color: "#1F6D69",
  },
  dayPickerCancelButton: {
    alignItems: "center",
    backgroundColor: "#EEF2F4",
    borderRadius: 13,
    justifyContent: "center",
    marginTop: spacing.md,
    minHeight: 42,
  },
  dayPickerCancelButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  zoneHeaderPressable: {
    backgroundColor: "#4F86A8",
    borderRadius: 12,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  zoneHeaderRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  zoneHeaderCopy: {
    alignItems: "center",
    flex: 1,
    paddingLeft: 20,
  },
  zoneTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
  },
  zoneChevronWrap: {
    alignItems: "flex-end",
    justifyContent: "center",
    width: 20,
  },
  zoneCardHighlighted: {
    borderColor: "#8CC9A2",
    borderWidth: 2,
  },
  zoneLedIndicator: {
    backgroundColor: "#7BFF73",
    borderColor: "#2E9F45",
    borderRadius: 999,
    borderWidth: 1,
    height: 10,
    width: 10,
  },
  zoneTitle: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "uppercase",
  },
  zoneTitleHighlighted: {
    color: "#F5FFB8",
  },
  zoneMeta: {
    color: "#D9E6EF",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
    textAlign: "center",
  },
  zoneAssignButton: {
    alignItems: "center",
    backgroundColor: colors.primaryDark,
    borderRadius: 12,
    justifyContent: "center",
    minHeight: 32,
    paddingHorizontal: spacing.sm,
  },
  zoneAssignButtonDisabled: {
    opacity: 0.35,
  },
  zoneAssignButtonText: {
    color: colors.surface,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  zonePairRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.xs,
  },
  zonePairRowHighlighted: {
    backgroundColor: "#E8F7EE",
    borderColor: "#92D0A9",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  zonePairText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "600",
  },
  zonePairTextHighlighted: {
    color: "#1E88C8",
    fontWeight: "900",
  },
  emptyText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
    marginTop: spacing.md,
    textAlign: "center",
  },
  zoneMatchesWrap: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  zoneAutomationActions: {
    marginBottom: spacing.sm,
  },
  zoneMatchCard: {
    backgroundColor: "#FFFFFF",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.sm,
  },
  zoneMatchCardPending: {
    backgroundColor: "#FFF3E6",
    borderColor: "#F5A623",
  },
  zoneMatchCardAltA: {
    backgroundColor: "#F4F7FB",
    borderColor: "#D8E1EC",
  },
  zoneMatchCardAltB: {
    backgroundColor: "#F8F8F8",
    borderColor: "#E2E2E2",
  },
  zoneMatchTitlePill: {
    backgroundColor: "#D9ECFF",
    borderColor: "#8BB9E8",
    borderRadius: 999,
    borderWidth: 1,
    color: "#1B5D92",
    fontSize: 12,
    fontWeight: "900",
    alignSelf: "flex-start",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  zoneMatchHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
  },
  zoneMatchScheduleWrap: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    flexWrap: "wrap",
    justifyContent: "center",
  },
  zoneMatchScheduleButton: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#8BB9E8",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  zoneMatchSchedulePill: {
    color: "#1B5D92",
    fontSize: 12,
    fontWeight: "900",
  },
  zoneMatchCourtText: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
    flexShrink: 1,
  },
  zoneMatchCourtButton: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#8BB9E8",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    justifyContent: "center",
    marginTop: spacing.xs,
    maxWidth: "100%",
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  zoneMatchCourtButtonDisabled: {
    opacity: 0.78,
  },
  zoneInlinePickerCard: {
    backgroundColor: "#F7FBFF",
    borderColor: "#C9DDF0",
    borderRadius: 16,
    borderWidth: 1,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  zoneInlinePickerTitle: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
    marginBottom: spacing.xs,
    textAlign: "center",
    textTransform: "uppercase",
  },
  zoneInlinePickerOptions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    justifyContent: "center",
  },
  zoneInlinePickerOption: {
    backgroundColor: colors.surface,
    borderColor: "#C9DDF0",
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 28,
    justifyContent: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  zoneInlinePickerOptionSelected: {
    backgroundColor: "#DCEEFF",
    borderColor: "#7EB1E2",
  },
  zoneInlinePickerOptionText: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "800",
  },
  zoneInlinePickerOptionTextSelected: {
    color: "#0F4C7D",
  },
  zoneInlinePickerCloseButton: {
    alignSelf: "center",
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  zoneInlinePickerCloseButtonText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  zoneMatchTeams: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
    marginTop: 4,
  },
  zoneMatchSeedText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 3,
  },
  zoneTeamsRow: {
    flexDirection: "row",
    marginTop: spacing.sm,
    alignItems: "center",
  },
  zoneTeamColumn: {
    alignItems: "stretch",
    backgroundColor: "#FFFFFF",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 78,
    maxHeight: 92,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  zoneTeamColumnWinner: {
    backgroundColor: "#EAF8EF",
    borderColor: "#8FD0A7",
  },
  zoneTeamColumnLoser: {
    backgroundColor: "#FCEEEE",
    borderColor: "#E7B2B2",
  },
  zoneTeamColumnHighlighted: {
    backgroundColor: "#EEF9F1",
    borderColor: "#63B97F",
    borderWidth: 2,
  },
  zoneTeamPlayerName: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
    marginTop: spacing.xs,
    textAlign: "center",
  },
  zoneTeamPlayersBlock: {
    alignItems: "flex-start",
    marginTop: 4,
    width: "100%",
  },
  zoneTeamContentRow: {
    alignItems: "center",
    flexDirection: "row",
    width: "100%",
  },
  zoneTeamPlayersCompactBlock: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  zoneTeamPlayerSubname: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "700",
    marginTop: 1,
    textAlign: "left",
  },
  zoneVsWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  zoneResetWinnerButton: {
    alignItems: "center",
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 28,
    minWidth: 28,
  },
  zoneResetWinnerButtonDisabled: {
    opacity: 0.45,
  },
  neutralFistIcon: {
    transform: [{ rotate: "90deg" }],
  },
  zoneVsLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "900",
    marginTop: 0,
  },
  zoneSetsWrap: {
    alignItems: "center",
    alignSelf: "center",
    flexDirection: "row",
    gap: 3,
    justifyContent: "center",
    marginTop: spacing.xs,
    width: "100%",
  },
  bracketSetsInlineWrap: {
    alignItems: "center",
    flexDirection: "row",
    gap: 0,
    justifyContent: "flex-start",
    flex: 1,
  },
  bracketSetsInlineWrapCompact: {
    flex: 0,
    gap: 0,
    justifyContent: "center",
    marginTop: 1,
    width: "100%",
  },
  bracketByeResultText: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "800",
    marginTop: spacing.xs,
    textAlign: "center",
    textTransform: "uppercase",
  },
  zoneSetColumn: {
    alignItems: "center",
    flex: 1,
    gap: 1,
    maxWidth: 72,
  },
  zoneSetColumnCompact: {
    flex: 0,
    maxWidth: 52,
    minWidth: 42,
  },
  zoneSetLabel: {
    color: colors.muted,
    fontSize: 8,
    fontWeight: "800",
    textAlign: "center",
    transform: [{ translateY: 3 }],
  },
  zoneSetInputsRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 2,
    justifyContent: "center",
    width: "100%",
  },
  zoneSetInput: {
    backgroundColor: "#FFFFFF",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.text,
    fontSize: 10,
    fontWeight: "800",
    minHeight: 24,
    minWidth: 22,
    paddingVertical: 0,
    textAlign: "center",
    width: 22,
  },
  zoneSetSeparator: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "900",
  },
  bracketCompactSetInput: {
    backgroundColor: "#FFFFFF",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.text,
    fontSize: 10,
    fontWeight: "800",
    minHeight: 24,
    paddingVertical: 0,
    textAlign: "center",
    width: 30,
  },
  zoneCompactSetInput: {
    backgroundColor: "#FFFFFF",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.text,
    fontSize: 11,
    fontWeight: "800",
    minHeight: 30,
    minWidth: 38,
    paddingVertical: 0,
    textAlign: "center",
    width: 38,
  },
  zoneSetSlash: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800",
  },
  zoneMatchMeta: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "600",
    marginTop: 3,
  },
  zoneMatchFormatMeta: {
    color: "#1E88C8",
    fontSize: 11,
    fontWeight: "900",
    marginTop: 4,
    textAlign: "center",
    textTransform: "uppercase",
  },
  bracketCard: {
    backgroundColor: "#F7FBF8",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.sm,
  },
  bracketLauncherCard: {
    alignItems: "center",
    backgroundColor: "#F7FBF8",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  bracketLauncherIcon: {
    marginBottom: 2,
  },
  bracketLauncherTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "uppercase",
  },
  bracketLauncherText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
    textAlign: "center",
  },
  bracketLauncherButton: {
    alignItems: "center",
    backgroundColor: "#E7F1F8",
    borderColor: "#BED5E6",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: 4,
    minHeight: 38,
    paddingHorizontal: spacing.lg,
  },
  bracketLauncherButtonText: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "uppercase",
  },
  bracketSummaryCard: {
    backgroundColor: "#F7FBF8",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  bracketWarningCard: {
    alignItems: "center",
    backgroundColor: "#EAF6F6",
    borderColor: "#B8DCDD",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  bracketWarningText: {
    color: "#15555E",
    flex: 1,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 16,
  },
  bracketFullscreenWarningCard: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  bracketSummaryHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
  },
  bracketSummaryHeaderCopy: {
    alignItems: "center",
    flex: 1,
    gap: 2,
  },
  bracketSummaryTitle: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: "800",
    textAlign: "center",
    textTransform: "uppercase",
  },
  bracketSummaryText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
  },
  bracketUpcomingList: {
    gap: 6,
    marginTop: spacing.sm,
  },
  bracketUpcomingItem: {
    backgroundColor: "#FFFFFF",
    borderColor: "#DCE6E0",
    borderRadius: 8,
    borderWidth: 1,
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  bracketUpcomingTopRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    justifyContent: "space-between",
  },
  bracketUpcomingRound: {
    color: colors.text,
    flexShrink: 1,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  bracketUpcomingSchedule: {
    color: "#1E88C8",
    flexShrink: 0,
    fontSize: 10,
    fontWeight: "800",
    textAlign: "right",
  },
  bracketUpcomingTeams: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "800",
    lineHeight: 15,
  },
  bracketUpcomingVenue: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "700",
    lineHeight: 13,
  },
  bracketSummaryEmptyText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    marginTop: spacing.md,
    textAlign: "center",
  },
  bracketTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "uppercase",
  },
  bracketText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  bracketBlueText: {
    color: "#1E88C8",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  bracketZonesText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 18,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  bracketToolbar: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    justifyContent: "center",
    marginTop: 4,
    position: "relative",
    zIndex: 8,
  },
  bracketActionsMenuWrap: {
    alignItems: "flex-end",
    alignSelf: "stretch",
    minHeight: 40,
    position: "relative",
    width: "100%",
    zIndex: 12,
  },
  bracketActionsMenuWrapHeader: {
    alignItems: "flex-start",
    alignSelf: "auto",
    left: spacing.md,
    minHeight: 38,
    position: "absolute",
    top: 8,
    width: 230,
    zIndex: 30,
  },
  bracketActionsMenuButton: {
    alignItems: "center",
    backgroundColor: "#EEF7F3",
    borderColor: "#CFE3D9",
    borderRadius: 999,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  bracketActionsMenuButtonHeader: {
    backgroundColor: colors.surface,
    borderColor: colors.surface,
  },
  bracketActionsMenuButtonActive: {
    backgroundColor: "#1E88C8",
    borderColor: "#1E88C8",
  },
  bracketActionsMenuCard: {
    backgroundColor: colors.surface,
    borderColor: "#CFE3D9",
    borderRadius: 14,
    borderWidth: 1,
    minWidth: 218,
    paddingVertical: spacing.xs,
    position: "absolute",
    right: 0,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    top: 44,
    zIndex: 20,
    elevation: 8,
  },
  bracketActionsMenuItem: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  bracketActionsMenuItemPressed: {
    backgroundColor: "#EEF7F3",
  },
  bracketActionsMenuItemText: {
    color: colors.text,
    flex: 1,
    fontSize: 13,
    fontWeight: "800",
  },
  bracketToolbarButton: {
    alignItems: "center",
    backgroundColor: "#EEF7F3",
    borderColor: "#CFE3D9",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: spacing.md,
  },
  bracketToolbarButtonCompact: {
    minHeight: 31,
    paddingHorizontal: spacing.sm,
  },
  bracketToolbarIconButton: {
    height: 36,
    minHeight: 36,
    paddingHorizontal: 0,
    width: 42,
  },
  bracketClearCourtsButton: {
    backgroundColor: "#EEF7F3",
    borderColor: "#CFE3D9",
    minHeight: 31,
    paddingHorizontal: spacing.sm,
  },
  bracketClearCourtsButtonText: {
    fontSize: 9,
  },
  bracketToolbarIconButtonCompact: {
    height: 31,
    minHeight: 31,
    width: 36,
  },
  bracketToolbarButtonActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  bracketToolbarButtonDisabled: {
    backgroundColor: "#F1F3F4",
    borderColor: "#DDE2E6",
    opacity: 0.72,
  },
  bracketToolbarButtonText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  bracketToolbarButtonTextCompact: {
    fontSize: 10,
  },
  bracketToolbarButtonTextActive: {
    color: colors.surface,
  },
  bracketSwapHelpText: {
    color: "#1E88C8",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  bracketViewport: {
    marginTop: spacing.md,
    overflow: "hidden",
  },
  bracketInlineBoardWrap: {
    alignItems: "flex-start",
    justifyContent: "flex-start",
  },
  bracketGestureAreaInline: {
    alignItems: "flex-start",
    justifyContent: "flex-start",
    paddingTop: spacing.md,
  },
  bracketInlineAnimatedLayer: {
    alignItems: "flex-start",
    justifyContent: "flex-start",
  },
  bracketViewportFullscreen: {
    flex: 1,
    height: undefined,
    marginTop: 0,
  },
  bracketFullscreenSafeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  bracketFullscreenHeader: {
    alignItems: "center",
    backgroundColor: colors.primaryDark,
    flexDirection: "row",
    justifyContent: "center",
    minHeight: 54,
    paddingHorizontal: spacing.md,
  },
  bracketFullscreenTitle: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "uppercase",
  },
  bracketFullscreenCloseButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
    borderRadius: 999,
    height: 38,
    justifyContent: "center",
    position: "absolute",
    right: spacing.md,
    width: 38,
  },
  bracketFullscreenToolbar: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  bracketFullscreenSwapHelpText: {
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  bracketGestureArea: {
    flex: 1,
    overflow: "visible",
  },
  bracketBoardCanvas: {
    position: "relative",
  },
  bracketShareCaptureWrap: {
    backgroundColor: colors.background,
    left: -10000,
    padding: spacing.lg,
    position: "absolute",
    top: -10000,
  },
  zoneShareHiddenRoot: {
    left: -10000,
    position: "absolute",
    top: -10000,
  },
  zoneShareCaptureCard: {
    backgroundColor: "#F4F8F1",
    padding: spacing.lg,
    width: 920,
  },
  zoneShareHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  zoneShareHeaderCopy: {
    alignItems: "flex-start",
  },
  zoneShareOrganizerLogo: {
    borderRadius: 999,
    height: 54,
    width: 54,
  },
  zoneShareTitle: {
    color: colors.primaryDark,
    fontSize: 26,
    fontWeight: "900",
    textAlign: "left",
  },
  zoneShareSubtitle: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 4,
    textAlign: "left",
  },
  zoneShareZoneCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  zoneShareZoneTitle: {
    alignSelf: "center",
    backgroundColor: "#E1F4F0",
    borderColor: "#9FD6CF",
    borderRadius: 999,
    borderWidth: 1,
    color: "#1F6D69",
    fontSize: 18,
    fontWeight: "900",
    marginBottom: spacing.sm,
    minWidth: 130,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    textAlign: "center",
    textTransform: "uppercase",
  },
  zoneSharePairsGrid: {
    gap: 5,
    marginBottom: spacing.sm,
  },
  zoneSharePairRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  zoneSharePairNumber: {
    backgroundColor: "#E1F4F0",
    borderColor: "#9FD6CF",
    borderRadius: 999,
    borderWidth: 1,
    color: "#1F6D69",
    fontSize: 12,
    fontWeight: "900",
    height: 24,
    lineHeight: 22,
    textAlign: "center",
    width: 24,
  },
  zoneSharePairName: {
    color: colors.text,
    flex: 1,
    fontSize: 13,
    fontWeight: "900",
  },
  zoneShareMatchTable: {
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
  },
  zoneShareMatchHeader: {
    backgroundColor: "#E1F4F0",
    borderBottomColor: "#9FD6CF",
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: 30,
  },
  zoneShareMatchHeaderText: {
    color: "#1F6D69",
    fontSize: 10,
    fontWeight: "900",
    paddingVertical: 8,
    textAlign: "center",
  },
  zoneShareMatchRow: {
    alignItems: "center",
    borderBottomColor: "#E6ECE8",
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: 32,
  },
  zoneShareMatchText: {
    color: colors.text,
    fontSize: 10,
    fontWeight: "800",
    paddingHorizontal: 5,
    textAlign: "center",
  },
  zoneShareResultColumn: {
    flex: 1.1,
  },
  zoneSharePairColumn: {
    flex: 1,
  },
  zoneShareDayColumn: {
    flex: 0.8,
  },
  zoneShareTimeColumn: {
    flex: 0.75,
  },
  zoneSharePlaceColumn: {
    flex: 1.25,
  },
  zoneShareQualifiersRow: {
    backgroundColor: "#F7FAF8",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  zoneShareQualifierText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
  },
  bracketDayPickerModalCard: {
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderColor: "#C9DDF0",
    borderRadius: 18,
    borderWidth: 1,
    marginHorizontal: spacing.lg,
    marginTop: "28%",
    maxWidth: 360,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    width: "90%",
    zIndex: 3,
  },
  bracketDayPickerModalTitle: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "900",
    marginBottom: spacing.sm,
    textAlign: "center",
    textTransform: "uppercase",
  },
  bracketRoundBadge: {
    alignItems: "center",
    backgroundColor: BRACKET_ROUND_BADGE_COLORS[0],
    borderColor: BRACKET_ROUND_BADGE_COLORS[0],
    borderRadius: 10,
    borderWidth: 2,
    justifyContent: "center",
    minHeight: 34,
    paddingHorizontal: spacing.md,
    position: "absolute",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    top: -2,
    elevation: 4,
  },
  bracketConnectorHorizontal: {
    backgroundColor: "#B6CBD9",
    height: BRACKET_CONNECTOR_THICKNESS,
    position: "absolute",
  },
  bracketConnectorVertical: {
    backgroundColor: "#B6CBD9",
    position: "absolute",
    width: BRACKET_CONNECTOR_THICKNESS,
  },
  roundsWrap: {
    alignItems: "flex-start",
    gap: spacing.xs,
    flexDirection: "row",
    paddingRight: spacing.sm,
  },
  roundCard: {
    backgroundColor: "#FFFFFF",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    minWidth: 220,
    maxWidth: 220,
    padding: spacing.xs,
  },
  roundTitle: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.6,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.82)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
    textTransform: "uppercase",
  },
  matchFormatMeta: {
    color: "#1E88C8",
    fontSize: 10,
    fontWeight: "900",
    marginTop: 4,
    textAlign: "center",
    textTransform: "uppercase",
  },
  matchCard: {
    backgroundColor: "#F9FCFA",
    borderColor: "#E1ECE5",
    borderRadius: 12,
    borderWidth: 1,
    marginTop: spacing.xs,
    padding: spacing.xs,
  },
  bracketAbsoluteMatchCard: {
    backgroundColor: "#F9FCFA",
    borderColor: "#E1ECE5",
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "flex-start",
    height: BRACKET_CARD_HEIGHT,
    paddingHorizontal: 6,
    paddingVertical: 5,
    position: "absolute",
  },
  matchTitle: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "800",
    marginBottom: 6,
    textAlign: "center",
  },
  bracketMatchHeader: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 1,
    marginTop: 0,
    minHeight: 30,
    transform: [{ translateY: 2 }],
    width: "100%",
  },
  bracketMatchScheduleWrap: {
    alignItems: "center",
    gap: 0,
    justifyContent: "center",
    paddingRight: 58,
    minWidth: 0,
    width: "100%",
  },
  bracketMatchScheduleLine: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    justifyContent: "center",
    width: "100%",
  },
  bracketMatchScheduleButton: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderRadius: 0,
    borderWidth: 0,
    flexDirection: "row",
    gap: 2,
    minHeight: 18,
    paddingHorizontal: 2,
    paddingVertical: 1,
  },
  bracketMatchSchedulePill: {
    color: "#263238",
    fontSize: 8,
    fontWeight: "900",
  },
  bracketProgramButton: {
    marginTop: 0,
    position: "absolute",
    right: 3,
    top: 4,
  },
  bracketTeamsColumn: {
    alignItems: "center",
    flex: 1,
    gap: 0,
    justifyContent: "center",
    height: BRACKET_TEAMS_STACK_HEIGHT,
    minWidth: 0,
  },
  bracketMatchBodyRow: {
    alignItems: "center",
    flex: 0,
    flexDirection: "row",
    gap: 4,
    height: BRACKET_TEAMS_STACK_HEIGHT,
    justifyContent: "space-between",
    paddingTop: 2,
    width: "100%",
  },
  bracketSideControlsColumn: {
    alignItems: "center",
    height: BRACKET_TEAMS_STACK_HEIGHT,
    justifyContent: "center",
    width: 18,
  },
  bracketResultsColumn: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexShrink: 0,
    justifyContent: "flex-start",
    height: BRACKET_TEAMS_STACK_HEIGHT,
    paddingTop: 31,
    width: 62,
  },
  bracketResultsColumnCompact: {
    width: 60,
  },
  bracketResultsSetRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 2,
    justifyContent: "center",
    paddingTop: 14,
  },
  bracketResultsColumnDisabled: {
    opacity: 0.78,
  },
  bracketResultSetColumn: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 0,
    width: 26,
  },
  bracketVerticalSetInputs: {
    alignItems: "center",
    gap: 3,
    marginTop: 10,
  },
  bracketVerticalSetInput: {
    backgroundColor: "#FFFFFF",
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    color: colors.text,
    fontSize: 10,
    fontWeight: "900",
    height: 22,
    paddingHorizontal: 0,
    paddingVertical: 0,
    textAlign: "center",
    width: 24,
  },
  bracketVerticalSetInputDisabled: {
    backgroundColor: "#EEF1F3",
    borderColor: "#D4DADF",
    color: "#8C969E",
  },
  bracketScoreLabelDisabled: {
    color: "#8C969E",
  },
  bracketTeamColumn: {
    alignItems: "stretch",
    backgroundColor: "#FFFFFF",
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flex: 0,
    height: BRACKET_TEAM_CARD_HEIGHT,
    justifyContent: "center",
    paddingHorizontal: 5,
    paddingVertical: 0,
    alignSelf: "center",
    width: "100%",
  },
  bracketTeamColumnResolved: {
    backgroundColor: "#F2F7F4",
    borderColor: "#C8D8CE",
  },
  bracketTeamColumnSwapSelected: {
    borderColor: "#1E88C8",
    borderWidth: 2,
  },
  bracketTeamColumnHighlighted: {
    backgroundColor: "#E8F6F6",
    borderColor: "#1F6F78",
    borderWidth: 2,
  },
  bracketTeamContentRow: {
    alignItems: "center",
    flexDirection: "row",
    height: "100%",
    width: "100%",
  },
  bracketStatusIconLeftWrap: {
    alignItems: "center",
    justifyContent: "center",
    width: 24,
  },
  bracketSwapSelectBadge: {
    alignItems: "center",
    backgroundColor: "#0B4FB3",
    borderColor: "#FFFFFF",
    borderRadius: 999,
    borderWidth: 2,
    height: 26,
    justifyContent: "center",
    marginBottom: 4,
    shadowColor: "#0B4FB3",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    width: 26,
    elevation: 4,
  },
  bracketSwapSelectBadgeActive: {
    backgroundColor: "#1E88C8",
    borderColor: "#0A2F6F",
  },
  bracketTeamSeedSide: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: "900",
    marginTop: 4,
    textAlign: "center",
  },
  bracketTeamSeed: {
    color: colors.muted,
    fontSize: 9,
    fontWeight: "900",
    marginTop: 4,
    textAlign: "center",
  },
  bracketTeamPrimaryName: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "900",
    marginTop: 0,
    textAlign: "center",
  },
  highlightedPairNameText: {
    color: "#1E88C8",
    fontWeight: "900",
  },
  bracketTeamPlayersBlock: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  bracketTeamPlayersBlockBye: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 0,
  },
  bracketTeamByeText: {
    color: colors.primaryDark,
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "uppercase",
  },
  bracketMiddleWrap: {
    alignItems: "center",
    flexDirection: "row",
    gap: 3,
    justifyContent: "center",
    width: "100%",
  },
  bracketTeamsStack: {
    alignItems: "center",
    gap: 4,
    width: "100%",
  },
  bracketMatchLocationWrap: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    justifyContent: "center",
    marginTop: 0,
    maxWidth: "100%",
    minHeight: 12,
    paddingHorizontal: 0,
  },
  bracketMatchVenueText: {
    color: "#2EA8D9",
    fontSize: 7,
    fontWeight: "900",
    lineHeight: 9,
    textAlign: "center",
    maxWidth: 98,
  },
  bracketMatchCourtText: {
    color: "#1B5D92",
    fontSize: 7,
    fontWeight: "900",
    textAlign: "center",
    maxWidth: 68,
  },
  bracketCourtChip: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#E7F1FF",
    borderColor: "#9EC3F1",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: 1,
    maxWidth: 84,
    minHeight: 15,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  bracketCourtChipDisabled: {
    opacity: 0.78,
  },
  bracketResultModalButton: {
    alignItems: "center",
    backgroundColor: "#EEF4FA",
    borderColor: "#B8CCE0",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: 7,
    minHeight: 22,
    paddingHorizontal: 7,
    width: 56,
  },
  bracketResultModalButtonDisabled: {
    opacity: 0.72,
  },
  bracketResultModalButtonText: {
    color: "#244A66",
    fontSize: 8,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "uppercase",
  },
  bracketResultScoreCardsRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 2,
    justifyContent: "center",
    minHeight: 34,
    width: 62,
  },
  bracketResultScoreCard: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#9FD6CF",
    borderRadius: 7,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 32,
    width: 18,
  },
  bracketResultScoreCardEmpty: {
    backgroundColor: "#F7FAF8",
    borderColor: "#DCE9E5",
  },
  bracketResultScoreDivider: {
    backgroundColor: "#D8E8E4",
    height: 1,
    width: "70%",
  },
  bracketResultScoreValue: {
    color: "#173C38",
    fontSize: 9,
    fontWeight: "900",
    lineHeight: 13,
    textAlign: "center",
  },
  bracketResultScoreValueEmpty: {
    color: "#A3B2AF",
  },
  bracketResultSummaryText: {
    color: colors.text,
    fontSize: 8,
    fontWeight: "900",
    lineHeight: 10,
    textAlign: "center",
    width: 56,
  },
  bracketCenterInfo: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: 22,
  },
  bracketStatusIconWrap: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
    minHeight: 18,
  },
  matchSlot: {
    backgroundColor: "#FFFFFF",
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  matchSlotSeed: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  matchSlotSeedBye: {
    color: "#1E88C8",
  },
  matchSlotZone: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
    textAlign: "center",
  },
});
