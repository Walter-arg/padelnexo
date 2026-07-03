const { onRequest } = require("firebase-functions/v2/https");
const crypto = require("crypto");

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
  shouldUseOAuthTestToken,
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

function base64UrlEncode(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createPkcePair() {
  const verifier = base64UrlEncode(crypto.randomBytes(48));
  const challenge = base64UrlEncode(crypto.createHash("sha256").update(verifier).digest());

  return {
    challenge,
    method: "S256",
    verifier,
  };
}

function buildMercadoPagoAuthorizationUrl({
  clientId = "",
  redirectUri = "",
  state = "",
  codeChallenge = "",
  codeChallengeMethod = "S256",
}) {
  const authorizationUrl = new URL("https://auth.mercadopago.com/authorization");

  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("platform_id", "mp");

  if (codeChallenge) {
    authorizationUrl.searchParams.set("code_challenge", codeChallenge);
    authorizationUrl.searchParams.set("code_challenge_method", codeChallengeMethod);
  }

  return authorizationUrl.toString();
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
    const pkce = createPkcePair();

    await getDb().collection(OAUTH_SESSIONS_COLLECTION).doc(sessionId).set({
      codeChallenge: pkce.challenge,
      codeChallengeMethod: pkce.method,
      codeVerifier: pkce.verifier,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      nativeRedirectUri,
      organizerId,
      oauthRedirectUri,
      platform,
      state,
      status: "pending",
    });

    const authUrl = buildMercadoPagoAuthorizationUrl({
      clientId,
      codeChallenge: pkce.challenge,
      codeChallengeMethod: pkce.method,
      redirectUri: oauthRedirectUri,
      state,
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
    target.searchParams.set("sessionId", session.id);

    if (error) {
      target.searchParams.set("error", error);
    }

    const deepLink = target.toString();
    const escapedDeepLink = deepLink
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    res.status(200).send(`<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Volviendo a PadelNexo</title>
    <style>
      body {
        margin: 0;
        padding: 0;
        font-family: Arial, sans-serif;
        background: #f4f6f8;
        color: #1f2933;
      }
      .wrap {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
      }
      .card {
        width: 100%;
        max-width: 420px;
        background: #ffffff;
        border: 1px solid #d7e3ec;
        border-radius: 18px;
        padding: 24px;
        box-shadow: 0 14px 34px rgba(15, 23, 42, 0.08);
        text-align: center;
      }
      h1 {
        font-size: 22px;
        margin: 0 0 12px;
      }
      p {
        font-size: 15px;
        line-height: 1.5;
        margin: 0 0 18px;
        color: #52606d;
      }
      a {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 46px;
        padding: 0 18px;
        border-radius: 12px;
        background: #1e9f6e;
        color: #ffffff;
        font-weight: 700;
        text-decoration: none;
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>Ya casi volvemos a PadelNexo</h1>
        <p>Si la app no se abre sola en unos segundos, toca el boton para continuar.</p>
        <a href="${escapedDeepLink}">Volver a PadelNexo</a>
      </div>
    </div>
    <script>
      const deepLink = ${JSON.stringify(deepLink)};
      window.location.replace(deepLink);
      setTimeout(() => {
        window.location.href = deepLink;
      }, 900);
    </script>
  </body>
</html>`);
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

    const useOAuthTestToken = shouldUseOAuthTestToken();
    const oauthCreateBody = {
      client_id: getEnv("MERCADO_PAGO_CLIENT_ID"),
      client_secret: getEnv("MERCADO_PAGO_CLIENT_SECRET"),
      code,
      code_verifier: String(sessionData.codeVerifier || "").trim(),
      redirect_uri: oauthRedirectUri,
    };

    if (useOAuthTestToken) {
      oauthCreateBody.test_token = true;
    }

    logger.info("Completando OAuth de Mercado Pago", {
      organizerId,
      platform,
      testToken: useOAuthTestToken,
    });

    const oauthResult = await getMercadoPagoOAuthClient().create({
      body: oauthCreateBody,
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
        accountDisplayName,
        linkedAt: admin.firestore.FieldValue.serverTimestamp(),
        organizerId,
        platform,
        provider: "mercado_pago",
        publicKey,
        refreshToken,
        sellerId,
        status: "linked",
        tokenMode: useOAuthTestToken ? "test" : "production",
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
          categories: currentConfig.categories || {
            turnos: true,
            ligas: true,
            torneos: true,
          },
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
      config: {
        enabled: currentConfig.enabled === true,
        accountDisplayName,
        accountLinked: true,
        autoEnableNewPayments: currentConfig.autoEnableNewPayments === true,
        categories: currentConfig.categories || {
          turnos: true,
          ligas: true,
          torneos: true,
        },
        connectionStatus: "linked",
      },
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
