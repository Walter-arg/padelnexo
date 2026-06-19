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

function buildLeagueItemTitle(payload = {}) {
  const targets = Array.isArray(payload.targets)
    ? payload.targets.filter((target) => target && typeof target === "object")
    : [];
  const leagueName = String(payload.leagueName || "Liga").trim();
  const roundTitle =
    targets.length > 1
      ? `${targets.length} fechas`
      : String(payload.roundTitle || "Fecha").trim();
  const participantLabel = String(payload.participantLabel || "Jugador").trim();

  return [leagueName, roundTitle, participantLabel].filter(Boolean).join(" - ");
}

function buildTournamentItemTitle(payload = {}) {
  const tournamentName = String(payload.tournamentName || "Torneo").trim();
  const registrationLabel = String(payload.registrationLabel || "Inscripcion").trim();
  const playerLabel = String(payload.playerLabel || "Jugador").trim();

  return [tournamentName, registrationLabel, playerLabel].filter(Boolean).join(" - ");
}

function buildLeagueExternalReference(payload = {}) {
  const leagueId = String(payload.leagueId || "").trim() || "league";
  const targets = Array.isArray(payload.targets)
    ? payload.targets.filter((target) => target && typeof target === "object")
    : [];

  if (targets.length > 1) {
    return `league-batch__${leagueId}__${targets.length}__${Date.now()}`;
  }

  const roundId = String(payload.roundId || "").trim() || "round";
  const targetId =
    String(payload.pairId || "").trim() ||
    String(payload.participantId || "").trim() ||
    "participant";

  return `league-payment__${leagueId}__${roundId}__${targetId}__${Date.now()}`;
}

function buildTournamentExternalReference(payload = {}) {
  const tournamentId = String(payload.tournamentId || "").trim() || "tournament";
  const registrationId = String(payload.registrationId || "").trim() || "registration";
  const playerId = String(payload.playerId || "").trim() || "player";

  return `tournament-payment__${tournamentId}__${registrationId}__${playerId}__${Date.now()}`;
}

function parseLeagueExternalReference(value = "") {
  const normalized = String(value || "").trim();

  if (normalized.startsWith("league-batch__")) {
    const parts = normalized.split("__");

    return {
      batchCount: Number(parts[2] || 0) || 0,
      externalReference: normalized,
      isBatch: true,
      leagueId: String(parts[1] || "").trim(),
      participantId: "",
      roundId: "",
    };
  }

  if (!normalized.startsWith("league-payment__")) {
    return {
      batchCount: 0,
      externalReference: normalized,
      isBatch: false,
      leagueId: "",
      participantId: "",
      roundId: "",
    };
  }

  const parts = normalized.split("__");

  return {
    batchCount: 0,
    externalReference: normalized,
    isBatch: false,
    leagueId: String(parts[1] || "").trim(),
    roundId: String(parts[2] || "").trim(),
    participantId: String(parts[3] || "").trim(),
  };
}

function parseTournamentExternalReference(value = "") {
  const normalized = String(value || "").trim();

  if (!normalized.startsWith("tournament-payment__")) {
    return {
      externalReference: normalized,
      playerId: "",
      registrationId: "",
      tournamentId: "",
    };
  }

  const parts = normalized.split("__");

  return {
    externalReference: normalized,
    tournamentId: String(parts[1] || "").trim(),
    registrationId: String(parts[2] || "").trim(),
    playerId: String(parts[3] || "").trim(),
  };
}

function normalizeLeagueCheckoutTargets(payload = {}) {
  const rawTargets = Array.isArray(payload.targets) ? payload.targets : [];

  if (rawTargets.length) {
    return rawTargets
      .map((target) => ({
        pairId: String(target?.pairId || "").trim(),
        participantId: String(target?.participantId || "").trim(),
        participantLabel: String(target?.participantLabel || "").trim(),
        roundId: String(target?.roundId || "").trim(),
        roundTitle: String(target?.roundTitle || "").trim(),
      }))
      .filter((target) => target.roundId && target.participantId);
  }

  const participantId = String(payload.participantId || "").trim();
  const roundId = String(payload.roundId || "").trim();

  if (!participantId || !roundId) {
    return [];
  }

  return [
    {
      pairId: String(payload.pairId || "").trim(),
      participantId,
      participantLabel: String(payload.participantLabel || "").trim(),
      roundId,
      roundTitle: String(payload.roundTitle || "").trim(),
    },
  ];
}

