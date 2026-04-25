import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";

import BottomQuickActionsBar, {
  BOTTOM_QUICK_ACTIONS_SPACE,
} from "../components/BottomQuickActionsBar";
import SectionHeader from "../components/SectionHeader";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import { listLeagues } from "../services/leaguesService";
import { formatPlayerShortName } from "../utils/playerDisplayName";

function normalizeText(value = "") {
  return String(value || "").trim().toLowerCase();
}

function collectReplacementRequests(leagues = [], userData = {}) {
  const currentUserId = normalizeText(userData?.uid || userData?.id || "");

  return leagues
    .filter((league) => normalizeText(league.organizerId || league.createdBy) === currentUserId)
    .flatMap((league) =>
      (league.fixture?.rounds || []).flatMap((round) =>
        (round.matches || []).flatMap((match) =>
          Object.entries(match.replacements || {})
            .filter(([, replacement]) => replacement?.requested)
            .map(([replacementKey, replacement]) => ({
              id: `${league.id}-${round.id}-${match.id}-${replacementKey}`,
              league,
              match,
              replacement,
              replacementKey,
              round,
              status: replacement.replacement ? "designated" : "pending",
            }))
        )
      )
    )
    .sort((first, second) => {
      if (first.status !== second.status) {
        return first.status === "pending" ? -1 : 1;
      }

      return String(first.league.nombre).localeCompare(String(second.league.nombre), "es");
    });
}

export default function OrganizerReplacementsScreen({ navigation }) {
  const { userData } = useAuth();
  const [loading, setLoading] = useState(true);
  const [leaguesSource, setLeaguesSource] = useState([]);

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
                  ) : (
                    <Text style={styles.helperText}>
                      Toca para ir al fixture y designar el remplazo.
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

