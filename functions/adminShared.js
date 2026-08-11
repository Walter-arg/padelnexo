const admin = require("firebase-admin");
const { logger } = require("firebase-functions/v2");

const ADMIN_EMAIL = "wramirez.arg@gmail.com";

let adminApp = null;
let db = null;

function getDb() {
  if (!adminApp) {
    adminApp = admin.apps.length ? admin.app() : admin.initializeApp();
  }

  if (!db) {
    db = admin.firestore(adminApp);
  }

  return db;
}

function applyCors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function handlePreflight(req, res) {
  applyCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }

  return false;
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function isAdminEmail(email = "") {
  return String(email || "").trim().toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

// Verifica que quien llama esta autenticado y es administrador.
// Nunca confia en datos enviados por el cliente para esto: solo en el ID
// token verificado por Firebase Auth y en el propio documento de Firestore
// del que llama (leido con Admin SDK, que ignora las reglas de seguridad).
async function requireAdmin(req) {
  const authHeader = String(req.headers?.authorization || "");
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  if (!idToken) {
    throw new HttpError(401, "missing_id_token");
  }

  // admin.auth() usa la app por defecto de Admin SDK, que getDb() es quien
  // la inicializa (lazy). Hay que asegurarla antes de tocar admin.auth().
  getDb();

  let decodedToken;

  try {
    decodedToken = await admin.auth().verifyIdToken(idToken);
  } catch (error) {
    logger.warn("Token invalido al verificar admin", error);
    throw new HttpError(401, "invalid_id_token");
  }

  if (isAdminEmail(decodedToken.email)) {
    return decodedToken;
  }

  const callerSnapshot = await getDb().collection("users").doc(decodedToken.uid).get();
  const callerData = callerSnapshot.exists ? callerSnapshot.data() || {} : {};
  const isAdmin = callerData.role === "admin" || callerData.adminStatus === "active";

  if (!isAdmin) {
    throw new HttpError(403, "not_admin");
  }

  return decodedToken;
}

// Registra quien hizo que y cuando. Nunca debe romper la accion real: si el
// log falla, solo se anota en los logs de Cloud Functions.
async function logAdminAction({ action, actor, details = {} }) {
  try {
    await getDb()
      .collection("adminAuditLog")
      .add({
        action,
        actorUid: actor?.uid || "",
        actorEmail: actor?.email || "",
        details,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
  } catch (error) {
    logger.error("No se pudo registrar la accion en el log de auditoria", error);
  }
}

function withAdminHandler(actionName, handler) {
  return async (req, res) => {
    if (handlePreflight(req, res)) {
      return;
    }

    applyCors(res);

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    try {
      const actor = await requireAdmin(req);
      await handler(req, res);

      if (actionName) {
        await logAdminAction({ action: actionName, actor, details: req.body || {} });
      }
    } catch (error) {
      if (error instanceof HttpError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }

      logger.error("Error en accion administrativa", error);
      res.status(500).json({ error: error?.message || "No pudimos completar la accion." });
    }
  };
}

module.exports = {
  HttpError,
  admin,
  applyCors,
  getDb,
  handlePreflight,
  logger,
  requireAdmin,
  withAdminHandler,
};
