/**
 * Pickup waiting time = how long a finished order sat on the counter:
 * the gap between an order's "Ready" event and its "PickedUp" event.
 * Computed purely from order_events rows so it can be unit-tested and reused.
 */

export interface OrderEventRow {
  order_id: string;
  status: string;
  changed_at: string;
}

export interface PickupStats {
  /** Orders with a PickedUp event in the window. */
  completed: number;
  /** Mean Ready→PickedUp gap in seconds across `completed` orders that also have a Ready event; null when none. */
  averageWaitSec: number | null;
  /** How many of `completed` contributed to the average (a PickedUp with no prior Ready is skipped). */
  measured: number;
}

/** Target the kitchen is measured against: hand-over within two minutes of Ready. */
export const PICKUP_TARGET_SEC = 120;

export function computePickupStats(events: OrderEventRow[]): PickupStats {
  const byOrder = new Map<string, OrderEventRow[]>();
  for (const e of events) {
    const list = byOrder.get(e.order_id);
    if (list) list.push(e);
    else byOrder.set(e.order_id, [e]);
  }

  let completed = 0;
  let measured = 0;
  let totalSec = 0;

  Array.from(byOrder.values()).forEach((list) => {
    list.sort((a, b) => Date.parse(a.changed_at) - Date.parse(b.changed_at));
    // Last PickedUp wins; the Ready we measure from is the latest one before it
    // (an order bounced back to Preparing and re-readied counts from the re-ready).
    let pickedUpAt: number | null = null;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].status === "PickedUp") {
        pickedUpAt = Date.parse(list[i].changed_at);
        break;
      }
    }
    if (pickedUpAt === null || Number.isNaN(pickedUpAt)) return;
    completed++;

    let readyAt: number | null = null;
    for (const e of list) {
      const t = Date.parse(e.changed_at);
      if (e.status === "Ready" && t <= pickedUpAt) readyAt = t;
    }
    if (readyAt === null) return;
    measured++;
    totalSec += (pickedUpAt - readyAt) / 1000;
  });

  return { completed, measured, averageWaitSec: measured ? totalSec / measured : null };
}

/** 95 → "1:35"; rounds to whole seconds. */
export function formatMinSec(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
