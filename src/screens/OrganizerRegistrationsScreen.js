import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Modal,
  Pressable,
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
import SectionHeader from "../components/SectionHeader";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import { sendChatMessage } from "../services/chatService";
import {
  getOrganizerRegistrationsSummary,
  hasUnreadTurnoReservationNotification,
  isActionableLeagueRegistration,
  isPendingTurnoNotification,
  isActionableTurnoReservation,
  isActionableTournamentRegistration,
} from "../services/organizerTasksService";
import {
  markTurnoReservationNotificationRead,
  updateTurnoReservationStatus,
} from "../services/turnosService";
import { formatPlayerShortName } from "../utils/playerDisplayName";

function getLeagueStatusLabel(status = "") {
  if (status === "confirmed") {
    return "CONFIRMADA";
  }

  if (status === "rejected" || status === "partner_rejected") {
    return "RECHAZADA";
  }

  if (status === "awaiting_partner") {
    return "ESPERANDO PAREJA";
  }

  return "PENDIENTE";
}

function getTournamentStatusLabel(registration = {}) {
  if (registration.withdrawalStatus === "requested") {
    return "BAJA SOLICITADA";
  }

  if (registration.status === "confirmed") {
    return "CONFIRMADA";
  }

  if (registration.status === "in_review") {
    return "EN REVISION";
  }

  if (registration.status === "rejected") {
    return "RECHAZADA";
  }

  return "PENDIENTE";
}

function getTurnoStatusLabel(reservation = {}) {
  if (reservation.status === "confirmed") {
    return "CONFIRMADA";
  }

  if (reservation.status === "rejected") {
    return "RECHAZADA";
  }

  if (reservation.status === "cancelled") {
    return "CANCELADA";
  }

  return "PENDIENTE";
}

function getTurnoPaymentMethodLabel(paymentMethod = "") {
  if (paymentMethod === "a_confirmar") {
    return "A confirmar";
  }

  if (paymentMethod === "mercado_pago") {
    return "Mercado Pago";
  }

  if (paymentMethod === "transferencia") {
    return "Transferencia";
  }

  return "Efectivo";
}

function getEntryMillis(entry = {}) {
  return entry.createdAtMillis || entry.updatedAtMillis || 0;
}

function getDayRelationLabel(dateMillis) {
  const reservationDate = Number(dateMillis || 0);

  if (!reservationDate) {
    return "";
  }

  const target = new Date(reservationDate);
  target.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return "today";
  }

  if (diffDays === 1) {
    return "tomorrow";
  }

  return "";
}

function getLatestNotificationSection({
  leagueRequests = [],
  tournamentRequests = [],
  turnoReservations = [],
} = {}) {
  const registrationEntries = [
    ...leagueRequests.map((entry) => ({
      ...entry,
      actionable: isActionableLeagueRegistration(entry),
    })),
    ...tournamentRequests.map((entry) => ({
      ...entry,
      actionable: isActionableTournamentRegistration(entry),
    })),
  ];
  const pendingRegistrationEntries = registrationEntries.filter((entry) => entry.actionable);
  const pendingTurnoEntries = turnoReservations.filter(isPendingTurnoNotification);
  const entriesToCompare =
    pendingRegistrationEntries.length || pendingTurnoEntries.length
      ? [
          ...pendingRegistrationEntries.map((entry) => ({ ...entry, notificationSection: "registrations" })),
          ...pendingTurnoEntries.map((entry) => ({ ...entry, notificationSection: "turnos" })),
        ]
      : [
          ...registrationEntries.map((entry) => ({ ...entry, notificationSection: "registrations" })),
          ...turnoReservations.map((entry) => ({ ...entry, notificationSection: "turnos" })),
        ];

  return (
    entriesToCompare.sort((first, second) => getEntryMillis(second) - getEntryMillis(first))[0]
      ?.notificationSection || "registrations"
  );
}

