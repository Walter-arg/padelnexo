import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";

import BottomQuickActionsBar, {
  BOTTOM_QUICK_ACTIONS_SPACE,
} from "../components/BottomQuickActionsBar";
import FeedbackModal from "../components/FeedbackModal";
import LeagueHeaderCard from "../components/LeagueHeaderCard";
import SectionHeader from "../components/SectionHeader";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import {
  canManageLeague,
  getLeagueById,
  updateLeaguePlayers,
} from "../services/leaguesService";
import { listPlayers } from "../services/playersService";
import { formatPlayerShortName } from "../utils/playerDisplayName";

const DEFAULT_MINIMUM_LEAGUE_PLAYERS = 8;

function normalizeText(value = "") {
  return String(value).trim().toLowerCase();
}

function normalizePairNumber(value) {
  const parsedValue = Number.parseInt(value, 10);

  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : null;
}

function normalizeSexValue(value = "") {
  const normalizedValue = normalizeText(value);

  if (normalizedValue.startsWith("masculino") || normalizedValue.startsWith("cab")) {
    return "masculino";
  }

  if (normalizedValue.startsWith("femenino") || normalizedValue.startsWith("dam")) {
    return "femenino";
  }

  return "";
}

function isMixedSexValue(value = "") {
  const normalizedValue = normalizeText(value);

  return normalizedValue === "mixto" || normalizedValue === "mixta";
}

function buildPendingGuestValue(name = "", lastName = "") {
  return JSON.stringify({
    name: String(name || "").trim(),
    lastName: String(lastName || "").trim(),
  });
}

function parsePendingGuestValue(value = "") {
  try {
    const parsedValue = JSON.parse(value);

    return {
      name: String(parsedValue?.name || "").trim(),
      lastName: String(parsedValue?.lastName || "").trim(),
    };
  } catch (error) {
    return {
      name: String(value || "").trim(),
      lastName: "",
    };
  }
}

function formatPlayerFullName(player = {}) {
  return [player.nombre, player.apellido].filter(Boolean).join(" ") || "Jugador";
}

function buildRegisteredLeaguePlayer(player, sideOverride = "", pairNumber = null) {
  return {
    id: `registered-${player.id}`,
    type: "registered",
    linkedUserId: player.id,
    nombre: player.nombre || "Jugador",
    apellido: player.apellido || "",
    categoria: player.categoria || "",
    sexo: player.sexo || "",
    ciudad: player.ciudad || "",
    provincia: player.provincia || "",
    foto: player.foto || "",
    ladoJuego: sideOverride || player.ladoJuego || "ambos",
    ladoPreferido:
      sideOverride === "drive"
        ? "Drive"
        : sideOverride === "reves"
        ? "Reves"
        : player.ladoPreferido || "Ambos lados",
    pairNumber: normalizePairNumber(pairNumber),
  };
}

function buildGuestLeaguePlayer(name, sideOverride = "", pairNumber = null, lastName = "") {
  return {
    id: `guest-${Date.now()}`,
    type: "guest",
    linkedUserId: "",
    nombre: String(name || "").trim(),
    apellido: String(lastName || "").trim(),
    categoria: "",
    sexo: "",
    ciudad: "",
    provincia: "",
    foto: "",
    ladoJuego: sideOverride || "ambos",
    ladoPreferido: sideOverride === "drive" ? "Drive" : sideOverride === "reves" ? "Reves" : "Ambos lados",
    pairNumber: normalizePairNumber(pairNumber),
  };
}

