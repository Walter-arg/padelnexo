import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

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

function buildColorFromString(value = "") {
  const palette = ["#E4572E", "#1C7ED6", "#0F9D58", "#C77D00", "#D63384", "#6C5CE7"];
  const normalized = String(value || "").trim();

  if (!normalized) {
    return "#144234";
  }

  let hash = 0;

  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0;
  }

  return palette[hash % palette.length];
}

function formatPlayDateLabel(startDateMillis = 0, endDateMillis = 0) {
  const start = Number(startDateMillis || 0);
  const end = Number(endDateMillis || 0);
  const formatDate = (value) =>
    new Date(value).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "2-digit",
    });

  if (start && end) {
    return `${formatDate(start)} - ${formatDate(end)}`;
  }

  if (start) {
    return `Desde ${formatDate(start)}`;
  }

  if (end) {
    return `Hasta ${formatDate(end)}`;
  }

  return "A confirmar";
}

export default function TournamentHeaderCard({
  actions = null,
  children = null,
  category = "",
  compactFriendly = false,
  endDateMillis = 0,
  organizerLogoUrl = "",
  onPosterPress = null,
  onPosterRemove = null,
  posterUrl = "",
  subtitle = "",
  startDateMillis = 0,
  title = "Torneo",
  titleColorSeed = "",
  venue = "",
  status = "draft",
}) {
  const statusMeta = getStatusMeta(status);
  const playDateLabel = formatPlayDateLabel(startDateMillis, endDateMillis);
  const compactTitleColor = buildColorFromString(titleColorSeed || category || title);

  if (compactFriendly) {
    return (
      <View style={[styles.card, styles.compactCard]}>
        <View style={styles.compactTitleRow}>
          {organizerLogoUrl ? (
            <Image source={{ uri: organizerLogoUrl }} style={[styles.compactSideThumb, styles.organizerLogoThumb]} />
          ) : (
            <View style={[styles.compactSideThumb, styles.organizerLogoPlaceholder]}>
              <Ionicons color={statusMeta.accent} name="shield-checkmark-outline" size={18} />
            </View>
          )}
          <View style={styles.compactTitleCopy}>
            <Text style={styles.eyebrow}>TORNEO</Text>
            <Text numberOfLines={2} style={[styles.compactTitle, { color: compactTitleColor }]}>
              {title}
            </Text>
          </View>
          {posterUrl ? (
            <View style={styles.posterThumbWrap}>
              <Pressable
                onPress={onPosterPress}
                style={({ pressed }) => [
                  styles.posterThumbButton,
                  pressed ? styles.posterThumbButtonPressed : null,
                ]}
              >
                <Image source={{ uri: posterUrl }} style={styles.posterThumbImage} />
              </Pressable>
              {onPosterRemove ? (
                <Pressable
                  accessibilityLabel="Quitar afiche"
                  onPress={onPosterRemove}
                  style={({ pressed }) => [
                    styles.posterRemoveMiniButton,
                    pressed ? styles.posterRemoveMiniButtonPressed : null,
                  ]}
                >
                  <Ionicons color="#B24343" name="trash-outline" size={12} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {actions ? <View style={styles.compactActionsWrap}>{actions}</View> : null}
        </View>

        <View style={styles.compactMetaRow}>
          {category ? (
            <>
              <View style={styles.compactMetaItem}>
                <Ionicons color={colors.primaryDark} name="ribbon-outline" size={14} />
                <Text numberOfLines={1} style={styles.compactMetaText}>
                  {category}
                </Text>
              </View>
              <Text style={styles.compactMetaSeparator}>-</Text>
            </>
          ) : null}
          <View style={styles.compactMetaItem}>
            <Ionicons color={colors.primaryDark} name="calendar-outline" size={14} />
            <Text numberOfLines={1} style={styles.compactMetaText}>
              {playDateLabel}
            </Text>
          </View>
        </View>
        {children}
      </View>
    );
  }

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
  compactActionsWrap: {
    marginLeft: spacing.sm,
  },
  compactCard: {
    gap: 6,
    paddingVertical: spacing.md,
  },
  compactMetaItem: {
    alignItems: "center",
    columnGap: 5,
    flexDirection: "row",
    justifyContent: "center",
    minWidth: 0,
  },
  compactMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minWidth: 0,
  },
  compactMetaSeparator: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
  },
  compactMetaText: {
    color: colors.primaryDark,
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 15,
    textAlign: "center",
  },
  compactTitle: {
    flexShrink: 1,
    fontFamily: "serif",
    fontSize: 22,
    fontWeight: "700",
    lineHeight: 25,
    textAlign: "center",
  },
  compactTitleCopy: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 54,
    width: "100%",
  },
  compactTitleRow: {
    alignItems: "center",
    columnGap: 8,
    flexDirection: "row",
    justifyContent: "center",
    minHeight: 46,
    position: "relative",
  },
  eyebrow: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0,
    lineHeight: 12,
    marginBottom: 1,
  },
  organizerLogoPlaceholder: {
    alignItems: "center",
    backgroundColor: "#F3FAF6",
    borderColor: "#D5EADF",
    borderRadius: 999,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  organizerLogoThumb: {
    borderColor: "#D5EADF",
    borderRadius: 999,
    borderWidth: 1,
    height: 42,
    resizeMode: "cover",
    width: 42,
  },
  posterRemoveMiniButton: {
    alignItems: "center",
    backgroundColor: "#FFF3F3",
    borderColor: "#E8C5C5",
    borderRadius: 999,
    borderWidth: 1,
    bottom: -4,
    height: 20,
    justifyContent: "center",
    position: "absolute",
    right: -5,
    width: 20,
  },
  posterRemoveMiniButtonPressed: {
    backgroundColor: "#FCE7E7",
  },
  posterThumbButton: {
    borderColor: "#D5EADF",
    borderRadius: 10,
    borderWidth: 1,
    height: 46,
    overflow: "hidden",
    width: 36,
  },
  posterThumbButtonPressed: {
    opacity: 0.9,
  },
  posterThumbImage: {
    height: "100%",
    resizeMode: "cover",
    width: "100%",
  },
  posterThumbWrap: {
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 1,
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
  compactSideThumb: {
    left: 0,
    position: "absolute",
    top: 2,
    zIndex: 1,
  },
});
