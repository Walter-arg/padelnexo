import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";

import BottomQuickActionsBar, {
  BOTTOM_QUICK_ACTIONS_SPACE,
} from "../components/BottomQuickActionsBar";
import LeagueCard from "../components/LeagueCard";
import SectionHeader from "../components/SectionHeader";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import { isLeagueParticipant, listLeagues } from "../services/leaguesService";
import { getUserId } from "../utils/getUserId";

function countPendingReplacementRequests(league = {}, userData = {}) {
  const currentUserId = getUserId(userData).toLowerCase();

  if (!currentUserId) {
    return 0;
  }

  return (league?.fixture?.rounds || []).reduce((total, round) => {
    const roundRequests = (round.matches || []).reduce((matchTotal, match) => {
      const ownRequests = Object.values(match.replacements || {}).filter((replacement) => {
        const titular = replacement?.titular || {};
        const titularIds = [titular.linkedUserId, titular.id].filter(Boolean);

        return (
          replacement?.requested &&
          !replacement?.replacement &&
          titularIds.some((playerId) => String(playerId).trim().toLowerCase() === currentUserId)
        );
      });

      return matchTotal + ownRequests.length;
    }, 0);

    return total + roundRequests;
  }, 0);
}

export default function PlayerLeaguesScreen({ navigation }) {
  const { userData } = useAuth();
  const [loading, setLoading] = useState(true);
  const [leaguesSource, setLeaguesSource] = useState([]);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      const loadPlayerLeagues = async () => {
        try {
          setLoading(true);
          const leagues = await listLeagues();

          if (!isMounted) {
            return;
          }

          setLeaguesSource(leagues.filter((league) => isLeagueParticipant(league, userData)));
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

      loadPlayerLeagues();

      return () => {
        isMounted = false;
      };
    }, [userData])
  );

  const leaguesWithState = useMemo(
    () =>
      leaguesSource.map((league) => ({
        ...league,
        pendingReplacementRequests: countPendingReplacementRequests(league, userData),
      })),
    [leaguesSource, userData]
  );

  const handleOpenLeague = (league) => {
    navigation.navigate("LeagueDetail", {
      leagueId: league.id,
      leagueName: league.nombre,
    });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader onBack={() => navigation.goBack()} subtitle="Mis ligas" />
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />

      <View style={styles.container}>
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <Ionicons color={colors.primaryDark} name="tennisball-outline" size={22} />
          </View>
          <View style={styles.heroCopy}>
            <Text style={styles.heroTitle}>Ligas donde jugas</Text>
            <Text style={styles.heroText}>
              Accede rapido a fixture, puntajes y solicitudes de remplazo.
            </Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator color={colors.primaryDark} />
            <Text style={styles.loaderText}>Buscando tus ligas...</Text>
          </View>
        ) : (
          <FlatList
            contentContainerStyle={styles.listContent}
            data={leaguesWithState}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>Todavia no estas en una liga</Text>
                <Text style={styles.emptyText}>
                  Cuando un organizador te agregue como jugador registrado, la liga aparecera aca.
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <Pressable
                onPress={() => handleOpenLeague(item)}
                style={({ pressed }) => [pressed ? styles.cardPressed : null]}
              >
                <LeagueCard
                  hideFavoriteAction
                  league={item}
                  managementActions={
                    item.pendingReplacementRequests > 0
                      ? [
                          {
                            key: "replacement-pending",
                            icon: "alert-circle-outline",
                            label: "Remplazo solicitado",
                          },
                        ]
                      : []
                  }
                  onDetails={() => handleOpenLeague(item)}
                  showProgressStatus
                />
              </Pressable>
            )}
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
  heroCard: {
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
  heroIcon: {
    alignItems: "center",
    backgroundColor: "#E8FFF0",
    borderColor: "#8EE6A3",
    borderRadius: 16,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  heroCopy: {
    flex: 1,
  },
  heroTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  heroText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
    marginTop: 2,
  },
  listContent: {
    paddingBottom: BOTTOM_QUICK_ACTIONS_SPACE,
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
  cardPressed: {
    opacity: 0.96,
  },
});

