import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { colors } from "../config/theme";
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
import MyLeaguesScreen from "../screens/MyLeaguesScreen";
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
import TorneosScreen from "../screens/TorneosScreen";
import TurnosScreen from "../screens/TurnosScreen";

const Stack = createNativeStackNavigator();

export default function AppNavigator() {
  return (
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
        options={{ title: "Turnos" }}
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
  );
}

