import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

import BottomQuickActionsBar, {
  BOTTOM_QUICK_ACTIONS_SPACE,
} from "../components/BottomQuickActionsBar";
import AvatarBadge from "../components/AvatarBadge";
import FeedbackModal from "../components/FeedbackModal";
import SectionHeader from "../components/SectionHeader";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import {
  listLeagues,
  resolveLeaguePaymentRounds,
  updateLeagueRoundPayments,
} from "../services/leaguesService";
import { listPlayers } from "../services/playersService";
import { isApprovedOrganizer } from "../services/roleService";
import { sendChatMessage } from "../services/chatService";
import {
  sendPaymentReminderPushAsync,
  sendTournamentPaymentReminderPushAsync,
} from "../services/pushNotificationsService";
import { listTournamentRegistrations, listTournaments } from "../services/tournamentsService";
import { listOrganizerTurnoReservations } from "../services/turnosService";

const FINANCE_MODULES = [
  { key: "ligas", label: "Ligas", icon: "tennisball-outline" },
  { key: "torneos", label: "Torneos", icon: "trophy-outline" },
  { key: "turnos", label: "Turnos", icon: "calendar-outline" },
];

const LEAGUE_FINANCE_AREAS = [
  { key: "values", label: "VALORES DE LIGAS", icon: "cash-outline" },
  { key: "cash", label: "Caja de Ligas", icon: "cash-outline" },
  { key: "debts", label: "Deudas Individuales", icon: "people-outline" },
  { key: "history", label: "Historial de Pagos", icon: "receipt-outline" },
  { key: "reminders", label: "Recordatorios", icon: "notifications-outline" },
];

const TOURNAMENT_FINANCE_AREAS = [
  { key: "debts", label: "Deudas Individuales", icon: "people-outline" },
  { key: "history", label: "Historial de Pagos", icon: "receipt-outline" },
  { key: "reminders", label: "Recordatorios", icon: "notifications-outline" },
  { key: "cash", label: "Caja de Torneos", icon: "cash-outline" },
];

const REGISTRATION_FEE_OPTIONS = [
  { label: "Sin inscripcion", value: "no" },
  { label: "Con inscripcion", value: "yes" },
];

const FINANCE_TABS = [
  { key: "cobros", label: "Cobros", icon: "wallet-outline" },
  { key: "history", label: "Historial", icon: "receipt-outline" },
  { key: "summary", label: "Resumen", icon: "stats-chart-outline" },
  { key: "settings", label: "Ajustes", icon: "cog-outline" },
];

const FINANCE_SOURCE_FILTERS = [
  { key: "leagues", label: "Ligas" },
  { key: "tournaments", label: "Torneos" },
  { key: "turns", label: "Turnos" },
];

const COBRO_STATUS_FILTERS = [
  { key: "all", label: "Todos" },
  { key: "pending", label: "Pendientes" },
  { key: "review", label: "En revision" },
];

function sanitizeDecimal(value) {
  const normalizedValue = String(value || "").replace(",", ".").replace(/[^0-9.]/g, "");
  const [integerPart = "", ...decimalParts] = normalizedValue.split(".");
  const decimalPart = decimalParts.join("");

  if (!normalizedValue.includes(".")) {
    return integerPart;
  }

  return `${integerPart || "0"}.${decimalPart.slice(0, 2)}`;
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
    registrationFeeMode: registrationFeeEnabled ? "yes" : "no",
    registrationFeeAmount:
      registrationFeeEnabled && Number.isFinite(registrationFeeAmount) && registrationFeeAmount > 0
        ? String(registrationFeeAmount)
        : "",
    roundPricePerPlayer:
      Number.isFinite(roundPricePerPlayer) && roundPricePerPlayer > 0
        ? String(roundPricePerPlayer)
        : "",
  };
}

function buildPaymentDefaultsPayload(form = {}) {
  const registrationFeeEnabled = form.registrationFeeMode === "yes";
  const registrationFeeAmount = Number.parseFloat(
    String(form.registrationFeeAmount || "0").replace(",", ".")
  );
  const roundPricePerPlayer = Number.parseFloat(
    String(form.roundPricePerPlayer || "0").replace(",", ".")
  );

  return {
    currency: "ARS",
    registrationFeeEnabled,
    registrationFeeAmount:
      registrationFeeEnabled && Number.isFinite(registrationFeeAmount)
        ? Math.round(registrationFeeAmount * 100) / 100
        : 0,
    roundPricePerPlayer: Number.isFinite(roundPricePerPlayer)
      ? Math.round(roundPricePerPlayer * 100) / 100
      : 0,
  };
}

function normalizeText(value = "") {
  return String(value || "").trim().toLowerCase();
}

function buildFinancePlayerLookup(players = []) {
  return players.reduce((lookup, player) => {
    const keys = [
      player?.id,
      player?.linkedUserId,
      [player?.nombre, player?.apellido].filter(Boolean).join(" "),
    ]
      .map((value) => normalizeText(value))
      .filter(Boolean);

    keys.forEach((key) => {
      lookup[key] = {
        foto: player?.foto || "",
      };
    });

    return lookup;
  }, {});
}

function resolveFinancePlayerPhoto(playerLookup = {}, identifiers = []) {
  for (const identifier of identifiers) {
    const key = normalizeText(identifier);

    if (key && playerLookup[key]?.foto) {
      return playerLookup[key].foto;
    }
  }

  return "";
}

function formatCurrency(value = 0) {
  const amount = Number(value || 0);

  return amount.toLocaleString("es-AR", {
    currency: "ARS",
    maximumFractionDigits: 0,
    style: "currency",
  });
}

function formatShortDate(millis = 0) {
  const value = Number(millis || 0);

  if (!value) {
    return "";
  }

  return new Date(value).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

function formatFinanceMethodLabel(method = "") {
  const normalized = normalizeText(method);

  if (normalized.includes("efect")) {
    return "Efectivo";
  }

  if (normalized.includes("transf")) {
    return "Transferencia";
  }

  if (normalized.includes("mercado")) {
    return "Mercado Pago";
  }

  return method ? String(method) : "Pago confirmado";
}

function getTurnoFinancePendingStatus(reservation = {}) {
  const paymentStatus = normalizeText(reservation.paymentStatus);
  const reservationStatus = normalizeText(reservation.status);
  const pendingAmount = Number(
    reservation.paymentPendingAmount ?? reservation.price ?? 0
  );

  if (["cancelled", "rejected"].includes(reservationStatus)) {
    return null;
  }

  if (paymentStatus === "pagado" || pendingAmount <= 0) {
    return null;
  }

  if (paymentStatus === "in_review") {
    return "review";
  }

  if (
    ["pending", "pending_cash", "to_be_defined", "payment_required", "pending_payment", "partial_payment"].includes(
      paymentStatus
    )
  ) {
    return "pending";
  }

  if (["pending_payment", "pending_organizer_confirmation", "confirmed"].includes(reservationStatus)) {
    return "pending";
  }

  return null;
}

function getTurnoFinanceMethodLabel(method = "", paymentStatus = "") {
  const normalizedMethod = normalizeText(method);
  const normalizedStatus = normalizeText(paymentStatus);

  if (normalizedStatus === "to_be_defined" || normalizedMethod === "a_confirmar") {
    return "A confirmar";
  }

  return formatFinanceMethodLabel(method || paymentStatus);
}

function getTurnoFinanceStatusLabel(reservation = {}) {
  const paidAmount = Number(reservation.paymentPaidAmount || 0);
  const pendingAmount = Number(reservation.paymentPendingAmount ?? reservation.price ?? 0);
  const paymentStatus = normalizeText(reservation.paymentStatus);

  if (paymentStatus === "in_review") {
    return "En revision";
  }

  if (pendingAmount <= 0) {
    return "Pagado";
  }

  if (paidAmount > 0) {
    return "Parcial";
  }

  if (paymentStatus === "to_be_defined") {
    return "A confirmar";
  }

  return "Pendiente";
}

function buildFinanceFilterOptions(values = []) {
  const uniqueValues = Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  ).sort((first, second) => first.localeCompare(second, "es"));

  return [{ key: "all", label: "Todos" }, ...uniqueValues.map((value) => ({ key: value, label: value }))];
}

function formatLeagueCollectionSchedule(round = {}) {
  const baseDateMillis = Number(round?.rescheduledDateMillis || round?.scheduledDateMillis || 0);
  const scheduleLabel = String(round?.scheduleLabel || "").trim();

  if (!baseDateMillis && !scheduleLabel) {
    return "";
  }

  const parts = [];

  if (baseDateMillis) {
    parts.push(
      new Date(baseDateMillis).toLocaleDateString("es-AR", {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
      })
    );
  }

  if (scheduleLabel) {
    parts.push(scheduleLabel);
  }

  return parts.join(" · ");
}

