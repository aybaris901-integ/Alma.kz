import type { Order, OrderItem, OrderStatus } from "@/types/shared";

/**
 * Raw `orders` row as Supabase returns it, optionally with the joined
 * `pickup_slots(slot_time)` relation from the dashboard's select.
 */
export interface DbOrderRow {
  id: string;
  order_number: string | number;
  guest_id: string | null;
  restaurant_id: string;
  slot_id: string | null;
  items: unknown; // jsonb — shape not confirmed by backend yet, parsed defensively below
  total_amount: number | string | null;
  status: string;
  qr_token: string | null;
  payment_status?: string | null;
  created_at?: string | null;
  ready_at?: string | null;
  picked_up_at?: string | null;
  /** Present only when the query joins pickup_slots. May be an object or a 1-element array. */
  pickup_slots?: { slot_time: string | null } | { slot_time: string | null }[] | null;
}

const KNOWN_STATUSES: ReadonlySet<string> = new Set<OrderStatus>([
  "Created",
  "Preparing",
  "Ready",
  "PickedUp",
  "Cancelled",
  "Rejected",
  "NoShow",
  "Delayed",
]);

// ---------------------------------------------------------------------------
// items (jsonb)
// ---------------------------------------------------------------------------

type Loose = Record<string, unknown>;

/** First defined value among several candidate keys (snake_case / camelCase). */
function pick(obj: Loose, ...keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

// Warn about each unexpected shape once per session, not once per row.
const warnedShapes = new Set<string>();
function warnOnce(key: string, message: string, sample: unknown) {
  if (warnedShapes.has(key)) return;
  warnedShapes.add(key);
  console.warn(`[orders adapter] ${message}`, sample);
}

/**
 * Parse the jsonb `items` column into OrderItem[].
 *
 * Accepts an array (or a JSON string of one) of objects keyed either
 * snake_case or camelCase: menu_item_id/menuItemId, quantity/qty, price/
 * price_at_order/priceAtOrder, plus an optional id and name/title. Entries
 * that don't yield a menu item id are dropped with a warning so a bad payload
 * is visible in the console instead of silently rendering nothing.
 */
export function parseOrderItems(raw: unknown, orderId: string): OrderItem[] {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      warnOnce("items-not-json", `orders.items for ${orderId} is a string but not valid JSON:`, raw);
      return [];
    }
  }
  if (value == null) return [];
  if (!Array.isArray(value)) {
    warnOnce("items-not-array", `orders.items for ${orderId} is not an array (got ${typeof value}):`, value);
    return [];
  }

  const items: OrderItem[] = [];
  value.forEach((entry, i) => {
    if (typeof entry !== "object" || entry === null) {
      warnOnce("item-not-object", `orders.items[${i}] for ${orderId} is not an object:`, entry);
      return;
    }
    const obj = entry as Loose;
    const menuItemId = asString(pick(obj, "menu_item_id", "menuItemId", "menu_item", "menuItem", "item_id", "itemId", "id"));
    if (!menuItemId) {
      warnOnce(
        "item-no-menu-id",
        `orders.items[${i}] for ${orderId} has no menu_item_id/menuItemId — keys were ${JSON.stringify(Object.keys(obj))}:`,
        entry,
      );
      return;
    }
    const quantity = asNumber(pick(obj, "quantity", "qty", "count"));
    if (quantity === undefined) {
      warnOnce("item-no-quantity", `orders.items[${i}] for ${orderId} has no numeric quantity — defaulting to 1:`, entry);
    }
    const price = asNumber(pick(obj, "price_at_order", "priceAtOrder", "price", "unit_price", "unitPrice"));
    if (price === undefined) {
      warnOnce("item-no-price", `orders.items[${i}] for ${orderId} has no numeric price — defaulting to 0:`, entry);
    }
    const name = asString(pick(obj, "name", "title"));

    items.push({
      id: asString(pick(obj, "id", "order_item_id", "orderItemId")) ?? `${orderId}:${i}`,
      menuItemId,
      quantity: quantity ?? 1,
      priceAtOrder: price ?? 0,
      ...(name ? { name } : {}),
    });
  });
  return items;
}

// ---------------------------------------------------------------------------
// Row → Order
// ---------------------------------------------------------------------------

/** The joined pickup_slots relation may come back as an object or a 1-element array. */
export function slotTimeFromRow(row: Pick<DbOrderRow, "pickup_slots">): string | undefined {
  const rel = row.pickup_slots;
  if (!rel) return undefined;
  const slot = Array.isArray(rel) ? rel[0] : rel;
  return slot?.slot_time ?? undefined;
}

/**
 * Convert a raw Supabase `orders` row into the app's Order shape.
 *
 * `slotTime` is the raw pickup_slots.slot_time range ("17:00 - 17:15"); use
 * lib/parseSlotTime to turn it into a comparable Date. When the row has no
 * joined slot (e.g. a realtime payload), pass `slotTimeOverride` from a
 * slot_id → slot_time lookup.
 */
export function mapDbOrderToAppOrder(row: DbOrderRow, slotTimeOverride?: string): Order {
  const status = String(row.status);
  if (!KNOWN_STATUSES.has(status)) {
    warnOnce(`status-${status}`, `orders.status "${status}" is not a known OrderStatus (order ${row.id}) — UI may not label it.`, row);
  }

  const totalAmount = asNumber(row.total_amount);
  if (totalAmount === undefined) {
    warnOnce("total-not-number", `orders.total_amount for ${row.id} is not numeric — defaulting to 0:`, row.total_amount);
  }

  return {
    id: String(row.id),
    orderNumber: String(row.order_number ?? ""),
    restaurantId: String(row.restaurant_id ?? ""),
    guestSessionId: row.guest_id ?? "",
    pickupSlotId: row.slot_id ?? "",
    status: status as OrderStatus,
    totalAmount: totalAmount ?? 0,
    qrToken: row.qr_token ?? "",
    items: parseOrderItems(row.items, String(row.id)),
    createdAt: row.created_at ?? "",
    readyAt: row.ready_at ?? undefined,
    pickedUpAt: row.picked_up_at ?? undefined,
    slotTime: slotTimeOverride ?? slotTimeFromRow(row),
  };
}
