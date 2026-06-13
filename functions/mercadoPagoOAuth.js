const { onRequest } = require("firebase-functions/v2/https");

const {
  MERCADO_PAGO_ACCOUNTS_COLLECTION,
  OAUTH_SESSIONS_COLLECTION,
  admin,
  applyCors,
  createRandomId,
  findOauthSessionByState,
  getDb,
  getEnv,
  getMercadoPagoOAuthClient,
  getOptionalEnv,
  handlePreflight,
  logger,
  readOrganizerMercadoPagoConfig,
} = require("./mercadoPagoShared");

function isOAuthConfigured() {
  return Boolean(
    getOptionalEnv("MERCADO_PAGO_CLIENT_ID") &&
      getOptionalEnv("MERCADO_PAGO_CLIENT_SECRET") &&
      getOptionalEnv("MERCADO_PAGO_OAUTH_REDIRECT_URL")
  );
}

function sendOAuthNotConfigured(res) {
  res.status(501).json({
    error: "mercado_pago_oauth_not_configured",
    message:
      "OAuth de Mercado Pago todavia no esta configurado. Checkout Pro sigue funcionando sin Client ID ni Client Secret.",
  });
}

const mercadoPagoOAuthStart = onRequest({ invoker: "public" }, async (req, res) => {
  if (handlePreflight(req, res)) {
    return;
  }

  applyCors(res);

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!isOAuthConfigured()) {
    sendOAuthNotConfigured(res);
    return;
  }

  try {
    const organizerId = String(req.query.organizerId || "").trim();
    const nativeRedirectUri = String(req.query.redirectUri || "").trim();
    const platform = String(req.query.platform || "").trim();

    if (!organizerId) {
      res.status(400).json({ error: "organizerId is required" });
      return;
    }

    if (!nativeRedirectUri) {
      res.status(400).json({ error: "redirectUri is required" });
      return;
    }

    const clientId = getEnv("MERCADO_PAGO_CLIENT_ID");
    const oauthRedirectUri = getEnv("MERCADO_PAGO_OAUTH_REDIRECT_URL");
    const sessionId = createRandomId();
    const state = createRandomId();

    await getDb().collection(OAUTH_SESSIONS_COLLECTION).doc(sessionId).set({
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      nativeRedirectUri,
      organizerId,
      oauthRedirectUri,
      platform,
      state,
      status: "pending",
    });

    const authUrl = getMercadoPagoOAuthClient().getAuthorizationURL({
      options: {
        client_id: clientId,
        redirect_uri: oauthRedirectUri,
        state,
      },
    });

    res.status(200).json({
      authUrl,
      sessionId,
    });
  } catch (error) {
    logger.error("No pudimos iniciar OAuth de Mercado Pago", error);
    res.status(500).json({
      error: error?.message || "No pudimos iniciar la vinculacion de Mercado Pago.",
    });
  }
});

const mercadoPagoOAuthRedirect = onRequest({ invoker: "public" }, async (req, res) => {
  if (!isOAuthConfigured()) {
    res.status(501).send("OAuth de Mercado Pago no esta configurado.");
    return;
  }

  const state = String(req.query.state || "").trim();
  const code = String(req.query.code || "").trim();
  const error = String(req.query.error || "").trim();

  try {
    if (!state) {
      res.status(400).send("Falta el estado de autorizacion.");
      return;
    }

    const session = await findOauthSessionByState(state);

    if (!session) {
      res.status(404).send("No encontramos la sesion de vinculacion.");
      return;
    }

    const nativeRedirectUri = String(session.data.nativeRedirectUri || "").trim();

    if (!nativeRedirectUri) {
      res.status(400).send("La sesion no tiene una redireccion nativa configurada.");
      return;
    }

    const target = new URL(nativeRedirectUri);

    if (code) {
      target.searchParams.set("code", code);
    }

    target.searchParams.set("state", state);

    if (error) {
      target.searchParams.set("error", error);
    }

    res.redirect(302, target.toString());
  } catch (currentError) {
    logger.error("No pudimos redirigir el callback OAuth de Mercado Pago", currentError);
    res.status(500).send("No pudimos completar la vuelta a la app.");
  }
});

