import { StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "../config/theme";

const STATUS_META = {
  draft: { label: "Borrador", accent: "#667482", tint: "#F3F5F7", border: "#D4DBE2" },
  published: { label: "Publicado", accent: "#356CB8", tint: "#EEF5FF", border: "#BED4F7" },
  registration_open: {
    label: "Inscripcion abierta",
    accent: "#237547",
    tint: "#EEF9F1",
    border: "#B7DFBF",
  },
  registration_closed: {
    label: "Inscripcion cerrada",
    accent: "#9B6A18",
    tint: "#FFF6EA",
    border: "#E8CF9B",
  },
  building: { label: "Armando", accent: "#6751B6", tint: "#F2F0FF", border: "#CDC6F5" },
  in_progress: { label: "En juego", accent: "#1C76A7", tint: "#EAF6FF", border: "#B5D8F0" },
  finished: { label: "Finalizado", accent: "#576773", tint: "#F2F5F7", border: "#CDD6DC" },
  cancelled: { label: "Cancelado", accent: "#B24343", tint: "#FFF0F0", border: "#E7B8B8" },
};

function getStatusMeta(status = "") {
  return STATUS_META[status] || STATUS_META.draft;
}

export default function TournamentHeaderCard({
  actions = null,
  children = null,
  category = "",
  subtitle = "",
  title = "Torneo",
  venue = "",
  status = "draft",
}) {
  const statusMeta = getStatusMeta(status);

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <Text numberOfLines={2} style={[styles.title, actions ? styles.titleWithActions : null]}>
          {title}
        </Text>
        {actions ? <View style={styles.actionsWrap}>{actions}</View> : null}
      </View>

      {venue ? (
        <Text numberOfLines={1} style={styles.venue}>
          {venue}
        </Text>
      ) : null}

      <View style={styles.metaRow}>
        {category ? <Text style={styles.metaText}>{category}</Text> : null}
        {category ? <Text style={styles.metaSeparator}>-</Text> : null}
        <View
          style={[
            styles.statusPill,
            {
              backgroundColor: statusMeta.tint,
              borderColor: statusMeta.border,
            },
          ]}
        >
          <Text style={[styles.statusText, { color: statusMeta.accent }]}>{statusMeta.label}</Text>
        </View>
      </View>

      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: "rgba(31,171,137,0.12)",
    borderRadius: 22,
    borderWidth: 1,
    gap: 4,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: {
    color: colors.text,
    flex: 1,
    fontFamily: "serif",
    fontSize: 20,
    fontWeight: "700",
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
  venue: {
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
    gap: 6,
    justifyContent: "center",
  },
  metaText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
    lineHeight: 15,
    textAlign: "center",
  },
  metaSeparator: {
    color: "#7AAFD3",
    fontSize: 12,
    fontWeight: "800",
  },
  statusPill: {
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 24,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  statusText: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  subtitle: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 17,
    textAlign: "center",
  },
});

