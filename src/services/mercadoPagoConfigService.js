export const DEFAULT_MERCADO_PAGO_CONFIG = {
  enabled: false,
  accountLinked: false,
  autoEnableNewPayments: false,
  accountDisplayName: "",
  connectionStatus: "checkout_pro_test",
};

export function normalizeMercadoPagoConfig(config = {}) {
  return {
    ...DEFAULT_MERCADO_PAGO_CONFIG,
    ...(config && typeof config === "object" ? config : {}),
    enabled: config?.enabled === true,
    accountLinked: config?.accountLinked === true,
    autoEnableNewPayments: config?.autoEnableNewPayments === true,
    accountDisplayName: String(config?.accountDisplayName || "").trim(),
    connectionStatus:
      String(config?.connectionStatus || DEFAULT_MERCADO_PAGO_CONFIG.connectionStatus).trim() ||
      DEFAULT_MERCADO_PAGO_CONFIG.connectionStatus,
  };
}

export function isMercadoPagoReady(config = {}) {
  const normalized = normalizeMercadoPagoConfig(config);
  return normalized.enabled;
}

export function shouldAutoEnableMercadoPago(config = {}) {
  const normalized = normalizeMercadoPagoConfig(config);
  return normalized.enabled && normalized.autoEnableNewPayments;
}

export function buildPublicationMercadoPagoConfig(config = {}) {
  const normalized = normalizeMercadoPagoConfig(config);

  return {
    enabled: normalized.enabled,
    accountLinked: normalized.accountLinked,
    accountDisplayName: normalized.accountDisplayName,
    autoEnableNewPayments: normalized.autoEnableNewPayments,
    connectionStatus: normalized.connectionStatus,
    provider: "mercado_pago",
  };
}
