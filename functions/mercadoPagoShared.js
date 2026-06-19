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

async function mercadoPagoRequest(path, options = {}) {
  const accessToken = logMercadoPagoAccessTokenLoaded("mercadoPagoRequest");
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
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

function getMercadoPagoSdkClient() {
  const accessToken = logMercadoPagoAccessTokenLoaded("sdkClient");
  const { MercadoPagoConfig } = getMercadoPagoSdk();

  return new MercadoPagoConfig({
    accessToken,
    options: { timeout: 10000 },
  });
}

function getMercadoPagoOAuthClient() {
  const { OAuth } = getMercadoPagoSdk();

  return new OAuth(getMercadoPagoSdkClient());
}

function getMercadoPagoPreferenceClient() {
  const { Preference } = getMercadoPagoSdk();

  return new Preference(getMercadoPagoSdkClient());
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
  getOptionalEnv,
  handlePreflight,
  logger,
  logMercadoPagoAccessTokenLoaded,
  maskSecret,
  mercadoPagoRequest,
  normalizeOrganizerMercadoPagoConfig,
  readOrganizerMercadoPagoConfig,
};
