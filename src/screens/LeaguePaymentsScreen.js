import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { getDownloadURL, ref, uploadBytes } from "../../services/firebaseStorage";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";

import BottomQuickActionsBar, {
  BOTTOM_QUICK_ACTIONS_SPACE,
} from "../components/BottomQuickActionsBar";
import FeedbackModal from "../components/FeedbackModal";
import LeagueHeaderCard from "../components/LeagueHeaderCard";
import SectionHeader from "../components/SectionHeader";
import { getMercadoPagoReturnUrls } from "../config/mercadoPago";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import {
  canManageLeague,
  getLeagueById,
  getLeaguePaymentRoundSummary,
  resolveLeaguePaymentRounds,
  updateLeagueRoundPayments,
} from "../services/leaguesService";
import { normalizeMercadoPagoConfig } from "../services/mercadoPagoConfigService";
import {
  createLeagueMercadoPagoPreference,
  persistPendingMercadoPagoCheckout,
} from "../services/mercadoPagoCheckoutService";
import { sendChatMessage } from "../services/chatService";
import { storage } from "../../services/firebaseConfig";

const STATUS_META = {
  pendiente: {
    label: "Impago",
    tint: "#F8FBF9",
    border: "#DDE8E2",
    accent: "#D26A2C",
  },
  in_review: {
    label: "Pago pendiente",
    tint: "#FFF9E6",
    border: "#E5D07F",
    accent: "#8C6A05",
  },
  informo_transferencia: {
    label: "Pago a Verificar",
    tint: "#FFF9E6",
    border: "#E5D07F",
    accent: "#8C6A05",
  },
  pagado: {
    label: "Pagado",
    tint: "#EEF9F1",
    border: "#B7DFBF",
    accent: "#237547",
  },
};

const PAYMENT_METHOD_OPTIONS = [
  { key: "efectivo", label: "Efectivo" },
  { key: "transferencia", label: "Transferencia" },
];

function isPdfProof(entryOrAsset = {}) {
  const fileName = String(entryOrAsset?.proofFileName || entryOrAsset?.fileName || entryOrAsset?.name || "").toLowerCase();
  const mimeType = String(entryOrAsset?.mimeType || entryOrAsset?.type || "").toLowerCase();

  return mimeType.includes("pdf") || fileName.endsWith(".pdf");
}

function isImageProof(asset = {}) {
  const fileName = String(asset?.fileName || asset?.name || "").toLowerCase();
  const mimeType = String(asset?.mimeType || asset?.type || "").toLowerCase();

  return mimeType.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(fileName);
}

function resolveCurrentPaymentsRoundId(rounds = []) {
  if (!Array.isArray(rounds) || !rounds.length) {
    return "";
  }

  const firstPendingRound = rounds.find((round) =>
    (round.entries || []).some((entry) => entry.paymentStatus !== "pagado")
  );

  return firstPendingRound?.roundId || rounds[rounds.length - 1]?.roundId || "";
}

