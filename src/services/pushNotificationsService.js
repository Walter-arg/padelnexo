import { arrayUnion, doc, getDoc, serverTimestamp, setDoc } from "../../services/firebaseFirestore";

import { db } from "../../services/firebaseConfig";
import devLog from "../utils/devLog";

// expo-notifications requiere modulos nativos que solo existen en builds nativos (EAS Build).
// En Expo Go no hay soporte para push tokens. Las funciones de registro son no-ops
// en este entorno y se activaran automaticamente en el build de produccion/desarrollo nativo.

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
  devLog("[pushNotificationsService] Push notifications disponibles solo en builds nativos (EAS Build)");
  return null;
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
