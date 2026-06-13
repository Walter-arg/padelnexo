const { setGlobalOptions } = require("firebase-functions/v2");

const {
  mercadoPagoCreateTurnoPreference,
  mercadoPagoSyncTurnoPayment,
  mercadoPagoWebhook,
} = require("./mercadoPagoCheckoutPro");
const {
  mercadoPagoOAuthComplete,
  mercadoPagoOAuthRedirect,
  mercadoPagoOAuthStart,
} = require("./mercadoPagoOAuth");

setGlobalOptions({
  maxInstances: 10,
  region: "southamerica-east1",
});

exports.mercadoPagoCreateTurnoPreference = mercadoPagoCreateTurnoPreference;
exports.mercadoPagoSyncTurnoPayment = mercadoPagoSyncTurnoPayment;
exports.mercadoPagoWebhook = mercadoPagoWebhook;

// OAuth queda desacoplado del flujo actual de Checkout Pro.
exports.mercadoPagoOAuthStart = mercadoPagoOAuthStart;
exports.mercadoPagoOAuthRedirect = mercadoPagoOAuthRedirect;
exports.mercadoPagoOAuthComplete = mercadoPagoOAuthComplete;
