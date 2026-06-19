import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";

import BottomQuickActionsBar, {
  BOTTOM_QUICK_ACTIONS_SPACE,
} from "../components/BottomQuickActionsBar";
import FeedbackModal from "../components/FeedbackModal";
import SectionHeader from "../components/SectionHeader";
import TournamentHeaderCard from "../components/TournamentHeaderCard";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import { sendChatMessage } from "../services/chatService";
import { sendTournamentPaymentReminderPushAsync } from "../services/pushNotificationsService";
import {
  getTournamentById,
  listTournamentRegistrations,
  recordTournamentOrganizerPayment,
  reviewTournamentPayment,
  uploadTournamentPaymentReceipt,
} from "../services/tournamentsService";

const PAYMENT_METHOD_OPTIONS = [
  { key: "efectivo", label: "Efectivo", icon: "cash-outline" },
  { key: "transferencia", label: "Transferencia", icon: "swap-horizontal-outline" },
];

function normalizeText(value = "") {
  return String(value || "").trim().toLowerCase();
}

function formatMoney(value = 0) {
  return Number(value || 0).toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  });
}

function getTournamentPaymentStatusMeta(payment = {}) {
  if (payment.status === "approved" && payment.method === "efectivo") {
    return {
      accent: "#1F7A43",
      background: "#EEF8F1",
      border: "#C5E5CF",
      icon: "checkmark-circle",
      indicatorColor: "#1F7A43",
      label: "Pago en efectivo",
    };
  }

  if (payment.status === "approved" && payment.method === "transferencia") {
    return {
      accent: "#1F7A43",
      background: "#EEF8F1",
      border: "#C5E5CF",
      icon: payment.receiptUrl ? "document-attach-outline" : "checkmark-circle",
      indicatorColor: "#1F7A43",
      label: payment.receiptUrl ? "Transferencia con comprobante" : "Transferencia cargada",
    };
  }

  if (payment.status === "in_review") {
    return {
      accent: "#9B6A00",
      background: "#FFF7E3",
      border: "#E8D59A",
      icon: "time-outline",
      indicatorColor: "#1F7A43",
      label: "Comprobante en revision",
    };
  }

  if (payment.status === "rejected") {
    return {
      accent: "#B24343",
      background: "#FFF1F1",
      border: "#E6C0C0",
      icon: "alert-circle-outline",
      indicatorColor: "#D64545",
      label: "Pago rechazado",
    };
  }

  return {
    accent: "#B24343",
    background: "#FFF1F1",
    border: "#E6C0C0",
    icon: "close-circle-outline",
    indicatorColor: "#D64545",
    label: "Impago",
  };
}

function getTournamentPaymentTableStatusLabel(payment = {}) {
  if (payment.status === "approved" && payment.method === "efectivo") {
    return "Pagado";
  }

  if (payment.status === "approved" && payment.method === "transferencia") {
    return "Pagado";
  }

  if (payment.status === "in_review") {
    return "Pago a\nVerificar";
  }

  if (payment.status === "rejected") {
    return "Impago";
  }

  return "Impago";
}

function normalizePhoneNumber(value = "") {
  return String(value || "").replace(/[^\d]/g, "");
}

function resolveTournamentPlayerPhone(registration = {}, payment = {}, slot = "player1") {
  const paymentPhone = String(
    payment?.phone || payment?.telefono || payment?.whatsapp || ""
  ).trim();

  if (paymentPhone) {
    return paymentPhone;
  }

  const slotData = registration?.[slot];
  const slotPhone = String(
    slotData?.phone ||
      slotData?.telefono ||
      slotData?.celular ||
      slotData?.whatsapp ||
      registration?.[`${slot}Phone`] ||
      registration?.[`${slot}Telefono`] ||
      ""
  ).trim();

  return slotPhone;
}

