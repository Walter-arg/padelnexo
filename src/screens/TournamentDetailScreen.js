import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
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
import { normalizeMercadoPagoConfig } from "../services/mercadoPagoConfigService";
import { listPlayers } from "../services/playersService";
import {
  buildTournamentDayOptions,
  formatTournamentAvailabilitySummary,
  getTournamentAvailabilitySummaryItems,
} from "../services/tournamentAvailabilityService";
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
  updateTournament,
} from "../services/tournamentsService";

const TAB_LABELS = {
  registration: "Inscripcion",
  fixture: "Fixture",
  payments: "Pagos",
  management: "Gestion",
};

const TAB_ICONS = {
  registration: "clipboard-outline",
  fixture: "grid-outline",
  payments: "card-outline",
  management: "settings-outline",
};

const ORGANIZER_AREA_KEYS = ["registration", "fixture", "payments", "management"];

const FIXTURE_MODE_OPTIONS = [
  { label: "Automatico", value: "automatic" },
  { label: "Semiautomatico", value: "semiautomatic" },
  { label: "Manual", value: "manual" },
];

const FIXTURE_PATH_OPTIONS = [
  {
    label: "A: ESTRICTO",
    value: "strict",
    description: "Menos cantidad de partidos, mas eliminados.",
  },
  {
    label: "B: FLEXIBILIDAD",
    value: "flex",
    description: "Menos eliminados directos y mas continuidad deportiva.",
  },
];

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

async function handleOpenTournamentPoster(navigation, tournament = {}) {
  const posterUrl = tournament?.coverImage || "";
  if (!posterUrl) {
    return;
  }

  navigation.navigate("TournamentPosterViewer", {
    posterUrl,
    tournamentId: tournament?.id || "",
    tournamentName: tournament?.name || "Torneo",
    organizerId: tournament?.organizerId || tournament?.createdBy || "",
    organizerName: tournament?.organizerName || tournament?.createdByName || "",
  });
}

function formatAvailabilitySummary(availability = {}, tournamentDayOptions = []) {
  if (!Array.isArray(tournamentDayOptions) || tournamentDayOptions.length === 0) {
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

  return formatTournamentAvailabilitySummary(availability, tournamentDayOptions);
}

function getWeeklyAvailabilitySummaryItems(availability = {}) {
  const dayLabels = {
    monday: { full: "Lunes", short: "Lun" },
    tuesday: { full: "Martes", short: "Mar" },
    wednesday: { full: "Miercoles", short: "Mie" },
    thursday: { full: "Jueves", short: "Jue" },
    friday: { full: "Viernes", short: "Vie" },
    saturday: { full: "Sabado", short: "Sab" },
    sunday: { full: "Domingo", short: "Dom" },
  };
  const quickSlotLabels = {
    morning: "Manana",
    afternoon: "Tarde",
    night: "Noche",
    late_night: "Madrugada",
  };

  return Object.entries(availability || {})
    .map(([dayKey, dayValue]) => {
      const dayMeta = dayLabels[dayKey];

      if (!dayMeta) {
        return null;
      }

      const quickLabels = (Array.isArray(dayValue?.quickSlots) ? dayValue.quickSlots : [])
        .map((slotKey) => quickSlotLabels[slotKey] || "")
        .filter(Boolean);
      const customLabels = (Array.isArray(dayValue?.customSlots) ? dayValue.customSlots : [])
        .map((slot) => `${slot.from} a ${slot.to}`)
        .filter(Boolean);
      const text = [...quickLabels, ...customLabels].join(" y ");

      if (!text) {
        return null;
      }

      return {
        key: dayKey,
        dayLabel: dayMeta.full,
        dayShortLabel: dayMeta.short,
        text,
        label: `${dayMeta.short} · ${text}`,
      };
    })
    .filter(Boolean);
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
    return ["management"];
  }

  if (role === "confirmed_player") {
    return ["registration", "fixture"];
  }

  if (role === "registered_player") {
    return ["registration"];
  }

  return ["fixture"];
}

function resolveTournamentTab(tabKey = "") {
  if (
    tabKey === "bracket" ||
    tabKey === "matches" ||
    tabKey === "info" ||
    tabKey === "participants"
  ) {
    return "fixture";
  }

  return tabKey || "fixture";
}

