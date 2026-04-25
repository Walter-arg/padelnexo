import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";

import AppButton from "../components/AppButton";
import AutocompleteField from "../components/AutocompleteField";
import AvailabilityEditor from "../components/AvailabilityEditor";
import AvailabilitySummary from "../components/AvailabilitySummary";
import BottomQuickActionsBar, {
  BOTTOM_QUICK_ACTIONS_SPACE,
} from "../components/BottomQuickActionsBar";
import FeedbackModal from "../components/FeedbackModal";
import SectionHeader from "../components/SectionHeader";
import TournamentHeaderCard from "../components/TournamentHeaderCard";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import { getAvailabilitySummaryItems } from "../services/availabilityService";
import { listPlayers } from "../services/playersService";
import {
  cancelTournament,
  closeTournamentRegistration,
  confirmTournamentRegistration,
  getTournamentById,
  listTournamentGroups,
  listTournamentMatches,
  listTournamentRegistrations,
  openTournamentRegistration,
  publishTournament,
  registerPairToTournament,
  reviewTournamentPayment,
  uploadTournamentPaymentReceipt,
} from "../services/tournamentsService";

const TAB_LABELS = {
  info: "Informacion",
  registration: "Inscripcion",
  participants: "Participantes",
  bracket: "Grupos / llaves",
  matches: "Partidos",
  management: "Gestion",
};

function normalizeText(value = "") {
  return String(value || "").trim().toLowerCase();
}

