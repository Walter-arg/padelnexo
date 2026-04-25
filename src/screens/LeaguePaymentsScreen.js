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
import * as ImagePicker from "expo-image-picker";
import { getDownloadURL, ref, uploadBytes } from "../../services/firebaseStorage";
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
  getLeagueById,
  getLeaguePaymentRoundSummary,
  resolveLeaguePaymentRounds,
  updateLeagueRoundPayments,
} from "../services/leaguesService";
import { sendChatMessage } from "../services/chatService";
import { storage } from "../../services/firebaseConfig";

const STATUS_META = {
  pendiente: {
    label: "Impago",
    tint: "#FFF4F4",
    border: "#E4B8B8",
    accent: "#B24343",
  },
  informo_transferencia: {
    label: "Verificar pago",
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
  { key: "cuenta_corriente", label: "Cuenta corriente" },
];

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
        (entry.paymentStatus === "pagado" && entry.paymentMethod === "transferencia") ||
        entry.paymentStatus === "informo_transferencia"
      ) {
        summary.transfer += amount;
      } else if (entry.paymentStatus === "pagado" && entry.paymentMethod === "cuenta_corriente") {
        summary.account += amount;
      } else if (entry.paymentStatus !== "pagado" && Number(entry.completedAtMillis || 0) > 0) {
        summary.pending += amount;
      }

      return summary;
    },
    { cash: 0, transfer: 0, account: 0, pending: 0 }
  );
}

function getPaymentAmountSummaryItems(summary = {}) {
  return [
    { key: "cash", label: "Efectivo", value: summary.cash || 0 },
    { key: "transfer", label: "Transferencia", value: summary.transfer || 0 },
    { key: "account", label: "Cuenta corriente", value: summary.account || 0 },
    { key: "pending", label: "Impagos", value: summary.pending || 0 },
  ];
}

