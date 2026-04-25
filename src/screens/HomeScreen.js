import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import AvatarBadge from "../components/AvatarBadge";
import BottomQuickActionsBar, {
  BOTTOM_QUICK_ACTIONS_SPACE,
} from "../components/BottomQuickActionsBar";
import CircularMenu from "../components/CircularMenu";
import LoginModal from "../components/LoginModal";
import ProfileModal from "../components/ProfileModal";
import { heroPhrases } from "../data/profileOptions";
import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import { listPlayers } from "../services/playersService";

const MENU_ITEMS = [
  {
    key: "Ligas",
    label: "LIGAS",
    subtitle: "Ligas activas en tu ciudad",
  },
  {
    key: "Torneos",
    label: "TORNEOS",
    subtitle: "Cuadros y eventos para sumarte",
  },
  {
    key: "Turnos",
    label: "TURNOS",
    subtitle: "Reservas rapidas para tu proximo partido",
  },
  {
    key: "Jugadores",
    label: "JUGADORES",
    subtitle: "Conecta con la comunidad PadelNexo",
  },
];

const DEFAULT_USER = {
  name: "Jugador",
  email: "",
  phone: "",
  countryCode: "+54",
  city: "Buenos Aires",
  category: "Iniciante",
  sex: "Masculino",
  description: "",
  avatarColor: colors.primary,
  avatarUrl: "",
  role: "user",
  organizerStatus: "none",
  availability: {},
  availabilityDays: [],
  complejos: [],
};

