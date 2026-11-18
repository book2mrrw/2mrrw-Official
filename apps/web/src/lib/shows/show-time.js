/**
 * Show times are stored as the venue's wall clock: a date ("2026-12-05"), a
 * time as the admin typed it ("6:00pm", "8:00 PM", "20:00") and the venue's
 * IANA time zone. These turn that into the instant it happens, the same on the
 * server (the 2MRRW Live countdown) and in every visitor's browser.
 */

/** Minutes after midnight for "8:00 PM", "6:00pm" or "20:00"; null when unreadable. */
export function parseShowTime(timeStr) {
  if (!timeStr) return null;
  const text = String(timeStr).trim();
  let match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (match) {
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
  }
  match = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  if (hours < 1 || hours > 12 || minutes > 59) return null;
  const pm = match[3].toLowerCase() === "pm";
  if (pm && hours !== 12) hours += 12;
  if (!pm && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

/** The venue's UTC offset in minutes at `instant` (east of UTC is positive). */
function venueOffsetMinutes(instant, venueTz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: venueTz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(instant).map((part) => [part.type, part.value])
  );
  const wallAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return Math.round((wallAsUtc - instant.getTime()) / 60000);
}

/** The instant a show starts (its date and time at the venue), or null. */
export function showStartsAt(dateStr, timeStr, venueTz) {
  const minutes = parseShowTime(timeStr);
  const date = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (minutes === null || !date || !venueTz) return null;
  try {
    const wallAsUtc = Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]), 0, minutes);
    // The offset at the guess, then at the corrected instant (exact across DST changes).
    let instant = wallAsUtc - venueOffsetMinutes(new Date(wallAsUtc), venueTz) * 60000;
    instant = wallAsUtc - venueOffsetMinutes(new Date(instant), venueTz) * 60000;
    return new Date(instant);
  } catch {
    return null;
  }
}

/** "8:00 PM CDT", plus "· 9:00 PM EDT your time" when the viewer is elsewhere. */
export function formatShowTime(dateStr, timeStr, venueTz, viewerTz = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  if (!timeStr) return "";
  const startsAt = showStartsAt(dateStr, timeStr, venueTz);
  if (!startsAt) return timeStr;
  try {
    const clock = { hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short" };
    const atVenue = new Intl.DateTimeFormat("en-US", { ...clock, timeZone: venueTz }).format(startsAt);
    if (!viewerTz || viewerTz === venueTz) return atVenue;
    const forViewer = new Intl.DateTimeFormat("en-US", { ...clock, timeZone: viewerTz }).format(startsAt);
    return forViewer === atVenue ? atVenue : `${atVenue} · ${forViewer} your time`;
  } catch {
    return timeStr;
  }
}
