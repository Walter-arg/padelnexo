const { setGlobalOptions } = require("firebase-functions/v2");
const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const v1 = require("firebase-functions/v1");

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

exports.sendPasswordReset = lazyOnRequest("./sendPasswordReset", "sendPasswordReset", {
  invoker: "public",
  secrets: ["RESEND_API_KEY"],
});

// Acciones administrativas: requieren token de Firebase Auth verificado en el
// servidor (Authorization: Bearer <idToken>) y que quien llama sea admin.
// El cliente ya no puede escribir estos campos directamente via Firestore.
exports.grantAdminAccess = lazyOnRequest("./adminActions", "grantAdminAccess");
exports.revokeAdminAccess = lazyOnRequest("./adminActions", "revokeAdminAccess");
exports.revokeOrganizerAccess = lazyOnRequest("./adminActions", "revokeOrganizerAccess");
exports.blockUserAccount = lazyOnRequest("./adminActions", "blockUserAccount");
exports.restoreUserAccount = lazyOnRequest("./adminActions", "restoreUserAccount");
exports.deleteUserAccount = lazyOnRequest("./adminActions", "deleteUserAccount");
exports.assignOrganizerPlan = lazyOnRequest("./adminActions", "assignOrganizerPlan", {
  invoker: "public",
  secrets: ["RESEND_API_KEY"],
});
exports.revokeOrganizerPlan = lazyOnRequest("./adminActions", "revokeOrganizerPlan");
exports.updateUserProfileAsAdmin = lazyOnRequest("./adminActions", "updateUserProfileAsAdmin");
exports.archiveLeagueAsAdmin = lazyOnRequest("./adminActions", "archiveLeagueAsAdmin");
exports.restoreLeagueAsAdmin = lazyOnRequest("./adminActions", "restoreLeagueAsAdmin");
exports.cancelTournamentAsAdmin = lazyOnRequest("./adminActions", "cancelTournamentAsAdmin");
exports.restoreTournamentAsAdmin = lazyOnRequest("./adminActions", "restoreTournamentAsAdmin");
exports.approveOrganizerRequest = lazyOnRequest("./adminActions", "approveOrganizerRequest", {
  invoker: "public",
  secrets: ["RESEND_API_KEY"],
});
exports.rejectOrganizerRequest = lazyOnRequest("./adminActions", "rejectOrganizerRequest");
exports.deleteOrganizerRequest = lazyOnRequest("./adminActions", "deleteOrganizerRequest");
exports.approveComplexRequest = lazyOnRequest("./adminActions", "approveComplexRequest");
exports.deleteComplexRequestAsAdmin = lazyOnRequest(
  "./adminActions",
  "deleteComplexRequestAsAdmin"
);
exports.listAdminUsersData = lazyOnRequest("./adminActions", "listAdminUsersData");

// Revisa una vez por dia los planes de organizador: pasa a "expired" los
// que ya vencieron, y avisa por email a los que vencen en menos de 3 dias.
exports.checkPlanExpirations = onSchedule(
  {
    schedule: "every day 09:00",
    timeZone: "America/Argentina/Buenos_Aires",
    secrets: ["RESEND_API_KEY"],
  },
  async () => {
    const { checkPlanExpirationsHandler } = require("./checkPlanExpirations");
    await checkPlanExpirationsHandler();
  }
);

exports.sendWelcomeEmail = v1
  .runWith({ secrets: ["RESEND_API_KEY"] })
  .auth.user()
  .onCreate(async (user) => {
    const { sendWelcomeEmail } = require("./sendWelcomeEmail");
    return sendWelcomeEmail({
      email: user.email,
      displayName: user.displayName || "",
      uid: user.uid,
    });
  });
