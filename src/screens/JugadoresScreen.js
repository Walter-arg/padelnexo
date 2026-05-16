import { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

import BottomQuickActionsBar, {
  BOTTOM_QUICK_ACTIONS_SPACE,
} from "../components/BottomQuickActionsBar";
import AvailabilityEditor from "../components/AvailabilityEditor";
import PlayerCard from "../components/PlayerCard";
import SectionFilterBar from "../components/SectionFilterBar";
import SectionHeader from "../components/SectionHeader";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import { playersMock } from "../data/playersMock";
import { playerCategories } from "../data/profileOptions";
import { isAvailableToday } from "../services/availabilityService";
import {
  applyFavoriteFlags,
  registerPlayersForFavorites,
  subscribeToFavoritePlayers,
  toggleFavoritePlayer,
} from "../services/favoritesService";
import { listPlayers } from "../services/playersService";
import { getProfileImageUri } from "../utils/defaultProfileImage";

const SEX_FILTER_OPTIONS = ["Todos", "Masculino", "Femenino"];

function normalizeText(value = "") {
  return value.trim().toLowerCase();
}

function isOwnPlayer(player, userData) {
  if (!player || !userData) {
    return false;
  }

  if (userData.uid && player.id === userData.uid) {
    return true;
  }

  if (player.id || userData.uid) {
    return false;
  }

  return normalizeText(player.nombre) === normalizeText(userData.name || "");
}

function buildOwnPlayerFromUser(userData) {
  if (!userData?.uid) {
    return null;
  }

  const availability = userData.availability || {};

  return {
    id: userData.uid,
    nombre: userData.name || "Jugador",
    categoria: userData.category || "Iniciante",
    sexo: userData.sex || "Masculino",
    ciudad: userData.localidad?.nombre || userData.city || "Buenos Aires",
    provincia:
      userData.localidad?.provincia ||
      userData.province ||
      userData.location?.provincia ||
      "Buenos Aires",
    disponibilidad: "Tu perfil",
    disponibleHoy: isAvailableToday(availability),
    manoHabil: userData.manoHabil || "Derecha",
    ladoPreferido: userData.ladoJuego || "Ambos lados",
    descripcion: userData.description || "",
    foto: getProfileImageUri(userData.avatarUrl),
    availability,
    esFavorito: false,
  };
}

function toggleCategorySelection(current, target) {
  if (current.includes(target)) {
    return current.filter((item) => item !== target);
  }

  if (current.length >= 2) {
    return [current[1], target];
  }

  return [...current, target];
}

export default function JugadoresScreen({ navigation }) {
  const { updateProfile, userData } = useAuth();
  const currentUserId = userData?.uid;
  const [query, setQuery] = useState("");
  const [playersSource, setPlayersSource] = useState(playersMock);
  const [playersLoading, setPlayersLoading] = useState(true);
  const [isAvailabilityVisible, setIsAvailabilityVisible] = useState(false);
  const [availabilitySaving, setAvailabilitySaving] = useState(false);

  const userLocalidad = useMemo(() => {
    const name = userData?.localidad?.nombre || userData?.city || "";

    if (!name) {
      return null;
    }

    return {
      nombre: name,
      provincia:
        userData?.localidad?.provincia || userData?.province || userData?.location?.provincia || "",
      pais: userData?.localidad?.pais || userData?.location?.pais || "Argentina",
    };
  }, [userData]);

  const [appliedFilters, setAppliedFilters] = useState({
    sexo: "Todos",
    categorias: [],
    localidades: userLocalidad ? [userLocalidad] : [],
  });
  const [draftSexo, setDraftSexo] = useState("Todos");
  const [draftCategorias, setDraftCategorias] = useState([]);

  const hasActiveFilters =
    query.trim().length > 0 ||
    appliedFilters.sexo !== "Todos" ||
    appliedFilters.categorias.length > 0;

  useEffect(() => {
    let isCancelled = false;

    const loadPlayers = async () => {
      try {
        setPlayersLoading(true);
        const players = await listPlayers();

        if (isCancelled) {
          return;
        }

        const sourcePlayers = players.length > 0 ? players : playersMock;
        setPlayersSource(registerPlayersForFavorites(currentUserId, sourcePlayers));
      } catch (error) {
        if (!isCancelled) {
          setPlayersSource(registerPlayersForFavorites(currentUserId, playersMock));
        }
      } finally {
        if (!isCancelled) {
          setPlayersLoading(false);
        }
      }
    };

    loadPlayers();

    return () => {
      isCancelled = true;
    };
  }, [currentUserId]);

  useEffect(() => {
    setPlayersSource((current) => applyFavoriteFlags(currentUserId, current));
  }, [currentUserId]);

  useEffect(() => {
    const unsubscribe = subscribeToFavoritePlayers(currentUserId, () => {
      setPlayersSource((current) => applyFavoriteFlags(currentUserId, current));
    });

    return unsubscribe;
  }, [currentUserId]);

  const playersFiltered = useMemo(() => {
    const normalizedQuery = normalizeText(query);

    const visiblePlayers = playersSource.filter((player) => {
      if (appliedFilters.sexo !== "Todos" && player.sexo !== appliedFilters.sexo) {
        return false;
      }

      if (
        appliedFilters.categorias.length > 0 &&
        !appliedFilters.categorias.includes(player.categoria)
      ) {
        return false;
      }

      if (appliedFilters.localidades.length > 0) {
        const cityMatches = appliedFilters.localidades.some(
          (location) => normalizeText(player.ciudad) === normalizeText(location.nombre)
        );

        if (!cityMatches) {
          return false;
        }
      }

      if (!normalizedQuery) {
        return true;
      }

      return (
        normalizeText(player.nombre).includes(normalizedQuery) ||
        normalizeText(player.ciudad).includes(normalizedQuery)
      );
    });

    const ownPlayerFromUser = buildOwnPlayerFromUser(userData);
    const ownPlayers = visiblePlayers.filter((player) => isOwnPlayer(player, userData));
    const otherPlayers = visiblePlayers.filter((player) => !isOwnPlayer(player, userData));

    if (!ownPlayerFromUser) {
      return [...ownPlayers, ...otherPlayers];
    }

    return [ownPlayerFromUser, ...otherPlayers];
  }, [appliedFilters, playersSource, query, userData]);

  const handleOpenFilters = () => {
    setDraftSexo(appliedFilters.sexo);
    setDraftCategorias(appliedFilters.categorias);
  };

  const handleApplyFilters = async () => {
    setAppliedFilters((current) => ({
      ...current,
      sexo: draftSexo,
      categorias: draftCategorias,
    }));
  };

  const handleToggleFavorite = (playerId) => {
    setPlayersSource((current) => {
      const targetPlayer = current.find((player) => player.id === playerId);

      if (!targetPlayer) {
        return current;
      }

      toggleFavoritePlayer(currentUserId, targetPlayer);

      return applyFavoriteFlags(currentUserId, current);
    });
  };

  const handleSaveAvailability = async (availability) => {
    setAvailabilitySaving(true);

    try {
      await updateProfile({ availability });
    } finally {
      setAvailabilitySaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader onBack={() => navigation.goBack()} subtitle="Jugadores">
        <SectionFilterBar
          extraSummary={hasActiveFilters ? "Activo" : undefined}
          onApply={handleApplyFilters}
          onChange={({ locations }) =>
            setAppliedFilters((current) => ({
              ...current,
              localidades: locations,
            }))
          }
          onModalOpen={handleOpenFilters}
          renderExtraContent={() => (
            <View>
              <Text style={styles.modalLabel}>Sexo</Text>
              <View style={styles.modalRow}>
                {SEX_FILTER_OPTIONS.map((sex) => (
                  <Pressable
                    key={sex}
                    onPress={() => setDraftSexo(sex)}
                    style={[styles.filterChip, draftSexo === sex && styles.filterChipActive]}
                  >
                    <Text
                      style={[styles.filterChipText, draftSexo === sex && styles.filterChipTextActive]}
                    >
                      {sex}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.modalLabel}>Categoria (maximo 2)</Text>
              <View style={styles.modalRow}>
                {playerCategories.map((category) => (
                  <Pressable
                    key={category}
                    onPress={() =>
                      setDraftCategorias((current) => toggleCategorySelection(current, category))
                    }
                    style={[
                      styles.filterChip,
                      draftCategorias.includes(category) && styles.filterChipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        draftCategorias.includes(category) && styles.filterChipTextActive,
                      ]}
                    >
                      {category}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.modalLabel}>Complejo</Text>
              <View style={styles.placeholderField}>
                <Ionicons color={colors.muted} name="business-outline" size={16} />
                <Text style={styles.placeholderFieldText}>
                  Selector de complejo disponible proximamente para esta seccion
                </Text>
              </View>
            </View>
          )}
          userLocation={userLocalidad}
        />
      </SectionHeader>
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />

      <View style={styles.container}>
        <Pressable
          onPress={() => setIsAvailabilityVisible(true)}
          style={({ pressed }) => [
            styles.availabilityButton,
            pressed ? styles.availabilityButtonPressed : null,
          ]}
        >
          <View style={styles.availabilityIconWrap}>
            <Ionicons color="#2F7F96" name="calendar-outline" size={19} />
            <Ionicons color="#2F7F96" name="time-outline" size={11} style={styles.availabilityTimeIcon} />
          </View>
          <View style={styles.availabilityCopy}>
            <Text style={styles.availabilityTitle}>Disponibilidad</Text>
            <Text style={styles.availabilityText}>Actualiza tus dias y horarios para jugar</Text>
          </View>
          <Ionicons color={colors.primaryDark} name="chevron-forward" size={18} />
        </Pressable>

        <View style={styles.topSearchRow}>
          <View style={styles.searchWrap}>
            <TextInput
              onChangeText={setQuery}
              placeholder="Buscar por nombre y apellido"
              placeholderTextColor={colors.muted}
              style={styles.searchInput}
              value={query}
            />
          </View>

          <Pressable
            onPress={() => navigation.navigate("Favoritos")}
            style={({ pressed }) => [
              styles.favoriteInlineButton,
              pressed && styles.favoriteInlineButtonPressed,
            ]}
          >
            <Ionicons color="#B87407" name="star" size={18} />
            <Text style={styles.favoriteInlineButtonText}>Favoritos</Text>
          </Pressable>
        </View>

        <FlatList
          contentContainerStyle={styles.listContent}
          data={playersFiltered}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                {playersLoading ? "Cargando jugadores..." : "No encontramos resultados"}
              </Text>
              <Text style={styles.emptyText}>
                {playersLoading
                  ? "Estamos sincronizando perfiles desde la comunidad."
                  : "Ajusta la busqueda o los filtros para descubrir mas perfiles."}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <PlayerCard
              isBlocked={isOwnPlayer(item, userData)}
              onMessage={
                isOwnPlayer(item, userData)
                  ? undefined
                  : () =>
                      navigation.navigate("Mensajes", {
                        playerId: item.id,
                        playerName: item.nombre,
                      })
              }
              onToggleFavorite={
                isOwnPlayer(item, userData) ? undefined : () => handleToggleFavorite(item.id)
              }
              onViewProfile={
                isOwnPlayer(item, userData)
                  ? undefined
                  : () =>
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

      <AvailabilityEditor
        initialAvailability={userData?.availability}
        loading={availabilitySaving}
        onClose={() => setIsAvailabilityVisible(false)}
        onSave={handleSaveAvailability}
        visible={isAvailabilityVisible}
      />

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
    paddingTop: 2,
  },
  availabilityButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    marginBottom: spacing.sm,
    minHeight: 58,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  availabilityButtonPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  availabilityIconWrap: {
    alignItems: "center",
    backgroundColor: "#EAF6F8",
    borderRadius: 999,
    height: 36,
    justifyContent: "center",
    marginRight: spacing.sm,
    position: "relative",
    width: 36,
  },
  availabilityTimeIcon: {
    position: "absolute",
    right: 6,
    top: 22,
  },
  availabilityCopy: {
    flex: 1,
  },
  availabilityTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  availabilityText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
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
  topSearchRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: 0,
  },
  favoriteInlineButton: {
    alignItems: "center",
    backgroundColor: "#FFF8E8",
    borderColor: "#F2D89C",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    flexShrink: 0,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 14,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  favoriteInlineButtonPressed: {
    opacity: 0.92,
  },
  favoriteInlineButtonText: {
    color: "#8A5700",
    fontSize: 13,
    fontWeight: "800",
    marginLeft: 6,
  },
  searchWrap: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  searchInput: {
    color: colors.text,
    fontSize: 14,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  listContent: {
    paddingBottom: BOTTOM_QUICK_ACTIONS_SPACE,
    paddingTop: spacing.sm,
  },
  emptyCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
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
    lineHeight: 20,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  modalLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    marginBottom: spacing.xs,
    marginTop: spacing.xs,
    textTransform: "uppercase",
  },
  modalRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  filterChip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  filterChipActive: {
    backgroundColor: colors.secondary,
    borderColor: colors.primaryLight,
  },
  filterChipText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
  },
  filterChipTextActive: {
    color: colors.primaryDark,
  },
  placeholderField: {
    alignItems: "center",
    backgroundColor: "#F7FBF9",
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  placeholderFieldText: {
    color: colors.muted,
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    marginLeft: spacing.sm,
  },
});

