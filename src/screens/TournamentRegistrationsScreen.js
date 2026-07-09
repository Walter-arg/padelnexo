import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
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
import { listPlayers } from "../services/playersService";
import { buildTournamentDayOptions, getTournamentAvailabilitySummaryItems } from "../services/tournamentAvailabilityService";
import {
  confirmTournamentRegistrationWithdrawal,
  confirmTournamentRegistration,
  deleteTournamentRegistration,
  getTournamentById,
  listTournamentRegistrations,
} from "../services/tournamentsService";
import { hasProfileImage } from "../utils/defaultProfileImage";

function getRegistrationStatusLabel(status = "") {
  if (status === "confirmed") {
    return "Confirmada";
  }

  if (status === "in_review") {
    return "En revision";
  }

  if (status === "rejected") {
    return "Rechazada";
  }

  return "Pendiente";
}

function buildAvailabilityMeta(items = []) {
  return items.length
    ? {
        icon: "checkmark-circle",
        label: "Disponibilidad cargada",
        tone: "ready",
      }
    : {
        icon: "time-outline",
        label: "Disponibilidad pendiente",
        tone: "pending",
      };
}

function getOrganizerRegistrationStatusMeta(registration = {}) {
  if (registration.withdrawalStatus === "confirmed") {
    return {
      label: "BAJA CONFIRMADA",
      style: styles.registrationStatusWithdrawn,
    };
  }

  if (registration.withdrawalStatus === "requested") {
    return {
      label: "BAJA SOLICITADA",
      style: styles.registrationStatusWithdrawalRequested,
    };
  }

  return {
    label: registration.status === "confirmed" ? "CONFIRMADA" : "PENDIENTE DE CONFIRMAR",
    style:
      registration.status === "confirmed"
        ? styles.registrationStatusConfirmed
        : styles.registrationStatusPending,
  };
}