export default function LeaguePlayersScreen({ navigation, route }) {
  const { userData } = useAuth();
  const leagueId = route?.params?.leagueId || "";
  const fallbackLeagueName = route?.params?.leagueName || "Liga";
  const [league, setLeague] = useState(null);
  const [registeredPlayers, setRegisteredPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [guestModalVisible, setGuestModalVisible] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [guestLastName, setGuestLastName] = useState("");
  const [sidePickerVisible, setSidePickerVisible] = useState(false);
  const [pairPickerVisible, setPairPickerVisible] = useState(false);
  const [expandedPairNumbers, setExpandedPairNumbers] = useState([]);
  const [pendingRegisteredPlayer, setPendingRegisteredPlayer] = useState(null);
  const [pendingGuestName, setPendingGuestName] = useState("");
  const [replacementTargetId, setReplacementTargetId] = useState("");
  const [feedback, setFeedback] = useState({
    visible: false,
    title: "",
    message: "",
    tone: "default",
  });

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      const loadData = async () => {
        try {
          setLoading(true);
          const [leagueData, appPlayers] = await Promise.all([
            getLeagueById(leagueId),
            listPlayers(),
          ]);

          if (!isMounted) {
            return;
          }

          setLeague(leagueData);
          setRegisteredPlayers(appPlayers);
        } catch (error) {
          if (isMounted) {
            setFeedback({
              visible: true,
              title: "No pudimos cargar los jugadores",
              message: error?.message || "Intenta nuevamente en unos instantes.",
              tone: "danger",
            });
          }
        } finally {
          if (isMounted) {
            setLoading(false);
          }
        }
      };

      loadData();

      return () => {
        isMounted = false;
      };
    }, [leagueId])
  );

  const showFeedback = (title, message, tone = "default") => {
    setFeedback({
      visible: true,
      title,
      message,
      tone,
    });
  };

  const leaguePlayers = league?.players || [];
  const minimumPlayersCount = Math.max(
    2,
    Number.parseInt(league?.fixtureConfig?.minPlayersCount, 10) || DEFAULT_MINIMUM_LEAGUE_PLAYERS
  );
  const canManage = league ? canManageLeague(league, userData) : false;
  const isIndividualLeague = league?.teamType === "individual";
  const isPairLeague = league?.teamType === "pair";
  const isMixedPairLeague = isPairLeague && isMixedSexValue(league?.sexo);
  const pairNumbers = useMemo(
    () => Array.from({ length: minimumPlayersCount }, (_, index) => index + 1),
    [minimumPlayersCount]
  );
  const pairGroups = useMemo(
    () =>
      pairNumbers.map((pairNumber) => ({
        pairNumber,
        players: leaguePlayers.filter(
          (player) => normalizePairNumber(player.pairNumber) === pairNumber
        ),
      })),
    [leaguePlayers, pairNumbers]
  );
  const pairPickerGroups = useMemo(() => {
    const maxExistingPairNumber = leaguePlayers.reduce(
      (highest, player) => Math.max(highest, normalizePairNumber(player.pairNumber) || 0),
      minimumPlayersCount
    );
    const pickerPairNumbers = Array.from(
      { length: maxExistingPairNumber + 1 },
      (_, index) => index + 1
    );

    return pickerPairNumbers.map((pairNumber) => ({
      pairNumber,
      players: leaguePlayers.filter(
        (player) => normalizePairNumber(player.pairNumber) === pairNumber
      ),
    }));
  }, [leaguePlayers, minimumPlayersCount]);
  const completePairsCount = pairGroups.filter((pair) => pair.players.length >= 2).length;
  const pairPlayersTargetCount = minimumPlayersCount * 2;
  const currentCount = isPairLeague ? completePairsCount : leaguePlayers.length;
  const missingPlayersCount = isPairLeague
    ? Math.max(0, pairPlayersTargetCount - leaguePlayers.length)
    : Math.max(0, minimumPlayersCount - currentCount);
  const sideTargetCount = Math.ceil(minimumPlayersCount / 2);
  const driveCount = leaguePlayers.filter((player) => player.ladoJuego === "drive").length;
  const revesCount = leaguePlayers.filter((player) => player.ladoJuego === "reves").length;

  const filteredRegisteredPlayers = useMemo(() => {
    const normalizedQuery = normalizeText(query);

    return registeredPlayers.filter((player) => {
      if (!normalizedQuery) {
        return true;
      }

      return (
        normalizeText(`${player.nombre || ""} ${player.apellido || ""}`).includes(normalizedQuery) ||
        normalizeText(player.categoria).includes(normalizedQuery) ||
        normalizeText(player.ciudad).includes(normalizedQuery)
      );
    });
  }, [query, registeredPlayers]);

  const persistPlayers = async (nextPlayers, successMessage) => {
    if (!league?.id) {
      return;
    }

    try {
      setSaving(true);
      await updateLeaguePlayers(league.id, nextPlayers);
      setLeague((current) =>
        current
          ? {
              ...current,
              players: nextPlayers,
            }
          : current
      );

      if (successMessage) {
        showFeedback("Jugadores actualizados", successMessage, "success");
      }
    } catch (error) {
      showFeedback(
        "No pudimos guardar los jugadores",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setSaving(false);
    }
  };

  const getMixedPairCompatibility = (player, pairNumber, targetPlayerId = "") => {
    if (!isMixedPairLeague || !pairNumber || !player) {
      return { valid: true };
    }

    const playerSex = normalizeSexValue(player.sexo);

    if (!playerSex) {
      return { valid: true };
    }

    const samePairPlayers = leaguePlayers.filter(
      (entry) =>
        entry.id !== targetPlayerId &&
        normalizePairNumber(entry.pairNumber) === normalizePairNumber(pairNumber)
    );
    const sameSexPartner = samePairPlayers.find(
      (entry) => normalizeSexValue(entry.sexo) === playerSex
    );

    if (!sameSexPartner) {
      return { valid: true };
    }

    return {
      valid: false,
      message:
        "Esta liga es mixta. No puedes asignar dos jugadores registrados del mismo sexo en la misma pareja.",
    };
  };

  const showMixedPairCompatibilityError = (message) => {
    showFeedback("Pareja mixta requerida", message, "danger");
  };

  const addRegisteredPlayerToLeague = async (player, sideOverride = "", pairNumber = null) => {
    if (!canManage) {
      return;
    }

    const alreadyExists = leaguePlayers.some(
      (entry) =>
        entry.id !== replacementTargetId &&
        normalizeText(entry.linkedUserId) === normalizeText(player.id)
    );

    if (alreadyExists && !replacementTargetId) {
      showFeedback(
        "Jugador repetido",
        "Ese jugador ya forma parte de la liga.",
        "danger"
      );
      return;
    }

    const replacementTarget = leaguePlayers.find((entry) => entry.id === replacementTargetId);
    const targetPairNumber = pairNumber || replacementTarget?.pairNumber || null;
    const compatibility = getMixedPairCompatibility(
      player,
      targetPairNumber,
      replacementTargetId
    );

    if (!compatibility.valid) {
      showMixedPairCompatibilityError(compatibility.message);
      return;
    }

    const registeredLeaguePlayer = buildRegisteredLeaguePlayer(
      player,
      sideOverride || replacementTarget?.ladoJuego || "",
      targetPairNumber
    );

    if (replacementTargetId) {
      if (alreadyExists) {
        showFeedback(
          "Jugador repetido",
          "Ese jugador ya forma parte de la liga y no puede reemplazar a otro sin duplicarse.",
          "danger"
        );
        return;
      }

      const nextPlayers = leaguePlayers.map((entry) =>
        entry.id === replacementTargetId ? registeredLeaguePlayer : entry
      );
      setReplacementTargetId("");
      await persistPlayers(nextPlayers);
      return;
    }

    await persistPlayers([...leaguePlayers, registeredLeaguePlayer]);
  };

  const handleAddRegisteredPlayer = async (player) => {
    if (isIndividualLeague) {
      setPendingRegisteredPlayer(player);
      setPendingGuestName("");
      setSidePickerVisible(true);
      return;
    }

    if (isPairLeague) {
      setPendingRegisteredPlayer(player);
      setPendingGuestName("");
      setPairPickerVisible(true);
      return;
    }

    await addRegisteredPlayerToLeague(player);
  };

  const handleRemovePlayer = async (playerId) => {
    if (!canManage) {
      return;
    }

    const nextPlayers = leaguePlayers.filter((entry) => entry.id !== playerId);
    if (replacementTargetId === playerId) {
      setReplacementTargetId("");
    }
    await persistPlayers(nextPlayers);
  };

  const createGuestPlayerInLeague = async (
    name,
    sideOverride = "",
    pairNumber = null,
    lastName = ""
  ) => {
    if (!canManage) {
      return;
    }

    const normalizedName = String(name || "").trim();

    if (!normalizedName) {
      showFeedback("Falta el nombre", "Escribe el nombre del jugador para agregarlo.", "danger");
      return;
    }

    const normalizedLastName = String(lastName || "").trim();

    if (!normalizedLastName) {
      showFeedback("Falta el apellido", "Escribe el apellido del jugador para agregarlo.", "danger");
      return;
    }

    const alreadyExists = leaguePlayers.some(
      (entry) =>
        normalizeText(`${entry.nombre || ""} ${entry.apellido || ""}`) ===
        normalizeText(`${normalizedName} ${normalizedLastName}`)
    );

    if (alreadyExists) {
      showFeedback(
        "Jugador repetido",
        "Ya existe un jugador con ese nombre dentro de la liga.",
        "danger"
      );
      return;
    }

    const nextPlayers = [
      ...leaguePlayers,
      buildGuestLeaguePlayer(normalizedName, sideOverride, pairNumber, lastName),
    ];
    setGuestName("");
    setGuestLastName("");
    setGuestModalVisible(false);
    await persistPlayers(nextPlayers);
  };

  const handleCreateGuestPlayer = async () => {
    const normalizedName = String(guestName || "").trim();
    const normalizedLastName = String(guestLastName || "").trim();

    if (!normalizedName) {
      showFeedback("Falta el nombre", "Escribe el nombre del jugador para agregarlo.", "danger");
      return;
    }

    if (!normalizedLastName) {
      showFeedback("Falta el apellido", "Escribe el apellido del jugador para agregarlo.", "danger");
      return;
    }

    if (isIndividualLeague) {
      setGuestModalVisible(false);
      setPendingRegisteredPlayer(null);
      setPendingGuestName(buildPendingGuestValue(normalizedName, normalizedLastName));
      setGuestName("");
      setGuestLastName("");
      setSidePickerVisible(true);
      return;
    }

    if (isPairLeague) {
      setGuestModalVisible(false);
      setPendingRegisteredPlayer(null);
      setPendingGuestName(buildPendingGuestValue(normalizedName, normalizedLastName));
      setGuestName("");
      setGuestLastName("");
      setPairPickerVisible(true);
      return;
    }

    await createGuestPlayerInLeague(normalizedName, "", null, normalizedLastName);
  };

  const handleSelectLeagueSide = async (side) => {
    setSidePickerVisible(false);

    if (pendingRegisteredPlayer) {
      const nextPlayer = pendingRegisteredPlayer;
      setPendingRegisteredPlayer(null);
      await addRegisteredPlayerToLeague(nextPlayer, side);
      return;
    }

    if (pendingGuestName) {
      const nextGuest = parsePendingGuestValue(pendingGuestName);
      setPendingGuestName("");
      await createGuestPlayerInLeague(nextGuest.name, side, null, nextGuest.lastName);
    }
  };

  const handleSelectPairNumber = async (pairNumber) => {
    setPairPickerVisible(false);
    setExpandedPairNumbers((current) =>
      current.includes(pairNumber) ? current : [...current, pairNumber]
    );

    if (pendingRegisteredPlayer) {
      const nextPlayer = pendingRegisteredPlayer;
      setPendingRegisteredPlayer(null);
      await addRegisteredPlayerToLeague(nextPlayer, "", pairNumber);
      return;
    }

    if (pendingGuestName) {
      const nextGuest = parsePendingGuestValue(pendingGuestName);
      setPendingGuestName("");
      await createGuestPlayerInLeague(nextGuest.name, "", pairNumber, nextGuest.lastName);
    }
  };

  const togglePairExpanded = (pairNumber) => {
    setExpandedPairNumbers((current) =>
      current.includes(pairNumber)
        ? current.filter((item) => item !== pairNumber)
        : [...current, pairNumber]
    );
  };

  const renderPlayerAvatar = (player, style) => {
    if (player?.foto) {
      return <Image source={{ uri: player.foto }} style={[styles.playerAvatar, style]} />;
    }

    return (
      <View style={[styles.playerAvatarFallback, style]}>
        <Ionicons color="#9CA3AF" name="person" size={16} />
      </View>
    );
  };

  const renderLeaguePlayer = ({ item, index }) => (
    <View style={styles.leaguePlayerCard}>
      <View style={styles.leaguePlayerHeader}>
        <View style={styles.playerIdentity}>
          <View style={[styles.playerTypeDot, item.type === "guest" ? styles.playerTypeDotGuest : null]} />
          <View style={styles.playerCopy}>
            <Text style={styles.playerName}>{formatPlayerShortName(item)}</Text>
            <Text style={styles.playerMeta}>
              {item.type === "registered" ? "Jugador registrado" : "Solo visible en esta liga"}
            </Text>
          </View>
        </View>

        <View style={styles.playerActions}>
          {item.type === "guest" ? (
            <Pressable
              disabled={saving}
              onPress={() =>
                setReplacementTargetId((current) => (current === item.id ? "" : item.id))
              }
              style={({ pressed }) => [
                styles.smallActionButton,
                replacementTargetId === item.id ? styles.smallActionButtonPrimary : null,
                pressed ? styles.smallActionButtonPressed : null,
              ]}
            >
              <Ionicons
                color={replacementTargetId === item.id ? colors.surface : colors.primaryDark}
                name="swap-horizontal-outline"
                size={15}
              />
            </Pressable>
          ) : null}
          <Pressable
            disabled={saving}
            onPress={() => handleRemovePlayer(item.id)}
            style={({ pressed }) => [
              styles.smallActionButton,
              styles.smallActionButtonDanger,
              pressed ? styles.smallActionButtonPressed : null,
            ]}
          >
            <Ionicons color={colors.danger} name="trash-outline" size={15} />
          </Pressable>
        </View>
      </View>

      <View style={styles.playerBadgesRow}>
        <View style={styles.playerBadge}>
          <Text style={styles.playerBadgeText}>#{index + 1}</Text>
        </View>
        {item.categoria ? (
          <View style={styles.playerBadge}>
            <Text style={styles.playerBadgeText}>{item.categoria}</Text>
          </View>
        ) : null}
        {item.sexo ? (
          <View style={styles.playerBadgeSecondary}>
            <Text style={styles.playerBadgeSecondaryText}>{item.sexo}</Text>
          </View>
        ) : null}
        {isIndividualLeague && item.ladoJuego !== "ambos" ? (
          <View style={styles.playerBadge}>
            <Text style={styles.playerBadgeText}>
              {item.ladoJuego === "drive" ? "Drive" : "Reves"}
            </Text>
          </View>
        ) : null}
      </View>

      {item.ciudad ? (
        <Text style={styles.playerLocation}>
          {item.ciudad}
          {item.provincia ? `, ${item.provincia}` : ""}
        </Text>
      ) : null}

      {replacementTargetId === item.id ? (
        <Text style={styles.replacementHint}>
          Selecciona abajo un jugador registrado para reemplazar este nombre manual.
        </Text>
      ) : null}
    </View>
  );

  const renderRegisteredPlayer = ({ item }) => {
    const alreadyAdded = leaguePlayers.some(
      (entry) => normalizeText(entry.linkedUserId) === normalizeText(item.id)
    );

    return (
      <View style={styles.searchPlayerCard}>
        {renderPlayerAvatar(item, styles.searchPlayerAvatar)}
        <View style={styles.searchPlayerCopy}>
          <Text style={styles.searchPlayerName}>{formatPlayerFullName(item)}</Text>
          <Text style={styles.searchPlayerMeta}>
            {item.categoria} - {item.ciudad}
          </Text>
        </View>
        <Pressable
          disabled={saving || (alreadyAdded && !replacementTargetId)}
          onPress={() => handleAddRegisteredPlayer(item)}
          style={({ pressed }) => [
            styles.addPlayerButton,
            alreadyAdded && !replacementTargetId ? styles.addPlayerButtonDisabled : null,
            pressed ? styles.smallActionButtonPressed : null,
          ]}
        >
          <Ionicons color={colors.surface} name={replacementTargetId ? "swap-horizontal" : "add"} size={16} />
          <Text style={styles.addPlayerButtonText}>
            {replacementTargetId ? "Reemplazar" : alreadyAdded ? "Agregado" : "Agregar"}
          </Text>
        </Pressable>
      </View>
    );
  };

  const renderPairGroup = ({ item }) => {
    const pairPlayers = item.players.slice(0, 2);
    const freeSlots = Math.max(0, 2 - pairPlayers.length);
    const isExpanded = expandedPairNumbers.includes(item.pairNumber);

    return (
      <View style={styles.pairCard}>
        <Pressable
          onPress={() => togglePairExpanded(item.pairNumber)}
          style={({ pressed }) => [styles.pairCardHeader, pressed ? styles.smallActionButtonPressed : null]}
        >
          <View>
            <Text style={styles.pairCardTitle}>Pareja {item.pairNumber}</Text>
            <Text style={styles.pairCardStatus}>
              {pairPlayers.length === 2 ? "Completa" : `${freeSlots} libre${freeSlots > 1 ? "s" : ""}`}
            </Text>
          </View>
          <Ionicons
            color={colors.primaryDark}
            name={isExpanded ? "chevron-up" : "chevron-down"}
            size={18}
          />
        </Pressable>

        {isExpanded ? (
          <>
            {pairPlayers.map((player, index) => (
              <View key={player.id} style={styles.pairSlotRow}>
                {renderPlayerAvatar(player, styles.pairPlayerAvatar)}
                <View style={styles.pairSlotCopy}>
                  <Text style={styles.playerName}>{formatPlayerShortName(player)}</Text>
                  <Text style={styles.playerMeta}>
                    {player.type === "registered" ? "Jugador registrado" : "Solo visible en esta liga"}
                  </Text>
                </View>
                {player.type === "guest" ? (
                  <Pressable
                    disabled={saving}
                    onPress={() =>
                      setReplacementTargetId((current) => (current === player.id ? "" : player.id))
                    }
                    style={({ pressed }) => [
                      styles.smallActionButton,
                      replacementTargetId === player.id ? styles.smallActionButtonPrimary : null,
                      pressed ? styles.smallActionButtonPressed : null,
                    ]}
                  >
                    <Ionicons
                      color={replacementTargetId === player.id ? colors.surface : colors.primaryDark}
                      name="swap-horizontal-outline"
                      size={15}
                    />
                  </Pressable>
                ) : null}
                <Pressable
                  disabled={saving}
                  onPress={() => handleRemovePlayer(player.id)}
                  style={({ pressed }) => [
                    styles.smallActionButton,
                    styles.smallActionButtonDanger,
                    pressed ? styles.smallActionButtonPressed : null,
                  ]}
                >
                  <Ionicons color={colors.danger} name="trash-outline" size={15} />
                </Pressable>
              </View>
            ))}

            {Array.from({ length: freeSlots }, (_, index) => (
              <View key={`free-${item.pairNumber}-${index}`} style={styles.pairSlotRow}>
                <View style={styles.freeSlotAvatar}>
                  <Ionicons color={colors.muted} name="person-outline" size={14} />
                </View>
                <View style={styles.pairSlotCopy}>
                  <Text style={styles.freeSlotTitle}>Libre</Text>
                  <Text style={styles.playerMeta}>Agrega un jugador para completar la pareja.</Text>
                </View>
              </View>
            ))}
          </>
        ) : (
          <View style={styles.collapsedPairPlayers}>
            {pairPlayers.length > 0 ? (
              pairPlayers.map((player) => (
                <View key={player.id} style={styles.collapsedPairPlayer}>
                  {renderPlayerAvatar(player, styles.collapsedPlayerAvatar)}
                  <Text numberOfLines={1} style={styles.collapsedPairPlayerName}>
                    {formatPlayerShortName(player)}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.collapsedPairEmpty}>Sin jugadores asignados</Text>
            )}
          </View>
        )}

        {pairPlayers.some((player) => replacementTargetId === player.id) ? (
          <Text style={styles.replacementHint}>
            Selecciona abajo un jugador registrado para reemplazar este nombre manual.
          </Text>
        ) : null}
      </View>
    );
  };

  const renderPairPickerGroup = (pair) => {
    const pairPlayers = pair.players.slice(0, 2);
    const freeSlots = Math.max(0, 2 - pairPlayers.length);
    const mixedCompatibility = getMixedPairCompatibility(
      pendingRegisteredPlayer,
      pair.pairNumber,
      replacementTargetId
    );
    const isMixedPairDisabled = Boolean(pendingRegisteredPlayer) && !mixedCompatibility.valid;
    const isDisabled = pairPlayers.length >= 2 || isMixedPairDisabled;
    const pairStatusText = pairPlayers.length >= 2
      ? "Completa"
      : `${freeSlots} libre${freeSlots > 1 ? "s" : ""}`;

    return (
      <View key={pair.pairNumber} style={[styles.pairCard, styles.pairPickerCard]}>
        <View style={styles.pairCardHeader}>
          <View>
            <Text style={styles.pairCardTitle}>Pareja {pair.pairNumber}</Text>
            <Text style={styles.pairCardStatus}>{pairStatusText}</Text>
          </View>
          <Pressable
            disabled={isDisabled}
            onPress={() => handleSelectPairNumber(pair.pairNumber)}
            style={({ pressed }) => [
              styles.assignPairButton,
              isDisabled ? styles.assignPairButtonDisabled : null,
              pressed && !isDisabled ? styles.smallActionButtonPressed : null,
            ]}
          >
            <Text style={styles.assignPairButtonText}>
              {isMixedPairDisabled ? "Bloqueada" : pairPlayers.length >= 2 ? "Completa" : "Asignar aqui"}
            </Text>
          </Pressable>
        </View>

        {pairPlayers.map((player) => (
          <View key={player.id} style={styles.pairSlotRow}>
            {renderPlayerAvatar(player, styles.pairPlayerAvatar)}
            <View style={styles.pairSlotCopy}>
              <Text style={styles.playerName}>{formatPlayerShortName(player)}</Text>
              <Text style={styles.playerMeta}>
                {player.type === "registered" ? "Jugador registrado" : "Solo visible en esta liga"}
              </Text>
            </View>
          </View>
        ))}

        {Array.from({ length: freeSlots }, (_, index) => (
          <Pressable
            key={`picker-free-${pair.pairNumber}-${index}`}
            disabled={isDisabled}
            onPress={() => handleSelectPairNumber(pair.pairNumber)}
            style={({ pressed }) => [
              styles.pairSlotRow,
              styles.freePairSlotButton,
              pairPlayers.length >= 2 ? styles.freePairSlotButtonDisabled : null,
              pressed && !isDisabled ? styles.smallActionButtonPressed : null,
            ]}
          >
            <View style={styles.freeSlotAvatar}>
              <Ionicons color={colors.muted} name="person-outline" size={14} />
            </View>
            <View style={styles.pairSlotCopy}>
              <Text style={styles.freeSlotTitle}>Libre</Text>
              <Text style={styles.playerMeta}>
                {isMixedPairDisabled
                  ? "Liga mixta requiere un jugador de diferente sexo"
                  : "Toca aca para asignar a esta pareja."}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader onBack={() => navigation.goBack()} subtitle="Jugadores liga" />
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />

      <View style={styles.container}>
        <LeagueHeaderCard
          category={league?.categoria}
          complexName={league?.complejoNombre}
          league={league}
          sex={league?.sexo}
          title={league?.nombre || fallbackLeagueName}
          teamType={league?.teamType}
        >
          <Text style={styles.summaryText}>
            {isPairLeague
              ? `Parejas completas cargadas ${currentCount}/${minimumPlayersCount}`
              : `Jugadores cargados ${currentCount}/${minimumPlayersCount}`}
          </Text>
          {isIndividualLeague ? (
            <View style={styles.sideSummaryRow}>
              <Text style={styles.sideSummaryText}>Drive {driveCount}/{sideTargetCount}</Text>
              <Text style={styles.sideSummaryText}>Reves {revesCount}/{sideTargetCount}</Text>
            </View>
          ) : null}
        </LeagueHeaderCard>
        <Text
          style={[
            styles.summaryStatus,
            missingPlayersCount === 0 ? styles.summaryStatusReady : styles.summaryStatusPending,
          ]}
        >
          {missingPlayersCount === 0
            ? "Minimo completo."
            : isPairLeague
            ? `Faltan ${missingPlayersCount} jugadores para llegar a ${pairPlayersTargetCount}.`
            : `Faltan ${missingPlayersCount} jugadores para llegar a ${minimumPlayersCount}.`}
        </Text>

        {!canManage && !loading ? (
          <View style={styles.warningCard}>
            <Text style={styles.warningText}>
              Solo el organizador creador o un administrador puede modificar los jugadores de esta liga.
            </Text>
          </View>
        ) : null}

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>
            {isPairLeague ? "Parejas de la liga" : "Jugadores de la liga"}
          </Text>
          <Pressable
            disabled={!canManage || saving}
            onPress={() => setGuestModalVisible(true)}
            style={({ pressed }) => [
              styles.inlineCreateButton,
              (!canManage || saving) ? styles.inlineCreateButtonDisabled : null,
              pressed ? styles.smallActionButtonPressed : null,
            ]}
          >
            <Ionicons color={colors.surface} name="person-add-outline" size={16} />
            <Text style={styles.inlineCreateButtonText}>Crear Jugador</Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator color={colors.primaryDark} />
            <Text style={styles.loaderText}>Cargando jugadores de la liga...</Text>
          </View>
        ) : (
          <FlatList
            contentContainerStyle={styles.listContent}
            data={isPairLeague ? pairGroups : leaguePlayers}
            keyExtractor={(item) => (isPairLeague ? `pair-${item.pairNumber}` : item.id)}
            ListEmptyComponent={
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>
                  {isPairLeague
                    ? "Todavia no hay parejas cargadas"
                    : "Todavia no hay jugadores cargados"}
                </Text>
                <Text style={styles.emptyText}>
                  Puedes sumarlos desde usuarios registrados o crear jugadores manuales solo para esta liga.
                </Text>
              </View>
            }
            ListHeaderComponent={
              <>
                <TextInput
                  onChangeText={setQuery}
                  placeholder={
                    replacementTargetId
                      ? "Buscar jugador registrado para reemplazar"
                      : "Buscar jugadores registrados"
                  }
                  placeholderTextColor={colors.muted}
                  style={styles.searchInput}
                  value={query}
                />
                <Text style={styles.searchSectionTitle}>Jugadores registrados en la app</Text>
                {filteredRegisteredPlayers.length === 0 ? (
                  <View style={styles.placeholderCard}>
                    <Text style={styles.placeholderText}>
                      No encontramos jugadores registrados con esa busqueda.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.searchResultsWrap}>
                    {filteredRegisteredPlayers.slice(0, 12).map((player) => (
                      <View key={player.id}>{renderRegisteredPlayer({ item: player })}</View>
                    ))}
                  </View>
                )}
                <Text style={styles.listSectionTitle}>
                  {isPairLeague ? "Parejas actuales" : "Listado actual"}
                </Text>
              </>
            }
            renderItem={isPairLeague ? renderPairGroup : renderLeaguePlayer}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      <Modal
        animationType="slide"
        onRequestClose={() => {
          setGuestModalVisible(false);
          setGuestName("");
          setGuestLastName("");
        }}
        transparent
        visible={guestModalVisible}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            onPress={() => {
              setGuestModalVisible(false);
              setGuestName("");
              setGuestLastName("");
            }}
            style={styles.modalBackdrop}
          />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Crear jugador solo para esta liga</Text>
            <Text style={styles.modalText}>
              Este jugador no se registra en la app. Solo servira para identificar fixture y puntajes.
            </Text>
            <TextInput
              autoFocus
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
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => {
                  setGuestModalVisible(false);
                  setGuestName("");
                  setGuestLastName("");
                }}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryButtonText}>Cancelar</Text>
              </Pressable>
              <Pressable onPress={handleCreateGuestPlayer} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>Agregar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={() => {
          setSidePickerVisible(false);
          setPendingRegisteredPlayer(null);
          setPendingGuestName("");
        }}
        transparent
        visible={sidePickerVisible}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            onPress={() => {
              setSidePickerVisible(false);
              setPendingRegisteredPlayer(null);
              setPendingGuestName("");
            }}
            style={styles.modalBackdrop}
          />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Tipo de jugador en esta liga</Text>
            <Text style={styles.modalText}>
              Selecciona si entra como Drive o Reves. En esta liga va a valer esta asignacion.
            </Text>
            <View style={styles.sideButtonsRow}>
              <Pressable
                onPress={() => handleSelectLeagueSide("drive")}
                style={({ pressed }) => [
                  styles.sideOptionButton,
                  pressed ? styles.smallActionButtonPressed : null,
                ]}
              >
                <Text style={styles.sideOptionButtonText}>Drive</Text>
              </Pressable>
              <Pressable
                onPress={() => handleSelectLeagueSide("reves")}
                style={({ pressed }) => [
                  styles.sideOptionButton,
                  pressed ? styles.smallActionButtonPressed : null,
                ]}
              >
                <Text style={styles.sideOptionButtonText}>Reves</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={() => {
          setPairPickerVisible(false);
          setPendingRegisteredPlayer(null);
          setPendingGuestName("");
        }}
        transparent
        visible={pairPickerVisible}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            onPress={() => {
              setPairPickerVisible(false);
              setPendingRegisteredPlayer(null);
              setPendingGuestName("");
            }}
            style={styles.modalBackdrop}
          />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Asignar a una pareja</Text>
            <Text style={styles.modalText}>
              Selecciona que pareja conforma. Si falta el companero, queda el espacio libre hasta
              agregarlo.
            </Text>
            <ScrollView showsVerticalScrollIndicator={false} style={styles.pairPickerList}>
              {pairPickerGroups.map(renderPairPickerGroup)}
            </ScrollView>
          </View>
        </View>
      </Modal>

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
    paddingTop: spacing.sm,
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
  summaryText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  sideSummaryRow: {
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    marginTop: 1,
  },
  sideSummaryText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
  },
  summaryStatus: {
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 15,
    marginTop: 4,
    textAlign: "center",
  },
  summaryStatusReady: {
    color: colors.primaryDark,
  },
  summaryStatusPending: {
    color: "#8A5700",
  },
  warningCard: {
    backgroundColor: "#FFF8E8",
    borderColor: "#F2D89C",
    borderRadius: 18,
    borderWidth: 1,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  warningText: {
    color: "#8A5700",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  sectionHeaderRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.md,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
  },
  inlineCreateButton: {
    alignItems: "center",
    backgroundColor: colors.primaryDark,
    borderRadius: 14,
    flexDirection: "row",
    minHeight: 36,
    paddingHorizontal: 12,
  },
  inlineCreateButtonDisabled: {
    opacity: 0.55,
  },
  inlineCreateButtonText: {
    color: colors.surface,
    fontSize: 12,
    fontWeight: "800",
    marginLeft: 6,
  },
  loaderWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xl,
  },
  loaderText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
    marginTop: spacing.sm,
  },
  listContent: {
    paddingBottom: BOTTOM_QUICK_ACTIONS_SPACE,
    paddingTop: spacing.sm,
  },
  searchInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    color: colors.text,
    fontSize: 14,
    marginBottom: spacing.sm,
    minHeight: 42,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  searchSectionTitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 8,
    marginTop: 2,
    textAlign: "center",
    textTransform: "uppercase",
  },
  searchResultsWrap: {
    gap: 4,
  },
  searchPlayerCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  searchPlayerAvatar: {
    marginRight: spacing.sm,
  },
  searchPlayerCopy: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  searchPlayerName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  searchPlayerMeta: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },
  addPlayerButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 12,
    flexDirection: "row",
    minHeight: 28,
    paddingHorizontal: 9,
  },
  addPlayerButtonDisabled: {
    backgroundColor: "#A9C9BC",
  },
  addPlayerButtonText: {
    color: colors.surface,
    fontSize: 11,
    fontWeight: "800",
    marginLeft: 4,
  },
  listSectionTitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "800",
    marginBottom: spacing.xs,
    marginTop: 12,
    textAlign: "center",
    textTransform: "uppercase",
  },
  leaguePlayerCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  leaguePlayerHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  playerIdentity: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    paddingRight: spacing.sm,
  },
  playerTypeDot: {
    backgroundColor: colors.primaryDark,
    borderRadius: 999,
    height: 12,
    marginRight: spacing.sm,
    width: 12,
  },
  playerTypeDotGuest: {
    backgroundColor: "#B87407",
  },
  playerCopy: {
    flex: 1,
  },
  playerName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  playerMeta: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },
  playerActions: {
    flexDirection: "row",
    gap: 4,
  },
  smallActionButton: {
    alignItems: "center",
    backgroundColor: "#EDF7F2",
    borderColor: "#C9E5D8",
    borderRadius: 10,
    borderWidth: 1,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  smallActionButtonPrimary: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  smallActionButtonDanger: {
    backgroundColor: "#FFF1F1",
    borderColor: "#F2C4C4",
  },
  smallActionButtonPressed: {
    opacity: 0.9,
  },
  playerBadgesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 6,
  },
  playerBadge: {
    backgroundColor: "#EDF7F2",
    borderColor: "#C9E5D8",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  playerBadgeText: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "800",
  },
  playerBadgeSecondary: {
    backgroundColor: "#FFF4E7",
    borderColor: "#E8C58E",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  playerBadgeSecondaryText: {
    color: "#8A5A2B",
    fontSize: 11,
    fontWeight: "800",
  },
  playerLocation: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 4,
  },
  playerAvatar: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 28,
    width: 28,
  },
  playerAvatarFallback: {
    alignItems: "center",
    backgroundColor: "#E5E7EB",
    borderRadius: 999,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  pairCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  pairCardHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  pairCardTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  pairCardStatus: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
  },
  pairSlotRow: {
    alignItems: "center",
    backgroundColor: "#F7FBF9",
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  pairPlayerAvatar: {
    marginRight: 2,
  },
  freeSlotAvatar: {
    alignItems: "center",
    backgroundColor: "#EEF6F2",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 28,
    justifyContent: "center",
    marginRight: 2,
    width: 28,
  },
  freePairSlotButton: {
    borderColor: colors.primaryLight,
  },
  freePairSlotButtonDisabled: {
    backgroundColor: "#FFF1F1",
    borderColor: "#F2C4C4",
    opacity: 0.75,
  },
  pairSlotNumber: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
    width: 16,
  },
  pairSlotCopy: {
    flex: 1,
  },
  freeSlotTitle: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "800",
  },
  collapsedPairPlayers: {
    gap: 4,
    marginTop: 2,
  },
  collapsedPairPlayer: {
    alignItems: "center",
    flexDirection: "row",
  },
  collapsedPlayerAvatar: {
    height: 22,
    marginRight: spacing.xs,
    width: 22,
  },
  collapsedPairPlayerName: {
    color: colors.text,
    flex: 1,
    fontSize: 13,
    fontWeight: "800",
  },
  collapsedPairEmpty: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  replacementHint: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 15,
    marginTop: 4,
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
  placeholderCard: {
    backgroundColor: "#F7FBF9",
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  placeholderText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
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
    maxHeight: "88%",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
  },
  modalText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.sm,
  },
  modalInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    color: colors.text,
    fontSize: 14,
    marginTop: spacing.md,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  modalActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  sideButtonsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  sideOptionButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 16,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
  },
  sideOptionButtonText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: "800",
  },
  pairPickerGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.lg,
  },
  pairPickerList: {
    marginTop: spacing.lg,
  },
  pairPickerCard: {
    marginBottom: spacing.sm,
  },
  assignPairButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 12,
    justifyContent: "center",
    minHeight: 32,
    paddingHorizontal: 10,
  },
  assignPairButtonDisabled: {
    backgroundColor: "#A9C9BC",
  },
  assignPairButtonText: {
    color: colors.surface,
    fontSize: 11,
    fontWeight: "900",
  },
  pairPickerButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: 14,
    justifyContent: "center",
    minHeight: 46,
    minWidth: "30%",
    paddingHorizontal: spacing.sm,
  },
  pairPickerButtonDisabled: {
    backgroundColor: "#A9C9BC",
  },
  pairPickerButtonText: {
    color: colors.surface,
    fontSize: 13,
    fontWeight: "800",
  },
  pairPickerButtonMeta: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 11,
    fontWeight: "800",
    marginTop: 2,
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

