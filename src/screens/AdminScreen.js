import { useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import AppButton from "../components/AppButton";
import ScreenWrapper from "../components/ScreenWrapper";
import { ADMIN_EMAIL, canAccessAdminPanel } from "../config/admin";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import {
  approveComplexRequest,
  approveOrganizerRequest,
  deleteComplexRequest,
  deleteOrganizerRequest,
  listComplexRequests,
  listOrganizerRequests,
  rejectComplexRequest,
  rejectOrganizerRequest,
} from "../services/organizerService";
import {
  archiveLeagueAsAdmin,
  blockUserAccount,
  cancelTournamentAsAdmin,
  grantAdminAccess,
  listAdminContent,
  listAdminUsers,
  restoreUserAccount,
  restoreLeagueAsAdmin,
  restoreTournamentAsAdmin,
  revokeAdminAccess,
  revokeOrganizerAccess,
  updateUserProfileAsAdmin,
} from "../services/adminService";
import { ADMIN_ROLE, ORGANIZER_ROLE, ORGANIZER_STATUS } from "../services/roleService";
import { listAdminReports, updateReportStatus } from "../services/reportsService";
import { getTournamentById } from "../services/tournamentsService";

function formatAdminDate(millis = 0) {
  if (!millis) {
    return "Sin registro";
  }

  const date = new Date(millis);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();

  return `${day}/${month}/${year}`;
}

function buildUserEditForm(user = {}) {
  return {
    name: user.name || "",
    phone: user.phone || "",
    category: user.category || "",
    sex: user.sex || "",
    city: user.city || "",
    province: user.province || "",
    country: user.country || "Argentina",
    side: user.side || "",
    hand: user.hand || "",
    description: user.description || "",
  };
}

function formatRoleLabel(user = {}) {
  if (user.role === ADMIN_ROLE || user.adminStatus === "active") {
    return "Administrador";
  }

  if (user.role === ORGANIZER_ROLE && user.organizerStatus === ORGANIZER_STATUS.APPROVED) {
    return "Organizador";
  }

  if (user.role === "blocked" || user.accountDeleted) {
    return "Bloqueado";
  }

  return "Jugador";
}

function formatOrganizerStatusLabel(status = "") {
  if (status === ORGANIZER_STATUS.APPROVED) {
    return "Aprobado";
  }

  if (status === ORGANIZER_STATUS.PENDING) {
    return "Pendiente";
  }

  if (status === ORGANIZER_STATUS.REJECTED) {
    return "Rechazado";
  }

  return "Sin permiso de organizador";
}

function formatContentStatusLabel(status = "") {
  const normalizedStatus = String(status || "").toLowerCase();

  if (normalizedStatus === "draft" || normalizedStatus === "draf") {
    return "Borrador";
  }

  if (normalizedStatus === "registration_open") {
    return "Inscripciones abiertas";
  }

  if (normalizedStatus === "registration_closed") {
    return "Inscripciones cerradas";
  }

  if (normalizedStatus === "published" || normalizedStatus === "active") {
    return "Publicado";
  }

  if (normalizedStatus === "in_progress") {
    return "En curso";
  }

  if (normalizedStatus === "finished" || normalizedStatus === "completed") {
    return "Finalizado";
  }

  if (normalizedStatus === "archived") {
    return "Eliminado";
  }

  if (normalizedStatus === "cancelled") {
    return "Cancelado";
  }

  return status || "Sin estado";
}

function formatReportTypeLabel(type = "") {
  if (type === "conversation") {
    return "Conversacion";
  }

  if (type === "profile") {
    return "Perfil";
  }

  if (type === "tournament_poster") {
    return "Afiche de torneo";
  }

  return "Reporte";
}

function resolveReportedUserFromReport(report = {}) {
  const metadata = report.metadata || {};

  if (metadata.reportedUserId) {
    return {
      id: metadata.reportedUserId,
      name: metadata.reportedUserName || report.targetTitle || "",
    };
  }

  if (report.targetType === "profile" && report.targetId) {
    return {
      id: report.targetId,
      name: report.targetTitle || "",
    };
  }

  if (report.targetType === "conversation" && metadata.otherUserId) {
    return {
      id: metadata.otherUserId,
      name: metadata.reportedUserName || report.targetTitle || "",
    };
  }

  if (report.targetType === "tournament_poster" && metadata.organizerId) {
    return {
      id: metadata.organizerId,
      name: metadata.organizerName || metadata.reportedUserName || "",
    };
  }

  return {
    id: "",
    name: metadata.reportedUserName || report.targetTitle || "",
  };
}

export default function AdminScreen({ navigation, route }) {
  const { user, userData } = useAuth();
  const [requests, setRequests] = useState([]);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [users, setUsers] = useState([]);
  const [contentItems, setContentItems] = useState([]);
  const [reports, setReports] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedContent, setSelectedContent] = useState(null);
  const [organizerHistoryUser, setOrganizerHistoryUser] = useState(null);
  const [userEditForm, setUserEditForm] = useState(() => buildUserEditForm());
  const [activeTab, setActiveTab] = useState("menu");
  const [loading, setLoading] = useState(true);

  const canAccessAdmin = canAccessAdminPanel({
    ...userData,
    email: userData?.email || user?.email || "",
  });
  const currentAdminId = userData?.uid || user?.uid || "";
  const isSelectedMainAdmin =
    selectedUser?.email?.trim().toLowerCase() === ADMIN_EMAIL.trim().toLowerCase();
  const selectedUserCriticalActionsDisabled = selectedUser?.id === currentAdminId || isSelectedMainAdmin;
  const playerUsers = users.filter(
    (item) =>
      item.role !== "blocked" &&
      item.blockStatus !== "temporary" &&
      item.blockStatus !== "indefinite" &&
      (item.role !== ORGANIZER_ROLE || item.organizerStatus !== ORGANIZER_STATUS.APPROVED)
  );
  const organizerUsers = users.filter(
    (item) =>
      item.role !== "blocked" &&
      item.blockStatus !== "temporary" &&
      item.blockStatus !== "indefinite" &&
      item.role === ORGANIZER_ROLE &&
      item.organizerStatus === ORGANIZER_STATUS.APPROVED
  );
  const blockedUsers = users.filter(
    (item) =>
      item.accountDeleted ||
      item.role === "blocked" ||
      item.blockStatus === "temporary" ||
      item.blockStatus === "indefinite"
  );
  const contentFiltered = contentItems.filter((item) => {
    if (activeTab === "leagues") {
      return item.type === "league";
    }

    if (activeTab === "tournaments") {
      return item.type === "tournament";
    }

    return true;
  });
  const sixMonthsAgo = Date.now() - 1000 * 60 * 60 * 24 * 183;
  const getOrganizerActivity = (organizerId = "", limit = 0, onlyRecent = false) => {
    const activity = contentItems.filter((item) => {
      if (item.organizerId !== organizerId) {
        return false;
      }

      if (!onlyRecent) {
        return true;
      }

      const activityTime = item.updatedAtMillis || item.createdAtMillis || 0;
      return !activityTime || activityTime >= sixMonthsAgo;
    });

    return limit ? activity.slice(0, limit) : activity;
  };

  const loadRequests = async () => {
    setLoading(true);

    try {
      const organizerRequests = await listOrganizerRequests();
      const complexRequests = await listComplexRequests();
      const nextUsers = await listAdminUsers();
      const nextContentItems = await listAdminContent();
      const nextReports = await listAdminReports();
      const combinedRequests = [
        ...organizerRequests.map((item) => ({ ...item, requestType: "organizer" })),
        ...complexRequests.map((item) => ({ ...item, requestType: "complex" })),
      ].sort((first, second) => {
        const firstTime =
          typeof first.createdAt?.toMillis === "function" ? first.createdAt.toMillis() : 0;
        const secondTime =
          typeof second.createdAt?.toMillis === "function" ? second.createdAt.toMillis() : 0;

        return secondTime - firstTime;
      });

      setRequests(combinedRequests);
      setUsers(nextUsers);
      setContentItems(nextContentItems);
      setReports(nextReports);
    } catch (error) {
      Alert.alert("No pudimos cargar solicitudes", error.message);
    } finally {
      setLoading(false);
    }
  };

  const refreshAdminData = () => {
    loadRequests();
  };

  const handleSelectUser = (item) => {
    setSelectedUser(item);
    setUserEditForm(buildUserEditForm(item));
  };

  const updateUserEditField = (field, value) => {
    setUserEditForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleSaveUserProfile = async () => {
    if (!selectedUser) {
      return;
    }

    try {
      await updateUserProfileAsAdmin(selectedUser.id, userEditForm);
      setSelectedUser(null);
      refreshAdminData();
      Alert.alert("Perfil actualizado", "Los datos del usuario fueron guardados.");
    } catch (error) {
      Alert.alert("No pudimos guardar el perfil", error.message);
    }
  };

  const handleEditContent = async () => {
    if (!selectedContent) {
      return;
    }

    try {
      if (selectedContent.type === "league") {
        const leagueId = selectedContent.id;
        setSelectedContent(null);
        navigation.navigate("CreateLeague", { leagueId });
        return;
      }

      const tournament = await getTournamentById(selectedContent.id);

      if (!tournament) {
        Alert.alert("No encontramos el torneo", "El torneo ya no esta disponible.");
        return;
      }

      setSelectedContent(null);
      navigation.navigate("CreateTournament", {
        returnToTournamentDetail: true,
        tournament,
      });
    } catch (error) {
      Alert.alert("No pudimos abrir la edicion", error.message);
    }
  };

  const handleOpenContentOrganizer = () => {
    if (!selectedContent?.organizerId) {
      Alert.alert("Sin organizador", "No encontramos un organizador asociado a este contenido.");
      return;
    }

    const organizer = users.find((item) => item.id === selectedContent.organizerId);

    if (!organizer) {
      Alert.alert(
        "No encontramos el perfil",
        "El organizador no aparece en la lista de usuarios cargada."
      );
      return;
    }

    setSelectedContent(null);
    handleSelectUser(organizer);
  };

  const handleOpenReportUser = (userId = "", fallbackName = "") => {
    const selected = users.find((item) => item.id === userId || item.uid === userId);

    if (!selected) {
      Alert.alert(
        "No encontramos el perfil",
        fallbackName
          ? `${fallbackName} no aparece en la lista de usuarios cargada.`
          : "Ese usuario no aparece en la lista cargada."
      );
      return;
    }

    setSelectedReport(null);
    handleSelectUser(selected);
  };

  const handleOpenOrganizerHistory = (organizer) => {
    setOrganizerHistoryUser(organizer);
    setSelectedUser(null);
    setActiveTab("organizerHistory");
  };

  useEffect(() => {
    if (canAccessAdmin) {
      loadRequests();
    } else {
      setLoading(false);
    }
  }, [canAccessAdmin]);

  useEffect(() => {
    const requestedTab = route?.params?.initialTab;

    if (requestedTab) {
      setActiveTab(requestedTab);
      if (typeof navigation?.setParams === "function") {
        navigation.setParams({ initialTab: undefined });
      }
    }
  }, [navigation, route?.params?.initialTab]);

  const handleApprove = async () => {
    if (!selectedRequest) {
      return;
    }

    try {
      if (selectedRequest.requestType === "complex") {
        await approveComplexRequest(selectedRequest.id);
        Alert.alert("Complejo aprobado", "El complejo ya quedo disponible para el organizador.");
      } else {
        await approveOrganizerRequest(selectedRequest.userId);
        Alert.alert("Solicitud aprobada", "El organizador ya quedo habilitado.");
      }
      setSelectedRequest(null);
      loadRequests();
    } catch (error) {
      Alert.alert("No pudimos aprobar", error.message);
    }
  };

  const handleReject = async () => {
    if (!selectedRequest) {
      return;
    }

    try {
      if (selectedRequest.requestType === "complex") {
        await rejectComplexRequest(selectedRequest.id);
        Alert.alert("Solicitud rechazada", "El complejo no fue aprobado.");
      } else {
        await rejectOrganizerRequest(selectedRequest.userId);
        Alert.alert("Solicitud rechazada", "La solicitud fue marcada como rechazada.");
      }
      setSelectedRequest(null);
      loadRequests();
    } catch (error) {
      Alert.alert("No pudimos rechazar", error.message);
    }
  };

  const handleDeleteRequest = async () => {
    if (!selectedRequest) {
      return;
    }

    try {
      if (selectedRequest.requestType === "complex") {
        await deleteComplexRequest(selectedRequest.id);
      } else {
        await deleteOrganizerRequest(selectedRequest.userId);
      }

      setSelectedRequest(null);
      loadRequests();
    } catch (error) {
      Alert.alert("No pudimos eliminar", error.message);
    }
  };

  if (!canAccessAdmin) {
    return (
      <ScreenWrapper>
        <View style={styles.card}>
          <Text style={styles.title}>Panel Admin</Text>
          <Text style={styles.subtitle}>
            Esta pantalla esta reservada para administradores. Admin inicial: {ADMIN_EMAIL}.
          </Text>
        </View>
      </ScreenWrapper>
    );
  }

  const renderRequestItem = ({ item }) => (
    <Pressable
      onPress={() => setSelectedRequest(item)}
      style={({ pressed }) => [
        styles.requestCard,
        pressed && styles.requestCardPressed,
      ]}
    >
      <View style={styles.requestTopRow}>
        <Text style={styles.requestName}>{item.nombre || item.organizerName || "Solicitud"}</Text>
        <Text style={styles.statusBadge}>{item.status}</Text>
      </View>
      <Text style={styles.requestMeta}>
        Tipo: {item.requestType === "complex" ? "Nuevo complejo" : "Organizador"}
      </Text>
      {item.requestType === "organizer" ? (
        <>
          <Text style={styles.requestMeta}>DNI: {item.dni}</Text>
          <Text style={styles.requestMeta}>Telefono: {item.telefono}</Text>
        </>
      ) : (
        <Text style={styles.requestMeta}>Email: {item.organizerEmail || "-"}</Text>
      )}
      <Text style={styles.requestMeta}>Complejos: {item.complejos?.length || 0}</Text>
    </Pressable>
  );

  const handleHeaderBack = () => {
    if (activeTab === "menu") {
      navigation.goBack();
      return;
    }

    if (activeTab === "organizerHistory") {
      setOrganizerHistoryUser(null);
      setActiveTab("organizers");
      return;
    }

    setActiveTab("menu");
  };

  const renderMenuCard = ({ title, subtitle, onPress, icon = "grid-outline" }) => (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuCard,
        pressed && styles.requestCardPressed,
      ]}
    >
      <View style={styles.menuCardRow}>
        <View style={styles.menuCardIcon}>
          <Ionicons color="#0C6A49" name={icon} size={22} />
        </View>
        <View style={styles.menuCardCopy}>
          <Text style={styles.menuCardTitle}>{title}</Text>
          <Text style={styles.menuCardText}>{subtitle}</Text>
        </View>
      </View>
    </Pressable>
  );

  return (
    <>
      <ScreenWrapper>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Pressable
              onPress={handleHeaderBack}
              style={({ pressed }) => [styles.headerBackButton, pressed && styles.requestCardPressed]}
            >
              <Ionicons color={colors.primaryDark} name="arrow-back" size={22} />
            </Pressable>
            <View style={styles.headerCopy}>
              <View style={styles.titleChip}>
                <Text style={styles.titleChipTop}>PANEL</Text>
                <Text numberOfLines={1} adjustsFontSizeToFit style={styles.titleChipBottom}>
                  ADMINISTRADOR
                </Text>
              </View>
            </View>
            <View style={styles.headerBackPlaceholder} />
          </View>

          {activeTab === "menu" ? (
            <View style={styles.menuGrid}>
              {renderMenuCard({
                title: "SOLICITUD ORGANIZADOR",
                subtitle: `${requests.length} solicitudes para revisar`,
                onPress: () => setActiveTab("requests"),
                icon: "person-add-outline",
              })}
              {renderMenuCard({
                title: "USUARIOS",
                subtitle: "Jugadores, organizadores y bloqueados",
                onPress: () => setActiveTab("usersMenu"),
                icon: "people-outline",
              })}
              {renderMenuCard({
                title: "LIGAS Y TORNEOS",
                subtitle: "Contenido publicado y archivado",
                onPress: () => setActiveTab("contentMenu"),
                icon: "trophy-outline",
              })}
              {renderMenuCard({
                title: "REPORTES",
                subtitle: `${reports.filter((item) => item.status === "pending").length} pendientes`,
                onPress: () => setActiveTab("reports"),
                icon: "flag-outline",
              })}
            </View>
          ) : activeTab === "usersMenu" ? (
            <View style={styles.menuGrid}>
              {renderMenuCard({
                title: "JUGADORES",
                subtitle: `${playerUsers.length} usuarios registrados`,
                onPress: () => setActiveTab("players"),
                icon: "tennisball-outline",
              })}
              {renderMenuCard({
                title: "ORGANIZADORES",
                subtitle: `${organizerUsers.length} organizadores aprobados`,
                onPress: () => setActiveTab("organizers"),
                icon: "business-outline",
              })}
              {renderMenuCard({
                title: "USUARIOS BLOQUEADOS",
                subtitle: `${blockedUsers.length} cuentas bloqueadas`,
                onPress: () => setActiveTab("blockedUsers"),
                icon: "ban-outline",
              })}
            </View>
          ) : activeTab === "contentMenu" ? (
            <View style={styles.menuGrid}>
              {renderMenuCard({
                title: "LIGAS",
                subtitle: `${contentItems.filter((item) => item.type === "league").length} ligas`,
                onPress: () => setActiveTab("leagues"),
                icon: "calendar-outline",
              })}
              {renderMenuCard({
                title: "TORNEOS",
                subtitle: `${contentItems.filter((item) => item.type === "tournament").length} torneos`,
                onPress: () => setActiveTab("tournaments"),
                icon: "podium-outline",
              })}
            </View>
          ) : activeTab === "reports" ? (
            <FlatList
              contentContainerStyle={styles.listContent}
              data={reports}
              keyExtractor={(item) => item.id}
              ListEmptyComponent={
                <Text style={styles.emptyText}>
                  {loading ? "Cargando reportes..." : "No hay reportes para revisar."}
                </Text>
              }
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => setSelectedReport(item)}
                  style={({ pressed }) => [styles.requestCard, pressed && styles.requestCardPressed]}
                >
                  <View style={styles.requestTopRow}>
                    <Text style={styles.requestName}>{formatReportTypeLabel(item.targetType)}</Text>
                    <Text style={styles.statusBadge}>
                      {item.status === "pending" ? "Pendiente" : "Revisado"}
                    </Text>
                  </View>
                  <Text style={styles.requestMeta}>{item.targetTitle || "Sin titulo"}</Text>
                  <Text style={styles.requestMeta}>Reporto: {item.reporterName || "-"}</Text>
                  <Text style={styles.requestMeta}>
                    Fecha: {formatAdminDate(item.createdAtMillis)}
                  </Text>
                </Pressable>
              )}
              showsVerticalScrollIndicator={false}
            />
          ) : activeTab === "requests" ? (
            <FlatList
              contentContainerStyle={styles.listContent}
              data={requests}
              keyExtractor={(item) => item.id}
              ListEmptyComponent={
                <Text style={styles.emptyText}>
                  {loading ? "Cargando solicitudes..." : "No hay solicitudes para revisar."}
                </Text>
              }
              renderItem={renderRequestItem}
              showsVerticalScrollIndicator={false}
            />
          ) : activeTab === "players" || activeTab === "organizers" || activeTab === "blockedUsers" ? (
            <FlatList
              contentContainerStyle={styles.listContent}
              data={
                activeTab === "players"
                  ? playerUsers
                  : activeTab === "organizers"
                    ? organizerUsers
                    : blockedUsers
              }
              keyExtractor={(item) => item.id}
              ListEmptyComponent={
                <Text style={styles.emptyText}>
                  {loading
                    ? "Cargando usuarios..."
                    : activeTab === "players"
                      ? "No hay jugadores para revisar."
                      : activeTab === "organizers"
                        ? "No hay organizadores para revisar."
                        : "No hay usuarios bloqueados."}
                </Text>
              }
              renderItem={({ item }) => {
                const isAdmin = item.role === ADMIN_ROLE || item.adminStatus === "active";
                const isOrganizer =
                  item.role === ORGANIZER_ROLE &&
                  item.organizerStatus === ORGANIZER_STATUS.APPROVED;

                return (
                  <Pressable
                    onPress={() => handleSelectUser(item)}
                    style={({ pressed }) => [
                      styles.requestCard,
                      item.accountDeleted ? styles.userCardBlocked : null,
                      pressed && styles.requestCardPressed,
                    ]}
                  >
                    <View style={styles.requestTopRow}>
                      <Text style={styles.requestName}>{item.name}</Text>
                      <Text style={styles.statusBadge}>
                        {isAdmin
                          ? "Admin"
                          : item.accountDeleted
                            ? "Bloqueado"
                            : isOrganizer
                              ? "Organizador"
                              : "Jugador"}
                      </Text>
                    </View>
                    <Text style={styles.requestMeta}>{item.email || "Sin email"}</Text>
                    <Text style={styles.requestMeta}>
                      Ultimo ingreso: {formatAdminDate(item.lastLoginAtMillis)}
                    </Text>
                    <Text style={styles.requestMeta}>
                      Alta: {formatAdminDate(item.createdAtMillis)}
                    </Text>
                  </Pressable>
                );
              }}
              showsVerticalScrollIndicator={false}
            />
          ) : activeTab === "organizerHistory" ? (
            <View style={styles.historyScreen}>
              <Text style={styles.historyTitle}>
                Historial de {organizerHistoryUser?.name || "organizador"}
              </Text>
              <Text style={styles.historySubtitle}>Actividad visible de los ultimos 6 meses.</Text>
              <FlatList
                contentContainerStyle={styles.listContent}
                data={getOrganizerActivity(organizerHistoryUser?.id, 0, true)}
                keyExtractor={(item) => `${item.type}-${item.id}`}
                ListEmptyComponent={
                  <Text style={styles.emptyText}>
                    No hay actividad reciente para este organizador.
                  </Text>
                }
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => setSelectedContent(item)}
                    style={({ pressed }) => [styles.requestCard, pressed && styles.requestCardPressed]}
                  >
                    <View style={styles.requestTopRow}>
                      <Text style={styles.requestName}>{item.title}</Text>
                      <Text style={styles.statusBadge}>
                        {item.type === "league" ? "Liga" : "Torneo"}
                      </Text>
                    </View>
                    <Text style={styles.requestMeta}>
                      Estado: {formatContentStatusLabel(item.status)}
                    </Text>
                    <Text style={styles.requestMeta}>
                      Creado: {formatAdminDate(item.createdAtMillis)}
                    </Text>
                    <Text style={styles.requestMeta}>
                      Ultima modificacion: {formatAdminDate(item.updatedAtMillis)}
                    </Text>
                  </Pressable>
                )}
                showsVerticalScrollIndicator={false}
              />
            </View>
          ) : (
            <FlatList
              contentContainerStyle={styles.listContent}
              data={contentFiltered}
              keyExtractor={(item) => `${item.type}-${item.id}`}
              ListEmptyComponent={
                <Text style={styles.emptyText}>
                  {loading
                    ? "Cargando contenido..."
                    : activeTab === "leagues"
                      ? "No hay ligas para revisar."
                      : "No hay torneos para revisar."}
                </Text>
              }
              renderItem={({ item }) => {
                const isLeague = item.type === "league";
                const isArchived = item.status === "archived" || item.status === "cancelled";

                return (
                  <Pressable
                    onPress={() => setSelectedContent(item)}
                    style={({ pressed }) => [
                      styles.requestCard,
                      isArchived ? styles.userCardBlocked : null,
                      pressed && styles.requestCardPressed,
                    ]}
                  >
                    <View style={styles.requestTopRow}>
                      <Text style={styles.requestName}>{item.title}</Text>
                      <Text style={styles.statusBadge}>{isLeague ? "Liga" : "Torneo"}</Text>
                    </View>
                    <Text style={styles.requestMeta}>
                      Estado: {formatContentStatusLabel(item.status)}
                    </Text>
                    <Text style={styles.requestMeta}>Organizador: {item.organizerName}</Text>
                    {item.venue ? <Text style={styles.requestMeta}>Sede: {item.venue}</Text> : null}
                  </Pressable>
                );
              }}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      </ScreenWrapper>

      <Modal animationType="slide" transparent visible={Boolean(selectedRequest)}>
        <View style={styles.modalOverlay}>
          <Pressable onPress={() => setSelectedRequest(null)} style={styles.modalBackdrop} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Detalle de solicitud</Text>

            {selectedRequest ? (
              <ScrollView
                contentContainerStyle={styles.modalContent}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.detailCard}>
                  <Text style={styles.detailLabel}>Tipo</Text>
                  <Text style={styles.detailValue}>
                    {selectedRequest.requestType === "complex"
                      ? "Solicitud de nuevo complejo"
                      : "Solicitud de organizador"}
                  </Text>
                  <Text style={styles.detailLabel}>Nombre</Text>
                  <Text style={styles.detailValue}>
                    {selectedRequest.nombre || selectedRequest.organizerName || "-"}
                  </Text>
                  {selectedRequest.requestType === "organizer" ? (
                    <>
                      <Text style={styles.detailLabel}>DNI</Text>
                      <Text style={styles.detailValue}>{selectedRequest.dni}</Text>
                      <Text style={styles.detailLabel}>Telefono</Text>
                      <Text style={styles.detailValue}>{selectedRequest.telefono}</Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.detailLabel}>Email</Text>
                      <Text style={styles.detailValue}>{selectedRequest.organizerEmail || "-"}</Text>
                    </>
                  )}
                </View>

                {(selectedRequest.complejos || []).map((complex, index) => (
                  <View key={`${complex.nombre}-${index}`} style={styles.detailCard}>
                    <Text style={styles.complexTitle}>Complejo {index + 1}</Text>
                    <Text style={styles.detailValue}>{complex.nombre}</Text>
                    <Text style={styles.detailMeta}>Blindex: {complex.blindex}</Text>
                    <Text style={styles.detailMeta}>
                      Cemento con cesped sintetico: {complex.cesped}
                    </Text>
                    <Text style={styles.detailMeta}>
                      Cemento piso de cemento: {complex.cemento}
                    </Text>
                    <Text style={styles.detailMeta}>
                      Total de canchas: {complex.totalCanchas}
                    </Text>
                    <Text style={styles.detailAddress}>{complex.direccion}</Text>
                  </View>
                ))}

                <View style={styles.modalActions}>
                  <AppButton title="Aprobar" onPress={handleApprove} style={styles.compactButton} />
                  <AppButton
                    title="Rechazar"
                    onPress={handleReject}
                    style={styles.compactButton}
                    variant="secondary"
                  />
                  <AppButton
                    title="Cerrar"
                    onPress={() => setSelectedRequest(null)}
                    style={styles.compactButton}
                    variant="secondary"
                  />
                  <AppButton
                    title="Eliminar solicitud"
                    onPress={handleDeleteRequest}
                    style={styles.compactButton}
                    variant="secondary"
                  />
                </View>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
      <Modal animationType="slide" transparent visible={Boolean(selectedUser)}>
        <View style={styles.modalOverlay}>
          <Pressable onPress={() => setSelectedUser(null)} style={styles.modalBackdrop} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Gestionar usuario</Text>
            {selectedUser ? (
              <ScrollView contentContainerStyle={styles.modalContent}>
                {selectedUser.id === currentAdminId ? (
                  <Text style={styles.selfAdminWarning}>
                    Estas viendo tu propio usuario. Las acciones criticas se deshabilitan para no
                    dejarte sin acceso.
                  </Text>
                ) : null}
                <View style={styles.profileHeaderCard}>
                  {selectedUser.avatarUrl ? (
                    <Image source={{ uri: selectedUser.avatarUrl }} style={styles.profileAvatar} />
                  ) : (
                    <View
                      style={[
                        styles.profileAvatar,
                        styles.profileAvatarFallback,
                        { backgroundColor: selectedUser.avatarColor || colors.primary },
                      ]}
                    >
                      <Text style={styles.profileAvatarInitial}>
                        {(selectedUser.name || "U").trim().charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                  <View style={styles.profileHeaderCopy}>
                    <Text style={styles.profileHeaderName}>{selectedUser.name}</Text>
                    <Text style={styles.profileHeaderMeta}>{formatRoleLabel(selectedUser)}</Text>
                  </View>
                  {selectedUser.organizerLogoUrl ? (
                    <Image
                      source={{ uri: selectedUser.organizerLogoUrl }}
                      style={styles.organizerLogoPreview}
                    />
                  ) : null}
                </View>
                <View style={styles.detailCard}>
                  <Text style={styles.detailLabel}>Nombre</Text>
                  <Text style={styles.detailValue}>{selectedUser.name}</Text>
                  <Text style={styles.detailLabel}>Email</Text>
                  <Text style={styles.detailValue}>{selectedUser.email || "-"}</Text>
                  <Text style={styles.detailLabel}>Rol</Text>
                  <Text style={styles.detailValue}>{formatRoleLabel(selectedUser)}</Text>
                  <Text style={styles.detailLabel}>Estado organizador</Text>
                  <Text style={styles.detailValue}>
                    {formatOrganizerStatusLabel(selectedUser.organizerStatus)}
                  </Text>
                  <Text style={styles.detailLabel}>Bloqueo</Text>
                  <Text style={styles.detailValue}>
                    {selectedUser.blockStatus === "temporary"
                      ? `Temporal hasta ${formatAdminDate(selectedUser.blockedUntilMillis)}`
                      : selectedUser.blockStatus === "indefinite" || selectedUser.role === "blocked"
                        ? "Indefinido"
                        : "Sin bloqueo"}
                  </Text>
                  <Text style={styles.detailLabel}>Ultimo ingreso</Text>
                  <Text style={styles.detailValue}>
                    {formatAdminDate(selectedUser.lastLoginAtMillis)}
                  </Text>
                  <Text style={styles.detailLabel}>Fecha de alta</Text>
                  <Text style={styles.detailValue}>
                    {formatAdminDate(selectedUser.createdAtMillis)}
                  </Text>
                </View>
                <View style={styles.detailCard}>
                  <Text style={styles.complexTitle}>Perfil completo</Text>
                  <Text style={styles.inputLabel}>Nombre y apellido</Text>
                  <TextInput
                    onChangeText={(value) => updateUserEditField("name", value)}
                    placeholder="Nombre y apellido"
                    placeholderTextColor={colors.muted}
                    style={styles.adminInput}
                    value={userEditForm.name}
                  />
                  <Text style={styles.inputLabel}>Telefono</Text>
                  <TextInput
                    keyboardType="phone-pad"
                    onChangeText={(value) => updateUserEditField("phone", value)}
                    placeholder="Telefono"
                    placeholderTextColor={colors.muted}
                    style={styles.adminInput}
                    value={userEditForm.phone}
                  />
                  <View style={styles.inputGrid}>
                    <View style={styles.inputGridItem}>
                      <Text style={styles.inputLabel}>Categoria</Text>
                      <TextInput
                        onChangeText={(value) => updateUserEditField("category", value)}
                        placeholder="Categoria"
                        placeholderTextColor={colors.muted}
                        style={styles.adminInput}
                        value={userEditForm.category}
                      />
                    </View>
                    <View style={styles.inputGridItem}>
                      <Text style={styles.inputLabel}>Sexo</Text>
                      <TextInput
                        onChangeText={(value) => updateUserEditField("sex", value)}
                        placeholder="Sexo"
                        placeholderTextColor={colors.muted}
                        style={styles.adminInput}
                        value={userEditForm.sex}
                      />
                    </View>
                  </View>
                  <View style={styles.inputGrid}>
                    <View style={styles.inputGridItem}>
                      <Text style={styles.inputLabel}>Localidad</Text>
                      <TextInput
                        onChangeText={(value) => updateUserEditField("city", value)}
                        placeholder="Localidad"
                        placeholderTextColor={colors.muted}
                        style={styles.adminInput}
                        value={userEditForm.city}
                      />
                    </View>
                    <View style={styles.inputGridItem}>
                      <Text style={styles.inputLabel}>Provincia</Text>
                      <TextInput
                        onChangeText={(value) => updateUserEditField("province", value)}
                        placeholder="Provincia"
                        placeholderTextColor={colors.muted}
                        style={styles.adminInput}
                        value={userEditForm.province}
                      />
                    </View>
                  </View>
                  <View style={styles.inputGrid}>
                    <View style={styles.inputGridItem}>
                      <Text style={styles.inputLabel}>Lado</Text>
                      <TextInput
                        onChangeText={(value) => updateUserEditField("side", value)}
                        placeholder="Drive / reves"
                        placeholderTextColor={colors.muted}
                        style={styles.adminInput}
                        value={userEditForm.side}
                      />
                    </View>
                    <View style={styles.inputGridItem}>
                      <Text style={styles.inputLabel}>Mano habil</Text>
                      <TextInput
                        onChangeText={(value) => updateUserEditField("hand", value)}
                        placeholder="Derecha / zurda"
                        placeholderTextColor={colors.muted}
                        style={styles.adminInput}
                        value={userEditForm.hand}
                      />
                    </View>
                  </View>
                  <Text style={styles.inputLabel}>Descripcion</Text>
                  <TextInput
                    multiline
                    onChangeText={(value) => updateUserEditField("description", value)}
                    placeholder="Descripcion del perfil"
                    placeholderTextColor={colors.muted}
                    style={[styles.adminInput, styles.adminTextArea]}
                    textAlignVertical="top"
                    value={userEditForm.description}
                  />
                  <AppButton
                    title="Guardar perfil"
                    onPress={handleSaveUserProfile}
                    style={styles.compactButton}
                  />
                </View>
                {selectedUser.role === ORGANIZER_ROLE ? (
                  <View style={styles.detailCard}>
                    <View style={styles.activityHeaderRow}>
                      <Text style={styles.complexTitle}>Actividad como organizador</Text>
                      {getOrganizerActivity(selectedUser.id).length > 5 ? (
                        <Pressable
                          onPress={() => handleOpenOrganizerHistory(selectedUser)}
                          style={({ pressed }) => [
                            styles.historyLink,
                            pressed && styles.requestCardPressed,
                          ]}
                        >
                          <Text style={styles.historyLinkText}>Ver toda</Text>
                        </Pressable>
                      ) : null}
                    </View>
                    {getOrganizerActivity(selectedUser.id).length ? (
                      getOrganizerActivity(selectedUser.id, 5)
                        .map((item) => (
                          <View key={`${item.type}-${item.id}`} style={styles.activityRow}>
                            <Text style={styles.activityTitle}>
                              {item.type === "league" ? "Liga" : "Torneo"}: {item.title}
                            </Text>
                            <Text style={styles.detailMeta}>
                              Estado: {formatContentStatusLabel(item.status)}
                            </Text>
                            <Text style={styles.detailMeta}>
                              Creado: {formatAdminDate(item.createdAtMillis)}
                            </Text>
                            <Text style={styles.detailMeta}>
                              Ultima modificacion: {formatAdminDate(item.updatedAtMillis)}
                            </Text>
                          </View>
                        ))
                    ) : (
                      <Text style={styles.detailMeta}>No tiene ligas ni torneos registrados.</Text>
                    )}
                  </View>
                ) : null}
                <View style={styles.modalActions}>
                  {selectedUser.role === ADMIN_ROLE || selectedUser.adminStatus === "active" ? (
                    <AppButton
                      title="Quitar admin"
                      onPress={async () => {
                        await revokeAdminAccess(selectedUser.id, selectedUser.role);
                        setSelectedUser(null);
                        refreshAdminData();
                      }}
                      disabled={selectedUserCriticalActionsDisabled}
                      style={styles.compactButton}
                      variant="secondary"
                    />
                  ) : (
                    <AppButton
                      title="Hacer admin"
                      onPress={async () => {
                        await grantAdminAccess(selectedUser.id);
                        setSelectedUser(null);
                        refreshAdminData();
                      }}
                      style={styles.compactButton}
                    />
                  )}
                  {selectedUser.role === ORGANIZER_ROLE ? (
                    <AppButton
                      title="Quitar organizador"
                      onPress={async () => {
                        await revokeOrganizerAccess(selectedUser.id);
                        setSelectedUser(null);
                        refreshAdminData();
                      }}
                      disabled={selectedUserCriticalActionsDisabled}
                      style={styles.compactButton}
                      variant="secondary"
                    />
                  ) : null}
                  {selectedUser.accountDeleted ||
                  selectedUser.blockStatus === "temporary" ||
                  selectedUser.blockStatus === "indefinite" ||
                  selectedUser.role === "blocked" ? (
                    <AppButton
                      title="Desbloquear usuario"
                      onPress={async () => {
                        await restoreUserAccount(selectedUser.id);
                        setSelectedUser(null);
                        refreshAdminData();
                      }}
                      style={styles.compactButton}
                    />
                  ) : (
                    <>
                      <AppButton
                        title="Bloquear 7 dias"
                        onPress={async () => {
                          await blockUserAccount(selectedUser.id, "temporary_7_days", selectedUser);
                          setSelectedUser(null);
                          refreshAdminData();
                        }}
                        disabled={selectedUserCriticalActionsDisabled}
                        style={styles.compactButton}
                        variant="secondary"
                      />
                      <AppButton
                        title="Bloquear indefinido"
                        onPress={async () => {
                          await blockUserAccount(selectedUser.id, "indefinite", selectedUser);
                          setSelectedUser(null);
                          refreshAdminData();
                        }}
                        disabled={selectedUserCriticalActionsDisabled}
                        style={styles.compactButton}
                        variant="secondary"
                      />
                    </>
                  )}
                  <AppButton
                    title="Cerrar"
                    onPress={() => setSelectedUser(null)}
                    style={styles.compactButton}
                    variant="secondary"
                  />
                </View>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
      <Modal animationType="slide" transparent visible={Boolean(selectedContent)}>
        <View style={styles.modalOverlay}>
          <Pressable onPress={() => setSelectedContent(null)} style={styles.modalBackdrop} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Gestionar contenido</Text>
            {selectedContent ? (
              <ScrollView contentContainerStyle={styles.modalContent}>
                <View style={styles.detailCard}>
                  <Text style={styles.detailLabel}>Tipo</Text>
                  <Text style={styles.detailValue}>
                    {selectedContent.type === "league" ? "Liga" : "Torneo"}
                  </Text>
                  <Text style={styles.detailLabel}>Nombre</Text>
                  <Text style={styles.detailValue}>{selectedContent.title}</Text>
                  <Text style={styles.detailLabel}>Organizador</Text>
                  <Text style={styles.detailValue}>{selectedContent.organizerName}</Text>
                  <Text style={styles.detailLabel}>Estado</Text>
                  <Text style={styles.detailValue}>
                    {formatContentStatusLabel(selectedContent.status)}
                  </Text>
                </View>
                <View style={styles.modalActions}>
                  <AppButton
                    title={selectedContent.type === "league" ? "Editar liga" : "Editar torneo"}
                    onPress={handleEditContent}
                    style={styles.compactButton}
                  />
                  <AppButton
                    title="Ver perfil del organizador"
                    onPress={handleOpenContentOrganizer}
                    style={styles.compactButton}
                    variant="secondary"
                  />
                  {selectedContent.type === "league" ? (
                    selectedContent.status === "archived" ? (
                      <AppButton
                        title="Restaurar liga"
                        onPress={async () => {
                          await restoreLeagueAsAdmin(selectedContent.id);
                          setSelectedContent(null);
                          refreshAdminData();
                        }}
                        style={styles.compactButton}
                      />
                    ) : (
                      <AppButton
                        title="Eliminar liga"
                        onPress={async () => {
                          await archiveLeagueAsAdmin(selectedContent.id);
                          setSelectedContent(null);
                          refreshAdminData();
                        }}
                        style={styles.compactButton}
                        variant="secondary"
                      />
                    )
                  ) : selectedContent.status === "cancelled" ? (
                    <AppButton
                      title="Restaurar torneo"
                      onPress={async () => {
                        await restoreTournamentAsAdmin(selectedContent.id);
                        setSelectedContent(null);
                        refreshAdminData();
                      }}
                      style={styles.compactButton}
                    />
                  ) : (
                    <AppButton
                      title="Eliminar torneo"
                      onPress={async () => {
                        await cancelTournamentAsAdmin(selectedContent.id);
                        setSelectedContent(null);
                        refreshAdminData();
                      }}
                      style={styles.compactButton}
                      variant="secondary"
                    />
                  )}
                  <AppButton
                    title="Cerrar"
                    onPress={() => setSelectedContent(null)}
                    style={styles.compactButton}
                    variant="secondary"
                  />
                </View>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
      <Modal animationType="slide" transparent visible={Boolean(selectedReport)}>
        <View style={styles.modalOverlay}>
          <Pressable onPress={() => setSelectedReport(null)} style={styles.modalBackdrop} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Detalle de reporte</Text>
            {selectedReport ? (
              <ScrollView contentContainerStyle={styles.modalContent}>
                {(() => {
                  const reportedUser = resolveReportedUserFromReport(selectedReport);

                  return (
                <View style={styles.detailCard}>
                  <Text style={styles.detailLabel}>Tipo</Text>
                  <Text style={styles.detailValue}>
                    {formatReportTypeLabel(selectedReport.targetType)}
                  </Text>
                  <Text style={styles.detailLabel}>Reportado</Text>
                  <Text style={styles.detailValue}>{selectedReport.targetTitle || "-"}</Text>
                  <Text style={styles.detailLabel}>Usuario que reporto</Text>
                  <Text style={styles.detailValue}>{selectedReport.reporterName || "-"}</Text>
                  <Pressable
                    onPress={() =>
                      handleOpenReportUser(selectedReport.reporterId, selectedReport.reporterName)
                    }
                    style={({ pressed }) => [styles.reportUserLink, pressed && styles.requestCardPressed]}
                  >
                    <Text style={styles.reportUserLinkText}>Ver perfil del que reporto</Text>
                  </Pressable>
                  <Text style={styles.detailLabel}>Persona reportada</Text>
                  <Text style={styles.detailValue}>
                    {reportedUser.name || selectedReport.targetTitle || "-"}
                  </Text>
                  {reportedUser.id ? (
                    <Pressable
                      onPress={() =>
                        handleOpenReportUser(
                          reportedUser.id,
                          reportedUser.name
                        )
                      }
                      style={({ pressed }) => [
                        styles.reportUserLink,
                        pressed && styles.requestCardPressed,
                      ]}
                    >
                      <Text style={styles.reportUserLinkText}>Ver perfil reportado</Text>
                    </Pressable>
                  ) : null}
                  <Text style={styles.detailLabel}>Motivo</Text>
                  <Text style={styles.detailValue}>{selectedReport.description || "Sin detalle"}</Text>
                  <Text style={styles.detailLabel}>Estado</Text>
                  <Text style={styles.detailValue}>
                    {selectedReport.status === "pending" ? "Pendiente" : "Revisado"}
                  </Text>
                </View>
                  );
                })()}
                <View style={styles.modalActions}>
                  {selectedReport.status === "pending" ? (
                    <AppButton
                      title="Marcar revisado"
                      onPress={async () => {
                        await updateReportStatus(selectedReport.id, "reviewed");
                        setSelectedReport(null);
                        refreshAdminData();
                      }}
                      style={styles.compactButton}
                    />
                  ) : null}
                  <AppButton
                    title="Cerrar"
                    onPress={() => setSelectedReport(null)}
                    style={styles.compactButton}
                    variant="secondary"
                  />
                </View>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#F5FBF8",
    borderRadius: 24,
    flex: 1,
    padding: spacing.lg,
  },
  headerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  headerBackButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  headerBackPlaceholder: {
    height: 36,
    width: 36,
  },
  headerCopy: {
    flex: 1,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "800",
    textAlign: "center",
  },
  titleChip: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#E7F7EF",
    borderColor: "#97D7B6",
    borderRadius: 16,
    borderWidth: 1,
    minWidth: 188,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
  },
  titleChipTop: {
    color: "#0C6A49",
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 15,
    textAlign: "center",
  },
  titleChipBottom: {
    color: "#123D33",
    fontSize: 19,
    fontWeight: "900",
    lineHeight: 20,
    textAlign: "center",
    width: "100%",
  },
  subtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: spacing.xs,
  },
  refreshButton: {
    marginBottom: 0,
    minHeight: 48,
    paddingVertical: 12,
  },
  listContent: {
    paddingBottom: spacing.sm,
  },
  backButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: spacing.md,
    minHeight: 36,
    paddingHorizontal: spacing.md,
    justifyContent: "center",
  },
  backButtonText: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "800",
  },
  menuGrid: {
    gap: spacing.sm,
  },
  menuCard: {
    backgroundColor: "#FFFFFF",
    borderColor: "#CFE7DC",
    borderRadius: 18,
    borderWidth: 1,
    padding: spacing.md,
  },
  menuCardRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  menuCardIcon: {
    alignItems: "center",
    backgroundColor: "#E7F7EF",
    borderColor: "#B8E3CE",
    borderRadius: 14,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  menuCardCopy: {
    flex: 1,
  },
  menuCardTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  menuCardText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
    marginTop: 4,
  },
  emptyCard: {
    alignItems: "center",
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    padding: spacing.lg,
  },
  historyScreen: {
    flex: 1,
  },
  historyTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 4,
  },
  historySubtitle: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    marginBottom: spacing.md,
  },
  tabRow: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 16,
    flexDirection: "row",
    gap: spacing.xs,
    marginBottom: spacing.md,
    padding: 4,
  },
  tabButton: {
    alignItems: "center",
    borderRadius: 12,
    flex: 1,
    justifyContent: "center",
    minHeight: 38,
  },
  tabButtonActive: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  tabText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800",
  },
  tabTextActive: {
    color: colors.primaryDark,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  requestCard: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  requestCardPressed: {
    opacity: 0.92,
  },
  userCardBlocked: {
    backgroundColor: "#FFF0EE",
    borderColor: "#F2B8B2",
  },
  requestTopRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },
  requestName: {
    color: colors.text,
    flex: 1,
    fontSize: 16,
    fontWeight: "800",
    marginRight: spacing.sm,
  },
  statusBadge: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  requestMeta: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
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
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    maxHeight: "90%",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "800",
    marginBottom: spacing.md,
    textAlign: "center",
  },
  modalContent: {
    paddingBottom: spacing.sm,
  },
  detailCard: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  selfAdminWarning: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  profileHeaderCard: {
    alignItems: "center",
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  profileAvatar: {
    borderRadius: 34,
    height: 68,
    width: 68,
  },
  profileAvatarFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  profileAvatarInitial: {
    color: colors.surface,
    fontSize: 26,
    fontWeight: "900",
  },
  profileHeaderCopy: {
    flex: 1,
  },
  profileHeaderName: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  profileHeaderMeta: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 2,
  },
  organizerLogoPreview: {
    borderRadius: 12,
    height: 48,
    width: 48,
  },
  detailLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 2,
    textTransform: "uppercase",
  },
  detailValue: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "700",
    marginBottom: spacing.sm,
  },
  complexTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
    marginBottom: spacing.xs,
  },
  detailMeta: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  detailAddress: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  reportUserLink: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#E7F7EF",
    borderColor: "#B8E3CE",
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
  },
  reportUserLinkText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
  },
  inputGrid: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  inputGridItem: {
    flex: 1,
  },
  inputLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 4,
    textTransform: "uppercase",
  },
  adminInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
    marginBottom: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
  },
  adminTextArea: {
    minHeight: 92,
  },
  activityRow: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingVertical: spacing.sm,
  },
  activityHeaderRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  historyLink: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  historyLinkText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
  },
  activityTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 19,
    marginBottom: 2,
  },
  modalActions: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  compactButton: {
    marginBottom: 0,
    minHeight: 48,
    paddingVertical: 12,
  },
});

