import { useEffect, useRef, useState } from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { AppState, Animated, Easing, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, spacing } from "../config/theme";
import { useAuth } from "../context/AuthContext";
import AdminScreen from "../screens/AdminScreen";
import CreateLeagueScreen from "../screens/CreateLeagueScreen";
import CreateTournamentScreen from "../screens/CreateTournamentScreen";
import FavoritosScreen from "../screens/FavoritosScreen";
import FinanzasScreen from "../screens/FinanzasScreen";
import HomeScreen from "../screens/HomeScreen";
import InvitacionesScreen from "../screens/InvitacionesScreen";
import LeagueDetailScreen from "../screens/LeagueDetailScreen";
import LeagueFixtureScreen from "../screens/LeagueFixtureScreen";
import LeaguePaymentsScreen from "../screens/LeaguePaymentsScreen";
import JugadoresScreen from "../screens/JugadoresScreen";
import LeaguePlayersScreen from "../screens/LeaguePlayersScreen";
import LeagueStandingsScreen from "../screens/LeagueStandingsScreen";
import LigasHubScreen from "../screens/LigasHubScreen";
import LoginScreen from "../screens/LoginScreen";
import MensajesScreen from "../screens/MensajesScreen";
import MercadoPagoReturnScreen from "../screens/MercadoPagoReturnScreen";
import MyLeaguesScreen from "../screens/MyLeaguesScreen";
import OrganizerRegistrationsScreen from "../screens/OrganizerRegistrationsScreen";
import OrganizerReplacementsScreen from "../screens/OrganizerReplacementsScreen";
import PlayerDetailScreen from "../screens/PlayerDetailScreen";
import PlayerLeaguesScreen from "../screens/PlayerLeaguesScreen";
import RegisterScreen from "../screens/RegisterScreen";
import TournamentDetailScreen from "../screens/TournamentDetailScreen";
import TournamentBracketFullscreenScreen from "../screens/TournamentBracketFullscreenScreen";
import TournamentFixtureScreen from "../screens/TournamentFixtureScreen";
import TournamentPaymentsScreen from "../screens/TournamentPaymentsScreen";
import TournamentPosterViewerScreen from "../screens/TournamentPosterViewerScreen";
import TournamentRegistrationScreen from "../screens/TournamentRegistrationScreen";
import TournamentRegistrationsScreen from "../screens/TournamentRegistrationsScreen";
import TournamentZonePlanningScreen from "../screens/TournamentZonePlanningScreen";
import TorneosScreen from "../screens/TorneosScreen";
import TurnosScreen from "../screens/TurnosScreen";

const Stack = createNativeStackNavigator();
const LOADING_SEGMENTS = Array.from({ length: 36 }, (_, index) => index);

function AuthLoadingScreen() {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          duration: 1500,
          easing: Easing.out(Easing.cubic),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          duration: 180,
          easing: Easing.in(Easing.cubic),
          toValue: 0,
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();

    return () => animation.stop();
  }, [progress]);

  return (
    <SafeAreaView style={styles.loadingSafeArea}>
      <View style={styles.loadingCard}>
        <View style={styles.loadingLogoStage}>
          {LOADING_SEGMENTS.map((segment) => {
            const start = Math.max(segment / LOADING_SEGMENTS.length, 0.001);
            const end = Math.min(start + 0.045, 1);
            const opacity = progress.interpolate({
              inputRange: [0, start, end],
              outputRange: [0.18, 0.18, 1],
              extrapolate: "clamp",
            });
            const scaleX = progress.interpolate({
              inputRange: [0, start, end],
              outputRange: [0.4, 0.4, 1],
              extrapolate: "clamp",
            });

            return (
              <Animated.View
                key={segment}
                style={[
                  styles.loadingSegment,
                  {
                    opacity,
                    transform: [
                      { rotate: `${segment * (360 / LOADING_SEGMENTS.length)}deg` },
                      { translateY: -72 },
                      { scaleX },
                    ],
                  },
                ]}
              />
            );
          })}
          <View style={styles.loadingLogoFrame}>
            <Image
              resizeMode="contain"
              source={require("../../assets/loading-icon-rounded.png")}
              style={styles.loadingLogo}
            />
          </View>
        </View>
        <Text style={styles.loadingBrand}>PadelNexo</Text>
        <Text style={styles.loadingText}>Cargando tu cuenta...</Text>
      </View>
    </SafeAreaView>
  );
}

