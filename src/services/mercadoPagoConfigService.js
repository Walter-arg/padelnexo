export const DEFAULT_MERCADO_PAGO_CONFIG = {
  enabled: false,
  accountLinked: false,
  autoEnableNewPayments: false,
  accountDisplayName: "",
  connectionStatus: "checkout_pro_test",
  categories: {
    turnos: true,
    ligas: true,
    torneos: true,
  },
};

export function normalizeMercadoPagoConfig(config = {}) {
  const categories =
    config?.categories && typeof config.categories === "object" ? config.categories : {};

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
    categories: {
      turnos: categories.turnos !== false,
      ligas: categories.ligas !== false,
      torneos: categories.torneos !== false,
    },
  };
}

export function isMercadoPagoReady(config = {}) {
  const normalized = normalizeMercadoPagoConfig(config);
  return normalized.enabled;
}

export function isMercadoPagoCategoryEnabled(config = {}, categoryKey = "") {
  const normalized = normalizeMercadoPagoConfig(config);

  if (!normalized.enabled) {
    return false;
  }

  return normalized.categories?.[categoryKey] === true;
}

export function shouldAutoEnableMercadoPago(config = {}) {
  const normalized = normalizeMercadoPagoConfig(config);
  return normalized.enabled && normalized.autoEnableNewPayments;
}

export function buildPublicationMercadoPagoConfig(config = {}, categoryKey = "") {
  const normalized = normalizeMercadoPagoConfig(config);
  const categoryEnabled = categoryKey
    ? isMercadoPagoCategoryEnabled(normalized, categoryKey)
    : normalized.enabled;

  return {
    enabled: categoryEnabled,
    accountLinked: normalized.accountLinked,
    accountDisplayName: normalized.accountDisplayName,
    autoEnableNewPayments: normalized.autoEnableNewPayments,
    connectionStatus: normalized.connectionStatus,
    categories: {
      ...normalized.categories,
    },
    provider: "mercado_pago",
  };
}
