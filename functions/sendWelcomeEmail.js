const { logger } = require("firebase-functions/v2");

function buildWelcomeEmailHtml(displayName) {
  const firstName = displayName ? displayName.trim().split(" ")[0] : null;
  const greeting = firstName ? `¡Hola, ${firstName}!` : "¡Bienvenido a PadelNexo!";
  const intro = firstName
    ? `Nos alegra que te hayas sumado a la comunidad. Ya sos parte de PadelNexo.`
    : `Nos alegra que te hayas sumado a la comunidad de pádel amateur más grande de Argentina.`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Bienvenido a PadelNexo</title>
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
              <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#173A2E;">${greeting}</h1>
              <p style="margin:0 0 20px;font-size:15px;color:#5F7D72;line-height:1.65;">${intro}</p>
              <p style="margin:0 0 28px;font-size:15px;color:#5F7D72;line-height:1.65;">
                Con PadelNexo podés:
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="padding:6px 0;font-size:14px;color:#173A2E;line-height:1.5;">
                    🎾 &nbsp;Inscribirte en ligas y torneos de tu zona
                  </td>
                </tr>
                <tr>
                  <td style="padding:6px 0;font-size:14px;color:#173A2E;line-height:1.5;">
                    📅 &nbsp;Reservar turnos en complejos cercanos
                  </td>
                </tr>
                <tr>
                  <td style="padding:6px 0;font-size:14px;color:#173A2E;line-height:1.5;">
                    🤝 &nbsp;Conectar con otros jugadores de tu categoría
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 32px 32px;">
              <p style="margin:0 0 16px;font-size:13px;color:#5F7D72;line-height:1.6;">
                Completá tu perfil para aprovechar al máximo la app y aparecer en las búsquedas de otros jugadores.
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

exports.sendWelcomeEmail = async (user) => {
  const { email, displayName, uid } = user;

  if (!email) {
    logger.warn("[sendWelcomeEmail] Usuario sin email, omitiendo:", uid);
    return;
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    logger.error("[sendWelcomeEmail] RESEND_API_KEY no configurada");
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
        subject: "¡Bienvenido a PadelNexo!",
        html: buildWelcomeEmailHtml(displayName),
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      logger.error("[sendWelcomeEmail] Resend error:", errorData);
      return;
    }

    logger.info("[sendWelcomeEmail] Email de bienvenida enviado a:", email);
  } catch (error) {
    logger.error("[sendWelcomeEmail] Error:", error?.message);
  }
};
