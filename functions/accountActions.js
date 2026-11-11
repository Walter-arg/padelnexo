const { onRequest } = require("firebase-functions/v2/https");

const { admin, applyCors, getDb, handlePreflight, HttpError, logger } = require("./adminShared");

function serverTimestamp() {
  return admin.firestore.FieldValue.serverTimestamp();
}

// Borra por completo las conversaciones (y sus mensajes) donde el usuario
// participo, y los bloqueos donde figura como bloqueador o bloqueado.
async function deleteUserChatData(db, userId) {
  const conversationsSnapshot = await db
    .collection("conversations")
    .where("participants", "array-contains", userId)
    .get();

  for (const conversationDoc of conversationsSnapshot.docs) {
    const messagesSnapshot = await conversationDoc.ref.collection("messages").get();
    const messagesBatch = db.batch();

    messagesSnapshot.docs.forEach((messageDoc) => messagesBatch.delete(messageDoc.ref));

    if (!messagesSnapshot.empty) {
      await messagesBatch.commit();
    }

    await conversationDoc.ref.delete();
  }

  const [blockedByUser, blockedUser] = await Promise.all([
    db.collection("userBlocks").where("blockerId", "==", userId).get(),
    db.collection("userBlocks").where("blockedId", "==", userId).get(),
  ]);

  const blocksBatch = db.batch();
  blockedByUser.docs.forEach((blockDoc) => blocksBatch.delete(blockDoc.ref));
  blockedUser.docs.forEach((blockDoc) => blocksBatch.delete(blockDoc.ref));

  if (!blockedByUser.empty || !blockedUser.empty) {
    await blocksBatch.commit();
  }
}

async function verifyCallerToken(req) {
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

// Autoeliminacion de cuenta. Corre server-side con Admin SDK para no
// depender de que el cliente siga autenticado durante toda la operacion.
// El usuario de Auth se borra primero: si eso falla, se aborta sin tocar
// Firestore (Admin SDK ignora las reglas de seguridad, asi que el orden ya
// no depende de ellas). En vez de borrar el documento de users/{uid} por
// completo, lo dejamos como un perfil "tumba" (Usuario eliminado) para no
// romper referencias en ligas/torneos en curso que ya tienen el nombre
// guardado. Las conversaciones/mensajes y bloqueos si se borran por completo
// (incluye el lado del otro participante), a diferencia del perfil.
const deleteOwnAccount = onRequest({ invoker: "public" }, async (req, res) => {
  if (handlePreflight(req, res)) {
    return;
  }

  applyCors(res);

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const decodedToken = await verifyCallerToken(req);
    const userId = decodedToken.uid;
    const db = getDb();
    const userRef = db.collection("users").doc(userId);
    const privateRef = userRef.collection("private").doc("contact");
    const organizerRequestRef = db.collection("organizerRequests").doc(userId);

    // El borrado de Auth va PRIMERO y si falla, abortamos sin tocar
    // Firestore. Antes iba al final con el error silenciado: si fallaba, la
    // cuenta de Auth quedaba viva pero el perfil ya tachado, y la persona
    // quedaba bloqueada al volver a entrar hasta que un admin la desbloqueaba
    // a mano. Asi, una cuenta nunca queda "a medio borrar".
    await admin.auth().deleteUser(userId);

    const userSnapshot = await userRef.get();
    const userData = userSnapshot.exists ? userSnapshot.data() || {} : {};

    try {
      await admin.storage().bucket().file(`profileImages/${userId}`).delete();
    } catch (error) {
      // La foto puede no existir, seguimos igual con el resto del borrado.
    }

    await deleteUserChatData(db, userId);

    const batch = db.batch();

    batch.delete(privateRef);
    batch.delete(organizerRequestRef);
    batch.update(userRef, {
      nombre: "Usuario eliminado",
      // Se guarda el nombre real aparte para que el panel de admin pueda
      // seguir identificando a la cuenta; nunca se expone a otros usuarios.
      nombreOriginal: userData.nombre || "",
      apellidoOriginal: userData.apellido || "",
      fotoURL: "",
      descripcion: "",
      mostrarTelefono: false,
      telefono: "",
      accountDeleted: true,
      deletedAt: serverTimestamp(),
    });

    await batch.commit();

    res.status(200).json({ ok: true });
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }

    logger.error("[deleteOwnAccount] Error", error);
    res.status(500).json({ error: error?.message || "No pudimos eliminar la cuenta." });
  }
});

module.exports = { deleteOwnAccount };
