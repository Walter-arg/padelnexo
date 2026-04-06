import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";

import BottomQuickActionsBar, {
  BOTTOM_QUICK_ACTIONS_SPACE,
} from "../components/BottomQuickActionsBar";
import FeedbackModal from "../components/FeedbackModal";
import LeagueCard from "../components/LeagueCard";
import SectionFilterBar from "../components/SectionFilterBar";
import SectionHeader from "../components/SectionHeader";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import { playerCategories } from "../data/profileOptions";
import {
  applyLeagueFavoriteFlags,
  subscribeToFavoriteLeagueIds,
  toggleLeagueFavorite,
} from "../services/leagueFavoritesService";
import {
  archiveLeague,
  getLeagueComplexOptions,
  listLeagues,
} from "../services/leaguesService";
import { isApprovedOrganizer } from "../services/roleService";

const SEX_FILTER_OPTIONS = ["Todos", "Masculino", "Femenino", "Mixto"];

function normalizeText(value = "") {
  return String(value).trim().toLowerCase();
}

export default function LigasHubScreen({ navigation }) {
  const { userData } = useAuth();
  const currentUserId = userData?.uid;
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [leaguesSource, setLeaguesSource] = useState([]);
  const [favoriteLeagueIds, setFavoriteLeagueIds] = useState(new Set());
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [feedback, setFeedback] = useState({
    visible: false,
    title: "",
    message: "",
    tone: "default",
  });

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
    categoria: "",
    complejo: "",
    localidades: userLocalidad ? [userLocalidad] : [],
  });
  const [draftSexo, setDraftSexo] = useState("Todos");
  const [draftCategoria, setDraftCategoria] = useState("");
  const [draftComplejo, setDraftComplejo] = useState("");
  const canCreateLeague = isApprovedOrganizer(userData);

  const hasActiveFilters =
    query.trim().length > 0 ||
    appliedFilters.sexo !== "Todos" ||
    Boolean(appliedFilters.categoria) ||
    Boolean(appliedFilters.complejo);

  useEffect(() => {
    let isCancelled = false;

    const loadLeagues = async () => {
      try {
        setLoading(true);
        setLoadError("");
        const leagues = await listLeagues();

        if (isCancelled) {
          return;
        }

        setLeaguesSource(applyLeagueFavoriteFlags(leagues, favoriteLeagueIds));
      } catch (error) {
        if (!isCancelled) {
          setLoadError("No pudimos cargar las ligas por ahora.");
          setLeaguesSource([]);
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    loadLeagues();

    return () => {
      isCancelled = true;
    };
  }, [favoriteLeagueIds, reloadKey]);

  useFocusEffect(
    useCallback(
      () => {
        setReloadKey((current) => current + 1);
      },
      []
    )
  );

  useEffect(() => {
    const unsubscribe = subscribeToFavoriteLeagueIds({
      currentUserId,
      onData: (favoriteIds) => {
        setFavoriteLeagueIds(favoriteIds);
        setLeaguesSource((current) => applyLeagueFavoriteFlags(current, favoriteIds));
      },
      onError: () => setFavoriteLeagueIds(new Set()),
    });

    return unsubscribe;
  }, [currentUserId]);

  const leaguesFiltered = useMemo(() => {
    const normalizedQuery = normalizeText(query);
    const filtered = leaguesSource.filter((league) => {
      if (appliedFilters.sexo !== "Todos" && league.sexo !== appliedFilters.sexo) {
        return false;
      }

      if (appliedFilters.categoria && league.categoria !== appliedFilters.categoria) {
        return false;
      }

      if (appliedFilters.complejo && league.complejoNombre !== appliedFilters.complejo) {
        return false;
      }

      if (appliedFilters.localidades.length > 0) {
        const sameCity = appliedFilters.localidades.some(
          (location) => normalizeText(league.localidad) === normalizeText(location.nombre)
        );

        if (!sameCity) {
          return false;
        }
      }

      if (
        normalizedQuery &&
        !normalizeText(league.nombre || league.name || "").includes(normalizedQuery)
      ) {
        return false;
      }

      return true;
    });

    if (activeTab === "mine") {
      return filtered.filter((league) => league.esMiLiga);
    }

    return filtered;
  }, [activeTab, appliedFilters, leaguesSource, query]);

  const showFeedback = (title, message, tone = "default") => {
    setFeedback({
      visible: true,
      title,
      message,
      tone,
    });
  };

  const handleOpenFilters = () => {
    setDraftSexo(appliedFilters.sexo);
    setDraftCategoria(appliedFilters.categoria);
    setDraftComplejo(appliedFilters.complejo);
  };

  const handleApplyFilters = async () => {
    setAppliedFilters((current) => ({
      ...current,
      sexo: draftSexo,
      categoria: draftCategoria,
      complejo: draftComplejo,
    }));
  };

  const handleToggleFavorite = async (league) => {
    try {
      await toggleLeagueFavorite(currentUserId, league);
    } catch (error) {
      showFeedback(
        "No pudimos actualizar mis ligas",
        "Intenta nuevamente en unos instantes.",
        "danger"
      );
    }
  };

  const handleDeleteLeague = (league) => {
    Alert.alert(
      "Eliminar liga",
      `Vas a eliminar ${league.nombre}. Esta accion la oculta de la app.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            try {
              await archiveLeague(league.id);
              setLeaguesSource((current) =>
                current.filter((currentLeague) => currentLeague.id !== league.id)
              );
              showFeedback("Liga eliminada", "La liga se elimino correctamente.", "success");
            } catch (error) {
              showFeedback(
                "No pudimos eliminar la liga",
                "Intenta nuevamente en unos instantes.",
                "danger"
              );
            }
          },
        },
      ]
    );
  };

  const handleCreateLeague = () => {
    if (!canCreateLeague) {
      showFeedback(
        "Acceso restringido",
        "Solo los organizadores pueden crear liga. Solicita acceso al administrador desde tu perfil."
      );
      return;
    }

    navigation.navigate("CreateLeague");
  };

  const emptyTitle = loading
    ? "Cargando ligas..."
    : activeTab === "mine"
      ? "Todavia no marcaste ligas"
      : "No encontramos ligas";

  const emptyText = loading
    ? "Estamos sincronizando las ligas disponibles."
    : activeTab === "mine"
      ? "Suma una liga con la estrella para verla en Mis ligas."
      : loadError || "Ajusta los filtros o crea una liga nueva cuando la funcion este lista.";

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader onBack={() => navigation.goBack()} subtitle="Ligas">
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
          renderExtraContent={({ draftLocations }) => {
            const modalComplexOptions = getLeagueComplexOptions(leaguesSource, draftLocations);

            return (
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

                <Text style={styles.modalLabel}>Categoria</Text>
                <View style={styles.modalRow}>
                  {playerCategories.map((category) => (
                    <Pressable
                      key={category}
                      onPress={() =>
                        setDraftCategoria((current) => (current === category ? "" : category))
                      }
                      style={[
                        styles.filterChip,
                        draftCategoria === category && styles.filterChipActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          draftCategoria === category && styles.filterChipTextActive,
                        ]}
                      >
                        {category}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.modalLabel}>Complejo</Text>
                <View style={styles.modalRow}>
                  <Pressable
                    onPress={() => setDraftComplejo("")}
                    style={[styles.filterChip, !draftComplejo && styles.filterChipActive]}
                  >
                    <Text
                      style={[styles.filterChipText, !draftComplejo && styles.filterChipTextActive]}
                    >
                      Todos
                    </Text>
                  </Pressable>
                  {modalComplexOptions.length > 0 ? (
                    modalComplexOptions.map((option) => (
                      <Pressable
                        key={option.value}
                        onPress={() =>
                          setDraftComplejo((current) =>
                            current === option.value ? "" : option.value
                          )
                        }
                        style={[
                          styles.filterChip,
                          draftComplejo === option.value && styles.filterChipActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.filterChipText,
                            draftComplejo === option.value && styles.filterChipTextActive,
                          ]}
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    ))
                  ) : (
                    <View style={styles.placeholderField}>
                      <Ionicons color={colors.muted} name="business-outline" size={16} />
                      <Text style={styles.placeholderFieldText}>
                        El selector de complejo se habilita segun las localidades activas
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            );
          }}
          userLocation={userLocalidad}
        />
      </SectionHeader>
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />

      <View style={styles.container}>
        <View style={styles.topSearchRow}>
          <View style={styles.searchWrap}>
            <TextInput
              onChangeText={setQuery}
              placeholder="Buscar por nombre de liga"
              placeholderTextColor={colors.muted}
              style={styles.searchInput}
              value={query}
            />
          </View>

          <Pressable
            onPress={() => setActiveTab((current) => (current === "mine" ? "all" : "mine"))}
            style={({ pressed }) => [
              styles.favoriteInlineButton,
              activeTab === "mine" && styles.favoriteInlineButtonActive,
              pressed && styles.favoriteInlineButtonPressed,
            ]}
          >
            <Ionicons
              color={activeTab === "mine" ? colors.surface : "#B87407"}
              name={activeTab === "mine" ? "star" : "star-outline"}
              size={18}
            />
            <Text
              style={[
                styles.favoriteInlineButtonText,
                activeTab === "mine" && styles.favoriteInlineButtonTextActive,
              ]}
            >
              Favoritas
            </Text>
          </Pressable>
        </View>

        <Pressable
          onPress={handleCreateLeague}
          style={({ pressed }) => [
            styles.createLeagueButton,
            !canCreateLeague && styles.createLeagueButtonDisabled,
            pressed && styles.createLeagueButtonPressed,
          ]}
        >
          <View
            style={[
              styles.createLeagueIconWrap,
              !canCreateLeague && styles.createLeagueIconWrapDisabled,
            ]}
          >
            <Ionicons color={colors.surface} name="add" size={20} />
          </View>
          <View style={styles.createLeagueTextWrap}>
            <Text style={styles.createLeagueTitle}>Crear liga</Text>
            <Text style={styles.createLeagueSubtitle}>
              {canCreateLeague
                ? "Organiza una nueva competencia para tu comunidad"
                : "Disponible para cuentas con perfil de organizador"}
            </Text>
          </View>
          <Ionicons color={colors.surface} name="chevron-forward" size={18} />
        </Pressable>

        <FlatList
          contentContainerStyle={styles.listContent}
          data={leaguesFiltered}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>{emptyTitle}</Text>
              <Text style={styles.emptyText}>{emptyText}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <LeagueCard
              league={item}
              onDelete={
                item.organizerId && item.organizerId === currentUserId
                  ? () => handleDeleteLeague(item)
                  : undefined
              }
              onToggleFavorite={() => handleToggleFavorite(item)}
            />
          )}
          showsVerticalScrollIndicator={false}
        />
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
  favoriteInlineButtonActive: {
    backgroundColor: "#B87407",
    borderColor: "#B87407",
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
  favoriteInlineButtonTextActive: {
    color: colors.surface,
  },
  createLeagueButton: {
    alignItems: "center",
    backgroundColor: colors.primaryDark,
    borderRadius: 24,
    flexDirection: "row",
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 4,
  },
  createLeagueButtonDisabled: {
    backgroundColor: "#7EA495",
  },
  createLeagueButtonPressed: {
    opacity: 0.94,
  },
  createLeagueIconWrap: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
    borderRadius: 16,
    height: 38,
    justifyContent: "center",
    marginRight: spacing.sm,
    width: 38,
  },
  createLeagueIconWrapDisabled: {
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  createLeagueTextWrap: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  createLeagueTitle: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: "800",
  },
  createLeagueSubtitle: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
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
    textAlign: "center",
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
