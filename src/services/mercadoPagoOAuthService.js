import AsyncStorage from "@react-native-async-storage/async-storage";
import * as WebBrowser from "expo-web-browser";
import { AppState, Linking } from "react-native";

import {
  getMercadoPagoConfig,
  hasMercadoPagoOAuthRuntimeConfig,
} from "../config/mercadoPago";
import devLog from "../utils/devLog";

WebBrowser.maybeCompleteAuthSession();

const PENDING_OAUTH_KEY = "@padelnexo:mercado-pago-pending-oauth";

function buildError(message, code = "mercado_pago_oauth_error") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function buildRedirectUri() {
  const config = getMercadoPagoConfig();
  const scheme = String(config.scheme || "com.padelnexo.app").trim() || "com.padelnexo.app";
  return `${scheme}://checkout/oauth`;
}

function parseUrlParams(url = "") {
  const normalized = String(url || "").trim();

  if (!normalized) {
    return {};
  }

  const queryString = normalized.includes("?") ? normalized.split("?")[1] : "";
  return queryString.split("&").reduce((accumulator, entry) => {
    const [rawKey, rawValue = ""] = entry.split("=");
    const key = decodeURIComponent(rawKey || "").trim();

    if (!key) {
      return accumulator;
    }

    accumulator[key] = decodeURIComponent(rawValue || "").trim();
    return accumulator;
  }, {});
}

function isMercadoPagoOAuthReturnUrl(url = "") {
  const normalized = String(url || "").trim().toLowerCase();
  return normalized.startsWith("com.padelnexo.app://checkout/oauth");
}

async function persistPendingOAuth(payload = {}) {
  await AsyncStorage.setItem(
    PENDING_OAUTH_KEY,
    JSON.stringify({
      authorizationUrl: String(payload.authorizationUrl || "").trim(),
      createdAt: Date.now(),
      organizerId: String(payload.organizerId || "").trim(),
      redirectUri: String(payload.redirectUri || "").trim(),
      sessionId: String(payload.sessionId || "").trim(),
    })
  );
}

async function clearPendingOAuth() {
  await AsyncStorage.removeItem(PENDING_OAUTH_KEY);
}

async function readPendingOAuth() {
  const raw = await AsyncStorage.getItem(PENDING_OAUTH_KEY);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    return null;
  }
}

async function waitForOAuthRedirect(start = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId = null;
    let returnCheckTimeoutId = null;
    let appStateSubscription = null;
    let linkingSubscription = null;
    let appLeftForeground = false;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (returnCheckTimeoutId) {
        clearTimeout(returnCheckTimeoutId);
      }

      if (appStateSubscription?.remove) {
        appStateSubscription.remove();
      }

      if (linkingSubscription?.remove) {
        linkingSubscription.remove();
      }
    };

    const finish = (callback) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      callback();
    };

    const tryResolveUrl = async (incomingUrl = "") => {
      const normalizedUrl = String(incomingUrl || "").trim();

      if (!normalizedUrl || !isMercadoPagoOAuthReturnUrl(normalizedUrl)) {
        return false;
      }

      finish(() => resolve(normalizedUrl));
      return true;
    };

    linkingSubscription = Linking.addEventListener("url", ({ url }) => {
      tryResolveUrl(url).catch(() => {});
    });

    appStateSubscription = AppState.addEventListener("change", async (nextState) => {
      if (nextState === "background" || nextState === "inactive") {
        appLeftForeground = true;
        return;
      }

      if (nextState !== "active") {
        return;
      }

      const initialUrl = await Linking.getInitialURL().catch(() => "");
      const resolved = await tryResolveUrl(initialUrl);

      if (!resolved && appLeftForeground) {
        returnCheckTimeoutId = setTimeout(async () => {
          if (settled) {
            return;
          }

          const delayedInitialUrl = await Linking.getInitialURL().catch(() => "");
          const delayedResolved = await tryResolveUrl(delayedInitialUrl);

          if (delayedResolved || settled) {
            return;
          }

          finish(() =>
            reject(
              buildError(
                "La vinculacion con Mercado Pago se cancelo antes de completarse.",
                "mercado_pago_oauth_cancelled"
              )
            )
          );
        }, 900);
      }
    });

    timeoutId = setTimeout(() => {
      finish(() =>
        reject(
          buildError(
            "La vinculacion con Mercado Pago se cancelo antes de completarse.",
            "mercado_pago_oauth_cancelled"
          )
        )
      );
    }, 180000);

    Linking.openURL(start.authorizationUrl).catch((error) => {
      finish(() =>
        reject(
          buildError(
            error?.message || "No pudimos abrir Mercado Pago para vincular la cuenta.",
            "mercado_pago_oauth_open_failed"
          )
        )
      );
    });
  });
}

