function normalizeE164(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === "1") return `+${digits}`;
  if (digits.length > 11) return `+${digits}`;
  return null;
}

export async function sendSMS({ to, body }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const from       = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !from) {
    console.warn("[twilio] credentials not configured");
    return { ok: false };
  }

  const normalized = normalizeE164(to);
  if (!normalized) {
    console.warn("[twilio] invalid phone number:", to);
    return { ok: false };
  }

  try {
    const creds = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${creds}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: normalized, From: from, Body: body }).toString(),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      console.error("[twilio] send failed:", data?.message || data);
      return { ok: false };
    }
    return { ok: true, sid: data.sid };
  } catch (err) {
    console.error("[twilio] fetch error:", err?.message);
    return { ok: false };
  }
}
