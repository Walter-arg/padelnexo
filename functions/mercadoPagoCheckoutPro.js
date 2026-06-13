const crypto = require("crypto");
const { onRequest } = require("firebase-functions/v2/https");

const {
  admin,
  applyCors,
  getDb,
  getMercadoPagoPreferenceClient,
  getOptionalEnv,
  handlePreflight,
  logger,
  mercadoPagoRequest,
} = require("./mercadoPagoShared");

function normalizeMoney(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0;
}

function buildTurnoItemTitle(payload = {}) {
  const complexName = String(payload.complexName || "Complejo").trim();
  const courtName = String(payload.courtName || "Cancha").trim();
  const dateLabel = String(payload.dateLabel || "").trim();
  const time = String(payload.time || "").trim();

  return [complexName, courtName, dateLabel && time ? `${dateLabel} ${time} hs` : dateLabel || time]
    .filter(Boolean)
    .join(" - ");
}

const mercadoPagoCreateTurnoPreference = onRequest({ invoker: "public" }, async (req, res) => {
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
    const reservationId = String(payload.reservationId || "").trim();
    const amount = normalizeMoney(payload.amount);

    if (!reservationId) {
      res.status(400).json({ error: "reservationId is required" });
      return;
    }

    if (!amount) {
      res.status(400).json({ error: "amount must be greater than 0" });
      return;
    }

    const preferenceBody = {
      items: [
        {
          title: buildTurnoItemTitle(payload),
          quantity: 1,
          unit_price: amount,
          currency_id: "ARS",
        },
      ],
      external_reference: reservationId,
      metadata: {
        complexName: String(payload.complexName || "").trim(),
        courtName: String(payload.courtName || "").trim(),
        organizerId: String(payload.organizerId || "").trim(),
        organizerName: String(payload.organizerName || "").trim(),
        reservationId,
        source: "padelnexo_turnos",
      },
      payer: {
        email: String(payload.payerEmail || "").trim() || undefined,
        name: String(payload.payerName || "").trim() || undefined,
      },
      statement_descriptor: String(
        getOptionalEnv("MERCADO_PAGO_STATEMENT_DESCRIPTOR") || "PADELNEXO"
      ).trim(),
      notification_url: String(
        payload.notificationUrl || getOptionalEnv("MERCADO_PAGO_WEBHOOK_URL") || ""
      ).trim() || undefined,
      back_urls:
        payload.successUrl || payload.failureUrl || payload.pendingUrl
          ? {
              success: String(payload.successUrl || "").trim() || undefined,
              failure: String(payload.failureUrl || "").trim() || undefined,
              pending: String(payload.pendingUrl || "").trim() || undefined,
            }
          : undefined,
      auto_return: payload.successUrl ? "approved" : undefined,
    };

    logger.info("Creando preferencia de Checkout Pro", {
      amount,
      organizerId: String(payload.organizerId || "").trim(),
      reservationId,
      title: preferenceBody.items?.[0]?.title || "",
    });

    const preference = await getMercadoPagoPreferenceClient().create({
      body: preferenceBody,
    });

    logger.info("Preferencia creada correctamente", {
      preferenceId: String(preference.id || "").trim(),
      reservationId,
    });
    logger.info("URL de Checkout Pro generada correctamente", {
      hasInitPoint: Boolean(String(preference.init_point || "").trim()),
      hasSandboxInitPoint: Boolean(String(preference.sandbox_init_point || "").trim()),
      reservationId,
    });

    await getDb().collection("turnoReservations").doc(reservationId).set(
      {
        mercadoPagoPreferenceId: String(preference.id || "").trim(),
        mercadoPagoCheckoutUrl: String(preference.init_point || "").trim(),
        mercadoPagoStatus: "pending",
        paymentGateway: "mercado_pago",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    res.status(200).json({
      id: preference.id,
      initPoint: preference.init_point || "",
      sandboxInitPoint: preference.sandbox_init_point || "",
      preferenceId: preference.id || "",
    });
  } catch (error) {
    logger.error("No pudimos crear la preferencia de Mercado Pago", error);
    res.status(500).json({
      error: error?.message || "No pudimos crear el cobro de Mercado Pago.",
    });
  }
});

function resolveWebhookPaymentId(req = {}) {
  const body = req.body || {};
  const query = req.query || {};

  return String(
    query["data.id"] ||
      query.data_id ||
      body?.data?.id ||
      body?.resource?.id ||
      body?.id ||
      ""
  ).trim();
}

function resolveWebhookTopic(req = {}) {
  const body = req.body || {};
  const query = req.query || {};

  return String(query.type || query.topic || body.type || body.topic || "").trim().toLowerCase();
}

function isWebhookSimulation(req = {}) {
  const body = req.body || {};

  return body.live_mode === false;
}

function parseWebhookSignatureHeader(signatureHeader = "") {
  return String(signatureHeader || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((accumulator, part) => {
      const [key, value] = part.split("=");

      if (key && value) {
        accumulator[key.trim()] = value.trim();
      }

      return accumulator;
    }, {});
}

function buildWebhookManifest({ paymentId = "", requestId = "", timestamp = "" }) {
  return [
    paymentId ? `id:${paymentId}` : "",
    requestId ? `request-id:${requestId}` : "",
    timestamp ? `ts:${timestamp}` : "",
  ]
    .filter(Boolean)
    .join(";")
    .concat(";");
}

function safeEqualHex(left = "", right = "") {
  const leftBuffer = Buffer.from(String(left || ""), "hex");
  const rightBuffer = Buffer.from(String(right || ""), "hex");

  if (!leftBuffer.length || !rightBuffer.length || leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function validateWebhookSignature(req = {}) {
  const webhookSecret = getOptionalEnv("MERCADO_PAGO_WEBHOOK_SECRET");

  if (!webhookSecret) {
    logger.warn("Mercado Pago webhook recibido sin validacion de firma", {
      reason: "missing_webhook_secret",
    });
    return {
      reason: "missing_webhook_secret",
      validated: false,
    };
  }

  const signatureHeader = String(req.headers?.["x-signature"] || "").trim();
  const requestId = String(req.headers?.["x-request-id"] || "").trim();

  if (!signatureHeader || !requestId) {
    return {
      error: "missing_signature_headers",
      validated: false,
    };
  }

  const signatureParts = parseWebhookSignatureHeader(signatureHeader);
  const paymentId = resolveWebhookPaymentId(req);
  const timestamp = String(signatureParts.ts || "").trim();
  const receivedHash = String(signatureParts.v1 || "").trim().toLowerCase();

  if (!paymentId || !timestamp || !receivedHash) {
    return {
      error: "invalid_signature_payload",
      validated: false,
    };
  }

  const manifest = buildWebhookManifest({
    paymentId,
    requestId,
    timestamp,
  });
  const expectedHash = crypto
    .createHmac("sha256", webhookSecret)
    .update(manifest)
    .digest("hex")
    .toLowerCase();

  if (!safeEqualHex(expectedHash, receivedHash)) {
    return {
      error: "invalid_signature",
      validated: false,
    };
  }

  logger.info("Firma de webhook de Mercado Pago validada correctamente", {
    paymentId,
    requestId,
  });

  return {
    validated: true,
  };
}

function mapMercadoPagoStatusToReservationPaymentStatus(status = "") {
  const normalized = String(status || "").trim().toLowerCase();

  if (normalized === "approved") {
    return "pagado";
  }

  if (["pending", "in_process", "authorized"].includes(normalized)) {
    return "in_review";
  }

  if (["rejected", "cancelled", "refunded", "charged_back"].includes(normalized)) {
    return "payment_issue";
  }

  return "in_review";
}

async function updateReservationPaymentFromMercadoPagoPayment(payment = {}) {
  const reservationId = String(
    payment.external_reference || payment.metadata?.reservationId || ""
  ).trim();

  if (!reservationId) {
    return {
      reason: "missing_external_reference",
      reservationId: "",
      updated: false,
    };
  }

  const reservationRef = getDb().collection("turnoReservations").doc(reservationId);
  const reservationSnapshot = await reservationRef.get();
  const reservationData = reservationSnapshot.exists ? reservationSnapshot.data() || {} : {};
  const requiresOrganizerApproval = reservationData.requiresOrganizerApproval !== false;
  const normalizedPaymentStatus = String(payment.status || "").trim().toLowerCase();
  const nextReservationStatus =
    normalizedPaymentStatus === "approved"
      ? requiresOrganizerApproval
        ? "pending_organizer_confirmation"
        : "confirmed"
      : ["rejected", "cancelled", "refunded", "charged_back"].includes(normalizedPaymentStatus)
        ? "cancelled"
        : reservationData.status || "pending_payment";

  await reservationRef.set(
    {
      mercadoPagoLiveMode: payment.live_mode === true,
      mercadoPagoPaymentId: String(payment.id || "").trim(),
      mercadoPagoStatus: String(payment.status || "").trim(),
      mercadoPagoStatusDetail: String(payment.status_detail || "").trim(),
      paymentGateway: "mercado_pago",
      paymentMethod: "mercado_pago",
      paymentStatus: mapMercadoPagoStatusToReservationPaymentStatus(payment.status),
      status: nextReservationStatus,
      confirmedAt:
        nextReservationStatus === "confirmed"
          ? admin.firestore.FieldValue.serverTimestamp()
          : reservationData.confirmedAt || null,
      cancelledAt:
        nextReservationStatus === "cancelled"
          ? admin.firestore.FieldValue.serverTimestamp()
          : reservationData.cancelledAt || null,
      mercadoPagoApprovedAt:
        payment.status === "approved"
          ? admin.firestore.FieldValue.serverTimestamp()
          : null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return {
    reservationId,
    updated: true,
  };
}

const mercadoPagoSyncTurnoPayment = onRequest({ invoker: "public" }, async (req, res) => {
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
    const paymentId = String(payload.paymentId || "").trim();
    const reservationId = String(payload.reservationId || "").trim();

    if (!paymentId && !reservationId) {
      res.status(400).json({
        error: "paymentId or reservationId is required",
      });
      return;
    }

    let payment = null;

    if (paymentId) {
      payment = await mercadoPagoRequest(`/v1/payments/${paymentId}`, {
        method: "GET",
      });
    } else {
      const searchResult = await mercadoPagoRequest(
        `/v1/payments/search?external_reference=${encodeURIComponent(
          reservationId
        )}&sort=date_created&criteria=desc&limit=1`,
        {
          method: "GET",
        }
      );

      payment = Array.isArray(searchResult.results) ? searchResult.results[0] || null : null;
    }

    if (!payment) {
      res.status(404).json({
        error: "payment_not_found",
      });
      return;
    }

    const updateResult = await updateReservationPaymentFromMercadoPagoPayment(payment);

    logger.info("Pago sincronizado correctamente desde retorno de Checkout Pro", {
      mercadoPagoPaymentId: String(payment.id || "").trim(),
      reservationId: updateResult.reservationId || reservationId,
      status: String(payment.status || "").trim(),
    });

    res.status(200).json({
      mercadoPagoPaymentId: String(payment.id || "").trim(),
      mercadoPagoStatus: String(payment.status || "").trim(),
      paymentStatus: mapMercadoPagoStatusToReservationPaymentStatus(payment.status),
      reservationId: updateResult.reservationId || reservationId,
      updated: updateResult.updated === true,
    });
  } catch (error) {
    logger.error("No pudimos sincronizar el pago de Mercado Pago", error);
    res.status(500).json({
      error: error?.message || "No pudimos sincronizar el pago.",
    });
  }
});

const mercadoPagoWebhook = onRequest({ invoker: "public" }, async (req, res) => {
  if (handlePreflight(req, res)) {
    return;
  }

  applyCors(res);

  if (req.method !== "POST") {
    res.status(200).json({ received: true });
    return;
  }

  try {
    const signatureValidation = validateWebhookSignature(req);

    if (signatureValidation.error) {
      logger.error("Firma invalida en webhook de Mercado Pago", {
        error: signatureValidation.error,
      });
      res.status(401).json({
        error: signatureValidation.error,
      });
      return;
    }

    const topic = resolveWebhookTopic(req);
    const paymentId = resolveWebhookPaymentId(req);

    if (topic && topic !== "payment") {
      res.status(200).json({ received: true, ignored: true, topic });
      return;
    }

    if (!paymentId) {
      res.status(200).json({ received: true, ignored: true, reason: "missing_payment_id" });
      return;
    }

    let payment = null;

    try {
      payment = await mercadoPagoRequest(`/v1/payments/${paymentId}`, {
        method: "GET",
      });
    } catch (error) {
      if (isWebhookSimulation(req)) {
        logger.info("Webhook de simulacion recibido correctamente", {
          paymentId,
          topic,
        });
        res.status(200).json({
          received: true,
          simulated: true,
          paymentId,
        });
        return;
      }

      throw error;
    }

    const updateResult = await updateReservationPaymentFromMercadoPagoPayment(payment);

    if (!updateResult.reservationId) {
      res.status(200).json({ received: true, ignored: true, reason: "missing_external_reference" });
      return;
    }

    res.status(200).json({ received: true, reservationId: updateResult.reservationId });
  } catch (error) {
    logger.error("Fallo el webhook de Mercado Pago", error);
    res.status(500).json({
      error: error?.message || "No pudimos procesar la notificacion.",
    });
  }
});

module.exports = {
  mercadoPagoCreateTurnoPreference,
  mercadoPagoSyncTurnoPayment,
  mercadoPagoWebhook,
};