function normalizePhoneNumber(value = "") {
  return String(value || "").replace(/[^\d]/g, "");
}

function buildWhatsAppPhoneNumber(phone = "", countryCode = "+54") {
  const phoneDigits = normalizePhoneNumber(phone);
  const countryDigits = normalizePhoneNumber(countryCode || "+54") || "54";

  if (!phoneDigits) {
    return "";
  }

  if (phoneDigits.startsWith(countryDigits)) {
    return countryDigits === "54" && !phoneDigits.startsWith("549")
      ? `549${phoneDigits.slice(2)}`
      : phoneDigits;
  }

  if (countryDigits === "54") {
    const localDigits = phoneDigits
      .replace(/^0+/, "")
      .replace(/^15/, "");

    return localDigits.startsWith("9") ? `54${localDigits}` : `549${localDigits}`;
  }

  return `${countryDigits}${phoneDigits.replace(/^0+/, "")}`;
}

function getPhoneLabel(value = "") {
  return String(value || "").trim() || "Sin telefono cargado";
}

function buildContactMessage(contextLabel = "") {
  return encodeURIComponent(
    `Hola! Te escribo desde Padel Nexo por ${contextLabel || "una notificacion pendiente"}.`
  );
}

export default function OrganizerRegistrationsScreen({ navigation }) {
  const { userData } = useAuth();
  const [loading, setLoading] = useState(true);
  const [leagueRequests, setLeagueRequests] = useState([]);
  const [tournamentRequests, setTournamentRequests] = useState([]);
  const [turnoReservations, setTurnoReservations] = useState([]);
  const [activeSection, setActiveSection] = useState("registrations");
  const [activeFilter, setActiveFilter] = useState("pending");
  const [contactMenu, setContactMenu] = useState(null);
  const [runningTurnoAction, setRunningTurnoAction] = useState("");

  const loadScreen = useCallback(async () => {
    const summary = await getOrganizerRegistrationsSummary(userData?.uid || "");
    const latestSection = getLatestNotificationSection(summary);
    const latestTurnoReservations = summary.turnoReservations || [];
    const hasPendingRegistrations =
      summary.leagueRequests?.some(isActionableLeagueRegistration) ||
      summary.tournamentRequests?.some(isActionableTournamentRegistration);
    const hasPendingTurnos = latestTurnoReservations.some(isPendingTurnoNotification);
    const hasActionableTurnos = latestTurnoReservations.some(isActionableTurnoReservation);

    setLeagueRequests(summary.leagueRequests);
    setTournamentRequests(summary.tournamentRequests);
    setTurnoReservations(latestTurnoReservations);
    setActiveSection(latestSection);
    setActiveFilter(
      latestSection === "turnos"
        ? hasActionableTurnos
          ? "pending"
          : "all"
        : hasPendingRegistrations
          ? "pending"
          : "all"
    );
  }, [userData?.uid]);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      const sync = async () => {
        try {
          setLoading(true);
          await loadScreen();
        } catch (error) {
          if (isMounted) {
            setLeagueRequests([]);
            setTournamentRequests([]);
            setTurnoReservations([]);
          }
        } finally {
          if (isMounted) {
            setLoading(false);
          }
        }
      };

      sync();

      return () => {
        isMounted = false;
      };
    }, [loadScreen])
  );

  const allEntries = useMemo(
    () =>
      [
        ...leagueRequests.map((entry) => ({
          ...entry,
          actionable: isActionableLeagueRegistration(entry),
        })),
        ...tournamentRequests.map((entry) => ({
          ...entry,
          actionable: isActionableTournamentRegistration(entry),
        })),
      ].sort((first, second) => getEntryMillis(second) - getEntryMillis(first)),
    [leagueRequests, tournamentRequests]
  );

  const pendingEntries = useMemo(
    () => allEntries.filter((entry) => entry.actionable),
    [allEntries]
  );

  const visibleEntries = activeFilter === "pending" ? pendingEntries : allEntries;
  const pendingTurnos = useMemo(
    () => turnoReservations.filter(isPendingTurnoNotification),
    [turnoReservations]
  );
  const visibleTurnos = activeFilter === "pending" ? pendingTurnos : turnoReservations;
  const registrationTabCount = activeFilter === "pending" ? pendingEntries.length : allEntries.length;
  const turnoTabCount = activeFilter === "pending" ? pendingTurnos.length : turnoReservations.length;
  const todayTurnosCount = useMemo(
    () =>
      turnoReservations.filter(
        (reservation) => getDayRelationLabel(reservation.dateMillis) === "today"
      ).length,
    [turnoReservations]
  );

  const handleSelectSection = (nextSection) => {
    setActiveSection(nextSection);

    if (nextSection === "turnos") {
      setActiveFilter(turnoReservations.some(isActionableTurnoReservation) ? "pending" : "all");
      const unread = turnoReservations.filter(hasUnreadTurnoReservationNotification);
      if (unread.length) {
        Promise.all(unread.map((r) => markTurnoReservationNotificationRead(r.id))).then(loadScreen).catch(() => null);
      }
      return;
    }

    setActiveFilter(pendingEntries.length ? "pending" : "all");
  };

  const handleOpenEntry = (entry) => {
    if (entry.type === "league") {
      navigation.navigate("LeaguePlayers", {
        leagueId: entry.leagueId,
        leagueName: entry.leagueName,
      });
      return;
    }

    navigation.navigate("TournamentRegistrations", {
      tournamentId: entry.tournament.id,
      tournamentName: entry.tournament.name || "Torneo",
    });
  };

  const handleTurnoStatus = async (reservation, status) => {
    try {
      setRunningTurnoAction(`${reservation.id}-${status}`);
      await updateTurnoReservationStatus(reservation.id, status);
      if (status === "confirmed" && reservation.playerId) {
        await sendChatMessage({
          currentUserId: userData?.uid || "",
          currentUserName: reservation.complexName || "Complejo",
          otherUserId: reservation.playerId,
          otherUserName: reservation.playerName || "Jugador",
          text: `**Tu reserva fue confirmada.**\n\nTu reserva de ${reservation.courtName || "cancha"} en ${
            reservation.complexName || "el complejo"
          } para el ${reservation.dateLabel || "dia seleccionado"} a las ${
            reservation.time || ""
          } hs fue confirmada por el organizador. Recuerde que una cancelacion sin anticipacion pueden aplicar cargos.`,
        }).catch(() => null);
      }
      await loadScreen();
    } finally {
      setRunningTurnoAction("");
    }
  };

  const openContactMenu = (contact) => {
    setContactMenu(contact);
  };

  const closeContactMenu = () => {
    setContactMenu(null);
  };

  const handleOpenInternalMessage = () => {
    if (!contactMenu?.playerId) {
      closeContactMenu();
      return;
    }

    navigation.navigate("Mensajes", {
      playerId: contactMenu.playerId,
      playerName: contactMenu.playerName || "Jugador",
    });
    closeContactMenu();
  };

  const handleOpenWhatsApp = async () => {
    const phone = buildWhatsAppPhoneNumber(contactMenu?.phone, contactMenu?.countryCode);

    if (!phone) {
      return;
    }

    try {
      await Linking.openURL(`https://wa.me/${phone}?text=${buildContactMessage(contactMenu?.context)}`);
    } finally {
      closeContactMenu();
    }
  };

  const getEntryContact = (item = {}) => {
    if (item.type === "league") {
      const requester = item.requester || {};

      return {
      context: `la inscripcion a la liga ${item.leagueName || "Liga"}`,
      countryCode: requester.countryCode || "+54",
      phone: requester.phone || requester.telefono || "",
      playerId: requester.linkedUserId || requester.id || "",
        playerName: formatPlayerShortName(requester) || "Jugador",
      };
    }

    return {
      context: `la inscripcion al torneo ${item.tournament?.name || "Torneo"}`,
      countryCode: item.player1CountryCode || item.player2CountryCode || "+54",
      phone: item.player1Phone || item.player2Phone || "",
      playerId: item.player1Id || item.player2Id || "",
      playerName: item.player1Name || item.player2Name || "Jugador",
    };
  };

  const getTurnoContact = (item = {}) => ({
    context: `la reserva de ${item.courtName || "cancha"} en ${item.complexName || "el complejo"}`,
    countryCode: item.playerCountryCode || "+54",
    phone: item.playerPhone || "",
    playerId: item.playerId || "",
    playerName: item.playerName || "Jugador",
  });

  const renderEntry = ({ item }) => {
    const isLeague = item.type === "league";
    const title = isLeague ? item.leagueName : item.tournament?.name || "Torneo";
    const category = isLeague
      ? [item.league?.categoria, item.league?.sexo].filter(Boolean).join(" - ")
      : item.tournament?.compositionConfig?.label || item.tournament?.compositionLabel || "";
    const playerLabel = isLeague
      ? [formatPlayerShortName(item.requester), item.partner ? formatPlayerShortName(item.partner) : ""]
          .filter(Boolean)
          .join(" / ")
      : item.pairLabel || [item.player1Name, item.player2Name].filter(Boolean).join(" / ");
    const statusLabel = isLeague ? getLeagueStatusLabel(item.status) : getTournamentStatusLabel(item);
    const typeToneStyle = isLeague ? styles.typeChipLeague : styles.typeChipTournament;
    const typeTextStyle = isLeague ? styles.typeChipTextLeague : styles.typeChipTextTournament;
    const contact = getEntryContact(item);

    return (
      <Pressable
        onPress={() => handleOpenEntry(item)}
        style={({ pressed }) => [styles.entryCard, pressed ? styles.entryCardPressed : null]}
      >
        <View style={styles.entryHeader}>
          <View style={styles.entryIcon}>
            <Ionicons
              color={isLeague ? "#1E7A43" : "#2D5E97"}
              name={isLeague ? "trophy-outline" : "ribbon-outline"}
              size={18}
            />
          </View>
          <View style={styles.entryCopy}>
            <Text numberOfLines={1} style={styles.entryTitle}>
              {title}
            </Text>
            <Text numberOfLines={1} style={styles.entryMeta}>
              {isLeague ? "Liga" : "Torneo"}{category ? ` - ${category}` : ""}
            </Text>
          </View>
          <View style={styles.entryRightActions}>
            <View style={[styles.typeChip, typeToneStyle]}>
              <Text style={[styles.typeChipText, typeTextStyle]}>
                {isLeague ? "LIGA" : "TORNEO"}
              </Text>
            </View>
            <Pressable
              onPress={() => openContactMenu(contact)}
              style={({ pressed }) => [styles.moreButton, pressed ? styles.entryCardPressed : null]}
            >
              <Ionicons color={colors.primaryDark} name="ellipsis-vertical" size={17} />
            </Pressable>
          </View>
        </View>

        <View style={styles.playerRow}>
          <Ionicons color={colors.muted} name="people-outline" size={16} />
          <Text numberOfLines={1} style={styles.playerText}>
            {playerLabel || "Jugadores a confirmar"}
          </Text>
        </View>

        <View style={styles.phoneRow}>
          <Ionicons color={colors.muted} name="call-outline" size={15} />
          <Text numberOfLines={1} style={styles.phoneText}>
            {getPhoneLabel(contact.phone)}
          </Text>
        </View>

        <View style={styles.reviewRow}>
          <Text style={styles.reviewText}>
            {item.actionable ? "Requiere revision del organizador" : "Sin accion pendiente"}
          </Text>
          <Ionicons color={colors.primaryDark} name="chevron-forward" size={17} />
        </View>
        <View style={[styles.statusChip, item.actionable ? styles.statusChipPending : null]}>
          <Text
            style={[
              styles.statusChipText,
              item.actionable ? styles.statusChipTextPending : null,
            ]}
          >
            {statusLabel}
          </Text>
        </View>
      </Pressable>
    );
  };

  const renderTurno = ({ item }) => {
    const actionable = isActionableTurnoReservation(item);
    const isUnread = hasUnreadTurnoReservationNotification(item);
    const statusLabel = getTurnoStatusLabel(item);
    const durationLabel = `${item.durationMinutes || 60} min`;
    const contact = getTurnoContact(item);
    const dayRelationLabel = getDayRelationLabel(item.dateMillis);

    return (
      <View style={styles.entryCard}>
        <View style={styles.entryHeader}>
          <View style={[styles.entryIcon, styles.turnoIcon]}>
            <Ionicons color="#1E7A43" name="calendar-outline" size={18} />
          </View>
          <View style={styles.entryCopy}>
            <Text numberOfLines={1} style={styles.entryTitle}>
              {item.complexName || "Complejo"}
            </Text>
            <Text numberOfLines={1} style={styles.entryMeta}>
              {item.courtName || "Cancha"} - {item.time} hs - {durationLabel}
            </Text>
          </View>
          <View style={styles.entryRightActions}>
            <View style={[styles.typeChip, styles.typeChipTurno]}>
              <Text style={[styles.typeChipText, styles.typeChipTextTurno]}>TURNO</Text>
            </View>
            <Pressable
              onPress={() => openContactMenu(contact)}
              style={({ pressed }) => [styles.moreButton, pressed ? styles.entryCardPressed : null]}
            >
              <Ionicons color={colors.primaryDark} name="ellipsis-vertical" size={17} />
            </Pressable>
          </View>
        </View>

        <View style={styles.playerRow}>
          <Ionicons color={colors.muted} name="person-outline" size={16} />
          <Text numberOfLines={1} style={styles.playerText}>
            {item.playerName || "Jugador"} - {item.dateLabel || "Fecha a confirmar"}
          </Text>
        </View>

        <View style={styles.phoneRow}>
          <Ionicons color={colors.muted} name="call-outline" size={15} />
          <Text numberOfLines={1} style={styles.phoneText}>
            {getPhoneLabel(contact.phone)}
          </Text>
        </View>

        <View style={styles.reviewRow}>
          <Text style={styles.reviewText}>
            {actionable
              ? "Reserva pendiente de aprobacion"
              : isUnread
                ? "Nueva reserva registrada"
                : "Reserva registrada"}
          </Text>
          <Text style={styles.turnoPaymentText}>
            {getTurnoPaymentMethodLabel(item.paymentMethod)}
          </Text>
        </View>


        {actionable ? (
          <View style={styles.turnoActionsRow}>
            <Pressable
              disabled={Boolean(runningTurnoAction)}
              onPress={() => handleTurnoStatus(item, "rejected")}
              style={[styles.turnoActionButton, styles.turnoRejectButton]}
            >
              <Text style={[styles.turnoActionText, styles.turnoRejectText]}>
                {runningTurnoAction === `${item.id}-rejected` ? "..." : "RECHAZAR"}
              </Text>
            </Pressable>
            <Pressable
              disabled={Boolean(runningTurnoAction)}
              onPress={() => handleTurnoStatus(item, "confirmed")}
              style={[styles.turnoActionButton, styles.turnoConfirmButton]}
            >
              <Text style={[styles.turnoActionText, styles.turnoConfirmText]}>
                {runningTurnoAction === `${item.id}-confirmed` ? "..." : "CONFIRMAR"}
              </Text>
            </Pressable>
          </View>
        ) : null}
        <View
          style={[
            styles.turnoStatusRow,
          ]}
        >
          <View
            style={[
              styles.statusChip,
              styles.turnoStatusChip,
              actionable ? styles.statusChipPending : null,
              !actionable && isUnread ? styles.statusChipUnread : null,
            ]}
          >
            <Text
              style={[
                styles.statusChipText,
                actionable ? styles.statusChipTextPending : null,
                !actionable && isUnread ? styles.statusChipTextUnread : null,
              ]}
            >
              {actionable ? statusLabel : isUnread ? "NUEVA" : statusLabel}
            </Text>
          </View>
          {dayRelationLabel ? (
            <View
              style={[
                styles.dayNoticeChip,
                dayRelationLabel === "today"
                  ? styles.dayNoticeChipToday
                  : styles.dayNoticeChipTomorrow,
              ]}
            >
              <Text
                style={[
                  styles.dayNoticeChipText,
                  dayRelationLabel === "today"
                    ? styles.dayNoticeChipTextToday
                    : styles.dayNoticeChipTextTomorrow,
                ]}
              >
                {dayRelationLabel === "today" ? "HOY" : "MAÑANA"}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader onBack={() => navigation.navigate("Home")} subtitle="Notificaciones" />
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />

      <View style={styles.container}>
        <View style={styles.sectionTabs}>
          <Pressable
            onPress={() => handleSelectSection("registrations")}
            style={[
              styles.sectionTab,
              activeSection === "registrations" ? styles.sectionTabActive : null,
            ]}
          >
            <Text
              style={[
                styles.sectionTabText,
                activeSection === "registrations" ? styles.sectionTabTextActive : null,
              ]}
            >
              INSCRIPCIONES {registrationTabCount ? `(${registrationTabCount})` : ""}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => handleSelectSection("turnos")}
            style={[
              styles.sectionTab,
              activeSection === "turnos" ? styles.sectionTabActive : null,
            ]}
          >
            {turnoReservations.some(hasUnreadTurnoReservationNotification) ? (
              <View style={styles.sectionTabDot} />
            ) : null}
            <Text
              style={[
                styles.sectionTabText,
                activeSection === "turnos" ? styles.sectionTabTextActive : null,
              ]}
            >
              TURNOS
            </Text>
            <Text
              style={[
                styles.sectionTabSubtext,
                activeSection === "turnos" ? styles.sectionTabSubtextActive : null,
              ]}
            >
              HOY {todayTurnosCount}
            </Text>
          </Pressable>
        </View>

        <View style={styles.filterRow}>
          <Pressable
            onPress={() => setActiveFilter("pending")}
            style={[styles.filterButton, activeFilter === "pending" ? styles.filterButtonActive : null]}
          >
            <Text
              style={[
                styles.filterButtonText,
                activeFilter === "pending" ? styles.filterButtonTextActive : null,
              ]}
            >
              Pendientes
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveFilter("all")}
            style={[styles.filterButton, activeFilter === "all" ? styles.filterButtonActive : null]}
          >
            <Text
              style={[
                styles.filterButtonText,
                activeFilter === "all" ? styles.filterButtonTextActive : null,
              ]}
            >
              Todas
            </Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator color={colors.primaryDark} />
            <Text style={styles.loaderText}>Cargando pendientes...</Text>
          </View>
        ) : (
          <FlatList
            contentContainerStyle={styles.listContent}
            data={activeSection === "turnos" ? visibleTurnos : visibleEntries}
            key={`${activeSection}-${activeFilter}`}
            keyExtractor={(item) =>
              activeSection === "turnos" ? `turno-${item.id}` : `${item.type}-${item.id}`
            }
            ListEmptyComponent={
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>
                  {activeSection === "turnos"
                    ? "Sin turnos para revisar"
                    : "Sin inscripciones para revisar"}
                </Text>
                <Text style={styles.emptyText}>
                  {activeSection === "turnos"
                    ? "Cuando haya reservas de canchas, van a aparecer aca."
                    : "Cuando haya solicitudes de ligas o torneos, van a aparecer aca."}
                </Text>
              </View>
            }
            renderItem={activeSection === "turnos" ? renderTurno : renderEntry}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      <Modal animationType="fade" onRequestClose={closeContactMenu} transparent visible={Boolean(contactMenu)}>
        <View style={styles.modalOverlay}>
          <Pressable onPress={closeContactMenu} style={styles.modalBackdrop} />
          <View style={styles.contactMenuCard}>
            <Text numberOfLines={1} style={styles.contactMenuTitle}>
              {contactMenu?.playerName || "Jugador"}
            </Text>
            <Text numberOfLines={1} style={styles.contactMenuPhone}>
              {getPhoneLabel(contactMenu?.phone)}
            </Text>
            <Pressable onPress={handleOpenInternalMessage} style={styles.contactMenuAction}>
              <Ionicons color={colors.primaryDark} name="chatbubble-ellipses-outline" size={18} />
              <Text style={styles.contactMenuActionText}>Enviar mensaje interno</Text>
            </Pressable>
            <Pressable
              disabled={!normalizePhoneNumber(contactMenu?.phone)}
              onPress={handleOpenWhatsApp}
              style={[
                styles.contactMenuAction,
                !buildWhatsAppPhoneNumber(contactMenu?.phone, contactMenu?.countryCode)
                  ? styles.contactMenuActionDisabled
                  : null,
              ]}
            >
              <Ionicons color="#1E7A43" name="logo-whatsapp" size={18} />
              <Text style={styles.contactMenuActionText}>Enviar WhatsApp</Text>
            </Pressable>
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
  backgroundOrbTop: {
    position: "absolute",
    top: -40,
    right: -30,
    width: 190,
    height: 190,
    borderRadius: 999,
    backgroundColor: "rgba(45,94,151,0.11)",
  },
  backgroundOrbBottom: {
    position: "absolute",
    left: -70,
    bottom: 110,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(31,171,137,0.08)",
  },
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  summaryCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  summaryIcon: {
    alignItems: "center",
    backgroundColor: "#EAF4FF",
    borderColor: "#B7D7F7",
    borderRadius: 16,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  summaryCopy: {
    flex: 1,
  },
  summaryTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  summaryText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 2,
  },
  filterRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sectionTabs: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  sectionTab: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    minHeight: 46,
    justifyContent: "center",
    paddingHorizontal: 6,
    paddingVertical: 10,
    position: "relative",
  },
  sectionTabDot: {
    backgroundColor: "#FF8A00",
    borderColor: colors.surface,
    borderRadius: 999,
    borderWidth: 2,
    height: 12,
    position: "absolute",
    right: 9,
    top: 7,
    width: 12,
  },
  sectionTabActive: {
    backgroundColor: "#E7F6EF",
    borderColor: "#83CDA7",
  },
  sectionTabText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "900",
    textAlign: "center",
  },
  sectionTabTextActive: {
    color: "#1E6B45",
  },
  sectionTabSubtext: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "900",
    marginTop: 2,
    textAlign: "center",
  },
  sectionTabSubtextActive: {
    color: "#1E6B45",
  },
  filterButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 9,
  },
  filterButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterButtonText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
  },
  filterButtonTextActive: {
    color: colors.surface,
  },
  listContent: {
    gap: spacing.sm,
    paddingBottom: BOTTOM_QUICK_ACTIONS_SPACE + spacing.lg,
  },
  entryCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    padding: spacing.md,
  },
  entryCardPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  entryHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  entryIcon: {
    alignItems: "center",
    backgroundColor: "#F3FAF7",
    borderRadius: 14,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  turnoIcon: {
    backgroundColor: "#EAF8F3",
  },
  entryRightActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
  },
  dayNoticeChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 5,
  },
  dayNoticeChipToday: {
    backgroundColor: "#FFF0D9",
    borderColor: "#FFC36A",
  },
  dayNoticeChipTomorrow: {
    backgroundColor: "#EEF6FF",
    borderColor: "#BBD7F2",
  },
  dayNoticeChipText: {
    fontSize: 9,
    fontWeight: "900",
  },
  dayNoticeChipTextToday: {
    color: "#C65D00",
  },
  dayNoticeChipTextTomorrow: {
    color: "#1E5F86",
  },
  moreButton: {
    alignItems: "center",
    backgroundColor: "#F7FBF9",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  entryCopy: {
    flex: 1,
  },
  entryTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  entryMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  statusChip: {
    alignSelf: "flex-start",
    backgroundColor: "#EEF4F1",
    borderRadius: 999,
    marginTop: spacing.sm,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  turnoStatusChip: {
    marginTop: 0,
  },
  statusChipPending: {
    backgroundColor: "#FFF0D9",
  },
  statusChipText: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "900",
  },
  statusChipTextPending: {
    color: "#C65D00",
  },
  statusChipUnread: {
    backgroundColor: "#EAF3FF",
  },
  statusChipTextUnread: {
    color: "#1E5F86",
  },
  turnoStatusRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  playerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    marginTop: spacing.sm,
  },
  playerText: {
    color: colors.text,
    flex: 1,
    fontSize: 13,
    fontWeight: "800",
  },
  phoneRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    marginTop: 6,
  },
  phoneText: {
    color: colors.muted,
    flex: 1,
    fontSize: 12,
    fontWeight: "800",
  },
  reviewRow: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
  },
  reviewText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  turnoPaymentText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
  },
  turnoActionsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  markReadButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#EEF6FF",
    borderColor: "#BBD7F2",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    marginTop: spacing.sm,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  markReadButtonDisabled: {
    opacity: 0.6,
  },
  markReadButtonText: {
    color: "#1E5F86",
    fontSize: 11,
    fontWeight: "900",
  },
  turnoActionButton: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 9,
  },
  turnoRejectButton: {
    backgroundColor: "#FFF1F1",
    borderColor: "#F0B8B8",
  },
  turnoConfirmButton: {
    backgroundColor: "#EAF8F3",
    borderColor: "#91D7B2",
  },
  turnoActionText: {
    fontSize: 11,
    fontWeight: "900",
  },
  turnoRejectText: {
    color: "#B94141",
  },
  turnoConfirmText: {
    color: "#1E6B45",
  },
  typeChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 5,
  },
  typeChipLeague: {
    backgroundColor: "#EAF8F3",
    borderColor: "#91D7B2",
  },
  typeChipTournament: {
    backgroundColor: "#EEF6FF",
    borderColor: "#BBD7F2",
  },
  typeChipTurno: {
    backgroundColor: "#F2F0FF",
    borderColor: "#C7BEF5",
  },
  typeChipText: {
    fontSize: 9,
    fontWeight: "900",
  },
  typeChipTextLeague: {
    color: "#1E6B45",
  },
  typeChipTextTournament: {
    color: "#1E5F86",
  },
  typeChipTextTurno: {
    color: "#4A3B8F",
  },
  modalOverlay: {
    alignItems: "center",
    backgroundColor: colors.overlay,
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  contactMenuCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    gap: spacing.sm,
    padding: spacing.lg,
    width: "100%",
  },
  contactMenuTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "900",
    textAlign: "center",
  },
  contactMenuPhone: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },
  contactMenuAction: {
    alignItems: "center",
    backgroundColor: "#F7FBF9",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  contactMenuActionDisabled: {
    opacity: 0.45,
  },
  contactMenuActionText: {
    color: colors.text,
    flex: 1,
    fontSize: 13,
    fontWeight: "900",
  },
  loaderWrap: {
    alignItems: "center",
    flex: 1,
    gap: spacing.sm,
    justifyContent: "center",
  },
  loaderText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
  },
  emptyCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    padding: spacing.lg,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900",
    textAlign: "center",
  },
  emptyText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
    textAlign: "center",
  },
});
