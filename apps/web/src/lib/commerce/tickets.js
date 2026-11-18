import { sendTransactionalEmail } from "@/lib/server/email";
import { formatTicketPrice } from "@/lib/commerce/ticket-price";

export { MIN_PAID_TICKET_CENTS, formatTicketPrice, ticketPriceError } from "@/lib/commerce/ticket-price";

/**
 * Show tickets: what follows a confirmed ticket, shared by
 * checkout (free claims), the buyer's confirmation after an in-page card
 * payment (/api/tickets/confirm) and the Stripe webhook.
 *
 * Server only (it sends email); the price rules themselves live in
 * ticket-price.js. A confirmed ticket is a ticket_purchases row with status
 * "paid", whatever it cost.
 */

/** Claim a free ticket: confirmed at once, no payment. */
export async function recordFreeTicket(admin, { userId, show, quantity, email = null, phone = null }) {
  const { error } = await admin.from("ticket_purchases").insert({
    user_id: userId,
    show_id: show.id,
    stripe_payment_intent_id: null,
    email,
    phone,
    quantity,
    price_cents: 0,
    status: "paid",
  });
  if (error) throw error;
  await decrementShowStock(admin, show.id, quantity);
  await sendTicketConfirmation({
    to: email,
    showName: show.name,
    location: show.location,
    showDate: show.event_date,
    showTime: show.event_time,
    quantity,
    amountCents: 0,
  });
}

/** Non-fatal: the ticket is already recorded. */
export async function decrementShowStock(admin, showId, quantity) {
  try {
    const { data: showRow } = await admin
      .from("shows_events")
      .select("tickets_available")
      .eq("id", showId)
      .single();
    if (showRow && showRow.tickets_available !== null) {
      await admin
        .from("shows_events")
        .update({ tickets_available: Math.max(0, showRow.tickets_available - quantity) })
        .eq("id", showId);
    }
  } catch (err) {
    console.warn("[tickets] ticket count decrement failed", showId, err?.message);
  }
}

/** Non-fatal: the ticket stands even if the email does not send. */
export async function sendTicketConfirmation({ to, showName, location, showDate, showTime, quantity, amountCents }) {
  if (!to) return;
  try {
    const date = showDate
      ? new Date(showDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
      : "";
    const { subject, html, text } = buildTicketConfirmationEmail({
      name: "",
      showName: showName || "2MRRW Live",
      location: location || "",
      date,
      time: showTime || "",
      quantity,
      amountCents,
    });
    await sendTransactionalEmail({ to, subject, html, text });
  } catch (err) {
    console.warn("[tickets] ticket confirmation email failed", err?.message);
  }
}

export function buildTicketConfirmationEmail({ name, showName, location, date, time, quantity, amountCents }) {
  const total = formatTicketPrice(amountCents);
  const greeting = name ? `Hey ${name},` : "Hey,";
  const text = `${greeting}\n\nYour ticket${quantity > 1 ? "s are" : " is"} confirmed!\n\n${showName}\n${location}\n${date}${time ? ` · ${time}` : ""}\n\nQuantity: ${quantity}\nTotal: ${total}\n\nSee you there.\n\n— 2MRRW`;
  const html = `<p>${greeting}</p><p>Your ticket${quantity > 1 ? "s are" : " is"} confirmed.</p><h2>${showName}</h2><p>${location}<br/>${date}${time ? ` · ${time}` : ""}</p><p>Qty: ${quantity} · Total: ${total}</p><p>See you there.<br/>— 2MRRW</p>`;
  return { subject: `Your ticket — ${showName}`, html, text };
}