export default function TournamentRegistrationsScreen({ navigation, route }) {
  const { user, userData } = useAuth();
  const tournamentId = route?.params?.tournamentId || "";
  const fallbackTournamentName = route?.params?.tournamentName || "Torneo";
  const [tournament, setTournament] = useState(null);
  const [registrations, setRegistrations] = useState([]);
  const [playersDirectory, setPlayersDirectory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [runningActionKey, setRunningActionKey] = useState("");
  const [feedback, setFeedback] = useState({
    visible: false,
    title: "",
    message: "",
    tone: "default",
  });
  const [registrationToDelete, setRegistrationToDelete] = useState(null);
  const currentOrganizer = useMemo(
    () => ({
      uid: userData?.uid || user?.uid || "",
      name: userData?.name || user?.displayName || "Organizador",
    }),
    [user?.displayName, user?.uid, userData]
  );

  const loadScreen = useCallback(async () => {
    const [tournamentResponse, registrationsResponse, playersResponse] = await Promise.all([
      getTournamentById(tournamentId),
      listTournamentRegistrations(tournamentId),
      listPlayers(),
    ]);

    setTournament(tournamentResponse);
    setRegistrations(registrationsResponse);
    setPlayersDirectory(playersResponse);
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
            title: "No pudimos cargar las inscripciones",
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

  const tournamentDayOptions = useMemo(() => buildTournamentDayOptions(tournament), [tournament]);
  const playersMap = useMemo(
    () =>
      playersDirectory.reduce((accumulator, player) => {
        accumulator[player.id] = player;
        return accumulator;
      }, {}),
    [playersDirectory]
  );

  const handleConfirmRegistration = async (registration) => {
    try {
      setRunningActionKey(`confirm-${registration.id}`);
      await confirmTournamentRegistration({
        force: true,
        organizerId: currentOrganizer.uid,
        organizerName: currentOrganizer.name,
        registrationId: registration.id,
        tournamentId,
      });
      await Promise.all(
        [
          { id: registration.player1Id, name: registration.player1Name },
          { id: registration.player2Id, name: registration.player2Name },
        ]
          .filter((player) => player.id)
          .map((player) =>
            sendChatMessage({
              currentUserId: currentOrganizer.uid,
              currentUserName: currentOrganizer.name,
              otherUserId: player.id,
              otherUserName: player.name || "Jugador",
              text: `Tu inscripcion al torneo ${
                tournament?.name || fallbackTournamentName
              } fue confirmada por el organizador.`,
            }).catch(() => null)
          )
      );
      await loadScreen();
      setFeedback({
        visible: true,
        title: "Pareja confirmada",
        message: "La pareja quedo confirmada dentro del torneo.",
        tone: "success",
      });
    } catch (error) {
      setFeedback({
        visible: true,
        title: "No pudimos confirmar la pareja",
        message: error?.message || "Intenta nuevamente en unos instantes.",
        tone: "danger",
      });
    } finally {
      setRunningActionKey("");
    }
  };

  const handleDeleteRegistration = (registration) => {
    setRegistrationToDelete(registration);
  };

  const handleConfirmWithdrawal = async (registration) => {
    try {
      setRunningActionKey(`withdraw-${registration.id}`);
      await confirmTournamentRegistrationWithdrawal({
        organizerId: currentOrganizer.uid,
        organizerName: currentOrganizer.name,
        registrationId: registration.id,
        tournamentId,
      });
      await loadScreen();
      setFeedback({
        visible: true,
        title: "Baja confirmada",
        message: "La baja de la pareja ya quedo confirmada.",
        tone: "success",
      });
    } catch (error) {
      setFeedback({
        visible: true,
        title: "No pudimos confirmar la baja",
        message: error?.message || "Intenta nuevamente en unos instantes.",
        tone: "danger",
      });
    } finally {
      setRunningActionKey("");
    }
  };

  const confirmDeleteRegistration = async () => {
    if (!registrationToDelete?.id) {
      return;
    }

    try {
      setRunningActionKey(`delete-${registrationToDelete.id}`);
      await deleteTournamentRegistration({
        registrationId: registrationToDelete.id,
        tournamentId,
      });
      setRegistrationToDelete(null);
      await loadScreen();
      setFeedback({
        visible: true,
        title: "Pareja eliminada",
        message: "La pareja fue quitada de las inscripciones.",
        tone: "success",
      });
    } catch (error) {
      setFeedback({
        visible: true,
        title: "No pudimos eliminar la pareja",
        message: error?.message || "Intenta nuevamente en unos instantes.",
        tone: "danger",
      });
    } finally {
      setRunningActionKey("");
    }
  };

  const renderPlayerRow = (playerId, fallbackName) => {
    const player = playersMap[playerId] || null;
    const displayName =
      player ? [player.nombre, player.apellido].filter(Boolean).join(" ").trim() : fallbackName || "Jugador";
    const hasImage = hasProfileImage(player?.foto);

    return (
      <View key={playerId || fallbackName} style={styles.playerRow}>
        {hasImage ? (
          <Image source={{ uri: player.foto }} style={styles.playerAvatar} />
        ) : (
          <View style={styles.playerAvatarPlaceholder}>
            <Ionicons color="#9CA3AF" name="person" size={20} />
          </View>
        )}

        <View style={styles.playerCopy}>
          <Text style={styles.playerName}>{displayName}</Text>
          <Text style={styles.playerMeta}>
            {player?.categoria || "Categoria a confirmar"}
            {player?.ciudad ? ` · ${player.ciudad}` : ""}
          </Text>
        </View>

        <Pressable
          disabled={!player}
          onPress={() => navigation.navigate("PlayerDetail", { player: player || undefined, playerId })}
          style={({ pressed }) => [
            styles.profileButton,
            !player ? styles.profileButtonDisabled : null,
            pressed ? styles.profileButtonPressed : null,
          ]}
        >
          <Ionicons
            color={!player ? "#96A6A0" : colors.primaryDark}
            name="person-outline"
            size={14}
          />
          <Text style={[styles.profileButtonText, !player ? styles.profileButtonTextDisabled : null]}>
            Perfil
          </Text>
        </Pressable>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader onBack={() => navigation.goBack()} subtitle="Inscripciones" />

      <View style={styles.container}>
        {loading ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator color={colors.primaryDark} />
            <Text style={styles.loaderText}>Cargando inscripciones...</Text>
          </View>
        ) : tournament ? (
          <FlatList
            contentContainerStyle={styles.listContent}
            data={registrations}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>Todavia no hay parejas inscriptas</Text>
                <Text style={styles.emptyText}>
                  Cuando lleguen solicitudes o parejas confirmadas, las vas a ver aca.
                </Text>
              </View>
            }
            ListHeaderComponent={
              <View style={styles.headerStack}>
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

                <Pressable
                  onPress={() =>
                    navigation.navigate("TournamentRegistration", {
                      editorRole: "organizer_create",
                      tournamentId: tournament.id,
                      tournamentName: tournament.name || "Torneo",
                    })
                  }
                  style={({ pressed }) => [
                    styles.createPairButton,
                    pressed ? styles.editButtonPressed : null,
                  ]}
                >
                  <Ionicons color={colors.surface} name="people-outline" size={18} />
                  <Text style={styles.createPairButtonText}>Inscribir nueva pareja</Text>
                </Pressable>
              </View>
            }
            renderItem={({ item, index }) => {
              const availabilityItems = getTournamentAvailabilitySummaryItems(
                item.availability || {},
                tournamentDayOptions
              );
              const availabilityMeta = buildAvailabilityMeta(availabilityItems);
              const registrationStatusMeta = getOrganizerRegistrationStatusMeta(item);

              return (
                <View style={styles.registrationCard}>
                  <View style={styles.registrationTopRow}>
                    <View style={styles.registrationCopy}>
                      <View style={styles.registrationHeaderRow}>
                        <Text style={styles.registrationTitle}>{`PAREJA ${index + 1}`}</Text>
                        <Text
                          style={[
                            styles.registrationStatus,
                            registrationStatusMeta.style,
                          ]}
                        >
                          {registrationStatusMeta.label}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.playersStack}>
                    {renderPlayerRow(item.player1Id || `${item.id}-player1`, item.player1Name)}
                    {item.player2Name
                      ? renderPlayerRow(item.player2Id || `${item.id}-player2`, item.player2Name)
                      : null}
                  </View>

                  <View style={styles.actionsRow}>
                    <Pressable
                      onPress={() =>
                        navigation.navigate("TournamentRegistration", {
                          autoOpenAvailability: true,
                          editorRole: "organizer",
                          initialPanel: "availability",
                          registrationId: item.id,
                          tournamentId: tournament.id,
                          tournamentName: tournament.name || "Torneo",
                        })
                      }
                      style={[
                        styles.summaryChip,
                        availabilityMeta.tone === "ready"
                          ? styles.summaryChipReady
                          : styles.summaryChipPending,
                      ]}
                    >
                      <Ionicons
                        color={availabilityMeta.tone === "ready" ? "#1D7A34" : "#4A78C0"}
                        name={availabilityMeta.icon}
                        size={14}
                      />
                      <Text
                        style={[
                          styles.summaryChipText,
                          availabilityMeta.tone === "ready"
                            ? styles.summaryChipTextReady
                            : styles.summaryChipTextPending,
                        ]}
                      >
                        {availabilityMeta.label}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        navigation.navigate("TournamentRegistration", {
                          editorRole: "organizer",
                          registrationId: item.id,
                          tournamentId: tournament.id,
                          tournamentName: tournament.name || "Torneo",
                        })
                      }
                      style={({ pressed }) => [
                        styles.editButton,
                        pressed ? styles.editButtonPressed : null,
                      ]}
                    >
                      <Ionicons color={colors.primaryDark} name="create-outline" size={16} />
                      <Text style={styles.editButtonText}>Editar</Text>
                    </Pressable>

                    <Pressable
                      onPress={() => handleDeleteRegistration(item)}
                      style={({ pressed }) => [
                        styles.deleteIconButton,
                        pressed ? styles.editButtonPressed : null,
                      ]}
                    >
                      <Ionicons color="#B24343" name="trash" size={16} />
                    </Pressable>

                    {item.withdrawalStatus === "requested" ? (
                      <Pressable
                        onPress={() => handleConfirmWithdrawal(item)}
                        style={({ pressed }) => [
                          styles.withdrawButton,
                          pressed ? styles.editButtonPressed : null,
                        ]}
                      >
                        <Ionicons color={colors.surface} name="log-out-outline" size={16} />
                        <Text style={styles.confirmButtonText}>
                          {runningActionKey === `withdraw-${item.id}` ? "Confirmando..." : "Confirmar baja"}
                        </Text>
                      </Pressable>
                    ) : null}

                    {item.status !== "confirmed" && item.withdrawalStatus !== "requested" ? (
                      <Pressable
                        onPress={() => handleConfirmRegistration(item)}
                        style={({ pressed }) => [
                          styles.confirmButton,
                          pressed ? styles.editButtonPressed : null,
                        ]}
                      >
                        <Ionicons color={colors.surface} name="checkmark-circle-outline" size={16} />
                        <Text style={styles.confirmButtonText}>
                          {runningActionKey === `confirm-${item.id}` ? "Confirmando..." : "Confirmar pareja"}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              );
            }}
            showsVerticalScrollIndicator={false}
          />
        ) : (
          <View style={styles.loaderWrap}>
            <Text style={styles.loaderText}>No encontramos el torneo.</Text>
          </View>
        )}
      </View>

      <FeedbackModal
        message={feedback.message}
        onClose={() => setFeedback((current) => ({ ...current, visible: false }))}
        tone={feedback.tone}
        title={feedback.title}
        visible={feedback.visible}
      />
      <Modal
        animationType="fade"
        onRequestClose={() =>
          runningActionKey === `delete-${registrationToDelete?.id}` ? null : setRegistrationToDelete(null)
        }
        transparent
        visible={Boolean(registrationToDelete)}
      >
        <View style={styles.confirmOverlay}>
          <Pressable
            onPress={() =>
              runningActionKey === `delete-${registrationToDelete?.id}` ? null : setRegistrationToDelete(null)
            }
            style={styles.confirmBackdrop}
          />
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Eliminar pareja</Text>
            <Text style={styles.confirmMessage}>
              Esta accion quitara la pareja de las inscripciones del torneo.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                disabled={runningActionKey === `delete-${registrationToDelete?.id}`}
                onPress={() => setRegistrationToDelete(null)}
                style={({ pressed }) => [
                  styles.confirmModalButton,
                  styles.confirmModalButtonSecondary,
                  pressed && runningActionKey !== `delete-${registrationToDelete?.id}`
                    ? styles.editButtonPressed
                    : null,
                ]}
              >
                <Text style={styles.confirmModalButtonSecondaryText}>Cancelar</Text>
              </Pressable>
              <Pressable
                disabled={runningActionKey === `delete-${registrationToDelete?.id}`}
                onPress={confirmDeleteRegistration}
                style={({ pressed }) => [
                  styles.confirmModalButton,
                  styles.confirmModalButtonDanger,
                  pressed && runningActionKey !== `delete-${registrationToDelete?.id}`
                    ? styles.editButtonPressed
                    : null,
                ]}
              >
                <Text style={styles.confirmModalButtonDangerText}>
                  {runningActionKey === `delete-${registrationToDelete?.id}` ? "Eliminando..." : "Eliminar"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

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
  listContent: {
    gap: spacing.md,
    paddingBottom: spacing.lg + BOTTOM_QUICK_ACTIONS_SPACE,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  headerStack: {
    gap: spacing.md,
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
  emptyCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    padding: spacing.lg,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
    textAlign: "center",
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  registrationCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    padding: spacing.sm,
  },
  registrationTopRow: {
    alignItems: "flex-start",
  },
  registrationCopy: {
    flex: 1,
  },
  registrationHeaderRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    justifyContent: "space-between",
  },
  registrationTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  registrationStatus: {
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  registrationStatusConfirmed: {
    color: "#1D7A34",
  },
  registrationStatusPending: {
    color: "#B24343",
  },
  registrationStatusWithdrawalRequested: {
    color: "#B66A16",
  },
  registrationStatusWithdrawn: {
    color: "#576773",
  },
  registrationMeta: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
    marginTop: spacing.xs,
  },
  playersStack: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  playerRow: {
    alignItems: "center",
    backgroundColor: "#F7FAF8",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
  },
  playerAvatar: {
    borderRadius: 18,
    height: 36,
    width: 36,
  },
  playerAvatarPlaceholder: {
    alignItems: "center",
    backgroundColor: "#EFF2F4",
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  playerCopy: {
    flex: 1,
  },
  playerName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  playerMeta: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },
  profileButton: {
    alignItems: "center",
    backgroundColor: "#EDF7F2",
    borderColor: "#C9E5D8",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  profileButtonDisabled: {
    backgroundColor: "#F3F6F8",
    borderColor: "#D7DEE4",
  },
  profileButtonPressed: {
    opacity: 0.84,
  },
  profileButtonText: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "800",
  },
  profileButtonTextDisabled: {
    color: "#96A6A0",
  },
  summaryChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  summaryChip: {
    alignItems: "center",
    backgroundColor: "#F3F6F8",
    borderColor: "#D9E2E8",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  summaryChipReady: {
    backgroundColor: "#EEF9F1",
    borderColor: "#B7DFBF",
  },
  summaryChipPending: {
    backgroundColor: "#EBF2FF",
    borderColor: "#A8C6F0",
  },
  summaryChipText: {
    fontSize: 11,
    fontWeight: "800",
  },
  summaryChipTextReady: {
    color: "#1D7A34",
  },
  summaryChipTextPending: {
    color: "#4A78C0",
  },
  actionsRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  editButton: {
    alignItems: "center",
    backgroundColor: "#EDF7F2",
    borderColor: "#C9E5D8",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  editButtonPressed: {
    opacity: 0.84,
  },
  editButtonText: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "800",
  },
  deleteIconButton: {
    alignItems: "center",
    backgroundColor: "#FFF1F1",
    borderColor: "#F1C8C8",
    borderRadius: 999,
    borderWidth: 1,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  confirmButton: {
    alignItems: "center",
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  withdrawButton: {
    alignItems: "center",
    backgroundColor: "#C27A1C",
    borderColor: "#C27A1C",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  confirmButtonText: {
    color: colors.surface,
    fontSize: 11,
    fontWeight: "800",
  },
  createPairButton: {
    alignItems: "center",
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  createPairButtonText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: "900",
    textTransform: "uppercase",
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
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    padding: spacing.lg,
    width: "100%",
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
});
