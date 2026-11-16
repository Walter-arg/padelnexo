import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";

import BottomQuickActionsBar, {
  BOTTOM_QUICK_ACTIONS_SPACE,
} from "../components/BottomQuickActionsBar";
import FeedbackModal from "../components/FeedbackModal";
import SectionHeader from "../components/SectionHeader";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import { getTournamentById, updateTournamentRules } from "../services/tournamentsService";

// Reconoce **negrita** (el boton "N" de este editor) y tambien *negrita*
// (la convencion de WhatsApp), para que un texto pegado desde ahi ya se vea
// formateado sin tener que retocarlo.
function parseRulesSegments(text = "") {
  const segments = [];
  const regex = /\*\*([\s\S]+?)\*\*|\*([^*\n]+?)\*/g;
  let lastIndex = 0;
  let match = regex.exec(text);

  while (match) {
    if (match.index > lastIndex) {
      segments.push({ bold: false, text: text.slice(lastIndex, match.index) });
    }

    segments.push({ bold: true, text: match[1] !== undefined ? match[1] : match[2] });
    lastIndex = match.index + match[0].length;
    match = regex.exec(text);
  }

  if (lastIndex < text.length) {
    segments.push({ bold: false, text: text.slice(lastIndex) });
  }

  return segments;
}

function RulesText({ style, text }) {
  const segments = parseRulesSegments(text);

  return (
    <Text style={style}>
      {segments.map((segment, index) => (
        <Text key={`segment-${index}`} style={segment.bold ? styles.boldSegment : null}>
          {segment.text}
        </Text>
      ))}
    </Text>
  );
}

