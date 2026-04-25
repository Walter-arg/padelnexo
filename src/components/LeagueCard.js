import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing } from "../config/theme";
import LeagueSuspensionNotice from "./LeagueSuspensionNotice";
import { getActiveLeagueSuspensionNotice } from "../services/leaguesService";

const FAVORITE_COLOR = "#BF6F00";
const STATUS_ORANGE = "#FF8A00";
const STATUS_FLUOR_GREEN = "#22E044";
const STATUS_RED = "#E53935";
const COMPLEX_NAME_COLORS = ["#24A8D8", "#5B63C8", "#B965B8"];
const DAY_LABELS = {
  monday: "Lunes",
  tuesday: "Martes",
  wednesday: "Miercoles",
  thursday: "Jueves",
  friday: "Viernes",
  saturday: "Sabado",
  sunday: "Domingo",
};

function buildScheduleSummary(league) {
  const timeSlots = Array.isArray(league?.scheduleConfig?.timeSlots)
    ? league.scheduleConfig.timeSlots.filter(Boolean)
    : [];
  const dayLabel = DAY_LABELS[league?.scheduleConfig?.dayKey] || "";

  if (!timeSlots.length) {
    return dayLabel ? `${dayLabel} - Horario a definir` : "Horario a definir";
  }

  const timeLabel = timeSlots.join(" · ");
  return dayLabel ? `${dayLabel} - ${timeLabel}` : timeLabel;
}

function isPairLeagueComplete(league) {
  const players = Array.isArray(league?.players) ? league.players : [];
  const minimumPairs = Math.max(
    0,
    Number.parseInt(String(league?.fixtureConfig?.minPlayersCount ?? "0"), 10) || 0
  );
  const numberedPlayers = players.filter((player) => Number(player?.pairNumber) > 0);

  if (!minimumPairs) {
    return players.length > 0;
  }

  if (!numberedPlayers.length) {
    return Math.floor(players.length / 2) >= minimumPairs;
  }

  const completePairsCount = numberedPlayers.reduce((groups, player) => {
    const pairNumber = Number(player?.pairNumber) || 0;

    if (!pairNumber) {
      return groups;
    }

    const currentCount = groups.get(pairNumber) || 0;
    groups.set(pairNumber, currentCount + 1);

    return groups;
  }, new Map());

  return (
    Array.from(completePairsCount.values()).filter((count) => count >= 2).length >=
    minimumPairs
  );
}

function isLeagueRosterComplete(league) {
  const players = Array.isArray(league?.players) ? league.players : [];
  const minimumPlayers = Math.max(
    0,
    Number.parseInt(String(league?.fixtureConfig?.minPlayersCount ?? "0"), 10) || 0
  );

  if (league?.teamType === "pair") {
    return isPairLeagueComplete(league);
  }

  if (!minimumPlayers) {
    return players.length > 0;
  }

  return players.length >= minimumPlayers;
}

function buildProgressStatus(league) {
  const rounds = Array.isArray(league?.fixture?.rounds) ? league.fixture.rounds : [];
  const matches = rounds.flatMap((round) => (Array.isArray(round?.matches) ? round.matches : []));
  const playableMatches = matches.filter(
    (match) => match?.teamA?.id !== "__bye__" && match?.teamB?.id !== "__bye__"
  );
  const completedMatches = playableMatches.filter((match) => Boolean(match?.result?.winner)).length;

  if (playableMatches.length && completedMatches === playableMatches.length) {
    return { label: "Finalizada", tone: "red" };
  }

  if (playableMatches.length > 0) {
    return { label: "En curso", tone: "green" };
  }

  if (isLeagueRosterComplete(league)) {
    return { label: "Completa", tone: "green" };
  }

  return { label: "Incompleta", tone: "orange" };
}

function shouldShowSexMeta(category = "", sex = "") {
  const categoryText = String(category || "").trim().toLowerCase();
  const sexText = String(sex || "").trim().toLowerCase();

  if (sexText === "femenino") {
    return !categoryText.includes("damas") && !categoryText.includes("femenino");
  }

  if (sexText === "masculino") {
    return (
      !categoryText.includes("caballeros") &&
      !categoryText.includes(" cab") &&
      !categoryText.endsWith("cab") &&
      !categoryText.includes("masculino")
    );
  }

  if (sexText === "mixto") {
    return !categoryText.includes("mixta") && !categoryText.includes("mixto");
  }

  return Boolean(sexText);
}

function getStableColorIndex(value = "") {
  const text = String(value || "").trim().toLowerCase();

  if (!text) {
    return 0;
  }

  return text.split("").reduce((total, character) => total + character.charCodeAt(0), 0);
}

