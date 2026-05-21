import { useEffect, useState } from "react";
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
              leagueId,
              leagueName: league.nombre || "Liga",
              payments: [],
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

export default function FinanzasScreen({ navigation }) {
  const { updateProfile, userData } = useAuth();
  const [form, setForm] = useState(() =>
    normalizePaymentDefaults(userData?.leaguePaymentDefaults || {})
  );
  const [activeModule, setActiveModule] = useState("");
  const [activeLeagueArea, setActiveLeagueArea] = useState("");
  const [activeTournamentArea, setActiveTournamentArea] = useState("");
  const [ownLeagues, setOwnLeagues] = useState([]);
  const [ownTournaments, setOwnTournaments] = useState([]);
  const [financePlayers, setFinancePlayers] = useState([]);
  const [expandedDebtorIds, setExpandedDebtorIds] = useState([]);
  const [expandedHistoryIds, setExpandedHistoryIds] = useState([]);
  const [expandedTournamentDebtorIds, setExpandedTournamentDebtorIds] = useState([]);
  const [expandedTournamentHistoryIds, setExpandedTournamentHistoryIds] = useState([]);
  const [leagueDebtSearch, setLeagueDebtSearch] = useState("");
  const [tournamentDebtSearch, setTournamentDebtSearch] = useState("");
  const [tournamentReminderSearch, setTournamentReminderSearch] = useState("");
  const [loadingLeagues, setLoadingLeagues] = useState(false);
  const [loadingTournaments, setLoadingTournaments] = useState(false);
  const [sendingReminderId, setSendingReminderId] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState({
    visible: false,
    title: "",
    message: "",
    tone: "default",
  });
  const canManageFinances = isApprovedOrganizer(userData);

  useEffect(() => {
    setForm(normalizePaymentDefaults(userData?.leaguePaymentDefaults || {}));
  }, [userData?.leaguePaymentDefaults]);

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
  }, [canManageFinances, userData?.uid]);

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
  }, [canManageFinances, userData?.uid]);

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
  }, [canManageFinances]);

  const defaultRoundPrice = Number.parseFloat(
    String(userData?.leaguePaymentDefaults?.roundPricePerPlayer || "0").replace(",", ".")
  );
  const financePlayerLookup = buildFinancePlayerLookup(financePlayers);
  const leagueDebtors = buildLeagueDebtors(
    ownLeagues,
    Number.isFinite(defaultRoundPrice) ? defaultRoundPrice : 0
  ).map((debtor) => ({
    ...debtor,
    playerPhoto:
      debtor.playerPhoto ||
      resolveFinancePlayerPhoto(financePlayerLookup, [debtor.playerId, debtor.playerName]),
  }));
  const filteredLeagueDebtors = filterLeagueDebtors(leagueDebtors, leagueDebtSearch);
  const leaguePaymentHistory = buildLeaguePaymentHistory(
    ownLeagues,
    Number.isFinite(defaultRoundPrice) ? defaultRoundPrice : 0
  );
  const cashSummary = buildCashSummary(
    ownLeagues,
    Number.isFinite(defaultRoundPrice) ? defaultRoundPrice : 0
  );
  const reminderItems = buildLeagueReminderItems(ownLeagues);
  const tournamentDebtors = buildTournamentDebtors(ownTournaments)
    .map((debtor) => ({
      ...debtor,
      playerPhoto:
        debtor.playerPhoto ||
        resolveFinancePlayerPhoto(financePlayerLookup, [debtor.playerId, debtor.playerName]),
    }));
  const filteredTournamentDebtors = filterTournamentDebtors(tournamentDebtors, tournamentDebtSearch);
  const tournamentPaymentHistory = buildTournamentPaymentHistory(ownTournaments);
  const tournamentCashSummary = buildTournamentCashSummary(ownTournaments);
  const tournamentReminderItems = buildTournamentReminderItems(ownTournaments).filter((item) =>
    normalizeText(`${item.playerName} ${item.tournament?.name || ""}`).includes(
      normalizeText(tournamentReminderSearch)
    )
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
    if (activeModule === "ligas" && activeLeagueArea) {
      setActiveLeagueArea("");
      return;
    }

    if (activeModule === "torneos" && activeTournamentArea) {
      setActiveTournamentArea("");
      return;
    }

    if (activeModule) {
      setActiveModule("");
      setActiveLeagueArea("");
      setActiveTournamentArea("");
      return;
    }

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

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader onBack={handleHeaderBack} subtitle="Finanzas" />
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
          <View style={styles.heroCard}>
            <Text style={styles.heroEyebrow}>
              {activeModule === "ligas"
                ? "GESTION GENERAL LIGAS"
                : activeModule === "torneos"
                ? "GESTION GENERAL TORNEOS"
                : "GESTION GENERAL"}
            </Text>
          </View>

          {!canManageFinances ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Acceso de organizador</Text>
              <Text style={styles.cardText}>
                Esta area queda disponible para organizadores aprobados.
              </Text>
            </View>
          ) : (
            <>
              {!activeModule ? (
              <View style={styles.moduleButtonsGrid}>
                {FINANCE_MODULES.map((module) => {
                  const isActive = activeModule === module.key;

                  return (
                    <Pressable
                      key={module.key}
                      onPress={() => {
                        setActiveModule(module.key);
                        setActiveLeagueArea("");
                        setActiveTournamentArea("");
                      }}
                      style={({ pressed }) => [
                        styles.moduleButton,
                        isActive ? styles.moduleButtonActive : null,
                        pressed ? styles.pressedState : null,
                      ]}
                    >
                      <Ionicons
                        color={isActive ? colors.surface : colors.primaryDark}
                        name={module.icon}
                        size={22}
                      />
                      <Text style={[styles.moduleButtonText, isActive ? styles.moduleButtonTextActive : null]}>
                        {module.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              ) : null}

              {activeModule === "ligas" && !activeLeagueArea ? (
                <View style={styles.leagueAreaButtons}>
                  {LEAGUE_FINANCE_AREAS.map((area) => {
                    const isActive = activeLeagueArea === area.key;

                    return (
                      <Pressable
                        key={area.key}
                        onPress={() => setActiveLeagueArea(area.key)}
                        style={({ pressed }) => [
                          styles.leagueAreaButton,
                          isActive ? styles.leagueAreaButtonActive : null,
                          pressed ? styles.pressedState : null,
                        ]}
                      >
                        <Ionicons
                          color={isActive ? colors.surface : colors.primaryDark}
                          name={area.icon}
                          size={24}
                        />
                        <Text style={[styles.leagueAreaButtonText, isActive ? styles.leagueAreaButtonTextActive : null]}>
                          {area.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              {activeModule === "torneos" && !activeTournamentArea ? (
                <View style={styles.leagueAreaButtons}>
                  {TOURNAMENT_FINANCE_AREAS.map((area) => {
                    const isActive = activeTournamentArea === area.key;

                    return (
                      <Pressable
                        key={area.key}
                        onPress={() => setActiveTournamentArea(area.key)}
                        style={({ pressed }) => [
                          styles.leagueAreaButton,
                          isActive ? styles.leagueAreaButtonActive : null,
                          pressed ? styles.pressedState : null,
                        ]}
                      >
                        <Ionicons
                          color={isActive ? colors.surface : colors.primaryDark}
                          name={area.icon}
                          size={24}
                        />
                        <Text style={[styles.leagueAreaButtonText, isActive ? styles.leagueAreaButtonTextActive : null]}>
                          {area.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              {activeModule && activeModule !== "ligas" && activeModule !== "torneos" ? (
                <View style={styles.card}>
                  <View style={styles.cardHeaderRow}>
                    <View>
                      <Text style={styles.cardEyebrow}>{activeModule.toUpperCase()}</Text>
                      <Text style={styles.cardTitle}>Proximamente</Text>
                    </View>
                    <Ionicons color={colors.primaryDark} name="construct-outline" size={24} />
                  </View>
                  <Text style={styles.cardText}>
                    Esta parte todavia no esta desarrollada. La dejamos dentro de Finanzas para
                    centralizar torneos y turnos cuando avancemos esos modulos.
                  </Text>
                </View>
              ) : null}

              {activeModule === "ligas" && activeLeagueArea === "cash" ? (
                <View style={styles.card}>
                  <View style={styles.cardHeaderRow}>
                    <View>
                      <Text style={styles.cardEyebrow}>LIGAS</Text>
                      <Text style={styles.cardTitle}>Caja de Ligas</Text>
                    </View>
                    <Ionicons color={colors.primaryDark} name="cash-outline" size={24} />
                  </View>

                  {loadingLeagues ? (
                    <View style={styles.loadingBox}>
                      <ActivityIndicator color={colors.primaryDark} />
                      <Text style={styles.loadingText}>Calculando caja...</Text>
                    </View>
                  ) : null}

                  {!loadingLeagues ? (
                    <>
                      <View style={styles.cashSummaryGrid}>
                        <View style={styles.cashSummaryBlock}>
                          <Text style={styles.cashSummaryTitle}>HOY</Text>
                          <View style={styles.cashMetricRow}>
                            <Text style={styles.cashMetricLabel}>Ingresos</Text>
                            <Text style={styles.cashIncomeAmount}>
                              {formatCurrency(cashSummary.today.income)}
                            </Text>
                          </View>
                          <View style={styles.cashMetricRow}>
                            <Text style={styles.cashMetricLabel}>Impagos</Text>
                            <Text style={styles.cashPendingAmount}>
                              {formatCurrency(cashSummary.today.pending)}
                            </Text>
                          </View>
                        </View>

                        <View style={styles.cashSummaryBlock}>
                          <Text style={styles.cashSummaryTitle}>ULTIMOS 7 DIAS</Text>
                          {cashSummary.daily.map((day) => (
                            <View key={day.key} style={styles.cashDailyRow}>
                              <Text style={styles.cashDailyLabel}>{day.label}</Text>
                              <View style={styles.cashDailyAmounts}>
                                <Text style={styles.cashDailyIncome}>
                                  Ingresos {formatCurrency(day.income)}
                                </Text>
                                <Text style={styles.cashDailyPending}>
                                  Impagos {formatCurrency(day.pending)}
                                </Text>
                              </View>
                            </View>
                          ))}
                        </View>
                      </View>

                      <Text style={styles.helperText}>
                        Los ingresos se toman de pagos confirmados. Los impagos se calculan solo
                        cuando el jugador pertenece a un partido con ganador cargado.
                      </Text>
                    </>
                  ) : null}
                </View>
              ) : null}

              {activeModule === "ligas" && activeLeagueArea === "values" ? (
              <View style={styles.card}>
                <View style={styles.cardHeaderRow}>
                  <View>
                    <Text style={styles.cardEyebrow}>LIGAS</Text>
                    <Text style={styles.cardTitle}>Valores predeterminados</Text>
                  </View>
                  <Ionicons color={colors.primaryDark} name="wallet-outline" size={24} />
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
                  Guardar aca cambia el valor base para ligas nuevas. Las ligas ya creadas
                  conservan su propio importe hasta que decidas actualizarlas.
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
                    {saving ? "GUARDANDO..." : "GUARDAR PARA NUEVAS LIGAS"}
                  </Text>
                </Pressable>

                <View style={styles.disabledAction}>
                  <Text style={styles.disabledActionTitle}>Aplicar a ligas activas</Text>
                  <Text style={styles.disabledActionText}>
                    Lo dejamos separado para desarrollarlo con seleccion manual de ligas y evitar
                    cambios masivos por error.
                  </Text>
                </View>
              </View>
              ) : null}

              {activeModule === "ligas" && activeLeagueArea === "debts" ? (
                <View style={styles.card}>
                  <View style={styles.cardHeaderRow}>
                    <View>
                      <Text style={styles.cardEyebrow}>LIGAS</Text>
                      <Text style={styles.cardTitle}>Deudas Individuales</Text>
                    </View>
                    <Ionicons color={colors.primaryDark} name="people-outline" size={24} />
                  </View>

                  {loadingLeagues ? (
                    <View style={styles.loadingBox}>
                      <ActivityIndicator color={colors.primaryDark} />
                      <Text style={styles.loadingText}>Calculando deudas...</Text>
                    </View>
                  ) : null}

                  <View style={styles.searchWrap}>
                    <Ionicons color={colors.textMuted} name="search-outline" size={18} />
                    <TextInput
                      onChangeText={setLeagueDebtSearch}
                      placeholder="Buscar por jugador o categoria"
                      placeholderTextColor={colors.textMuted}
                      style={styles.searchInput}
                      value={leagueDebtSearch}
                    />
                  </View>

                  {!loadingLeagues && !filteredLeagueDebtors.length ? (
                    <View style={styles.emptyBox}>
                      <Text style={styles.emptyTitle}>
                        {leagueDebtSearch.trim() ? "Sin resultados" : "Sin deudas registradas"}
                      </Text>
                      <Text style={styles.emptyText}>
                        {leagueDebtSearch.trim()
                          ? "No encontramos jugadores o categorias que coincidan con tu busqueda."
                          : "Cuando haya fechas impagas en tus ligas, van a aparecer agrupadas por jugador."}
                      </Text>
                    </View>
                  ) : null}

                  {!loadingLeagues
                    ? filteredLeagueDebtors.map((debtor) => {
                        const debtorKey = String(debtor.playerId || debtor.playerName);
                        const isExpanded = expandedDebtorIds.includes(debtorKey);
                        const leagueCount = debtor.leagueDetails.length;
                        const roundCount = debtor.pendingRounds.length;

                        return (
                          <Pressable
                            key={debtorKey}
                            onPress={() => toggleDebtorDetails(debtorKey)}
                            style={({ pressed }) => [
                              styles.debtorCard,
                              pressed ? styles.debtorCardPressed : null,
                            ]}
                          >
                            <View style={styles.debtorHeader}>
                              <AvatarBadge color={colors.primaryDark} size={36} uri={debtor.playerPhoto} />
                              <View style={styles.debtorCopy}>
                                <Text numberOfLines={1} style={styles.debtorName}>
                                  {debtor.playerName}
                                </Text>
                                <Text numberOfLines={1} style={styles.debtorLeague}>
                                  {leagueCount === 1
                                    ? debtor.leagueDetails[0]?.leagueName || "Liga"
                                    : `${leagueCount} ligas con deuda`}
                                </Text>
                              </View>
                              <Text style={styles.debtorAmount}>{formatCurrency(debtor.amount)}</Text>
                              <Ionicons
                                color={colors.textMuted}
                                name={isExpanded ? "chevron-up" : "chevron-down"}
                                size={18}
                                style={styles.debtorChevron}
                              />
                            </View>
                            <Text style={styles.debtorDetail}>Total fechas impagas: {roundCount}</Text>

                            {isExpanded ? (
                              <View style={styles.debtorDetailList}>
                                {debtor.leagueDetails.map((detail) => (
                                  <View key={detail.leagueId} style={styles.debtorLeagueDetail}>
                                    <View style={styles.debtorLeagueDetailHeader}>
                                      <Text numberOfLines={1} style={styles.debtorLeagueDetailTitle}>
                                        {detail.leagueName}
                                      </Text>
                                      <Text style={styles.debtorLeagueDetailAmount}>
                                        {formatCurrency(detail.amount)}
                                      </Text>
                                    </View>
                                    {detail.category ? (
                                      <Text style={styles.debtorLeagueCategory}>{detail.category}</Text>
                                    ) : null}
                                    <Text style={styles.debtorLeagueDetailText}>
                                      Fechas impagas: {detail.pendingRounds.join(", ")}
                                    </Text>
                                  </View>
                                ))}
                              </View>
                            ) : null}
                          </Pressable>
                        );
                      })
                    : null}
                </View>
              ) : null}

              {activeModule === "ligas" && activeLeagueArea === "history" ? (
                <View style={styles.card}>
                  <View style={styles.cardHeaderRow}>
                    <View>
                      <Text style={styles.cardEyebrow}>LIGAS</Text>
                      <Text style={styles.cardTitle}>Historial de Pagos</Text>
                    </View>
                    <Ionicons color={colors.primaryDark} name="receipt-outline" size={24} />
                  </View>

                  {loadingLeagues ? (
                    <View style={styles.loadingBox}>
                      <ActivityIndicator color={colors.primaryDark} />
                      <Text style={styles.loadingText}>Armando historial...</Text>
                    </View>
                  ) : null}

                  {!loadingLeagues && !leaguePaymentHistory.length ? (
                    <View style={styles.emptyBox}>
                      <Text style={styles.emptyTitle}>Sin pagos registrados</Text>
                      <Text style={styles.emptyText}>
                        Cuando marques pagos en tus ligas, van a aparecer agrupados por jugador.
                      </Text>
                    </View>
                  ) : null}

                  {!loadingLeagues
                    ? leaguePaymentHistory.map((history) => {
                        const historyKey = String(history.playerId || history.playerName);
                        const isExpanded = expandedHistoryIds.includes(historyKey);
                        const leagueCount = history.leagueDetails.length;

                        return (
                          <Pressable
                            key={historyKey}
                            onPress={() => toggleHistoryDetails(historyKey)}
                            style={({ pressed }) => [
                              styles.historyCard,
                              pressed ? styles.debtorCardPressed : null,
                            ]}
                          >
                            <View style={styles.debtorHeader}>
                              <View style={styles.historyAvatar}>
                                <Text style={styles.debtorAvatarText}>
                                  {String(history.playerName || "J").charAt(0).toUpperCase()}
                                </Text>
                              </View>
                              <View style={styles.debtorCopy}>
                                <Text numberOfLines={1} style={styles.debtorName}>
                                  {history.playerName}
                                </Text>
                                <Text numberOfLines={1} style={styles.debtorLeague}>
                                  {leagueCount === 1
                                    ? history.leagueDetails[0]?.leagueName || "Liga"
                                    : `${leagueCount} ligas con pagos`}
                                </Text>
                              </View>
                              <Text style={styles.historyAmount}>{formatCurrency(history.amount)}</Text>
                              <Ionicons
                                color={colors.textMuted}
                                name={isExpanded ? "chevron-up" : "chevron-down"}
                                size={18}
                                style={styles.debtorChevron}
                              />
                            </View>
                            <Text style={styles.debtorDetail}>
                              Total pagos registrados: {history.paymentCount}
                            </Text>

                            {isExpanded ? (
                              <View style={styles.debtorDetailList}>
                                {history.leagueDetails.map((detail) => (
                                  <View key={detail.leagueId} style={styles.historyLeagueDetail}>
                                    <View style={styles.debtorLeagueDetailHeader}>
                                      <Text numberOfLines={1} style={styles.debtorLeagueDetailTitle}>
                                        {detail.leagueName}
                                      </Text>
                                      <Text style={styles.historyLeagueDetailAmount}>
                                        {formatCurrency(detail.amount)}
                                      </Text>
                                    </View>
                                    {detail.payments.map((payment, index) => {
                                      const confirmedDate = formatShortDate(payment.confirmedAtMillis);

                                      return (
                                        <Text
                                          key={`${detail.leagueId}-${payment.roundTitle}-${index}`}
                                          style={styles.historyPaymentLine}
                                        >
                                          {payment.roundTitle} · {getPaymentMethodLabel(payment.method)}
                                          {confirmedDate ? ` · ${confirmedDate}` : ""}
                                        </Text>
                                      );
                                    })}
                                  </View>
                                ))}
                              </View>
                            ) : null}
                          </Pressable>
                        );
                      })
                    : null}
                </View>
              ) : null}

              {activeModule === "ligas" && activeLeagueArea === "reminders" ? (
                <View style={styles.card}>
                  <View style={styles.cardHeaderRow}>
                    <View>
                      <Text style={styles.cardEyebrow}>LIGAS</Text>
                      <Text style={styles.cardTitle}>Recordatorios de deuda</Text>
                    </View>
                    <Ionicons color={colors.primaryDark} name="notifications-outline" size={24} />
                  </View>

                  <Text style={styles.helperText}>
                    Aca aparecen los jugadores con pagos pendientes de fechas ya jugadas. El envio
                    del recordatorio es siempre manual.
                  </Text>

                  {loadingLeagues ? (
                    <View style={styles.loadingBox}>
                      <ActivityIndicator color={colors.primaryDark} />
                      <Text style={styles.loadingText}>Buscando recordatorios...</Text>
                    </View>
                  ) : null}

                  {!loadingLeagues && !reminderItems.length ? (
                    <View style={styles.emptyBox}>
                      <Text style={styles.emptyTitle}>Sin recordatorios pendientes</Text>
                      <Text style={styles.emptyText}>
                        Cuando una fecha jugada tenga pagos pendientes, apareceran aca.
                      </Text>
                    </View>
                  ) : null}

                  {!loadingLeagues
                    ? reminderItems.map((item) => (
                        <View key={item.id} style={styles.reminderCard}>
                          <View style={styles.reminderHeader}>
                            <View style={styles.reminderBadge}>
                              <Text style={styles.reminderBadgeText}>{item.stage.label}</Text>
                            </View>
                            <View style={styles.reminderCopy}>
                              <Text numberOfLines={1} style={styles.debtorName}>
                                {item.playerName}
                              </Text>
                              <Text numberOfLines={1} style={styles.debtorLeague}>
                                {item.league?.nombre || "Liga"} · {item.round?.title || "Fecha"}
                              </Text>
                            </View>
                          </View>
                          <Pressable
                            disabled={sendingReminderId === item.id}
                            onPress={() => handleSendReminder(item)}
                            style={({ pressed }) => [
                              styles.reminderButton,
                              sendingReminderId === item.id ? styles.primaryButtonDisabled : null,
                              pressed && sendingReminderId !== item.id ? styles.pressedState : null,
                            ]}
                          >
                            <Text style={styles.reminderButtonText}>
                              {sendingReminderId === item.id ? "ENVIANDO..." : "ENVIAR RECORDATORIO"}
                            </Text>
                          </Pressable>
                        </View>
                      ))
                    : null}
                </View>
              ) : null}

              {activeModule === "torneos" && activeTournamentArea === "debts" ? (
                <View style={styles.card}>
                  <View style={styles.cardHeaderRow}>
                    <View>
                      <Text style={styles.cardEyebrow}>TORNEOS</Text>
                      <Text style={styles.cardTitle}>Deudas Individuales</Text>
                    </View>
                    <Ionicons color={colors.primaryDark} name="people-outline" size={24} />
                  </View>

                  {loadingTournaments ? (
                    <View style={styles.loadingBox}>
                      <ActivityIndicator color={colors.primaryDark} />
                      <Text style={styles.loadingText}>Calculando deudas...</Text>
                    </View>
                  ) : null}

                  <View style={styles.searchWrap}>
                    <Ionicons color={colors.textMuted} name="search-outline" size={18} />
                    <TextInput
                      onChangeText={setTournamentDebtSearch}
                      placeholder="Buscar por jugador o torneo"
                      placeholderTextColor={colors.textMuted}
                      style={styles.searchInput}
                      value={tournamentDebtSearch}
                    />
                  </View>

                  {!loadingTournaments && !filteredTournamentDebtors.length ? (
                    <View style={styles.emptyBox}>
                      <Text style={styles.emptyTitle}>
                        {tournamentDebtSearch.trim() ? "Sin resultados" : "Sin deudas registradas"}
                      </Text>
                      <Text style={styles.emptyText}>
                        {tournamentDebtSearch.trim()
                          ? "No encontramos jugadores o torneos que coincidan con tu busqueda."
                          : "Cuando haya inscripciones impagas en tus torneos, van a aparecer agrupadas por jugador."}
                      </Text>
                    </View>
                  ) : null}

                  {!loadingTournaments
                    ? filteredTournamentDebtors.map((debtor) => {
                        const debtorKey = String(debtor.playerId || debtor.playerName);
                        const isExpanded = expandedTournamentDebtorIds.includes(debtorKey);

                        return (
                          <Pressable
                            key={debtorKey}
                            onPress={() => toggleTournamentDebtorDetails(debtorKey)}
                            style={({ pressed }) => [
                              styles.debtorCard,
                              pressed ? styles.debtorCardPressed : null,
                            ]}
                          >
                            <View style={styles.debtorHeader}>
                              <AvatarBadge color={colors.primaryDark} size={36} uri={debtor.playerPhoto} />
                              <View style={styles.debtorCopy}>
                                <Text numberOfLines={1} style={styles.debtorName}>
                                  {debtor.playerName}
                                </Text>
                                <Text numberOfLines={1} style={styles.debtorLeague}>
                                  {debtor.tournamentDetails.length === 1
                                    ? debtor.tournamentDetails[0]?.tournamentName || "Torneo"
                                    : `${debtor.tournamentDetails.length} torneos con deuda`}
                                </Text>
                              </View>
                              <Text style={styles.debtorAmount}>{formatCurrency(debtor.amount)}</Text>
                              <Ionicons
                                color={colors.textMuted}
                                name={isExpanded ? "chevron-up" : "chevron-down"}
                                size={18}
                                style={styles.debtorChevron}
                              />
                            </View>
                            <Text style={styles.debtorDetail}>INSCRIPCION IMPAGA</Text>

                            {isExpanded ? (
                              <View style={styles.debtorDetailList}>
                                {debtor.tournamentDetails.map((detail) => (
                                  <View key={detail.tournamentId} style={styles.debtorLeagueDetail}>
                                    <View style={styles.debtorLeagueDetailHeader}>
                                      <Text numberOfLines={1} style={styles.debtorLeagueDetailTitle}>
                                        {detail.tournamentName}
                                      </Text>
                                      <Text style={styles.debtorLeagueDetailAmount}>
                                        {formatCurrency(detail.amount)}
                                      </Text>
                                    </View>
                                    {detail.pairLabel ? (
                                      <Text style={styles.debtorLeagueCategory}>{detail.pairLabel}</Text>
                                    ) : null}
                                    <Text style={styles.debtorLeagueDetailText}>
                                      Estado pendiente: {[...new Set(detail.statuses)].join(", ")}
                                    </Text>
                                  </View>
                                ))}
                              </View>
                            ) : null}
                          </Pressable>
                        );
                      })
                    : null}
                </View>
              ) : null}

              {activeModule === "torneos" && activeTournamentArea === "history" ? (
                <View style={styles.card}>
                  <View style={styles.cardHeaderRow}>
                    <View>
                      <Text style={styles.cardEyebrow}>TORNEOS</Text>
                      <Text style={styles.cardTitle}>Historial de Pagos</Text>
                    </View>
                    <Ionicons color={colors.primaryDark} name="receipt-outline" size={24} />
                  </View>

                  <Text style={styles.helperText}>
                    Se muestran los pagos aprobados de los ultimos 30 dias.
                  </Text>

                  {loadingTournaments ? (
                    <View style={styles.loadingBox}>
                      <ActivityIndicator color={colors.primaryDark} />
                      <Text style={styles.loadingText}>Armando historial...</Text>
                    </View>
                  ) : null}

                  {!loadingTournaments && !tournamentPaymentHistory.length ? (
                    <View style={styles.emptyBox}>
                      <Text style={styles.emptyTitle}>Sin pagos registrados</Text>
                      <Text style={styles.emptyText}>
                        Cuando registres pagos aprobados en tus torneos, van a aparecer aca.
                      </Text>
                    </View>
                  ) : null}

                  {!loadingTournaments
                    ? tournamentPaymentHistory.map((history) => {
                        const historyKey = String(history.playerId || history.playerName);
                        const isExpanded = expandedTournamentHistoryIds.includes(historyKey);

                        return (
                          <Pressable
                            key={historyKey}
                            onPress={() => toggleTournamentHistoryDetails(historyKey)}
                            style={({ pressed }) => [
                              styles.historyCard,
                              pressed ? styles.debtorCardPressed : null,
                            ]}
                          >
                            <View style={styles.debtorHeader}>
                              <View style={styles.historyAvatar}>
                                <Text style={styles.debtorAvatarText}>
                                  {String(history.playerName || "J").charAt(0).toUpperCase()}
                                </Text>
                              </View>
                              <View style={styles.debtorCopy}>
                                <Text numberOfLines={1} style={styles.debtorName}>
                                  {history.playerName}
                                </Text>
                                <Text numberOfLines={1} style={styles.debtorLeague}>
                                  {history.tournamentDetails.length === 1
                                    ? history.tournamentDetails[0]?.tournamentName || "Torneo"
                                    : `${history.tournamentDetails.length} torneos con pagos`}
                                </Text>
                              </View>
                              <Text style={styles.historyAmount}>{formatCurrency(history.amount)}</Text>
                              <Ionicons
                                color={colors.textMuted}
                                name={isExpanded ? "chevron-up" : "chevron-down"}
                                size={18}
                                style={styles.debtorChevron}
                              />
                            </View>
                            <Text style={styles.debtorDetail}>
                              Total pagos registrados: {history.paymentCount}
                            </Text>

                            {isExpanded ? (
                              <View style={styles.debtorDetailList}>
                                {history.tournamentDetails.map((detail) => (
                                  <View key={detail.tournamentId} style={styles.historyLeagueDetail}>
                                    <View style={styles.debtorLeagueDetailHeader}>
                                      <Text numberOfLines={1} style={styles.debtorLeagueDetailTitle}>
                                        {detail.tournamentName}
                                      </Text>
                                      <Text style={styles.historyLeagueDetailAmount}>
                                        {formatCurrency(detail.amount)}
                                      </Text>
                                    </View>
                                    {detail.payments.map((payment, index) => {
                                      const confirmedDate = formatShortDate(payment.confirmedAtMillis);

                                      return (
                                        <Text
                                          key={`${detail.tournamentId}-${payment.pairLabel}-${index}`}
                                          style={styles.historyPaymentLine}
                                        >
                                          {payment.pairLabel || "Inscripcion"} · {getPaymentMethodLabel(payment.method)}
                                          {confirmedDate ? ` · ${confirmedDate}` : ""}
                                        </Text>
                                      );
                                    })}
                                  </View>
                                ))}
                              </View>
                            ) : null}
                          </Pressable>
                        );
                      })
                    : null}
                </View>
              ) : null}

              {activeModule === "torneos" && activeTournamentArea === "reminders" ? (
                <View style={styles.card}>
                  <View style={styles.cardHeaderRow}>
                    <View>
                      <Text style={styles.cardEyebrow}>TORNEOS</Text>
                      <Text style={styles.cardTitle}>Recordatorios de deuda</Text>
                    </View>
                    <Ionicons color={colors.primaryDark} name="notifications-outline" size={24} />
                  </View>

                  <Text style={styles.helperText}>
                    Aca podes enviar recordatorios manuales a inscripciones pendientes de pago.
                  </Text>

                  <View style={styles.searchWrap}>
                    <Ionicons color={colors.textMuted} name="search-outline" size={18} />
                    <TextInput
                      onChangeText={setTournamentReminderSearch}
                      placeholder="Buscar por jugador o torneo"
                      placeholderTextColor={colors.textMuted}
                      style={styles.searchInput}
                      value={tournamentReminderSearch}
                    />
                  </View>

                  {loadingTournaments ? (
                    <View style={styles.loadingBox}>
                      <ActivityIndicator color={colors.primaryDark} />
                      <Text style={styles.loadingText}>Buscando recordatorios...</Text>
                    </View>
                  ) : null}

                  {!loadingTournaments && !tournamentReminderItems.length ? (
                    <View style={styles.emptyBox}>
                      <Text style={styles.emptyTitle}>
                        {tournamentReminderSearch.trim() ? "Sin resultados" : "Sin recordatorios pendientes"}
                      </Text>
                      <Text style={styles.emptyText}>
                        {tournamentReminderSearch.trim()
                          ? "No encontramos inscripciones impagas que coincidan con tu busqueda."
                          : "Cuando haya inscripciones impagas en tus torneos, apareceran aca."}
                      </Text>
                    </View>
                  ) : null}

                  {!loadingTournaments
                    ? tournamentReminderItems.map((item) => (
                        <View key={item.id} style={styles.reminderCard}>
                          <View style={styles.reminderHeader}>
                            <View style={styles.reminderBadge}>
                              <Text style={styles.reminderBadgeText}>PENDIENTE</Text>
                            </View>
                            <View style={styles.reminderCopy}>
                              <Text numberOfLines={1} style={styles.debtorName}>
                                {item.playerName}
                              </Text>
                              <Text numberOfLines={1} style={styles.debtorLeague}>
                                {item.tournament?.name || "Torneo"} · {item.registration?.pairLabel || "Inscripcion"}
                              </Text>
                            </View>
                          </View>
                          <Pressable
                            disabled={sendingReminderId === item.id}
                            onPress={() => handleSendTournamentReminder(item)}
                            style={({ pressed }) => [
                              styles.reminderButton,
                              sendingReminderId === item.id ? styles.primaryButtonDisabled : null,
                              pressed && sendingReminderId !== item.id ? styles.pressedState : null,
                            ]}
                          >
                            <Text style={styles.reminderButtonText}>
                              {sendingReminderId === item.id ? "ENVIANDO..." : "ENVIAR RECORDATORIO"}
                            </Text>
                          </Pressable>
                        </View>
                      ))
                    : null}
                </View>
              ) : null}

              {activeModule === "torneos" && activeTournamentArea === "cash" ? (
                <View style={styles.card}>
                  <View style={styles.cardHeaderRow}>
                    <View>
                      <Text style={styles.cardEyebrow}>TORNEOS</Text>
                      <Text style={styles.cardTitle}>Caja de Torneos</Text>
                    </View>
                    <Ionicons color={colors.primaryDark} name="cash-outline" size={24} />
                  </View>

                  {loadingTournaments ? (
                    <View style={styles.loadingBox}>
                      <ActivityIndicator color={colors.primaryDark} />
                      <Text style={styles.loadingText}>Calculando caja...</Text>
                    </View>
                  ) : null}

                  {!loadingTournaments ? (
                    <>
                      <View style={styles.cashSummaryGrid}>
                        <View style={styles.cashSummaryBlock}>
                          <Text style={styles.cashSummaryTitle}>HOY</Text>
                          <View style={styles.cashMetricRow}>
                            <Text style={styles.cashMetricLabel}>Ingresos</Text>
                            <Text style={styles.cashIncomeAmount}>
                              {formatCurrency(tournamentCashSummary.today.income)}
                            </Text>
                          </View>
                          <View style={styles.cashMetricRow}>
                            <Text style={styles.cashMetricLabel}>Impagos</Text>
                            <Text style={styles.cashPendingAmount}>
                              {formatCurrency(tournamentCashSummary.today.pending)}
                            </Text>
                          </View>
                        </View>

                        <View style={styles.cashSummaryBlock}>
                          <Text style={styles.cashSummaryTitle}>ULTIMOS 7 DIAS</Text>
                          {tournamentCashSummary.daily.map((day) => (
                            <View key={day.key} style={styles.cashDailyRow}>
                              <Text style={styles.cashDailyLabel}>{day.label}</Text>
                              <View style={styles.cashDailyAmounts}>
                                <Text style={styles.cashDailyIncome}>
                                  Ingresos {formatCurrency(day.income)}
                                </Text>
                                <Text style={styles.cashDailyPending}>
                                  Impagos {formatCurrency(day.pending)}
                                </Text>
                              </View>
                            </View>
                          ))}
                        </View>
                      </View>

                      <Text style={styles.helperText}>
                        Los ingresos se toman de pagos aprobados. Los impagos reflejan inscripciones pendientes o rechazadas con importe cargado.
                      </Text>
                    </>
                  ) : null}
                </View>
              ) : null}
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
  pressedState: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
});

