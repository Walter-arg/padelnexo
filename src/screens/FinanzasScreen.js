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
import FeedbackModal from "../components/FeedbackModal";
import SectionHeader from "../components/SectionHeader";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import {
  listLeagues,
  resolveLeaguePaymentRounds,
  updateLeagueRoundPayments,
} from "../services/leaguesService";
import { isApprovedOrganizer } from "../services/roleService";
import { sendChatMessage } from "../services/chatService";
import { sendPaymentReminderPushAsync } from "../services/pushNotificationsService";

const FINANCE_MODULES = [
  { key: "ligas", label: "Ligas", icon: "tennisball-outline" },
  { key: "torneos", label: "Torneos", icon: "trophy-outline" },
  { key: "turnos", label: "Turnos", icon: "calendar-outline" },
  { key: "caja", label: "Caja General", icon: "cash-outline" },
];

const LEAGUE_FINANCE_AREAS = [
  { key: "values", label: "VALORES DE LIGAS", icon: "cash-outline" },
  { key: "debts", label: "Deudas Individuales", icon: "people-outline" },
  { key: "history", label: "Historial de Pagos", icon: "receipt-outline" },
  { key: "reminders", label: "Recordatorios", icon: "notifications-outline" },
];

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

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

  const elapsed = now - completedAtMillis;

  if (elapsed >= TWENTY_FOUR_HOURS_MS && !entry.reminder24hSentAtMillis) {
    return {
      key: "24h",
      label: "24 hs",
      field: "reminder24hSentAtMillis",
      byField: "reminder24hSentBy",
      byNameField: "reminder24hSentByName",
    };
  }

  if (elapsed >= FOUR_HOURS_MS && !entry.reminder4hSentAtMillis) {
    return {
      key: "4h",
      label: "4 hs",
      field: "reminder4hSentAtMillis",
      byField: "reminder4hSentBy",
      byNameField: "reminder4hSentByName",
    };
  }

  return null;
}

function buildReminderMessage({ leagueName, roundTitle, playerName, stageLabel }) {
  return `Hola ${playerName}. Te recordamos que sigue pendiente el pago de ${roundTitle} en ${leagueName}. Recordatorio ${stageLabel}.`;
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
            pendingRounds: [],
            leagueDetails: [],
          };
          const leagueId = league.id || league.nombre || "liga";
          let leagueDetail = current.leagueDetails.find((detail) => detail.leagueId === leagueId);

          if (!leagueDetail) {
            leagueDetail = {
              amount: 0,
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
  const [ownLeagues, setOwnLeagues] = useState([]);
  const [expandedDebtorIds, setExpandedDebtorIds] = useState([]);
  const [expandedHistoryIds, setExpandedHistoryIds] = useState([]);
  const [loadingLeagues, setLoadingLeagues] = useState(false);
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

  const defaultRoundPrice = Number.parseFloat(
    String(userData?.leaguePaymentDefaults?.roundPricePerPlayer || "0").replace(",", ".")
  );
  const leagueDebtors = buildLeagueDebtors(
    ownLeagues,
    Number.isFinite(defaultRoundPrice) ? defaultRoundPrice : 0
  );
  const leaguePaymentHistory = buildLeaguePaymentHistory(
    ownLeagues,
    Number.isFinite(defaultRoundPrice) ? defaultRoundPrice : 0
  );
  const cashSummary = buildCashSummary(
    ownLeagues,
    Number.isFinite(defaultRoundPrice) ? defaultRoundPrice : 0
  );
  const reminderItems = buildLeagueReminderItems(ownLeagues);

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

    if (activeModule) {
      setActiveModule("");
      setActiveLeagueArea("");
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
          stageLabel: item.stage.label,
        }),
      });

      try {
        await sendPaymentReminderPushAsync({
          leagueId: item.league?.id || "",
          leagueName: item.league?.nombre || "Liga",
          playerUserId: item.playerUserId,
          roundId: item.round?.roundId || "",
          roundTitle: item.round?.title || "Fecha",
          stageLabel: item.stage.label,
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
        `Se envio el recordatorio de ${item.stage.label} a ${item.playerName}.`,
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
            <Text style={styles.heroEyebrow}>GESTION GENERAL</Text>
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
                      {module.key === "caja" ? (
                        <View style={styles.moduleButtonMiniSummary}>
                          <Text style={styles.moduleButtonMiniTitle}>Hoy</Text>
                          <Text style={styles.moduleButtonMiniText}>
                            Ingresos {formatCurrency(cashSummary.today.income)}
                          </Text>
                          <Text style={styles.moduleButtonMiniMuted}>
                            Impagos: {formatCurrency(cashSummary.today.pending)}
                          </Text>
                        </View>
                      ) : null}
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

              {activeModule && activeModule !== "ligas" && activeModule !== "caja" ? (
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
                    centralizar torneos, turnos y caja general cuando avancemos esos modulos.
                  </Text>
                </View>
              ) : null}

              {activeModule === "caja" ? (
                <View style={styles.card}>
                  <View style={styles.cardHeaderRow}>
                    <View>
                      <Text style={styles.cardEyebrow}>GESTION GENERAL</Text>
                      <Text style={styles.cardTitle}>Caja General</Text>
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

                  {!loadingLeagues && !leagueDebtors.length ? (
                    <View style={styles.emptyBox}>
                      <Text style={styles.emptyTitle}>Sin deudas registradas</Text>
                      <Text style={styles.emptyText}>
                        Cuando haya fechas impagas en tus ligas, van a aparecer agrupadas por jugador.
                      </Text>
                    </View>
                  ) : null}

                  {!loadingLeagues
                    ? leagueDebtors.map((debtor) => {
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
                              <View style={styles.debtorAvatar}>
                                <Text style={styles.debtorAvatarText}>
                                  {String(debtor.playerName || "J").charAt(0).toUpperCase()}
                                </Text>
                              </View>
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
                            <Text style={styles.debtorDetail}>
                              Total fechas impagas: {roundCount}
                            </Text>

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
                    Se calculan sobre partidos jugados. Si pasaron 4 hs o 24 hs desde que se cargo
                    el ganador y el jugador sigue impago, podes enviar el recordatorio manualmente.
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
                        Cuando una fecha finalizada tenga pagos pendientes vencidos, apareceran aca.
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

