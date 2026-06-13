import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  getMercadoPagoConfig,
  hasMercadoPagoPublicKey,
  hasTurnosCheckoutConfig,
  hasTurnosSyncConfig,
} from "../config/mercadoPago";

const PENDING_TURNO_CHECKOUT_KEY = "@padelnexo:mercado-pago-pending-turno-checkout";

function buildError(message) {
  return new Error(message);
}

export async function createTurnoMercadoPagoPreference(payload = {}) {
  if (!hasTurnosCheckoutConfig()) {
    throw buildError(
      "La URL de cobro de Mercado Pago para turnos todavia no esta configurada en la app."
    );
  }

  const config = getMercadoPagoConfig();
  console.log("[mercadoPagoCheckout] Public Key cargada correctamente:", {
    configured: hasMercadoPagoPublicKey(),
    suffix: config.publicKey ? config.publicKey.slice(-6) : "",
  });
  const response = await fetch(config.turnosCheckoutUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw buildError("No pudimos crear el cobro de Mercado Pago para este turno.");
  }

  const data = await response.json();
  const checkoutUrl = String(data?.initPoint || data?.init_point || "").trim();
  const preferenceId = String(data?.preferenceId || data?.id || "").trim();

  console.log("[mercadoPagoCheckout] Preferencia creada correctamente:", {
    preferenceId,
  });
  console.log("[mercadoPagoCheckout] URL de Checkout Pro generada correctamente:", {
    hasCheckoutUrl: Boolean(checkoutUrl),
  });

  return {
    checkoutUrl,
    preferenceId,
    sandboxCheckoutUrl: String(data?.sandboxInitPoint || data?.sandbox_init_point || "").trim(),
  };
}

export async function persistPendingTurnoCheckout(payload = {}) {
  const nextPayload = {
    createdAt: Date.now(),
    paymentId: String(payload.paymentId || "").trim(),
    preferenceId: String(payload.preferenceId || "").trim(),
    reservationId: String(payload.reservationId || "").trim(),
    source: "turnos",
    status: String(payload.status || "pending").trim().toLowerCase(),
  };

  await AsyncStorage.setItem(PENDING_TURNO_CHECKOUT_KEY, JSON.stringify(nextPayload));
  return nextPayload;
}

export async function readPendingTurnoCheckout() {
  const rawValue = await AsyncStorage.getItem(PENDING_TURNO_CHECKOUT_KEY);

  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue);

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return parsed;
  } catch (error) {
    return null;
  }
}

export async function clearPendingTurnoCheckout() {
  await AsyncStorage.removeItem(PENDING_TURNO_CHECKOUT_KEY);
}

export async function syncTurnoMercadoPagoPayment(payload = {}) {
  if (!hasTurnosSyncConfig()) {
    throw buildError(
      "La URL de sincronizacion de Mercado Pago para turnos todavia no esta configurada en la app."
    );
  }

  const config = getMercadoPagoConfig();
  const response = await fetch(config.turnosSyncUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  let data = {};

  try {
    data = await response.json();
  } catch (error) {
    data = {};
  }

  if (!response.ok) {
    const error = buildError(
      String(data?.error || "").trim() || "No pudimos actualizar el estado final del pago de Mercado Pago."
    );
    error.code = String(data?.error || "").trim() || "mercado_pago_sync_failed";
    error.httpStatus = Number(response.status || 0);
    throw error;
  }

  console.log("[mercadoPagoCheckout] Pago sincronizado correctamente:", {
    mercadoPagoPaymentId: String(data?.mercadoPagoPaymentId || "").trim(),
    mercadoPagoStatus: String(data?.mercadoPagoStatus || "").trim(),
    paymentStatus: String(data?.paymentStatus || "").trim(),
    reservationId: String(data?.reservationId || "").trim(),
  });

  return data;
}
