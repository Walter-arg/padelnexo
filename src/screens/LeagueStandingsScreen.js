import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";

import BottomQuickActionsBar, {
  BOTTOM_QUICK_ACTIONS_SPACE,
} from "../components/BottomQuickActionsBar";
import FeedbackModal from "../components/FeedbackModal";
import LeagueHeaderCard from "../components/LeagueHeaderCard";
import SectionHeader from "../components/SectionHeader";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import { buildLeagueStandings, getLeagueById } from "../services/leaguesService";

const STANDINGS_LEGEND = [
  { key: "Pts", label: "Puntos" },
  { key: "PJ", label: "Partidos jugados" },
  { key: "PG", label: "Partidos ganados" },
  { key: "PP", label: "Partidos perdidos" },
  { key: "SF", label: "Sets a favor" },
  { key: "SC", label: "Sets en contra" },
  { key: "DIF", label: "Diferencia de sets" },
  { key: "DG", label: "Diferencia de games" },
  { key: "R", label: "Reemplazos" },
];

function formatStandingNumber(value = 0) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "0";
  }

  return Number.isInteger(numericValue)
    ? String(numericValue)
    : numericValue.toFixed(1);
}

function buildReplacementLegendText(scoringSettings = {}) {
  const penalty = Number(scoringSettings.replacementPenalty || 0);

  if (!Number.isFinite(penalty) || penalty <= 0) {
    return "";
  }

  return `(-${formatStandingNumber(penalty)} Pts)`;
}

function buildReplacementQuotaLegendText(scoringSettings = {}) {
  const quota = Number.parseInt(String(scoringSettings.replacementQuota || "0"), 10);

  if (!Number.isInteger(quota) || quota <= 0) {
    return "";
  }

  return `Reemplazo sin descuento de pts = ${quota}`;
}

function normalizeText(value = "") {
  return String(value).trim().toLowerCase();
}

function buildCurrentUserStandingRowIds(league = {}, userData = {}) {
  const currentUserId = normalizeText(userData?.uid || userData?.id || "");

  if (!currentUserId) {
    return new Set();
  }

  const leaguePlayers = Array.isArray(league?.players) ? league.players : [];
  const currentPlayer = leaguePlayers.find((player) =>
    [player?.linkedUserId, player?.id]
      .filter(Boolean)
      .some((playerId) => normalizeText(playerId) === currentUserId)
  );

  if (!currentPlayer) {
    return new Set();
  }

  if (league?.teamType === "pair") {
    const pairNumber = Number.parseInt(String(currentPlayer?.pairNumber || "0"), 10) || 0;

    return pairNumber > 0 ? new Set([`pair-number-${pairNumber}`]) : new Set();
  }

  return new Set([currentUserId, currentPlayer.id, currentPlayer.linkedUserId].filter(Boolean));
}

