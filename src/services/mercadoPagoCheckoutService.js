import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  getMercadoPagoConfig,
  hasLeaguesCheckoutConfig,
  hasLeaguesSyncConfig,
  hasMercadoPagoPublicKey,
  hasTournamentsCheckoutConfig,
  hasTournamentsSyncConfig,
  hasTurnosCheckoutConfig,
  hasTurnosSyncConfig,
} from "../config/mercadoPago";

const PENDING_TURNO_CHECKOUT_KEY = "@padelnexo:mercado-pago-pending-turno-checkout";
const PENDING_CHECKOUT_KEY = "@padelnexo:mercado-pago-pending-checkout";

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
  const externalReference = String(data?.externalReference || "").trim();
  const preferenceId = String(data?.preferenceId || data?.id || "").trim();

  console.log("[mercadoPagoCheckout] Preferencia creada correctamente:", {
    preferenceId,
  });
  console.log("[mercadoPagoCheckout] URL de Checkout Pro generada correctamente:", {
    hasCheckoutUrl: Boolean(checkoutUrl),
  });

  return {
    checkoutUrl,
    externalReference,
    preferenceId,
    sandboxCheckoutUrl: String(data?.sandboxInitPoint || data?.sandbox_init_point || "").trim(),
  };
}

export async function createLeagueMercadoPagoPreference(payload = {}) {
  if (!hasLeaguesCheckoutConfig()) {
    throw buildError(
      "La URL de cobro de Mercado Pago para ligas todavia no esta configurada en la app."
    );
  }

  const config = getMercadoPagoConfig();
  console.log("[mercadoPagoCheckout] Public Key cargada correctamente:", {
    configured: hasMercadoPagoPublicKey(),
    suffix: config.publicKey ? config.publicKey.slice(-6) : "",
  });
  const response = await fetch(config.leaguesCheckoutUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw buildError("No pudimos crear el cobro de Mercado Pago para esta liga.");
  }

  const data = await response.json();
  const checkoutUrl = String(data?.initPoint || data?.init_point || "").trim();
  const externalReference = String(data?.externalReference || "").trim();
  const preferenceId = String(data?.preferenceId || data?.id || "").trim();

  console.log("[mercadoPagoCheckout] Preferencia creada correctamente:", {
    externalReference,
    preferenceId,
  });
  console.log("[mercadoPagoCheckout] URL de Checkout Pro generada correctamente:", {
    hasCheckoutUrl: Boolean(checkoutUrl),
  });

  return {
    checkoutUrl,
    externalReference,
    preferenceId,
    sandboxCheckoutUrl: String(data?.sandboxInitPoint || data?.sandbox_init_point || "").trim(),
  };
}

export async function createTournamentMercadoPagoPreference(payload = {}) {
  if (!hasTournamentsCheckoutConfig()) {
    throw buildError(
      "La URL de cobro de Mercado Pago para torneos todavia no esta configurada en la app."
    );
  }

  const config = getMercadoPagoConfig();
  console.log("[mercadoPagoCheckout] Public Key cargada correctamente:", {
    configured: hasMercadoPagoPublicKey(),
    suffix: config.publicKey ? config.publicKey.slice(-6) : "",
  });
  const response = await fetch(config.tournamentsCheckoutUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw buildError("No pudimos crear el cobro de Mercado Pago para este torneo.");
  }

  const data = await response.json();
  const checkoutUrl = String(data?.initPoint || data?.init_point || "").trim();
  const externalReference = String(data?.externalReference || "").trim();
  const preferenceId = String(data?.preferenceId || data?.id || "").trim();

  console.log("[mercadoPagoCheckout] Preferencia creada correctamente:", {
    externalReference,
    preferenceId,
  });
  console.log("[mercadoPagoCheckout] URL de Checkout Pro generada correctamente:", {
    hasCheckoutUrl: Boolean(checkoutUrl),
  });

  return {
    checkoutUrl,
    externalReference,
    preferenceId,
    sandboxCheckoutUrl: String(data?.sandboxInitPoint || data?.sandbox_init_point || "").trim(),
  };
}

export async function persistPendingMercadoPagoCheckout(payload = {}) {
  const nextPayload = {
    batchCount: Number(payload.batchCount || 0) || 0,
    batchTargets: Array.isArray(payload.batchTargets)
      ? payload.batchTargets
          .map((target) => ({
            pairId: String(target?.pairId || "").trim(),
            participantId: String(target?.participantId || "").trim(),
            roundId: String(target?.roundId || "").trim(),
          }))
          .filter((target) => target.roundId && target.participantId)
      : [],
    createdAt: Date.now(),
    externalReference: String(payload.externalReference || "").trim(),
    failedSyncAttempts: Number(payload.failedSyncAttempts || 0),
    leagueId: String(payload.leagueId || "").trim(),
    pairId: String(payload.pairId || "").trim(),
    participantId: String(payload.participantId || "").trim(),
    paymentId: String(payload.paymentId || "").trim(),
    preferenceId: String(payload.preferenceId || "").trim(),
    reservationId: String(payload.reservationId || "").trim(),
    roundId: String(payload.roundId || "").trim(),
    source: String(payload.source || "turnos").trim(),
    status: String(payload.status || "pending").trim().toLowerCase(),
    tournamentId: String(payload.tournamentId || "").trim(),
    registrationId: String(payload.registrationId || "").trim(),
    playerId: String(payload.playerId || "").trim(),
  };

  await AsyncStorage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify(nextPayload));
  return nextPayload;
}

