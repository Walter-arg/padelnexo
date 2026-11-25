import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
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
import FeedbackModal from "../components/FeedbackModal";
import SectionFilterBar from "../components/SectionFilterBar";
import SectionHeader from "../components/SectionHeader";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import { LEAGUE_BRANCH_OPTIONS } from "../services/leaguesService";
import { listUserBrandingProfiles } from "../services/userService";
import {
  deleteCancelledTournament,
  deleteDraftTournament,
  findTournamentRegistrationsByPlayer,
  getTournamentById,
  listOrganizerDraftTournaments,
  listTournamentsWithRegistrationCounts,
} from "../services/tournamentsService";
import { hasActivePlan, isApprovedOrganizer } from "../services/roleService";
import {
  calculateDistanceKm,
  geocodeAddress,
  getCoordinatesFromObject,
  requestCurrentLocation,
} from "../services/locationService";
import { auth } from "../../services/firebaseConfig";

const HISTORY_WINDOW_DAYS = 30;
const ORGANIZER_MENU_OPTIONS = [
  { key: "active", label: "MIS TORNEOS" },
  { key: "finished", label: "FINALIZADOS" },
  { key: "cancelled", label: "CANCELADOS" },
  { key: "rescheduled", label: "REPROGRAMADOS" },
];
const PLAYER_MENU_OPTIONS = [
  { key: "published", label: "PUBLICADOS" },
  { key: "mine", label: "MIS TORNEOS" },
  { key: "finished", label: "FINALIZADOS" },
  { key: "cancelled", label: "CANCELADOS" },
  { key: "rescheduled", label: "REPROGRAMADOS" },
];
const PROXIMITY_RADIUS_OPTIONS = [5, 10, 20, 50];
const DEFAULT_TOURNAMENT_FILTERS = {
  localidades: [],
  sexo: "Todos",
  categoria: "Todas",
  complejo: "Todos",
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
    label: "Inscripciones abiertas",
    tint: "#D9FF63",
    border: "#A6D831",
    accent: "#295400",
  },
  registration_closed: {
    label: "Inscripcion cerrada",
    tint: "#EAF4FF",
    border: "#A9C8E7",
    accent: "#2D5B8C",
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

function areTournamentFiltersEqual(left = {}, right = {}) {
  const leftLocations = Array.isArray(left.localidades) ? left.localidades : [];
  const rightLocations = Array.isArray(right.localidades) ? right.localidades : [];

  return (
    left.sexo === right.sexo &&
    left.categoria === right.categoria &&
    left.complejo === right.complejo &&
    leftLocations.length === rightLocations.length &&
    leftLocations.every((location, index) => location === rightLocations[index])
  );
}

function sortByUpdatedAt(items = []) {
  return [...items].sort((first, second) => {
    const secondValue = Number(second?.updatedAtMillis || second?.createdAtMillis || 0);
    const firstValue = Number(first?.updatedAtMillis || first?.createdAtMillis || 0);
    return secondValue - firstValue;
  });
}

function formatTournamentDays(tournament = {}) {
  const startDateMillis = Number(tournament.startDateMillis || 0);
  const endDateMillis = Number(tournament.endDateMillis || 0);

  if (startDateMillis || endDateMillis) {
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

    if (startDateMillis && endDateMillis) {
      const startDate = new Date(startDateMillis);
      const endDate = new Date(endDateMillis);
      const sameMonth =
        startDate.getMonth() === endDate.getMonth() &&
        startDate.getFullYear() === endDate.getFullYear();

      if (sameMonth && endDate >= startDate) {
        return buildConsecutiveDaysLabel(startDate, endDate);
      }

      return `${formatDate(startDateMillis)} al ${formatDate(endDateMillis)}`;
    }

    if (startDateMillis) {
      return `Desde ${formatDate(startDateMillis)}`;
    }

    return `Hasta ${formatDate(endDateMillis)}`;
  }

  const days = Array.isArray(tournament.groupStageDays) && tournament.groupStageDays.length
    ? tournament.groupStageDays
    : Array.isArray(tournament.playDays)
    ? tournament.playDays
    : [];

  if (!days.length) {
    return "A confirmar";
  }

  const dayLabels = {
    monday: "Lun",
    tuesday: "Mar",
    wednesday: "Mie",
    thursday: "Jue",
    friday: "Vie",
    saturday: "Sab",
    sunday: "Dom",
  };

  return days.map((dayKey) => dayLabels[dayKey] || dayKey).join(" / ");
}

function getTournamentStatusMeta(status = "") {
  return STATUS_META[status] || STATUS_META.draft;
}

function buildColorFromString(value = "") {
  const palette = ["#E4572E", "#1C7ED6", "#0F9D58", "#C77D00", "#D63384", "#6C5CE7"];
  const normalized = String(value || "").trim();

  if (!normalized) {
    return "#144234";
  }

  let hash = 0;

  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0;
  }

  return palette[hash % palette.length];
}

function getTournamentTitleColor(tournament = {}) {
  const batchScopedSeed = [tournament.creationBatchId, tournament.name]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(":");

  return buildColorFromString(
    batchScopedSeed ||
      tournament.compositionLabel ||
      tournament?.compositionConfig?.label ||
      tournament.name
  );
}

function getOrganizerViewMeta(viewKey = "active") {
  if (viewKey === "finished") {
    return { subtitle: "Finalizados", title: "Finalizados" };
  }

  if (viewKey === "cancelled") {
    return { subtitle: "Cancelados", title: "Cancelados" };
  }

  if (viewKey === "rescheduled") {
    return { subtitle: "Reprogramados", title: "Reprogramados" };
  }

  return { subtitle: "Torneos", title: "Torneos" };
}

function resolveOrganizerLastArea(areaKey = "") {
  return ["registration", "fixture", "payments", "management"].includes(areaKey)
    ? areaKey
    : "management";
}

function getPlayerViewMeta(viewKey = "published") {
  if (viewKey === "mine") {
    return { subtitle: "Mis torneos", title: "Mis torneos" };
  }

  if (viewKey === "finished") {
    return { subtitle: "Finalizados", title: "Finalizados" };
  }

  if (viewKey === "cancelled") {
    return { subtitle: "Cancelados", title: "Cancelados" };
  }

  if (viewKey === "rescheduled") {
    return { subtitle: "Reprogramados", title: "Reprogramados" };
  }

  return { subtitle: "Publicados", title: "Publicados" };
}

function getTournamentLocationNames(tournament = {}) {
  const locations = [
    ...(Array.isArray(tournament.venues) ? tournament.venues : []),
    ...(Array.isArray(tournament.temporaryVenues) ? tournament.temporaryVenues : []),
  ]
    .map((venue) => normalizeText(venue?.city || venue?.ciudad || ""))
    .filter(Boolean);

  if (locations.length) {
    return locations;
  }

  const fallback = normalizeText(
    tournament.city || tournament.ciudad || tournament.venueCity || ""
  );

  return fallback ? [fallback] : [];
}

function getTournamentBranchLabel(tournament = {}) {
  const branch = tournament?.compositionConfig?.branch || "";
  return LEAGUE_BRANCH_OPTIONS.some((option) => option.value === branch) ? branch : "Todos";
}

function getTournamentComplexNames(tournament = {}) {
  const complexes = [
    ...(Array.isArray(tournament.venues) ? tournament.venues : []),
    ...(Array.isArray(tournament.temporaryVenues) ? tournament.temporaryVenues : []),
  ]
    .map((venue) => normalizeText(venue?.name || venue?.nombre || ""))
    .filter(Boolean);

  if (complexes.length) {
    return complexes;
  }

  const fallback = normalizeText(tournament.venueLabel || "");
  return fallback && fallback !== "sede a confirmar" ? [fallback] : [];
}

function getTournamentVenueEntries(tournament = {}) {
  return [
    ...(Array.isArray(tournament.venues) ? tournament.venues : []),
    ...(Array.isArray(tournament.temporaryVenues) ? tournament.temporaryVenues : []),
  ];
}

function buildTournamentDistanceKey(tournament = {}) {
  return `${tournament.id || tournament.name || "tournament"}|${tournament.venueLabel || ""}`;
}

