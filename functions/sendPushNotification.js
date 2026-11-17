const { onRequest } = require("firebase-functions/v2/https");

const { applyCors, getDb, handlePreflight, logger } = require("./mercadoPagoShared");

function normalizeString(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

async function getUserPushTokens(db, uid) {
  const snapshot = await db.collection("users").doc(uid).get();

  if (!snapshot.exists) {
    return [];
  }

  const data = snapshot.data() || {};
  const tokens = Array.isArray(data.pushTokens) ? data.pushTokens : [];

  return [...new Set([...tokens, data.expoPushToken].filter(Boolean))];
}

async function sendExpoPush(tokens, title, body, data) {
  if (!tokens.length) {
    return;
  }

  await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      tokens.map((to) => ({
        to,
        sound: "default",
        title,
        body,
        data: data || {},
        channelId: "default",
      }))
    ),
  });
}

// Permite que la web dispare el mismo aviso push al telefono que ya dispara
// la app cuando el organizador manda un mensaje interno (ver
// sendExpoPushNotificationAsync en pushNotificationsService.js). Web nunca
// tiene el token push del organizador, asi que esto llena ese hueco: la web
// llama a esta funcion con el id del jugador destinatario, y el texto ya
// armado (mismo template que usa la app).
const sendPushNotification = onRequest({ invoker: "public" }, async (req, res) => {
  if (handlePreflight(req, res)) {
    return;
  }

  applyCors(res);

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const payload = req.body || {};
    const recipientId = normalizeString(payload.recipientId);
    const title = normalizeString(payload.title, "Nuevo mensaje");
    const body = normalizeString(payload.body);

    if (!recipientId || !body) {
      res.status(400).json({ error: "recipientId and body are required" });
      return;
    }

    const db = getDb();
    const recipientSnapshot = await db.collection("users").doc(recipientId).get();
    const recipientData = recipientSnapshot.exists ? recipientSnapshot.data() || {} : {};

    if (recipientData.chatHabilitado !== true) {
      res.status(200).json({ sent: false, reason: "chat_disabled" });
      return;
    }

    const tokens = await getUserPushTokens(db, recipientId);

    if (!tokens.length) {
      res.status(200).json({ sent: false, reason: "no_tokens" });
      return;
    }

    await sendExpoPush(tokens, title, body, payload.data || {});

    res.status(200).json({ sent: true });
  } catch (error) {
    logger.error("sendPushNotification failed", error);
    res.status(500).json({ error: "No pudimos enviar la notificacion." });
  }
});

module.exports = { sendPushNotification };
