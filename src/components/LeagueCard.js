import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing } from "../config/theme";
import LeagueSuspensionNotice from "./LeagueSuspensionNotice";
import { getActiveLeagueSuspensionNotice } from "../services/leaguesService";

const FAVORITE_COLOR = "#BF6F00";
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
    return {
      accent: "#9F2F2A",
      border: "#F2B8B2",
      label: "Finalizada",
      tint: "#FFE3E0",
    };
  }

  if (playableMatches.length > 0) {
    return {
      accent: "#295400",
      border: "#A6D831",
      label: "En curso",
      tint: "#D9FF63",
    };
  }

  if (isLeagueRosterComplete(league)) {
    return {
      accent: "#295400",
      border: "#A6D831",
      label: "Completa",
      tint: "#D9FF63",
    };
  }

  return {
    accent: "#9B5E00",
    border: "#FFBF66",
    label: "Incompleta",
    tint: "#FFF2D9",
  };
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
  const categoryLine = [league?.categoria, showSex ? league?.sexo : ""].filter(Boolean).join(" · ");
  const locationLine = [league?.localidad, league?.provincia].filter(Boolean).join(", ");
  const complexLocationLine = [league?.complejoNombre, locationLine].filter(Boolean).join(" · ");

  return (
    <View style={styles.card}>
      {progressStatus ? (
        <View style={styles.statusWrap}>
          <View
            style={[
              styles.statusPill,
              {
                backgroundColor: progressStatus.tint,
                borderColor: progressStatus.border,
              },
            ]}
          >
            <Text style={[styles.statusPillText, { color: progressStatus.accent }]}>
              {progressStatus.label}
            </Text>
          </View>
        </View>
      ) : null}

      <View style={styles.headerRow}>
        <View style={styles.copy}>
          <View style={styles.titleInline}>
            <Text numberOfLines={2} style={styles.name}>
              {league?.nombre || "Liga"}
            </Text>
          </View>
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
                name={league?.esMiLiga ? "star" : "star-outline"}
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

      <View style={styles.detailsList}>
        {categoryLine ? (
          <View style={styles.detailRow}>
            <Ionicons color={colors.primaryDark} name="ribbon-outline" size={15} />
            <Text numberOfLines={1} style={[styles.detailText, styles.detailTextStrong]}>
              {categoryLine}
            </Text>
          </View>
        ) : null}

        <View style={styles.detailRow}>
          <Ionicons color={colors.primaryDark} name="calendar-outline" size={15} />
          <Text numberOfLines={1} style={[styles.detailText, styles.detailTextMuted]}>
            {scheduleSummary}
          </Text>
        </View>

        {complexLocationLine ? (
          <View style={styles.detailRow}>
            <Ionicons color={complexNameColor} name="business-outline" size={15} />
            <Text numberOfLines={1} style={[styles.detailText, styles.detailTextStrong]}>
              {complexLocationLine}
            </Text>
          </View>
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
    gap: 6,
    marginBottom: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3,
  },
  statusWrap: {
    alignItems: "center",
  },
  statusPill: {
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 24,
    paddingHorizontal: spacing.sm,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  headerRow: {
    alignItems: "flex-start",
    flexDirection: "row",
  },
  copy: {
    flex: 1,
    paddingHorizontal: 38,
  },
  titleInline: {
    alignItems: "center",
    justifyContent: "center",
  },
  name: {
    color: "#4F8FC8",
    flexShrink: 1,
    fontFamily: "serif",
    fontSize: 19,
    fontWeight: "800",
    letterSpacing: 0.2,
    lineHeight: 23,
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
  detailsList: {
    gap: 5,
  },
  detailRow: {
    alignItems: "center",
    columnGap: 8,
    flexDirection: "row",
    justifyContent: "center",
  },
  detailText: {
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 15,
    textAlign: "center",
  },
  detailTextStrong: {
    color: "#101820",
  },
  detailTextMuted: {
    color: "#66737F",
  },
  managementActionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.sm,
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
