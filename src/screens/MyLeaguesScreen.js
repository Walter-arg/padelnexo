import { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
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
import { playerCategories } from "../data/profileOptions";
import {
  getLeagueComplexOptions,
  listLeagues,
} from "../services/leaguesService";
import { isApprovedOrganizer } from "../services/roleService";

const SEX_FILTER_OPTIONS = ["Todos", "Masculino", "Femenino", "Mixto"];
const COMPLEX_NAME_COLORS = ["#24A8D8", "#5B63C8", "#B965B8"];
const DAY_FILTER_OPTIONS = [
  { label: "Todos", value: "" },
  { label: "Lunes", value: "monday" },
  { label: "Martes", value: "tuesday" },
  { label: "Miercoles", value: "wednesday" },
  { label: "Jueves", value: "thursday" },
  { label: "Viernes", value: "friday" },
  { label: "Sabado", value: "saturday" },
  { label: "Domingo", value: "sunday" },
];

function normalizeText(value = "") {
  return String(value).trim().toLowerCase();
}

export default function MyLeaguesScreen({ navigation }) {
  const { userData } = useAuth();
  const currentUserId = userData?.uid || "";
  const canManageOwnLeagues = isApprovedOrganizer(userData);
  const [loading, setLoading] = useState(true);
  const [leaguesSource, setLeaguesSource] = useState([]);
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [filters, setFilters] = useState({
    sexo: "Todos",
    categoria: "",
    complejo: "",
    dia: "",
  });
  const [draftSexo, setDraftSexo] = useState("Todos");
  const [draftCategoria, setDraftCategoria] = useState("");
  const [draftComplejo, setDraftComplejo] = useState("");
  const [draftDia, setDraftDia] = useState("");

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      const loadOwnLeagues = async () => {
        try {
          setLoading(true);
          const leagues = await listLeagues();

          if (!isMounted) {
            return;
          }

          setLeaguesSource(
            leagues.filter(
              (league) =>
                normalizeText(league.organizerId) === normalizeText(currentUserId)
            )
          );
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

      loadOwnLeagues();

      return () => {
        isMounted = false;
      };
    }, [currentUserId])
  );

  const complexOptions = useMemo(
    () => getLeagueComplexOptions(leaguesSource, []),
    [leaguesSource]
  );

  const complexColorMap = useMemo(
    () =>
      complexOptions.reduce((map, option, index) => {
        map[option.value] = COMPLEX_NAME_COLORS[index % COMPLEX_NAME_COLORS.length];
        return map;
      }, {}),
    [complexOptions]
  );

  const filteredLeagues = useMemo(() => {
    return leaguesSource.filter((league) => {
      if (filters.sexo !== "Todos" && league.sexo !== filters.sexo) {
        return false;
      }

      if (
        filters.categoria &&
        !normalizeText(league.categoria).includes(normalizeText(filters.categoria))
      ) {
        return false;
      }

      if (filters.complejo && league.complejoNombre !== filters.complejo) {
        return false;
      }

      if (filters.dia && league.scheduleConfig?.dayKey !== filters.dia) {
        return false;
      }

      return true;
    });
  }, [filters, leaguesSource]);

  const activeFilterCount = useMemo(() => {
    let total = 0;

    if (filters.sexo !== "Todos") {
      total += 1;
    }

    if (filters.categoria) {
      total += 1;
    }

    if (filters.complejo) {
      total += 1;
    }

    if (filters.dia) {
      total += 1;
    }

    return total;
  }, [filters]);

  const handleOpenFilters = () => {
    setDraftSexo(filters.sexo);
    setDraftCategoria(filters.categoria);
    setDraftComplejo(filters.complejo);
    setDraftDia(filters.dia);
    setFiltersVisible(true);
  };

  const handleApplyFilters = () => {
    setFilters({
      sexo: draftSexo,
      categoria: draftCategoria,
      complejo: draftComplejo,
      dia: draftDia,
    });
    setFiltersVisible(false);
  };

  const handleOpenLeague = (league) => {
    if (!league?.id) {
      return;
    }

    navigation.navigate("LeagueDetail", {
      leagueId: league.id,
      leagueName: league.nombre,
      leagueComplex: league.complejoNombre || "",
      leagueCategory: league.categoria || "",
      leagueSex: league.sexo || "",
      leagueCity: league.localidad || "",
      leagueProvince: league.provincia || "",
      playersCount: Array.isArray(league.players) ? league.players.length : 0,
    });
  };

  const emptyTitle = loading ? "Cargando tus ligas..." : "Todavia no creaste ligas";
  const emptyText = loading
    ? "Estamos sincronizando las ligas que organizas."
    : "Cuando crees una liga como organizador, la vas a ver y gestionar desde aca.";

  if (!canManageOwnLeagues) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <SectionHeader onBack={() => navigation.goBack()} subtitle="Mis ligas" />
        <View style={styles.container}>
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Acceso restringido</Text>
            <Text style={styles.emptyText}>
              Esta pantalla esta disponible solo para perfiles organizadores.
            </Text>
          </View>
        </View>
        <BottomQuickActionsBar />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader onBack={() => navigation.goBack()} subtitle="Mis ligas" />
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />

      <View style={styles.container}>
        <Pressable
          onPress={() => navigation.navigate("CreateLeague")}
          style={({ pressed }) => [
            styles.createLeagueButton,
            pressed ? styles.createLeagueButtonPressed : null,
          ]}
        >
          <View style={styles.createLeagueIconWrap}>
            <Ionicons color={colors.surface} name="add" size={18} />
          </View>
          <View style={styles.createLeagueTextWrap}>
            <Text style={styles.createLeagueTitle}>CREAR LIGA</Text>
          </View>
          <Ionicons color={colors.surface} name="chevron-forward" size={16} />
        </Pressable>

        <Pressable
          onPress={handleOpenFilters}
          style={({ pressed }) => [
            styles.filterBar,
            pressed ? styles.filterBarPressed : null,
          ]}
        >
          <View style={styles.filterBarHeader}>
            <View style={styles.filterBarTitleWrap}>
              <View style={styles.filterBarIconWrap}>
                <Ionicons color={colors.primaryDark} name="options-outline" size={18} />
              </View>
              <View style={styles.filterBarTextWrap}>
                <Text style={styles.filterBarEyebrow}>Gestion del organizador</Text>
                <Text numberOfLines={1} style={styles.filterBarTitle}>
                  Filtrar por sexo, categoria o complejo
                </Text>
              </View>
            </View>
            {activeFilterCount > 0 ? (
              <View style={styles.summaryChipSecondary}>
                <Text style={styles.summaryChipSecondaryText}>
                  {activeFilterCount} activo{activeFilterCount > 1 ? "s" : ""}
                </Text>
              </View>
            ) : (
              <Ionicons color={colors.primaryDark} name="chevron-forward" size={18} />
            )}
          </View>
        </Pressable>

        <FlatList
          contentContainerStyle={styles.listContent}
          data={filteredLeagues}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>{emptyTitle}</Text>
              <Text style={styles.emptyText}>{emptyText}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => handleOpenLeague(item)}
              style={({ pressed }) => [pressed ? styles.cardPressed : null]}
            >
              <LeagueCard
                complexColor={complexColorMap[item.complejoNombre]}
                hideFavoriteAction
                league={item}
                onDetails={() => handleOpenLeague(item)}
                showProgressStatus
              />
            </Pressable>
          )}
          showsVerticalScrollIndicator={false}
        />
      </View>

      <Modal
        animationType="slide"
        onRequestClose={() => setFiltersVisible(false)}
        transparent
        visible={filtersVisible}
      >
        <View style={styles.modalOverlay}>
          <Pressable onPress={() => setFiltersVisible(false)} style={styles.modalBackdrop} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Filtros de Mis Ligas</Text>

            <ScrollView showsVerticalScrollIndicator={false}>
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
                <Pressable
                  onPress={() => setDraftCategoria("")}
                  style={[styles.filterChip, !draftCategoria && styles.filterChipActive]}
                >
                  <Text
                    style={[styles.filterChipText, !draftCategoria && styles.filterChipTextActive]}
                  >
                    Todas
                  </Text>
                </Pressable>
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

              <Text style={styles.modalLabel}>Dia de juego</Text>
              <View style={styles.modalRow}>
                {DAY_FILTER_OPTIONS.map((day) => (
                  <Pressable
                    key={day.value || "all-days"}
                    onPress={() => setDraftDia(day.value)}
                    style={[styles.filterChip, draftDia === day.value && styles.filterChipActive]}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        draftDia === day.value && styles.filterChipTextActive,
                      ]}
                    >
                      {day.label}
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
                {complexOptions.map((option) => (
                  <Pressable
                    key={option.value}
                    onPress={() =>
                      setDraftComplejo((current) => (current === option.value ? "" : option.value))
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
                ))}
              </View>
            </ScrollView>

            <View style={styles.actionsRow}>
              <Pressable onPress={() => setFiltersVisible(false)} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Cerrar</Text>
              </Pressable>
              <Pressable onPress={handleApplyFilters} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>Aplicar filtros</Text>
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
  createLeagueButton: {
    alignItems: "center",
    backgroundColor: colors.primaryDark,
    borderRadius: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 4,
  },
  createLeagueButtonPressed: {
    opacity: 0.94,
  },
  createLeagueIconWrap: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.16)",
    borderRadius: 12,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  createLeagueTextWrap: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  createLeagueTitle: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: "800",
  },
  filterBar: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: spacing.sm,
    minHeight: 54,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 3,
  },
  filterBarPressed: {
    opacity: 0.95,
  },
  filterBarHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  filterBarTitleWrap: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
  },
  filterBarIconWrap: {
    alignItems: "center",
    backgroundColor: "#EAF6F1",
    borderRadius: 12,
    height: 28,
    justifyContent: "center",
    marginRight: 8,
    width: 28,
  },
  filterBarTextWrap: {
    flex: 1,
  },
  filterBarEyebrow: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.2,
    textTransform: "uppercase",
  },
  filterBarTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 0,
  },
  summaryChipSecondary: {
    alignItems: "center",
    backgroundColor: "#E8F3FF",
    borderRadius: 999,
    justifyContent: "center",
    marginLeft: spacing.sm,
    minHeight: 24,
    paddingHorizontal: 9,
  },
  summaryChipSecondaryText: {
    color: "#24537D",
    fontSize: 10,
    fontWeight: "700",
  },
  listContent: {
    paddingBottom: BOTTOM_QUICK_ACTIONS_SPACE,
    paddingTop: spacing.sm,
  },
  cardPressed: {
    opacity: 0.96,
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
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: "82%",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
  },
  modalLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    marginBottom: spacing.xs,
    marginTop: spacing.md,
    textTransform: "uppercase",
  },
  modalRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
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
  actionsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 16,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
  },
  primaryButtonText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: "800",
  },
});

