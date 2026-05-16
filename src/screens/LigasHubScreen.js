import { useCallback, useEffect, useMemo, useState } from "react";
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
  canManageLeague,
  createLeagueRegistrationRequest,
  getLeagueComplexOptions,
  isLeagueParticipant,
  listLeagues,
  listLeagueRegistrationRequests,
} from "../services/leaguesService";
import { createInvitation } from "../services/invitationsService";
import { listPlayers } from "../services/playersService";
import { isApprovedOrganizer } from "../services/roleService";

const SEX_FILTER_OPTIONS = ["Todos", "Masculino", "Femenino", "Mixto"];
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

export default function LigasHubScreen({ navigation }) {
  const { userData } = useAuth();
  const currentUserId = userData?.uid;
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [leaguesSource, setLeaguesSource] = useState([]);
  const [registrationRequests, setRegistrationRequests] = useState([]);
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
  const [leaguePendingDelete, setLeaguePendingDelete] = useState(null);
  const [leaguePendingRegistration, setLeaguePendingRegistration] = useState(null);
  const [partnerPickerPlayers, setPartnerPickerPlayers] = useState([]);
  const [partnerPickerQuery, setPartnerPickerQuery] = useState("");
  const [partnerPickerLoading, setPartnerPickerLoading] = useState(false);
  const [registrationSaving, setRegistrationSaving] = useState(false);
  const [deletingLeague, setDeletingLeague] = useState(false);

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
    dia: "",
    localidades: userLocalidad ? [userLocalidad] : [],
  });
  const [draftSexo, setDraftSexo] = useState("Todos");
  const [draftCategoria, setDraftCategoria] = useState("");
  const [draftComplejo, setDraftComplejo] = useState("");
  const [draftDia, setDraftDia] = useState("");
  const canCreateLeague = isApprovedOrganizer(userData);

  const hasActiveFilters =
    query.trim().length > 0 ||
    appliedFilters.sexo !== "Todos" ||
    Boolean(appliedFilters.categoria) ||
    Boolean(appliedFilters.complejo) ||
    Boolean(appliedFilters.dia);

  useEffect(() => {
    if (canCreateLeague) {
      navigation.replace("MyLeagues");
    }
  }, [canCreateLeague, navigation]);

  useEffect(() => {
    let isCancelled = false;

    const loadLeagues = async () => {
      try {
        setLoading(true);
        setLoadError("");
        const leagues = await listLeagues();
        const requestsByLeague = await Promise.all(
          leagues.map((league) => listLeagueRegistrationRequests(league.id))
        );

        if (isCancelled) {
          return;
        }

        setLeaguesSource(applyLeagueFavoriteFlags(leagues, favoriteLeagueIds));
        setRegistrationRequests(requestsByLeague.flat());
      } catch (error) {
        if (!isCancelled) {
          setLoadError("No pudimos cargar las ligas por ahora.");
          setLeaguesSource([]);
          setRegistrationRequests([]);
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

      if (
        appliedFilters.categoria &&
        !normalizeText(league.categoria).includes(normalizeText(appliedFilters.categoria))
      ) {
        return false;
      }

      if (appliedFilters.complejo && league.complejoNombre !== appliedFilters.complejo) {
        return false;
      }

      if (appliedFilters.dia && league.scheduleConfig?.dayKey !== appliedFilters.dia) {
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
  const partnerPickerFilteredPlayers = useMemo(() => {
    const normalizedQuery = normalizeText(partnerPickerQuery);

    if (!normalizedQuery) {
      return partnerPickerPlayers;
    }

    return partnerPickerPlayers.filter((player) =>
      [
        player.nombre,
        player.apellido,
        `${player.nombre || ""} ${player.apellido || ""}`,
        player.categoria,
      ]
        .filter(Boolean)
        .some((value) => normalizeText(value).includes(normalizedQuery))
    );
  }, [partnerPickerPlayers, partnerPickerQuery]);

  const getUserLeagueRegistration = (league) => {
    const userKey = normalizeText(userData?.uid || userData?.id || "");

    if (!userKey || !league?.id) {
      return null;
    }

    return registrationRequests.find((request) => {
      if (request.leagueId !== league.id) {
        return false;
      }

      const requesterKey = normalizeText(
        request.requester?.linkedUserId || request.requester?.id || ""
      );
      const partnerKey = normalizeText(request.partner?.linkedUserId || request.partner?.id || "");

      return requesterKey === userKey || partnerKey === userKey;
    });
  };

  const isLeagueClosedForRegistration = (league = {}) => {
    const rounds = Array.isArray(league?.fixture?.rounds) ? league.fixture.rounds : [];
    const matches = rounds.flatMap((round) => (Array.isArray(round?.matches) ? round.matches : []));
    const playableMatches = matches.filter(
      (match) => match?.teamA?.id !== "__bye__" && match?.teamB?.id !== "__bye__"
    );
    const hasStarted = playableMatches.length > 0;

    return hasStarted;
  };

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
    setDraftDia(appliedFilters.dia);
  };

  const handleApplyFilters = async () => {
    setAppliedFilters((current) => ({
      ...current,
      sexo: draftSexo,
      categoria: draftCategoria,
      complejo: draftComplejo,
      dia: draftDia,
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
    if (!canManageLeague(league, userData)) {
      showFeedback(
        "Acceso restringido",
        "Solo el organizador creador o el administrador pueden eliminar esta liga.",
        "danger"
      );
      return;
    }

    setLeaguePendingDelete(league);
  };

  const confirmDeleteLeague = async () => {
    if (!leaguePendingDelete || deletingLeague) {
      return;
    }

    try {
      setDeletingLeague(true);
      await archiveLeague(leaguePendingDelete.id);
      setLeaguesSource((current) =>
        current.filter((currentLeague) => currentLeague.id !== leaguePendingDelete.id)
      );
      setLeaguePendingDelete(null);
      showFeedback("Liga eliminada", "La liga se elimino correctamente.", "success");
    } catch (error) {
      showFeedback(
        "No pudimos eliminar la liga",
        "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setDeletingLeague(false);
    }
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

  const handleOpenMyLeagues = () => {
    if (!canCreateLeague) {
      showFeedback(
        "Acceso restringido",
        "Solo los organizadores pueden acceder a Mis ligas desde esta seccion.",
        "danger"
      );
      return;
    }

    navigation.navigate("MyLeagues");
  };

  const handleOpenPlayerLeagues = () => {
    navigation.navigate("PlayerLeagues");
  };

  const handleOpenParticipantLeague = (league) => {
    navigation.navigate("LeagueDetail", {
      leagueId: league.id,
      leagueName: league.nombre,
    });
  };

  const buildRegistrationRequester = () => ({
    ...userData,
    id: userData?.uid || userData?.id || "",
    uid: userData?.uid || userData?.id || "",
  });

  const handleRequestLeagueRegistration = async (league) => {
    if (isLeagueParticipant(league, userData)) {
      handleOpenParticipantLeague(league);
      return;
    }

    if (league.teamType === "pair") {
      try {
        setPartnerPickerLoading(true);
        setLeaguePendingRegistration(league);
        setPartnerPickerQuery("");
        const players = await listPlayers();
        const currentUserKey = normalizeText(userData?.uid || userData?.id || "");
        setPartnerPickerPlayers(
          players.filter((player) => normalizeText(player.id) !== currentUserKey)
        );
      } catch (error) {
        showFeedback("No pudimos cargar jugadores", "Intenta nuevamente en unos instantes.", "danger");
      } finally {
        setPartnerPickerLoading(false);
      }
      return;
    }

    try {
      setRegistrationSaving(true);
      const request = await createLeagueRegistrationRequest({
        league,
        requester: buildRegistrationRequester(),
      });
      setRegistrationRequests((current) => [request, ...current]);
      showFeedback(
        "Solicitud enviada",
        "El organizador revisara tu inscripcion a la liga.",
        "success"
      );
    } catch (error) {
      showFeedback("No pudimos enviar la solicitud", "Intenta nuevamente en unos instantes.", "danger");
    } finally {
      setRegistrationSaving(false);
    }
  };

  const handleSelectLeaguePartner = async (partner) => {
    if (!leaguePendingRegistration || registrationSaving) {
      return;
    }

    try {
      setRegistrationSaving(true);
      const request = await createLeagueRegistrationRequest({
        league: leaguePendingRegistration,
        requester: buildRegistrationRequester(),
        partner,
      });
      setRegistrationRequests((current) => [request, ...current]);

      await createInvitation({
        senderId: userData?.uid || userData?.id || "",
        senderName: userData?.name || userData?.nombre || "Jugador",
        recipientId: partner.id,
        recipientName: [partner.nombre, partner.apellido].filter(Boolean).join(" ") || "Jugador",
        title: "Invitacion a liga",
        subtitle: `${userData?.name || userData?.nombre || "Jugador"} te invito a jugar ${
          leaguePendingRegistration.nombre || "una liga"
        } como pareja fija.`,
        type: "league_pair_invitation",
        metadata: {
          leagueId: leaguePendingRegistration.id,
          leagueName: leaguePendingRegistration.nombre || "Liga",
          requestId: request.id,
        },
      });

      setLeaguePendingRegistration(null);
      setPartnerPickerQuery("");
      showFeedback(
        "Invitacion enviada",
        "Cuando tu pareja acepte, el organizador podra confirmar la inscripcion.",
        "success"
      );
    } catch (error) {
      showFeedback("No pudimos enviar la invitacion", "Intenta nuevamente en unos instantes.", "danger");
    } finally {
      setRegistrationSaving(false);
    }
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
              color={activeTab === "mine" ? colors.surface : "#1FAB89"}
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

        {canCreateLeague ? (
          <View style={styles.organizerActionsRow}>
            <Pressable
              onPress={handleCreateLeague}
              style={({ pressed }) => [
                styles.createLeagueButton,
                styles.organizerActionButton,
                pressed && styles.createLeagueButtonPressed,
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
              onPress={handleOpenMyLeagues}
              style={({ pressed }) => [
                styles.myLeaguesButton,
                styles.organizerActionButton,
                pressed && styles.createLeagueButtonPressed,
              ]}
            >
              <View style={styles.myLeaguesIconWrap}>
                <Ionicons color={colors.primaryDark} name="grid-outline" size={18} />
              </View>
              <View style={styles.createLeagueTextWrap}>
                <Text style={styles.myLeaguesTitle}>MIS LIGAS</Text>
              </View>
              <Ionicons color={colors.primaryDark} name="chevron-forward" size={16} />
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={handleOpenPlayerLeagues}
            style={({ pressed }) => [
              styles.playerLeaguesButton,
              pressed && styles.createLeagueButtonPressed,
            ]}
          >
            <View style={styles.playerLeaguesIconWrap}>
              <Ionicons color={colors.primaryDark} name="tennisball-outline" size={18} />
            </View>
            <View style={styles.createLeagueTextWrap}>
              <Text style={styles.playerLeaguesTitle}>MIS LIGAS</Text>
              <Text style={styles.playerLeaguesSubtitle}>Fixture, puntajes y remplazos</Text>
            </View>
            <Ionicons color={colors.primaryDark} name="chevron-forward" size={16} />
          </Pressable>
        )}

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
          renderItem={({ item }) => {
            const isParticipant = isLeagueParticipant(item, userData);
            const currentRegistration = getUserLeagueRegistration(item);
            const isRegistrationConfirmed = currentRegistration?.status === "confirmed";
            const isRegistrationRejected = ["rejected", "partner_rejected"].includes(
              currentRegistration?.status
            );
            const hasPendingRegistration =
              currentRegistration &&
              !["confirmed", "rejected", "partner_rejected"].includes(currentRegistration.status);
            const canRegister = !isParticipant && (!currentRegistration || isRegistrationRejected);
            const registrationClosed = isLeagueClosedForRegistration(item);

            return (
              <LeagueCard
                league={item}
                managementActions={
                  isParticipant || isRegistrationConfirmed
                    ? [
                        {
                          disabled: true,
                          icon: "checkmark-circle-outline",
                          key: `registered-${item.id}`,
                          label: "INSCRIPTO",
                          tone: "success",
                        },
                      ]
                    : hasPendingRegistration
                    ? [
                        {
                          disabled: true,
                          icon: "time-outline",
                          key: `pending-${item.id}`,
                          label: "Pendiente",
                          tone: "pending",
                        },
                      ]
                    : canRegister
                    ? [
                        {
                          disabled: registrationClosed || registrationSaving,
                          icon: registrationClosed ? "lock-closed-outline" : "person-add-outline",
                          key: `register-${item.id}`,
                          label: registrationSaving ? "Enviando..." : "Inscribirme",
                          onPress: () => handleRequestLeagueRegistration(item),
                          tone: "primary",
                        },
                      ]
                    : []
                }
                onDetails={
                  isParticipant
                    ? () => handleOpenParticipantLeague(item)
                    : undefined
                }
                onToggleFavorite={() => handleToggleFavorite(item)}
                showProgressStatus
              />
            );
          }}
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
      <Modal
        animationType="fade"
        onRequestClose={() => (deletingLeague ? null : setLeaguePendingDelete(null))}
        transparent
        visible={Boolean(leaguePendingDelete)}
      >
        <View style={styles.confirmOverlay}>
          <Pressable
            onPress={() => (deletingLeague ? null : setLeaguePendingDelete(null))}
            style={styles.confirmBackdrop}
          />
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Eliminar liga</Text>
            <Text style={styles.confirmMessage}>
              {leaguePendingDelete
                ? `Vas a eliminar ${leaguePendingDelete.nombre}. Esta accion es irreversible.`
                : ""}
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                disabled={deletingLeague}
                onPress={() => setLeaguePendingDelete(null)}
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
      <Modal
        animationType="fade"
        onRequestClose={() => (registrationSaving ? null : setLeaguePendingRegistration(null))}
        transparent
        visible={Boolean(leaguePendingRegistration)}
      >
        <View style={styles.confirmOverlay}>
          <Pressable
            onPress={() => (registrationSaving ? null : setLeaguePendingRegistration(null))}
            style={styles.confirmBackdrop}
          />
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Elegir pareja</Text>
            <Text style={styles.confirmMessage}>
              Selecciona quien recibira la invitacion para jugar esta liga.
            </Text>
            {partnerPickerLoading ? (
              <Text style={styles.confirmMessage}>Cargando jugadores...</Text>
            ) : (
              <>
                <TextInput
                  autoCapitalize="words"
                  onChangeText={setPartnerPickerQuery}
                  placeholder="Buscar por nombre o categoria"
                  placeholderTextColor={colors.muted}
                  style={styles.partnerPickerSearchInput}
                  value={partnerPickerQuery}
                />
                <FlatList
                  data={partnerPickerFilteredPlayers}
                  keyExtractor={(item) => item.id}
                  ListEmptyComponent={
                    <Text style={styles.partnerPickerEmpty}>No encontramos jugadores.</Text>
                  }
                  style={styles.partnerPickerList}
                  renderItem={({ item }) => (
                    <Pressable
                      disabled={registrationSaving}
                      onPress={() => handleSelectLeaguePartner(item)}
                      style={({ pressed }) => [
                        styles.partnerPickerRow,
                        pressed && !registrationSaving ? styles.confirmButtonPressed : null,
                      ]}
                    >
                      <Text style={styles.partnerPickerName}>
                        {[item.nombre, item.apellido].filter(Boolean).join(" ") || "Jugador"}
                      </Text>
                      <Text style={styles.partnerPickerMeta}>
                        {[item.categoria, item.sexo].filter(Boolean).join(" - ")}
                      </Text>
                    </Pressable>
                  )}
                />
              </>
            )}
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
    backgroundColor: "#EAF8F3",
    borderColor: "#B8E3D2",
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
    backgroundColor: "#1FAB89",
    borderColor: "#1FAB89",
  },
  favoriteInlineButtonPressed: {
    opacity: 0.92,
  },
  favoriteInlineButtonText: {
    color: "#12745E",
    fontSize: 13,
    fontWeight: "800",
    marginLeft: 6,
  },
  favoriteInlineButtonTextActive: {
    color: colors.surface,
  },
  organizerActionsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  organizerActionButton: {
    flex: 1,
    marginTop: 0,
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
  myLeaguesButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 4,
  },
  playerLeaguesButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: "#8EE6A3",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 4,
  },
  playerLeaguesIconWrap: {
    alignItems: "center",
    backgroundColor: "#E8FFF0",
    borderRadius: 12,
    height: 30,
    justifyContent: "center",
    width: 30,
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
    borderRadius: 12,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  myLeaguesIconWrap: {
    alignItems: "center",
    backgroundColor: "#EAF6F1",
    borderRadius: 12,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  createLeagueIconWrapDisabled: {
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  createLeagueTextWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  createLeagueTitle: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: "800",
  },
  myLeaguesTitle: {
    color: colors.primaryDark,
    fontSize: 15,
    fontWeight: "800",
  },
  playerLeaguesTitle: {
    color: colors.primaryDark,
    fontSize: 15,
    fontWeight: "900",
    textAlign: "center",
  },
  playerLeaguesSubtitle: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "700",
    marginTop: 1,
    textAlign: "center",
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
  partnerPickerSearchInput: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  partnerPickerList: {
    marginTop: spacing.sm,
    maxHeight: 320,
  },
  partnerPickerEmpty: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    paddingVertical: spacing.md,
    textAlign: "center",
  },
  partnerPickerRow: {
    backgroundColor: "#F7FCFA",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  partnerPickerName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  partnerPickerMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
});

