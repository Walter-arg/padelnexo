import { useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import SectionHeader from "../components/SectionHeader";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import {
  markInvitationsAsViewed,
  subscribeToUserInvitations,
} from "../services/invitationsService";

export default function InvitacionesScreen({ navigation }) {
  const { userData } = useAuth();
  const [invitations, setInvitations] = useState([]);

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
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardSubtitle}>{item.subtitle}</Text>
            </View>
          )}
          showsVerticalScrollIndicator={false}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#EAF3FF",
  },
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  subtitle: {
    color: "#2F5688",
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
    borderColor: "#C2D8F2",
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
  emptyCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: "#C2D8F2",
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

