const { logger } = require("firebase-functions/v2");

function buildExpirationWarningEmailHtml({ name, planLabel, expiresAtLabel }) {
  const firstName = name ? String(name).trim().split(" ")[0] : "";
  const greeting = firstName ? `Hola, ${firstName}` : "Hola";

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Tu plan esta por vencer</title>
</head>
<body style="margin:0;padding:0;background:#F6FBF8;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F6FBF8;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 16px rgba(11,132,87,0.12);">
          <tr>
            <td style="background:#0B8457;padding:28px 32px;text-align:center;">
              <p style="margin:0;font-size:28px;font-weight:900;color:#ffffff;letter-spacing:-0.5px;">PadelNexo</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 32px 16px;">
              <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#173A2E;">${greeting}, tu plan esta por vencer</h1>
              <p style="margin:0 0 20px;font-size:15px;color:#5F7D72;line-height:1.65;">
                Tu <strong>${planLabel}</strong> vence el <strong>${expiresAtLabel}</strong>. Si no lo renovas antes de esa fecha, vas a perder el acceso a las funciones de organizador (crear ligas, torneos y turnos) hasta que renueves.
              </p>
              <p style="margin:0 0 8px;font-size:15px;color:#5F7D72;line-height:1.65;">
                Para renovarlo, contactate con el equipo de PadelNexo.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 32px;">
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

async function sendPlanExpirationWarningEmail({ email, name, planLabel, expiresAtLabel }) {
  if (!email) {
    return;
  }

  const resendApiKey = process.env.RESEND_API_KEY;

  if (!resendApiKey) {
    logger.error("[sendPlanExpirationWarning] RESEND_API_KEY no configurada");
    return;
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "PadelNexo <noreply@padelnexo.com.ar>",
        to: [email],
        subject: "Tu plan de PadelNexo esta por vencer",
        html: buildExpirationWarningEmailHtml({ name, planLabel, expiresAtLabel }),
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logger.error("[sendPlanExpirationWarning] Resend error:", errorData);
      return;
    }

    logger.info("[sendPlanExpirationWarning] Aviso de vencimiento enviado a:", email);
  } catch (error) {
    logger.error("[sendPlanExpirationWarning] Error:", error?.message);
  }
}

module.exports = { sendPlanExpirationWarningEmail };
