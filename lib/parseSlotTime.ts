/**
 * pickup_slots.slot_time is stored as a human range like "17:00 - 17:15".
 * The dashboard needs a real, comparable timestamp for sorting and for the
 * rush-hour "within 5 minutes" check, so we anchor the START of the range to
 * a calendar day (today by default) in the browser's local timezone — the
 * kitchen tablets run in Asia/Almaty, the same zone the slots are defined in.
 */

const START_RE = /^\s*(\d{1,2}):(\d{2})/;

/** "17:00 - 17:15" → "17:00"; null when the string doesn't start with HH:MM. */
export function slotStartLabel(slotTimeRange: string | undefined | null): string | null {
  if (!slotTimeRange) return null;
  const m = START_RE.exec(slotTimeRange);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

/**
 * Start of a slot as a Date on `referenceDate`'s calendar day (local time).
 * Returns an Invalid Date (`Number.isNaN(d.getTime())`) for unparseable input
 * so callers can sort it last / treat it as "no slot" instead of throwing.
 */
export function parseSlotStart(slotTimeRange: string, referenceDate: Date = new Date()): Date {
  const m = START_RE.exec(slotTimeRange ?? "");
  if (!m) return new Date(NaN);
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return new Date(NaN);

  const d = new Date(referenceDate);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

/** Convenience: epoch millis of the slot start, or +Infinity when unknown (sorts last). */
export function slotStartMillis(slotTimeRange: string | undefined | null, referenceDate?: Date): number {
  if (!slotTimeRange) return Number.POSITIVE_INFINITY;
  const t = parseSlotStart(slotTimeRange, referenceDate).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}
