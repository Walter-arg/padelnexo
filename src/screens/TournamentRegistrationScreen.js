import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
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
  const initialPanel = route?.params?.initialPanel || "";
  const autoOpenAvailability = Boolean(route?.params?.autoOpenAvailability);
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
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [pendingLeaveAction, setPendingLeaveAction] = useState(null);

  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", (event) => {
      if (!hasUnsavedChanges) {
        return;
      }

      event.preventDefault();
      setPendingLeaveAction(event.data.action);
    });

    return unsubscribe;
  }, [navigation, hasUnsavedChanges]);

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

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.container}
      >
        {loading ? (
          <View style={styles.loaderWrap}>
            <ActivityIndicator color={colors.primaryDark} />
            <Text style={styles.loaderText}>Cargando inscripcion...</Text>
          </View>
        ) : tournament ? (
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <TournamentHeaderCard
              category={tournament?.compositionConfig?.label || tournament?.compositionLabel || ""}
              compactFriendly
              endDateMillis={tournament?.endDateMillis || 0}
              organizerLogoUrl={tournament?.organizerLogoUrl || ""}
              startDateMillis={tournament?.startDateMillis || 0}
              status={tournament?.status || "draft"}
              title={tournament?.name || "Torneo"}
              venue={tournament?.venueLabel || ""}
            />

            <TournamentRegistrationPanel
              currentUser={editorUser}
              autoOpenAvailability={autoOpenAvailability}
              editorRole={editorRole}
              initialPanel={initialPanel}
              onDirtyChange={setHasUnsavedChanges}
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
      </KeyboardAvoidingView>

      <FeedbackModal
        message={feedback.message}
        onClose={() => setFeedback((current) => ({ ...current, visible: false }))}
        tone={feedback.tone}
        title={feedback.title}
        visible={feedback.visible}
      />

      <Modal
        animationType="fade"
        onRequestClose={() => setPendingLeaveAction(null)}
        transparent
        visible={Boolean(pendingLeaveAction)}
      >
        <View style={styles.modalOverlay}>
          <Pressable onPress={() => setPendingLeaveAction(null)} style={styles.modalBackdrop} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Tenes cambios sin guardar</Text>
            <Text style={styles.modalMessage}>
              Si salis ahora vas a perder los cambios de pago que todavia no guardaste.
            </Text>
            <View style={styles.modalActionsRow}>
              <Pressable
                onPress={() => setPendingLeaveAction(null)}
                style={({ pressed }) => [
                  styles.modalSecondaryButton,
                  pressed ? styles.pressedState : null,
                ]}
              >
                <Text style={styles.modalSecondaryButtonText}>Seguir editando</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const action = pendingLeaveAction;
                  setPendingLeaveAction(null);
                  navigation.dispatch(action);
                }}
                style={({ pressed }) => [
                  styles.modalDangerButton,
                  pressed ? styles.pressedState : null,
                ]}
              >
                <Text style={styles.modalPrimaryButtonText}>Salir sin guardar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

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
  modalOverlay: {
    alignItems: "center",
    backgroundColor: colors.overlay,
    flex: 1,
    justifyContent: "center",
    padding: spacing.md,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 24,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
    width: "100%",
  },
  modalTitle: {
    color: colors.text,
    fontSize: 21,
    fontWeight: "800",
    textAlign: "center",
  },
  modalMessage: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  modalActionsRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  modalSecondaryButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
  },
  modalSecondaryButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
  },
  modalDangerButton: {
    alignItems: "center",
    backgroundColor: colors.danger,
    borderRadius: 16,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
  },
  modalPrimaryButtonText: {
    color: colors.surface,
    fontSize: 15,
    fontWeight: "800",
  },
  pressedState: {
    opacity: 0.78,
  },
});