export async function persistPendingTurnoCheckout(payload = {}) {
  const nextPayload = await persistPendingMercadoPagoCheckout({
    ...payload,
    source: "turnos",
  });
  await AsyncStorage.setItem(PENDING_TURNO_CHECKOUT_KEY, JSON.stringify(nextPayload));
  return nextPayload;
}

export async function readPendingTurnoCheckout() {
  const genericPendingCheckout = await readPendingMercadoPagoCheckout();

  if (genericPendingCheckout?.source === "turnos" && genericPendingCheckout?.reservationId) {
    return genericPendingCheckout;
  }

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

export async function readPendingMercadoPagoCheckout() {
  const rawValue = await AsyncStorage.getItem(PENDING_CHECKOUT_KEY);

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
  await AsyncStorage.removeItem(PENDING_CHECKOUT_KEY);
  await AsyncStorage.removeItem(PENDING_TURNO_CHECKOUT_KEY);
}

export async function clearPendingMercadoPagoCheckout() {
  await AsyncStorage.removeItem(PENDING_CHECKOUT_KEY);
}

export async function updatePendingMercadoPagoCheckout(patch = {}) {
  const current = await readPendingMercadoPagoCheckout();

  if (!current) {
    return null;
  }

  const nextPayload = {
    ...current,
    ...patch,
    failedSyncAttempts: Number(
      patch.failedSyncAttempts ?? current.failedSyncAttempts ?? 0
    ),
  };

  await AsyncStorage.setItem(PENDING_CHECKOUT_KEY, JSON.stringify(nextPayload));
  return nextPayload;
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
    console.log("[mercadoPagoCheckout] Error al sincronizar pago de liga:", {
      body: data,
      httpStatus: Number(response.status || 0),
      payload,
    });
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

export async function syncLeagueMercadoPagoPayment(payload = {}) {
  if (!hasLeaguesSyncConfig()) {
    throw buildError(
      "La URL de sincronizacion de Mercado Pago para ligas todavia no esta configurada en la app."
    );
  }

  const config = getMercadoPagoConfig();
  const response = await fetch(config.leaguesSyncUrl, {
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
    console.log("[mercadoPagoCheckout] Error al sincronizar pago de liga:", {
      body: data,
      httpStatus: Number(response.status || 0),
      payload,
    });
    const error = buildError(
      String(data?.error || "").trim() || "No pudimos actualizar el estado final del pago de Mercado Pago."
    );
    error.code = String(data?.error || "").trim() || "mercado_pago_sync_failed";
    error.httpStatus = Number(response.status || 0);
    throw error;
  }

  console.log("[mercadoPagoCheckout] Pago sincronizado correctamente:", {
    externalReference: String(data?.externalReference || "").trim(),
    leagueId: String(data?.leagueId || "").trim(),
    mercadoPagoPaymentId: String(data?.mercadoPagoPaymentId || "").trim(),
    mercadoPagoStatus: String(data?.mercadoPagoStatus || "").trim(),
    participantId: String(data?.participantId || "").trim(),
    roundId: String(data?.roundId || "").trim(),
  });

  return data;
}

export async function syncTournamentMercadoPagoPayment(payload = {}) {
  if (!hasTournamentsSyncConfig()) {
    throw buildError(
      "La URL de sincronizacion de Mercado Pago para torneos todavia no esta configurada en la app."
    );
  }

  const config = getMercadoPagoConfig();
  const response = await fetch(config.tournamentsSyncUrl, {
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
    console.log("[mercadoPagoCheckout] Error al sincronizar pago de torneo:", {
      body: data,
      httpStatus: Number(response.status || 0),
      payload,
    });
    const error = buildError(
      String(data?.error || "").trim() || "No pudimos actualizar el estado final del pago de Mercado Pago."
    );
    error.code = String(data?.error || "").trim() || "mercado_pago_sync_failed";
    error.httpStatus = Number(response.status || 0);
    throw error;
  }

  console.log("[mercadoPagoCheckout] Pago sincronizado correctamente:", {
    externalReference: String(data?.externalReference || "").trim(),
    mercadoPagoPaymentId: String(data?.mercadoPagoPaymentId || "").trim(),
    mercadoPagoStatus: String(data?.mercadoPagoStatus || "").trim(),
    playerId: String(data?.playerId || "").trim(),
    registrationId: String(data?.registrationId || "").trim(),
    tournamentId: String(data?.tournamentId || "").trim(),
  });

  return data;
}
