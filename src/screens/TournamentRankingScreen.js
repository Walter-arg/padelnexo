import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  Share as NativeShare,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import DateTimePicker from "@react-native-community/datetimepicker";
import RNShare from "react-native-share";
import { captureRef } from "react-native-view-shot";

import BottomQuickActionsBar, {
  BOTTOM_QUICK_ACTIONS_SPACE,
} from "../components/BottomQuickActionsBar";
import FeedbackModal from "../components/FeedbackModal";
import SectionHeader from "../components/SectionHeader";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import { doc, getDoc } from "../../services/firebaseFirestore";
import { db } from "../../services/firebaseConfig";
import {
  buildOrganizerRanking,
  getOrganizerRankingConfig,
  listOrganizerTournamentRankingEntries,
  resetOrganizerRanking,
  updateOrganizerRankingConfig,
} from "../services/tournamentRankingService";

const PUBLIC_RANKING_BASE_URL = "https://www.padelnexo.com.ar/ranking";

function formatConfigDate(millis) {
  if (!millis) {
    return "Sin definir";
  }

  return new Date(millis).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function TournamentRankingScreen({ navigation, route }) {
  const { userData } = useAuth();
  const organizerId = route?.params?.organizerId || "";
  const [loading, setLoading] = useState(true);
  const [organizerProfile, setOrganizerProfile] = useState(null);
  const [entries, setEntries] = useState([]);
  const [config, setConfig] = useState({ fromMillis: 0, toMillis: 0 });
  const [activeCategory, setActiveCategory] = useState(route?.params?.initialCategory || "");
  const [configModalVisible, setConfigModalVisible] = useState(false);
  const [draftConfig, setDraftConfig] = useState({ fromMillis: 0, toMillis: 0 });
  const [datePickerTarget, setDatePickerTarget] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [feedback, setFeedback] = useState({ visible: false, title: "", message: "", tone: "default" });
  const shareViewRef = useRef(null);

  const isOwner = Boolean(organizerId) && organizerId === userData?.uid;

  const showFeedback = (title, message, tone = "default") => {
    setFeedback({ visible: true, title, message, tone });
  };

  const loadRanking = useCallback(async () => {
    if (!organizerId) {
      return;
    }

    try {
      setLoading(true);
      const [organizerSnapshot, nextEntries, nextConfig] = await Promise.all([
        getDoc(doc(db, "users", organizerId)),
        listOrganizerTournamentRankingEntries(organizerId),
        getOrganizerRankingConfig(organizerId),
      ]);

      setOrganizerProfile(organizerSnapshot.exists() ? organizerSnapshot.data() : null);
      setEntries(nextEntries);
      setConfig(nextConfig);
    } catch (error) {
      showFeedback(
        "No pudimos cargar el ranking",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setLoading(false);
    }
  }, [organizerId]);

  useFocusEffect(
    useCallback(() => {
      loadRanking();
    }, [loadRanking])
  );

  const { categories, rankingsByCategory } = buildOrganizerRanking(entries, config);
  const currentCategory = categories.includes(activeCategory) ? activeCategory : categories[0] || "";
  const rows = rankingsByCategory[currentCategory] || [];
  const venueName = organizerProfile?.complejos?.[0]?.nombre || "";

  const openConfigModal = () => {
    setDraftConfig(config);
    setConfigModalVisible(true);
  };

  const handleSaveConfig = async () => {
    try {
      setSavingConfig(true);
      await updateOrganizerRankingConfig(organizerId, draftConfig);
      setConfig(draftConfig);
      setConfigModalVisible(false);
      showFeedback("Configuracion guardada", "El ranking ya refleja el nuevo rango de fechas.", "success");
    } catch (error) {
      showFeedback("No pudimos guardar", error?.message || "Intenta nuevamente.", "danger");
    } finally {
      setSavingConfig(false);
    }
  };

  const handleResetRanking = async () => {
    try {
      setSavingConfig(true);
      const fromMillis = await resetOrganizerRanking(organizerId);
      const nextConfig = { fromMillis, toMillis: 0 };
      setConfig(nextConfig);
      setDraftConfig(nextConfig);
      setConfigModalVisible(false);
      showFeedback("Ranking reseteado", "A partir de ahora el ranking arranca de cero.", "success");
    } catch (error) {
      showFeedback("No pudimos resetear", error?.message || "Intenta nuevamente.", "danger");
    } finally {
      setSavingConfig(false);
    }
  };

  const handleShareLink = async () => {
    const url = `${PUBLIC_RANKING_BASE_URL}/${organizerId}`;
    const clubLabel = venueName || organizerProfile?.name || "este organizador";

    try {
      await NativeShare.share({
        message: `Mira el ranking de torneos de ${clubLabel}: ${url}`,
      });
    } catch (error) {
      // El usuario cerro el panel de compartir.
    }
  };

  const handleShareImage = async () => {
    if (!shareViewRef.current) {
      return;
    }

    try {
      setSharing(true);
      const imageUri = await captureRef(shareViewRef.current, {
        format: "png",
        quality: 1,
        result: "tmpfile",
      });

      await RNShare.open({
        failOnCancel: false,
        title: "Compartir ranking",
        type: "image/png",
        url: Platform.OS === "android" ? `file://${imageUri}` : imageUri,
      });
    } catch (error) {
      if (error?.message && !String(error.message).toLowerCase().includes("cancel")) {
        showFeedback("No pudimos compartir", "Intenta nuevamente en unos instantes.", "danger");
      }
    } finally {
      setSharing(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader onBack={() => navigation.goBack()} subtitle="Ranking" />

      {loading ? (
        <View style={styles.loaderWrap}>
          <ActivityIndicator color={colors.primaryDark} />
          <Text style={styles.loaderText}>Cargando ranking...</Text>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={styles.scrollContent}
          data={rows}
          keyExtractor={(item) => item.key}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View>
              <View ref={shareViewRef} collapsable={false} style={styles.shareCaptureWrap}>
                <View style={styles.headerCard}>
                  {organizerProfile?.organizerLogoUrl ? (
                    <Image source={{ uri: organizerProfile.organizerLogoUrl }} style={styles.organizerLogo} />
                  ) : (
                    <View style={styles.organizerLogoPlaceholder}>
                      <Ionicons color={colors.primaryDark} name="trophy-outline" size={22} />
                    </View>
                  )}
                  {venueName ? <Text style={styles.venueText}>{venueName}</Text> : null}
                  <Text style={styles.rankingTitle}>Ranking</Text>
                  {organizerProfile?.name ? (
                    <Text style={styles.organizerNameText}>{organizerProfile.name}</Text>
                  ) : null}
                </View>

                {categories.length > 0 ? (
                  <View style={styles.chipsRow}>
                    {categories.map((category) => (
                      <Pressable
                        key={category}
                        onPress={() => setActiveCategory(category)}
                        style={[
                          styles.chip,
                          category === currentCategory ? styles.chipActive : null,
                        ]}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            category === currentCategory ? styles.chipTextActive : null,
                          ]}
                          numberOfLines={1}
                        >
                          {category}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}

                {rows.length > 0 ? (
                  <View style={styles.rowsHeader}>
                    <Text style={[styles.rowsHeaderText, styles.rankCol]}>#</Text>
                    <Text style={[styles.rowsHeaderText, styles.nameCol]}>Jugador</Text>
                    <Text style={[styles.rowsHeaderText, styles.pointsCol]}>Pts</Text>
                  </View>
                ) : null}
              </View>

              {rows.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Ionicons color={colors.muted} name="podium-outline" size={28} />
                  <Text style={styles.emptyText}>
                    Todavia no hay torneos finalizados que sumen a este ranking.
                  </Text>
                </View>
              ) : null}
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={[styles.rowText, styles.rankCol, styles.rankText]}>{item.rank}</Text>
              <Text style={[styles.rowText, styles.nameCol]} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={[styles.rowText, styles.pointsCol, styles.pointsText]}>{item.points}</Text>
            </View>
          )}
          ListFooterComponent={
            <View style={styles.actionsWrap}>
              <View style={styles.shareRow}>
                <Pressable onPress={handleShareLink} style={styles.shareButton}>
                  <Ionicons color={colors.primaryDark} name="link-outline" size={16} />
                  <Text style={styles.shareButtonText}>Compartir link</Text>
                </Pressable>
                <Pressable onPress={handleShareImage} disabled={sharing} style={styles.shareButton}>
                  <Ionicons color={colors.primaryDark} name="image-outline" size={16} />
                  <Text style={styles.shareButtonText}>{sharing ? "Generando..." : "Compartir imagen"}</Text>
                </Pressable>
              </View>

              {isOwner ? (
                <Pressable onPress={openConfigModal} style={styles.configButton}>
                  <Ionicons color={colors.primaryDark} name="settings-outline" size={16} />
                  <Text style={styles.configButtonText}>Configurar ranking</Text>
                </Pressable>
              ) : null}
            </View>
          }
        />
      )}

      <Modal animationType="fade" transparent visible={configModalVisible}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Configurar ranking</Text>
              <Pressable onPress={() => setConfigModalVisible(false)}>
                <Ionicons color={colors.muted} name="close" size={20} />
              </Pressable>
            </View>

            <Text style={styles.modalHint}>
              Elegi desde y hasta que fecha se tienen en cuenta los torneos para este ranking.
            </Text>

            <Pressable onPress={() => setDatePickerTarget("fromMillis")} style={styles.dateField}>
              <Text style={styles.dateFieldLabel}>Desde</Text>
              <Text style={styles.dateFieldValue}>{formatConfigDate(draftConfig.fromMillis)}</Text>
            </Pressable>

            <Pressable onPress={() => setDatePickerTarget("toMillis")} style={styles.dateField}>
              <Text style={styles.dateFieldLabel}>Hasta</Text>
              <Text style={styles.dateFieldValue}>
                {draftConfig.toMillis ? formatConfigDate(draftConfig.toMillis) : "Sin limite (hoy)"}
              </Text>
            </Pressable>

            <Pressable
              onPress={handleResetRanking}
              disabled={savingConfig}
              style={styles.resetButton}
            >
              <Ionicons color="#B24343" name="refresh-outline" size={16} />
              <Text style={styles.resetButtonText}>Resetear ranking a cero</Text>
            </Pressable>

            <View style={styles.modalActions}>
              <Pressable onPress={() => setConfigModalVisible(false)} style={styles.modalCancelButton}>
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </Pressable>
              <Pressable
                onPress={handleSaveConfig}
                disabled={savingConfig}
                style={styles.modalSaveButton}
              >
                <Text style={styles.modalSaveText}>{savingConfig ? "Guardando..." : "Guardar"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {datePickerTarget ? (
        <DateTimePicker
          display="default"
          mode="date"
          onChange={(_, selectedDate) => {
            setDatePickerTarget("");

            if (!selectedDate) {
              return;
            }

            setDraftConfig((current) => ({
              ...current,
              [datePickerTarget]: selectedDate.getTime(),
            }));
          }}
          value={new Date(Number(draftConfig[datePickerTarget] || 0) || Date.now())}
        />
      ) : null}

      <FeedbackModal
        message={feedback.message}
        onClose={() => setFeedback((current) => ({ ...current, visible: false }))}
        title={feedback.title}
        tone={feedback.tone}
        visible={feedback.visible}
      />

      <BottomQuickActionsBar />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  loaderWrap: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  loaderText: {
    color: colors.muted,
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    marginTop: spacing.sm,
  },
  scrollContent: {
    paddingBottom: BOTTOM_QUICK_ACTIONS_SPACE + spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  shareCaptureWrap: {
    backgroundColor: colors.background,
  },
  headerCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  organizerLogo: {
    borderRadius: 999,
    height: 56,
    marginBottom: spacing.sm,
    width: 56,
  },
  organizerLogoPlaceholder: {
    alignItems: "center",
    backgroundColor: "#F3FAF6",
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 56,
    justifyContent: "center",
    marginBottom: spacing.sm,
    width: 56,
  },
  venueText: {
    color: "#2F8FCF",
    fontSize: 13,
    fontFamily: "Inter_800ExtraBold",
    marginBottom: 2,
  },
  rankingTitle: {
    color: colors.primaryLight,
    fontSize: 22,
    fontFamily: "Inter_900Black",
    letterSpacing: 0.3,
  },
  organizerNameText: {
    color: colors.muted,
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    marginTop: 2,
  },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  chip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  chipActive: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.primaryDark,
  },
  chipText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontFamily: "Inter_800ExtraBold",
  },
  chipTextActive: {
    color: colors.surface,
  },
  rowsHeader: {
    flexDirection: "row",
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  rowsHeaderText: {
    color: colors.muted,
    fontSize: 11,
    fontFamily: "Inter_900Black",
    textTransform: "uppercase",
  },
  rankCol: {
    width: 36,
  },
  nameCol: {
    flex: 1,
  },
  pointsCol: {
    textAlign: "right",
    width: 50,
  },
  emptyCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  row: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  rowText: {
    color: colors.text,
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  rankText: {
    color: colors.muted,
    fontFamily: "Inter_900Black",
  },
  pointsText: {
    color: colors.primaryDark,
    fontFamily: "Inter_900Black",
  },
  actionsWrap: {
    marginTop: spacing.md,
  },
  shareRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  shareButton: {
    alignItems: "center",
    backgroundColor: "#F0F7F4",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    paddingVertical: spacing.sm,
  },
  shareButtonText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontFamily: "Inter_800ExtraBold",
  },
  configButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    paddingVertical: spacing.sm,
  },
  configButtonText: {
    color: colors.primaryDark,
    fontSize: 13,
    fontFamily: "Inter_800ExtraBold",
  },
  modalOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(19,44,35,0.5)",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: spacing.lg,
    width: "100%",
  },
  modalHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 16,
    fontFamily: "Inter_900Black",
  },
  modalHint: {
    color: colors.muted,
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    marginBottom: spacing.md,
  },
  dateField: {
    backgroundColor: "#F6FBF8",
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  dateFieldLabel: {
    color: colors.muted,
    fontSize: 11,
    fontFamily: "Inter_800ExtraBold",
    textTransform: "uppercase",
  },
  dateFieldValue: {
    color: colors.text,
    fontSize: 15,
    fontFamily: "Inter_800ExtraBold",
    marginTop: 2,
  },
  resetButton: {
    alignItems: "center",
    backgroundColor: "#FFF1F1",
    borderColor: "#F1C8C8",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    paddingVertical: spacing.sm,
  },
  resetButtonText: {
    color: "#B24343",
    fontSize: 13,
    fontFamily: "Inter_800ExtraBold",
  },
  modalActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  modalCancelButton: {
    alignItems: "center",
    backgroundColor: "#ECF8F2",
    borderRadius: 14,
    flex: 1,
    paddingVertical: spacing.sm,
  },
  modalCancelText: {
    color: colors.text,
    fontSize: 14,
    fontFamily: "Inter_800ExtraBold",
  },
  modalSaveButton: {
    alignItems: "center",
    backgroundColor: colors.primaryDark,
    borderRadius: 14,
    flex: 1,
    paddingVertical: spacing.sm,
  },
  modalSaveText: {
    color: colors.surface,
    fontSize: 14,
    fontFamily: "Inter_800ExtraBold",
  },
});
