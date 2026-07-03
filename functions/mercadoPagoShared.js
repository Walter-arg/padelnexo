const admin = require("firebase-admin");
const { logger } = require("firebase-functions/v2");

const OAUTH_SESSIONS_COLLECTION = "mercadoPagoOauthSessions";
const MERCADO_PAGO_ACCOUNTS_COLLECTION = "mercadoPagoAccounts";

let adminApp = null;
let db = null;
let mercadoPagoSdk = null;

function getMercadoPagoSdk() {
  if (!mercadoPagoSdk) {
    mercadoPagoSdk = require("mercadopago");
  }

  return mercadoPagoSdk;
}

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

function getEnv(name) {
  const value = String(process.env[name] || "").trim();

  if (!value) {
    throw new Error(`Falta configurar la variable ${name}.`);
  }

  return value;
}

function getOptionalEnv(name) {
  return String(process.env[name] || "").trim();
}

function maskSecret(value = "") {
  if (!value) {
    return "";
  }

  if (value.length <= 8) {
    return `${value.slice(0, 2)}***${value.slice(-2)}`;
  }

  return `${value.slice(0, 6)}***${value.slice(-4)}`;
}

function logMercadoPagoAccessTokenLoaded(context = "general") {
  const accessToken = getEnv("MERCADO_PAGO_ACCESS_TOKEN");

  logger.info("Mercado Pago Access Token cargado correctamente", {
    context,
    masked: maskSecret(accessToken),
  });

  return accessToken;
}

function shouldUseLinkedMercadoPagoAccounts() {
  return String(getOptionalEnv("MERCADO_PAGO_USE_LINKED_ACCOUNTS") || "true")
    .trim()
    .toLowerCase() !== "false";
}

function shouldRequireLinkedMercadoPagoAccounts() {
  return String(getOptionalEnv("MERCADO_PAGO_REQUIRE_LINKED_ACCOUNTS") || "")
    .trim()
    .toLowerCase() === "true";
}

function shouldUseOAuthTestToken() {
  return String(getOptionalEnv("MERCADO_PAGO_OAUTH_TEST_TOKEN") || "")
    .trim()
    .toLowerCase() === "true";
}

async function readOrganizerMercadoPagoAccount(organizerId = "") {
  const normalizedOrganizerId = String(organizerId || "").trim();

  if (!normalizedOrganizerId) {
    return null;
  }

  const snapshot = await getDb()
    .collection(MERCADO_PAGO_ACCOUNTS_COLLECTION)
    .doc(normalizedOrganizerId)
    .get();

  if (!snapshot.exists) {
    return null;
  }

  const data = snapshot.data() || {};

  return {
    accessToken: String(data.accessToken || "").trim(),
    accountDisplayName: String(data.accountDisplayName || "").trim(),
    organizerId: normalizedOrganizerId,
    publicKey: String(data.publicKey || "").trim(),
    refreshToken: String(data.refreshToken || "").trim(),
    sellerId: String(data.sellerId || "").trim(),
    tokenMode: String(data.tokenMode || "").trim().toLowerCase(),
  };
}

async function resolveMercadoPagoRuntimeContext(options = {}) {
  const organizerId = String(options.organizerId || "").trim();
  const requireOrganizerAccount =
    options.requireOrganizerAccount === true || shouldRequireLinkedMercadoPagoAccounts();

  if (organizerId && shouldUseLinkedMercadoPagoAccounts()) {
    const [{ currentConfig }, organizerAccount] = await Promise.all([
      readOrganizerMercadoPagoConfig(organizerId),
      readOrganizerMercadoPagoAccount(organizerId),
    ]);

    const expectedTokenMode = shouldUseOAuthTestToken() ? "test" : "production";
    const organizerTokenMode = String(organizerAccount?.tokenMode || "")
      .trim()
      .toLowerCase();

    if (
      currentConfig.accountLinked &&
      organizerAccount?.accessToken &&
      organizerTokenMode === expectedTokenMode
    ) {
      logger.info("Usando cuenta vinculada del organizador en Mercado Pago", {
        context: String(options.context || "general").trim() || "general",
        organizerId,
        source: "organizer_account",
        tokenMode: organizerTokenMode,
      });

      return {
        accessToken: organizerAccount.accessToken,
        accountDisplayName: organizerAccount.accountDisplayName,
        organizerId,
        publicKey: organizerAccount.publicKey,
        source: "organizer_account",
        tokenMode: organizerTokenMode,
      };
    }

    if (currentConfig.accountLinked && organizerAccount?.accessToken) {
      logger.warn("La cuenta vinculada de Mercado Pago no coincide con el modo actual", {
        expectedTokenMode,
        organizerId,
        tokenMode: organizerTokenMode || "unknown",
      });
    }

    if (requireOrganizerAccount) {
      throw new Error(
        !organizerTokenMode
          ? "El organizador debe volver a vincular su cuenta de Mercado Pago para actualizar el modo de cobro."
          : expectedTokenMode === "production"
            ? "El organizador debe vincular una cuenta real de Mercado Pago para recibir pagos."
            : "El organizador debe vincular una cuenta de prueba de Mercado Pago para probar pagos."
      );
    }
  }

  const accessToken = logMercadoPagoAccessTokenLoaded(
    String(options.context || "general").trim() || "general"
  );

  return {
    accessToken,
    accountDisplayName: "",
    organizerId,
    publicKey: "",
    source: "global_test",
    tokenMode: shouldUseOAuthTestToken() ? "test" : "production",
  };
}

