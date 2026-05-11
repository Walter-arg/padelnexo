import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing } from "../config/theme";
import LeagueSuspensionNotice from "./LeagueSuspensionNotice";
import { getActiveLeagueSuspensionNotice } from "../services/leaguesService";

const DAY_LABELS = {
  monday: "Lunes",
  tuesday: "Martes",
  wednesday: "Miercoles",
  thursday: "Jueves",
  friday: "Viernes",
  saturday: "Sabado",
  sunday: "Domingo",
};

function buildScheduleSummary(league = {}) {
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

export default function LeagueHeaderCard({
  actions = null,
  category = "",
  children = null,
  complexName = "",
  league = null,
  sex = "",
  subtitle = "",
  title = "Liga",
  teamType = "",
}) {
  const categoryText = String(category || "").trim();
  const showSex = shouldShowSexMeta(categoryText, sex);
  const metaCategory = [categoryText, showSex ? sex : ""].filter(Boolean).join(" · ");
  const scheduleSummary = buildScheduleSummary(league);
  const teamTypeLabel =
    teamType === "individual" ? "Individual" : teamType === "pair" ? "Pareja fija" : "";
  const locationLine = [league?.localidad, league?.provincia].filter(Boolean).join(", ");
  const complexLocationLine = [complexName, locationLine].filter(Boolean).join(" · ");
  const suspensionNotice = getActiveLeagueSuspensionNotice(league);

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <View style={styles.titleInline}>
          <Text numberOfLines={2} style={[styles.title, actions ? styles.titleWithActions : null]}>
            {title}
          </Text>
        </View>
        {actions ? <View style={styles.actionsWrap}>{actions}</View> : null}
      </View>

      <View style={styles.metaList}>
        {metaCategory ? (
          <View style={styles.metaItem}>
            <Ionicons color={colors.primaryDark} name="ribbon-outline" size={16} />
            <Text numberOfLines={1} style={[styles.metaText, styles.metaTextStrong]}>
              {metaCategory}
            </Text>
          </View>
        ) : null}

        <View style={styles.metaItem}>
          <Ionicons color={colors.primaryDark} name="calendar-outline" size={16} />
          <Text numberOfLines={1} style={[styles.metaText, styles.metaTextMuted]}>
            {scheduleSummary}
          </Text>
        </View>

        {complexLocationLine ? (
          <View style={styles.metaItem}>
            <Ionicons color="#2F8FCF" name="business-outline" size={16} />
            <Text numberOfLines={1} style={[styles.metaText, styles.metaTextStrong]}>
              {complexLocationLine}
            </Text>
          </View>
        ) : null}

        {teamTypeLabel ? (
          <View style={styles.metaItem}>
            <Ionicons color={colors.primaryDark} name="people-outline" size={16} />
            <Text numberOfLines={1} style={[styles.metaText, styles.metaTextMuted]}>
              {teamTypeLabel}
            </Text>
          </View>
        ) : null}
      </View>

      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {children}
      <LeagueSuspensionNotice notice={suspensionNotice} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: "rgba(31,171,137,0.12)",
    borderRadius: 22,
    borderWidth: 1,
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  titleRow: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 26,
    position: "relative",
  },
  titleInline: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 42,
  },
  title: {
    color: "#4F8FC8",
    flexShrink: 1,
    fontFamily: "serif",
    fontSize: 21,
    fontWeight: "800",
    letterSpacing: 0.2,
    lineHeight: 25,
    textAlign: "center",
  },
  titleWithActions: {
    paddingRight: 6,
  },
  actionsWrap: {
    position: "absolute",
    right: 0,
    top: 0,
  },
  metaList: {
    gap: 6,
  },
  metaItem: {
    alignItems: "center",
    columnGap: 8,
    flexDirection: "row",
    justifyContent: "center",
  },
  metaText: {
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 15,
    textAlign: "center",
  },
  metaTextStrong: {
    color: "#101820",
  },
  metaTextMuted: {
    color: "#66737F",
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
    lineHeight: 15,
    textAlign: "center",
  },
});
