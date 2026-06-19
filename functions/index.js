const { setGlobalOptions } = require("firebase-functions/v2");
const { onRequest } = require("firebase-functions/v2/https");

setGlobalOptions({
  maxInstances: 10,
  region: "southamerica-east1",
});

function lazyOnRequest(modulePath, exportName, options = { invoker: "public" }) {
  return onRequest(options, async (req, res) => {
    const moduleExports = require(modulePath);
    const handler = moduleExports?.[exportName];

    if (typeof handler !== "function") {
      res.status(500).json({
        error: `handler_not_found:${exportName}`,
      });
      return;
    }

    return handler(req, res);
  });
}

exports.mercadoPagoCreateLeaguePreference = lazyOnRequest(
  "./mercadoPagoCheckoutPro",
  "mercadoPagoCreateLeaguePreference"
);
exports.mercadoPagoCreateTournamentPreference = lazyOnRequest(
  "./mercadoPagoCheckoutPro",
  "mercadoPagoCreateTournamentPreference"
);
exports.mercadoPagoCreateTurnoPreference = lazyOnRequest(
  "./mercadoPagoCheckoutPro",
  "mercadoPagoCreateTurnoPreference"
);
exports.mercadoPagoSyncLeaguePayment = lazyOnRequest(
  "./mercadoPagoCheckoutPro",
  "mercadoPagoSyncLeaguePayment"
);
exports.mercadoPagoSyncTournamentPayment = lazyOnRequest(
  "./mercadoPagoCheckoutPro",
  "mercadoPagoSyncTournamentPayment"
);
exports.mercadoPagoSyncTurnoPayment = lazyOnRequest(
  "./mercadoPagoCheckoutPro",
  "mercadoPagoSyncTurnoPayment"
);
exports.mercadoPagoWebhook = lazyOnRequest("./mercadoPagoCheckoutPro", "mercadoPagoWebhook");

// OAuth queda desacoplado del flujo actual de Checkout Pro.
exports.mercadoPagoOAuthStart = lazyOnRequest("./mercadoPagoOAuth", "mercadoPagoOAuthStart");
exports.mercadoPagoOAuthRedirect = lazyOnRequest("./mercadoPagoOAuth", "mercadoPagoOAuthRedirect");
exports.mercadoPagoOAuthComplete = lazyOnRequest("./mercadoPagoOAuth", "mercadoPagoOAuthComplete");
