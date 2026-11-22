import { useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing } from "../config/theme";

const STATUS_META = {
  draft: { label: "Borrador", accent: "#667482", tint: "#F3F5F7", border: "#D4DBE2" },
  published: { label: "Publicado", accent: "#356CB8", tint: "#EEF5FF", border: "#BED4F7" },
  registration_open: {
    label: "Inscripcion abierta",
    accent: "#1FAE63",
    tint: "#E7FBEF",
    border: "#A9E8C3",
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

// Color unico y acorde a la marca para el titulo del torneo (antes rotaba
// entre varios colores sin relacion con la paleta de la app).
const TOURNAMENT_TITLE_COLOR = colors.primaryLight;

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
  categoryOptions = [],
  activeTournamentId = "",
  children = null,
  category = "",
  compactFriendly = false,
  endDateMillis = 0,
  organizerLogoUrl = "",
  onPosterPress = null,
  onPosterRemove = null,
  onSelectCategory = null,
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
  const compactTitleColor = TOURNAMENT_TITLE_COLOR;
  const [categoryPickerVisible, setCategoryPickerVisible] = useState(false);
  const hasCategorySwitcher = categoryOptions.length > 1 && typeof onSelectCategory === "function";

  if (compactFriendly) {
    return (
      <View style={[styles.card, styles.compactCard]}>
        <View style={styles.compactOrganizerRow}>
          {organizerLogoUrl ? (
            <Image source={{ uri: organizerLogoUrl }} style={styles.organizerLogoThumb} />
          ) : (
            <View style={styles.organizerLogoPlaceholder}>
              <Ionicons color={statusMeta.accent} name="shield-checkmark-outline" size={18} />
            </View>
          )}
          {venue ? (
            <Text numberOfLines={1} style={styles.compactVenueText}>
              {venue}
            </Text>
          ) : null}
          <View style={styles.compactHeaderSpacer} />
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

        <Text style={styles.eyebrow}>TORNEO</Text>
        <Text numberOfLines={2} style={[styles.compactTitle, { color: compactTitleColor }]}>
          {title}
        </Text>

        <View style={styles.compactStatusRow}>
          <View
            style={[
              styles.compactStatusPill,
              { backgroundColor: statusMeta.tint, borderColor: statusMeta.border },
            ]}
          >
            <Text style={[styles.compactStatusText, { color: statusMeta.accent }]}>
              {statusMeta.label}
            </Text>
          </View>
        </View>

        {category ? (
          hasCategorySwitcher ? (
            <Pressable
              onPress={() => setCategoryPickerVisible(true)}
              style={({ pressed }) => [
                styles.categorySwitcherButton,
                pressed ? styles.categorySwitcherButtonPressed : null,
              ]}
            >
              <Text numberOfLines={1} style={styles.categorySwitcherText}>
                {category}
              </Text>
              <Ionicons color={colors.primaryDark} name="chevron-down" size={16} />
            </Pressable>
          ) : (
            <Text numberOfLines={1} style={styles.categoryStaticText}>
              {category}
            </Text>
          )
        ) : null}

        <View style={styles.compactMetaRow}>
          <View style={styles.compactMetaItem}>
            <Ionicons color={colors.primaryDark} name="calendar-outline" size={14} />
            <Text numberOfLines={1} style={styles.compactMetaText}>
              {playDateLabel}
            </Text>
          </View>
        </View>

        {hasCategorySwitcher ? (
          <Modal
            animationType="fade"
            onRequestClose={() => setCategoryPickerVisible(false)}
            transparent
            visible={categoryPickerVisible}
          >
            <View style={styles.categoryModalOverlay}>
              <Pressable
                onPress={() => setCategoryPickerVisible(false)}
                style={styles.categoryModalBackdrop}
              />
              <View style={styles.categoryModalCard}>
                <Text style={styles.categoryModalTitle}>Elegir categoria</Text>
                <ScrollView showsVerticalScrollIndicator={false}>
                  {categoryOptions.map((option) => {
                    const isSelected = option.value === activeTournamentId;

                    return (
                      <Pressable
                        key={option.value}
                        onPress={() => {
                          onSelectCategory(option.value);
                          setCategoryPickerVisible(false);
                        }}
                        style={[
                          styles.categoryOptionRow,
                          isSelected ? styles.categoryOptionRowSelected : null,
                        ]}
                      >
                        <Text
                          style={[
                            styles.categoryOptionText,
                            isSelected ? styles.categoryOptionTextSelected : null,
                          ]}
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            </View>
          </Modal>
        ) : null}

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
  compactMetaText: {
    color: colors.primaryDark,
    flexShrink: 1,
    fontFamily: "Inter_800ExtraBold",
    fontSize: 12,
    lineHeight: 15,
    textAlign: "center",
  },
  compactTitle: {
    flexShrink: 1,
    fontFamily: "Inter_800ExtraBold",
    fontSize: 21,
    letterSpacing: 0.2,
    lineHeight: 25,
    textAlign: "left",
  },
  compactOrganizerRow: {
    alignItems: "center",
    columnGap: 8,
    flexDirection: "row",
    minHeight: 46,
  },
  compactHeaderSpacer: {
    flex: 1,
  },
  eyebrow: {
    color: colors.primaryDark,
    fontFamily: "Inter_900Black",
    fontSize: 11,
    letterSpacing: 0,
    lineHeight: 12,
    marginBottom: 1,
    marginTop: 2,
  },
  compactVenueText: {
    color: "#2F8FCF",
    flexShrink: 1,
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
    lineHeight: 19,
  },
  categorySwitcherButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#EEF5FF",
    borderColor: "#BED4F7",
    borderRadius: 999,
    borderWidth: 1,
    columnGap: 4,
    flexDirection: "row",
    marginTop: 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  categorySwitcherButtonPressed: {
    opacity: 0.85,
  },
  categorySwitcherText: {
    color: colors.primaryDark,
    fontFamily: "Inter_700Bold",
    fontSize: 13,
    maxWidth: 220,
  },
  categoryStaticText: {
    color: colors.primaryDark,
    fontFamily: "Inter_700Bold",
    fontSize: 13,
    marginTop: 4,
    textAlign: "left",
  },
  categoryModalOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
  },
  categoryModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  categoryModalCard: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: "65%",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  categoryModalTitle: {
    color: colors.text,
    fontFamily: "Inter_800ExtraBold",
    fontSize: 22,
    marginBottom: spacing.md,
    textAlign: "center",
  },
  categoryOptionRow: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 16,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  categoryOptionRowSelected: {
    backgroundColor: colors.secondary,
    borderColor: colors.primary,
    borderWidth: 1,
  },
  categoryOptionText: {
    color: colors.text,
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
  },
  categoryOptionTextSelected: {
    color: colors.primaryDark,
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
    position: "relative",
  },
  title: {
    color: TOURNAMENT_TITLE_COLOR,
    flex: 1,
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: 0.3,
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
  compactStatusRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "flex-start",
    marginTop: 6,
  },
  compactStatusPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  compactStatusText: {
    fontFamily: "Inter_900Black",
    fontSize: 11,
    letterSpacing: 0.3,
    textTransform: "uppercase",
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