function hasPaymentMovement(entry = {}) {
  return (
    entry.paymentStatus === "pagado" ||
    entry.paymentStatus === "informo_transferencia" ||
    Boolean(entry.paymentMethod || entry.proofUrl || entry.updatedAtMillis)
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

export default function LeaguePaymentsScreen({ navigation, route }) {
  const { userData } = useAuth();
  const leagueId = route?.params?.leagueId || "";
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
  const [reminderNewValue, setReminderNewValue] = useState("");
  const [reminderValueStart, setReminderValueStart] = useState("now");
  const [entryMenuVisible, setEntryMenuVisible] = useState(false);
  const [methodPickerVisible, setMethodPickerVisible] = useState(false);
  const [proofReviewVisible, setProofReviewVisible] = useState(false);
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
          const currentRoundId = resolveCurrentPaymentsRoundId(nextRounds);
          setLeague(nextLeague);
          setRoundPaymentsDraft(nextRounds);
          setExpandedRoundIds(currentRoundId ? [currentRoundId] : []);
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

  const handleUploadProof = async (round, entry) => {
    if (!round || !entry) {
      return;
    }

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        setFeedback({
          visible: true,
          title: "Permiso necesario",
          message: "Necesitamos acceso a tus fotos para adjuntar el comprobante.",
          tone: "danger",
        });
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: false,
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.75,
      });

      if (result.canceled || !result.assets?.length) {
        return;
      }

      setSaving(true);
      const asset = result.assets[0];
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const extension = asset.fileName?.split(".").pop() || "jpg";
      const fileName = `${entry.participantId}-${Date.now()}.${extension}`;
      const proofRef = ref(storage, `league-payment-proofs/${leagueId}/${round.roundId}/${fileName}`);

      await uploadBytes(proofRef, blob, {
        contentType: asset.mimeType || "image/jpeg",
      });

      const proofUrl = await getDownloadURL(proofRef);
      const nextPayments = patchRoundPaymentEntry(
        roundPaymentsDraft,
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
        title: "Comprobante enviado",
        message: "El organizador ya puede revisarlo y confirmar el pago.",
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
    const methodLabel =
      entry.paymentStatus === "pagado"
        ? entry.paymentMethod === "efectivo"
          ? "Efectivo"
          : entry.paymentMethod === "cuenta_corriente"
          ? "Cuenta corriente"
          : entry.paymentMethod === "transferencia"
          ? "Transferencia"
          : "Sin medio"
        : null;

    return (
      <View
        key={`${round.roundId}-${entry.participantId}`}
        style={[
          styles.entryRow,
          {
            backgroundColor: statusMeta.tint,
            borderColor: statusMeta.border,
          },
        ]}
      >
        <View style={[styles.statusDot, { backgroundColor: statusMeta.accent }]} />

        <View style={styles.entryCopy}>
          <Text numberOfLines={1} style={styles.entryName}>
            {entry.participantLabel}
          </Text>
          <View style={styles.entryMetaRow}>
            {roundPricePerPlayer > 0 ? (
              <Text style={styles.entryAmountLabel}>{formatCurrency(roundPricePerPlayer)}</Text>
            ) : null}
            <Text style={[styles.entryStatusLabel, { color: statusMeta.accent }]}>
              {statusMeta.label}
            </Text>
            {methodLabel ? <Text style={styles.entryDivider}>•</Text> : null}
            {methodLabel ? <Text style={styles.entryMethod}>{methodLabel}</Text> : null}
            {entry.proofUrl ? <Text style={styles.entryDivider}>|</Text> : null}
            {entry.proofUrl ? (
              <Text style={styles.entryMethod}>
                Comprobante {formatUpdatedAt(entry.proofUploadedAtMillis)}
              </Text>
            ) : null}
            <Text style={styles.entryDivider}>•</Text>
            <Text style={styles.entryUpdated}>{formatUpdatedAt(entry.updatedAtMillis)}</Text>
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
            {entry.paymentStatus !== "pagado" ? (
              <Pressable
                disabled={saving}
                onPress={() => handleUploadProof(round, entry)}
                style={({ pressed }) => [
                  styles.playerPrimaryButton,
                  saving ? styles.saveButtonDisabled : null,
                  pressed && !saving ? styles.pressedState : null,
                ]}
              >
                <Text style={styles.playerPrimaryButtonText}>
                  {entry.proofUrl ? "Cambiar" : "Subir"}
                </Text>
              </Pressable>
            ) : null}
          </View>
        )}
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
          sex={league?.sexo}
          title={leagueName}
          teamType={league?.teamType}
        >
          <Text style={styles.heroText}>
            {canManage
              ? "Revisa una fecha a la vez, confirma transferencias y actualiza los pagos de cada participante."
              : "Aca podes consultar tus pagos de la liga y enviar el comprobante cuando pagues por transferencia."}
          </Text>
        </LeagueHeaderCard>

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

        {paymentsToRender.map((round) => {
          const isExpanded = expandedRoundIds.includes(round.roundId);
          const roundSummary = getLeaguePaymentRoundSummary(round);
          const roundAmountSummary = getPaymentAmountSummary(round.entries || [], roundPricePerPlayer);
          const roundDateMeta = getPaymentRoundDateMeta(round);

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
                <View style={styles.roundChevronSpacer} />
                <View style={styles.roundHeader}>
                  <View style={styles.roundTitleValueRow}>
                    <Text style={styles.roundTitle}>{String(round.title || "").toUpperCase()}</Text>
                    {roundDateMeta.label ? (
                      <Text
                        style={[
                          styles.roundDatePill,
                          roundDateMeta.reprogrammed ? styles.roundDatePillReprogrammed : null,
                        ]}
                      >
                        {roundDateMeta.label}
                      </Text>
                    ) : null}
                    {roundPriceLabel ? (
                      <Text style={styles.roundPricePill}>{roundPriceLabel}</Text>
                    ) : null}
                  </View>
                  <Text style={styles.roundSchedule}>{round.scheduleLabel}</Text>
                  {round.pendingReprogrammedMatchesCount > 0 ? (
                    <Text style={styles.roundReprogrammedNotice}>
                      {round.pendingReprogrammedMatchesCount} partido(s) reprogramado(s) pendiente(s)
                      no generan deuda todavia.
                    </Text>
                  ) : null}
                </View>
                <Ionicons
                  color={colors.primaryDark}
                  name={isExpanded ? "chevron-up" : "chevron-down"}
                  size={18}
                />
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
                ) : (
                  <View style={[styles.inlineCounter, styles.inlineCounterWarning]}>
                    <Text style={styles.inlineCounterText}>Tu pago de esta fecha</Text>
                  </View>
                )}
              </View>

              {isExpanded ? (
                <View style={styles.entriesWrap}>
                  {canManage && league?.teamType === "pair"
                    ? groupEntriesByPair(round.entries || []).map((group) => (
                        <View key={`${round.roundId}-${group.key}`} style={styles.pairPaymentCard}>
                          <Text style={styles.pairPaymentTitle}>{group.label}</Text>
                          <View style={styles.pairPaymentEntries}>
                            {group.entries.map((entry) => renderPaymentEntryRow(round, entry))}
                          </View>
                        </View>
                      ))
                    : (round.entries || []).map((entry) => {
                    const statusMeta = getStatusMeta(entry.paymentStatus);
                    const methodLabel =
                      entry.paymentStatus === "pagado"
                        ? entry.paymentMethod === "efectivo"
                          ? "Efectivo"
                          : entry.paymentMethod === "cuenta_corriente"
                          ? "Cuenta corriente"
                          : entry.paymentMethod === "transferencia"
                          ? "Transferencia"
                          : "Sin medio"
                        : null;

                    return (
                      <View
                        key={`${round.roundId}-${entry.participantId}`}
                        style={[
                          styles.entryRow,
                          {
                            backgroundColor: statusMeta.tint,
                            borderColor: statusMeta.border,
                          },
                        ]}
                      >
                        <View style={[styles.statusDot, { backgroundColor: statusMeta.accent }]} />

                        <View style={styles.entryCopy}>
                          <Text numberOfLines={1} style={styles.entryName}>
                            {entry.participantLabel}
                          </Text>
                          <View style={styles.entryMetaRow}>
                            {roundPricePerPlayer > 0 ? (
                              <Text style={styles.entryAmountLabel}>{formatCurrency(roundPricePerPlayer)}</Text>
                            ) : null}
                            <Text style={[styles.entryStatusLabel, { color: statusMeta.accent }]}>
                              {statusMeta.label}
                            </Text>
                            {methodLabel ? <Text style={styles.entryDivider}>•</Text> : null}
                            {methodLabel ? <Text style={styles.entryMethod}>{methodLabel}</Text> : null}
                            {entry.proofUrl ? <Text style={styles.entryDivider}>|</Text> : null}
                            {entry.proofUrl ? (
                              <Text style={styles.entryMethod}>
                                Comprobante {formatUpdatedAt(entry.proofUploadedAtMillis)}
                              </Text>
                            ) : null}
                            <Text style={styles.entryDivider}>•</Text>
                            <Text style={styles.entryUpdated}>{formatUpdatedAt(entry.updatedAtMillis)}</Text>
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
                            {entry.paymentStatus !== "pagado" ? (
                              <Pressable
                                disabled={saving}
                                onPress={() => handleUploadProof(round, entry)}
                                style={({ pressed }) => [
                                  styles.playerPrimaryButton,
                                  saving ? styles.saveButtonDisabled : null,
                                  pressed && !saving ? styles.pressedState : null,
                                ]}
                              >
                                <Text style={styles.playerPrimaryButtonText}>
                                  {entry.proofUrl ? "Cambiar" : "Subir"}
                                </Text>
                              </Pressable>
                            ) : null}
                          </View>
                        )}
                      </View>
                    );
                  })}
                  {!canManage ? (
                    <View style={styles.playerPaymentHelpCard}>
                      <Text style={styles.playerPaymentHelpTitle}>Transferencia</Text>
                      <Text style={styles.playerPaymentHelpText}>
                        Selecciona el comprobante de tu galeria. El organizador lo revisa y confirma el pago.
                      </Text>
                      <View style={styles.modalActionDisabled}>
                        <Text style={styles.modalActionDisabledText}>Mercado Pago proximamente</Text>
                      </View>
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
                              item.key === "pending" ? styles.amountSummaryItemDanger : null,
                            ]}
                          >
                            <Text style={styles.amountSummaryLabel}>{item.label}</Text>
                            <Text
                              style={[
                                styles.amountSummaryValue,
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
                    item.key === "pending" ? styles.amountSummaryItemDanger : null,
                  ]}
                >
                  <Text style={styles.amountSummaryLabel}>{item.label}</Text>
                  <Text
                    style={[
                      styles.amountSummaryValue,
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
              <Image
                resizeMode="contain"
                source={{ uri: selectedEntry?.proofUrl }}
                style={styles.proofPreviewImage}
              />
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
                onPress={() => markPaidWithMethod(option.key)}
                style={({ pressed }) => [styles.modalAction, pressed ? styles.pressedState : null]}
              >
                <Text style={styles.modalActionText}>{option.label}</Text>
              </Pressable>
            ))}
            <View style={styles.modalActionDisabled}>
              <Text style={styles.modalActionDisabledText}>Mercado Pago proximamente</Text>
            </View>
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
    padding: spacing.md,
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
    width: 18,
  },
  roundHeader: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  roundTitleValueRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  roundTitle: {
    backgroundColor: "#2D6B8F",
    borderRadius: 8,
    color: colors.surface,
    fontSize: 12,
    fontWeight: "900",
    minHeight: 26,
    overflow: "hidden",
    paddingHorizontal: 9,
    paddingVertical: 4,
    textAlign: "center",
  },
  roundPricePill: {
    color: colors.surface,
    fontSize: 12,
    fontWeight: "900",
    backgroundColor: colors.primaryDark,
    borderRadius: 8,
    overflow: "hidden",
    paddingHorizontal: 9,
    paddingVertical: 4,
    textAlign: "center",
  },
  roundDatePill: {
    color: colors.surface,
    fontSize: 12,
    fontWeight: "900",
    backgroundColor: "#2D6B8F",
    borderRadius: 8,
    minHeight: 26,
    overflow: "hidden",
    paddingHorizontal: 9,
    paddingVertical: 4,
    textAlign: "center",
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
    backgroundColor: "#FFF4F4",
    borderColor: "#E4B8B8",
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
  pairPaymentCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#CFE2D8",
    backgroundColor: "#F5FBF8",
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
  amountSummaryItemDanger: {
    backgroundColor: "#FFF4F4",
    borderColor: "#E4B8B8",
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
  amountSummaryValueDanger: {
    color: "#B24343",
  },
  entryRow: {
    minHeight: 58,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  entryCopy: {
    flex: 1,
    gap: 2,
  },
  entryName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  entryMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 4,
  },
  entryAmountLabel: {
    backgroundColor: colors.primaryDark,
    borderRadius: 8,
    color: colors.surface,
    fontSize: 11,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  entryStatusLabel: {
    fontSize: 11,
    fontWeight: "800",
  },
  entryMethod: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
  },
  entryUpdated: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "600",
  },
  entryDivider: {
    color: colors.textMuted,
    fontSize: 10,
  },
  moreButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "#FFFFFFAA",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  organizerEntryActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  quickProofButton: {
    minHeight: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primaryDark,
    backgroundColor: colors.surface,
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
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  quickPaidButtonPending: {
    backgroundColor: "#D71920",
  },
  quickPaidButtonTransfer: {
    backgroundColor: "#B77905",
  },
  quickPaidButtonPaid: {
    backgroundColor: "#178A45",
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
  playerSecondaryButton: {
    minHeight: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primaryDark,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  playerSecondaryButtonText: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "900",
  },
  playerPaymentHelpCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D7E5DE",
    backgroundColor: "#F3FAF6",
    padding: spacing.sm,
    gap: spacing.xs,
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

