import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { arrayUnion, doc, getDoc, serverTimestamp, setDoc } from "../../services/firebaseFirestore";

import { db } from "../../services/firebaseConfig";
import devLog from "../utils/devLog";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

if (Platform.OS === "android") {
  Notifications.setNotificationChannelAsync("default", {
    name: "default",
    importance: Notifications.AndroidImportance.DEFAULT,
    lightColor: "#2E7D52",
    vibrationPattern: [0, 250, 250, 250],
  }).catch(() => {});
}

export async function saveUserPushToken(uid, expoPushToken) {
  if (!uid || !expoPushToken) {
    return;
  }

  await setDoc(
    doc(db, "users", uid),
    {
      expoPushToken,
      pushTokens: arrayUnion(expoPushToken),
      pushTokenUpdatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function registerForPushNotificationsAsync(uid) {
  if (!uid || Platform.OS === "web") {
    return null;
  }

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== "granted") {
      devLog("[pushNotificationsService] Permiso de notificaciones no concedido");
      return null;
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;

    if (!projectId) {
      devLog("[pushNotificationsService] Falta el projectId de EAS, no se puede pedir el push token");
      return null;
    }

    const { data: expoPushToken } = await Notifications.getExpoPushTokenAsync({ projectId });

    await saveUserPushToken(uid, expoPushToken);

    return expoPushToken;
  } catch (error) {
    // En Expo Go (sin build nativo) esta llamada falla siempre: se degrada
    // a no-op igual que antes, y funciona de verdad en builds EAS reales.
    devLog("[pushNotificationsService] No se pudo registrar el push token:", error?.message || error);
    return null;
  }
}

export async function getUserPushTokens(uid) {
  if (!uid) {
    return [];
  }

  const snapshot = await getDoc(doc(db, "users", uid));

  if (!snapshot.exists()) {
    return [];
  }

  const data = snapshot.data() || {};
  const tokens = Array.isArray(data.pushTokens) ? data.pushTokens : [];

  return [...new Set([...tokens, data.expoPushToken].filter(Boolean))];
}

export async function sendExpoPushNotificationAsync({ body, data = {}, title, tokens = [] }) {
  const uniqueTokens = [...new Set(tokens.filter(Boolean))];

  if (!uniqueTokens.length) {
    return;
  }

  await fetch("https://exp.host/--/api/v2/push/send", {
    body: JSON.stringify(
      uniqueTokens.map((to) => ({
        to,
        sound: "default",
        title,
        body,
        data,
        channelId: "default",
      }))
    ),
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    method: "POST",
  });
}

export async function sendPaymentReminderPushAsync({
  leagueId = "",
  leagueName = "Liga",
  playerUserId = "",
  roundId = "",
  roundTitle = "Fecha",
  stageLabel = "",
}) {
  const tokens = await getUserPushTokens(playerUserId);

  if (!tokens.length) {
    return;
  }

  await sendExpoPushNotificationAsync({
    tokens,
    title: "Recordatorio de pago",
    body: `${leagueName} · ${roundTitle}: pago pendiente (${stageLabel}).`,
    data: {
      type: "league_payment_reminder",
      leagueId,
      roundId,
      stageLabel,
    },
  });
}

export async function sendTournamentPaymentReminderPushAsync({
  playerUserId = "",
  registrationId = "",
  tournamentId = "",
  tournamentName = "Torneo",
}) {
  const tokens = await getUserPushTokens(playerUserId);

  if (!tokens.length) {
    return;
  }

  await sendExpoPushNotificationAsync({
    tokens,
    title: "Recordatorio de pago",
    body: `${tournamentName}: tenes un pago pendiente de inscripcion.`,
    data: {
      type: "tournament_payment_reminder",
      tournamentId,
      registrationId,
    },
  });
}