async function mercadoPagoRequest(path, options = {}, runtimeOptions = {}) {
  const runtimeContext = await resolveMercadoPagoRuntimeContext({
    context: "mercadoPagoRequest",
    ...runtimeOptions,
  });
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${runtimeContext.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let json = {};

  try {
    json = text ? JSON.parse(text) : {};
  } catch (error) {
    logger.warn("Mercado Pago respondio un cuerpo no JSON", { path, text });
  }

  if (!response.ok) {
    logger.error("Mercado Pago respondio con error", {
      body: json,
      path,
      status: response.status,
    });
    throw new Error("Mercado Pago rechazo la solicitud.");
  }

  return json;
}

function createMercadoPagoSdkClient(accessToken) {
  const { MercadoPagoConfig } = getMercadoPagoSdk();

  return new MercadoPagoConfig({
    accessToken,
    options: { timeout: 10000 },
  });
}

function getMercadoPagoOAuthClient() {
  const { OAuth } = getMercadoPagoSdk();

  return new OAuth(createMercadoPagoSdkClient(logMercadoPagoAccessTokenLoaded("sdkClient")));
}

function shouldUseMercadoPagoSandboxCheckout() {
  return String(getOptionalEnv("MERCADO_PAGO_CHECKOUT_SANDBOX") || "")
    .trim()
    .toLowerCase() === "true";
}

async function getMercadoPagoPreferenceClient(runtimeOptions = {}) {
  const { Preference } = getMercadoPagoSdk();
  const runtimeContext = await resolveMercadoPagoRuntimeContext({
    context: "sdkClient",
    ...runtimeOptions,
  });

  return new Preference(createMercadoPagoSdkClient(runtimeContext.accessToken));
}

async function getMercadoPagoPreferenceRuntime(runtimeOptions = {}) {
  const { Preference } = getMercadoPagoSdk();
  const runtimeContext = await resolveMercadoPagoRuntimeContext({
    context: "sdkClient",
    ...runtimeOptions,
  });

  return {
    client: new Preference(createMercadoPagoSdkClient(runtimeContext.accessToken)),
    context: runtimeContext,
  };
}

function createRandomId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function normalizeOrganizerMercadoPagoConfig(config = {}) {
  return {
    enabled: config?.enabled === true,
    accountLinked: config?.accountLinked === true,
    autoEnableNewPayments: config?.autoEnableNewPayments === true,
    accountDisplayName: String(config?.accountDisplayName || "").trim(),
    connectionStatus:
      String(config?.connectionStatus || "checkout_pro_test").trim() || "checkout_pro_test",
  };
}

async function readOrganizerMercadoPagoConfig(organizerId) {
  const organizerDoc = await getDb().collection("users").doc(organizerId).get();
  const data = organizerDoc.exists ? organizerDoc.data() || {} : {};

  return {
    organizerDocExists: organizerDoc.exists,
    currentConfig: normalizeOrganizerMercadoPagoConfig(data.mercadoPagoConfig),
  };
}

async function findOauthSessionByState(state) {
  const snapshot = await getDb()
    .collection(OAUTH_SESSIONS_COLLECTION)
    .where("state", "==", state)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  const sessionDoc = snapshot.docs[0];

  return {
    id: sessionDoc.id,
    ref: sessionDoc.ref,
    data: sessionDoc.data() || {},
  };
}

module.exports = {
  OAUTH_SESSIONS_COLLECTION,
  MERCADO_PAGO_ACCOUNTS_COLLECTION,
  admin,
  applyCors,
  createRandomId,
  findOauthSessionByState,
  getDb,
  getEnv,
  getMercadoPagoOAuthClient,
  getMercadoPagoPreferenceClient,
  getMercadoPagoPreferenceRuntime,
  getOptionalEnv,
  handlePreflight,
  logger,
  logMercadoPagoAccessTokenLoaded,
  maskSecret,
  mercadoPagoRequest,
  normalizeOrganizerMercadoPagoConfig,
  readOrganizerMercadoPagoAccount,
  readOrganizerMercadoPagoConfig,
  resolveMercadoPagoRuntimeContext,
  shouldUseMercadoPagoSandboxCheckout,
  shouldRequireLinkedMercadoPagoAccounts,
  shouldUseLinkedMercadoPagoAccounts,
  shouldUseOAuthTestToken,
};
