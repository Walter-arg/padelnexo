import { StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "../config/theme";
import LeagueSuspensionNotice from "./LeagueSuspensionNotice";
import { getActiveLeagueSuspensionNotice } from "../services/leaguesService";

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
  const sexText = String(sex || "").trim();
  const normalizedCategory = categoryText.toLowerCase();
  const normalizedSex = sexText.toLowerCase();
  const categoryIncludesSex =
    (normalizedSex === "femenino" &&
      (normalizedCategory.includes("damas") || normalizedCategory.includes("femenino"))) ||
    (normalizedSex === "masculino" &&
      (normalizedCategory.includes("caballeros") ||
        normalizedCategory.includes(" cab") ||
        normalizedCategory.endsWith("cab") ||
        normalizedCategory.includes("masculino"))) ||
    (normalizedSex === "mixto" &&
      (normalizedCategory.includes("mixta") || normalizedCategory.includes("mixto")));
  const visibleSex = categoryIncludesSex ? "" : sexText;
  const teamTypeLabel =
    teamType === "individual" ? "Individual" : teamType === "pair" ? "Pareja fija" : "";
  const hasMeta = Boolean(categoryText || visibleSex || teamTypeLabel);
  const suspensionNotice = getActiveLeagueSuspensionNotice(league);

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <Text numberOfLines={2} style={[styles.title, actions ? styles.titleWithActions : null]}>
          {title}
        </Text>
        {actions ? <View style={styles.actionsWrap}>{actions}</View> : null}
      </View>
      {complexName ? (
        <Text numberOfLines={1} style={styles.complex}>
          {complexName}
        </Text>
      ) : null}
      {hasMeta ? (
        <View style={styles.metaRow}>
          {categoryText ? <Text style={styles.metaText}>{categoryText}</Text> : null}
          {categoryText && visibleSex ? <Text style={styles.metaSeparator}>-</Text> : null}
          {visibleSex ? <Text style={styles.metaText}>{visibleSex}</Text> : null}
          {(categoryText || visibleSex) && teamTypeLabel ? (
            <Text style={styles.metaSeparator}>-</Text>
          ) : null}
          {teamTypeLabel ? <Text style={styles.metaText}>{teamTypeLabel}</Text> : null}
        </View>
      ) : null}
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
    gap: 3,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: {
    color: colors.text,
    flex: 1,
    fontFamily: "serif",
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: 0.2,
    lineHeight: 24,
    textAlign: "center",
  },
  titleRow: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 26,
    position: "relative",
  },
  titleWithActions: {
    paddingHorizontal: 42,
  },
  actionsWrap: {
    position: "absolute",
    right: 0,
    top: 0,
  },
  complex: {
    color: "#2F8FCF",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 16,
    textAlign: "center",
  },
  metaRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    justifyContent: "center",
  },
  metaText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.3,
    lineHeight: 15,
    textAlign: "center",
  },
  metaSeparator: {
    color: "#7AAFD3",
    fontSize: 12,
    fontWeight: "800",
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.8,
    lineHeight: 17,
    textAlign: "center",
  },
});