function formatMoney(value = 0) {
  return Number(value || 0).toLocaleString("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  });
}

function formatDateTime(value = 0) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatAvailabilitySummary(availability = {}) {
  const days = Object.entries(availability || {});

  if (!days.length) {
    return "Sin disponibilidad cargada";
  }

  return days
    .map(([dayKey, dayValue]) => {
      const label =
        dayKey === "monday"
          ? "Lunes"
          : dayKey === "tuesday"
          ? "Martes"
          : dayKey === "wednesday"
          ? "Miercoles"
          : dayKey === "thursday"
          ? "Jueves"
          : dayKey === "friday"
          ? "Viernes"
          : dayKey === "saturday"
          ? "Sabado"
          : "Domingo";
      const quick = Array.isArray(dayValue?.quickSlots) ? dayValue.quickSlots : [];
      const custom = Array.isArray(dayValue?.customSlots)
        ? dayValue.customSlots.map((slot) => `${slot.from} a ${slot.to}`)
        : [];

      return `${label}: ${[...quick, ...custom].join(" / ")}`;
    })
    .join(" · ");
}

function getUserTournamentRole({
  currentUserId,
  registrations,
  tournament,
}) {
  if (normalizeText(tournament?.organizerId) === normalizeText(currentUserId)) {
    return {
      role: "organizer",
      registration: registrations.find(
        (entry) =>
          normalizeText(entry.player1Id) === normalizeText(currentUserId) ||
          normalizeText(entry.player2Id) === normalizeText(currentUserId)
      ) || null,
    };
  }

  const registration =
    registrations.find(
      (entry) =>
        normalizeText(entry.player1Id) === normalizeText(currentUserId) ||
        normalizeText(entry.player2Id) === normalizeText(currentUserId)
    ) || null;

  if (!registration) {
    return {
      role: "guest",
      registration: null,
    };
  }

  return {
    role: registration.status === "confirmed" ? "confirmed_player" : "registered_player",
    registration,
  };
}

function getVisibleTabs(role = "guest") {
  if (role === "organizer") {
    return ["info", "registration", "participants", "bracket", "matches", "management"];
  }

  if (role === "confirmed_player") {
    return ["info", "registration", "participants", "bracket", "matches"];
  }

  if (role === "registered_player") {
    return ["info", "registration", "participants"];
  }

  return ["info", "registration"];
}

function getRegistrationStatusLabel(status = "") {
  if (status === "confirmed") {
    return "Confirmada";
  }

  if (status === "in_review") {
    return "En revision";
  }

  if (status === "rejected") {
    return "Rechazada";
  }

  return "Pendiente";
}

function getPaymentStatusLabel(status = "") {
  if (status === "approved") {
    return "Aprobado";
  }

  if (status === "in_review") {
    return "En revision";
  }

  if (status === "rejected") {
    return "Rechazado";
  }

  return "Pendiente";
}

function buildCurrentPlayerPayload(userData = {}) {
  return {
    userId: userData?.uid || "",
    playerId: userData?.uid || "",
    name: userData?.name || "Jugador",
    category: userData?.category || "",
    sex: userData?.sex || "Masculino",
  };
}

function buildPartnerLabel(player = {}) {
  return [player?.nombre || "", player?.apellido || ""].filter(Boolean).join(" ").trim();
}

function buildPartnerPayload(player = {}) {
  return {
    userId: player?.id || "",
    playerId: player?.id || "",
    name: buildPartnerLabel(player) || player?.nombre || "Jugador",
    category: player?.categoria || "",
    sex: player?.sexo || "Masculino",
  };
}

function InfoTab({ role, tournament, groups, matches, registrations }) {
  const summaryItems = [
    { label: "Formato", value: tournament?.tournamentFormat === "groups_knockout" ? "Zonas + llaves" : "A confirmar" },
    { label: "Categoria", value: tournament?.compositionConfig?.label || tournament?.compositionLabel || "A confirmar" },
    { label: "Inscripcion", value: Number(tournament?.entryFee || 0) > 0 ? formatMoney(tournament.entryFee) : "Sin cargo" },
    { label: "Confirmacion", value: tournament?.pairConfirmationMode === "both_paid" ? "Pagan ambos" : tournament?.pairConfirmationMode === "one_paid" ? "Paga uno" : "Manual" },
    { label: "Sedes", value: tournament?.venueMode === "multiple" ? "Multiples sedes" : "Sede unica" },
  ];

  if (role === "organizer") {
    summaryItems.push({
      label: "Cupos",
      value: `${registrations.length}/${tournament?.maxPairs || 0} parejas`,
    });
  }

  return (
    <View style={styles.tabBody}>
      {tournament?.description ? (
        <View style={styles.blockCard}>
          <Text style={styles.blockTitle}>Descripcion</Text>
          <Text style={styles.blockText}>{tournament.description}</Text>
        </View>
      ) : null}

      <View style={styles.metricsGrid}>
        {summaryItems.map((item) => (
          <View key={item.label} style={styles.metricCard}>
            <Text style={styles.metricLabel}>{item.label}</Text>
            <Text style={styles.metricValue}>{item.value}</Text>
          </View>
        ))}
      </View>

      <View style={styles.blockCard}>
        <Text style={styles.blockTitle}>Estado deportivo</Text>
        <Text style={styles.blockText}>
          {groups.length} grupo{groups.length === 1 ? "" : "s"} · {matches.length} partido
          {matches.length === 1 ? "" : "s"} generados
        </Text>
      </View>
    </View>
  );
}

function RegistrationTab({
  currentUser,
  onRegistrationCreated,
  registration,
  registrations,
  showFeedback,
  tournament,
}) {
  const [playersSource, setPlayersSource] = useState([]);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [partnerQuery, setPartnerQuery] = useState("");
  const [selectedPartner, setSelectedPartner] = useState(null);
  const [availability, setAvailability] = useState({});
  const [availabilityEditorVisible, setAvailabilityEditorVisible] = useState(false);
  const [receiptAsset, setReceiptAsset] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let isMounted = true;

    if (registration) {
      setAvailability(registration.availability || {});
      return () => {
        isMounted = false;
      };
    }

    const loadPlayersDirectory = async () => {
      try {
        setPlayersLoading(true);
        const players = await listPlayers();

        if (!isMounted) {
          return;
        }

        setPlayersSource(players);
      } catch (error) {
        if (isMounted) {
          setPlayersSource([]);
        }
      } finally {
        if (isMounted) {
          setPlayersLoading(false);
        }
      }
    };

    loadPlayersDirectory();

    return () => {
      isMounted = false;
    };
  }, [registration]);

  const availabilityItems = useMemo(
    () => getAvailabilitySummaryItems(availability || {}),
    [availability]
  );

  const occupiedPlayerIds = useMemo(() => {
    return new Set(
      registrations.flatMap((entry) => [entry.player1Id, entry.player2Id]).filter(Boolean)
    );
  }, [registrations]);

  const partnerSuggestions = useMemo(() => {
    const normalizedQuery = normalizeText(partnerQuery);

    return playersSource
      .filter((player) => normalizeText(player.id) !== normalizeText(currentUser?.uid))
      .filter((player) => !occupiedPlayerIds.has(player.id))
      .filter((player) => {
        if (!normalizedQuery) {
          return true;
        }

        const haystack = [
          player.nombre,
          player.apellido,
          player.categoria,
          player.ciudad,
        ]
          .map(normalizeText)
          .join(" ");

        return haystack.includes(normalizedQuery);
      })
      .slice(0, 8)
      .map((player) => ({
        label: `${player.categoria || "Categoria"} · ${player.ciudad || "Ciudad"}`,
        player,
        value: buildPartnerLabel(player) || player.nombre || "Jugador",
      }));
  }, [currentUser?.uid, occupiedPlayerIds, partnerQuery, playersSource]);

  const registrationSteps = useMemo(() => {
    return [
      {
        key: "partner",
        title: "Jugador 2",
        description: selectedPartner
          ? buildPartnerLabel(selectedPartner) || selectedPartner.nombre
          : "Selecciona companero",
        ready: Boolean(selectedPartner),
      },
      {
        key: "availability",
        title: "Disponibilidad",
        description: availabilityItems.length
          ? `${availabilityItems.length} dia${availabilityItems.length === 1 ? "" : "s"} cargado${availabilityItems.length === 1 ? "" : "s"}`
          : "Cargar horarios",
        ready: availabilityItems.length > 0,
      },
      {
        key: "receipt",
        title: "Comprobante",
        description:
          Number(tournament?.entryFee || 0) > 0 &&
          (tournament?.paymentMethods || []).includes("transferencia")
            ? receiptAsset?.uri
              ? "Adjuntado"
              : "Adjuntar archivo"
            : "No requerido",
        ready:
          !(
            Number(tournament?.entryFee || 0) > 0 &&
            (tournament?.paymentMethods || []).includes("transferencia")
          ) || Boolean(receiptAsset?.uri),
      },
      {
        key: "submit",
        title: "Solicitud",
        description: submitting ? "Enviando..." : "Enviar pareja",
        ready: Boolean(selectedPartner) && availabilityItems.length > 0,
      },
    ];
  }, [
    availabilityItems,
    receiptAsset?.uri,
    selectedPartner,
    submitting,
    tournament?.entryFee,
    tournament?.paymentMethods,
  ]);

  const handlePickReceipt = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (permission.status !== "granted") {
      showFeedback(
        "Permiso necesario",
        "Necesitamos acceso a tus fotos para adjuntar el comprobante.",
        "danger"
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });

    if (result.canceled) {
      return;
    }

    const asset = result.assets?.[0];

    if (!asset?.uri) {
      return;
    }

    setReceiptAsset({
      fileName: asset.fileName || `comprobante-${Date.now()}.jpg`,
      uri: asset.uri,
    });
  };

  const handleSubmitRegistration = async () => {
    if (!currentUser?.uid) {
      showFeedback(
        "Sesion requerida",
        "Necesitas iniciar sesion para inscribirte en un torneo.",
        "danger"
      );
      return;
    }

    if (!selectedPartner) {
      showFeedback(
        "Falta companero",
        "Selecciona un companero registrado para completar la pareja.",
        "danger"
      );
      return;
    }

    if (!availabilityItems.length) {
      showFeedback(
        "Falta disponibilidad",
        "Carga la disponibilidad de la pareja antes de enviar la solicitud.",
        "danger"
      );
      return;
    }

    try {
      setSubmitting(true);

      const createdRegistration = await registerPairToTournament(tournament.id, {
        availability,
        player1: buildCurrentPlayerPayload(currentUser),
        player2: buildPartnerPayload(selectedPartner),
      });

      if (receiptAsset?.uri && Number(tournament?.entryFee || 0) > 0) {
        await uploadTournamentPaymentReceipt({
          tournamentId: tournament.id,
          registrationId: createdRegistration.id,
          playerId: currentUser.uid,
          receiptUri: receiptAsset.uri,
          fileName: receiptAsset.fileName,
          method: "transferencia",
          uploadedBy: currentUser.uid,
          uploadedByName: currentUser.name || "Jugador",
        });
      }

      setPartnerQuery("");
      setSelectedPartner(null);
      setReceiptAsset(null);
      await onRegistrationCreated();

      showFeedback(
        "Inscripcion enviada",
        "La pareja ya quedo cargada en el torneo.",
        "success"
      );
    } catch (error) {
      showFeedback(
        "No pudimos registrar la pareja",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.tabBody}>
      {registration ? (
        <>
          <View style={styles.blockCard}>
            <Text style={styles.blockTitle}>Tu inscripcion</Text>
            <Text style={styles.blockText}>Pareja: {registration.pairLabel}</Text>
            <Text style={styles.blockText}>
              Estado: {getRegistrationStatusLabel(registration.status)}
            </Text>
            <Text style={styles.blockText}>
              Disponibilidad: {formatAvailabilitySummary(registration.availability)}
            </Text>
          </View>

          <View style={styles.blockCard}>
            <Text style={styles.blockTitle}>Pagos individuales</Text>
            {(registration.payments || []).map((payment) => (
              <View key={payment.playerId || payment.userId} style={styles.inlineRow}>
                <Text style={styles.inlineRowLabel}>{payment.playerName}</Text>
                <Text style={styles.inlineRowValue}>{getPaymentStatusLabel(payment.status)}</Text>
              </View>
            ))}
          </View>
        </>
      ) : (
        <>
          <View style={styles.blockCard}>
            <Text style={styles.blockTitleCentered}>INSCRIBIR PAREJA</Text>

            <View style={styles.registrationStepsGrid}>
              {registrationSteps.map((step) => (
                <View key={step.key} style={styles.registrationStepCard}>
                  <Text style={styles.registrationStepTitle}>{step.title}</Text>
                  <Text style={styles.registrationStepDescription}>{step.description}</Text>
                  <Text
                    style={[
                      styles.registrationStepStatus,
                      step.ready ? styles.registrationStepStatusReady : null,
                    ]}
                  >
                    {step.ready ? "Listo" : "Pendiente"}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.blockCard}>
            <Text style={styles.blockTitleCentered}>INSCRIBIR PAREJA</Text>

            <AutocompleteField
              label="Buscar jugador registrado"
              onChangeText={(value) => {
                setPartnerQuery(value);

                if (!value) {
                  setSelectedPartner(null);
                }
              }}
              onSelect={(item) => {
                setSelectedPartner(item.player);
                setPartnerQuery(item.value);
              }}
              placeholder="Nombre, categoria o ciudad"
              showSuggestions={!selectedPartner && partnerSuggestions.length > 0}
              suggestions={partnerSuggestions}
              value={partnerQuery}
            />

            {playersLoading ? (
              <Text style={styles.blockText}>Cargando jugadores registrados...</Text>
            ) : null}

            {selectedPartner ? (
              <View style={styles.selectedPartnerCard}>
                <View style={styles.selectedPartnerCopy}>
                  <Text style={styles.selectedPartnerTitle}>
                    {buildPartnerLabel(selectedPartner) || selectedPartner.nombre}
                  </Text>
                  <Text style={styles.selectedPartnerSubtitle}>
                    {selectedPartner.categoria} · {selectedPartner.ciudad}
                  </Text>
                </View>
                <Pressable
                  onPress={() => {
                    setSelectedPartner(null);
                    setPartnerQuery("");
                  }}
                >
                  <Text style={styles.selectedPartnerRemove}>Quitar</Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          <View style={styles.blockCard}>
            <Text style={styles.blockTitleCentered}>DISPONIBILIDAD DE LA PAREJA</Text>
            <Text style={styles.blockTextCentered}>
              Se guardan hasta 2 dias y hasta 2 franjas por dia para la etapa de zonas.
            </Text>
            <AvailabilitySummary items={availabilityItems} />
            <AppButton
              onPress={() => setAvailabilityEditorVisible(true)}
              style={styles.sectionButton}
              title={availabilityItems.length ? "EDITAR DISPONIBILIDAD" : "CARGAR DISPONIBILIDAD"}
              variant="secondary"
            />
          </View>

          {Number(tournament?.entryFee || 0) > 0 &&
          (tournament?.paymentMethods || []).includes("transferencia") ? (
            <View style={styles.blockCard}>
              <Text style={styles.blockTitleCentered}>COMPROBANTE DE PAGO</Text>
              <Text style={styles.blockTextCentered}>
                Alias: {tournament?.paymentAlias || "Alias a confirmar por organizador"}
              </Text>
              {receiptAsset?.uri ? (
                <View style={styles.receiptPreviewCard}>
                  <Image source={{ uri: receiptAsset.uri }} style={styles.receiptPreviewImage} />
                  <Text numberOfLines={1} style={styles.receiptPreviewName}>
                    {receiptAsset.fileName}
                  </Text>
                </View>
              ) : null}
              <AppButton
                onPress={handlePickReceipt}
                style={styles.sectionButton}
                title={receiptAsset?.uri ? "CAMBIAR COMPROBANTE" : "ADJUNTAR COMPROBANTE"}
                variant="secondary"
              />
            </View>
          ) : null}

          <AppButton
            disabled={submitting || !selectedPartner}
            onPress={handleSubmitRegistration}
            title={submitting ? "ENVIANDO..." : "FINALIZAR SOLICITUD"}
          />

          <AvailabilityEditor
            initialAvailability={availability}
            loading={false}
            onClose={() => setAvailabilityEditorVisible(false)}
            onSave={async (nextAvailability) => {
              setAvailability(nextAvailability);
              setAvailabilityEditorVisible(false);
            }}
            visible={availabilityEditorVisible}
          />
        </>
      )}
    </View>
  );
}

function ParticipantsTab({ registrations }) {
  return (
    <View style={styles.tabBody}>
      <View style={styles.blockCard}>
        <Text style={styles.blockTitle}>Parejas inscriptas</Text>
        {registrations.length ? (
          registrations.map((registration) => (
            <View key={registration.id} style={styles.listRow}>
              <View style={styles.listRowMain}>
                <Text style={styles.listRowTitle}>{registration.pairLabel}</Text>
                <Text style={styles.listRowSubtext}>
                  {formatAvailabilitySummary(registration.availability)}
                </Text>
              </View>
              <Text style={styles.listRowBadge}>
                {getRegistrationStatusLabel(registration.status)}
              </Text>
            </View>
          ))
        ) : (
          <Text style={styles.blockText}>Todavia no hay parejas inscriptas.</Text>
        )}
      </View>
    </View>
  );
}

function BracketTab({ groups }) {
  return (
    <View style={styles.tabBody}>
      {groups.length ? (
        groups.map((group) => (
          <View key={group.id} style={styles.blockCard}>
            <Text style={styles.blockTitle}>Grupo {group.name}</Text>
            <Text style={styles.blockText}>
              {group.size} parejas · clasifican {group.qualifiedCount}
            </Text>
            {(group.standings || []).map((row) => (
              <View key={row.pairId} style={styles.inlineRow}>
                <Text style={styles.inlineRowLabel}>
                  {row.position}. {row.pairLabel}
                </Text>
                <Text style={styles.inlineRowValue}>
                  {row.qualified ? "Clasifica" : "Eliminado"}
                </Text>
              </View>
            ))}
          </View>
        ))
      ) : (
        <View style={styles.blockCard}>
          <Text style={styles.blockTitle}>Grupos / llaves</Text>
          <Text style={styles.blockText}>
            Aun no hay armado confirmado para este torneo.
          </Text>
        </View>
      )}
    </View>
  );
}

function MatchesTab({ matches }) {
  const sortedMatches = [...matches].sort((first, second) => {
    if (first.stage !== second.stage) {
      return String(first.stage).localeCompare(String(second.stage), "es");
    }

    if (Number(first.roundOrder || 0) !== Number(second.roundOrder || 0)) {
      return Number(first.roundOrder || 0) - Number(second.roundOrder || 0);
    }

    return Number(first.matchOrder || 0) - Number(second.matchOrder || 0);
  });

  return (
    <View style={styles.tabBody}>
      {sortedMatches.length ? (
        sortedMatches.map((match) => (
          <View key={match.id} style={styles.blockCard}>
            <Text style={styles.blockTitle}>
              {match.stage === "groups"
                ? `Grupo ${match.groupId || ""}`
                : String(match.stage || "Partido").toUpperCase()}
            </Text>
            <Text style={styles.blockText}>
              {match.sideALabel || "Pendiente"} vs {match.sideBLabel || "Pendiente"}
            </Text>
            <Text style={styles.blockText}>
              Estado: {match.status === "completed" ? "Jugado" : match.status === "scheduled" ? "Programado" : "Pendiente"}
            </Text>
            {match.scoreText ? (
              <Text style={styles.blockText}>Resultado: {match.scoreText}</Text>
            ) : null}
          </View>
        ))
      ) : (
        <View style={styles.blockCard}>
          <Text style={styles.blockTitle}>Partidos</Text>
          <Text style={styles.blockText}>Todavia no hay partidos generados.</Text>
        </View>
      )}
    </View>
  );
}

function ManagementTab({
  currentUser,
  onActionCompleted,
  registrations,
  showFeedback,
  tournament,
  groups,
  matches,
}) {
  const [actionLoadingKey, setActionLoadingKey] = useState("");
  const paymentsToReview = registrations.reduce((total, registration) => {
    return (
      total +
      (registration.payments || []).filter((payment) => payment.status === "in_review").length
    );
  }, 0);

  const pendingConfirmations = registrations.filter(
    (registration) => registration.status === "pending" || registration.status === "in_review"
  ).length;

  const actionItems = [
    {
      title: "Publicar y abrir inscripcion",
      text:
        tournament.status === "draft"
          ? "El torneo sigue en borrador."
          : `Estado actual: ${tournament.status}.`,
    },
    {
      title: "Pagos a revisar",
      text: `${paymentsToReview} comprobante${paymentsToReview === 1 ? "" : "s"} en revision.`,
    },
    {
      title: "Parejas por confirmar",
      text: `${pendingConfirmations} pareja${pendingConfirmations === 1 ? "" : "s"} esperando definicion.`,
    },
    {
      title: "Armado deportivo",
      text: `${groups.length} grupo${groups.length === 1 ? "" : "s"} y ${matches.length} partido${matches.length === 1 ? "" : "s"} cargados.`,
    },
  ];

  const runAction = async (key, action, successMessage) => {
    try {
      setActionLoadingKey(key);
      await action();
      await onActionCompleted();
      showFeedback("Cambios guardados", successMessage, "success");
    } catch (error) {
      showFeedback(
        "No pudimos guardar el cambio",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setActionLoadingKey("");
    }
  };

  const handleOpenReceipt = async (url) => {
    if (!url) {
      return;
    }

    try {
      await Linking.openURL(url);
    } catch (error) {
      showFeedback(
        "No pudimos abrir el comprobante",
        "Revisa la conexion o intenta nuevamente en unos instantes.",
        "danger"
      );
    }
  };

  const actionButtons = [
    tournament.status === "draft"
      ? {
          key: "publish",
          title: "Publicar torneo",
          onPress: () =>
            runAction(
              "publish",
              () => publishTournament(tournament.id),
              "El torneo ya quedo publicado."
            ),
        }
      : null,
    tournament.status === "published" || tournament.status === "registration_closed"
      ? {
          key: "open-registration",
          title: "Abrir inscripcion",
          onPress: () =>
            runAction(
              "open-registration",
              () => openTournamentRegistration(tournament.id),
              "La inscripcion ya quedo abierta."
            ),
        }
      : null,
    tournament.status === "registration_open"
      ? {
          key: "close-registration",
          title: "Cerrar inscripcion",
          onPress: () =>
            runAction(
              "close-registration",
              () => closeTournamentRegistration(tournament.id),
              "La inscripcion ya quedo cerrada."
            ),
        }
      : null,
    tournament.status !== "cancelled" && tournament.status !== "finished"
      ? {
          key: "cancel-tournament",
          title: "Cancelar torneo",
          variant: "danger",
          onPress: () =>
            runAction(
              "cancel-tournament",
              () =>
                cancelTournament({
                  tournamentId: tournament.id,
                  reason: "Cancelado por el organizador",
                  organizerId: currentUser?.uid || "",
                  organizerName: currentUser?.name || "Organizador",
                }),
              "El torneo ya quedo cancelado."
            ),
        }
      : null,
  ].filter(Boolean);

  return (
    <View style={styles.tabBody}>
      <View style={styles.blockCard}>
        <Text style={styles.blockTitle}>Acciones del torneo</Text>
        <View style={styles.managementButtonsWrap}>
          {actionButtons.length ? (
            actionButtons.map((button) => (
              <AppButton
                key={button.key}
                disabled={Boolean(actionLoadingKey)}
                onPress={button.onPress}
                style={styles.managementButton}
                textStyle={button.variant === "danger" ? styles.dangerButtonText : null}
                title={actionLoadingKey === button.key ? "Guardando..." : button.title}
                variant={
                  button.key === "close-registration" || button.variant === "danger"
                    ? "secondary"
                    : "primary"
                }
              />
            ))
          ) : (
            <Text style={styles.blockText}>
              No hay acciones inmediatas pendientes para este estado del torneo.
            </Text>
          )}
        </View>
      </View>

      {actionItems.map((item) => (
        <View key={item.title} style={styles.blockCard}>
          <Text style={styles.blockTitle}>{item.title}</Text>
          <Text style={styles.blockText}>{item.text}</Text>
        </View>
      ))}

      <View style={styles.blockCard}>
        <Text style={styles.blockTitle}>Inscripciones y pagos</Text>
        {registrations.length ? (
          registrations.map((registration) => {
            const canForceConfirm = tournament?.pairConfirmationMode === "manual";

            return (
              <View key={registration.id} style={styles.managementRegistrationCard}>
                <View style={styles.managementRegistrationHeader}>
                  <View style={styles.managementRegistrationMain}>
                    <Text style={styles.managementRegistrationTitle}>{registration.pairLabel}</Text>
                    <Text style={styles.managementRegistrationMeta}>
                      Estado: {getRegistrationStatusLabel(registration.status)}
                    </Text>
                  </View>
                  <AppButton
                    disabled={Boolean(actionLoadingKey)}
                    onPress={() =>
                      runAction(
                        `confirm-${registration.id}`,
                        () =>
                          confirmTournamentRegistration({
                            tournamentId: tournament.id,
                            registrationId: registration.id,
                            organizerId: currentUser?.uid || "",
                            organizerName: currentUser?.name || "Organizador",
                            force: canForceConfirm,
                          }),
                        "La pareja ya quedo confirmada."
                      )
                    }
                    style={styles.confirmButton}
                    title={
                      actionLoadingKey === `confirm-${registration.id}`
                        ? "Confirmando..."
                        : "Confirmar pareja"
                    }
                    variant="secondary"
                  />
                </View>

                {(registration.payments || []).map((payment) => (
                  <View key={payment.playerId || payment.userId} style={styles.paymentReviewCard}>
                    <View style={styles.paymentReviewCopy}>
                      <Text style={styles.paymentReviewTitle}>{payment.playerName}</Text>
                      <Text style={styles.paymentReviewMeta}>
                        Estado: {getPaymentStatusLabel(payment.status)}
                      </Text>
                    </View>

                    <View style={styles.paymentReviewActions}>
                      {payment.receiptUrl ? (
                        <Pressable
                          onPress={() => handleOpenReceipt(payment.receiptUrl)}
                          style={styles.inlineActionButton}
                        >
                          <Text style={styles.inlineActionButtonText}>Ver comprobante</Text>
                        </Pressable>
                      ) : null}

                      {payment.status === "in_review" ? (
                        <>
                          <Pressable
                            onPress={() =>
                              runAction(
                                `approve-${registration.id}-${payment.playerId || payment.userId}`,
                                () =>
                                  reviewTournamentPayment({
                                    tournamentId: tournament.id,
                                    registrationId: registration.id,
                                    playerId: payment.playerId || payment.userId,
                                    reviewerId: currentUser?.uid || "",
                                    reviewerName: currentUser?.name || "Organizador",
                                    approved: true,
                                  }),
                                "El pago fue aprobado."
                              )
                            }
                            style={[styles.inlineActionButton, styles.inlineApproveButton]}
                          >
                            <Text
                              style={[
                                styles.inlineActionButtonText,
                                styles.inlineApproveButtonText,
                              ]}
                            >
                              Aprobar
                            </Text>
                          </Pressable>
                          <Pressable
                            onPress={() =>
                              runAction(
                                `reject-${registration.id}-${payment.playerId || payment.userId}`,
                                () =>
                                  reviewTournamentPayment({
                                    tournamentId: tournament.id,
                                    registrationId: registration.id,
                                    playerId: payment.playerId || payment.userId,
                                    reviewerId: currentUser?.uid || "",
                                    reviewerName: currentUser?.name || "Organizador",
                                    approved: false,
                                  }),
                                "El pago fue rechazado."
                              )
                            }
                            style={[styles.inlineActionButton, styles.inlineRejectButton]}
                          >
                            <Text
                              style={[
                                styles.inlineActionButtonText,
                                styles.inlineRejectButtonText,
                              ]}
                            >
                              Rechazar
                            </Text>
                          </Pressable>
                        </>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            );
          })
        ) : (
          <Text style={styles.blockText}>Todavia no hay parejas inscriptas para gestionar.</Text>
        )}
      </View>

      <View style={styles.noticeCard}>
        <Ionicons color={colors.primaryDark} name="construct-outline" size={18} />
        <Text style={styles.noticeText}>
          La edicion completa del torneo y la cancelacion formal las dejamos como siguiente capa, para no mezclar esta fase con el flujo deportivo.
        </Text>
      </View>
    </View>
  );
}

export default function TournamentDetailScreen({ navigation, route }) {
  const { userData } = useAuth();
  const tournamentId = route?.params?.tournamentId || "";
  const [tournament, setTournament] = useState(null);
  const [registrations, setRegistrations] = useState([]);
  const [groups, setGroups] = useState([]);
  const [matches, setMatches] = useState([]);
  const [activeTab, setActiveTab] = useState("info");
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState({
    visible: false,
    title: "",
    message: "",
    tone: "default",
  });

  const loadTournamentDetail = useCallback(async () => {
    const [tournamentResponse, registrationsResponse, groupsResponse, matchesResponse] =
      await Promise.all([
        getTournamentById(tournamentId),
        listTournamentRegistrations(tournamentId),
        listTournamentGroups(tournamentId),
        listTournamentMatches(tournamentId),
      ]);

    setTournament(tournamentResponse);
    setRegistrations(registrationsResponse);
    setGroups(groupsResponse);
    setMatches(matchesResponse);
  }, [tournamentId]);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      const syncTournamentDetail = async () => {
        try {
          setLoading(true);
          await loadTournamentDetail();

          if (!isMounted) {
            return;
          }
        } catch (error) {
          if (!isMounted) {
            return;
          }

          setFeedback({
            visible: true,
            title: "No pudimos cargar el torneo",
            message: error?.message || "Intenta nuevamente en unos instantes.",
            tone: "danger",
          });
        } finally {
          if (isMounted) {
            setLoading(false);
          }
        }
      };

      syncTournamentDetail();

      return () => {
        isMounted = false;
      };
    }, [loadTournamentDetail])
  );

  const accessMeta = useMemo(
    () =>
      getUserTournamentRole({
        currentUserId: userData?.uid || "",
        registrations,
        tournament,
      }),
    [registrations, tournament, userData?.uid]
  );

  const visibleTabs = useMemo(() => getVisibleTabs(accessMeta.role), [accessMeta.role]);

  useEffect(() => {
    if (!visibleTabs.includes(activeTab)) {
      setActiveTab(visibleTabs[0] || "info");
    }
  }, [activeTab, visibleTabs]);

  const renderTabContent = () => {
    if (!tournament) {
      return null;
    }

    if (activeTab === "info") {
      return (
        <InfoTab
          groups={groups}
          matches={matches}
          registrations={registrations}
          role={accessMeta.role}
          tournament={tournament}
        />
      );
    }

    if (activeTab === "registration") {
      return (
        <RegistrationTab
          currentUser={userData}
          onRegistrationCreated={loadTournamentDetail}
          registration={accessMeta.registration}
          registrations={registrations}
          showFeedback={(title, message, tone = "default") =>
            setFeedback({
              visible: true,
              title,
              message,
              tone,
            })
          }
          tournament={tournament}
        />
      );
    }

    if (activeTab === "participants") {
      return <ParticipantsTab registrations={registrations} />;
    }

    if (activeTab === "bracket") {
      return <BracketTab groups={groups} />;
    }

    if (activeTab === "matches") {
      return <MatchesTab matches={matches} />;
    }

    if (activeTab === "management") {
      return (
        <ManagementTab
          currentUser={userData}
          groups={groups}
          matches={matches}
          onActionCompleted={loadTournamentDetail}
          registrations={registrations}
          showFeedback={(title, message, tone = "default") =>
            setFeedback({
              visible: true,
              title,
              message,
              tone,
            })
          }
          tournament={tournament}
        />
      );
    }

    return null;
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader onBack={() => navigation.goBack()} subtitle="Detalle torneo" />

      <View style={styles.container}>
        {loading ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator color={colors.primaryDark} />
            <Text style={styles.loaderText}>Cargando torneo...</Text>
          </View>
        ) : tournament ? (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <TournamentHeaderCard
              category={tournament?.compositionConfig?.label || tournament?.compositionLabel || ""}
              status={tournament?.status}
              subtitle={
                accessMeta.role === "organizer"
                  ? "Vista del organizador"
                  : accessMeta.role === "confirmed_player"
                  ? "Vista del jugador confirmado"
                  : accessMeta.role === "registered_player"
                  ? "Vista de inscripcion"
                  : "Vista publica"
              }
              title={tournament?.name || "Torneo"}
              venue={tournament?.venueLabel || ""}
            >
              <Text style={styles.headerSubline}>
                {tournament?.organizerName || "Organizador"} · {formatDateTime(tournament?.createdAtMillis)}
              </Text>
            </TournamentHeaderCard>

            <ScrollView
              contentContainerStyle={styles.tabsRow}
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {visibleTabs.map((tabKey) => {
                const isActive = tabKey === activeTab;

                return (
                  <Pressable
                    key={tabKey}
                    onPress={() => setActiveTab(tabKey)}
                    style={[styles.tabButton, isActive && styles.tabButtonActive]}
                  >
                    <Text style={[styles.tabButtonText, isActive && styles.tabButtonTextActive]}>
                      {TAB_LABELS[tabKey]}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {renderTabContent()}
          </ScrollView>
        ) : (
          <View style={styles.loaderWrap}>
            <Text style={styles.loaderText}>No encontramos el torneo.</Text>
          </View>
        )}
      </View>

      <FeedbackModal
        message={feedback.message}
        onClose={() => setFeedback((current) => ({ ...current, visible: false }))}
        tone={feedback.tone}
        title={feedback.title}
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
  },
  scrollContent: {
    paddingBottom: spacing.lg + BOTTOM_QUICK_ACTIONS_SPACE,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  loaderWrap: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  loaderText: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: "700",
    marginTop: spacing.sm,
    textAlign: "center",
  },
  headerSubline: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 6,
    textAlign: "center",
  },
  tabsRow: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
    paddingTop: spacing.md,
  },
  tabButton: {
    backgroundColor: "#EFF6F2",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: spacing.md,
  },
  tabButtonActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  tabButtonText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  tabButtonTextActive: {
    color: colors.surface,
  },
  tabBody: {
    gap: spacing.md,
  },
  blockCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    padding: spacing.md,
  },
  blockTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  blockText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 21,
    marginTop: 6,
  },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  metricCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: "47%",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  metricLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  metricValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 4,
  },
  blockTitleCentered: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "uppercase",
  },
  blockTextCentered: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 21,
    marginTop: 6,
    textAlign: "center",
  },
  sectionButton: {
    marginBottom: 0,
    marginTop: spacing.md,
  },
  registrationStepsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  registrationStepCard: {
    backgroundColor: "#F5FAF7",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: "47%",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  registrationStepTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
    textTransform: "uppercase",
  },
  registrationStepDescription: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 18,
    marginTop: 4,
    textAlign: "center",
  },
  registrationStepStatus: {
    color: "#A36C17",
    fontSize: 11,
    fontWeight: "800",
    marginTop: spacing.sm,
    textAlign: "center",
    textTransform: "uppercase",
  },
  registrationStepStatusReady: {
    color: colors.primaryDark,
  },
  managementButtonsWrap: {
    marginTop: spacing.sm,
  },
  managementButton: {
    marginBottom: spacing.sm,
  },
  dangerButtonText: {
    color: colors.danger,
  },
  managementRegistrationCard: {
    backgroundColor: "#F6FBF8",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  managementRegistrationHeader: {
    gap: spacing.sm,
  },
  managementRegistrationMain: {
    flex: 1,
  },
  managementRegistrationTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  managementRegistrationMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  confirmButton: {
    marginBottom: 0,
  },
  paymentReviewCard: {
    backgroundColor: colors.surface,
    borderColor: "#E8EEF1",
    borderRadius: 8,
    borderWidth: 1,
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  paymentReviewCopy: {
    marginBottom: spacing.xs,
  },
  paymentReviewTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  paymentReviewMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
  paymentReviewActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  inlineActionButton: {
    alignItems: "center",
    backgroundColor: "#F2F5F7",
    borderColor: "#D4DBE2",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 30,
    paddingHorizontal: 10,
  },
  inlineActionButtonText: {
    color: "#5E6C78",
    fontSize: 11,
    fontWeight: "800",
  },
  inlineApproveButton: {
    backgroundColor: "#EEF9F1",
    borderColor: "#B7DFBF",
  },
  inlineApproveButtonText: {
    color: "#237547",
  },
  inlineRejectButton: {
    backgroundColor: "#FFF0F0",
    borderColor: "#E7B8B8",
  },
  inlineRejectButtonText: {
    color: "#B24343",
  },
  inlineRow: {
    alignItems: "center",
    borderTopColor: "#EEF2F4",
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
  },
  inlineRowLabel: {
    color: colors.text,
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    marginRight: spacing.sm,
  },
  inlineRowValue: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
  },
  listRow: {
    borderTopColor: "#EEF2F4",
    borderTopWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
  },
  listRowMain: {
    flex: 1,
    marginRight: spacing.sm,
  },
  listRowTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  listRowSubtext: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 18,
    marginTop: 4,
  },
  listRowBadge: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
  },
  noticeCard: {
    alignItems: "flex-start",
    backgroundColor: "#EFF8F4",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    padding: spacing.md,
  },
  noticeText: {
    color: colors.text,
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 20,
    marginLeft: spacing.sm,
  },
  selectedPartnerCard: {
    alignItems: "center",
    backgroundColor: "#EFF8F4",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  selectedPartnerCopy: {
    flex: 1,
    marginRight: spacing.sm,
  },
  selectedPartnerTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  selectedPartnerSubtitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
  selectedPartnerRemove: {
    color: "#B44B4B",
    fontSize: 12,
    fontWeight: "800",
  },
  receiptPreviewCard: {
    alignItems: "center",
    backgroundColor: "#F5FAF7",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  receiptPreviewImage: {
    borderRadius: 8,
    height: 150,
    resizeMode: "cover",
    width: "100%",
  },
  receiptPreviewName: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700",
    marginTop: spacing.sm,
  },
});