export default function HomeScreen({ navigation }) {
  const { user, userData } = useAuth();
  const [isLoginVisible, setIsLoginVisible] = useState(false);
  const [isProfileVisible, setIsProfileVisible] = useState(false);
  const [selectedMenuItem, setSelectedMenuItem] = useState(MENU_ITEMS[0]);
  const [phraseIndex, setPhraseIndex] = useState(0);
  const phraseOpacity = useRef(new Animated.Value(1)).current;
  const phraseTranslate = useRef(new Animated.Value(0)).current;
  const currentUser = userData ? { ...DEFAULT_USER, ...userData } : null;
  const [playersPreview, setPlayersPreview] = useState([]);

  useEffect(() => {
    const interval = setInterval(() => {
      Animated.parallel([
        Animated.timing(phraseOpacity, {
          toValue: 0,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.timing(phraseTranslate, {
          toValue: -10,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setPhraseIndex((current) => (current + 1) % heroPhrases.length);
        phraseTranslate.setValue(10);
        Animated.parallel([
          Animated.timing(phraseOpacity, {
            toValue: 1,
            duration: 220,
            useNativeDriver: true,
          }),
          Animated.timing(phraseTranslate, {
            toValue: 0,
            duration: 220,
            useNativeDriver: true,
          }),
        ]).start();
      });
    }, 2800);

    return () => clearInterval(interval);
  }, [phraseOpacity, phraseTranslate]);

  useEffect(() => {
    let isCancelled = false;

    const loadPlayersPreview = async () => {
      if (!userData?.uid) {
        setPlayersPreview([]);
        return;
      }

      try {
        const players = await listPlayers();

        if (isCancelled) {
          return;
        }

        setPlayersPreview(players);
      } catch (error) {
        if (!isCancelled) {
          setPlayersPreview([]);
        }
      }
    };

    loadPlayersPreview();

    return () => {
      isCancelled = true;
    };
  }, [userData?.uid]);

  const handleItemPress = (item) => {
    if (!currentUser) {
      setSelectedMenuItem(item);
      setIsLoginVisible(true);
      return;
    }

    navigation.navigate(item.key);
  };

  const handleLogin = (user) => {
    setIsLoginVisible(false);
  };

  const handleLogout = () => {
    setIsProfileVisible(false);
  };

  const handleProfileSave = (profile) => {
    setIsProfileVisible(false);
  };

  const buildCategorySummary = () => {
    const city = currentUser?.city || "tu ciudad";
    const category = currentUser?.category || "tu categoria";
    const hour = new Date().getHours();

    if (selectedMenuItem.key === "Ligas") {
      return {
        title: "Tu panorama de ligas",
        subtitle: "Resumen rapido para decidir donde jugar esta semana.",
        rows: [
          `Participas en 2 ligas de ${city}`,
          `Hay 4 ligas nuevas abiertas en ${city}`,
        ],
      };
    }

    if (selectedMenuItem.key === "Jugadores") {
      return {
        title: "DISPONIBLES HOY PARA JUGAR",
        subtitle: "",
        rows: [
          `3 jugadores de ${category} disponibles hoy`,
          "2 contactos con nivel similar y buena reputacion",
        ],
      };
    }

    if (selectedMenuItem.key === "Turnos") {
      const firstSlot = `${String(hour + 1).padStart(2, "0")}:00`;
      const secondSlot = `${String(hour + 2).padStart(2, "0")}:30`;

      return {
        title: "Turnos cercanos para hoy",
        subtitle: "Horarios proximos pensados para reservar en segundos.",
        rows: [
          `Cancha cubierta a las ${firstSlot} en ${city}`,
          `Cancha rapida a las ${secondSlot} cerca tuyo`,
        ],
      };
    }

    return {
      title: "Torneos en movimiento",
      subtitle: "Eventos activos y proximos para que no te quedes afuera.",
      rows: [
        "2 torneos activos con cupos limitados",
        "1 torneo arranca este fin de semana",
      ],
    };
  };

  const categorySummary = buildCategorySummary();
  const playerPreviewRows = useMemo(
    () =>
      playersPreview
        .filter((player) => player.id !== userData?.uid)
        .slice(0, 4),
    [playersPreview, userData?.uid]
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar backgroundColor={colors.background} barStyle="dark-content" />
      <View style={styles.backgroundOrbTop} />
      <View style={styles.backgroundOrbBottom} />

      <ScrollView
        bounces={false}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <View style={styles.brandBlock}>
            <Text numberOfLines={1} style={styles.appName}>
              PadelNexo
            </Text>
            <Text style={styles.appCaption}>Conectando el mundo del padel</Text>
          </View>

          {user && currentUser ? (
            <Pressable
              onPress={() => setIsProfileVisible(true)}
              style={({ pressed }) => [
                styles.userBadge,
                pressed && styles.userBadgePressed,
              ]}
            >
              <AvatarBadge
                color={currentUser.avatarColor}
                name={currentUser.name}
                size={34}
                textSize={12}
                uri={currentUser.avatarUrl}
              />
              <View style={styles.userNameBlock}>
                <Text numberOfLines={2} style={styles.userName}>
                  {currentUser.name}
                </Text>
              </View>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => setIsLoginVisible(true)}
              style={({ pressed }) => [
                styles.authButton,
                pressed && styles.authButtonPressed,
              ]}
            >
              <Text style={styles.authButtonText}>Ingresar / Registrarse</Text>
            </Pressable>
          )}
        </View>

        {user && currentUser ? (
          <Pressable
            onPress={() => navigation.navigate("Finanzas")}
            style={({ pressed }) => [
              styles.financeButton,
              pressed ? styles.financeButtonPressed : null,
            ]}
          >
            <View style={styles.financeIconWrap}>
              <Text style={styles.financeIconText}>$</Text>
            </View>
            <View style={styles.financeCopy}>
              <Text style={styles.financeTitle}>FINANZAS</Text>
              <Text style={styles.financeText}>Pagos, valores y caja del organizador</Text>
            </View>
          </Pressable>
        ) : null}

        <Pressable
          disabled={selectedMenuItem.key !== "Jugadores"}
          onPress={() => {
            if (selectedMenuItem.key === "Jugadores") {
              handleItemPress({ key: "Jugadores" });
            }
          }}
          style={({ pressed }) => [
            styles.heroCard,
            selectedMenuItem.key === "Jugadores" && pressed ? styles.heroCardPressed : null,
          ]}
        >
          {!user || !currentUser ? (
            <>
              <Text style={styles.heroEyebrow}>HOME</Text>
              <Text style={styles.heroTitle}>Haciendo más fácil tu juego</Text>
              <View style={styles.phraseFrame}>
                <Animated.View
                  style={[
                    styles.phrasePill,
                    {
                      opacity: phraseOpacity,
                      transform: [{ translateY: phraseTranslate }],
                    },
                  ]}
                >
                  <Text style={styles.heroPhrase}>{heroPhrases[phraseIndex]}</Text>
                </Animated.View>
              </View>
              <View style={styles.paginationRow}>
                {heroPhrases.map((phrase, index) => (
                  <Pressable
                    key={phrase}
                    onPress={() => setPhraseIndex(index)}
                    style={[
                      styles.paginationDot,
                      index === phraseIndex && styles.paginationDotActive,
                    ]}
                  />
                ))}
              </View>
            </>
          ) : (
            <>
              <Text style={styles.heroEyebrow}>
                {selectedMenuItem.key === "Jugadores" ? "VISTA PREVIA" : selectedMenuItem.label}
              </Text>
              {selectedMenuItem.key === "Jugadores" ? (
                <View style={styles.playersAvailableTitleRow}>
                  <View style={styles.playersAvailableDot} />
                  <Text style={styles.playersAvailableTitle}>{categorySummary.title}</Text>
                </View>
              ) : (
                <Text style={styles.heroTitle}>{categorySummary.title}</Text>
              )}
              {categorySummary.subtitle ? (
                <Text style={styles.heroDescription}>{categorySummary.subtitle}</Text>
              ) : null}
              {selectedMenuItem.key === "Jugadores" ? (
                <View style={styles.playerPreviewList}>
                  {playerPreviewRows.map((player) => (
                    <View key={player.id} style={styles.playerPreviewRow}>
                      <AvatarBadge
                        color={colors.primary}
                        name={player.nombre}
                        size={26}
                        textSize={9}
                        uri={player.foto}
                      />
                      <Text numberOfLines={1} style={styles.playerPreviewName}>
                        {player.nombre}
                      </Text>
                      <Text numberOfLines={1} style={styles.playerPreviewCategory}>
                        {player.categoria}
                      </Text>
                    </View>
                  ))}
                  {playerPreviewRows.length === 0 ? (
                    <View style={styles.previewRow}>
                      <View style={styles.previewDot} />
                      <Text style={styles.previewText}>
                        Todavia no hay jugadores para mostrar en este resumen.
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : (
                <View style={styles.previewList}>
                  {categorySummary.rows.map((row) => (
                    <View key={row} style={styles.previewRow}>
                      <View style={styles.previewDot} />
                      <Text style={styles.previewText}>{row}</Text>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </Pressable>

        <View style={styles.carouselSection}>
          <Text style={styles.sectionSubtitle}>
            Presiona la pelota para ver más
          </Text>

          <CircularMenu
            items={MENU_ITEMS}
            onItemPress={handleItemPress}
            onSelectionChange={(item) => setSelectedMenuItem(item)}
          />
        </View>

        <View style={styles.infoRow}>
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Perfil</Text>
            <Text style={styles.infoText}>
              Completa tu categoria, ciudad y descripcion para conectar mejor.
            </Text>
          </View>
          <View style={styles.infoCard}>
            <Text style={styles.infoLabel}>Social</Text>
            <Text style={styles.infoText}>
              Descubre jugadores, complejos y torneos desde una sola home.
            </Text>
          </View>
        </View>
      </ScrollView>

      <LoginModal
        onClose={() => setIsLoginVisible(false)}
        onLogin={handleLogin}
        visible={isLoginVisible}
      />
      <ProfileModal
        navigation={navigation}
        onClose={() => setIsProfileVisible(false)}
        onLogout={handleLogout}
        onSave={handleProfileSave}
        user={currentUser}
        visible={isProfileVisible}
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
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl + BOTTOM_QUICK_ACTIONS_SPACE,
  },
  backgroundOrbTop: {
    position: "absolute",
    top: -50,
    right: -20,
    width: 190,
    height: 190,
    borderRadius: 999,
    backgroundColor: "rgba(31,171,137,0.15)",
  },
  backgroundOrbBottom: {
    position: "absolute",
    left: -60,
    bottom: 140,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: "rgba(11,132,87,0.08)",
  },
  headerRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
    paddingTop: spacing.sm,
  },
  brandBlock: {
    flex: 1,
    paddingRight: spacing.md,
  },
  appName: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  appCaption: {
    color: colors.muted,
    fontSize: 14,
    marginTop: 2,
  },
  authButton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  authButtonPressed: {
    opacity: 0.88,
  },
  authButtonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: "700",
  },
  userBadge: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    maxWidth: 176,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  userNameBlock: {
    justifyContent: "center",
    maxWidth: 104,
    minWidth: 88,
  },
  userBadgePressed: {
    opacity: 0.9,
  },
  userName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 16,
    textAlign: "left",
  },
  financeButton: {
    alignItems: "center",
    backgroundColor: colors.primaryDark,
    borderRadius: 18,
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.lg,
    minHeight: 62,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 18,
    elevation: 5,
  },
  financeButtonPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  financeIconWrap: {
    alignItems: "center",
    backgroundColor: "#F5C84B",
    borderRadius: 8,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  financeIconText: {
    color: colors.primaryDark,
    fontSize: 24,
    fontWeight: "900",
  },
  financeCopy: {
    flex: 1,
  },
  financeTitle: {
    color: colors.surface,
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0,
  },
  financeText: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: 28,
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 5,
  },
  heroCardPressed: {
    opacity: 0.92,
  },
  heroEyebrow: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.2,
    marginBottom: 4,
    textAlign: "center",
  },
  heroTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    lineHeight: 27,
    textAlign: "center",
  },
  playersAvailableTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 2,
  },
  playersAvailableDot: {
    backgroundColor: "#20C76F",
    borderRadius: 999,
    height: 10,
    marginRight: 8,
    shadowColor: "#20C76F",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    width: 10,
  },
  playersAvailableTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
    textAlign: "center",
  },
  heroDescription: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 19,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  phraseFrame: {
    alignItems: "center",
    height: 76,
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  phrasePill: {
    alignItems: "center",
    backgroundColor: colors.secondary,
    borderRadius: 22,
    height: 62,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    width: "100%",
  },
  heroPhrase: {
    color: colors.primaryDark,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 21,
    textAlign: "center",
  },
  paginationRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  paginationDot: {
    backgroundColor: colors.border,
    borderRadius: 999,
    height: 8,
    marginHorizontal: 4,
    width: 8,
  },
  paginationDotActive: {
    backgroundColor: colors.primary,
    width: 18,
  },
  previewList: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  playerPreviewList: {
    gap: 6,
    marginTop: spacing.sm,
  },
  playerPreviewRow: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 26,
  },
  playerPreviewName: {
    color: colors.text,
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
    marginLeft: 6,
    marginRight: spacing.xs,
  },
  playerPreviewCategory: {
    color: colors.primaryDark,
    fontSize: 11,
    fontWeight: "700",
    maxWidth: 96,
    textAlign: "right",
  },
  previewRow: {
    alignItems: "center",
    flexDirection: "row",
  },
  previewDot: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    height: 8,
    marginRight: spacing.sm,
    width: 8,
  },
  previewText: {
    color: colors.text,
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 18,
  },
  carouselSection: {
    marginBottom: spacing.xl + 8,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 26,
    fontWeight: "800",
    marginBottom: spacing.xs,
    textAlign: "center",
  },
  sectionSubtitle: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: spacing.md,
    textAlign: "center",
  },
  infoRow: {
    gap: spacing.md,
  },
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    padding: spacing.lg,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 4,
  },
  infoLabel: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.8,
    marginBottom: spacing.xs,
    textTransform: "uppercase",
  },
  infoText: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
});

