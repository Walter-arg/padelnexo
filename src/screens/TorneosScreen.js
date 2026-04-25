import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
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
import SectionHeader from "../components/SectionHeader";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import {
  findTournamentRegistrationsByPlayer,
  listTournamentsWithRegistrationCounts,
} from "../services/tournamentsService";
import { isApprovedOrganizer } from "../services/roleService";

const STATUS_FILTER_OPTIONS = [
  { label: "Todos", value: "all" },
  { label: "Abiertos", value: "open" },
  { label: "En juego", value: "in_progress" },
  { label: "Finalizados", value: "finished" },
];

const DAY_LABELS = {
  monday: "Lun",
  tuesday: "Mar",
  wednesday: "Mie",
  thursday: "Jue",
  friday: "Vie",
  saturday: "Sab",
  sunday: "Dom",
};

const STATUS_META = {
  draft: {
    label: "Borrador",
    tint: "#F3F5F7",
    border: "#D4DBE2",
    accent: "#667482",
  },
  published: {
    label: "Publicado",
    tint: "#EEF5FF",
    border: "#BED4F7",
    accent: "#356CB8",
  },
  registration_open: {
    label: "Inscripcion abierta",
    tint: "#EEF9F1",
    border: "#B7DFBF",
    accent: "#237547",
  },
  registration_closed: {
    label: "Inscripcion cerrada",
    tint: "#FFF6EA",
    border: "#E8CF9B",
    accent: "#9B6A18",
  },
  building: {
    label: "Armando",
    tint: "#F2F0FF",
    border: "#CDC6F5",
    accent: "#6751B6",
  },
  in_progress: {
    label: "En juego",
    tint: "#EAF6FF",
    border: "#B5D8F0",
    accent: "#1C76A7",
  },
  finished: {
    label: "Finalizado",
    tint: "#F2F5F7",
    border: "#CDD6DC",
    accent: "#576773",
  },
  cancelled: {
    label: "Cancelado",
    tint: "#FFF0F0",
    border: "#E7B8B8",
    accent: "#B24343",
  },
};

function normalizeText(value = "") {
  return String(value || "").trim().toLowerCase();
}

function sortByUpdatedAt(items = []) {
  return [...items].sort((first, second) => {
    const secondValue = Number(second?.updatedAtMillis || second?.createdAtMillis || 0);
    const firstValue = Number(first?.updatedAtMillis || first?.createdAtMillis || 0);
    return secondValue - firstValue;
  });
}

function formatTournamentDays(tournament = {}) {
  const days = Array.isArray(tournament.groupStageDays) && tournament.groupStageDays.length
    ? tournament.groupStageDays
    : Array.isArray(tournament.playDays)
    ? tournament.playDays
    : [];

  if (!days.length) {
    return "A confirmar";
  }

  return days.map((dayKey) => DAY_LABELS[dayKey] || dayKey).join(" / ");
}

function getTournamentStatusMeta(status = "") {
  return STATUS_META[status] || STATUS_META.draft;
}

function getStatusFilterMatch(tournament = {}, statusFilter = "all") {
  if (statusFilter === "all") {
    return tournament.status !== "cancelled";
  }

  if (statusFilter === "open") {
    return tournament.status === "published" || tournament.status === "registration_open";
  }

  if (statusFilter === "in_progress") {
    return tournament.status === "building" || tournament.status === "in_progress";
  }

  if (statusFilter === "finished") {
    return tournament.status === "finished" || tournament.status === "cancelled";
  }

  return true;
}

function getRegistrationsCountMap(registrationsByTournament = []) {
  return registrationsByTournament.reduce((accumulator, entry) => {
    const tournamentId = entry?.tournament?.id || "";

    if (!tournamentId) {
      return accumulator;
    }

    accumulator[tournamentId] = {
      registration: entry.registration,
    };

    return accumulator;
  }, {});
}

function buildTournamentCardData(tournament = {}, registrationMeta = null) {
  const registrationsCount = Number(tournament.registrationsCount || 0);
  const maxPairs = Number(tournament.maxPairs || 0);

  return {
    ...tournament,
    userRegistration: registrationMeta?.registration || null,
    tournamentDaysLabel: formatTournamentDays(tournament),
    occupancyLabel:
      maxPairs > 0 ? `${registrationsCount}/${maxPairs} parejas` : `${registrationsCount} parejas`,
    categoryLabel:
      tournament?.compositionConfig?.label ||
      tournament?.compositionLabel ||
      "Categoria a confirmar",
  };
}

