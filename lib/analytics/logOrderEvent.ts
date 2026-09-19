import { supabase } from "@/lib/supabaseClient";

/**
 * Record a status transition in `order_events` (raw source for the Average
 * Pickup Waiting Time metric). Fire-and-forget: call it right after a
 * successful `orders.status` write, don't await it, and it never throws — a
 * failed insert is a console warning, not a broken kitchen screen.
 */
export function logOrderEvent(orderId: string, status: string): void {
  try {
    void supabase
      .from("order_events")
      .insert({ order_id: orderId, status })
      .then(({ error }) => {
        if (error) {
          console.warn(`[order_events] failed to log ${status} for order ${orderId}:`, error.message);
        }
      });
  } catch (err) {
    console.warn(`[order_events] failed to log ${status} for order ${orderId}:`, err);
  }
}
