const { logger } = require("firebase-functions/v2");

function buildPlanActivationEmailHtml({ name, planLabel, isTrial, expiresAtLabel, isNewOrganizer }) {
  const firstName = name ? String(name).trim().split(" ")[0] : "";
  const greeting = firstName ? `Hola, ${firstName}` : "Hola";
  const intro = isNewOrganizer
    ? `Tu cuenta de organizador en PadelNexo ya fue aprobada, y además te activamos`
    : `Te activamos`;
  const planPhrase = isTrial
    ? `${planLabel} de prueba, valido hasta el <strong>${expiresAtLabel}</strong>`
    : `${planLabel}, valido hasta el <strong>${expiresAtLabel}</strong>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Tu plan de PadelNexo esta activo</title>
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
              <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#173A2E;">${greeting}!</h1>
              <p style="margin:0 0 20px;font-size:15px;color:#5F7D72;line-height:1.65;">
                ${intro} <strong>${planPhrase}</strong>.
              </p>
              <p style="margin:0 0 8px;font-size:15px;color:#5F7D72;line-height:1.65;">
                Ya podés crear ligas, torneos y administrar turnos desde la app.
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

async function sendPlanActivationEmail({ email, name, planLabel, isTrial, expiresAtLabel, isNewOrganizer }) {
  if (!email) {
    return;
  }

  const resendApiKey = process.env.RESEND_API_KEY;

  if (!resendApiKey) {
    logger.error("[sendPlanActivationEmail] RESEND_API_KEY no configurada");
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
        subject: isNewOrganizer
          ? "Ya sos organizador en PadelNexo"
          : "Tu plan de PadelNexo esta activo",
        html: buildPlanActivationEmailHtml({
          name,
          planLabel,
          isTrial,
          expiresAtLabel,
          isNewOrganizer,
        }),
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logger.error("[sendPlanActivationEmail] Resend error:", errorData);
      return;
    }

    logger.info("[sendPlanActivationEmail] Email de activacion de plan enviado a:", email);
  } catch (error) {
    logger.error("[sendPlanActivationEmail] Error:", error?.message);
  }
}

module.exports = { sendPlanActivationEmail };