export default function LeagueCard({
  league,
  complexColor,
  onDelete,
  onDetails,
  onToggleFavorite,
  hideFavoriteAction = false,
  managementActions = [],
  showProgressStatus = false,
}) {
  const scheduleSummary = buildScheduleSummary(league);
  const progressStatus = showProgressStatus ? buildProgressStatus(league) : null;
  const suspensionNotice = getActiveLeagueSuspensionNotice(league);
  const showSex = shouldShowSexMeta(league?.categoria, league?.sexo);
  const complexNameColor =
    complexColor ||
    COMPLEX_NAME_COLORS[
      getStableColorIndex(league?.complejoNombre) % COMPLEX_NAME_COLORS.length
    ];

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.copy}>
          <Text numberOfLines={1} style={styles.name}>
            {league.nombre}
          </Text>
          <Text numberOfLines={1} style={[styles.complex, { color: complexNameColor }]}>
            {league.complejoNombre}
          </Text>
        </View>

        <View style={styles.actionsColumn}>
          {!hideFavoriteAction ? (
            <Pressable
              onPress={onToggleFavorite}
              style={({ pressed }) => [
                styles.favoriteButton,
                pressed && styles.favoriteButtonPressed,
              ]}
            >
              <Ionicons
                color={FAVORITE_COLOR}
                name={league.esMiLiga ? "star" : "star-outline"}
                size={18}
              />
            </Pressable>
          ) : null}
          {onDelete ? (
            <Pressable
              onPress={onDelete}
              style={({ pressed }) => [styles.deleteButton, pressed && styles.favoriteButtonPressed]}
            >
              <Ionicons color={colors.danger} name="trash-outline" size={17} />
            </Pressable>
          ) : null}
          {onDetails ? (
            <Pressable
              onPress={onDetails}
              style={({ pressed }) => [styles.detailsButton, pressed && styles.favoriteButtonPressed]}
            >
              <Ionicons color={colors.primaryDark} name="chevron-forward" size={18} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.metaText}>{league.categoria}</Text>
        {showSex ? <Text style={styles.metaSeparator}>-</Text> : null}
        {showSex ? <Text style={styles.metaText}>{league.sexo}</Text> : null}
      </View>

      <View style={styles.footerRow}>
        <Ionicons color={colors.muted} name="location-outline" size={14} />
        <Text numberOfLines={1} style={styles.location}>
          {league.localidad}
          {league.provincia ? `, ${league.provincia}` : ""}
        </Text>
      </View>

      <View style={styles.scheduleStatusRow}>
        <Text numberOfLines={1} style={styles.organizer}>
          {scheduleSummary}
        </Text>
        {progressStatus ? (
          <Text
            style={[
              styles.progressStatusText,
              progressStatus.tone === "green"
                ? styles.progressStatusTextGreen
                : progressStatus.tone === "red"
                ? styles.progressStatusTextRed
                : styles.progressStatusTextOrange,
            ]}
          >
            {progressStatus.label}
          </Text>
        ) : null}
      </View>

      <LeagueSuspensionNotice compact notice={suspensionNotice} />

      {managementActions.length > 0 ? (
        <View style={styles.managementActionsRow}>
          {managementActions.map((action) => (
            <Pressable
              key={action.key}
              onPress={action.onPress}
              style={({ pressed }) => [
                styles.managementActionButton,
                action.tone === "primary" ? styles.managementActionButtonPrimary : null,
                pressed ? styles.favoriteButtonPressed : null,
              ]}
            >
              <Ionicons
                color={action.tone === "primary" ? colors.surface : colors.primaryDark}
                name={action.icon}
                size={14}
              />
              <Text
                style={[
                  styles.managementActionText,
                  action.tone === "primary" ? styles.managementActionTextPrimary : null,
                ]}
              >
                {action.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3,
  },
  headerRow: {
    alignItems: "flex-start",
    flexDirection: "row",
  },
  copy: {
    flex: 1,
    paddingHorizontal: 38,
  },
  name: {
    color: colors.text,
    fontFamily: "serif",
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: 0.2,
    lineHeight: 20,
    textAlign: "center",
  },
  complex: {
    color: "#2F8FCF",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 15,
    textAlign: "center",
  },
  actionsColumn: {
    gap: 4,
    position: "absolute",
    right: 0,
    top: 0,
  },
  favoriteButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    height: 26,
    justifyContent: "center",
    width: 26,
  },
  deleteButton: {
    alignItems: "center",
    backgroundColor: "#FFF1F1",
    borderColor: "#F2C4C4",
    borderRadius: 10,
    borderWidth: 1,
    height: 26,
    justifyContent: "center",
    width: 26,
  },
  detailsButton: {
    alignItems: "center",
    backgroundColor: "#EDF7F2",
    borderColor: "#C9E5D8",
    borderRadius: 10,
    borderWidth: 1,
    height: 26,
    justifyContent: "center",
    width: 26,
  },
  favoriteButtonPressed: {
    opacity: 0.9,
  },
  metaRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    justifyContent: "center",
    marginTop: 4,
  },
  metaText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.3,
    lineHeight: 15,
  },
  metaSeparator: {
    color: "#7AAFD3",
    fontSize: 12,
    fontWeight: "800",
  },
  footerRow: {
    alignItems: "center",
    flexDirection: "row",
    marginTop: 4,
  },
  location: {
    color: "#A7B0AA",
    flex: 1,
    fontSize: 12,
    marginLeft: 6,
  },
  organizer: {
    color: "#2F3F38",
    flex: 1,
    fontSize: 11,
  },
  scheduleStatusRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    marginTop: 3,
  },
  progressStatusText: {
    fontSize: 11,
    fontWeight: "900",
  },
  progressStatusTextGreen: {
    color: STATUS_FLUOR_GREEN,
  },
  progressStatusTextOrange: {
    color: STATUS_ORANGE,
  },
  progressStatusTextRed: {
    color: STATUS_RED,
  },
  managementActionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  managementActionButton: {
    alignItems: "center",
    backgroundColor: "#EDF7F2",
    borderColor: "#C9E5D8",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 34,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  managementActionButtonPrimary: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  managementActionText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
    marginLeft: 6,
  },
  managementActionTextPrimary: {
    color: colors.surface,
  },
});

