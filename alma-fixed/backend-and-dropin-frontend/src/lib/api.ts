import { supabase } from './supabaseClient';
import type { Restaurant, MenuItem, PickupSlot, Order, OrderItem } from '../../types/shared';

// ---------------------------------------------------------------------------
// Guest session
// Anonymous sign-in gives every visitor a stable auth.uid() (no login form)
// so RLS can scope orders to "their own", per supabase/migrations/0002_rls.sql.
// Enable it in Supabase Dashboard -> Authentication -> Providers -> Anonymous.
// ---------------------------------------------------------------------------
export async function ensureGuestSession() {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;

  const { data: signInData, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return signInData.session;
}

// ---------------------------------------------------------------------------
// Error normalisation.
// create_order() in migration 0001 raises distinct SQLSTATE codes (EMPT1,
// SLTRQ, SLTFU, ...) with stable human-readable messages. Depending on the
// supabase-js / PostgREST version the failing shape differs, so map by code
// first and fall back to whatever message text exists.
// ---------------------------------------------------------------------------
const ERROR_TEXT: Record<string, string> = {
  NOSES: 'Sign-in is required to place an order. Please reload the page.',
  EMPT1: 'Your cart is empty.',
  RSTAV: 'This restaurant is not available right now.',
  SLTRQ: 'Please choose a pickup time.',
  SLTWT: 'That pickup time is not available at this restaurant.',
  SLTOF: 'This pickup time is no longer offered.',
  SLTPT: 'That pickup time has already passed.',
  SLTLT: 'You already have an open order for this pickup time.',
  SLTFU: 'This pickup time is fully booked. Please pick another one.',
  ITMUN: 'One of the items in your cart is no longer available.',
  QTYIN: 'Item quantity must be a whole number between 1 and 99.',
  ORDCN: 'This order can no longer be cancelled.',
};

export function getErrorMessage(err: unknown): string {
  const maybe = err as { code?: string; message?: string } | null;
  if (maybe?.code && ERROR_TEXT[maybe.code]) return ERROR_TEXT[maybe.code];
  if (maybe?.message) return maybe.message;
  return 'Something went wrong. Please try again.';
}

// ---------------------------------------------------------------------------
// Catalog reads (was GET /api/restaurants)
// ---------------------------------------------------------------------------
export async function getRestaurants(): Promise<Restaurant[]> {
  const { data, error } = await supabase.from('restaurants').select('*');
  if (error) throw error;
  return data ?? [];
}

// (was GET /api/menu?restaurantId=...)
export async function getMenuItems(restaurantId: string): Promise<MenuItem[]> {
  const { data, error } = await supabase
    .from('menu_items')
    .select('*')
    .eq('restaurant_id', restaurantId);
  if (error) throw error;
  return data ?? [];
}

// (was GET /api/pickup-slots?restaurantId=...)
// Only slots that are bookable RIGHT NOW are returned: enough free capacity
// AND in the future. The previous version kept showing "5 spots left" for
// slots that were actually gone (already fully booked in another tab, or
// seeded more than 3 hours ago and now in the past).
export async function getAvailablePickupSlots(restaurantId: string): Promise<PickupSlot[]> {
  const { data, error } = await supabase
    .from('pickup_slots')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('slot_time', { ascending: true });
  if (error) throw error;
  const nowMs = Date.now();
  return (data ?? []).filter(
    (slot: PickupSlot) =>
      slot.booked_load < slot.capacity && new Date(slot.slot_time).getTime() > nowMs
  );
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
export interface CartLine {
  menu_item_id: string;
  title: string;
  price: number;
  quantity: number;
}

// Client-side validation mirroring the server checks in create_order() so
// obviously-bad requests (no slot, fractional quantities) never leave the
// browser. The server still enforces everything authoritatively.
function validateBeforeSend(params: { restaurantId: string; slotId: string | null; items: CartLine[] }) {
  if (!params.restaurantId) throw new Error('Please select a restaurant.');
  if (!params.slotId) throw new Error('Please choose a pickup time.');
  if (!params.items.length) throw new Error('Your cart is empty.');
  for (const line of params.items) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99) {
      throw new Error('Item quantity must be a whole number between 1 and 99.');
    }
  }
}

// Calls the create_order() Postgres function (see migration 0001) so the
// order, its line items, and the slot's booked_load update atomically.
//
// Only menu_item_id + quantity are sent. Every price is looked up from
// menu_items server-side and the total is computed there, so a tampered
// request is rejected or repriced rather than trusted. CartLine still
// carries price/title for on-screen display only.
//
// create_order() returns a jsonb object in the exact `Order` shape below
// (items included), so the result can be used as an Order directly.
export async function placeOrder(params: {
  restaurantId: string;
  slotId: string | null;
  items: CartLine[];
}): Promise<Order> {
  validateBeforeSend(params);
  await ensureGuestSession();

  const { data, error } = await supabase.rpc('create_order', {
    p_restaurant_id: params.restaurantId,
    p_slot_id: params.slotId,
    p_items: params.items.map(({ menu_item_id, quantity }) => ({ menu_item_id, quantity })),
  });
  if (error) throw error;
  return data as Order;
}

// Guest-side cancellation — releases the slot capacity immediately
// (see cancel_order() in migration 0001).
export async function cancelOrder(orderId: string): Promise<Order> {
  await ensureGuestSession();
  const { data, error } = await supabase.rpc('cancel_order', { p_order_id: orderId });
  if (error) throw error;
  return data as Order;
}

// A guest's own order history, items included (RLS-scoped by auth.uid()).
export async function getMyOrders(): Promise<(Order & { items: OrderItem[] })[]> {
  const { data, error } = await supabase
    .from('orders_with_items')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as (Order & { items: OrderItem[] })[];
}