function getDayStartMillis(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function getFinancePlayerKey(player = {}) {
  return player?.linkedUserId || player?.id || player?.nombre || "";
}

function isMillisInRange(millis = 0, startMillis = 0, endMillis = Date.now()) {
  const value = Number(millis || 0);

  return value >= startMillis && value <= endMillis;
}

function buildCashDayBuckets(now = new Date()) {
  const todayStartMillis = getDayStartMillis(now);

  return Array.from({ length: 7 }, (_, index) => {
    const startMillis = todayStartMillis - (6 - index) * 24 * 60 * 60 * 1000;
    const endMillis = startMillis + 24 * 60 * 60 * 1000 - 1;
    const date = new Date(startMillis);

    return {
      endMillis,
      income: 0,
      key: String(startMillis),
      label: date.toLocaleDateString("es-AR", {
        day: "2-digit",
        month: "2-digit",
        weekday: "short",
      }),
      pending: 0,
      startMillis,
    };
  });
}

function addAmountToCashBuckets(buckets = [], millis = 0, field = "income", amount = 0) {
  const bucket = buckets.find((item) => isMillisInRange(millis, item.startMillis, item.endMillis));

  if (bucket) {
    bucket[field] += amount;
  }
}

function getMatchFinanceCompletedAtMillis(match = {}, round = {}) {
  return Number(match?.completedAtMillis || 0) ||
    Number(round?.completedAtMillis || 0) ||
    Number(match?.scheduledAtMillis || 0) ||
    Number(round?.scheduledDateMillis || 0);
}

function collectCompletedPlayerDatesByRound(round = {}) {
  const completedPlayers = new Map();
  const matches = Array.isArray(round?.matches) ? round.matches : [];

  matches.forEach((match) => {
    if (!match?.result?.winner) {
      return;
    }

    const completedAtMillis = getMatchFinanceCompletedAtMillis(match, round);
    const players = [
      ...(match?.teamA?.players || []),
      ...(match?.teamB?.players || []),
    ];

    players.forEach((player) => {
      const playerKey = getFinancePlayerKey(player);

      if (!playerKey) {
        return;
      }

      completedPlayers.set(
        playerKey,
        Math.max(Number(completedPlayers.get(playerKey) || 0), completedAtMillis)
      );
    });
  });

  return completedPlayers;
}

function getPaymentMethodLabel(method = "") {
  if (method === "efectivo") {
    return "Efectivo";
  }

  if (method === "transferencia") {
    return "Transferencia";
  }

  if (method === "cuenta_corriente") {
    return "Cuenta corriente";
  }

  return "Sin medio";
}

function serializeRoundPayments(roundPayments = []) {
  return roundPayments.map((round) => ({
    roundId: round.roundId,
    entries: (round.entries || []).map((entry) => ({
      participantId: entry.participantId,
      participantType: entry.participantType,
      participantLabel: entry.participantLabel,
      pairId: entry.pairId || "",
      pairLabel: entry.pairLabel || "",
      playerIds: entry.playerIds || [],
      paymentStatus: entry.paymentStatus,
      paymentMethod: entry.paymentMethod || "",
      proofUrl: entry.proofUrl || "",
      proofFileName: entry.proofFileName || "",
      proofUploadedAtMillis: entry.proofUploadedAtMillis || 0,
      proofUploadedBy: entry.proofUploadedBy || "",
      proofUploadedByName: entry.proofUploadedByName || "",
      confirmedAtMillis: entry.confirmedAtMillis || 0,
      confirmedBy: entry.confirmedBy || "",
      confirmedByName: entry.confirmedByName || "",
      rejectedAtMillis: entry.rejectedAtMillis || 0,
      rejectedBy: entry.rejectedBy || "",
      rejectedByName: entry.rejectedByName || "",
      reminder4hSentAtMillis: entry.reminder4hSentAtMillis || 0,
      reminder4hSentBy: entry.reminder4hSentBy || "",
      reminder4hSentByName: entry.reminder4hSentByName || "",
      reminder24hSentAtMillis: entry.reminder24hSentAtMillis || 0,
      reminder24hSentBy: entry.reminder24hSentBy || "",
      reminder24hSentByName: entry.reminder24hSentByName || "",
      updatedAtMillis: entry.updatedAtMillis || 0,
      updatedBy: entry.updatedBy || "",
      updatedByName: entry.updatedByName || "",
    })),
  }));
}

function getReminderStage(entry = {}, completedAtMillis = 0, now = Date.now()) {
  if (entry.paymentStatus !== "pendiente" || !completedAtMillis) {
    return null;
  }

  return {
    key: "manual",
    label: "Manual",
    field: "reminder4hSentAtMillis",
    byField: "reminder4hSentBy",
    byNameField: "reminder4hSentByName",
  };
}

function buildReminderMessage({ leagueName, roundTitle, playerName }) {
  return `Hola ${playerName}. Te recordamos que sigue pendiente el pago de ${roundTitle} en ${leagueName}.`;
}

function getTournamentFinanceStatusLabel(status = "") {
  if (status === "in_review") {
    return "Comprobante en revision";
  }

  if (status === "rejected") {
    return "Pago rechazado";
  }

  return "Impago";
}

function buildLeagueDebtors(leagues = [], defaultRoundPrice = 0) {
  const debtorsMap = new Map();

  leagues.forEach((league) => {
    const leagueRoundPrice = Number(league?.paymentConfig?.roundPricePerPlayer || 0);
    const roundPrice = leagueRoundPrice > 0 ? leagueRoundPrice : Number(defaultRoundPrice || 0);

    if (roundPrice <= 0) {
      return;
    }

    const paymentRounds = resolveLeaguePaymentRounds(league);

    paymentRounds.forEach((round) => {
      (round.entries || []).forEach((entry) => {
        if (entry.paymentStatus !== "pendiente" || Number(entry.completedAtMillis || 0) <= 0) {
          return;
        }

        const players = Array.isArray(entry.players) && entry.players.length
          ? entry.players
          : [{ nombre: entry.participantLabel, id: entry.participantId }];

        players.forEach((player) => {
          const playerName = [player?.nombre, player?.apellido].filter(Boolean).join(" ") ||
            entry.participantLabel ||
            "Jugador";
          const playerId = player?.linkedUserId ||
            player?.id ||
            normalizeText(playerName) ||
            entry.participantId;
          const key = String(playerId || playerName);
          const current = debtorsMap.get(key) || {
            amount: 0,
            playerId,
            playerName,
            playerPhoto: player?.foto || "",
            pendingRounds: [],
            leagueDetails: [],
          };
          const leagueId = league.id || league.nombre || "liga";
          let leagueDetail = current.leagueDetails.find((detail) => detail.leagueId === leagueId);

          if (!leagueDetail) {
            leagueDetail = {
              amount: 0,
              category: league.categoria || "",
              leagueId,
              leagueName: league.nombre || "Liga",
              pendingRounds: [],
            };
            current.leagueDetails.push(leagueDetail);
          }

          current.pendingRounds.push(round.title || `Fecha ${round.roundNumber}`);
          current.amount += roundPrice;
          leagueDetail.pendingRounds.push(round.title || `Fecha ${round.roundNumber}`);
          leagueDetail.amount += roundPrice;

          debtorsMap.set(key, current);
        });
      });
    });
  });

  return [...debtorsMap.values()]
    .filter((debtor) => debtor.amount > 0)
    .map((debtor) => ({
      ...debtor,
      leagueDetails: debtor.leagueDetails.sort((first, second) => first.leagueName.localeCompare(second.leagueName, "es")),
    }))
    .sort((first, second) => {
      if (second.amount !== first.amount) {
        return second.amount - first.amount;
      }

      return first.playerName.localeCompare(second.playerName, "es");
    });
}

function filterLeagueDebtors(debtors = [], query = "") {
  const normalizedQuery = normalizeText(query);

  if (!normalizedQuery) {
    return debtors;
  }

  return debtors.filter((debtor) => {
    if (normalizeText(debtor.playerName).includes(normalizedQuery)) {
      return true;
    }

    return debtor.leagueDetails.some((detail) => {
      return (
        normalizeText(detail.leagueName).includes(normalizedQuery) ||
        normalizeText(detail.category).includes(normalizedQuery)
      );
    });
  });
}

function filterTournamentDebtors(debtors = [], query = "") {
  const normalizedQuery = normalizeText(query);

  if (!normalizedQuery) {
    return debtors;
  }

  return debtors.filter((debtor) => {
    if (normalizeText(debtor.playerName).includes(normalizedQuery)) {
      return true;
    }

    return debtor.tournamentDetails.some((detail) =>
      normalizeText(detail.tournamentName).includes(normalizedQuery)
    );
  });
}

function buildLeaguePaymentHistory(leagues = [], defaultRoundPrice = 0) {
  const historyMap = new Map();

  leagues.forEach((league) => {
    const leagueRoundPrice = Number(league?.paymentConfig?.roundPricePerPlayer || 0);
    const roundPrice = leagueRoundPrice > 0 ? leagueRoundPrice : Number(defaultRoundPrice || 0);

    if (roundPrice <= 0) {
      return;
    }

    const paymentRounds = resolveLeaguePaymentRounds(league);

    paymentRounds.forEach((round) => {
      (round.entries || []).forEach((entry) => {
        if (entry.paymentStatus !== "pagado") {
          return;
        }

        const players = Array.isArray(entry.players) && entry.players.length
          ? entry.players
          : [{ nombre: entry.participantLabel, id: entry.participantId }];

        players.forEach((player) => {
          const playerName = [player?.nombre, player?.apellido].filter(Boolean).join(" ") ||
            entry.participantLabel ||
            "Jugador";
          const playerId = player?.linkedUserId ||
            player?.id ||
            normalizeText(playerName) ||
            entry.participantId;
          const key = String(playerId || playerName);
          const current = historyMap.get(key) || {
            amount: 0,
            playerId,
            playerName,
            paymentCount: 0,
            leagueDetails: [],
          };
          const leagueId = league.id || league.nombre || "liga";
          let leagueDetail = current.leagueDetails.find((detail) => detail.leagueId === leagueId);

          if (!leagueDetail) {
            leagueDetail = {
              amount: 0,
              category: league.categoria || "",
              leagueId,
              leagueName: league.nombre || "Liga",
              payments: [],
              sex: league.sexo || "",
            };
            current.leagueDetails.push(leagueDetail);
          }

          const payment = {
            amount: roundPrice,
            confirmedAtMillis: Number(entry.confirmedAtMillis || entry.updatedAtMillis || 0),
            method: entry.paymentMethod || "",
            roundTitle: round.title || `Fecha ${round.roundNumber}`,
          };

          current.amount += roundPrice;
          current.paymentCount += 1;
          leagueDetail.amount += roundPrice;
          leagueDetail.payments.push(payment);

          historyMap.set(key, current);
        });
      });
    });
  });

  return [...historyMap.values()]
    .filter((history) => history.amount > 0)
    .map((history) => ({
      ...history,
      leagueDetails: history.leagueDetails
        .map((detail) => ({
          ...detail,
          payments: detail.payments.sort((first, second) => {
            const secondDate = Number(second.confirmedAtMillis || 0);
            const firstDate = Number(first.confirmedAtMillis || 0);

            if (secondDate !== firstDate) {
              return secondDate - firstDate;
            }

            return first.roundTitle.localeCompare(second.roundTitle, "es");
          }),
        }))
        .sort((first, second) => first.leagueName.localeCompare(second.leagueName, "es")),
    }))
    .sort((first, second) => {
      if (second.amount !== first.amount) {
        return second.amount - first.amount;
      }

      return first.playerName.localeCompare(second.playerName, "es");
    });
}

function buildCashSummary(leagues = [], defaultRoundPrice = 0) {
  const now = new Date();
  const nowMillis = now.getTime();
  const todayStartMillis = getDayStartMillis(now);
  const last7DaysStartMillis = todayStartMillis - 6 * 24 * 60 * 60 * 1000;
  const daily = buildCashDayBuckets(now);
  const summary = {
    today: {
      income: 0,
      pending: 0,
    },
    daily,
    last7Days: {
      income: 0,
      pending: 0,
    },
  };

  leagues.forEach((league) => {
    const leagueRoundPrice = Number(league?.paymentConfig?.roundPricePerPlayer || 0);
    const roundPrice = leagueRoundPrice > 0 ? leagueRoundPrice : Number(defaultRoundPrice || 0);

    if (roundPrice <= 0) {
      return;
    }

    const paymentRounds = resolveLeaguePaymentRounds(league);

    paymentRounds.forEach((round) => {
      const rawRound = (league?.fixture?.rounds || []).find(
        (fixtureRound) =>
          fixtureRound?.id === round.roundId ||
          Number(fixtureRound?.number || 0) === Number(round.roundNumber || 0)
      ) || {};
      const completedPlayerDates = collectCompletedPlayerDatesByRound(rawRound);

      (round.entries || []).forEach((entry) => {
        const players = Array.isArray(entry.players) && entry.players.length
          ? entry.players
          : [{ nombre: entry.participantLabel, id: entry.participantId }];
        const playerMultiplier = Math.max(players.length, 1);

        if (entry.paymentStatus === "pagado") {
          const paidAtMillis = Number(entry.confirmedAtMillis || entry.updatedAtMillis || 0);
          const paidAmount = roundPrice * playerMultiplier;

          if (isMillisInRange(paidAtMillis, todayStartMillis, nowMillis)) {
            summary.today.income += paidAmount;
          }

          if (isMillisInRange(paidAtMillis, last7DaysStartMillis, nowMillis)) {
            summary.last7Days.income += paidAmount;
            addAmountToCashBuckets(daily, paidAtMillis, "income", paidAmount);
          }

          return;
        }

        if (entry.paymentStatus === "pendiente") {
          const entryPlayerIds = Array.isArray(entry.playerIds) && entry.playerIds.length
            ? entry.playerIds
            : players.map(getFinancePlayerKey).filter(Boolean);
          const completedValues = entryPlayerIds
            .map((playerId) => Number(completedPlayerDates.get(playerId) || 0))
            .filter((value) => value > 0);

          if (!completedValues.length) {
            return;
          }

          const completedAtMillis = Math.max(...completedValues);
          const pendingAmount = roundPrice * playerMultiplier;

          if (isMillisInRange(completedAtMillis, todayStartMillis, nowMillis)) {
            summary.today.pending += pendingAmount;
          }

          if (isMillisInRange(completedAtMillis, last7DaysStartMillis, nowMillis)) {
            summary.last7Days.pending += pendingAmount;
            addAmountToCashBuckets(daily, completedAtMillis, "pending", pendingAmount);
          }
        }
      });
    });
  });

  return summary;
}

function buildLeagueReminderItems(leagues = []) {
  const now = Date.now();

  return leagues.flatMap((league) => {
    const paymentRounds = resolveLeaguePaymentRounds(league);

    return paymentRounds.flatMap((round) => {
      return (round.entries || []).flatMap((entry) => {
        const completedAtMillis = Number(entry.completedAtMillis || round.completedAtMillis || 0);
        const stage = getReminderStage(entry, completedAtMillis, now);

        if (!stage) {
          return [];
        }

        const player = (entry.players || [])[0] || {};
        const playerUserId = player.linkedUserId || player.id || "";
        const playerName =
          [player.nombre, player.apellido].filter(Boolean).join(" ") ||
          entry.participantLabel ||
          "Jugador";

        return [
          {
            id: `${league.id}-${round.roundId}-${entry.participantId}-${stage.key}`,
            league,
            round,
            entry,
            stage,
            playerName,
            playerUserId,
            completedAtMillis,
          },
        ];
      });
    });
  });
}

function buildTournamentRegistrationPlayers(registration = {}) {
  const payments = Array.isArray(registration.payments) ? registration.payments : [];
  const paymentByKey = new Map(
    payments.map((payment) => [String(payment.userId || payment.playerId || "").trim(), payment])
  );

  return [
    {
      playerId: registration.player1Id || "player-1",
      playerName: registration.player1Name || "Jugador 1",
      playerPhoto:
        registration?.player1?.foto ||
        registration?.player1?.avatarUrl ||
        registration?.player1Photo ||
        "",
      payment:
        paymentByKey.get(String(registration.player1Id || "").trim()) ||
        payments.find((entry) => entry.playerName === registration.player1Name) ||
        null,
    },
    registration.player2Id || registration.player2Name
      ? {
          playerId: registration.player2Id || "player-2",
          playerName: registration.player2Name || "Jugador 2",
          playerPhoto:
            registration?.player2?.foto ||
            registration?.player2?.avatarUrl ||
            registration?.player2Photo ||
            "",
          payment:
            paymentByKey.get(String(registration.player2Id || "").trim()) ||
            payments.find((entry) => entry.playerName === registration.player2Name) ||
            null,
        }
      : null,
  ].filter(Boolean);
}

function getTournamentPaymentEventMillis(registration = {}, payment = {}) {
  return Number(payment.reviewedAt || 0) ||
    Number(payment.uploadedAt || 0) ||
    Number(registration.updatedAtMillis || 0) ||
    Number(registration.createdAtMillis || 0);
}

function buildTournamentDebtors(tournaments = []) {
  const debtorsMap = new Map();

  tournaments.forEach((tournament) => {
    const registrations = Array.isArray(tournament.registrations) ? tournament.registrations : [];

    registrations.forEach((registration) => {
      buildTournamentRegistrationPlayers(registration).forEach((player) => {
        const payment = player.payment || {};
        const amount = Number(payment.amount || tournament.entryFee || 0);

        if (amount <= 0 || payment.status === "approved") {
          return;
        }

        const playerId = payment.userId || payment.playerId || player.playerId || player.playerName;
        const key = String(playerId || player.playerName);
        const current = debtorsMap.get(key) || {
          amount: 0,
          playerId,
          playerName: player.playerName || "Jugador",
          playerPhoto: player.playerPhoto || "",
          tournamentDetails: [],
          paymentCount: 0,
        };
        const tournamentId = tournament.id || tournament.name || "tournament";
        let tournamentDetail = current.tournamentDetails.find((detail) => detail.tournamentId === tournamentId);

        if (!tournamentDetail) {
          tournamentDetail = {
            amount: 0,
            tournamentId,
            tournamentName: tournament.name || "Torneo",
            pairLabel: registration.pairLabel || "",
            statuses: [],
          };
          current.tournamentDetails.push(tournamentDetail);
        }

        current.amount += amount;
        current.paymentCount += 1;
        tournamentDetail.amount += amount;
        tournamentDetail.statuses.push(getTournamentFinanceStatusLabel(payment.status || "pending"));
        debtorsMap.set(key, current);
      });
    });
  });

  return [...debtorsMap.values()]
    .filter((debtor) => debtor.amount > 0)
    .map((debtor) => ({
      ...debtor,
      tournamentDetails: debtor.tournamentDetails.sort((first, second) =>
        first.tournamentName.localeCompare(second.tournamentName, "es")
      ),
    }))
    .sort((first, second) => {
      if (second.amount !== first.amount) {
        return second.amount - first.amount;
      }

      return first.playerName.localeCompare(second.playerName, "es");
    });
}

function buildTournamentPaymentHistory(tournaments = []) {
  const historyMap = new Map();
  const cutoffMillis = Date.now() - 30 * 24 * 60 * 60 * 1000;

  tournaments.forEach((tournament) => {
    const registrations = Array.isArray(tournament.registrations) ? tournament.registrations : [];

    registrations.forEach((registration) => {
      buildTournamentRegistrationPlayers(registration).forEach((player) => {
        const payment = player.payment || {};
        const amount = Number(payment.amount || tournament.entryFee || 0);
        const eventMillis = getTournamentPaymentEventMillis(registration, payment);

        if (amount <= 0 || payment.status !== "approved" || eventMillis < cutoffMillis) {
          return;
        }

        const playerId = payment.userId || payment.playerId || player.playerId || player.playerName;
        const key = String(playerId || player.playerName);
        const current = historyMap.get(key) || {
          amount: 0,
          playerId,
          playerName: player.playerName || "Jugador",
          paymentCount: 0,
          tournamentDetails: [],
        };
        const tournamentId = tournament.id || tournament.name || "tournament";
        let tournamentDetail = current.tournamentDetails.find((detail) => detail.tournamentId === tournamentId);

        if (!tournamentDetail) {
          tournamentDetail = {
            amount: 0,
            category:
              tournament.compositionLabel ||
              tournament.compositionConfig?.label ||
              tournament.categoria ||
              tournament.category ||
              "",
            sex:
              tournament.compositionConfig?.branch ||
              tournament.branch ||
              tournament.sexo ||
              tournament.sex ||
              "",
            tournamentId,
            tournamentName: tournament.name || "Torneo",
            payments: [],
          };
          current.tournamentDetails.push(tournamentDetail);
        }

        const historyPayment = {
          amount,
          confirmedAtMillis: eventMillis,
          method: payment.method || "",
          pairLabel: registration.pairLabel || "",
        };

        current.amount += amount;
        current.paymentCount += 1;
        tournamentDetail.amount += amount;
        tournamentDetail.payments.push(historyPayment);
        historyMap.set(key, current);
      });
    });
  });

  return [...historyMap.values()]
    .filter((history) => history.amount > 0)
    .map((history) => ({
      ...history,
      tournamentDetails: history.tournamentDetails
        .map((detail) => ({
          ...detail,
          payments: detail.payments.sort(
            (first, second) => Number(second.confirmedAtMillis || 0) - Number(first.confirmedAtMillis || 0)
          ),
        }))
        .sort((first, second) => first.tournamentName.localeCompare(second.tournamentName, "es")),
    }))
    .sort((first, second) => {
      if (second.amount !== first.amount) {
        return second.amount - first.amount;
      }

      return first.playerName.localeCompare(second.playerName, "es");
    });
}

function buildTournamentCashSummary(tournaments = []) {
  const now = new Date();
  const nowMillis = now.getTime();
  const todayStartMillis = getDayStartMillis(now);
  const last7DaysStartMillis = todayStartMillis - 6 * 24 * 60 * 60 * 1000;
  const daily = buildCashDayBuckets(now);
  const summary = {
    today: {
      income: 0,
      pending: 0,
    },
    daily,
    last7Days: {
      income: 0,
      pending: 0,
    },
  };

  tournaments.forEach((tournament) => {
    const registrations = Array.isArray(tournament.registrations) ? tournament.registrations : [];

    registrations.forEach((registration) => {
      buildTournamentRegistrationPlayers(registration).forEach((player) => {
        const payment = player.payment || {};
        const amount = Number(payment.amount || tournament.entryFee || 0);
        const eventMillis = getTournamentPaymentEventMillis(registration, payment);

        if (amount <= 0 || !eventMillis) {
          return;
        }

        if (payment.status === "approved") {
          if (isMillisInRange(eventMillis, todayStartMillis, nowMillis)) {
            summary.today.income += amount;
          }

          if (isMillisInRange(eventMillis, last7DaysStartMillis, nowMillis)) {
            summary.last7Days.income += amount;
            addAmountToCashBuckets(daily, eventMillis, "income", amount);
          }

          return;
        }

        if (isMillisInRange(eventMillis, todayStartMillis, nowMillis)) {
          summary.today.pending += amount;
        }

        if (isMillisInRange(eventMillis, last7DaysStartMillis, nowMillis)) {
          summary.last7Days.pending += amount;
          addAmountToCashBuckets(daily, eventMillis, "pending", amount);
        }
      });
    });
  });

  return summary;
}

function buildTournamentReminderItems(tournaments = []) {
  return tournaments.flatMap((tournament) => {
    const registrations = Array.isArray(tournament.registrations) ? tournament.registrations : [];

    return registrations.flatMap((registration) =>
      buildTournamentRegistrationPlayers(registration).flatMap((player) => {
        const payment = player.payment || {};
        const amount = Number(payment.amount || tournament.entryFee || 0);
        const playerUserId = payment.userId || player.playerId || "";

        if (amount <= 0 || payment.status === "approved") {
          return [];
        }

        return [
          {
            id: `${tournament.id}-${registration.id}-${player.playerId}`,
            tournament,
            registration,
            payment,
            playerName: player.playerName || "Jugador",
            playerUserId,
          },
        ];
      })
    );
  });
}

function buildLeagueCollectionRows(leagues = [], defaultRoundPrice = 0, playerLookup = {}) {
  const rows = [];

  leagues.forEach((league) => {
    const leagueRoundPrice = Number(league?.paymentConfig?.roundPricePerPlayer || 0);
    const roundPrice = leagueRoundPrice > 0 ? leagueRoundPrice : Number(defaultRoundPrice || 0);

    if (roundPrice <= 0) {
      return;
    }

    const paymentRounds = resolveLeaguePaymentRounds(league);

    paymentRounds.forEach((round) => {
      const roundLabel = round.title || `Fecha ${round.roundNumber}`;
      const roundSchedule = formatLeagueCollectionSchedule(round);
      const roundDetail = roundSchedule ? `${roundLabel} · ${roundSchedule}` : roundLabel;

      (round.entries || []).forEach((entry) => {
        if (!["pendiente", "informo_transferencia"].includes(entry.paymentStatus)) {
          return;
        }

        if (Number(entry.completedAtMillis || 0) <= 0 && entry.paymentStatus !== "informo_transferencia") {
          return;
        }

        const players = Array.isArray(entry.players) && entry.players.length
          ? entry.players
          : [{ nombre: entry.participantLabel, id: entry.participantId }];

        players.forEach((player) => {
          const playerName =
            [player?.nombre, player?.apellido].filter(Boolean).join(" ") ||
            entry.participantLabel ||
            "Jugador";
          const playerId =
            player?.linkedUserId ||
            player?.id ||
            normalizeText(playerName) ||
            entry.participantId;

          rows.push({
            amount: roundPrice,
            eventMillis: Number(
              entry.paymentStatus === "informo_transferencia"
                ? entry.proofUploadedAtMillis || entry.updatedAtMillis || 0
                : entry.completedAtMillis || round.completedAtMillis || 0
            ),
            itemId: `${league.id}-${round.roundId}-${entry.participantId}-${playerId}`,
            label:
              entry.paymentStatus === "informo_transferencia"
                ? `Comprobante para revisar · ${roundDetail}`
                : roundDetail,
            playerId,
            playerName,
            playerPhoto:
              player?.foto ||
              resolveFinancePlayerPhoto(playerLookup, [playerId, playerName]) ||
              "",
            sourceId: league.id,
            sourceName: league.nombre || "Liga",
            sourceType: "leagues",
            sourceTypeLabel: "Liga",
            sourceCategory: league.categoria || "",
            sourceSex: league.sexo || "",
            status: entry.paymentStatus === "informo_transferencia" ? "review" : "pending",
          });
        });
      });
    });
  });

  return rows;
}

function buildTournamentCollectionRows(tournaments = [], playerLookup = {}) {
  const rows = [];

  tournaments.forEach((tournament) => {
    const registrations = Array.isArray(tournament.registrations) ? tournament.registrations : [];

    registrations.forEach((registration) => {
      buildTournamentRegistrationPlayers(registration).forEach((player) => {
        const payment = player.payment || {};
        const amount = Number(payment.amount || tournament.entryFee || 0);

        if (amount <= 0 || payment.status === "approved") {
          return;
        }

        const playerId = payment.userId || payment.playerId || player.playerId || player.playerName;
        const playerName = player.playerName || "Jugador";
        const paymentStatus = payment.status === "in_review" ? "review" : "pending";

        rows.push({
          amount,
          eventMillis: getTournamentPaymentEventMillis(registration, payment),
          itemId: `${tournament.id}-${registration.id}-${playerId}`,
          label:
            paymentStatus === "review"
              ? `Comprobante para revisar${registration.pairLabel ? ` · ${registration.pairLabel}` : ""}`
              : `Inscripcion${registration.pairLabel ? ` · ${registration.pairLabel}` : ""}`,
          playerId,
          playerName,
          playerPhoto:
            player.playerPhoto ||
            resolveFinancePlayerPhoto(playerLookup, [playerId, playerName]) ||
            "",
          sourceId: tournament.id,
          sourceName: tournament.name || "Torneo",
          sourceType: "tournaments",
          sourceTypeLabel: "Torneo",
          sourceCategory:
            tournament.compositionLabel ||
            tournament.compositionConfig?.label ||
            tournament.categoria ||
            tournament.category ||
            "",
          sourceSex:
            tournament.compositionConfig?.branch ||
            tournament.branch ||
            tournament.sexo ||
            tournament.sex ||
            "",
          status: paymentStatus,
        });
      });
    });
  });

  return rows;
}

function buildTurnoCollectionRows(reservations = [], playerLookup = {}) {
  return reservations.flatMap((reservation) => {
    const amount = Number(
      reservation.paymentPendingAmount ?? reservation.price ?? 0
    );
    const status = getTurnoFinancePendingStatus(reservation);

    if (amount <= 0 || !status) {
      return [];
    }

    const playerName = String(reservation.playerName || "").trim() || "Jugador";
    const playerId =
      reservation.playerId ||
      reservation.playerEmail ||
      normalizeText(playerName) ||
      reservation.id;
    const summaryParts = [
      String(reservation.courtName || "").trim(),
      String(reservation.dateLabel || "").trim(),
      String(reservation.time || "").trim(),
    ].filter(Boolean);
    const summary = summaryParts.join(" · ");

    return [
      {
        amount,
        eventMillis: Number(
          reservation.updatedAtMillis ||
            reservation.confirmedAtMillis ||
            reservation.createdAtMillis ||
            reservation.dateMillis ||
            0
        ),
        itemId: `turno-${reservation.id}`,
        label:
          status === "review"
            ? `Comprobante para revisar${summary ? ` · ${summary}` : ""}`
            : summary || "Reserva de turno",
        playerId,
        playerName,
        playerPhoto: resolveFinancePlayerPhoto(playerLookup, [playerId, playerName]) || "",
        sourceId: reservation.id,
        sourceName: reservation.complexName || "Turno",
        sourceType: "turns",
        sourceTypeLabel: "Turno",
        turnPaidAmount: Number(reservation.paymentPaidAmount || 0),
        turnStatusLabel: getTurnoFinanceStatusLabel(reservation),
        turnTotalAmount: Number(reservation.paymentTotalAmount ?? reservation.price ?? 0),
        sourceCategory: "",
        sourceSex: "",
        status,
      },
    ];
  });
}

function buildCollectionRowsByPlayer(items = []) {
  const itemsByPlayer = new Map();

  items.forEach((item) => {
    const key = String(item.playerId || item.playerName);
    const current = itemsByPlayer.get(key) || {
      items: [],
      pendingAmount: 0,
      playerId: item.playerId,
      playerName: item.playerName,
      playerPhoto: item.playerPhoto || "",
      reviewAmount: 0,
      sourceTypes: new Set(),
      totalAmount: 0,
    };

    current.items.push(item);
    current.totalAmount += item.amount;

    if (item.status === "review") {
      current.reviewAmount += item.amount;
    } else {
      current.pendingAmount += item.amount;
    }

    current.sourceTypes.add(item.sourceType);

    if (!current.playerPhoto && item.playerPhoto) {
      current.playerPhoto = item.playerPhoto;
    }

    itemsByPlayer.set(key, current);
  });

  return [...itemsByPlayer.values()]
    .map((entry) => ({
      ...entry,
      items: entry.items.sort((first, second) => Number(second.eventMillis || 0) - Number(first.eventMillis || 0)),
      sourceTypes: Array.from(entry.sourceTypes),
    }))
    .sort((first, second) => {
      if (second.reviewAmount !== first.reviewAmount) {
        return second.reviewAmount - first.reviewAmount;
      }

      if (second.totalAmount !== first.totalAmount) {
        return second.totalAmount - first.totalAmount;
      }

      return String(first.playerName || "").localeCompare(String(second.playerName || ""), "es");
    });
}

function buildTurnoPaymentHistory(reservations = [], playerLookup = {}) {
  return reservations
    .filter(
      (reservation) =>
        normalizeText(reservation.paymentStatus) === "pagado" ||
        Number(reservation.paymentPendingAmount ?? reservation.price ?? 0) <= 0
    )
    .map((reservation) => {
      const amount = Number(
        reservation.paymentPaidAmount ??
          reservation.paymentTotalAmount ??
          reservation.price ??
          0
      );
      const paymentMovements = Array.isArray(reservation.paymentMovements)
        ? reservation.paymentMovements
        : [];
      const movementMethods = [...new Set(paymentMovements.map((movement) => movement?.method).filter(Boolean))];
      const playerName = String(reservation.playerName || "").trim() || "Jugador";
      const playerId =
        reservation.playerId ||
        reservation.playerEmail ||
        normalizeText(playerName) ||
        reservation.id;
      const dateMillis = Number(
        paymentMovements[0]?.createdAtMillis ||
        reservation.updatedAtMillis ||
          reservation.confirmedAtMillis ||
          reservation.createdAtMillis ||
          reservation.dateMillis ||
          0
      );
      const summaryParts = [
        String(reservation.courtName || "").trim(),
        String(reservation.dateLabel || "").trim(),
        String(reservation.time || "").trim(),
      ].filter(Boolean);

      return {
        amount,
        dateMillis,
        dateLabel: formatShortDate(dateMillis),
        id: `turn-history-${reservation.id}`,
        method: reservation.paymentMethod || reservation.paymentStatus || "",
        methodLabel:
          movementMethods.length > 1
            ? "Pago mixto"
            : getTurnoFinanceMethodLabel(
                movementMethods[0] || reservation.paymentMethod || "",
                reservation.paymentStatus || ""
              ),
        playerId,
        playerName,
        playerPhoto: resolveFinancePlayerPhoto(playerLookup, [playerId, playerName]) || "",
        sourceCategory: "",
        sourceName: reservation.complexName || "Turno",
        sourceSex: "",
        sourceType: "turns",
        sourceTypeLabel: "Turno",
        summary: summaryParts.join(" · ") || "Reserva de turno",
      };
    })
    .filter((row) => Number(row.amount || 0) > 0);
}

function buildTurnoCashSummary(reservations = []) {
  const now = new Date();
  const nowMillis = now.getTime();
  const todayStartMillis = getDayStartMillis(now);
  const last7DaysStartMillis = todayStartMillis - 6 * 24 * 60 * 60 * 1000;
  const daily = buildCashDayBuckets(now);
  const summary = {
    today: {
      income: 0,
      pending: 0,
    },
    daily,
    last7Days: {
      income: 0,
      pending: 0,
    },
  };

  reservations.forEach((reservation) => {
    const amount = Number(reservation.price || 0);
    const eventMillis = Number(
      reservation.updatedAtMillis ||
        reservation.confirmedAtMillis ||
        reservation.createdAtMillis ||
        reservation.dateMillis ||
        0
    );

    if (amount <= 0 || !eventMillis) {
      return;
    }

    if (normalizeText(reservation.paymentStatus) === "pagado") {
      if (isMillisInRange(eventMillis, todayStartMillis, nowMillis)) {
        summary.today.income += amount;
      }

      if (isMillisInRange(eventMillis, last7DaysStartMillis, nowMillis)) {
        summary.last7Days.income += amount;
        addAmountToCashBuckets(daily, eventMillis, "income", amount);
      }

      return;
    }

    if (!getTurnoFinancePendingStatus(reservation)) {
      return;
    }

    if (isMillisInRange(eventMillis, todayStartMillis, nowMillis)) {
      summary.today.pending += amount;
    }

    if (isMillisInRange(eventMillis, last7DaysStartMillis, nowMillis)) {
      summary.last7Days.pending += amount;
      addAmountToCashBuckets(daily, eventMillis, "pending", amount);
    }
  });

  return summary;
}

function buildCollectionHistoryRows(leagueHistory = [], tournamentHistory = [], turnoHistory = []) {
  const rows = [];

  leagueHistory.forEach((history) => {
    history.leagueDetails.forEach((detail) => {
      detail.payments.forEach((payment, index) => {
        rows.push({
          amount: payment.amount || 0,
          dateMillis: Number(payment.confirmedAtMillis || 0),
          dateLabel: formatShortDate(payment.confirmedAtMillis || 0),
          id: `league-${history.playerId}-${detail.leagueId}-${index}`,
          method: payment.method || "",
          methodLabel: formatFinanceMethodLabel(payment.method || ""),
          playerId: history.playerId,
          playerName: history.playerName,
          sourceCategory: detail.category || "",
          sourceName: detail.leagueName || "Liga",
          sourceSex: detail.sex || "",
          sourceType: "leagues",
          sourceTypeLabel: "Liga",
          summary: payment.roundTitle || "Fecha",
        });
      });
    });
  });

  tournamentHistory.forEach((history) => {
    history.tournamentDetails.forEach((detail) => {
      detail.payments.forEach((payment, index) => {
        rows.push({
          amount: payment.amount || 0,
          dateMillis: Number(payment.confirmedAtMillis || 0),
          dateLabel: formatShortDate(payment.confirmedAtMillis || 0),
          id: `tournament-${history.playerId}-${detail.tournamentId}-${index}`,
          method: payment.method || "",
          methodLabel: formatFinanceMethodLabel(payment.method || ""),
          playerId: history.playerId,
          playerName: history.playerName,
          sourceCategory: detail.category || "",
          sourceName: detail.tournamentName || "Torneo",
          sourceSex: detail.sex || "",
          sourceType: "tournaments",
          sourceTypeLabel: "Torneo",
          summary: payment.pairLabel || "Inscripcion",
        });
      });
    });
  });

  turnoHistory.forEach((row) => {
    rows.push(row);
  });

  return rows.sort((first, second) => {
    const secondDate = Number(second.dateMillis || 0);
    const firstDate = Number(first.dateMillis || 0);

    if (secondDate !== firstDate) {
      return secondDate - firstDate;
    }

    return String(first.playerName || "").localeCompare(String(second.playerName || ""), "es");
  });
}

function ChipGroup({ onChange, options, value }) {
  return (
    <View style={styles.chipRow}>
      {options.map((option) => {
        const isActive = option.value === value;

        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.chip,
              isActive ? styles.chipActive : null,
              pressed ? styles.pressedState : null,
            ]}
          >
            <Text style={[styles.chipText, isActive ? styles.chipTextActive : null]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const CollectionRowsList = memo(function CollectionRowsList({
  expandedCollectionIds,
  onOpenItem,
  onToggleDetails,
  rows,
}) {
  const getActionLabel = (item) => {
    if (item.sourceType === "turns") {
      return item.status === "review" ? "Revisar" : "Cobrar";
    }

    return item.status === "review" ? "Revisar" : "Abrir";
  };

  return rows.map((row) => {
    const playerKey = String(row.playerId || row.playerName);
    const isExpanded = expandedCollectionIds.includes(playerKey);

    return (
      <Pressable
        key={playerKey}
        onPress={() => onToggleDetails(playerKey)}
        style={({ pressed }) => [
          styles.collectionCard,
          pressed ? styles.debtorCardPressed : null,
        ]}
      >
        <View style={styles.collectionHeader}>
          <AvatarBadge color={colors.primaryDark} size={38} uri={row.playerPhoto} />
          <View style={styles.collectionCopy}>
            <Text numberOfLines={1} style={styles.debtorName}>
              {row.playerName}
            </Text>
            <Text numberOfLines={1} style={styles.collectionAmountText}>
              Debe {formatCurrency(row.totalAmount)}
            </Text>
          </View>
          <Ionicons
            color={colors.textMuted}
            name={isExpanded ? "chevron-up" : "chevron-down"}
            size={18}
          />
        </View>

        <View style={styles.collectionMetaRow}>
          {row.pendingAmount > 0 ? (
            <View style={[styles.collectionStatusPill, styles.collectionStatusPillPending]}>
              <Text style={styles.collectionStatusPillPendingText}>
                Pendiente {formatCurrency(row.pendingAmount)}
              </Text>
            </View>
          ) : null}
          {row.reviewAmount > 0 ? (
            <View style={[styles.collectionStatusPill, styles.collectionStatusPillReview]}>
              <Text style={styles.collectionStatusPillReviewText}>
                Revision {formatCurrency(row.reviewAmount)}
              </Text>
            </View>
          ) : null}
        </View>

        {isExpanded ? (
          <View style={styles.collectionDetailList}>
            {row.items.map((item) => (
              <View key={item.itemId} style={styles.collectionDetailItem}>
                <View style={styles.collectionDetailCopy}>
                  <Text numberOfLines={1} style={styles.collectionDetailTitle}>
                    {item.sourceTypeLabel} · {item.sourceName}
                  </Text>
                  <Text numberOfLines={2} style={styles.collectionDetailText}>
                    {item.label}
                  </Text>
                  {item.sourceType === "turns" ? (
                    <View style={styles.collectionTurnMeta}>
                      <Text style={styles.collectionTurnMetaText}>
                        Pago: {formatCurrency(item.turnPaidAmount || 0)}
                      </Text>
                      <Text style={styles.collectionTurnMetaText}>
                        Debe: {formatCurrency(item.amount || 0)}
                      </Text>
                      <Text style={styles.collectionTurnMetaText}>
                        Estado: {item.turnStatusLabel || "Pendiente"}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.collectionDetailRight}>
                  <Text style={styles.collectionDetailAmount}>{formatCurrency(item.amount)}</Text>
                  <Pressable
                    onPress={() => onOpenItem(item)}
                    style={({ pressed }) => [
                      styles.collectionActionButton,
                      pressed ? styles.pressedState : null,
                    ]}
                  >
                    <Text style={styles.collectionActionButtonText}>
                      {getActionLabel(item)}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </Pressable>
    );
  });
});

const HistoryRowsList = memo(function HistoryRowsList({ rows }) {
  return rows.map((row) => (
    <View key={row.id} style={styles.historyLineCard}>
      <View style={styles.historyLineTop}>
        <Text numberOfLines={1} style={styles.historyLinePlayer}>
          {row.playerName}
        </Text>
        <Text style={styles.historyLineAmount}>{formatCurrency(row.amount)}</Text>
      </View>
      <Text numberOfLines={2} style={styles.historyLineText}>
        {row.sourceTypeLabel} · {row.sourceName} · {row.summary}
      </Text>
      <Text style={styles.historyLineMeta}>
        {row.methodLabel}
        {row.dateLabel ? ` · ${row.dateLabel}` : ""}
      </Text>
    </View>
  ));
});

export default function FinanzasScreen({ navigation }) {
  const { updateProfile, userData } = useAuth();
  const [form, setForm] = useState(() =>
    normalizePaymentDefaults(userData?.leaguePaymentDefaults || {})
  );
  const [activeFinanceTab, setActiveFinanceTab] = useState("cobros");
  const [activeSourceFilters, setActiveSourceFilters] = useState(() =>
    FINANCE_SOURCE_FILTERS.map((filter) => filter.key)
  );
  const [activeCobroStatus, setActiveCobroStatus] = useState("all");
  const [showFinanceAdvancedFilters, setShowFinanceAdvancedFilters] = useState(false);
  const [financeCategoryFilter, setFinanceCategoryFilter] = useState("all");
  const [financeSexFilter, setFinanceSexFilter] = useState("all");
  const [ownLeagues, setOwnLeagues] = useState([]);
  const [ownTournaments, setOwnTournaments] = useState([]);
  const [ownTurnoReservations, setOwnTurnoReservations] = useState([]);
  const [financePlayers, setFinancePlayers] = useState([]);
  const [expandedCollectionIds, setExpandedCollectionIds] = useState([]);
  const [expandedDebtorIds, setExpandedDebtorIds] = useState([]);
  const [expandedHistoryIds, setExpandedHistoryIds] = useState([]);
  const [expandedTournamentDebtorIds, setExpandedTournamentDebtorIds] = useState([]);
  const [expandedTournamentHistoryIds, setExpandedTournamentHistoryIds] = useState([]);
  const [financeSearch, setFinanceSearch] = useState("");
  const [leagueDebtSearch, setLeagueDebtSearch] = useState("");
  const [tournamentDebtSearch, setTournamentDebtSearch] = useState("");
  const [tournamentReminderSearch, setTournamentReminderSearch] = useState("");
  const [loadingLeagues, setLoadingLeagues] = useState(false);
  const [loadingTournaments, setLoadingTournaments] = useState(false);
  const [loadingTurnos, setLoadingTurnos] = useState(false);
  const [sendingReminderId, setSendingReminderId] = useState("");
  const [saving, setSaving] = useState(false);
  const [financeReloadKey, setFinanceReloadKey] = useState(0);
  const [feedback, setFeedback] = useState({
    visible: false,
    title: "",
    message: "",
    tone: "default",
  });
  const canManageFinances = isApprovedOrganizer(userData);
  const deferredSourceFilters = useDeferredValue(activeSourceFilters);
  const deferredCobroStatus = useDeferredValue(activeCobroStatus);
  const deferredFinanceSearch = useDeferredValue(financeSearch);

  useEffect(() => {
    setForm(normalizePaymentDefaults(userData?.leaguePaymentDefaults || {}));
  }, [userData?.leaguePaymentDefaults]);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      setFinanceReloadKey((current) => current + 1);
    });

    return unsubscribe;
  }, [navigation]);

  useEffect(() => {
    let isMounted = true;

    const loadOwnLeagues = async () => {
      if (!canManageFinances || !userData?.uid) {
        setOwnLeagues([]);
        return;
      }

      try {
        setLoadingLeagues(true);
        const leagues = await listLeagues();

        if (!isMounted) {
          return;
        }

        setOwnLeagues(
          leagues.filter((league) => normalizeText(league.organizerId) === normalizeText(userData.uid))
        );
      } catch (error) {
        if (isMounted) {
          setOwnLeagues([]);
        }
      } finally {
        if (isMounted) {
          setLoadingLeagues(false);
        }
      }
    };

    loadOwnLeagues();

    return () => {
      isMounted = false;
    };
  }, [canManageFinances, financeReloadKey, userData?.uid]);

  useEffect(() => {
    let isMounted = true;

    const loadOwnTurnoReservations = async () => {
      if (!canManageFinances || !userData?.uid) {
        setOwnTurnoReservations([]);
        return;
      }

      try {
        setLoadingTurnos(true);
        const reservations = await listOrganizerTurnoReservations(userData.uid);

        if (!isMounted) {
          return;
        }

        setOwnTurnoReservations(reservations);
      } catch (error) {
        if (isMounted) {
          setOwnTurnoReservations([]);
        }
      } finally {
        if (isMounted) {
          setLoadingTurnos(false);
        }
      }
    };

    loadOwnTurnoReservations();

    return () => {
      isMounted = false;
    };
  }, [canManageFinances, financeReloadKey, userData?.uid]);

  useEffect(() => {
    let isMounted = true;

    const loadOwnTournaments = async () => {
      if (!canManageFinances || !userData?.uid) {
        setOwnTournaments([]);
        return;
      }

      try {
        setLoadingTournaments(true);
        const tournaments = await listTournaments();
        const organizerTournaments = tournaments.filter(
          (tournament) => normalizeText(tournament.organizerId) === normalizeText(userData.uid)
        );
        const tournamentsWithRegistrations = await Promise.all(
          organizerTournaments.map(async (tournament) => ({
            ...tournament,
            registrations: (await listTournamentRegistrations(tournament.id)).filter(
              (registration) => registration.withdrawalStatus !== "confirmed"
            ),
          }))
        );

        if (!isMounted) {
          return;
        }

        setOwnTournaments(tournamentsWithRegistrations);
      } catch (error) {
        if (isMounted) {
          setOwnTournaments([]);
        }
      } finally {
        if (isMounted) {
          setLoadingTournaments(false);
        }
      }
    };

    loadOwnTournaments();

    return () => {
      isMounted = false;
    };
  }, [canManageFinances, financeReloadKey, userData?.uid]);

  useEffect(() => {
    let isMounted = true;

    const loadFinancePlayers = async () => {
      if (!canManageFinances) {
        setFinancePlayers([]);
        return;
      }

      try {
        const players = await listPlayers();

        if (!isMounted) {
          return;
        }

        setFinancePlayers(players);
      } catch (error) {
        if (isMounted) {
          setFinancePlayers([]);
        }
      }
    };

    loadFinancePlayers();

    return () => {
      isMounted = false;
    };
  }, [canManageFinances, financeReloadKey]);

  const defaultRoundPrice = Number.parseFloat(
    String(userData?.leaguePaymentDefaults?.roundPricePerPlayer || "0").replace(",", ".")
  );
  const financePlayerLookup = useMemo(
    () => buildFinancePlayerLookup(financePlayers),
    [financePlayers]
  );
  const leagueDebtors = useMemo(
    () =>
      buildLeagueDebtors(
        ownLeagues,
        Number.isFinite(defaultRoundPrice) ? defaultRoundPrice : 0
      ).map((debtor) => ({
        ...debtor,
        playerPhoto:
          debtor.playerPhoto ||
          resolveFinancePlayerPhoto(financePlayerLookup, [debtor.playerId, debtor.playerName]),
      })),
    [defaultRoundPrice, financePlayerLookup, ownLeagues]
  );
  const filteredLeagueDebtors = useMemo(
    () => filterLeagueDebtors(leagueDebtors, leagueDebtSearch),
    [leagueDebtors, leagueDebtSearch]
  );
  const leaguePaymentHistory = useMemo(
    () =>
      buildLeaguePaymentHistory(
        ownLeagues,
        Number.isFinite(defaultRoundPrice) ? defaultRoundPrice : 0
      ),
    [defaultRoundPrice, ownLeagues]
  );
  const cashSummary = useMemo(
    () =>
      buildCashSummary(
        ownLeagues,
        Number.isFinite(defaultRoundPrice) ? defaultRoundPrice : 0
      ),
    [defaultRoundPrice, ownLeagues]
  );
  const reminderItems = useMemo(() => buildLeagueReminderItems(ownLeagues), [ownLeagues]);
  const tournamentDebtors = useMemo(
    () =>
      buildTournamentDebtors(ownTournaments).map((debtor) => ({
        ...debtor,
        playerPhoto:
          debtor.playerPhoto ||
          resolveFinancePlayerPhoto(financePlayerLookup, [debtor.playerId, debtor.playerName]),
      })),
    [financePlayerLookup, ownTournaments]
  );
  const filteredTournamentDebtors = useMemo(
    () => filterTournamentDebtors(tournamentDebtors, tournamentDebtSearch),
    [tournamentDebtors, tournamentDebtSearch]
  );
  const tournamentPaymentHistory = useMemo(
    () => buildTournamentPaymentHistory(ownTournaments),
    [ownTournaments]
  );
  const turnoPaymentHistory = useMemo(
    () => buildTurnoPaymentHistory(ownTurnoReservations, financePlayerLookup),
    [financePlayerLookup, ownTurnoReservations]
  );
  const tournamentCashSummary = useMemo(
    () => buildTournamentCashSummary(ownTournaments),
    [ownTournaments]
  );
  const turnoCashSummary = useMemo(
    () => buildTurnoCashSummary(ownTurnoReservations),
    [ownTurnoReservations]
  );
  const tournamentReminderItems = useMemo(
    () =>
      buildTournamentReminderItems(ownTournaments).filter((item) =>
        normalizeText(`${item.playerName} ${item.tournament?.name || ""}`).includes(
          normalizeText(tournamentReminderSearch)
        )
      ),
    [ownTournaments, tournamentReminderSearch]
  );
  const leagueCollectionItems = useMemo(
    () =>
      buildLeagueCollectionRows(
        ownLeagues,
        Number.isFinite(defaultRoundPrice) ? defaultRoundPrice : 0,
        financePlayerLookup
      ),
    [defaultRoundPrice, financePlayerLookup, ownLeagues]
  );
  const tournamentCollectionItems = useMemo(
    () => buildTournamentCollectionRows(ownTournaments, financePlayerLookup),
    [financePlayerLookup, ownTournaments]
  );
  const turnoCollectionItems = useMemo(
    () => buildTurnoCollectionRows(ownTurnoReservations, financePlayerLookup),
    [financePlayerLookup, ownTurnoReservations]
  );
  const collectionItems = useMemo(
    () => [...leagueCollectionItems, ...tournamentCollectionItems, ...turnoCollectionItems],
    [leagueCollectionItems, tournamentCollectionItems, turnoCollectionItems]
  );
  const collectionRows = useMemo(() => buildCollectionRowsByPlayer(collectionItems), [collectionItems]);
  const filteredCollectionRows = useMemo(() => {
    const searchText = normalizeText(deferredFinanceSearch);

    return collectionRows
      .map((row) => {
        const filteredItems = row.items.filter((item) => {
          if (deferredSourceFilters.length && !deferredSourceFilters.includes(item.sourceType)) {
            return false;
          }

          if (deferredCobroStatus === "pending" && item.status !== "pending") {
            return false;
          }

          if (deferredCobroStatus === "review" && item.status !== "review") {
            return false;
          }

          if (financeCategoryFilter !== "all" && item.sourceCategory !== financeCategoryFilter) {
            return false;
          }

          if (financeSexFilter !== "all" && item.sourceSex !== financeSexFilter) {
            return false;
          }

          if (!searchText) {
            return true;
          }

          return normalizeText(`${row.playerName} ${item.sourceName} ${item.label}`).includes(searchText);
        });

        if (!filteredItems.length) {
          return null;
        }

        return {
          ...row,
          items: filteredItems,
          pendingAmount: filteredItems
            .filter((item) => item.status === "pending")
            .reduce((total, item) => total + Number(item.amount || 0), 0),
          reviewAmount: filteredItems
            .filter((item) => item.status === "review")
            .reduce((total, item) => total + Number(item.amount || 0), 0),
          sourceTypes: [...new Set(filteredItems.map((item) => item.sourceType))],
          totalAmount: filteredItems.reduce((total, item) => total + Number(item.amount || 0), 0),
        };
      })
      .filter(Boolean);
  }, [
    collectionRows,
    deferredCobroStatus,
    deferredFinanceSearch,
    deferredSourceFilters,
    financeCategoryFilter,
    financeSexFilter,
  ]);
  const historyRows = useMemo(
    () => buildCollectionHistoryRows(leaguePaymentHistory, tournamentPaymentHistory, turnoPaymentHistory),
    [leaguePaymentHistory, tournamentPaymentHistory, turnoPaymentHistory]
  );
  const financeCategoryOptions = useMemo(
    () =>
      buildFinanceFilterOptions([
        ...collectionItems.map((item) => item.sourceCategory),
        ...historyRows.map((row) => row.sourceCategory),
      ]),
    [collectionItems, historyRows]
  );
  const financeSexOptions = useMemo(
    () =>
      buildFinanceFilterOptions([
        ...collectionItems.map((item) => item.sourceSex),
        ...historyRows.map((row) => row.sourceSex),
      ]),
    [collectionItems, historyRows]
  );
  const filteredHistoryRows = useMemo(() => {
    const searchText = normalizeText(deferredFinanceSearch);

    return historyRows.filter((row) => {
      if (deferredSourceFilters.length && !deferredSourceFilters.includes(row.sourceType)) {
        return false;
      }

      if (financeCategoryFilter !== "all" && row.sourceCategory !== financeCategoryFilter) {
        return false;
      }

      if (financeSexFilter !== "all" && row.sourceSex !== financeSexFilter) {
        return false;
      }

      if (!searchText) {
        return true;
      }

      return normalizeText(`${row.playerName} ${row.sourceName} ${row.summary}`).includes(searchText);
    });
  }, [
    deferredFinanceSearch,
    deferredSourceFilters,
    financeCategoryFilter,
    financeSexFilter,
    historyRows,
  ]);
  const combinedSummary = useMemo(
    () => ({
      todayIncome:
        Number(cashSummary.today.income || 0) +
        Number(tournamentCashSummary.today.income || 0) +
        Number(turnoCashSummary.today.income || 0),
      todayPending:
        Number(cashSummary.today.pending || 0) +
        Number(tournamentCashSummary.today.pending || 0) +
        Number(turnoCashSummary.today.pending || 0),
      weekIncome:
        Number(cashSummary.last7Days.income || 0) +
        Number(tournamentCashSummary.last7Days.income || 0) +
        Number(turnoCashSummary.last7Days.income || 0),
      weekPending:
        Number(cashSummary.last7Days.pending || 0) +
        Number(tournamentCashSummary.last7Days.pending || 0) +
        Number(turnoCashSummary.last7Days.pending || 0),
      reviewAmount: collectionRows.reduce((total, row) => total + Number(row.reviewAmount || 0), 0),
      debtorsCount: collectionRows.length,
    }),
    [cashSummary, collectionRows, tournamentCashSummary, turnoCashSummary]
  );

  const toggleDebtorDetails = (playerId) => {
    setExpandedDebtorIds((current) => {
      const key = String(playerId);

      if (current.includes(key)) {
        return current.filter((item) => item !== key);
      }

      return [...current, key];
    });
  };

  const toggleCollectionDetails = useCallback((playerId) => {
    setExpandedCollectionIds((current) => {
      const key = String(playerId);

      if (current.includes(key)) {
        return current.filter((item) => item !== key);
      }

      return [...current, key];
    });
  }, []);

  const toggleHistoryDetails = (playerId) => {
    setExpandedHistoryIds((current) => {
      const key = String(playerId);

      if (current.includes(key)) {
        return current.filter((item) => item !== key);
      }

      return [...current, key];
    });
  };

  const toggleTournamentDebtorDetails = (playerId) => {
    setExpandedTournamentDebtorIds((current) => {
      const key = String(playerId);

      if (current.includes(key)) {
        return current.filter((item) => item !== key);
      }

      return [...current, key];
    });
  };

  const toggleTournamentHistoryDetails = (playerId) => {
    setExpandedTournamentHistoryIds((current) => {
      const key = String(playerId);

      if (current.includes(key)) {
        return current.filter((item) => item !== key);
      }

      return [...current, key];
    });
  };

  const updateField = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleHeaderBack = () => {
    navigation.goBack();
  };

  const showFeedback = (title, message, tone = "default") => {
    setFeedback({
      visible: true,
      title,
      message,
      tone,
    });
  };

  const handleSaveDefaults = async () => {
    const roundPrice = Number.parseFloat(String(form.roundPricePerPlayer || "").replace(",", "."));

    if (!Number.isFinite(roundPrice) || roundPrice <= 0) {
      showFeedback(
        "Falta el precio por fecha",
        "Indica el valor por fecha por jugador para tus nuevas ligas.",
        "danger"
      );
      return;
    }

    if (form.registrationFeeMode === "yes") {
      const registrationFee = Number.parseFloat(
        String(form.registrationFeeAmount || "").replace(",", ".")
      );

      if (!Number.isFinite(registrationFee) || registrationFee <= 0) {
        showFeedback(
          "Falta la inscripcion",
          "Indica el monto de inscripcion inicial para tus nuevas ligas.",
          "danger"
        );
        return;
      }
    }

    try {
      setSaving(true);
      await updateProfile({
        leaguePaymentDefaults: buildPaymentDefaultsPayload(form),
      });
      showFeedback(
        "Valores guardados",
        "Las nuevas ligas van a tomar estos importes por defecto.",
        "success"
      );
    } catch (error) {
      showFeedback(
        "No pudimos guardar los valores",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setSaving(false);
    }
  };

  const handleSendReminder = async (item) => {
    if (!item?.playerUserId) {
      showFeedback(
        "Sin usuario vinculado",
        "Este jugador no tiene usuario vinculado para recibir mensajes internos.",
        "danger"
      );
      return;
    }

    try {
      setSendingReminderId(item.id);
      await sendChatMessage({
        currentUserId: userData?.uid,
        currentUserName: userData?.name || "Organizador",
        otherUserId: item.playerUserId,
        otherUserName: item.playerName,
        text: buildReminderMessage({
          leagueName: item.league?.nombre || "Liga",
          roundTitle: item.round?.title || "Fecha",
          playerName: item.playerName,
        }),
      });

      try {
        await sendPaymentReminderPushAsync({
          leagueId: item.league?.id || "",
          leagueName: item.league?.nombre || "Liga",
          playerUserId: item.playerUserId,
          roundId: item.round?.roundId || "",
          roundTitle: item.round?.title || "Fecha",
          stageLabel: "Manual",
        });
      } catch (pushError) {
        console.log("[FinanzasScreen] No se pudo enviar push:", pushError?.message || pushError);
      }

      const nextPayments = resolveLeaguePaymentRounds(item.league).map((round) =>
        round.roundId !== item.round.roundId
          ? round
          : {
              ...round,
              entries: (round.entries || []).map((entry) =>
                entry.participantId !== item.entry.participantId
                  ? entry
                  : {
                      ...entry,
                      [item.stage.field]: Date.now(),
                      [item.stage.byField]: userData?.uid || "",
                      [item.stage.byNameField]: userData?.name || "Organizador",
                      updatedAtMillis: Date.now(),
                      updatedBy: userData?.uid || "",
                      updatedByName: userData?.name || "Organizador",
                    }
              ),
            }
      );

      await updateLeagueRoundPayments(item.league.id, serializeRoundPayments(nextPayments));
      setOwnLeagues((current) =>
        current.map((league) =>
          league.id === item.league.id
            ? {
                ...league,
                roundPayments: nextPayments,
              }
            : league
        )
      );
      showFeedback(
        "Recordatorio enviado",
        `Se envio el recordatorio a ${item.playerName}.`,
        "success"
      );
    } catch (error) {
      showFeedback(
        "No pudimos enviar el recordatorio",
        error?.message === "CHAT_BLOCKED"
          ? "No se puede enviar el mensaje porque la conversacion esta bloqueada."
          : error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setSendingReminderId("");
    }
  };

  const handleSendTournamentReminder = async (item) => {
    if (!item?.playerUserId) {
      showFeedback(
        "Sin usuario vinculado",
        "Este jugador no tiene usuario vinculado para recibir mensajes internos.",
        "danger"
      );
      return;
    }

    try {
      setSendingReminderId(item.id);
      await sendChatMessage({
        currentUserId: userData?.uid,
        currentUserName: userData?.name || "Organizador",
        otherUserId: item.playerUserId,
        otherUserName: item.playerName,
        text: `Hola ${item.playerName}. Te recordamos que sigue pendiente el pago de tu inscripcion en ${item.tournament?.name || "Torneo"}.`,
      });

      try {
        await sendTournamentPaymentReminderPushAsync({
          playerUserId: item.playerUserId,
          registrationId: item.registration?.id || "",
          tournamentId: item.tournament?.id || "",
          tournamentName: item.tournament?.name || "Torneo",
        });
      } catch (pushError) {
        console.log("[FinanzasScreen] No se pudo enviar push torneo:", pushError?.message || pushError);
      }

      showFeedback(
        "Recordatorio enviado",
        `Se envio el recordatorio a ${item.playerName}.`,
        "success"
      );
    } catch (error) {
      showFeedback(
        "No pudimos enviar el recordatorio",
        error?.message === "CHAT_BLOCKED"
          ? "No se puede enviar el mensaje porque la conversacion esta bloqueada."
          : error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setSendingReminderId("");
    }
  };

  const renderCollectionSourceChip = (sourceType) => {
    const label =
      sourceType === "leagues" ? "Liga" : sourceType === "tournaments" ? "Torneo" : "Turno";
    const filterKey =
      sourceType === "leagues" ? "leagues" : sourceType === "tournaments" ? "tournaments" : "turns";
    const isActive = activeSourceFilters.includes(filterKey);

    return (
      <Pressable
        key={sourceType}
        onPress={() =>
          setActiveSourceFilters((current) => {
            const next = current.includes(filterKey)
              ? current.filter((item) => item !== filterKey)
              : [...current, filterKey];

            return next.length ? next : current;
          })
        }
        style={({ pressed }) => [
          styles.collectionSourceChip,
          isActive ? styles.collectionSourceChipActive : null,
          pressed ? styles.pressedState : null,
        ]}
      >
        <Text
          style={[
            styles.collectionSourceChipText,
            isActive ? styles.collectionSourceChipTextActive : null,
          ]}
        >
          {label}
        </Text>
      </Pressable>
    );
  };

  const openCollectionItem = useCallback((item) => {
    if (!item) {
      return;
    }

    if (item.sourceType === "leagues") {
      navigation.navigate("LeaguePayments", {
        leagueId: item.sourceId,
        leagueName: item.sourceName,
        focusPlayerId: item.playerId || "",
        focusPlayerName: item.playerName || "",
      });
      return;
    }

    if (item.sourceType === "tournaments") {
      navigation.navigate("TournamentPayments", {
        tournamentId: item.sourceId,
        tournamentName: item.sourceName,
        focusPlayerId: item.playerId || "",
        focusPlayerName: item.playerName || "",
      });
      return;
    }

    if (item.sourceType === "turns") {
      navigation.navigate("Turnos", {
        focusReservationId: item.sourceId,
        openPaymentEntry: item.status !== "review",
      });
    }
  }, [navigation]);

  const toggleSourceFilter = useCallback((filterKey) => {
    setActiveSourceFilters((current) => {
      const next = current.includes(filterKey)
        ? current.filter((item) => item !== filterKey)
        : [...current, filterKey];

      return next.length ? next : current;
    });
  }, []);

  const toggleFinanceAdvancedFilters = useCallback(() => {
    setShowFinanceAdvancedFilters((current) => !current);
  }, []);

  const renderFinanceAdvancedFilters = () => (
    <View style={styles.advancedFiltersPanel}>
      <View style={styles.advancedFiltersSection}>
        <Text style={styles.advancedFiltersLabel}>Categoria</Text>
        <View style={styles.advancedFiltersChipRow}>
          {financeCategoryOptions.map((option) => {
            const isActive = financeCategoryFilter === option.key;

            return (
              <Pressable
                key={`category-${option.key}`}
                onPress={() => setFinanceCategoryFilter(option.key)}
                style={({ pressed }) => [
                  styles.advancedFilterChip,
                  isActive ? styles.advancedFilterChipActive : null,
                  pressed ? styles.pressedState : null,
                ]}
              >
                <Text
                  style={[
                    styles.advancedFilterChipText,
                    isActive ? styles.advancedFilterChipTextActive : null,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.advancedFiltersSection}>
        <Text style={styles.advancedFiltersLabel}>Sexo</Text>
        <View style={styles.advancedFiltersChipRow}>
          {financeSexOptions.map((option) => {
            const isActive = financeSexFilter === option.key;

            return (
              <Pressable
                key={`sex-${option.key}`}
                onPress={() => setFinanceSexFilter(option.key)}
                style={({ pressed }) => [
                  styles.advancedFilterChip,
                  isActive ? styles.advancedFilterChipActive : null,
                  pressed ? styles.pressedState : null,
                ]}
              >
                <Text
                  style={[
                    styles.advancedFilterChipText,
                    isActive ? styles.advancedFilterChipTextActive : null,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );

  const renderCobrosTab = () => {
    const isLoading = loadingLeagues || loadingTournaments || loadingTurnos;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <View>
            <Text style={styles.cardTitle}>Pendientes por jugador</Text>
          </View>
          <Ionicons color={colors.primaryDark} name="wallet-outline" size={24} />
        </View>

        <View style={styles.sourceFilterGrid}>
          {FINANCE_SOURCE_FILTERS.map((filter) => {
            const isActive = activeSourceFilters.includes(filter.key);

            return (
              <Pressable
                key={filter.key}
                onPress={() => toggleSourceFilter(filter.key)}
                style={({ pressed }) => [
                  styles.sourceFilterSquare,
                  isActive ? styles.sourceFilterSquareActive : null,
                  pressed ? styles.pressedState : null,
                ]}
              >
                <View
                  style={[
                    styles.sourceFilterCheck,
                    isActive ? styles.sourceFilterCheckActive : null,
                  ]}
                >
                  {isActive ? <Ionicons color={colors.surface} name="checkmark" size={12} /> : null}
                </View>
                <Text
                  style={[
                    styles.sourceFilterSquareText,
                    isActive ? styles.sourceFilterSquareTextActive : null,
                  ]}
                >
                  {filter.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.searchWrap}>
          <Ionicons color={colors.textMuted} name="search-outline" size={18} />
          <TextInput
            onChangeText={setFinanceSearch}
            placeholder="Buscar jugador o competencia"
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
            value={financeSearch}
          />
          <Pressable
            onPress={toggleFinanceAdvancedFilters}
            style={({ pressed }) => [
              styles.searchFilterButton,
              showFinanceAdvancedFilters ? styles.searchFilterButtonActive : null,
              pressed ? styles.pressedState : null,
            ]}
          >
            <Ionicons
              color={showFinanceAdvancedFilters ? colors.surface : colors.textMuted}
              name="options-outline"
              size={18}
            />
          </Pressable>
        </View>

        {showFinanceAdvancedFilters ? renderFinanceAdvancedFilters() : null}

        <View style={styles.financeFilterRow}>
          {COBRO_STATUS_FILTERS.map((filter) => {
            const isActive = activeCobroStatus === filter.key;

            return (
              <Pressable
                key={filter.key}
                onPress={() => setActiveCobroStatus(filter.key)}
                style={({ pressed }) => [
                  styles.statusFilterChip,
                  isActive ? styles.statusFilterChipActive : null,
                  pressed ? styles.pressedState : null,
                ]}
              >
                <Text style={[styles.statusFilterChipText, isActive ? styles.statusFilterChipTextActive : null]}>
                  {filter.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {isLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.primaryDark} />
            <Text style={styles.loadingText}>Preparando cobros...</Text>
          </View>
        ) : null}

        {!isLoading && !filteredCollectionRows.length ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>Sin cobros para mostrar</Text>
            <Text style={styles.emptyText}>
              Cuando haya deudas o comprobantes pendientes, van a aparecer agrupados por jugador.
            </Text>
          </View>
        ) : null}

        {!isLoading ? (
          <CollectionRowsList
            expandedCollectionIds={expandedCollectionIds}
            onOpenItem={openCollectionItem}
            onToggleDetails={toggleCollectionDetails}
            rows={filteredCollectionRows}
          />
        ) : null}
      </View>
    );
  };

  const renderHistoryTab = () => {
    const isLoading = loadingLeagues || loadingTournaments || loadingTurnos;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <View>
            <Text style={styles.cardEyebrow}>HISTORIAL</Text>
            <Text style={styles.cardTitle}>Pagos confirmados</Text>
          </View>
          <Ionicons color={colors.primaryDark} name="receipt-outline" size={24} />
        </View>

        <View style={styles.sourceFilterGrid}>
          {FINANCE_SOURCE_FILTERS.map((filter) => {
            const isActive = activeSourceFilters.includes(filter.key);

            return (
              <Pressable
                key={filter.key}
                onPress={() => toggleSourceFilter(filter.key)}
                style={({ pressed }) => [
                  styles.sourceFilterSquare,
                  isActive ? styles.sourceFilterSquareActive : null,
                  pressed ? styles.pressedState : null,
                ]}
              >
                <View
                  style={[
                    styles.sourceFilterCheck,
                    isActive ? styles.sourceFilterCheckActive : null,
                  ]}
                >
                  {isActive ? <Ionicons color={colors.surface} name="checkmark" size={12} /> : null}
                </View>
                <Text
                  style={[
                    styles.sourceFilterSquareText,
                    isActive ? styles.sourceFilterSquareTextActive : null,
                  ]}
                >
                  {filter.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.searchWrap}>
          <Ionicons color={colors.textMuted} name="search-outline" size={18} />
          <TextInput
            onChangeText={setFinanceSearch}
            placeholder="Buscar jugador o competencia"
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
            value={financeSearch}
          />
          <Pressable
            onPress={toggleFinanceAdvancedFilters}
            style={({ pressed }) => [
              styles.searchFilterButton,
              showFinanceAdvancedFilters ? styles.searchFilterButtonActive : null,
              pressed ? styles.pressedState : null,
            ]}
          >
            <Ionicons
              color={showFinanceAdvancedFilters ? colors.surface : colors.textMuted}
              name="options-outline"
              size={18}
            />
          </Pressable>
        </View>

        {showFinanceAdvancedFilters ? renderFinanceAdvancedFilters() : null}

        {isLoading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.primaryDark} />
            <Text style={styles.loadingText}>Armando historial...</Text>
          </View>
        ) : null}

        {!isLoading && !filteredHistoryRows.length ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>Sin pagos registrados</Text>
            <Text style={styles.emptyText}>
              Cuando se confirmen pagos, apareceran aca en formato de historial.
            </Text>
          </View>
        ) : null}

        {!isLoading ? <HistoryRowsList rows={filteredHistoryRows} /> : null}
      </View>
    );
  };

  const renderSummaryTab = () => (
    <View style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <View>
          <Text style={styles.cardEyebrow}>RESUMEN</Text>
          <Text style={styles.cardTitle}>Vista rapida</Text>
        </View>
        <Ionicons color={colors.primaryDark} name="stats-chart-outline" size={24} />
      </View>

      <View style={styles.summaryMiniGrid}>
        <View style={styles.summaryMiniCard}>
          <Text style={styles.summaryMiniLabel}>Ingresado hoy</Text>
          <Text style={styles.summaryMiniValue}>{formatCurrency(combinedSummary.todayIncome)}</Text>
        </View>
        <View style={styles.summaryMiniCard}>
          <Text style={styles.summaryMiniLabel}>Pendiente hoy</Text>
          <Text style={[styles.summaryMiniValue, styles.summaryMiniValueWarning]}>
            {formatCurrency(combinedSummary.todayPending)}
          </Text>
        </View>
        <View style={styles.summaryMiniCard}>
          <Text style={styles.summaryMiniLabel}>Ingresado 7 dias</Text>
          <Text style={styles.summaryMiniValue}>{formatCurrency(combinedSummary.weekIncome)}</Text>
        </View>
        <View style={styles.summaryMiniCard}>
          <Text style={styles.summaryMiniLabel}>Pendiente total</Text>
          <Text style={[styles.summaryMiniValue, styles.summaryMiniValueWarning]}>
            {formatCurrency(combinedSummary.weekPending + combinedSummary.reviewAmount)}
          </Text>
        </View>
        <View style={styles.summaryMiniCard}>
          <Text style={styles.summaryMiniLabel}>Jugadores con deuda</Text>
          <Text style={styles.summaryMiniValue}>{combinedSummary.debtorsCount}</Text>
        </View>
        <View style={styles.summaryMiniCard}>
          <Text style={styles.summaryMiniLabel}>A revisar</Text>
          <Text style={[styles.summaryMiniValue, styles.summaryMiniValueInfo]}>
            {formatCurrency(combinedSummary.reviewAmount)}
          </Text>
        </View>
      </View>
    </View>
  );

  const renderSettingsTab = () => (
    <View style={styles.card}>
      <View style={styles.cardHeaderRow}>
        <View>
          <Text style={styles.cardEyebrow}>AJUSTES</Text>
          <Text style={styles.cardTitle}>Valores predeterminados</Text>
        </View>
        <Ionicons color={colors.primaryDark} name="cog-outline" size={24} />
      </View>

      <Text style={styles.sectionLabel}>Inscripcion inicial</Text>
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
      />

      {form.registrationFeeMode === "yes" ? (
        <View style={styles.inlineFieldRow}>
          <Text style={styles.inlineFieldLabel}>Monto de inscripcion</Text>
          <TextInput
            keyboardType="decimal-pad"
            onChangeText={(value) => updateField("registrationFeeAmount", sanitizeDecimal(value))}
            placeholder="0"
            placeholderTextColor={colors.muted}
            style={styles.inlineFieldInput}
            value={form.registrationFeeAmount}
          />
        </View>
      ) : null}

      <View style={styles.inlineFieldRow}>
        <Text style={styles.inlineFieldLabel}>Precio por fecha por jugador</Text>
        <TextInput
          keyboardType="decimal-pad"
          onChangeText={(value) => updateField("roundPricePerPlayer", sanitizeDecimal(value))}
          placeholder="0"
          placeholderTextColor={colors.muted}
          style={styles.inlineFieldInput}
          value={form.roundPricePerPlayer}
        />
      </View>

      <Text style={styles.helperText}>
        Guardar aca cambia el valor base para ligas nuevas. Las ligas ya creadas mantienen su propio importe.
      </Text>

      <Pressable
        disabled={saving}
        onPress={handleSaveDefaults}
        style={({ pressed }) => [
          styles.primaryButton,
          saving ? styles.primaryButtonDisabled : null,
          pressed && !saving ? styles.pressedState : null,
        ]}
      >
        <Text style={styles.primaryButtonText}>
          {saving ? "GUARDANDO..." : "GUARDAR CONFIGURACION"}
        </Text>
      </Pressable>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader onBack={handleHeaderBack} subtitle="Centro de Cobros" />
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />

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
{!canManageFinances ? (
  <View style={styles.card}>
    <Text style={styles.cardTitle}>Acceso de organizador</Text>
    <Text style={styles.cardText}>
      Esta area queda disponible para organizadores aprobados.
    </Text>
  </View>
) : (
  <>
    <View style={styles.financeTabsRow}>
      {FINANCE_TABS.map((tab) => {
        const isActive = activeFinanceTab === tab.key;

        return (
          <Pressable
            key={tab.key}
            onPress={() => setActiveFinanceTab(tab.key)}
            style={({ pressed }) => [
              styles.financeTabButton,
              isActive ? styles.financeTabButtonActive : null,
              pressed ? styles.pressedState : null,
            ]}
          >
            <Ionicons
              color={isActive ? colors.surface : colors.primaryDark}
              name={tab.icon}
              size={18}
            />
            <Text
              style={[
                styles.financeTabButtonText,
                isActive ? styles.financeTabButtonTextActive : null,
              ]}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>

    {activeFinanceTab === "cobros" ? renderCobrosTab() : null}
    {activeFinanceTab === "history" ? renderHistoryTab() : null}
    {activeFinanceTab === "summary" ? renderSummaryTab() : null}
    {activeFinanceTab === "settings" ? renderSettingsTab() : null}
  </>
)}
      </ScrollView>
    </KeyboardAvoidingView>

      <BottomQuickActionsBar />
      <FeedbackModal
        message={feedback.message}
        onClose={() =>
          setFeedback({
            visible: false,
            title: "",
            message: "",
            tone: "default",
          })
        }
        title={feedback.title}
        tone={feedback.tone}
        visible={feedback.visible}
      />
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
  backgroundOrbTop: {
    position: "absolute",
    top: -45,
    right: -30,
    width: 190,
    height: 190,
    borderRadius: 999,
    backgroundColor: "rgba(31,171,137,0.13)",
  },
  backgroundOrbBottom: {
    position: "absolute",
    left: -70,
    bottom: 120,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(11,132,87,0.08)",
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: 2,
    paddingBottom: spacing.xl + BOTTOM_QUICK_ACTIONS_SPACE,
    gap: spacing.md,
  },
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: "center",
    gap: spacing.xs,
  },
  heroEyebrow: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0,
  },
  heroTitle: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "900",
  },
  heroText: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  cardEyebrow: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "900",
  },
  cardTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  cardText: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  moduleButtonsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  moduleButton: {
    width: "48%",
    minHeight: 84,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    padding: spacing.sm,
  },
  moduleButtonActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  moduleButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
  },
  moduleButtonTextActive: {
    color: colors.surface,
  },
  moduleButtonMiniSummary: {
    alignItems: "center",
    gap: 2,
  },
  moduleButtonMiniTitle: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "uppercase",
  },
  moduleButtonMiniText: {
    color: "#197B59",
    fontSize: 11,
    fontWeight: "900",
    textAlign: "center",
  },
  moduleButtonMiniMuted: {
    color: "#B24343",
    fontSize: 10,
    fontWeight: "900",
    textAlign: "center",
  },
  financeSubHeader: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
  },
  financeBackButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: 2,
    minHeight: 38,
    paddingHorizontal: spacing.sm,
  },
  financeBackButtonText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
  },
  financeSubTitleWrap: {
    flex: 1,
  },
  financeSubTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  leagueAreaButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  leagueAreaButton: {
    width: "48%",
    minHeight: 92,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
  },
  leagueAreaButtonActive: {
    backgroundColor: "#178A45",
    borderColor: "#178A45",
  },
  leagueAreaButtonText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 18,
    textAlign: "center",
  },
  leagueAreaButtonTextActive: {
    color: colors.surface,
  },
  cashSummaryGrid: {
    gap: spacing.sm,
  },
  cashSummaryBlock: {
    backgroundColor: "#F5FAFD",
    borderColor: "#C9DDEA",
    borderRadius: 8,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  cashSummaryTitle: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
  },
  cashMetricRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  cashMetricLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  cashIncomeAmount: {
    color: "#197B59",
    fontSize: 15,
    fontWeight: "900",
  },
  cashPendingAmount: {
    color: "#B24343",
    fontSize: 15,
    fontWeight: "900",
  },
  cashDailyRow: {
    borderTopColor: "#DCEAF2",
    borderTopWidth: 1,
    gap: spacing.xs,
    paddingTop: spacing.sm,
  },
  cashDailyLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  cashDailyAmounts: {
    gap: 3,
  },
  cashDailyIncome: {
    color: "#197B59",
    fontSize: 12,
    fontWeight: "900",
  },
  cashDailyPending: {
    color: "#B24343",
    fontSize: 12,
    fontWeight: "900",
  },
  sectionLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
    marginTop: spacing.xs,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  chip: {
    minHeight: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  chipActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  chipText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  chipTextActive: {
    color: colors.surface,
  },
  inlineFieldRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inlineFieldLabel: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  inlineFieldInput: {
    width: 110,
    minHeight: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
    paddingHorizontal: spacing.sm,
    textAlign: "right",
  },
  helperText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  primaryButton: {
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: colors.primaryDark,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  primaryButtonDisabled: {
    opacity: 0.55,
  },
  primaryButtonText: {
    color: colors.surface,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
  },
  disabledAction: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E7E0C4",
    backgroundColor: "#FAF6E8",
    padding: spacing.md,
    gap: 4,
  },
  disabledActionTitle: {
    color: "#7A6625",
    fontSize: 13,
    fontWeight: "900",
  },
  disabledActionText: {
    color: "#8A7A39",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  loadingBox: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.lg,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
  },
  emptyBox: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    padding: spacing.md,
    gap: 4,
  },
  searchWrap: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    color: colors.text,
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    minHeight: 44,
    paddingVertical: 0,
  },
  searchFilterButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchFilterButtonActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  advancedFiltersPanel: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D8E3ED",
    backgroundColor: "#F8FBFD",
    padding: spacing.md,
    gap: spacing.sm,
  },
  advancedFiltersSection: {
    gap: spacing.xs,
  },
  advancedFiltersLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
  },
  advancedFiltersChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  advancedFilterChip: {
    minHeight: 32,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#D3DEE8",
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  advancedFilterChipActive: {
    backgroundColor: "#E7F1F8",
    borderColor: "#9DBAD0",
  },
  advancedFilterChipText: {
    color: "#5B7385",
    fontSize: 12,
    fontWeight: "800",
  },
  advancedFilterChipTextActive: {
    color: "#2E607F",
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  debtorCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    padding: spacing.md,
    gap: spacing.xs,
  },
  debtorCardPressed: {
    opacity: 0.82,
  },
  debtorHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  debtorAvatar: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: colors.primaryDark,
    alignItems: "center",
    justifyContent: "center",
  },
  historyAvatar: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: "#197B59",
    alignItems: "center",
    justifyContent: "center",
  },
  debtorAvatarText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: "900",
  },
  debtorCopy: {
    flex: 1,
  },
  debtorName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  debtorLeague: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  debtorAmount: {
    color: "#B24343",
    fontSize: 14,
    fontWeight: "900",
  },
  historyAmount: {
    color: "#197B59",
    fontSize: 14,
    fontWeight: "900",
  },
  debtorChevron: {
    marginLeft: -2,
  },
  debtorDetail: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },
  debtorDetailList: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  debtorLeagueDetail: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#D4E3EF",
    backgroundColor: "#F4FAFE",
    padding: spacing.sm,
    gap: 4,
  },
  debtorLeagueDetailHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  debtorLeagueDetailTitle: {
    flex: 1,
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "900",
  },
  debtorLeagueDetailAmount: {
    color: "#B24343",
    fontSize: 13,
    fontWeight: "900",
  },
  debtorLeagueDetailText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },
  debtorLeagueCategory: {
    color: "#1C76A7",
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  debtorTransfer: {
    color: "#8C6A05",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
  },
  historyCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#B9DCCA",
    backgroundColor: "#F4FBF7",
    padding: spacing.md,
    gap: spacing.xs,
  },
  historyLeagueDetail: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#B9DCCA",
    backgroundColor: colors.surface,
    padding: spacing.sm,
    gap: 4,
  },
  historyLeagueDetailAmount: {
    color: "#197B59",
    fontSize: 13,
    fontWeight: "900",
  },
  historyPaymentLine: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },
  reminderCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    padding: spacing.md,
    gap: spacing.sm,
  },
  reminderHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  reminderBadge: {
    minWidth: 44,
    minHeight: 34,
    borderRadius: 8,
    backgroundColor: "#B24343",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  reminderBadgeText: {
    color: colors.surface,
    fontSize: 12,
    fontWeight: "900",
  },
  reminderCopy: {
    flex: 1,
  },
  reminderButton: {
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: colors.primaryDark,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  reminderButtonText: {
    color: colors.surface,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
  },
  moduleGrid: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  moduleCard: {
    flex: 1,
    minHeight: 128,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.xs,
  },
  moduleTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  moduleText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  financeTabsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  financeTabButton: {
    width: "23%",
    minHeight: 64,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  financeTabButtonActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  financeTabButtonText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
  },
  financeTabButtonTextActive: {
    color: colors.surface,
  },
  financeFilterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  compactFilterChip: {
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  compactFilterChipActive: {
    backgroundColor: "#E5F4EF",
    borderColor: "#A7D6C4",
  },
  compactFilterChipText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
  },
  compactFilterChipTextActive: {
    color: colors.primaryDark,
  },
  sourceFilterGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  sourceFilterSquare: {
    width: "31%",
    minHeight: 62,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#C6DAD0",
    backgroundColor: "#F4FAF7",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  sourceFilterSquareActive: {
    backgroundColor: "#DCEFE6",
    borderColor: "#7FB89D",
  },
  sourceFilterCheck: {
    width: 18,
    height: 18,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#A8C8B7",
    backgroundColor: "#EEF6F1",
    alignItems: "center",
    justifyContent: "center",
  },
  sourceFilterCheckActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  sourceFilterSquareText: {
    color: "#456A5C",
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
  },
  sourceFilterSquareTextActive: {
    color: "#1E5642",
  },
  statusFilterChip: {
    minHeight: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#D8E3ED",
    backgroundColor: "#F7FAFD",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  statusFilterChipActive: {
    backgroundColor: "#E9F1F9",
    borderColor: "#AFC7DE",
  },
  statusFilterChipText: {
    color: "#567287",
    fontSize: 12,
    fontWeight: "800",
  },
  statusFilterChipTextActive: {
    color: "#2E607F",
  },
  collectionCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    padding: spacing.md,
    gap: spacing.sm,
  },
  collectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  collectionCopy: {
    flex: 1,
    gap: 2,
  },
  collectionAmountText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  collectionMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  collectionStatusPill: {
    minHeight: 28,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  collectionStatusPillPending: {
    backgroundColor: "#FFF0EE",
  },
  collectionStatusPillPendingText: {
    color: "#B24343",
    fontSize: 11,
    fontWeight: "900",
  },
  collectionStatusPillReview: {
    backgroundColor: "#EEF6FF",
  },
  collectionStatusPillReviewText: {
    color: "#2A6DA8",
    fontSize: 11,
    fontWeight: "900",
  },
  collectionSourceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  collectionSourceChip: {
    minHeight: 24,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  collectionSourceChipActive: {
    backgroundColor: "#E5F4EF",
    borderColor: "#A7D6C4",
  },
  collectionSourceChipText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
  },
  collectionSourceChipTextActive: {
    color: colors.primaryDark,
  },
  collectionDetailList: {
    gap: spacing.xs,
  },
  collectionDetailItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  collectionDetailCopy: {
    flex: 1,
    gap: 2,
  },
  collectionDetailTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  collectionDetailText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  collectionTurnMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: 4,
  },
  collectionTurnMetaText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
  },
  collectionDetailRight: {
    alignItems: "flex-end",
    gap: spacing.xs,
  },
  collectionDetailAmount: {
    color: "#B24343",
    fontSize: 13,
    fontWeight: "900",
  },
  collectionActionButton: {
    minHeight: 28,
    borderRadius: 999,
    backgroundColor: colors.primaryDark,
    paddingHorizontal: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  collectionActionButtonText: {
    color: colors.surface,
    fontSize: 11,
    fontWeight: "900",
  },
  historyLineCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    padding: spacing.md,
    gap: spacing.xs,
  },
  historyLineTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  historyLinePlayer: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  historyLineAmount: {
    color: "#197B59",
    fontSize: 14,
    fontWeight: "900",
  },
  historyLineText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700",
  },
  historyLineMeta: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  summaryMiniGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  summaryMiniCard: {
    width: "48%",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    padding: spacing.md,
    gap: 4,
  },
  summaryMiniLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  summaryMiniValue: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "900",
  },
  summaryMiniValueWarning: {
    color: "#B24343",
  },
  summaryMiniValueInfo: {
    color: "#1E6A8F",
  },
  pressedState: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
});