const mercadoPagoOAuthComplete = onRequest({ invoker: "public" }, async (req, res) => {
  if (handlePreflight(req, res)) {
    return;
  }

  applyCors(res);

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!isOAuthConfigured()) {
    sendOAuthNotConfigured(res);
    return;
  }

  try {
    const organizerId = String(req.body?.organizerId || "").trim();
    const redirectUri = String(req.body?.redirectUri || "").trim();
    const code = String(req.body?.code || "").trim();
    const state = String(req.body?.state || "").trim();
    const sessionId = String(req.body?.sessionId || "").trim();
    const platform = String(req.body?.platform || "").trim();

    if (!organizerId || !redirectUri || !code || !state || !sessionId) {
      res.status(400).json({
        error: "organizerId, redirectUri, code, state and sessionId are required",
      });
      return;
    }

    const sessionRef = getDb().collection(OAUTH_SESSIONS_COLLECTION).doc(sessionId);
    const sessionSnapshot = await sessionRef.get();

    if (!sessionSnapshot.exists) {
      res.status(404).json({ error: "oauth_session_not_found" });
      return;
    }

    const sessionData = sessionSnapshot.data() || {};

    if (
      String(sessionData.organizerId || "").trim() !== organizerId ||
      String(sessionData.nativeRedirectUri || "").trim() !== redirectUri ||
      String(sessionData.state || "").trim() !== state
    ) {
      res.status(400).json({ error: "oauth_session_invalid" });
      return;
    }

    const oauthRedirectUri = String(sessionData.oauthRedirectUri || "").trim();

    if (!oauthRedirectUri) {
      throw new Error("La sesion OAuth no tiene redirect URL configurada.");
    }

    const oauthResult = await getMercadoPagoOAuthClient().create({
      body: {
        client_id: getEnv("MERCADO_PAGO_CLIENT_ID"),
        client_secret: getEnv("MERCADO_PAGO_CLIENT_SECRET"),
        code,
        redirect_uri: oauthRedirectUri,
      },
    });

    const sellerId = String(
      oauthResult.user_id || oauthResult.payer_id || oauthResult.collector_id || ""
    ).trim();
    const publicKey = String(oauthResult.public_key || "").trim();
    const accessToken = String(oauthResult.access_token || "").trim();
    const refreshToken = String(oauthResult.refresh_token || "").trim();

    if (!accessToken) {
      throw new Error("Mercado Pago no devolvio un access token valido.");
    }

    const { currentConfig } = await readOrganizerMercadoPagoConfig(organizerId);
    const accountDisplayName =
      String(oauthResult.nickname || "").trim() ||
      (sellerId ? `Cuenta MP ${sellerId}` : "Cuenta vinculada");

    await getDb().collection(MERCADO_PAGO_ACCOUNTS_COLLECTION).doc(organizerId).set(
      {
        accessToken,
        linkedAt: admin.firestore.FieldValue.serverTimestamp(),
        organizerId,
        platform,
        provider: "mercado_pago",
        publicKey,
        refreshToken,
        sellerId,
        status: "linked",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await getDb().collection("users").doc(organizerId).set(
      {
        mercadoPagoConfig: {
          enabled: currentConfig.enabled === true,
          accountDisplayName,
          accountLinked: true,
          autoEnableNewPayments: currentConfig.autoEnableNewPayments === true,
          connectionStatus: "linked",
        },
      },
      { merge: true }
    );

    await sessionRef.set(
      {
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        sellerId,
        status: "completed",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    res.status(200).json({
      accountDisplayName,
      accountLinked: true,
      autoEnableNewPayments: currentConfig.autoEnableNewPayments === true,
      connectionStatus: "linked",
      enabled: currentConfig.enabled === true,
      publicKey,
      sellerId,
    });
  } catch (error) {
    logger.error("No pudimos completar OAuth de Mercado Pago", error);
    res.status(500).json({
      error: error?.message || "No pudimos completar la vinculacion de Mercado Pago.",
    });
  }
});

module.exports = {
  mercadoPagoOAuthComplete,
  mercadoPagoOAuthRedirect,
  mercadoPagoOAuthStart,
};
