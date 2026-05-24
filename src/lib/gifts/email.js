const BRAND = "2MRRW";
const BRAND_SITE = "https://www.2mrrw.com";

function storefrontBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    BRAND_SITE
  ).replace(/\/+$/, "");
}

export function buildGiftLink(token) {
  return `${storefrontBaseUrl()}/gift/${token}`;
}

function formatExpiry(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildGiftEmailHtml({ itemTitle, message, giftLink, expiresAt, coverUrl }) {
  const expiryLine = formatExpiry(expiresAt);
  const messageHtml = message?.trim()
    ? `<p style="margin:20px 0 0;font-size:15px;line-height:1.7;color:#d4c4ff;font-style:italic;">&ldquo;${escapeHtml(message.trim())}&rdquo;</p>`
    : "";
  const artBlock = coverUrl
    ? `<img src="${escapeHtml(coverUrl)}" alt="" width="280" height="280" style="display:block;width:min(280px,88vw);height:auto;aspect-ratio:1;border-radius:16px;margin:0 auto 24px;border:1px solid rgba(162,89,255,0.35);box-shadow:0 24px 60px rgba(0,0,0,0.55);" />`
    : `<div style="width:200px;height:200px;margin:0 auto 24px;border-radius:16px;background:linear-gradient(135deg,#1a1030,#0a0a12);border:1px solid rgba(162,89,255,0.35);"></div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#050505;font-family:system-ui,-apple-system,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#050505;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;">
        <tr><td style="text-align:center;padding-bottom:8px;">
          <span style="font-size:11px;letter-spacing:4px;color:#00ffff;text-transform:uppercase;font-weight:700;">${BRAND}</span>
        </td></tr>
        <tr><td style="text-align:center;padding-bottom:28px;">
          <h1 style="margin:0;font-size:26px;font-weight:900;color:#ffffff;line-height:1.25;">You received a gift</h1>
          <p style="margin:12px 0 0;font-size:14px;color:#888;line-height:1.6;">${escapeHtml(itemTitle)} is waiting for you.</p>
        </td></tr>
        <tr><td style="text-align:center;background:linear-gradient(180deg,#0d0d14,#080808);border:1px solid #1e1e1e;border-radius:20px;padding:32px 24px;">
          ${artBlock}
          ${messageHtml}
          <a href="${escapeHtml(giftLink)}" style="display:inline-block;margin-top:28px;padding:16px 36px;background:#00ffff;color:#000000;font-size:13px;font-weight:900;text-decoration:none;border-radius:10px;letter-spacing:1px;text-transform:uppercase;">Open Your Gift</a>
          <p style="margin:24px 0 0;font-size:12px;color:#666;line-height:1.6;">Claim within 15 days${expiryLine ? ` — expires ${escapeHtml(expiryLine)}` : ""}.</p>
        </td></tr>
        <tr><td style="text-align:center;padding-top:28px;font-size:11px;color:#444;line-height:1.6;">
          <a href="${BRAND_SITE}" style="color:#555;text-decoration:none;">${BRAND_SITE.replace(/^https?:\/\//, "")}</a><br/>
          &mdash; ${BRAND}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function sendGiftEmail({
  to,
  itemTitle,
  message,
  giftLink,
  expiresAt,
  coverUrl,
}) {
  const subject = `${BRAND} gifted you something special`;
  const expiryLine = formatExpiry(expiresAt);
  const messageBlock = message?.trim() ? `\n\n"${message.trim()}"\n` : "";
  const text = `${BRAND} has gifted you: ${itemTitle}${messageBlock}

Open your gift:
${giftLink}

This gift expires in 15 days${expiryLine ? ` on ${expiryLine}` : ""}.

— ${BRAND}`;

  const html = buildGiftEmailHtml({ itemTitle, message, giftLink, expiresAt, coverUrl });

  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    const from = process.env.GIFT_EMAIL_FROM || "2MRRW <gifts@2mrrw.com>";
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        text,
        html,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.warn("gift email send failed:", response.status, body);
      return { sent: false, subject, text };
    }
    return { sent: true, subject, text };
  }

  console.info("[gift-email]", { to, subject, giftLink });
  return { sent: false, subject, text, loggedOnly: true };
}

export async function sendGiftReminderEmail({
  to,
  itemTitle,
  giftLink,
  expiresAt,
  coverUrl,
}) {
  const subject = `Your gift from ${BRAND} expires in 5 days`;
  const text = `You have an unclaimed gift: ${itemTitle}

Open your gift:
${giftLink}

Expires: ${formatExpiry(expiresAt)}

— ${BRAND}`;

  const html = buildGiftEmailHtml({
    itemTitle,
    message: "Your gift is still waiting — claim it before it expires.",
    giftLink,
    expiresAt,
    coverUrl,
  });

  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    const from = process.env.GIFT_EMAIL_FROM || "2MRRW <gifts@2mrrw.com>";
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, text, html }),
    });
    if (!response.ok) {
      console.warn("gift reminder email failed:", response.status);
      return { sent: false };
    }
    return { sent: true };
  }

  console.info("[gift-reminder-email]", { to, subject, giftLink });
  return { sent: false, loggedOnly: true };
}