function EmailVerificationBanner({ email, onResend, onDismiss }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleResend = async () => {
    if (sending || sent) return;
    setSending(true);
    setError("");
    try {
      await onResend();
      setSent(true);
    } catch (e) {
      setError(e?.message || "No pudimos reenviar el email.");
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.verificationBanner}>
      <View style={styles.verificationBannerContent}>
        <Text style={styles.verificationBannerText} numberOfLines={2}>
          {sent
            ? "Email reenviado. Revisá tu bandeja."
            : `Verificá el email enviado a ${email}`}
        </Text>
        {error ? (
          <Text style={styles.verificationBannerError}>{error}</Text>
        ) : null}
        {!sent ? (
          <Pressable onPress={handleResend} disabled={sending}>
            <Text style={styles.verificationBannerResend}>
              {sending ? "Enviando..." : "Reenviar"}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Pressable onPress={onDismiss} style={styles.verificationBannerClose} hitSlop={8}>
        <Text style={styles.verificationBannerCloseText}>✕</Text>
      </Pressable>
    </View>
  );
}

export default function AppNavigator() {
  const { initializing, user, emailVerified, resendVerificationEmail, refreshEmailVerified } = useAuth();
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const isEmailPasswordUser = user?.providerData?.[0]?.providerId === "password";
  const showBanner = Boolean(user && !emailVerified && isEmailPasswordUser && !bannerDismissed);

  useEffect(() => {
    if (!showBanner) return;
    const subscription = AppState.addEventListener("change", async (nextState) => {
      if (nextState === "active") {
        await refreshEmailVerified();
      }
    });
    return () => subscription.remove();
  }, [showBanner, refreshEmailVerified]);

  if (initializing) {
    return <AuthLoadingScreen />;
  }

  return (
    <View style={styles.navigatorRoot}>
      {showBanner ? (
        <EmailVerificationBanner
          email={user?.email || ""}
          onResend={resendVerificationEmail}
          onDismiss={() => setBannerDismissed(true)}
        />
      ) : null}
      <Stack.Navigator
      initialRouteName="Home"
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.surface,
        },
        headerShadowVisible: false,
        headerTintColor: colors.text,
        headerTitleAlign: "center",
        headerTitleStyle: {
          color: colors.text,
          fontWeight: "700",
        },
      }}
    >
      <Stack.Screen
        component={HomeScreen}
        name="Home"
        options={{ headerShown: false, title: "PadelNexo" }}
      />
      <Stack.Screen
        component={AdminScreen}
        name="Admin"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        component={LigasHubScreen}
        name="Ligas"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        component={CreateLeagueScreen}
        name="CreateLeague"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        component={MyLeaguesScreen}
        name="MyLeagues"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        component={PlayerLeaguesScreen}
        name="PlayerLeagues"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        component={OrganizerReplacementsScreen}
        name="OrganizerReplacements"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        component={OrganizerRegistrationsScreen}
        name="OrganizerRegistrations"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        component={LeagueDetailScreen}
        name="LeagueDetail"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        component={LeaguePlayersScreen}
        name="LeaguePlayers"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        component={LeagueFixtureScreen}
        name="LeagueFixture"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        component={LeaguePaymentsScreen}
        name="LeaguePayments"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        component={LeagueStandingsScreen}
        name="LeagueStandings"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        component={TorneosScreen}
        name="Torneos"
        options={{ headerShown: false, title: "Torneos" }}
      />
      <Stack.Screen
        component={CreateTournamentScreen}
        name="CreateTournament"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        component={TournamentDetailScreen}
        name="TournamentDetail"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        component={TournamentFixtureScreen}
        name="TournamentFixture"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        component={TournamentBracketFullscreenScreen}
        name="TournamentBracketFullscreen"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        component={TournamentRegistrationScreen}
        name="TournamentRegistration"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        component={TournamentRegistrationsScreen}
        name="TournamentRegistrations"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        component={TournamentZonePlanningScreen}
        name="TournamentZonePlanning"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        component={TournamentPaymentsScreen}
        name="TournamentPayments"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        component={TournamentPosterViewerScreen}
        name="TournamentPosterViewer"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        component={TurnosScreen}
        name="Turnos"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        component={JugadoresScreen}
        name="Jugadores"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        component={FinanzasScreen}
        name="Finanzas"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        component={FavoritosScreen}
        name="Favoritos"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        component={InvitacionesScreen}
        name="Invitaciones"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        component={MensajesScreen}
        name="Mensajes"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        component={MercadoPagoReturnScreen}
        name="MercadoPagoReturn"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        component={PlayerDetailScreen}
        name="PlayerDetail"
        options={{
          headerShown: false,
        }}
      />
      <Stack.Screen
        component={LoginScreen}
        name="Login"
        options={{ title: "Iniciar sesion" }}
      />
      <Stack.Screen
        component={RegisterScreen}
        name="Register"
        options={{ title: "Crear cuenta" }}
      />
    </Stack.Navigator>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingSafeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingCard: {
    alignItems: "center",
    flex: 1,
    gap: spacing.sm,
    justifyContent: "center",
    padding: spacing.lg,
  },
  loadingLogoStage: {
    alignItems: "center",
    height: 168,
    justifyContent: "center",
    marginBottom: spacing.sm,
    width: 168,
  },
  loadingSegment: {
    backgroundColor: colors.primaryLight,
    borderRadius: 999,
    height: 5,
    left: 75,
    position: "absolute",
    top: 81,
    width: 18,
  },
  loadingLogoFrame: {
    alignItems: "center",
    borderRadius: 999,
    height: 142,
    justifyContent: "center",
    width: 142,
  },
  loadingLogo: {
    borderRadius: 999,
    height: 138,
    width: 138,
  },
  loadingBrand: {
    color: colors.primaryDark,
    fontSize: 28,
    fontWeight: "900",
  },
  loadingText: {
    color: colors.muted,
    fontSize: 14,
    fontWeight: "700",
  },
  navigatorRoot: {
    flex: 1,
  },
  verificationBanner: {
    alignItems: "center",
    backgroundColor: "#FEF9E7",
    borderBottomColor: "#F9E79F",
    borderBottomWidth: 1,
    flexDirection: "row",
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  verificationBannerContent: {
    flex: 1,
    gap: 2,
  },
  verificationBannerText: {
    color: "#7D6608",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },
  verificationBannerError: {
    color: "#922B21",
    fontSize: 11,
    marginTop: 2,
  },
  verificationBannerResend: {
    color: "#B7950B",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 2,
    textDecorationLine: "underline",
  },
  verificationBannerClose: {
    marginLeft: spacing.sm,
    padding: 4,
  },
  verificationBannerCloseText: {
    color: "#7D6608",
    fontSize: 14,
    fontWeight: "700",
  },
});