function buildRegistrationPlayers(registration = {}) {
  const payments = Array.isArray(registration.payments) ? registration.payments : [];
  const paymentByKey = new Map(
    payments.map((payment) => [String(payment.userId || payment.playerId || "").trim(), payment])
  );

  return [
    {
      playerId: registration.player1Id || "player-1",
      playerName: registration.player1Name || "Jugador 1",
      phone: resolveTournamentPlayerPhone(
        registration,
        paymentByKey.get(String(registration.player1Id || "").trim()) ||
          payments.find((entry) => entry.playerName === registration.player1Name) ||
          null,
        "player1"
      ),
      payment:
        paymentByKey.get(String(registration.player1Id || "").trim()) ||
        payments.find((entry) => entry.playerName === registration.player1Name) ||
        null,
    },
    registration.player2Id || registration.player2Name
      ? {
          playerId: registration.player2Id || "player-2",
          playerName: registration.player2Name || "Jugador 2",
          phone: resolveTournamentPlayerPhone(
            registration,
            paymentByKey.get(String(registration.player2Id || "").trim()) ||
              payments.find((entry) => entry.playerName === registration.player2Name) ||
              null,
            "player2"
          ),
          payment:
            paymentByKey.get(String(registration.player2Id || "").trim()) ||
            payments.find((entry) => entry.playerName === registration.player2Name) ||
            null,
        }
      : null,
  ].filter(Boolean);
}

