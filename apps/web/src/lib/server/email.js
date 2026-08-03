const BRAND = "2MRRW";
const BRAND_SITE = "https://www.2mrrw.com";

function storefrontBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    BRAND_SITE
  ).replace(/\/+$/, "");
}

function transactionalFrom() {
  return process.env.TRANSACTIONAL_EMAIL_FROM || `${BRAND} <no-reply@2mrrw.com>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function emailShell(content) {
  const base = storefrontBaseUrl();
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#050505;font-family:system-ui,-apple-system,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#050505;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;">
        <tr><td style="text-align:center;padding-bottom:32px;">
          <span style="font-size:11px;letter-spacing:4px;color:#00ffff;text-transform:uppercase;font-weight:700;">${BRAND}</span>
        </td></tr>
        ${content}
        <tr><td style="text-align:center;padding-top:28px;font-size:11px;color:#444;line-height:1.6;">
          <a href="${base}" style="color:#555;text-decoration:none;">${base.replace(/^https?:\/\//, "")}</a><br/>
          &mdash; ${BRAND}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Send a transactional email via Resend.
 * Non-fatal: if RESEND_API_KEY is absent or the request fails, logs and returns { sent: false }.
 */
export async function sendTransactionalEmail({ to, subject, html, text }) {
  if (!to) return { sent: false };
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.info("[email] no RESEND_API_KEY — logged only", { to, subject });
    return { sent: false, loggedOnly: true };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: transactionalFrom(),
        to: [to],
        subject,
        text: text || subject,
        html,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn("[email] send failed", res.status, body.slice(0, 200), { to, subject });
      return { sent: false };
    }
    return { sent: true };
  } catch (err) {
    console.warn("[email] send error", err?.message, { to, subject });
    return { sent: false };
  }
}

export function buildPurchaseConfirmationEmail({ name, items, amountCents }) {
  const base = storefrontBaseUrl();
  const displayName = name ? escapeHtml(name.trim().split(/\s+/)[0]) : "there";
  const total = typeof amountCents === "number"
    ? (amountCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
    : "";

  const itemRows = Array.isArray(items) && items.length > 0
    ? items.map((item) =>
        `<tr>
          <td style="padding:10px 0;font-size:14px;color:#ffffff;border-bottom:1px solid #181818;">${escapeHtml(item.title || item.slug || "Item")}</td>
          <td style="padding:10px 0;font-size:14px;color:#aaa;text-align:right;border-bottom:1px solid #181818;">${item.price != null ? `$${Number(item.price).toFixed(2)}` : ""}</td>
        </tr>`
      ).join("")
    : `<tr><td colspan="2" style="padding:10px 0;font-size:14px;color:#888;">Your purchase</td></tr>`;

  const totalRow = total
    ? `<tr>
        <td style="padding:14px 0 0;font-size:12px;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Total</td>
        <td style="padding:14px 0 0;font-size:15px;color:#ffffff;font-weight:900;text-align:right;">${escapeHtml(total)}</td>
      </tr>`
    : "";

  const html = emailShell(`
    <tr><td style="text-align:center;padding-bottom:28px;">
      <h1 style="margin:0;font-size:24px;font-weight:900;color:#ffffff;line-height:1.25;">Order confirmed, ${displayName}</h1>
      <p style="margin:10px 0 0;font-size:14px;color:#888;">Your music is ready in your library.</p>
    </td></tr>
    <tr><td style="background:linear-gradient(180deg,#0d0d14,#080808);border:1px solid #1e1e1e;border-radius:20px;padding:28px 24px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        ${itemRows}
        ${totalRow}
      </table>
      <div style="text-align:center;margin-top:24px;">
        <a href="${base}" style="display:inline-block;padding:14px 32px;background:#00ffff;color:#000000;font-size:12px;font-weight:900;text-decoration:none;border-radius:10px;letter-spacing:1px;text-transform:uppercase;">Go to My Library</a>
      </div>
    </td></tr>
  `);

  const itemList = Array.isArray(items)
    ? items.map((i) => `• ${i.title || i.slug}`).join("\n")
    : "";
  const text = [
    `Order confirmed, ${name || "there"}.`,
    `Your music is ready in your library.`,
    "",
    itemList,
    total ? `\nTotal: ${total}` : "",
    `\nVisit ${base} to listen.\n\n— ${BRAND}`,
  ].join("\n").replace(/\n{3,}/g, "\n\n").trim();

  return { subject: `${BRAND} — Your order is confirmed`, html, text };
}

export function buildMembershipWelcomeEmail({ name }) {
  const base = storefrontBaseUrl();
  const displayName = name ? escapeHtml(name.trim().split(/\s+/)[0]) : "there";
  const html = emailShell(`
    <tr><td style="text-align:center;padding-bottom:28px;">
      <h1 style="margin:0;font-size:24px;font-weight:900;color:#ffffff;line-height:1.25;">Welcome to the Inner Circle, ${displayName}</h1>
      <p style="margin:10px 0 0;font-size:14px;color:#888;">You now have full access to the 2MRRW digital ecosystem.</p>
    </td></tr>
    <tr><td style="background:linear-gradient(180deg,#0d0d14,#080808);border:1px solid #1e1e1e;border-radius:20px;padding:28px 24px;text-align:center;">
      <p style="margin:0 0 6px;font-size:13px;color:#888;text-transform:uppercase;letter-spacing:2px;font-weight:700;">What&apos;s unlocked</p>
      <p style="margin:12px 0 6px;font-size:15px;color:#ffffff;">Full streaming catalog</p>
      <p style="margin:0 0 6px;font-size:15px;color:#ffffff;">Vault &mdash; exclusive content &amp; archives</p>
      <p style="margin:0 0 6px;font-size:15px;color:#ffffff;">Premium livestreams</p>
      <p style="margin:0 0 24px;font-size:15px;color:#ffffff;">Inner Circle community</p>
      <a href="${base}" style="display:inline-block;padding:14px 32px;background:#00ffff;color:#000000;font-size:12px;font-weight:900;text-decoration:none;border-radius:10px;letter-spacing:1px;text-transform:uppercase;">Start Exploring</a>
    </td></tr>
  `);

  const text = [
    `Welcome to the 2MRRW Inner Circle, ${name || "there"}.`,
    ``,
    `You now have full access:`,
    `• Full streaming catalog`,
    `• Vault — exclusive content & archives`,
    `• Premium livestreams`,
    `• Inner Circle community`,
    ``,
    `Visit ${base} to get started.\n\n— ${BRAND}`,
  ].join("\n");

  return { subject: `Welcome to the 2MRRW Inner Circle`, html, text };
}

export function buildWelcomeEmail({ name }) {
  const base = storefrontBaseUrl();
  const displayName = name ? escapeHtml(name.trim().split(/\s+/)[0]) : "there";
  const html = emailShell(`
    <tr><td style="text-align:center;padding-bottom:28px;">
      <h1 style="margin:0;font-size:24px;font-weight:900;color:#ffffff;line-height:1.25;">Welcome, ${displayName}</h1>
      <p style="margin:10px 0 0;font-size:14px;color:#888;">You&apos;re in. The music is ready.</p>
    </td></tr>
    <tr><td style="background:linear-gradient(180deg,#0d0d14,#080808);border:1px solid #1e1e1e;border-radius:20px;padding:28px 24px;text-align:center;">
      <p style="margin:0 0 24px;font-size:15px;color:#d4c4ff;line-height:1.7;">Browse the catalog, purchase releases, collect music, and unlock exclusive content as a member or collector.</p>
      <a href="${base}" style="display:inline-block;padding:14px 32px;background:#00ffff;color:#000000;font-size:12px;font-weight:900;text-decoration:none;border-radius:10px;letter-spacing:1px;text-transform:uppercase;">Start Listening</a>
    </td></tr>
  `);

  const text = [
    `Welcome, ${name || "there"}.`,
    ``,
    `You're in. The music is ready.`,
    ``,
    `Browse the catalog, purchase releases, collect music, and unlock exclusive content.`,
    ``,
    `Visit ${base} to get started.\n\n— ${BRAND}`,
  ].join("\n");

  return { subject: `Welcome to 2MRRW`, html, text };
}
