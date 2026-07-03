import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";

import BottomQuickActionsBar, {
  BOTTOM_QUICK_ACTIONS_SPACE,
} from "../components/BottomQuickActionsBar";
import FeedbackModal from "../components/FeedbackModal";
import SectionHeader from "../components/SectionHeader";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import { sendChatMessage } from "../services/chatService";
import { isLeagueParticipant, listLeagues, updateLeagueFixture } from "../services/leaguesService";
import { getUserId } from "../utils/getUserId";
import { formatPlayerShortName } from "../utils/playerDisplayName";

function normalizeText(value = "") {
  return String(value || "").trim().toLowerCase();
}

function getCandidateKey(candidate = {}) {
  return normalizeText(candidate.linkedUserId || candidate.id || "");
}

function isSameCandidate(first = {}, second = {}) {
  const firstKey = getCandidateKey(first);
  const secondKey = getCandidateKey(second);

  return Boolean(firstKey && secondKey && firstKey === secondKey);
}

function candidatePlaysLeague(league = {}, candidate = {}) {
  return isLeagueParticipant(league, {
    id: candidate.id || "",
    uid: candidate.linkedUserId || candidate.id || "",
  });
}

function normalizeCandidateForReplacement(candidate = {}) {
  return {
    id: candidate.id || "",
    type: candidate.type || (candidate.linkedUserId ? "registered" : "guest"),
    linkedUserId: candidate.linkedUserId || candidate.id || "",
    nombre: candidate.nombre || candidate.name || "Jugador",
    apellido: candidate.apellido || candidate.lastName || "",
    categoria: candidate.categoria || "",
    sexo: candidate.sexo || "",
  };
}

function buildFixtureWithAcceptedCandidate(fixture = {}, request = {}, candidate = {}) {
  return {
    ...fixture,
    rounds: (fixture.rounds || []).map((round) => {
      if (round.id !== request.round.id) {
        return round;
      }

      return {
        ...round,
        matches: (round.matches || []).map((match) => {
          if (match.id !== request.match.id) {
            return match;
          }

          const currentReplacement = match.replacements?.[request.replacementKey] || {};
          const currentCandidates = Array.isArray(currentReplacement.candidates)
            ? currentReplacement.candidates
            : [];

          return {
            ...match,
            replacements: {
              ...(match.replacements || {}),
              [request.replacementKey]: {
                ...currentReplacement,
                requested: true,
                replacement: normalizeCandidateForReplacement(candidate),
                acceptedAtMillis: Date.now(),
                acceptedCandidateId: candidate.linkedUserId || candidate.id || "",
                candidates: currentCandidates.filter((item) => !isSameCandidate(item, candidate)),
              },
            },
          };
        }),
      };
    }),
  };
}

function buildFixtureWithRejectedCandidate(fixture = {}, request = {}, candidate = {}) {
  return {
    ...fixture,
    rounds: (fixture.rounds || []).map((round) => {
      if (round.id !== request.round.id) {
        return round;
      }

      return {
        ...round,
        matches: (round.matches || []).map((match) => {
          if (match.id !== request.match.id) {
            return match;
          }

          const currentReplacement = match.replacements?.[request.replacementKey] || {};
          const currentCandidates = Array.isArray(currentReplacement.candidates)
            ? currentReplacement.candidates
            : [];
          const currentRejectedCandidates = Array.isArray(currentReplacement.rejectedCandidates)
            ? currentReplacement.rejectedCandidates
            : [];
          const nextRejectedCandidates = currentRejectedCandidates.some((item) =>
            isSameCandidate(item, candidate)
          )
            ? currentRejectedCandidates
            : [...currentRejectedCandidates, candidate];

          return {
            ...match,
            replacements: {
              ...(match.replacements || {}),
              [request.replacementKey]: {
                ...currentReplacement,
                requested: true,
                candidates: currentCandidates.filter((item) => !isSameCandidate(item, candidate)),
                rejectedCandidates: nextRejectedCandidates,
              },
            },
          };
        }),
      };
    }),
  };
}

function buildReplacementMessage(request = {}) {
  const timeLabel =
    request.match?.timeSlot || request.round?.scheduleLabel || "Horario a definir";
  const complexLabel =
    request.league?.complejoNombre ||
    request.league?.complejo?.nombre ||
    "Complejo a definir";

  return [
    `Tu postulacion para reemplazar en ${request.league?.nombre || "la liga"} fue aceptada.`,
    `${request.round?.title || "Fecha"} - ${timeLabel}.`,
    `Complejo: ${complexLabel}.`,
  ].join("\n");
}

