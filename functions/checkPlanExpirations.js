const { logger } = require("firebase-functions/v2");
const { admin, getDb } = require("./adminShared");
const { sendPlanExpirationWarningEmail } = require("./sendPlanExpirationWarning");

const WARNING_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const PLAN_LABELS = { simple: "Nexo Simple", plus: "Nexo Plus", premium: "Nexo Premium" };

// Corre una vez por dia (ver el schedule en index.js). Una sola consulta por
// planExpiresAt (single-field, no necesita indice compuesto) y despues filtra
// por planStatus en memoria, para no depender de crear un indice compuesto.
async function checkPlanExpirationsHandler() {
  const db = getDb();
  const now = Date.now();
  const warningThreshold = now + WARNING_WINDOW_MS;

  const snapshot = await db
    .collection("users")
    .where("planExpiresAt", "<=", warningThreshold)
    .get();

  let expiredCount = 0;
  let warnedCount = 0;

  for (const docSnapshot of snapshot.docs) {
    const data = docSnapshot.data() || {};
    const planStatus = data.planStatus;

    if (planStatus !== "trial" && planStatus !== "active") {
      continue;
    }

    const planExpiresAt = Number(data.planExpiresAt || 0);

    if (!planExpiresAt) {
      continue;
    }

    if (planExpiresAt <= now) {
      await docSnapshot.ref.update({
        planStatus: "expired",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      expiredCount += 1;
      continue;
    }

    if (data.planExpirationWarningSentAt) {
      continue;
    }

    try {
      const privateSnapshot = await docSnapshot.ref.collection("private").doc("contact").get();
      const email = privateSnapshot.exists ? privateSnapshot.data()?.email || "" : "";

      if (email) {
        await sendPlanExpirationWarningEmail({
          email,
          name: data.nombre || "",
          planLabel: PLAN_LABELS[data.plan] || "tu plan",
          expiresAtLabel: new Date(planExpiresAt).toLocaleDateString("es-AR"),
        });
        warnedCount += 1;
      }

      await docSnapshot.ref.update({
        planExpirationWarningSentAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (error) {
      logger.error(
        `[checkPlanExpirations] No se pudo avisar a ${docSnapshot.id}`,
        error?.message || error
      );
    }
  }

  logger.info(
    `[checkPlanExpirations] Revisados: ${snapshot.size}. Vencidos: ${expiredCount}. Avisados: ${warnedCount}.`
  );
}

module.exports = { checkPlanExpirationsHandler };
