const { onRequest } = require("firebase-functions/v2/https");

const { admin, applyCors, getDb, handlePreflight, HttpError, logger } = require("./adminShared");

function serverTimestamp() {
  return admin.firestore.FieldValue.serverTimestamp();
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
// depender de que el cliente siga autenticado durante toda la operacion
// (el borrado de Firestore tiene que pasar SIEMPRE antes de borrar el
// usuario de Auth, si no las reglas de seguridad rechazan la escritura).
// En vez de borrar el documento de users/{uid} por completo, lo dejamos
// como un perfil "tumba" (Usuario eliminado) para no romper referencias
// en ligas/torneos en curso que ya tienen el nombre guardado.
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

    try {
      await admin.storage().bucket().file(`profileImages/${userId}`).delete();
    } catch (error) {
      // La foto puede no existir, seguimos igual con el resto del borrado.
    }

    const batch = db.batch();

    batch.delete(privateRef);
    batch.delete(organizerRequestRef);
    batch.update(userRef, {
      nombre: "Usuario eliminado",
      fotoURL: "",
      descripcion: "",
      mostrarTelefono: false,
      telefono: "",
      accountDeleted: true,
      deletedAt: serverTimestamp(),
    });

    await batch.commit();

    try {
      await admin.auth().deleteUser(userId);
    } catch (error) {
      logger.error("[deleteOwnAccount] No se pudo borrar el usuario de Auth", error);
    }

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
