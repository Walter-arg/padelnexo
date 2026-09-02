const admin = require("firebase-admin");

// Funcion temporal de solo lectura para ver los breadcrumbs de diagnostico
// del bug del formulario en blanco. Se borra junto con debugBreadcrumb.js,
// la regla de Firestore de debugBreadcrumbs, y esta funcion, una vez resuelto.
const TARGET_UID = "TYhB9OcjaZTIfMgnXP7OXvGGZmm2";

async function debugBreadcrumbsTemp(req, res) {
  if (!admin.apps.length) {
    admin.initializeApp();
  }

  const db = admin.firestore();
  const snapshot = await db
    .collection("debugBreadcrumbs")
    .where("uid", "==", TARGET_UID)
    .get();

  const entries = snapshot.docs
    .map((doc) => {
      const data = doc.data() || {};
      return {
        event: data.event,
        details: data.details || {},
        clientTimeMs: data.clientTimeMs,
      };
    })
    .sort((a, b) => (a.clientTimeMs || 0) - (b.clientTimeMs || 0));

  res.status(200).json({ uid: TARGET_UID, count: entries.length, entries });
}

module.exports = { debugBreadcrumbsTemp };
