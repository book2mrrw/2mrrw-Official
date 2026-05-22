const BRAND = "2MRRW";

function storefrontBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    "https://artist-platform-silk.vercel.app"
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

export async function sendGiftEmail({ to, itemTitle, message, giftLink, expiresAt }) {
  const subject = `${BRAND} gifted you something special`;
  const expiryLine = formatExpiry(expiresAt);
  const messageBlock = message?.trim()
    ? `\n\n"${message.trim()}"\n`
    : "";
  const text = `Tomorrow has gifted you: ${itemTitle}${messageBlock}

Claim your gift here:
${giftLink}

This gift expires in 15 days${expiryLine ? ` on ${expiryLine}` : ""}.

— ${BRAND}`;

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

export async function sendGiftReminderEmail({ to, itemTitle, giftLink, expiresAt }) {
  const subject = `Your gift from ${BRAND} expires in 5 days`;
  const text = `You have an unclaimed gift: ${itemTitle}

Claim it here:
${giftLink}

Expires: ${formatExpiry(expiresAt)}

— ${BRAND}`;

  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    const from = process.env.GIFT_EMAIL_FROM || "2MRRW <gifts@2mrrw.com>";
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, text }),
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
