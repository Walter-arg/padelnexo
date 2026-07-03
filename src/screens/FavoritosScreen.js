import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import PlayerCard from "../components/PlayerCard";
import SectionHeader from "../components/SectionHeader";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import { playersMock } from "../data/playersMock";
import {
  getFavoritePlayers,
  registerPlayersForFavorites,
  subscribeToFavoritePlayers,
  toggleFavoritePlayer,
} from "../services/favoritesService";
import { listPlayers } from "../services/playersService";

export default function FavoritosScreen({ navigation }) {
  const { userData } = useAuth();
  const currentUserId = userData?.uid;
  const [favoritePlayers, setFavoritePlayers] = useState(getFavoritePlayers(currentUserId));
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isCancelled = false;

    const loadFavorites = async () => {
      try {
        const players = await listPlayers();
        registerPlayersForFavorites(currentUserId, players.length > 0 ? players : playersMock);

        if (!isCancelled) {
          setFavoritePlayers(getFavoritePlayers(currentUserId));
          setIsLoading(false);
        }
      } catch (error) {
        if (!isCancelled) {
          registerPlayersForFavorites(currentUserId, playersMock);
          setFavoritePlayers(getFavoritePlayers(currentUserId));
          setIsLoading(false);
        }
      }
    };

    loadFavorites();

    return () => {
      isCancelled = true;
    };
  }, [currentUserId]);

  useEffect(() => {
    const unsubscribe = subscribeToFavoritePlayers(currentUserId, setFavoritePlayers);

    return unsubscribe;
  }, [currentUserId]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader onBack={() => navigation.goBack()} subtitle="Favoritos" />
      <View style={styles.container}>
        <Text style={styles.subtitle}>Tus jugadores guardados para volver rapido</Text>

        <FlatList
          contentContainerStyle={styles.listContent}
          data={favoritePlayers}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            isLoading ? (
              <View style={styles.emptyCard}>
                <ActivityIndicator color={colors.primaryDark} size="small" />
                <Text style={styles.emptyTitle}>Cargando jugadores...</Text>
              </View>
            ) : (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>Sin favoritos por ahora</Text>
                <Text style={styles.emptyText}>Agrega perfiles para verlos aca.</Text>
              </View>
            )
          }
          renderItem={({ item }) => (
            <PlayerCard
              onToggleFavorite={() => {
                toggleFavoritePlayer(currentUserId, item);
              }}
              onMessage={() =>
                navigation.navigate("Mensajes", {
                  playerId: item.id,
                  playerName: item.nombre,
                })
              }
              onViewProfile={() =>
                navigation.navigate("PlayerDetail", {
                  player: item,
                  playerId: item.id,
                })
              }
              player={item}
            />
          )}
          showsVerticalScrollIndicator={false}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#FFF7E9",
  },
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  subtitle: {
    color: "#8A5A18",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  listContent: {
    paddingBottom: spacing.lg,
  },
  emptyCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: "#F5D8A8",
    borderRadius: 20,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
    marginTop: spacing.xs,
    textAlign: "center",
  },
});

