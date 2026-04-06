import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { colors } from "../config/theme";
import AdminScreen from "../screens/AdminScreen";
import CreateLeagueScreen from "../screens/CreateLeagueScreen";
import FavoritosScreen from "../screens/FavoritosScreen";
import HomeScreen from "../screens/HomeScreen";
import InvitacionesScreen from "../screens/InvitacionesScreen";
import JugadoresScreen from "../screens/JugadoresScreen";
import LigasHubScreen from "../screens/LigasHubScreen";
import LoginScreen from "../screens/LoginScreen";
import MensajesScreen from "../screens/MensajesScreen";
import PlayerDetailScreen from "../screens/PlayerDetailScreen";
import RegisterScreen from "../screens/RegisterScreen";
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
        options={{ title: "Panel Admin" }}
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
        component={TorneosScreen}
        name="Torneos"
        options={{ title: "Torneos" }}
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
