import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";

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

function sanitizeTimeSlotValue(value = "") {
  return String(value || "")
    .replace(/[^\d:]/g, "")
    .slice(0, 5);
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

function buildSuspensionMessage({ leagueName = "Liga", round = {} }) {
  const dateLabel = formatDateLabel(round.scheduledDateMillis);
  const timeSlots = [
    ...new Set((round.matches || []).map((match) => match?.timeSlot).filter(Boolean)),
  ];
  const timeLabel = timeSlots.length ? `${timeSlots.join(" / ")} hs` : round.scheduleLabel || "";

  return [
    `LIGA SUSPENDIDA: ${leagueName}.`,
    round.title ? `${round.title}${dateLabel ? ` del ${dateLabel}` : ""}.` : "",
    timeLabel ? `Horario: ${timeLabel}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
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
  const [suspensionScope, setSuspensionScope] = useState("");
  const [selectedSuspendedMatchIds, setSelectedSuspendedMatchIds] = useState([]);
  const [selectedSuspensionReason, setSelectedSuspensionReason] = useState("");
  const [rescheduleDatePickerVisible, setRescheduleDatePickerVisible] = useState(false);
  const [applyingSuspension, setApplyingSuspension] = useState(false);
  const [goToPaymentsPromptVisible, setGoToPaymentsPromptVisible] = useState(false);
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
  const currentUserId = String(userData?.uid || userData?.id || "").trim().toLowerCase();
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

  const notifyLeagueSuspensionAsync = async (targetLeague = league, nextFixture = fixtureDraft) => {
    const previousRounds = new Map(
      (targetLeague?.fixture?.rounds || []).map((round) => [round.id, round])
    );
    const newlySuspendedRounds = (nextFixture?.rounds || []).filter((round) => {
      const previousRound = previousRounds.get(round.id) || {};
      const hadSuspension = (previousRound.matches || []).some(
        (match) => match?.suspensionMode && !match?.result?.winner
      );
      const hasSuspension = (round.matches || []).some(
        (match) => match?.suspensionMode && !match?.result?.winner
      );

      return hasSuspension && !hadSuspension;
    });

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
    }
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
        await notifyLeagueSuspensionAsync(nextLeague, nextFixture);

        if (nextLeague.id === league?.id) {
          setFixtureDraft(nextFixture);
          setLeague((current) => ({
            ...current,
            fixture: nextFixture,
          }));
        }
      })
    );

    return { affectedLeaguesCount, affectedMatchesCount };
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

  const handleToggleReplacementRequest = ({ roundId, match, teamKey, player, playerIndex }) => {
    const replacementKey = getPlayerReplacementKey(teamKey, player, playerIndex);
    const canRequestThisReplacement =
      canEditFixture ||
      (canRequestOwnReplacement &&
        isCurrentUserFixturePlayer(player) &&
        nextReplacementTarget?.roundId === roundId &&
        nextReplacementTarget?.match?.id === match.id &&
        nextReplacementTarget?.replacementKey === replacementKey);

    if (!canRequestThisReplacement || hasMatchResultData(match) || match.result?.winner) {
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
        requestedBy: userData?.uid || userData?.id || "",
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

    updateMatchReplacement(
      replacementTarget.roundId,
      replacementTarget.matchId,
      replacementTarget.replacementKey,
      (currentReplacement) => ({
        ...(currentReplacement || {}),
        requested: true,
        replacement,
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
      "Remplazo quitado",
      "Guarda los cambios para actualizar la tabla de puntajes.",
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

  const buildOwnReplacementRequest = (player, currentReplacement = {}) => ({
    ...(currentReplacement || {}),
    requested: true,
    titular: currentReplacement?.titular || normalizeReplacementPlayer(player, player.type || "league"),
    replacement: currentReplacement?.replacement || null,
    requestedBy: userData?.uid || userData?.id || "",
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

  const handlePlayerReplacementRequest = async () => {
    if (!league || !nextReplacementTarget) {
      showFeedback(
        "Sin fecha disponible",
        "No encontramos una proxima fecha pendiente para pedir remplazo.",
        "danger"
      );
      return;
    }

    if (hasOwnReplacementRequest) {
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
      nextReplacementTarget.roundId,
      nextReplacementTarget.match.id,
      (match) => {
        const currentReplacement = match.replacements?.[nextReplacementTarget.replacementKey] || {};

        return {
          ...match,
          replacements: {
            ...(match.replacements || {}),
            [nextReplacementTarget.replacementKey]: buildOwnReplacementRequest(
              nextReplacementTarget.player,
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
      expandRound(nextReplacementTarget.roundId);
      showFeedback(
        "Solicitud de remplazo",
        `Solicitud de remplazo para ${nextReplacementTarget.roundTitle}.`,
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

  const handleCancelPlayerReplacementRequest = async () => {
    if (!league || !nextReplacementTarget || !hasOwnReplacementRequest || hasOwnReplacementDesignated) {
      return;
    }

    const nextFixture = buildNextFixture(
      fixtureDraft,
      nextReplacementTarget.roundId,
      nextReplacementTarget.match.id,
      (match) => {
        const nextReplacements = {
          ...(match.replacements || {}),
        };

        delete nextReplacements[nextReplacementTarget.replacementKey];

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
      expandRound(nextReplacementTarget.roundId);
      showFeedback(
        "Solicitud cancelada",
        `Cancelaste el pedido de remplazo para ${nextReplacementTarget.roundTitle}.`,
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

    try {
      setSavingMatchId("saving");
      await updateLeagueFixture(league.id, nextFixture);
      setLeague((current) => ({
        ...current,
        fixture: nextFixture,
      }));
      setFixtureDraft(nextFixture);
      setExpandedRoundIds((currentRoundIds) => {
        const nextRoundIds = new Set((nextFixture.rounds || []).map((round) => round.id));
        const validRoundIds = currentRoundIds.filter((roundId) => nextRoundIds.has(roundId));
        const currentRoundId = resolveCurrentRoundId(nextFixture.rounds || []);

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
      } else {
        showFeedback("Cambios guardados", "Tabla de puntajes actualizada", "success");
      }
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
          sex={league?.sexo}
          title={leagueName}
          teamType={league?.teamType}
        >
          <Text style={styles.heroMeta}>
            Fechas configuradas: {league?.fixtureConfig?.roundsCount || 0}
            {league?.fixtureConfig?.roundMode === "double" ? " · Ida y vuelta" : " · Ida"}
            {league?.fixtureConfig?.visibilityMode === "current"
              ? " · Jugadores ven proxima pendiente"
              : ""}
          </Text>
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
            {historyRoundShowsReprogrammedInfo ? (
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
              styles.roundCard,
              styles[`roundCardTone${(roundIndex % 12) + 1}`],
              round.id === focusRoundId ? styles.roundCardFocused : null,
            ]}
          >
            {(() => {
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

            {expandedRoundIds.includes(round.id) ? (
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
          </View>
          </Fragment>
          );
        })}

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
      </ScrollView>

      {canSaveFixtureChanges && canEditFixture ? (
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
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Opciones del partido</Text>
            <Text style={styles.modalMessage}>
              {nextReplacementTarget
                ? `${nextReplacementTarget.roundTitle} - ${nextReplacementTarget.match?.timeSlot || "Sin horario"} hs`
                : "No encontramos un partido pendiente."}
            </Text>
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
            <Text style={styles.modalTitle}>Liga Suspendida</Text>

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
                    <Ionicons color={colors.surface} name="warning" size={20} />
                    <Text style={styles.suspensionPrimaryStartText}>SUSPENDER LIGA</Text>
                  </Pressable>
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
                  <Text style={styles.modalMessage}>
                    Primero elegi que alcance tiene la suspension. Los partidos con resultado cargado
                    no se modifican.
                  </Text>

                  <View style={styles.suspensionReasonList}>
                    <Text style={styles.suspensionReasonTitle}>Alcance:</Text>
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
                            ? colors.surface
                            : colors.primaryDark
                        }
                        name="calendar-clear-outline"
                        size={18}
                      />
                      <Text
                        style={[
                          styles.suspensionReasonText,
                          suspensionScope === SUSPENSION_SCOPES.ALL_DAY
                            ? styles.suspensionReasonTextActive
                            : null,
                        ]}
                      >
                        Suspender todas las Ligas del Dia de la fecha
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
                            ? colors.surface
                            : colors.primaryDark
                        }
                        name="albums-outline"
                        size={18}
                      />
                      <Text
                        style={[
                          styles.suspensionReasonText,
                          suspensionScope === SUSPENSION_SCOPES.LEAGUE_ROUND
                            ? styles.suspensionReasonTextActive
                            : null,
                        ]}
                      >
                        Suspender esta liga completa
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
                            ? colors.surface
                            : colors.primaryDark
                        }
                        name="checkbox-outline"
                        size={18}
                      />
                      <Text
                        style={[
                          styles.suspensionReasonText,
                          suspensionScope === SUSPENSION_SCOPES.SELECTED_MATCHES
                            ? styles.suspensionReasonTextActive
                            : null,
                        ]}
                      >
                        Seleccionar que Partidos se Suspenden
                      </Text>
                    </Pressable>
                  </View>

                  {suspensionScope === SUSPENSION_SCOPES.SELECTED_MATCHES ? (
                    <View style={styles.suspensionReasonList}>
                      <Text style={styles.suspensionReasonTitle}>Partidos pendientes:</Text>
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
                                color={isSelected ? colors.surface : colors.primaryDark}
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

                  {canChooseSuspensionReason ? (
                    <View style={styles.suspensionReasonList}>
                      <Text style={styles.suspensionReasonTitle}>Motivo:</Text>
                      {SUSPENSION_REASONS.map((reason) => {
                        const isSelected = selectedSuspensionReason === reason.value;

                        return (
                          <Pressable
                            key={reason.value}
                            onPress={() => setSelectedSuspensionReason(reason.value)}
                            style={({ pressed }) => [
                              styles.suspensionReasonButton,
                              isSelected ? styles.suspensionReasonButtonActive : null,
                              pressed ? styles.generateButtonPressed : null,
                            ]}
                          >
                            <Ionicons
                              color={isSelected ? colors.surface : colors.primaryDark}
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
                      <Pressable
                        disabled={!canApplySuspension || applyingSuspension}
                        onPress={() =>
                          applyRoundSuspension({
                            rescheduledDateMillis: 0,
                            suspensionMode: "next_week",
                          })
                        }
                        style={({ pressed }) => [
                          styles.nextWeekSuspensionButton,
                          styles.suspensionActionButton,
                          !canApplySuspension || applyingSuspension ? styles.modalButtonDisabled : null,
                          pressed ? styles.generateButtonPressed : null,
                        ]}
                      >
                        <Ionicons color={colors.surface} name="calendar-number-outline" size={18} />
                        <Text style={styles.nextWeekSuspensionButtonText}>
                          {suspensionScope === SUSPENSION_SCOPES.SELECTED_MATCHES
                            ? "JUGAR PARTIDOS SUSPENDIDOS LA PROXIMA SEMANA"
                            : "SE JUEGA LA PROXIMA SEMANA FECHA NORMAL"}
                        </Text>
                      </Pressable>
                      <Pressable
                        disabled={!canApplySuspension || applyingSuspension}
                        onPress={() => setRescheduleDatePickerVisible(true)}
                        style={({ pressed }) => [
                          styles.modalPrimaryButton,
                          styles.suspensionActionButton,
                          !canApplySuspension || applyingSuspension ? styles.modalButtonDisabled : null,
                          pressed ? styles.generateButtonPressed : null,
                        ]}
                      >
                        <Text style={styles.modalPrimaryButtonText}>Elegir fecha reprogramada</Text>
                      </Pressable>
                      {suspensionScope === SUSPENSION_SCOPES.SELECTED_MATCHES ? (
                        <Pressable
                          disabled={!canApplySuspension || applyingSuspension}
                          onPress={() =>
                            applyRoundSuspension({
                              rescheduledDateMillis: getDateAfterLastFixtureRound(),
                              suspensionMode: "after_last",
                            })
                          }
                          style={({ pressed }) => [
                            styles.modalSecondaryButton,
                            styles.suspensionActionButton,
                            !canApplySuspension || applyingSuspension ? styles.modalButtonDisabled : null,
                            pressed ? styles.generateButtonPressed : null,
                          ]}
                        >
                          <Text style={styles.modalSecondaryButtonText}>
                            JUGAR DESPUES DE LA ULTIMA FECHA
                          </Text>
                        </Pressable>
                      ) : null}
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
            <Text style={styles.modalTitle}>Quitar reemplazo</Text>
            <Text style={styles.modalMessage}>
              Vas a quitar el reemplazo {replacementPendingRemoval?.playerName || ""}. Al guardar,
              se recalculara la tabla y se devolvera el descuento si correspondia.
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
                <Text style={styles.modalPrimaryButtonText}>Quitar</Text>
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
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },
  suspensionPrimaryStartButton: {
    alignItems: "center",
    backgroundColor: "#B51F1F",
    borderColor: "#7F1D1D",
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
  suspensionReasonList: {
    gap: spacing.xs,
  },
  suspensionReasonTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  suspensionReasonButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  suspensionReasonButtonActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  suspensionReasonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  suspensionReasonTextActive: {
    color: colors.surface,
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