function formatUpdatedAt(value) {
  if (!value) {
    return "Sin cambios";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Sin cambios";
  }

  return date.toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCurrency(value = 0) {
  const amount = Number(value || 0);

  return amount.toLocaleString("es-AR", {
    currency: "ARS",
    maximumFractionDigits: 0,
    style: "currency",
  });
}

function getNextMonthLabel() {
  const date = new Date();
  date.setMonth(date.getMonth() + 1, 1);

  return date.toLocaleDateString("es-AR", {
    month: "long",
    year: "numeric",
  });
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

function getPaymentRoundDateMeta(round = {}) {
  if (round.rescheduledDateMillis) {
    return {
      label: `Reprogramada ${formatDateLabel(round.rescheduledDateMillis)}`,
      reprogrammed: true,
    };
  }

  if (round.scheduledDateMillis) {
    return {
      label: formatDateLabel(round.scheduledDateMillis),
      reprogrammed: false,
    };
  }

  return { label: "", reprogrammed: false };
}

function getPositiveMoneyValue(value) {
  const amount = Number.parseFloat(String(value ?? "0").replace(",", "."));

  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function getPaymentAmountSummary(entries = [], amountPerEntry = 0) {
  return (Array.isArray(entries) ? entries : []).reduce(
    (summary, entry) => {
      const amount = amountPerEntry;

      if (entry.paymentStatus === "pagado" && entry.paymentMethod === "efectivo") {
        summary.cash += amount;
      } else if (
        (entry.paymentStatus === "pagado" &&
          (entry.paymentMethod === "transferencia" ||
            entry.paymentMethod === "cuenta_corriente" ||
            entry.paymentMethod === "mercado_pago")) ||
        entry.paymentStatus === "informo_transferencia" ||
        entry.paymentStatus === "in_review"
      ) {
        summary.transfer += amount;
      } else if (entry.paymentStatus !== "pagado" && Number(entry.completedAtMillis || 0) > 0) {
        summary.pending += amount;
      }

      return summary;
    },
    { cash: 0, transfer: 0, account: 0, pending: 0 }
  );
}

function getPaymentAmountSummaryItems(summary = {}) {
  const paidTotal = Number(summary.cash || 0) + Number(summary.transfer || 0);

  return [
    { key: "cash", label: "Efectivo", value: summary.cash || 0 },
    { key: "transfer", label: "Transferencia", value: summary.transfer || 0 },
    { key: "paid_total", label: "Pagados", value: paidTotal },
    { key: "pending", label: "Impagos", value: summary.pending || 0 },
  ];
}

function hasPaymentMovement(entry = {}) {
  return (
    entry.paymentStatus === "pagado" ||
    entry.paymentStatus === "in_review" ||
    entry.paymentStatus === "informo_transferencia" ||
    Boolean(
      entry.paymentMethod ||
        entry.proofUrl ||
        entry.updatedAtMillis ||
        entry.mercadoPagoPreferenceId ||
        entry.mercadoPagoPaymentId
    )
  );
}

function isRealPendingEntry(entry = {}) {
  return entry.paymentStatus === "pendiente" && Number(entry.completedAtMillis || 0) > 0;
}

function getLinkedRecipientsFromEntries(entries = []) {
  const recipientMap = new Map();

  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    (entry.players || []).forEach((player) => {
      const linkedUserId = String(player?.linkedUserId || "").trim();

      if (!linkedUserId || recipientMap.has(linkedUserId)) {
        return;
      }

      recipientMap.set(linkedUserId, {
        id: linkedUserId,
        name: player?.nombre || entry.participantLabel || "Jugador",
      });
    });
  });

  return [...recipientMap.values()];
}

function getStatusMeta(status) {
  return STATUS_META[status] || STATUS_META.pendiente;
}

function getPaymentMethodLabel(entry = {}) {
  if (entry.paymentStatus !== "pagado") {
    if (entry.paymentMethod === "mercado_pago") {
      return "MP";
    }

    return entry.paymentMethod === "transferencia" ? "Transf." : "";
  }

  if (entry.paymentMethod === "efectivo") {
    return "Efec.";
  }

  if (
    entry.paymentMethod === "transferencia" ||
    entry.paymentMethod === "cuenta_corriente"
  ) {
    return "Transf.";
  }

  if (entry.paymentMethod === "mercado_pago") {
    return "MP";
  }

  return "";
}

function normalizePhoneNumber(value = "") {
  return String(value || "").replace(/[^\d]/g, "");
}

function buildReminderMessage(leagueName, roundTitle, participantLabel) {
  return `Hola! Te recordamos el pago pendiente de ${participantLabel} en ${leagueName}, ${roundTitle}.`;
}

function getCurrentUserId(userData = {}) {
  return String(userData?.uid || userData?.id || "").trim().toLowerCase();
}

function isEntryForCurrentUser(entry = {}, currentUserId = "") {
  if (!currentUserId) {
    return false;
  }

  const playerIds = Array.isArray(entry?.playerIds) ? entry.playerIds : [];
  const playerUserIds = Array.isArray(entry?.players)
    ? entry.players.flatMap((player) => [player?.linkedUserId, player?.id])
    : [];

  return [...playerIds, ...playerUserIds]
    .filter(Boolean)
    .some((playerId) => String(playerId).trim().toLowerCase() === currentUserId);
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
      mercadoPagoPreferenceId: entry.mercadoPagoPreferenceId || "",
      mercadoPagoCheckoutUrl: entry.mercadoPagoCheckoutUrl || "",
      mercadoPagoPaymentId: entry.mercadoPagoPaymentId || "",
      mercadoPagoStatus: entry.mercadoPagoStatus || "",
      mercadoPagoStatusDetail: entry.mercadoPagoStatusDetail || "",
      paymentGateway: entry.paymentGateway || "",
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

function patchRoundPaymentEntry(roundPayments = [], roundId = "", participantId = "", patch = {}, actor = {}) {
  return roundPayments.map((round) =>
    round.roundId !== roundId
      ? round
      : {
          ...round,
          entries: (round.entries || []).map((entry) =>
            entry.participantId !== participantId
              ? entry
              : {
                  ...entry,
                  ...patch,
                  updatedAtMillis: Date.now(),
                  updatedBy: actor?.id || "",
                  updatedByName: actor?.name || "",
                }
          ),
        }
  );
}

function groupEntriesByPair(entries = []) {
  const groups = [];
  const groupMap = new Map();

  entries.forEach((entry) => {
    const groupKey = entry.pairId || entry.pairLabel || `sin-pareja-${entry.participantId}`;

    if (!groupMap.has(groupKey)) {
      const nextGroup = {
        key: groupKey,
        label: `PAREJA ${groups.length + 1}`,
        entries: [],
      };
      groupMap.set(groupKey, nextGroup);
      groups.push(nextGroup);
    }

    groupMap.get(groupKey).entries.push(entry);
  });

  return groups;
}

function buildPaymentTableRows(entries = [], teamType = "single") {
  if (teamType !== "pair") {
    return (entries || []).map((entry) => ({
      ...entry,
      pairLabel: "",
      pairMateLabel: "",
    }));
  }

  return groupEntriesByPair(entries || []).flatMap((group) =>
    group.entries.map((entry, index) => ({
      ...entry,
      pairLabel: group.label,
      pairMateLabel:
        group.entries.length > 1
          ? group.entries[index === 0 ? 1 : 0]?.participantLabel || ""
          : "",
    }))
  );
}

function formatCompactPlayerName(value = "") {
  const parts = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) {
    return "Jugador";
  }

  if (parts.length === 1) {
    return parts[0];
  }

  const lastName = parts[parts.length - 1];
  const firstNameInitial = parts[0].charAt(0).toUpperCase();

  return `${lastName} ${firstNameInitial}.`;
}

function appendCheckoutQueryParams(baseUrl = "", params = {}) {
  const normalizedBaseUrl = String(baseUrl || "").trim();

  if (!normalizedBaseUrl) {
    return "";
  }

  const search = Object.entries(params)
    .map(([key, value]) => [String(key || "").trim(), String(value || "").trim()])
    .filter(([, value]) => value)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");

  if (!search) {
    return normalizedBaseUrl;
  }

  return `${normalizedBaseUrl}${normalizedBaseUrl.includes("?") ? "&" : "?"}${search}`;
}

export default function LeaguePaymentsScreen({ navigation, route }) {
  const { userData } = useAuth();
  const leagueId = route?.params?.leagueId || "";
  const focusPlayerId = String(route?.params?.focusPlayerId || "").trim().toLowerCase();
  const focusPlayerName = String(route?.params?.focusPlayerName || "").trim().toLowerCase();
  const fallbackLeagueName = route?.params?.leagueName || "Liga";
  const [league, setLeague] = useState(null);
  const [roundPaymentsDraft, setRoundPaymentsDraft] = useState([]);
  const [expandedRoundIds, setExpandedRoundIds] = useState([]);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [selectedRound, setSelectedRound] = useState(null);
  const [reminderCenterVisible, setReminderCenterVisible] = useState(false);
  const [reminderChannel, setReminderChannel] = useState("");
  const [reminderAction, setReminderAction] = useState("");
  const [selectedReminderRoundIds, setSelectedReminderRoundIds] = useState([]);
  const [selectedBatchRoundIds, setSelectedBatchRoundIds] = useState([]);
  const [reminderNewValue, setReminderNewValue] = useState("");
  const [reminderValueStart, setReminderValueStart] = useState("now");
  const [entryMenuVisible, setEntryMenuVisible] = useState(false);
  const [methodPickerVisible, setMethodPickerVisible] = useState(false);
  const [proofReviewVisible, setProofReviewVisible] = useState(false);
  const [transferProofPickerVisible, setTransferProofPickerVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState({
    visible: false,
    title: "",
    message: "",
    tone: "default",
  });

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

          const nextRounds = resolveLeaguePaymentRounds(nextLeague);
          setLeague(nextLeague);
          setRoundPaymentsDraft(nextRounds);
          setExpandedRoundIds([]);
          setSelectedBatchRoundIds([]);
        } catch (error) {
          if (isMounted) {
            setFeedback({
              visible: true,
              title: "No pudimos cargar los pagos",
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
    }, [leagueId])
  );

  const canManage = league ? canManageLeague(league, userData) : false;
  const currentUserId = getCurrentUserId(userData);
  const actor = {
    id: userData?.uid || userData?.id || "",
    name: userData?.name || userData?.displayName || "Usuario",
  };
  const leagueName = league?.nombre || fallbackLeagueName;
  const hasFixture = Array.isArray(league?.fixture?.rounds) && league.fixture.rounds.length > 0;
  const leagueRoundPrice = getPositiveMoneyValue(league?.paymentConfig?.roundPricePerPlayer);
  const leagueMercadoPagoConfig = useMemo(
    () => normalizeMercadoPagoConfig(league?.paymentConfig?.mercadoPago),
    [league?.paymentConfig?.mercadoPago]
  );
  const defaultRoundPrice = getPositiveMoneyValue(userData?.leaguePaymentDefaults?.roundPricePerPlayer);
  const roundPricePerPlayer = leagueRoundPrice || defaultRoundPrice;
  const roundPriceLabel = roundPricePerPlayer > 0 ? `${formatCurrency(roundPricePerPlayer)} por jugador` : "";
  const hasPendingChanges = useMemo(() => {
    const original = JSON.stringify(resolveLeaguePaymentRounds(league || {}));
    const current = JSON.stringify(roundPaymentsDraft);
    return original !== current;
  }, [league, roundPaymentsDraft]);

  const globalSummary = useMemo(() => {
    const playedRoundIds = new Set(
      Array.isArray(league?.fixture?.rounds)
        ? league.fixture.rounds
            .filter((round) => Number(round?.completedAtMillis || 0) > 0)
            .map((round) => round.id)
        : []
    );

    const playedPaymentRounds = roundPaymentsDraft.filter(
      (round) =>
        playedRoundIds.has(round.roundId) ||
        (round.entries || []).some((entry) => entry.completedAtMillis || hasPaymentMovement(entry))
    );
    const totals = playedPaymentRounds.reduce(
      (summary, round) => {
        const roundAmountSummary = getPaymentAmountSummary(round.entries || [], roundPricePerPlayer);

        summary.cash += roundAmountSummary.cash;
        summary.transfer += roundAmountSummary.transfer;
        summary.account += roundAmountSummary.account;
        summary.pending += roundAmountSummary.pending;

        return summary;
      },
      { cash: 0, transfer: 0, account: 0, pending: 0 }
    );

    return {
      ...totals,
      totalPlayedRounds: playedPaymentRounds.length,
      totalRounds: roundPaymentsDraft.length,
    };
  }, [league, roundPaymentsDraft, roundPricePerPlayer]);

  const playerPaymentRounds = useMemo(
    () =>
      roundPaymentsDraft
        .map((round) => ({
          ...round,
          entries: (round.entries || []).filter((entry) => isEntryForCurrentUser(entry, currentUserId)),
        }))
        .filter((round) => round.entries.length > 0),
    [currentUserId, roundPaymentsDraft]
  );
  const playerMercadoPagoBatchTargets = useMemo(
    () =>
      playerPaymentRounds
        .map((round) => ({
          entry: (round.entries || [])[0] || null,
          round,
        }))
        .filter(
          ({ entry }) =>
            entry &&
            entry.paymentStatus !== "pagado" &&
            entry.paymentStatus !== "in_review" &&
            entry.paymentStatus !== "informo_transferencia"
        ),
    [playerPaymentRounds]
  );
  const selectedMercadoPagoBatchTargets = useMemo(
    () =>
      playerMercadoPagoBatchTargets.filter(({ round }) =>
        selectedBatchRoundIds.includes(round.roundId)
      ),
    [playerMercadoPagoBatchTargets, selectedBatchRoundIds]
  );
  const hasMercadoPagoBatchSelection = selectedMercadoPagoBatchTargets.length > 0;
  const selectedMercadoPagoBatchAmount = roundPricePerPlayer * selectedMercadoPagoBatchTargets.length;
  const playedPaymentRoundsForReminders = useMemo(
    () =>
      roundPaymentsDraft.filter((round) =>
        (round.entries || []).some((entry) => Number(entry.completedAtMillis || 0) > 0)
      ),
    [roundPaymentsDraft]
  );

  const updateEntry = (roundId, participantId, patch) => {
    setRoundPaymentsDraft((current) => patchRoundPaymentEntry(current, roundId, participantId, patch, actor));
  };

  const toggleBatchRoundSelection = (roundId) => {
    setSelectedBatchRoundIds((current) =>
      current.includes(roundId)
        ? current.filter((currentRoundId) => currentRoundId !== roundId)
        : [...current, roundId]
    );
  };

  const openEntryMenu = (round, entry) => {
    setSelectedRound(round);
    setSelectedEntry(entry);
    setEntryMenuVisible(true);
  };

  const closeEntryMenu = () => {
    setSelectedEntry(null);
    setSelectedRound(null);
    setEntryMenuVisible(false);
    setMethodPickerVisible(false);
    setProofReviewVisible(false);
    setTransferProofPickerVisible(false);
  };

  const openReminderCenter = () => {
    setReminderChannel("");
    setReminderAction("");
    setSelectedReminderRoundIds(playedPaymentRoundsForReminders.map((round) => round.roundId));
    setReminderNewValue("");
    setReminderValueStart("now");
    setReminderCenterVisible(true);
  };

  const closeReminderCenter = () => {
    setReminderCenterVisible(false);
    setReminderChannel("");
    setReminderAction("");
    setSelectedReminderRoundIds([]);
    setReminderNewValue("");
    setReminderValueStart("now");
  };

  const toggleReminderRoundSelection = (roundId) => {
    setSelectedReminderRoundIds((current) =>
      current.includes(roundId)
        ? current.filter((currentRoundId) => currentRoundId !== roundId)
        : [...current, roundId]
    );
  };

  const showWhatsAppFutureFeedback = () => {
    closeReminderCenter();
    setFeedback({
      visible: true,
      title: "WhatsApp pendiente",
      message: "Esta opcion queda preparada, pero el envio por WhatsApp lo vamos a desarrollar mas adelante.",
      tone: "warning",
    });
  };

  const sendInternalMessages = async ({ entries = [], text = "", emptyMessage = "" }) => {
    if (!actor.id) {
      closeReminderCenter();
      setFeedback({
        visible: true,
        title: "No hay usuario emisor",
        message: "No pudimos identificar tu usuario para enviar mensajes internos.",
        tone: "danger",
      });
      return;
    }

    const recipients = getLinkedRecipientsFromEntries(entries);

    if (!recipients.length) {
      closeReminderCenter();
      setFeedback({
        visible: true,
        title: "Sin usuarios vinculados",
        message: emptyMessage || "No encontramos jugadores con usuario vinculado para enviar el mensaje interno.",
        tone: "warning",
      });
      return;
    }

    try {
      setSaving(true);
      const results = await Promise.allSettled(
        recipients.map((recipient) =>
          sendChatMessage({
            currentUserId: actor.id,
            currentUserName: actor.name,
            otherUserId: recipient.id,
            otherUserName: recipient.name,
            text,
          })
        )
      );
      const sentCount = results.filter((result) => result.status === "fulfilled").length;

      closeReminderCenter();
      setFeedback({
        visible: true,
        title: "Mensajes enviados",
        message: `Se enviaron ${sentCount} mensaje(s) internos.`,
        tone: "success",
      });
    } catch (error) {
      closeReminderCenter();
      setFeedback({
        visible: true,
        title: "No pudimos enviar",
        message: error?.message || "Intenta nuevamente en unos instantes.",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleInternalPendingReminder = () => {
    const selectedRounds = playedPaymentRoundsForReminders.filter((round) =>
      selectedReminderRoundIds.includes(round.roundId)
    );
    const pendingEntries = selectedRounds.flatMap((round) =>
      (round.entries || []).filter(isRealPendingEntry)
    );

    sendInternalMessages({
      entries: pendingEntries,
      text: `Hola! Te recordamos que tenes pagos pendientes en la liga ${leagueName}.`,
      emptyMessage: "No hay impagos reales con usuario vinculado en las fechas seleccionadas.",
    });
  };

  const handleInternalValueChangeNotice = () => {
    const newValue = getPositiveMoneyValue(reminderNewValue);

    if (newValue <= 0) {
      setFeedback({
        visible: true,
        title: "Falta el nuevo valor",
        message: "Ingresa el nuevo precio por fecha antes de enviar la notificacion.",
        tone: "warning",
      });
      return;
    }

    const startLabel =
      reminderValueStart === "next_month"
        ? `a partir de ${getNextMonthLabel()}`
        : "desde ahora";

    sendInternalMessages({
      entries: roundPaymentsDraft.flatMap((round) => round.entries || []),
      text: `Hola! Te avisamos que el nuevo valor por fecha de la liga ${leagueName} sera de ${formatCurrency(newValue)} por jugador y comenzara a regir ${startLabel}.`,
      emptyMessage: "No encontramos jugadores con usuario vinculado en esta liga.",
    });
  };

  const openPaymentMethodPicker = (round, entry) => {
    setSelectedRound(round);
    setSelectedEntry(entry);
    setEntryMenuVisible(false);
    setMethodPickerVisible(true);
  };

  const openProofReview = (round, entry) => {
    if (!entry?.proofUrl) {
      setFeedback({
        visible: true,
        title: "Sin comprobante",
        message: "Este pago todavia no tiene comprobante adjunto.",
        tone: "danger",
      });
      return;
    }

    setSelectedRound(round);
    setSelectedEntry(entry);
    setEntryMenuVisible(false);
    setProofReviewVisible(true);
  };

  const markPending = () => {
    if (!selectedRound || !selectedEntry) return;
    updateEntry(selectedRound.roundId, selectedEntry.participantId, {
      paymentStatus: "pendiente",
      paymentMethod: "",
      confirmedAtMillis: 0,
      confirmedBy: "",
      confirmedByName: "",
      rejectedAtMillis: Date.now(),
      rejectedBy: actor.id,
      rejectedByName: actor.name,
    });
    closeEntryMenu();
  };

  const markPaidWithMethod = (paymentMethod) => {
    if (!selectedRound || !selectedEntry) return;
    updateEntry(selectedRound.roundId, selectedEntry.participantId, {
      paymentStatus: "pagado",
      paymentMethod,
      confirmedAtMillis: Date.now(),
      confirmedBy: actor.id,
      confirmedByName: actor.name,
      rejectedAtMillis: 0,
      rejectedBy: "",
      rejectedByName: "",
    });
    closeEntryMenu();
  };

  const openTransferProofPicker = () => {
    setMethodPickerVisible(false);
    setTransferProofPickerVisible(true);
  };

  const confirmTransferPayment = () => {
    if (!selectedRound || !selectedEntry) return;
    updateEntry(selectedRound.roundId, selectedEntry.participantId, {
      paymentStatus: "pagado",
      paymentMethod: "transferencia",
      confirmedAtMillis: Date.now(),
      confirmedBy: actor.id,
      confirmedByName: actor.name,
      rejectedAtMillis: 0,
      rejectedBy: "",
      rejectedByName: "",
    });
    closeEntryMenu();
  };

  const handleOpenProof = async (proofUrl) => {
    if (!proofUrl) {
      setFeedback({
        visible: true,
        title: "Sin comprobante",
        message: "Este pago todavia no tiene comprobante adjunto.",
        tone: "danger",
      });
      return;
    }

    try {
      await Linking.openURL(proofUrl);
    } catch (error) {
      setFeedback({
        visible: true,
        title: "No pudimos abrir el comprobante",
        message: "Revisa la conexion o intenta nuevamente.",
        tone: "danger",
      });
    }
  };

  const handleUploadProof = async (round, entry, proofType = "any", options = {}) => {
    if (!round || !entry) {
      return;
    }

    const markAsPaid = options?.markAsPaid === true;

    try {
      const pickerType =
        proofType === "pdf"
          ? "application/pdf"
          : proofType === "image"
          ? "image/*"
          : ["image/*", "application/pdf"];
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: pickerType,
      });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      const asset = result.assets[0];
      const isSupported =
        proofType === "pdf"
          ? isPdfProof(asset)
          : proofType === "image"
          ? isImageProof(asset)
          : isPdfProof(asset) || isImageProof(asset);

      if (!isSupported) {
        setFeedback({
          visible: true,
          title: "Archivo no compatible",
          message:
            proofType === "pdf"
              ? "Adjunta un comprobante en PDF."
              : proofType === "image"
              ? "Adjunta un comprobante en imagen."
              : "Adjunta un comprobante en imagen o PDF.",
          tone: "danger",
        });
        return;
      }

      setSaving(true);
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const originalName = asset.name || asset.fileName || "";
      const detectedPdf = isPdfProof(asset);
      const extension = originalName.split(".").pop() || (detectedPdf ? "pdf" : "jpg");
      const fileName = `${entry.participantId}-${Date.now()}.${extension}`;
      const proofRef = ref(storage, `league-payment-proofs/${leagueId}/${round.roundId}/${fileName}`);
      const proofContentType =
        blob.type ||
        asset.mimeType ||
        (extension.toLowerCase() === "pdf" ? "application/pdf" : "image/jpeg");

      await uploadBytes(proofRef, blob, {
        contentType: proofContentType,
      });

      const proofUrl = await getDownloadURL(proofRef);
      const nextPayments = patchRoundPaymentEntry(
        roundPaymentsDraft,
        round.roundId,
        entry.participantId,
        {
          paymentStatus: markAsPaid ? "pagado" : "informo_transferencia",
          paymentMethod: "transferencia",
          proofUrl,
          proofFileName: fileName,
          proofUploadedAtMillis: Date.now(),
          proofUploadedBy: actor.id,
          proofUploadedByName: actor.name,
          confirmedAtMillis: markAsPaid ? Date.now() : 0,
          confirmedBy: markAsPaid ? actor.id : "",
          confirmedByName: markAsPaid ? actor.name : "",
          rejectedAtMillis: 0,
          rejectedBy: "",
          rejectedByName: "",
        },
        actor
      );

      await updateLeagueRoundPayments(leagueId, serializeRoundPayments(nextPayments));
      setRoundPaymentsDraft(nextPayments);
      setLeague((current) =>
        current
          ? {
              ...current,
              roundPayments: nextPayments,
            }
          : current
      );
      setFeedback({
        visible: true,
        title: markAsPaid ? "Pago actualizado" : "Comprobante enviado",
        message: markAsPaid
          ? "El pago quedo marcado como transferencia y el comprobante se guardo correctamente."
          : "El organizador ya puede revisarlo y confirmar el pago.",
        tone: "success",
      });

      if (markAsPaid) {
        closeEntryMenu();
      }
    } catch (error) {
      setFeedback({
        visible: true,
        title: "No pudimos subir el comprobante",
        message: error?.message || "Intenta nuevamente en unos instantes.",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleStartLeagueMercadoPago = async (round, entry) => {
    if (!round || !entry) {
      return;
    }

    if (!leagueMercadoPagoConfig.enabled) {
      setFeedback({
        visible: true,
        title: "Mercado Pago no disponible",
        message: "Esta liga todavia no tiene habilitado el cobro con Mercado Pago.",
        tone: "warning",
      });
      return;
    }

    if (roundPricePerPlayer <= 0) {
      setFeedback({
        visible: true,
        title: "Falta el importe",
        message: "La liga no tiene configurado un valor por fecha para cobrar con Mercado Pago.",
        tone: "warning",
      });
      return;
    }

    try {
      setSaving(true);
      const returnUrls = getMercadoPagoReturnUrls();
      const returnParams = {
        leagueId,
        pairId: entry.pairId || "",
        participantId: entry.participantId,
        roundId: round.roundId,
        source: "leagues",
      };
      const checkout = await createLeagueMercadoPagoPreference({
        amount: roundPricePerPlayer,
        leagueId,
        leagueName,
        organizerId: String(league?.organizerId || "").trim(),
        organizerName: String(league?.sede || league?.organizerName || "").trim(),
        pairId: entry.pairId || "",
        participantId: entry.participantId,
        participantLabel: entry.participantLabel,
        payerEmail: String(userData?.email || "").trim(),
        payerName: entry.participantLabel || userData?.name || "Jugador",
        roundId: round.roundId,
        roundTitle: round.title,
        successUrl: appendCheckoutQueryParams(returnUrls.successUrl, returnParams),
        failureUrl: appendCheckoutQueryParams(returnUrls.failureUrl, returnParams),
        pendingUrl: appendCheckoutQueryParams(returnUrls.pendingUrl, returnParams),
      });

      if (!checkout.checkoutUrl) {
        throw new Error("No pudimos obtener el link de pago de Mercado Pago.");
      }

      const nextPayments = patchRoundPaymentEntry(
        roundPaymentsDraft,
        round.roundId,
        entry.participantId,
        {
          mercadoPagoPreferenceId: checkout.preferenceId || "",
          mercadoPagoCheckoutUrl: checkout.checkoutUrl || "",
          mercadoPagoPaymentId: "",
          mercadoPagoStatus: "pending",
          mercadoPagoStatusDetail: "",
          paymentGateway: "mercado_pago",
          paymentMethod: "",
          paymentStatus: "pendiente",
        },
        actor
      );

      await updateLeagueRoundPayments(leagueId, serializeRoundPayments(nextPayments));
      setRoundPaymentsDraft(nextPayments);
      setLeague((current) =>
        current
          ? {
              ...current,
              roundPayments: nextPayments,
            }
          : current
      );

      await persistPendingMercadoPagoCheckout({
        externalReference: checkout.externalReference || "",
        leagueId,
        pairId: entry.pairId || "",
        participantId: entry.participantId,
        preferenceId: checkout.preferenceId,
        roundId: round.roundId,
        source: "leagues",
        status: "pending",
      });

      await Linking.openURL(checkout.checkoutUrl);
    } catch (error) {
      setFeedback({
        visible: true,
        title: "No pudimos iniciar el pago",
        message: error?.message || "Intenta nuevamente en unos instantes.",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleStartLeagueMercadoPagoBatch = async () => {
    if (!selectedMercadoPagoBatchTargets.length) {
      setFeedback({
        visible: true,
        title: "Selecciona fechas",
        message: "Elige al menos una fecha impaga para pagarla con Mercado Pago.",
        tone: "warning",
      });
      return;
    }

    if (!leagueMercadoPagoConfig.enabled) {
      setFeedback({
        visible: true,
        title: "Mercado Pago no disponible",
        message: "Esta liga todavia no tiene habilitado el cobro con Mercado Pago.",
        tone: "warning",
      });
      return;
    }

    if (roundPricePerPlayer <= 0) {
      setFeedback({
        visible: true,
        title: "Falta el importe",
        message: "La liga no tiene configurado un valor por fecha para cobrar con Mercado Pago.",
        tone: "warning",
      });
      return;
    }

    try {
      setSaving(true);
      const returnUrls = getMercadoPagoReturnUrls();
      const targets = selectedMercadoPagoBatchTargets.map(({ round, entry }) => ({
        pairId: entry?.pairId || "",
        participantId: entry?.participantId || "",
        participantLabel: entry?.participantLabel || "",
        roundId: round?.roundId || "",
        roundTitle: round?.title || "",
      }));
      const primaryTarget = targets[0] || {};
      const totalAmount = roundPricePerPlayer * targets.length;
      const checkout = await createLeagueMercadoPagoPreference({
        amount: totalAmount,
        leagueId,
        leagueName,
        organizerId: String(league?.organizerId || "").trim(),
        organizerName: String(league?.sede || league?.organizerName || "").trim(),
        pairId: primaryTarget.pairId || "",
        participantId: primaryTarget.participantId || "",
        participantLabel: primaryTarget.participantLabel || "",
        payerEmail: String(userData?.email || "").trim(),
        payerName: primaryTarget.participantLabel || userData?.name || "Jugador",
        roundId: primaryTarget.roundId || "",
        roundTitle: `${targets.length} fechas`,
        targets,
        successUrl: appendCheckoutQueryParams(returnUrls.successUrl, {
          batch_count: String(targets.length),
          leagueId,
          participantId: primaryTarget.participantId || "",
          source: "leagues",
        }),
        failureUrl: appendCheckoutQueryParams(returnUrls.failureUrl, {
          batch_count: String(targets.length),
          leagueId,
          participantId: primaryTarget.participantId || "",
          source: "leagues",
        }),
        pendingUrl: appendCheckoutQueryParams(returnUrls.pendingUrl, {
          batch_count: String(targets.length),
          leagueId,
          participantId: primaryTarget.participantId || "",
          source: "leagues",
        }),
      });

      if (!checkout.checkoutUrl) {
        throw new Error("No pudimos obtener el link de pago de Mercado Pago.");
      }

      let nextPayments = roundPaymentsDraft;
      selectedMercadoPagoBatchTargets.forEach(({ round, entry }) => {
        nextPayments = patchRoundPaymentEntry(
          nextPayments,
          round.roundId,
          entry.participantId,
          {
            mercadoPagoPreferenceId: checkout.preferenceId || "",
            mercadoPagoCheckoutUrl: checkout.checkoutUrl || "",
            mercadoPagoPaymentId: "",
            mercadoPagoStatus: "pending",
            mercadoPagoStatusDetail: "",
            paymentGateway: "mercado_pago",
            paymentMethod: "",
            paymentStatus: "pendiente",
          },
          actor
        );
      });

      await updateLeagueRoundPayments(leagueId, serializeRoundPayments(nextPayments));
      setRoundPaymentsDraft(nextPayments);
      setLeague((current) =>
        current
          ? {
              ...current,
              roundPayments: nextPayments,
            }
          : current
      );

      await persistPendingMercadoPagoCheckout({
        batchCount: targets.length,
        batchTargets: targets,
        externalReference: checkout.externalReference || "",
        leagueId,
        pairId: primaryTarget.pairId || "",
        participantId: primaryTarget.participantId || "",
        preferenceId: checkout.preferenceId,
        roundId: primaryTarget.roundId || "",
        source: "leagues",
        status: "pending",
      });

      setSelectedBatchRoundIds([]);
      await Linking.openURL(checkout.checkoutUrl);
    } catch (error) {
      setFeedback({
        visible: true,
        title: "No pudimos iniciar el pago",
        message: error?.message || "Intenta nuevamente en unos instantes.",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleUploadProofBatch = async (proofType = "any") => {
    if (!selectedMercadoPagoBatchTargets.length) {
      setFeedback({
        visible: true,
        title: "Selecciona fechas",
        message: "Elige al menos una fecha para adjuntar el comprobante.",
        tone: "warning",
      });
      return;
    }

    try {
      const pickerType =
        proofType === "pdf"
          ? "application/pdf"
          : proofType === "image"
          ? "image/*"
          : ["image/*", "application/pdf"];
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: pickerType,
      });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      const asset = result.assets[0];
      const isSupported =
        proofType === "pdf"
          ? isPdfProof(asset)
          : proofType === "image"
          ? isImageProof(asset)
          : isPdfProof(asset) || isImageProof(asset);

      if (!isSupported) {
        setFeedback({
          visible: true,
          title: "Archivo no compatible",
          message:
            proofType === "pdf"
              ? "Adjunta un comprobante en PDF."
              : proofType === "image"
              ? "Adjunta un comprobante en imagen."
              : "Adjunta un comprobante en imagen o PDF.",
          tone: "danger",
        });
        return;
      }

      setSaving(true);
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const originalName = asset.name || asset.fileName || "";
      const detectedPdf = isPdfProof(asset);
      const extension = originalName.split(".").pop() || (detectedPdf ? "pdf" : "jpg");
      const fileName = `batch-${Date.now()}.${extension}`;
      const proofRef = ref(storage, `league-payment-proofs/${leagueId}/batch/${fileName}`);
      const proofContentType =
        blob.type ||
        asset.mimeType ||
        (extension.toLowerCase() === "pdf" ? "application/pdf" : "image/jpeg");

      await uploadBytes(proofRef, blob, {
        contentType: proofContentType,
      });

      const proofUrl = await getDownloadURL(proofRef);
      let nextPayments = roundPaymentsDraft;

      selectedMercadoPagoBatchTargets.forEach(({ round, entry }) => {
        nextPayments = patchRoundPaymentEntry(
          nextPayments,
          round.roundId,
          entry.participantId,
          {
            paymentStatus: "informo_transferencia",
            paymentMethod: "transferencia",
            proofUrl,
            proofFileName: fileName,
            proofUploadedAtMillis: Date.now(),
            proofUploadedBy: actor.id,
            proofUploadedByName: actor.name,
            confirmedAtMillis: 0,
            confirmedBy: "",
            confirmedByName: "",
            rejectedAtMillis: 0,
            rejectedBy: "",
            rejectedByName: "",
          },
          actor
        );
      });

      await updateLeagueRoundPayments(leagueId, serializeRoundPayments(nextPayments));
      setRoundPaymentsDraft(nextPayments);
      setLeague((current) =>
        current
          ? {
              ...current,
              roundPayments: nextPayments,
            }
          : current
      );
      setSelectedBatchRoundIds([]);
      setFeedback({
        visible: true,
        title: "Comprobante enviado",
        message: "El comprobante se adjunto en las fechas seleccionadas.",
        tone: "success",
      });
    } catch (error) {
      setFeedback({
        visible: true,
        title: "No pudimos subir el comprobante",
        message: error?.message || "Intenta nuevamente en unos instantes.",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleOrganizerTransferSelection = async (shouldUploadProof = false) => {
    if (!selectedRound || !selectedEntry) {
      return;
    }

    if (!shouldUploadProof) {
      markPaidWithMethod("transferencia");
      return;
    }

    setTransferProofPickerVisible(false);
    await handleUploadProof(selectedRound, selectedEntry, "any", { markAsPaid: true });
  };

  const handleOpenWhatsAppReminder = async () => {
    if (!selectedEntry || !selectedRound) return;

    const contact = (selectedEntry.players || []).find((player) => normalizePhoneNumber(player?.telefono));
    const phone = normalizePhoneNumber(contact?.telefono);

    if (!phone) {
      setFeedback({
        visible: true,
        title: "Falta un telefono",
        message: "No encontramos un numero de WhatsApp para este participante.",
        tone: "danger",
      });
      closeEntryMenu();
      return;
    }

    const message = encodeURIComponent(
      buildReminderMessage(leagueName, selectedRound.title, selectedEntry.participantLabel)
    );

    try {
      await Linking.openURL(`https://wa.me/${phone}?text=${message}`);
    } catch (error) {
      setFeedback({
        visible: true,
        title: "No pudimos abrir WhatsApp",
        message: "Revisa si WhatsApp esta disponible en este dispositivo.",
        tone: "danger",
      });
    } finally {
      closeEntryMenu();
    }
  };

  const handleOpenInternalReminder = () => {
    if (!selectedEntry || !selectedRound) return;

    const contact = (selectedEntry.players || []).find((player) => player?.linkedUserId);

    if (!contact?.linkedUserId) {
      setFeedback({
        visible: true,
        title: "No hay chat disponible",
        message: "Este participante no tiene usuario vinculado para mensajeria interna.",
        tone: "danger",
      });
      closeEntryMenu();
      return;
    }

    navigation.navigate("Mensajes", {
      playerId: contact.linkedUserId,
      playerName: contact.nombre || selectedEntry.participantLabel,
    });
    closeEntryMenu();
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await updateLeagueRoundPayments(leagueId, serializeRoundPayments(roundPaymentsDraft));

      setLeague((current) =>
        current
          ? {
              ...current,
              roundPayments: roundPaymentsDraft,
            }
          : current
      );
      setFeedback({
        visible: true,
        title: "Pagos guardados",
        message: "Los estados por fecha quedaron actualizados.",
        tone: "success",
      });
    } catch (error) {
      setFeedback({
        visible: true,
        title: "No pudimos guardar los pagos",
        message: error?.message || "Intenta nuevamente en unos instantes.",
        tone: "danger",
      });
    } finally {
      setSaving(false);
    }
  };

  const renderPaymentEntryRow = (round, entry) => {
    const statusMeta = getStatusMeta(entry.paymentStatus);
    const methodLabel = getPaymentMethodLabel(entry);
    const hasProof = Boolean(entry.proofUrl);
    const updatedLabel = formatUpdatedAt(entry.updatedAtMillis);
    const isFocused =
      (!!focusPlayerId &&
        [entry.participantId, ...(entry.playerIds || []), ...(entry.players || []).flatMap((player) => [player?.linkedUserId, player?.id])]
          .filter(Boolean)
          .some((value) => String(value).trim().toLowerCase() === focusPlayerId)) ||
      (!!focusPlayerName &&
        String(entry.participantLabel || "").trim().toLowerCase() === focusPlayerName);

    return (
      <View
        key={`${round.roundId}-${entry.participantId}`}
        style={[styles.entryRow, isFocused ? styles.focusedPaymentRow : null]}
      >
        <View style={[styles.entryAccentBar, { backgroundColor: statusMeta.accent }]} />

        <View style={styles.entryCopy}>
          <View style={[styles.entryTopRow, !canManage ? styles.playerEntryTopRow : null]}>
            <Text
              numberOfLines={1}
              style={[styles.entryName, !canManage ? styles.playerEntryName : null]}
            >
              {entry.participantLabel}
            </Text>
            {roundPricePerPlayer > 0 ? (
              <Text style={styles.entryAmountLabel}>{formatCurrency(roundPricePerPlayer)}</Text>
            ) : null}
          </View>
          <View style={[styles.entryMetaRow, !canManage ? styles.playerEntryMetaRow : null]}>
            <View
              style={[
                styles.entryStatusChip,
                {
                  backgroundColor: statusMeta.tint,
                  borderColor: statusMeta.border,
                },
              ]}
            >
              <Text style={[styles.entryStatusLabel, { color: statusMeta.accent }]}>
                {statusMeta.label}
              </Text>
            </View>
            {methodLabel ? <Text style={styles.entryMetaChip}>{methodLabel}</Text> : null}
            {hasProof ? (
              <Text style={styles.entryProofChip}>
                Comprobante adjuntado · {formatUpdatedAt(entry.proofUploadedAtMillis)}
              </Text>
            ) : null}
          </View>
          <View style={[styles.entryFooterRow, !canManage ? styles.playerEntryFooterRow : null]}>
            <Text style={styles.entryUpdated}>
              {canManage ? updatedLabel ? `Actualizado ${updatedLabel}` : "Sin cambios" : "Si pagas en Efectivo, pagas en la sede"}
            </Text>
          </View>
        </View>

        {canManage ? (
          <View style={styles.organizerEntryActions}>
            {entry.proofUrl && entry.paymentStatus !== "pagado" ? (
              <Pressable
                onPress={() => openProofReview(round, entry)}
                style={({ pressed }) => [
                  styles.quickProofButton,
                  pressed ? styles.pressedState : null,
                ]}
              >
                <Ionicons color={colors.primaryDark} name="receipt-outline" size={14} />
                <Text style={styles.quickProofButtonText}>Ver</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => openPaymentMethodPicker(round, entry)}
              style={({ pressed }) => [
                styles.quickPaidButton,
                entry.paymentStatus === "pagado"
                  ? styles.quickPaidButtonPaid
                  : entry.paymentStatus === "pendiente"
                  ? styles.quickPaidButtonPending
                  : styles.quickPaidButtonTransfer,
                pressed ? styles.pressedState : null,
              ]}
            >
              <Ionicons color={colors.surface} name="cash-outline" size={14} />
            </Pressable>
            <Pressable
              onPress={() => openEntryMenu(round, entry)}
              style={({ pressed }) => [
                styles.moreButton,
                pressed ? styles.pressedState : null,
              ]}
            >
              <Ionicons color={colors.text} name="ellipsis-vertical" size={16} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.playerEntryActions}>
            {entry.proofUrl ? (
              <Pressable
                onPress={() => handleOpenProof(entry.proofUrl)}
                style={({ pressed }) => [
                  styles.playerSecondaryButton,
                  pressed ? styles.pressedState : null,
                ]}
              >
                <Text style={styles.playerSecondaryButtonText}>Ver</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>
    );
  };

  const renderPaymentTableRow = (round, entry) => {
    const statusMeta = getStatusMeta(entry.paymentStatus);
    const methodLabel = getPaymentMethodLabel(entry);
    const statusLabel =
      entry.paymentStatus === "informo_transferencia" ? "Pago a\nVerificar" : statusMeta.label;
    const isFocused =
      (!!focusPlayerId &&
        [entry.participantId, ...(entry.playerIds || []), ...(entry.players || []).flatMap((player) => [player?.linkedUserId, player?.id])]
          .filter(Boolean)
          .some((value) => String(value).trim().toLowerCase() === focusPlayerId)) ||
      (!!focusPlayerName &&
        String(entry.participantLabel || "").trim().toLowerCase() === focusPlayerName);

    return (
      <View
        key={`${round.roundId}-${entry.participantId}`}
        style={[styles.paymentTableRow, isFocused ? styles.focusedPaymentTableRow : null]}
      >
        <View style={styles.paymentTablePlayerCell}>
          {entry.pairLabel ? (
            <Text numberOfLines={1} style={styles.paymentTablePairLabel}>
              {entry.pairLabel}
            </Text>
          ) : null}
          <Text numberOfLines={1} style={styles.paymentTablePlayerName}>
            {formatCompactPlayerName(entry.participantLabel)}
          </Text>
        </View>

        <View style={styles.paymentTableStatusCell}>
          <Text numberOfLines={2} style={[styles.paymentTableStatusText, { color: statusMeta.accent }]}>
            {statusLabel}
          </Text>
        </View>

        <View style={styles.paymentTableMethodCell}>
          <Text numberOfLines={2} style={styles.paymentTableMethodText}>
            {methodLabel || "-"}
          </Text>
        </View>

        <View style={styles.paymentTableProofCell}>
          {entry.proofUrl ? (
            <Pressable
              onPress={() =>
                canManage ? openProofReview(round, entry) : handleOpenProof(entry.proofUrl)
              }
              style={({ pressed }) => [
                styles.paymentTableProofButton,
                pressed ? styles.pressedState : null,
              ]}
            >
              <Ionicons color={colors.primaryDark} name="document-text-outline" size={14} />
            </Pressable>
          ) : (
            <Text style={styles.paymentTableMutedText}>-</Text>
          )}
        </View>

        <View style={styles.paymentTableAmountCell}>
          <Text numberOfLines={1} style={styles.paymentTableAmountText}>
            {roundPricePerPlayer > 0 ? formatCurrency(roundPricePerPlayer) : "-"}
          </Text>
        </View>

        <View style={styles.paymentTableActionsCell}>
          {canManage ? (
            <View style={styles.paymentTableActionsRow}>
              <Pressable
                onPress={() => openPaymentMethodPicker(round, entry)}
                style={({ pressed }) => [
                  styles.paymentTableActionButton,
                  entry.paymentStatus === "pagado"
                    ? styles.quickPaidButtonPaid
                    : entry.paymentStatus === "pendiente"
                    ? styles.quickPaidButtonPending
                    : styles.quickPaidButtonTransfer,
                  pressed ? styles.pressedState : null,
                ]}
              >
                <Ionicons color={colors.surface} name="cash-outline" size={14} />
              </Pressable>
              <Pressable
                onPress={() => openEntryMenu(round, entry)}
                style={({ pressed }) => [
                  styles.paymentTableMenuButton,
                  pressed ? styles.pressedState : null,
                ]}
              >
                <Ionicons color={colors.text} name="ellipsis-vertical" size={16} />
              </Pressable>
            </View>
          ) : (
            <View style={styles.paymentTableActionsRow}>
              {entry.paymentStatus !== "pagado" ? (
                <Pressable
                  disabled={saving}
                  onPress={() => handleUploadProof(round, entry)}
                  style={({ pressed }) => [
                    styles.paymentTableMiniButton,
                    styles.paymentTableProofUploadButton,
                    saving ? styles.saveButtonDisabled : null,
                    pressed && !saving ? styles.pressedState : null,
                  ]}
                >
                  <Text style={styles.paymentTableMiniButtonText}>Comp.</Text>
                </Pressable>
              ) : (
                <Text style={styles.paymentTableMutedText}>-</Text>
              )}
            </View>
          )}
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <SectionHeader onBack={() => navigation.goBack()} subtitle="Pagos" />
        <View style={styles.loaderWrap}>
          <ActivityIndicator color={colors.primaryDark} />
          <Text style={styles.loaderText}>Cargando pagos...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const paymentsToRender = canManage ? roundPaymentsDraft : playerPaymentRounds;

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader onBack={() => navigation.goBack()} subtitle="Pagos" />
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <LeagueHeaderCard
          category={league?.categoria}
          complexName={league?.complejoNombre}
          league={league}
          organizerLogoUrl={league?.organizerLogoUrl || userData?.organizerLogoUrl || ""}
          sex={league?.sexo}
          title={leagueName}
          teamType={league?.teamType}
        />

        {!hasFixture ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Todavia no hay fechas cargadas</Text>
            <Text style={styles.emptyText}>
              Genera el fixture de la liga y despues podras controlar pagos por fecha.
            </Text>
          </View>
        ) : null}

        {hasFixture && !canManage && !paymentsToRender.length ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No encontramos pagos asociados a tu usuario</Text>
            <Text style={styles.emptyText}>
              Si estas jugando esta liga, pedile al organizador que vincule tu jugador con tu usuario.
            </Text>
          </View>
        ) : null}

        {hasFixture && canManage && hasPendingChanges ? (
          <View style={styles.unsavedChangesBanner}>
            <Ionicons color="#3F4EA8" name="sync-outline" size={17} />
            <Text style={styles.unsavedChangesText}>
              Hay cambios sin guardar en los pagos. Toca GUARDAR PAGOS para confirmarlos.
            </Text>
          </View>
        ) : null}

        {!canManage && playerMercadoPagoBatchTargets.length ? (
          <View style={styles.batchSelectionHint}>
            <Ionicons color={colors.primaryDark} name="information-circle-outline" size={15} />
            <Text style={styles.batchSelectionHintText}>Selecciona 1 o varias y paga.</Text>
          </View>
        ) : null}

        {paymentsToRender.map((round) => {
          const isExpanded = expandedRoundIds.includes(round.roundId);
          const roundSummary = getLeaguePaymentRoundSummary(round);
          const roundAmountSummary = getPaymentAmountSummary(round.entries || [], roundPricePerPlayer);
          const roundDateMeta = getPaymentRoundDateMeta(round);
          const playerPrimaryEntry = !canManage ? (round.entries || [])[0] || null : null;
          const playerStatusMeta = !canManage && playerPrimaryEntry ? getStatusMeta(playerPrimaryEntry.paymentStatus) : null;
          const roundSelectable =
            !canManage &&
            playerPrimaryEntry &&
            playerPrimaryEntry.paymentStatus !== "pagado" &&
            playerPrimaryEntry.paymentStatus !== "in_review" &&
            playerPrimaryEntry.paymentStatus !== "informo_transferencia";
          const roundSelected = selectedBatchRoundIds.includes(round.roundId);

          return (
            <View key={round.roundId} style={styles.roundCard}>
              <Pressable
                onPress={() =>
                  setExpandedRoundIds((current) =>
                    current.includes(round.roundId)
                      ? current.filter((roundId) => roundId !== round.roundId)
                      : [...current, round.roundId]
                  )
                }
                style={({ pressed }) => [
                  styles.roundToggleButton,
                  pressed ? styles.pressedState : null,
                ]}
              >
                <View style={styles.roundHeaderActions}>
                  {roundSelectable ? (
                    <Pressable
                      onPress={() => toggleBatchRoundSelection(round.roundId)}
                      style={({ pressed }) => [
                        styles.roundSelectButton,
                        roundSelected ? styles.roundSelectButtonActive : null,
                        pressed ? styles.pressedState : null,
                      ]}
                    >
                      <Ionicons
                        color={roundSelected ? "#1A7F5A" : colors.muted}
                        name={roundSelected ? "checkmark-circle" : "ellipse-outline"}
                        size={18}
                      />
                    </Pressable>
                  ) : (
                    <View style={styles.roundSelectButtonPlaceholder} />
                  )}
                </View>
                <View style={styles.roundHeader}>
                  <View style={styles.roundTitleValueRow}>
                    <Text
                      style={[
                        styles.roundTitle,
                        roundDateMeta.reprogrammed ? styles.roundDatePillReprogrammed : null,
                      ]}
                    >
                      {String(round.title || "").toUpperCase()}
                      {roundDateMeta.label ? ` - ${roundDateMeta.label}` : ""}
                    </Text>
                    {!canManage && playerStatusMeta ? (
                      <View
                        style={[
                          styles.roundStatusChip,
                          {
                            backgroundColor: playerStatusMeta.tint,
                            borderColor: playerStatusMeta.border,
                          },
                        ]}
                      >
                        <Text style={[styles.roundStatusChipText, { color: playerStatusMeta.accent }]}>
                          {playerStatusMeta.label}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  {roundPriceLabel ? <Text style={styles.roundPriceText}>{roundPriceLabel}</Text> : null}
                  {round.pendingReprogrammedMatchesCount > 0 ? (
                    <Text style={styles.roundReprogrammedNotice}>
                      {round.pendingReprogrammedMatchesCount} partido(s) reprogramado(s) pendiente(s)
                      no generan deuda todavia.
                    </Text>
                  ) : null}
                </View>
                <View style={styles.roundChevronWrap}>
                  <View style={styles.roundChevronSpacer}>
                    <Ionicons
                      color={colors.primaryDark}
                      name={isExpanded ? "chevron-up" : "chevron-down"}
                      size={18}
                    />
                  </View>
                </View>
              </Pressable>

              <View style={styles.roundCountersRow}>
                {canManage ? (
                  <>
                    <View style={[styles.inlineCounter, styles.inlineCounterSuccess]}>
                      <Text style={styles.inlineCounterText}>Pagados {roundSummary.paid}</Text>
                    </View>
                    <View style={[styles.inlineCounter, styles.inlineCounterWarning]}>
                      <Text style={styles.inlineCounterText}>Verificar pago {roundSummary.transfer}</Text>
                    </View>
                    <View style={[styles.inlineCounter, styles.inlineCounterDanger]}>
                      <Text style={styles.inlineCounterText}>Impagos {roundSummary.pending}</Text>
                    </View>
                  </>
                ) : null}
              </View>

              {isExpanded ? (
                <View style={styles.entriesWrap}>
                  {canManage ? (
                    <View style={styles.paymentTableCard}>
                      <View style={styles.paymentTableHeaderRow}>
                        <Text style={[styles.paymentTableHeaderText, styles.paymentTablePlayerHeader]}>
                          JUGADOR
                        </Text>
                        <Text style={[styles.paymentTableHeaderText, styles.paymentTableStatusHeader]}>
                          ESTADO
                        </Text>
                        <Text style={[styles.paymentTableHeaderText, styles.paymentTableMethodHeader]}>
                          MODO
                        </Text>
                        <Text style={[styles.paymentTableHeaderText, styles.paymentTableProofHeader]}>
                          COMP.
                        </Text>
                        <Text style={[styles.paymentTableHeaderText, styles.paymentTableAmountHeader]}>
                          $
                        </Text>
                        <Text style={[styles.paymentTableHeaderText, styles.paymentTableActionsHeader]}>
                          {" "}
                        </Text>
                      </View>

                      {buildPaymentTableRows(round.entries || [], league?.teamType).map((entry) =>
                        renderPaymentTableRow(round, entry)
                      )}
                    </View>
                  ) : (
                    (round.entries || []).map((entry) => renderPaymentEntryRow(round, entry))
                  )}
                  {!canManage && !leagueMercadoPagoConfig.enabled ? (
                    <View style={styles.playerPaymentHelpCard}>
                      <View style={styles.playerPaymentHelpTitleRow}>
                        <Ionicons color={colors.primaryDark} name="swap-horizontal-outline" size={16} />
                        <Text style={styles.playerPaymentHelpTitle}>
                          Transferencia
                        </Text>
                      </View>
                      <Text style={styles.playerPaymentHelpText}>
                        Selecciona una o varias fechas desde la tarjeta cerrada y adjunta un comprobante para todas.
                      </Text>
                    </View>
                  ) : null}
                  {canManage ? (
                    <View style={styles.roundAmountSummaryCard}>
                      <Text style={styles.roundAmountSummaryTitle}>
                        RESUMEN DE {String(round.title || "").toUpperCase()}
                        {roundDateMeta.label ? ` - ${roundDateMeta.label}` : ""}
                      </Text>
                      <View style={styles.amountSummaryGrid}>
                        {getPaymentAmountSummaryItems(roundAmountSummary).map((item) => (
                          <View
                            key={`${round.roundId}-${item.key}`}
                            style={[
                              styles.amountSummaryItem,
                              item.key === "paid_total" ? styles.amountSummaryItemSuccess : null,
                              item.key === "pending" ? styles.amountSummaryItemDanger : null,
                            ]}
                          >
                            <Text style={styles.amountSummaryLabel}>{item.label}</Text>
                            <Text
                              style={[
                                styles.amountSummaryValue,
                                item.key === "paid_total" ? styles.amountSummaryValueSuccess : null,
                                item.key === "pending" ? styles.amountSummaryValueDanger : null,
                              ]}
                            >
                              {formatCurrency(item.value)}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}

        {hasFixture && canManage ? (
          <View style={styles.footerSummaryCard}>
            <Text style={styles.footerSummaryTitle}>RESUMEN TOTAL DE LIGA</Text>
            <Text style={styles.footerSummarySubtitle}>
              Acumulado de las fechas jugadas: {globalSummary.totalPlayedRounds}/{globalSummary.totalRounds}
            </Text>
            <View style={styles.amountSummaryGrid}>
              {getPaymentAmountSummaryItems(globalSummary).map((item) => (
                <View
                  key={`global-${item.key}`}
                  style={[
                    styles.amountSummaryItem,
                    item.key === "paid_total" ? styles.amountSummaryItemSuccess : null,
                    item.key === "pending" ? styles.amountSummaryItemDanger : null,
                  ]}
                >
                  <Text style={styles.amountSummaryLabel}>{item.label}</Text>
                  <Text
                    style={[
                      styles.amountSummaryValue,
                      item.key === "paid_total" ? styles.amountSummaryValueSuccess : null,
                      item.key === "pending" ? styles.amountSummaryValueDanger : null,
                    ]}
                  >
                    {formatCurrency(item.value)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {hasFixture && canManage ? (
          <Pressable
            onPress={openReminderCenter}
            style={({ pressed }) => [
              styles.reminderCenterButton,
              pressed ? styles.pressedState : null,
            ]}
          >
            <Ionicons color={colors.surface} name="notifications-outline" size={18} />
            <Text style={styles.reminderCenterButtonText}>ENVÍO DE RECORDATORIOS</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {!canManage && selectedMercadoPagoBatchTargets.length ? (
        <View style={styles.batchFloatingBar}>
          <View style={styles.batchFloatingSummary}>
            <Text style={styles.batchFloatingTitle}>
              {selectedMercadoPagoBatchTargets.length} fecha(s) seleccionada(s)
            </Text>
            <Text style={styles.batchFloatingSubtitle}>
              {leagueMercadoPagoConfig.enabled
                ? `Total ${formatCurrency(selectedMercadoPagoBatchAmount)}`
                : "Adjuntaras un comprobante para las fechas elegidas"}
            </Text>
          </View>
          <Pressable
            disabled={saving}
            onPress={
              leagueMercadoPagoConfig.enabled
                ? handleStartLeagueMercadoPagoBatch
                : () => handleUploadProofBatch("any")
            }
            style={({ pressed }) => [
              styles.batchFloatingButton,
              leagueMercadoPagoConfig.enabled
                ? styles.batchFloatingButtonMercadoPago
                : styles.batchFloatingButtonTransfer,
              saving ? styles.saveButtonDisabled : null,
              pressed && !saving ? styles.pressedState : null,
            ]}
          >
            <Ionicons
              color={leagueMercadoPagoConfig.enabled ? "#1A7F5A" : colors.primaryDark}
              name={leagueMercadoPagoConfig.enabled ? "wallet-outline" : "attach-outline"}
              size={16}
            />
            <Text
              style={[
                styles.batchFloatingButtonText,
                leagueMercadoPagoConfig.enabled
                  ? styles.batchFloatingButtonTextMercadoPago
                  : styles.batchFloatingButtonTextTransfer,
              ]}
            >
              {leagueMercadoPagoConfig.enabled ? "Pagar" : "Enviar comprobante"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {hasFixture && canManage ? (
        <View style={styles.stickyActionsWrap}>
          <Pressable
            disabled={!hasPendingChanges || saving}
            onPress={handleSave}
            style={({ pressed }) => [
              styles.saveButton,
              !hasPendingChanges || saving ? styles.saveButtonDisabled : null,
              pressed && hasPendingChanges && !saving ? styles.pressedState : null,
            ]}
          >
            <Text style={styles.saveButtonText}>
              {saving ? "GUARDANDO..." : "GUARDAR PAGOS"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <Modal
        animationType="fade"
        transparent
        visible={reminderCenterVisible}
        onRequestClose={closeReminderCenter}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={closeReminderCenter} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Envío de recordatorios</Text>
            <Text style={styles.modalSubtitle}>
              Elegi el medio y luego la accion que queres realizar.
            </Text>

            <View style={styles.reminderChannelRow}>
              <Pressable
                onPress={() => {
                  setReminderChannel("whatsapp");
                  setReminderAction("");
                }}
                style={({ pressed }) => [
                  styles.reminderChannelButton,
                  reminderChannel === "whatsapp" ? styles.reminderChannelButtonActive : null,
                  pressed ? styles.pressedState : null,
                ]}
              >
                <Ionicons
                  color={reminderChannel === "whatsapp" ? colors.surface : colors.primaryDark}
                  name="logo-whatsapp"
                  size={18}
                />
                <Text
                  style={[
                    styles.reminderChannelText,
                    reminderChannel === "whatsapp" ? styles.reminderChannelTextActive : null,
                  ]}
                >
                  WhatsApp
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setReminderChannel("internal");
                  setReminderAction("");
                }}
                style={({ pressed }) => [
                  styles.reminderChannelButton,
                  reminderChannel === "internal" ? styles.reminderChannelButtonActive : null,
                  pressed ? styles.pressedState : null,
                ]}
              >
                <Ionicons
                  color={reminderChannel === "internal" ? colors.surface : colors.primaryDark}
                  name="chatbubble-ellipses-outline"
                  size={18}
                />
                <Text
                  style={[
                    styles.reminderChannelText,
                    reminderChannel === "internal" ? styles.reminderChannelTextActive : null,
                  ]}
                >
                  Mensajeria Interna
                </Text>
              </Pressable>
            </View>

            {reminderChannel ? (
              <>
                <Text style={styles.reminderSectionTitle}>Que queres enviar?</Text>
                <View style={styles.reminderActionChoiceList}>
                  <Pressable
                    onPress={() => setReminderAction("pending")}
                    style={({ pressed }) => [
                      styles.reminderActionChoice,
                      reminderAction === "pending" ? styles.reminderActionChoiceActive : null,
                      pressed ? styles.pressedState : null,
                    ]}
                  >
                    <Ionicons
                      color={reminderAction === "pending" ? colors.surface : colors.primaryDark}
                      name="notifications-outline"
                      size={18}
                    />
                    <Text
                      style={[
                        styles.reminderActionChoiceText,
                        reminderAction === "pending" ? styles.reminderActionChoiceTextActive : null,
                      ]}
                    >
                      ENVIAR RECORDATORIOS A IMPAGOS DE LA FECHA
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setReminderAction("value")}
                    style={({ pressed }) => [
                      styles.reminderActionChoice,
                      reminderAction === "value" ? styles.reminderActionChoiceActive : null,
                      pressed ? styles.pressedState : null,
                    ]}
                  >
                    <Ionicons
                      color={reminderAction === "value" ? colors.surface : colors.primaryDark}
                      name="cash-outline"
                      size={18}
                    />
                    <Text
                      style={[
                        styles.reminderActionChoiceText,
                        reminderAction === "value" ? styles.reminderActionChoiceTextActive : null,
                      ]}
                    >
                      NOTIFICAR NUEVO VALOR DE LA LIGA
                    </Text>
                  </Pressable>
                </View>

                {reminderAction === "pending" ? (
                  <>
                    <Text style={styles.reminderSectionTitle}>
                      Selecciona las fechas jugadas
                    </Text>
                    <View style={styles.reminderRoundList}>
                      {playedPaymentRoundsForReminders.length ? (
                        playedPaymentRoundsForReminders.map((round) => {
                          const isSelected = selectedReminderRoundIds.includes(round.roundId);
                          const roundDateMeta = getPaymentRoundDateMeta(round);

                          return (
                            <Pressable
                              key={round.roundId}
                              onPress={() => toggleReminderRoundSelection(round.roundId)}
                              style={({ pressed }) => [
                                styles.reminderRoundButton,
                                isSelected ? styles.reminderRoundButtonActive : null,
                                pressed ? styles.pressedState : null,
                              ]}
                            >
                              <Ionicons
                                color={isSelected ? colors.surface : colors.primaryDark}
                                name={isSelected ? "checkbox" : "square-outline"}
                                size={18}
                              />
                              <Text
                                style={[
                                  styles.reminderRoundText,
                                  isSelected ? styles.reminderRoundTextActive : null,
                                ]}
                              >
                                {String(round.title || "").toUpperCase()}
                                {roundDateMeta.label ? ` - ${roundDateMeta.label}` : ""}
                              </Text>
                            </Pressable>
                          );
                        })
                      ) : (
                        <Text style={styles.reminderEmptyText}>
                          Todavia no hay fechas jugadas con ganador cargado.
                        </Text>
                      )}
                    </View>

                    <Pressable
                      disabled={
                        saving ||
                        !selectedReminderRoundIds.length ||
                        !playedPaymentRoundsForReminders.length
                      }
                      onPress={
                        reminderChannel === "whatsapp"
                          ? showWhatsAppFutureFeedback
                          : handleInternalPendingReminder
                      }
                      style={({ pressed }) => [
                        styles.modalAction,
                        saving ||
                        !selectedReminderRoundIds.length ||
                        !playedPaymentRoundsForReminders.length
                          ? styles.saveButtonDisabled
                          : null,
                        pressed &&
                        !saving &&
                        selectedReminderRoundIds.length &&
                        playedPaymentRoundsForReminders.length
                          ? styles.pressedState
                          : null,
                      ]}
                    >
                      <Text style={styles.modalActionText}>Enviar recordatorios a impagos</Text>
                    </Pressable>
                  </>
                ) : null}

                {reminderAction === "value" ? (
                  <>
                <View style={styles.valueNoticeBox}>
                  <Text style={styles.reminderSectionTitle}>
                    NUEVO VALOR POR FECHA
                  </Text>
                  <TextInput
                    keyboardType="number-pad"
                    onChangeText={setReminderNewValue}
                    placeholder="Ingresar nuevo valor"
                    placeholderTextColor={colors.textMuted}
                    style={styles.valueNoticeInput}
                    value={reminderNewValue}
                  />
                  <Text style={styles.valueNoticeLabel}>Desde cuando rige</Text>
                  <View style={styles.valueStartRow}>
                    <Pressable
                      onPress={() => setReminderValueStart("now")}
                      style={({ pressed }) => [
                        styles.valueStartButton,
                        reminderValueStart === "now" ? styles.valueStartButtonActive : null,
                        pressed ? styles.pressedState : null,
                      ]}
                    >
                      <Text
                        style={[
                          styles.valueStartButtonText,
                          reminderValueStart === "now" ? styles.valueStartButtonTextActive : null,
                        ]}
                      >
                        Desde ahora
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setReminderValueStart("next_month")}
                      style={({ pressed }) => [
                        styles.valueStartButton,
                        reminderValueStart === "next_month" ? styles.valueStartButtonActive : null,
                        pressed ? styles.pressedState : null,
                      ]}
                    >
                      <Text
                        style={[
                          styles.valueStartButtonText,
                          reminderValueStart === "next_month" ? styles.valueStartButtonTextActive : null,
                        ]}
                      >
                        Mes entrante
                      </Text>
                    </Pressable>
                  </View>
                </View>

                <Pressable
                  disabled={saving}
                  onPress={
                    reminderChannel === "whatsapp"
                      ? showWhatsAppFutureFeedback
                      : handleInternalValueChangeNotice
                  }
                  style={({ pressed }) => [
                    styles.modalAction,
                    saving || !getPositiveMoneyValue(reminderNewValue) ? styles.saveButtonDisabled : null,
                    pressed && !saving && getPositiveMoneyValue(reminderNewValue)
                      ? styles.pressedState
                      : null,
                  ]}
                >
                  <Text style={styles.modalActionText}>
                    ENVIAR NOTIFICACION
                  </Text>
                </Pressable>
                  </>
                ) : null}
              </>
            ) : null}

            <Pressable onPress={closeReminderCenter} style={({ pressed }) => [styles.modalCloseButton, pressed ? styles.pressedState : null]}>
              <Text style={styles.modalCloseButtonText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={entryMenuVisible && Boolean(selectedEntry && selectedRound)}
        onRequestClose={closeEntryMenu}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={closeEntryMenu} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{selectedEntry?.participantLabel || "Opciones"}</Text>
            <Text style={styles.modalSubtitle}>
              Actualiza el estado o envia un recordatorio rapido.
            </Text>

            {selectedEntry?.proofUrl ? (
              <Pressable
                onPress={() => openProofReview(selectedRound, selectedEntry)}
                style={({ pressed }) => [styles.modalAction, pressed ? styles.pressedState : null]}
              >
                <Text style={styles.modalActionText}>Ver comprobante</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={handleOpenWhatsAppReminder} style={({ pressed }) => [styles.modalAction, pressed ? styles.pressedState : null]}>
              <Text style={styles.modalActionText}>Enviar recordatorio por WhatsApp</Text>
            </Pressable>
            <Pressable onPress={handleOpenInternalReminder} style={({ pressed }) => [styles.modalAction, pressed ? styles.pressedState : null]}>
              <Text style={styles.modalActionText}>Enviar por mensajeria interna</Text>
            </Pressable>
            <Pressable onPress={markPending} style={({ pressed }) => [styles.modalActionDanger, pressed ? styles.pressedState : null]}>
              <Text style={styles.modalActionDangerText}>Marcar impago</Text>
            </Pressable>

            <Pressable onPress={closeEntryMenu} style={({ pressed }) => [styles.modalCloseButton, pressed ? styles.pressedState : null]}>
              <Text style={styles.modalCloseButtonText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={proofReviewVisible && Boolean(selectedEntry?.proofUrl)}
        onRequestClose={closeEntryMenu}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={closeEntryMenu} />
          <View style={styles.proofModalCard}>
            <Text style={styles.modalTitle}>Comprobante</Text>
            <Text style={styles.modalSubtitle}>
              {selectedEntry?.participantLabel || "Participante"} · {selectedRound?.title || "Fecha"}
            </Text>
            <View style={styles.proofPreviewFrame}>
              {isPdfProof(selectedEntry) ? (
                <View style={styles.proofPdfPreview}>
                  <Ionicons color="#B24343" name="document-text-outline" size={48} />
                  <Text style={styles.proofPdfPreviewText}>PDF</Text>
                </View>
              ) : (
                <Image
                  resizeMode="contain"
                  source={{ uri: selectedEntry?.proofUrl }}
                  style={styles.proofPreviewImage}
                />
              )}
            </View>
            <Text style={styles.proofMetaText}>
              Adjuntado: {formatUpdatedAt(selectedEntry?.proofUploadedAtMillis)}
            </Text>
            <Pressable
              onPress={confirmTransferPayment}
              style={({ pressed }) => [styles.confirmProofButton, pressed ? styles.pressedState : null]}
            >
              <Ionicons color={colors.surface} name="checkmark-circle-outline" size={18} />
              <Text style={styles.confirmProofButtonText}>PAGO CONFIRMADO</Text>
            </Pressable>
            <Pressable
              onPress={() => handleOpenProof(selectedEntry?.proofUrl)}
              style={({ pressed }) => [styles.modalAction, pressed ? styles.pressedState : null]}
            >
              <Text style={styles.modalActionText}>Abrir comprobante</Text>
            </Pressable>
            <Pressable onPress={closeEntryMenu} style={({ pressed }) => [styles.modalCloseButton, pressed ? styles.pressedState : null]}>
              <Text style={styles.modalCloseButtonText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={methodPickerVisible}
        onRequestClose={() => setMethodPickerVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setMethodPickerVisible(false)} />
          <View style={styles.modalCardSmall}>
            <Text style={styles.modalTitle}>Marcar como pagado</Text>
            {PAYMENT_METHOD_OPTIONS.map((option) => (
              <Pressable
                key={option.key}
                onPress={() =>
                  option.key === "transferencia"
                    ? openTransferProofPicker()
                    : markPaidWithMethod(option.key)
                }
                style={({ pressed }) => [styles.modalAction, pressed ? styles.pressedState : null]}
              >
                <Text style={styles.modalActionText}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={transferProofPickerVisible}
        onRequestClose={() => setTransferProofPickerVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setTransferProofPickerVisible(false)}
          />
          <View style={styles.modalCardSmall}>
            <Text style={styles.modalTitle}>Transferencia</Text>
            <Text style={styles.modalSubtitle}>
              El comprobante puede cargarse ahora o dejarse sin adjuntar.
            </Text>
            <Pressable
              onPress={() => handleOrganizerTransferSelection(false)}
              style={({ pressed }) => [styles.modalAction, pressed ? styles.pressedState : null]}
            >
              <Text style={styles.modalActionText}>Marcar sin comprobante</Text>
            </Pressable>
            <Pressable
              onPress={() => handleOrganizerTransferSelection(true)}
              style={({ pressed }) => [styles.modalAction, pressed ? styles.pressedState : null]}
            >
              <Text style={styles.modalActionText}>Cargar comprobante</Text>
            </Pressable>
            <Pressable
              onPress={() => setTransferProofPickerVisible(false)}
              style={({ pressed }) => [styles.modalCloseButton, pressed ? styles.pressedState : null]}
            >
              <Text style={styles.modalCloseButtonText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <BottomQuickActionsBar navigation={navigation} />

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
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: BOTTOM_QUICK_ACTIONS_SPACE + 110,
    gap: spacing.md,
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
  heroText: {
    color: colors.textMuted,
    lineHeight: 20,
    textAlign: "center",
  },
  roundCard: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  roundToggleButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  roundChevronSpacer: {
    alignItems: "center",
    justifyContent: "center",
    width: 18,
  },
  roundChevronWrap: {
    alignItems: "center",
    justifyContent: "center",
    width: 24,
  },
  roundHeader: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  roundTitleValueRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    width: "100%",
  },
  roundTitle: {
    backgroundColor: "#2D6B8F",
    borderRadius: 10,
    color: colors.surface,
    fontSize: 13,
    fontWeight: "900",
    minHeight: 34,
    overflow: "hidden",
    paddingHorizontal: 12,
    paddingVertical: 7,
    textAlign: "center",
    flex: 1,
  },
  roundStatusChip: {
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 28,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  roundStatusChipText: {
    fontSize: 11,
    fontWeight: "900",
  },
  roundDatePillReprogrammed: {
    backgroundColor: "#1E7F4D",
  },
  roundSchedule: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  roundPriceText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
  },
  roundReprogrammedNotice: {
    color: "#126236",
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
  },
  unsavedChangesBanner: {
    alignItems: "center",
    backgroundColor: "#EEF1FF",
    borderColor: "#A9B4F5",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  unsavedChangesText: {
    color: "#263172",
    flex: 1,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
  },
  roundCountersRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    justifyContent: "center",
  },
  roundHeaderActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  roundSelectButton: {
    alignItems: "center",
    justifyContent: "center",
    width: 24,
    height: 24,
  },
  roundSelectButtonPlaceholder: {
    width: 24,
    height: 24,
  },
  roundSelectButtonActive: {
    transform: [{ scale: 1.02 }],
  },
  inlineCounter: {
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  inlineCounterSuccess: {
    backgroundColor: "#EEF9F1",
    borderColor: "#B7DFBF",
  },
  inlineCounterWarning: {
    backgroundColor: "#FFF9E6",
    borderColor: "#E5D07F",
  },
  inlineCounterDanger: {
    backgroundColor: "#FFF4E8",
    borderColor: "#F2C997",
  },
  inlineCounterText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
  },
  entriesWrap: {
    gap: spacing.xs,
  },
  paymentTableCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D6E0DB",
    backgroundColor: "#FCFDFC",
    overflow: "hidden",
  },
  paymentTableHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#EAF3EE",
    borderBottomWidth: 1,
    borderBottomColor: "#D6E0DB",
    minHeight: 38,
    paddingLeft: 3,
    paddingRight: 4,
  },
  paymentTableHeaderText: {
    color: colors.primaryDark,
    fontSize: 10,
    fontWeight: "900",
    textAlign: "center",
  },
  paymentTableRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 58,
    paddingLeft: 3,
    paddingRight: 4,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#EEF2F0",
  },
  focusedPaymentTableRow: {
    backgroundColor: "#F1FAF5",
  },
  paymentTablePlayerCell: {
    flex: 2.9,
    justifyContent: "center",
    paddingRight: 6,
  },
  paymentTablePlayerHeader: {
    flex: 2.9,
    textAlign: "left",
  },
  paymentTablePairLabel: {
    color: "#5C7468",
    fontSize: 9,
    fontWeight: "900",
    marginBottom: 1,
  },
  paymentTablePlayerName: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
  },
  paymentTablePlayerMate: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "600",
    marginTop: 1,
  },
  paymentTableStatusCell: {
    flex: 1.1,
    alignItems: "flex-start",
    justifyContent: "center",
    paddingLeft: 0,
    paddingRight: 2,
    marginLeft: -122,
  },
  paymentTableStatusHeader: {
    flex: 1.1,
    textAlign: "left",
    paddingLeft: 0,
    marginLeft: -122,
  },
  paymentTableStatusText: {
    fontSize: 10,
    fontWeight: "900",
    textAlign: "left",
    lineHeight: 11,
  },
  paymentTableMethodCell: {
    flex: 0.95,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
    marginLeft: -48,
  },
  paymentTableMethodHeader: {
    flex: 0.95,
    textAlign: "center",
    marginLeft: -48,
  },
  paymentTableMethodText: {
    color: colors.text,
    fontSize: 10,
    fontWeight: "700",
    textAlign: "center",
  },
  paymentTableProofCell: {
    flex: 0.75,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -20,
  },
  paymentTableProofHeader: {
    flex: 0.75,
    textAlign: "center",
    marginLeft: -20,
  },
  paymentTableProofButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#BFD2C8",
    backgroundColor: "#F6FBF8",
    alignItems: "center",
    justifyContent: "center",
  },
  paymentTableAmountCell: {
    flex: 0.9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
    marginLeft: -18,
  },
  paymentTableAmountHeader: {
    flex: 0.9,
    marginLeft: -18,
  },
  paymentTableAmountText: {
    color: colors.text,
    fontSize: 9,
    fontWeight: "900",
    textAlign: "center",
  },
  paymentTableActionsCell: {
    flex: 0.8,
    alignItems: "center",
    justifyContent: "center",
  },
  paymentTableActionsHeader: {
    flex: 0.8,
  },
  paymentTableActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  paymentTableActionButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  paymentTableMenuButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#D7E0DB",
    backgroundColor: "#F4F7F6",
    alignItems: "center",
    justifyContent: "center",
  },
  paymentTableMiniButton: {
    minWidth: 30,
    minHeight: 26,
    borderRadius: 8,
    backgroundColor: colors.primaryDark,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  paymentTableMiniButtonText: {
    color: colors.surface,
    fontSize: 9,
    fontWeight: "900",
  },
  paymentTableMutedText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "700",
    textAlign: "center",
  },
  pairPaymentCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D7E4DE",
    backgroundColor: "#FAFCFB",
    padding: spacing.sm,
    gap: spacing.xs,
  },
  pairPaymentTitle: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
  },
  pairPaymentEntries: {
    gap: spacing.xs,
  },
  roundAmountSummaryCard: {
    backgroundColor: "#F7F8FC",
    borderColor: "#D8DDEE",
    borderRadius: 8,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  roundAmountSummaryTitle: {
    color: "#263172",
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
  },
  amountSummaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    justifyContent: "center",
  },
  amountSummaryItem: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: "#D8DDEE",
    borderRadius: 8,
    borderWidth: 1,
    minWidth: "47%",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  amountSummaryItemSuccess: {
    backgroundColor: "#EEF9F1",
    borderColor: "#B7DFBF",
  },
  amountSummaryItemDanger: {
    backgroundColor: "#FFF4E8",
    borderColor: "#F2C997",
  },
  amountSummaryLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
  },
  amountSummaryValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
  },
  amountSummaryValueSuccess: {
    color: "#237547",
  },
  amountSummaryValueDanger: {
    color: "#C8581F",
  },
  entryRow: {
    minHeight: 72,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#DEE6E1",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "stretch",
    gap: spacing.sm,
  },
  focusedPaymentRow: {
    borderColor: "#8BCDB0",
    backgroundColor: "#F1FAF5",
  },
  entryAccentBar: {
    width: 5,
    borderRadius: 999,
  },
  entryCopy: {
    flex: 1,
    gap: 6,
    justifyContent: "center",
  },
  entryTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  playerEntryTopRow: {
    justifyContent: "center",
    flexWrap: "wrap",
  },
  entryName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
    flex: 1,
  },
  playerEntryName: {
    flex: 0,
    textAlign: "center",
  },
  entryMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  },
  playerEntryMetaRow: {
    justifyContent: "center",
  },
  entryAmountLabel: {
    backgroundColor: "#EAF3EE",
    borderWidth: 1,
    borderColor: "#C9DBD2",
    borderRadius: 8,
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  entryStatusChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  entryStatusLabel: {
    fontSize: 11,
    fontWeight: "800",
  },
  entryMetaChip: {
    backgroundColor: "#F3F6F5",
    borderRadius: 999,
    color: "#4F635B",
    fontSize: 11,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  entryProofChip: {
    backgroundColor: "#EAF4FF",
    borderRadius: 999,
    color: "#2F648D",
    fontSize: 11,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  entryFooterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  playerEntryFooterRow: {
    justifyContent: "center",
  },
  entryUpdated: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 15,
  },
  moreButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "#F4F7F6",
    borderWidth: 1,
    borderColor: "#D7E0DB",
    alignItems: "center",
    justifyContent: "center",
  },
  organizerEntryActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    alignSelf: "center",
  },
  quickProofButton: {
    minHeight: 32,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#B9D2C7",
    backgroundColor: "#F5FBF8",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 8,
  },
  quickProofButtonText: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "900",
  },
  quickPaidButton: {
    width: 32,
    minHeight: 32,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  quickPaidButtonPending: {
    backgroundColor: "#D98736",
  },
  quickPaidButtonTransfer: {
    backgroundColor: "#B58A33",
  },
  quickPaidButtonPaid: {
    backgroundColor: "#319260",
  },
  playerEntryActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  playerPrimaryButton: {
    minHeight: 32,
    borderRadius: 8,
    backgroundColor: colors.primaryDark,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  playerPrimaryButtonText: {
    color: colors.surface,
    fontSize: 11,
    fontWeight: "900",
  },
  proofUploadActions: {
    flexDirection: "row",
    gap: 4,
  },
  proofUploadButton: {
    alignItems: "center",
    backgroundColor: colors.primaryDark,
    borderRadius: 8,
    flexDirection: "row",
    gap: 5,
    justifyContent: "center",
    minHeight: 32,
    paddingHorizontal: 10,
  },
  proofUploadButtonText: {
    color: colors.surface,
    fontSize: 11,
    fontWeight: "900",
  },
  paymentTableProofUploadButton: {
    minWidth: 50,
  },
  playerSecondaryButton: {
    minHeight: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#C9D7D0",
    backgroundColor: "#F7FAF8",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  playerSecondaryButtonText: {
    color: "#496358",
    fontSize: 11,
    fontWeight: "800",
  },
  playerSoftActionButton: {
    minHeight: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#C9D7D0",
    backgroundColor: "#F7FAF8",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 10,
  },
  playerSoftActionButtonText: {
    color: "#496358",
    fontSize: 11,
    fontWeight: "800",
  },
  playerPaymentHelpCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D7E5DE",
    backgroundColor: "#F3FAF6",
    padding: spacing.sm,
    gap: spacing.xs,
  },
  playerPaymentHelpTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  playerPaymentHelpTitle: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "900",
  },
  playerPaymentHelpText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  playerPaymentHelpActions: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  playerPaymentHelpButton: {
    alignSelf: "stretch",
  },
  playerMercadoPagoButton: {
    backgroundColor: "#F3FBF7",
    borderColor: "#BFE5CD",
  },
  playerMercadoPagoButtonText: {
    color: "#1A7F5A",
  },
  playerBatchHintBox: {
    alignItems: "center",
    backgroundColor: "#F0FBF5",
    borderColor: "#BFE5CD",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  playerBatchHintText: {
    color: "#1A7F5A",
    flex: 1,
    fontSize: 11,
    fontWeight: "700",
  },
  batchPaymentCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#D7E5DE",
    backgroundColor: "#F3FAF6",
    padding: spacing.md,
    gap: spacing.xs,
  },
  batchPaymentHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  batchPaymentCounter: {
    color: "#1A7F5A",
    fontSize: 12,
    fontWeight: "900",
  },
  batchSelectionRow: {
    alignItems: "center",
    backgroundColor: "#F8FBF9",
    borderColor: "#D7E5DE",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 9,
  },
  batchSelectionRowActive: {
    backgroundColor: "#F0FBF5",
    borderColor: "#BFE5CD",
  },
  batchSelectionText: {
    color: colors.text,
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
  },
  batchSelectionHint: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  batchSelectionHintText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  batchFloatingBar: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: BOTTOM_QUICK_ACTIONS_SPACE + 18,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    padding: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  batchFloatingSummary: {
    flex: 1,
    gap: 2,
  },
  batchFloatingTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
  },
  batchFloatingSubtitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
  },
  batchFloatingButton: {
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  batchFloatingButtonMercadoPago: {
    backgroundColor: "#F3FBF7",
    borderColor: "#BFE5CD",
  },
  batchFloatingButtonTransfer: {
    backgroundColor: "#F7FAF8",
    borderColor: "#C9D7D0",
  },
  batchFloatingButtonText: {
    fontSize: 12,
    fontWeight: "900",
  },
  batchFloatingButtonTextMercadoPago: {
    color: "#1A7F5A",
  },
  batchFloatingButtonTextTransfer: {
    color: colors.primaryDark,
  },
  footerSummaryCard: {
    backgroundColor: "#EEF6FF",
    borderRadius: 22,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: "#BBD7F2",
    gap: spacing.sm,
  },
  footerSummaryTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
    textAlign: "center",
  },
  footerSummarySubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  reminderCenterButton: {
    alignItems: "center",
    backgroundColor: "#2D6B8F",
    borderColor: "#1F4E6F",
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    minHeight: 50,
    paddingHorizontal: spacing.md,
  },
  reminderCenterButtonText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
  },
  footerSummaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  footerSummaryLabel: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
  },
  footerSummaryValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  footerSummaryValueSuccess: {
    color: "#237547",
  },
  footerSummaryValueWarning: {
    color: "#8C6A05",
  },
  footerSummaryValueDanger: {
    color: "#B24343",
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
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
  },
  emptyText: {
    color: colors.textMuted,
    lineHeight: 20,
  },
  stickyActionsWrap: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: BOTTOM_QUICK_ACTIONS_SPACE + spacing.md,
  },
  saveButton: {
    minHeight: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  saveButtonDisabled: {
    opacity: 0.55,
  },
  saveButtonText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: "800",
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
    padding: spacing.lg,
    gap: spacing.sm,
  },
  modalCardSmall: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  proofModalCard: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "88%",
    backgroundColor: colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: "800",
    textAlign: "center",
  },
  modalSubtitle: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    marginBottom: spacing.xs,
  },
  modalAction: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  modalActionText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
  },
  modalActionDanger: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E4B8B8",
    backgroundColor: "#FFF4F4",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  modalActionDangerText: {
    color: "#B24343",
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
  },
  modalActionDisabled: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E7E0C4",
    backgroundColor: "#FAF6E8",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  modalActionDisabledText: {
    color: "#8A7A39",
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
  },
  reminderChannelRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  reminderChannelButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 46,
    minWidth: 130,
    paddingHorizontal: spacing.sm,
  },
  reminderChannelButtonActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  reminderChannelText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
  },
  reminderChannelTextActive: {
    color: colors.surface,
  },
  reminderSectionTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
  },
  reminderActionChoiceList: {
    gap: spacing.sm,
  },
  reminderActionChoice: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  reminderActionChoiceActive: {
    backgroundColor: "#2D6B8F",
    borderColor: "#2D6B8F",
  },
  reminderActionChoiceText: {
    color: colors.text,
    flex: 1,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
  },
  reminderActionChoiceTextActive: {
    color: colors.surface,
  },
  reminderRoundList: {
    gap: spacing.xs,
  },
  reminderRoundButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 42,
    paddingHorizontal: spacing.sm,
  },
  reminderRoundButtonActive: {
    backgroundColor: "#2D6B8F",
    borderColor: "#2D6B8F",
  },
  reminderRoundText: {
    color: colors.text,
    flex: 1,
    fontSize: 12,
    fontWeight: "800",
    marginRight: 18,
    textAlign: "center",
  },
  reminderRoundTextActive: {
    color: colors.surface,
  },
  reminderEmptyText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  valueNoticeBox: {
    backgroundColor: "#F7F8FC",
    borderColor: "#D8DDEE",
    borderRadius: 8,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  valueNoticeInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
    minHeight: 46,
    paddingHorizontal: spacing.md,
    textAlign: "center",
  },
  valueNoticeLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  valueStartRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  valueStartButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: spacing.sm,
  },
  valueStartButtonActive: {
    backgroundColor: "#2D6B8F",
    borderColor: "#2D6B8F",
  },
  valueStartButtonText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
  },
  valueStartButtonTextActive: {
    color: colors.surface,
  },
  modalCloseButton: {
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: colors.primaryDark,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.xs,
  },
  modalCloseButtonText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: "800",
  },
  proofPreviewFrame: {
    height: 330,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    overflow: "hidden",
  },
  proofPreviewImage: {
    width: "100%",
    height: "100%",
  },
  proofPdfPreview: {
    alignItems: "center",
    backgroundColor: "#FFF3F3",
    flex: 1,
    gap: spacing.xs,
    justifyContent: "center",
  },
  proofPdfPreviewText: {
    color: "#B24343",
    fontSize: 13,
    fontWeight: "900",
  },
  proofMetaText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  confirmProofButton: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: "#237547",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  confirmProofButtonText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
  },
  pressedState: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
});