function StandingsTable({ highlightedRowIds = new Set(), rows = [], title }) {
  return (
    <View style={styles.tableCard}>
      <Text style={styles.tableTitle}>{title}</Text>

      <ScrollView horizontal persistentScrollbar showsHorizontalScrollIndicator>
        <View style={styles.tableInner}>
          <View style={styles.headerRow}>
            <Text style={[styles.headerCell, styles.positionCell]}>#</Text>
            <Text style={[styles.headerCell, styles.nameCell]}>Nombre</Text>
            <Text style={[styles.headerCell, styles.pointsHeaderCell]}>Pts</Text>
            <Text style={styles.headerCell}>R</Text>
            <Text style={styles.headerCell}>PJ</Text>
            <Text style={styles.headerCell}>PG</Text>
            <Text style={styles.headerCell}>PP</Text>
            <Text style={styles.headerCell}>SF</Text>
            <Text style={styles.headerCell}>SC</Text>
            <Text style={styles.headerCell}>DIF</Text>
            <Text style={styles.headerCell}>DG</Text>
          </View>

          {rows.length ? (
            rows.map((row, index) => {
              const isHighlighted = highlightedRowIds.has(row.id);

              return (
              <View
                key={row.id}
                style={[styles.dataRow, isHighlighted ? styles.dataRowHighlighted : null]}
              >
                <Text style={[styles.dataCell, styles.positionCell]}>{index + 1}</Text>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.dataCell,
                    styles.nameCell,
                    isHighlighted ? styles.highlightedNameCell : null,
                  ]}
                >
                  {row.name}
                </Text>
                <Text style={[styles.dataCell, styles.pointsCell]}>
                  {formatStandingNumber(row.points)}
                </Text>
                <Text style={styles.dataCell}>{row.replacements || 0}</Text>
                <Text style={styles.dataCell}>{row.played}</Text>
                <Text style={styles.dataCell}>{row.won}</Text>
                <Text style={styles.dataCell}>{row.lost}</Text>
                <Text style={styles.dataCell}>{row.setsFor || 0}</Text>
                <Text style={styles.dataCell}>{row.setsAgainst || 0}</Text>
                <Text style={styles.dataCell}>{row.setDiff || 0}</Text>
                <Text style={styles.dataCell}>{row.gameDiff || 0}</Text>
              </View>
              );
            })
          ) : (
            <Text style={styles.emptyTableText}>Todavia no hay resultados cargados.</Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function StandingsLegend({ scoringSettings = {} }) {
  const replacementLegend = buildReplacementLegendText(scoringSettings);
  const replacementQuotaLegend = buildReplacementQuotaLegendText(scoringSettings);

  return (
    <View style={styles.legendWrap}>
      <Text style={styles.legendTitle}>Referencias</Text>
      <View style={styles.legendGrid}>
        {STANDINGS_LEGEND.map((item) => (
          <Text key={item.key} style={styles.legendText}>
            <Text style={styles.legendKey}>{item.key}</Text>: {item.label}
            {item.key === "R" && replacementLegend ? ` ${replacementLegend}` : ""}
          </Text>
        ))}
        {replacementQuotaLegend ? (
          <Text style={[styles.legendText, styles.legendNoteText]}>
            {replacementQuotaLegend}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export default function LeagueStandingsScreen({ navigation, route }) {
  const { userData } = useAuth();
  const leagueId = route?.params?.leagueId || "";
  const fallbackLeagueName = route?.params?.leagueName || "Liga";
  const [league, setLeague] = useState(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState({
    visible: false,
    title: "",
    message: "",
    tone: "default",
  });

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      const loadLeague = async () => {
        try {
          setLoading(true);
          const nextLeague = await getLeagueById(leagueId);

          if (!isMounted) {
            return;
          }

          setLeague(nextLeague);
        } catch (error) {
          if (isMounted) {
            setFeedback({
              visible: true,
              title: "No pudimos cargar los puntajes",
              message: error?.message || "Intenta nuevamente en unos instantes.",
              tone: "danger",
            });
          }
        } finally {
          if (isMounted) {
            setLoading(false);
          }
        }
      };

      loadLeague();

      return () => {
        isMounted = false;
      };
    }, [leagueId])
  );

  const leagueName = league?.nombre || fallbackLeagueName;
  const standings = useMemo(() => buildLeagueStandings(league || {}), [league]);
  const highlightedRowIds = useMemo(
    () => buildCurrentUserStandingRowIds(league || {}, userData || {}),
    [league, userData]
  );
  const hasFixture = Array.isArray(league?.fixture?.rounds) && league.fixture.rounds.length > 0;

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <SectionHeader onBack={() => navigation.goBack()} subtitle="Puntajes" />
        <View style={styles.loaderWrap}>
          <ActivityIndicator color={colors.primaryDark} />
          <Text style={styles.loaderText}>Cargando tabla...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader onBack={() => navigation.goBack()} subtitle="Puntajes" />
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <LeagueHeaderCard
          league={league}
          organizerLogoUrl={league?.organizerLogoUrl || userData?.organizerLogoUrl || ""}
          subtitle="TABLA DE PUNTUACION"
          title={leagueName}
        />

        {!hasFixture ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Todavia no hay fixture cargado</Text>
            <Text style={styles.emptyText}>
              Genera fechas desde la seccion Fixture para empezar a sumar resultados y posiciones.
            </Text>
          </View>
        ) : null}

        {standings.tables.map((table) => (
          <StandingsTable
            highlightedRowIds={highlightedRowIds}
            key={table.key}
            rows={table.rows}
            title={table.title}
          />
        ))}

        <StandingsLegend scoringSettings={league?.scoringSettings} />
      </ScrollView>

      <BottomQuickActionsBar navigation={navigation} />

      <FeedbackModal
        message={feedback.message}
        onClose={() =>
          setFeedback({
            visible: false,
            title: "",
            message: "",
            tone: "default",
          })
        }
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
  backgroundOrbTop: {
    position: "absolute",
    top: -40,
    right: -30,
    width: 210,
    height: 210,
    borderRadius: 999,
    backgroundColor: "rgba(31,171,137,0.12)",
  },
  backgroundOrbBottom: {
    position: "absolute",
    left: -70,
    bottom: 110,
    width: 240,
    height: 240,
    borderRadius: 999,
    backgroundColor: "rgba(31,171,137,0.09)",
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: BOTTOM_QUICK_ACTIONS_SPACE + spacing.xl,
    gap: spacing.md,
  },
  loaderWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  loaderText: {
    color: colors.textMuted,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.text,
  },
  emptyText: {
    color: colors.textMuted,
    lineHeight: 20,
  },
  tableCard: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  tableTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: colors.text,
  },
  tableInner: {
    minWidth: 654,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerCell: {
    width: 34,
    textAlign: "center",
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
  },
  positionCell: {
    width: 28,
  },
  nameCell: {
    width: 160,
    textAlign: "left",
    paddingHorizontal: spacing.xs,
  },
  dataRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 42,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(18,38,32,0.06)",
  },
  dataRowHighlighted: {
    backgroundColor: "rgba(47,143,207,0.10)",
    borderRadius: 10,
  },
  dataCell: {
    width: 34,
    textAlign: "center",
    color: colors.text,
    fontSize: 13,
  },
  pointsHeaderCell: {
    fontWeight: "900",
    color: colors.primaryDark,
  },
  pointsCell: {
    fontWeight: "900",
    color: colors.primaryDark,
  },
  highlightedNameCell: {
    color: "#2F8FCF",
    fontWeight: "900",
  },
  emptyTableText: {
    color: colors.textMuted,
    lineHeight: 20,
    paddingTop: spacing.xs,
  },
  legendWrap: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    padding: spacing.md,
  },
  legendTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
    marginBottom: spacing.xs,
  },
  legendGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  legendText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    width: "48%",
  },
  legendNoteText: {
    color: colors.primaryDark,
    fontWeight: "800",
    width: "48%",
  },
  legendKey: {
    color: colors.primaryDark,
    fontWeight: "900",
  },
});