export default function TournamentRulesScreen({ navigation, route }) {
  const { userData } = useAuth();
  const tournamentId = route?.params?.tournamentId || "";
  const tournamentName = route?.params?.tournamentName || "Torneo";
  const [tournament, setTournament] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rulesDraft, setRulesDraft] = useState("");
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState({ visible: false, title: "", message: "", tone: "default" });

  const showFeedback = (title, message, tone = "default") => {
    setFeedback({ visible: true, title, message, tone });
  };

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      const loadTournament = async () => {
        try {
          setLoading(true);
          const nextTournament = await getTournamentById(tournamentId);

          if (!isMounted) {
            return;
          }

          setTournament(nextTournament);
          setRulesDraft(nextTournament?.rules || "");
        } catch (error) {
          if (isMounted) {
            showFeedback(
              "No pudimos cargar el torneo",
              error?.message || "Intenta nuevamente en unos instantes.",
              "danger"
            );
          }
        } finally {
          if (isMounted) {
            setLoading(false);
          }
        }
      };

      loadTournament();

      return () => {
        isMounted = false;
      };
    }, [tournamentId])
  );

  const canManage = Boolean(
    tournament &&
      userData?.uid &&
      (tournament.organizerId === userData.uid || tournament.createdBy === userData.uid)
  );
  const hasUnsavedChanges = rulesDraft !== (tournament?.rules || "");

  const applyBoldToSelection = () => {
    const start = Math.min(selection.start, selection.end);
    const end = Math.max(selection.start, selection.end);

    if (start === end) {
      const nextText = `${rulesDraft.slice(0, start)}****${rulesDraft.slice(start)}`;
      setRulesDraft(nextText);
      setSelection({ start: start + 2, end: start + 2 });
      return;
    }

    const selectedText = rulesDraft.slice(start, end);
    const isAlreadyBold =
      selectedText.length >= 4 && selectedText.startsWith("**") && selectedText.endsWith("**");

    if (isAlreadyBold) {
      const innerText = selectedText.slice(2, -2);
      const nextText = `${rulesDraft.slice(0, start)}${innerText}${rulesDraft.slice(end)}`;
      setRulesDraft(nextText);
      setSelection({ start, end: start + innerText.length });
      return;
    }

    const nextText = `${rulesDraft.slice(0, start)}**${selectedText}**${rulesDraft.slice(end)}`;
    setRulesDraft(nextText);
    setSelection({ start, end: end + 4 });
  };

  const handleSaveRules = async () => {
    if (!tournamentId || saving) {
      return;
    }

    try {
      setSaving(true);
      await updateTournamentRules(tournamentId, rulesDraft);
      setTournament((current) => ({ ...current, rules: rulesDraft }));
      showFeedback("Reglamento guardado", "Los jugadores ya pueden verlo.", "success");
    } catch (error) {
      showFeedback(
        "No pudimos guardar el reglamento",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader onBack={() => navigation.goBack()} subtitle={tournamentName || "Reglamento"} />

      <View style={styles.container}>
        {loading ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator color={colors.primaryDark} />
            <Text style={styles.loaderText}>Cargando reglamento...</Text>
          </View>
        ) : canManage ? (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.sectionTitle}>Reglamento del torneo</Text>
            <Text style={styles.sectionHint}>
              Escribi o pega el reglamento (podes pegarlo directo desde WhatsApp, con emojis y
              todo). Los jugadores lo van a poder leer antes de inscribirse, pero no modificarlo.
            </Text>

            <View style={styles.toolbarRow}>
              <Pressable
                onPress={applyBoldToSelection}
                style={({ pressed }) => [styles.boldButton, pressed ? styles.boldButtonPressed : null]}
              >
                <Text style={styles.boldButtonText}>N</Text>
              </Pressable>
              <Text style={styles.toolbarHint}>Selecciona un texto y toca "N" para resaltarlo.</Text>
            </View>

            <TextInput
              multiline
              onChangeText={setRulesDraft}
              onSelectionChange={(event) => setSelection(event.nativeEvent.selection)}
              placeholder="Ej: El torneo se juega al mejor de 3 sets. Las inasistencias sin aviso..."
              placeholderTextColor={colors.muted}
              style={styles.textInput}
              value={rulesDraft}
            />

            {rulesDraft ? (
              <View style={styles.previewCard}>
                <Text style={styles.previewLabel}>Vista previa</Text>
                <RulesText style={styles.previewText} text={rulesDraft} />
              </View>
            ) : null}

            <Pressable
              disabled={!hasUnsavedChanges || saving}
              onPress={handleSaveRules}
              style={({ pressed }) => [
                styles.saveButton,
                !hasUnsavedChanges || saving ? styles.saveButtonDisabled : null,
                pressed && hasUnsavedChanges && !saving ? styles.saveButtonPressed : null,
              ]}
            >
              <Text style={styles.saveButtonText}>{saving ? "Guardando..." : "Guardar"}</Text>
            </Pressable>
          </ScrollView>
        ) : (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.sectionTitle}>Reglamento del torneo</Text>
            {tournament?.rules ? (
              <View style={styles.readOnlyCard}>
                <RulesText style={styles.readOnlyText} text={tournament.rules} />
              </View>
            ) : (
              <View style={styles.emptyCard}>
                <Ionicons color={colors.muted} name="document-text-outline" size={28} />
                <Text style={styles.emptyText}>
                  El organizador todavia no cargo el reglamento de este torneo.
                </Text>
              </View>
            )}
          </ScrollView>
        )}
      </View>

      <FeedbackModal
        message={feedback.message}
        onClose={() => setFeedback((current) => ({ ...current, visible: false }))}
        title={feedback.title}
        tone={feedback.tone}
        visible={feedback.visible}
      />

      <BottomQuickActionsBar navigation={navigation} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  loaderWrap: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  loaderText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
    marginTop: spacing.sm,
  },
  scrollContent: {
    paddingBottom: BOTTOM_QUICK_ACTIONS_SPACE + spacing.lg,
    paddingTop: spacing.md,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    marginBottom: spacing.xs,
  },
  sectionHint: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "500",
    marginBottom: spacing.md,
  },
  toolbarRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: 56,
  },
  boldButton: {
    alignItems: "center",
    backgroundColor: "#E9FFF0",
    borderColor: colors.primaryDark,
    borderRadius: 10,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  boldButtonPressed: {
    opacity: 0.85,
  },
  boldButtonText: {
    color: colors.primaryDark,
    fontSize: 15,
    fontWeight: "900",
  },
  toolbarHint: {
    color: colors.muted,
    flex: 1,
    fontSize: 12,
    fontWeight: "500",
  },
  textInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    color: colors.text,
    fontSize: 14,
    minHeight: 220,
    padding: spacing.md,
    textAlignVertical: "top",
  },
  previewCard: {
    backgroundColor: "#F6FBF8",
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  previewLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.4,
    marginBottom: spacing.xs,
    textTransform: "uppercase",
  },
  previewText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  boldSegment: {
    fontWeight: "800",
  },
  saveButton: {
    alignItems: "center",
    backgroundColor: colors.primaryDark,
    borderRadius: 16,
    justifyContent: "center",
    marginTop: spacing.lg,
    paddingVertical: 14,
  },
  saveButtonDisabled: {
    opacity: 0.4,
  },
  saveButtonPressed: {
    opacity: 0.9,
  },
  saveButtonText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: "800",
  },
  readOnlyCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    padding: spacing.md,
  },
  readOnlyText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 21,
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
    fontWeight: "600",
    textAlign: "center",
  },
});
