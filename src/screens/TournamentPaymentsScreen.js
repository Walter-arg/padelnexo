import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
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
      accent: "#1E5C89",
      background: "#EFF6FC",
      border: "#C7DCF1",
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

function buildRegistrationPlayers(registration = {}) {
  const payments = Array.isArray(registration.payments) ? registration.payments : [];
  const paymentByKey = new Map(
    payments.map((payment) => [String(payment.userId || payment.playerId || "").trim(), payment])
  );

  return [
    {
      playerId: registration.player1Id || "player-1",
      playerName: registration.player1Name || "Jugador 1",
      payment:
        paymentByKey.get(String(registration.player1Id || "").trim()) ||
        payments.find((entry) => entry.playerName === registration.player1Name) ||
        null,
    },
    registration.player2Id || registration.player2Name
      ? {
          playerId: registration.player2Id || "player-2",
          playerName: registration.player2Name || "Jugador 2",
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

export default function TournamentPaymentsScreen({ navigation, route }) {
  const { userData } = useAuth();
  const tournamentId = route?.params?.tournamentId || "";
  const fallbackTournamentName = route?.params?.tournamentName || "Torneo";
  const [tournament, setTournament] = useState(null);
  const [registrations, setRegistrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState("");
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

  const showFeedback = (title, message, tone = "default") => {
    setFeedback({
      visible: true,
      title,
      message,
      tone,
    });
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

  const handleUploadReceipt = async (registration, payment) => {
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

    const actionKey = `${registration.id}-${payment.playerId || payment.userId}-receipt`;

    try {
      setSavingKey(actionKey);
      await uploadTournamentPaymentReceipt({
        tournamentId,
        registrationId: registration.id,
        playerId: payment.playerId || payment.userId,
        receiptUri: asset.uri,
        fileName: asset.fileName || `comprobante-${Date.now()}.jpg`,
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
            ) : registrations.length ? (
              registrations.map((registration, index) => {
                const pairPlayers = buildRegistrationPlayers(registration);

                return (
                  <View key={registration.id} style={styles.pairCard}>
                    <View style={styles.pairHeader}>
                      <Text style={styles.pairTitle}>{`PAREJA ${index + 1}`}</Text>
                    </View>

                    {pairPlayers.map((player) => {
                      const payment = player.payment || {
                        amount: Number(tournament?.entryFee || 0),
                        method: "",
                        playerId: player.playerId,
                        playerName: player.playerName,
                        receiptUrl: "",
                        status: "pending",
                        userId: player.playerId,
                      };
                      const paymentStatusMeta = getTournamentPaymentStatusMeta(payment);
                      const paymentKey = `${registration.id}-${payment.playerId || payment.userId}`;
                      const isSaving = savingKey.startsWith(paymentKey);

                      return (
                        <View key={paymentKey} style={styles.playerCard}>
                          <View style={styles.playerHeader}>
                            <View style={styles.playerIdentityRow}>
                              <View style={styles.playerIdentityMain}>
                                <View
                                  style={[
                                    styles.playerLed,
                                    { backgroundColor: paymentStatusMeta.indicatorColor },
                                  ]}
                                />
                                <View style={styles.playerCopy}>
                                  <Text style={styles.playerName}>{player.playerName}</Text>
                                </View>
                              </View>
                              <Text style={styles.playerAmount}>
                                {payment.amount > 0
                                  ? formatMoney(payment.amount)
                                  : "Sin monto configurado"}
                              </Text>
                            </View>

                            <View style={styles.playerStatusWrap}>
                              <View
                                style={[
                                  styles.paymentStatusChip,
                                  {
                                    backgroundColor: paymentStatusMeta.background,
                                    borderColor: paymentStatusMeta.border,
                                  },
                                ]}
                              >
                                <Ionicons
                                  color={paymentStatusMeta.accent}
                                  name={paymentStatusMeta.icon}
                                  size={14}
                                />
                                <Text
                                  style={[
                                    styles.paymentStatusText,
                                    { color: paymentStatusMeta.accent },
                                  ]}
                                >
                                  {paymentStatusMeta.label}
                                </Text>
                              </View>
                            </View>
                          </View>

                          <View style={styles.paymentActionsRow}>
                            {PAYMENT_METHOD_OPTIONS.map((option) => {
                              const isActive = payment.method === option.key;

                              return (
                                <Pressable
                                  key={option.key}
                                  onPress={() => handlePickMethod(registration, payment, option.key)}
                                  style={({ pressed }) => [
                                    styles.methodChip,
                                    isActive && styles.methodChipActive,
                                    pressed ? styles.pressedState : null,
                                  ]}
                                >
                                  <Ionicons
                                    color={isActive ? colors.surface : colors.primaryDark}
                                    name={option.icon}
                                    size={15}
                                  />
                                  <Text
                                    style={[
                                      styles.methodChipText,
                                      isActive && styles.methodChipTextActive,
                                    ]}
                                  >
                                    {option.label}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>

                          {payment.method === "transferencia" ? (
                            <View style={styles.transferWrap}>
                              <Pressable
                                onPress={() => handleUploadReceipt(registration, payment)}
                                style={({ pressed }) => [
                                  styles.receiptButton,
                                  pressed ? styles.pressedState : null,
                                ]}
                              >
                                <Ionicons
                                  color={colors.primaryDark}
                                  name="document-attach-outline"
                                  size={16}
                                />
                                <Text style={styles.receiptButtonText}>
                                  {payment.receiptUrl
                                    ? "Cambiar comprobante"
                                    : "Cargar comprobante"}
                                </Text>
                              </Pressable>

                              {payment.receiptUrl ? (
                                <Pressable
                                  onPress={() => handleOpenReceipt(payment.receiptUrl)}
                                  style={({ pressed }) => [
                                    styles.receiptLinkRow,
                                    pressed ? styles.pressedState : null,
                                  ]}
                                >
                                  <Ionicons color="#1E5C89" name="open-outline" size={15} />
                                  <Text style={styles.receiptLinkText}>Ver comprobante</Text>
                                </Pressable>
                              ) : (
                                <Text style={styles.receiptHintText}>
                                  El comprobante es opcional cuando carga el organizador.
                                </Text>
                              )}
                            </View>
                          ) : null}

                          {isSaving ? (
                            <View style={styles.inlineSavingRow}>
                              <ActivityIndicator color={colors.primaryDark} size="small" />
                              <Text style={styles.inlineSavingText}>Guardando...</Text>
                            </View>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                );
              })
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
  pressedState: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
});
