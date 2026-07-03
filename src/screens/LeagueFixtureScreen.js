import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share as NativeShare,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as FileSystem from "expo-file-system/legacy";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import Share from "react-native-share";
import { captureRef } from "react-native-view-shot";

import BottomQuickActionsBar, {
  BOTTOM_QUICK_ACTIONS_SPACE,
} from "../components/BottomQuickActionsBar";
import FeedbackModal from "../components/FeedbackModal";
import LeagueHeaderCard from "../components/LeagueHeaderCard";
import SectionHeader from "../components/SectionHeader";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import {
  canManageLeague,
  generateLeagueFixture,
  getLeagueById,
  isLeagueParticipant,
  listLeagues,
  updateLeagueFixture,
  updateLeagueFixtureConfig,
  updateLeaguePlayers,
  validateFixtureGeneration,
} from "../services/leaguesService";
import { sendChatMessage } from "../services/chatService";
import { listPlayers } from "../services/playersService";
import { getUserId } from "../utils/getUserId";
import { formatPlayerShortName, formatTeamShortLabel } from "../utils/playerDisplayName";

function buildNextFixture(currentFixture, roundId, matchId, updater) {
  return {
    ...currentFixture,
    rounds: currentFixture.rounds.map((round) => {
      if (round.id !== roundId) {
        return round;
      }

      return {
        ...round,
        matches: round.matches.map((match) => {
          if (match.id !== matchId) {
            return match;
          }

          return updater(match);
        }),
      };
    }),
  };
}

function sanitizeSetValue(value = "", label = "") {
  const maxLength = label === "STB" ? 2 : 1;

  return String(value || "").replace(/\D/g, "").slice(0, maxLength);
}

function parseCompactLeagueSetInput(value = "", label = "") {
  const digits = String(value || "").replace(/\D/g, "");

  if (label === "STB") {
    return {
      own: digits.slice(0, 2),
      rival: digits.slice(2, 4),
    };
  }

  return {
    own: digits.slice(0, 1),
    rival: digits.slice(1, 2),
  };
}

function formatCompactLeagueSetInput(set = {}) {
  const own = String(set?.own || "");
  const rival = String(set?.rival || "");

  if (!own && !rival) {
    return "";
  }

  return `${own}/${rival}`;
}

