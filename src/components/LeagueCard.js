import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing } from "../config/theme";

const FAVORITE_COLOR = "#BF6F00";

export default function LeagueCard({ league, onDelete, onToggleFavorite }) {
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.copy}>
          <Text numberOfLines={1} style={styles.name}>
            {league.nombre}
          </Text>
          <Text numberOfLines={1} style={styles.complex}>
            {league.complejoNombre}
          </Text>
        </View>

        <View style={styles.actionsColumn}>
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
          {onDelete ? (
            <Pressable
              onPress={onDelete}
              style={({ pressed }) => [styles.deleteButton, pressed && styles.favoriteButtonPressed]}
            >
              <Ionicons color={colors.danger} name="trash-outline" size={17} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.metaRow}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{league.categoria}</Text>
        </View>
        <View style={styles.badgeSecondary}>
          <Text style={styles.badgeSecondaryText}>{league.sexo}</Text>
        </View>
      </View>

      <View style={styles.footerRow}>
        <Ionicons color={colors.muted} name="location-outline" size={14} />
        <Text numberOfLines={1} style={styles.location}>
          {league.localidad}
          {league.provincia ? `, ${league.provincia}` : ""}
        </Text>
      </View>

      {league.organizerName ? (
        <Text numberOfLines={1} style={styles.organizer}>
          Organiza: {league.organizerName}
        </Text>
      ) : null}
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
  headerRow: {
    alignItems: "flex-start",
    flexDirection: "row",
  },
  copy: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  name: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
  },
  complex: {
    color: "#8A5A2B",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 2,
  },
  actionsColumn: {
    gap: 6,
  },
  favoriteButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  deleteButton: {
    alignItems: "center",
    backgroundColor: "#FFF1F1",
    borderColor: "#F2C4C4",
    borderRadius: 12,
    borderWidth: 1,
    height: 30,
    justifyContent: "center",
    width: 30,
  },
  favoriteButtonPressed: {
    opacity: 0.9,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  badge: {
    backgroundColor: "#FFF4E7",
    borderColor: "#E8C58E",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeText: {
    color: "#8A5A2B",
    fontSize: 12,
    fontWeight: "800",
  },
  badgeSecondary: {
    backgroundColor: "#EEF6F2",
    borderColor: "#CFE1D8",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeSecondaryText: {
    color: "#456F61",
    fontSize: 12,
    fontWeight: "800",
  },
  footerRow: {
    alignItems: "center",
    flexDirection: "row",
    marginTop: spacing.sm,
  },
  location: {
    color: colors.muted,
    flex: 1,
    fontSize: 13,
    marginLeft: 6,
  },
  organizer: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 6,
  },
});
