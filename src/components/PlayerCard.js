import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing } from "../config/theme";
import { getAvailabilitySummaryItems, isAvailableToday } from "../services/availabilityService";
import { hasProfileImage } from "../utils/defaultProfileImage";

const FAVORITE_ICON_COLOR = "#BF6F00";
const ACTION_SILVER_BG = "#F1F3F5";
const ACTION_SILVER_BORDER = "#C9D0D6";
const ACTION_SILVER_TEXT = "#5F6B76";
const FAVORITE_BUTTON_SIZE = 28;
const ACTION_BUTTON_WIDTH = 68;

export default function PlayerCard({
  player,
  onViewProfile,
  onMessage,
  onToggleFavorite,
  isBlocked = false,
}) {
  const hasImage = hasProfileImage(player.foto);
  const hasConfiguredAvailability = getAvailabilitySummaryItems(player?.availability).length > 0;
  const isAvailable = Boolean(player?.disponibleHoy) || isAvailableToday(player?.availability);
  const shouldShowAvailability = isAvailable || hasConfiguredAvailability;

  return (
    <View style={[styles.card, isBlocked && styles.cardBlocked]}>
      <View style={styles.headerRow}>
        {hasImage ? (
          <Image source={{ uri: player.foto }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Ionicons color="#9CA3AF" name="person" size={30} />
          </View>
        )}

        <View style={styles.headerCopy}>
          <Text numberOfLines={1} style={styles.name}>
            {player.nombre}
          </Text>
          <View style={styles.categoryRow}>
            <Text style={styles.category}>{player.categoria}</Text>
            {shouldShowAvailability ? (
              <View style={styles.availabilityInline}>
                <View style={styles.availabilityDot} />
                <Text style={styles.availabilityText}>Disponible hoy</Text>
              </View>
            ) : null}
          </View>
          <Text numberOfLines={1} style={styles.city}>
            {player.ciudad}
          </Text>
        </View>

        <View style={styles.actionsColumn}>
          <View style={styles.mainActionsColumn}>
            <View style={styles.profileRow}>
              <View style={styles.favoriteSpacer} />
              <Pressable
                onPress={onViewProfile}
                disabled={isBlocked}
                style={({ pressed }) => [
                  styles.actionButton,
                  styles.profileButton,
                  isBlocked && styles.blockedButton,
                  pressed && styles.actionButtonPressed,
                ]}
              >
                <Ionicons
                  color={isBlocked ? "#96A6A0" : ACTION_SILVER_TEXT}
                  name="person-outline"
                  size={13}
                  style={styles.actionButtonIcon}
                />
                <Text style={styles.actionButtonText}>Perfil</Text>
              </Pressable>
            </View>
            <View style={styles.messageRow}>
              <Pressable
                onPress={onToggleFavorite}
                disabled={isBlocked}
                style={({ pressed }) => [
                  styles.iconButton,
                  styles.favoriteIconButton,
                  isBlocked && styles.blockedButton,
                  pressed && styles.iconButtonPressed,
                ]}
              >
                <Ionicons
                  color={isBlocked ? "#96A6A0" : FAVORITE_ICON_COLOR}
                  name={player?.esFavorito ? "star" : "star-outline"}
                  size={15}
                />
              </Pressable>
              <Pressable
                onPress={onMessage}
                disabled={isBlocked}
                style={({ pressed }) => [
                  styles.actionButton,
                  styles.messageButton,
                  isBlocked && styles.blockedButton,
                  pressed && styles.actionButtonPressed,
                ]}
              >
                <Ionicons
                  color={isBlocked ? "#96A6A0" : ACTION_SILVER_TEXT}
                  name="chatbubble-ellipses-outline"
                  size={13}
                  style={styles.actionButtonIcon}
                />
                <Text style={styles.actionButtonText}>Mensaje</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 22,
    borderWidth: 1,
    marginBottom: spacing.sm,
    padding: spacing.md,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3,
  },
  cardBlocked: {
    backgroundColor: "#EEF3F1",
    borderColor: "#D7E0DC",
    opacity: 0.86,
  },
  headerRow: {
    alignItems: "center",
    flexDirection: "row",
  },
  avatar: {
    borderRadius: 28,
    height: 56,
    width: 56,
  },
  avatarPlaceholder: {
    alignItems: "center",
    backgroundColor: "#E5E7EB",
    borderRadius: 28,
    height: 56,
    justifyContent: "center",
    width: 56,
  },
  headerCopy: {
    flex: 1,
    marginLeft: spacing.sm,
    marginRight: 4,
  },
  name: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
  },
  category: {
    color: "#8A5A2B",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 2,
  },
  categoryRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  city: {
    color: colors.muted,
    fontSize: 13,
    marginTop: 2,
  },
  availabilityInline: {
    alignItems: "center",
    flexDirection: "row",
  },
  availabilityDot: {
    backgroundColor: "#27AE60",
    borderRadius: 999,
    height: 8,
    marginRight: 6,
    width: 8,
  },
  availabilityText: {
    color: "#1F8F87",
    fontSize: 11,
    fontWeight: "800",
  },
  actionsColumn: {
    width: 104,
  },
  mainActionsColumn: {
    gap: 6,
    width: "100%",
  },
  profileRow: {
    flexDirection: "row",
    gap: 6,
  },
  favoriteSpacer: {
    width: FAVORITE_BUTTON_SIZE,
  },
  profileButton: {
    width: ACTION_BUTTON_WIDTH,
  },
  messageRow: {
    flexDirection: "row",
    gap: 6,
  },
  messageButton: {
    width: ACTION_BUTTON_WIDTH,
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: colors.secondary,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    height: FAVORITE_BUTTON_SIZE,
    justifyContent: "center",
    paddingHorizontal: 0,
    width: FAVORITE_BUTTON_SIZE,
  },
  favoriteIconButton: {
    backgroundColor: colors.surface,
  },
  iconButtonPressed: {
    opacity: 0.9,
  },
  blockedButton: {
    backgroundColor: "#F0F4F2",
    borderColor: "#D5DEDA",
    opacity: 0.75,
  },
  actionButton: {
    alignItems: "center",
    backgroundColor: ACTION_SILVER_BG,
    borderColor: ACTION_SILVER_BORDER,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: FAVORITE_BUTTON_SIZE,
    paddingHorizontal: 6,
  },
  actionButtonPressed: {
    opacity: 0.88,
  },
  actionButtonIcon: {
    marginTop: 4,
  },
  actionButtonText: {
    color: ACTION_SILVER_TEXT,
    fontSize: 10,
    fontWeight: "800",
    marginTop: 2,
  },
});
