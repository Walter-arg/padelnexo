import { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

import AppButton from "../components/AppButton";
import FeedbackModal from "../components/FeedbackModal";
import LeagueCard from "../components/LeagueCard";
import LocationPicker from "../components/LocationPicker";
import SectionHeader from "../components/SectionHeader";
import SelectField from "../components/SelectField";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import { playerCategories } from "../data/profileOptions";
import {
  applyLeagueFavoriteFlags,
  subscribeToFavoriteLeagueIds,
  toggleLeagueFavorite,
} from "../services/leagueFavoritesService";
import {
  getLeagueComplexOptions,
  listLeagues,
} from "../services/leaguesService";
import { isApprovedOrganizer } from "../services/roleService";

export default function LigasScreen() {
  return (
    <ScreenWrapper>
      <View style={styles.card}>
        <Text style={styles.title}>Ligas</Text>
        <Text style={styles.subtitle}>
          Próximamente vas a poder explorar ligas, posiciones y jornadas desde aquí.
        </Text>
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    padding: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "800",
  },
  subtitle: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 24,
    marginTop: spacing.sm,
  },
});