function buildReplacementRejectedMessage(request = {}) {
  return [
    `Tu postulacion para reemplazar en ${request.league?.nombre || "la liga"} fue rechazada.`,
    "El organizador puede elegir otro jugador o resolver el reemplazo manualmente.",
  ].join("\n");
}

function collectReplacementRequests(leagues = [], userData = {}) {
  const currentUserId = getUserId(userData).toLowerCase();

  return leagues
    .filter((league) => normalizeText(league.organizerId || league.createdBy) === currentUserId)
    .flatMap((league) =>
      (league.fixture?.rounds || []).flatMap((round) =>
        (round.matches || []).flatMap((match) =>
          Object.entries(match.replacements || {})
            .filter(([, replacement]) => replacement?.requested && !replacement?.replacement)
            .map(([replacementKey, replacement]) => ({
              id: `${league.id}-${round.id}-${match.id}-${replacementKey}`,
              league,
              match,
              replacement,
              replacementKey,
              round,
              status: "pending",
            }))
        )
      )
    )
    .sort((first, second) =>
      String(first.league.nombre).localeCompare(String(second.league.nombre), "es")
    );
}

export default function OrganizerReplacementsScreen({ navigation }) {
  const { userData } = useAuth();
  const [loading, setLoading] = useState(true);
  const [leaguesSource, setLeaguesSource] = useState([]);
  const [candidateActionId, setCandidateActionId] = useState("");
  const [feedback, setFeedback] = useState({ visible: false, title: "", message: "", tone: "default" });

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      const loadRequests = async () => {
        try {
          setLoading(true);
          const leagues = await listLeagues();

          if (!isMounted) {
            return;
          }

          setLeaguesSource(leagues);
        } catch (error) {
          if (isMounted) {
            setLeaguesSource([]);
          }
        } finally {
          if (isMounted) {
            setLoading(false);
          }
        }
      };

      loadRequests();

      return () => {
        isMounted = false;
      };
    }, [])
  );

  const replacementRequests = useMemo(
    () => collectReplacementRequests(leaguesSource, userData),
    [leaguesSource, userData]
  );
  const pendingCount = replacementRequests.filter((request) => request.status === "pending").length;

  const handleOpenFixture = (request) => {
    navigation.navigate("LeagueFixture", {
      focusMatchId: request.match.id,
      focusReplacementKey: request.replacementKey,
      focusRoundId: request.round.id,
      leagueId: request.league.id,
      leagueName: request.league.nombre,
    });
  };

  const updateLeagueSourceFixture = (leagueId, fixture) => {
    setLeaguesSource((current) =>
      current.map((league) => (league.id === leagueId ? { ...league, fixture } : league))
    );
  };

  const handleAcceptCandidate = async (request, candidate) => {
    const candidateKey = getCandidateKey(candidate);

    if (
      !request?.league?.id ||
      !candidateKey ||
      candidateActionId ||
      candidatePlaysLeague(request.league, candidate)
    ) {
      return;
    }

    const actionId = `${request.id}-${candidateKey}-accept`;

    try {
      setCandidateActionId(actionId);
      const nextFixture = buildFixtureWithAcceptedCandidate(
        request.league.fixture || { generatedAtMillis: 0, rounds: [] },
        request,
        candidate
      );

      await updateLeagueFixture(request.league.id, nextFixture);
      updateLeagueSourceFixture(request.league.id, nextFixture);

      try {
        await sendChatMessage({
          currentUserId: getUserId(userData),
          currentUserName: userData?.name || "Organizador",
          otherUserId: candidate.linkedUserId || candidate.id || "",
          otherUserName: formatPlayerShortName(candidate),
          text: buildReplacementMessage(request),
        });
      } catch (messageError) {
        // El remplazo queda asignado aunque el aviso por mensaje no se pueda enviar.
      }
    } catch (error) {
      setFeedback({ visible: true, title: "No pudimos asignar el remplazo", message: "Revisa tu conexion e intenta de nuevo.", tone: "danger" });
    } finally {
      setCandidateActionId("");
    }
  };

  const handleRejectCandidate = async (request, candidate) => {
    const candidateKey = getCandidateKey(candidate);

    if (!request?.league?.id || !candidateKey || candidateActionId) {
      return;
    }

    const actionId = `${request.id}-${candidateKey}-reject`;

    try {
      setCandidateActionId(actionId);
      const nextFixture = buildFixtureWithRejectedCandidate(
        request.league.fixture || { generatedAtMillis: 0, rounds: [] },
        request,
        candidate
      );

      await updateLeagueFixture(request.league.id, nextFixture);
      updateLeagueSourceFixture(request.league.id, nextFixture);

      try {
        await sendChatMessage({
          currentUserId: getUserId(userData),
          currentUserName: userData?.name || "Organizador",
          otherUserId: candidate.linkedUserId || candidate.id || "",
          otherUserName: formatPlayerShortName(candidate),
          text: buildReplacementRejectedMessage(request),
        });
      } catch (messageError) {
        // La postulacion queda rechazada aunque el aviso por mensaje no se pueda enviar.
      }
    } catch (error) {
      setFeedback({ visible: true, title: "No pudimos rechazar la postulacion", message: "Revisa tu conexion e intenta de nuevo.", tone: "danger" });
    } finally {
      setCandidateActionId("");
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader onBack={() => navigation.goBack()} subtitle="Remplazos" />
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />

      <View style={styles.container}>
        <View style={styles.summaryCard}>
          <View style={styles.summaryIcon}>
            <Ionicons color={colors.primaryDark} name="swap-horizontal-outline" size={22} />
          </View>
          <View style={styles.summaryCopy}>
            <Text style={styles.summaryTitle}>Pedidos de remplazo</Text>
            <Text style={styles.summaryText}>
              {pendingCount
                ? `${pendingCount} solicitud${pendingCount === 1 ? "" : "es"} pendiente${pendingCount === 1 ? "" : "s"}`
                : "No hay solicitudes pendientes"}
            </Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator color={colors.primaryDark} />
            <Text style={styles.loaderText}>Cargando remplazos...</Text>
          </View>
        ) : (
          <FlatList
            contentContainerStyle={styles.listContent}
            data={replacementRequests}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>Sin pedidos de remplazo</Text>
                <Text style={styles.emptyText}>
                  Cuando un jugador pida remplazo desde el fixture, lo vas a ver reflejado aca.
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              const titularName = formatPlayerShortName(item.replacement?.titular);
              const replacementName = item.replacement?.replacement
                ? formatPlayerShortName(item.replacement.replacement)
                : "";
              const candidates = Array.isArray(item.replacement?.candidates)
                ? item.replacement.candidates.filter(
                    (candidate) => !candidatePlaysLeague(item.league, candidate)
                  )
                : [];

              return (
                <Pressable
                  onPress={() => handleOpenFixture(item)}
                  style={({ pressed }) => [
                    styles.requestCard,
                    pressed ? styles.requestCardPressed : null,
                  ]}
                >
                  <View style={styles.requestHeader}>
                    <View style={styles.requestTitleWrap}>
                      <Text numberOfLines={1} style={styles.leagueName}>
                        {item.league.nombre}
                      </Text>
                      <Text style={styles.roundText}>
                        {item.round.title || "Fecha"} · {item.match.timeSlot || item.round.scheduleLabel || "Horario a definir"}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.statusPill,
                        item.status === "designated" ? styles.statusPillReady : null,
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusPillText,
                          item.status === "designated" ? styles.statusPillTextReady : null,
                        ]}
                      >
                        {item.status === "designated" ? "DESIGNADO" : "PENDIENTE"}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.playerRow}>
                    <Ionicons color={colors.danger} name="person-remove-outline" size={17} />
                    <Text style={styles.playerText}>
                      Titular: <Text style={styles.playerName}>{titularName}</Text>
                    </Text>
                  </View>

                  {replacementName ? (
                    <View style={styles.playerRow}>
                      <Ionicons color="#1E9E52" name="person-add-outline" size={17} />
                      <Text style={styles.playerText}>
                        Remplazo: <Text style={styles.replacementName}>{replacementName}</Text>
                      </Text>
                    </View>
                  ) : candidates.length ? (
                    <View style={styles.candidatesBox}>
                      <View style={styles.candidatesHeader}>
                        <Text style={styles.candidatesTitle}>
                          Postulaciones: {candidates.length}
                        </Text>
                        <Text style={styles.candidatesHint}>Resolver aca</Text>
                      </View>
                      <View style={styles.candidatesList}>
                        {candidates.slice(0, 4).map((candidate, candidateIndex) => {
                          const candidateKey =
                            getCandidateKey(candidate) || `candidate-${candidateIndex}`;
                          const acceptActionId = `${item.id}-${candidateKey}-accept`;
                          const rejectActionId = `${item.id}-${candidateKey}-reject`;
                          const isAccepting = candidateActionId === acceptActionId;
                          const isRejecting = candidateActionId === rejectActionId;
                          const isCandidateBusy = isAccepting || isRejecting;

                          return (
                          <View
                            key={`${candidate.id || candidate.linkedUserId || "candidate"}-${candidateIndex}`}
                            style={styles.candidateChip}
                          >
                            <View style={styles.candidateInfoRow}>
                              <Ionicons color={colors.primaryDark} name="person-add-outline" size={14} />
                              <View style={styles.candidateCopy}>
                              <Text numberOfLines={1} style={styles.candidateName}>
                                {formatPlayerShortName(candidate)}
                              </Text>
                              {candidate.categoria || candidate.sexo ? (
                                <Text numberOfLines={1} style={styles.candidateMeta}>
                                  {[candidate.categoria, candidate.sexo].filter(Boolean).join(" · ")}
                                </Text>
                              ) : null}
                              </View>
                            </View>
                            <View style={styles.candidateActionsRow}>
                              <Pressable
                                disabled={Boolean(candidateActionId)}
                                onPress={(event) => {
                                  event.stopPropagation?.();
                                  handleRejectCandidate(item, candidate);
                                }}
                                style={({ pressed }) => [
                                  styles.candidateRejectButton,
                                  pressed && !isCandidateBusy ? styles.candidateActionPressed : null,
                                  Boolean(candidateActionId) ? styles.candidateActionDisabled : null,
                                ]}
                              >
                                <Text style={styles.candidateRejectText}>
                                  {isRejecting ? "..." : "Rechazar"}
                                </Text>
                              </Pressable>
                              <Pressable
                                disabled={Boolean(candidateActionId)}
                                onPress={(event) => {
                                  event.stopPropagation?.();
                                  handleAcceptCandidate(item, candidate);
                                }}
                                style={({ pressed }) => [
                                  styles.candidateAcceptButton,
                                  pressed && !isCandidateBusy ? styles.candidateActionPressed : null,
                                  Boolean(candidateActionId) ? styles.candidateActionDisabled : null,
                                ]}
                              >
                                <Text style={styles.candidateAcceptText}>
                                  {isAccepting ? "..." : "Aceptar"}
                                </Text>
                              </Pressable>
                            </View>
                          </View>
                          );
                        })}
                      </View>
                    </View>
                  ) : (
                    <Text style={styles.helperText}>
                      Sin postulaciones. Toca para ir al fixture y designar manualmente.
                    </Text>
                  )}
                </Pressable>
              );
            }}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      <BottomQuickActionsBar />
      <FeedbackModal
        message={feedback.message}
        onClose={() => setFeedback((prev) => ({ ...prev, visible: false }))}
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
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  summaryCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  summaryIcon: {
    alignItems: "center",
    backgroundColor: "#E8FFF0",
    borderColor: "#8EE6A3",
    borderRadius: 16,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  summaryCopy: {
    flex: 1,
  },
  summaryTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  summaryText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  loaderWrap: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  loaderText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    marginTop: spacing.sm,
  },
  listContent: {
    paddingBottom: BOTTOM_QUICK_ACTIONS_SPACE,
  },
  requestCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  requestCardPressed: {
    opacity: 0.94,
  },
  requestHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  requestTitleWrap: {
    flex: 1,
  },
  leagueName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  roundText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 2,
  },
  statusPill: {
    backgroundColor: "#FFF0A8",
    borderColor: "#F1C84B",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusPillReady: {
    backgroundColor: "#DDF8E8",
    borderColor: "#7ED59A",
  },
  statusPillText: {
    color: "#8A4B00",
    fontSize: 10,
    fontWeight: "900",
  },
  statusPillTextReady: {
    color: "#1E9E52",
  },
  playerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  playerText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  playerName: {
    color: colors.danger,
    fontWeight: "900",
  },
  replacementName: {
    color: "#1E9E52",
    fontWeight: "900",
  },
  helperText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: spacing.sm,
  },
  candidatesBox: {
    backgroundColor: colors.secondary,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  candidatesHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "space-between",
  },
  candidatesTitle: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
  },
  candidatesHint: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  candidatesList: {
    gap: 6,
    marginTop: 8,
  },
  candidateChip: {
    backgroundColor: colors.surface,
    borderColor: "#B7E4D0",
    borderRadius: 12,
    borderWidth: 1,
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
  },
  candidateInfoRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  candidateCopy: {
    flex: 1,
  },
  candidateName: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
  },
  candidateMeta: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 1,
  },
  candidateActionsRow: {
    flexDirection: "row",
    gap: 7,
    justifyContent: "flex-end",
    marginTop: 7,
  },
  candidateAcceptButton: {
    backgroundColor: colors.primaryDark,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  candidateRejectButton: {
    backgroundColor: "#F4F5F7",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  candidateActionPressed: {
    opacity: 0.88,
  },
  candidateActionDisabled: {
    opacity: 0.6,
  },
  candidateAcceptText: {
    color: colors.surface,
    fontSize: 11,
    fontWeight: "900",
  },
  candidateRejectText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "900",
  },
  candidatesActionText: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "800",
    lineHeight: 15,
    marginTop: 7,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    padding: spacing.lg,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "900",
    textAlign: "center",
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.xs,
    textAlign: "center",
  },
});