function resolveOrganizerLastArea(areaKey = "") {
  return ORGANIZER_AREA_KEYS.includes(areaKey) ? areaKey : "management";
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

function isRegistrationConfirmed(registration = {}) {
  return (
    registration?.status === "confirmed" &&
    registration?.withdrawalStatus !== "confirmed"
  );
}

function getOrdinalLabel(value = 0) {
  const parsedValue = Number(value || 0);

  if (parsedValue === 1) {
    return "1ros";
  }

  if (parsedValue === 2) {
    return "2dos";
  }

  if (parsedValue === 3) {
    return "3ros";
  }

  return `${parsedValue}ros`;
}

function formatZoneLabel(zoneSizes = []) {
  if (!Array.isArray(zoneSizes) || !zoneSizes.length) {
    return "Sin recomendacion disponible";
  }

  return zoneSizes.map((size) => `Zona de ${size}`).join(" + ");
}

function buildRecommendedZoneNames(zoneSizes = []) {
  return zoneSizes.map((size, index) => ({
    key: `zone-${index + 1}`,
    name: `Zona ${String.fromCharCode(65 + index)}`,
    size,
  }));
}

function resolveFixtureRecommendation(pairCount = 0, pathType = "strict") {
  const path = pathType === "flex" ? "flex" : "strict";
  const totalPairs = Number(pairCount || 0);

  if (totalPairs < 6) {
    return {
      zoneSizes: [],
      qualifiedSummary: "Todavia no hay suficientes parejas confirmadas para recomendar zonas.",
      bracketSummary: "Se necesitan al menos 6 parejas confirmadas.",
      note: "Completa el cupo minimo antes de crear el fixture.",
    };
  }

  const presets = {
    6: {
      strict: {
        zoneSizes: [3, 3],
        qualifiedSummary: "Clasifican 2 por zona.",
        bracketSummary: "Semifinales directas.",
      },
      flex: {
        zoneSizes: [3, 3],
        qualifiedSummary: "Clasifican 2 por zona.",
        bracketSummary: "Semifinales directas.",
      },
    },
    7: {
      strict: {
        zoneSizes: [4, 3],
        qualifiedSummary: "Clasifican 2 por zona.",
        bracketSummary: "Semifinales directas.",
      },
      flex: {
        zoneSizes: [4, 3],
        qualifiedSummary: "Clasifican 2 en la zona de 3 y 3 en la zona de 4.",
        bracketSummary: "Llave larga con bye para las mejores ubicadas.",
      },
    },
    8: {
      strict: {
        zoneSizes: [4, 4],
        qualifiedSummary: "Clasifican 2 por zona.",
        bracketSummary: "Semifinales directas.",
      },
      flex: {
        zoneSizes: [3, 3, 2],
        qualifiedSummary: "Clasifican 2 por zona.",
        bracketSummary: "Los 2 mejores 1ros avanzan a semifinales y las otras 4 parejas juegan cuartos.",
      },
    },
    9: {
      strict: {
        zoneSizes: [3, 3, 3],
        qualifiedSummary: "Clasifican 2 por zona.",
        bracketSummary: "Los 2 mejores 1ros avanzan a semifinales y las otras 4 parejas juegan cuartos.",
      },
      flex: {
        zoneSizes: [3, 3, 3],
        qualifiedSummary: "Clasifican 2 por zona.",
        bracketSummary: "Llave de 8 con bye para las mejores ubicadas.",
      },
    },
    10: {
      strict: {
        zoneSizes: [3, 3, 4],
        qualifiedSummary: "Clasifican 2 por zona.",
        bracketSummary: "Los 2 mejores 1ros avanzan a semifinales y las otras 4 parejas juegan cuartos.",
      },
      flex: {
        zoneSizes: [3, 3, 4],
        qualifiedSummary: "Clasifican 2 en las zonas de 3 y 3 en la zona de 4.",
        bracketSummary: "Llave de 8 con 1 bye para la mejor ubicada.",
      },
    },
    11: {
      strict: {
        zoneSizes: [3, 3, 3, 2],
        qualifiedSummary: "Clasifican 2 por zona. En la zona de 2 ambas parejas clasifican y el partido define 1ro y 2do.",
        bracketSummary: "Cuartos de final.",
      },
      flex: {
        zoneSizes: [3, 3, 3, 2],
        qualifiedSummary: "Clasifican 2 por zona. En la zona de 2 ambas parejas clasifican y el partido define 1ro y 2do.",
        bracketSummary: "Cuartos de final.",
      },
    },
    12: {
      strict: {
        zoneSizes: [3, 3, 3, 3],
        qualifiedSummary: "Clasifican 2 por zona.",
        bracketSummary: "Cuartos de final.",
      },
      flex: {
        zoneSizes: [3, 3, 3, 3],
        qualifiedSummary: "Clasifican 2 por zona.",
        bracketSummary: "Cuartos de final.",
      },
    },
    13: {
      strict: {
        zoneSizes: [3, 3, 3, 4],
        qualifiedSummary: "Clasifican 2 por zona.",
        bracketSummary: "Cuartos de final.",
      },
      flex: {
        zoneSizes: [3, 3, 3, 4],
        qualifiedSummary: "Clasifican 2 en las zonas de 3 y 3 en la zona de 4.",
        bracketSummary: "Llave de 16 con bye.",
      },
    },
    14: {
      strict: {
        zoneSizes: [3, 3, 4, 4],
        qualifiedSummary: "Clasifican 2 por zona.",
        bracketSummary: "Cuartos de final.",
      },
      flex: {
        zoneSizes: [3, 3, 4, 4],
        qualifiedSummary: "Clasifican 2 en las zonas de 3 y 3 en las zonas de 4.",
        bracketSummary: "Llave de 16 con bye.",
      },
    },
    15: {
      strict: {
        zoneSizes: [3, 3, 3, 3, 3],
        qualifiedSummary: "Clasifican los 5 1ros y los 3 mejores 2dos.",
        bracketSummary: "Cuartos de final.",
      },
      flex: {
        zoneSizes: [3, 3, 3, 3, 3],
        qualifiedSummary: "Clasifican 2 por zona.",
        bracketSummary: "Llave de 16 con bye.",
      },
    },
    16: {
      strict: {
        zoneSizes: [3, 3, 3, 3, 4],
        qualifiedSummary: "Clasifican los 5 1ros y los 3 mejores 2dos.",
        bracketSummary: "Cuartos de final.",
      },
      flex: {
        zoneSizes: [3, 3, 3, 3, 4],
        qualifiedSummary: "Clasifican 2 en las zonas de 3 y 3 en la zona de 4.",
        bracketSummary: "Llave de 16 con bye.",
      },
    },
  };

  const selectedPreset = presets[totalPairs]?.[path];

  if (selectedPreset) {
    return {
      ...selectedPreset,
      note:
        path === "strict"
          ? "Prioriza menos cruces y una salida mas directa del torneo."
          : "Prioriza que mas parejas sigan en competencia usando bye cuando haga falta.",
    };
  }

  const zoneSizes = [];
  let remainingPairs = totalPairs;

  while (remainingPairs > 0) {
    if (remainingPairs === 4 || remainingPairs === 2) {
      zoneSizes.push(remainingPairs);
      remainingPairs = 0;
      continue;
    }

    if (remainingPairs % 3 === 0 || remainingPairs > 4) {
      zoneSizes.push(3);
      remainingPairs -= 3;
      continue;
    }

    zoneSizes.push(remainingPairs);
    remainingPairs = 0;
  }

  const zoneCount = zoneSizes.length;
  const strictQualified = Math.min(8, zoneCount);
  const flexQualified = Math.min(16, zoneCount * 2);

  return {
    zoneSizes,
    qualifiedSummary:
      path === "strict"
        ? `Clasifican ${strictQualified} parejas priorizando 1ros de zona y mejores ubicadas.`
        : `Clasifican hasta ${flexQualified} parejas priorizando 1ros, 2dos y bye cuando corresponda.`,
    bracketSummary:
      path === "strict"
        ? "Se recomienda una llave corta con prioridad para las mejores posiciones."
        : "Se recomienda una llave larga con bye segun la cantidad de clasificadas.",
    note:
      path === "strict"
        ? "La app prioriza zonas de 3, luego una de 4 y solo en ultimo recurso una de 2."
        : "La app prioriza que menos parejas queden eliminadas en la primera parte del torneo.",
  };
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
  tournamentDayOptions,
  tournament,
}) {
  const [playersSource, setPlayersSource] = useState([]);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [activePanel, setActivePanel] = useState("partner");
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
    () =>
      Array.isArray(tournamentDayOptions) && tournamentDayOptions.length > 0
        ? getTournamentAvailabilitySummaryItems(availability || {}, tournamentDayOptions)
        : getWeeklyAvailabilitySummaryItems(availability || {}),
    [availability, tournamentDayOptions]
  );
  const tournamentMercadoPagoConfig = useMemo(
    () => normalizeMercadoPagoConfig(tournament?.mercadoPagoConfig),
    [tournament?.mercadoPagoConfig]
  );
  const tournamentMercadoPagoEnabled = useMemo(
    () =>
      tournamentMercadoPagoConfig.enabled === true &&
      tournamentMercadoPagoConfig.categories?.torneos !== false,
    [tournamentMercadoPagoConfig]
  );
  const requiresTransferReceipt =
    Number(tournament?.entryFee || 0) > 0 &&
    (tournament?.paymentMethods || []).includes("transferencia") &&
    !tournamentMercadoPagoEnabled;

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
        title: "Mi companero",
        description: selectedPartner
          ? buildPartnerLabel(selectedPartner) || selectedPartner.nombre
          : "Opcional",
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
        key: "payments",
        title: "Pagos",
        description: tournamentMercadoPagoEnabled
          ? "Mercado Pago habilitado"
          : requiresTransferReceipt
          ? receiptAsset?.uri
            ? "Comprobante adjunto"
            : "Adjuntar comprobante"
          : "No requerido",
        ready: !requiresTransferReceipt || Boolean(receiptAsset?.uri),
      },
    ];
  }, [
    availabilityItems,
    receiptAsset?.uri,
    requiresTransferReceipt,
    selectedPartner,
    tournamentMercadoPagoEnabled,
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

    if (!availabilityItems.length) {
      showFeedback(
        "Falta disponibilidad",
        "Carga la disponibilidad antes de enviar la solicitud.",
        "danger"
      );
      return;
    }

    if (requiresTransferReceipt && !receiptAsset?.uri) {
      showFeedback(
        "Falta comprobante",
        "Adjunta el comprobante antes de enviar la solicitud.",
        "danger"
      );
      return;
    }

    try {
      setSubmitting(true);

      const createdRegistration = await registerPairToTournament(tournament.id, {
        availability,
        player1: buildCurrentPlayerPayload(currentUser),
        player2: selectedPartner ? buildPartnerPayload(selectedPartner) : null,
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
        selectedPartner
          ? "La pareja ya quedo cargada en el torneo."
          : "Tu solicitud individual ya quedo cargada en el torneo.",
        "success"
      );
    } catch (error) {
      showFeedback(
        "No pudimos registrar la solicitud",
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
            <Text style={styles.blockText}>
              {registration.player2Id
                ? `Pareja: ${registration.pairLabel}`
                : `Jugador cargado: ${registration.player1Name || currentUser?.name || "Jugador"}`}
            </Text>
            <Text style={styles.blockText}>
              Estado: {getRegistrationStatusLabel(registration.status)}
            </Text>
            <Text style={styles.blockText}>
              Disponibilidad: {formatAvailabilitySummary(
                registration.availability,
                tournamentDayOptions
              )}
            </Text>
            {!registration.player2Id ? (
              <Text style={styles.blockText}>
                Companero: pendiente de definir con el organizador o mas adelante.
              </Text>
            ) : null}
          </View>

          <View style={styles.blockCard}>
            <Text style={styles.blockTitle}>Pagos individuales</Text>
            {(registration.payments || [])
              .filter(
                (payment) =>
                  normalizeText(payment?.playerId) === normalizeText(currentUser?.uid) ||
                  normalizeText(payment?.userId) === normalizeText(currentUser?.uid)
              )
              .map((payment) => (
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
            <Text style={styles.blockTitleCentered}>INSCRIPCION</Text>
            <Text style={styles.blockTextCentered}>
              Organiza tu solicitud en tres pasos. El companero es opcional por ahora.
            </Text>

            <View style={styles.registrationActionRow}>
              {registrationSteps.map((step) => (
                <Pressable
                  key={step.key}
                  onPress={() => setActivePanel(step.key)}
                  style={[
                    styles.registrationActionButton,
                    activePanel === step.key && styles.registrationActionButtonActive,
                  ]}
                >
                  <Ionicons
                    color={activePanel === step.key ? colors.surface : colors.primaryDark}
                    name={
                      step.key === "partner"
                        ? "people-outline"
                        : step.key === "availability"
                        ? "calendar-outline"
                        : "card-outline"
                    }
                    size={18}
                  />
                  <Text
                    style={[
                      styles.registrationActionText,
                      activePanel === step.key && styles.registrationActionTextActive,
                    ]}
                  >
                    {step.title.toUpperCase()}
                  </Text>
                  <Text
                    style={[
                      styles.registrationStepDescription,
                      activePanel === step.key && styles.registrationStepDescriptionActive,
                    ]}
                  >
                    {step.description}
                  </Text>
                  <Text
                    style={[
                      styles.registrationActionMeta,
                      step.ready ? styles.registrationStepStatusReady : null,
                      activePanel === step.key && styles.registrationActionMetaActive,
                    ]}
                  >
                    {step.ready ? "Listo" : "Pendiente"}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {activePanel === "partner" ? (
          <View style={styles.blockCard}>
            <Text style={styles.blockTitleCentered}>MI COMPANERO</Text>
            <Text style={styles.blockTextCentered}>
              Este paso es opcional. Si todavia no definiste pareja, podes seguir igual.
            </Text>

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
            ) : (
              <View style={styles.registrationHintCard}>
                <Ionicons color={colors.primaryDark} name="sparkles-outline" size={18} />
                <Text style={styles.registrationHintText}>
                  Podes enviar una solicitud individual y completar el companero despues.
                </Text>
              </View>
            )}
          </View>
          ) : null}

          {activePanel === "availability" ? (
          <View style={styles.blockCard}>
            <Text style={styles.blockTitleCentered}>DISPONIBILIDAD</Text>
            <Text style={styles.blockTextCentered}>
              Guardamos tus horarios para que el organizador pueda acomodar mejor el torneo.
            </Text>
            <AvailabilitySummary
              emptyText="Todavia no cargaste disponibilidad para este torneo."
              items={availabilityItems}
            />
            <AppButton
              onPress={() => setAvailabilityEditorVisible(true)}
              style={styles.sectionButton}
              title={availabilityItems.length ? "EDITAR DISPONIBILIDAD" : "CARGAR DISPONIBILIDAD"}
              variant="secondary"
            />
          </View>
          ) : null}

          {activePanel === "payments" ? (
            <View style={styles.blockCard}>
              <Text style={styles.blockTitleCentered}>PAGOS</Text>
              {tournamentMercadoPagoEnabled ? (
                <View style={styles.registrationHintCard}>
                  <Ionicons color={colors.primaryDark} name="wallet-outline" size={18} />
                  <Text style={styles.registrationHintText}>
                    El organizador habilito Mercado Pago para este torneo. La transferencia queda desactivada.
                  </Text>
                </View>
              ) : requiresTransferReceipt ? (
                <>
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
                </>
              ) : (
                <View style={styles.registrationHintCard}>
                  <Ionicons color={colors.primaryDark} name="checkmark-circle-outline" size={18} />
                  <Text style={styles.registrationHintText}>
                    Este torneo no exige comprobante para enviar la solicitud.
                  </Text>
                </View>
              )}
            </View>
          ) : null}

          <AppButton
            disabled={
              submitting ||
              !availabilityItems.length ||
              (requiresTransferReceipt && !receiptAsset?.uri)
            }
            onPress={handleSubmitRegistration}
            title={submitting ? "ENVIANDO..." : "ENVIAR SOLICITUD"}
          />

          <AvailabilityEditor
            dayOptions={
              Array.isArray(tournamentDayOptions) && tournamentDayOptions.length > 0
                ? tournamentDayOptions
                : null
            }
            initialAvailability={availability}
            loading={false}
            onClose={() => setAvailabilityEditorVisible(false)}
            onSave={async (nextAvailability) => {
              setAvailability(nextAvailability);
              setAvailabilityEditorVisible(false);
            }}
            saveSuccessMessage="Tu disponibilidad para este torneo ya quedo actualizada."
            subtitle="Selecciona una o mas fechas reales del torneo y agrega los horarios disponibles."
            summaryEmptyText="Todavia no cargaste disponibilidad para este torneo."
            title="Disponibilidad para el torneo"
            visible={availabilityEditorVisible}
          />
        </>
      )}
    </View>
  );
}

function ParticipantsTab({ registrations, tournamentDayOptions }) {
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
                  {formatAvailabilitySummary(
                    registration.availability,
                    tournamentDayOptions
                  )}
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

function OrganizerFixtureWorkspace({
  currentUser,
  onActionCompleted,
  registrations,
  showFeedback,
  tournament,
}) {
  const fixtureSetup = tournament?.fixtureSetup || {};
  const confirmedRegistrations = useMemo(
    () => registrations.filter((registration) => isRegistrationConfirmed(registration)),
    [registrations]
  );
  const confirmedPairCount = confirmedRegistrations.length;
  const [savingKey, setSavingKey] = useState("");
  const [selectedMode, setSelectedMode] = useState(
    fixtureSetup.mode || tournament?.buildMode || "automatic"
  );
  const [selectedPathType, setSelectedPathType] = useState(fixtureSetup.pathType || "strict");
  const [selectedManualBracketMode, setSelectedManualBracketMode] = useState(
    fixtureSetup.manualBracketMode || "automatic"
  );

  useEffect(() => {
    const nextMode = fixtureSetup.mode || tournament?.buildMode || "automatic";
    const nextPathType = fixtureSetup.pathType || "strict";
    const nextManualBracketMode = fixtureSetup.manualBracketMode || "automatic";

    setSelectedMode((current) => (current === nextMode ? current : nextMode));
    setSelectedPathType((current) => (current === nextPathType ? current : nextPathType));
    setSelectedManualBracketMode((current) =>
      current === nextManualBracketMode ? current : nextManualBracketMode
    );
  }, [
    fixtureSetup.manualBracketMode,
    fixtureSetup.mode,
    fixtureSetup.pathType,
    tournament?.buildMode,
  ]);

  const recommendation = useMemo(
    () => resolveFixtureRecommendation(confirmedPairCount, selectedPathType),
    [confirmedPairCount, selectedPathType]
  );
  const recommendedZones = useMemo(
    () => buildRecommendedZoneNames(recommendation.zoneSizes),
    [recommendation.zoneSizes]
  );

  const saveFixtureSetup = async (partialSetup = {}, successMessage = "") => {
    if (!tournament?.id) {
      return;
    }

    const { savingKey: nextSavingKey = "saving", ...persistedPartialSetup } = partialSetup;
    const nextSetup = {
      mode: selectedMode,
      pathType: selectedPathType,
      manualBracketMode: selectedManualBracketMode,
      zonesStatus: fixtureSetup.zonesStatus || "pending",
      bracketStatus: fixtureSetup.bracketStatus || "pending",
      ...fixtureSetup,
      ...persistedPartialSetup,
      recommendedTemplate: {
        pairCount: confirmedPairCount,
        zoneSizes: recommendation.zoneSizes,
        qualifiedSummary: recommendation.qualifiedSummary,
        bracketSummary: recommendation.bracketSummary,
      },
    };

    try {
      setSavingKey(nextSavingKey);
      await updateTournament(
        tournament.id,
        { uid: currentUser?.uid || "", name: currentUser?.name || "Organizador" },
        { buildMode: selectedMode, fixtureSetup: nextSetup },
        tournament
      );
      await onActionCompleted?.();

      if (successMessage) {
        showFeedback("Fixture actualizado", successMessage, "success");
      }
    } catch (error) {
      showFeedback(
        "No pudimos guardar el fixture",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setSavingKey("");
    }
  };

  const handleCreateZones = () => {
    if (confirmedPairCount < 6) {
      showFeedback(
        "Faltan parejas confirmadas",
        "Se necesitan al menos 6 parejas confirmadas para crear zonas.",
        "warning"
      );
      return;
    }

    const modeCopy =
      selectedMode === "automatic"
        ? "Las zonas quedaron configuradas en modo automatico y seguiran la recomendacion de la app."
        : selectedMode === "semiautomatic"
        ? "Las zonas quedaron configuradas en modo automatico y las llaves quedaran para carga manual."
        : "La vista manual ya quedo preparada para crear zona por zona con recomendacion visible.";

    saveFixtureSetup(
      {
        savingKey: "zones",
        zonesStatus: "configured",
        mode: selectedMode,
        pathType: selectedPathType,
        manualBracketMode: selectedManualBracketMode,
      },
      modeCopy
    );
  };

  const handleConfigureBracket = (modeOverride = null) => {
    if (confirmedPairCount < 6) {
      showFeedback(
        "Faltan parejas confirmadas",
        "Antes de crear llaves debes tener al menos 6 parejas confirmadas.",
        "warning"
      );
      return;
    }

    const nextManualBracketMode = modeOverride || selectedManualBracketMode;
    const bracketStatus = nextManualBracketMode === "manual" ? "manual_ready" : "automatic_ready";
    const bracketMessage =
      nextManualBracketMode === "manual"
        ? "La app ya dejo la recomendacion de llaves lista para que el organizador la complete manualmente."
        : "La app ya dejo preparada la recomendacion para crear las llaves automaticamente.";

    saveFixtureSetup(
      {
        savingKey: "bracket",
        zonesStatus: fixtureSetup.zonesStatus || "configured",
        bracketStatus,
        manualBracketMode: nextManualBracketMode,
        mode: selectedMode,
        pathType: selectedPathType,
      },
      bracketMessage
    );
  };

  return (
    <View style={styles.tabBody}>
      <View style={styles.blockCard}>
        <Text style={styles.blockTitle}>Zonas</Text>
        <Text style={styles.blockText}>
          Trabajamos con las parejas confirmadas del torneo. La app recomienda el formato y el
          organizador decide como avanzar segun el modo elegido.
        </Text>

        <View style={styles.fixtureSummaryGrid}>
          <View style={styles.fixtureSummaryCard}>
            <Text style={styles.fixtureSummaryLabel}>Parejas confirmadas</Text>
            <Text style={styles.fixtureSummaryValue}>{confirmedPairCount}</Text>
          </View>
          <View style={styles.fixtureSummaryCard}>
            <Text style={styles.fixtureSummaryLabel}>Formato sugerido</Text>
            <Text style={styles.fixtureSummaryValue}>{formatZoneLabel(recommendation.zoneSizes)}</Text>
          </View>
        </View>

        <Text style={styles.fixtureSectionLabel}>Modo de armado</Text>
        <View style={styles.fixtureOptionRow}>
          {FIXTURE_MODE_OPTIONS.map((option) => {
            const isActive = selectedMode === option.value;

            return (
              <Pressable
                key={option.value}
                onPress={() => setSelectedMode(option.value)}
                style={[styles.fixtureOptionChip, isActive && styles.fixtureOptionChipActive]}
              >
                <Text
                  style={[
                    styles.fixtureOptionChipText,
                    isActive && styles.fixtureOptionChipTextActive,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.fixtureSectionLabel}>Modalidad</Text>
        <View style={styles.fixturePathStack}>
          {FIXTURE_PATH_OPTIONS.map((option) => {
            const isActive = selectedPathType === option.value;

            return (
              <Pressable
                key={option.value}
                onPress={() => setSelectedPathType(option.value)}
                style={[styles.fixturePathCard, isActive && styles.fixturePathCardActive]}
              >
                <Text
                  style={[styles.fixturePathTitle, isActive && styles.fixturePathTitleActive]}
                >
                  {option.label}
                </Text>
                <Text
                  style={[
                    styles.fixturePathDescription,
                    isActive && styles.fixturePathDescriptionActive,
                  ]}
                >
                  {option.description}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.fixtureRecommendationCard}>
          <Text style={styles.fixtureRecommendationTitle}>Recomendacion de la app</Text>
          <Text style={styles.fixtureRecommendationText}>
            {recommendation.qualifiedSummary}
          </Text>
          <Text style={styles.fixtureRecommendationText}>
            {recommendation.bracketSummary}
          </Text>
          <Text style={styles.fixtureRecommendationHint}>{recommendation.note}</Text>
        </View>

        <AppButton
          onPress={handleCreateZones}
          style={styles.sectionButton}
          title={savingKey === "zones" ? "GUARDANDO..." : "CREAR ZONAS"}
        />

        {selectedMode === "manual" ? (
          <View style={styles.fixtureManualZoneWrap}>
            <Text style={styles.fixtureSectionLabel}>Creacion manual guiada</Text>
            <Text style={styles.blockText}>
              La app recomienda esta estructura, pero el organizador puede apartarse si lo necesita.
            </Text>
            {recommendedZones.map((zone) => (
              <View key={zone.key} style={styles.fixtureZoneHintRow}>
                <View style={styles.fixtureZoneHintBadge}>
                  <Text style={styles.fixtureZoneHintBadgeText}>{zone.name}</Text>
                </View>
                <Text style={styles.fixtureZoneHintText}>
                  Recomendacion: {zone.size} parejas
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <View style={styles.blockCard}>
        <Text style={styles.blockTitle}>Llaves</Text>
        <Text style={styles.blockText}>
          La app siempre recomienda cruces y byes segun la cantidad de parejas clasificadas, pero
          el organizador puede definir el detalle final.
        </Text>

        <View style={styles.fixtureRecommendationCard}>
          <Text style={styles.fixtureRecommendationTitle}>Cruce sugerido</Text>
          <Text style={styles.fixtureRecommendationText}>
            Los 1ros de zona deben cruzarse con 2dos de otra zona, priorizando evitar cruces de la
            misma zona en la primera llave.
          </Text>
          <Text style={styles.fixtureRecommendationText}>
            Si queda un lugar vacio en la llave, la app recomienda completar ese espacio con BYE.
          </Text>
        </View>

        {selectedMode === "automatic" ? (
          <View style={styles.fixtureModeSummaryCard}>
            <Ionicons color={colors.primaryDark} name="git-branch-outline" size={18} />
            <Text style={styles.fixtureModeSummaryText}>
              En automatico, las llaves se recomiendan y se crean automaticamente. Luego podras
              editarlas si hace falta.
            </Text>
          </View>
        ) : null}

        {selectedMode === "semiautomatic" ? (
          <AppButton
            onPress={() => handleConfigureBracket("manual")}
            style={styles.sectionButton}
            title={savingKey === "bracket" ? "GUARDANDO..." : "CREAR LLAVES"}
            variant="secondary"
          />
        ) : null}

        {selectedMode === "manual" ? (
          <>
            <Text style={styles.fixtureSectionLabel}>Como crear las llaves</Text>
            <View style={styles.fixtureOptionRow}>
              {[
                { label: "Automaticas", value: "automatic" },
                { label: "Manuales", value: "manual" },
              ].map((option) => {
                const isActive = selectedManualBracketMode === option.value;

                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setSelectedManualBracketMode(option.value)}
                    style={[styles.fixtureOptionChip, isActive && styles.fixtureOptionChipActive]}
                  >
                    <Text
                      style={[
                        styles.fixtureOptionChipText,
                        isActive && styles.fixtureOptionChipTextActive,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <AppButton
              onPress={() => handleConfigureBracket(selectedManualBracketMode)}
              style={styles.sectionButton}
              title={savingKey === "bracket" ? "GUARDANDO..." : "CONFIGURAR LLAVES"}
              variant="secondary"
            />
          </>
        ) : null}
      </View>
    </View>
  );
}

function FixtureTab({
  currentUser,
  groups,
  matches,
  onActionCompleted,
  registrations,
  role,
  showFeedback,
  tournament,
}) {
  return (
    <View style={styles.tabBody}>
      {role === "organizer" ? (
        <OrganizerFixtureWorkspace
          currentUser={currentUser}
          onActionCompleted={onActionCompleted}
          registrations={registrations}
          showFeedback={showFeedback}
          tournament={tournament}
        />
      ) : null}
      <BracketTab groups={groups} />
      <MatchesTab matches={matches} />
    </View>
  );
}

function ManagementTab({
  currentUser,
  onEditDetails,
  onActionCompleted,
  showFeedback,
  tournament,
}) {
  const [actionLoadingKey, setActionLoadingKey] = useState("");

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

  const actionButtons = [
    {
      key: "edit-details",
      title: "Editar detalles",
      variant: "secondary",
      onPress: onEditDetails,
    },
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
                  button.key === "close-registration" ||
                  button.variant === "danger" ||
                  button.variant === "secondary"
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
    </View>
  );
}

export default function TournamentDetailScreen({ navigation, route }) {
  const { user, userData } = useAuth();
  const tournamentId = route?.params?.tournamentId || "";
  const requestedInitialTab = resolveTournamentTab(route?.params?.initialTab || "");
  const [tournament, setTournament] = useState(null);
  const [registrations, setRegistrations] = useState([]);
  const [groups, setGroups] = useState([]);
  const [matches, setMatches] = useState([]);
  const [activeTab, setActiveTab] = useState("");
  const [pendingOrganizerArea, setPendingOrganizerArea] = useState("");
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState({
    visible: false,
    title: "",
    message: "",
    tone: "default",
  });
  const initialTabAppliedRef = useRef(false);
  const lastOrganizerAreaPersistedRef = useRef("");
  const currentUser = useMemo(
    () => ({
      ...(userData || {}),
      uid: userData?.uid || user?.uid || "",
      name: userData?.name || user?.displayName || "Jugador",
    }),
    [user?.displayName, user?.uid, userData]
  );

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

  const handleRemovePoster = useCallback(async () => {
    if (!tournament?.id) {
      return;
    }

    try {
      setLoading(true);
      await updateTournament(
        tournament.id,
        { uid: currentUser.uid, name: currentUser.name },
        { coverImage: "" },
        tournament
      );
      await loadTournamentDetail();
      setFeedback({
        visible: true,
        title: "Afiche eliminado",
        message: "El torneo ya no muestra afiche.",
        tone: "success",
      });
    } catch (error) {
      setFeedback({
        visible: true,
        title: "No pudimos eliminar el afiche",
        message: error?.message || "Intenta nuevamente en unos instantes.",
        tone: "danger",
      });
    } finally {
      setLoading(false);
    }
  }, [currentUser.name, currentUser.uid, loadTournamentDetail, tournament]);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      setPendingOrganizerArea("");

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
        currentUserId: currentUser.uid,
        registrations,
        tournament,
      }),
    [currentUser.uid, registrations, tournament]
  );

  const tournamentDayOptions = useMemo(() => buildTournamentDayOptions(tournament), [tournament]);
  const visibleTabs = useMemo(() => getVisibleTabs(accessMeta.role), [accessMeta.role]);

  const persistOrganizerLastArea = useCallback(
    async (nextArea) => {
      if (!tournament?.id || accessMeta.role !== "organizer") {
        return;
      }

      const normalizedArea = resolveOrganizerLastArea(nextArea);
      const currentArea = resolveOrganizerLastArea(tournament?.organizerLastViewedArea || "");

      if (normalizedArea === currentArea && lastOrganizerAreaPersistedRef.current === normalizedArea) {
        return;
      }

      lastOrganizerAreaPersistedRef.current = normalizedArea;

      try {
        await updateTournament(
          tournament.id,
          { uid: currentUser.uid, name: currentUser.name },
          { organizerLastViewedArea: normalizedArea },
          tournament
        );
        setTournament((current) =>
          current
            ? {
                ...current,
                organizerLastViewedArea: normalizedArea,
              }
            : current
        );
      } catch (error) {
        lastOrganizerAreaPersistedRef.current = "";
      }
    },
    [accessMeta.role, currentUser.name, currentUser.uid, tournament]
  );

  useEffect(() => {
    initialTabAppliedRef.current = false;
    lastOrganizerAreaPersistedRef.current = "";
  }, [tournamentId]);

  useEffect(() => {
    if (accessMeta.role !== "organizer") {
      return;
    }

    lastOrganizerAreaPersistedRef.current = resolveOrganizerLastArea(
      tournament?.organizerLastViewedArea || ""
    );
  }, [accessMeta.role, tournament?.organizerLastViewedArea]);

  useEffect(() => {
    if (
      !initialTabAppliedRef.current &&
      requestedInitialTab &&
      visibleTabs.includes(requestedInitialTab) &&
      activeTab !== requestedInitialTab
    ) {
      initialTabAppliedRef.current = true;
      setActiveTab(requestedInitialTab);
      if (typeof navigation?.setParams === "function") {
        navigation.setParams({ initialTab: undefined });
      }
    }
  }, [activeTab, navigation, requestedInitialTab, visibleTabs]);

  const renderTabContent = () => {
    if (!tournament) {
      return null;
    }

    if (accessMeta.role === "organizer" && activeTab !== "management") {
      return null;
    }

    if (accessMeta.role !== "organizer") {
      return null;
    }

    if (activeTab === "management") {
      return (
        <ManagementTab
          currentUser={currentUser}
          groups={groups}
          matches={matches}
          onEditDetails={() =>
            navigation.navigate("CreateTournament", {
              returnToTournamentDetail: true,
              tournament,
            })
          }
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

  const isOrganizerAreaSelected = (areaKey) =>
    pendingOrganizerArea === areaKey ||
    (!pendingOrganizerArea && areaKey === "management" && activeTab === "management");

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
              compactFriendly
              endDateMillis={tournament?.endDateMillis || 0}
              organizerLogoUrl={
                tournament?.organizerLogoUrl ||
                ((tournament?.organizerId === userData?.uid || tournament?.createdBy === userData?.uid)
                  ? userData?.organizerLogoUrl
                  : "")
              }
              startDateMillis={tournament?.startDateMillis || 0}
              status={tournament?.status || "draft"}
              title={tournament?.name || "Torneo"}
              titleColorSeed={[tournament?.creationBatchId, tournament?.name]
                .map((value) => String(value || "").trim())
                .filter(Boolean)
                .join(":")}
            />

            <View style={styles.tabsGrid}>
              {accessMeta.role === "organizer" ? (
                <Pressable
                  onPress={async () => {
                    setPendingOrganizerArea("registration");
                    setActiveTab("");
                    await persistOrganizerLastArea("registration");
                    navigation.navigate("TournamentRegistrations", {
                      tournamentId: tournament.id,
                      tournamentName: tournament.name || "Torneo",
                    });
                  }}
                  style={[
                    styles.tabButton,
                    isOrganizerAreaSelected("registration") && styles.tabButtonActive,
                  ]}
                >
                  <View
                    style={[
                      styles.tabIconWrap,
                      isOrganizerAreaSelected("registration") && styles.tabIconWrapActive,
                    ]}
                  >
                    <Ionicons
                      color={
                        isOrganizerAreaSelected("registration")
                          ? colors.surface
                          : colors.primaryDark
                      }
                      name="people-outline"
                      size={20}
                    />
                  </View>
                  <Text
                    style={[
                      styles.tabButtonText,
                      isOrganizerAreaSelected("registration") && styles.tabButtonTextActive,
                    ]}
                  >
                    Inscripciones
                  </Text>
                </Pressable>
              ) : null}

              {accessMeta.role === "organizer" ? (
                <Pressable
                  onPress={async () => {
                    setPendingOrganizerArea("fixture");
                    setActiveTab("");
                    await persistOrganizerLastArea("fixture");
                    navigation.navigate("TournamentFixture", {
                      tournamentId: tournament.id,
                      tournamentName: tournament.name || "Torneo",
                    });
                  }}
                  style={[
                    styles.tabButton,
                    isOrganizerAreaSelected("fixture") && styles.tabButtonActive,
                  ]}
                >
                  <View
                    style={[
                      styles.tabIconWrap,
                      isOrganizerAreaSelected("fixture") && styles.tabIconWrapActive,
                    ]}
                  >
                    <Ionicons
                      color={
                        isOrganizerAreaSelected("fixture")
                          ? colors.surface
                          : colors.primaryDark
                      }
                      name={TAB_ICONS.fixture}
                      size={20}
                    />
                  </View>
                  <Text
                    style={[
                      styles.tabButtonText,
                      isOrganizerAreaSelected("fixture") && styles.tabButtonTextActive,
                    ]}
                  >
                    {TAB_LABELS.fixture}
                  </Text>
                </Pressable>
              ) : null}

              {accessMeta.role === "organizer" ? (
                <Pressable
                  onPress={async () => {
                    setPendingOrganizerArea("payments");
                    setActiveTab("");
                    await persistOrganizerLastArea("payments");
                    navigation.navigate("TournamentPayments", {
                      tournamentId: tournament.id,
                      tournamentName: tournament.name || "Torneo",
                    });
                  }}
                  style={[
                    styles.tabButton,
                    isOrganizerAreaSelected("payments") && styles.tabButtonActive,
                  ]}
                >
                  <View
                    style={[
                      styles.tabIconWrap,
                      isOrganizerAreaSelected("payments") && styles.tabIconWrapActive,
                    ]}
                  >
                    <Ionicons
                      color={
                        isOrganizerAreaSelected("payments")
                          ? colors.surface
                          : colors.primaryDark
                      }
                      name={TAB_ICONS.payments}
                      size={20}
                    />
                  </View>
                  <Text
                    style={[
                      styles.tabButtonText,
                      isOrganizerAreaSelected("payments") && styles.tabButtonTextActive,
                    ]}
                  >
                    {TAB_LABELS.payments}
                  </Text>
                </Pressable>
              ) : null}

              {accessMeta.role !== "organizer" ? (
                <>
                  <Pressable
                    onPress={() =>
                      navigation.navigate("TournamentRegistration", {
                        tournamentId: tournament.id,
                        tournamentName: tournament.name || "Torneo",
                      })
                    }
                    style={styles.tabButton}
                  >
                    <View style={styles.tabIconWrap}>
                      <Ionicons
                        color={colors.primaryDark}
                        name={TAB_ICONS.registration}
                        size={20}
                      />
                    </View>
                    <Text style={styles.tabButtonText}>{TAB_LABELS.registration}</Text>
                  </Pressable>

                  {accessMeta.role === "confirmed_player" ? (
                    <Pressable
                      onPress={() =>
                        navigation.navigate("TournamentFixture", {
                          tournamentId: tournament.id,
                          tournamentName: tournament.name || "Torneo",
                        })
                      }
                      style={styles.tabButton}
                    >
                      <View style={styles.tabIconWrap}>
                        <Ionicons
                          color={colors.primaryDark}
                          name={TAB_ICONS.fixture}
                          size={20}
                        />
                      </View>
                      <Text style={styles.tabButtonText}>{TAB_LABELS.fixture}</Text>
                    </Pressable>
                  ) : null}

                </>
              ) : null}

              {accessMeta.role === "organizer" ? visibleTabs.map((tabKey) => {
                const isActive = isOrganizerAreaSelected(tabKey);

                return (
                  <Pressable
                    key={tabKey}
                    onPress={async () => {
                      if (tabKey === "fixture" && accessMeta.role === "organizer") {
                        setPendingOrganizerArea("fixture");
                        await persistOrganizerLastArea("fixture");
                        navigation.navigate("TournamentFixture", {
                          tournamentId: tournament.id,
                          tournamentName: tournament.name || "Torneo",
                        });
                        return;
                      }

                      setPendingOrganizerArea("");
                      setActiveTab(tabKey);
                      if (accessMeta.role === "organizer" && tabKey === "management") {
                        await persistOrganizerLastArea("management");
                      }
                    }}
                    style={[styles.tabButton, isActive && styles.tabButtonActive]}
                  >
                    <View style={[styles.tabIconWrap, isActive && styles.tabIconWrapActive]}>
                      <Ionicons
                        color={isActive ? colors.surface : colors.primaryDark}
                        name={TAB_ICONS[tabKey] || "ellipse-outline"}
                        size={20}
                      />
                    </View>
                    <Text style={[styles.tabButtonText, isActive && styles.tabButtonTextActive]}>
                      {TAB_LABELS[tabKey]}
                    </Text>
                  </Pressable>
                );
              }) : null}
            </View>

            {tournament?.coverImage &&
            (accessMeta.role !== "organizer" || activeTab === "management") ? (
              <View style={styles.posterShortcutWrap}>
                <View style={styles.posterShortcutCard}>
                  {accessMeta.role === "organizer" ? (
                    <Pressable
                      onPress={async () => {
                        try {
                          await handleOpenTournamentPoster(
                            navigation,
                            tournament
                          );
                        } catch (error) {
                          setFeedback({
                            visible: true,
                            title: "No pudimos abrir el afiche",
                            message: "Intenta nuevamente en unos instantes.",
                            tone: "danger",
                          });
                        }
                      }}
                      style={({ pressed }) => [
                        styles.posterShortcutMain,
                        pressed ? styles.posterShortcutCardPressed : null,
                      ]}
                    >
                      <Image source={{ uri: tournament.coverImage }} style={styles.posterShortcutThumb} />
                      <View style={styles.posterShortcutCopy}>
                        <Text style={styles.posterShortcutTitle}>AFICHE DEL TORNEO</Text>
                        <Text style={styles.posterShortcutText}>Toca para verlo completo</Text>
                      </View>
                      <Ionicons color={colors.primaryDark} name="open-outline" size={18} />
                    </Pressable>
                  ) : (
                    <View style={styles.posterPreviewOnlyWrap}>
                      <Image
                        source={{ uri: tournament.coverImage }}
                        style={styles.posterPreviewOnlyImage}
                      />
                    </View>
                  )}

                  {accessMeta.role === "organizer" ? (
                    <Pressable
                      accessibilityLabel="Quitar afiche"
                      onPress={handleRemovePoster}
                      style={({ pressed }) => [
                        styles.posterRemoveIconButton,
                        pressed ? styles.posterRemoveButtonPressed : null,
                      ]}
                    >
                      <Ionicons color="#B24343" name="trash-outline" size={18} />
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ) : null}

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
  posterShortcutWrap: {
    marginTop: spacing.md,
  },
  posterShortcutCard: {
    alignItems: "center",
    backgroundColor: "#F3FAF6",
    borderColor: "#D5EADF",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    marginTop: spacing.md,
    padding: spacing.md,
  },
  posterShortcutMain: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 92,
  },
  posterShortcutCardPressed: {
    opacity: 0.9,
  },
  posterPreviewOnlyWrap: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    minHeight: 320,
  },
  posterPreviewOnlyImage: {
    borderRadius: 14,
    height: 320,
    resizeMode: "contain",
    width: "100%",
  },
  posterShortcutThumb: {
    borderRadius: 10,
    height: 92,
    resizeMode: "cover",
    width: 70,
  },
  posterShortcutCopy: {
    flex: 1,
  },
  posterShortcutTitle: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  posterShortcutText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
    marginTop: 4,
  },
  posterRemoveIconButton: {
    alignItems: "center",
    backgroundColor: "#FFF3F3",
    borderColor: "#E8C5C5",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    height: 38,
    marginLeft: spacing.sm,
    width: 38,
  },
  posterRemoveButtonPressed: {
    backgroundColor: "#FCE7E7",
  },
  tabsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingBottom: spacing.md,
    paddingTop: spacing.md,
  },
  tabButton: {
    alignItems: "center",
    backgroundColor: "#F2FAF5",
    borderColor: "#D5EADF",
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 104,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    width: "47.5%",
  },
  tabButtonActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 4,
  },
  tabIconWrap: {
    alignItems: "center",
    backgroundColor: colors.secondary,
    borderRadius: 999,
    height: 42,
    justifyContent: "center",
    marginBottom: spacing.xs,
    width: 42,
  },
  tabIconWrapActive: {
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  tabButtonText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
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
  registrationActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  registrationActionButton: {
    alignItems: "center",
    backgroundColor: "#F5FAF7",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    minWidth: "47%",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  registrationActionButtonActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  registrationActionText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 6,
    textAlign: "center",
    textTransform: "uppercase",
  },
  registrationActionTextActive: {
    color: colors.surface,
  },
  registrationStepDescription: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 18,
    marginTop: 4,
    textAlign: "center",
  },
  registrationStepDescriptionActive: {
    color: "rgba(255,255,255,0.82)",
  },
  registrationActionMeta: {
    color: "#A36C17",
    fontSize: 11,
    fontWeight: "800",
    marginTop: spacing.sm,
    textAlign: "center",
    textTransform: "uppercase",
  },
  registrationActionMetaActive: {
    color: colors.surface,
  },
  registrationStepStatusReady: {
    color: colors.primaryDark,
  },
  registrationHintCard: {
    alignItems: "center",
    backgroundColor: "#EFF8F4",
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  registrationHintText: {
    color: colors.text,
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
    marginLeft: spacing.sm,
  },
  fixtureSummaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  fixtureSummaryCard: {
    backgroundColor: "#F5FAF7",
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    minWidth: "47%",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  fixtureSummaryLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  fixtureSummaryValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 4,
  },
  fixtureSectionLabel: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
    marginTop: spacing.md,
    textAlign: "center",
    textTransform: "uppercase",
  },
  fixtureOptionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  fixtureOptionChip: {
    alignItems: "center",
    backgroundColor: "#F2FAF5",
    borderColor: "#D5EADF",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: spacing.md,
  },
  fixtureOptionChipActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  fixtureOptionChipText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
    textTransform: "uppercase",
  },
  fixtureOptionChipTextActive: {
    color: colors.surface,
  },
  fixturePathStack: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  fixturePathCard: {
    backgroundColor: "#F7FBF8",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  fixturePathCardActive: {
    backgroundColor: "#ECF8F2",
    borderColor: colors.primaryDark,
  },
  fixturePathTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
    textAlign: "center",
  },
  fixturePathTitleActive: {
    color: colors.primaryDark,
  },
  fixturePathDescription: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 18,
    marginTop: 4,
    textAlign: "center",
  },
  fixturePathDescriptionActive: {
    color: colors.primaryDark,
  },
  fixtureRecommendationCard: {
    backgroundColor: "#F3FAF6",
    borderColor: "#D5EADF",
    borderRadius: 12,
    borderWidth: 1,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  fixtureRecommendationTitle: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "uppercase",
  },
  fixtureRecommendationText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
    marginTop: 6,
    textAlign: "center",
  },
  fixtureRecommendationHint: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 18,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  fixtureManualZoneWrap: {
    marginTop: spacing.sm,
  },
  fixtureZoneHintRow: {
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  fixtureZoneHintBadge: {
    alignItems: "center",
    backgroundColor: "#EAF4EF",
    borderRadius: 999,
    justifyContent: "center",
    marginRight: spacing.sm,
    minHeight: 28,
    minWidth: 72,
    paddingHorizontal: spacing.sm,
  },
  fixtureZoneHintBadgeText: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "900",
    textAlign: "center",
    textTransform: "uppercase",
  },
  fixtureZoneHintText: {
    color: colors.text,
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
  },
  fixtureModeSummaryCard: {
    alignItems: "center",
    backgroundColor: "#EFF8F4",
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  fixtureModeSummaryText: {
    color: colors.text,
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
    marginLeft: spacing.sm,
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