async function requestOAuthStart(organizerId = "") {
  if (!hasMercadoPagoOAuthRuntimeConfig()) {
    throw buildError(
      "La app todavia no tiene configuradas las URLs para vincular Mercado Pago.",
      "mercado_pago_oauth_runtime_missing"
    );
  }

  const config = getMercadoPagoConfig();
  const redirectUri = buildRedirectUri();
  const params = new URLSearchParams({
    organizerId: String(organizerId || "").trim(),
    platform: "expo",
    redirectUri,
  });
  const response = await fetch(`${config.oauthStartUrl}?${params.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  let data = {};

  try {
    data = await response.json();
  } catch (error) {
    data = {};
  }

  if (!response.ok) {
    throw buildError(
      String(data?.error || "").trim() || "No pudimos iniciar la vinculacion con Mercado Pago.",
      String(data?.error || "").trim() || "mercado_pago_oauth_start_failed"
    );
  }

  return {
    authorizationUrl: String(data?.authorizationUrl || data?.authUrl || "").trim(),
    redirectUri,
    sessionId: String(data?.sessionId || "").trim(),
  };
}

async function completeOAuth({
  code = "",
  organizerId = "",
  redirectUri = "",
  sessionId = "",
  state = "",
}) {
  const config = getMercadoPagoConfig();
  const response = await fetch(config.oauthCompleteUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      code,
      organizerId,
      redirectUri,
      sessionId,
      state,
    }),
  });

  let data = {};

  try {
    data = await response.json();
  } catch (error) {
    data = {};
  }

  if (!response.ok) {
    throw buildError(
      String(data?.error || "").trim() || "No pudimos completar la vinculacion con Mercado Pago.",
      String(data?.error || "").trim() || "mercado_pago_oauth_complete_failed"
    );
  }

  return data;
}

export async function linkOrganizerMercadoPagoAccount(organizerId = "") {
  const normalizedOrganizerId = String(organizerId || "").trim();

  if (!normalizedOrganizerId) {
    throw buildError("No encontramos al organizador para vincular la cuenta.");
  }

  const start = await requestOAuthStart(normalizedOrganizerId);

  if (!start.authorizationUrl || !start.redirectUri || !start.sessionId) {
    throw buildError("La vinculacion con Mercado Pago no devolvio un inicio valido.");
  }

  devLog("[mercadoPagoOAuth] URL de autorizacion generada:", {
    authorizationUrl: start.authorizationUrl,
    organizerId: normalizedOrganizerId,
    redirectUri: start.redirectUri,
    sessionId: start.sessionId,
  });

  await persistPendingOAuth({
    authorizationUrl: start.authorizationUrl,
    organizerId: normalizedOrganizerId,
    redirectUri: start.redirectUri,
    sessionId: start.sessionId,
  });

  const redirectUrl = await waitForOAuthRedirect(start);
  devLog("[mercadoPagoOAuth] Resultado de la sesion OAuth:", {
    type: "success",
    url: redirectUrl,
  });

  const params = parseUrlParams(redirectUrl);
  const code = String(params.code || "").trim();
  const state = String(params.state || "").trim();
  const sessionId = String(params.sessionId || start.sessionId || "").trim();
  const error = String(params.error || "").trim();

  if (error) {
    throw buildError(
      String(params.error_description || error).trim() ||
        "Mercado Pago rechazo la vinculacion.",
      error
    );
  }

  if (!code || !state || !sessionId) {
    throw buildError("No recibimos la confirmacion necesaria desde Mercado Pago.");
  }

  try {
    const result = await completeOAuth({
      code,
      organizerId: normalizedOrganizerId,
      redirectUri: start.redirectUri,
      sessionId,
      state,
    });

    await clearPendingOAuth();
    return result;
  } catch (error) {
    await clearPendingOAuth();
    throw error;
  }
}

export async function recoverPendingMercadoPagoOAuth() {
  const pending = await readPendingOAuth();

  if (!pending?.organizerId || !pending?.redirectUri || !pending?.sessionId) {
    return null;
  }

  const initialUrl = await Linking.getInitialURL().catch(() => "");

  if (!isMercadoPagoOAuthReturnUrl(initialUrl)) {
    return null;
  }

  const params = parseUrlParams(initialUrl);
  const code = String(params.code || "").trim();
  const state = String(params.state || "").trim();
  const sessionId = String(params.sessionId || pending.sessionId || "").trim();
  const error = String(params.error || "").trim();

  if (error) {
    await clearPendingOAuth();
    throw buildError(
      String(params.error_description || error).trim() || "Mercado Pago rechazo la vinculacion.",
      error
    );
  }

  if (!code || !state || !sessionId) {
    return null;
  }

  const result = await completeOAuth({
    code,
    organizerId: String(pending.organizerId || "").trim(),
    redirectUri: String(pending.redirectUri || "").trim(),
    sessionId,
    state,
  });

  await clearPendingOAuth();
  return result;
}