function TournamentCard({ item, onPress }) {
  const statusMeta = getTournamentStatusMeta(item.status);
  const registration = item.userRegistration;

  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleWrap}>
          <Text numberOfLines={2} style={styles.cardTitle}>
            {item.name || "Torneo"}
          </Text>
          <Text numberOfLines={1} style={styles.cardVenue}>
            {item.venueLabel || "Sede a confirmar"}
          </Text>
        </View>

        <View
          style={[
            styles.statusPill,
            {
              backgroundColor: statusMeta.tint,
              borderColor: statusMeta.border,
            },
          ]}
        >
          <Text style={[styles.statusPillText, { color: statusMeta.accent }]}>
            {statusMeta.label}
          </Text>
        </View>
      </View>

      <View style={styles.cardMetaGrid}>
        <View style={styles.metaBox}>
          <Text style={styles.metaLabel}>Categoria</Text>
          <Text numberOfLines={2} style={styles.metaValue}>
            {item.categoryLabel}
          </Text>
        </View>

        <View style={styles.metaBox}>
          <Text style={styles.metaLabel}>Dias</Text>
          <Text numberOfLines={2} style={styles.metaValue}>
            {item.tournamentDaysLabel}
          </Text>
        </View>

        <View style={styles.metaBox}>
          <Text style={styles.metaLabel}>Cupos</Text>
          <Text numberOfLines={1} style={styles.metaValue}>
            {item.occupancyLabel}
          </Text>
        </View>

        <View style={styles.metaBox}>
          <Text style={styles.metaLabel}>Formato</Text>
          <Text numberOfLines={1} style={styles.metaValue}>
            {item.tournamentFormat === "groups_knockout" ? "Zonas + llaves" : "A confirmar"}
          </Text>
        </View>
      </View>

      {registration ? (
        <View style={styles.registrationRow}>
          <Ionicons color={colors.primaryDark} name="people-outline" size={16} />
          <Text numberOfLines={1} style={styles.registrationText}>
            Tu pareja: {registration.pairLabel}
          </Text>
          <Text style={styles.registrationStatus}>
            {registration.status === "confirmed"
              ? "Confirmada"
              : registration.status === "in_review"
              ? "En revision"
              : registration.status === "rejected"
              ? "Rechazada"
              : "Pendiente"}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function TournamentSectionHeader({ description, title }) {
  return (
    <View style={styles.sectionHeaderCard}>
      <Text style={styles.sectionHeaderTitle}>{title}</Text>
      {description ? <Text style={styles.sectionHeaderText}>{description}</Text> : null}
    </View>
  );
}

function EmptyState({ canCreate, currentTab, loading }) {
  if (loading) {
    return (
      <View style={styles.emptyCard}>
        <ActivityIndicator color={colors.primaryDark} size="small" />
        <Text style={styles.emptyTitle}>Cargando torneos...</Text>
        <Text style={styles.emptyText}>Estamos trayendo la informacion de Firestore.</Text>
      </View>
    );
  }

  if (currentTab === "create") {
    return (
      <View style={styles.emptyCard}>
        <Text style={styles.emptyTitle}>Crear torneo</Text>
        <Text style={styles.emptyText}>
          Ya esta lista la pantalla de alta para crear un torneo o varios en una sola accion.
        </Text>
        <View style={styles.createInfoList}>
          <Text style={styles.createInfoItem}>- Torneo simple o multiple</Text>
          <Text style={styles.createInfoItem}>- Composicion deportiva reutilizada desde LIGAS</Text>
          <Text style={styles.createInfoItem}>- Reglas de pago y confirmacion por pareja</Text>
        </View>
        {!canCreate ? (
          <Text style={styles.createInfoMuted}>
            Esta area se habilita para perfiles organizadores.
          </Text>
        ) : null}
      </View>
    );
  }

  const title =
    currentTab === "mine"
      ? "Todavia no tenes torneos propios"
      : currentTab === "registrations"
      ? "Todavia no tenes inscripciones"
      : "Todavia no hay torneos cargados";
  const message =
    currentTab === "mine"
      ? "Cuando creemos la pantalla de alta, vas a ver aca todos tus torneos."
      : currentTab === "registrations"
      ? "Cuando te inscribas con una pareja confirmada, ese torneo aparecera aca."
      : "Cuando haya torneos publicados, los vas a encontrar aca.";

  return (
    <View style={styles.emptyCard}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );
}

export default function TorneosScreen({ navigation }) {
  const { userData } = useAuth();
  const [activeTab, setActiveTab] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [tournaments, setTournaments] = useState([]);
  const [registrationsByTournament, setRegistrationsByTournament] = useState([]);
  const [feedback, setFeedback] = useState({
    visible: false,
    title: "",
    message: "",
    tone: "default",
  });

  const currentUserId = userData?.uid || "";
  const canCreateTournament = isApprovedOrganizer(userData);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      const loadTournamentHub = async () => {
        try {
          setLoading(true);
          const [tournamentsResponse, registrationsResponse] = await Promise.all([
            listTournamentsWithRegistrationCounts(),
            currentUserId ? findTournamentRegistrationsByPlayer(currentUserId) : Promise.resolve([]),
          ]);

          if (!isMounted) {
            return;
          }

          setTournaments(sortByUpdatedAt(tournamentsResponse));
          setRegistrationsByTournament(registrationsResponse);
        } catch (error) {
          if (!isMounted) {
            return;
          }

          setTournaments([]);
          setRegistrationsByTournament([]);
          setFeedback({
            visible: true,
            title: "No pudimos cargar torneos",
            message: "Intenta nuevamente en unos instantes.",
            tone: "danger",
          });
        } finally {
          if (isMounted) {
            setLoading(false);
          }
        }
      };

      loadTournamentHub();

      return () => {
        isMounted = false;
      };
    }, [currentUserId])
  );

  const tabs = useMemo(() => {
    const baseTabs = [
      { key: "all", label: "Todos" },
      { key: "mine", label: "Mis torneos" },
      { key: "registrations", label: "Inscripciones" },
    ];

    if (canCreateTournament) {
      baseTabs.push({ key: "create", label: "Crear torneo" });
    }

    return baseTabs;
  }, [canCreateTournament]);

  const registrationsMap = useMemo(
    () => getRegistrationsCountMap(registrationsByTournament),
    [registrationsByTournament]
  );

  const tournamentsEnriched = useMemo(() => {
    return tournaments.map((tournament) =>
      buildTournamentCardData(tournament, registrationsMap[tournament.id] || null)
    );
  }, [registrationsMap, tournaments]);

  const filteredTournaments = useMemo(() => {
    const normalizedQuery = normalizeText(query);

    return tournamentsEnriched.filter((tournament) => {
      if (!getStatusFilterMatch(tournament, statusFilter)) {
        return false;
      }

      if (normalizedQuery) {
        const haystack = [
          tournament.name,
          tournament.venueLabel,
          tournament.categoryLabel,
          tournament.organizerName,
        ]
          .map(normalizeText)
          .join(" ");

        if (!haystack.includes(normalizedQuery)) {
          return false;
        }
      }

      if (activeTab === "mine" && normalizeText(tournament.organizerId) !== normalizeText(currentUserId)) {
        return false;
      }

      if (activeTab === "registrations" && !tournament.userRegistration) {
        return false;
      }

      return true;
    });
  }, [activeTab, currentUserId, query, statusFilter, tournamentsEnriched]);

  const listItems = useMemo(() => {
    if (statusFilter !== "finished") {
      return filteredTournaments.map((tournament) => ({
        type: "tournament",
        id: tournament.id,
        tournament,
      }));
    }

    const finishedItems = filteredTournaments.filter((tournament) => tournament.status === "finished");
    const cancelledItems = filteredTournaments.filter((tournament) => tournament.status === "cancelled");
    const items = [];

    if (finishedItems.length) {
      items.push({
        type: "section",
        id: "section-finished",
        title: "Finalizados",
        description: "Torneos cerrados normalmente.",
      });
      finishedItems.forEach((tournament) => {
        items.push({
          type: "tournament",
          id: tournament.id,
          tournament,
        });
      });
    }

    if (cancelledItems.length) {
      items.push({
        type: "section",
        id: "section-cancelled",
        title: "Cancelados",
        description: "Quedan visibles aca para conservar historial y pagos.",
      });
      cancelledItems.forEach((tournament) => {
        items.push({
          type: "tournament",
          id: tournament.id,
          tournament,
        });
      });
    }

    return items;
  }, [filteredTournaments, statusFilter]);

  const handleOpenTournament = (tournament) => {
    if (!tournament?.id) {
      return;
    }

    navigation.navigate("TournamentDetail", {
      tournamentId: tournament.id,
      tournamentName: tournament.name || "Torneo",
    });
  };

  const handlePressCreateTab = () => {
    if (!canCreateTournament) {
      return;
    }

    navigation.navigate("CreateTournament");
  };

  const renderHeader = () => (
    <View>
      <View style={styles.searchCard}>
        <View style={styles.searchRow}>
          <Ionicons color={colors.muted} name="search-outline" size={18} />
          <TextInput
            onChangeText={setQuery}
            placeholder="Buscar por torneo, sede o categoria"
            placeholderTextColor={colors.muted}
            style={styles.searchInput}
            value={query}
          />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.tabsRow}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {tabs.map((tab) => {
          const isActive = tab.key === activeTab;

          return (
            <Pressable
              key={tab.key}
              onPress={tab.key === "create" ? handlePressCreateTab : () => setActiveTab(tab.key)}
              style={({ pressed }) => [
                styles.tabButton,
                isActive && styles.tabButtonActive,
                pressed && styles.tabButtonPressed,
              ]}
            >
              <Text style={[styles.tabButtonText, isActive && styles.tabButtonTextActive]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {activeTab !== "create" ? (
        <ScrollView
          contentContainerStyle={styles.filterRow}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {STATUS_FILTER_OPTIONS.map((option) => {
            const isActive = option.value === statusFilter;

            return (
              <Pressable
                key={option.value}
                onPress={() => setStatusFilter(option.value)}
                style={[styles.filterChip, isActive && styles.filterChipActive]}
              >
                <Text style={[styles.filterChipText, isActive && styles.filterChipTextActive]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader onBack={() => navigation.goBack()} subtitle="Torneos" />

      <View style={styles.container}>
        {activeTab === "create" ? (
          <ScrollView
            contentContainerStyle={styles.createTabWrap}
            showsVerticalScrollIndicator={false}
          >
            {renderHeader()}
            <EmptyState canCreate={canCreateTournament} currentTab="create" loading={false} />
          </ScrollView>
        ) : (
          <FlatList
            contentContainerStyle={styles.listContent}
            data={listItems}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              <EmptyState
                canCreate={canCreateTournament}
                currentTab={activeTab}
                loading={loading}
              />
            }
            ListHeaderComponent={renderHeader}
            renderItem={({ item }) =>
              item.type === "section" ? (
                <TournamentSectionHeader
                  description={item.description}
                  title={item.title}
                />
              ) : (
                <TournamentCard item={item.tournament} onPress={handleOpenTournament} />
              )
            }
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      <FeedbackModal
        message={feedback.message}
        onClose={() => setFeedback((current) => ({ ...current, visible: false }))}
        tone={feedback.tone}
        visible={feedback.visible}
        title={feedback.title}
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
    paddingBottom: spacing.lg + BOTTOM_QUICK_ACTIONS_SPACE,
  },
  listContent: {
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  searchCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
  },
  searchRow: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 46,
  },
  searchInput: {
    color: colors.text,
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    marginLeft: spacing.sm,
    paddingVertical: spacing.sm,
  },
  tabsRow: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  tabButton: {
    backgroundColor: "#EFF6F2",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 38,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
  },
  tabButtonActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  tabButtonPressed: {
    opacity: 0.88,
  },
  tabButtonText: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  tabButtonTextActive: {
    color: colors.surface,
  },
  filterRow: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  filterChip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 34,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
  },
  filterChipActive: {
    backgroundColor: "#E8F5EE",
    borderColor: colors.primaryLight,
  },
  filterChipText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  filterChipTextActive: {
    color: colors.primaryDark,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  cardPressed: {
    opacity: 0.92,
  },
  cardHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  cardTitleWrap: {
    flex: 1,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 19,
    fontWeight: "900",
  },
  cardVenue: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 4,
  },
  statusPill: {
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 30,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  sectionHeaderCard: {
    backgroundColor: "#F3F7F9",
    borderColor: "#D8E1E7",
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: spacing.md,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  sectionHeaderTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  sectionHeaderText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 18,
    marginTop: 4,
  },
  cardMetaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  metaBox: {
    backgroundColor: "#F5FAF7",
    borderRadius: 8,
    minWidth: "47%",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  metaLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  metaValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 4,
  },
  registrationRow: {
    alignItems: "center",
    backgroundColor: "#EFF8F4",
    borderRadius: 8,
    flexDirection: "row",
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  registrationText: {
    color: colors.text,
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
    marginLeft: spacing.xs,
    marginRight: spacing.xs,
  },
  registrationStatus: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
  },
  emptyCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    padding: spacing.lg,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
    marginTop: spacing.sm,
    textAlign: "center",
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 21,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  createInfoList: {
    marginTop: spacing.md,
    width: "100%",
  },
  createInfoItem: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 22,
  },
  createInfoMuted: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    marginTop: spacing.md,
    textAlign: "center",
  },
  createTabWrap: {
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
});

