import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";

import AvatarBadge from "../components/AvatarBadge";
import BottomQuickActionsBar, {
  BOTTOM_QUICK_ACTIONS_SPACE,
} from "../components/BottomQuickActionsBar";
import CircularMenu from "../components/CircularMenu";
import LoginModal from "../components/LoginModal";
import ProfileModal from "../components/ProfileModal";
import { heroPhrases } from "../data/profileOptions";
import { canAccessAdminPanel } from "../config/admin";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import { isLeagueParticipant, listLeagues, updateLeagueFixture } from "../services/leaguesService";
import { listPlayers } from "../services/playersService";
import { isApprovedOrganizer } from "../services/roleService";
import { listTournamentsWithRegistrationCounts } from "../services/tournamentsService";
import { formatPlayerShortName } from "../utils/playerDisplayName";

const MENU_ITEMS = [
  {
    key: "Ligas",
    label: "LIGAS",
    subtitle: "Ligas activas en tu ciudad",
  },
  {
    key: "Torneos",
    label: "TORNEOS",
    subtitle: "Cuadros y eventos para sumarte",
  },
  {
    key: "Turnos",
    label: "TURNOS",
    subtitle: "Reservas rapidas para tu proximo partido",
  },
  {
    key: "Jugadores",
    label: "JUGADORES",
    subtitle: "Conecta con la comunidad PadelNexo",
  },
];

const DEFAULT_USER = {
  name: "Jugador",
  email: "",
  phone: "",
  countryCode: "+54",
  city: "Buenos Aires",
  category: "Iniciante",
  sex: "Masculino",
  description: "",
  avatarColor: colors.primary,
  avatarUrl: "",
  role: "user",
  organizerStatus: "none",
  availability: {},
  availabilityDays: [],
  complejos: [],
};

const LEAGUE_CAROUSEL_ITEM_WIDTH = 252;
const TOURNAMENT_CAROUSEL_ITEM_WIDTH = 252;

const DAY_LABELS = {
  monday: "Lunes",
  tuesday: "Martes",
  wednesday: "Miercoles",
  thursday: "Jueves",
  friday: "Viernes",
  saturday: "Sabado",
  sunday: "Domingo",
};

function normalizeText(value = "") {
  return String(value || "").trim().toLowerCase();
}

function getLeagueMatches(league = {}) {
  return (league.fixture?.rounds || []).flatMap((round) =>
    (round.matches || []).map((match) => ({ match, round }))
  );
}

function hasLeagueStarted(league = {}) {
  return getLeagueMatches(league).some(({ match }) => Boolean(match?.result?.winner));
}

function buildLeagueScheduleLabel(league = {}) {
  const dayLabel = DAY_LABELS[league?.scheduleConfig?.dayKey] || "";
  const timeSlots = Array.isArray(league?.scheduleConfig?.timeSlots)
    ? league.scheduleConfig.timeSlots.filter(Boolean)
    : [];
  const timeLabel = timeSlots.slice(0, 2).join(" / ");

  if (league?.scheduleConfig?.mode === "weekly_coordination") {
    return timeLabel ? `A coordinar - ${timeLabel}` : "A coordinar";
  }

  if (!dayLabel && !timeLabel) {
    return "Horario a definir";
  }

  return [dayLabel, timeLabel].filter(Boolean).join(" - ");
}

function shouldShowLeagueInHomeCarousel(league = {}) {
  const status = normalizeText(league.status || "active");

  return status !== "deleted" && status !== "archived" && !hasLeagueStarted(league);
}

function isReplacementForCurrentUser(replacement = {}, currentUserId = "") {
  if (!currentUserId) {
    return false;
  }

  return [replacement?.titular?.id, replacement?.titular?.linkedUserId, replacement?.requestedBy]
    .filter(Boolean)
    .some((playerId) => normalizeText(playerId) === currentUserId);
}

function hasAssignedReplacementPlayer(replacement = {}) {
  const replacementPlayer = replacement?.replacement || null;

  if (!replacementPlayer || typeof replacementPlayer !== "object") {
    return false;
  }

  return [
    replacementPlayer.id,
    replacementPlayer.linkedUserId,
    replacementPlayer.nombre,
    replacementPlayer.name,
  ].some((value) => String(value || "").trim().length > 0);
}

function hasUserPostulated(replacement = {}, currentUserId = "") {
  if (!currentUserId) {
    return false;
  }

  return (replacement.candidates || []).some((candidate) =>
    [candidate?.id, candidate?.linkedUserId]
      .filter(Boolean)
      .some((candidateId) => normalizeText(candidateId) === currentUserId)
  );
}

function hasUserRejectedReplacement(replacement = {}, currentUserId = "") {
  if (!currentUserId) {
    return false;
  }

  return (replacement.rejectedCandidates || []).some((candidate) =>
    [candidate?.id, candidate?.linkedUserId]
      .filter(Boolean)
      .some((candidateId) => normalizeText(candidateId) === currentUserId)
  );
}

function buildPendingPostulationKey(userId = "", requestId = "") {
  return `${normalizeText(userId)}:${requestId}`;
}

