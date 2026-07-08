const admin = require("firebase-admin");
const { logger } = require("firebase-functions/v2");

let adminApp = null;

function getAdminApp() {
  if (!adminApp) {
    adminApp = admin.apps.length ? admin.app() : admin.initializeApp();
  }
  return adminApp;
}

function applyCors(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
}

function buildEmailHtml(resetLink) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Restablecé tu contraseña</title>
</head>
<body style="margin:0;padding:0;background:#F6FBF8;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F6FBF8;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(11,132,87,0.12);">
          <tr>
            <td style="background:#0B8457;padding:28px 32px;text-align:center;">
              <p style="margin:0;font-size:28px;font-weight:900;color:#ffffff;letter-spacing:-0.5px;">PadelNexo</p>
              <p style="margin:6px 0 0;font-size:12px;color:#DFF4EC;letter-spacing:1px;text-transform:uppercase;">Tu app de pádel</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 32px 16px;">
              <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#173A2E;">Restablecé tu contraseña</h1>
              <p style="margin:0 0 28px;font-size:15px;color:#5F7D72;line-height:1.65;">
                Recibimos una solicitud para restablecer la contraseña de tu cuenta en PadelNexo.
                Tocá el botón para crear una nueva contraseña.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${resetLink}"
                       style="display:inline-block;background:#0B8457;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:15px 36px;border-radius:10px;">
                      Restablecer contraseña
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 32px;">
              <p style="margin:0 0 16px;font-size:13px;color:#5F7D72;line-height:1.6;">
                Si no pediste restablecer tu contraseña, podés ignorar este mensaje con tranquilidad.
                Tu cuenta sigue segura.
              </p>
              <p style="margin:0;font-size:12px;color:#5F7D72;border-top:1px solid #CFE7DC;padding-top:16px;">
                PadelNexo &bull; App para pádel amateur en Argentina
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

exports.sendPasswordReset = async (req, res) => {
  applyCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ error: "email_required" });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    logger.error("[sendPasswordReset] RESEND_API_KEY no configurada");
    return res.status(500).json({ error: "email_service_not_configured" });
  }

  try {
    getAdminApp();
    const resetLink = await admin.auth().generatePasswordResetLink(email);

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "PadelNexo <noreply@padelnexo.com.ar>",
        to: [email],
        subject: "Restablecé tu contraseña en PadelNexo",
        html: buildEmailHtml(resetLink),
      }),
    });

    if (!resendResponse.ok) {
      const errorData = await resendResponse.json().catch(() => ({}));
      logger.error("[sendPasswordReset] Resend error:", errorData);
      return res.status(502).json({ error: "email_send_failed" });
    }

    logger.info("[sendPasswordReset] Email enviado a:", email);
    return res.status(200).json({ success: true });
  } catch (error) {
    logger.error("[sendPasswordReset] Error:", error?.message);
    // No exponer si el email existe o no — siempre éxito aparente
    return res.status(200).json({ success: true });
  }
};
