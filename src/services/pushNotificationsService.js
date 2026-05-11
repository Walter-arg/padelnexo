import { arrayUnion, doc, getDoc, serverTimestamp, setDoc } from "../../services/firebaseFirestore";

import { db } from "../../services/firebaseConfig";

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
  // Expo Go Android no soporta push remotas desde SDK 53. Para evitar que Metro cargue
  // expo-notifications en Expo Go, el registro real se activara cuando pasemos a development build.
  return uid ? null : null;
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

  return [...tokens, data.expoPushToken].filter(Boolean);
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

