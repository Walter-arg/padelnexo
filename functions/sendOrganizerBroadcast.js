const { admin, applyCors, getDb, handlePreflight, HttpError, logger } = require("./adminShared");

// Mismo mecanismo que usa la app (src/services/pushNotificationsService.js):
// los tokens de push se guardan en users/{uid}.pushTokens / expoPushToken, y
// se envian con un POST a la API de Expo. Se hace desde el backend (y no
// directo desde el navegador, como en el cliente RN) para no depender de si
// exp.host permite llamadas cross-origin desde un dominio web.
async function getPushTokensForUser(db, uid) {
  if (!uid) {
    return [];
  }

  const snapshot = await db.collection("users").doc(uid).get();

  if (!snapshot.exists) {
    return [];
  }

  const data = snapshot.data() || {};
  const tokens = Array.isArray(data.pushTokens) ? data.pushTokens : [];

  return [...new Set([...tokens, data.expoPushToken].filter(Boolean))];
}

function getLeaguePlayerIds(liga) {
  const players = Array.isArray(liga?.players) ? liga.players : [];

  return players.map((player) => player.linkedUserId).filter(Boolean);
}

async function getTournamentPlayerIds(db, tournamentId) {
  const snapshot = await db
    .collection("tournaments")
    .doc(tournamentId)
    .collection("registrations")
    .get();
  const ids = [];

  snapshot.docs.forEach((registrationDoc) => {
    const data = registrationDoc.data() || {};

    if (data.player1Id) {
      ids.push(data.player1Id);
    }

    if (data.player2Id) {
      ids.push(data.player2Id);
    }
  });

  return ids;
}

async function sendExpoPush(tokens, title, body) {
  const uniqueTokens = [...new Set(tokens.filter(Boolean))];

  if (!uniqueTokens.length) {
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
      uniqueTokens.map((to) => ({ to, sound: "default", title, body, channelId: "default" }))
    ),
  });
}

async function verifyCaller(req) {
  const authHeader = String(req.headers?.authorization || "");
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (!idToken) {
    throw new HttpError(401, "missing_id_token");
  }

  getDb();

  try {
    return await admin.auth().verifyIdToken(idToken);
  } catch (error) {
    throw new HttpError(401, "invalid_id_token");
  }
}

// Deja que un organizador les mande un aviso push a los jugadores de una de
// sus ligas, uno de sus torneos, o a todos a la vez (ej: se suspende o se
// posterga una liga y hay que avisarle a todos los inscriptos de una).
async function sendOrganizerBroadcast(req, res) {
  if (handlePreflight(req, res)) {
    return;
  }

  applyCors(res);

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const decodedToken = await verifyCaller(req);
    const organizerId = decodedToken.uid;
    const db = getDb();
    const { destino, destinoId, titulo, mensaje } = req.body || {};
    const safeTitulo = String(titulo || "").trim().slice(0, 80);
    const safeMensaje = String(mensaje || "").trim().slice(0, 300);

    if (!safeTitulo || !safeMensaje) {
      throw new HttpError(400, "titulo_y_mensaje_requeridos");
    }

    if (!["todos", "liga", "torneo"].includes(destino)) {
      throw new HttpError(400, "destino_invalido");
    }

    const [ligasSnapshot, torneosSnapshot] = await Promise.all([
      db.collection("leagues").where("organizerId", "==", organizerId).get(),
      db.collection("tournaments").where("organizerId", "==", organizerId).get(),
    ]);
    const ligas = ligasSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const torneos = torneosSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    let targetIds = [];
    let destinoNombre = "Todos los jugadores";

    if (destino === "liga") {
      const liga = ligas.find((item) => item.id === destinoId);

      if (!liga) {
        throw new HttpError(404, "liga_no_encontrada");
      }

      targetIds = getLeaguePlayerIds(liga);
      destinoNombre = liga.nombre || "Liga";
    } else if (destino === "torneo") {
      const torneo = torneos.find((item) => item.id === destinoId);

      if (!torneo) {
        throw new HttpError(404, "torneo_no_encontrado");
      }

      targetIds = await getTournamentPlayerIds(db, destinoId);
      destinoNombre = torneo.nombre || "Torneo";
    } else {
      const torneoIdsArrays = await Promise.all(
        torneos.map((torneo) => getTournamentPlayerIds(db, torneo.id))
      );

      targetIds = [...ligas.flatMap(getLeaguePlayerIds), ...torneoIdsArrays.flat()];
    }

    const uniqueTargetIds = [...new Set(targetIds)];
    const tokensArrays = await Promise.all(
      uniqueTargetIds.map((id) => getPushTokensForUser(db, id))
    );
    const allTokens = tokensArrays.flat();

    if (uniqueTargetIds.length) {
      await sendExpoPush(allTokens, safeTitulo, safeMensaje);
    }

    await db.collection("organizerNotifications").add({
      organizerId,
      titulo: safeTitulo,
      mensaje: safeMensaje,
      destino,
      destinoId: destino !== "todos" ? destinoId : null,
      destinoNombre,
      recipientCount: uniqueTargetIds.length,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      status: "sent",
    });

    res.status(200).json({ ok: true, recipientCount: uniqueTargetIds.length });
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    logger.error("[sendOrganizerBroadcast] Error", error);
    res.status(500).json({ error: error?.message || "No pudimos enviar la notificacion." });
  }
}

module.exports = { sendOrganizerBroadcast };
