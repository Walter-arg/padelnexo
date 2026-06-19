import { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Modal,
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
import FeedbackModal from "../components/FeedbackModal";
import PlayerCard from "../components/PlayerCard";
import SectionFilterBar from "../components/SectionFilterBar";
import SectionHeader from "../components/SectionHeader";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import { playersMock } from "../data/playersMock";
import { playerCategories } from "../data/profileOptions";
import { hasConfiguredAvailability, isAvailableToday } from "../services/availabilityService";
import {
  applyFavoriteFlags,
  registerPlayersForFavorites,
  subscribeToFavoritePlayers,
  toggleFavoritePlayer,
} from "../services/favoritesService";
import {
  calculateDistanceKm,
  geocodeAddress,
  getCoordinatesFromObject,
  requestCurrentLocation,
} from "../services/locationService";
import { listPlayers } from "../services/playersService";
import { getProfileImageUri } from "../utils/defaultProfileImage";

const SEX_FILTER_OPTIONS = ["Todos", "Masculino", "Femenino"];
const PROXIMITY_RADIUS_OPTIONS = [5, 10, 20, 50];

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
    ciudad: userData.localidad?.nombre || userData.city || "",
    provincia:
      userData.localidad?.provincia ||
      userData.province ||
      userData.location?.provincia ||
      "",
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

function buildPlayerDistanceKey(player = {}) {
  return `${player.id || player.nombre || "player"}|${player.ciudad || ""}|${player.provincia || ""}`;
}

function buildPlayerGeocodeCandidates(player = {}) {
  return [
    [player.ciudad, player.provincia, "Argentina"].filter(Boolean).join(", "),
    [player.provincia, "Argentina"].filter(Boolean).join(", "),
  ].filter(Boolean);
}

export default function JugadoresScreen({ navigation }) {
  const { updateProfile, userData } = useAuth();
  const currentUserId = userData?.uid;
  const [query, setQuery] = useState("");
  const [playersSource, setPlayersSource] = useState(playersMock);
  const [playersLoading, setPlayersLoading] = useState(true);
  const [isAvailabilityVisible, setIsAvailabilityVisible] = useState(false);
  const [availabilitySaving, setAvailabilitySaving] = useState(false);
  const [locationActionsVisible, setLocationActionsVisible] = useState(false);
  const [locatingUser, setLocatingUser] = useState(false);
  const [feedback, setFeedback] = useState({
    visible: false,
    title: "",
    message: "",
    tone: "default",
  });
  const [playerSearchFiltersVisible, setPlayerSearchFiltersVisible] = useState(false);
  const [proximityFilter, setProximityFilter] = useState({
    enabled: false,
    radiusKm: 10,
    userCoordinates: null,
  });
  const [playerCoordinatesByKey, setPlayerCoordinatesByKey] = useState({});

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
    soloDisponiblesHoy: false,
  });
  const [draftSexo, setDraftSexo] = useState("Todos");
  const [draftCategorias, setDraftCategorias] = useState([]);
  const [draftSoloDisponiblesHoy, setDraftSoloDisponiblesHoy] = useState(false);

  const hasActiveFilters =
    query.trim().length > 0 ||
    appliedFilters.sexo !== "Todos" ||
    appliedFilters.categorias.length > 0 ||
    appliedFilters.localidades.length > 0 ||
    proximityFilter.enabled ||
    appliedFilters.soloDisponiblesHoy;

  const hasActiveSearchFilters =
    appliedFilters.sexo !== "Todos" ||
    appliedFilters.categorias.length > 0 ||
    appliedFilters.soloDisponiblesHoy;

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

  useEffect(() => {
    if (!proximityFilter.enabled || !proximityFilter.userCoordinates || !playersSource.length) {
      return undefined;
    }

    let isCancelled = false;

    const geocodeMissingPlayers = async () => {
      const missingPlayers = playersSource.filter((player) => {
        const key = buildPlayerDistanceKey(player);
        return !getCoordinatesFromObject(player) && !playerCoordinatesByKey[key];
      });

      for (const player of missingPlayers) {
        const key = buildPlayerDistanceKey(player);

        for (const address of buildPlayerGeocodeCandidates(player)) {
          try {
            const coordinates = await geocodeAddress(address);

            if (isCancelled) {
              return;
            }

            if (coordinates) {
              setPlayerCoordinatesByKey((current) => ({
                ...current,
                [key]: coordinates,
              }));
              break;
            }
          } catch (error) {
            // Intentamos con el siguiente dato disponible del perfil.
          }
        }
      }
    };

    geocodeMissingPlayers();

    return () => {
      isCancelled = true;
    };
  }, [
    playerCoordinatesByKey,
    playersSource,
    proximityFilter.enabled,
    proximityFilter.userCoordinates,
  ]);

  const playersWithDistance = useMemo(
    () =>
      playersSource.map((player) => {
        const key = buildPlayerDistanceKey(player);
        const coordinates = getCoordinatesFromObject(player) || playerCoordinatesByKey[key];
        const distanceKm = proximityFilter.userCoordinates
          ? calculateDistanceKm(proximityFilter.userCoordinates, coordinates)
          : null;

        return {
          ...player,
          distanceKm,
        };
      }),
    [playerCoordinatesByKey, playersSource, proximityFilter.userCoordinates]
  );

  const playersFiltered = useMemo(() => {
    const normalizedQuery = normalizeText(query);

    const visiblePlayers = playersWithDistance.filter((player) => {
      if (appliedFilters.sexo !== "Todos" && player.sexo !== appliedFilters.sexo) {
        return false;
      }

      if (
        appliedFilters.categorias.length > 0 &&
        !appliedFilters.categorias.includes(player.categoria)
      ) {
        return false;
      }

      const playerHasStructuredAvailability = hasConfiguredAvailability(player.availability || {});
      const playerIsAvailableToday = playerHasStructuredAvailability
        ? isAvailableToday(player.availability || {})
        : Boolean(player.disponibleHoy);

      if (appliedFilters.soloDisponiblesHoy && !playerIsAvailableToday) {
        return false;
      }

      if (!proximityFilter.enabled && appliedFilters.localidades.length > 0) {
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

    const sortedPlayers =
      proximityFilter.enabled && proximityFilter.userCoordinates
        ? [...visiblePlayers].sort((first, second) => {
            const firstDistance = Number.isFinite(first.distanceKm)
              ? first.distanceKm
              : Number.MAX_SAFE_INTEGER;
            const secondDistance = Number.isFinite(second.distanceKm)
              ? second.distanceKm
              : Number.MAX_SAFE_INTEGER;
            const firstIsInsideRadius = firstDistance <= proximityFilter.radiusKm;
            const secondIsInsideRadius = secondDistance <= proximityFilter.radiusKm;

            if (firstIsInsideRadius !== secondIsInsideRadius) {
              return firstIsInsideRadius ? -1 : 1;
            }

            return firstDistance - secondDistance;
          })
        : visiblePlayers;

    const ownPlayerFromUser = buildOwnPlayerFromUser(userData);
    const ownPlayers = sortedPlayers.filter((player) => isOwnPlayer(player, userData));
    const otherPlayers = sortedPlayers.filter((player) => !isOwnPlayer(player, userData));

    if (!ownPlayerFromUser) {
      return [...ownPlayers, ...otherPlayers];
    }

    return [ownPlayerFromUser, ...otherPlayers];
  }, [appliedFilters, playersWithDistance, proximityFilter, query, userData]);

  const handleOpenFilters = () => {
    setDraftSexo(appliedFilters.sexo);
    setDraftCategorias(appliedFilters.categorias);
    setDraftSoloDisponiblesHoy(appliedFilters.soloDisponiblesHoy);
  };

  const handleApplyFilters = async () => {
    setAppliedFilters((current) => ({
      ...current,
      sexo: draftSexo,
      categorias: draftCategorias,
      soloDisponiblesHoy: draftSoloDisponiblesHoy,
    }));
  };

  const handleUseCurrentLocation = async () => {
    try {
      setLocatingUser(true);
      const userCoordinates = await requestCurrentLocation();

      setProximityFilter((current) => ({
        ...current,
        enabled: true,
        userCoordinates,
      }));
      setLocationActionsVisible(false);
      setFeedback({
        visible: true,
        title: "Ubicacion activada",
        message: `Vamos a priorizar jugadores dentro de ${proximityFilter.radiusKm} km.`,
        tone: "success",
      });
    } catch (error) {
      setFeedback({
        visible: true,
        title: "No pudimos usar tu ubicacion",
        message: error?.message || "Revisa los permisos de ubicacion del telefono.",
        tone: "danger",
      });
    } finally {
      setLocatingUser(false);
    }
  };

  const handleDisableProximityFilter = () => {
    setProximityFilter((current) => ({
      ...current,
      enabled: false,
      userCoordinates: null,
    }));
    setLocationActionsVisible(false);
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
        <View style={styles.filterLocationRow}>
          <SectionFilterBar
            containerStyle={styles.headerFilterBar}
            extraSummary={hasActiveFilters ? "Activo" : undefined}
            hideLeadingIcon
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
          <Pressable
            onPress={() => setLocationActionsVisible(true)}
            style={({ pressed }) => [
              styles.locationActionButton,
              proximityFilter.enabled ? styles.locationActionButtonActive : null,
              pressed ? styles.favoriteInlineButtonPressed : null,
            ]}
          >
            <Ionicons
              color={proximityFilter.enabled ? colors.surface : colors.primaryDark}
              name="location-outline"
              size={20}
            />
          </Pressable>
        </View>
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
            <View style={styles.searchWrapInner}>
              <Ionicons color={colors.muted} name="search-outline" size={18} />
            <TextInput
              onChangeText={setQuery}
              placeholder="Buscar por nombre y apellido"
              placeholderTextColor={colors.muted}
              multiline={false}
              style={styles.searchInput}
              value={query}
            />
              <Pressable
                onPress={() => {
                  handleOpenFilters();
                  setPlayerSearchFiltersVisible(true);
                }}
                style={[
                  styles.searchFilterInlineButton,
                  hasActiveSearchFilters ? styles.searchFilterInlineButtonActive : null,
                ]}
              >
                <Ionicons
                  color={hasActiveSearchFilters ? colors.surface : colors.primaryDark}
                  name="options-outline"
                  size={16}
                />
              </Pressable>
            </View>
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

      <Modal
        animationType="fade"
        onRequestClose={() => setPlayerSearchFiltersVisible(false)}
        transparent
        visible={playerSearchFiltersVisible}
      >
        <View style={styles.confirmOverlay}>
          <Pressable
            onPress={() => setPlayerSearchFiltersVisible(false)}
            style={styles.confirmBackdrop}
          />
          <View style={styles.searchFiltersCard}>
            <Text style={styles.confirmTitle}>Filtrar jugadores</Text>

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

            <Text style={styles.modalLabel}>Categoria</Text>
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

            <Text style={styles.modalLabel}>Disponibilidad</Text>
            <Pressable
              onPress={() => setDraftSoloDisponiblesHoy((current) => !current)}
              style={[
                styles.searchAvailabilityToggle,
                draftSoloDisponiblesHoy ? styles.searchAvailabilityToggleActive : null,
              ]}
            >
              <Ionicons
                color={draftSoloDisponiblesHoy ? "#1F6E4B" : colors.primaryDark}
                name={draftSoloDisponiblesHoy ? "checkmark-circle" : "time-outline"}
                size={18}
              />
              <Text
                style={[
                  styles.searchAvailabilityToggleText,
                  draftSoloDisponiblesHoy ? styles.searchAvailabilityToggleTextActive : null,
                ]}
              >
                Mostrar solo los disponibles hoy
              </Text>
            </Pressable>

            <View style={styles.searchFilterActions}>
              <Pressable
                onPress={() => {
                  setDraftSexo("Todos");
                  setDraftCategorias([]);
                  setDraftSoloDisponiblesHoy(false);
                  setAppliedFilters((current) => ({
                    ...current,
                    sexo: "Todos",
                    categorias: [],
                    soloDisponiblesHoy: false,
                  }));
                  setPlayerSearchFiltersVisible(false);
                }}
                style={styles.searchFilterSecondaryButton}
              >
                <Text style={styles.searchFilterSecondaryButtonText}>Limpiar</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  handleApplyFilters();
                  setPlayerSearchFiltersVisible(false);
                }}
                style={styles.searchFilterPrimaryButton}
              >
                <Text style={styles.searchFilterPrimaryButtonText}>Aplicar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={() => setLocationActionsVisible(false)}
        transparent
        visible={locationActionsVisible}
      >
        <View style={styles.confirmOverlay}>
          <Pressable
            onPress={() => setLocationActionsVisible(false)}
            style={styles.confirmBackdrop}
          />
          <View style={styles.locationOptionsCard}>
            <Text style={styles.confirmTitle}>Ubicacion</Text>
            <Text style={styles.locationOptionsSubtitle}>
              Usa tu ubicacion para priorizar jugadores cercanos.
            </Text>
            <Text style={styles.locationOptionsLabel}>Radio de busqueda</Text>
            <View style={styles.radiusOptionsRow}>
              {PROXIMITY_RADIUS_OPTIONS.map((radiusKm) => {
                const isSelected = proximityFilter.radiusKm === radiusKm;

                return (
                  <Pressable
                    key={radiusKm}
                    onPress={() =>
                      setProximityFilter((current) => ({
                        ...current,
                        radiusKm,
                      }))
                    }
                    style={[
                      styles.radiusOption,
                      isSelected ? styles.radiusOptionActive : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.radiusOptionText,
                        isSelected ? styles.radiusOptionTextActive : null,
                      ]}
                    >
                      {radiusKm} km
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              disabled={locatingUser}
              onPress={handleUseCurrentLocation}
              style={[
                styles.locationPrimaryButton,
                locatingUser ? styles.locationButtonDisabled : null,
              ]}
            >
              <Text style={styles.locationPrimaryButtonText}>
                {locatingUser ? "BUSCANDO..." : "USAR MI UBICACION"}
              </Text>
            </Pressable>
            <Pressable onPress={handleDisableProximityFilter} style={styles.locationSecondaryButton}>
              <Text style={styles.locationSecondaryButtonText}>VOLVER A LOCALIDAD</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <FeedbackModal
        message={feedback.message}
        onClose={() => setFeedback((current) => ({ ...current, visible: false }))}
        title={feedback.title}
        tone={feedback.tone}
        visible={feedback.visible}
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
  filterLocationRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    marginBottom: 2,
    marginHorizontal: spacing.md,
  },
  headerFilterBar: {
    flex: 1,
    marginHorizontal: 0,
    marginTop: 0,
    minHeight: 38,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    shadowOpacity: 0.02,
    elevation: 1,
  },
  locationActionButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.02,
    shadowRadius: 8,
    width: 42,
    elevation: 1,
  },
  locationActionButtonActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
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
  searchWrapInner: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 48,
    paddingLeft: spacing.md,
    paddingRight: 6,
  },
  searchInput: {
    color: colors.text,
    fontSize: 13,
    flex: 1,
    includeFontPadding: false,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: 0,
    textAlignVertical: "center",
  },
  searchFilterInlineButton: {
    alignItems: "center",
    backgroundColor: "#F6FAF8",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  searchFilterInlineButtonActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
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
  searchFiltersCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg,
    width: "100%",
  },
  searchAvailabilityToggle: {
    alignItems: "center",
    backgroundColor: "#F7FBF9",
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  searchAvailabilityToggleActive: {
    backgroundColor: "#E9F7EF",
    borderColor: "#B8DEC8",
  },
  searchAvailabilityToggleText: {
    color: colors.text,
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
  },
  searchAvailabilityToggleTextActive: {
    color: "#1F6E4B",
  },
  searchFilterActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  searchFilterPrimaryButton: {
    alignItems: "center",
    backgroundColor: colors.primaryDark,
    borderRadius: 16,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  searchFilterPrimaryButtonText: {
    color: colors.surface,
    fontSize: 13,
    fontWeight: "800",
  },
  searchFilterSecondaryButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  searchFilterSecondaryButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
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
  confirmTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
  },
  locationOptionsCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg,
    width: "100%",
  },
  locationOptionsSubtitle: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
    textAlign: "center",
  },
  locationOptionsLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "uppercase",
  },
  radiusOptionsRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  radiusOption: {
    alignItems: "center",
    backgroundColor: "#F2F6F4",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 34,
  },
  radiusOptionActive: {
    backgroundColor: "#E1F7EC",
    borderColor: colors.primary,
  },
  radiusOptionText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
  },
  radiusOptionTextActive: {
    color: colors.primaryDark,
  },
  locationPrimaryButton: {
    alignItems: "center",
    backgroundColor: colors.primaryDark,
    borderRadius: 16,
    justifyContent: "center",
    minHeight: 44,
  },
  locationPrimaryButtonText: {
    color: colors.surface,
    fontSize: 13,
    fontWeight: "900",
  },
  locationSecondaryButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 42,
  },
  locationSecondaryButtonText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
  },
  locationButtonDisabled: {
    opacity: 0.65,
  },
});

