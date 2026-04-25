import { useCallback, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
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
  archiveLeague,
  canManageLeague,
  getLeagueById,
  isLeagueParticipant,
} from "../services/leaguesService";

const actionPalette = {
  surface: "#CFF7D9",
  border: "#8EE6A3",
  accent: "#39C86A",
  accentDark: "#147A3A",
  iconSurface: "#E9FFF0",
};

function countCompletePairs(players = []) {
  const pairs = players.reduce((groups, player) => {
    const pairNumber = Number.parseInt(String(player?.pairNumber || "0"), 10) || 0;

    if (pairNumber > 0) {
      groups[pairNumber] = (groups[pairNumber] || 0) + 1;
    }

    return groups;
  }, {});

  if (Object.keys(pairs).length) {
    return Object.values(pairs).filter((count) => count >= 2).length;
  }

  return Math.floor(players.length / 2);
}

export default function LeagueDetailScreen({ navigation, route }) {
  const { userData } = useAuth();
  const leagueId = route?.params?.leagueId || "";
  const [league, setLeague] = useState(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState({
    visible: false,
    title: "",
    message: "",
    tone: "default",
  });
  const [isDeleteConfirmVisible, setIsDeleteConfirmVisible] = useState(false);
  const [deletingLeague, setDeletingLeague] = useState(false);

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
        } catch (error) {
          if (isMounted) {
            showFeedback(
              "No pudimos cargar la liga",
              error?.message || "Intenta nuevamente en unos instantes.",
              "danger"
            );
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

  const leagueName = league?.nombre || route?.params?.leagueName || "Liga";
  const leagueComplex = league?.complejoNombre || route?.params?.leagueComplex || "";
  const leagueCategory = league?.categoria || route?.params?.leagueCategory || "";
  const leagueSex = league?.sexo || route?.params?.leagueSex || "";
  const leaguePlayers = Array.isArray(league?.players) ? league.players : [];
  const playersCount = leaguePlayers.length || route?.params?.playersCount || 0;
  const isPairLeague = league?.teamType === "pair";
  const pairsCount = isPairLeague ? countCompletePairs(leaguePlayers) : 0;
  const canManage = league ? canManageLeague(league, userData) : false;
  const canAccessAsParticipant = league ? isLeagueParticipant(league, userData) : false;
  const canAccessLeague = canManage || canAccessAsParticipant;

  const showFeedback = (title, message, tone = "default") => {
    setFeedback({
      visible: true,
      title,
      message,
      tone,
    });
  };

  const organizerActionCards = [
    {
      key: "fixture",
      title: "Fixture",
      description: "Proximo paso: armado de fechas y cruces.",
      icon: "calendar-outline",
      onPress: () =>
        navigation.navigate("LeagueFixture", {
          leagueId,
          leagueName,
        }),
    },
    {
      key: "scores",
      title: "Puntajes",
      description: "Tabla de posiciones de la competencia.",
      icon: "trophy-outline",
      onPress: () =>
        navigation.navigate("LeagueStandings", {
          leagueId,
          leagueName,
        }),
    },
    {
      key: "payments",
      title: "Pagos",
      description: "Controla estados de pago de cada jugador.",
      icon: "card-outline",
      onPress: () =>
        navigation.navigate("LeaguePayments", {
          leagueId,
          leagueName,
        }),
    },
  ];
  const actionCards = canManage
    ? [
        {
          key: "players",
          title: "Jugadores",
          description: "Gestiona inscriptos y reemplazos de la liga.",
          icon: "people-outline",
          tone: "primary",
          onPress: () =>
            navigation.navigate("LeaguePlayers", {
              leagueId,
              leagueName,
            }),
        },
        ...organizerActionCards,
      ]
    : organizerActionCards;

  const confirmDeleteLeague = async () => {
    if (!leagueId || deletingLeague) {
      return;
    }

    try {
      setDeletingLeague(true);
      await archiveLeague(leagueId);
      setIsDeleteConfirmVisible(false);
      navigation.navigate("MyLeagues");
    } catch (error) {
      showFeedback(
        "No pudimos eliminar la liga",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setDeletingLeague(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader
        onBack={() => navigation.goBack()}
        subtitle={canManage ? "Gestionar liga" : "Gestion de Liga"}
      />
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />

      <View style={styles.container}>
        {loading ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator color={colors.primaryDark} />
            <Text style={styles.loaderText}>Cargando liga...</Text>
          </View>
        ) : canAccessLeague ? (
          <>
            <LeagueHeaderCard
              actions={
                canManage ? (
                <View style={styles.summaryActionsRow}>
                  <Pressable
                    onPress={() => navigation.navigate("CreateLeague", { leagueId })}
                    style={({ pressed }) => [
                      styles.summaryActionPill,
                      pressed ? styles.summaryActionPressed : null,
                    ]}
                  >
                    <Ionicons color={colors.primaryDark} name="create-outline" size={15} />
                  </Pressable>
                  <Pressable
                    onPress={() => setIsDeleteConfirmVisible(true)}
                    style={({ pressed }) => [
                      styles.summaryDeleteButton,
                      pressed ? styles.summaryActionPressed : null,
                    ]}
                  >
                    <Ionicons color={colors.danger} name="trash-outline" size={15} />
                  </Pressable>
                </View>
                ) : null
              }
              category={leagueCategory}
              complexName={leagueComplex}
              league={league}
              sex={leagueSex}
              title={leagueName}
              teamType={league?.teamType}
            >
              <Text style={styles.summaryCountText}>
                {isPairLeague
                  ? `${pairsCount} pareja${pairsCount === 1 ? "" : "s"}`
                  : `${playersCount} jugadores`}
              </Text>
            </LeagueHeaderCard>

            <Text style={styles.actionsTitle}>
              {canManage ? "Herramientas de esta liga" : "Tu acceso de jugador"}
            </Text>

            <View style={styles.actionsGrid}>
              {actionCards.map((action) => (
                <Pressable
                  key={action.key}
                  onPress={action.onPress}
                  style={({ pressed }) => [
                    styles.actionCard,
                    pressed ? styles.actionCardPressed : null,
                  ]}
                >
                  <View
                    style={styles.actionIconWrap}
                  >
                    <Ionicons color="#111111" name={action.icon} size={18} />
                  </View>
                  <Text style={styles.actionTitle}>{action.title}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : (
          <View style={styles.warningCard}>
            <Text style={styles.warningTitle}>Acceso restringido</Text>
            <Text style={styles.warningText}>
              Solo el organizador o los jugadores agregados a esta liga pueden acceder a su gestion.
            </Text>
          </View>
        )}
      </View>

      <FeedbackModal
        message={feedback.message}
        onClose={() =>
          setFeedback((current) => ({
            ...current,
            visible: false,
          }))
        }
        title={feedback.title}
        tone={feedback.tone}
        visible={feedback.visible}
      />
      <Modal
        animationType="fade"
        onRequestClose={() => (deletingLeague ? null : setIsDeleteConfirmVisible(false))}
        transparent
        visible={isDeleteConfirmVisible}
      >
        <View style={styles.confirmOverlay}>
          <Pressable
            onPress={() => (deletingLeague ? null : setIsDeleteConfirmVisible(false))}
            style={styles.confirmBackdrop}
          />
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Eliminar liga</Text>
            <Text style={styles.confirmMessage}>
              Vas a eliminar {leagueName}. Esta accion la oculta de la app.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                disabled={deletingLeague}
                onPress={() => setIsDeleteConfirmVisible(false)}
                style={({ pressed }) => [
                  styles.confirmButton,
                  styles.confirmButtonSecondary,
                  pressed && !deletingLeague ? styles.confirmButtonPressed : null,
                  deletingLeague ? styles.confirmButtonDisabled : null,
                ]}
              >
                <Text style={styles.confirmButtonSecondaryText}>Cancelar</Text>
              </Pressable>
              <Pressable
                disabled={deletingLeague}
                onPress={confirmDeleteLeague}
                style={({ pressed }) => [
                  styles.confirmButton,
                  styles.confirmButtonDanger,
                  pressed && !deletingLeague ? styles.confirmButtonPressed : null,
                  deletingLeague ? styles.confirmButtonDisabled : null,
                ]}
              >
                <Text style={styles.confirmButtonDangerText}>
                  {deletingLeague ? "Eliminando..." : "Eliminar"}
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
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: BOTTOM_QUICK_ACTIONS_SPACE,
  },
  backgroundOrbTop: {
    position: "absolute",
    top: -40,
    right: -30,
    width: 190,
    height: 190,
    borderRadius: 999,
    backgroundColor: "rgba(31,171,137,0.12)",
  },
  backgroundOrbBottom: {
    position: "absolute",
    left: -70,
    bottom: 110,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(11,132,87,0.08)",
  },
  summaryActionPressed: {
    opacity: 0.97,
  },
  summaryActionPill: {
    alignItems: "center",
    backgroundColor: "#E8FFF0",
    borderColor: "#8EE6A3",
    borderRadius: 999,
    borderWidth: 1,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  summaryActionsRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
  },
  summaryDeleteButton: {
    alignItems: "center",
    backgroundColor: "#FFF1F1",
    borderColor: "#F2C4C4",
    borderRadius: 999,
    borderWidth: 1,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  summaryCountText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  actionsTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  actionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between",
  },
  actionCard: {
    backgroundColor: actionPalette.surface,
    borderColor: actionPalette.border,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 108,
    paddingHorizontal: spacing.sm,
    paddingVertical: 12,
    width: "47.5%",
  },
  actionCardPressed: {
    opacity: 0.95,
  },
  actionIconWrap: {
    alignItems: "center",
    backgroundColor: actionPalette.iconSurface,
    borderRadius: 14,
    borderColor: "#111111",
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    marginBottom: 8,
    width: 34,
  },
  actionTitle: {
    color: actionPalette.accentDark,
    fontSize: 15,
    fontWeight: "800",
    textAlign: "center",
  },
  loaderWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loaderText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
    marginTop: spacing.sm,
  },
  warningCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    padding: spacing.lg,
  },
  warningTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
    textAlign: "center",
  },
  warningText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.xs,
    textAlign: "center",
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
  confirmButton: {
    alignItems: "center",
    borderRadius: 16,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  confirmButtonSecondary: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1,
  },
  confirmButtonDanger: {
    backgroundColor: colors.danger,
  },
  confirmButtonSecondaryText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
  },
  confirmButtonDangerText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: "800",
  },
  confirmButtonPressed: {
    opacity: 0.9,
  },
  confirmButtonDisabled: {
    opacity: 0.7,
  },
});