function collectHomeReplacementRequests(leagues = [], userData = {}, canManage = false) {
  const currentUserId = normalizeText(userData?.uid || userData?.id || "");

  return leagues
    .flatMap((league) => {
      const isOwnLeague =
        currentUserId &&
        [league.organizerId, league.createdBy].filter(Boolean).some(
          (ownerId) => normalizeText(ownerId) === currentUserId
        );
      const currentUserPlaysLeague = isLeagueParticipant(league, userData);

      if (currentUserPlaysLeague && !isOwnLeague) {
        return [];
      }

      return (league.fixture?.rounds || []).flatMap((round) =>
        (round.matches || []).flatMap((match) =>
          Object.entries(match.replacements || {})
            .filter(([, replacement]) => {
              if (!replacement?.requested) {
                return false;
              }

              if (hasAssignedReplacementPlayer(replacement)) {
                return false;
              }

              return true;
            })
            .map(([replacementKey, replacement]) => ({
              id: `${league.id}-${round.id}-${match.id}-${replacementKey}`,
              canManageRequest: Boolean(canManage && isOwnLeague),
              league,
              match,
              replacement,
              replacementKey,
              round,
            }))
        )
      );
    })
    .sort((first, second) => {
      const firstRequestedAt = Number(first.replacement?.requestedAtMillis || 0);
      const secondRequestedAt = Number(second.replacement?.requestedAtMillis || 0);

      if (firstRequestedAt !== secondRequestedAt) {
        return secondRequestedAt - firstRequestedAt;
      }

      return String(first.league.nombre).localeCompare(String(second.league.nombre), "es");
    });
}

function buildReplacementCandidate(userData = {}) {
  return {
    id: userData?.uid || userData?.id || "",
    linkedUserId: userData?.uid || userData?.id || "",
    nombre: userData?.nombre || userData?.name || "Jugador",
    apellido: userData?.apellido || userData?.lastName || "",
    categoria: userData?.category || userData?.categoria || "",
    sexo: userData?.sex || userData?.sexo || "",
    phone: userData?.phone || "",
    avatarUrl: userData?.avatarUrl || userData?.foto || "",
    requestedAtMillis: Date.now(),
  };
}

function addReplacementCandidateToFixture(fixture = {}, request = {}, candidate = {}) {
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
          const nextCandidates = hasUserPostulated(currentReplacement, candidate.id)
            ? currentCandidates
            : [...currentCandidates, candidate];

          return {
            ...match,
            replacements: {
              ...(match.replacements || {}),
              [request.replacementKey]: {
                ...currentReplacement,
                requested: true,
                candidates: nextCandidates,
              },
            },
          };
        }),
      };
    }),
  };
}

function calculateProfileCompletion(user = {}) {
  const checks = [
    user.name,
    user.email,
    user.phone,
    user.city || user.localidad?.nombre,
    user.category || user.categoria,
    user.sex || user.sexo,
    user.description,
    user.avatarUrl || user.foto,
  ];
  const completed = checks.filter((value) => String(value || "").trim().length > 0).length;

  return Math.round((completed / checks.length) * 100);
}

function formatHomeTournamentDate(tournament = {}) {
  const start = Number(tournament.startDateMillis || 0);
  const end = Number(tournament.endDateMillis || 0);
  const monthNames = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ];
  const formatDate = (value) => {
    const date = new Date(value);
    return `${date.getDate()} de ${monthNames[date.getMonth()]}`;
  };
  const buildConsecutiveDaysLabel = (startDate, endDate) => {
    const days = [];
    const current = new Date(startDate);

    while (current <= endDate && days.length < 7) {
      days.push(current.getDate());
      current.setDate(current.getDate() + 1);
    }

    if (days.length === 1) {
      return `${days[0]} de ${monthNames[startDate.getMonth()]}`;
    }

    return `${days.slice(0, -1).join(", ")} y ${days[days.length - 1]} de ${
      monthNames[startDate.getMonth()]
    }`;
  };

  if (start && end) {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const sameMonth =
      startDate.getMonth() === endDate.getMonth() &&
      startDate.getFullYear() === endDate.getFullYear();

    if (sameMonth && endDate >= startDate) {
      return buildConsecutiveDaysLabel(startDate, endDate);
    }

    return `${formatDate(start)} al ${formatDate(end)}`;
  }

  if (start) {
    return `Desde ${formatDate(start)}`;
  }

  if (end) {
    return `Hasta ${formatDate(end)}`;
  }

  return "Fecha a confirmar";
}

function shouldShowTournamentInHomeCarousel(tournament = {}) {
  return [
    "published",
    "registration_open",
    "registration_closed",
    "building",
    "in_progress",
  ].includes(tournament.status);
}