function buildSummary(registrations = []) {
  return registrations.reduce(
    (summary, registration) => {
      buildRegistrationPlayers(registration).forEach((player) => {
        const payment = player.payment || {};
        const amount = Number(payment.amount || 0);

        if (payment.method === "efectivo" && payment.status === "approved") {
          summary.cashCount += 1;
          summary.cashAmount += amount;
        } else if (
          payment.method === "transferencia" &&
          (payment.status === "approved" || payment.status === "in_review")
        ) {
          summary.transferCount += 1;
          summary.transferAmount += amount;
        } else {
          summary.unpaidCount += 1;
          summary.unpaidAmount += amount;
        }
      });

      return summary;
    },
    {
      cashAmount: 0,
      cashCount: 0,
      transferAmount: 0,
      transferCount: 0,
      unpaidAmount: 0,
      unpaidCount: 0,
    }
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

export default function TournamentPaymentsScreen({ navigation, route }) {
  const { userData } = useAuth();
  const tournamentId = route?.params?.tournamentId || "";
  const fallbackTournamentName = route?.params?.tournamentName || "Torneo";
  const focusPlayerId = String(route?.params?.focusPlayerId || "").trim().toLowerCase();
  const focusPlayerName = String(route?.params?.focusPlayerName || "").trim().toLowerCase();
  const [tournament, setTournament] = useState(null);
  const [registrations, setRegistrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [menuVisible, setMenuVisible] = useState(false);
  const [menuTarget, setMenuTarget] = useState(null);
  const [methodPickerVisible, setMethodPickerVisible] = useState(false);
  const [savingKey, setSavingKey] = useState("");
  const [receiptPickerVisible, setReceiptPickerVisible] = useState(false);
  const [receiptPickerTarget, setReceiptPickerTarget] = useState(null);
  const [feedback, setFeedback] = useState({
    visible: false,
    title: "",
    message: "",
    tone: "default",
  });

  const loadTournamentPayments = useCallback(async () => {
    const [nextTournament, nextRegistrations] = await Promise.all([
      getTournamentById(tournamentId),
      listTournamentRegistrations(tournamentId),
    ]);

    setTournament(nextTournament);
    setRegistrations(
      nextRegistrations.filter((registration) => registration.withdrawalStatus !== "confirmed")
    );
  }, [tournamentId]);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      const load = async () => {
        try {
          setLoading(true);
          await loadTournamentPayments();
        } catch (error) {
          if (!isMounted) {
            return;
          }

          setFeedback({
            visible: true,
            title: "No pudimos cargar los pagos",
            message: error?.message || "Intenta nuevamente en unos instantes.",
            tone: "danger",
          });
        } finally {
          if (isMounted) {
            setLoading(false);
          }
        }
      };

      load();

      return () => {
        isMounted = false;
      };
    }, [loadTournamentPayments])
  );

  const organizerId = userData?.uid || userData?.id || "";
  const canManage =
    normalizeText(tournament?.organizerId) === normalizeText(organizerId) && Boolean(organizerId);
  const summary = useMemo(() => buildSummary(registrations), [registrations]);
  const paymentRows = useMemo(
    () =>
      registrations.flatMap((registration, index) =>
        buildRegistrationPlayers(registration).map((player) => {
          const payment = player.payment || {
            amount: Number(tournament?.entryFee || 0),
            method: "",
            playerId: player.playerId,
            playerName: player.playerName,
            receiptUrl: "",
            status: "pending",
            userId: player.playerId,
          };

          return {
            index,
            payment,
            player,
            registration,
          };
        })
      ),
    [registrations, tournament?.entryFee]
  );

  const showFeedback = (title, message, tone = "default") => {
    setFeedback({
      visible: true,
      title,
      message,
      tone,
    });
  };

  const closeReceiptPicker = () => {
    setReceiptPickerVisible(false);
    setReceiptPickerTarget(null);
  };

  const closeMenu = () => {
    setMenuVisible(false);
    setMenuTarget(null);
  };

  const openMenu = (target) => {
    setMenuTarget(target);
    setMenuVisible(true);
  };

  const openMethodPicker = (target) => {
    setMenuTarget(target);
    setMenuVisible(false);
    setMethodPickerVisible(true);
  };

  const closeMethodPicker = () => {
    setMethodPickerVisible(false);
  };

  const dismissMethodPicker = () => {
    setMethodPickerVisible(false);
    setMenuTarget(null);
  };

  const handlePickMethod = async (registration, payment, method) => {
    const actionKey = `${registration.id}-${payment.playerId || payment.userId}-${method}`;

    try {
      setSavingKey(actionKey);
      await recordTournamentOrganizerPayment({
        tournamentId,
        registrationId: registration.id,
        playerId: payment.playerId || payment.userId,
        organizerId,
        organizerName: userData?.name || "Organizador",
        method,
      });
      await loadTournamentPayments();
      showFeedback("Pago actualizado", "El pago del jugador quedo cargado correctamente.", "success");
    } catch (error) {
      showFeedback(
        "No pudimos guardar el pago",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setSavingKey("");
    }
  };

  const handleMarkPending = async () => {
    if (!menuTarget?.registration || !menuTarget?.payment) {
      return;
    }

    const { payment, registration } = menuTarget;
    const actionKey = `${registration.id}-${payment.playerId || payment.userId}-pending`;

    try {
      setSavingKey(actionKey);
      await recordTournamentOrganizerPayment({
        tournamentId,
        registrationId: registration.id,
        playerId: payment.playerId || payment.userId,
        organizerId,
        organizerName: userData?.name || "Organizador",
        method: "",
      });
      await loadTournamentPayments();
      closeMenu();
      showFeedback("Pago actualizado", "El jugador quedo marcado como impago.", "success");
    } catch (error) {
      showFeedback(
        "No pudimos actualizar el pago",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setSavingKey("");
    }
  };

  const handleSendInternalReminder = async () => {
    if (!menuTarget?.registration || !menuTarget?.payment || !menuTarget?.player?.playerName) {
      return;
    }

    const playerUserId = String(menuTarget.payment.userId || "").trim();

    if (!playerUserId) {
      showFeedback(
        "Sin usuario vinculado",
        "Este jugador no tiene usuario vinculado para recibir mensajes internos.",
        "danger"
      );
      return;
    }

    const actionKey = `${menuTarget.registration.id}-${playerUserId}-internal-reminder`;

    try {
      setSavingKey(actionKey);
      await sendChatMessage({
        currentUserId: organizerId,
        currentUserName: userData?.name || "Organizador",
        otherUserId: playerUserId,
        otherUserName: menuTarget.player.playerName,
        text: `Hola ${menuTarget.player.playerName}. Te recordamos que sigue pendiente el pago de tu inscripcion en ${tournament?.name || "Torneo"}.`,
      });

      try {
        await sendTournamentPaymentReminderPushAsync({
          playerUserId,
          registrationId: menuTarget.registration.id,
          tournamentId,
          tournamentName: tournament?.name || fallbackTournamentName,
        });
      } catch (pushError) {
        console.log(
          "[TournamentPaymentsScreen] No se pudo enviar push torneo:",
          pushError?.message || pushError
        );
      }

      closeMenu();
      showFeedback(
        "Recordatorio enviado",
        `Se envio el recordatorio a ${menuTarget.player.playerName}.`,
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
      setSavingKey("");
    }
  };

  const handleOpenWhatsAppReminder = async () => {
    if (!menuTarget?.player?.playerName) {
      return;
    }

    const normalizedPhone = normalizePhoneNumber(menuTarget?.player?.phone || "");

    if (!normalizedPhone) {
      return;
    }

    const message = `Hola ${menuTarget.player.playerName}. Te escribimos desde ${tournament?.name || "Torneo"} para ponernos en contacto por tu pago de inscripcion.`;
    const url = `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`;

    try {
      const supported = await Linking.canOpenURL(url);

      if (!supported) {
        showFeedback(
          "WhatsApp no disponible",
          "No pudimos abrir WhatsApp en este dispositivo.",
          "danger"
        );
        return;
      }

      await Linking.openURL(url);
      closeMenu();
    } catch (error) {
      showFeedback(
        "No pudimos abrir WhatsApp",
        "Intenta nuevamente en unos instantes.",
        "danger"
      );
    }
  };

  const uploadReceiptAsset = async (registration, payment, asset = {}) => {
    if (!registration || !payment || !asset?.uri) {
      return;
    }

    const actionKey = `${registration.id}-${payment.playerId || payment.userId}-receipt`;

    try {
      setSavingKey(actionKey);
      await uploadTournamentPaymentReceipt({
        tournamentId,
        registrationId: registration.id,
        playerId: payment.playerId || payment.userId,
        receiptUri: asset.uri,
        fileName: asset.fileName || asset.name || `comprobante-${Date.now()}.jpg`,
        method: "transferencia",
        uploadedBy: organizerId,
        uploadedByName: userData?.name || "Organizador",
      });
      await reviewTournamentPayment({
        tournamentId,
        registrationId: registration.id,
        playerId: payment.playerId || payment.userId,
        reviewerId: organizerId,
        reviewerName: userData?.name || "Organizador",
        approved: true,
      });
      await loadTournamentPayments();
      showFeedback(
        "Comprobante cargado",
        "El comprobante quedo asociado al jugador y el pago ya figura aprobado.",
        "success"
      );
    } catch (error) {
      showFeedback(
        "No pudimos subir el comprobante",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setSavingKey("");
    }
  };

  const openReceiptPicker = (registration, payment) => {
    setReceiptPickerTarget({ payment, registration });
    setReceiptPickerVisible(true);
    setMethodPickerVisible(false);
    closeMenu();
  };

  const handlePickReceiptFromGallery = async () => {
    const target = receiptPickerTarget || menuTarget;
    if (!target?.registration || !target?.payment) {
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (permission.status !== "granted") {
      showFeedback(
        "Permiso necesario",
        "Necesitamos acceso a tus fotos para adjuntar el comprobante.",
        "danger"
      );
      return;
    }

    const pickerResult = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });

    if (pickerResult.canceled) {
      return;
    }

    const asset = pickerResult.assets?.[0];

    if (!asset?.uri) {
      return;
    }

    closeReceiptPicker();
    closeMethodPicker();
    await uploadReceiptAsset(target.registration, target.payment, asset);
  };

  const handlePickReceiptFromCamera = async () => {
    const target = receiptPickerTarget || menuTarget;
    if (!target?.registration || !target?.payment) {
      return;
    }

    const permission = await ImagePicker.requestCameraPermissionsAsync();

    if (permission.status !== "granted") {
      showFeedback(
        "Permiso necesario",
        "Necesitamos acceso a la camara para fotografiar el comprobante.",
        "danger"
      );
      return;
    }

    const cameraResult = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      cameraType: ImagePicker.CameraType.back,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });

    if (cameraResult.canceled) {
      return;
    }

    const asset = cameraResult.assets?.[0];

    if (!asset?.uri) {
      return;
    }

    closeReceiptPicker();
    closeMethodPicker();
    await uploadReceiptAsset(target.registration, target.payment, asset);
  };

  const handlePickReceiptPdf = async () => {
    const target = receiptPickerTarget || menuTarget;
    if (!target?.registration || !target?.payment) {
      return;
    }

    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: "application/pdf",
    });

    if (result.canceled || !result.assets?.length) {
      return;
    }

    const asset = result.assets[0];

    if (!asset?.uri) {
      return;
    }

    closeReceiptPicker();
    closeMethodPicker();
    await uploadReceiptAsset(target.registration, target.payment, asset);
  };

  const handlePickMethodFromModal = async (method) => {
    if (!menuTarget?.registration || !menuTarget?.payment) {
      return;
    }

    closeMethodPicker();
    await handlePickMethod(menuTarget.registration, menuTarget.payment, method);
    closeMenu();
  };

  const handleOpenReceipt = async (receiptUrl) => {
    if (!receiptUrl) {
      return;
    }

    try {
      await Linking.openURL(receiptUrl);
    } catch (error) {
      showFeedback(
        "No pudimos abrir el comprobante",
        "Intenta nuevamente en unos instantes.",
        "danger"
      );
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader onBack={() => navigation.goBack()} subtitle="Pagos torneo" />

      <View style={styles.container}>
        {loading ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator color={colors.primaryDark} />
            <Text style={styles.loaderText}>Cargando pagos...</Text>
          </View>
        ) : tournament ? (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
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
              title={tournament?.name || fallbackTournamentName}
              titleColorSeed={[tournament?.creationBatchId, tournament?.name]
                .map((value) => String(value || "").trim())
                .filter(Boolean)
                .join(":")}
            />

            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>RESUMEN DE PAGOS</Text>
                <View style={styles.summaryGrid}>
                  <View style={styles.summaryItem}>
                    <Text style={styles.summaryLabel}>Efectivo</Text>
                    <Text style={[styles.summaryValue, styles.summaryValueSuccess]}>
                      {summary.cashCount}
                    </Text>
                    <Text style={styles.summaryAmount}>{formatMoney(summary.cashAmount)}</Text>
                  </View>
                  <View style={styles.summaryItem}>
                    <Text style={styles.summaryLabel}>Transferencia</Text>
                    <Text style={[styles.summaryValue, styles.summaryValueInfo]}>
                      {summary.transferCount}
                    </Text>
                    <Text style={styles.summaryAmount}>{formatMoney(summary.transferAmount)}</Text>
                  </View>
                  <View style={styles.summaryItem}>
                    <Text style={styles.summaryLabel}>Impagos</Text>
                    <Text style={[styles.summaryValue, styles.summaryValueMuted]}>
                      {summary.unpaidCount}
                    </Text>
                    <Text style={styles.summaryAmount}>{formatMoney(summary.unpaidAmount)}</Text>
                  </View>
                </View>
              </View>

            {!canManage ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>Acceso solo para organizador</Text>
                <Text style={styles.emptyText}>
                  Esta vista de pagos esta reservada para quien organiza el torneo.
                </Text>
              </View>
            ) : paymentRows.length ? (
              <View style={styles.paymentTableCard}>
                <Text style={styles.paymentTableTitle}>PAGOS DEL TORNEO</Text>
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

                {paymentRows.map(({ index, payment, player, registration }) => {
                  const paymentStatusMeta = getTournamentPaymentStatusMeta(payment);
                  const paymentTableStatusLabel = getTournamentPaymentTableStatusLabel(payment);
                  const paymentKey = `${registration.id}-${payment.playerId || payment.userId}`;
                  const isSaving = savingKey.startsWith(paymentKey);
                  const isFocused =
                    (!!focusPlayerId &&
                      [payment.playerId, payment.userId, player.playerId]
                        .filter(Boolean)
                        .some((value) => String(value).trim().toLowerCase() === focusPlayerId)) ||
                    (!!focusPlayerName &&
                      String(player.playerName || "").trim().toLowerCase() === focusPlayerName);

                  return (
                    <View
                      key={paymentKey}
                      style={[styles.paymentTableRow, isFocused ? styles.focusedPaymentTableRow : null]}
                    >
                      <View style={styles.paymentTablePlayerCell}>
                        <Text numberOfLines={1} style={styles.paymentTablePairLabel}>
                          {`PAREJA ${index + 1}`}
                        </Text>
                        <Text numberOfLines={1} style={styles.paymentTablePlayerName}>
                          {formatCompactPlayerName(player.playerName)}
                        </Text>
                      </View>

                      <View style={styles.paymentTableStatusCell}>
                        <Text
                          numberOfLines={2}
                          style={[styles.paymentTableStatusText, { color: paymentStatusMeta.accent }]}
                        >
                          {paymentTableStatusLabel}
                        </Text>
                      </View>

                      <View style={styles.paymentTableMethodCell}>
                        <Text numberOfLines={2} style={styles.paymentTableMethodText}>
                          {payment.method === "efectivo"
                            ? "Efec."
                            : payment.method === "transferencia"
                              ? "Transf."
                              : "-"}
                        </Text>
                      </View>

                      <View style={styles.paymentTableProofCell}>
                        {payment.receiptUrl ? (
                          <Pressable
                            onPress={() => handleOpenReceipt(payment.receiptUrl)}
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
                          {payment.amount > 0 ? formatMoney(payment.amount) : "-"}
                        </Text>
                      </View>

                      <View style={styles.paymentTableActionsCell}>
                        <View style={styles.paymentTableActionsRow}>
                          <Pressable
                            onPress={() => openMethodPicker({ payment, player, registration })}
                            style={({ pressed }) => [
                              styles.paymentTableActionButton,
                              payment.status === "approved" && payment.method === "efectivo"
                                ? styles.quickPaidButtonPaid
                                : payment.status === "approved" && payment.method === "transferencia"
                                  ? styles.quickPaidButtonTransfer
                                  : styles.quickPaidButtonPending,
                              pressed ? styles.pressedState : null,
                            ]}
                          >
                            <Ionicons color={colors.surface} name="cash-outline" size={14} />
                          </Pressable>
                          <Pressable
                            onPress={() => openMenu({ payment, player, registration })}
                            style={({ pressed }) => [
                              styles.paymentTableMenuButton,
                              pressed ? styles.pressedState : null,
                            ]}
                          >
                            <Ionicons color={colors.text} name="ellipsis-vertical" size={16} />
                          </Pressable>
                        </View>
                        {isSaving ? (
                          <View style={styles.tableInlineSavingWrap}>
                            <ActivityIndicator color={colors.primaryDark} size="small" />
                          </View>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>Todavia no hay parejas inscriptas</Text>
                <Text style={styles.emptyText}>
                  Cuando lleguen parejas al torneo, las vas a poder gestionar desde aca.
                </Text>
              </View>
            )}
          </ScrollView>
        ) : (
          <View style={styles.loaderWrap}>
            <Text style={styles.loaderText}>No encontramos el torneo.</Text>
          </View>
        )}
      </View>

      <BottomQuickActionsBar />

      <Modal
        animationType="fade"
        transparent
        visible={menuVisible && Boolean(menuTarget)}
        onRequestClose={closeMenu}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={closeMenu} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{menuTarget?.player?.playerName || "Opciones"}</Text>
            <Text style={styles.modalSubtitle}>
              Actualiza el estado o envia un recordatorio rapido.
            </Text>

            {menuTarget?.payment?.receiptUrl ? (
              <Pressable
                onPress={() => handleOpenReceipt(menuTarget?.payment?.receiptUrl)}
                style={({ pressed }) => [styles.modalAction, pressed ? styles.pressedState : null]}
              >
                <Text style={styles.modalActionText}>Ver comprobante</Text>
              </Pressable>
            ) : null}

            <Pressable
              disabled={!normalizePhoneNumber(menuTarget?.player?.phone || "")}
              onPress={handleOpenWhatsAppReminder}
              style={({ pressed }) => [
                styles.modalAction,
                !normalizePhoneNumber(menuTarget?.player?.phone || "")
                  ? styles.modalActionDisabled
                  : null,
                pressed && normalizePhoneNumber(menuTarget?.player?.phone || "")
                  ? styles.pressedState
                  : null,
              ]}
            >
              <Text
                style={[
                  styles.modalActionText,
                  !normalizePhoneNumber(menuTarget?.player?.phone || "")
                    ? styles.modalActionDisabledText
                    : null,
                ]}
              >
                Enviar por WhatsApp
              </Text>
            </Pressable>

            <Pressable
              onPress={handleSendInternalReminder}
              style={({ pressed }) => [styles.modalAction, pressed ? styles.pressedState : null]}
            >
              <Text style={styles.modalActionText}>Enviar por mensajeria interna</Text>
            </Pressable>

            <Pressable
              onPress={handleMarkPending}
              style={({ pressed }) => [styles.modalActionDanger, pressed ? styles.pressedState : null]}
            >
              <Text style={styles.modalActionDangerText}>Marcar impago</Text>
            </Pressable>

            <Pressable
              onPress={closeMenu}
              style={({ pressed }) => [styles.modalSecondaryButton, pressed ? styles.pressedState : null]}
            >
              <Text style={styles.modalSecondaryButtonText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={methodPickerVisible}
        onRequestClose={dismissMethodPicker}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={dismissMethodPicker} />
          <View style={styles.modalCardSmall}>
            <Text style={styles.modalTitle}>Marcar como pagado</Text>
            <Text style={styles.modalSubtitle}>
              Elige el metodo y, si es transferencia, puedes cargar el comprobante ahora mismo.
            </Text>

            <Pressable
              onPress={() => handlePickMethodFromModal("efectivo")}
              style={({ pressed }) => [styles.modalAction, pressed ? styles.pressedState : null]}
            >
              <Text style={styles.modalActionText}>Efectivo</Text>
            </Pressable>

            <Pressable
              onPress={() => handlePickMethodFromModal("transferencia")}
              style={({ pressed }) => [styles.modalAction, pressed ? styles.pressedState : null]}
            >
              <Text style={styles.modalActionText}>Transferencia sin comprobante</Text>
            </Pressable>

            <Pressable
              onPress={handlePickReceiptFromGallery}
              style={({ pressed }) => [styles.modalAction, pressed ? styles.pressedState : null]}
            >
              <Text style={styles.modalActionText}>Imagen</Text>
            </Pressable>

            <Pressable
              onPress={handlePickReceiptPdf}
              style={({ pressed }) => [styles.modalAction, pressed ? styles.pressedState : null]}
            >
              <Text style={styles.modalActionText}>PDF</Text>
            </Pressable>

            <Pressable
              onPress={handlePickReceiptFromCamera}
              style={({ pressed }) => [styles.modalAction, pressed ? styles.pressedState : null]}
            >
              <Text style={styles.modalActionText}>Usar camara</Text>
            </Pressable>

            <Pressable
              onPress={dismissMethodPicker}
              style={({ pressed }) => [styles.modalSecondaryButton, pressed ? styles.pressedState : null]}
            >
              <Text style={styles.modalSecondaryButtonText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

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

      <Modal
        animationType="fade"
        transparent
        visible={receiptPickerVisible}
        onRequestClose={closeReceiptPicker}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={closeReceiptPicker} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Adjuntar comprobante</Text>
            <Text style={styles.modalSubtitle}>
              Puedes subir una imagen, un PDF o sacar una foto en el momento.
            </Text>

            <Pressable
              onPress={handlePickReceiptFromGallery}
              style={({ pressed }) => [styles.modalAction, pressed ? styles.pressedState : null]}
            >
              <Ionicons color={colors.primaryDark} name="image-outline" size={18} />
              <Text style={styles.modalActionText}>Imagen</Text>
            </Pressable>

            <Pressable
              onPress={handlePickReceiptPdf}
              style={({ pressed }) => [styles.modalAction, pressed ? styles.pressedState : null]}
            >
              <Ionicons color={colors.primaryDark} name="document-text-outline" size={18} />
              <Text style={styles.modalActionText}>PDF</Text>
            </Pressable>

            <Pressable
              onPress={handlePickReceiptFromCamera}
              style={({ pressed }) => [styles.modalAction, pressed ? styles.pressedState : null]}
            >
              <Ionicons color={colors.primaryDark} name="camera-outline" size={18} />
              <Text style={styles.modalActionText}>Usar camara</Text>
            </Pressable>

            <Pressable
              onPress={closeReceiptPicker}
              style={({ pressed }) => [
                styles.modalSecondaryButton,
                pressed ? styles.pressedState : null,
              ]}
            >
              <Text style={styles.modalSecondaryButtonText}>Cancelar</Text>
            </Pressable>
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
  container: {
    flex: 1,
  },
  loaderWrap: {
    flex: 1,
    alignItems: "center",
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
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: BOTTOM_QUICK_ACTIONS_SPACE + spacing.lg,
    gap: spacing.md,
  },
  summaryCard: {
    backgroundColor: "#F4FAF7",
    borderColor: "#D7E8DF",
    borderRadius: 22,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.sm,
  },
  summaryTitle: {
    color: colors.primaryDark,
    fontSize: 15,
    fontWeight: "900",
    textAlign: "center",
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "center",
  },
  summaryItem: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: "#D7E8DF",
    borderRadius: 14,
    borderWidth: 1,
    minWidth: "30%",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  summaryLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
  },
  summaryValue: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900",
    marginTop: 4,
    textAlign: "center",
  },
  summaryValueSuccess: {
    color: "#1F7A43",
  },
  summaryValueMuted: {
    color: "#6B7280",
  },
  summaryValueInfo: {
    color: "#1E5C89",
  },
  summaryAmount: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 4,
    textAlign: "center",
  },
  paymentTableCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 6,
    paddingTop: 8,
    paddingBottom: 4,
    overflow: "hidden",
  },
  paymentTableTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
    marginBottom: spacing.xs,
  },
  paymentTableHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 3,
    paddingRight: 4,
    paddingBottom: spacing.xs,
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
    minHeight: 52,
    paddingLeft: 3,
    paddingRight: 4,
    paddingVertical: 6,
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
  paymentTableMutedText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "700",
    textAlign: "center",
  },
  tableInlineSavingWrap: {
    marginTop: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  quickPaidButtonPending: {
    backgroundColor: "#D26A2C",
  },
  quickPaidButtonTransfer: {
    backgroundColor: "#237547",
  },
  quickPaidButtonPaid: {
    backgroundColor: "#237547",
  },
  pairCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.sm,
  },
  pairHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  pairTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  playerCard: {
    backgroundColor: "#F8FBF9",
    borderColor: "#DFEAE4",
    borderRadius: 18,
    borderWidth: 1,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  focusedPlayerCard: {
    backgroundColor: "#F1FAF5",
    borderColor: "#8BCDB0",
  },
  playerHeader: {
    gap: spacing.sm,
    alignItems: "stretch",
  },
  playerIdentityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: spacing.xs,
    width: "100%",
  },
  playerIdentityMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    flex: 1,
    minWidth: 0,
  },
  playerLed: {
    width: 10,
    height: 10,
    borderRadius: 999,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 2,
  },
  playerCopy: {
    alignItems: "flex-start",
    flexShrink: 1,
    minWidth: 0,
  },
  playerName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
    textAlign: "left",
  },
  playerAmount: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "left",
    marginLeft: 4,
  },
  playerStatusWrap: {
    alignItems: "center",
  },
  paymentStatusChip: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  paymentStatusText: {
    fontSize: 11,
    fontWeight: "900",
  },
  paymentActionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    justifyContent: "center",
  },
  methodChip: {
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#D6E1E8",
    backgroundColor: "#F8FBFD",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
  },
  methodChipActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  methodChipText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
  },
  methodChipTextActive: {
    color: colors.surface,
  },
  transferWrap: {
    gap: spacing.xs,
  },
  receiptButton: {
    alignSelf: "flex-start",
    minHeight: 36,
    borderRadius: 12,
    backgroundColor: colors.surface,
    borderColor: "#C9D8E3",
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: spacing.sm,
  },
  receiptButtonText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
  },
  receiptHintText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 18,
  },
  receiptLinkRow: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 6,
  },
  receiptLinkText: {
    color: "#1E5C89",
    fontSize: 12,
    fontWeight: "800",
  },
  inlineSavingRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  inlineSavingText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900",
    textAlign: "center",
  },
  emptyText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 20,
    textAlign: "center",
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.32)",
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#DCE7E0",
    padding: spacing.lg,
    gap: spacing.sm,
  },
  modalCardSmall: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#DCE7E0",
    padding: spacing.lg,
    gap: spacing.sm,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
  },
  modalSubtitle: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
    textAlign: "center",
  },
  modalAction: {
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D6E1D9",
    backgroundColor: "#F7FBF8",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: spacing.md,
  },
  modalActionText: {
    color: colors.primaryDark,
    fontSize: 14,
    fontWeight: "800",
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
    backgroundColor: "#F4F6F5",
    borderColor: "#D8DFDB",
  },
  modalActionDisabledText: {
    color: "#98A39D",
  },
  modalSecondaryButton: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#D7E2DB",
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  modalSecondaryButtonText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "800",
  },
  pressedState: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
});
