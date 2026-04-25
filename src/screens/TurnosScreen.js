import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";

import BottomQuickActionsBar, {
  BOTTOM_QUICK_ACTIONS_SPACE,
} from "../components/BottomQuickActionsBar";
import SectionFilterBar from "../components/SectionFilterBar";
import SectionHeader from "../components/SectionHeader";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";

export default function TurnosScreen({ navigation }) {
  const { userData } = useAuth();
  const [activeLocations, setActiveLocations] = useState([]);

  const userLocalidad = useMemo(() => {
    const name = userData?.localidad?.nombre || userData?.city || "";

    if (!name) {
      return null;
    }

    return {
      nombre: name,
      provincia:
        userData?.localidad?.provincia || userData?.province || userData?.location?.provincia || "",
      pais: userData?.localidad?.pais || userData?.location?.pais || "Argentina",
    };
  }, [userData]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <SectionHeader onBack={() => navigation.goBack()} subtitle="Turnos">
        <SectionFilterBar
          onChange={({ locations }) => setActiveLocations(locations)}
          renderExtraContent={() => (
            <View>
              <Text style={styles.modalLabel}>Complejo</Text>
              <View style={styles.placeholderField}>
                <Ionicons color={colors.muted} name="business-outline" size={16} />
                <Text style={styles.placeholderFieldText}>
                  El selector de complejo queda preparado para futuros filtros de reservas
                </Text>
              </View>
            </View>
          )}
          userLocation={userLocalidad}
        />
      </SectionHeader>

      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.title}>Turnos</Text>
          <Text style={styles.subtitle}>
            Aqui vas a poder reservar canchas, ver horarios y gestionar disponibilidad.
          </Text>
          <View style={styles.locationsBox}>
            <Text style={styles.locationsLabel}>Localidades activas</Text>
            <Text style={styles.locationsText}>
              {activeLocations.length > 0
                ? activeLocations.map((location) => location.nombre).join(" · ")
                : "Tu ciudad base aparecera aqui automaticamente."}
            </Text>
          </View>
        </View>
      </View>

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
    paddingHorizontal: spacing.lg,
    paddingTop: 2,
    paddingBottom: spacing.lg + BOTTOM_QUICK_ACTIONS_SPACE,
  },
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
  locationsBox: {
    backgroundColor: "#F4FAF7",
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  locationsLabel: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  locationsText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
    marginTop: 6,
  },
  modalLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    marginBottom: spacing.xs,
    marginTop: spacing.xs,
    textTransform: "uppercase",
  },
  placeholderField: {
    alignItems: "center",
    backgroundColor: "#F7FBF9",
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  placeholderFieldText: {
    color: colors.muted,
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    marginLeft: spacing.sm,
  },
});

