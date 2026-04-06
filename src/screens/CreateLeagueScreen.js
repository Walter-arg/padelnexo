import { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

import AppButton from "../components/AppButton";
import AppInput from "../components/AppInput";
import FeedbackModal from "../components/FeedbackModal";
import SectionHeader from "../components/SectionHeader";
import SelectField from "../components/SelectField";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import {
  buildFixedSumLabel,
  createLeague,
  LEAGUE_BRANCH_OPTIONS,
  LEAGUE_CATEGORY_FORMAT_OPTIONS,
  LEAGUE_CATEGORY_OPTIONS,
  LEAGUE_SUM_RULE_OPTIONS,
  LEAGUE_SUM_TARGET_OPTIONS,
  LEAGUE_TEAM_TYPE_OPTIONS,
  MATCH_FORMAT_OPTIONS,
  normalizeLeagueDefaults,
} from "../services/leaguesService";
import { isApprovedOrganizer } from "../services/roleService";

function buildInitialForm(userData) {
  const defaults = normalizeLeagueDefaults(userData?.leagueDefaults || {});
  const firstComplex = Array.isArray(userData?.complejos) ? userData.complejos[0] : null;

  return {
    name: "",
    complexName: firstComplex?.nombre || "",
    branch: defaults.branch,
    teamType: defaults.teamType,
    categoryFormat: defaults.categoryFormat,
    sumTarget: defaults.sumTarget,
    sumRule: defaults.sumRule,
    fixedCategoryA: defaults.fixedCategoryA,
    fixedCategoryB: defaults.fixedCategoryB,
    matchFormat: defaults.matchFormat,
    allowWalkover: defaults.allowWalkover,
    pointsWin: String(defaults.pointsWin),
    pointsLoss: String(defaults.pointsLoss),
    pointsWalkoverWin: String(defaults.pointsWalkoverWin),
    replacementPenalty: String(defaults.replacementPenalty),
  };
}

function ChipGroup({ onChange, options, value }) {
  return (
    <View style={styles.chipRow}>
      {options.map((option) => {
        const isActive = option.value === value;

        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.chip, isActive && styles.chipActive]}
          >
            <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
              {option.label}
            </Text>
            {option.description ? (
              <Text
                style={[styles.chipDescription, isActive && styles.chipDescriptionActive]}
              >
                {option.description}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function sanitizeNumber(value) {
  return String(value || "").replace(/[^0-9]/g, "").slice(0, 2);
}

export default function CreateLeagueScreen({ navigation }) {
  const { updateProfile, userData } = useAuth();
  const [form, setForm] = useState(() => buildInitialForm(userData));
  const [submitting, setSubmitting] = useState(false);
  const [isComplexVisible, setIsComplexVisible] = useState(false);
  const [isSumVisible, setIsSumVisible] = useState(false);
  const [isCategoryAVisible, setIsCategoryAVisible] = useState(false);
  const [isCategoryBVisible, setIsCategoryBVisible] = useState(false);
  const [feedback, setFeedback] = useState({
    visible: false,
    title: "",
    message: "",
    tone: "default",
  });

  const organizerComplexOptions = useMemo(
    () =>
      (userData?.complejos || []).map((complex) => ({
        label: complex.nombre,
        value: complex.nombre,
      })),
    [userData?.complejos]
  );

  const selectedComplex = useMemo(
    () =>
      (userData?.complejos || []).find((complex) => complex.nombre === form.complexName) || null,
    [form.complexName, userData?.complejos]
  );

  const canCreateLeague = isApprovedOrganizer(userData);
  const sumPreview =
    form.categoryFormat === "suma"
      ? buildFixedSumLabel(
          form.branch,
          form.sumTarget,
          form.sumRule,
          form.fixedCategoryA,
          form.fixedCategoryB
        )
      : `Libre ${
          form.branch === "Femenino"
            ? "Damas"
            : form.branch === "Mixto"
              ? "Mixta"
              : "Caballeros"
        }`;

  const standingsSummary =
    form.teamType === "individual"
      ? "Se generan 2 tablas de puntos: Drive y Reves."
      : "Se genera una tabla unica por parejas.";

  const showFeedback = (title, message, tone = "default") => {
    setFeedback({
      visible: true,
      title,
      message,
      tone,
    });
  };

  const updateField = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleToggleWalkover = () => {
    updateField("allowWalkover", !form.allowWalkover);
  };

  const validateForm = () => {
    if (!canCreateLeague) {
      showFeedback(
        "Acceso restringido",
        "Solo los organizadores aprobados pueden crear ligas.",
        "danger"
      );
      return false;
    }

    if (!form.name.trim()) {
      showFeedback("Falta el nombre", "Ingresa un nombre para la liga.", "danger");
      return false;
    }

    if (!selectedComplex) {
      showFeedback("Falta el complejo", "Selecciona un complejo organizador.", "danger");
      return false;
    }

    if (form.categoryFormat === "suma") {
      if (!form.sumTarget) {
        showFeedback("Falta la suma", "Selecciona que suma va a jugar la liga.", "danger");
        return false;
      }

      if (form.sumRule === "fixed") {
        if (!form.fixedCategoryA || !form.fixedCategoryB) {
          showFeedback(
            "Faltan categorias",
            "Selecciona las dos categorias fijas de la suma.",
            "danger"
          );
          return false;
        }

        const firstValue = Number.parseInt(form.fixedCategoryA, 10) || 0;
        const secondValue = Number.parseInt(form.fixedCategoryB, 10) || 0;
        const targetValue = Number.parseInt(form.sumTarget, 10) || 0;

        if (firstValue + secondValue !== targetValue) {
          showFeedback(
            "La suma no coincide",
            "Las categorias fijas deben coincidir exactamente con la suma seleccionada.",
            "danger"
          );
          return false;
        }
      }
    }

    if (!form.pointsWin) {
      showFeedback("Faltan puntos", "Define cuantos puntos suma el ganador.", "danger");
      return false;
    }

    if (!form.pointsLoss) {
      showFeedback("Faltan puntos", "Define cuantos puntos suma el perdedor.", "danger");
      return false;
    }

    if (!form.pointsWalkoverWin) {
      showFeedback(
        "Faltan puntos",
        "Define cuantos puntos suma el ganador por W.O.",
        "danger"
      );
      return false;
    }

    if (!form.replacementPenalty) {
      showFeedback(
        "Falta descuento",
        "Define cuantos puntos se descuentan por reemplazos.",
        "danger"
      );
      return false;
    }

    return true;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      setSubmitting(true);

      await createLeague(userData, {
        name: form.name,
        complex: selectedComplex,
        branch: form.branch,
        teamType: form.teamType,
        categoryFormat: form.categoryFormat,
        sumTarget: form.sumTarget,
        sumRule: form.sumRule,
        fixedCategoryA: form.fixedCategoryA,
        fixedCategoryB: form.fixedCategoryB,
        matchFormat: form.matchFormat,
        allowWalkover: form.allowWalkover,
        pointsWin: form.pointsWin,
        pointsLoss: form.pointsLoss,
        pointsWalkoverWin: form.pointsWalkoverWin,
        replacementPenalty: form.replacementPenalty,
      });

      await updateProfile({
        leagueDefaults: normalizeLeagueDefaults({
          branch: form.branch,
          teamType: form.teamType,
          categoryFormat: form.categoryFormat,
          sumTarget: form.sumTarget,
          sumRule: form.sumRule,
          fixedCategoryA: form.fixedCategoryA,
          fixedCategoryB: form.fixedCategoryB,
          matchFormat: form.matchFormat,
          allowWalkover: form.allowWalkover,
          pointsWin: form.pointsWin,
          pointsLoss: form.pointsLoss,
          pointsWalkoverWin: form.pointsWalkoverWin,
          replacementPenalty: form.replacementPenalty,
        }),
      });

      showFeedback(
        "Liga creada",
        "La liga se guardo correctamente y esta configuracion quedo como base para la proxima.",
        "success"
      );
    } catch (error) {
      showFeedback(
        "No pudimos crear la liga",
        error?.message || "Intenta nuevamente en unos instantes.",
        "danger"
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader onBack={() => navigation.goBack()} subtitle="Crear liga" />
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <Text style={styles.heroTitle}>Configura la liga con reglas reales</Text>
          <Text style={styles.heroText}>
            La base del organizador se precarga, pero esta liga puede llevar un formato distinto en
            categorias, partidos y puntuacion.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Datos principales</Text>
          <AppInput
            autoCapitalize="words"
            label="Nombre de la liga"
            onChangeText={(value) => updateField("name", value.slice(0, 40))}
            placeholder="Ej. Clausura Zona Centro"
            value={form.name}
          />
          <SelectField
            containerStyle={styles.fieldSpacing}
            label="Complejo"
            onClose={() => setIsComplexVisible(false)}
            onOpen={() => setIsComplexVisible(true)}
            onSelect={(value) => updateField("complexName", value)}
            options={organizerComplexOptions}
            placeholder="Selecciona un complejo"
            value={form.complexName}
            visible={isComplexVisible}
          />
          <Text style={styles.contextText}>
            Localidad base: {userData?.localidad?.nombre || userData?.city || "Sin localidad"}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Categoria de la liga</Text>

          <Text style={styles.subsectionTitle}>Rama</Text>
          <ChipGroup
            onChange={(value) => updateField("branch", value)}
            options={LEAGUE_BRANCH_OPTIONS}
            value={form.branch}
          />

          <Text style={styles.subsectionTitle}>Tipo de competencia</Text>
          <ChipGroup
            onChange={(value) => updateField("teamType", value)}
            options={LEAGUE_TEAM_TYPE_OPTIONS}
            value={form.teamType}
          />

          <Text style={styles.subsectionTitle}>Regla de categoria</Text>
          <ChipGroup
            onChange={(value) =>
              setForm((current) => ({
                ...current,
                categoryFormat: value,
                sumTarget: value === "suma" ? current.sumTarget : "",
                sumRule: value === "suma" ? current.sumRule : "open",
                fixedCategoryA: value === "suma" ? current.fixedCategoryA : "",
                fixedCategoryB: value === "suma" ? current.fixedCategoryB : "",
              }))
            }
            options={LEAGUE_CATEGORY_FORMAT_OPTIONS}
            value={form.categoryFormat}
          />

          {form.categoryFormat === "suma" ? (
            <View style={styles.sumCard}>
              <SelectField
                label="Que suma juega"
                onClose={() => setIsSumVisible(false)}
                onOpen={() => setIsSumVisible(true)}
                onSelect={(value) => updateField("sumTarget", value)}
                options={LEAGUE_SUM_TARGET_OPTIONS}
                placeholder="Selecciona una suma"
                value={form.sumTarget}
                visible={isSumVisible}
              />

              <Text style={styles.subsectionTitle}>Como se arma la suma</Text>
              <ChipGroup
                onChange={(value) => updateField("sumRule", value)}
                options={LEAGUE_SUM_RULE_OPTIONS}
                value={form.sumRule}
              />

              {form.sumRule === "fixed" ? (
                <View style={styles.sumSelectorsRow}>
                  <SelectField
                    containerStyle={styles.sumField}
                    label="Categoria 1"
                    onClose={() => setIsCategoryAVisible(false)}
                    onOpen={() => setIsCategoryAVisible(true)}
                    onSelect={(value) => updateField("fixedCategoryA", value)}
                    options={LEAGUE_CATEGORY_OPTIONS}
                    placeholder="Elegir"
                    value={form.fixedCategoryA}
                    visible={isCategoryAVisible}
                  />
                  <SelectField
                    containerStyle={styles.sumField}
                    label="Categoria 2"
                    onClose={() => setIsCategoryBVisible(false)}
                    onOpen={() => setIsCategoryBVisible(true)}
                    onSelect={(value) => updateField("fixedCategoryB", value)}
                    options={LEAGUE_CATEGORY_OPTIONS}
                    placeholder="Elegir"
                    value={form.fixedCategoryB}
                    visible={isCategoryBVisible}
                  />
                </View>
              ) : (
                <View style={styles.infoCard}>
                  <Ionicons color={colors.primaryDark} name="shuffle-outline" size={18} />
                  <Text style={styles.infoCardText}>
                    Cualquier pareja puede postularse si entre ambos alcanza exactamente la suma
                    elegida, sin importar como se reparte.
                  </Text>
                </View>
              )}
            </View>
          ) : null}

          <View style={styles.sumPreview}>
            <Text style={styles.sumPreviewLabel}>Como se publica</Text>
            <Text style={styles.sumPreviewValue}>{sumPreview}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Formato de partidos</Text>
          <ChipGroup
            onChange={(value) => updateField("matchFormat", value)}
            options={MATCH_FORMAT_OPTIONS}
            value={form.matchFormat}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Sistema de puntuacion</Text>
          <View style={styles.scoreGrid}>
            <AppInput
              containerStyle={styles.scoreField}
              keyboardType="number-pad"
              label="Puntos por ganar"
              onChangeText={(value) => updateField("pointsWin", sanitizeNumber(value))}
              placeholder="3"
              value={form.pointsWin}
            />
            <AppInput
              containerStyle={styles.scoreField}
              keyboardType="number-pad"
              label="Puntos por perder"
              onChangeText={(value) => updateField("pointsLoss", sanitizeNumber(value))}
              placeholder="1"
              value={form.pointsLoss}
            />
          </View>
          <View style={styles.scoreGrid}>
            <AppInput
              containerStyle={styles.scoreField}
              keyboardType="number-pad"
              label="Puntos por ganar W.O."
              onChangeText={(value) => updateField("pointsWalkoverWin", sanitizeNumber(value))}
              placeholder="3"
              value={form.pointsWalkoverWin}
            />
            <AppInput
              containerStyle={styles.scoreField}
              keyboardType="number-pad"
              label="Descuento por reemplazo"
              onChangeText={(value) => updateField("replacementPenalty", sanitizeNumber(value))}
              placeholder="1"
              value={form.replacementPenalty}
            />
          </View>

          <Pressable onPress={handleToggleWalkover} style={styles.walkoverRow}>
            <View style={styles.walkoverTextWrap}>
              <Text style={styles.walkoverTitle}>Registrar W.O.</Text>
              <Text style={styles.walkoverText}>
                Si un equipo llega mas de 15 minutos tarde, el rival gana automaticamente 6-0 /
                6-0.
              </Text>
            </View>
            <View style={[styles.walkoverBadge, form.allowWalkover && styles.walkoverBadgeActive]}>
              <Text
                style={[
                  styles.walkoverBadgeText,
                  form.allowWalkover && styles.walkoverBadgeTextActive,
                ]}
              >
                {form.allowWalkover ? "Activo" : "Inactivo"}
              </Text>
            </View>
          </Pressable>

          <View style={styles.infoCard}>
            <Ionicons color={colors.primaryDark} name="stats-chart-outline" size={18} />
            <Text style={styles.infoCardText}>{standingsSummary}</Text>
          </View>
        </View>

        <AppButton
          disabled={submitting}
          onPress={handleSubmit}
          style={styles.submitButton}
          title={submitting ? "Creando liga..." : "Crear liga"}
        />
      </ScrollView>

      <FeedbackModal
        message={feedback.message}
        onClose={() => {
          const shouldGoBack = feedback.tone === "success";
          setFeedback((current) => ({
            ...current,
            visible: false,
          }));

          if (shouldGoBack) {
            navigation.navigate("Ligas");
          }
        }}
        title={feedback.title}
        tone={feedback.tone}
        visible={feedback.visible}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: 4,
    paddingBottom: spacing.xl,
  },
  backgroundOrbTop: {
    position: "absolute",
    top: -40,
    right: -30,
    width: 190,
    height: 190,
    borderRadius: 999,
    backgroundColor: "rgba(31,171,137,0.12)",
  },
  backgroundOrbBottom: {
    position: "absolute",
    left: -70,
    bottom: 110,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(11,132,87,0.08)",
  },
  heroCard: {
    backgroundColor: "#EAF6F1",
    borderColor: "#CDE5D8",
    borderRadius: 24,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.lg,
  },
  heroTitle: {
    color: colors.primaryDark,
    fontSize: 20,
    fontWeight: "800",
  },
  heroText: {
    color: "#3F6458",
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    marginBottom: spacing.md,
    padding: spacing.md,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    marginBottom: spacing.sm,
  },
  subsectionTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  fieldSpacing: {
    marginBottom: 0,
  },
  contextText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
    marginTop: spacing.sm,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  chip: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    minWidth: "31%",
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
  },
  chipActive: {
    backgroundColor: colors.secondary,
    borderColor: colors.primaryLight,
  },
  chipText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  chipTextActive: {
    color: colors.primaryDark,
  },
  chipDescription: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 4,
  },
  chipDescriptionActive: {
    color: "#476C60",
  },
  sumCard: {
    marginTop: spacing.sm,
  },
  sumSelectorsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  sumField: {
    flex: 1,
  },
  sumPreview: {
    backgroundColor: "#F4FAF7",
    borderColor: "#D2E8DD",
    borderRadius: 18,
    borderWidth: 1,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  sumPreviewLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  sumPreviewValue: {
    color: colors.primaryDark,
    fontSize: 16,
    fontWeight: "800",
    marginTop: 4,
  },
  infoCard: {
    alignItems: "center",
    backgroundColor: "#F7FBF9",
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  infoCardText: {
    color: colors.muted,
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
    marginLeft: spacing.sm,
  },
  scoreGrid: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  scoreField: {
    flex: 1,
  },
  walkoverRow: {
    alignItems: "center",
    backgroundColor: "#FFF8E8",
    borderColor: "#F2D89C",
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  walkoverTextWrap: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  walkoverTitle: {
    color: "#8A5700",
    fontSize: 15,
    fontWeight: "800",
  },
  walkoverText: {
    color: "#8A6A2A",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3,
  },
  walkoverBadge: {
    alignItems: "center",
    backgroundColor: "#F4E1B6",
    borderRadius: 999,
    justifyContent: "center",
    minHeight: 30,
    paddingHorizontal: 10,
  },
  walkoverBadgeActive: {
    backgroundColor: "#B87407",
  },
  walkoverBadgeText: {
    color: "#8A5700",
    fontSize: 12,
    fontWeight: "800",
  },
  walkoverBadgeTextActive: {
    color: colors.surface,
  },
  submitButton: {
    marginTop: spacing.xs,
  },
});
