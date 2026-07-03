import Constants from "expo-constants";

const defaultMercadoPagoConfig = {
  publicKey: "",
  scheme: "com.padelnexo.app",
  leaguesCheckoutUrl: "",
  leaguesSyncUrl: "",
  oauthCompleteUrl: "",
  oauthStartUrl: "",
  tournamentsCheckoutUrl: "",
  tournamentsSyncUrl: "",
  turnosCheckoutUrl: "",
  turnosSyncUrl: "",
};

function getExpoExtraConfig() {
  return (
    Constants.expoConfig?.extra ||
    Constants.manifest2?.extra ||
    Constants.manifest?.extra ||
    {}
  );
}

export function getMercadoPagoConfig() {
  const extra = getExpoExtraConfig();
  const configured = extra.mercadoPago && typeof extra.mercadoPago === "object"
    ? extra.mercadoPago
    : {};
  const envPublicKey = String(process.env.EXPO_PUBLIC_MERCADO_PAGO_PUBLIC_KEY || "").trim();

  return {
    ...defaultMercadoPagoConfig,
    ...configured,
    publicKey: envPublicKey || String(configured.publicKey || "").trim(),
    scheme:
      String(Constants.expoConfig?.scheme || configured.scheme || defaultMercadoPagoConfig.scheme).trim() ||
      defaultMercadoPagoConfig.scheme,
    leaguesCheckoutUrl: String(configured.leaguesCheckoutUrl || "").trim(),
    leaguesSyncUrl: String(configured.leaguesSyncUrl || "").trim(),
    oauthCompleteUrl: String(configured.oauthCompleteUrl || "").trim(),
    oauthStartUrl: String(configured.oauthStartUrl || "").trim(),
    tournamentsCheckoutUrl: String(configured.tournamentsCheckoutUrl || "").trim(),
    tournamentsSyncUrl: String(configured.tournamentsSyncUrl || "").trim(),
    turnosCheckoutUrl: String(configured.turnosCheckoutUrl || "").trim(),
    turnosSyncUrl: String(configured.turnosSyncUrl || "").trim(),
  };
}

export function hasMercadoPagoPublicKey() {
  const config = getMercadoPagoConfig();

  return Boolean(config.publicKey);
}

export function hasTurnosCheckoutConfig() {
  const config = getMercadoPagoConfig();

  return Boolean(config.turnosCheckoutUrl);
}

export function hasLeaguesCheckoutConfig() {
  const config = getMercadoPagoConfig();

  return Boolean(config.leaguesCheckoutUrl);
}

export function hasTurnosSyncConfig() {
  const config = getMercadoPagoConfig();

  return Boolean(config.turnosSyncUrl);
}

export function hasTournamentsCheckoutConfig() {
  const config = getMercadoPagoConfig();

  return Boolean(config.tournamentsCheckoutUrl);
}

export function hasTournamentsSyncConfig() {
  const config = getMercadoPagoConfig();

  return Boolean(config.tournamentsSyncUrl);
}

export function hasLeaguesSyncConfig() {
  const config = getMercadoPagoConfig();

  return Boolean(config.leaguesSyncUrl);
}

export function hasMercadoPagoCheckoutRuntimeConfig() {
  const config = getMercadoPagoConfig();

  return Boolean(config.publicKey && config.turnosCheckoutUrl);
}

export function hasMercadoPagoOAuthRuntimeConfig() {
  const config = getMercadoPagoConfig();

  return Boolean(config.oauthStartUrl && config.oauthCompleteUrl);
}

export function getMercadoPagoReturnUrls() {
  const config = getMercadoPagoConfig();
  const baseUrl = `${config.scheme}://checkout`;

  return {
    successUrl: `${baseUrl}/success`,
    failureUrl: `${baseUrl}/failure`,
    pendingUrl: `${baseUrl}/pending`,
  };
}