function normalizeLeagueSyncTargets(payload = {}) {
  const rawTargets = Array.isArray(payload.batchTargets)
    ? payload.batchTargets
    : Array.isArray(payload.targets)
      ? payload.targets
      : [];

  return rawTargets
    .map((target) => ({
      pairId: String(target?.pairId || "").trim(),
      participantId: String(target?.participantId || "").trim(),
      roundId: String(target?.roundId || "").trim(),
    }))
    .filter((target) => target.roundId && (target.participantId || target.pairId));
}

function getTournamentRegistrationStatusFromPayments(tournament = {}, payments = []) {
  const approvedCount = payments.filter((payment) => payment?.status === "approved").length;
  const inReviewCount = payments.filter((payment) => payment?.status === "in_review").length;
  const rejectedCount = payments.filter((payment) => payment?.status === "rejected").length;
  const requiresPayment = normalizeMoney(tournament?.entryFee) > 0;
  const confirmationMode = String(tournament?.pairConfirmationMode || "both_paid").trim().toLowerCase();

  if (!requiresPayment) {
    return confirmationMode === "manual" ? "pending" : "confirmed";
  }

  if (confirmationMode === "manual") {
    if (rejectedCount > 0) {
      return "rejected";
    }

    return inReviewCount > 0 ? "in_review" : "pending";
  }

  if (confirmationMode === "one_paid" && approvedCount >= 1) {
    return "confirmed";
  }

  if (confirmationMode === "both_paid" && approvedCount >= payments.length) {
    return "confirmed";
  }

  if (rejectedCount > 0) {
    return "rejected";
  }

  return inReviewCount > 0 ? "in_review" : "pending";
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

function mapMercadoPagoStatusToLeaguePaymentStatus(status = "") {
  const normalized = String(status || "").trim().toLowerCase();

  if (normalized === "approved") {
    return "pagado";
  }

  if (["pending", "in_process", "authorized"].includes(normalized)) {
    return "in_review";
  }

  if (["rejected", "cancelled", "refunded", "charged_back"].includes(normalized)) {
    return "pendiente";
  }

  return "in_review";
}

function patchLeagueRoundPayments(roundPayments = [], identifiers = {}, patch = {}) {
  const roundId = String(identifiers.roundId || "").trim();
  const participantId = String(identifiers.participantId || "").trim();
  const pairId = String(identifiers.pairId || "").trim();
  let updated = false;

  const nextRoundPayments = (Array.isArray(roundPayments) ? roundPayments : []).map((round) => {
    if (String(round?.roundId || "").trim() !== roundId) {
      return round;
    }

    return {
      ...round,
      entries: (Array.isArray(round?.entries) ? round.entries : []).map((entry) => {
        const entryParticipantId = String(entry?.participantId || "").trim();
        const entryPairId = String(entry?.pairId || "").trim();
        const entryPlayerIds = Array.isArray(entry?.playerIds)
          ? entry.playerIds.map((value) => String(value || "").trim()).filter(Boolean)
          : [];
        const matchesParticipant =
          (participantId && entryParticipantId === participantId) ||
          (participantId && entryPairId === participantId) ||
          (participantId && entryPlayerIds.includes(participantId)) ||
          (pairId && entryPairId === pairId);

        if (!matchesParticipant) {
          return entry;
        }

        updated = true;
        return {
          ...entry,
          ...patch,
          updatedAtMillis: Date.now(),
        };
      }),
    };
  });

  return { updated, roundPayments: nextRoundPayments };
}

async function updateLeaguePaymentFromMercadoPagoPayment(payment = {}, fallbackContext = {}) {
  const metadata = payment?.metadata && typeof payment.metadata === "object" ? payment.metadata : {};
  const parsedExternalReference = parseLeagueExternalReference(
    payment?.external_reference || metadata.externalReference || ""
  );
  const fallbackTargets = normalizeLeagueSyncTargets(fallbackContext);
  const metadataTargets = Array.isArray(metadata.targets)
    ? metadata.targets
        .map((target) => ({
          pairId: String(target?.pairId || "").trim(),
          participantId: String(target?.participantId || "").trim(),
          roundId: String(target?.roundId || "").trim(),
        }))
        .filter((target) => target.roundId && (target.participantId || target.pairId))
    : [];
  const fallbackTarget = {
    pairId: String(metadata.pairId || fallbackContext.pairId || "").trim(),
    participantId: String(
      metadata.participantId ||
        fallbackContext.participantId ||
        parsedExternalReference.participantId ||
        ""
    ).trim(),
    roundId: String(
      metadata.roundId || fallbackContext.roundId || parsedExternalReference.roundId || ""
    ).trim(),
  };
  const targets = metadataTargets.length
    ? metadataTargets
    : fallbackTargets.length
      ? fallbackTargets
    : fallbackTarget.roundId && (fallbackTarget.participantId || fallbackTarget.pairId)
      ? [fallbackTarget]
      : [];
  const leagueId = String(
    metadata.leagueId || fallbackContext.leagueId || parsedExternalReference.leagueId || ""
  ).trim();

  if (!leagueId || !targets.length) {
    return {
      leagueId,
      participantId: fallbackTarget.participantId,
      reason: "missing_league_identifiers",
      roundId: fallbackTarget.roundId,
      updated: false,
    };
  }

  const leagueRef = getDb().collection("leagues").doc(leagueId);
  const leagueSnapshot = await leagueRef.get();

  if (!leagueSnapshot.exists) {
    return {
      leagueId,
      participantId: fallbackTarget.participantId,
      reason: "league_not_found",
      roundId: fallbackTarget.roundId,
      updated: false,
    };
  }

  const leagueData = leagueSnapshot.data() || {};
  const currentRoundPayments = Array.isArray(leagueData.roundPayments) ? leagueData.roundPayments : [];
  const paymentStatus = mapMercadoPagoStatusToLeaguePaymentStatus(payment.status);
  const paymentMethod = ["approved", "pending", "in_process", "authorized"].includes(
    String(payment.status || "").trim().toLowerCase()
  )
    ? "mercado_pago"
    : "";
  const confirmedAtMillis =
    String(payment.status || "").trim().toLowerCase() === "approved" ? Date.now() : 0;

  let nextRoundPayments = currentRoundPayments;
  let updatedCount = 0;
  const paymentPatch = {
    confirmedAtMillis,
    confirmedBy: confirmedAtMillis ? "mercado_pago" : "",
    confirmedByName: confirmedAtMillis ? "Mercado Pago" : "",
    mercadoPagoCheckoutUrl: "",
    mercadoPagoLiveMode: payment.live_mode === true,
    mercadoPagoPaymentId: String(payment.id || "").trim(),
    mercadoPagoPreferenceId: String(
      payment.order?.id || metadata.preferenceId || payment.preference_id || ""
    ).trim(),
    mercadoPagoStatus: String(payment.status || "").trim(),
    mercadoPagoStatusDetail: String(payment.status_detail || "").trim(),
    paymentGateway: "mercado_pago",
    paymentMethod,
    paymentStatus,
    proofFileName: "",
    proofUploadedAtMillis: 0,
    proofUploadedBy: "",
    proofUploadedByName: "",
    proofUrl: "",
    rejectedAtMillis: paymentStatus === "pendiente" ? Date.now() : 0,
    rejectedBy: paymentStatus === "pendiente" ? "mercado_pago" : "",
    rejectedByName: paymentStatus === "pendiente" ? "Mercado Pago" : "",
  };

  targets.forEach((target) => {
    const patchResult = patchLeagueRoundPayments(
      nextRoundPayments,
      {
        participantId: target.participantId,
        pairId: target.pairId,
        roundId: target.roundId,
      },
      paymentPatch
    );

    if (patchResult.updated) {
      updatedCount += 1;
      nextRoundPayments = patchResult.roundPayments;
    }
  });

  if (!updatedCount) {
    return {
      leagueId,
      participantId: fallbackTarget.participantId,
      reason: "entry_not_found",
      roundId: fallbackTarget.roundId,
      updated: false,
    };
  }

  await leagueRef.set(
    {
      roundPayments: nextRoundPayments,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return {
    leagueId,
    participantId: fallbackTarget.participantId,
    roundId: fallbackTarget.roundId,
    updatedCount,
    updated: true,
  };
}

function mapMercadoPagoStatusToTournamentPaymentStatus(status = "") {
  const normalized = String(status || "").trim().toLowerCase();

  if (normalized === "approved") {
    return "approved";
  }

  if (["pending", "in_process", "authorized"].includes(normalized)) {
    return "in_review";
  }

  if (["rejected", "cancelled", "refunded", "charged_back"].includes(normalized)) {
    return "pending";
  }

  return "in_review";
}

async function updateTournamentPaymentFromMercadoPagoPayment(payment = {}, fallbackContext = {}) {
  const metadata = payment?.metadata && typeof payment.metadata === "object" ? payment.metadata : {};
  const parsedExternalReference = parseTournamentExternalReference(
    payment?.external_reference || metadata.externalReference || ""
  );
  const tournamentId = String(
    metadata.tournamentId || fallbackContext.tournamentId || parsedExternalReference.tournamentId || ""
  ).trim();
  const registrationId = String(
    metadata.registrationId ||
      fallbackContext.registrationId ||
      parsedExternalReference.registrationId ||
      ""
  ).trim();
  const playerId = String(
    metadata.playerId || fallbackContext.playerId || parsedExternalReference.playerId || ""
  ).trim();

  if (!tournamentId || !registrationId || !playerId) {
    return {
      playerId,
      reason: "missing_tournament_identifiers",
      registrationId,
      tournamentId,
      updated: false,
    };
  }

  const tournamentRef = getDb().collection("tournaments").doc(tournamentId);
  const registrationRef = tournamentRef.collection("registrations").doc(registrationId);
  const [tournamentSnapshot, registrationSnapshot] = await Promise.all([
    tournamentRef.get(),
    registrationRef.get(),
  ]);

  if (!tournamentSnapshot.exists) {
    return {
      playerId,
      reason: "tournament_not_found",
      registrationId,
      tournamentId,
      updated: false,
    };
  }

  if (!registrationSnapshot.exists) {
    return {
      playerId,
      reason: "registration_not_found",
      registrationId,
      tournamentId,
      updated: false,
    };
  }

  const tournamentData = tournamentSnapshot.data() || {};
  const registrationData = registrationSnapshot.data() || {};
  const currentPayments = Array.isArray(registrationData.payments) ? registrationData.payments : [];
  const paymentStatus = mapMercadoPagoStatusToTournamentPaymentStatus(payment.status);
  const paymentMethod = ["approved", "pending", "in_process", "authorized"].includes(
    String(payment.status || "").trim().toLowerCase()
  )
    ? "mercado_pago"
    : "";
  const reviewedAt = Date.now();
  let updated = false;

  const nextPayments = currentPayments.map((entry) => {
    const entryPlayerId = String(entry?.playerId || entry?.userId || "").trim();

    if (entryPlayerId !== playerId) {
      return entry;
    }

    updated = true;

    return {
      ...entry,
      method: paymentMethod,
      receiptPath: "",
      receiptFileName: "",
      receiptUrl: "",
      reviewedAt,
      reviewedBy: "mercado_pago",
      reviewedByName: "Mercado Pago",
      status: paymentStatus,
      uploadedAt: null,
      mercadoPagoCheckoutUrl: "",
      mercadoPagoLiveMode: payment.live_mode === true,
      mercadoPagoPaymentId: String(payment.id || "").trim(),
      mercadoPagoPreferenceId: String(
        payment.order?.id || metadata.preferenceId || payment.preference_id || ""
      ).trim(),
      mercadoPagoStatus: String(payment.status || "").trim(),
      mercadoPagoStatusDetail: String(payment.status_detail || "").trim(),
      paymentGateway: "mercado_pago",
    };
  });

  if (!updated) {
    return {
      playerId,
      reason: "payment_entry_not_found",
      registrationId,
      tournamentId,
      updated: false,
    };
  }

  const registrationStatus = getTournamentRegistrationStatusFromPayments(
    tournamentData,
    nextPayments
  );

  await registrationRef.set(
    {
      payments: nextPayments,
      status: registrationStatus,
      confirmedAt:
        registrationStatus === "confirmed"
          ? admin.firestore.FieldValue.serverTimestamp()
          : registrationData.confirmedAt || null,
      rejectedAt:
        registrationStatus === "rejected"
          ? admin.firestore.FieldValue.serverTimestamp()
          : null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return {
    playerId,
    registrationId,
    tournamentId,
    updated: true,
  };
}

const mercadoPagoCreateLeaguePreference = onRequest({ invoker: "public" }, async (req, res) => {
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
    const leagueId = String(payload.leagueId || "").trim();
    const checkoutTargets = normalizeLeagueCheckoutTargets(payload);
    const primaryTarget = checkoutTargets[0] || {};
    const roundId = String(primaryTarget.roundId || payload.roundId || "").trim();
    const participantId = String(primaryTarget.participantId || payload.participantId || "").trim();
    const amount = normalizeMoney(payload.amount);
    const externalReference = buildLeagueExternalReference(payload);

    if (!leagueId || !checkoutTargets.length) {
      res.status(400).json({ error: "leagueId and at least one payment target are required" });
      return;
    }

    if (!amount) {
      res.status(400).json({ error: "amount must be greater than 0" });
      return;
    }

    const preferenceBody = {
      items: [
        {
          title: buildLeagueItemTitle(payload),
          quantity: 1,
          unit_price: amount,
          currency_id: "ARS",
        },
      ],
      external_reference: externalReference,
      metadata: {
        leagueId,
        leagueName: String(payload.leagueName || "").trim(),
        organizerId: String(payload.organizerId || "").trim(),
        organizerName: String(payload.organizerName || "").trim(),
        participantId,
        participantLabel: String(payload.participantLabel || "").trim(),
        pairId: String(payload.pairId || "").trim(),
        preferenceId: "",
        targets: checkoutTargets,
        roundId,
        roundTitle: String(payload.roundTitle || "").trim(),
        source: "padelnexo_ligas",
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

    logger.info("Creando preferencia de Checkout Pro para liga", {
      amount,
      externalReference,
      batchCount: checkoutTargets.length,
      leagueId,
      participantId,
      roundId,
      title: preferenceBody.items?.[0]?.title || "",
    });

    const preference = await getMercadoPagoPreferenceClient().create({
      body: preferenceBody,
    });

    logger.info("Preferencia creada correctamente para liga", {
      leagueId,
      participantId,
      preferenceId: String(preference.id || "").trim(),
      roundId,
    });
    logger.info("URL de Checkout Pro generada correctamente para liga", {
      hasInitPoint: Boolean(String(preference.init_point || "").trim()),
      hasSandboxInitPoint: Boolean(String(preference.sandbox_init_point || "").trim()),
      leagueId,
      participantId,
      roundId,
    });

    res.status(200).json({
      id: preference.id,
      externalReference,
      batchCount: checkoutTargets.length,
      initPoint: preference.init_point || "",
      leagueId,
      participantId,
      preferenceId: preference.id || "",
      roundId,
      sandboxInitPoint: preference.sandbox_init_point || "",
    });
  } catch (error) {
    logger.error("No pudimos crear la preferencia de Mercado Pago para la liga", error);
    res.status(500).json({
      error: error?.message || "No pudimos crear el cobro de Mercado Pago para la liga.",
    });
  }
});

const mercadoPagoCreateTournamentPreference = onRequest({ invoker: "public" }, async (req, res) => {
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
    const tournamentId = String(payload.tournamentId || "").trim();
    const registrationId = String(payload.registrationId || "").trim();
    const playerId = String(payload.playerId || "").trim();
    const amount = normalizeMoney(payload.amount);
    const externalReference = buildTournamentExternalReference(payload);

    if (!tournamentId || !registrationId || !playerId) {
      res.status(400).json({
        error: "tournamentId, registrationId and playerId are required",
      });
      return;
    }

    if (!amount) {
      res.status(400).json({ error: "amount must be greater than 0" });
      return;
    }

    const preferenceBody = {
      items: [
        {
          title: buildTournamentItemTitle(payload),
          quantity: 1,
          unit_price: amount,
          currency_id: "ARS",
        },
      ],
      external_reference: externalReference,
      metadata: {
        tournamentId,
        tournamentName: String(payload.tournamentName || "").trim(),
        organizerId: String(payload.organizerId || "").trim(),
        organizerName: String(payload.organizerName || "").trim(),
        registrationId,
        registrationLabel: String(payload.registrationLabel || "").trim(),
        playerId,
        playerLabel: String(payload.playerLabel || "").trim(),
        preferenceId: "",
        source: "padelnexo_torneos",
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

    logger.info("Creando preferencia de Checkout Pro para torneo", {
      amount,
      externalReference,
      playerId,
      registrationId,
      title: preferenceBody.items?.[0]?.title || "",
      tournamentId,
    });

    const preference = await getMercadoPagoPreferenceClient().create({
      body: preferenceBody,
    });

    logger.info("Preferencia creada correctamente para torneo", {
      playerId,
      preferenceId: String(preference.id || "").trim(),
      registrationId,
      tournamentId,
    });
    logger.info("URL de Checkout Pro generada correctamente para torneo", {
      hasInitPoint: Boolean(String(preference.init_point || "").trim()),
      hasSandboxInitPoint: Boolean(String(preference.sandbox_init_point || "").trim()),
      playerId,
      registrationId,
      tournamentId,
    });

    res.status(200).json({
      id: preference.id,
      externalReference,
      initPoint: preference.init_point || "",
      sandboxInitPoint: preference.sandbox_init_point || "",
      preferenceId: preference.id || "",
    });
  } catch (error) {
    logger.error("No pudimos crear la preferencia de Mercado Pago para torneo", error);
    res.status(500).json({
      error: error?.message || "No pudimos crear el cobro de Mercado Pago del torneo.",
    });
  }
});

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

    const source = String(payment?.metadata?.source || "").trim().toLowerCase();

    if (source === "padelnexo_ligas") {
      const updateResult = await updateLeaguePaymentFromMercadoPagoPayment(payment);

      if (!updateResult.updated) {
        res.status(200).json({
          received: true,
          ignored: true,
          reason: updateResult.reason || "league_payment_not_updated",
        });
        return;
      }

      res.status(200).json({
        leagueId: updateResult.leagueId,
        participantId: updateResult.participantId,
        received: true,
        roundId: updateResult.roundId,
      });
      return;
    }

    if (source === "padelnexo_torneos") {
      const updateResult = await updateTournamentPaymentFromMercadoPagoPayment(payment);

      if (!updateResult.updated) {
        res.status(200).json({
          received: true,
          ignored: true,
          reason: updateResult.reason || "tournament_payment_not_updated",
        });
        return;
      }

      res.status(200).json({
        playerId: updateResult.playerId,
        received: true,
        registrationId: updateResult.registrationId,
        tournamentId: updateResult.tournamentId,
      });
      return;
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

const mercadoPagoSyncLeaguePayment = onRequest({ invoker: "public" }, async (req, res) => {
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
    const externalReference = String(payload.externalReference || "").trim();
    const parsedPayloadExternalReference = parseLeagueExternalReference(externalReference);
    const syncTargets = normalizeLeagueSyncTargets(payload);
    const leagueId = String(payload.leagueId || "").trim();
    const pairId = String(payload.pairId || "").trim();
    const roundId = String(payload.roundId || "").trim();
    const participantId = String(payload.participantId || "").trim();

    logger.info("Iniciando sync de pago de liga", {
      batchTargets: syncTargets.length,
      externalReference,
      hasPaymentId: Boolean(paymentId),
      leagueId: leagueId || parsedPayloadExternalReference.leagueId,
      pairId,
      participantId: participantId || parsedPayloadExternalReference.participantId,
      roundId: roundId || parsedPayloadExternalReference.roundId,
    });

    const resolvedLeagueId = leagueId || parsedPayloadExternalReference.leagueId;
    const resolvedRoundId = roundId || parsedPayloadExternalReference.roundId;
    const resolvedParticipantId = participantId || parsedPayloadExternalReference.participantId;

    if (
      !paymentId &&
      !externalReference &&
      (!resolvedLeagueId || !resolvedRoundId || (!resolvedParticipantId && !pairId))
    ) {
      res.status(400).json({
        error: "paymentId, externalReference or (leagueId, roundId and participantId/pairId) is required",
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
          externalReference || leagueId
        )}&sort=date_created&criteria=desc&limit=20`,
        {
          method: "GET",
        }
      );

      payment =
        (Array.isArray(searchResult.results) ? searchResult.results : []).find((candidate) => {
          const metadata =
            candidate?.metadata && typeof candidate.metadata === "object" ? candidate.metadata : {};
          const parsedCandidateReference = parseLeagueExternalReference(
            candidate?.external_reference || metadata.externalReference || ""
          );
          const candidateExternalReference = String(
            candidate?.external_reference || parsedCandidateReference.externalReference || ""
          ).trim();
          const candidateRoundId = String(
            metadata.roundId || parsedCandidateReference.roundId || ""
          ).trim();
          const candidateParticipantId = String(
            metadata.participantId || parsedCandidateReference.participantId || ""
          ).trim();
          const candidateTargets = Array.isArray(metadata.targets)
            ? metadata.targets
                .map((target) => ({
                  pairId: String(target?.pairId || "").trim(),
                  participantId: String(target?.participantId || "").trim(),
                  roundId: String(target?.roundId || "").trim(),
                }))
                .filter((target) => target.roundId && (target.participantId || target.pairId))
            : [];

          if (externalReference && candidateExternalReference === externalReference) {
            return true;
          }

          if (candidateTargets.length) {
            return candidateTargets.some(
              (target) =>
                target.roundId === resolvedRoundId &&
                ((resolvedParticipantId && target.participantId === resolvedParticipantId) ||
                  (pairId && target.pairId === pairId))
            );
          }

          return (
            candidateRoundId === resolvedRoundId &&
            (
              (resolvedParticipantId && candidateParticipantId === resolvedParticipantId) ||
              (pairId && String(metadata.pairId || "").trim() === pairId)
            )
          );
        }) || null;
    }

    if (!payment) {
      logger.warn("No se encontro el pago de liga en Mercado Pago", {
        externalReference,
        leagueId: resolvedLeagueId,
        pairId,
        participantId: resolvedParticipantId,
        roundId: resolvedRoundId,
        searchedBy: paymentId ? "payment_id" : "search",
        paymentId,
      });
      res.status(404).json({
        debug: {
          externalReference,
          leagueId: resolvedLeagueId,
          pairId,
          participantId: resolvedParticipantId,
          paymentId,
          roundId: resolvedRoundId,
          searchedBy: paymentId ? "payment_id" : "search",
        },
        error: "payment_not_found",
      });
      return;
    }

    logger.info("Pago de liga encontrado en Mercado Pago", {
      externalReference,
      mercadoPagoPaymentId: String(payment.id || "").trim(),
      metadata: payment?.metadata || {},
      status: String(payment.status || "").trim(),
    });

    const updateResult = await updateLeaguePaymentFromMercadoPagoPayment(payment, {
      batchTargets: syncTargets,
      leagueId: resolvedLeagueId,
      pairId,
      participantId: resolvedParticipantId,
      roundId: resolvedRoundId,
    });

    if (!updateResult.updated) {
      logger.warn("No se pudo aplicar el pago sobre la liga", {
        externalReference,
        leagueId,
        pairId,
        participantId,
        reason: updateResult.reason || "league_payment_not_found",
        roundId,
      });
      res.status(404).json({
        debug: {
          externalReference,
          leagueId,
          pairId,
          participantId,
          reason: updateResult.reason || "league_payment_not_found",
          roundId,
        },
        error: updateResult.reason || "league_payment_not_found",
      });
      return;
    }

    logger.info("Pago de liga sincronizado correctamente desde retorno de Checkout Pro", {
      leagueId: updateResult.leagueId,
      mercadoPagoPaymentId: String(payment.id || "").trim(),
      participantId: updateResult.participantId,
      roundId: updateResult.roundId,
      status: String(payment.status || "").trim(),
    });

    res.status(200).json({
      externalReference,
      leagueId: updateResult.leagueId,
      mercadoPagoPaymentId: String(payment.id || "").trim(),
      mercadoPagoStatus: String(payment.status || "").trim(),
      participantId: updateResult.participantId,
      paymentStatus: mapMercadoPagoStatusToLeaguePaymentStatus(payment.status),
      roundId: updateResult.roundId,
      updated: true,
    });
  } catch (error) {
    logger.error("No pudimos sincronizar el pago de liga en Mercado Pago", error);
    res.status(500).json({
      error: error?.message || "No pudimos sincronizar el pago de la liga.",
    });
  }
});

const mercadoPagoSyncTournamentPayment = onRequest({ invoker: "public" }, async (req, res) => {
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
    const externalReference = String(payload.externalReference || "").trim();
    const parsedPayloadExternalReference = parseTournamentExternalReference(externalReference);
    const tournamentId = String(payload.tournamentId || "").trim();
    const registrationId = String(payload.registrationId || "").trim();
    const playerId = String(payload.playerId || "").trim();

    logger.info("Iniciando sync de pago de torneo", {
      externalReference,
      hasPaymentId: Boolean(paymentId),
      playerId: playerId || parsedPayloadExternalReference.playerId,
      registrationId: registrationId || parsedPayloadExternalReference.registrationId,
      tournamentId: tournamentId || parsedPayloadExternalReference.tournamentId,
    });

    const resolvedTournamentId = tournamentId || parsedPayloadExternalReference.tournamentId;
    const resolvedRegistrationId =
      registrationId || parsedPayloadExternalReference.registrationId;
    const resolvedPlayerId = playerId || parsedPayloadExternalReference.playerId;

    if (!paymentId && !externalReference && (!resolvedTournamentId || !resolvedRegistrationId || !resolvedPlayerId)) {
      res.status(400).json({
        error: "paymentId, externalReference or (tournamentId, registrationId and playerId) is required",
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
          externalReference || resolvedTournamentId
        )}&sort=date_created&criteria=desc&limit=20`,
        {
          method: "GET",
        }
      );

      payment =
        (Array.isArray(searchResult.results) ? searchResult.results : []).find((candidate) => {
          const metadata =
            candidate?.metadata && typeof candidate.metadata === "object" ? candidate.metadata : {};
          const parsedCandidateReference = parseTournamentExternalReference(
            candidate?.external_reference || metadata.externalReference || ""
          );
          const candidateExternalReference = String(
            candidate?.external_reference || parsedCandidateReference.externalReference || ""
          ).trim();
          const candidateRegistrationId = String(
            metadata.registrationId || parsedCandidateReference.registrationId || ""
          ).trim();
          const candidatePlayerId = String(
            metadata.playerId || parsedCandidateReference.playerId || ""
          ).trim();

          if (externalReference && candidateExternalReference === externalReference) {
            return true;
          }

          return (
            candidateRegistrationId === resolvedRegistrationId &&
            candidatePlayerId === resolvedPlayerId
          );
        }) || null;
    }

    if (!payment) {
      logger.warn("No se encontro el pago de torneo en Mercado Pago", {
        externalReference,
        playerId: resolvedPlayerId,
        registrationId: resolvedRegistrationId,
        searchedBy: paymentId ? "payment_id" : "search",
        paymentId,
        tournamentId: resolvedTournamentId,
      });
      res.status(404).json({
        debug: {
          externalReference,
          playerId: resolvedPlayerId,
          paymentId,
          registrationId: resolvedRegistrationId,
          searchedBy: paymentId ? "payment_id" : "search",
          tournamentId: resolvedTournamentId,
        },
        error: "payment_not_found",
      });
      return;
    }

    logger.info("Pago de torneo encontrado en Mercado Pago", {
      externalReference,
      mercadoPagoPaymentId: String(payment.id || "").trim(),
      metadata: payment?.metadata || {},
      status: String(payment.status || "").trim(),
    });

    const updateResult = await updateTournamentPaymentFromMercadoPagoPayment(payment, {
      playerId: resolvedPlayerId,
      registrationId: resolvedRegistrationId,
      tournamentId: resolvedTournamentId,
    });

    if (!updateResult.updated) {
      logger.warn("No se pudo aplicar el pago sobre el torneo", {
        externalReference,
        playerId: resolvedPlayerId,
        reason: updateResult.reason || "tournament_payment_not_found",
        registrationId: resolvedRegistrationId,
        tournamentId: resolvedTournamentId,
      });
      res.status(404).json({
        debug: {
          externalReference,
          playerId: resolvedPlayerId,
          reason: updateResult.reason || "tournament_payment_not_found",
          registrationId: resolvedRegistrationId,
          tournamentId: resolvedTournamentId,
        },
        error: updateResult.reason || "tournament_payment_not_found",
      });
      return;
    }

    logger.info("Pago de torneo sincronizado correctamente desde retorno de Checkout Pro", {
      mercadoPagoPaymentId: String(payment.id || "").trim(),
      playerId: updateResult.playerId,
      registrationId: updateResult.registrationId,
      status: String(payment.status || "").trim(),
      tournamentId: updateResult.tournamentId,
    });

    res.status(200).json({
      externalReference,
      mercadoPagoPaymentId: String(payment.id || "").trim(),
      mercadoPagoStatus: String(payment.status || "").trim(),
      paymentStatus: mapMercadoPagoStatusToTournamentPaymentStatus(payment.status),
      playerId: updateResult.playerId,
      registrationId: updateResult.registrationId,
      tournamentId: updateResult.tournamentId,
      updated: true,
    });
  } catch (error) {
    logger.error("No pudimos sincronizar el pago de torneo en Mercado Pago", error);
    res.status(500).json({
      error: error?.message || "No pudimos sincronizar el pago del torneo.",
    });
  }
});

module.exports = {
  mercadoPagoCreateLeaguePreference,
  mercadoPagoCreateTournamentPreference,
  mercadoPagoCreateTurnoPreference,
  mercadoPagoSyncLeaguePayment,
  mercadoPagoSyncTournamentPayment,
  mercadoPagoSyncTurnoPayment,
  mercadoPagoWebhook,
};