export default function HomeScreen({ navigation, route }) {
  const { user, userData } = useAuth();
  const [isLoginVisible, setIsLoginVisible] = useState(false);
  const [isProfileVisible, setIsProfileVisible] = useState(false);
  const [selectedMenuItem, setSelectedMenuItem] = useState(MENU_ITEMS[0]);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const phraseOpacity = useRef(new Animated.Value(1)).current;
  const phraseTranslate = useRef(new Animated.Value(0)).current;
  const leagueCarouselRef = useRef(null);
  const tournamentCarouselRef = useRef(null);
  const currentUser = userData ? { ...DEFAULT_USER, ...userData } : null;
  const canManageFinances = isApprovedOrganizer(currentUser);
  const canOpenAdminPanel = canAccessAdminPanel(currentUser || {});
  const [playersPreview, setPlayersPreview] = useState([]);
  const [leaguesPreview, setLeaguesPreview] = useState([]);
  const [tournamentsPreview, setTournamentsPreview] = useState([]);
  const [activeLeagueIndex, setActiveLeagueIndex] = useState(0);
  const [activeTournamentIndex, setActiveTournamentIndex] = useState(0);
  const [expandedReplacementId, setExpandedReplacementId] = useState("");
  const [pendingPostulationIds, setPendingPostulationIds] = useState([]);
  const [submittingReplacementId, setSubmittingReplacementId] = useState("");
  const currentUserId = userData?.uid || userData?.id || "";

  useEffect(() => {
    const interval = setInterval(() => {
      Animated.parallel([
        Animated.timing(phraseOpacity, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(phraseTranslate, {
          toValue: -10,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setPhraseIndex((current) => (current + 1) % heroPhrases.length);
        phraseTranslate.setValue(10);
        Animated.parallel([
          Animated.timing(phraseOpacity, {
            toValue: 1,
            duration: 220,
            useNativeDriver: true,
          }),
          Animated.timing(phraseTranslate, {
            toValue: 0,
            duration: 220,
            useNativeDriver: true,
          }),
        ]).start();
      });
    }, 2800);

    return () => clearInterval(interval);
  }, [phraseOpacity, phraseTranslate]);

  useEffect(() => {
    const selectedMenuItemKey = route?.params?.selectedMenuItemKey;

    if (!selectedMenuItemKey) {
      return;
    }

    const nextMenuItem = MENU_ITEMS.find((item) => item.key === selectedMenuItemKey);

    if (nextMenuItem) {
      setSelectedMenuItem(nextMenuItem);
    }
  }, [route?.params?.selectedMenuItemKey]);

  useEffect(() => {
    let isCancelled = false;

    const loadPlayersPreview = async () => {
      if (!userData?.uid) {
        setPlayersPreview([]);
        return;
      }

      try {
        const players = await listPlayers();

        if (isCancelled) {
          return;
        }

        setPlayersPreview(players);
      } catch (error) {
        if (!isCancelled) {
          setPlayersPreview([]);
        }
      }
    };

    loadPlayersPreview();

    return () => {
      isCancelled = true;
    };
  }, [userData?.uid]);

  useEffect(() => {
    let isCancelled = false;

    const loadTournamentsPreview = async () => {
      if (!userData?.uid) {
        setTournamentsPreview([]);
        return;
      }

      try {
        const tournaments = await listTournamentsWithRegistrationCounts();

        if (isCancelled) {
          return;
        }

        setTournamentsPreview(tournaments);
      } catch (error) {
        if (!isCancelled) {
          setTournamentsPreview([]);
        }
      }
    };

    loadTournamentsPreview();

    return () => {
      isCancelled = true;
    };
  }, [userData?.uid]);

  useFocusEffect(
    useCallback(() => {
      let isCancelled = false;

      const loadLeaguesPreview = async () => {
        if (!userData?.uid) {
          setLeaguesPreview([]);
          return;
        }

        try {
          const leagues = await listLeagues();

          if (isCancelled) {
            return;
          }

          setLeaguesPreview(leagues);
        } catch (error) {
          if (!isCancelled) {
            setLeaguesPreview([]);
          }
        }
      };

      loadLeaguesPreview();

      return () => {
        isCancelled = true;
      };
    }, [userData?.uid])
  );

  const handleItemPress = (item) => {
    if (!currentUser) {
      setSelectedMenuItem(item);
      setIsLoginVisible(true);
      return;
    }

    navigation.navigate(item.key);
  };

  const handleLogin = (user) => {
    setIsLoginVisible(false);
  };

  const handleLogout = () => {
    setIsProfileVisible(false);
  };

  const handleProfileSave = (profile) => {
    setIsProfileVisible(false);
  };

  const buildCategorySummary = () => {
    const city = currentUser?.city || "tu ciudad";
    const category = currentUser?.category || "tu categoria";
    const hour = new Date().getHours();

    if (selectedMenuItem.key === "Ligas") {
      return {
        title: "Tu panorama de ligas",
        subtitle: "Resumen rapido para decidir donde jugar esta semana.",
        rows: [
          `Participas en 2 ligas de ${city}`,
          `Hay 4 ligas nuevas abiertas en ${city}`,
        ],
      };
    }

    if (selectedMenuItem.key === "Jugadores") {
      return {
        title: "DISPONIBLES HOY PARA JUGAR",
        subtitle: "",
        rows: [
          `3 jugadores de ${category} disponibles hoy`,
          "2 contactos con nivel similar y buena reputacion",
        ],
      };
    }

    if (selectedMenuItem.key === "Turnos") {
      const firstSlot = `${String(hour + 1).padStart(2, "0")}:00`;
      const secondSlot = `${String(hour + 2).padStart(2, "0")}:30`;

      return {
        title: "Turnos cercanos para hoy",
        subtitle: "Horarios proximos pensados para reservar en segundos.",
        rows: [
          `Cancha cubierta a las ${firstSlot} en ${city}`,
          `Cancha rapida a las ${secondSlot} cerca tuyo`,
        ],
      };
    }

    return {
      title: "Torneos en movimiento",
      subtitle: "Eventos activos y proximos para que no te quedes afuera.",
      rows: [
        "2 torneos activos con cupos limitados",
        "1 torneo arranca este fin de semana",
      ],
    };
  };

  const categorySummary = buildCategorySummary();
  const homeLeagueSlides = useMemo(
    () => leaguesPreview.filter(shouldShowLeagueInHomeCarousel).slice(0, 8),
    [leaguesPreview]
  );
  const replacementRequestsPreview = useMemo(
    () => collectHomeReplacementRequests(leaguesPreview, userData, canManageFinances).slice(0, 8),
    [canManageFinances, leaguesPreview, userData]
  );
  const profileCompletion = useMemo(
    () => (currentUser ? calculateProfileCompletion(currentUser) : 0),
    [currentUser]
  );
  const homeTournamentSlides = useMemo(
    () =>
      tournamentsPreview
        .filter(shouldShowTournamentInHomeCarousel)
        .sort((first, second) => {
          const firstValue = Number(first.startDateMillis || first.createdAtMillis || 0);
          const secondValue = Number(second.startDateMillis || second.createdAtMillis || 0);
          return firstValue - secondValue;
        })
        .slice(0, 8),
    [tournamentsPreview]
  );
  const playerPreviewRows = useMemo(
    () =>
      playersPreview
        .filter((player) => player.id !== userData?.uid)
        .slice(0, 4),
    [playersPreview, userData?.uid]
  );

  useEffect(() => {
    if (selectedMenuItem.key !== "Ligas" || homeLeagueSlides.length <= 1) {
      return undefined;
    }

    const interval = setInterval(() => {
      setActiveLeagueIndex((current) => {
        const nextIndex = (current + 1) % homeLeagueSlides.length;
        leagueCarouselRef.current?.scrollTo({
          animated: true,
          x: nextIndex * LEAGUE_CAROUSEL_ITEM_WIDTH,
          y: 0,
        });
        return nextIndex;
      });
    }, 3600);

    return () => clearInterval(interval);
  }, [homeLeagueSlides.length, selectedMenuItem.key]);

  useEffect(() => {
    if (selectedMenuItem.key !== "Torneos" || homeTournamentSlides.length <= 1) {
      return undefined;
    }

    const interval = setInterval(() => {
      setActiveTournamentIndex((current) => {
        const nextIndex = (current + 1) % homeTournamentSlides.length;
        tournamentCarouselRef.current?.scrollTo({
          animated: true,
          x: nextIndex * TOURNAMENT_CAROUSEL_ITEM_WIDTH,
          y: 0,
        });
        return nextIndex;
      });
    }, 3800);

    return () => clearInterval(interval);
  }, [homeTournamentSlides.length, selectedMenuItem.key]);

  const handlePostulateReplacement = async (request) => {
    const candidate = buildReplacementCandidate(userData);

    if (!candidate.id || submittingReplacementId) {
      return;
    }

    try {
      setSubmittingReplacementId(request.id);
      const pendingPostulationKey = buildPendingPostulationKey(candidate.id, request.id);
      setPendingPostulationIds((current) =>
        current.includes(pendingPostulationKey) ? current : [...current, pendingPostulationKey]
      );
      const nextFixture = addReplacementCandidateToFixture(
        request.league.fixture || { generatedAtMillis: 0, rounds: [] },
        request,
        candidate
      );

      await updateLeagueFixture(request.league.id, nextFixture);
      setLeaguesPreview((current) =>
        current.map((league) =>
          league.id === request.league.id ? { ...league, fixture: nextFixture } : league
        )
      );
    } catch (error) {
      const pendingPostulationKey = buildPendingPostulationKey(candidate.id, request.id);
      setPendingPostulationIds((current) =>
        current.filter((itemId) => itemId !== pendingPostulationKey)
      );
    } finally {
      setSubmittingReplacementId("");
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar backgroundColor={colors.background} barStyle="dark-content" />
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />

      <ScrollView
        bounces={false}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <View style={styles.brandBlock}>
            <Text numberOfLines={1} style={styles.appName}>
              PadelNexo
            </Text>
            <Text style={styles.appCaption}>Conectando el mundo del padel</Text>
          </View>

          {user && currentUser ? (
            <Pressable
              onPress={() => setIsProfileVisible(true)}
              style={({ pressed }) => [
                styles.userBadge,
                pressed && styles.userBadgePressed,
              ]}
            >
              <AvatarBadge
                color={currentUser.avatarColor}
                name={currentUser.name}
                size={34}
                textSize={12}
                uri={currentUser.avatarUrl}
              />
              <View style={styles.userNameBlock}>
                <Text numberOfLines={2} style={styles.userName}>
                  {currentUser.name}
                </Text>
              </View>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => setIsLoginVisible(true)}
              style={({ pressed }) => [
                styles.authButton,
                pressed && styles.authButtonPressed,
              ]}
            >
              <Text style={styles.authButtonText}>Ingresar / Registrarse</Text>
            </Pressable>
          )}
        </View>

        {user && currentUser && canManageFinances ? (
          <Pressable
            onPress={() => navigation.navigate("Finanzas")}
            style={({ pressed }) => [
              styles.financeButton,
              pressed ? styles.financeButtonPressed : null,
            ]}
          >
            <View style={styles.financeIconWrap}>
              <Text style={styles.financeIconText}>$</Text>
            </View>
            <View style={styles.financeCopy}>
              <Text style={styles.financeTitle}>FINANZAS</Text>
              <Text style={styles.financeText}>Pagos, valores y caja del organizador</Text>
            </View>
          </Pressable>
        ) : null}

        {user && currentUser && canOpenAdminPanel ? (
          <Pressable
            onPress={() => navigation.navigate("Admin")}
            style={({ pressed }) => [
              styles.adminHomeButton,
              pressed ? styles.financeButtonPressed : null,
            ]}
          >
            <View style={styles.adminHomeIconWrap}>
              <Text style={styles.adminHomeIconText}>A</Text>
            </View>
            <View style={styles.financeCopy}>
              <Text style={styles.financeTitle}>ADMINISTRADOR</Text>
              <Text style={styles.financeText}>Usuarios, permisos y contenido</Text>
            </View>
          </Pressable>
        ) : null}

        <Pressable
          disabled={selectedMenuItem.key !== "Jugadores"}
          onPress={() => {
            if (selectedMenuItem.key === "Jugadores") {
              handleItemPress({ key: "Jugadores" });
            }
          }}
          style={({ pressed }) => [
            styles.heroCard,
            selectedMenuItem.key === "Jugadores" && pressed ? styles.heroCardPressed : null,
          ]}
        >
          {!user || !currentUser ? (
            <>
              <Text style={styles.heroEyebrow}>HOME</Text>
              <Text style={styles.heroTitle}>Haciendo más fácil tu juego</Text>
              <View style={styles.phraseFrame}>
                <Animated.View
                  style={[
                    styles.phrasePill,
                    {
                      opacity: phraseOpacity,
                      transform: [{ translateY: phraseTranslate }],
                    },
                  ]}
                >
                  <Text style={styles.heroPhrase}>{heroPhrases[phraseIndex]}</Text>
                </Animated.View>
              </View>
              <View style={styles.paginationRow}>
                {heroPhrases.map((phrase, index) => (
                  <Pressable
                    key={phrase}
                    onPress={() => setPhraseIndex(index)}
                    style={[
                      styles.paginationDot,
                      index === phraseIndex && styles.paginationDotActive,
                    ]}
                  />
                ))}
              </View>
            </>
          ) : (
            <>
              <Text style={styles.heroEyebrow}>
                {selectedMenuItem.key === "Jugadores"
                  ? "VISTA PREVIA"
                  : selectedMenuItem.key === "Ligas"
                    ? "RESUMEN DE LIGAS"
                    : selectedMenuItem.key === "Torneos"
                      ? "RESUMEN DE TORNEOS"
                    : selectedMenuItem.label}
              </Text>
              {selectedMenuItem.key === "Jugadores" ? (
                <View style={styles.playersAvailableTitleRow}>
                  <View style={styles.playersAvailableDot} />
                  <Text style={styles.playersAvailableTitle}>{categorySummary.title}</Text>
                </View>
              ) : selectedMenuItem.key === "Ligas" || selectedMenuItem.key === "Torneos" ? null : (
                <Text style={styles.heroTitle}>{categorySummary.title}</Text>
              )}
              {categorySummary.subtitle &&
              selectedMenuItem.key !== "Ligas" &&
              selectedMenuItem.key !== "Torneos" ? (
                <Text style={styles.heroDescription}>{categorySummary.subtitle}</Text>
              ) : null}
              {selectedMenuItem.key === "Jugadores" ? (
                <View style={styles.playerPreviewList}>
                  {playerPreviewRows.map((player, playerIndex) => (
                    <View key={`${player.id || "player"}-${playerIndex}`} style={styles.playerPreviewRow}>
                      <AvatarBadge
                        color={colors.primary}
                        name={player.nombre}
                        size={26}
                        textSize={9}
                        uri={player.foto}
                      />
                      <Text numberOfLines={1} style={styles.playerPreviewName}>
                        {player.nombre}
                      </Text>
                      <Text numberOfLines={1} style={styles.playerPreviewCategory}>
                        {player.categoria}
                      </Text>
                    </View>
                  ))}
                  {playerPreviewRows.length === 0 ? (
                    <View style={styles.previewRow}>
                      <View style={styles.previewDot} />
                      <Text style={styles.previewText}>
                        Todavia no hay jugadores para mostrar en este resumen.
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : selectedMenuItem.key === "Ligas" ? (
                <View style={styles.leaguePreviewBlock}>
                  {replacementRequestsPreview.length ? (
                    <View style={styles.replacementHighlight}>
                      <Text style={styles.replacementEyebrow}>PEDIDO DE REMPLAZO</Text>
                      <ScrollView
                        nestedScrollEnabled
                        showsVerticalScrollIndicator
                        style={styles.replacementListScroll}
                      >
                        {replacementRequestsPreview.map((request, index) => {
                          const titularName = formatPlayerShortName(request.replacement?.titular);
                          const matchTime =
                            request.match?.timeSlot ||
                            request.round?.scheduleLabel ||
                            buildLeagueScheduleLabel(request.league);
                          const isPostulated = hasUserPostulated(
                            request.replacement,
                            currentUserId
                          ) || pendingPostulationIds.includes(
                            buildPendingPostulationKey(currentUserId, request.id)
                          );
                          const isRejected = hasUserRejectedReplacement(
                            request.replacement,
                            currentUserId
                          );
                          const candidatesCount = request.replacement?.candidates?.length || 0;
                          const isExpanded = expandedReplacementId === request.id;
                          const categoryText = [
                            request.league.categoria,
                            request.league.sexo,
                          ].filter(Boolean).join(" - ");

                          return (
                            <View
                              key={request.id}
                              style={[
                                styles.replacementCompactItem,
                                index % 2 === 1 ? styles.replacementCompactItemAlt : null,
                              ]}
                            >
                              <View style={styles.replacementCompactRow}>
                                <Text numberOfLines={1} style={styles.replacementCompactText}>
                                  {categoryText || "Categoria a confirmar"}
                                </Text>
                                <Pressable
                                  onPress={() =>
                                    setExpandedReplacementId((current) =>
                                      current === request.id ? "" : request.id
                                    )
                                  }
                                  style={({ pressed }) => [
                                    styles.replacementMoreChip,
                                    pressed ? styles.replacementMoreChipPressed : null,
                                  ]}
                                >
                                  <Text style={styles.replacementMoreChipText}>
                                    {isExpanded ? "Cerrar" : "Ver mas"}
                                  </Text>
                                </Pressable>
                              </View>

                              {isExpanded ? (
                                <View style={styles.replacementExpandedBox}>
                                  <Text numberOfLines={1} style={styles.replacementLeague}>
                                    {request.league.nombre}
                                  </Text>
                                  <Text numberOfLines={1} style={styles.replacementText}>
                                    {request.round?.title || "Fecha"} - {matchTime} - {titularName}
                                  </Text>
                                  {request.canManageRequest ? (
                                    <Text style={styles.replacementCandidatesText}>
                                      {candidatesCount
                                        ? `${candidatesCount} postulacion${candidatesCount === 1 ? "" : "es"}`
                                        : "Sin postulaciones"}
                                    </Text>
                                  ) : (
                                    <Pressable
                                      disabled={
                                        isPostulated ||
                                        isRejected ||
                                        submittingReplacementId === request.id
                                      }
                                      onPress={() => handlePostulateReplacement(request)}
                                      style={({ pressed }) => [
                                        styles.postulateButton,
                                        isPostulated ? styles.postulateButtonDone : null,
                                        isRejected ? styles.postulateButtonRejected : null,
                                        pressed && !isPostulated && !isRejected
                                          ? styles.postulateButtonPressed
                                          : null,
                                      ]}
                                    >
                                      <Text
                                        style={[
                                          styles.postulateButtonText,
                                          isPostulated ? styles.postulateButtonTextDone : null,
                                          isRejected ? styles.postulateButtonTextRejected : null,
                                        ]}
                                      >
                                        {isPostulated
                                          ? "EN REVISION"
                                          : isRejected
                                            ? "RECHAZADO"
                                            : submittingReplacementId === request.id
                                            ? "ENVIANDO..."
                                            : "POSTULARME"}
                                      </Text>
                                    </Pressable>
                                  )}
                                </View>
                              ) : null}
                            </View>
                          );
                        })}
                      </ScrollView>
                    </View>
                  ) : null}

                  {homeLeagueSlides.length ? (
                    <>
                      <ScrollView
                        horizontal
                        onMomentumScrollEnd={(event) => {
                          const nextIndex = Math.round(
                            event.nativeEvent.contentOffset.x / LEAGUE_CAROUSEL_ITEM_WIDTH
                          );
                          setActiveLeagueIndex(
                            Math.max(0, Math.min(nextIndex, homeLeagueSlides.length - 1))
                          );
                        }}
                        ref={leagueCarouselRef}
                        showsHorizontalScrollIndicator={false}
                        snapToInterval={LEAGUE_CAROUSEL_ITEM_WIDTH}
                        style={styles.leagueCarousel}
                      >
                        {homeLeagueSlides.map((league, leagueIndex) => (
                          <View key={`${league.id || "league"}-${leagueIndex}`} style={styles.leagueSlide}>
                            <View style={styles.leagueSlideHeader}>
                              <Text numberOfLines={1} style={styles.leagueSlideName}>
                                {league.nombre}
                              </Text>
                              <Text style={styles.leagueSlideStatus}>POR INICIAR</Text>
                            </View>
                            <Text numberOfLines={1} style={styles.leagueSlideCategory}>
                              {league.categoria} {league.sexo ? `- ${league.sexo}` : ""}
                            </Text>
                            <Text numberOfLines={1} style={styles.leagueSlideMeta}>
                              {league.complejoNombre}
                            </Text>
                            <Text numberOfLines={1} style={styles.leagueSlideMeta}>
                              {league.localidad || "Localidad a definir"} -{" "}
                              {buildLeagueScheduleLabel(league)}
                            </Text>
                          </View>
                        ))}
                      </ScrollView>

                      <View style={styles.leagueDotsRow}>
                        {homeLeagueSlides.map((league, index) => (
                          <View
                            key={`${league.id}-dot`}
                            style={[
                              styles.leagueDot,
                              index === activeLeagueIndex ? styles.leagueDotActive : null,
                            ]}
                          />
                        ))}
                      </View>
                    </>
                  ) : (
                    <View style={styles.previewRow}>
                      <View style={styles.previewDot} />
                      <Text style={styles.previewText}>
                        Todavia no hay ligas publicadas por iniciar para mostrar.
                      </Text>
                    </View>
                  )}
                </View>
              ) : selectedMenuItem.key === "Torneos" ? (
                <View style={styles.tournamentPreviewBlock}>
                  {homeTournamentSlides.length ? (
                    <>
                      <ScrollView
                        horizontal
                        onMomentumScrollEnd={(event) => {
                          const nextIndex = Math.round(
                            event.nativeEvent.contentOffset.x / TOURNAMENT_CAROUSEL_ITEM_WIDTH
                          );
                          setActiveTournamentIndex(
                            Math.max(0, Math.min(nextIndex, homeTournamentSlides.length - 1))
                          );
                        }}
                        ref={tournamentCarouselRef}
                        showsHorizontalScrollIndicator={false}
                        snapToInterval={TOURNAMENT_CAROUSEL_ITEM_WIDTH}
                        style={styles.tournamentCarousel}
                      >
                        {homeTournamentSlides.map((tournament, tournamentIndex) => {
                          const isInProgress =
                            tournament.status === "in_progress" || tournament.status === "building";
                          const category =
                            tournament?.compositionConfig?.label ||
                            tournament?.compositionLabel ||
                            "Categoria a confirmar";
                          const organizerLogoUrl =
                            tournament.organizerLogoUrl ||
                            tournament.organizerAvatarUrl ||
                            tournament.organizerPhotoUrl ||
                            "";

                          return (
                            <View
                              key={`${tournament.id || "tournament"}-${tournamentIndex}`}
                              style={[
                                styles.tournamentSlide,
                                isInProgress ? styles.tournamentSlideInProgress : null,
                              ]}
                            >
                              <View style={styles.tournamentSlideHeader}>
                                <Text numberOfLines={1} style={styles.tournamentSlideName}>
                                  {tournament.name || "Torneo"}
                                </Text>
                              </View>
                              <Text numberOfLines={1} style={styles.tournamentSlideCategory}>
                                {category}
                              </Text>
                              <Text numberOfLines={1} style={styles.tournamentSlideMeta}>
                                {tournament.venueLabel || "Sede a confirmar"}
                              </Text>
                              <View style={styles.tournamentSlideFooter}>
                                <Text numberOfLines={1} style={styles.tournamentSlideMetaStrong}>
                                  {formatHomeTournamentDate(tournament)}
                                </Text>
                              </View>
                              <View style={styles.tournamentOrganizerLogoWrap}>
                                <AvatarBadge
                                  color={isInProgress ? "#B6DAF2" : "#BFE6C8"}
                                  size={58}
                                  uri={organizerLogoUrl}
                                />
                              </View>
                            </View>
                          );
                        })}
                      </ScrollView>

                      <View style={styles.tournamentDotsRow}>
                        {homeTournamentSlides.map((tournament, index) => (
                          <View
                            key={`${tournament.id}-dot`}
                            style={[
                              styles.tournamentDot,
                              index === activeTournamentIndex ? styles.tournamentDotActive : null,
                            ]}
                          />
                        ))}
                      </View>
                    </>
                  ) : (
                    <View style={styles.previewRow}>
                      <View style={styles.previewDot} />
                      <Text style={styles.previewText}>
                        Todavia no hay torneos publicados para mostrar.
                      </Text>
                    </View>
                  )}
                </View>
              ) : (
                <View style={styles.previewList}>
                  {categorySummary.rows.map((row) => (
                    <View key={row} style={styles.previewRow}>
                      <View style={styles.previewDot} />
                      <Text style={styles.previewText}>{row}</Text>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </Pressable>

        <View style={styles.carouselSection}>
          <Text style={styles.sectionSubtitle}>
            Presiona la pelota para ver más
          </Text>

          <CircularMenu
            items={MENU_ITEMS}
            onItemPress={handleItemPress}
            onSelectionChange={(item) => setSelectedMenuItem(item)}
          />
        </View>

        <View style={styles.infoRow}>
          <Pressable
            disabled={!currentUser}
            onPress={() => setIsProfileVisible(true)}
            style={({ pressed }) => [
              styles.infoCard,
              pressed && currentUser ? styles.infoCardPressed : null,
            ]}
          >
            <View style={styles.profileProgressHeader}>
              <Text style={styles.infoLabel}>Perfil</Text>
              <Text style={styles.profileProgressValue}>{profileCompletion}%</Text>
            </View>
            <View style={styles.profileProgressTrack}>
              <View
                style={[
                  styles.profileProgressFill,
                  { width: `${profileCompletion}%` },
                  profileCompletion === 0 ? styles.profileProgressFillEmpty : null,
                ]}
              />
            </View>
            <Text style={styles.infoText}>
              Completa tu perfil y obtene beneficios
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      <LoginModal
        onClose={() => setIsLoginVisible(false)}
        onLogin={handleLogin}
        visible={isLoginVisible}
      />
      <ProfileModal
        navigation={navigation}
        onClose={() => setIsProfileVisible(false)}
        onLogout={handleLogout}
        onSave={handleProfileSave}
        user={currentUser}
        visible={isProfileVisible}
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
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl + BOTTOM_QUICK_ACTIONS_SPACE,
  },
  backgroundOrbTop: {
    position: "absolute",
    top: -50,
    right: -20,
    width: 190,
    height: 190,
    borderRadius: 999,
    backgroundColor: "rgba(31,171,137,0.15)",
  },
  backgroundOrbBottom: {
    position: "absolute",
    left: -60,
    bottom: 140,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(11,132,87,0.08)",
  },
  headerRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
    paddingTop: spacing.sm,
  },
  brandBlock: {
    flex: 1,
    paddingRight: spacing.md,
  },
  appName: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  appCaption: {
    color: colors.muted,
    fontSize: 14,
    marginTop: 2,
  },
  authButton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  authButtonPressed: {
    opacity: 0.88,
  },
  authButtonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "700",
  },
  userBadge: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    maxWidth: 176,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  userNameBlock: {
    justifyContent: "center",
    maxWidth: 104,
    minWidth: 88,
  },
  userBadgePressed: {
    opacity: 0.9,
  },
  userName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 16,
    textAlign: "left",
  },
  financeButton: {
    alignItems: "center",
    backgroundColor: colors.primaryDark,
    borderRadius: 18,
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.lg,
    minHeight: 62,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 18,
    elevation: 5,
  },
  adminHomeButton: {
    alignItems: "center",
    backgroundColor: "#123D33",
    borderRadius: 18,
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.md,
    shadowColor: "rgba(18,61,51,0.18)",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 1,
    shadowRadius: 18,
    elevation: 5,
  },
  financeButtonPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  financeIconWrap: {
    alignItems: "center",
    backgroundColor: "#F5C84B",
    borderRadius: 8,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  adminHomeIconWrap: {
    alignItems: "center",
    backgroundColor: "#D9FF63",
    borderRadius: 8,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  adminHomeIconText: {
    color: "#123D33",
    fontSize: 18,
    fontWeight: "900",
  },
  financeIconText: {
    color: colors.primaryDark,
    fontSize: 24,
    fontWeight: "900",
  },
  financeCopy: {
    flex: 1,
  },
  financeTitle: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0,
  },
  financeText: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: 28,
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 5,
  },
  heroCardPressed: {
    opacity: 0.92,
  },
  heroEyebrow: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginBottom: 4,
    textAlign: "center",
  },
  heroTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    lineHeight: 27,
    textAlign: "center",
  },
  playersAvailableTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 2,
  },
  playersAvailableDot: {
    backgroundColor: "#20C76F",
    borderRadius: 999,
    height: 10,
    marginRight: 8,
    shadowColor: "#20C76F",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    width: 10,
  },
  playersAvailableTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
    textAlign: "center",
  },
  heroDescription: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 19,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  phraseFrame: {
    alignItems: "center",
    height: 76,
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  phrasePill: {
    alignItems: "center",
    backgroundColor: colors.secondary,
    borderRadius: 22,
    height: 62,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    width: "100%",
  },
  heroPhrase: {
    color: colors.primaryDark,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 21,
    textAlign: "center",
  },
  paginationRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  paginationDot: {
    backgroundColor: colors.border,
    borderRadius: 999,
    height: 8,
    marginHorizontal: 4,
    width: 8,
  },
  paginationDotActive: {
    backgroundColor: colors.primary,
    width: 18,
  },
  previewList: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  playerPreviewList: {
    gap: 6,
    marginTop: spacing.sm,
  },
  playerPreviewRow: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 26,
  },
  playerPreviewName: {
    color: colors.text,
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
    marginLeft: 6,
    marginRight: spacing.xs,
  },
  playerPreviewCategory: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "700",
    maxWidth: 96,
    textAlign: "right",
  },
  leaguePreviewBlock: {
    marginTop: spacing.sm,
  },
  replacementHighlight: {
    backgroundColor: "#ECF8F2",
    borderColor: "#B7E4D0",
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: 9,
  },
  replacementEyebrow: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.8,
    marginBottom: 5,
    textAlign: "center",
  },
  replacementListScroll: {
    maxHeight: 136,
  },
  replacementCompactItem: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 5,
    overflow: "hidden",
  },
  replacementCompactItemAlt: {
    backgroundColor: "#F7FCFA",
  },
  replacementCompactRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 32,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  replacementCompactText: {
    color: colors.primaryDark,
    flex: 1,
    fontSize: 12,
    fontWeight: "900",
  },
  replacementMoreChip: {
    backgroundColor: colors.primaryDark,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  replacementMoreChipPressed: {
    opacity: 0.9,
  },
  replacementMoreChipText: {
    color: colors.surface,
    fontSize: 10,
    fontWeight: "900",
  },
  replacementExpandedBox: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingBottom: 8,
    paddingTop: 6,
  },
  replacementLeague: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
  },
  replacementText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 1,
  },
  replacementCandidatesText: {
    alignSelf: "flex-start",
    backgroundColor: colors.secondary,
    borderRadius: 999,
    color: colors.primaryDark,
    fontSize: 10,
    fontWeight: "900",
    marginTop: 7,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  postulateButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.primaryDark,
    borderRadius: 999,
    marginTop: 8,
    minHeight: 28,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  postulateButtonDone: {
    backgroundColor: "#FFF6DA",
    borderColor: "#E8C65A",
    borderWidth: 1,
  },
  postulateButtonRejected: {
    backgroundColor: "#F4F5F7",
    borderColor: colors.border,
    borderWidth: 1,
  },
  postulateButtonPressed: {
    opacity: 0.9,
  },
  postulateButtonText: {
    color: colors.surface,
    fontSize: 10,
    fontWeight: "900",
  },
  postulateButtonTextDone: {
    color: colors.primaryDark,
  },
  postulateButtonTextRejected: {
    color: colors.muted,
  },
  leagueCarousel: {
    marginHorizontal: -spacing.xs,
  },
  leagueSlide: {
    backgroundColor: "#EEF8FF",
    borderColor: "#B9DFF4",
    borderRadius: 16,
    borderWidth: 1,
    marginHorizontal: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    width: LEAGUE_CAROUSEL_ITEM_WIDTH - spacing.xs * 2,
  },
  leagueSlideHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  leagueSlideName: {
    color: colors.text,
    flex: 1,
    fontSize: 14,
    fontWeight: "900",
  },
  leagueSlideStatus: {
    backgroundColor: "#D9FF63",
    borderColor: "#A6D831",
    borderRadius: 999,
    borderWidth: 1,
    color: "#295400",
    fontSize: 9,
    fontWeight: "900",
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  leagueSlideCategory: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 5,
  },
  leagueSlideMeta: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 3,
  },
  leagueDotsRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 8,
  },
  leagueDot: {
    backgroundColor: colors.border,
    borderRadius: 999,
    height: 6,
    marginHorizontal: 3,
    width: 6,
  },
  leagueDotActive: {
    backgroundColor: colors.primary,
    width: 16,
  },
  tournamentPreviewBlock: {
    marginTop: spacing.sm,
  },
  tournamentCarousel: {
    marginHorizontal: -spacing.xs,
  },
  tournamentSlide: {
    backgroundColor: "#F2FBF4",
    borderColor: "#BFE6C8",
    borderRadius: 16,
    borderWidth: 1,
    marginHorizontal: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingRight: 76,
    paddingVertical: 10,
    position: "relative",
    width: TOURNAMENT_CAROUSEL_ITEM_WIDTH - spacing.xs * 2,
  },
  tournamentSlideInProgress: {
    backgroundColor: "#EAF6FF",
    borderColor: "#B6DAF2",
  },
  tournamentSlideHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  tournamentSlideName: {
    color: colors.text,
    flex: 1,
    fontSize: 14,
    fontWeight: "900",
  },
  tournamentSlideCategory: {
    color: "#1D6A35",
    fontSize: 12,
    fontWeight: "900",
    marginTop: 5,
  },
  tournamentSlideMeta: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 3,
    paddingRight: 4,
  },
  tournamentSlideFooter: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "space-between",
    marginTop: 7,
  },
  tournamentSlideMetaStrong: {
    color: colors.text,
    flex: 1,
    fontSize: 11,
    fontWeight: "900",
  },
  tournamentOrganizerLogoWrap: {
    alignItems: "center",
    justifyContent: "center",
    position: "absolute",
    right: 10,
    top: "50%",
    transform: [{ translateY: -29 }],
    width: 64,
  },
  tournamentDotsRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 8,
  },
  tournamentDot: {
    backgroundColor: "#BFE6C8",
    borderRadius: 999,
    height: 6,
    marginHorizontal: 3,
    width: 6,
  },
  tournamentDotActive: {
    backgroundColor: "#1D8A45",
    width: 16,
  },
  previewRow: {
    alignItems: "center",
    flexDirection: "row",
  },
  previewDot: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    height: 8,
    marginRight: spacing.sm,
    width: 8,
  },
  previewText: {
    color: colors.text,
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 18,
  },
  carouselSection: {
    marginBottom: spacing.xl + 8,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "800",
    marginBottom: spacing.xs,
    textAlign: "center",
  },
  sectionSubtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: spacing.md,
    textAlign: "center",
  },
  infoRow: {
    gap: spacing.md,
  },
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    padding: spacing.lg,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 4,
  },
  infoCardPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  profileProgressHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  infoLabel: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  profileProgressValue: {
    color: colors.primaryDark,
    fontSize: 18,
    fontWeight: "900",
  },
  profileProgressTrack: {
    backgroundColor: colors.secondary,
    borderRadius: 999,
    height: 12,
    marginBottom: spacing.sm,
    overflow: "hidden",
  },
  profileProgressFill: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    height: "100%",
    minWidth: 8,
  },
  profileProgressFillEmpty: {
    minWidth: 0,
  },
  infoText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
});

