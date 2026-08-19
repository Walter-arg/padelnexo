const { admin, applyCors, getDb, handlePreflight, logger } = require("./adminShared");

const PLAN_LABELS = { simple: "Nexo Simple", plus: "Nexo Plus", premium: "Nexo Premium" };

// Eventos donde el entitlement queda (o sigue) activo. PRODUCT_CHANGE cubre
// upgrade/downgrade entre Simple/Plus/Premium o mensual/anual.
const ACTIVE_EVENT_TYPES = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "UNCANCELLATION",
]);

// CANCELLATION y BILLING_ISSUE no cortan el acceso al instante: el usuario
// sigue teniendo el entitlement hasta que la tienda lo de de baja de verdad
// y RevenueCat mande EXPIRATION (o, como red de seguridad, hasta que
// checkPlanExpirations detecte planExpiresAt vencido).
const EXPIRED_EVENT_TYPES = new Set(["EXPIRATION"]);

function serverTimestamp() {
  return admin.firestore.FieldValue.serverTimestamp();
}

function resolvePlanFromEvent(event = {}) {
  const entitlementId = Array.isArray(event.entitlement_ids) ? event.entitlement_ids[0] : null;
  return PLAN_LABELS[entitlementId] ? entitlementId : null;
}

function resolveBillingCycle(productId = "") {
  const normalized = String(productId || "");
  if (normalized.endsWith("_anual")) return "anual";
  if (normalized.endsWith("_mensual")) return "mensual";
  return null;
}

async function revenueCatWebhook(req, res) {
  if (handlePreflight(req, res)) {
    return;
  }

  applyCors(res);

  if (req.method !== "POST") {
    res.status(200).json({ received: true });
    return;
  }

  const expectedAuth = process.env.REVENUECAT_WEBHOOK_AUTH || "";
  const receivedAuth = String(req.headers?.authorization || "");

  if (!expectedAuth || receivedAuth !== expectedAuth) {
    logger.warn("Webhook de RevenueCat con Authorization invalido o sin configurar");
    res.status(401).json({ error: "invalid_authorization" });
    return;
  }

  const event = req.body?.event || {};
  const uid = String(event.app_user_id || "").trim();
  const eventType = String(event.type || "").trim();

  // Los eventos TEST (boton "Send test event" del dashboard) traen un
  // app_user_id de prueba que no corresponde a ningun usuario real.
  if (!uid || eventType === "TEST") {
    res.status(200).json({ received: true, ignored: true });
    return;
  }

  try {
    const userRef = getDb().collection("users").doc(uid);

    if (ACTIVE_EVENT_TYPES.has(eventType)) {
      const plan = resolvePlanFromEvent(event);

      if (!plan) {
        logger.warn("Evento de RevenueCat sin entitlement de plan reconocido", {
          eventType,
          productId: event.product_id,
          uid,
        });
        res.status(200).json({ ignored: true, reason: "unknown_plan", received: true });
        return;
      }

      await userRef.set(
        {
          plan,
          planActivatedDate: serverTimestamp(),
          planBillingCycle: resolveBillingCycle(event.product_id),
          planExpiresAt: Number(event.expiration_at_ms) || 0,
          planExpirationWarningSentAt: null,
          planSource: "revenuecat",
          planStatus: "active",
          planUpdatedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      res.status(200).json({ plan, received: true, uid });
      return;
    }

    if (EXPIRED_EVENT_TYPES.has(eventType)) {
      await userRef.set(
        {
          planStatus: "expired",
          planUpdatedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      res.status(200).json({ expired: true, received: true, uid });
      return;
    }

    logger.info("Evento de RevenueCat sin accion directa en Firestore", { eventType, uid });
    res.status(200).json({ eventType, ignored: true, received: true });
  } catch (error) {
    logger.error("Error al procesar webhook de RevenueCat", error);
    res.status(500).json({ error: error?.message || "webhook_error" });
  }
}

module.exports = { revenueCatWebhook };
