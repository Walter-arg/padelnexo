import { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import SectionHeader from "../components/SectionHeader";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import {
  markInvitationsAsViewed,
  respondToInvitation,
  subscribeToUserInvitations,
} from "../services/invitationsService";

export default function InvitacionesScreen({ navigation }) {
  const { userData } = useAuth();
  const [invitations, setInvitations] = useState([]);
  const [respondingId, setRespondingId] = useState("");

  useEffect(() => {
    const unsubscribe = subscribeToUserInvitations({
      currentUserId: userData?.uid,
      onData: setInvitations,
      onError: () => setInvitations([]),
    });

    return unsubscribe;
  }, [userData?.uid]);

  useEffect(() => {
    markInvitationsAsViewed(userData?.uid).catch(() => {});
  }, [userData?.uid, invitations.length]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader onBack={() => navigation.goBack()} subtitle="Invitaciones" />
      <View style={styles.container}>
        <Text style={styles.subtitle}>Gestiona tus invitaciones en un solo lugar</Text>

        <FlatList
          contentContainerStyle={styles.listContent}
          data={invitations}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No hay invitaciones</Text>
              <Text style={styles.emptyText}>Cuando recibas una, aparecera en esta pantalla.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const canRespond =
              item.type === "league_pair_invitation" && item.responseStatus === "pending";

            return (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.cardSubtitle}>{item.subtitle}</Text>
                {item.responseStatus && item.responseStatus !== "pending" ? (
                  <Text style={styles.responseStatusText}>
                    {item.responseStatus === "accepted" ? "Aceptada" : "Rechazada"}
                  </Text>
                ) : null}
                {canRespond ? (
                  <View style={styles.actionsRow}>
                    <Pressable
                      disabled={Boolean(respondingId)}
                      onPress={async () => {
                        setRespondingId(item.id);
                        await respondToInvitation(item, false).finally(() => setRespondingId(""));
                      }}
                      style={({ pressed }) => [
                        styles.rejectButton,
                        pressed && !respondingId ? styles.actionPressed : null,
                      ]}
                    >
                      <Text style={styles.rejectButtonText}>Rechazar</Text>
                    </Pressable>
                    <Pressable
                      disabled={Boolean(respondingId)}
                      onPress={async () => {
                        setRespondingId(item.id);
                        await respondToInvitation(item, true).finally(() => setRespondingId(""));
                      }}
                      style={({ pressed }) => [
                        styles.acceptButton,
                        pressed && !respondingId ? styles.actionPressed : null,
                      ]}
                    >
                      <Text style={styles.acceptButtonText}>
                        {respondingId === item.id ? "..." : "Aceptar"}
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          }}
          showsVerticalScrollIndicator={false}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F3FAF6",
  },
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  subtitle: {
    color: colors.primaryDark,
    fontSize: 14,
    fontWeight: "700",
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  listContent: {
    paddingBottom: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: "#BFE6D1",
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
  },
  cardSubtitle: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  responseStatusText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "900",
    marginTop: spacing.sm,
    textTransform: "uppercase",
  },
  actionsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  acceptButton: {
    alignItems: "center",
    backgroundColor: colors.primaryDark,
    borderRadius: 14,
    flex: 1,
    minHeight: 40,
    justifyContent: "center",
  },
  rejectButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    minHeight: 40,
    justifyContent: "center",
  },
  acceptButtonText: {
    color: colors.surface,
    fontSize: 13,
    fontWeight: "900",
  },
  rejectButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  actionPressed: {
    opacity: 0.9,
  },
  emptyCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: "#BFE6D1",
    borderRadius: 20,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.lg,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
    marginTop: spacing.xs,
    textAlign: "center",
  },
});