function sanitizeTimeSlotValue(value = "") {
  return String(value || "")
    .replace(/[^\d:]/g, "")
    .slice(0, 5);
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

function chunkItems(items = [], chunkSize = 3) {
  const size = Math.max(Number(chunkSize || 1), 1);
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
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

function buildDateFromMillis(value = 0) {
  const date = value ? new Date(value) : new Date();

  if (Number.isNaN(date.getTime())) {
    return new Date();
  }

  return date;
}

function normalizeDateStartMillis(value = 0) {
  if (!value) {
    return 0;
  }

  const date = buildDateFromMillis(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function addDaysToDateMillis(value = 0, days = 0) {
  if (!value) {
    return 0;
  }

  const date = buildDateFromMillis(value);
  date.setDate(date.getDate() + days);
  return normalizeDateStartMillis(date.getTime());
}

function formatDateLabel(value = 0) {
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

function formatDayLabel(value = 0) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString("es-AR", {
    weekday: "long",
  });
}

function formatRoundDayTimeLabel(round = {}) {
  const dateMillis = round.rescheduledDateMillis || round.scheduledDateMillis || 0;
  const dayLabel = formatDayLabel(dateMillis);
  const timeSlots = (round.matches || []).map((match) => match.timeSlot).filter(Boolean);
  const uniqueTimes = [...new Set(timeSlots)];
  const timeLabel = uniqueTimes.length ? `${uniqueTimes.join(" / ")} hs` : round.scheduleLabel || "";

  return [dayLabel, timeLabel].filter(Boolean).join(" · ");
}

function resolveLeagueOrganizerLabel(league = {}, fallbackName = "la organizacion") {
  return (
    league?.complejoNombre ||
    league?.complejo?.nombre ||
    league?.complexName ||
    league?.clubName ||
    league?.organizerName ||
    league?.organizadorNombre ||
    fallbackName
  );
}

function buildSuspensionMessage({ leagueName = "Liga", round = {} }) {
  const dateLabel = formatDateLabel(round.scheduledDateMillis);
  const hasRescheduledDate =
    Boolean(round.rescheduledDateMillis) ||
    (round.matches || []).some((match) => Boolean(match?.rescheduledDateMillis));
  const timeSlots = [
    ...new Set((round.matches || []).map((match) => match?.timeSlot).filter(Boolean)),
  ];
  const timeLabel = timeSlots.length ? `${timeSlots.join(" / ")} hs` : round.scheduleLabel || "";

  return [
    `${hasRescheduledDate ? "LIGA REPROGRAMADA" : "LIGA SUSPENDIDA"}: ${leagueName}.`,
    round.title ? `${round.title}${dateLabel ? ` del ${dateLabel}` : ""}.` : "",
    timeLabel ? `Horario: ${timeLabel}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildSuspensionWhatsAppMessage({
  leagueName = "Liga",
  organizerLabel = "la organizacion",
  round = {},
}) {
  const roundTitle = round.title || "Fecha";
  const dateLabel = formatDateLabel(round.scheduledDateMillis);
  const timeSlots = [
    ...new Set((round.matches || []).map((match) => match?.timeSlot).filter(Boolean)),
  ];
  const timeLabel = timeSlots.length ? `${timeSlots.join(" / ")} hs` : round.scheduleLabel || "";
  const hasManualReschedule =
    Boolean(round.rescheduledDateMillis) ||
    (round.matches || []).some((match) => Boolean(match?.rescheduledDateMillis));
  const hasRainReason = (round.matches || []).some((match) => {
    const reason = String(match?.suspensionReason || round.suspensionReason || "").toLowerCase();
    const label = getSuspensionReasonLabel(reason).toLowerCase();

    return reason.includes("weather") || reason.includes("lluvia") || label.includes("climatica");
  });
  const actionText = hasManualReschedule ? "fue suspendida y sera reprogramada" : "fue suspendida";
  const reasonText = hasRainReason ? " por lluvia" : "";
  const roundDetail = [dateLabel, timeLabel ? `a las ${timeLabel}` : ""].filter(Boolean).join(" ");

  const baseMessage = `Hola! Te avisamos desde ${organizerLabel}, que la liga: ${leagueName}, ${roundTitle}${
    roundDetail ? ` la que se jugaria el ${roundDetail}` : ""
  }, ${actionText}${reasonText}.`;

  return [baseMessage, "Cualquier consulta comunicate con nosotros. Gracias."].join(" ");
}

function getLeagueSuspensionNotificationTargets(round = {}) {
  const playersMap = new Map();

  (round.matches || []).forEach((match) => {
    if (!match?.suspensionMode || match?.result?.winner) {
      return;
    }

    [...(match.teamA?.players || []), ...(match.teamB?.players || [])].forEach((player) => {
      const playerUserId = player?.linkedUserId || player?.id || "";

      if (!playerUserId || playersMap.has(playerUserId)) {
        return;
      }

      playersMap.set(playerUserId, {
        id: playerUserId,
        name: formatPlayerShortName(player) || "Jugador",
      });
    });
  });

  return [...playersMap.values()];
}

const SUSPENSION_REASONS = [
  { label: "Inclemencia Climatica", value: "weather" },
  { label: "Feriado", value: "holiday" },
  { label: "Problema Tecnico", value: "technical" },
  { label: "Otros Motivos", value: "other" },
];

const SUSPENSION_SCOPES = {
  ALL_DAY: "all_day",
  LEAGUE_ROUND: "league_round",
  SELECTED_MATCHES: "selected_matches",
};

function getSuspensionReasonLabel(value = "") {
  return SUSPENSION_REASONS.find((reason) => reason.value === value)?.label || "";
}

function isSuspensionNoticeActive(suspendedAtMillis = 0) {
  if (!suspendedAtMillis) {
    return true;
  }

  return Date.now() - suspendedAtMillis < 24 * 60 * 60 * 1000;
}

function clearMatchSuspensionData(match = {}) {
  return {
    ...match,
    suspendedAtMillis: 0,
    suspensionReason: "",
    suspensionMode: "",
    rescheduledDateMillis: 0,
  };
}

function isPendingReprogrammedMatch(match = {}) {
  return Boolean(match?.suspensionMode && !isMatchCompleted(match));
}

function getMatchStatusMeta(match = {}) {
  if (isMatchCompleted(match)) {
    return {
      label: "Jugado",
      styleKey: "played",
    };
  }

  if (match?.suspensionMode) {
    return {
      label: isSuspensionNoticeActive(match.suspendedAtMillis) ? "Suspendido" : "Reprogramado",
      styleKey: isSuspensionNoticeActive(match.suspendedAtMillis) ? "suspended" : "reprogrammed",
    };
  }

  return {
    label: "Pendiente",
    styleKey: "pending",
  };
}

function getRoundStatusMeta(round = {}) {
  const matches = Array.isArray(round?.matches) ? round.matches : [];
  const allPlayed = matches.length > 0 && matches.every((match) => isMatchCompleted(match));
  const suspensionEntries = [
    ...(round?.suspensionMode ? [round] : []),
    ...matches.filter((match) => match?.suspensionMode && !isMatchCompleted(match)),
  ];
  const hasActiveSuspension = suspensionEntries.some((entry) =>
    isSuspensionNoticeActive(entry.suspendedAtMillis)
  );

  if (allPlayed) {
    return { label: "JUGADA", styleKey: "played" };
  }

  if (hasActiveSuspension) {
    return { label: "SUSPENDIDA", styleKey: "suspended" };
  }

  if (suspensionEntries.length) {
    return { label: "REPROGRAMADA", styleKey: "reprogrammed" };
  }

  return { label: "PENDIENTE", styleKey: "pending" };
}

function formatTimeValue(date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function combineDateAndTimeMillis(dateMillis = 0, timeSlot = "") {
  if (!dateMillis) {
    return 0;
  }

  const date = buildDateFromMillis(dateMillis);
  const normalizedTime = isValidTimeValue(timeSlot) ? timeSlot : "19:00";
  const [hours, minutes] = normalizedTime.split(":").map((part) => Number.parseInt(part, 10));
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
}

function getTimeSlotSortValue(value = "") {
  const match = String(value || "").match(/^(\d{1,2}):?(\d{0,2})$/);

  if (!match) {
    return Number.MAX_SAFE_INTEGER;
  }

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt((match[2] || "0").padEnd(2, "0"), 10);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return Number.MAX_SAFE_INTEGER;
  }

  return hours * 60 + minutes;
}

function sortMatchesByTime(matches = []) {
  return [...matches]
    .map((match, index) => ({ match, index }))
    .sort((first, second) => {
      const timeDiff =
        getTimeSlotSortValue(first.match?.timeSlot) - getTimeSlotSortValue(second.match?.timeSlot);

      return timeDiff || first.index - second.index;
    })
    .map(({ match }, index) => ({
      ...match,
      order: index + 1,
    }));
}

function sortFixtureRoundsByMatchTime(rounds = []) {
  return rounds.map((round) => ({
    ...round,
    matches: sortMatchesByTime(round.matches || []),
  }));
}

function buildLeagueShareTeamLabel(team = {}) {
  const players = Array.isArray(team?.players) ? team.players : [];
  const labels = players.map((player) => formatPlayerShortName(player)).filter(Boolean);

  return labels.join(" / ") || "Pareja";
}

function resolveLeagueShareLogoUrl(league = {}, fallbackLogo = "") {
  return (
    league?.organizerLogoUrl ||
    league?.organizerLogoURL ||
    league?.complejo?.organizerLogoUrl ||
    league?.complejo?.organizerLogoURL ||
    league?.complejo?.logoUrl ||
    league?.logoUrl ||
    fallbackLogo ||
    ""
  );
}

function applyFixtureScheduledDates(fixture = {}, startDateMillis = 0) {
  if (!startDateMillis) {
    return fixture;
  }

  const startDate = normalizeDateStartMillis(startDateMillis);

  return {
    ...fixture,
    rounds: (fixture.rounds || []).map((round, roundIndex) => {
      const roundDate = new Date(startDate);
      roundDate.setDate(roundDate.getDate() + roundIndex * 7);
      roundDate.setHours(0, 0, 0, 0);
      const scheduledDateMillis = roundDate.getTime();

      return {
        ...round,
        scheduledDateMillis,
        matches: (round.matches || []).map((match) => ({
          ...match,
          scheduledAtMillis: combineDateAndTimeMillis(scheduledDateMillis, match.timeSlot),
        })),
      };
    }),
  };
}

function getMatchSetDefinitions(matchFormat = "three_full_sets") {
  if (matchFormat === "single_set") {
    return [{ key: "set1", label: "Set 1" }];
  }

  if (matchFormat === "two_sets_super_tiebreak") {
    return [
      { key: "set1", label: "Set 1" },
      { key: "set2", label: "Set 2" },
      { key: "stb", label: "STB" },
    ];
  }

  return [
    { key: "set1", label: "Set 1" },
    { key: "set2", label: "Set 2" },
    { key: "set3", label: "3er set" },
  ];
}

function getMatchResultSets(match, matchFormat) {
  const setDefinitions = getMatchSetDefinitions(matchFormat);
  const currentSets = Array.isArray(match?.result?.sets) ? match.result.sets : [];

  return setDefinitions.map((definition, index) => ({
    ...definition,
    own: String(currentSets[index]?.own || ""),
    rival: String(currentSets[index]?.rival || ""),
  }));
}

function buildScoreSummary(sets = []) {
  return sets
    .filter((set) => set.own || set.rival)
    .map((set) => `${set.own || "0"}/${set.rival || "0"}`)
    .join(" ");
}

function hasSetData(set = {}) {
  return Boolean(String(set?.own || "").trim() || String(set?.rival || "").trim());
}

function hasRequiredResultSets(match, matchFormat) {
  const sets = getMatchResultSets(match, matchFormat);
  const requiredSetsCount = matchFormat === "single_set" ? 1 : 2;

  return sets.slice(0, requiredSetsCount).every((set) => hasSetData(set));
}

function isMatchCompleted(match) {
  return Boolean(match?.result?.winner);
}

function hasMatchResultData(match) {
  const result = match?.result || {};
  const hasSets = Array.isArray(result.sets) && result.sets.some((set) => hasSetData(set));

  return Boolean(hasSets || String(result.score || "").trim() || String(result.reason || "").trim());
}

function getReplacementEntries(match = {}) {
  return Object.values(match.replacements || {});
}

function hasAssignedReplacement(match = {}) {
  return getReplacementEntries(match).some(
    (replacement) => replacement?.requested && replacement?.replacement
  );
}

function hasUnassignedReplacement(match = {}) {
  return getReplacementEntries(match).some(
    (replacement) => replacement?.requested && !replacement?.replacement
  );
}

function getFixtureReplacementSignature(fixture = {}) {
  return (fixture.rounds || [])
    .flatMap((round) =>
      (round.matches || []).flatMap((match) =>
        Object.entries(match.replacements || {})
          .filter(([, replacement]) => replacement?.requested && replacement?.replacement)
          .map(([replacementKey, replacement]) => {
            const replacementPlayer = replacement.replacement || {};
            const replacementPlayerKey =
              replacementPlayer.linkedUserId || replacementPlayer.id || replacementPlayer.nombre || "";

            return `${round.id}:${match.id}:${replacementKey}:${replacementPlayerKey}`;
          })
      )
    )
    .sort()
    .join("|");
}

function getFixtureReplacementRequestSignature(fixture = {}) {
  return (fixture.rounds || [])
    .flatMap((round) =>
      (round.matches || []).flatMap((match) =>
        Object.entries(match.replacements || {})
          .filter(([, replacement]) => replacement?.requested)
          .map(([replacementKey, replacement]) => {
            const replacementPlayer = replacement.replacement || {};
            const replacementPlayerKey =
              replacementPlayer.linkedUserId || replacementPlayer.id || replacementPlayer.nombre || "";

            return `${round.id}:${match.id}:${replacementKey}:${replacement.requestedBy || ""}:${replacementPlayerKey}`;
          })
      )
    )
    .sort()
    .join("|");
}

function hasResultDataChanged(currentFixture = {}, nextFixture = {}) {
  const serializeResults = (fixture) =>
    (fixture.rounds || [])
      .flatMap((round) =>
        (round.matches || []).map((match) =>
          JSON.stringify({
            id: `${round.id}:${match.id}`,
            result: match.result || {},
          })
        )
      )
      .join("|");

  return serializeResults(currentFixture) !== serializeResults(nextFixture);
}

function hasSuspensionDataChanged(currentFixture = {}, nextFixture = {}) {
  const serializeSuspensions = (fixture) =>
    (fixture.rounds || [])
      .flatMap((round) => [
        JSON.stringify({
          id: round.id,
          rescheduledDateMillis: round.rescheduledDateMillis || 0,
          suspendedAtMillis: round.suspendedAtMillis || 0,
          suspensionMode: round.suspensionMode || "",
          suspensionReason: round.suspensionReason || "",
        }),
        ...(round.matches || []).map((match) =>
          JSON.stringify({
            id: `${round.id}:${match.id}`,
            rescheduledDateMillis: match.rescheduledDateMillis || 0,
            scheduledAtMillis: match.scheduledAtMillis || 0,
            suspendedAtMillis: match.suspendedAtMillis || 0,
            suspensionMode: match.suspensionMode || "",
            suspensionReason: match.suspensionReason || "",
          })
        ),
      ])
      .join("|");

  return serializeSuspensions(currentFixture) !== serializeSuspensions(nextFixture);
}

function hasNewWinnerAssigned(currentFixture = {}, nextFixture = {}) {
  const currentWinnerMap = new Map(
    (currentFixture.rounds || []).flatMap((round) =>
      (round.matches || []).map((match) => [
        `${round.id}:${match.id}`,
        String(match?.result?.winner || ""),
      ])
    )
  );

  return (nextFixture.rounds || []).some((round) =>
    (round.matches || []).some((match) => {
      const matchKey = `${round.id}:${match.id}`;
      const previousWinner = currentWinnerMap.get(matchKey) || "";
      const nextWinner = String(match?.result?.winner || "");

      return !previousWinner && Boolean(nextWinner);
    })
  );
}

function getTeamStatusIconName(match, teamKey) {
  if (!match?.result?.winner) {
    return "thumbs-up";
  }

  return match.result.winner === teamKey ? "thumbs-up" : "thumbs-down";
}

function getTeamStatusIconColor(match, teamKey) {
  if (!match?.result?.winner) {
    return colors.textMuted;
  }

  return match.result.winner === teamKey ? "#1E9E52" : "#C44A4A";
}

function getRoundCompletedAtMillis(round) {
  return typeof round?.completedAtMillis === "number" ? round.completedAtMillis : 0;
}

function resolveCurrentRoundId(rounds = []) {
  if (!Array.isArray(rounds) || !rounds.length) {
    return "";
  }

  const oneDayInMillis = 24 * 60 * 60 * 1000;
  const now = Date.now();

  for (let index = 0; index < rounds.length; index += 1) {
    const round = rounds[index];
    const isComplete = (round.matches || []).every((match) => isMatchCompleted(match));

    if (!isComplete) {
      return round.id;
    }

    const completedAtMillis = getRoundCompletedAtMillis(round);

    if (!completedAtMillis || now - completedAtMillis < oneDayInMillis) {
      return round.id;
    }
  }

  return rounds[rounds.length - 1]?.id || "";
}

function isRoundCompleted(round = {}) {
  const matches = Array.isArray(round?.matches) ? round.matches : [];

  return matches.length > 0 && matches.every((match) => isMatchCompleted(match));
}

function getProgressiveVisibleRounds(rounds = []) {
  if (!Array.isArray(rounds) || !rounds.length) {
    return [];
  }

  const currentRoundId = resolveCurrentRoundId(rounds);
  const currentRoundIndex = rounds.findIndex((round) => round.id === currentRoundId);

  return rounds.filter((round, index) => {
    const isPastOrCurrent = currentRoundIndex >= 0 && index <= currentRoundIndex;

    return isPastOrCurrent || isRoundCompleted(round);
  });
}

function buildTeamLabelFromPlayers(players = []) {
  return formatTeamShortLabel(players);
}

function buildPlayerPairTeams(players = []) {
  const groupedPlayers = players.reduce((groups, player) => {
    const pairNumber = Number.parseInt(String(player?.pairNumber || "0"), 10) || 0;

    if (pairNumber > 0) {
      groups[pairNumber] = [...(groups[pairNumber] || []), player];
    }

    return groups;
  }, {});

  return Object.entries(groupedPlayers)
    .sort(([first], [second]) => Number(first) - Number(second))
    .map(([pairNumber, pairPlayers]) => {
      const playersInPair = pairPlayers.slice(0, 2);

      return {
        id: `pair-team-${pairNumber}`,
        label: buildTeamLabelFromPlayers(playersInPair) || `Pareja ${pairNumber}`,
        pairNumber: Number(pairNumber),
        players: playersInPair,
      };
    });
}

function normalizeFixtureSide(value = "") {
  const normalizedValue = String(value || "").trim().toLowerCase();

  if (normalizedValue === "reves" || normalizedValue === "revés") {
    return "reves";
  }

  if (normalizedValue === "drive") {
    return "drive";
  }

  return "ambos";
}

function buildIndividualFixturePreview(league = {}) {
  const players = Array.isArray(league?.players) ? league.players : [];
  const drivePlayers = [];
  const revesPlayers = [];
  const undefinedPlayers = [];

  players.forEach((player) => {
    const side = normalizeFixtureSide(player?.ladoJuego);

    if (side === "drive") {
      drivePlayers.push(player);
      return;
    }

    if (side === "reves") {
      revesPlayers.push(player);
      return;
    }

    undefinedPlayers.push(player);
  });

  const pairedTeamsCount = Math.min(drivePlayers.length, revesPlayers.length);
  const recommendedRounds =
    pairedTeamsCount <= 1
      ? pairedTeamsCount
      : pairedTeamsCount % 2 === 0
        ? pairedTeamsCount - 1
        : pairedTeamsCount;
  const configuredRounds = Number.parseInt(String(league?.fixtureConfig?.roundsCount || "0"), 10) || 0;
  const extraDriveCount = Math.max(0, drivePlayers.length - revesPlayers.length);
  const extraRevesCount = Math.max(0, revesPlayers.length - drivePlayers.length);

  return {
    configuredRounds,
    drivePlayers,
    extraDriveCount,
    extraRevesCount,
    hasBalancedSides: drivePlayers.length === revesPlayers.length && undefinedPlayers.length === 0,
    hasOddTeams: pairedTeamsCount > 0 && pairedTeamsCount % 2 === 1,
    pairedTeamsCount,
    recommendedRounds,
    revesPlayers,
    undefinedPlayers,
  };
}

function getPlayerReplacementKey(teamKey, player = {}, index = 0) {
  const playerId = player.id || player.linkedUserId;

  if (playerId) {
    return `${teamKey}:${playerId}`;
  }

  return `${teamKey}:guest-${index}-${String(player.nombre || "").trim()}-${String(player.apellido || "").trim()}`;
}

function normalizeReplacementPlayer(player = {}, type = "registered") {
  return {
    id: player.id || "",
    linkedUserId: player.linkedUserId || (type === "registered" ? player.id || "" : ""),
    nombre: player.nombre || player.name || "Jugador",
    apellido: player.apellido || player.lastName || "",
    categoria: player.categoria || "",
    sexo: player.sexo || "",
    type,
  };
}

function formatReplacementNoticeDate(round = {}) {
  const dateMillis = Number(round?.scheduledDateMillis || round?.rescheduledDateMillis || 0);

  if (!dateMillis) {
    return "";
  }

  return new Date(dateMillis).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function getReplacementPlayerKey(player = {}) {
  return String(player?.linkedUserId || player?.id || "").trim();
}

function collectReplacementConfirmationNotices(fixture = {}, league = {}) {
  return (fixture.rounds || []).flatMap((round) =>
    (round.matches || []).flatMap((match) =>
      Object.entries(match.replacements || {})
        .filter(([, replacement]) => replacement?.confirmedNoticePending)
        .map(([, replacement]) => {
          const replacementPlayer = replacement.replacement || {};
          const recipientId = getReplacementPlayerKey(replacementPlayer);
          const dateLabel = formatReplacementNoticeDate(round);
          const timeLabel = match.timeSlot || round.scheduleLabel || "Horario a definir";
          const complexLabel =
            league?.complejoNombre ||
            league?.complejo?.nombre ||
            league?.complexName ||
            "Complejo a definir";

          return {
            recipientId,
            recipientName: formatPlayerShortName(replacementPlayer),
            text: [
              `Fuiste confirmado como remplazo en ${league?.nombre || "la liga"}.`,
              `Categoria: ${league?.categoria || "A confirmar"}${league?.sexo ? ` - ${league.sexo}` : ""}.`,
              `Fecha: ${round.title || "Fecha"}${dateLabel ? ` (${dateLabel})` : ""}.`,
              `Hora: ${timeLabel}.`,
              `Complejo: ${complexLabel}.`,
            ].join("\n"),
          };
        })
        .filter((notice) => notice.recipientId)
    )
  );
}

function clearReplacementConfirmationNoticeFlags(fixture = {}) {
  return {
    ...fixture,
    rounds: (fixture.rounds || []).map((round) => ({
      ...round,
      matches: (round.matches || []).map((match) => ({
        ...match,
        replacements: Object.entries(match.replacements || {}).reduce(
          (nextReplacements, [replacementKey, replacement]) => {
            nextReplacements[replacementKey] = {
              ...(replacement || {}),
              confirmedNoticePending: false,
            };

            return nextReplacements;
          },
          {}
        ),
      })),
    })),
  };
}

export default function LeagueFixtureScreen({ navigation, route }) {
  const { userData } = useAuth();
  const leagueId = route?.params?.leagueId || "";
  const fallbackLeagueName = route?.params?.leagueName || "Liga";
  const focusRoundId = route?.params?.focusRoundId || "";
  const focusMatchId = route?.params?.focusMatchId || "";
  const focusReplacementKey = route?.params?.focusReplacementKey || "";
  const [league, setLeague] = useState(null);
  const [fixtureDraft, setFixtureDraft] = useState({ generatedAtMillis: 0, rounds: [] });
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [fixtureGenerationMode, setFixtureGenerationMode] = useState("all");
  const [fixtureVisibilityMode, setFixtureVisibilityMode] = useState("all");
  const [fixtureStartDateMillis, setFixtureStartDateMillis] = useState(0);
  const [fixtureStartDatePickerVisible, setFixtureStartDatePickerVisible] = useState(false);
  const [fixtureGenerateSetupVisible, setFixtureGenerateSetupVisible] = useState(false);
  const [savingMatchId, setSavingMatchId] = useState("");
  const [pairingDraft, setPairingDraft] = useState([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [savingPairs, setSavingPairs] = useState(false);
  const [pairsOverviewExpanded, setPairsOverviewExpanded] = useState(false);
  const [expandedRoundIds, setExpandedRoundIds] = useState([]);
  const [leagueResultEditor, setLeagueResultEditor] = useState(null);
  const [leagueMatchDayPickerTarget, setLeagueMatchDayPickerTarget] = useState(null);
  const [tableReplacementMenuTarget, setTableReplacementMenuTarget] = useState(null);
  const setInputRefs = useRef({});
  const [confirmRegenerateVisible, setConfirmRegenerateVisible] = useState(false);
  const [confirmDeleteVisible, setConfirmDeleteVisible] = useState(false);
  const [replacementPendingRemoval, setReplacementPendingRemoval] = useState(null);
  const [individualPreviewVisible, setIndividualPreviewVisible] = useState(false);
  const [savingIndividualSideId, setSavingIndividualSideId] = useState("");
  const [replacementPickerVisible, setReplacementPickerVisible] = useState(false);
  const [replacementTarget, setReplacementTarget] = useState(null);
  const [replacementPlayers, setReplacementPlayers] = useState([]);
  const [replacementQuery, setReplacementQuery] = useState("");
  const [replacementLoading, setReplacementLoading] = useState(false);
  const [replacementGuestNombre, setReplacementGuestNombre] = useState("");
  const [replacementGuestApellido, setReplacementGuestApellido] = useState("");
  const [timePickerTarget, setTimePickerTarget] = useState(null);
  const [playerReplacementMenuVisible, setPlayerReplacementMenuVisible] = useState(false);
  const [roundSuspensionTarget, setRoundSuspensionTarget] = useState(null);
  const [suspensionFlowStarted, setSuspensionFlowStarted] = useState(false);
  const [retakingSuspension, setRetakingSuspension] = useState(false);
  const [suspensionScope, setSuspensionScope] = useState("");
  const [selectedSuspendedMatchIds, setSelectedSuspendedMatchIds] = useState([]);
  const [selectedSuspensionReason, setSelectedSuspensionReason] = useState("");
  const [rescheduleDatePickerVisible, setRescheduleDatePickerVisible] = useState(false);
  const [applyingSuspension, setApplyingSuspension] = useState(false);
  const [goToPaymentsPromptVisible, setGoToPaymentsPromptVisible] = useState(false);
  const [leagueShareModalVisible, setLeagueShareModalVisible] = useState(false);
  const [leagueShareInProgress, setLeagueShareInProgress] = useState(false);
  const [selectedLeagueShareRoundIds, setSelectedLeagueShareRoundIds] = useState([]);
  const [whatsAppSharePrompt, setWhatsAppSharePrompt] = useState({
    visible: false,
    message: "",
  });
  const [feedback, setFeedback] = useState({
    visible: false,
    title: "",
    message: "",
    tone: "default",
    askPaymentsAfterClose: false,
  });
  const reopenIndividualPreviewOnFocusRef = useRef(false);
  const fixtureScrollRef = useRef(null);
  const roundLayoutOffsetsRef = useRef({});
  const leagueShareViewRefs = useRef({});
  const leagueResultSetInputRefs = useRef({});

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      const loadLeague = async () => {
        try {
          setLoading(true);
          const nextLeague = await getLeagueById(leagueId);

          if (!isMounted) {
            return;
          }

          setLeague(nextLeague);
          setFixtureDraft(nextLeague.fixture || { generatedAtMillis: 0, rounds: [] });
          setPairingDraft(nextLeague.fixtureConfig?.manualTeams || []);
          const nextVisibilityMode =
            nextLeague.fixtureConfig?.visibilityMode === "current" ? "current" : "all";
          setFixtureGenerationMode(
            nextLeague.fixtureConfig?.generationMode === "next" ? "next" : "all"
          );
          setFixtureVisibilityMode(nextVisibilityMode);
          setFixtureStartDateMillis(
            normalizeDateStartMillis(nextLeague.fixtureConfig?.startDateMillis || 0)
          );
          setSelectedPlayerId("");
          const nextRounds = nextLeague.fixture?.rounds || [];
          setExpandedRoundIds((currentRoundIds) => {
            const nextRoundIds = new Set(nextRounds.map((round) => round.id));
            const validRoundIds = currentRoundIds.filter((roundId) => nextRoundIds.has(roundId));
            const currentRoundId = resolveCurrentRoundId(nextRounds);

            if (nextVisibilityMode === "current") {
              return [currentRoundId].filter(Boolean);
            }

            if (focusRoundId && nextRoundIds.has(focusRoundId)) {
              return validRoundIds.includes(focusRoundId)
                ? validRoundIds
                : [...validRoundIds, focusRoundId];
            }

            return validRoundIds.length || !currentRoundId ? validRoundIds : [currentRoundId];
          });
          if (reopenIndividualPreviewOnFocusRef.current && nextLeague?.teamType === "individual") {
            reopenIndividualPreviewOnFocusRef.current = false;
            setIndividualPreviewVisible(true);
          }
        } catch (error) {
          if (isMounted) {
            setFeedback({
              visible: true,
              title: "No pudimos cargar el fixture",
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

      loadLeague();

      return () => {
        isMounted = false;
      };
    }, [focusRoundId, leagueId])
  );

  const leagueName = league?.nombre || fallbackLeagueName;
  const canEditFixture = canManageLeague(league, userData);
  const fixtureRounds = Array.isArray(fixtureDraft?.rounds) ? fixtureDraft.rounds : [];
  const hasFixture = fixtureRounds.length > 0;
  const leagueFixtureDayOptions = useMemo(() => {
    const uniqueDates = new Map();

    fixtureRounds.forEach((round) => {
      const dateMillis = normalizeDateStartMillis(
        round.rescheduledDateMillis || round.scheduledDateMillis || 0
      );

      if (dateMillis && !uniqueDates.has(dateMillis)) {
        uniqueDates.set(dateMillis, {
          dateMillis,
          label: `${formatDayLabel(dateMillis)} ${formatDateLabel(dateMillis)}`,
        });
      }
    });

    return [...uniqueDates.values()].sort((left, right) => left.dateMillis - right.dateMillis);
  }, [fixtureRounds]);
  const leagueShareRoundOptions = useMemo(
    () =>
      fixtureRounds.map((round, index) => ({
        id: round.id,
        label: round.title || `Fecha ${index + 1}`,
        status: getRoundStatusMeta(round).label,
      })),
    [fixtureRounds]
  );
  const allLeagueShareRoundIds = useMemo(
    () => leagueShareRoundOptions.map((round) => round.id),
    [leagueShareRoundOptions]
  );
  const leagueShareSelectedRounds = useMemo(() => {
    const selectedIds = new Set(
      (selectedLeagueShareRoundIds.length ? selectedLeagueShareRoundIds : allLeagueShareRoundIds)
        .filter(Boolean)
    );

    return fixtureRounds.filter((round) => selectedIds.has(round.id));
  }, [allLeagueShareRoundIds, fixtureRounds, selectedLeagueShareRoundIds]);
  const leagueShareChunks = useMemo(
    () => chunkItems(leagueShareSelectedRounds, 3),
    [leagueShareSelectedRounds]
  );
  const leagueShareLogoUrl = useMemo(
    () => resolveLeagueShareLogoUrl(league, userData?.organizerLogoUrl),
    [league, userData?.organizerLogoUrl]
  );
  const allLeagueShareRoundsSelected =
    allLeagueShareRoundIds.length > 0 &&
    allLeagueShareRoundIds.every((roundId) => selectedLeagueShareRoundIds.includes(roundId));
  const tableReplacementMenuMatch = useMemo(() => {
    if (!tableReplacementMenuTarget?.roundId || !tableReplacementMenuTarget?.matchId) {
      return null;
    }

    const round = fixtureRounds.find((item) => item.id === tableReplacementMenuTarget.roundId);
    const match = (round?.matches || []).find(
      (item) => item.id === tableReplacementMenuTarget.matchId
    );

    return match ? { match, round } : null;
  }, [fixtureRounds, tableReplacementMenuTarget]);
  const fixtureValidation = useMemo(() => validateFixtureGeneration(league), [league]);
  const visibleFixtureRounds =
    !canEditFixture && fixtureVisibilityMode === "current"
      ? getProgressiveVisibleRounds(fixtureRounds)
      : fixtureRounds;
  const fullFixturePreview = useMemo(
    () => (league && fixtureValidation.valid ? generateLeagueFixture(league) : null),
    [fixtureValidation.valid, league]
  );
  const configuredRoundsCount =
    Number.parseInt(String(league?.fixtureConfig?.roundsCount || "0"), 10) || 0;
  const canGenerateNextRound =
    canEditFixture &&
    hasFixture &&
    fixtureValidation.valid &&
    fixtureRounds.length < (fullFixturePreview?.rounds?.length || configuredRoundsCount);
  const isSavingFixture = savingMatchId === "saving";
  const leaguePlayers = Array.isArray(league?.players) ? league.players : [];
  const canRequestOwnReplacement = league ? isLeagueParticipant(league, userData) && !canEditFixture : false;
  const canSaveFixtureChanges = hasFixture && (canEditFixture || canRequestOwnReplacement);
  const hasUnsavedFixtureChanges =
    hasFixture && JSON.stringify(league?.fixture || { generatedAtMillis: 0, rounds: [] }) !== JSON.stringify(fixtureDraft);
  const currentUserId = getUserId(userData).toLowerCase();
  const individualFixturePreview = useMemo(
    () => buildIndividualFixturePreview(league || {}),
    [league]
  );
  const playerPairTeams = useMemo(() => buildPlayerPairTeams(leaguePlayers), [leaguePlayers]);
  const hasPlayerPairTeams = playerPairTeams.length > 0;
  const visiblePairingTeams = hasPlayerPairTeams ? playerPairTeams : pairingDraft;
  const manualPairPlayerIds = useMemo(
    () =>
      new Set(
        visiblePairingTeams.flatMap((team) =>
          (team.players || []).map((player) => player.id || player.linkedUserId).filter(Boolean)
        )
      ),
    [visiblePairingTeams]
  );
  const unassignedPlayers = useMemo(
    () =>
      leaguePlayers.filter((player) => {
        const keys = [player.id, player.linkedUserId].filter(Boolean);
        return !keys.some((key) => manualPairPlayerIds.has(key));
      }),
    [leaguePlayers, manualPairPlayerIds]
  );
  const leaguePlayerIds = useMemo(
    () =>
      new Set(
        leaguePlayers
          .flatMap((player) => [player.id, player.linkedUserId])
          .filter(Boolean)
          .map((playerId) => String(playerId).trim().toLowerCase())
      ),
    [leaguePlayers]
  );
  const replacementPlayersFiltered = useMemo(() => {
    const normalizedQuery = replacementQuery.trim().toLowerCase();

    if (!normalizedQuery) {
      return replacementPlayers;
    }

    return replacementPlayers.filter((player) =>
      `${player.apellido || ""} ${player.nombre || ""} ${player.categoria || ""}`
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [replacementPlayers, replacementQuery]);

  const isRegisteredPlayerAlreadyInLeague = (player = {}) =>
    [player.id, player.linkedUserId]
      .filter(Boolean)
      .some((playerId) => leaguePlayerIds.has(String(playerId).trim().toLowerCase()));

  const isCurrentUserFixturePlayer = (player = {}) =>
    Boolean(
      currentUserId &&
        [player.linkedUserId, player.id]
          .filter(Boolean)
          .some((playerId) => String(playerId).trim().toLowerCase() === currentUserId)
    );

  const nextReplacementTarget = useMemo(() => {
    if (!canRequestOwnReplacement || !currentUserId) {
      return null;
    }

    for (const round of fixtureRounds) {
      const roundIsActivelySuspended =
        round?.suspensionMode === "suspended" && isSuspensionNoticeActive(round.suspendedAtMillis);

      for (const match of round.matches || []) {
        if (
          roundIsActivelySuspended ||
          isPendingReprogrammedMatch(match) ||
          match.result?.winner ||
          hasMatchResultData(match)
        ) {
          continue;
        }

        const teams = [
          { teamKey: "teamA", players: match.teamA?.players || [] },
          { teamKey: "teamB", players: match.teamB?.players || [] },
        ];

        for (const team of teams) {
          const playerIndex = team.players.findIndex((player) => isCurrentUserFixturePlayer(player));

          if (playerIndex >= 0) {
            const player = team.players[playerIndex];
            const replacementKey = getPlayerReplacementKey(team.teamKey, player, playerIndex);

            return {
              match,
              player,
              playerIndex,
              replacementEntry: match.replacements?.[replacementKey] || null,
              replacementKey,
              roundId: round.id,
              roundTitle: round.title || `Fecha ${round.number || ""}`.trim(),
              teamKey: team.teamKey,
            };
          }
        }
      }
    }

    return null;
  }, [canRequestOwnReplacement, currentUserId, fixtureRounds]);
  const ownReplacementRequest = nextReplacementTarget?.replacementEntry || null;
  const hasOwnReplacementRequest = Boolean(ownReplacementRequest?.requested);
  const hasOwnReplacementDesignated = Boolean(ownReplacementRequest?.replacement);

  const showFeedback = (title, message, tone = "default", options = {}) => {
    setFeedback({
      visible: true,
      title,
      message,
      tone,
      askPaymentsAfterClose: Boolean(options.askPaymentsAfterClose),
    });
  };

  const promptWhatsAppShare = (messages = []) => {
    const validMessages = messages.filter(Boolean);

    if (!canEditFixture || !validMessages.length) {
      return;
    }

    setWhatsAppSharePrompt({
      visible: true,
      message: validMessages.join("\n\n"),
    });
  };

  const closeWhatsAppSharePrompt = () => {
    setWhatsAppSharePrompt({
      visible: false,
      message: "",
    });
  };

  const handleShareSuspensionByWhatsApp = async () => {
    const message = whatsAppSharePrompt.message;

    closeWhatsAppSharePrompt();

    if (!message) {
      return;
    }

    try {
      await NativeShare.share({ message });
    } catch (error) {
      showFeedback(
        "No pudimos abrir WhatsApp",
        error?.message || "Intenta compartir el aviso nuevamente.",
        "danger"
      );
    }
  };

  const openLeagueShareModal = () => {
    if (!hasFixture) {
      showFeedback(
        "No hay fechas para compartir",
        "Primero genera o guarda el fixture para poder compartirlo.",
        "warning"
      );
      return;
    }

    setSelectedLeagueShareRoundIds(allLeagueShareRoundIds);
    setLeagueShareModalVisible(true);
  };

  const closeLeagueShareModal = () => {
    if (leagueShareInProgress) {
      return;
    }

    setLeagueShareModalVisible(false);
  };

  const toggleLeagueShareRound = (roundId) => {
    setSelectedLeagueShareRoundIds((currentIds) =>
      currentIds.includes(roundId)
        ? currentIds.filter((currentRoundId) => currentRoundId !== roundId)
        : [...currentIds, roundId]
    );
  };

  const toggleLeagueShareAllRounds = () => {
    setSelectedLeagueShareRoundIds((currentIds) =>
      currentIds.length === allLeagueShareRoundIds.length ? [] : allLeagueShareRoundIds
    );
  };

  const buildLeagueSharePdfHtml = useCallback(() => {
    const organizerLabel = resolveLeagueOrganizerLabel(league, userData?.name || "PadelNexo");
    const logoUrl = resolveLeagueShareLogoUrl(league, userData?.organizerLogoUrl);
    const title = escapeHtml(leagueName || "Liga");
    const subtitle = escapeHtml(
      [league?.categoria || "", organizerLabel || ""].filter(Boolean).join(" · ")
    );
    const logoHtml = logoUrl
      ? `<img class="organizer-logo" src="${escapeHtml(logoUrl)}" />`
      : "";
    const chunksHtml = leagueShareChunks
      .map(
        (chunk) => `
          <section class="page">
            ${chunk
              .map((round) => {
                const statusMeta = getRoundStatusMeta(round);
                const rowsHtml = sortMatchesByTime(round.matches || [])
                  .map((match) => {
                    const resultLabel =
                      buildScoreSummary(getMatchResultSets(match, league?.matchFormat)) || "Pendiente";
                    const dayLabel = formatDayLabel(
                      match.rescheduledDateMillis ||
                        round.rescheduledDateMillis ||
                        round.scheduledDateMillis
                    ) || "Sin dia";
                    const timeLabel = match.timeSlot || "--:--";
                    const pairLabel = `${buildLeagueShareTeamLabel(match.teamA)}\n${buildLeagueShareTeamLabel(match.teamB)}`;

                    return `
                      <tr>
                        <td>${escapeHtml(resultLabel)}</td>
                        <td class="pairs-cell">${escapeHtml(pairLabel).replace(/\n/g, "<br/>")}</td>
                        <td>${escapeHtml(dayLabel)}</td>
                        <td>${escapeHtml(timeLabel)}</td>
                      </tr>
                    `;
                  })
                  .join("");

                return `
                  <article class="round-card">
                    <div class="round-header">
                      <h2>${escapeHtml(round.title || "Fecha")}</h2>
                      <span class="round-status ${String(statusMeta.styleKey || "pending").toLowerCase()}">
                        ${escapeHtml(statusMeta.label)}
                      </span>
                    </div>
                    <table>
                      <thead>
                        <tr>
                          <th>RESULTADOS</th>
                          <th>PAREJAS</th>
                          <th>DIA</th>
                          <th>HORA</th>
                        </tr>
                      </thead>
                      <tbody>${rowsHtml}</tbody>
                    </table>
                  </article>
                `;
              })
              .join("")}
          </section>
        `
      )
      .join("");

    return `
      <html>
        <head>
          <meta charset="utf-8" />
          <style>
            body {
              font-family: Arial, sans-serif;
              background: #f4f7f6;
              color: #173633;
              margin: 0;
              padding: 20px 18px;
            }
            .page {
              page-break-after: always;
            }
            .page:last-child {
              page-break-after: auto;
            }
            .round-card {
              background: #ffffff;
              border: 1px solid #cfe0dc;
              border-radius: 16px;
              overflow: hidden;
              margin-bottom: 18px;
            }
            .round-header {
              align-items: center;
              background: #dcefeb;
              display: flex;
              justify-content: space-between;
              gap: 12px;
              padding: 12px 14px;
            }
            .round-header h2 {
              color: #285e59;
              font-size: 16px;
              font-weight: 800;
              margin: 0;
            }
            .round-status {
              border-radius: 999px;
              font-size: 11px;
              font-weight: 800;
              padding: 5px 10px;
            }
            .round-status.pending {
              background: #eef2f1;
              color: #596563;
            }
            .round-status.played {
              background: #dff4ee;
              color: #24725e;
            }
            .round-status.suspended {
              background: #fff0f0;
              color: #994646;
            }
            .round-status.reprogrammed {
              background: #fff3e3;
              color: #9a601c;
            }
            table {
              border-collapse: collapse;
              table-layout: fixed;
              width: 100%;
            }
            th, td {
              border-top: 1px solid #e3ecea;
              font-size: 11px;
              padding: 10px 8px;
              text-align: center;
              vertical-align: middle;
            }
            th {
              background: #eff7f5;
              color: #285e59;
              font-size: 10px;
              font-weight: 800;
            }
            .pairs-cell {
              font-weight: 700;
              line-height: 1.45;
              width: 42%;
            }
            .meta {
              align-items: center;
              display: flex;
              gap: 12px;
              justify-content: center;
              margin-bottom: 14px;
              text-align: left;
            }
            .meta-copy {
              text-align: left;
            }
            .meta h1 {
              color: #173633;
              font-size: 21px;
              margin: 0 0 4px;
            }
            .meta p {
              color: #4c6460;
              font-size: 12px;
              margin: 0;
            }
            .organizer-logo {
              border-radius: 14px;
              height: 48px;
              object-fit: cover;
              width: 48px;
            }
          </style>
        </head>
        <body>
          <div class="meta">
            ${logoHtml}
            <div class="meta-copy">
              <h1>${title}</h1>
              <p>${subtitle}</p>
            </div>
          </div>
          ${chunksHtml}
        </body>
      </html>
    `;
  }, [
    league,
    league?.categoria,
    league?.matchFormat,
    leagueName,
    leagueShareChunks,
    userData?.name,
    userData?.organizerLogoUrl,
  ]);

  const handleShareLeaguePdf = async () => {
    if (!leagueShareSelectedRounds.length) {
      showFeedback(
        "Selecciona al menos una fecha",
        "Marca una o mas fechas para generar el PDF.",
        "warning"
      );
      return;
    }

    try {
      setLeagueShareInProgress(true);
      const canShare = await Sharing.isAvailableAsync();

      if (!canShare) {
        showFeedback(
          "No se pudo compartir",
          "Este dispositivo no tiene disponible el panel para compartir PDF.",
          "danger"
        );
        return;
      }

      setLeagueShareModalVisible(false);
      const { uri } = await Print.printToFileAsync({
        base64: false,
        html: buildLeagueSharePdfHtml(),
      });
      const fileBaseName =
        sanitizeSharedFileName(
          [leagueName || "Liga", league?.categoria || "Fixture"].filter(Boolean).join("-")
        ) || "Liga-Fixture";
      const sharedPdfUri = `${FileSystem.cacheDirectory}${fileBaseName}.pdf`;

      await FileSystem.deleteAsync(sharedPdfUri, { idempotent: true });
      await FileSystem.copyAsync({ from: uri, to: sharedPdfUri });

      await Sharing.shareAsync(sharedPdfUri, {
        dialogTitle: "Compartir fixture",
        mimeType: "application/pdf",
        UTI: "com.adobe.pdf",
      });
    } catch (error) {
      showFeedback(
        "No se pudo compartir",
        error?.message || "No pudimos generar el PDF del fixture.",
        "danger"
      );
    } finally {
      setLeagueShareInProgress(false);
    }
  };

  const handleShareLeagueImages = async () => {
    if (!leagueShareSelectedRounds.length) {
      showFeedback(
        "Selecciona al menos una fecha",
        "Marca una o mas fechas para generar las imagenes.",
        "warning"
      );
      return;
    }

    try {
      setLeagueShareInProgress(true);
      const canShare = await Sharing.isAvailableAsync();

      if (!canShare) {
        showFeedback(
          "No se pudo compartir",
          "Este dispositivo no tiene disponible el panel para compartir imagenes.",
          "danger"
        );
        return;
      }

      setLeagueShareModalVisible(false);
      const imageUris = [];

      for (let index = 0; index < leagueShareChunks.length; index += 1) {
        const ref = leagueShareViewRefs.current[index];

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

      if (!imageUris.length) {
        throw new Error("No pudimos generar las imagenes del fixture.");
      }

      await Share.open({
        failOnCancel: false,
        title: "Compartir fixture",
        type: "image/png",
        urls: imageUris,
      });
    } catch (error) {
      showFeedback(
        "No se pudo compartir",
        error?.message || "No pudimos generar las imagenes del fixture.",
        "danger"
      );
    } finally {
      setLeagueShareInProgress(false);
    }
  };

  const notifyLeagueSuspensionAsync = async (targetLeague = league, nextFixture = fixtureDraft) => {
    const previousRounds = new Map(
      (targetLeague?.fixture?.rounds || []).map((round) => [round.id, round])
    );
    const newlySuspendedRounds = (nextFixture?.rounds || []).map((round) => {
      const previousRound = previousRounds.get(round.id) || {};
      const previousMatches = new Map(
        (previousRound.matches || []).map((match) => [match.id, match])
      );
      const newlySuspendedMatches = (round.matches || []).filter((match) => {
        const previousMatch = previousMatches.get(match.id) || {};
        const wasSuspended = previousMatch?.suspensionMode && !previousMatch?.result?.winner;
        const isSuspended = match?.suspensionMode && !match?.result?.winner;
        const suspensionChanged =
          isSuspended &&
          wasSuspended &&
          (previousMatch.suspensionMode !== match.suspensionMode ||
            previousMatch.suspensionReason !== match.suspensionReason ||
            previousMatch.rescheduledDateMillis !== match.rescheduledDateMillis ||
            previousMatch.scheduledAtMillis !== match.scheduledAtMillis);

        return (isSuspended && !wasSuspended) || suspensionChanged;
      });

      return newlySuspendedMatches.length
        ? {
            ...round,
            matches: newlySuspendedMatches,
          }
        : null;
    }).filter(Boolean);

    const shareMessages = [];

    for (const round of newlySuspendedRounds) {
      const targets = getLeagueSuspensionNotificationTargets(round);
      const text = buildSuspensionMessage({
        leagueName: targetLeague?.nombre || leagueName,
        round,
      });

      await Promise.allSettled(
        targets.map((target) =>
          sendChatMessage({
            currentUserId: userData?.uid,
            currentUserName: userData?.name || "Organizador",
            otherUserId: target.id,
            otherUserName: target.name,
            text,
          })
        )
      );

      if (targets.length) {
        shareMessages.push(
          buildSuspensionWhatsAppMessage({
            leagueName: targetLeague?.nombre || leagueName,
            organizerLabel: resolveLeagueOrganizerLabel(targetLeague, userData?.name || "la organizacion"),
            round,
          })
        );
      }
    }

    return shareMessages.filter(Boolean);
  };

  const expandRound = (roundId) => {
    if (!roundId) {
      return;
    }

    setExpandedRoundIds((currentRoundIds) =>
      currentRoundIds.includes(roundId) ? currentRoundIds : [...currentRoundIds, roundId]
    );
  };

  const toggleRoundExpansion = (roundId) => {
    setExpandedRoundIds((currentRoundIds) =>
      currentRoundIds.includes(roundId)
        ? currentRoundIds.filter((currentRoundId) => currentRoundId !== roundId)
        : [...currentRoundIds, roundId]
    );
  };

  const scrollToFocusedRound = () => {
    if (!focusRoundId || !fixtureScrollRef.current) {
      return;
    }

    const y = roundLayoutOffsetsRef.current[focusRoundId];

    if (typeof y === "number") {
      fixtureScrollRef.current.scrollTo({
        animated: true,
        y: Math.max(0, y - 8),
      });
    }
  };

  const handleGenerateFixture = async ({ appendNext = false, mode = fixtureGenerationMode } = {}) => {
    if (!league) {
      return;
    }

    if (!fixtureValidation.valid) {
      showFeedback("No pudimos generar el fixture", fixtureValidation.message, "danger");
      return;
    }

    if (!fixtureStartDateMillis) {
      showFeedback(
        "Falta fecha de inicio",
        "Selecciona la fecha de inicio de la liga antes de generar el fixture.",
        "danger"
      );
      return;
    }

    try {
      setGenerating(true);
      const generatedFixture = generateLeagueFixture(league);
      const shouldAppendNext = appendNext || mode === "next";
      const currentRounds = appendNext ? fixtureRounds : [];
      const nextRound = generatedFixture.rounds?.[currentRounds.length] || null;

      if (shouldAppendNext && !nextRound) {
        showFeedback("Fixture completo", "Ya estan generadas todas las fechas configuradas.", "warning");
        return;
      }

      const nextFixtureBase = shouldAppendNext
        ? {
            ...generatedFixture,
            generatedAtMillis: fixtureDraft.generatedAtMillis || generatedFixture.generatedAtMillis,
            rounds: [...currentRounds, nextRound],
          }
        : generatedFixture;
      const nextFixture = applyFixtureScheduledDates(
        {
          ...nextFixtureBase,
          rounds: sortFixtureRoundsByMatchTime(nextFixtureBase.rounds || []),
        },
        fixtureStartDateMillis
      );
      const nextFixtureConfig = {
        ...(league.fixtureConfig || {}),
        generationMode: mode,
        startDateMillis: fixtureStartDateMillis,
        visibilityMode: fixtureVisibilityMode,
      };

      await updateLeagueFixtureConfig(league.id, nextFixtureConfig, nextFixture);
      setLeague((current) => ({
        ...current,
        fixtureConfig: nextFixtureConfig,
        fixture: nextFixture,
      }));
      setFixtureDraft(nextFixture);
      setExpandedRoundIds([resolveCurrentRoundId(nextFixture.rounds || [])].filter(Boolean));
      showFeedback(
        appendNext ? "Fecha generada" : "Fixture generado",
        shouldAppendNext
          ? "La proxima fecha quedo lista para cargar resultados."
          : "Las fechas quedaron listas para cargar resultados.",
        "success"
      );
    } catch (error) {
      showFeedback(
        "No pudimos generar el fixture",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerateFixturePress = () => {
    if (hasFixture) {
      setConfirmRegenerateVisible(true);
      return;
    }

    setFixtureGenerateSetupVisible(true);
  };

  const handleConfirmIndividualFixtureGeneration = () => {
    setIndividualPreviewVisible(false);
    handleGenerateFixture({ mode: fixtureGenerationMode });
  };

  const handleConfirmFixtureGenerationSetup = () => {
    if (!fixtureStartDateMillis) {
      showFeedback(
        "Falta fecha de inicio",
        "Selecciona la fecha de inicio de la liga antes de generar el fixture.",
        "danger"
      );
      return;
    }

    setFixtureGenerateSetupVisible(false);

    if (league?.teamType === "individual") {
      setIndividualPreviewVisible(true);
      return;
    }

    handleGenerateFixture({ mode: fixtureGenerationMode });
  };

  const handleGenerateNextRound = () => {
    if (league?.teamType === "individual" && !hasFixture) {
      setIndividualPreviewVisible(true);
      return;
    }

    handleGenerateFixture({ appendNext: true, mode: "next" });
  };

  const updateFixtureVisibilityMode = async (mode) => {
    setFixtureVisibilityMode(mode);

    if (!league?.id || !canEditFixture) {
      return;
    }

    const nextFixtureConfig = {
      ...(league.fixtureConfig || {}),
      generationMode: fixtureGenerationMode,
      visibilityMode: mode,
    };

    try {
      await updateLeagueFixtureConfig(league.id, nextFixtureConfig);
      setLeague((current) => ({
        ...current,
        fixtureConfig: nextFixtureConfig,
      }));
      setExpandedRoundIds([resolveCurrentRoundId(fixtureRounds)].filter(Boolean));
    } catch (error) {
      showFeedback(
        "No pudimos guardar la vista",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    }
  };

  const handleGoToManageFromIndividualPreview = () => {
    reopenIndividualPreviewOnFocusRef.current = true;
    setIndividualPreviewVisible(false);
    navigation.navigate("CreateLeague", {
      leagueId: league?.id,
      leagueName,
    });
  };

  const handleChangeIndividualPlayerSide = async (player, nextSide) => {
    if (!league?.id || savingIndividualSideId) {
      return;
    }

    const targetPlayerId = player?.id || player?.linkedUserId;

    if (!targetPlayerId) {
      return;
    }

    const nextPlayers = leaguePlayers.map((currentPlayer) => {
      const currentPlayerKeys = [currentPlayer.id, currentPlayer.linkedUserId].filter(Boolean);

      if (!currentPlayerKeys.includes(targetPlayerId)) {
        return currentPlayer;
      }

      return {
        ...currentPlayer,
        ladoJuego: nextSide,
        ladoPreferido: nextSide === "drive" ? "Drive" : "Reves",
      };
    });

    try {
      setSavingIndividualSideId(targetPlayerId);
      await updateLeaguePlayers(league.id, nextPlayers);
      setLeague((current) => ({
        ...current,
        players: nextPlayers,
      }));
      showFeedback(
        "Lado actualizado",
        `${formatPlayerShortName(player)} ahora figura como ${nextSide === "drive" ? "Drive" : "Reves"}.`,
        "success"
      );
    } catch (error) {
      showFeedback(
        "No pudimos cambiar el lado",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setSavingIndividualSideId("");
    }
  };

  const handlePairPlayerPress = (player) => {
    const playerId = player?.id || player?.linkedUserId;

    if (!playerId) {
      return;
    }

    if (!selectedPlayerId) {
      setSelectedPlayerId(playerId);
      return;
    }

    if (selectedPlayerId === playerId) {
      setSelectedPlayerId("");
      return;
    }

    const firstPlayer = leaguePlayers.find((entry) =>
      [entry.id, entry.linkedUserId].filter(Boolean).includes(selectedPlayerId)
    );

    if (!firstPlayer) {
      setSelectedPlayerId(playerId);
      return;
    }

    const nextTeam = {
      id: `manual-team-${Date.now()}`,
      label: formatTeamShortLabel([firstPlayer, player]),
      players: [
        {
          id: firstPlayer.id,
          linkedUserId: firstPlayer.linkedUserId,
          nombre: firstPlayer.nombre,
          apellido: firstPlayer.apellido,
          ladoJuego: firstPlayer.ladoJuego,
        },
        {
          id: player.id,
          linkedUserId: player.linkedUserId,
          nombre: player.nombre,
          apellido: player.apellido,
          ladoJuego: player.ladoJuego,
        },
      ],
    };

    setPairingDraft((current) => [...current, nextTeam]);
    setSelectedPlayerId("");
  };

  const handleRemovePair = (teamId) => {
    setPairingDraft((current) => current.filter((team) => team.id !== teamId));
    setSelectedPlayerId("");
  };

  const handleAutoPair = () => {
    const nextTeams = [];

    for (let index = 0; index + 1 < unassignedPlayers.length; index += 2) {
      const firstPlayer = unassignedPlayers[index];
      const secondPlayer = unassignedPlayers[index + 1];

      nextTeams.push({
        id: `manual-team-${Date.now()}-${index}`,
        label: formatTeamShortLabel([firstPlayer, secondPlayer]),
        players: [
          {
            id: firstPlayer.id,
            linkedUserId: firstPlayer.linkedUserId,
            nombre: firstPlayer.nombre,
            apellido: firstPlayer.apellido,
            ladoJuego: firstPlayer.ladoJuego,
          },
          {
            id: secondPlayer.id,
            linkedUserId: secondPlayer.linkedUserId,
            nombre: secondPlayer.nombre,
            apellido: secondPlayer.apellido,
            ladoJuego: secondPlayer.ladoJuego,
          },
        ],
      });
    }

    setPairingDraft((current) => [...current, ...nextTeams]);
  };

  const handleClearPairs = () => {
    setPairingDraft([]);
    setSelectedPlayerId("");
  };

  const handleSavePairs = async () => {
    if (!league) {
      return;
    }

    if (pairingDraft.length * 2 !== leaguePlayers.length) {
      showFeedback(
        "Parejas incompletas",
        "Todas las personas de la liga deben quedar dentro de una pareja antes de guardar.",
        "danger"
      );
      return;
    }

    try {
      setSavingPairs(true);
      const nextFixtureConfig = {
        ...league.fixtureConfig,
        manualTeams: pairingDraft,
      };
      const emptyFixture = { generatedAtMillis: 0, rounds: [] };
      await updateLeagueFixtureConfig(league.id, nextFixtureConfig, emptyFixture);
      setLeague((current) => ({
        ...current,
        fixtureConfig: nextFixtureConfig,
        fixture: emptyFixture,
      }));
      setFixtureDraft(emptyFixture);
      setExpandedRoundIds([]);
      showFeedback(
        "Parejas guardadas",
        "Las parejas quedaron fijas para esta liga. Ahora puedes regenerar el fixture.",
        "success"
      );
    } catch (error) {
      showFeedback(
        "No pudimos guardar las parejas",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setSavingPairs(false);
    }
  };

  const updateMatchSetValue = (roundId, matchId, setIndex, field, value, setLabel = "") => {
    expandRound(roundId);
    setFixtureDraft((current) =>
      buildNextFixture(current, roundId, matchId, (match) => {
        const nextSets = getMatchResultSets(match, league?.matchFormat).map((set, index) =>
          index === setIndex
            ? {
                own: field === "own" ? sanitizeSetValue(value, setLabel) : set.own,
                rival: field === "rival" ? sanitizeSetValue(value, setLabel) : set.rival,
              }
            : {
                own: set.own,
                rival: set.rival,
              }
        );

        return {
          ...match,
          result: {
            ...match.result,
            score: buildScoreSummary(nextSets),
            sets: nextSets,
          },
        };
      })
    );
  };

  const updateMatchTimeSlot = (roundId, matchId, value) => {
    expandRound(roundId);
    setFixtureDraft((current) => ({
      ...current,
      rounds: current.rounds.map((round) => {
        if (round.id !== roundId) {
          return round;
        }

        const nextMatches = (round.matches || []).map((match) =>
          match.id === matchId
            ? {
                ...match,
                timeSlot: sanitizeTimeSlotValue(value),
                scheduledAtMillis: combineDateAndTimeMillis(
                  match.rescheduledDateMillis ||
                    round.rescheduledDateMillis ||
                    round.scheduledDateMillis,
                  sanitizeTimeSlotValue(value)
                ),
              }
            : match
        );

        return {
          ...round,
          matches: sortMatchesByTime(nextMatches),
        };
      }),
    }));
  };

  const openMatchTimePicker = (roundId, matchId, currentValue = "") => {
    if (!canEditFixture) {
      return;
    }

    setTimePickerTarget({
      currentValue,
      matchId,
      roundId,
    });
  };

  const closeMatchTimePicker = () => {
    setTimePickerTarget(null);
  };

  const openLeagueMatchDayPicker = (round, match) => {
    if (!canEditFixture || !leagueFixtureDayOptions.length) {
      return;
    }

    const teamALabel =
      match.teamA?.label || buildTeamLabelFromPlayers(match.teamA?.players || []) || "Pareja A";
    const teamBLabel =
      match.teamB?.label || buildTeamLabelFromPlayers(match.teamB?.players || []) || "Pareja B";

    setLeagueMatchDayPickerTarget({
      currentDateMillis: normalizeDateStartMillis(
        match.rescheduledDateMillis ||
          round.rescheduledDateMillis ||
          round.scheduledDateMillis ||
          0
      ),
      matchId: match.id,
      participants: [teamALabel, teamBLabel],
      roundDateMillis: normalizeDateStartMillis(
        round.rescheduledDateMillis || round.scheduledDateMillis || 0
      ),
      roundId: round.id,
    });
  };

  const closeLeagueMatchDayPicker = () => {
    setLeagueMatchDayPickerTarget(null);
  };

  const selectLeagueMatchDay = (dateMillis = 0) => {
    if (
      !leagueMatchDayPickerTarget?.roundId ||
      !leagueMatchDayPickerTarget?.matchId ||
      !dateMillis
    ) {
      return;
    }

    const selectedDateMillis = normalizeDateStartMillis(dateMillis);

    setFixtureDraft((current) =>
      buildNextFixture(
        current,
        leagueMatchDayPickerTarget.roundId,
        leagueMatchDayPickerTarget.matchId,
        (match) => ({
          ...match,
          rescheduledDateMillis:
            selectedDateMillis === leagueMatchDayPickerTarget.roundDateMillis
              ? 0
              : selectedDateMillis,
          scheduledAtMillis: combineDateAndTimeMillis(selectedDateMillis, match.timeSlot),
        })
      )
    );
    closeLeagueMatchDayPicker();
  };

  const handleMatchTimePickerChange = (_, selectedDate) => {
    if (!selectedDate) {
      closeMatchTimePicker();
      return;
    }

    if (timePickerTarget?.roundId && timePickerTarget?.matchId) {
      updateMatchTimeSlot(
        timePickerTarget.roundId,
        timePickerTarget.matchId,
        formatTimeValue(selectedDate)
      );
    }

    if (Platform.OS !== "ios") {
      closeMatchTimePicker();
    } else {
      setTimePickerTarget((current) =>
        current ? { ...current, currentValue: formatTimeValue(selectedDate) } : current
      );
    }
  };

  const openFixtureStartDatePicker = ({ allowWithSetup = false } = {}) => {
    if (!canEditFixture || (hasFixture && !allowWithSetup)) {
      return;
    }

    setFixtureStartDatePickerVisible(true);
  };

  const handleFixtureStartDateChange = (_, selectedDate) => {
    if (!selectedDate) {
      setFixtureStartDatePickerVisible(false);
      return;
    }

    setFixtureStartDateMillis(normalizeDateStartMillis(selectedDate.getTime()));

    if (Platform.OS !== "ios") {
      setFixtureStartDatePickerVisible(false);
    }
  };

  const openRoundSuspensionOptions = (event, round) => {
    event?.stopPropagation?.();

    if (!canEditFixture || !round?.id) {
      return;
    }

    setRoundSuspensionTarget(round);
    setSuspensionFlowStarted(false);
    setSuspensionScope("");
    setSelectedSuspendedMatchIds([]);
    setSelectedSuspensionReason(round.suspensionReason || "");
  };

  const closeRoundSuspensionOptions = () => {
    setRoundSuspensionTarget(null);
    setSuspensionFlowStarted(false);
    setRetakingSuspension(false);
    setSuspensionScope("");
    setSelectedSuspendedMatchIds([]);
    setSelectedSuspensionReason("");
    setRescheduleDatePickerVisible(false);
  };

  const getPendingMatchesForRound = (round = {}) => {
    const matches = Array.isArray(round?.matches) ? round.matches : [];

    return matches.filter((match) => !isMatchCompleted(match));
  };

  const toggleSuspendedMatchSelection = (matchId) => {
    setSelectedSuspendedMatchIds((current) =>
      current.includes(matchId)
        ? current.filter((currentMatchId) => currentMatchId !== matchId)
        : [...current, matchId]
    );
  };

  const selectSuspensionScope = (scope) => {
    setSuspensionScope(scope);
    setSelectedSuspensionReason("");

    if (scope === SUSPENSION_SCOPES.SELECTED_MATCHES) {
      setSelectedSuspendedMatchIds([]);
    } else {
      setSelectedSuspendedMatchIds(getPendingMatchesForRound(roundSuspensionTarget).map((match) => match.id));
    }
  };

  const buildSuspendedMatch = ({
    match,
    reasonValue,
    rescheduledDateMillis = 0,
    suspensionMode = "next_week",
  }) => ({
    ...match,
    scheduledAtMillis: rescheduledDateMillis
      ? combineDateAndTimeMillis(rescheduledDateMillis, match.timeSlot)
      : match.scheduledAtMillis,
    suspendedAtMillis: Date.now(),
    suspensionReason: reasonValue,
    suspensionMode,
    rescheduledDateMillis,
  });

  const buildSuspendedRound = ({
    round,
    matchIds = [],
    reasonValue,
    rescheduledDateMillis = 0,
    suspensionMode = "next_week",
    markRound = false,
  }) => {
    const selectedIds = new Set(matchIds);
    const nextRescheduledDateMillis =
      rescheduledDateMillis ||
      (suspensionMode === "next_week" ? addDaysToDateMillis(round.scheduledDateMillis, 7) : 0);
    const nextMatches = (round.matches || []).map((match) => {
      const shouldSuspend = selectedIds.has(match.id) && !isMatchCompleted(match);

      return shouldSuspend
        ? buildSuspendedMatch({
            match,
            reasonValue,
            rescheduledDateMillis: nextRescheduledDateMillis,
            suspensionMode,
          })
        : match;
    });
    const suspendedCount = nextMatches.filter(
      (match) => match.suspensionMode === suspensionMode && match.suspensionReason === reasonValue
    ).length;

    return {
      ...round,
      ...(markRound && suspendedCount
        ? {
            suspendedAtMillis: Date.now(),
            suspensionReason: reasonValue,
            suspensionMode: "suspended",
            rescheduledDateMillis: nextRescheduledDateMillis,
          }
        : {}),
      matches: nextMatches,
    };
  };

  const shiftRoundScheduleByDays = (round = {}, days = 7) => {
    const nextScheduledDateMillis = addDaysToDateMillis(round.scheduledDateMillis, days);

    if (!nextScheduledDateMillis) {
      return round;
    }

    return {
      ...round,
      scheduledDateMillis: nextScheduledDateMillis,
      matches: (round.matches || []).map((match) => ({
        ...match,
        scheduledAtMillis: combineDateAndTimeMillis(nextScheduledDateMillis, match.timeSlot),
      })),
    };
  };

  const shiftFutureRoundsAfter = (rounds = [], roundId = "", days = 7) => {
    const targetIndex = rounds.findIndex((round) => round.id === roundId);

    if (targetIndex < 0) {
      return rounds;
    }

    return rounds.map((round, index) =>
      index > targetIndex ? shiftRoundScheduleByDays(round, days) : round
    );
  };

  const getDateAfterLastFixtureRound = () => {
    const rounds = Array.isArray(fixtureDraft?.rounds) ? fixtureDraft.rounds : [];
    const dateMillisList = rounds.flatMap((round) => [
      normalizeDateStartMillis(round?.scheduledDateMillis || 0),
      normalizeDateStartMillis(round?.rescheduledDateMillis || 0),
      ...((round?.matches || []).flatMap((match) => [
        normalizeDateStartMillis(match?.scheduledAtMillis || 0),
        normalizeDateStartMillis(match?.rescheduledDateMillis || 0),
      ])),
    ]);
    const lastDateMillis = dateMillisList.reduce(
      (currentMax, dateMillis) => (dateMillis > currentMax ? dateMillis : currentMax),
      0
    );

    return addDaysToDateMillis(lastDateMillis || roundSuspensionTarget?.scheduledDateMillis, 7);
  };

  const hasRoundSuspensionData = (round = {}) => {
    const matches = Array.isArray(round?.matches) ? round.matches : [];

    return Boolean(
      round?.suspensionMode ||
        round?.suspendedAtMillis ||
        round?.suspensionReason ||
        round?.rescheduledDateMillis ||
        matches.some(
          (match) =>
            match?.suspensionMode ||
            match?.suspendedAtMillis ||
            match?.suspensionReason ||
            match?.rescheduledDateMillis
        )
    );
  };

  const clearRoundSuspensionData = (round = {}) => ({
    ...round,
    suspendedAtMillis: 0,
    suspensionReason: "",
    suspensionMode: "",
    rescheduledDateMillis: 0,
    matches: (Array.isArray(round?.matches) ? round.matches : []).map(clearMatchSuspensionData),
  });

  const handleClearRoundSuspension = () => {
    if (!roundSuspensionTarget?.id) {
      return;
    }

    setFixtureDraft((current) => ({
      ...current,
      rounds: (current.rounds || []).map((round) =>
        round.id === roundSuspensionTarget.id ? clearRoundSuspensionData(round) : round
      ),
    }));
    expandRound(roundSuspensionTarget.id);
    closeRoundSuspensionOptions();
    showFeedback(
      "Suspension quitada",
      "La liga quedo sin suspension. Presiona GUARDAR CAMBIOS para confirmarlo.",
      "success"
    );
  };

  const getRoundSuspensionReason = (round = {}) => {
    const suspendedMatch = (round.matches || []).find((match) => match?.suspensionReason);

    return round.suspensionReason || suspendedMatch?.suspensionReason || "other";
  };

  const openRetakeSuspendedRound = (round = roundSuspensionTarget) => {
    if (!canEditFixture || !round?.id) {
      return;
    }

    setRoundSuspensionTarget(round);
    setSuspensionFlowStarted(true);
    setRetakingSuspension(true);
    setSuspensionScope(SUSPENSION_SCOPES.LEAGUE_ROUND);
    setSelectedSuspendedMatchIds(getPendingMatchesForRound(round).map((match) => match.id));
    setSelectedSuspensionReason(getRoundSuspensionReason(round));
  };

  const applyAllDaySuspension = async ({
    reasonValue,
    rescheduledDateMillis = 0,
    suspensionMode = "next_week",
  }) => {
    const targetDateMillis = normalizeDateStartMillis(roundSuspensionTarget?.scheduledDateMillis || 0);

    if (!targetDateMillis) {
      throw new Error("Esta fecha no tiene dia programado.");
    }

    const organizerLeagues = (await listLeagues()).filter((nextLeague) =>
      canManageLeague(nextLeague, userData)
    );
    let affectedLeaguesCount = 0;
    let affectedMatchesCount = 0;
    const shareMessages = [];

    await Promise.all(
      organizerLeagues.map(async (nextLeague) => {
        const baseFixture =
          nextLeague.id === league?.id ? fixtureDraft : nextLeague.fixture || {};
        const rounds = baseFixture.rounds || [];
        let leagueHasChanges = false;
        let suspendedRoundId = "";
        const nextRounds = rounds.map((round) => {
          const roundDateMillis = normalizeDateStartMillis(round.scheduledDateMillis || 0);

          if (roundDateMillis !== targetDateMillis) {
            return round;
          }

          const pendingMatches = getPendingMatchesForRound(round);

          if (!pendingMatches.length) {
            return round;
          }

          leagueHasChanges = true;
          suspendedRoundId = suspendedRoundId || round.id;
          affectedMatchesCount += pendingMatches.length;

          return buildSuspendedRound({
            round,
            matchIds: pendingMatches.map((match) => match.id),
            reasonValue,
            rescheduledDateMillis,
            suspensionMode,
            markRound: true,
          });
        });

        if (!leagueHasChanges) {
          return;
        }

        affectedLeaguesCount += 1;
        const shiftedRounds =
          suspensionMode === "next_week" && suspendedRoundId
            ? shiftFutureRoundsAfter(nextRounds, suspendedRoundId, 7)
            : nextRounds;
        const nextFixture = {
          ...baseFixture,
          rounds: shiftedRounds,
        };

        await updateLeagueFixture(nextLeague.id, nextFixture);
        const nextShareMessages = await notifyLeagueSuspensionAsync(nextLeague, nextFixture);
        shareMessages.push(...nextShareMessages);

        if (nextLeague.id === league?.id) {
          setFixtureDraft(nextFixture);
          setLeague((current) => ({
            ...current,
            fixture: nextFixture,
          }));
        }
      })
    );

    return { affectedLeaguesCount, affectedMatchesCount, shareMessages };
  };

  const applyRoundSuspension = async ({
    reasonValue = selectedSuspensionReason,
    rescheduledDateMillis = 0,
    suspensionMode = "next_week",
  } = {}) => {
    if (!roundSuspensionTarget?.id || !reasonValue) {
      return;
    }

    const matchIds =
      suspensionScope === SUSPENSION_SCOPES.SELECTED_MATCHES
        ? selectedSuspendedMatchIds
        : getPendingMatchesForRound(roundSuspensionTarget).map((match) => match.id);

    if (suspensionScope !== SUSPENSION_SCOPES.ALL_DAY && !matchIds.length) {
      showFeedback("No hay partidos pendientes", "Los partidos con resultado cargado no se modifican.", "warning");
      return;
    }

    try {
      setApplyingSuspension(true);

      if (suspensionScope === SUSPENSION_SCOPES.ALL_DAY) {
        const result = await applyAllDaySuspension({
          reasonValue,
          rescheduledDateMillis,
          suspensionMode,
        });

        closeRoundSuspensionOptions();
        showFeedback(
          "Ligas suspendidas",
          `Se suspendieron ${result.affectedMatchesCount} partidos pendientes en ${result.affectedLeaguesCount} liga(s).`,
          "warning"
        );
        promptWhatsAppShare(result.shareMessages);
        return;
      }

      const markRound = suspensionScope === SUSPENSION_SCOPES.LEAGUE_ROUND;

      setFixtureDraft((current) => ({
        ...current,
        rounds: (() => {
          const nextRounds = (current.rounds || []).map((round) =>
          round.id === roundSuspensionTarget.id
            ? buildSuspendedRound({
                round,
                matchIds,
                reasonValue,
                rescheduledDateMillis,
                suspensionMode,
                markRound,
              })
            : round
          );

          return suspensionMode === "next_week" && markRound
            ? shiftFutureRoundsAfter(nextRounds, roundSuspensionTarget.id, 7)
            : nextRounds;
        })(),
      }));
      expandRound(roundSuspensionTarget.id);
      closeRoundSuspensionOptions();
      showFeedback(
        "Fecha suspendida",
        "La suspension quedo cargada. Presiona GUARDAR CAMBIOS para confirmarla en la liga.",
        "warning"
      );
    } catch (error) {
      showFeedback(
        "No pudimos suspender",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setApplyingSuspension(false);
    }
  };

  const handleRescheduleDateChange = (_, selectedDate) => {
    if (!selectedDate) {
      setRescheduleDatePickerVisible(false);
      return;
    }

    applyRoundSuspension({
      rescheduledDateMillis: normalizeDateStartMillis(selectedDate.getTime()),
      suspensionMode: "manual",
    });

    if (Platform.OS !== "ios") {
      setRescheduleDatePickerVisible(false);
    }
  };

  const selectFixtureGenerationMode = (mode) => {
    setFixtureGenerationMode(mode);
  };

  const getSetInputKey = (matchId, setIndex, field) => `${matchId}-${setIndex}-${field}`;

  const focusNextSetInput = (matchId, setIndex, field) => {
    const nextField = field === "own" ? "rival" : "own";
    const nextSetIndex = field === "own" ? setIndex : setIndex + 1;
    const nextKey = getSetInputKey(matchId, nextSetIndex, nextField);
    const nextRef = setInputRefs.current[nextKey];

    if (nextRef && typeof nextRef.focus === "function") {
      nextRef.focus();
    }
  };

  const handleSetInputChange = (roundId, matchId, setIndex, field, value, setLabel) => {
    const sanitizedValue = sanitizeSetValue(value, setLabel);
    updateMatchSetValue(roundId, matchId, setIndex, field, sanitizedValue, setLabel);

    const shouldAdvance = setLabel === "STB" ? sanitizedValue.length >= 2 : sanitizedValue.length >= 1;

    if (shouldAdvance) {
      focusNextSetInput(matchId, setIndex, field);
    }
  };

  const updateMatchReplacement = (roundId, matchId, replacementKey, updater) => {
    expandRound(roundId);
    setFixtureDraft((current) =>
      buildNextFixture(current, roundId, matchId, (match) => {
        const nextReplacements = {
          ...(match.replacements || {}),
        };
        const currentReplacement = nextReplacements[replacementKey];
        const updatedReplacement = updater(currentReplacement, match);

        if (updatedReplacement) {
          nextReplacements[replacementKey] = updatedReplacement;
        } else {
          delete nextReplacements[replacementKey];
        }

        return {
          ...match,
          replacements: nextReplacements,
        };
      })
    );
  };

  const buildReplacementTargetFromMatchPlayer = ({
    match,
    player,
    playerIndex = 0,
    roundId = "",
    roundTitle = "",
    teamKey = "",
  }) => {
    if (!match || !player || !roundId || !teamKey) {
      return null;
    }

    const replacementKey = getPlayerReplacementKey(teamKey, player, playerIndex);

    return {
      match,
      player,
      playerIndex,
      replacementEntry: match.replacements?.[replacementKey] || null,
      replacementKey,
      roundId,
      roundTitle,
      teamKey,
    };
  };

  const handleToggleReplacementRequest = ({
    roundId,
    roundTitle = "",
    match,
    teamKey,
    player,
    playerIndex,
  }) => {
    const replacementKey = getPlayerReplacementKey(teamKey, player, playerIndex);
    const canRequestThisReplacement =
      canEditFixture ||
      (canRequestOwnReplacement && isCurrentUserFixturePlayer(player));

    if (!canRequestThisReplacement || hasMatchResultData(match) || match.result?.winner) {
      return;
    }

    if (!canEditFixture) {
      handlePlayerReplacementRequest(
        buildReplacementTargetFromMatchPlayer({
          match,
          player,
          playerIndex,
          roundId,
          roundTitle,
          teamKey,
        })
      );
      return;
    }

    updateMatchReplacement(roundId, match.id, replacementKey, (currentReplacement) => {
      if (currentReplacement?.requested) {
        return canEditFixture ? null : currentReplacement;
      }

      return {
        requested: true,
        titular: normalizeReplacementPlayer(player, player.type || "league"),
        replacement: null,
        requestedBy: getUserId(userData),
        requestedByName: userData?.name || player?.nombre || "Jugador",
        requestedAtMillis: Date.now(),
        penaltySnapshot: league?.scoringSettings?.replacementPenalty ?? null,
        penaltyModeSnapshot: league?.scoringSettings?.replacementPenaltyMode || "individual",
        quotaSnapshot: league?.scoringSettings?.replacementQuota ?? null,
      };
    });
  };

  const loadReplacementPlayers = async () => {
    try {
      setReplacementLoading(true);
      const players = await listPlayers();
      setReplacementPlayers(players);
    } catch (error) {
      showFeedback(
        "No pudimos cargar jugadores",
        "Intenta nuevamente en unos instantes o crea un jugador manual.",
        "danger"
      );
    } finally {
      setReplacementLoading(false);
    }
  };

  const handleOpenReplacementPicker = ({ roundId, matchId, replacementKey }) => {
    expandRound(roundId);
    setReplacementTarget({ roundId, matchId, replacementKey });
    setReplacementQuery("");
    setReplacementGuestNombre("");
    setReplacementGuestApellido("");
    setReplacementPickerVisible(true);

    if (!replacementPlayers.length) {
      loadReplacementPlayers();
    }
  };

  const handleCloseReplacementPicker = () => {
    setReplacementPickerVisible(false);
    setReplacementTarget(null);
    setReplacementQuery("");
    setReplacementGuestNombre("");
    setReplacementGuestApellido("");
  };

  const handleAssignReplacement = (player, type = "registered") => {
    if (!replacementTarget) {
      return;
    }

    const replacement = normalizeReplacementPlayer(player, type);
    const shouldNotifyConfirmedReplacement = Boolean(getReplacementPlayerKey(replacement));

    updateMatchReplacement(
      replacementTarget.roundId,
      replacementTarget.matchId,
      replacementTarget.replacementKey,
      (currentReplacement) => ({
        ...(currentReplacement || {}),
        requested: true,
        replacement,
        confirmedNoticePending: shouldNotifyConfirmedReplacement,
        penaltySnapshot:
          currentReplacement?.penaltySnapshot ?? league?.scoringSettings?.replacementPenalty ?? null,
        penaltyModeSnapshot:
          currentReplacement?.penaltyModeSnapshot ||
          league?.scoringSettings?.replacementPenaltyMode ||
          "individual",
        quotaSnapshot:
          currentReplacement?.quotaSnapshot ?? league?.scoringSettings?.replacementQuota ?? null,
      })
    );
    handleCloseReplacementPicker();
  };

  const handleRemoveAssignedReplacement = () => {
    if (!replacementPendingRemoval) {
      return;
    }

    updateMatchReplacement(
      replacementPendingRemoval.roundId,
      replacementPendingRemoval.matchId,
      replacementPendingRemoval.replacementKey,
      () => null
    );
    setReplacementPendingRemoval(null);
    showFeedback(
      "Pedido de remplazo cancelado",
      "Guarda los cambios para quitarlo de Remplazos y del resumen de ligas.",
      "success"
    );
  };

  const openTableReplacementMenu = (round, match) => {
    setTableReplacementMenuTarget({
      matchId: match.id,
      roundId: round.id,
    });
  };

  const closeTableReplacementMenu = () => {
    setTableReplacementMenuTarget(null);
  };

  const toggleTableReplacementRequest = (payload) => {
    handleToggleReplacementRequest(payload);
    closeTableReplacementMenu();
  };

  const cancelTablePlayerReplacementRequest = (target = null) => {
    closeTableReplacementMenu();
    handleCancelPlayerReplacementRequest(target);
  };

  const openTableReplacementPicker = ({ matchId, replacementKey, roundId }) => {
    closeTableReplacementMenu();
    handleOpenReplacementPicker({ matchId, replacementKey, roundId });
  };

  const removeTableReplacement = ({ matchId, playerName, replacementKey, roundId }) => {
    closeTableReplacementMenu();
    setReplacementPendingRemoval({
      matchId,
      playerName,
      replacementKey,
      roundId,
    });
  };

  const openTableMatchSuspensionFlow = () => {
    const match = tableReplacementMenuMatch?.match;
    const round = tableReplacementMenuMatch?.round;

    if (!canEditFixture || !match || !round || isMatchCompleted(match)) {
      return;
    }

    closeTableReplacementMenu();
    setRoundSuspensionTarget(round);
    setSuspensionFlowStarted(true);
    setSuspensionScope(SUSPENSION_SCOPES.SELECTED_MATCHES);
    setSelectedSuspendedMatchIds([match.id]);
    setSelectedSuspensionReason(match.suspensionReason || "");
  };

  const openTableRetakeSuspendedRound = () => {
    const round = tableReplacementMenuMatch?.round;

    if (!round?.id) {
      return;
    }

    closeTableReplacementMenu();
    openRetakeSuspendedRound(round);
  };

  const shouldClearWholeRoundSuspension = (round = {}) => {
    const hasRoundLevelData = Boolean(
      round?.suspensionMode ||
        round?.suspendedAtMillis ||
        round?.suspensionReason ||
        round?.rescheduledDateMillis
    );
    const suspendedMatchesCount = (round?.matches || []).filter((currentMatch) =>
      hasRoundSuspensionData({ matches: [currentMatch] })
    ).length;

    return hasRoundLevelData || suspendedMatchesCount > 1;
  };

  const clearTableMatchSuspension = () => {
    const match = tableReplacementMenuMatch?.match;
    const round = tableReplacementMenuMatch?.round;
    const shouldClearWholeRound = shouldClearWholeRoundSuspension(round);
    const hasMatchSuspensionData = hasRoundSuspensionData({ matches: [match] });

    if (!canEditFixture || !match?.id || !round?.id || (!hasMatchSuspensionData && !shouldClearWholeRound)) {
      return;
    }

    setFixtureDraft((current) => ({
      ...current,
      rounds: (current.rounds || []).map((currentRound) => {
        if (currentRound.id !== round.id) {
          return currentRound;
        }

        if (shouldClearWholeRound) {
          return clearRoundSuspensionData(currentRound);
        }

        const nextMatches = (currentRound.matches || []).map((currentMatch) =>
          currentMatch.id === match.id ? clearMatchSuspensionData(currentMatch) : currentMatch
        );
        const hasOtherSuspensions = nextMatches.some((currentMatch) => currentMatch.suspensionMode);

        return {
          ...currentRound,
          ...(!hasOtherSuspensions
            ? {
                suspendedAtMillis: 0,
                suspensionReason: "",
                suspensionMode: "",
                rescheduledDateMillis: 0,
              }
            : {}),
          matches: nextMatches,
        };
      }),
    }));
    closeTableReplacementMenu();
    showFeedback(
      "Suspension quitada",
      shouldClearWholeRound
        ? "Se quito la suspension de toda la fecha. Presiona GUARDAR CAMBIOS para confirmarlo."
        : "Se quito la suspension de este partido. Presiona GUARDAR CAMBIOS para confirmarlo.",
      "success"
    );
  };

  const handleCreateReplacementPlayer = () => {
    const nombre = replacementGuestNombre.trim();
    const apellido = replacementGuestApellido.trim();

    if (!nombre || !apellido) {
      showFeedback(
        "Faltan datos",
        "Completa nombre y apellido para crear el reemplazante manual.",
        "danger"
      );
      return;
    }

    handleAssignReplacement(
      {
        id: `fixture-guest-replacement-${Date.now()}`,
        nombre,
        apellido,
        categoria: league?.categoria || "",
        sexo: league?.sexo || "",
      },
      "guest"
    );
  };

  const updateMatchWinner = (roundId, matchId, winner) => {
    expandRound(roundId);
    setFixtureDraft((current) =>
      buildNextFixture(current, roundId, matchId, (match) => {
        const nextMatch = clearMatchSuspensionData(match);

        return {
          ...nextMatch,
          completedAtMillis: nextMatch.completedAtMillis || Date.now(),
          result: {
            ...nextMatch.result,
            winner,
          },
        };
      })
    );
  };

  const clearMatchResult = (roundId, matchId) => {
    expandRound(roundId);
    setFixtureDraft((current) =>
      buildNextFixture(current, roundId, matchId, (match) => ({
        ...match,
        result: {
          ...match.result,
          winner: "",
          score: "",
          sets: [],
        },
        completedAtMillis: 0,
      }))
    );
  };

  const openLeagueResultEditor = (round, match) => {
    if (!canEditFixture) {
      return;
    }

    const teamALabel =
      match.teamA?.label || buildTeamLabelFromPlayers(match.teamA?.players || []) || "Pareja A";
    const teamBLabel =
      match.teamB?.label || buildTeamLabelFromPlayers(match.teamB?.players || []) || "Pareja B";

    setLeagueResultEditor({
      matchId: match.id,
      participants: [
        { id: "teamA", label: teamALabel },
        { id: "teamB", label: teamBLabel },
      ],
      roundId: round.id,
      sets: getMatchResultSets(match, league?.matchFormat),
      winner: String(match.result?.winner || ""),
    });
  };

  const closeLeagueResultEditor = () => {
    setLeagueResultEditor(null);
  };

  const updateLeagueResultEditorSet = (setIndex, value) => {
    let shouldFocusNext = false;
    let nextFocusIndex = setIndex + 1;

    setLeagueResultEditor((current) => {
      if (!current) {
        return current;
      }

      const currentSetLabel = current.sets?.[setIndex]?.label || "";
      const digitsLength = String(value || "").replace(/\D/g, "").length;
      const expectedDigits = currentSetLabel === "STB" ? 4 : 2;
      shouldFocusNext = digitsLength >= expectedDigits && setIndex < (current.sets?.length || 0) - 1;

      return {
        ...current,
        sets: current.sets.map((set, index) =>
          index === setIndex
            ? {
                ...set,
                ...parseCompactLeagueSetInput(value, set.label),
              }
            : set
        ),
      };
    });

    if (shouldFocusNext) {
      requestAnimationFrame(() => {
        leagueResultSetInputRefs.current[`set-${nextFocusIndex}`]?.focus?.();
      });
    }
  };

  const saveLeagueResultEditor = () => {
    if (!leagueResultEditor?.roundId || !leagueResultEditor?.matchId) {
      closeLeagueResultEditor();
      return;
    }

    const sets = leagueResultEditor.sets || [];
    const hasScore = sets.some((set) => hasSetData(set));
    const requiredSetsCount = league?.matchFormat === "single_set" ? 1 : 2;
    const requiredSetsAreComplete = sets
      .slice(0, requiredSetsCount)
      .every((set) => Boolean(set.own && set.rival && set.own !== set.rival));
    const optionalSetsAreComplete = sets
      .slice(requiredSetsCount)
      .every((set) => !hasSetData(set) || Boolean(set.own && set.rival && set.own !== set.rival));

    if ((hasScore || leagueResultEditor.winner) && !leagueResultEditor.winner) {
      showFeedback(
        "Falta seleccionar ganador",
        "Para guardar un resultado cargado, selecciona la pareja ganadora.",
        "danger"
      );
      return;
    }

    if ((hasScore || leagueResultEditor.winner) && (!requiredSetsAreComplete || !optionalSetsAreComplete)) {
      showFeedback(
        "Resultado incompleto",
        league?.matchFormat === "single_set"
          ? "Completa el resultado del set antes de guardar."
          : "SET 1 y SET 2 deben tener ganador. Si cargas el tercer set, tambien debe tener ganador.",
        "danger"
      );
      return;
    }

    setFixtureDraft((current) =>
      buildNextFixture(current, leagueResultEditor.roundId, leagueResultEditor.matchId, (match) => {
        const nextMatch = leagueResultEditor.winner ? clearMatchSuspensionData(match) : match;

        return {
          ...nextMatch,
          completedAtMillis: leagueResultEditor.winner
            ? nextMatch.completedAtMillis || Date.now()
            : 0,
          result: {
            ...nextMatch.result,
            score: buildScoreSummary(sets),
            sets,
            winner: leagueResultEditor.winner,
          },
        };
      })
    );
    closeLeagueResultEditor();
  };

  const buildOwnReplacementRequest = (player, currentReplacement = {}) => ({
    ...(currentReplacement || {}),
    requested: true,
    titular: currentReplacement?.titular || normalizeReplacementPlayer(player, player.type || "league"),
    replacement: currentReplacement?.replacement || null,
    requestedBy: getUserId(userData),
    requestedByName: userData?.name || player?.nombre || "Jugador",
    requestedAtMillis: currentReplacement?.requestedAtMillis || Date.now(),
    penaltySnapshot:
      currentReplacement?.penaltySnapshot ?? league?.scoringSettings?.replacementPenalty ?? null,
    penaltyModeSnapshot:
      currentReplacement?.penaltyModeSnapshot ||
      league?.scoringSettings?.replacementPenaltyMode ||
      "individual",
    quotaSnapshot:
      currentReplacement?.quotaSnapshot ?? league?.scoringSettings?.replacementQuota ?? null,
  });

  const handlePlayerReplacementRequest = async (targetOverride = null) => {
    const target = targetOverride || nextReplacementTarget;

    if (!league || !target) {
      showFeedback(
        "Sin fecha disponible",
        "No encontramos una proxima fecha pendiente para pedir remplazo.",
        "danger"
      );
      return;
    }

    if (!targetOverride && hasOwnReplacementRequest) {
      showFeedback(
        hasOwnReplacementDesignated ? "Remplazo designado" : "Remplazo solicitado",
        hasOwnReplacementDesignated
          ? "El organizador ya designo tu remplazo para esta fecha."
          : "Tu solicitud ya fue enviada y esta esperando confirmacion.",
        "success"
      );
      return;
    }

    const nextFixture = buildNextFixture(
      fixtureDraft,
      target.roundId,
      target.match.id,
      (match) => {
        const currentReplacement = match.replacements?.[target.replacementKey] || {};

        return {
          ...match,
          replacements: {
            ...(match.replacements || {}),
            [target.replacementKey]: buildOwnReplacementRequest(
              target.player,
              currentReplacement
            ),
          },
        };
      }
    );

    try {
      setSavingMatchId("saving");
      await updateLeagueFixture(league.id, nextFixture);
      await notifyLeagueSuspensionAsync(league, nextFixture);
      setLeague((current) => ({
        ...current,
        fixture: nextFixture,
      }));
      setFixtureDraft(nextFixture);
      expandRound(target.roundId);
      showFeedback(
        "Solicitud de remplazo",
        `Solicitud de remplazo para ${target.roundTitle || "esta fecha"}.`,
        "success"
      );
    } catch (error) {
      showFeedback(
        "No pudimos pedir remplazo",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setSavingMatchId("");
    }
  };

  const handleCancelPlayerReplacementRequest = async (targetOverride = null) => {
    const target = targetOverride || nextReplacementTarget;
    const targetReplacementEntry = target?.replacementEntry || null;
    const targetHasRequest = Boolean(targetReplacementEntry?.requested);
    const targetHasAssignedReplacement = Boolean(targetReplacementEntry?.replacement);

    if (!league || !target || !targetHasRequest || targetHasAssignedReplacement) {
      return;
    }

    const nextFixture = buildNextFixture(
      fixtureDraft,
      target.roundId,
      target.match.id,
      (match) => {
        const nextReplacements = {
          ...(match.replacements || {}),
        };

        delete nextReplacements[target.replacementKey];

        return {
          ...match,
          replacements: nextReplacements,
        };
      }
    );

    try {
      setSavingMatchId("saving");
      await updateLeagueFixture(league.id, nextFixture);
      setLeague((current) => ({
        ...current,
        fixture: nextFixture,
      }));
      setFixtureDraft(nextFixture);
      expandRound(target.roundId);
      showFeedback(
        "Solicitud cancelada",
        `Cancelaste el pedido de remplazo para ${target.roundTitle || "esta fecha"}.`,
        "success"
      );
    } catch (error) {
      showFeedback(
        "No pudimos cancelar el remplazo",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setSavingMatchId("");
    }
  };

  const handleSaveMatch = async () => {
    if (!league) {
      return;
    }

    const hasFixtureUnassignedReplacement = fixtureRounds.some((round) =>
      (round.matches || []).some((match) => hasUnassignedReplacement(match))
    );

    if (canEditFixture) {
      const matchWithoutWinner = fixtureRounds
        .flatMap((round) =>
          round.matches.map((match) => ({
            roundTitle: round.title,
            match,
          }))
        )
        .find(({ match }) => {
          const sets = getMatchResultSets(match, league?.matchFormat);
          const hasFirstSet = hasSetData(sets[0]);
          const hasSecondSet = hasSetData(sets[1]);

          return hasFirstSet && hasSecondSet && !match.result?.winner;
        });

      if (matchWithoutWinner) {
        showFeedback(
          "Falta marcar ganador",
          `${matchWithoutWinner.roundTitle}: si cargas datos en set 1 y set 2, debes marcar la pareja ganadora antes de guardar.`,
          "danger"
        );
        return;
      }

      const winnerWithoutRequiredSets = fixtureRounds
        .flatMap((round) =>
          round.matches.map((match) => ({
            roundTitle: round.title,
            match,
          }))
        )
        .find(({ match }) =>
          match?.result?.winner && !hasRequiredResultSets(match, league?.matchFormat)
        );

      if (winnerWithoutRequiredSets) {
        const requiredText = league?.matchFormat === "single_set" ? "set 1" : "set 1 y set 2";

        showFeedback(
          "Faltan cargar los resultados",
          `${winnerWithoutRequiredSets.roundTitle}: si marcas ganador, debes cargar al menos ${requiredText}.`,
          "danger"
        );
        return;
      }
    }

    const nextFixture = {
      ...fixtureDraft,
      rounds: fixtureRounds.map((round) => {
        const nextMatches = (round.matches || []).map((match) =>
          isMatchCompleted(match)
            ? {
                ...clearMatchSuspensionData(match),
                completedAtMillis: match.completedAtMillis || Date.now(),
              }
            : {
                ...match,
                completedAtMillis: 0,
              }
        );
        const roundIsComplete = nextMatches.length
          ? nextMatches.every((match) => isMatchCompleted(match))
          : false;
        const hasSuspendedPendingMatches = nextMatches.some(
          (match) => !isMatchCompleted(match) && match.suspensionMode
        );

        return {
          ...round,
          ...(!hasSuspendedPendingMatches && round.suspensionMode
            ? {
                suspendedAtMillis: 0,
                suspensionReason: "",
                suspensionMode: "",
                rescheduledDateMillis: 0,
              }
            : {}),
          completedAtMillis: roundIsComplete
            ? getRoundCompletedAtMillis(round) || Date.now()
            : 0,
          matches: nextMatches,
        };
      }),
    };
    const hasNewAssignedReplacement =
      getFixtureReplacementSignature(league.fixture || {}) !==
      getFixtureReplacementSignature(nextFixture);
    const hasReplacementRequestChange =
      getFixtureReplacementRequestSignature(league.fixture || {}) !==
      getFixtureReplacementRequestSignature(nextFixture);
    const didResultDataChange = hasResultDataChanged(league.fixture || {}, nextFixture);
    const didAssignNewWinner = hasNewWinnerAssigned(league.fixture || {}, nextFixture);
    const didSuspensionDataChange = hasSuspensionDataChanged(league.fixture || {}, nextFixture);
    const replacementConfirmationNotices = collectReplacementConfirmationNotices(nextFixture, league);
    const fixtureToSave = replacementConfirmationNotices.length
      ? clearReplacementConfirmationNoticeFlags(nextFixture)
      : nextFixture;

    try {
      setSavingMatchId("saving");
      await updateLeagueFixture(league.id, fixtureToSave);
      let suspensionShareMessages = [];
      if (canEditFixture) {
        suspensionShareMessages = await notifyLeagueSuspensionAsync(league, fixtureToSave);
      }
      if (replacementConfirmationNotices.length) {
        await Promise.allSettled(
          replacementConfirmationNotices.map((notice) =>
            sendChatMessage({
              currentUserId: getUserId(userData),
              currentUserName: userData?.name || "Organizador",
              otherUserId: notice.recipientId,
              otherUserName: notice.recipientName,
              text: notice.text,
            })
          )
        );
      }
      setLeague((current) => ({
        ...current,
        fixture: fixtureToSave,
      }));
      setFixtureDraft(fixtureToSave);
      setExpandedRoundIds((currentRoundIds) => {
        const nextRoundIds = new Set((fixtureToSave.rounds || []).map((round) => round.id));
        const validRoundIds = currentRoundIds.filter((roundId) => nextRoundIds.has(roundId));
        const currentRoundId = resolveCurrentRoundId(fixtureToSave.rounds || []);

        if (fixtureVisibilityMode === "current") {
          return [currentRoundId].filter(Boolean);
        }

        return validRoundIds.length || !currentRoundId ? validRoundIds : [currentRoundId];
      });
      if (!canEditFixture && hasReplacementRequestChange) {
        showFeedback(
          "Solicitud enviada",
          "El organizador ya puede ver que pediste remplazo.",
          "success"
        );
      } else if (hasFixtureUnassignedReplacement) {
        showFeedback("Atencion", "Remplazo no Asignado", "warning");
      } else if (hasNewAssignedReplacement) {
        showFeedback("Remplazo Realizado Correctamente", "Los cambios quedaron guardados.", "success");
      } else if (didResultDataChange) {
        if (canEditFixture && didAssignNewWinner) {
          setGoToPaymentsPromptVisible(true);
        } else {
          showFeedback("Resultado guardado", "Tabla de puntajes actualizada", "success");
        }
      } else if (didSuspensionDataChange) {
        showFeedback(
          "Suspension actualizada",
          "Los cambios de suspension quedaron guardados.",
          "success"
        );
      } else {
        showFeedback("Cambios guardados", "Los cambios quedaron guardados.", "success");
      }
      promptWhatsAppShare(suspensionShareMessages);
    } catch (error) {
      showFeedback(
        "No pudimos guardar el resultado",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setSavingMatchId("");
    }
  };

  const closeFeedback = () => {
    const shouldAskPayments = feedback.askPaymentsAfterClose;

    setFeedback({
      visible: false,
      title: "",
      message: "",
      tone: "default",
      askPaymentsAfterClose: false,
    });

    if (shouldAskPayments) {
      setGoToPaymentsPromptVisible(true);
    }
  };

  const handleGoToPayments = () => {
    setGoToPaymentsPromptVisible(false);
    navigation.navigate("LeaguePayments", {
      leagueId: league?.id || leagueId,
      leagueName: league?.nombre || fallbackLeagueName,
    });
  };

  const handleDeleteFixture = async () => {
    if (!league) {
      return;
    }

    try {
      setSavingMatchId("deleting");
      const emptyFixture = { generatedAtMillis: 0, rounds: [] };
      await updateLeagueFixture(league.id, emptyFixture);
      setLeague((current) => ({
        ...current,
        fixture: emptyFixture,
      }));
      setFixtureDraft(emptyFixture);
      setExpandedRoundIds([]);
      showFeedback("Fixture eliminado", "Se borraron todas las fechas y resultados de esta liga.", "success");
    } catch (error) {
      showFeedback(
        "No pudimos eliminar el fixture",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setSavingMatchId("");
    }
  };

  const renderFixturePlayer = ({ player, playerIndex, teamKey, match, roundId }) => {
    const replacementKey = getPlayerReplacementKey(teamKey, player, playerIndex);
    const replacementEntry = match.replacements?.[replacementKey];
    const hasReplacementRequest = Boolean(replacementEntry?.requested);
    const replacementPlayer = replacementEntry?.replacement;
    const isFocusedReplacement =
      roundId === focusRoundId &&
      match.id === focusMatchId &&
      replacementKey === focusReplacementKey;
    const canRequestThisReplacement =
      (canEditFixture || (canRequestOwnReplacement && isCurrentUserFixturePlayer(player))) &&
      !match.result?.winner &&
      !hasMatchResultData(match);
    const canAssignReplacement = canEditFixture && !match.result?.winner && !hasMatchResultData(match);

    return (
      <View
        key={`${teamKey}-${replacementKey}-${playerIndex}`}
        style={[
          styles.fixturePlayerWrap,
          isFocusedReplacement ? styles.fixturePlayerWrapFocused : null,
        ]}
      >
        <View style={styles.fixturePlayerNameRow}>
          <Text
            numberOfLines={1}
            style={[
              styles.teamPlayerName,
              hasReplacementRequest ? styles.teamPlayerNameReplacementRequested : null,
              replacementPlayer ? styles.teamPlayerNameReplaced : null,
            ]}
          >
            {formatPlayerShortName(player)}
          </Text>
          {canRequestThisReplacement ? (
            <Pressable
              hitSlop={8}
              onPress={(event) => {
                event.stopPropagation?.();
                handleToggleReplacementRequest({
                  roundId,
                  match,
                  teamKey,
                  player,
                  playerIndex,
                });
              }}
              style={({ pressed }) => [
                styles.replacementToggleButton,
                hasReplacementRequest ? styles.replacementToggleButtonActive : null,
                pressed ? styles.generateButtonPressed : null,
              ]}
            >
              <Ionicons
                color={hasReplacementRequest ? colors.surface : colors.primaryDark}
                name="swap-horizontal-outline"
                size={13}
              />
            </Pressable>
          ) : null}
        </View>

        {hasReplacementRequest ? (
          <Pressable
            disabled={!canAssignReplacement && !replacementPlayer}
            onPress={(event) => {
              event.stopPropagation?.();
              if (replacementPlayer || !canAssignReplacement) {
                return;
              }

              handleOpenReplacementPicker({
                roundId,
                matchId: match.id,
                replacementKey,
              });
            }}
            style={({ pressed }) => [
              styles.replacementField,
              replacementPlayer ? styles.replacementFieldFilled : null,
              pressed && canAssignReplacement ? styles.generateButtonPressed : null,
            ]}
          >
            {!replacementPlayer ? (
              <Ionicons color={colors.primaryDark} name="people-outline" size={13} />
            ) : null}
            <Text
              numberOfLines={1}
              style={[
                styles.replacementFieldText,
                replacementPlayer ? styles.replacementFieldTextFilled : null,
              ]}
            >
              {replacementPlayer
                ? formatPlayerShortName(replacementPlayer)
                : canAssignReplacement
                ? "Agregar reemplazo"
                : "Remplazo solicitado"}
            </Text>
            {replacementPlayer && canEditFixture ? (
              <Pressable
                hitSlop={8}
                onPress={(event) => {
                  event.stopPropagation?.();
                  setReplacementPendingRemoval({
                    roundId,
                    matchId: match.id,
                    replacementKey,
                    playerName: formatPlayerShortName(replacementPlayer),
                  });
                }}
                style={({ pressed }) => [
                  styles.replacementRemoveButton,
                  pressed ? styles.generateButtonPressed : null,
                ]}
              >
                <Ionicons color="#A44747" name="close" size={12} />
              </Pressable>
            ) : null}
          </Pressable>
        ) : null}
      </View>
    );
  };

  const renderMigrationTableTeam = ({ team, teamKey, match, roundId }) => {
    const isWinner = match?.result?.winner === teamKey;

    if (!(team?.players || []).length) {
      return (
        <View style={styles.leagueMigrationTeamRow}>
          <View style={styles.leagueMigrationWinnerIconSlot}>
            {isWinner ? (
              <Ionicons
                color="#36D66B"
                name="thumbs-up"
                size={11}
                style={styles.leagueMigrationWinnerIcon}
              />
            ) : null}
          </View>
          <Text numberOfLines={2} style={styles.leagueMigrationPairText}>
            {team?.label || "Pareja"}
          </Text>
        </View>
      );
    }

    const playerEntries = (team.players || []).map((player, playerIndex) => {
      const replacementKey = getPlayerReplacementKey(teamKey, player, playerIndex);
      const replacementEntry = match.replacements?.[replacementKey];
      return {
        hasReplacementRequest: Boolean(replacementEntry?.requested),
        player,
        replacementPlayer: replacementEntry?.replacement || null,
      };
    });
    return (
      <View style={styles.leagueMigrationTeamRowTopAligned}>
        <View style={styles.leagueMigrationWinnerIconSlot}>
          {isWinner ? (
            <Ionicons
              color="#36D66B"
              name="thumbs-up"
              size={11}
              style={styles.leagueMigrationWinnerIcon}
            />
          ) : null}
        </View>
        <View style={styles.leagueMigrationCompactTeamWrap}>
          {playerEntries.map((entry, playerIndex) => (
            <Fragment key={`migration-${match.id}-${teamKey}-${playerIndex}`}>
              {playerIndex > 0 ? <Text style={styles.leagueMigrationPairSeparator}>/</Text> : null}
              <View style={styles.leagueMigrationPlayerSlot}>
                <View style={styles.leagueMigrationPlayerStatusRow}>
                  {playerIndex === 0 && entry.hasReplacementRequest ? (
                    <Ionicons
                      color={entry.replacementPlayer ? "#247653" : "#D47713"}
                      name="swap-horizontal-outline"
                      size={11}
                    />
                  ) : null}
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.leagueMigrationPairText,
                      entry.replacementPlayer ? styles.leagueMigrationPlayerReplaced : null,
                      entry.hasReplacementRequest && !entry.replacementPlayer
                        ? styles.leagueMigrationPlayerRequested
                        : null,
                    ]}
                  >
                    {formatPlayerShortName(entry.player)}
                  </Text>
                  {playerIndex > 0 && entry.hasReplacementRequest ? (
                    <Ionicons
                      color={entry.replacementPlayer ? "#247653" : "#D47713"}
                      name="swap-horizontal-outline"
                      size={11}
                    />
                  ) : null}
                </View>
                {entry.replacementPlayer ? (
                  <Text numberOfLines={1} style={styles.leagueMigrationReplacementPlayerText}>
                    {formatPlayerShortName(entry.replacementPlayer)}
                  </Text>
                ) : (
                  <Text style={styles.leagueMigrationReplacementPlaceholder}> </Text>
                )}
              </View>
            </Fragment>
          ))}
        </View>
      </View>
    );
  };

  const pendingSuspensionMatches = getPendingMatchesForRound(roundSuspensionTarget);
  const roundHasSuspensionData = hasRoundSuspensionData(roundSuspensionTarget);
  const canChooseSuspensionReason =
    suspensionScope &&
    (suspensionScope !== SUSPENSION_SCOPES.SELECTED_MATCHES || selectedSuspendedMatchIds.length > 0);
  const canApplySuspension = Boolean(selectedSuspensionReason && canChooseSuspensionReason);

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <SectionHeader onBack={() => navigation.goBack()} subtitle="Fixture" />
        <View style={styles.loaderWrap}>
          <ActivityIndicator color={colors.primaryDark} />
          <Text style={styles.loaderText}>Cargando fixture...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader onBack={() => navigation.goBack()} subtitle="Fixture" />
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />

      <ScrollView
        contentContainerStyle={styles.content}
        ref={fixtureScrollRef}
        showsVerticalScrollIndicator={false}
      >
        <LeagueHeaderCard
          category={league?.categoria}
          complexName={league?.complejoNombre}
          league={league}
          organizerLogoUrl={league?.organizerLogoUrl || userData?.organizerLogoUrl || ""}
          sex={league?.sexo}
          title={leagueName}
          teamType={league?.teamType}
        >
          {canEditFixture ? <Text style={styles.heroMeta}>
            Fechas configuradas: {league?.fixtureConfig?.roundsCount || 0}
            {league?.fixtureConfig?.roundMode === "double" ? " · Ida y vuelta" : " · Ida"}
            {league?.fixtureConfig?.visibilityMode === "current"
              ? " · Jugadores ven proxima pendiente"
              : ""}
          </Text> : null}
        </LeagueHeaderCard>

        {league?.teamType === "pair" && leaguePlayers.length ? (
          <View style={[styles.roundCard, styles.pairsOverviewCard]}>
            <Pressable
              onPress={() => setPairsOverviewExpanded((current) => !current)}
              style={({ pressed }) => [
                styles.pairsOverviewHeader,
                pressed ? styles.generateButtonPressed : null,
              ]}
            >
              <View style={styles.pairsOverviewCopy}>
                <Text style={styles.pairsOverviewTitle}>PAREJAS DE LA LIGA</Text>
                <Text style={styles.pairsOverviewCount}>
                  {visiblePairingTeams.length
                    ? `${visiblePairingTeams.length} parejas armadas`
                    : "Arma manualmente las parejas antes del fixture"}
                </Text>
              </View>
              <Ionicons
                color={colors.primaryDark}
                name={pairsOverviewExpanded ? "chevron-up" : "chevron-down"}
                size={18}
              />
            </Pressable>

            {pairsOverviewExpanded ? (
              <>
            {visiblePairingTeams.length ? (
              <View style={styles.pairsCompactList}>
                {visiblePairingTeams.map((team, index) => (
                  <View
                    key={team.id}
                    style={[
                      styles.manualTeamRow,
                      index === visiblePairingTeams.length - 1 ? styles.manualTeamRowLast : null,
                    ]}
                  >
                    <Text numberOfLines={1} style={styles.manualTeamPlayers}>
                      {formatTeamShortLabel(team.players || [], team.label)}
                    </Text>
                    {canEditFixture && !hasPlayerPairTeams ? (
                      <Pressable
                        onPress={() => handleRemovePair(team.id)}
                        style={({ pressed }) => [
                          styles.removePairButton,
                          pressed ? styles.generateButtonPressed : null,
                        ]}
                      >
                        <Ionicons color="#9F3E3E" name="close-outline" size={18} />
                      </Pressable>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.emptyText}>
                Todavia no definiste parejas manuales para esta liga.
              </Text>
            )}

            {hasPlayerPairTeams ? (
              <Text style={styles.helperText}>
                Podes editarla en Jugadores de la liga.
              </Text>
            ) : null}

            {canEditFixture && !hasPlayerPairTeams ? (
              <>
                <View style={styles.unassignedHeader}>
                  <Text style={styles.unassignedTitle}>Jugadores sin pareja</Text>
                  {unassignedPlayers.length >= 2 ? (
                    <Pressable
                      onPress={handleAutoPair}
                      style={({ pressed }) => [
                        styles.inlineActionButton,
                        pressed ? styles.generateButtonPressed : null,
                      ]}
                    >
                      <Text style={styles.inlineActionText}>Autocompletar</Text>
                    </Pressable>
                  ) : null}
                </View>

                <View style={styles.playerSelectionWrap}>
                  {unassignedPlayers.length ? (
                    unassignedPlayers.map((player) => {
                      const playerKey = player.id || player.linkedUserId;

                      return (
                        <Pressable
                          key={playerKey}
                          onPress={() => handlePairPlayerPress(player)}
                          style={({ pressed }) => [
                            styles.playerChip,
                            selectedPlayerId === playerKey ? styles.playerChipActive : null,
                            pressed ? styles.generateButtonPressed : null,
                          ]}
                        >
                          <Text
                            style={[
                              styles.playerChipText,
                              selectedPlayerId === playerKey ? styles.playerChipTextActive : null,
                            ]}
                          >
                            {formatPlayerShortName(player)}
                          </Text>
                        </Pressable>
                      );
                    })
                  ) : (
                    <Text style={styles.emptyText}>
                      Todas las personas de la liga ya quedaron dentro de una pareja.
                    </Text>
                  )}
                </View>

                <Text style={styles.helperText}>
                  Toca un jugador y luego su companero para formar una pareja.
                </Text>

                <View style={styles.manualTeamsActionsRow}>
                  <Pressable
                    disabled={savingPairs}
                    onPress={handleClearPairs}
                    style={({ pressed }) => [
                      styles.secondaryActionButton,
                      pressed ? styles.generateButtonPressed : null,
                    ]}
                  >
                    <Text style={styles.secondaryActionText}>Limpiar parejas</Text>
                  </Pressable>
                  <Pressable
                    disabled={savingPairs}
                    onPress={handleSavePairs}
                    style={({ pressed }) => [
                      styles.primaryActionButton,
                      pressed ? styles.generateButtonPressed : null,
                    ]}
                  >
                    <Text style={styles.primaryActionText}>
                      {savingPairs ? "Guardando..." : "Guardar parejas"}
                    </Text>
                  </Pressable>
                </View>
              </>
            ) : null}
              </>
            ) : null}
          </View>
        ) : null}

        {!fixtureValidation.valid ? (
          <View style={styles.warningCard}>
            <Ionicons color="#B04343" name="alert-circle-outline" size={18} />
            <Text style={styles.warningText}>{fixtureValidation.message}</Text>
          </View>
        ) : null}

        {canEditFixture && !hasFixture ? (
          <Pressable
            onPress={handleGenerateFixturePress}
            style={({ pressed }) => [
              styles.generateButton,
              pressed ? styles.generateButtonPressed : null,
            ]}
          >
            <Ionicons color={colors.surface} name="calendar-outline" size={18} />
            <Text style={styles.generateButtonText}>
              {generating ? "Generando fixture..." : hasFixture ? "Regenerar fixture" : "Generar fixture"}
            </Text>
          </Pressable>
        ) : null}

        {!hasFixture ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Todavia no hay fechas armadas</Text>
            <Text style={styles.emptyText}>
              Cuando generes el fixture vas a poder cargar resultados desde aca y ver la tabla en
              Puntajes.
            </Text>
          </View>
        ) : null}

        {canEditFixture && hasUnsavedFixtureChanges ? (
          <View style={styles.unsavedChangesBanner}>
            <Ionicons color="#7D4B00" name="save-outline" size={17} />
            <Text style={styles.unsavedChangesText}>
              Hay cambios sin guardar en el fixture. Revisa y toca GUARDAR CAMBIOS para confirmarlos.
            </Text>
          </View>
        ) : null}

        {visibleFixtureRounds.map((round, roundIndex) => {
          const historyRoundIsSuspended = round.suspensionMode === "suspended";
          const historyRoundShowsReprogrammedInfo =
            historyRoundIsSuspended &&
            !isSuspensionNoticeActive(round.suspendedAtMillis) &&
            Boolean(round.rescheduledDateMillis);

          return (
          <Fragment key={round.id}>
            {false && historyRoundShowsReprogrammedInfo ? (
              <View style={[styles.roundCard, styles.roundHistoryCard]}>
                <View style={styles.roundHistoryRow}>
                  <Text style={[styles.roundTitle, styles.roundHistoryPill]}>
                    {String(round.title || "").toUpperCase()}
                  </Text>
                  {round.scheduledDateMillis ? (
                    <Text style={[styles.roundDatePill, styles.roundHistoryPill]}>
                      {formatDateLabel(round.scheduledDateMillis)}
                    </Text>
                  ) : null}
                  <Text style={[styles.roundSuspendedInlinePill, styles.roundSuspendedHistoryPill]}>
                    SUSPENDIDA
                  </Text>
                </View>
              </View>
            ) : null}
          <View
            key={`${round.id}-fixture`}
            onLayout={(event) => {
              roundLayoutOffsetsRef.current[round.id] = event.nativeEvent.layout.y;

              if (round.id === focusRoundId) {
                setTimeout(scrollToFocusedRound, 120);
              }
            }}
            style={[
              styles.leagueMigrationRoundWrap,
              round.id === focusRoundId ? styles.leagueMigrationRoundWrapFocused : null,
            ]}
          >
            {false && (() => {
              const isRoundExpanded = expandedRoundIds.includes(round.id);
              const roundIsComplete = (round.matches || []).length
                ? round.matches.every((match) => isMatchCompleted(match))
                : false;
              const roundHasUnassignedReplacement = (round.matches || []).some((match) =>
                hasUnassignedReplacement(match)
              );
              const roundHasAssignedReplacement = (round.matches || []).some((match) =>
                hasAssignedReplacement(match)
              );
              const roundIsSuspended = round.suspensionMode === "suspended";
              const roundSuspensionIsActive =
                roundIsSuspended && isSuspensionNoticeActive(round.suspendedAtMillis);
              const roundIsReprogrammed = roundIsSuspended && !roundSuspensionIsActive;
              const roundShowsReprogrammedInfo =
                roundIsSuspended && roundIsReprogrammed && Boolean(round.rescheduledDateMillis);
              const roundDayTimeLabel = formatRoundDayTimeLabel(round);
              const roundDisplayDateMillis =
                roundShowsReprogrammedInfo && round.rescheduledDateMillis
                  ? round.rescheduledDateMillis
                  : round.scheduledDateMillis;
              const canShowPlayerReplacementOptions =
                !canEditFixture && nextReplacementTarget?.roundId === round.id;

              return (
            <Pressable
              onPress={() => toggleRoundExpansion(round.id)}
              style={({ pressed }) => [
                styles.roundToggleButton,
                pressed ? styles.generateButtonPressed : null,
              ]}
            >
              <View style={styles.roundChevronSpacer} />
              <View style={styles.roundHeader}>
                <View style={styles.roundTitleDateRow}>
                  <Text style={styles.roundTitle}>
                    {String(round.title || "").toUpperCase()}
                  </Text>
                  {roundDisplayDateMillis ? (
                    <Text style={styles.roundDatePill}>
                      {formatDateLabel(roundDisplayDateMillis)}
                    </Text>
                  ) : null}
                  {roundSuspensionIsActive ? (
                    <Text style={styles.roundSuspendedInlinePill}>
                      SUSPENDIDA
                    </Text>
                  ) : null}
                  {roundShowsReprogrammedInfo ? (
                    <Text style={[styles.roundRescheduledPill, styles.roundRescheduledPillReady]}>
                      REPROGRAMADA
                    </Text>
                  ) : null}
                  {roundIsSuspended && !roundShowsReprogrammedInfo ? (
                    <Text
                      style={[
                        styles.roundRescheduledPill,
                        roundIsReprogrammed ? styles.roundRescheduledPillReady : null,
                      ]}
                    >
                      {roundIsReprogrammed ? "Reprogramada activa" : "Reprogramada"}
                    </Text>
                  ) : null}
                  {roundIsSuspended && round.rescheduledDateMillis && !roundShowsReprogrammedInfo ? (
                    <Text style={styles.roundRescheduledDatePill}>
                      {formatDateLabel(round.rescheduledDateMillis)}
                    </Text>
                  ) : null}
                </View>
                {canEditFixture ? (
                  <Pressable
                    hitSlop={8}
                    onPress={(event) => openRoundSuspensionOptions(event, round)}
                    style={({ pressed }) => [
                      styles.roundOptionsButton,
                      styles.roundOptionsButtonFloating,
                      pressed ? styles.roundOptionsButtonPressed : null,
                    ]}
                  >
                    <Ionicons color={colors.primaryDark} name="ellipsis-vertical" size={18} />
                  </Pressable>
                ) : null}
                {canShowPlayerReplacementOptions ? (
                  <Pressable
                    hitSlop={8}
                    onPress={(event) => {
                      event?.stopPropagation?.();
                      setPlayerReplacementMenuVisible(true);
                    }}
                    style={({ pressed }) => [
                      styles.roundOptionsButton,
                      styles.roundOptionsButtonFloating,
                      pressed ? styles.roundOptionsButtonPressed : null,
                    ]}
                  >
                    <Ionicons color={colors.primaryDark} name="ellipsis-vertical" size={18} />
                  </Pressable>
                ) : null}
                <Text style={styles.roundSchedule}>
                  {roundShowsReprogrammedInfo ? roundDayTimeLabel || round.scheduleLabel : round.scheduleLabel}
                </Text>
                {roundHasUnassignedReplacement ? (
                  <View style={styles.roundReplacementWarning}>
                    <Ionicons color="#A05A00" name="alert-circle" size={14} />
                    <Text style={styles.roundReplacementWarningText}>REMPLAZO SOLICITADO</Text>
                  </View>
                ) : null}
                {!roundHasUnassignedReplacement && roundHasAssignedReplacement ? (
                  <View style={[styles.roundReplacementWarning, styles.roundReplacementDesignated]}>
                    <Ionicons color="#1E9E52" name="checkmark-circle" size={14} />
                    <Text
                      style={[
                        styles.roundReplacementWarningText,
                        styles.roundReplacementDesignatedText,
                      ]}
                    >
                      REMPLAZO DESIGNADO
                    </Text>
                  </View>
                ) : null}
                {roundIsComplete ? <Text style={styles.roundStatusTiny}>JUGADA</Text> : null}
              </View>
              <Ionicons
                color={colors.primaryDark}
                name={isRoundExpanded ? "chevron-up" : "chevron-down"}
                size={18}
              />
            </Pressable>
              );
            })()}

            {false && expandedRoundIds.includes(round.id) ? (
              <>
            {(() => {
              const sortedMatches = sortMatchesByTime(round.matches || []);
              const regularMatches = sortedMatches.filter((match) => !isPendingReprogrammedMatch(match));
              const reprogrammedMatches = sortedMatches.filter((match) => isPendingReprogrammedMatch(match));
              const displayedMatches = [...regularMatches, ...reprogrammedMatches];

              return displayedMatches.map((match, matchIndex) => {
                const startsReprogrammedSection =
                  reprogrammedMatches.length > 0 && matchIndex === regularMatches.length;
                const matchStatusMeta = getMatchStatusMeta(match);

                return (
                  <View key={match.id} style={styles.matchDisplayWrap}>
                    {startsReprogrammedSection ? (
                      <View style={styles.reprogrammedSectionHeader}>
                        <Ionicons color="#126236" name="calendar-outline" size={16} />
                        <View style={styles.reprogrammedSectionCopy}>
                          <Text style={styles.reprogrammedSectionTitle}>
                            Reprogramados de {round.title}
                          </Text>
                          <Text style={styles.reprogrammedSectionText}>
                            Solo juegan los partidos pendientes. Quienes ya jugaron quedan libres.
                          </Text>
                        </View>
                      </View>
                    ) : null}
                <View
                  style={[
                    styles.matchCard,
                    styles[`matchCardTone${(matchIndex % 4) + 1}`],
                  ]}
                >
                  <View style={styles.matchHeader}>
                    <View style={styles.matchTitleStatusWrap}>
                      <Text style={styles.matchTitle}>Partido {matchIndex + 1}</Text>
                      <Text
                        style={[
                          styles.matchStatusPill,
                          styles[`matchStatusPill${matchStatusMeta.styleKey}`],
                        ]}
                      >
                        {matchStatusMeta.label}
                      </Text>
                    </View>
                    <View style={styles.matchTimeWrap}>
                      <Text style={styles.matchTimeLabel}>Horario</Text>
                      <Pressable
                        disabled={!canEditFixture}
                        onPress={() => openMatchTimePicker(round.id, match.id, match.timeSlot)}
                        style={[
                          styles.matchTimeButton,
                          !canEditFixture ? styles.matchTimeInputDisabled : null,
                        ]}
                      >
                        <Text
                          style={[
                            styles.matchTimeButtonText,
                            !match.timeSlot ? styles.matchTimeButtonPlaceholder : null,
                          ]}
                        >
                          {match.timeSlot || "HH:MM"}
                        </Text>
                        <Ionicons color={colors.primaryDark} name="time-outline" size={15} />
                      </Pressable>
                      <Text style={styles.matchTimeSuffix}>hs</Text>
                    </View>
                  </View>
                  {match.suspensionMode ? (
                    (() => {
                      const matchSuspensionIsActive = isSuspensionNoticeActive(match.suspendedAtMillis);

                      return (
                        <View
                          style={[
                            styles.matchSuspendedBanner,
                            !matchSuspensionIsActive ? styles.matchReprogrammedBanner : null,
                          ]}
                        >
                          <Ionicons
                            color={matchSuspensionIsActive ? "#B51F1F" : "#1E7F4D"}
                            name={matchSuspensionIsActive ? "warning" : "calendar-outline"}
                            size={15}
                          />
                          <Text
                            style={[
                              styles.matchSuspendedText,
                              !matchSuspensionIsActive ? styles.matchReprogrammedText : null,
                            ]}
                          >
                            {matchSuspensionIsActive ? "PARTIDO SUSPENDIDO" : "PARTIDO REPROGRAMADO"} -{" "}
                            {getSuspensionReasonLabel(match.suspensionReason) || "Motivo pendiente"}
                            {match.rescheduledDateMillis
                              ? ` - ${formatDateLabel(match.rescheduledDateMillis)}`
                              : " - Proxima semana"}
                          </Text>
                        </View>
                      );
                    })()
                  ) : null}
                  <View style={styles.matchTeamsRow}>
                    <Pressable
                      disabled={!canEditFixture}
                      onPress={() => updateMatchWinner(round.id, match.id, "teamA")}
                      style={({ pressed }) => [
                        styles.teamColumn,
                        match.result?.winner === "teamA" ? styles.teamColumnWinner : null,
                        match.result?.winner === "teamB" ? styles.teamColumnLoser : null,
                        pressed ? styles.generateButtonPressed : null,
                      ]}
                    >
                      {!match.result?.winner ? (
                        <FontAwesome5
                          color={colors.textMuted}
                          name="hand-rock"
                          size={18}
                          style={styles.neutralFistIcon}
                        />
                      ) : (
                        <Ionicons
                          color={getTeamStatusIconColor(match, "teamA")}
                          name={getTeamStatusIconName(match, "teamA")}
                          size={20}
                        />
                      )}
                      {match.teamA.players?.length ? (
                        match.teamA.players.map((player, index) =>
                          renderFixturePlayer({
                            player,
                            playerIndex: index,
                            teamKey: "teamA",
                            match,
                            roundId: round.id,
                          })
                        )
                      ) : (
                        <Text style={styles.teamPlayerName}>{match.teamA.label}</Text>
                      )}
                    </Pressable>

                    <View style={styles.vsWrap}>
                      <Pressable
                        disabled={
                          !canEditFixture || !match.result?.winner || hasMatchResultData(match)
                        }
                        onPress={() => clearMatchResult(round.id, match.id)}
                        style={({ pressed }) => [
                          styles.resetWinnerButton,
                          !match.result?.winner || hasMatchResultData(match)
                            ? styles.resetWinnerButtonDisabled
                            : null,
                          pressed && canEditFixture && match.result?.winner && !hasMatchResultData(match)
                            ? styles.generateButtonPressed
                            : null,
                        ]}
                      >
                        <FontAwesome5
                          color={colors.textMuted}
                          name="hand-rock"
                          size={16}
                          style={styles.neutralFistIcon}
                        />
                      </Pressable>
                      <Text style={styles.teamNameMuted}>VS</Text>
                    </View>

                    <Pressable
                      disabled={!canEditFixture}
                      onPress={() => updateMatchWinner(round.id, match.id, "teamB")}
                      style={({ pressed }) => [
                        styles.teamColumn,
                        match.result?.winner === "teamB" ? styles.teamColumnWinner : null,
                        match.result?.winner === "teamA" ? styles.teamColumnLoser : null,
                        pressed ? styles.generateButtonPressed : null,
                      ]}
                    >
                      {!match.result?.winner ? (
                        <FontAwesome5
                          color={colors.textMuted}
                          name="hand-rock"
                          size={18}
                          style={styles.neutralFistIcon}
                        />
                      ) : (
                        <Ionicons
                          color={getTeamStatusIconColor(match, "teamB")}
                          name={getTeamStatusIconName(match, "teamB")}
                          size={20}
                        />
                      )}
                      {match.teamB.players?.length ? (
                        match.teamB.players.map((player, index) =>
                          renderFixturePlayer({
                            player,
                            playerIndex: index,
                            teamKey: "teamB",
                            match,
                            roundId: round.id,
                          })
                        )
                      ) : (
                        <Text style={styles.teamPlayerName}>{match.teamB.label}</Text>
                      )}
                    </Pressable>
                  </View>

                  <View style={styles.setsWrap}>
                    {getMatchResultSets(match, league?.matchFormat).map((set, index) => (
                      <View key={`${match.id}-${set.key}`} style={styles.setColumn}>
                        <Text style={styles.setLabel}>{set.label}</Text>
                        <View style={styles.setInputsRow}>
                          <TextInput
                            editable={canEditFixture}
                            keyboardType="number-pad"
                            maxLength={set.label === "STB" ? 2 : 1}
                            onChangeText={(value) =>
                              handleSetInputChange(round.id, match.id, index, "own", value, set.label)
                            }
                            placeholder="0"
                            placeholderTextColor={colors.textMuted}
                            ref={(ref) => {
                              setInputRefs.current[getSetInputKey(match.id, index, "own")] = ref;
                            }}
                            style={styles.setInput}
                            value={set.own}
                          />
                          <Text style={styles.setSlash}>/</Text>
                          <TextInput
                            editable={canEditFixture}
                            keyboardType="number-pad"
                            maxLength={set.label === "STB" ? 2 : 1}
                            onChangeText={(value) =>
                              handleSetInputChange(round.id, match.id, index, "rival", value, set.label)
                            }
                            placeholder="0"
                            placeholderTextColor={colors.textMuted}
                            ref={(ref) => {
                              setInputRefs.current[getSetInputKey(match.id, index, "rival")] = ref;
                            }}
                            style={styles.setInput}
                            value={set.rival}
                          />
                        </View>
                      </View>
                    ))}
                  </View>

                </View>
                  </View>
                );
              });
            })()}

            {round.byeLabels?.length ? (
              <View style={styles.byeWrap}>
                <Text style={styles.byeText}>Libre: {round.byeLabels.join(" / ")}</Text>
              </View>
            ) : null}
              </>
            ) : null}

            <View style={styles.leagueMigrationTable}>
              <View style={styles.leagueMigrationDateHeading}>
                <Text style={styles.leagueMigrationDateHeadingText}>
                  {String(round.title || `Fecha ${roundIndex + 1}`).toUpperCase()}
                </Text>
                {(() => {
                  const statusMeta = getRoundStatusMeta(round);

                  return (
                    <View style={styles.leagueMigrationDateStatus}>
                      <View
                        style={[
                          styles.leagueMigrationDateStatusDot,
                          styles[`leagueMigrationDateStatusDot${statusMeta.styleKey}`],
                        ]}
                      />
                      <Text
                        style={[
                          styles.leagueMigrationDateStatusText,
                          styles[`leagueMigrationDateStatusText${statusMeta.styleKey}`],
                        ]}
                      >
                        {statusMeta.label}
                      </Text>
                    </View>
                  );
                })()}
              </View>
              <View style={styles.leagueMigrationTableHeader}>
                <Text
                  style={[
                    styles.leagueMigrationTableHeaderText,
                    styles.leagueMigrationResultColumn,
                  ]}
                >
                  RESULTADOS
                </Text>
                <Text
                  style={[
                    styles.leagueMigrationTableHeaderText,
                    styles.leagueMigrationPairsColumn,
                  ]}
                >
                  PAREJAS
                </Text>
                <Text
                  style={[
                    styles.leagueMigrationTableHeaderText,
                    styles.leagueMigrationDayColumn,
                  ]}
                >
                  DIA
                </Text>
                <Text
                  style={[
                    styles.leagueMigrationTableHeaderText,
                    styles.leagueMigrationTimeColumn,
                  ]}
                >
                  HORA
                </Text>
                <View style={styles.leagueMigrationActionsColumn}>
                  <Ionicons
                    color="#285E59"
                    name="swap-horizontal-outline"
                    size={13}
                  />
                </View>
              </View>

              {sortMatchesByTime(round.matches || []).map((match, tableMatchIndex) => {
                const resultLabel = buildScoreSummary(
                  getMatchResultSets(match, league?.matchFormat)
                );
                const dayLabel = formatDayLabel(
                  match.rescheduledDateMillis ||
                    round.rescheduledDateMillis ||
                    round.scheduledDateMillis
                );

                return (
                  <View
                    key={`league-migration-${round.id}-${match.id}`}
                    style={[
                      styles.leagueMigrationTableRow,
                      tableMatchIndex === (round.matches || []).length - 1
                        ? styles.leagueMigrationTableRowLast
                        : null,
                    ]}
                  >
                    <Pressable
                      disabled={!canEditFixture}
                      onPress={() => openLeagueResultEditor(round, match)}
                      style={({ pressed }) => [
                        styles.leagueMigrationResultColumn,
                        styles.leagueMigrationResultButton,
                        pressed && canEditFixture ? styles.generateButtonPressed : null,
                      ]}
                    >
                      <Text
                        numberOfLines={2}
                        style={[
                          styles.leagueMigrationTableCell,
                          canEditFixture ? styles.leagueMigrationResultButtonText : null,
                        ]}
                      >
                        {resultLabel || "Pendiente"}
                      </Text>
                    </Pressable>
                    <View style={styles.leagueMigrationPairsColumn}>
                      <View style={styles.leagueMigrationTeamWrap}>
                        {renderMigrationTableTeam({
                          match,
                          roundId: round.id,
                          team: match.teamA,
                          teamKey: "teamA",
                        })}
                      </View>
                      <View style={styles.leagueMigrationTeamWrap}>
                        {renderMigrationTableTeam({
                          match,
                          roundId: round.id,
                          team: match.teamB,
                          teamKey: "teamB",
                        })}
                      </View>
                    </View>
                    <Pressable
                      disabled={!canEditFixture}
                      onPress={() => openLeagueMatchDayPicker(round, match)}
                      style={({ pressed }) => [
                        styles.leagueMigrationDayColumn,
                        styles.leagueMigrationScheduleButton,
                        pressed && canEditFixture ? styles.generateButtonPressed : null,
                      ]}
                    >
                      <Text
                        numberOfLines={2}
                        style={[
                          styles.leagueMigrationTableCell,
                          canEditFixture ? styles.leagueMigrationScheduleButtonText : null,
                        ]}
                      >
                        {dayLabel || "Sin dia"}
                      </Text>
                    </Pressable>
                    <Pressable
                      disabled={!canEditFixture}
                      onPress={() => openMatchTimePicker(round.id, match.id, match.timeSlot)}
                      style={({ pressed }) => [
                        styles.leagueMigrationTimeColumn,
                        styles.leagueMigrationScheduleButton,
                        pressed && canEditFixture ? styles.generateButtonPressed : null,
                      ]}
                    >
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.leagueMigrationTableCell,
                          canEditFixture ? styles.leagueMigrationScheduleButtonText : null,
                        ]}
                      >
                        {match.timeSlot || "--:--"}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => openTableReplacementMenu(round, match)}
                      style={({ pressed }) => [
                        styles.leagueMigrationActionsColumn,
                        styles.leagueMigrationActionsButton,
                        pressed ? styles.generateButtonPressed : null,
                      ]}
                    >
                      <Ionicons color={colors.primaryDark} name="ellipsis-vertical" size={16} />
                      {hasUnassignedReplacement(match) ? (
                        <View style={styles.leagueMigrationReplacementPendingDot} />
                      ) : hasAssignedReplacement(match) ? (
                        <View style={styles.leagueMigrationReplacementAssignedDot} />
                      ) : null}
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </View>
          </Fragment>
          );
        })}

        {hasFixture ? (
          <Pressable
            onPress={() =>
              navigation.navigate("LeagueStandings", {
                leagueId: league?.id || leagueId,
                leagueName,
              })
            }
            style={({ pressed }) => [
              styles.fixtureStandingsShortcut,
              pressed ? styles.generateButtonPressed : null,
            ]}
          >
            <Ionicons color="#1F6D69" name="trophy-outline" size={18} />
            <Text style={styles.fixtureStandingsShortcutText}>Puntajes</Text>
          </Pressable>
        ) : null}

        {hasFixture && canEditFixture ? (
          <View style={styles.bottomActionsSpacer}>
            <View style={styles.fixtureOptionsCard}>
              <Text style={styles.fixtureOptionsTitle}>VISIBILIDAD PARA JUGADORES</Text>
              <View style={styles.visibilitySwitchRow}>
                <View style={styles.visibilitySwitchCopy}>
                  <Text style={styles.visibilitySwitchLabel}>
                    {fixtureVisibilityMode === "all"
                      ? "Mostrar todas las fechas"
                      : "Mostrar solo Proxima fecha"}
                  </Text>
                </View>
                <Pressable
                  onPress={() =>
                    updateFixtureVisibilityMode(fixtureVisibilityMode === "all" ? "current" : "all")
                  }
                  style={[
                    styles.visibilitySwitchTrack,
                    fixtureVisibilityMode === "all" ? styles.visibilitySwitchTrackActive : null,
                  ]}
                >
                  <View
                    style={[
                      styles.visibilitySwitchThumb,
                      fixtureVisibilityMode === "all" ? styles.visibilitySwitchThumbActive : null,
                    ]}
                  />
                </Pressable>
              </View>
            </View>
            {canGenerateNextRound ? (
              <Pressable
                disabled={Boolean(savingMatchId) || generating}
                onPress={handleGenerateNextRound}
                style={({ pressed }) => [
                  styles.generateNextRoundButton,
                  pressed ? styles.generateButtonPressed : null,
                  Boolean(savingMatchId) || generating ? styles.saveButtonDisabled : null,
                ]}
              >
                <Text style={styles.generateNextRoundButtonText}>
                  {generating ? "Generando fecha..." : "Generar proxima fecha"}
                </Text>
              </Pressable>
            ) : null}
            <View style={styles.fixtureDangerActionsRow}>
              <Pressable
                disabled={Boolean(savingMatchId) || generating}
                onPress={handleGenerateFixturePress}
                style={({ pressed }) => [
                  styles.regenerateFixtureButton,
                  pressed ? styles.generateButtonPressed : null,
                  Boolean(savingMatchId) || generating ? styles.saveButtonDisabled : null,
                ]}
              >
                <Text style={styles.regenerateFixtureButtonText}>
                  {generating ? "REGENERANDO..." : "REGENERAR FIXTURE"}
                </Text>
              </Pressable>
              <Pressable
                disabled={Boolean(savingMatchId)}
                onPress={() => setConfirmDeleteVisible(true)}
                style={({ pressed }) => [
                  styles.deleteFixtureButton,
                  pressed ? styles.generateButtonPressed : null,
                  Boolean(savingMatchId) ? styles.saveButtonDisabled : null,
                ]}
              >
                <Text style={styles.deleteFixtureButtonText}>
                  {savingMatchId === "deleting" ? "ELIMINANDO..." : "ELIMINAR FIXTURE"}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {hasFixture && canEditFixture ? (
          <Pressable
            accessibilityLabel="Compartir fixture"
            onPress={openLeagueShareModal}
            style={({ pressed }) => [
              styles.leagueShareShortcut,
              pressed ? styles.generateButtonPressed : null,
            ]}
          >
            <Ionicons color="#1F6D69" name="share-social-outline" size={17} />
          </Pressable>
        ) : null}
      </ScrollView>

      {canSaveFixtureChanges && canEditFixture && hasUnsavedFixtureChanges ? (
        <View style={styles.stickyActionsWrap}>
          <Pressable
            disabled={Boolean(savingMatchId)}
            onPress={handleSaveMatch}
            style={({ pressed }) => [
              styles.saveButton,
              pressed ? styles.generateButtonPressed : null,
              Boolean(savingMatchId) ? styles.saveButtonDisabled : null,
            ]}
          >
            <Text style={styles.saveButtonText}>
              {savingMatchId === "saving" ? "GUARDANDO..." : "GUARDAR CAMBIOS"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {canEditFixture && leagueShareChunks.length ? (
        <View pointerEvents="none" style={styles.leagueShareHiddenRoot}>
          {leagueShareChunks.map((chunk, chunkIndex) => (
            <View
              key={`league-share-chunk-${chunkIndex}`}
              collapsable={false}
              ref={(ref) => {
                leagueShareViewRefs.current[chunkIndex] = ref;
              }}
              style={styles.leagueShareCaptureCard}
            >
              <View style={styles.leagueShareHeader}>
                <View style={styles.leagueShareHeaderRow}>
                  {leagueShareLogoUrl ? (
                    <Image source={{ uri: leagueShareLogoUrl }} style={styles.leagueShareLogo} />
                  ) : null}
                  <View style={styles.leagueShareHeaderCopy}>
                    <Text style={styles.leagueShareTitle}>{leagueName || "Liga"}</Text>
                    <Text style={styles.leagueShareSubtitle}>
                      {[league?.categoria || "", resolveLeagueOrganizerLabel(league, "PadelNexo")]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </View>
                </View>
              </View>

              {chunk.map((round, roundIndex) => {
                const statusMeta = getRoundStatusMeta(round);

                return (
                  <View
                    key={`league-share-round-${round.id || roundIndex}`}
                    style={styles.leagueShareRoundCard}
                  >
                    <View style={styles.leagueShareRoundHeader}>
                      <Text style={styles.leagueShareRoundTitle}>
                        {round.title || `Fecha ${roundIndex + 1}`}
                      </Text>
                      <Text
                        style={[
                          styles.leagueShareRoundStatus,
                          styles[`leagueShareRoundStatus${statusMeta.styleKey}`],
                        ]}
                      >
                        {statusMeta.label}
                      </Text>
                    </View>

                    <View style={styles.leagueShareTableHeader}>
                      <Text
                        style={[
                          styles.leagueShareTableHeaderText,
                          styles.leagueShareResultColumn,
                        ]}
                      >
                        RESULTADOS
                      </Text>
                      <Text
                        style={[
                          styles.leagueShareTableHeaderText,
                          styles.leagueSharePairsColumn,
                        ]}
                      >
                        PAREJAS
                      </Text>
                      <Text
                        style={[styles.leagueShareTableHeaderText, styles.leagueShareDayColumn]}
                      >
                        DIA
                      </Text>
                      <Text
                        style={[styles.leagueShareTableHeaderText, styles.leagueShareTimeColumn]}
                      >
                        HORA
                      </Text>
                    </View>

                    {sortMatchesByTime(round.matches || []).map((match, matchIndex, matchList) => (
                      <View
                        key={`league-share-row-${round.id}-${match.id}`}
                        style={[
                          styles.leagueShareTableRow,
                          matchIndex === matchList.length - 1 ? styles.leagueShareTableRowLast : null,
                        ]}
                      >
                        <Text
                          style={[styles.leagueShareTableCell, styles.leagueShareResultColumn]}
                        >
                          {buildScoreSummary(getMatchResultSets(match, league?.matchFormat)) ||
                            "Pendiente"}
                        </Text>
                        <Text
                          style={[styles.leagueShareTableCell, styles.leagueSharePairsColumn]}
                        >
                          {buildLeagueShareTeamLabel(match.teamA)}
                          {"\n"}
                          {buildLeagueShareTeamLabel(match.teamB)}
                        </Text>
                        <Text
                          style={[styles.leagueShareTableCell, styles.leagueShareDayColumn]}
                        >
                          {formatDayLabel(
                            match.rescheduledDateMillis ||
                              round.rescheduledDateMillis ||
                              round.scheduledDateMillis
                          ) || "Sin dia"}
                        </Text>
                        <Text
                          style={[styles.leagueShareTableCell, styles.leagueShareTimeColumn]}
                        >
                          {match.timeSlot || "--:--"}
                        </Text>
                      </View>
                    ))}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      ) : null}

      <BottomQuickActionsBar navigation={navigation} />

      {timePickerTarget ? (
        <DateTimePicker
          display={Platform.OS === "ios" ? "spinner" : "clock"}
          is24Hour
          mode="time"
          onChange={handleMatchTimePickerChange}
          value={buildDateFromTime(timePickerTarget.currentValue)}
        />
      ) : null}

      {fixtureStartDatePickerVisible ? (
        <DateTimePicker
          display={Platform.OS === "ios" ? "spinner" : "calendar"}
          mode="date"
          onChange={handleFixtureStartDateChange}
          value={buildDateFromMillis(fixtureStartDateMillis || Date.now())}
        />
      ) : null}

      <Modal
        animationType="fade"
        onRequestClose={() => setPlayerReplacementMenuVisible(false)}
        transparent
        visible={playerReplacementMenuVisible}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            onPress={() => setPlayerReplacementMenuVisible(false)}
            style={styles.modalBackdrop}
          />
          <View style={[styles.modalCard, styles.playerReplacementMenuModalCard]}>
            <Text style={styles.modalTitle}>Opciones del partido</Text>
            <Text style={styles.modalMessage}>Solicita remplazo de liga</Text>
            {hasOwnReplacementRequest ? (
              <View style={styles.replacementMenuStatusBox}>
                <Text style={styles.replacementMenuStatusTitle}>
                  {hasOwnReplacementDesignated ? "REMPLAZO DESIGNADO" : "REMPLAZO SOLICITADO"}
                </Text>
                <Text style={styles.replacementMenuStatusText}>
                  {hasOwnReplacementDesignated
                    ? formatPlayerShortName(ownReplacementRequest?.replacement)
                    : "Esperando confirmacion del organizador."}
                </Text>
              </View>
            ) : null}
            <View style={styles.modalActionsColumn}>
              {!hasOwnReplacementRequest ? (
                <Pressable
                  disabled={!nextReplacementTarget || Boolean(savingMatchId)}
                  onPress={() => {
                    setPlayerReplacementMenuVisible(false);
                    handlePlayerReplacementRequest();
                  }}
                  style={({ pressed }) => [
                    styles.modalPrimaryButton,
                    styles.replacementMenuActionButton,
                    !nextReplacementTarget || Boolean(savingMatchId) ? styles.modalButtonDisabled : null,
                    pressed ? styles.generateButtonPressed : null,
                  ]}
                >
                  <Ionicons color={colors.surface} name="person-add-outline" size={18} />
                  <Text style={styles.modalPrimaryButtonText}>PEDIR REMPLAZO</Text>
                </Pressable>
              ) : !hasOwnReplacementDesignated ? (
                <Pressable
                  disabled={Boolean(savingMatchId)}
                  onPress={() => {
                    setPlayerReplacementMenuVisible(false);
                    handleCancelPlayerReplacementRequest();
                  }}
                  style={({ pressed }) => [
                    styles.modalSecondaryButton,
                    styles.replacementMenuActionButton,
                    Boolean(savingMatchId) ? styles.modalButtonDisabled : null,
                    pressed ? styles.generateButtonPressed : null,
                  ]}
                >
                  <Text style={styles.modalSecondaryButtonText}>CANCELAR REMPLAZO</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      </Modal>

      {rescheduleDatePickerVisible ? (
        <DateTimePicker
          display={Platform.OS === "ios" ? "spinner" : "calendar"}
          mode="date"
          onChange={handleRescheduleDateChange}
          value={buildDateFromMillis(roundSuspensionTarget?.rescheduledDateMillis || Date.now())}
        />
      ) : null}

      <Modal
        animationType="fade"
        onRequestClose={closeRoundSuspensionOptions}
        transparent
        visible={Boolean(roundSuspensionTarget)}
      >
        <View style={styles.modalOverlay}>
          <Pressable onPress={closeRoundSuspensionOptions} style={styles.modalBackdrop} />
          <View style={[styles.modalCard, styles.suspensionModalCard]}>
            <Text style={styles.modalTitle}>
              {retakingSuspension ? "Retomar fecha suspendida" : "Suspender o reprogramar"}
            </Text>

            <ScrollView
              contentContainerStyle={styles.suspensionModalContent}
              showsVerticalScrollIndicator={false}
              style={styles.suspensionModalScroll}
            >
              {!suspensionFlowStarted ? (
                <>
                  <Pressable
                    onPress={() => setSuspensionFlowStarted(true)}
                    style={({ pressed }) => [
                      styles.suspensionPrimaryStartButton,
                      pressed ? styles.generateButtonPressed : null,
                    ]}
                  >
                    <Ionicons color={colors.surface} name="options-outline" size={20} />
                    <Text style={styles.suspensionPrimaryStartText}>CONFIGURAR SUSPENSION</Text>
                  </Pressable>
                  {roundHasSuspensionData ? (
                    <Pressable
                      onPress={() => openRetakeSuspendedRound(roundSuspensionTarget)}
                      style={({ pressed }) => [
                        styles.retakeSuspensionButton,
                        pressed ? styles.generateButtonPressed : null,
                      ]}
                    >
                      <Ionicons color="#176B5B" name="play-forward-circle-outline" size={21} />
                      <Text style={styles.retakeSuspensionButtonText}>
                        RETOMAR FECHA SUSPENDIDA
                      </Text>
                    </Pressable>
                  ) : null}
                  {roundHasSuspensionData ? (
                    <Pressable
                      onPress={handleClearRoundSuspension}
                      style={({ pressed }) => [
                        styles.clearSuspensionButton,
                        pressed ? styles.generateButtonPressed : null,
                      ]}
                    >
                      <Ionicons color="#B51F1F" name="refresh-circle-outline" size={21} />
                      <Text style={styles.clearSuspensionButtonText}>QUITAR SUSPENSION</Text>
                    </Pressable>
                  ) : null}
                </>
              ) : (
                <>
                  {retakingSuspension ? (
                    <Text style={styles.suspensionIntroText}>
                      La fecha ya esta suspendida. Defini ahora cuando se va a retomar.
                    </Text>
                  ) : (
                    <>
                      <Text style={styles.suspensionIntroText}>
                        Completa los pasos para definir que partidos se suspenden y cuando se
                        jugaran. Los partidos con resultado cargado no se modifican.
                      </Text>

                      <View style={styles.suspensionReasonList}>
                        <View style={styles.suspensionStepHeader}>
                          <Text style={styles.suspensionStepNumber}>1</Text>
                          <Text style={styles.suspensionReasonTitle}>Que suspender?</Text>
                        </View>
                        <Pressable
                          onPress={() => selectSuspensionScope(SUSPENSION_SCOPES.ALL_DAY)}
                          style={({ pressed }) => [
                            styles.suspensionReasonButton,
                            suspensionScope === SUSPENSION_SCOPES.ALL_DAY
                              ? styles.suspensionReasonButtonActive
                              : null,
                            pressed ? styles.generateButtonPressed : null,
                          ]}
                        >
                          <Ionicons
                            color={
                              suspensionScope === SUSPENSION_SCOPES.ALL_DAY
                                ? "#176B5B"
                                : colors.primaryDark
                            }
                            name="calendar-clear-outline"
                            size={18}
                          />
                          <Text
                            style={[
                              styles.suspensionReasonText,
                              styles.suspensionReasonTextWithSupport,
                              suspensionScope === SUSPENSION_SCOPES.ALL_DAY
                                ? styles.suspensionReasonTextActive
                                : null,
                            ]}
                          >
                            Todas mis ligas programadas para este dia{"\n"}
                            <Text style={styles.suspensionReasonSupportText}>
                              Incluye otras ligas que organices en la misma fecha.
                            </Text>
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => selectSuspensionScope(SUSPENSION_SCOPES.LEAGUE_ROUND)}
                          style={({ pressed }) => [
                            styles.suspensionReasonButton,
                            suspensionScope === SUSPENSION_SCOPES.LEAGUE_ROUND
                              ? styles.suspensionReasonButtonActive
                              : null,
                            pressed ? styles.generateButtonPressed : null,
                          ]}
                        >
                          <Ionicons
                            color={
                              suspensionScope === SUSPENSION_SCOPES.LEAGUE_ROUND
                                ? "#176B5B"
                                : colors.primaryDark
                            }
                            name="albums-outline"
                            size={18}
                          />
                          <Text
                            style={[
                              styles.suspensionReasonText,
                              styles.suspensionReasonTextWithSupport,
                              suspensionScope === SUSPENSION_SCOPES.LEAGUE_ROUND
                                ? styles.suspensionReasonTextActive
                                : null,
                            ]}
                          >
                            Esta fecha de {leagueName} solamente{"\n"}
                            <Text style={styles.suspensionReasonSupportText}>
                              No afecta ninguna otra liga.
                            </Text>
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => selectSuspensionScope(SUSPENSION_SCOPES.SELECTED_MATCHES)}
                          style={({ pressed }) => [
                            styles.suspensionReasonButton,
                            suspensionScope === SUSPENSION_SCOPES.SELECTED_MATCHES
                              ? styles.suspensionReasonButtonActive
                              : null,
                            pressed ? styles.generateButtonPressed : null,
                          ]}
                        >
                          <Ionicons
                            color={
                              suspensionScope === SUSPENSION_SCOPES.SELECTED_MATCHES
                                ? "#176B5B"
                                : colors.primaryDark
                            }
                            name="checkbox-outline"
                            size={18}
                          />
                          <Text
                            style={[
                              styles.suspensionReasonText,
                              styles.suspensionReasonTextWithSupport,
                              suspensionScope === SUSPENSION_SCOPES.SELECTED_MATCHES
                                ? styles.suspensionReasonTextActive
                                : null,
                            ]}
                          >
                            Elegir partidos de{" "}
                            {String(roundSuspensionTarget?.title || "esta fecha").toUpperCase()}
                            {"\n"}
                            <Text style={styles.suspensionReasonSupportText}>
                              Solo se suspenden los partidos que marques.
                            </Text>
                          </Text>
                        </Pressable>
                      </View>
                    </>
                  )}

                  {!retakingSuspension && suspensionScope === SUSPENSION_SCOPES.SELECTED_MATCHES ? (
                    <View style={styles.suspensionReasonList}>
                      <Text style={styles.suspensionSubsectionTitle}>Partidos pendientes</Text>
                      {pendingSuspensionMatches.length ? (
                        pendingSuspensionMatches.map((match, index) => {
                          const isSelected = selectedSuspendedMatchIds.includes(match.id);

                          return (
                            <Pressable
                              key={match.id}
                              onPress={() => toggleSuspendedMatchSelection(match.id)}
                              style={({ pressed }) => [
                                styles.suspensionReasonButton,
                                isSelected ? styles.suspensionReasonButtonActive : null,
                                pressed ? styles.generateButtonPressed : null,
                              ]}
                            >
                              <Ionicons
                                color={isSelected ? "#176B5B" : colors.primaryDark}
                                name={isSelected ? "checkbox" : "square-outline"}
                                size={18}
                              />
                              <Text
                                style={[
                                  styles.suspensionReasonText,
                                  isSelected ? styles.suspensionReasonTextActive : null,
                                ]}
                              >
                                Partido {index + 1} - {match.timeSlot || "Sin horario"}
                              </Text>
                            </Pressable>
                          );
                        })
                      ) : (
                        <Text style={styles.suspensionEmptyText}>
                          No quedan partidos pendientes para suspender.
                        </Text>
                      )}
                    </View>
                  ) : null}

                  {!retakingSuspension && canChooseSuspensionReason ? (
                    <View style={styles.suspensionReasonList}>
                      <View style={styles.suspensionStepHeader}>
                        <Text style={styles.suspensionStepNumber}>2</Text>
                        <Text style={styles.suspensionReasonTitle}>Motivo</Text>
                      </View>
                      {SUSPENSION_REASONS.map((reason) => {
                        const isSelected = selectedSuspensionReason === reason.value;

                        return (
                          <Pressable
                            key={reason.value}
                            onPress={() => setSelectedSuspensionReason(reason.value)}
                            style={({ pressed }) => [
                              styles.suspensionReasonButton,
                              styles.suspensionReasonButtonCompact,
                              isSelected ? styles.suspensionReasonButtonActive : null,
                              pressed ? styles.generateButtonPressed : null,
                            ]}
                          >
                            <Ionicons
                              color={isSelected ? "#176B5B" : colors.primaryDark}
                              name={isSelected ? "radio-button-on" : "radio-button-off"}
                              size={18}
                            />
                            <Text
                              style={[
                                styles.suspensionReasonText,
                                isSelected ? styles.suspensionReasonTextActive : null,
                              ]}
                            >
                              {reason.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}

                  {selectedSuspensionReason ? (
                    <View style={styles.modalActionsColumn}>
                      <View style={styles.suspensionStepHeader}>
                        {!retakingSuspension ? (
                          <Text style={styles.suspensionStepNumber}>3</Text>
                        ) : null}
                        <Text style={styles.suspensionReasonTitle}>
                          {retakingSuspension ? "Cuando se retoma" : "Cuando se jugaran"}
                        </Text>
                      </View>
                      <Pressable
                        disabled={!canApplySuspension || applyingSuspension}
                        onPress={() =>
                          applyRoundSuspension({
                            rescheduledDateMillis: 0,
                            suspensionMode: "next_week",
                          })
                        }
                        style={({ pressed }) => [
                          styles.suspensionScheduleOption,
                          !canApplySuspension || applyingSuspension ? styles.modalButtonDisabled : null,
                          pressed ? styles.generateButtonPressed : null,
                        ]}
                      >
                        <Ionicons color="#176B5B" name="calendar-number-outline" size={17} />
                        <View style={styles.suspensionScheduleOptionCopy}>
                          <Text style={styles.suspensionScheduleOptionTitle}>Proxima semana</Text>
                          <Text style={styles.suspensionScheduleOptionText}>
                            Se mantiene el mismo orden y se corre a la semana siguiente.
                          </Text>
                        </View>
                      </Pressable>
                      <Pressable
                        disabled={!canApplySuspension || applyingSuspension}
                        onPress={() => setRescheduleDatePickerVisible(true)}
                        style={({ pressed }) => [
                          styles.suspensionScheduleOption,
                          !canApplySuspension || applyingSuspension ? styles.modalButtonDisabled : null,
                          pressed ? styles.generateButtonPressed : null,
                        ]}
                      >
                        <Ionicons color="#176B5B" name="calendar-outline" size={17} />
                        <View style={styles.suspensionScheduleOptionCopy}>
                          <Text style={styles.suspensionScheduleOptionTitle}>Elegir fecha</Text>
                          <Text style={styles.suspensionScheduleOptionText}>
                            Selecciona un dia especifico para jugar la fecha.
                          </Text>
                        </View>
                      </Pressable>
                      <Pressable
                        disabled={!canApplySuspension || applyingSuspension}
                        onPress={() =>
                          applyRoundSuspension({
                            rescheduledDateMillis: getDateAfterLastFixtureRound(),
                            suspensionMode: "after_last",
                          })
                        }
                        style={({ pressed }) => [
                          styles.suspensionScheduleOption,
                          !canApplySuspension || applyingSuspension ? styles.modalButtonDisabled : null,
                          pressed ? styles.generateButtonPressed : null,
                        ]}
                      >
                        <Ionicons color="#176B5B" name="play-skip-forward-outline" size={17} />
                        <View style={styles.suspensionScheduleOptionCopy}>
                          <Text style={styles.suspensionScheduleOptionTitle}>
                            Despues de la ultima fecha
                          </Text>
                          <Text style={styles.suspensionScheduleOptionText}>
                            La fecha queda al final del fixture.
                          </Text>
                        </View>
                      </Pressable>
                    </View>
                  ) : null}
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={() => setFixtureGenerateSetupVisible(false)}
        transparent
        visible={fixtureGenerateSetupVisible}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            onPress={() => setFixtureGenerateSetupVisible(false)}
            style={styles.modalBackdrop}
          />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Generar fixture</Text>
            <Text style={styles.modalMessage}>
              Primero elegi como queres generar las fechas. Despues selecciona la fecha de inicio
              de la liga.
            </Text>

            <View style={styles.fixtureSetupOptions}>
              <Pressable
                onPress={() => selectFixtureGenerationMode("all")}
                style={({ pressed }) => [
                  styles.fixtureSetupOption,
                  fixtureGenerationMode === "all" ? styles.fixtureSetupOptionActive : null,
                  pressed ? styles.generateButtonPressed : null,
                ]}
              >
                <Ionicons
                  color={fixtureGenerationMode === "all" ? colors.surface : colors.primaryDark}
                  name="calendar-number-outline"
                  size={22}
                />
                <Text
                  style={[
                    styles.fixtureSetupOptionTitle,
                    fixtureGenerationMode === "all" ? styles.fixtureSetupOptionTitleActive : null,
                  ]}
                >
                  Generar todas las fechas
                </Text>
                <Text
                  style={[
                    styles.fixtureSetupOptionText,
                    fixtureGenerationMode === "all" ? styles.fixtureSetupOptionTextActive : null,
                  ]}
                >
                  Crea el fixture completo de la liga desde la fecha inicial.
                </Text>
              </Pressable>

              <Pressable
                onPress={() => selectFixtureGenerationMode("next")}
                style={({ pressed }) => [
                  styles.fixtureSetupOption,
                  fixtureGenerationMode === "next" ? styles.fixtureSetupOptionActive : null,
                  pressed ? styles.generateButtonPressed : null,
                ]}
              >
                <Ionicons
                  color={fixtureGenerationMode === "next" ? colors.surface : colors.primaryDark}
                  name="calendar-outline"
                  size={22}
                />
                <Text
                  style={[
                    styles.fixtureSetupOptionTitle,
                    fixtureGenerationMode === "next" ? styles.fixtureSetupOptionTitleActive : null,
                  ]}
                >
                  Generar solo la proxima fecha
                </Text>
                <Text
                  style={[
                    styles.fixtureSetupOptionText,
                    fixtureGenerationMode === "next" ? styles.fixtureSetupOptionTextActive : null,
                  ]}
                >
                  Crea solo la primera fecha y deja el resto para generar luego.
                </Text>
              </Pressable>
            </View>

            <Pressable
              onPress={() => openFixtureStartDatePicker({ allowWithSetup: true })}
              style={({ pressed }) => [
                styles.fixtureStartDateButton,
                pressed ? styles.generateButtonPressed : null,
              ]}
            >
              <View style={styles.fixtureStartDateIcon}>
                <Ionicons color={colors.primaryDark} name="calendar-outline" size={18} />
              </View>
              <View style={styles.fixtureStartDateCopy}>
                <Text style={styles.fixtureStartDateLabel}>Selecciona fecha de inicio de la liga</Text>
                <Text style={styles.fixtureStartDateValue}>
                  {fixtureStartDateMillis
                    ? formatDateLabel(fixtureStartDateMillis)
                    : "Tocar para elegir fecha"}
                </Text>
              </View>
            </Pressable>

            <View style={styles.modalActionsRow}>
              <Pressable
                onPress={() => setFixtureGenerateSetupVisible(false)}
                style={({ pressed }) => [
                  styles.modalSecondaryButton,
                  pressed ? styles.generateButtonPressed : null,
                ]}
              >
                <Text style={styles.modalSecondaryButtonText}>Cancelar</Text>
              </Pressable>
              <Pressable
                onPress={handleConfirmFixtureGenerationSetup}
                style={({ pressed }) => [
                  styles.modalPaymentsButton,
                  pressed ? styles.generateButtonPressed : null,
                ]}
              >
                <Text style={styles.modalPrimaryButtonText}>Generar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={() => setConfirmRegenerateVisible(false)}
        transparent
        visible={confirmRegenerateVisible}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            onPress={() => setConfirmRegenerateVisible(false)}
            style={styles.modalBackdrop}
          />
          <View style={[styles.modalCard, styles.individualPreviewModalCard]}>
            <Text style={styles.modalTitle}>Regenerar fixture</Text>
            <Text style={styles.modalMessage}>
              Si regeneras el fixture se perderan los cruces y resultados cargados. Quieres
              continuar?
            </Text>
            <View style={styles.modalActionsRow}>
              <Pressable
                onPress={() => setConfirmRegenerateVisible(false)}
                style={({ pressed }) => [
                  styles.modalSecondaryButton,
                  pressed ? styles.generateButtonPressed : null,
                ]}
              >
                <Text style={styles.modalSecondaryButtonText}>Cancelar</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setConfirmRegenerateVisible(false);
                  if (league?.teamType === "individual") {
                    setFixtureGenerationMode("all");
                    setIndividualPreviewVisible(true);
                    return;
                  }

                  handleGenerateFixture({ mode: "all" });
                }}
                style={({ pressed }) => [
                  styles.modalPrimaryButton,
                  pressed ? styles.generateButtonPressed : null,
                ]}
              >
                <Text style={styles.modalPrimaryButtonText}>Regenerar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={() => setConfirmDeleteVisible(false)}
        transparent
        visible={confirmDeleteVisible}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            onPress={() => setConfirmDeleteVisible(false)}
            style={styles.modalBackdrop}
          />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Eliminar fixture</Text>
            <Text style={styles.modalMessage}>
              Vas a eliminar todas las fechas y resultados cargados de esta liga. Esta accion no se
              puede deshacer.
            </Text>
            <View style={styles.modalActionsRow}>
              <Pressable
                onPress={() => setConfirmDeleteVisible(false)}
                style={({ pressed }) => [
                  styles.modalSecondaryButton,
                  pressed ? styles.generateButtonPressed : null,
                ]}
              >
                <Text style={styles.modalSecondaryButtonText}>Cancelar</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setConfirmDeleteVisible(false);
                  handleDeleteFixture();
                }}
                style={({ pressed }) => [
                  styles.modalDangerButton,
                  pressed ? styles.generateButtonPressed : null,
                ]}
              >
                <Text style={styles.modalPrimaryButtonText}>Eliminar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={() => setReplacementPendingRemoval(null)}
        transparent
        visible={Boolean(replacementPendingRemoval)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            onPress={() => setReplacementPendingRemoval(null)}
            style={styles.modalBackdrop}
          />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Cancelar pedido de remplazo</Text>
            <Text style={styles.modalMessage}>
              Vas a quitar el remplazo {replacementPendingRemoval?.playerName || ""} y cancelar
              este pedido. Al guardar, ya no aparecera en Remplazos ni en el resumen de ligas.
            </Text>
            <View style={styles.modalActionsRow}>
              <Pressable
                onPress={() => setReplacementPendingRemoval(null)}
                style={({ pressed }) => [
                  styles.modalSecondaryButton,
                  pressed ? styles.generateButtonPressed : null,
                ]}
              >
                <Text style={styles.modalSecondaryButtonText}>Cancelar</Text>
              </Pressable>
              <Pressable
                onPress={handleRemoveAssignedReplacement}
                style={({ pressed }) => [
                  styles.modalDangerButton,
                  pressed ? styles.generateButtonPressed : null,
                ]}
              >
                <Text style={styles.modalPrimaryButtonText}>Cancelar pedido</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        onRequestClose={() => setIndividualPreviewVisible(false)}
        transparent
        visible={individualPreviewVisible}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            onPress={() => setIndividualPreviewVisible(false)}
            style={styles.modalBackdrop}
          />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Previsualizar fixture individual</Text>
            <Text style={styles.modalMessage}>
              Revisa que haya la misma cantidad de Drive y Reves antes de generar las fechas.
            </Text>

            <View style={styles.individualPreviewSummary}>
              <View style={styles.individualPreviewPill}>
                <Text style={styles.individualPreviewPillLabel}>Drive</Text>
                <Text style={styles.individualPreviewPillValue}>
                  {individualFixturePreview.drivePlayers.length}
                </Text>
              </View>
              <View style={styles.individualPreviewPill}>
                <Text style={styles.individualPreviewPillLabel}>Reves</Text>
                <Text style={styles.individualPreviewPillValue}>
                  {individualFixturePreview.revesPlayers.length}
                </Text>
              </View>
              <View style={styles.individualPreviewPill}>
                <Text style={styles.individualPreviewPillLabel}>Parejas</Text>
                <Text style={styles.individualPreviewPillValue}>
                  {individualFixturePreview.pairedTeamsCount}
                </Text>
              </View>
            </View>

            {!individualFixturePreview.hasBalancedSides ? (
              <View style={styles.individualPreviewWarning}>
                <Ionicons color="#A05A00" name="alert-circle" size={18} />
                <Text style={styles.individualPreviewWarningText}>
                  Hay desbalance: ajusta los lados en Jugadores antes de generar.{" "}
                  {individualFixturePreview.extraDriveCount > 0
                    ? `Faltan ${individualFixturePreview.extraDriveCount} Reves o debes pasar ${individualFixturePreview.extraDriveCount} Drive a Reves.`
                    : ""}
                  {individualFixturePreview.extraRevesCount > 0
                    ? `Faltan ${individualFixturePreview.extraRevesCount} Drive o debes pasar ${individualFixturePreview.extraRevesCount} Reves a Drive.`
                    : ""}
                  {individualFixturePreview.undefinedPlayers.length > 0
                    ? ` Hay ${individualFixturePreview.undefinedPlayers.length} jugador(es) sin lado definido.`
                    : ""}
                </Text>
              </View>
            ) : null}

            {individualFixturePreview.hasOddTeams && individualFixturePreview.hasBalancedSides ? (
              <View style={styles.individualPreviewInfo}>
                <Ionicons color={colors.primaryDark} name="information-circle-outline" size={18} />
                <Text style={styles.individualPreviewInfoText}>
                  Hay cantidad impar de parejas: en cada fecha quedara una pareja libre.
                </Text>
              </View>
            ) : null}

            {individualFixturePreview.recommendedRounds > 0 &&
            individualFixturePreview.configuredRounds !== individualFixturePreview.recommendedRounds ? (
              <View style={styles.individualPreviewInfo}>
                <Ionicons color={colors.primaryDark} name="calendar-outline" size={18} />
                <Text style={styles.individualPreviewInfoText}>
                  Para {individualFixturePreview.pairedTeamsCount} parejas, lo optimo es jugar{" "}
                  {individualFixturePreview.recommendedRounds} fecha(s). Configuraste{" "}
                  {individualFixturePreview.configuredRounds || 0}. Puedes continuar igual o cambiarlo desde{" "}
                  <Text
                    onPress={handleGoToManageFromIndividualPreview}
                    style={styles.individualPreviewManageLink}
                  >
                    Editar liga
                  </Text>
                  .
                </Text>
              </View>
            ) : null}

            <ScrollView
              persistentScrollbar
              showsVerticalScrollIndicator
              style={styles.individualPreviewBodyScroll}
            >
            <View style={styles.individualPreviewLists}>
              <View style={styles.individualPreviewListCard}>
                <Text style={styles.individualPreviewListTitle}>Drive</Text>
                <ScrollView
                  nestedScrollEnabled
                  persistentScrollbar
                  showsVerticalScrollIndicator
                  style={styles.individualPreviewPlayersList}
                >
                  {individualFixturePreview.drivePlayers.map((player) => (
                    <View key={player.id || player.linkedUserId} style={styles.individualPreviewPlayerRow}>
                      <Text numberOfLines={1} style={styles.individualPreviewPlayerName}>
                        {formatPlayerShortName(player)}
                      </Text>
                      <Pressable
                        disabled={savingIndividualSideId === (player.id || player.linkedUserId)}
                        onPress={() => handleChangeIndividualPlayerSide(player, "reves")}
                        style={({ pressed }) => [
                          styles.individualPreviewSideButton,
                          pressed ? styles.generateButtonPressed : null,
                        ]}
                      >
                        <Ionicons color={colors.primaryDark} name="arrow-forward" size={16} />
                      </Pressable>
                    </View>
                  ))}
                </ScrollView>
              </View>
              <View style={styles.individualPreviewListCard}>
                <Text style={styles.individualPreviewListTitle}>Reves</Text>
                <ScrollView
                  nestedScrollEnabled
                  persistentScrollbar
                  showsVerticalScrollIndicator
                  style={styles.individualPreviewPlayersList}
                >
                  {individualFixturePreview.revesPlayers.map((player) => (
                    <View key={player.id || player.linkedUserId} style={styles.individualPreviewPlayerRow}>
                      <Text numberOfLines={1} style={styles.individualPreviewPlayerName}>
                        {formatPlayerShortName(player)}
                      </Text>
                      <Pressable
                        disabled={savingIndividualSideId === (player.id || player.linkedUserId)}
                        onPress={() => handleChangeIndividualPlayerSide(player, "drive")}
                        style={({ pressed }) => [
                          styles.individualPreviewSideButton,
                          pressed ? styles.generateButtonPressed : null,
                        ]}
                      >
                        <Ionicons color={colors.primaryDark} name="arrow-back" size={16} />
                      </Pressable>
                    </View>
                  ))}
                </ScrollView>
              </View>
            </View>
            </ScrollView>

            <View style={styles.modalActionsRow}>
              <Pressable
                onPress={() => setIndividualPreviewVisible(false)}
                style={({ pressed }) => [
                  styles.modalSecondaryButton,
                  pressed ? styles.generateButtonPressed : null,
                ]}
              >
                <Text style={styles.modalSecondaryButtonText}>Cancelar</Text>
              </Pressable>

              {!individualFixturePreview.hasBalancedSides ? (
                <Pressable
                  onPress={() => {
                    setIndividualPreviewVisible(false);
                    navigation.navigate("LeaguePlayers", {
                      leagueId: league?.id,
                      leagueName,
                    });
                  }}
                  style={({ pressed }) => [
                    styles.modalPrimaryButton,
                    pressed ? styles.generateButtonPressed : null,
                  ]}
                >
                  <Text style={styles.modalPrimaryButtonText}>Ir a Jugadores</Text>
                </Pressable>
              ) : (
                <Pressable
                  disabled={individualFixturePreview.pairedTeamsCount < 2}
                  onPress={handleConfirmIndividualFixtureGeneration}
                  style={({ pressed }) => [
                    styles.modalPrimaryButton,
                    individualFixturePreview.pairedTeamsCount < 2 ? styles.saveButtonDisabled : null,
                    pressed && individualFixturePreview.pairedTeamsCount >= 2
                      ? styles.generateButtonPressed
                      : null,
                  ]}
                >
                  <Text style={styles.modalPrimaryButtonText}>Continuar</Text>
                </Pressable>
              )}
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        onRequestClose={handleCloseReplacementPicker}
        transparent
        visible={replacementPickerVisible}
      >
        <View style={styles.modalOverlay}>
          <Pressable onPress={handleCloseReplacementPicker} style={styles.modalBackdrop} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Asignar reemplazo</Text>
            <Text style={styles.modalMessage}>
              Selecciona un jugador registrado o crea uno manual para esta fecha.
            </Text>

            <TextInput
              onChangeText={setReplacementQuery}
              placeholder="Buscar jugador registrado"
              placeholderTextColor={colors.textMuted}
              style={styles.replacementSearchInput}
              value={replacementQuery}
            />

            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={styles.replacementPlayersList}
            >
              {replacementLoading ? (
                <View style={styles.replacementLoadingRow}>
                  <ActivityIndicator color={colors.primaryDark} />
                  <Text style={styles.replacementLoadingText}>Cargando jugadores...</Text>
                </View>
              ) : replacementPlayersFiltered.length ? (
                replacementPlayersFiltered.map((player) => {
                  const alreadyInLeague = isRegisteredPlayerAlreadyInLeague(player);

                  return (
                    <Pressable
                      disabled={alreadyInLeague}
                      key={player.id}
                      onPress={() => handleAssignReplacement(player, "registered")}
                      style={({ pressed }) => [
                        styles.replacementPlayerOption,
                        alreadyInLeague ? styles.replacementPlayerOptionDisabled : null,
                        pressed && !alreadyInLeague ? styles.generateButtonPressed : null,
                      ]}
                    >
                      <View
                        style={[
                          styles.replacementPlayerIcon,
                          alreadyInLeague ? styles.replacementPlayerIconDisabled : null,
                        ]}
                      >
                        <Ionicons
                          color={alreadyInLeague ? colors.textMuted : colors.primaryDark}
                          name="person-outline"
                          size={14}
                        />
                      </View>
                      <View style={styles.replacementPlayerCopy}>
                        <Text
                          style={[
                            styles.replacementPlayerName,
                            alreadyInLeague ? styles.replacementPlayerNameDisabled : null,
                          ]}
                        >
                          {formatPlayerShortName(player)}
                        </Text>
                        <Text style={styles.replacementPlayerMeta}>
                          {alreadyInLeague
                            ? "Ya juega esta liga"
                            : `${player.categoria || "Sin categoria"}${player.ciudad ? ` - ${player.ciudad}` : ""}`}
                        </Text>
                      </View>
                      <Ionicons
                        color={alreadyInLeague ? colors.textMuted : colors.primaryDark}
                        name={alreadyInLeague ? "lock-closed-outline" : "add-circle-outline"}
                        size={18}
                      />
                    </Pressable>
                  );
                })
              ) : (
                <Text style={styles.replacementEmptyText}>
                  No encontramos jugadores registrados con esa busqueda.
                </Text>
              )}
            </ScrollView>

            <View style={styles.replacementGuestCard}>
              <Text style={styles.replacementGuestTitle}>Crear jugador manual</Text>
              <View style={styles.replacementGuestInputsRow}>
                <TextInput
                  onChangeText={setReplacementGuestNombre}
                  placeholder="Nombre"
                  placeholderTextColor={colors.textMuted}
                  style={styles.replacementGuestInput}
                  value={replacementGuestNombre}
                />
                <TextInput
                  onChangeText={setReplacementGuestApellido}
                  placeholder="Apellido"
                  placeholderTextColor={colors.textMuted}
                  style={styles.replacementGuestInput}
                  value={replacementGuestApellido}
                />
              </View>
              <Pressable
                onPress={handleCreateReplacementPlayer}
                style={({ pressed }) => [
                  styles.replacementGuestButton,
                  pressed ? styles.generateButtonPressed : null,
                ]}
              >
                <Ionicons color={colors.surface} name="person-add-outline" size={16} />
                <Text style={styles.replacementGuestButtonText}>Crear y asignar</Text>
              </Pressable>
            </View>

            <Pressable
              onPress={handleCloseReplacementPicker}
              style={({ pressed }) => [
                styles.modalSecondaryButton,
                styles.replacementCloseButton,
                pressed ? styles.generateButtonPressed : null,
              ]}
            >
              <Text style={styles.modalSecondaryButtonText}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <FeedbackModal
        message={feedback.message}
        onClose={closeFeedback}
        title={feedback.title}
        tone={feedback.tone}
        visible={feedback.visible}
      />

      <Modal
        animationType="fade"
        onRequestClose={closeLeagueShareModal}
        transparent
        visible={leagueShareModalVisible}
      >
        <View style={styles.modalOverlay}>
          <Pressable onPress={closeLeagueShareModal} style={styles.modalBackdrop} />
          <View style={styles.leagueShareModalCard}>
            <Text style={styles.modalTitle}>Compartir fixture</Text>
            <Text style={styles.modalMessage}>
              Selecciona las fechas que quieras compartir. Despues podras elegir WhatsApp desde el
              panel de compartir.
            </Text>

            <Pressable
              disabled={leagueShareInProgress}
              onPress={toggleLeagueShareAllRounds}
              style={[
                styles.leagueShareSelectAllButton,
                allLeagueShareRoundsSelected ? styles.leagueShareSelectAllButtonActive : null,
              ]}
            >
              <Ionicons
                color={allLeagueShareRoundsSelected ? colors.surface : "#1F6D69"}
                name={allLeagueShareRoundsSelected ? "checkbox" : "square-outline"}
                size={18}
              />
              <Text
                style={[
                  styles.leagueShareSelectAllButtonText,
                  allLeagueShareRoundsSelected ? styles.leagueShareSelectAllButtonTextActive : null,
                ]}
              >
                {allLeagueShareRoundsSelected ? "Quitar seleccion" : "Seleccionar todas"}
              </Text>
            </Pressable>

            <ScrollView
              contentContainerStyle={styles.leagueShareRoundOptions}
              showsVerticalScrollIndicator={false}
              style={styles.leagueShareRoundOptionsScroll}
            >
              {leagueShareRoundOptions.map((round) => {
                const isSelected = selectedLeagueShareRoundIds.includes(round.id);

                return (
                  <Pressable
                    key={`league-share-option-${round.id}`}
                    disabled={leagueShareInProgress}
                    onPress={() => toggleLeagueShareRound(round.id)}
                    style={[
                      styles.leagueShareRoundOption,
                      isSelected ? styles.leagueShareRoundOptionSelected : null,
                    ]}
                  >
                    <View style={styles.leagueShareRoundOptionCopy}>
                      <Text
                        style={[
                          styles.leagueShareRoundOptionTitle,
                          isSelected ? styles.leagueShareRoundOptionTitleSelected : null,
                        ]}
                      >
                        {round.label}
                      </Text>
                      <Text
                        style={[
                          styles.leagueShareRoundOptionStatus,
                          isSelected ? styles.leagueShareRoundOptionStatusSelected : null,
                        ]}
                      >
                        {round.status}
                      </Text>
                    </View>
                    <Ionicons
                      color={isSelected ? "#1F6D69" : colors.textMuted}
                      name={isSelected ? "checkmark-circle" : "ellipse-outline"}
                      size={20}
                    />
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={styles.leagueShareModalActions}>
              <Pressable
                disabled={leagueShareInProgress}
                onPress={handleShareLeaguePdf}
                style={({ pressed }) => [
                  styles.leagueShareOptionButton,
                  pressed ? styles.generateButtonPressed : null,
                ]}
              >
                <Ionicons color={colors.surface} name="document-text-outline" size={18} />
                <Text style={styles.leagueShareOptionButtonText}>PDF</Text>
              </Pressable>
              <Pressable
                disabled={leagueShareInProgress}
                onPress={handleShareLeagueImages}
                style={({ pressed }) => [
                  styles.leagueShareOptionButton,
                  pressed ? styles.generateButtonPressed : null,
                ]}
              >
                <Ionicons color={colors.surface} name="images-outline" size={18} />
                <Text style={styles.leagueShareOptionButtonText}>
                  {leagueShareInProgress ? "Generando..." : "Imagenes"}
                </Text>
              </Pressable>
            </View>

            <Pressable onPress={closeLeagueShareModal} style={styles.leagueShareCancelButton}>
              <Text style={styles.leagueShareCancelButtonText}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={closeLeagueResultEditor}
        transparent
        visible={Boolean(leagueResultEditor)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.leagueResultModalOverlay}
        >
          <Pressable onPress={closeLeagueResultEditor} style={styles.modalBackdrop} />
          <ScrollView
            contentContainerStyle={styles.leagueResultModalScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.leagueResultModalCard}>
              <Text style={styles.leagueResultModalTitle}>Resultado</Text>
              <Text style={styles.leagueResultModalSubtitle}>
                Selecciona ganador y carga los sets del partido.
              </Text>

              <View style={styles.leagueResultWinnerOptions}>
                {(leagueResultEditor?.participants || []).map((participant, index) => {
                  const isSelected = leagueResultEditor?.winner === participant.id;

                  return (
                    <Pressable
                      key={`league-result-winner-${participant.id}`}
                      onPress={() =>
                        setLeagueResultEditor((current) =>
                          current
                            ? {
                                ...current,
                                winner: isSelected ? "" : participant.id,
                              }
                            : current
                        )
                      }
                      style={[
                        styles.leagueResultWinnerOption,
                        isSelected ? styles.leagueResultWinnerOptionSelected : null,
                      ]}
                    >
                      <Text
                        numberOfLines={2}
                        style={[
                          styles.leagueResultWinnerOptionText,
                          isSelected ? styles.leagueResultWinnerOptionTextSelected : null,
                        ]}
                      >
                        {index + 1}. {participant.label}
                      </Text>
                      {isSelected ? (
                        <Text style={styles.leagueResultWinnerBadge}>GANADOR</Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.leagueResultSetsGrid}>
                {(leagueResultEditor?.sets || []).map((set, setIndex) => (
                  <View key={`league-result-set-${set.key || setIndex}`} style={styles.leagueResultSetRow}>
                    <Text
                      style={[
                        styles.leagueResultSetLabel,
                        set.label === "STB" ? styles.leagueResultSuperTieBreakLabel : null,
                      ]}
                    >
                      {set.label === "STB" ? "SUPER TIE BREAK" : set.label}
                    </Text>
                    <TextInput
                      keyboardType="number-pad"
                      maxLength={set.label === "STB" ? 5 : 3}
                      onChangeText={(value) => updateLeagueResultEditorSet(setIndex, value)}
                      ref={(ref) => {
                        leagueResultSetInputRefs.current[`set-${setIndex}`] = ref;
                      }}
                      style={styles.leagueResultSetInput}
                      value={formatCompactLeagueSetInput(set)}
                    />
                  </View>
                ))}
              </View>

              <View style={styles.leagueResultModalActions}>
                <Pressable onPress={closeLeagueResultEditor} style={styles.modalSecondaryButton}>
                  <Text style={styles.modalSecondaryButtonText}>Cancelar</Text>
                </Pressable>
                <Pressable onPress={saveLeagueResultEditor} style={styles.modalPrimaryButton}>
                  <Text style={styles.modalPrimaryButtonText}>Guardar</Text>
                </Pressable>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={closeLeagueMatchDayPicker}
        transparent
        visible={Boolean(leagueMatchDayPickerTarget)}
      >
        <View style={styles.leagueDayPickerModalOverlay}>
          <Pressable onPress={closeLeagueMatchDayPicker} style={styles.modalBackdrop} />
          <View style={styles.leagueDayPickerModalCard}>
            <Text style={styles.leagueDayPickerModalTitle}>Seleccionar dia</Text>
            <View style={styles.leagueDayPickerMatchSummary}>
              <Text numberOfLines={2} style={styles.leagueDayPickerPairText}>
                {leagueMatchDayPickerTarget?.participants?.[0] || "Pareja A"}
              </Text>
              <Text style={styles.leagueDayPickerVsText}>VS</Text>
              <Text numberOfLines={2} style={styles.leagueDayPickerPairText}>
                {leagueMatchDayPickerTarget?.participants?.[1] || "Pareja B"}
              </Text>
            </View>
            <View style={styles.leagueDayPickerOptions}>
              {leagueFixtureDayOptions.map((day) => {
                const isSelected =
                  day.dateMillis === leagueMatchDayPickerTarget?.currentDateMillis;

                return (
                  <Pressable
                    key={`league-match-day-${day.dateMillis}`}
                    onPress={() => selectLeagueMatchDay(day.dateMillis)}
                    style={[
                      styles.leagueDayPickerOption,
                      isSelected ? styles.leagueDayPickerOptionSelected : null,
                    ]}
                  >
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.leagueDayPickerOptionText,
                        isSelected ? styles.leagueDayPickerOptionTextSelected : null,
                      ]}
                    >
                      {day.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              onPress={closeLeagueMatchDayPicker}
              style={styles.leagueDayPickerCancelButton}
            >
              <Text style={styles.leagueDayPickerCancelButtonText}>Cancelar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={closeTableReplacementMenu}
        transparent
        visible={Boolean(tableReplacementMenuTarget)}
      >
        <View style={styles.modalOverlay}>
          <Pressable onPress={closeTableReplacementMenu} style={styles.modalBackdrop} />
          <View
            style={[
              styles.modalCard,
              styles.tableReplacementModalCard,
              !canEditFixture ? styles.tableReplacementPlayerModalCard : null,
            ]}
          >
            <Text style={styles.modalTitle}>Opciones del partido</Text>
            <Text style={styles.modalMessage}>
              {canEditFixture
                ? "Gestiona remplazos, suspension y reprogramacion sin salir de la tabla."
                : "Solicita remplazo de liga"}
            </Text>

            {canEditFixture && tableReplacementMenuMatch?.match ? (
              <View style={styles.tableMatchManagementActions}>
                {tableReplacementMenuMatch.round?.suspensionMode ? (
                  <Pressable
                    onPress={openTableRetakeSuspendedRound}
                    style={({ pressed }) => [
                      styles.tableMatchRetakeAction,
                      pressed ? styles.generateButtonPressed : null,
                    ]}
                  >
                    <Ionicons color="#176B5B" name="play-forward-circle-outline" size={16} />
                    <Text style={styles.tableMatchRetakeActionText}>
                      Retomar fecha suspendida
                    </Text>
                  </Pressable>
                ) : null}
                {!isMatchCompleted(tableReplacementMenuMatch.match) ? (
                  <Pressable
                    onPress={openTableMatchSuspensionFlow}
                    style={({ pressed }) => [
                      styles.tableMatchSuspensionAction,
                      pressed ? styles.generateButtonPressed : null,
                    ]}
                  >
                    <Ionicons color="#8A5A13" name="calendar-outline" size={16} />
                    <Text style={styles.tableMatchSuspensionActionText}>
                      {tableReplacementMenuMatch.round?.suspensionMode
                        ? "Reprogramar partido puntual"
                        : tableReplacementMenuMatch.match.suspensionMode
                        ? "Reprogramar partido"
                        : "Suspender o reprogramar"}
                    </Text>
                  </Pressable>
                ) : null}
                {hasRoundSuspensionData(tableReplacementMenuMatch.round) ||
                hasRoundSuspensionData({ matches: [tableReplacementMenuMatch.match] }) ? (
                  <Pressable
                    onPress={clearTableMatchSuspension}
                    style={({ pressed }) => [
                      styles.tableMatchClearSuspensionAction,
                      pressed ? styles.generateButtonPressed : null,
                    ]}
                  >
                    <Ionicons color="#A44747" name="refresh-circle-outline" size={17} />
                    <Text style={styles.tableMatchClearSuspensionActionText}>
                      {shouldClearWholeRoundSuspension(tableReplacementMenuMatch.round)
                        ? "Quitar suspension de la fecha"
                        : "Quitar suspension del partido"}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            <Text style={styles.tableReplacementSectionTitle}>REMPLAZOS</Text>
            <ScrollView
              contentContainerStyle={styles.tableReplacementPlayersContent}
              showsVerticalScrollIndicator={false}
              style={styles.tableReplacementPlayersScroll}
            >
              {(() => {
                const match = tableReplacementMenuMatch?.match;
                const round = tableReplacementMenuMatch?.round;

                if (!match || !round) {
                  return null;
                }

                const entries = [
                  { team: match.teamA, teamKey: "teamA" },
                  { team: match.teamB, teamKey: "teamB" },
                ].flatMap(({ team, teamKey }) =>
                  (team?.players || []).map((player, playerIndex) => {
                    const replacementKey = getPlayerReplacementKey(teamKey, player, playerIndex);
                    const replacementEntry = match.replacements?.[replacementKey];

                    return {
                      canManage:
                        canEditFixture ||
                        (canRequestOwnReplacement && isCurrentUserFixturePlayer(player)),
                      player,
                      playerIndex,
                      replacementEntry,
                      replacementKey,
                      teamKey,
                    };
                  })
                );
                const visibleEntries = entries.filter((entry) => entry.canManage);

                if (!visibleEntries.length) {
                  return (
                    <Text style={styles.tableReplacementEmptyText}>
                      No hay acciones de remplazo disponibles para este partido.
                    </Text>
                  );
                }

                return visibleEntries.map((entry) => {
                  const hasRequest = Boolean(entry.replacementEntry?.requested);
                  const replacementPlayer = entry.replacementEntry?.replacement;
                  const canChangeRequest = !match.result?.winner && !hasMatchResultData(match);

                  return (
                    <View key={entry.replacementKey} style={styles.tableReplacementPlayerCard}>
                      <View style={styles.tableReplacementPlayerHeader}>
                        <View style={styles.tableReplacementPlayerCopy}>
                          <Text numberOfLines={1} style={styles.tableReplacementPlayerName}>
                            {formatPlayerShortName(entry.player)}
                          </Text>
                          <Text
                            style={[
                              styles.tableReplacementStatusText,
                              hasRequest && !replacementPlayer
                                ? styles.tableReplacementStatusPending
                                : null,
                              replacementPlayer ? styles.tableReplacementStatusAssigned : null,
                            ]}
                          >
                            {replacementPlayer
                              ? `Remplazo: ${formatPlayerShortName(replacementPlayer)}`
                              : hasRequest
                              ? "Remplazo solicitado"
                              : "Sin solicitud"}
                          </Text>
                        </View>
                        <Ionicons
                          color={
                            replacementPlayer
                              ? "#23825B"
                              : hasRequest
                              ? "#D47713"
                              : colors.textMuted
                          }
                          name={
                            replacementPlayer
                              ? "checkmark-circle"
                              : hasRequest
                              ? "alert-circle"
                              : "swap-horizontal-outline"
                          }
                          size={20}
                        />
                      </View>

                      {canChangeRequest ? (
                        <View style={styles.tableReplacementActionsRow}>
                          {!hasRequest ? (
                            <Pressable
                              onPress={() =>
                                toggleTableReplacementRequest({
                                  match,
                                  player: entry.player,
                                  playerIndex: entry.playerIndex,
                                  roundId: round.id,
                                  roundTitle: round.title || `Fecha ${round.number || ""}`.trim(),
                                  teamKey: entry.teamKey,
                                })
                              }
                              style={styles.tableReplacementPrimaryAction}
                            >
                              <Text style={styles.tableReplacementPrimaryActionText}>
                                Solicitar remplazo
                              </Text>
                            </Pressable>
                          ) : null}

                          {hasRequest && canEditFixture ? (
                            <Pressable
                              onPress={() =>
                                openTableReplacementPicker({
                                  matchId: match.id,
                                  replacementKey: entry.replacementKey,
                                  roundId: round.id,
                                })
                              }
                              style={styles.tableReplacementPrimaryAction}
                            >
                              <Text style={styles.tableReplacementPrimaryActionText}>
                                {replacementPlayer ? "Cambiar remplazo" : "Asignar remplazo"}
                              </Text>
                            </Pressable>
                          ) : null}

                          {hasRequest && (canEditFixture || !replacementPlayer) ? (
                            <Pressable
                              onPress={() =>
                                replacementPlayer
                                  ? removeTableReplacement({
                                      matchId: match.id,
                                      playerName: formatPlayerShortName(replacementPlayer),
                                      replacementKey: entry.replacementKey,
                                      roundId: round.id,
                                    })
                                  : canEditFixture
                                  ? toggleTableReplacementRequest({
                                      match,
                                      player: entry.player,
                                      playerIndex: entry.playerIndex,
                                      roundId: round.id,
                                      roundTitle: round.title || `Fecha ${round.number || ""}`.trim(),
                                      teamKey: entry.teamKey,
                                    })
                                  : cancelTablePlayerReplacementRequest(
                                      buildReplacementTargetFromMatchPlayer({
                                        match,
                                        player: entry.player,
                                        playerIndex: entry.playerIndex,
                                        roundId: round.id,
                                        roundTitle:
                                          round.title || `Fecha ${round.number || ""}`.trim(),
                                        teamKey: entry.teamKey,
                                      })
                                    )
                              }
                              style={styles.tableReplacementSecondaryAction}
                            >
                              <Text style={styles.tableReplacementSecondaryActionText}>
                                Cancelar solicitud
                              </Text>
                            </Pressable>
                          ) : null}
                        </View>
                      ) : (
                        <Text style={styles.tableReplacementLockedText}>
                          El partido ya tiene resultados y no admite cambios de remplazo.
                        </Text>
                      )}
                    </View>
                  );
                });
              })()}
            </ScrollView>

            <Pressable onPress={closeTableReplacementMenu} style={styles.modalSecondaryButton}>
              <Text style={styles.modalSecondaryButtonText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={goToPaymentsPromptVisible}
        onRequestClose={() => setGoToPaymentsPromptVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            onPress={() => setGoToPaymentsPromptVisible(false)}
            style={styles.modalBackdrop}
          />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Ir a pagos de la liga</Text>
            <Text style={styles.modalMessage}>
              Los resultados quedaron guardados. ¿Querés revisar ahora los pagos de esta liga?
            </Text>
            <View style={styles.modalActionsRow}>
              <Pressable
                onPress={() => setGoToPaymentsPromptVisible(false)}
                style={({ pressed }) => [
                  styles.modalSecondaryButton,
                  pressed ? styles.generateButtonPressed : null,
                ]}
              >
                <Text style={styles.modalSecondaryButtonText}>Ahora no</Text>
              </Pressable>
              <Pressable
                onPress={handleGoToPayments}
                style={({ pressed }) => [
                  styles.modalPaymentsButton,
                  pressed ? styles.generateButtonPressed : null,
                ]}
              >
                <Text style={styles.modalPrimaryButtonText}>Ir a pagos</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={closeWhatsAppSharePrompt}
        transparent
        visible={whatsAppSharePrompt.visible}
      >
        <View style={styles.modalOverlay}>
          <Pressable onPress={closeWhatsAppSharePrompt} style={styles.modalBackdrop} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Notificar por WhatsApp</Text>
            <Text style={styles.modalMessage}>
              Se notifico a los participantes por mensajeria interna. Deseas enviarlo tambien por
              WhatsApp?
            </Text>
            <View style={styles.modalActionsRow}>
              <Pressable
                onPress={closeWhatsAppSharePrompt}
                style={({ pressed }) => [
                  styles.modalSecondaryButton,
                  pressed ? styles.generateButtonPressed : null,
                ]}
              >
                <Text style={styles.modalSecondaryButtonText}>No</Text>
              </Pressable>
              <Pressable
                onPress={handleShareSuspensionByWhatsApp}
                style={({ pressed }) => [
                  styles.whatsAppShareButton,
                  pressed ? styles.generateButtonPressed : null,
                ]}
              >
                <Text style={styles.whatsAppShareButtonText}>Enviar por WhatsApp</Text>
              </Pressable>
            </View>
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
  backgroundOrbTop: {
    position: "absolute",
    top: -40,
    right: -30,
    width: 210,
    height: 210,
    borderRadius: 999,
    backgroundColor: "rgba(31,171,137,0.12)",
  },
  backgroundOrbBottom: {
    position: "absolute",
    left: -70,
    bottom: 110,
    width: 240,
    height: 240,
    borderRadius: 999,
    backgroundColor: "rgba(31,171,137,0.09)",
  },
  content: {
    paddingHorizontal: 6,
    paddingTop: spacing.sm,
    paddingBottom: BOTTOM_QUICK_ACTIONS_SPACE + 190,
    gap: spacing.sm,
  },
  loaderWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  loaderText: {
    color: colors.textMuted,
  },
  heroMeta: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.primaryDark,
    textAlign: "center",
  },
  warningCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "#FFF1F1",
    borderWidth: 1,
    borderColor: "#F2CACA",
    borderRadius: 18,
    padding: spacing.md,
  },
  warningText: {
    flex: 1,
    color: "#8C2D2D",
    fontSize: 13,
    lineHeight: 18,
  },
  leagueMigrationTable: {
    backgroundColor: colors.surface,
    borderColor: "#BCD8D4",
    borderRadius: 10,
    borderWidth: 1,
    marginTop: spacing.sm,
    overflow: "hidden",
  },
  leagueMigrationRoundWrap: {
    marginBottom: spacing.sm,
  },
  leagueMigrationRoundWrapFocused: {
    borderColor: "#FF9F1C",
    borderRadius: 11,
    borderWidth: 2,
  },
  leagueMigrationDateHeading: {
    alignItems: "center",
    backgroundColor: "#CDE9E3",
    borderBottomColor: "#9FCFC3",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    minHeight: 34,
    paddingHorizontal: spacing.sm,
  },
  leagueMigrationDateHeadingText: {
    color: "#1E5F57",
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
  },
  leagueMigrationDateStatus: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
  },
  leagueMigrationDateStatusDot: {
    borderRadius: 4,
    height: 7,
    width: 7,
  },
  leagueMigrationDateStatusDotpending: {
    backgroundColor: "#7D8987",
  },
  leagueMigrationDateStatusDotplayed: {
    backgroundColor: "#3A9A82",
  },
  leagueMigrationDateStatusDotsuspended: {
    backgroundColor: "#C76464",
  },
  leagueMigrationDateStatusDotreprogrammed: {
    backgroundColor: "#D68A2D",
  },
  leagueMigrationDateStatusText: {
    fontSize: 8,
    fontWeight: "900",
  },
  leagueMigrationDateStatusTextpending: {
    color: "#596563",
  },
  leagueMigrationDateStatusTextplayed: {
    color: "#24725E",
  },
  leagueMigrationDateStatusTextsuspended: {
    color: "#994646",
  },
  leagueMigrationDateStatusTextreprogrammed: {
    color: "#9A601C",
  },
  leagueMigrationTableHeader: {
    alignItems: "center",
    backgroundColor: "#DCEFEB",
    borderBottomColor: "#BCD8D4",
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: 32,
    paddingHorizontal: 3,
  },
  leagueMigrationTableHeaderText: {
    color: "#285E59",
    fontSize: 8,
    fontWeight: "900",
    textAlign: "center",
  },
  leagueMigrationTableRow: {
    alignItems: "center",
    borderBottomColor: "#E4ECEA",
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: 58,
    paddingHorizontal: 3,
    paddingVertical: 6,
  },
  leagueMigrationTableRowLast: {
    borderBottomWidth: 0,
  },
  leagueMigrationTableCell: {
    color: colors.text,
    fontSize: 9,
    fontWeight: "800",
    paddingHorizontal: 2,
    textAlign: "center",
    textTransform: "capitalize",
  },
  leagueMigrationResultColumn: {
    flex: 0.8,
  },
  leagueMigrationResultButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 2,
  },
  leagueMigrationResultButtonText: {
    color: "#176B5B",
    textDecorationLine: "underline",
  },
  leagueMigrationPairsColumn: {
    alignItems: "center",
    flex: 2.65,
    justifyContent: "space-between",
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  leagueMigrationTeamWrap: {
    alignItems: "center",
    gap: 1,
    minHeight: 20,
    width: "100%",
  },
  leagueMigrationTeamRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    minHeight: 16,
  },
  leagueMigrationTeamRowTopAligned: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "center",
    minHeight: 16,
  },
  leagueMigrationCompactTeamWrap: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 2,
    justifyContent: "center",
    maxWidth: "100%",
  },
  leagueMigrationWinnerIconSlot: {
    alignItems: "center",
    justifyContent: "flex-start",
    minHeight: 14,
    width: 14,
  },
  leagueMigrationWinnerIcon: {
    marginRight: 3,
    marginTop: 1,
  },
  leagueMigrationPlayerSlot: {
    alignItems: "center",
    flexShrink: 1,
    minWidth: 0,
  },
  leagueMigrationPlayerStatusRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 2,
    justifyContent: "center",
    maxWidth: "100%",
  },
  leagueMigrationPairSeparator: {
    color: colors.textMuted,
    fontSize: 8,
    fontWeight: "900",
    lineHeight: 13,
  },
  leagueMigrationPairText: {
    color: colors.text,
    flexShrink: 1,
    fontSize: 9,
    fontWeight: "800",
    textAlign: "center",
  },
  leagueMigrationPlayerRequested: {
    color: "#A85B0E",
  },
  leagueMigrationPlayerReplaced: {
    color: colors.textMuted,
    textDecorationLine: "line-through",
  },
  leagueMigrationReplacementPlayerText: {
    color: "#247653",
    fontSize: 8,
    fontWeight: "900",
    minHeight: 10,
    textAlign: "center",
  },
  leagueMigrationReplacementPlaceholder: {
    fontSize: 8,
    minHeight: 10,
  },
  leagueMigrationDayColumn: {
    flex: 0.58,
  },
  leagueMigrationTimeColumn: {
    flex: 0.48,
  },
  leagueMigrationActionsColumn: {
    alignItems: "center",
    flex: 0.34,
    justifyContent: "center",
  },
  leagueMigrationActionsButton: {
    minHeight: 34,
    position: "relative",
  },
  leagueMigrationReplacementPendingDot: {
    backgroundColor: "#E88319",
    borderColor: colors.surface,
    borderRadius: 5,
    borderWidth: 1,
    height: 8,
    position: "absolute",
    right: 5,
    top: 4,
    width: 8,
  },
  leagueMigrationReplacementAssignedDot: {
    backgroundColor: "#2A9A6B",
    borderColor: colors.surface,
    borderRadius: 5,
    borderWidth: 1,
    height: 8,
    position: "absolute",
    right: 5,
    top: 4,
    width: 8,
  },
  leagueMigrationScheduleButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 34,
    paddingHorizontal: 2,
  },
  leagueMigrationScheduleButtonText: {
    color: "#176B5B",
    textDecorationLine: "underline",
  },
  leagueShareHiddenRoot: {
    left: -9999,
    opacity: 0,
    position: "absolute",
    top: 0,
    width: 900,
  },
  leagueShareCaptureCard: {
    backgroundColor: "#F4F7F6",
    padding: 20,
    width: 900,
  },
  leagueShareHeader: {
    marginBottom: 14,
  },
  leagueShareHeaderRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "center",
  },
  leagueShareHeaderCopy: {
    alignItems: "flex-start",
    justifyContent: "center",
  },
  leagueShareLogo: {
    borderRadius: 14,
    height: 48,
    width: 48,
  },
  leagueShareTitle: {
    color: "#173633",
    fontSize: 22,
    fontWeight: "900",
    textAlign: "left",
  },
  leagueShareSubtitle: {
    color: "#4C6460",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
    textAlign: "left",
  },
  leagueShareRoundCard: {
    backgroundColor: colors.surface,
    borderColor: "#CFE0DC",
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 16,
    overflow: "hidden",
  },
  leagueShareRoundHeader: {
    alignItems: "center",
    backgroundColor: "#DCEFEB",
    borderBottomColor: "#C7DEDA",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  leagueShareRoundTitle: {
    color: "#285E59",
    fontSize: 16,
    fontWeight: "900",
  },
  leagueShareRoundStatus: {
    borderRadius: 999,
    fontSize: 11,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  leagueShareRoundStatuspending: {
    backgroundColor: "#EEF2F1",
    color: "#596563",
  },
  leagueShareRoundStatusplayed: {
    backgroundColor: "#DFF4EE",
    color: "#24725E",
  },
  leagueShareRoundStatussuspended: {
    backgroundColor: "#FFF0F0",
    color: "#994646",
  },
  leagueShareRoundStatusreprogrammed: {
    backgroundColor: "#FFF3E3",
    color: "#9A601C",
  },
  leagueShareTableHeader: {
    alignItems: "center",
    backgroundColor: "#EFF7F5",
    borderBottomColor: "#E3ECEA",
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: 34,
    paddingHorizontal: 8,
  },
  leagueShareTableHeaderText: {
    color: "#285E59",
    fontSize: 10,
    fontWeight: "900",
    textAlign: "center",
  },
  leagueShareTableRow: {
    alignItems: "center",
    borderBottomColor: "#E3ECEA",
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: 56,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  leagueShareTableRowLast: {
    borderBottomWidth: 0,
  },
  leagueShareTableCell: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "800",
    lineHeight: 16,
    paddingHorizontal: 4,
    textAlign: "center",
    textTransform: "capitalize",
  },
  leagueShareResultColumn: {
    flex: 0.9,
  },
  leagueSharePairsColumn: {
    flex: 2.8,
  },
  leagueShareDayColumn: {
    flex: 1.05,
  },
  leagueShareTimeColumn: {
    flex: 0.7,
  },
  leagueResultModalOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
  },
  leagueResultModalScrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  leagueResultModalCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    padding: spacing.lg,
    width: "100%",
  },
  leagueResultModalTitle: {
    color: colors.primaryDark,
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center",
  },
  leagueResultModalSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  leagueResultWinnerOptions: {
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  leagueResultWinnerOption: {
    alignItems: "center",
    backgroundColor: "#F7FAF8",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: spacing.sm,
  },
  leagueResultWinnerOptionSelected: {
    backgroundColor: "#DDF6EF",
    borderColor: "#89D9C4",
  },
  leagueResultWinnerOptionText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
  },
  leagueResultWinnerOptionTextSelected: {
    color: "#176B5B",
  },
  leagueResultWinnerBadge: {
    color: "#176B5B",
    fontSize: 9,
    fontWeight: "900",
    marginTop: 2,
  },
  leagueResultSetsGrid: {
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  leagueResultSetRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
  },
  leagueResultSetLabel: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "900",
    textAlign: "right",
    width: 102,
  },
  leagueResultSuperTieBreakLabel: {
    fontSize: 10,
    lineHeight: 12,
  },
  leagueResultSetInput: {
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
  leagueResultModalActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  leagueDayPickerModalOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  leagueDayPickerModalCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    padding: spacing.md,
    width: "100%",
  },
  leagueDayPickerModalTitle: {
    color: colors.primaryDark,
    fontSize: 16,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "uppercase",
  },
  leagueDayPickerMatchSummary: {
    alignItems: "center",
    backgroundColor: "#F7FAF8",
    borderColor: colors.border,
    borderRadius: 13,
    borderWidth: 1,
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  leagueDayPickerPairText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
  },
  leagueDayPickerVsText: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: "900",
    marginVertical: 2,
  },
  leagueDayPickerOptions: {
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  leagueDayPickerOption: {
    alignItems: "center",
    backgroundColor: "#F7FAF8",
    borderColor: colors.border,
    borderRadius: 13,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: spacing.sm,
  },
  leagueDayPickerOptionSelected: {
    backgroundColor: "#E1F4F0",
    borderColor: "#9FD6CF",
  },
  leagueDayPickerOptionText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "capitalize",
  },
  leagueDayPickerOptionTextSelected: {
    color: "#1F6D69",
  },
  leagueDayPickerCancelButton: {
    alignItems: "center",
    backgroundColor: "#EEF2F4",
    borderRadius: 13,
    justifyContent: "center",
    marginTop: spacing.md,
    minHeight: 42,
  },
  leagueDayPickerCancelButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  tableReplacementModalCard: {
    maxHeight: "82%",
  },
  tableReplacementPlayerModalCard: {
    minHeight: 360,
    justifyContent: "flex-start",
  },
  tableMatchManagementActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  tableMatchSuspensionAction: {
    alignItems: "center",
    backgroundColor: "#FFF6E8",
    borderColor: "#E4C48F",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    flexGrow: 1,
    gap: 5,
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: spacing.sm,
  },
  tableMatchSuspensionActionText: {
    color: "#8A5A13",
    fontSize: 10,
    fontWeight: "900",
    textAlign: "center",
  },
  tableMatchRetakeAction: {
    alignItems: "center",
    backgroundColor: "#E8F6F1",
    borderColor: "#9CCFC2",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    flexGrow: 1,
    gap: 5,
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: spacing.sm,
  },
  tableMatchRetakeActionText: {
    color: "#176B5B",
    fontSize: 10,
    fontWeight: "900",
    textAlign: "center",
  },
  tableMatchClearSuspensionAction: {
    alignItems: "center",
    backgroundColor: "#FFF2F2",
    borderColor: "#E2B4B4",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    flexGrow: 1,
    gap: 5,
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: spacing.sm,
  },
  tableMatchClearSuspensionActionText: {
    color: "#A44747",
    fontSize: 10,
    fontWeight: "900",
    textAlign: "center",
  },
  tableReplacementSectionTitle: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "900",
    marginTop: spacing.md,
    textAlign: "center",
  },
  tableReplacementPlayersScroll: {
    flexGrow: 0,
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
  tableReplacementPlayersContent: {
    gap: spacing.sm,
    paddingVertical: 2,
  },
  tableReplacementPlayerCard: {
    backgroundColor: "#F7FAF8",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  tableReplacementPlayerHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  tableReplacementPlayerCopy: {
    alignItems: "center",
    flex: 1,
  },
  tableReplacementPlayerName: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
  },
  tableReplacementStatusText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "800",
    marginTop: 2,
    textAlign: "center",
  },
  tableReplacementStatusPending: {
    color: "#A85B0E",
  },
  tableReplacementStatusAssigned: {
    color: "#247653",
  },
  tableReplacementActionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  tableReplacementPrimaryAction: {
    alignItems: "center",
    backgroundColor: "#DDF1EC",
    borderColor: "#9CCFC2",
    borderRadius: 9,
    borderWidth: 1,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 34,
    paddingHorizontal: spacing.sm,
  },
  tableReplacementPrimaryActionText: {
    color: "#176B5B",
    fontSize: 10,
    fontWeight: "900",
    textAlign: "center",
  },
  tableReplacementSecondaryAction: {
    alignItems: "center",
    backgroundColor: "#FFF4EF",
    borderColor: "#E7B9A7",
    borderRadius: 9,
    borderWidth: 1,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 34,
    paddingHorizontal: spacing.sm,
  },
  tableReplacementSecondaryActionText: {
    color: "#A44747",
    fontSize: 10,
    fontWeight: "900",
    textAlign: "center",
  },
  tableReplacementLockedText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "700",
    lineHeight: 14,
    textAlign: "center",
  },
  tableReplacementEmptyText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    paddingVertical: spacing.md,
    textAlign: "center",
  },
  fixtureOptionsCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  fixtureOptionsTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
  },
  fixtureStartDateButton: {
    alignItems: "center",
    backgroundColor: "#F4FAF7",
    borderColor: "#CFE2D8",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 54,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  fixtureStartDateIcon: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  fixtureStartDateCopy: {
    flex: 1,
  },
  fixtureStartDateLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "900",
  },
  fixtureStartDateValue: {
    color: colors.primaryDark,
    fontSize: 15,
    fontWeight: "900",
    marginTop: 2,
  },
  fixtureSetupOptions: {
    gap: spacing.sm,
  },
  fixtureSetupOption: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: 4,
    minHeight: 94,
    justifyContent: "center",
    padding: spacing.md,
  },
  fixtureSetupOptionActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  fixtureSetupOptionTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
  },
  fixtureSetupOptionTitleActive: {
    color: colors.surface,
  },
  fixtureSetupOptionText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
    textAlign: "center",
  },
  fixtureSetupOptionTextActive: {
    color: "rgba(255,255,255,0.82)",
  },
  fixtureOptionRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  fixtureOptionChip: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  fixtureOptionChipActive: {
    backgroundColor: "#DDF7E6",
    borderColor: "#7ED59A",
  },
  fixtureOptionChipText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  fixtureOptionChipTextActive: {
    color: colors.primaryDark,
  },
  fixtureOptionsHint: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
    textAlign: "center",
  },
  visibilitySwitchRow: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    minHeight: 54,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  visibilitySwitchCopy: {
    flex: 1,
  },
  visibilitySwitchLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  visibilitySwitchHint: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
  visibilitySwitchTrack: {
    width: 54,
    height: 30,
    borderRadius: 999,
    backgroundColor: "#D9DEE4",
    padding: 3,
    justifyContent: "center",
  },
  visibilitySwitchTrackActive: {
    backgroundColor: colors.primaryDark,
  },
  visibilitySwitchThumb: {
    width: 24,
    height: 24,
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  visibilitySwitchThumbActive: {
    alignSelf: "flex-end",
  },
  generateButton: {
    minHeight: 50,
    borderRadius: 18,
    backgroundColor: colors.primaryDark,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.sm,
  },
  generateButtonPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  generateButtonText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: "800",
  },
  generateNextRoundButton: {
    alignItems: "center",
    backgroundColor: "#DDF7E6",
    borderColor: "#7ED59A",
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
  },
  generateNextRoundButtonText: {
    color: colors.primaryDark,
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.text,
  },
  emptyText: {
    color: colors.textMuted,
    lineHeight: 20,
  },
  manualTeamCard: {
    alignItems: "center",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "48%",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 22,
    paddingHorizontal: 6,
    paddingVertical: 1,
    position: "relative",
  },
  manualTeamCopy: {
    width: "100%",
  },
  manualTeamRow: {
    alignItems: "center",
    borderBottomColor: "#D7DEE5",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "center",
    minHeight: 30,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  manualTeamRowLast: {
    borderBottomWidth: 0,
  },
  manualTeamPlayers: {
    flex: 1,
    fontSize: 13,
    fontWeight: "800",
    color: colors.text,
    textAlign: "center",
  },
  removePairButton: {
    position: "absolute",
    right: spacing.sm,
    top: spacing.sm,
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF2F2",
    borderWidth: 1,
    borderColor: "#F1D0D0",
  },
  unassignedHeader: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  unassignedTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.text,
  },
  inlineActionButton: {
    minHeight: 34,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    justifyContent: "center",
    backgroundColor: "#E6F7ED",
    borderWidth: 1,
    borderColor: "#B4E0C1",
  },
  inlineActionText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
  },
  playerSelectionWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  playerChip: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    justifyContent: "center",
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  playerChipActive: {
    backgroundColor: "#DDF7E6",
    borderColor: "#81D89F",
  },
  playerChipText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  playerChipTextActive: {
    color: colors.primaryDark,
  },
  helperText: {
    color: colors.textMuted,
    lineHeight: 18,
    fontSize: 12,
  },
  manualTeamsActionsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  secondaryActionButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF2F2",
    borderWidth: 1,
    borderColor: "#F1D0D0",
  },
  secondaryActionText: {
    color: "#A44747",
    fontWeight: "800",
  },
  primaryActionButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primaryDark,
  },
  primaryActionText: {
    color: colors.surface,
    fontWeight: "800",
  },
  roundCard: {
    borderRadius: 18,
    padding: 8,
    borderWidth: 1,
    gap: spacing.sm,
  },
  roundCardTone1: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E2E2E2",
  },
  roundCardTone2: {
    backgroundColor: "#F0F0F0",
    borderColor: "#D0D0D0",
  },
  roundCardTone3: {
    backgroundColor: "#E2E2E2",
    borderColor: "#BEBEBE",
  },
  roundCardTone4: {
    backgroundColor: "#D4D4D4",
    borderColor: "#ACACAC",
  },
  roundCardTone5: {
    backgroundColor: "#C6C6C6",
    borderColor: "#9A9A9A",
  },
  roundCardTone6: {
    backgroundColor: "#B8B8B8",
    borderColor: "#888888",
  },
  roundCardTone7: {
    backgroundColor: "#AAAAAA",
    borderColor: "#767676",
  },
  roundCardTone8: {
    backgroundColor: "#9C9C9C",
    borderColor: "#646464",
  },
  roundCardTone9: {
    backgroundColor: "#8E8E8E",
    borderColor: "#525252",
  },
  roundCardTone10: {
    backgroundColor: "#808080",
    borderColor: "#404040",
  },
  roundCardTone11: {
    backgroundColor: "#727272",
    borderColor: "#333333",
  },
  roundCardTone12: {
    backgroundColor: "#646464",
    borderColor: "#262626",
  },
  roundHistoryCard: {
    backgroundColor: "#E7E7E7",
    borderColor: "#BDBDBD",
    gap: 0,
    opacity: 0.92,
    paddingVertical: 6,
  },
  roundHistoryRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    justifyContent: "center",
  },
  roundReprogrammedCard: {
    backgroundColor: "#EAF8EF",
    borderColor: "#9AD8B3",
  },
  pairsOverviewCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    gap: 2,
    padding: 6,
  },
  pairsCompactList: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  pairsOverviewHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    marginBottom: 0,
    minHeight: 42,
  },
  pairsOverviewCopy: {
    alignItems: "center",
    flex: 1,
  },
  pairsOverviewTitle: {
    color: "#021F42",
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.8,
    textAlign: "center",
  },
  pairsOverviewCount: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "800",
    textAlign: "center",
  },
  roundToggleButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  roundChevronSpacer: {
    width: 18,
  },
  roundCardFocused: {
    borderColor: "#FF9F1C",
    borderWidth: 2,
  },
  unsavedChangesBanner: {
    alignItems: "center",
    backgroundColor: "#FFF4C7",
    borderColor: "#E0AD23",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  unsavedChangesText: {
    color: "#7D4B00",
    flex: 1,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
  },
  roundHeader: {
    flex: 1,
    alignItems: "center",
    gap: spacing.xs,
    justifyContent: "center",
    paddingHorizontal: 34,
    position: "relative",
    width: "100%",
  },
  roundTitleDateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 4,
  },
  roundTitle: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.surface,
    fontSize: 14,
    fontWeight: "900",
    minHeight: 34,
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 6,
    textAlign: "center",
  },
  roundDatePill: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.surface,
    fontSize: 14,
    fontWeight: "900",
    minHeight: 34,
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 6,
    textAlign: "center",
  },
  roundDatePillSuspended: {
    backgroundColor: "#D12F2F",
    borderColor: "#D12F2F",
    textDecorationLine: "line-through",
  },
  roundHistoryPill: {
    backgroundColor: "#E0E0E0",
    borderColor: "#B8B8B8",
    color: "#5F5F5F",
  },
  roundSuspendedInlinePill: {
    backgroundColor: "#D12F2F",
    borderColor: "#D12F2F",
    borderRadius: 8,
    borderWidth: 1,
    color: colors.surface,
    fontSize: 12,
    fontWeight: "900",
    minHeight: 30,
    overflow: "hidden",
    paddingHorizontal: 6,
    paddingVertical: 5,
    textAlign: "center",
  },
  roundSuspendedHistoryPill: {
    backgroundColor: "#CFCFCF",
    borderColor: "#A8A8A8",
    color: "#5F5F5F",
  },
  roundRescheduledPill: {
    backgroundColor: "#FFE1E1",
    borderColor: "#D12F2F",
    borderRadius: 8,
    borderWidth: 1,
    color: "#B51F1F",
    fontSize: 11,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    textAlign: "center",
  },
  roundRescheduledPillReady: {
    backgroundColor: "#DDF8E8",
    borderColor: "#1E9E52",
    color: "#126236",
  },
  roundReprogrammedInfoWrap: {
    alignItems: "center",
    gap: 3,
  },
  roundReprogrammedInfoRow: {
    alignSelf: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: -2,
    justifyContent: "center",
  },
  roundReprogrammedTitlePill: {
    backgroundColor: "#DDF8E8",
    borderColor: "#1E9E52",
    borderRadius: 8,
    borderWidth: 1,
    color: "#126236",
    fontSize: 11,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    textAlign: "center",
  },
  roundReprogrammedSchedule: {
    color: "#126236",
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "capitalize",
  },
  roundRescheduledDatePill: {
    backgroundColor: "#FFF4C7",
    borderColor: "#E0AD23",
    borderRadius: 8,
    borderWidth: 1,
    color: "#7D4B00",
    fontSize: 11,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    textAlign: "center",
  },
  roundRescheduledDatePillReady: {
    backgroundColor: "#DDF8E8",
    borderColor: "#1E9E52",
    color: "#126236",
  },
  roundOptionsButton: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.72)",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  roundOptionsButtonFloating: {
    position: "absolute",
    right: 0,
    top: 3,
  },
  roundOptionsButtonPressed: {
    opacity: 0.75,
  },
  roundSchedule: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
  roundSuspendedBanner: {
    alignItems: "center",
    alignSelf: "stretch",
    backgroundColor: colors.surface,
    borderColor: "#D12F2F",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  roundReprogrammedBanner: {
    backgroundColor: "#ECF8F0",
    borderColor: "#1E9E52",
  },
  roundSuspendedAlertTriangle: {
    alignItems: "center",
    backgroundColor: "#FFD642",
    borderBottomColor: "#1D1D1D",
    borderLeftColor: "#1D1D1D",
    borderRadius: 5,
    borderRightColor: "#1D1D1D",
    borderTopColor: "#1D1D1D",
    borderWidth: 1,
    height: 24,
    justifyContent: "center",
    transform: [{ rotate: "45deg" }],
    width: 24,
  },
  roundSuspendedAlertTriangleText: {
    color: "#1D1D1D",
    fontSize: 16,
    fontWeight: "900",
    transform: [{ rotate: "-45deg" }],
  },
  roundSuspendedCopy: {
    flex: 1,
    gap: 2,
  },
  roundSuspendedText: {
    color: "#B51F1F",
    fontSize: 15,
    fontWeight: "900",
    textAlign: "center",
  },
  roundReprogrammedText: {
    color: "#126236",
  },
  roundSuspendedReason: {
    color: "#7F1D1D",
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
  },
  roundStatusTiny: {
    width: "100%",
    color: "#4E7F67",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
    marginTop: 2,
    textAlign: "center",
  },
  roundReplacementWarning: {
    alignSelf: "center",
    alignItems: "center",
    backgroundColor: "#FFF0A8",
    borderColor: "#F1C84B",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    minHeight: 24,
    paddingHorizontal: 8,
  },
  roundReplacementWarningText: {
    color: "#8A4B00",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  roundReplacementDesignated: {
    backgroundColor: "#DDF8E8",
    borderColor: "#7ED59A",
  },
  roundReplacementDesignatedText: {
    color: "#1E9E52",
  },
  matchCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 6,
    gap: 8,
  },
  matchDisplayWrap: {
    gap: spacing.sm,
  },
  reprogrammedSectionHeader: {
    alignItems: "center",
    backgroundColor: "#ECF8F0",
    borderColor: "#1E9E52",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  reprogrammedSectionCopy: {
    flex: 1,
    gap: 2,
  },
  reprogrammedSectionTitle: {
    color: "#126236",
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
  },
  reprogrammedSectionText: {
    color: "#1D5F3D",
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
  },
  matchCardTone1: {
    backgroundColor: "#F2FAF5",
    borderColor: "#CFE8D8",
  },
  matchCardTone2: {
    backgroundColor: "#F1F7FB",
    borderColor: "#CDE1EA",
  },
  matchCardTone3: {
    backgroundColor: "#FAF8EC",
    borderColor: "#E7DEB7",
  },
  matchCardTone4: {
    backgroundColor: "#F6F3FA",
    borderColor: "#DED4E8",
  },
  matchHeader: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 40,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  matchTitleStatusWrap: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    paddingRight: spacing.xs,
  },
  matchTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  matchStatusPill: {
    borderRadius: 8,
    fontSize: 10,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 3,
    textAlign: "center",
  },
  matchStatusPillplayed: {
    backgroundColor: "#DDF8E8",
    color: "#126236",
  },
  matchStatusPillpending: {
    backgroundColor: "#EEF2F7",
    color: "#425466",
  },
  matchStatusPillsuspended: {
    backgroundColor: "#FFE1E1",
    color: "#B51F1F",
  },
  matchStatusPillreprogrammed: {
    backgroundColor: "#ECF8F0",
    color: "#126236",
  },
  matchSuspendedBanner: {
    alignItems: "center",
    backgroundColor: "#FFF0F0",
    borderColor: "#D12F2F",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  matchReprogrammedBanner: {
    backgroundColor: "#ECF8F0",
    borderColor: "#1E9E52",
  },
  matchSuspendedText: {
    color: "#B51F1F",
    flex: 1,
    fontSize: 11,
    fontWeight: "900",
    textAlign: "center",
  },
  matchReprogrammedText: {
    color: "#126236",
  },
  matchTimeWrap: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  matchTimeLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  matchTimeSuffix: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
  },
  matchTimeButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    height: 30,
    justifyContent: "center",
    paddingHorizontal: 8,
    width: 82,
  },
  matchTimeButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
  },
  matchTimeButtonPlaceholder: {
    color: colors.textMuted,
  },
  matchTimeInputDisabled: {
    opacity: 0.75,
  },
  matchTeamsRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 4,
  },
  teamColumn: {
    flex: 1,
    minHeight: 84,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingVertical: 5,
    paddingHorizontal: 3,
  },
  teamColumnWinner: {
    backgroundColor: "#E5F8EB",
    borderColor: "#73CB91",
  },
  teamColumnLoser: {
    backgroundColor: "#FFF1F1",
    borderColor: "#E2B1B1",
  },
  vsWrap: {
    width: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  resetWinnerButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  resetWinnerButtonDisabled: {
    opacity: 0.35,
  },
  neutralFistIcon: {
    transform: [{ rotate: "90deg" }],
  },
  teamPlayerName: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: "800",
    color: colors.text,
    textAlign: "center",
  },
  fixturePlayerWrap: {
    alignItems: "center",
    gap: 4,
    maxWidth: "100%",
  },
  fixturePlayerWrapFocused: {
    backgroundColor: "#FFF6E8",
    borderColor: "#FF9F1C",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 5,
  },
  fixturePlayerNameRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    justifyContent: "center",
    maxWidth: "100%",
  },
  teamPlayerNameReplacementRequested: {
    color: colors.danger,
  },
  teamPlayerNameReplaced: {
    textDecorationLine: "line-through",
  },
  replacementToggleButton: {
    alignItems: "center",
    backgroundColor: "#EEF6F0",
    borderColor: "#CDE8D6",
    borderRadius: 999,
    borderWidth: 1,
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  replacementToggleButtonActive: {
    backgroundColor: colors.danger,
    borderColor: colors.danger,
  },
  replacementField: {
    alignItems: "center",
    backgroundColor: "#F7FBF8",
    borderColor: "#CDE8D6",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    maxWidth: 132,
    minHeight: 26,
    paddingHorizontal: 8,
  },
  replacementFieldFilled: {
    backgroundColor: "#E9F8EE",
    borderColor: "#7ED59A",
  },
  replacementFieldText: {
    color: colors.primaryDark,
    flexShrink: 1,
    fontSize: 10,
    fontWeight: "800",
  },
  replacementFieldTextFilled: {
    color: "#1E9E52",
    fontSize: 11,
  },
  replacementRemoveButton: {
    alignItems: "center",
    backgroundColor: "#FFECEC",
    borderColor: "#F2C9C9",
    borderRadius: 999,
    borderWidth: 1,
    height: 20,
    justifyContent: "center",
    marginLeft: 2,
    width: 20,
  },
  teamNameMuted: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
  },
  setsWrap: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
  },
  setColumn: {
    flex: 1,
    alignItems: "center",
    maxWidth: 96,
    gap: 6,
  },
  setLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
  },
  setInputsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  setInput: {
    width: 34,
    minHeight: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    textAlign: "center",
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
    paddingVertical: 0,
  },
  setSlash: {
    color: colors.textMuted,
    fontSize: 15,
    fontWeight: "800",
  },
  byeWrap: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  byeText: {
    color: colors.textMuted,
    fontSize: 13,
  },
  saveButton: {
    minHeight: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  replacementRequestButton: {
    backgroundColor: "#22E044",
    borderColor: "#13B932",
    borderWidth: 1,
  },
  replacementRequestButtonPending: {
    backgroundColor: "#FF9F1C",
    borderColor: "#E27C00",
  },
  replacementRequestButtonDesignated: {
    backgroundColor: "#22E044",
    borderColor: "#13B932",
  },
  stickyActionsWrap: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: BOTTOM_QUICK_ACTIONS_SPACE + 24,
    gap: spacing.sm,
  },
  bottomActionsSpacer: {
    marginTop: spacing.sm,
    gap: spacing.md,
  },
  fixtureDangerActionsRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  saveButtonDisabled: {
    opacity: 0.65,
  },
  saveButtonText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: "800",
  },
  replacementRequestButtonText: {
    color: "#06280F",
  },
  replacementRequestButtonSubtext: {
    color: "#06280F",
    fontSize: 11,
    fontWeight: "800",
    marginTop: 2,
  },
  cancelReplacementButton: {
    alignItems: "center",
    backgroundColor: "#FFF6E8",
    borderColor: "#FF9F1C",
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 42,
  },
  cancelReplacementButtonText: {
    color: "#B85D00",
    fontSize: 13,
    fontWeight: "900",
  },
  deleteFixtureButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#4A4F55",
    borderWidth: 1,
    borderColor: "#2D3136",
    paddingHorizontal: 8,
  },
  deleteFixtureButtonText: {
    color: colors.surface,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
  },
  fixtureStandingsShortcut: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#E6F3F1",
    borderColor: "#B9D9D4",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    marginTop: spacing.sm,
    minHeight: 42,
    paddingHorizontal: spacing.lg,
  },
  fixtureStandingsShortcutText: {
    color: "#1F6D69",
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
  },
  leagueShareShortcut: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#E6F3F1",
    borderColor: "#B9D9D4",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: spacing.sm,
    height: 42,
    width: 42,
  },
  leagueShareShortcutText: {
    color: "#1F6D69",
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
  },
  regenerateFixtureButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#DDE1E5",
    borderWidth: 1,
    borderColor: "#AEB6BE",
    paddingHorizontal: 8,
  },
  regenerateFixtureButtonText: {
    color: "#30363D",
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  modalCard: {
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: "88%",
    padding: spacing.lg,
    gap: spacing.md,
  },
  playerReplacementMenuModalCard: {
    minHeight: 255,
    justifyContent: "center",
  },
  modalTitle: {
    color: colors.text,
    fontSize: 21,
    fontWeight: "800",
    textAlign: "center",
  },
  modalMessage: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  whatsAppSharePreview: {
    backgroundColor: "#F3F8F6",
    borderColor: "#C9DDD5",
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  whatsAppSharePreviewText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
  },
  leagueShareModalCard: {
    width: "100%",
    backgroundColor: colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    maxHeight: "88%",
    padding: spacing.lg,
    gap: spacing.md,
  },
  leagueShareSelectAllButton: {
    alignItems: "center",
    backgroundColor: "#F3FAF8",
    borderColor: "#CDE3DD",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 42,
  },
  leagueShareSelectAllButtonActive: {
    backgroundColor: "#1F6D69",
    borderColor: "#1F6D69",
  },
  leagueShareSelectAllButtonText: {
    color: "#1F6D69",
    fontSize: 13,
    fontWeight: "900",
  },
  leagueShareSelectAllButtonTextActive: {
    color: colors.surface,
  },
  leagueShareRoundOptionsScroll: {
    maxHeight: 280,
  },
  leagueShareRoundOptions: {
    gap: spacing.xs,
    paddingVertical: 2,
  },
  leagueShareRoundOption: {
    alignItems: "center",
    backgroundColor: "#F7FAF8",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  leagueShareRoundOptionSelected: {
    backgroundColor: "#E8F6F2",
    borderColor: "#A8D7CC",
  },
  leagueShareRoundOptionCopy: {
    flex: 1,
  },
  leagueShareRoundOptionTitle: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "900",
  },
  leagueShareRoundOptionTitleSelected: {
    color: "#176B5B",
  },
  leagueShareRoundOptionStatus: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "800",
    marginTop: 2,
  },
  leagueShareRoundOptionStatusSelected: {
    color: "#4B7E74",
  },
  leagueShareModalActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  leagueShareOptionButton: {
    alignItems: "center",
    backgroundColor: "#1F6D69",
    borderRadius: 14,
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 46,
  },
  leagueShareOptionButtonText: {
    color: colors.surface,
    fontSize: 13,
    fontWeight: "900",
  },
  leagueShareCancelButton: {
    alignItems: "center",
    backgroundColor: "#EEF2F4",
    borderRadius: 14,
    justifyContent: "center",
    minHeight: 42,
  },
  leagueShareCancelButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  modalActionsRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  modalActionsColumn: {
    gap: spacing.sm,
  },
  modalSecondaryButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalSecondaryButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
  },
  modalButtonDisabled: {
    opacity: 0.45,
  },
  replacementMenuStatusBox: {
    alignItems: "center",
    backgroundColor: "#F4FAF7",
    borderColor: "#CFE2D8",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  replacementMenuStatusTitle: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
  },
  replacementMenuStatusText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  replacementMenuActionButton: {
    alignSelf: "stretch",
    flex: 0,
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  suspensionModalCard: {
    maxHeight: "82%",
    padding: spacing.md,
  },
  suspensionModalScroll: {
    alignSelf: "stretch",
  },
  suspensionModalContent: {
    gap: spacing.md,
    paddingBottom: spacing.xs,
  },
  suspensionIntroText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 17,
    textAlign: "center",
  },
  suspensionPrimaryStartButton: {
    alignItems: "center",
    backgroundColor: "#2A7F83",
    borderColor: "#1E6266",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  suspensionPrimaryStartText: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: "900",
    textAlign: "center",
  },
  clearSuspensionButton: {
    alignItems: "center",
    backgroundColor: "#FFF0F0",
    borderColor: "#D12F2F",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  clearSuspensionButtonText: {
    color: "#B51F1F",
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
  },
  retakeSuspensionButton: {
    alignItems: "center",
    backgroundColor: "#E8F6F1",
    borderColor: "#9CCFC2",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  retakeSuspensionButtonText: {
    color: "#176B5B",
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
  },
  suspensionReasonList: {
    gap: spacing.xs,
  },
  suspensionStepHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    marginBottom: 2,
  },
  suspensionStepNumber: {
    backgroundColor: "#DDF1EC",
    borderColor: "#9CCFC2",
    borderRadius: 10,
    borderWidth: 1,
    color: "#176B5B",
    fontSize: 10,
    fontWeight: "900",
    height: 20,
    lineHeight: 18,
    textAlign: "center",
    width: 20,
  },
  suspensionReasonTitle: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "800",
  },
  suspensionSubsectionTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 2,
  },
  suspensionReasonButton: {
    alignItems: "center",
    backgroundColor: "#F8FAF9",
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  suspensionReasonButtonCompact: {
    minHeight: 36,
    paddingHorizontal: spacing.sm,
  },
  suspensionReasonButtonActive: {
    backgroundColor: "#DDF1EC",
    borderColor: "#79BFAF",
  },
  suspensionReasonText: {
    color: colors.text,
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
  },
  suspensionReasonTextWithSupport: {
    lineHeight: 16,
  },
  suspensionReasonTextActive: {
    color: "#176B5B",
    fontWeight: "800",
  },
  suspensionReasonSupportText: {
    color: "#2A8FA8",
    fontSize: 10,
    fontWeight: "700",
    lineHeight: 14,
  },
  suspensionEmptyText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
  suspensionActionButton: {
    alignItems: "center",
    flexDirection: "row",
    flex: 0,
    gap: spacing.sm,
    justifyContent: "center",
    minHeight: 44,
  },
  suspensionScheduleOption: {
    alignItems: "center",
    backgroundColor: "#F8FAF9",
    borderColor: "#D5E5E0",
    borderRadius: 11,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 50,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  suspensionScheduleOptionCopy: {
    flex: 1,
    gap: 2,
  },
  suspensionScheduleOptionTitle: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
  },
  suspensionScheduleOptionText: {
    color: "#2A8FA8",
    fontSize: 10,
    fontWeight: "700",
    lineHeight: 14,
  },
  nextWeekSuspensionButton: {
    alignItems: "center",
    backgroundColor: "#1E7F4D",
    borderColor: "#126236",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  nextWeekSuspensionButtonText: {
    color: colors.surface,
    flex: 1,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
  },
  individualPreviewSummary: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  individualPreviewModalCard: {
    maxHeight: "94%",
  },
  individualPreviewBodyScroll: {
    maxHeight: 360,
  },
  individualPreviewPill: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    minHeight: 54,
    justifyContent: "center",
  },
  individualPreviewPillLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  individualPreviewPillValue: {
    color: colors.primaryDark,
    fontSize: 18,
    fontWeight: "900",
    marginTop: 2,
  },
  individualPreviewWarning: {
    alignItems: "flex-start",
    backgroundColor: "#FFF3C4",
    borderColor: "#F3D46B",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
  },
  individualPreviewWarningText: {
    color: "#8A4B00",
    flex: 1,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 18,
  },
  individualPreviewInfo: {
    alignItems: "flex-start",
    backgroundColor: "#EAF6F1",
    borderColor: "#C8E3D6",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
  },
  individualPreviewInfoText: {
    color: colors.primaryDark,
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  individualPreviewManageLink: {
    color: "#1267B1",
    fontWeight: "900",
    textDecorationLine: "underline",
  },
  individualPreviewLists: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  individualPreviewListCard: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    padding: spacing.sm,
  },
  individualPreviewListTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 6,
    textAlign: "center",
    textTransform: "uppercase",
  },
  individualPreviewPlayersList: {
    maxHeight: 260,
  },
  individualPreviewPlayerRow: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: "rgba(18,38,32,0.06)",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    justifyContent: "space-between",
    marginBottom: 6,
    minHeight: 34,
    paddingHorizontal: 7,
  },
  individualPreviewPlayerName: {
    color: colors.text,
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
  },
  individualPreviewSideButton: {
    alignItems: "center",
    backgroundColor: "#EAF6F1",
    borderColor: "#C8E3D6",
    borderRadius: 999,
    borderWidth: 1,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  replacementSearchInput: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  replacementPlayersList: {
    maxHeight: 220,
  },
  replacementLoadingRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    paddingVertical: spacing.md,
  },
  replacementLoadingText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
  },
  replacementPlayerOption: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.sm,
    minHeight: 54,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  replacementPlayerOptionDisabled: {
    backgroundColor: "#F0F2F1",
    borderColor: "#D6DAD8",
    opacity: 0.78,
  },
  replacementPlayerIcon: {
    alignItems: "center",
    backgroundColor: "#E7F5EC",
    borderRadius: 999,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  replacementPlayerIconDisabled: {
    backgroundColor: "#E3E6E4",
  },
  replacementPlayerCopy: {
    flex: 1,
  },
  replacementPlayerName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  replacementPlayerNameDisabled: {
    color: colors.textMuted,
  },
  replacementPlayerMeta: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 1,
  },
  replacementEmptyText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    paddingVertical: spacing.md,
    textAlign: "center",
  },
  replacementGuestCard: {
    backgroundColor: "#F8FCF9",
    borderColor: "#DCECE2",
    borderRadius: 18,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  replacementGuestTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  replacementGuestInputsRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  replacementGuestInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    color: colors.text,
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    minHeight: 42,
    paddingHorizontal: spacing.sm,
  },
  replacementGuestButton: {
    alignItems: "center",
    backgroundColor: colors.primaryDark,
    borderRadius: 16,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minHeight: 44,
  },
  replacementGuestButtonText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: "800",
  },
  replacementCloseButton: {
    flex: 0,
    paddingHorizontal: spacing.lg,
  },
  modalPrimaryButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#D97878",
  },
  modalPaymentsButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primaryDark,
  },
  whatsAppShareButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1F8F72",
    paddingHorizontal: spacing.xs,
  },
  whatsAppShareButtonText: {
    color: colors.surface,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 16,
    textAlign: "center",
  },
  modalDangerButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.danger,
  },
  modalPrimaryButtonText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: "800",
  },
});