function getTournamentCoordinates(tournament = {}) {
  const venues = getTournamentVenueEntries(tournament);

  for (const venue of venues) {
    const coordinates = getCoordinatesFromObject(venue);

    if (coordinates) {
      return coordinates;
    }
  }

  return getCoordinatesFromObject(tournament);
}

function buildTournamentGeocodeCandidates(tournament = {}) {
  const venueCandidates = getTournamentVenueEntries(tournament).flatMap((venue) => [
    [venue.address || venue.direccion, venue.city || venue.ciudad, venue.province || venue.provincia, "Argentina"]
      .filter(Boolean)
      .join(", "),
    [venue.name || venue.nombre, venue.city || venue.ciudad, venue.province || venue.provincia, "Argentina"]
      .filter(Boolean)
      .join(", "),
  ]);
  const fallbackCandidates = [
    [tournament.venueLabel, tournament.city || tournament.ciudad, tournament.province || tournament.provincia, "Argentina"]
      .filter(Boolean)
      .join(", "),
    [tournament.city || tournament.ciudad, tournament.province || tournament.provincia, "Argentina"]
      .filter(Boolean)
      .join(", "),
  ];

  return [...venueCandidates, ...fallbackCandidates].filter(Boolean);
}

function getHistoryCutoffMillis() {
  return Date.now() - HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

function isHistoricalTournament(tournament = {}) {
  if (tournament.status !== "finished" && tournament.status !== "cancelled") {
    return false;
  }

  const referenceMillis = Number(
    tournament.updatedAtMillis || tournament.createdAtMillis || 0
  );

  return referenceMillis >= getHistoryCutoffMillis();
}

function isReprogrammedTournament(tournament = {}) {
  return Boolean(
    tournament.reprogrammedAt ||
      tournament.rescheduledAt ||
      tournament.wasRescheduled ||
      Number(tournament.scheduleChangesCount || 0) > 0
  );
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
  const pairLimitsEnabled = tournament.pairLimitsEnabled !== false;
  const maxPairs = pairLimitsEnabled ? Number(tournament.maxPairs || 0) : 0;
  const confirmedRegistrationsCount = Number(
    tournament.confirmedRegistrationsCount || registrationsCount || 0
  );

  let displayStatus = tournament.status;

  if (tournament.status === "finished" || tournament.championPairId) {
    displayStatus = "finished";
  } else if (tournament.status === "building" || tournament.status === "in_progress") {
    displayStatus = "in_progress";
  } else if (tournament.status === "registration_open") {
    displayStatus = "registration_open";
  } else if (tournament.status === "registration_closed") {
    displayStatus = "registration_closed";
  } else if (confirmedRegistrationsCount >= maxPairs && maxPairs > 0) {
    displayStatus = "registration_closed";
  } else if (confirmedRegistrationsCount > 0) {
    displayStatus = "published";
  }

  let occupancyInfo = null;
  if (maxPairs > 0 && tournament.showOccupancyCard) {
    const remaining = maxPairs - confirmedRegistrationsCount;
    if (remaining <= 0) {
      occupancyInfo = { text: "Sin cupos disponibles", color: "#6B7280", icon: "close-circle-outline" };
    } else if (remaining === 1) {
      occupancyInfo = { text: "Último cupo disponible", color: "#D97706", icon: "alert-circle-outline" };
    } else if (remaining === 2) {
      occupancyInfo = { text: "Últimos 2 cupos", color: "#D97706", icon: "alert-circle-outline" };
    } else {
      const pct = maxPairs > 0 ? Math.round((confirmedRegistrationsCount / maxPairs) * 100) : 0;
      occupancyInfo = { text: `${pct}% de cupos cubiertos`, color: null, icon: "people-outline" };
    }
  }

  return {
    ...tournament,
    userRegistration: registrationMeta?.registration || null,
    displayStatus,
    confirmedRegistrationsCount,
    tournamentDaysLabel: formatTournamentDays(tournament),
    occupancyInfo,
    categoryLabel:
      tournament?.compositionConfig?.label ||
      tournament?.compositionLabel ||
      "Categoria a confirmar",
  };
}

function getRegistrationChipMeta(registration = null, isRegistrationClosed = false) {
  if (!registration) {
    if (isRegistrationClosed) {
      return {
        accent: "#6B7280",
        border: "#D1D5DB",
        label: "Inscribirse",
        tint: "#F3F4F6",
      };
    }

    return {
      accent: "#0F7A4F",
      border: "#9FE3C6",
      label: "¡Inscribite aqui! 🎾",
      tint: "#EAFBF3",
    };
  }

  if (registration.withdrawalStatus === "confirmed") {
    return {
      accent: "#44515C",
      border: "#B9C5CF",
      label: "Baja confirmada",
      tint: "#EEF2F5",
    };
  }

  if (registration.withdrawalStatus === "requested") {
    return {
      accent: "#2D5B8C",
      border: "#A9C8E7",
      label: "Baja solicitada",
      tint: "#EAF4FF",
    };
  }

  if (registration.status === "confirmed") {
    return {
      accent: "#0F5F36",
      border: "#72C98B",
      label: "Inscripto",
      tint: "#CFF4D8",
    };
  }

  return {
    accent: "#9B6A18",
    border: "#E8CF9B",
    label: "Esperando confirmacion",
    tint: "#FFF6EA",
  };
}

function getPlayerStatusBadgeMeta(isOpen) {
  return isOpen
    ? { label: "Inscripciones Abiertas", tint: "#E3F9E8", accent: "#1B8A47" }
    : { label: "Inscripciones Cerradas", tint: "#EDF2F5", accent: "#5F7D8A" };
}

// Tarjeta del torneo para el jugador: encabezado con el club, estado de
// inscripcion, titulo, grilla de categorias (todas las que tenga el lote) y
// un boton inferior puramente visual (toda la tarjeta sigue siendo un unico
// Pressable, igual que antes del rediseno).
function PlayerTournamentCard({
  categories,
  representative,
  isCardPressEnabled,
  onPress,
  onViewPoster,
  isOpenForRegistration,
  ctaLabel,
  ctaBackgroundColor,
  ctaTextColor,
}) {
  const titleColor = getTournamentTitleColor(representative);
  const title = representative.baseName || representative.name || "Nombre del torneo";
  const statusBadge = getPlayerStatusBadgeMeta(isOpenForRegistration);

  return (
    <View style={styles.cardShell}>
      <Pressable
        disabled={!isCardPressEnabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.playerCard,
          pressed && isCardPressEnabled ? styles.cardPressed : null,
          !isCardPressEnabled ? styles.cardDisabled : null,
        ]}
      >
        <View style={styles.playerCardTopRow}>
          <View style={styles.playerCardClubRow}>
            {representative.organizerLogoUrl ? (
              <Image source={{ uri: representative.organizerLogoUrl }} style={styles.playerCardClubLogo} />
            ) : (
              <View style={styles.playerCardClubLogoPlaceholder}>
                <Ionicons color={colors.primaryDark} name="shield-outline" size={18} />
              </View>
            )}
            <Text numberOfLines={2} style={styles.playerCardClubName}>
              {representative.venueLabel || "Club a confirmar"}
            </Text>
          </View>
          <View style={[styles.playerCardStatusBadge, { backgroundColor: statusBadge.tint }]}>
            <View style={[styles.playerCardStatusDot, { backgroundColor: statusBadge.accent }]} />
            <Text style={[styles.playerCardStatusText, { color: statusBadge.accent }]}>
              {statusBadge.label}
            </Text>
          </View>
        </View>

        {representative.coverImage ? (
          <Pressable
            hitSlop={6}
            onPress={() => onViewPoster?.(representative)}
            style={({ pressed }) => [
              styles.playerCardPosterLink,
              pressed ? styles.playerCardPosterLinkPressed : null,
            ]}
          >
            <Ionicons color={colors.primaryDark} name="image-outline" size={13} />
            <Text style={styles.playerCardPosterLinkText}>Ver afiche</Text>
          </Pressable>
        ) : null}

        <Text style={styles.playerCardEyebrow}>TORNEO</Text>
        <Text numberOfLines={2} style={[styles.playerCardTitle, { color: titleColor }]}>
          {title}
        </Text>

        <View style={styles.playerCardDividerRow}>
          <View style={styles.playerCardDividerLine} />
          <View style={styles.playerCardDividerBadge}>
            <Text style={styles.playerCardDividerText}>CATEGORÍAS</Text>
          </View>
          <View style={styles.playerCardDividerLine} />
        </View>

        <View style={styles.playerCardCategoryGrid}>
          {categories.map((category) => (
            <View key={category.id} style={styles.playerCardCategoryChip}>
              <Text numberOfLines={1} style={styles.playerCardCategoryChipText}>
                {category.categoryLabel}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.playerCardDateRow}>
          <Ionicons color={colors.primaryDark} name="calendar-outline" size={14} />
          <Text numberOfLines={2} style={styles.playerCardDateText}>
            {representative.tournamentDaysLabel}
          </Text>
        </View>

        <View style={[styles.playerCardCtaButton, { backgroundColor: ctaBackgroundColor }]}>
          {ctaLabel === "INSCRIBIRME" ? (
            <Ionicons color={ctaTextColor} name="happy-outline" size={16} />
          ) : null}
          <Text style={[styles.playerCardCtaText, { color: ctaTextColor }]}>{ctaLabel}</Text>
        </View>
      </Pressable>
    </View>
  );
}

// Misma estetica que PlayerTournamentCard (logo+club, titulo, grilla de
// categorias, fecha) para el organizador, pero sin el boton INSCRIBIRME y
// mostrando el estado real de cada categoria (Borrador/Armando/etc.) en vez
// del estado simplificado abierto/cerrado del jugador.
function OrganizerTournamentCard({
  categories,
  representative,
  isCardPressEnabled,
  onPress,
  onViewPoster,
  onEditDraft,
  onDeleteDraft,
  onDeleteCancelled,
  showDraftDelete,
  showCancelledDelete,
}) {
  const titleColor = getTournamentTitleColor(representative);
  const title = representative.baseName || representative.name || "Nombre del torneo";
  const hasOpenCategory = categories.some(
    (category) => (category.displayStatus || category.status) === "registration_open"
  );
  const areAllCategoriesClosed = categories.every((category) =>
    ["published", "registration_closed"].includes(category.displayStatus || category.status)
  );
  const headerStatusMeta = hasOpenCategory
    ? getTournamentStatusMeta("registration_open")
    : areAllCategoriesClosed
    ? getTournamentStatusMeta("registration_closed")
    : getTournamentStatusMeta(representative.displayStatus || representative.status);

  return (
    <View style={styles.cardShell}>
      <Pressable
        disabled={!isCardPressEnabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.playerCard,
          pressed && isCardPressEnabled ? styles.cardPressed : null,
          !isCardPressEnabled ? styles.cardDisabled : null,
        ]}
      >
        <View style={styles.playerCardTopRow}>
          <View style={styles.playerCardClubRow}>
            {representative.organizerLogoUrl ? (
              <Image source={{ uri: representative.organizerLogoUrl }} style={styles.playerCardClubLogo} />
            ) : (
              <View style={styles.playerCardClubLogoPlaceholder}>
                <Ionicons color={colors.primaryDark} name="shield-outline" size={18} />
              </View>
            )}
            <Text numberOfLines={2} style={styles.playerCardClubName}>
              {representative.venueLabel || "Club a confirmar"}
            </Text>
          </View>
          <View style={styles.organizerCardStatusCluster}>
            <View style={[styles.playerCardStatusBadge, { backgroundColor: headerStatusMeta.tint }]}>
              <View style={[styles.playerCardStatusDot, { backgroundColor: headerStatusMeta.accent }]} />
              <Text style={[styles.playerCardStatusText, { color: headerStatusMeta.accent }]}>
                {headerStatusMeta.label}
              </Text>
            </View>
            {showDraftDelete || showCancelledDelete ? (
              <View style={styles.draftChipActions}>
                {showDraftDelete ? (
                  <Pressable
                    hitSlop={8}
                    onPress={() => onEditDraft?.(representative)}
                    style={({ pressed }) => [
                      styles.draftChipButton,
                      pressed && styles.draftChipButtonPressed,
                    ]}
                  >
                    <Ionicons color={colors.primaryDark} name="create-outline" size={14} />
                  </Pressable>
                ) : null}
                <Pressable
                  hitSlop={8}
                  onPress={() =>
                    showCancelledDelete
                      ? onDeleteCancelled?.(representative)
                      : onDeleteDraft?.(representative)
                  }
                  style={({ pressed }) => [
                    styles.draftChipButton,
                    styles.draftChipDeleteButton,
                    pressed && styles.draftChipButtonPressed,
                  ]}
                >
                  <Ionicons color="#B24343" name="trash-outline" size={14} />
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>

        {representative.coverImage ? (
          <Pressable
            hitSlop={6}
            onPress={() => onViewPoster?.(representative)}
            style={({ pressed }) => [
              styles.playerCardPosterLink,
              pressed ? styles.playerCardPosterLinkPressed : null,
            ]}
          >
            <Ionicons color={colors.primaryDark} name="image-outline" size={13} />
            <Text style={styles.playerCardPosterLinkText}>Ver afiche</Text>
          </Pressable>
        ) : null}

        <Text style={styles.playerCardEyebrow}>TORNEO</Text>
        <Text numberOfLines={2} style={[styles.playerCardTitle, { color: titleColor }]}>
          {title}
        </Text>

        <View style={styles.playerCardDividerRow}>
          <View style={styles.playerCardDividerLine} />
          <View style={styles.playerCardDividerBadge}>
            <Text style={styles.playerCardDividerText}>CATEGORÍAS</Text>
          </View>
          <View style={styles.playerCardDividerLine} />
        </View>

        <View style={styles.playerCardCategoryGrid}>
          {categories.map((category) => {
            const categoryStatusMeta = getTournamentStatusMeta(
              category.displayStatus || category.status
            );

            return (
              <View key={category.id} style={styles.playerCardCategoryChip}>
                <Text numberOfLines={1} style={styles.playerCardCategoryChipText}>
                  {category.categoryLabel}
                </Text>
                <View style={styles.organizerCategoryStatusRow}>
                  <View
                    style={[
                      styles.organizerCategoryStatusDot,
                      { backgroundColor: categoryStatusMeta.accent },
                    ]}
                  />
                  <Text
                    numberOfLines={1}
                    style={[styles.organizerCategoryStatusText, { color: categoryStatusMeta.accent }]}
                  >
                    {categoryStatusMeta.label}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        <View style={styles.playerCardDateRow}>
          <Ionicons color={colors.primaryDark} name="calendar-outline" size={14} />
          <Text numberOfLines={2} style={styles.playerCardDateText}>
            {representative.tournamentDaysLabel}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

function TournamentCard({
  canManageTournament,
  item,
  onDeleteCancelled,
  onEditDraft,
  onDeleteDraft,
  onOpenRegistration,
  onPress,
  onViewPoster,
  showDraftDelete,
  showCancelledDelete,
}) {
  const registration = item.userRegistration;
  const hasRegistration = Boolean(registration);
  const isPlayerFacingCard = !canManageTournament;
  const isRegistrationClosed =
    isPlayerFacingCard &&
    !hasRegistration &&
    ["published", "registration_closed"].includes(item.displayStatus || item.status);
  const registrationChipMeta = getRegistrationChipMeta(registration, isRegistrationClosed);
  const isWithdrawnRegistration = registration?.withdrawalStatus === "confirmed";
  const isCardDisabled = isPlayerFacingCard && (isWithdrawnRegistration || isRegistrationClosed);
  const isCardPressEnabled = !isCardDisabled;

  if (!canManageTournament) {
    const isOpenForRegistration = (item.displayStatus || item.status) === "registration_open";
    let ctaLabel = "INSCRIBIRME";
    let ctaBackgroundColor = colors.primaryDark;
    let ctaTextColor = "#FFFFFF";

    if (isCardDisabled) {
      ctaLabel = isWithdrawnRegistration ? "BAJA CONFIRMADA" : "INSCRIPCIONES CERRADAS";
      ctaBackgroundColor = "#E6EAED";
      ctaTextColor = "#8A99A3";
    } else if (hasRegistration) {
      ctaLabel = String(registrationChipMeta.label || "").toUpperCase();
      ctaBackgroundColor = registrationChipMeta.tint;
      ctaTextColor = registrationChipMeta.accent;
    }

    return (
      <PlayerTournamentCard
        categories={[item]}
        ctaBackgroundColor={ctaBackgroundColor}
        ctaLabel={ctaLabel}
        ctaTextColor={ctaTextColor}
        isCardPressEnabled={isCardPressEnabled}
        isOpenForRegistration={isOpenForRegistration}
        onPress={() => onPress(item)}
        onViewPoster={onViewPoster}
        representative={item}
      />
    );
  }

  return (
    <OrganizerTournamentCard
      categories={[item]}
      isCardPressEnabled={isCardPressEnabled}
      onDeleteCancelled={onDeleteCancelled}
      onDeleteDraft={onDeleteDraft}
      onEditDraft={onEditDraft}
      onPress={() => onPress(item)}
      onViewPoster={onViewPoster}
      representative={item}
      showCancelledDelete={showCancelledDelete}
      showDraftDelete={showDraftDelete}
    />
  );
}

function TournamentSectionHeader({ title }) {
  return (
    <View style={styles.sectionHeaderCard}>
      <Text style={styles.sectionHeaderTitle}>{title}</Text>
    </View>
  );
}

function pickEntryTournament(categories = [], canManageTournament = false) {
  if (!categories.length) {
    return null;
  }

  if (canManageTournament) {
    return categories[0];
  }

  const registered = categories.find((tournament) => tournament.userRegistration);
  if (registered) {
    return registered;
  }

  const open = categories.find(
    (tournament) => (tournament.displayStatus || tournament.status) === "registration_open"
  );
  if (open) {
    return open;
  }

  return categories[0];
}

function isCategoryClosedForPlayer(tournament = {}) {
  const registration = tournament.userRegistration;
  const isWithdrawn = registration?.withdrawalStatus === "confirmed";
  const isClosed =
    !registration &&
    ["published", "registration_closed"].includes(tournament.displayStatus || tournament.status);

  return isWithdrawn || isClosed;
}

function TournamentEventCard({
  canManageTournament,
  categories,
  onOpenRegistration,
  onPress,
  onViewPoster,
}) {
  const representative = categories[0];
  const isCardPressEnabled =
    canManageTournament || !categories.every(isCategoryClosedForPlayer);

  const handlePress = () => {
    const entryTournament = pickEntryTournament(categories, canManageTournament);

    if (!entryTournament) {
      return;
    }

    if (canManageTournament) {
      onPress(entryTournament);
    } else {
      onOpenRegistration(entryTournament);
    }
  };

  if (!canManageTournament) {
    const isOpenForRegistration = categories.some(
      (category) => (category.displayStatus || category.status) === "registration_open"
    );
    const registeredCategory = categories.find((category) => category.userRegistration);
    let ctaLabel = "INSCRIBIRME";
    let ctaBackgroundColor = colors.primaryDark;
    let ctaTextColor = "#FFFFFF";

    if (!isCardPressEnabled) {
      ctaLabel = "INSCRIPCIONES CERRADAS";
      ctaBackgroundColor = "#E6EAED";
      ctaTextColor = "#8A99A3";
    } else if (registeredCategory) {
      const chipMeta = getRegistrationChipMeta(registeredCategory.userRegistration);
      ctaLabel = String(chipMeta.label || "").toUpperCase();
      ctaBackgroundColor = chipMeta.tint;
      ctaTextColor = chipMeta.accent;
    }

    return (
      <PlayerTournamentCard
        categories={categories}
        ctaBackgroundColor={ctaBackgroundColor}
        ctaLabel={ctaLabel}
        ctaTextColor={ctaTextColor}
        isCardPressEnabled={isCardPressEnabled}
        isOpenForRegistration={isOpenForRegistration}
        onPress={handlePress}
        onViewPoster={onViewPoster}
        representative={representative}
      />
    );
  }

  return (
    <OrganizerTournamentCard
      categories={categories}
      isCardPressEnabled={isCardPressEnabled}
      onPress={handlePress}
      onViewPoster={onViewPoster}
      representative={representative}
    />
  );
}

function CreateTournamentButton({ onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.createButton, pressed && styles.createButtonPressed]}
    >
      <View style={styles.createButtonIconWrap}>
        <Ionicons color={colors.surface} name="add" size={18} />
      </View>
      <View style={styles.createButtonTextWrap}>
        <Text style={styles.createButtonText}>CREAR TORNEO</Text>
      </View>
      <Ionicons color={colors.surface} name="chevron-forward" size={16} />
    </Pressable>
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

  const title =
    currentTab === "mine"
      ? "Todavia no tenes torneos en curso"
      : currentTab === "finished" || currentTab === "cancelled" || currentTab === "rescheduled"
      ? "Todavia no hay historial reciente"
      : canCreate
      ? "Todavia no tenes torneos activos"
      : "Todavia no hay torneos cargados";
  const message =
    currentTab === "mine"
      ? "Aca vas a encontrar los torneos donde ya estas inscripto o jugando."
      : currentTab === "finished" || currentTab === "cancelled" || currentTab === "rescheduled"
      ? "Los torneos finalizados o cancelados quedan visibles durante 30 dias."
      : canCreate
      ? "Cuando crees un torneo nuevo, va a aparecer directamente en esta vista."
      : "Cuando haya torneos publicados, los vas a encontrar aca.";

  return (
    <View style={styles.emptyCard}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );
}

export default function TorneosScreen({ navigation, route }) {
  const { user, userData } = useAuth();
  const canCreateTournament = isApprovedOrganizer(userData) && hasActivePlan(userData);
  const organizerView = canCreateTournament
    ? route?.params?.organizerView || "active"
    : "active";
  const organizerViewMeta = getOrganizerViewMeta(organizerView);
  const playerView = canCreateTournament ? "published" : route?.params?.playerView || "published";
  const playerViewMeta = getPlayerViewMeta(playerView);
  const headerSubtitle = canCreateTournament ? organizerViewMeta.subtitle : playerViewMeta.subtitle;
  const resolvedHeaderSubtitle = headerSubtitle === "Torneos" ? "" : headerSubtitle;
  const [showOrganizerHistoryMenu, setShowOrganizerHistoryMenu] = useState(false);
  const [showPlayerHistoryMenu, setShowPlayerHistoryMenu] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tournaments, setTournaments] = useState([]);
  const [organizerBrandingMap, setOrganizerBrandingMap] = useState({});
  const [registrationsByTournament, setRegistrationsByTournament] = useState([]);
  const [feedback, setFeedback] = useState({
    visible: false,
    title: "",
    message: "",
    tone: "default",
  });
  const [cancelledTournamentToDelete, setCancelledTournamentToDelete] = useState(null);
  const [deletingCancelledTournament, setDeletingCancelledTournament] = useState(false);
  const [locationActionsVisible, setLocationActionsVisible] = useState(false);
  const [locatingUser, setLocatingUser] = useState(false);
  const [proximityFilter, setProximityFilter] = useState({
    enabled: false,
    radiusKm: 10,
    userCoordinates: null,
  });
  const [tournamentCoordinatesByKey, setTournamentCoordinatesByKey] = useState({});

  const currentUserId = userData?.uid || user?.uid || auth?.currentUser?.uid || "";
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
  const [appliedFilters, setAppliedFilters] = useState(DEFAULT_TOURNAMENT_FILTERS);
  const [draftSexo, setDraftSexo] = useState("Todos");
  const [draftCategoria, setDraftCategoria] = useState("Todas");
  const [draftComplejo, setDraftComplejo] = useState("Todos");
  const hasActiveFilters =
    appliedFilters.localidades.length > 0 ||
    appliedFilters.sexo !== "Todos" ||
    appliedFilters.categoria !== "Todas" ||
    appliedFilters.complejo !== "Todos" ||
    proximityFilter.enabled;

  useEffect(() => {
    setAppliedFilters((current) =>
      areTournamentFiltersEqual(current, DEFAULT_TOURNAMENT_FILTERS)
        ? current
        : DEFAULT_TOURNAMENT_FILTERS
    );
    setDraftSexo((current) => (current === "Todos" ? current : "Todos"));
    setDraftCategoria((current) => (current === "Todas" ? current : "Todas"));
    setDraftComplejo((current) => (current === "Todos" ? current : "Todos"));
  }, [canCreateTournament, currentUserId, userLocalidad]);

  useEffect(() => {
    if (!route?.params?.resetOrganizerFilters || !canCreateTournament) {
      return;
    }

    setAppliedFilters((current) =>
      areTournamentFiltersEqual(current, DEFAULT_TOURNAMENT_FILTERS)
        ? current
        : DEFAULT_TOURNAMENT_FILTERS
    );
    navigation.setParams({
      resetOrganizerFilters: undefined,
    });
  }, [canCreateTournament, navigation, route?.params?.resetOrganizerFilters]);

  useEffect(() => {
    if (canCreateTournament) {
      setShowOrganizerHistoryMenu(false);
    }
  }, [canCreateTournament, organizerView]);

  useEffect(() => {
    if (!canCreateTournament) {
      setShowPlayerHistoryMenu(false);
    }
  }, [canCreateTournament, playerView]);

  useEffect(() => {
    if (canCreateTournament) {
      return;
    }

    if (route?.params?.playerView && route.params.playerView !== "published") {
      navigation.setParams({ playerView: "published" });
    }
  }, [canCreateTournament, currentUserId, navigation, route?.params?.playerView]);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      const loadTournamentHub = async () => {
        try {
          setLoading(true);
          const [tournamentsResponse, draftTournamentsResponse, registrationsResponse, brandingProfiles] = await Promise.all([
            listTournamentsWithRegistrationCounts(),
            canCreateTournament && currentUserId ? listOrganizerDraftTournaments(currentUserId) : Promise.resolve([]),
            currentUserId ? findTournamentRegistrationsByPlayer(currentUserId) : Promise.resolve([]),
            listUserBrandingProfiles(),
          ]);

          const draftIds = new Set((draftTournamentsResponse || []).map((t) => t.id));
          let nextTournaments = sortByUpdatedAt([
            ...tournamentsResponse.filter((t) => !draftIds.has(t.id)),
            ...(draftTournamentsResponse || []),
          ]);
          const createdTournamentId = route?.params?.createdTournamentId || "";
          const createdTournament = route?.params?.createdTournament || null;

          if (
            createdTournament &&
            createdTournament.id &&
            !nextTournaments.some((tournament) => tournament.id === createdTournament.id)
          ) {
            nextTournaments = sortByUpdatedAt([...nextTournaments, createdTournament]);
          }

          if (
            createdTournamentId &&
            !nextTournaments.some((tournament) => tournament.id === createdTournamentId)
          ) {
            const fetchedTournament = await getTournamentById(createdTournamentId);

            if (fetchedTournament) {
              nextTournaments = sortByUpdatedAt([...nextTournaments, fetchedTournament]);
            }
          }

          if (!isMounted) {
            return;
          }

          setTournaments(nextTournaments);
          setOrganizerBrandingMap(
            brandingProfiles.reduce((accumulator, item) => {
              accumulator[item.uid] = item.organizerLogoUrl || "";
              return accumulator;
            }, {})
          );
          setRegistrationsByTournament(registrationsResponse);
          if (createdTournamentId || createdTournament) {
            navigation.setParams({
              createdTournamentId: undefined,
              createdTournament: undefined,
            });
          }
        } catch (error) {
          if (!isMounted) {
            return;
          }

          setTournaments([]);
          setOrganizerBrandingMap({});
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
    }, [
      canCreateTournament,
      currentUserId,
      navigation,
      route?.params?.createdTournament,
      route?.params?.createdTournamentId,
    ])
  );

  const registrationsMap = useMemo(
    () => getRegistrationsCountMap(registrationsByTournament),
    [registrationsByTournament]
  );

  const tournamentsEnriched = useMemo(() => {
    return tournaments.map((tournament) =>
      buildTournamentCardData(
        {
          ...tournament,
          organizerLogoUrl:
            organizerBrandingMap[tournament.organizerId] ||
            organizerBrandingMap[tournament.createdBy] ||
            "",
        },
        registrationsMap[tournament.id] || null
      )
    );
  }, [organizerBrandingMap, registrationsMap, tournaments]);

  useEffect(() => {
    if (!proximityFilter.enabled || !proximityFilter.userCoordinates || !tournamentsEnriched.length) {
      return undefined;
    }

    let isCancelled = false;

    const geocodeMissingTournaments = async () => {
      const missingTournaments = tournamentsEnriched.filter((tournament) => {
        const key = buildTournamentDistanceKey(tournament);
        return !getTournamentCoordinates(tournament) && !tournamentCoordinatesByKey[key];
      });

      for (const tournament of missingTournaments) {
        const key = buildTournamentDistanceKey(tournament);

        for (const address of buildTournamentGeocodeCandidates(tournament)) {
          try {
            const coordinates = await geocodeAddress(address);

            if (isCancelled) {
              return;
            }

            if (coordinates) {
              setTournamentCoordinatesByKey((current) => ({
                ...current,
                [key]: coordinates,
              }));
              break;
            }
          } catch (error) {
            // Intentamos con el siguiente dato disponible de la sede.
          }
        }
      }
    };

    geocodeMissingTournaments();

    return () => {
      isCancelled = true;
    };
  }, [
    proximityFilter.enabled,
    proximityFilter.userCoordinates,
    tournamentCoordinatesByKey,
    tournamentsEnriched,
  ]);

  const tournamentsWithDistance = useMemo(
    () =>
      tournamentsEnriched.map((tournament) => {
        const key = buildTournamentDistanceKey(tournament);
        const coordinates =
          getTournamentCoordinates(tournament) || tournamentCoordinatesByKey[key];
        const distanceKm = proximityFilter.userCoordinates
          ? calculateDistanceKm(proximityFilter.userCoordinates, coordinates)
          : null;

        return {
          ...tournament,
          distanceKm,
        };
      }),
    [proximityFilter.userCoordinates, tournamentCoordinatesByKey, tournamentsEnriched]
  );

  const sexFilterOptions = useMemo(
    () => ["Todos", ...LEAGUE_BRANCH_OPTIONS.map((option) => option.value)],
    []
  );

  const categoryFilterOptions = useMemo(() => {
    const categories = [...new Set(tournamentsEnriched.map((tournament) => tournament.categoryLabel).filter(Boolean))];
    return ["Todas", ...categories];
  }, [tournamentsEnriched]);

  const complexFilterOptions = useMemo(() => {
    const complexes = [
      ...new Set(
        tournamentsEnriched
          .flatMap((tournament) => getTournamentComplexNames(tournament))
          .map((name) => name.trim())
          .filter(Boolean)
      ),
    ].sort((first, second) => first.localeCompare(second, "es"));

    return ["Todos", ...complexes];
  }, [tournamentsEnriched]);

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
        message: `Vamos a priorizar torneos dentro de ${proximityFilter.radiusKm} km.`,
        tone: "success",
      });
    } catch (error) {
      // Cerrar el menu de ubicacion antes de avisar: en iOS el
      // FeedbackModal no puede presentarse arriba de este Modal si se
      // queda abierto.
      setLocationActionsVisible(false);
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

  const handleOpenOrganizerView = (viewKey) => {
    setShowOrganizerHistoryMenu(false);
    navigation.setParams({ organizerView: viewKey });
  };

  const handleOpenPlayerView = (viewKey) => {
    setShowPlayerHistoryMenu(false);
    navigation.setParams({ playerView: viewKey });
  };

  const filteredTournaments = useMemo(() => {
    const filtered = tournamentsWithDistance.filter((tournament) => {
      const isHistory = isHistoricalTournament(tournament);
      const isRescheduled = isReprogrammedTournament(tournament);

      if (!proximityFilter.enabled && appliedFilters.localidades.length > 0) {
        const tournamentLocations = getTournamentLocationNames(tournament);
        const cityMatches = appliedFilters.localidades.some((location) =>
          tournamentLocations.includes(normalizeText(location.nombre))
        );

        if (!cityMatches) {
          return false;
        }
      }

      if (appliedFilters.sexo !== "Todos") {
        if (getTournamentBranchLabel(tournament) !== appliedFilters.sexo) {
          return false;
        }
      }

      if (appliedFilters.categoria !== "Todas") {
        if (tournament.categoryLabel !== appliedFilters.categoria) {
          return false;
        }
      }

      if (appliedFilters.complejo !== "Todos") {
        const complexMatches = getTournamentComplexNames(tournament).includes(
          normalizeText(appliedFilters.complejo)
        );

        if (!complexMatches) {
          return false;
        }
      }

      if (canCreateTournament) {
        const isOwnedByOrganizer =
          normalizeText(tournament.organizerId) === normalizeText(currentUserId) ||
          normalizeText(tournament.createdBy) === normalizeText(currentUserId);

        if (!isOwnedByOrganizer) {
          return false;
        }

        if (organizerView === "active") {
          return !isHistory && !isRescheduled;
        }

        if (organizerView === "finished") {
          return tournament.status === "finished" && isHistory;
        }

        if (organizerView === "cancelled") {
          return tournament.status === "cancelled" && isHistory;
        }

        if (organizerView === "rescheduled") {
          return isRescheduled;
        }

        return !isHistory && !isRescheduled;
      }

      if (playerView === "mine") {
        return Boolean(tournament.userRegistration) && !isHistory && !isRescheduled;
      }

      if (playerView === "finished") {
        return tournament.status === "finished" && isHistory && Boolean(tournament.userRegistration);
      }

      if (playerView === "cancelled") {
        return tournament.status === "cancelled" && isHistory && Boolean(tournament.userRegistration);
      }

      if (playerView === "rescheduled") {
        return isRescheduled && Boolean(tournament.userRegistration);
      }

      return tournament.status !== "draft" && !isHistory && !isRescheduled;
    });

    if (proximityFilter.enabled && proximityFilter.userCoordinates) {
      return [...filtered].sort((first, second) => {
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
      });
    }

    return filtered;
  }, [
    appliedFilters.categoria,
    appliedFilters.complejo,
    appliedFilters.localidades,
    appliedFilters.sexo,
    canCreateTournament,
    currentUserId,
    organizerView,
    playerView,
    proximityFilter,
    tournamentsWithDistance,
  ]);

  const organizerOwnedActiveTournaments = useMemo(() => {
    if (!canCreateTournament) {
      return [];
    }

    return tournamentsEnriched.filter((tournament) => {
      const isOwnedByOrganizer =
        normalizeText(tournament.organizerId) === normalizeText(currentUserId) ||
        normalizeText(tournament.createdBy) === normalizeText(currentUserId);

      return isOwnedByOrganizer && !isHistoricalTournament(tournament) && !isReprogrammedTournament(tournament);
    });
  }, [canCreateTournament, currentUserId, tournamentsEnriched]);

  const playerPublishedTournaments = useMemo(() => {
    if (canCreateTournament) {
      return [];
    }

    return tournamentsEnriched.filter((tournament) => {
      const isHistory = isHistoricalTournament(tournament);
      const isRescheduled = isReprogrammedTournament(tournament);

      return tournament.status !== "draft" && !isHistory && !isRescheduled;
    });
  }, [canCreateTournament, tournamentsEnriched]);

  const visibleTournaments = useMemo(() => {
    if (
      canCreateTournament &&
      organizerView === "active" &&
      !filteredTournaments.length &&
      organizerOwnedActiveTournaments.length
    ) {
      return organizerOwnedActiveTournaments;
    }

    if (
      !canCreateTournament &&
      playerView === "published" &&
      !hasActiveFilters &&
      !filteredTournaments.length &&
      playerPublishedTournaments.length
    ) {
      return playerPublishedTournaments;
    }

    return filteredTournaments;
  }, [
    canCreateTournament,
    filteredTournaments,
    hasActiveFilters,
    organizerOwnedActiveTournaments,
    organizerView,
    playerPublishedTournaments,
    playerView,
  ]);

  const listItems = useMemo(() => {
    const items = [];
    const eventIndexByBatchId = new Map();

    visibleTournaments.forEach((tournament) => {
      const batchId = tournament.creationBatchId || "";

      if (!batchId) {
        items.push({ type: "tournament", id: tournament.id, tournament });
        return;
      }

      if (eventIndexByBatchId.has(batchId)) {
        items[eventIndexByBatchId.get(batchId)].categories.push(tournament);
        return;
      }

      eventIndexByBatchId.set(batchId, items.length);
      items.push({ type: "event", id: `event-${batchId}`, categories: [tournament] });
    });

    return items.map((item) =>
      item.type === "event" && item.categories.length === 1
        ? { type: "tournament", id: item.categories[0].id, tournament: item.categories[0] }
        : item
    );
  }, [visibleTournaments]);

  const handleOpenTournament = (tournament) => {
    if (!tournament?.id) {
      return;
    }

    if (
      !canCreateTournament &&
      !tournament?.userRegistration &&
      (tournament?.displayStatus || tournament?.status) === "registration_closed"
    ) {
      return;
    }

    if (!canCreateTournament && tournament?.userRegistration?.withdrawalStatus === "confirmed") {
      return;
    }

    if (canCreateTournament) {
      const organizerLastArea = resolveOrganizerLastArea(tournament?.organizerLastViewedArea || "");

      if (organizerLastArea === "registration") {
        navigation.navigate("TournamentRegistrations", {
          tournamentId: tournament.id,
          tournamentName: tournament.name || "Torneo",
        });
        return;
      }

      if (organizerLastArea === "fixture") {
        navigation.navigate("TournamentFixture", {
          tournamentId: tournament.id,
          tournamentName: tournament.name || "Torneo",
        });
        return;
      }

      if (organizerLastArea === "payments") {
        navigation.navigate("TournamentPayments", {
          tournamentId: tournament.id,
          tournamentName: tournament.name || "Torneo",
        });
        return;
      }
    }

    navigation.navigate("TournamentDetail", {
      tournamentId: tournament.id,
      tournamentName: tournament.name || "Torneo",
    });
  };

  const handleOpenRegistration = (tournament) => {
    if (!tournament?.id) {
      return;
    }

    navigation.navigate("TournamentRegistration", {
      tournamentId: tournament.id,
      tournamentName: tournament.name || "Torneo",
    });
  };

  const handleViewPoster = async (tournament = {}) => {
    if (!tournament?.coverImage) {
      return;
    }

    try {
      navigation.navigate("TournamentPosterViewer", {
        posterUrl: tournament.coverImage,
        tournamentId: tournament.id || "",
        tournamentName: tournament.name || "Torneo",
        organizerId: tournament.organizerId || tournament.createdBy || "",
        organizerName: tournament.organizerName || tournament.createdByName || "",
      });
    } catch (error) {
      setFeedback({
        visible: true,
        title: "No pudimos abrir el poster",
        message: "Intenta nuevamente en unos instantes.",
        tone: "danger",
      });
    }
  };

  const handleDeleteDraft = async (tournament) => {
    try {
      await deleteDraftTournament({
        tournamentId: tournament?.id || "",
        organizerId: currentUserId,
      });

      setTournaments((current) => current.filter((item) => item.id !== tournament?.id));
      setFeedback({
        visible: true,
        title: "Borrador eliminado",
        message: "El torneo en borrador se elimino correctamente.",
        tone: "success",
      });
    } catch (error) {
      setFeedback({
        visible: true,
        title: "No pudimos eliminar el borrador",
        message: error?.message || "Intenta nuevamente en unos instantes.",
        tone: "danger",
      });
    }
  };

  const handleRequestDeleteCancelled = (tournament) => {
    if (!canCreateTournament || !tournament) {
      return;
    }

    setCancelledTournamentToDelete(tournament);
  };

  const handleConfirmDeleteCancelled = async () => {
    if (!cancelledTournamentToDelete?.id) {
      return;
    }

    try {
      setDeletingCancelledTournament(true);
      await deleteCancelledTournament({
        tournamentId: cancelledTournamentToDelete.id,
        organizerId: currentUserId,
      });

      setTournaments((current) =>
        current.filter((item) => item.id !== cancelledTournamentToDelete.id)
      );
      setCancelledTournamentToDelete(null);
      setFeedback({
        visible: true,
        title: "Torneo eliminado",
        message: "El torneo cancelado se elimino definitivamente.",
        tone: "success",
      });
    } catch (error) {
      // Cerrar la confirmacion antes de avisar: en iOS el FeedbackModal no
      // puede presentarse arriba de este Modal si se queda abierto.
      setCancelledTournamentToDelete(null);
      setFeedback({
        visible: true,
        title: "No pudimos eliminar el torneo",
        message: error?.message || "Intenta nuevamente en unos instantes.",
        tone: "danger",
      });
    } finally {
      setDeletingCancelledTournament(false);
    }
  };

  const handleOpenCreateTournament = () => {
    if (!canCreateTournament) {
      return;
    }

    navigation.navigate("CreateTournament");
  };

  const handleEditDraft = (tournament) => {
    if (!canCreateTournament || !tournament) {
      return;
    }

    navigation.navigate("CreateTournament", {
      tournament,
    });
  };

  const renderHeader = () => (
    <View>
      <View style={styles.topActionsWrap}>
        {canCreateTournament ? (
          <>
            <View style={styles.organizerTopRow}>
              <View style={styles.createButtonRow}>
                <CreateTournamentButton onPress={handleOpenCreateTournament} />
              </View>
              <Pressable
                onPress={() => setShowOrganizerHistoryMenu((current) => !current)}
                style={({ pressed }) => [
                  styles.organizerMenuButton,
                  styles.inlineMenuButton,
                  pressed && styles.organizerMenuButtonPressed,
                ]}
              >
                <Ionicons color={colors.primaryDark} name="ellipsis-horizontal" size={18} />
              </Pressable>
            </View>

            {showOrganizerHistoryMenu ? (
              <View style={styles.organizerMenuCard}>
                {ORGANIZER_MENU_OPTIONS.map((option) => (
                  <Pressable
                    key={option.key}
                    onPress={() => handleOpenOrganizerView(option.key)}
                    style={({ pressed }) => [
                      styles.organizerMenuItem,
                      pressed && styles.organizerMenuItemPressed,
                    ]}
                  >
                    <Text style={styles.organizerMenuItemText}>{option.label}</Text>
                    <Ionicons color={colors.primaryDark} name="chevron-forward" size={16} />
                  </Pressable>
                ))}
              </View>
            ) : null}
          </>
        ) : null}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader
        onBack={() => navigation.goBack()}
        subtitle={resolvedHeaderSubtitle}
      >
        <>
          {canCreateTournament ? (
            <View style={styles.rankingButtonRow}>
              <Pressable
                onPress={() =>
                  navigation.navigate("TournamentRanking", { organizerId: currentUserId })
                }
                style={({ pressed }) => [
                  styles.rankingButton,
                  pressed ? styles.rankingButtonPressed : null,
                ]}
              >
                <Ionicons color={colors.primaryDark} name="trophy-outline" size={16} />
                <Text style={styles.rankingButtonText}>Ranking</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.filterAndMenuRow}>
            <View style={styles.filterInlineWrap}>
              <SectionFilterBar
                containerStyle={styles.inlineFilterBar}
                disablePersistedDefaults
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
                      {sexFilterOptions.map((sex) => (
                        <Pressable
                          key={sex}
                          onPress={() => setDraftSexo(sex)}
                          style={[styles.filterChip, draftSexo === sex && styles.filterChipActive]}
                        >
                          <Text style={[styles.filterChipText, draftSexo === sex && styles.filterChipTextActive]}>
                            {sex}
                          </Text>
                        </Pressable>
                      ))}
                    </View>

                    <Text style={styles.modalLabel}>Categoria</Text>
                    <View style={styles.modalRow}>
                      {categoryFilterOptions.map((category) => (
                        <Pressable
                          key={category}
                          onPress={() => setDraftCategoria(category)}
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
                      {complexFilterOptions.map((complex) => (
                        <Pressable
                          key={complex}
                          onPress={() => setDraftComplejo(complex)}
                          style={[
                            styles.filterChip,
                            draftComplejo === complex && styles.filterChipActive,
                          ]}
                        >
                          <Text
                            style={[
                              styles.filterChipText,
                              draftComplejo === complex && styles.filterChipTextActive,
                            ]}
                          >
                            {complex}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                )}
                userLocation={userLocalidad}
              />
            </View>

            <Pressable
              onPress={() => setLocationActionsVisible(true)}
              style={({ pressed }) => [
                styles.locationActionButton,
                proximityFilter.enabled ? styles.locationActionButtonActive : null,
                pressed ? styles.organizerMenuButtonPressed : null,
              ]}
            >
              <Ionicons
                color={proximityFilter.enabled ? colors.surface : colors.primaryDark}
                name="location-outline"
                size={19}
              />
            </Pressable>

            {!canCreateTournament ? (
              <Pressable
                onPress={() => setShowPlayerHistoryMenu((current) => !current)}
                style={({ pressed }) => [
                  styles.organizerMenuButton,
                  styles.inlineMenuButton,
                  pressed && styles.organizerMenuButtonPressed,
                ]}
              >
                <Ionicons color={colors.primaryDark} name="funnel-outline" size={18} />
              </Pressable>
            ) : null}
          </View>

          {!canCreateTournament && showPlayerHistoryMenu ? (
            <View style={styles.organizerMenuCard}>
              {PLAYER_MENU_OPTIONS.map((option) => (
                <Pressable
                  key={option.key}
                  onPress={() => handleOpenPlayerView(option.key)}
                  style={({ pressed }) => [
                    styles.organizerMenuItem,
                    pressed && styles.organizerMenuItemPressed,
                  ]}
                >
                  <Text style={styles.organizerMenuItemText}>{option.label}</Text>
                  <Ionicons color={colors.primaryDark} name="chevron-forward" size={16} />
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      </SectionHeader>

      <View style={styles.container}>
        <FlatList
          contentContainerStyle={styles.listContent}
          data={listItems}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            <EmptyState
              canCreate={canCreateTournament}
              currentTab={canCreateTournament ? organizerView : playerView}
              loading={loading}
            />
          }
          ListHeaderComponent={renderHeader}
          renderItem={({ item }) =>
            item.type === "section" ? (
              <TournamentSectionHeader title={item.title} />
            ) : item.type === "event" ? (
              <TournamentEventCard
                canManageTournament={canCreateTournament}
                categories={item.categories}
                onOpenRegistration={handleOpenRegistration}
                onPress={handleOpenTournament}
                onViewPoster={handleViewPoster}
              />
            ) : (
              <TournamentCard
                canManageTournament={canCreateTournament}
                item={item.tournament}
                onDeleteCancelled={handleRequestDeleteCancelled}
                onEditDraft={handleEditDraft}
                onDeleteDraft={handleDeleteDraft}
                onOpenRegistration={handleOpenRegistration}
                onPress={handleOpenTournament}
                onViewPoster={handleViewPoster}
                showDraftDelete={
                  canCreateTournament &&
                  organizerView === "active" &&
                  item.tournament?.status === "draft"
                }
                showCancelledDelete={
                  canCreateTournament &&
                  organizerView === "cancelled" &&
                  item.tournament?.status === "cancelled"
                }
              />
            )
          }
          showsVerticalScrollIndicator={false}
        />
      </View>

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
              Usa tu ubicacion para priorizar los torneos mas cercanos.
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
        tone={feedback.tone}
        visible={feedback.visible}
        title={feedback.title}
      />

      <Modal
        animationType="fade"
        onRequestClose={() =>
          deletingCancelledTournament ? null : setCancelledTournamentToDelete(null)
        }
        transparent
        visible={Boolean(cancelledTournamentToDelete)}
      >
        <View style={styles.confirmOverlay}>
          <Pressable
            onPress={() =>
              deletingCancelledTournament ? null : setCancelledTournamentToDelete(null)
            }
            style={styles.confirmBackdrop}
          />
          <View style={styles.confirmCard}>
            <View style={styles.confirmWarningIcon}>
              <Text style={styles.confirmWarningIconText}>!</Text>
            </View>
            <Text style={styles.confirmTitle}>Eliminar torneo cancelado</Text>
            <Text style={styles.confirmMessage}>
              Esta accion eliminara definitivamente el torneo de la lista de cancelados.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                disabled={deletingCancelledTournament}
                onPress={() => setCancelledTournamentToDelete(null)}
                style={({ pressed }) => [
                  styles.confirmModalButton,
                  styles.confirmModalButtonSecondary,
                  pressed && !deletingCancelledTournament ? styles.draftChipButtonPressed : null,
                ]}
              >
                <Text style={styles.confirmModalButtonSecondaryText}>Cancelar</Text>
              </Pressable>
              <Pressable
                disabled={deletingCancelledTournament}
                onPress={handleConfirmDeleteCancelled}
                style={({ pressed }) => [
                  styles.confirmModalButton,
                  styles.confirmModalButtonDanger,
                  pressed && !deletingCancelledTournament ? styles.draftChipButtonPressed : null,
                ]}
              >
                <Text style={styles.confirmModalButtonDangerText}>
                  {deletingCancelledTournament ? "Eliminando..." : "Eliminar"}
                </Text>
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
    paddingBottom: spacing.lg + BOTTOM_QUICK_ACTIONS_SPACE,
  },
  listContent: {
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  topActionsWrap: {
    marginBottom: spacing.md,
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
    borderColor: "#F2C94C",
    borderRadius: 24,
    borderWidth: 2,
    padding: spacing.lg,
    width: "100%",
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
    fontFamily: "Inter_700Bold",
    lineHeight: 18,
    textAlign: "center",
  },
  locationOptionsLabel: {
    color: colors.text,
    fontSize: 12,
    fontFamily: "Inter_900Black",
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
    fontFamily: "Inter_900Black",
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
    fontFamily: "Inter_900Black",
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
    fontFamily: "Inter_900Black",
  },
  locationButtonDisabled: {
    opacity: 0.65,
  },
  confirmWarningIcon: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#FFD84D",
    borderColor: "#E0A400",
    borderRadius: 999,
    borderWidth: 2,
    height: 58,
    justifyContent: "center",
    marginBottom: spacing.sm,
    width: 58,
  },
  confirmWarningIconText: {
    color: "#7A4300",
    fontSize: 34,
    fontFamily: "Inter_900Black",
    lineHeight: 38,
  },
  confirmTitle: {
    color: colors.text,
    fontSize: 22,
    fontFamily: "Inter_800ExtraBold",
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
  confirmModalButton: {
    alignItems: "center",
    borderRadius: 16,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  confirmModalButtonSecondary: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  confirmModalButtonDanger: {
    backgroundColor: colors.danger,
  },
  confirmModalButtonSecondaryText: {
    color: colors.primaryDark,
    fontSize: 15,
    fontFamily: "Inter_800ExtraBold",
  },
  confirmModalButtonDangerText: {
    color: colors.surface,
    fontSize: 15,
    fontFamily: "Inter_800ExtraBold",
  },
  organizerTopRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  rankingButtonRow: {
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
  },
  rankingButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  rankingButtonPressed: {
    opacity: 0.85,
  },
  rankingButtonText: {
    color: colors.primaryDark,
    fontSize: 13,
    fontFamily: "Inter_800ExtraBold",
  },
  filterAndMenuRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
  },
  filterInlineWrap: {
    flex: 1,
  },
  inlineFilterBar: {
    marginHorizontal: 0,
    marginTop: 0,
    minHeight: 38,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  locationActionButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    marginTop: -6,
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
  organizerMenuButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 40,
  },
  inlineMenuButton: {
    marginTop: -6,
  },
  organizerMenuButtonPressed: {
    opacity: 0.92,
  },
  organizerMenuCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: spacing.sm,
    overflow: "hidden",
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  organizerMenuItem: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  organizerMenuItemPressed: {
    backgroundColor: "#F5FAF7",
  },
  organizerMenuItemText: {
    color: colors.text,
    fontSize: 13,
    fontFamily: "Inter_800ExtraBold",
  },
  createButtonRow: {
    flex: 1,
  },
  createButton: {
    alignItems: "center",
    backgroundColor: "#1F8A70",
    borderRadius: 18,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 4,
  },
  createButtonPressed: {
    opacity: 0.92,
  },
  createButtonIconWrap: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: 12,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  createButtonTextWrap: {
    flex: 1,
    marginHorizontal: spacing.sm,
  },
  createButtonText: {
    color: colors.surface,
    fontSize: 14,
    fontFamily: "Inter_900Black",
    textAlign: "center",
    textTransform: "uppercase",
  },
  cardShell: {
    marginBottom: spacing.md,
  },
  cardPressed: {
    opacity: 0.92,
  },
  cardDisabled: {
    opacity: 0.92,
  },
  playerCard: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    marginBottom: 0,
    padding: spacing.md,
    shadowColor: "#0B2719",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  playerCardTopRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  playerCardClubRow: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minWidth: 0,
  },
  playerCardClubLogo: {
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    height: 40,
    width: 40,
  },
  playerCardClubLogoPlaceholder: {
    alignItems: "center",
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  playerCardClubName: {
    color: colors.text,
    flexShrink: 1,
    fontFamily: "Inter_800ExtraBold",
    fontSize: 14,
    lineHeight: 18,
  },
  playerCardStatusBadge: {
    alignItems: "center",
    borderRadius: 999,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  playerCardStatusDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  playerCardStatusText: {
    fontFamily: "Inter_800ExtraBold",
    fontSize: 10,
  },
  playerCardPosterLink: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 4,
    marginTop: spacing.sm,
  },
  playerCardPosterLinkPressed: {
    opacity: 0.7,
  },
  playerCardPosterLinkText: {
    color: colors.primaryDark,
    fontFamily: "Inter_700Bold",
    fontSize: 11,
    textDecorationLine: "underline",
  },
  playerCardEyebrow: {
    color: colors.primaryDark,
    fontFamily: "Inter_900Black",
    fontSize: 10,
    letterSpacing: 1,
    marginTop: spacing.md,
  },
  playerCardTitle: {
    fontFamily: "Inter_900Black",
    fontSize: 24,
    lineHeight: 28,
    marginTop: 2,
  },
  playerCardDividerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  playerCardDividerLine: {
    backgroundColor: colors.border,
    flex: 1,
    height: 1,
  },
  playerCardDividerBadge: {
    backgroundColor: colors.primaryDark,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  playerCardDividerText: {
    color: colors.surface,
    fontFamily: "Inter_800ExtraBold",
    fontSize: 10,
    letterSpacing: 1,
  },
  playerCardCategoryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  playerCardCategoryChip: {
    backgroundColor: colors.secondary,
    borderRadius: 14,
    marginBottom: spacing.sm,
    paddingHorizontal: 10,
    paddingVertical: 13,
    width: "48%",
  },
  playerCardCategoryChipText: {
    color: colors.text,
    fontFamily: "Inter_800ExtraBold",
    fontSize: 13,
    textAlign: "center",
  },
  playerCardDateRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    marginTop: spacing.xs,
  },
  playerCardDateText: {
    color: colors.muted,
    flexShrink: 1,
    fontFamily: "Inter_700Bold",
    fontSize: 12,
  },
  playerCardCtaButton: {
    alignItems: "center",
    borderRadius: 18,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    marginTop: spacing.md,
    paddingVertical: 14,
  },
  playerCardCtaText: {
    fontFamily: "Inter_900Black",
    fontSize: 13,
    letterSpacing: 0.5,
  },
  organizerCardStatusCluster: {
    alignItems: "flex-end",
    gap: 6,
  },
  organizerCategoryStatusRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    justifyContent: "center",
    marginTop: 4,
  },
  organizerCategoryStatusDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  organizerCategoryStatusText: {
    fontFamily: "Inter_700Bold",
    fontSize: 10,
  },
  draftChipActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  draftChipButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.72)",
    borderColor: "rgba(0,0,0,0.08)",
    borderRadius: 999,
    borderWidth: 1,
    height: 24,
    justifyContent: "center",
    width: 24,
  },
  draftChipDeleteButton: {
    backgroundColor: "#FFF0F0",
    borderColor: "#E7B8B8",
  },
  draftChipButtonPressed: {
    opacity: 0.82,
  },
  sectionHeaderCard: {
    backgroundColor: "#F7F9FA",
    borderColor: "#E1E6EA",
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: spacing.md,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  sectionHeaderTitle: {
    color: "#5B6770",
    fontSize: 12,
    fontFamily: "Inter_900Black",
    textTransform: "uppercase",
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
    fontFamily: "Inter_900Black",
    marginTop: spacing.sm,
    textAlign: "center",
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 21,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  modalLabel: {
    color: colors.muted,
    fontSize: 12,
    fontFamily: "Inter_700Bold",
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
    fontFamily: "Inter_700Bold",
  },
  filterChipTextActive: {
    color: colors.primaryDark,
  },
});

