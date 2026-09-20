// pickup_slots.slot_time in the DB is a bare "HH:MM" (no date part) —
// e.g. "17:30", "20:56" — not a full ISO timestamp. `new Date("17:30")`
// returns Invalid Date in JS, which silently breaks:
//   - the availability filter (Invalid Date > now is always false, so
//     every slot looked "already passed" and got filtered out)
//   - any display formatting (would render "Invalid Date")
//
// This builds a real Date by combining today's date with the given time.
// Defensive fallback: if a full timestamp is ever passed instead (e.g. the
// schema changes later to a real timestamptz), it's parsed normally.
export function parseSlotTime(slotTime: string, reference: Date = new Date()): Date {
  const match = /^(\d{1,2}):(\d{2})$/.exec(slotTime.trim());
  if (!match) return new Date(slotTime);

  const [, hh, mm] = match;
  const d = new Date(reference);
  d.setHours(Number(hh), Number(mm), 0, 0);
  return d;
}
