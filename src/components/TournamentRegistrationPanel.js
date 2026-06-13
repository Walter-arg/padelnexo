import { useEffect, useMemo, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";

import AppButton from "./AppButton";
import AutocompleteField from "./AutocompleteField";
import AvailabilityEditor from "./AvailabilityEditor";
import AvailabilitySummary from "./AvailabilitySummary";
import SelectField from "./SelectField";
import { colors, spacing } from "../config/theme";
import { LEAGUE_CATEGORY_OPTIONS } from "../services/leaguesService";
import { normalizeMercadoPagoConfig } from "../services/mercadoPagoConfigService";
import { listPlayers } from "../services/playersService";
import { getTournamentAvailabilitySummaryItems } from "../services/tournamentAvailabilityService";
import { hasProfileImage } from "../utils/defaultProfileImage";
import {
  cancelTournamentRegistrationWithdrawal,
  requestTournamentRegistrationWithdrawal,
  registerPairToTournament,
  updateTournamentRegistration,
  uploadTournamentPaymentReceipt,
} from "../services/tournamentsService";

function normalizeText(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isPdfReceipt(asset = {}) {
  const fileName = String(asset?.fileName || asset?.name || "").toLowerCase();
  const mimeType = String(asset?.mimeType || asset?.type || "").toLowerCase();

  return mimeType.includes("pdf") || fileName.endsWith(".pdf");
}

function isImageReceipt(asset = {}) {
  const fileName = String(asset?.fileName || asset?.name || "").toLowerCase();
  const mimeType = String(asset?.mimeType || asset?.type || "").toLowerCase();

  return (
    mimeType.startsWith("image/") ||
    /\.(jpe?g|png|webp|heic|heif)$/i.test(fileName)
  );
}

function isSupportedReceipt(asset = {}) {
  return isPdfReceipt(asset) || isImageReceipt(asset);
}

function buildCurrentPlayerPayload(userData = {}, fallbackPlayer = null) {
  return {
    userId: userData?.uid || "",
    playerId: userData?.uid || "",
    name: userData?.name || "Jugador",
    category: userData?.category || fallbackPlayer?.categoria || "",
    sex: userData?.sex || fallbackPlayer?.sexo || "Masculino",
  };
}

function buildPartnerLabel(player = {}) {
  return [player?.nombre || "", player?.apellido || ""].filter(Boolean).join(" ").trim();
}

function getPlayerDisplayName(player = {}) {
  return buildPartnerLabel(player) || player?.nombre || "Jugador";
}

function normalizeCategoryTag(value = "") {
  return String(value || "").trim().toLowerCase();
}

function areSimpleObjectsEqual(left = {}, right = {}) {
  return JSON.stringify(left || {}) === JSON.stringify(right || {});
}

function arePartnerSelectionsEqual(left = null, right = null) {
  if (!left && !right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    String(left.id || "") === String(right.id || "") &&
    String(left.nombre || "") === String(right.nombre || "") &&
    String(left.apellido || "") === String(right.apellido || "") &&
    String(left.categoria || "") === String(right.categoria || "") &&
    String(left.ciudad || "") === String(right.ciudad || "") &&
    String(left.sexo || "") === String(right.sexo || "") &&
    Boolean(left.isGuest) === Boolean(right.isGuest)
  );
}

function areAssetsEqual(left = null, right = null) {
  if (!left && !right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    String(left.uri || "") === String(right.uri || "") &&
    String(left.fileName || "") === String(right.fileName || "")
  );
}

function buildCategoryWarning(tournament = {}, player1 = null, player2 = null) {
  const composition = tournament?.compositionConfig || {};

  if (composition.categoryFormat === "suma") {
    if (player1 && player2) {
      return "Aviso: la categoria del torneo es orientativa y la pareja se puede cargar igual.";
    }

    return "";
  }

  if (!composition.fixedCategoryA) {
    return "";
  }

  const expectedCategory = normalizeCategoryTag(composition.fixedCategoryA);
  const mismatchedPlayers = [player1, player2]
    .filter(Boolean)
    .filter((player) => normalizeCategoryTag(player?.categoria) !== expectedCategory)
    .map((player) => getPlayerDisplayName(player));

  if (!mismatchedPlayers.length) {
    return "";
  }

  return `Aviso: ${mismatchedPlayers.join(" y ")} no pertenece a la categoria del torneo, pero se permite la carga.`;
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

function buildManualPlayerPayload(player = {}) {
  return {
    userId: "",
    playerId: player?.id || `guest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: [player?.nombre || "", player?.apellido || ""].filter(Boolean).join(" ").trim() || player?.nombre || "Jugador",
    category: player?.categoria || "",
    sex: player?.sexo || "Masculino",
  };
}

function getRegistrationStatusLabel(registration = {}) {
  if (registration?.withdrawalStatus === "confirmed") {
    return "Baja confirmada";
  }

  if (registration?.withdrawalStatus === "requested") {
    return "Solicitud de baja en revision";
  }

  if (registration?.status === "confirmed") {
    return "Inscripto";
  }

  if (registration?.status === "in_review") {
    return "En revision";
  }

  if (registration?.status === "rejected") {
    return "Rechazada";
  }

  return "Solicitud enviada";
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

function getRegistrationSidePlayerKey(registration = {}, side = "player1") {
  const directId = registration?.[`${side}Id`];

  if (directId) {
    return directId;
  }

  const playerName = String(registration?.[`${side}Name`] || "").trim();
  const paymentMatch = (Array.isArray(registration?.payments) ? registration.payments : []).find(
    (payment) => String(payment?.playerName || "").trim() === playerName && payment?.playerId
  );

  return paymentMatch?.playerId || `guest-${side}-${registration?.id || "registration"}`;
}

function buildEditablePartnerFromRegistration(registration = {}, playersSource = [], currentUserId = "") {
  const isCurrentUserPlayer2 =
    normalizeText(registration?.player2Id) === normalizeText(currentUserId);
  const partnerSide = isCurrentUserPlayer2 ? "player1" : "player2";
  const partnerId = getRegistrationSidePlayerKey(registration, partnerSide);
  const partnerName = isCurrentUserPlayer2 ? registration?.player1Name : registration?.player2Name;

  if (!partnerId && !partnerName) {
    return null;
  }

  const matchedPlayer = playersSource.find(
    (player) => normalizeText(player?.id) === normalizeText(partnerId)
  );

  if (matchedPlayer) {
    return matchedPlayer;
  }

  const fullName = String(partnerName || "").trim();
  const [nombre = fullName, ...rest] = fullName.split(/\s+/);

  return {
    id: partnerId || `guest-partner-${registration?.id || "registration"}`,
    nombre,
    apellido: rest.join(" "),
    categoria: "",
    ciudad: "",
    sexo: "Masculino",
  };
}

export default function TournamentRegistrationPanel({
  autoOpenAvailability = false,
  currentUser,
  editorRole = "player",
  initialPanel = "partner",
  onRegistrationCreated,
  registration,
  registrations = [],
  showFeedback = () => {},
  tournament,
  tournamentDayOptions,
}) {
  const [playersSource, setPlayersSource] = useState([]);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [activePanel, setActivePanel] = useState(initialPanel || "partner");
  const [partnerQuery, setPartnerQuery] = useState("");
  const [selectedPartner, setSelectedPartner] = useState(null);
  const [availability, setAvailability] = useState({});
  const [availabilityEditorVisible, setAvailabilityEditorVisible] = useState(false);
  const [receiptAsset, setReceiptAsset] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [paymentTargetPlayerId, setPaymentTargetPlayerId] = useState("");
  const [paymentMethodByPlayer, setPaymentMethodByPlayer] = useState({});
  const [receiptAssetByPlayer, setReceiptAssetByPlayer] = useState({});
  const [player1Query, setPlayer1Query] = useState("");
  const [selectedPlayer1, setSelectedPlayer1] = useState(null);
  const [activePairSlot, setActivePairSlot] = useState("player1");
  const [playerPickerVisible, setPlayerPickerVisible] = useState(false);
  const [playerPickerQuery, setPlayerPickerQuery] = useState("");
  const [playerCategoryFilter, setPlayerCategoryFilter] = useState("");
  const [playerCategoryPickerVisible, setPlayerCategoryPickerVisible] = useState(false);
  const [guestModalVisible, setGuestModalVisible] = useState(false);
  const [guestTarget, setGuestTarget] = useState("player1");
  const [guestName, setGuestName] = useState("");
  const [guestLastName, setGuestLastName] = useState("");
  const [guestCategory, setGuestCategory] = useState("");
  const [guestSex, setGuestSex] = useState("Masculino");
  const [guestCategoryPickerVisible, setGuestCategoryPickerVisible] = useState(false);
  const [withdrawalModalVisible, setWithdrawalModalVisible] = useState(false);
  const isOrganizerEditing = editorRole === "organizer";
  const isOrganizerCreating = editorRole === "organizer_create";

  const currentPlayerRecord = useMemo(
    () =>
      playersSource.find((player) => normalizeText(player?.id) === normalizeText(currentUser?.uid)) || null,
    [currentUser?.uid, playersSource]
  );

  const availablePayments = useMemo(
    () => (Array.isArray(registration?.payments) ? registration.payments.filter(Boolean) : []),
    [registration?.payments]
  );

  const effectivePaymentPlayerId = paymentTargetPlayerId || currentUser?.uid || "";

  const currentPlayerPayment = useMemo(
    () =>
      availablePayments.find(
        (payment) =>
          normalizeText(payment?.playerId) === normalizeText(effectivePaymentPlayerId) ||
          normalizeText(payment?.userId) === normalizeText(effectivePaymentPlayerId)
      ) || null,
    [availablePayments, effectivePaymentPlayerId]
  );

  const hasExistingReceipt = Boolean(currentPlayerPayment?.receiptUrl);
  const isOrganizerPaymentEditor = isOrganizerCreating || isOrganizerEditing;
  const withdrawalStatus = registration?.withdrawalStatus || "none";
  const canRequestWithdrawal = Boolean(
    registration && !isOrganizerPaymentEditor && withdrawalStatus === "none"
  );
  const organizerPaymentParticipants = useMemo(() => {
    return [
      selectedPlayer1
        ? {
            key: selectedPlayer1.id,
            label: `Jugador 1 · ${getPlayerDisplayName(selectedPlayer1)}`,
          }
        : null,
      selectedPartner
        ? {
            key: selectedPartner.id,
            label: `Jugador 2 · ${getPlayerDisplayName(selectedPartner)}`,
          }
        : null,
    ].filter(Boolean);
  }, [selectedPartner, selectedPlayer1]);

  useEffect(() => {
    let isMounted = true;

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
  }, []);

  useEffect(() => {
    if (!["partner", "availability", "payments"].includes(initialPanel)) {
      return;
    }

    setActivePanel((current) => (current === initialPanel ? current : initialPanel));
  }, [initialPanel]);

  useEffect(() => {
    if (!autoOpenAvailability || initialPanel !== "availability") {
      return;
    }

    setAvailabilityEditorVisible(true);
  }, [autoOpenAvailability, initialPanel, registration?.id]);

  useEffect(() => {
    if (!availablePayments.length) {
      if (!isOrganizerPaymentEditor || !organizerPaymentParticipants.length) {
        setPaymentTargetPlayerId((current) => (current ? "" : current));
      }
      return;
    }

    if (
      paymentTargetPlayerId &&
      availablePayments.some(
        (payment) =>
          normalizeText(payment?.playerId) === normalizeText(paymentTargetPlayerId) ||
          normalizeText(payment?.userId) === normalizeText(paymentTargetPlayerId)
      )
    ) {
      return;
    }

    const defaultPaymentId =
      availablePayments[0]?.playerId || availablePayments[0]?.userId || currentUser?.uid || "";
    setPaymentTargetPlayerId((current) => (current === defaultPaymentId ? current : defaultPaymentId));
  }, [
    availablePayments,
    currentUser?.uid,
    isOrganizerPaymentEditor,
    organizerPaymentParticipants.length,
    paymentTargetPlayerId,
  ]);

  useEffect(() => {
    if (!isOrganizerPaymentEditor) {
      return;
    }

    if (
      paymentTargetPlayerId &&
      organizerPaymentParticipants.some(
        (participant) => normalizeText(participant.key) === normalizeText(paymentTargetPlayerId)
      )
    ) {
      return;
    }

    const nextTargetPlayerId = organizerPaymentParticipants[0]?.key || "";
    setPaymentTargetPlayerId((current) =>
      current === nextTargetPlayerId ? current : nextTargetPlayerId
    );
  }, [isOrganizerPaymentEditor, organizerPaymentParticipants, paymentTargetPlayerId]);

  useEffect(() => {
    const nextAvailability = registration?.availability || {};
    setAvailability((current) =>
      areSimpleObjectsEqual(current, nextAvailability) ? current : nextAvailability
    );

    const nextSelectedPlayer1 = registration
      ? {
          id: getRegistrationSidePlayerKey(registration, "player1"),
          nombre: registration.player1Name || "",
          apellido: "",
          categoria: currentPlayerRecord?.categoria || "",
          ciudad: currentPlayerRecord?.ciudad || "",
          sexo: currentPlayerRecord?.sexo || "Masculino",
          isGuest: !registration.player1Id,
        }
      : null;
    setSelectedPlayer1((current) =>
      arePartnerSelectionsEqual(current, nextSelectedPlayer1) ? current : nextSelectedPlayer1
    );

    const nextPlayer1Query = registration?.player1Name || "";
    setPlayer1Query((current) => (current === nextPlayer1Query ? current : nextPlayer1Query));
    const editablePartner = buildEditablePartnerFromRegistration(
      registration,
      playersSource,
      currentUser?.uid
    );
    setSelectedPartner((current) =>
      arePartnerSelectionsEqual(current, editablePartner) ? current : editablePartner
    );
    const nextPartnerQuery = editablePartner ? getPlayerDisplayName(editablePartner) : "";
    setPartnerQuery((current) => (current === nextPartnerQuery ? current : nextPartnerQuery));

    const nextReceiptAsset = currentPlayerPayment?.receiptUrl
      ? {
          fileName: currentPlayerPayment.receiptFileName || "comprobante",
          uri: currentPlayerPayment.receiptUrl,
        }
      : null;
    setReceiptAsset((current) => (areAssetsEqual(current, nextReceiptAsset) ? current : nextReceiptAsset));

    const nextPaymentMethodByPlayer = (Array.isArray(registration?.payments) ? registration.payments : []).reduce((accumulator, payment) => {
        const paymentKey = payment?.playerId || payment?.userId;

        if (paymentKey) {
          accumulator[paymentKey] = payment?.method || "";
        }

        return accumulator;
      }, {});
    setPaymentMethodByPlayer((current) =>
      areSimpleObjectsEqual(current, nextPaymentMethodByPlayer) ? current : nextPaymentMethodByPlayer
    );

    const nextReceiptAssetByPlayer = (Array.isArray(registration?.payments) ? registration.payments : []).reduce((accumulator, payment) => {
        const paymentKey = payment?.playerId || payment?.userId;

        if (paymentKey && payment?.receiptUrl) {
          accumulator[paymentKey] = {
            fileName: payment.receiptFileName || "comprobante",
            uri: payment.receiptUrl,
          };
        }

        return accumulator;
      }, {});
    setReceiptAssetByPlayer((current) =>
      areSimpleObjectsEqual(current, nextReceiptAssetByPlayer) ? current : nextReceiptAssetByPlayer
    );
  }, [
    currentPlayerPayment?.receiptFileName,
    currentPlayerPayment?.receiptUrl,
    currentUser?.uid,
    playersSource,
    registration,
  ]);

  const availabilityItems = useMemo(
    () => getTournamentAvailabilitySummaryItems(availability || {}, tournamentDayOptions),
    [availability, tournamentDayOptions]
  );

  const requiresTransferReceipt =
    Number(tournament?.entryFee || 0) > 0 &&
    (tournament?.paymentMethods || []).includes("transferencia");
  const tournamentMercadoPagoConfig = useMemo(
    () => normalizeMercadoPagoConfig(tournament?.mercadoPagoConfig),
    [tournament?.mercadoPagoConfig]
  );
  const canSubmitManualPairRequest =
    !isOrganizerPaymentEditor &&
    tournament?.pairConfirmationMode === "manual" &&
    Boolean(selectedPartner);

  const occupiedPlayerIds = useMemo(() => {
    return new Set(
      registrations
        .filter((entry) => entry?.withdrawalStatus !== "confirmed")
        .filter((entry) => entry.id !== registration?.id)
        .flatMap((entry) => [
          getRegistrationSidePlayerKey(entry, "player1"),
          getRegistrationSidePlayerKey(entry, "player2"),
        ])
        .filter(Boolean)
    );
  }, [registration?.id, registrations]);

  const selectedPlayer1Id = selectedPlayer1?.id || "";

  const partnerSuggestions = useMemo(() => {
    const normalizedQuery = normalizeText(partnerQuery);

    return playersSource
      .filter((player) => normalizeText(player.id) !== normalizeText(currentUser?.uid))
      .filter((player) => normalizeText(player.id) !== normalizeText(selectedPlayer1Id))
      .filter((player) => !occupiedPlayerIds.has(player.id))
      .filter((player) => {
        if (registration?.player2Id && normalizeText(player.id) === normalizeText(registration.player2Id)) {
          return true;
        }

        if (!normalizedQuery) {
          return true;
        }

        const haystack = [player.nombre, player.apellido, player.categoria, player.ciudad]
          .map(normalizeText)
          .join(" ");

        return haystack.includes(normalizedQuery);
      })
      .slice(0, 8)
      .map((player) => ({
        avatarUri: player?.foto || "",
        label: [player.categoria || "Categoria", player.ciudad || "Ciudad"].join(" · "),
        player,
        value: buildPartnerLabel(player) || player.nombre || "Jugador",
      }));
  }, [currentUser?.uid, occupiedPlayerIds, partnerQuery, playersSource, registration?.player2Id, selectedPlayer1Id]);

  const player1Suggestions = useMemo(() => {
    const normalizedQuery = normalizeText(player1Query);

    return playersSource
      .filter((player) => normalizeText(player.id) !== normalizeText(selectedPartner?.id))
      .filter((player) => !occupiedPlayerIds.has(player.id))
      .filter((player) => {
        if (registration?.player1Id && normalizeText(player.id) === normalizeText(registration.player1Id)) {
          return true;
        }

        if (!normalizedQuery) {
          return true;
        }

        const haystack = [player.nombre, player.apellido, player.categoria, player.ciudad]
          .map(normalizeText)
          .join(" ");

        return haystack.includes(normalizedQuery);
      })
      .slice(0, 8)
      .map((player) => ({
        avatarUri: player?.foto || "",
        label: [player.categoria || "Categoria", player.ciudad || "Ciudad"].join(" · "),
        player,
        value: buildPartnerLabel(player) || player.nombre || "Jugador",
      }));
  }, [occupiedPlayerIds, player1Query, playersSource, registration?.player1Id, selectedPartner?.id]);

  const playerCategoryOptions = useMemo(() => {
    return Array.from(
      new Set(playersSource.map((player) => String(player?.categoria || "").trim()).filter(Boolean))
    ).sort((left, right) => left.localeCompare(right));
  }, [playersSource]);

  const playerCategorySelectOptions = useMemo(
    () => [
      { label: "Todas las categorias", value: "" },
      ...playerCategoryOptions.map((category) => ({ label: category, value: category })),
    ],
    [playerCategoryOptions]
  );

  const playerPickerResults = useMemo(() => {
    const normalizedQuery = normalizeText(playerPickerQuery);
    const otherSelectedId = activePairSlot === "player1" ? selectedPartner?.id : selectedPlayer1?.id;

    return playersSource
      .filter((player) => normalizeText(player?.id) !== normalizeText(otherSelectedId))
      .filter((player) => !occupiedPlayerIds.has(player.id))
      .filter((player) => {
        if (!playerCategoryFilter) {
          return true;
        }

        return normalizeText(player?.categoria) === normalizeText(playerCategoryFilter);
      })
      .filter((player) => {
        if (!normalizedQuery) {
          return true;
        }

        const haystack = [player.nombre, player.apellido, player.categoria, player.ciudad]
          .map(normalizeText)
          .join(" ");

        return haystack.includes(normalizedQuery);
      });
  }, [
    activePairSlot,
    occupiedPlayerIds,
    playerCategoryFilter,
    playerPickerQuery,
    playersSource,
    selectedPartner?.id,
    selectedPlayer1?.id,
  ]);

  const activeOrganizerReceiptAsset = receiptAssetByPlayer[effectivePaymentPlayerId] || null;
  const activeOrganizerPaymentMethod = paymentMethodByPlayer[effectivePaymentPlayerId] || "";
  const categoryWarning = useMemo(
    () =>
      buildCategoryWarning(
        tournament,
        isOrganizerCreating ? selectedPlayer1 : currentPlayerRecord,
        selectedPartner
      ),
    [currentPlayerRecord, isOrganizerCreating, selectedPartner, selectedPlayer1, tournament]
  );
  const organizerPaymentsReady = useMemo(() => {
    if (!isOrganizerPaymentEditor || !organizerPaymentParticipants.length) {
      return false;
    }

    return organizerPaymentParticipants.every((participant) =>
      Boolean(paymentMethodByPlayer[participant.key])
    );
  }, [isOrganizerPaymentEditor, organizerPaymentParticipants, paymentMethodByPlayer]);

  const registrationSteps = useMemo(() => {
    return [
      {
        key: "partner",
        title: isOrganizerCreating ? "Conformar pareja" : "Mi compañero",
        description: isOrganizerCreating
          ? selectedPlayer1 && selectedPartner
            ? "Pareja completa"
            : "Pareja pendiente"
          : selectedPartner
          ? getPlayerDisplayName(selectedPartner)
          : "Pareja pendiente",
        ready: isOrganizerCreating ? Boolean(selectedPlayer1 && selectedPartner) : Boolean(selectedPartner),
      },
      {
        key: "availability",
        title: "Disponibilidad",
        description: availabilityItems.length
          ? `${availabilityItems.length} dia${availabilityItems.length === 1 ? "" : "s"} cargado${availabilityItems.length === 1 ? "" : "s"}`
          : "Opcional",
        ready: availabilityItems.length > 0,
      },
      {
        key: "payments",
        title: "Pagos",
        description: isOrganizerPaymentEditor
          ? "Opcional"
          : requiresTransferReceipt
          ? receiptAsset?.uri || hasExistingReceipt
            ? "Comprobante adjunto"
            : "Adjuntar comprobante"
          : "No requerido",
        ready: isOrganizerPaymentEditor
          ? organizerPaymentsReady
          : !requiresTransferReceipt || Boolean(receiptAsset?.uri || hasExistingReceipt),
      },
    ];
  }, [
    availabilityItems,
    hasExistingReceipt,
    isOrganizerCreating,
    isOrganizerPaymentEditor,
    organizerPaymentsReady,
    receiptAsset?.uri,
    requiresTransferReceipt,
    selectedPartner,
    selectedPlayer1,
  ]);

  const handleOpenPlayerPicker = (slotKey) => {
    setActivePairSlot(slotKey);
    setPlayerPickerQuery("");
    setPlayerCategoryFilter("");
    setPlayerPickerVisible(true);
  };

  const handleSelectPlayerForSlot = (slotKey, player) => {
    const label = getPlayerDisplayName(player);

    if (slotKey === "player1") {
      setSelectedPlayer1(player);
      setPlayer1Query(label);
    } else {
      setSelectedPartner(player);
      setPartnerQuery(label);
    }

    setPlayerPickerVisible(false);
  };

  const handlePickReceipt = async (receiptType = "any") => {
    const pickerType =
      receiptType === "pdf" ? "application/pdf" : receiptType === "image" ? "image/*" : "*/*";
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: pickerType,
    });

    if (result.canceled) {
      return;
    }

    const asset = result.assets?.[0];

    if (!asset?.uri) {
      return;
    }

    const isSupported =
      receiptType === "pdf"
        ? isPdfReceipt(asset)
        : receiptType === "image"
        ? isImageReceipt(asset)
        : isSupportedReceipt(asset);

    if (!isSupported) {
      showFeedback(
        "Archivo no compatible",
        receiptType === "pdf"
          ? "Adjunta un comprobante en PDF."
          : receiptType === "image"
          ? "Adjunta un comprobante en imagen."
          : "Adjunta un comprobante en imagen o PDF.",
        "danger"
      );
      return;
    }

    const nextAsset = {
      fileName: asset.name || asset.fileName || `comprobante-${Date.now()}`,
      mimeType: asset.mimeType || "",
      uri: asset.uri,
    };

    if (isOrganizerPaymentEditor) {
      if (!effectivePaymentPlayerId) {
        return;
      }

      setReceiptAssetByPlayer((current) => ({
        ...current,
        [effectivePaymentPlayerId]: nextAsset,
      }));
      return;
    }

    setReceiptAsset(nextAsset);
  };

  const handleOpenMercadoPagoInfo = () => {
    showFeedback(
      "Mercado Pago disponible",
      "Este torneo ya quedo preparado para cobrar con Checkout Pro usando credenciales de prueba.",
      "default"
    );
  };

  const handleCreateGuestPlayer = () => {
    const trimmedName = String(guestName || "").trim();
    const trimmedLastName = String(guestLastName || "").trim();

    if (!trimmedName) {
      showFeedback("Falta el nombre", "Ingresa al menos el nombre del jugador manual.", "danger");
      return;
    }

    const guestPlayer = {
      id: `guest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      nombre: trimmedName,
      apellido: trimmedLastName,
      categoria: guestCategory || tournament?.compositionConfig?.label || tournament?.compositionLabel || "",
      ciudad: "",
      sexo: guestSex,
      isGuest: true,
    };

    if (guestTarget === "player1") {
      setSelectedPlayer1(guestPlayer);
      setPlayer1Query(buildPartnerLabel(guestPlayer) || guestPlayer.nombre);
    } else {
      setSelectedPartner(guestPlayer);
      setPartnerQuery(buildPartnerLabel(guestPlayer) || guestPlayer.nombre);
    }

    setPlayerPickerVisible(false);
    setGuestModalVisible(false);
    setGuestTarget("player1");
    setGuestName("");
    setGuestLastName("");
    setGuestCategory("");
    setGuestSex("Masculino");
  };

  const handleRequestWithdrawal = async () => {
    if (!registration?.id) {
      return;
    }

    try {
      setSubmitting(true);
      await requestTournamentRegistrationWithdrawal({
        tournamentId: tournament.id,
        registrationId: registration.id,
        requestedById: currentUser?.uid || "",
        requestedByName: currentUser?.name || "Jugador",
      });
      setWithdrawalModalVisible(false);
      await onRegistrationCreated?.();
      showFeedback(
        "Baja solicitada",
        "Tu solicitud de baja quedo enviada para que el organizador la confirme.",
        "success"
      );
    } catch (error) {
      showFeedback(
        "No pudimos solicitar la baja",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelWithdrawalRequest = async () => {
    if (!registration?.id) {
      return;
    }

    try {
      setSubmitting(true);
      await cancelTournamentRegistrationWithdrawal({
        tournamentId: tournament.id,
        registrationId: registration.id,
      });
      await onRegistrationCreated?.();
      showFeedback(
        "Pedido de baja cancelado",
        "La inscripcion vuelve a quedar activa dentro del torneo.",
        "success"
      );
    } catch (error) {
      showFeedback(
        "No pudimos cancelar la baja",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setSubmitting(false);
    }
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

    if (
      !isOrganizerPaymentEditor &&
      requiresTransferReceipt &&
      !receiptAsset?.uri &&
      !hasExistingReceipt &&
      !canSubmitManualPairRequest
    ) {
      showFeedback(
        "Falta comprobante",
        "Adjunta el comprobante antes de enviar la solicitud.",
        "danger"
      );
      return;
    }

    try {
      setSubmitting(true);

      const player1Payload = isOrganizerCreating
        ? selectedPlayer1?.isGuest
          ? buildManualPlayerPayload(selectedPlayer1)
          : selectedPlayer1
          ? buildPartnerPayload(selectedPlayer1)
          : null
        : buildCurrentPlayerPayload(currentUser, currentPlayerRecord);
      const player2Payload = selectedPartner
        ? selectedPartner?.isGuest
          ? buildManualPlayerPayload(selectedPartner)
          : buildPartnerPayload(selectedPartner)
        : null;
      const paymentsOverride = isOrganizerPaymentEditor
        ? [player1Payload, player2Payload]
            .filter((player) => player?.playerId)
            .map((player) => ({
              playerId: player.playerId,
              userId: player.userId,
              method: paymentMethodByPlayer[player.playerId] || "",
            }))
        : [];

      if (!player1Payload) {
        showFeedback("Falta jugador principal", "Selecciona o crea el jugador principal de la pareja.", "danger");
        setSubmitting(false);
        return;
      }

      if (isOrganizerCreating && !player2Payload) {
        showFeedback("Falta compañero", "Completa el jugador 2 para conformar la pareja.", "danger");
        setSubmitting(false);
        return;
      }

      const savedRegistration = registration
        ? await updateTournamentRegistration(tournament.id, registration.id, {
            allowGuestPlayers: isOrganizerEditing || isOrganizerCreating,
            availability,
            paymentsOverride,
            player1: player1Payload,
            player2: player2Payload,
          })
        : await registerPairToTournament(tournament.id, {
            allowGuestPlayers: isOrganizerCreating,
            availability,
            organizerConfirmed: isOrganizerCreating,
            paymentsOverride,
            player1: player1Payload,
            player2: player2Payload,
          });

      if (isOrganizerPaymentEditor) {
        const organizerReceipts = Object.entries(receiptAssetByPlayer).filter(([, asset]) => asset?.uri);

        for (const [playerId, asset] of organizerReceipts) {
          const existingPayment = availablePayments.find(
            (payment) =>
              normalizeText(payment?.playerId) === normalizeText(playerId) ||
              normalizeText(payment?.userId) === normalizeText(playerId)
          );

          if (asset.uri && asset.uri !== existingPayment?.receiptUrl) {
            await uploadTournamentPaymentReceipt({
              tournamentId: tournament.id,
              registrationId: savedRegistration.id,
              playerId,
              receiptUri: asset.uri,
              fileName: asset.fileName,
              method: paymentMethodByPlayer[playerId] || "transferencia",
              uploadedBy: "organizer",
              uploadedByName: "Organizador",
            });
          }
        }
      } else if (
        receiptAsset?.uri &&
        Number(tournament?.entryFee || 0) > 0 &&
        receiptAsset.uri !== currentPlayerPayment?.receiptUrl
      ) {
        await uploadTournamentPaymentReceipt({
          tournamentId: tournament.id,
          registrationId: savedRegistration.id,
          playerId: effectivePaymentPlayerId,
          receiptUri: receiptAsset.uri,
          fileName: receiptAsset.fileName,
          method: "transferencia",
          uploadedBy: isOrganizerEditing ? "organizer" : currentUser.uid,
          uploadedByName: isOrganizerEditing ? "Organizador" : currentUser.name || "Jugador",
        });
      }

      await onRegistrationCreated?.();

      showFeedback(
        registration
          ? "Inscripcion actualizada"
          : isOrganizerCreating
          ? "Inscripcion cargada exitosamente"
          : "Inscripcion enviada",
        registration
          ? "Tus cambios ya quedaron guardados en el torneo."
          : isOrganizerCreating
          ? ""
          : selectedPartner
          ? "El organizador va a revisar tu solicitud. Pronto puede ser confirmada."
          : "El organizador va a revisar tu solicitud. Pronto puede ser confirmada.",
        "success"
      );
    } catch (error) {
      showFeedback(
        registration ? "No pudimos actualizar la inscripcion" : "No pudimos registrar la solicitud",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setSubmitting(false);
    }
  };

  const submitButtonTitle = registration
    ? submitting
      ? "GUARDANDO..."
      : "GUARDAR CAMBIOS"
    : isOrganizerCreating
    ? submitting
      ? "CARGANDO..."
      : "CARGAR PAREJA"
    : submitting
    ? "ENVIANDO..."
    : "ENVIAR SOLICITUD";

  return (
    <View style={styles.tabBody}>
      <View style={styles.blockCard}>
        <Text style={styles.blockTitleCentered}>INSCRIPCION</Text>
        {!isOrganizerCreating ? (
          <Text style={styles.blockTextCentered}>
            {registration
              ? isOrganizerEditing
                ? "Edita la pareja, los pagos y la disponibilidad de esta inscripcion."
                : "Edita tu compañero, pago y disponibilidad cuando lo necesites."
              : "Completa la pareja y el pago para enviar la inscripcion. La disponibilidad es opcional."}
          </Text>
        ) : null}

        {registration && !isOrganizerCreating ? (
          <View style={styles.registrationStatusCard}>
            <Text style={styles.registrationStatusLabel}>Estado actual</Text>
            <Text
              style={[
                styles.registrationStatusValue,
                withdrawalStatus === "confirmed"
                  ? styles.registrationStatusValueMuted
                  : withdrawalStatus === "requested"
                  ? styles.registrationStatusValueReview
                  : registration?.status === "confirmed"
                  ? styles.registrationStatusValueConfirmed
                  : null,
              ]}
            >
              {getRegistrationStatusLabel(registration)}
            </Text>
          </View>
        ) : null}

        {registration && !isOrganizerPaymentEditor ? (
          <View style={styles.withdrawalActionWrap}>
            {canRequestWithdrawal ? (
              <Pressable
                onPress={() => setWithdrawalModalVisible(true)}
                style={({ pressed }) => [
                  styles.withdrawalButton,
                  pressed ? styles.withdrawalButtonPressed : null,
                ]}
              >
                <Ionicons color="#A43D3D" name="exit-outline" size={16} />
                <Text style={styles.withdrawalButtonText}>Solicitar baja</Text>
              </Pressable>
            ) : withdrawalStatus === "requested" ? (
              <Pressable
                onPress={handleCancelWithdrawalRequest}
                style={({ pressed }) => [
                  styles.withdrawalChip,
                  styles.withdrawalChipRequested,
                  pressed ? styles.withdrawalButtonPressed : null,
                ]}
              >
                <Ionicons
                  color="#2D5B8C"
                  name="refresh-outline"
                  size={14}
                />
                <Text
                  style={[
                    styles.withdrawalChipText,
                    styles.withdrawalChipTextRequested,
                  ]}
                >
                  Cancelar pedido de baja
                </Text>
              </Pressable>
            ) : withdrawalStatus !== "none" ? (
              <View
                style={[
                  styles.withdrawalChip,
                  withdrawalStatus === "confirmed"
                    ? styles.withdrawalChipConfirmed
                    : styles.withdrawalChipRequested,
                ]}
              >
                <Ionicons
                  color="#0F5F36"
                  name="checkmark-circle"
                  size={14}
                />
                <Text
                  style={[
                    styles.withdrawalChipText,
                    styles.withdrawalChipTextConfirmed,
                  ]}
                >
                  Baja confirmada
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.registrationActionRow}>
          {registrationSteps.map((step) => (
            <Pressable
              key={step.key}
              onPress={() => setActivePanel(step.key)}
              style={[
                styles.registrationActionButton,
                step.key === "payments" ? styles.registrationActionButtonWide : null,
                step.key === "payments" ? styles.registrationActionButtonCompact : null,
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
              {step.key === "payments" ? (
                <View style={styles.registrationActionLabelRow}>
                  <Text
                    style={[
                      styles.registrationActionText,
                      activePanel === step.key && styles.registrationActionTextActive,
                    ]}
                  >
                    {step.title.toUpperCase()}
                  </Text>
                  <Ionicons
                    color={
                      step.ready
                        ? activePanel === step.key
                          ? "#A7F3D0"
                          : "#1D7A34"
                        : activePanel === step.key
                        ? "#FECACA"
                        : "#B24343"
                    }
                    name={step.ready ? "checkmark-circle" : "hourglass-outline"}
                    size={16}
                  />
                </View>
              ) : (
                <>
                  <Text
                    style={[
                      styles.registrationActionText,
                      activePanel === step.key && styles.registrationActionTextActive,
                    ]}
                  >
                    {step.title.toUpperCase()}
                  </Text>
                  <View style={styles.registrationActionStatusBelow}>
                    <Ionicons
                      color={
                        step.ready
                          ? activePanel === step.key
                            ? "#A7F3D0"
                            : "#1D7A34"
                          : activePanel === step.key
                          ? "#FECACA"
                          : "#B24343"
                      }
                      name={step.ready ? "checkmark-circle" : "hourglass-outline"}
                      size={16}
                    />
                  </View>
                </>
              )}
            </Pressable>
          ))}
        </View>
      </View>

      {activePanel === "partner" ? (
        <View style={styles.blockCard}>
          <Text style={styles.blockTitleCentered}>
            {isOrganizerCreating ? "CONFORMAR PAREJA" : "MI COMPAÑERO"}
          </Text>
          {isOrganizerCreating ? (
            <View style={styles.organizerPairSection}>
              <View style={styles.pairSlotsColumn}>
                {[
                  { key: "player1", label: "Jugador 1", player: selectedPlayer1 },
                  { key: "player2", label: "Jugador 2", player: selectedPartner },
                ].map((slot) => {
                  const isSelected = Boolean(slot.player);

                  return (
                    <View key={slot.key} style={styles.organizerPlayerCard}>
                      <View style={styles.pairSlotHeader}>
                        <Text style={styles.organizerPlayerLabel}>{slot.label}</Text>
                        <View style={styles.organizerPlayerStatusIconWrap}>
                          <Ionicons
                            color={isSelected ? "#1D7A34" : "#B24343"}
                            name={isSelected ? "checkmark-circle" : "hourglass-outline"}
                            size={18}
                          />
                        </View>
                      </View>
                      <Text numberOfLines={2} style={styles.organizerPlayerName}>
                        {slot.player ? getPlayerDisplayName(slot.player) : "Sin jugador asignado"}
                      </Text>
                      <View style={styles.organizerPlayerActions}>
                        <Pressable
                          onPress={() => handleOpenPlayerPicker(slot.key)}
                          style={styles.organizerAddButton}
                        >
                          <Text style={styles.organizerAddButtonText}>
                            AGREGAR
                          </Text>
                        </Pressable>

                        {slot.player ? (
                          <Pressable
                            onPress={() => {
                              if (slot.key === "player1") {
                                setSelectedPlayer1(null);
                                setPlayer1Query("");
                                return;
                              }

                              setSelectedPartner(null);
                              setPartnerQuery("");
                            }}
                            style={styles.deletePlayerIconButton}
                          >
                            <Ionicons color="#B24343" name="trash" size={16} />
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </View>
              {categoryWarning ? (
                <View style={styles.categoryWarningCard}>
                  <Ionicons color="#A15B00" name="alert-circle-outline" size={18} />
                  <Text style={styles.categoryWarningText}>{categoryWarning}</Text>
                </View>
              ) : null}
            </View>
          ) : (
            !selectedPartner ? (
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
                  setPartnerQuery(getPlayerDisplayName(item.player));
                }}
                placeholder="Nombre, categoria o ciudad"
                showSuggestions={!selectedPartner && partnerSuggestions.length > 0}
                suggestions={partnerSuggestions}
                value={partnerQuery}
              />
            ) : null
          )}

          {playersLoading ? (
            <Text style={styles.blockText}>Cargando jugadores registrados...</Text>
          ) : null}

          {!isOrganizerCreating && selectedPartner ? (
            <View style={styles.selectedPartnerCard}>
              <View style={styles.selectedPartnerCopy}>
                <Text style={styles.selectedPartnerTitle}>
                  {buildPartnerLabel(selectedPartner) || selectedPartner.nombre}
                </Text>
                <Text style={styles.selectedPartnerSubtitle}>
                  {[selectedPartner.categoria, selectedPartner.ciudad].filter(Boolean).join(" - ") ||
                    "Jugador seleccionado"}
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
      ) : null}

      {activePanel === "availability" ? (
        <View style={styles.blockCard}>
          <Text style={styles.blockTitleCentered}>DISPONIBILIDAD</Text>
          <Text style={styles.blockTextCentered}>
            Si queres, podes cargar horarios para que el organizador pueda acomodar mejor el torneo.
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
          {isOrganizerPaymentEditor ? (
            <>
              {organizerPaymentParticipants.length ? (
                <View style={styles.organizerPaymentCards}>
                  {organizerPaymentParticipants.map((participant) => {
                    const participantMethod = paymentMethodByPlayer[participant.key] || "";
                    const participantReceipt = receiptAssetByPlayer[participant.key]?.uri;

                    return (
                      <View key={participant.key} style={styles.organizerPaymentSimpleCard}>
                        <View style={styles.organizerPaymentCardHeader}>
                          <View style={styles.organizerPaymentCardTitleRow}>
                            <Ionicons color={colors.primaryDark} name="cash-outline" size={18} />
                            <Text style={styles.organizerPaymentSimpleTitle}>{participant.label}</Text>
                          </View>
                          {participantReceipt ? (
                            <Ionicons color="#1D7A34" name="checkmark-circle" size={18} />
                          ) : null}
                        </View>
                        <View style={styles.organizerPaymentInlineMethods}>
                          {[
                            { key: "efectivo", label: "EFECTIVO" },
                            { key: "transferencia", label: "TRANSFERENCIA" },
                          ].map((option) => {
                            const isMethodSelected = participantMethod === option.key;

                            return (
                              <Pressable
                                key={option.key}
                                onPress={() => {
                                  setPaymentMethodByPlayer((current) => {
                                    const currentValue = current[participant.key] || "";
                                    return {
                                      ...current,
                                      [participant.key]: currentValue === option.key ? "" : option.key,
                                    };
                                  });
                                }}
                                style={[
                                  styles.organizerInlineMethodButton,
                                  isMethodSelected ? styles.organizerInlineMethodButtonActive : null,
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.organizerInlineMethodButtonText,
                                    isMethodSelected ? styles.organizerInlineMethodButtonTextActive : null,
                                  ]}
                                >
                                  {option.label}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                        {participantMethod === "transferencia" ? (
                          <Pressable
                            onPress={() => {
                              setPaymentTargetPlayerId(participant.key);
                              handlePickReceipt();
                            }}
                            style={styles.organizerReceiptButton}
                          >
                            <Text style={styles.organizerReceiptButtonText}>
                              {participantReceipt ? "CAMBIAR COMPROBANTE" : "CARGAR COMPROBANTE"}
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              ) : null}
              {!organizerPaymentParticipants.length ? (
                <View style={styles.registrationHintCard}>
                  <Ionicons color={colors.primaryDark} name="people-outline" size={18} />
                  <Text style={styles.registrationHintText}>
                    Primero conforma la pareja para cargar los pagos por jugador.
                  </Text>
                </View>
              ) : null}
            </>
          ) : requiresTransferReceipt ? (
            <>
              <Text style={styles.blockTextCentered}>
                Alias: {tournament?.paymentAlias || "Alias a confirmar por organizador"}
              </Text>
              {tournamentMercadoPagoConfig.enabled ? (
                <Pressable
                  onPress={handleOpenMercadoPagoInfo}
                  style={({ pressed }) => [
                    styles.mercadoPagoInfoButton,
                    pressed ? styles.receiptPickerButtonPressed : null,
                  ]}
                >
                  <Ionicons color="#1A7F5A" name="wallet-outline" size={18} />
                  <Text style={styles.mercadoPagoInfoButtonText}>Mercado Pago</Text>
                </Pressable>
              ) : null}
              {availablePayments.length > 1 ? (
                <View style={styles.paymentTargetsRow}>
                  {availablePayments.map((payment) => {
                    const targetId = payment.playerId || payment.userId || "";
                    const isSelected =
                      normalizeText(targetId) === normalizeText(effectivePaymentPlayerId);

                    return (
                      <Pressable
                        key={targetId || payment.playerName}
                        onPress={() => setPaymentTargetPlayerId(targetId)}
                        style={[
                          styles.paymentTargetChip,
                          isSelected ? styles.paymentTargetChipActive : null,
                        ]}
                      >
                        <Text
                          style={[
                            styles.paymentTargetChipText,
                            isSelected ? styles.paymentTargetChipTextActive : null,
                          ]}
                        >
                          {payment.playerName}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
              {currentPlayerPayment?.status ? (
                <Text style={styles.paymentStatusText}>
                  Estado del comprobante: {getPaymentStatusLabel(currentPlayerPayment.status)}
                </Text>
              ) : null}
              {receiptAsset?.uri ? (
                <View style={styles.receiptPreviewCard}>
                  {isPdfReceipt(receiptAsset) ? (
                    <View style={styles.receiptPdfPreview}>
                      <Ionicons color="#B24343" name="document-text-outline" size={34} />
                      <Text style={styles.receiptPdfPreviewText}>PDF</Text>
                    </View>
                  ) : (
                    <Image source={{ uri: receiptAsset.uri }} style={styles.receiptPreviewImage} />
                  )}
                  <Text numberOfLines={1} style={styles.receiptPreviewName}>
                    {receiptAsset.fileName}
                  </Text>
                </View>
              ) : null}
              <View style={styles.receiptPickerActions}>
                <Pressable
                  onPress={() => handlePickReceipt("image")}
                  style={({ pressed }) => [
                    styles.receiptPickerButton,
                    pressed ? styles.receiptPickerButtonPressed : null,
                  ]}
                >
                  <Ionicons color={colors.primaryDark} name="image-outline" size={18} />
                  <Text style={styles.receiptPickerButtonText}>
                    {receiptAsset?.uri ? "CAMBIAR IMAGEN" : "IMAGEN"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => handlePickReceipt("pdf")}
                  style={({ pressed }) => [
                    styles.receiptPickerButton,
                    pressed ? styles.receiptPickerButtonPressed : null,
                  ]}
                >
                  <Ionicons color={colors.primaryDark} name="document-text-outline" size={18} />
                  <Text style={styles.receiptPickerButtonText}>
                    {receiptAsset?.uri ? "CAMBIAR PDF" : "PDF"}
                  </Text>
                </Pressable>
              </View>
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
          (isOrganizerCreating && (!selectedPlayer1 || !selectedPartner)) ||
          (!isOrganizerPaymentEditor &&
            requiresTransferReceipt &&
            !receiptAsset?.uri &&
            !hasExistingReceipt &&
            !canSubmitManualPairRequest)
        }
        onPress={handleSubmitRegistration}
        title={submitButtonTitle}
      />

      <AvailabilityEditor
        dayOptions={Array.isArray(tournamentDayOptions) && tournamentDayOptions.length ? tournamentDayOptions : null}
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

      <Modal
        animationType="fade"
        onRequestClose={() => (submitting ? null : setWithdrawalModalVisible(false))}
        transparent
        visible={withdrawalModalVisible}
      >
        <View style={styles.withdrawalModalOverlay}>
          <Pressable
            onPress={() => (submitting ? null : setWithdrawalModalVisible(false))}
            style={styles.withdrawalModalBackdrop}
          />
          <View style={styles.withdrawalModalCard}>
            <Text style={styles.withdrawalModalTitle}>Solicitar baja</Text>
            <Text style={styles.withdrawalModalText}>
              Vamos a avisarle al organizador para que confirme tu baja del torneo.
            </Text>

            <View style={styles.withdrawalModalActions}>
              <Pressable
                disabled={submitting}
                onPress={() => setWithdrawalModalVisible(false)}
                style={({ pressed }) => [
                  styles.withdrawalModalButton,
                  styles.withdrawalModalButtonSecondary,
                  pressed ? styles.withdrawalModalButtonPressed : null,
                ]}
              >
                <Text style={styles.withdrawalModalButtonSecondaryText}>Cancelar</Text>
              </Pressable>

              <Pressable
                disabled={submitting}
                onPress={handleRequestWithdrawal}
                style={({ pressed }) => [
                  styles.withdrawalModalButton,
                  styles.withdrawalModalButtonDanger,
                  pressed ? styles.withdrawalModalButtonPressed : null,
                ]}
              >
                <Text style={styles.withdrawalModalButtonDangerText}>
                  {submitting ? "Enviando..." : "Solicitar baja"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        onRequestClose={() => setPlayerPickerVisible(false)}
        transparent
        visible={playerPickerVisible}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalOverlay}
        >
          <Pressable onPress={() => setPlayerPickerVisible(false)} style={styles.modalBackdrop} />
          <View style={[styles.modalCard, styles.playerPickerModalCard]}>
            <Text style={styles.modalTitle}>
              {activePairSlot === "player1" ? "Seleccionar Jugador 1" : "Seleccionar Jugador 2"}
            </Text>

            <TextInput
              onChangeText={setPlayerPickerQuery}
              placeholder="Buscar jugador"
              placeholderTextColor={colors.muted}
              style={styles.modalInput}
              value={playerPickerQuery}
            />

            <SelectField
              containerStyle={styles.playerCategorySelectWrap}
              fieldStyle={styles.playerCategorySelectField}
              label="Categoria"
              labelStyle={styles.playerCategorySelectLabel}
              onClose={() => setPlayerCategoryPickerVisible(false)}
              onOpen={() => setPlayerCategoryPickerVisible(true)}
              onSelect={setPlayerCategoryFilter}
              options={playerCategorySelectOptions}
              placeholder="Todas las categorias"
              value={playerCategoryFilter}
              visible={playerCategoryPickerVisible}
            />

            <Pressable
              onPress={() => {
                setPlayerPickerVisible(false);
                setGuestTarget(activePairSlot);
                setGuestModalVisible(true);
              }}
              style={styles.createGuestInlineButton}
            >
              <Text style={styles.createGuestInlineButtonText}>Crear no registrado</Text>
            </Pressable>

            <ScrollView
              contentContainerStyle={styles.playerPickerList}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {playerPickerResults.map((player) => (
                <Pressable
                  key={player.id}
                  onPress={() => handleSelectPlayerForSlot(activePairSlot, player)}
                  style={styles.playerPickerItem}
                >
                  {hasProfileImage(player?.foto) ? (
                    <Image source={{ uri: player.foto }} style={styles.playerPickerAvatar} />
                  ) : (
                    <View style={styles.playerPickerAvatarPlaceholder}>
                      <Ionicons color="#9CA3AF" name="person" size={18} />
                    </View>
                  )}
                  <View style={styles.playerPickerCopy}>
                    <Text style={styles.playerPickerName}>{getPlayerDisplayName(player)}</Text>
                    <Text style={styles.playerPickerMeta}>
                      {[player.categoria, player.ciudad].filter(Boolean).join(" - ") || "Jugador registrado"}
                    </Text>
                  </View>
                  <Ionicons color={colors.primaryDark} name="chevron-forward" size={18} />
                </Pressable>
              ))}

              {!playerPickerResults.length ? (
                <View style={styles.playerPickerEmpty}>
                  <Text style={styles.playerPickerEmptyText}>No encontramos jugadores con ese filtro.</Text>
                </View>
              ) : null}
            </ScrollView>

            <View style={styles.modalActions}>
              <Pressable onPress={() => setPlayerPickerVisible(false)} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Cancelar</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        animationType="slide"
        onRequestClose={() => setGuestModalVisible(false)}
        transparent
        visible={guestModalVisible}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.modalOverlay}
        >
          <Pressable onPress={() => setGuestModalVisible(false)} style={styles.modalBackdrop} />
          <View style={[styles.modalCard, styles.guestModalCard]}>
            <ScrollView
              contentContainerStyle={styles.guestModalScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.modalTitle}>Agregar jugador manual</Text>
              <Text style={styles.modalText}>
                Este jugador quedara cargado solo dentro de esta inscripcion del torneo.
              </Text>
              <TextInput
                onChangeText={setGuestName}
                placeholder="Nombre"
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={guestName}
              />
              <TextInput
                onChangeText={setGuestLastName}
                placeholder="Apellido"
                placeholderTextColor={colors.muted}
                style={styles.modalInput}
                value={guestLastName}
              />
              <SelectField
                label="Categoria"
                onClose={() => setGuestCategoryPickerVisible(false)}
                onOpen={() => setGuestCategoryPickerVisible(true)}
                onSelect={setGuestCategory}
                options={LEAGUE_CATEGORY_OPTIONS}
                placeholder="Seleccionar categoria"
                value={guestCategory}
                visible={guestCategoryPickerVisible}
              />
              <View style={styles.guestSexRow}>
                {["Masculino", "Femenino"].map((sexOption) => (
                  <Pressable
                    key={sexOption}
                    onPress={() => setGuestSex(sexOption)}
                    style={[
                      styles.guestSexChip,
                      guestSex === sexOption ? styles.guestSexChipActive : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.guestSexChipText,
                        guestSex === sexOption ? styles.guestSexChipTextActive : null,
                      ]}
                    >
                      {sexOption}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
            <View style={[styles.modalActions, styles.guestModalActions]}>
              <Pressable onPress={() => setGuestModalVisible(false)} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Cancelar</Text>
              </Pressable>
              <Pressable onPress={handleCreateGuestPlayer} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>Agregar</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  tabBody: {
    gap: spacing.md,
  },
  blockCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    padding: spacing.md,
  },
  blockText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
    marginTop: spacing.xs,
  },
  blockTextCentered: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  blockTitleCentered: {
    color: colors.primaryDark,
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
    textTransform: "uppercase",
  },
  paymentStatusText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
    marginTop: spacing.sm,
    textAlign: "center",
  },
  organizerPairSection: {
    marginBottom: spacing.sm,
  },
  pairSlotsColumn: {
    gap: spacing.sm,
  },
  pairSlotHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 20,
  },
  organizerPlayerCard: {
    backgroundColor: "#F5FAF7",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    padding: spacing.sm,
  },
  organizerPlayerLabel: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  organizerPlayerStatusIconWrap: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 20,
  },
  organizerPlayerName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 18,
    marginTop: spacing.sm,
  },
  organizerPlayerMeta: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 6,
  },
  organizerPlayerActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  categoryWarningCard: {
    alignItems: "center",
    backgroundColor: "#FFF7E8",
    borderColor: "#F3D7A0",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  categoryWarningText: {
    color: "#8A5A00",
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
    marginLeft: spacing.sm,
  },
  organizerAddButton: {
    alignItems: "center",
    backgroundColor: "#EDF7F2",
    borderColor: "#C9E5D8",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  organizerAddButtonText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
  },
  deletePlayerIconButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 34,
    minWidth: 34,
  },
  clearPlayerButton: {
    alignItems: "center",
    backgroundColor: "#FFF1F1",
    borderColor: "#F1C8C8",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: spacing.md,
  },
  clearPlayerButtonText: {
    color: "#B24343",
    fontSize: 12,
    fontWeight: "800",
  },
  paymentTargetChip: {
    backgroundColor: "#F3F6F8",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  paymentTargetChipActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  paymentTargetChipText: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "800",
  },
  paymentTargetChipTextActive: {
    color: colors.surface,
  },
  paymentTargetsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  organizerPaymentCards: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  organizerPaymentSimpleCard: {
    backgroundColor: "#F8FAFC",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    padding: spacing.sm,
  },
  organizerPaymentCardHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  organizerPaymentCardTitleRow: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
  },
  organizerPaymentSimpleTitle: {
    color: colors.primaryDark,
    flex: 1,
    fontSize: 13,
    fontWeight: "800",
    paddingRight: spacing.sm,
  },
  organizerPaymentInlineMethods: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  organizerInlineMethodButton: {
    alignItems: "center",
    backgroundColor: "#F3F6F8",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 34,
    paddingHorizontal: spacing.md,
  },
  organizerInlineMethodButtonActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  organizerInlineMethodButtonText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
  },
  organizerInlineMethodButtonTextActive: {
    color: colors.surface,
  },
  organizerReceiptButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#EDF4FF",
    borderColor: "#BFD3F3",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: spacing.sm,
    minHeight: 34,
    paddingHorizontal: spacing.md,
  },
  organizerReceiptButtonText: {
    color: "#214A84",
    fontSize: 11,
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
  receiptPickerActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  receiptPickerButton: {
    alignItems: "center",
    backgroundColor: colors.secondary,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: spacing.sm,
  },
  receiptPickerButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  receiptPickerButtonText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "800",
  },
  mercadoPagoInfoButton: {
    alignItems: "center",
    backgroundColor: "#F3FBF7",
    borderColor: "#BFE5CD",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    marginTop: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  mercadoPagoInfoButtonText: {
    color: "#1A7F5A",
    fontSize: 13,
    fontWeight: "800",
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15,23,42,0.35)",
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: "88%",
    padding: spacing.lg,
    paddingTop: spacing.xl + spacing.xs,
  },
  guestModalCard: {
    maxHeight: "84%",
    paddingBottom: spacing.xl + 26,
  },
  playerPickerModalCard: {
    maxHeight: "84%",
    paddingBottom: spacing.xl + 26,
  },
  guestModalScrollContent: {
    paddingBottom: spacing.sm,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 24,
    textAlign: "center",
  },
  modalText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  playerCategorySelectWrap: {
    marginTop: spacing.sm,
  },
  playerCategorySelectLabel: {
    textAlign: "center",
  },
  playerCategorySelectField: {
    minHeight: 46,
  },
  createGuestInlineButton: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#FFF2D9",
    borderColor: "#E8BA63",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: spacing.sm,
    minHeight: 38,
    paddingHorizontal: spacing.lg,
  },
  createGuestInlineButtonText: {
    color: "#A15B00",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  playerPickerList: {
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  playerPickerItem: {
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  playerPickerAvatar: {
    borderRadius: 20,
    height: 40,
    marginRight: spacing.sm,
    width: 40,
  },
  playerPickerAvatarPlaceholder: {
    alignItems: "center",
    backgroundColor: "#E5E7EB",
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    marginRight: spacing.sm,
    width: 40,
  },
  playerPickerCopy: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  playerPickerName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  playerPickerMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
  playerPickerEmpty: {
    backgroundColor: "#F8FAFC",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  playerPickerEmptyText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
  modalInput: {
    backgroundColor: "#F8FAFC",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    color: colors.text,
    fontSize: 14,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  guestSexRow: {
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  guestSexChip: {
    backgroundColor: "#F3F6F8",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  guestSexChipActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  guestSexChipText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
  },
  guestSexChipTextActive: {
    color: colors.surface,
  },
  modalActions: {
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    marginTop: spacing.lg,
  },
  guestModalActions: {
    marginTop: spacing.md,
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
  },
  secondaryButtonText: {
    color: colors.primaryDark,
    fontSize: 14,
    fontWeight: "800",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
  },
  primaryButtonText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: "800",
  },
  receiptPreviewImage: {
    borderRadius: 8,
    height: 150,
    resizeMode: "cover",
    width: "100%",
  },
  receiptPdfPreview: {
    alignItems: "center",
    backgroundColor: "#FFF3F3",
    borderColor: "#E8C5C5",
    borderRadius: 8,
    borderWidth: 1,
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 110,
    width: "100%",
  },
  receiptPdfPreviewText: {
    color: "#B24343",
    fontSize: 12,
    fontWeight: "900",
  },
  receiptPreviewName: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700",
    marginTop: spacing.sm,
  },
  registrationActionButton: {
    alignItems: "center",
    backgroundColor: "#F5FAF7",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexBasis: "48%",
    minHeight: 84,
    minWidth: "48%",
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  registrationActionButtonActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  registrationActionButtonWide: {
    flexBasis: "100%",
    minWidth: "100%",
  },
  registrationActionButtonCompact: {
    minHeight: 58,
    paddingVertical: 6,
  },
  registrationActionMeta: {
    color: "#A36C17",
    fontSize: 11,
    fontWeight: "800",
    marginTop: 6,
    textAlign: "center",
    textTransform: "uppercase",
  },
  registrationActionMetaActive: {
    color: colors.surface,
  },
  registrationActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  registrationActionText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 4,
    textAlign: "center",
    textTransform: "uppercase",
  },
  registrationActionTextActive: {
    color: colors.surface,
  },
  registrationActionLabelRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    marginTop: 4,
  },
  registrationActionStatusBelow: {
    marginTop: 4,
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
  registrationStatusCard: {
    alignItems: "center",
    backgroundColor: "#EFF8F4",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  registrationStatusLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  registrationStatusValue: {
    color: colors.primaryDark,
    fontSize: 16,
    fontWeight: "900",
    marginTop: 2,
    textTransform: "uppercase",
  },
  registrationStatusValueConfirmed: {
    color: "#0F5F36",
  },
  registrationStatusValueReview: {
    color: "#2D5B8C",
  },
  registrationStatusValueMuted: {
    color: "#576773",
  },
  withdrawalActionWrap: {
    alignItems: "center",
    marginTop: spacing.sm,
  },
  withdrawalButton: {
    alignItems: "center",
    backgroundColor: "#FFF3F3",
    borderColor: "#E9BABA",
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  withdrawalButtonPressed: {
    opacity: 0.84,
  },
  withdrawalButtonText: {
    color: "#A43D3D",
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  withdrawalChip: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  withdrawalChipConfirmed: {
    backgroundColor: "#E7F8EC",
    borderColor: "#8ED4A4",
  },
  withdrawalChipRequested: {
    backgroundColor: "#EAF4FF",
    borderColor: "#A9C8E7",
  },
  withdrawalChipText: {
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  withdrawalChipTextConfirmed: {
    color: "#0F5F36",
  },
  withdrawalChipTextRequested: {
    color: "#2D5B8C",
  },
  withdrawalModalOverlay: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
  },
  withdrawalModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(10,22,18,0.42)",
  },
  withdrawalModalCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: spacing.lg,
    width: "100%",
  },
  withdrawalModalTitle: {
    color: colors.primaryDark,
    fontSize: 19,
    fontWeight: "900",
    textAlign: "center",
  },
  withdrawalModalText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  withdrawalModalActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  withdrawalModalButton: {
    alignItems: "center",
    borderRadius: 14,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  withdrawalModalButtonSecondary: {
    backgroundColor: "#EEF2F0",
  },
  withdrawalModalButtonDanger: {
    backgroundColor: "#C94E4E",
  },
  withdrawalModalButtonPressed: {
    opacity: 0.88,
  },
  withdrawalModalButtonSecondaryText: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  withdrawalModalButtonDangerText: {
    color: colors.surface,
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  registrationStepDescription: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
    marginTop: 4,
    textAlign: "center",
  },
  registrationStepDescriptionActive: {
    color: "rgba(255,255,255,0.82)",
  },
  registrationStepStatusReady: {
    color: colors.primaryDark,
  },
  sectionButton: {
    marginTop: spacing.sm,
  },
  selectedPartnerCard: {
    alignItems: "center",
    backgroundColor: "#F5FAF7",
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  selectedPartnerCopy: {
    flex: 1,
  },
  selectedPartnerRemove: {
    color: "#B44B4B",
    fontSize: 12,
    fontWeight: "800",
  },
  selectedPartnerSubtitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
  selectedPartnerTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
});
