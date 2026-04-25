import { Alert, Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

import AppButton from "../components/AppButton";
import PublicAvailabilityPreview from "../components/PublicAvailabilityPreview";
import SectionHeader from "../components/SectionHeader";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import { playersMock } from "../data/playersMock";
import { createInvitation } from "../services/invitationsService";
import { hasProfileImage } from "../utils/defaultProfileImage";

function formatPhoneNumber(countryCode = "+54", phone = "") {
  const cleanPhone = String(phone || "").trim();

  if (!cleanPhone) {
    return "";
  }

  return `${countryCode} ${cleanPhone}`.trim();
}

export default function PlayerDetailScreen({ navigation, route }) {
  const { userData } = useAuth();
  const playerId = route?.params?.playerId;
  const playerFromParams = route?.params?.player;
  const player =
    playerFromParams ||
    playersMock.find((item) => item.id === playerId);
  const hasImage = hasProfileImage(player?.foto);
  const publicPhone = player?.isPhonePublic
    ? formatPhoneNumber(player?.countryCode, player?.phone)
    : "";

  const handleInvite = async () => {
    if (!userData?.uid || !player?.id || userData.uid === player.id) {
      return;
    }

    try {
      await createInvitation({
        senderId: userData.uid,
        senderName: userData.name,
        recipientId: player.id,
        recipientName: player.nombre,
      });
      Alert.alert("Invitacion enviada", `Le enviamos una invitacion a ${player.nombre}.`);
    } catch (error) {
      Alert.alert(
        "No pudimos enviar la invitacion",
        "Intenta nuevamente en unos instantes."
      );
    }
  };

  if (!player) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <View style={styles.fallbackCard}>
            <Text style={styles.fallbackTitle}>Jugador no encontrado</Text>
            <Text style={styles.fallbackText}>
              No pudimos cargar el perfil seleccionado. Volve a la lista e intenta nuevamente.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader onBack={() => navigation.goBack()} subtitle="Perfil jugador" />
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />

      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          {hasImage ? (
            <Image source={{ uri: player.foto }} style={styles.heroImage} />
          ) : (
            <View style={styles.heroImagePlaceholder}>
              <Ionicons color="#9CA3AF" name="person" size={58} />
            </View>
          )}
          <Text style={styles.name}>{player.nombre}</Text>
          <Text style={styles.category}>{player.categoria}</Text>
          <Text style={styles.city}>
            {player.ciudad}, {player.provincia}
          </Text>
        </View>

        <View style={styles.detailCard}>
          <Text style={styles.sectionTitle}>Disponibilidad</Text>
          <PublicAvailabilityPreview availability={player.availability} />
        </View>

        <View style={styles.row}>
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Sexo</Text>
            <Text style={styles.infoValue}>{player.sexo}</Text>
          </View>
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Mano habil</Text>
            <Text style={styles.infoValue}>{player.manoHabil}</Text>
          </View>
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Lado preferido</Text>
            <Text style={styles.infoValue}>{player.ladoPreferido}</Text>
          </View>
        </View>

        <View style={styles.detailCard}>
          <Text style={styles.sectionTitle}>Descripcion</Text>
          <Text style={styles.sectionText}>{player.descripcion}</Text>
        </View>

        {publicPhone ? (
          <View style={styles.detailCard}>
            <Text style={styles.sectionTitle}>Celular</Text>
            <Text style={styles.sectionText}>{publicPhone}</Text>
          </View>
        ) : null}

        <AppButton onPress={handleInvite} style={styles.inviteButton} title="Invitar" />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  backgroundOrbTop: {
    position: "absolute",
    top: -50,
    right: -25,
    width: 180,
    height: 180,
    borderRadius: 999,
    backgroundColor: "rgba(31,171,137,0.12)",
  },
  backgroundOrbBottom: {
    position: "absolute",
    left: -60,
    bottom: 120,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(11,132,87,0.08)",
  },
  heroCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 26,
    borderWidth: 1,
    padding: spacing.lg,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 3,
  },
  heroImage: {
    borderRadius: 56,
    height: 112,
    width: 112,
  },
  heroImagePlaceholder: {
    alignItems: "center",
    backgroundColor: "#E5E7EB",
    borderRadius: 56,
    height: 112,
    justifyContent: "center",
    width: 112,
  },
  name: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "800",
    marginTop: spacing.sm,
    textAlign: "center",
  },
  category: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "700",
    marginTop: 4,
  },
  city: {
    color: colors.muted,
    fontSize: 14,
    marginTop: 4,
  },
  detailCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  sectionTitle: {
    color: colors.primaryDark,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.8,
    marginBottom: spacing.xs,
    textTransform: "uppercase",
  },
  sectionText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  row: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  infoCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    flex: 1,
    padding: spacing.md,
  },
  infoLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    marginBottom: spacing.xs,
    textTransform: "uppercase",
  },
  infoValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  inviteButton: {
    marginBottom: 0,
    marginTop: spacing.md,
  },
  fallbackCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: spacing.xl,
    padding: spacing.lg,
  },
  fallbackTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center",
  },
  fallbackText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.sm,
    textAlign: "center",
  },
});

