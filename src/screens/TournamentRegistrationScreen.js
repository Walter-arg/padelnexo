import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";

import BottomQuickActionsBar, {
  BOTTOM_QUICK_ACTIONS_SPACE,
} from "../components/BottomQuickActionsBar";
import FeedbackModal from "../components/FeedbackModal";
import SectionHeader from "../components/SectionHeader";
import TournamentHeaderCard from "../components/TournamentHeaderCard";
import TournamentRegistrationPanel from "../components/TournamentRegistrationPanel";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import { buildTournamentDayOptions } from "../services/tournamentAvailabilityService";
import {
  getTournamentById,
  listTournamentRegistrations,
} from "../services/tournamentsService";

function normalizeText(value = "") {
  return String(value || "").trim().toLowerCase();
}

function getUserTournamentRegistration(currentUserId, registrations = []) {
  return (
    registrations.find(
      (entry) =>
        normalizeText(entry.player1Id) === normalizeText(currentUserId) ||
        normalizeText(entry.player2Id) === normalizeText(currentUserId)
    ) || null
  );
}

export default function TournamentRegistrationScreen({ navigation, route }) {
  const { user, userData } = useAuth();
  const tournamentId = route?.params?.tournamentId || "";
  const requestedRegistrationId = route?.params?.registrationId || "";
  const editorRole = route?.params?.editorRole || "player";
  const [tournament, setTournament] = useState(null);
  const [registrations, setRegistrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState({
    visible: false,
    title: "",
    message: "",
    tone: "default",
  });

  const currentUser = useMemo(
    () => ({
      ...(userData || {}),
      uid: userData?.uid || user?.uid || "",
      name: userData?.name || user?.displayName || "Jugador",
    }),
    [user?.displayName, user?.uid, userData]
  );
  const selectedRegistration = useMemo(() => {
    if (requestedRegistrationId) {
      return registrations.find((entry) => entry.id === requestedRegistrationId) || null;
    }

    if (editorRole === "organizer_create") {
      return null;
    }

    return getUserTournamentRegistration(currentUser.uid, registrations);
  }, [currentUser.uid, editorRole, registrations, requestedRegistrationId]);
  const editorUser = useMemo(() => {
    if (editorRole !== "organizer" || !selectedRegistration) {
      return currentUser;
    }

    return {
      uid: selectedRegistration.player1Id || "",
      name: selectedRegistration.player1Name || "Jugador",
      category: "",
      sex: "Masculino",
    };
  }, [currentUser, editorRole, selectedRegistration]);

  const loadRegistrationScreen = useCallback(async () => {
    const [tournamentResponse, registrationsResponse] = await Promise.all([
      getTournamentById(tournamentId),
      listTournamentRegistrations(tournamentId),
    ]);

    setTournament(tournamentResponse);
    setRegistrations(registrationsResponse);
  }, [tournamentId]);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      const sync = async () => {
        try {
          setLoading(true);
          await loadRegistrationScreen();
        } catch (error) {
          if (!isMounted) {
            return;
          }

          setFeedback({
            visible: true,
            title: "No pudimos cargar la inscripcion",
            message: error?.message || "Intenta nuevamente en unos instantes.",
            tone: "danger",
          });
        } finally {
          if (isMounted) {
            setLoading(false);
          }
        }
      };

      sync();

      return () => {
        isMounted = false;
      };
    }, [loadRegistrationScreen])
  );

  const tournamentDayOptions = useMemo(() => buildTournamentDayOptions(tournament), [tournament]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader
        onBack={() => navigation.goBack()}
        subtitle={
          editorRole === "organizer"
            ? "Editar inscripcion"
            : editorRole === "organizer_create"
            ? "Nueva pareja"
            : "Inscripcion torneo"
        }
      />

      <View style={styles.container}>
        {loading ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator color={colors.primaryDark} />
            <Text style={styles.loaderText}>Cargando inscripcion...</Text>
          </View>
        ) : tournament ? (
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <TournamentHeaderCard
              category={tournament?.compositionConfig?.label || tournament?.compositionLabel || ""}
              compactFriendly
              endDateMillis={tournament?.endDateMillis || 0}
              startDateMillis={tournament?.startDateMillis || 0}
              title={tournament?.name || "Torneo"}
            />

            <TournamentRegistrationPanel
              currentUser={editorUser}
              editorRole={editorRole}
              onRegistrationCreated={async () => {
                await loadRegistrationScreen();

                if (editorRole === "organizer_create") {
                  navigation.goBack();
                }
              }}
              registration={selectedRegistration}
              registrations={registrations}
              showFeedback={(title, message, tone = "default") =>
                setFeedback({
                  visible: true,
                  title,
                  message,
                  tone,
                })
              }
              tournament={tournament}
              tournamentDayOptions={tournamentDayOptions}
            />
          </ScrollView>
        ) : (
          <View style={styles.loaderWrap}>
            <Text style={styles.loaderText}>No encontramos el torneo.</Text>
          </View>
        )}
      </View>

      <FeedbackModal
        message={feedback.message}
        onClose={() => setFeedback((current) => ({ ...current, visible: false }))}
        tone={feedback.tone}
        title={feedback.title}
        visible={feedback.visible}
      />

      <BottomQuickActionsBar />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.lg + BOTTOM_QUICK_ACTIONS_SPACE,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  loaderWrap: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  loaderText: {
    color: colors.muted,
    fontSize: 15,
    fontWeight: "700",
    marginTop: spacing.sm,
    textAlign: "center",
  },
});
