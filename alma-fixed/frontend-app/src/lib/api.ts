import { supabase } from './supabaseClient';
import type { MenuItem, Order, PickupSlot, Restaurant } from '../types/shared';

// ---------------------------------------------------------------------------
// This file is the entire API layer: every function wraps exactly one
// Supabase call and maps snake_case database rows to the camelCase types
// in types/shared.ts. The UI never talks to Supabase directly, so the two
// naming conventions never leak into components.
// ---------------------------------------------------------------------------

// Anonymous sign-in gives every visitor a stable auth.uid() (no login
// form) so RLS can scope orders to "their own". Requires Anonymous
// sign-ins to be enabled: Supabase Dashboard -> Authentication ->
// Providers -> Anonymous.
export async function ensureGuestSession() {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session;

  const { data: signInData, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return signInData.session;
}

// ---------------------------------------------------------------------------
// Error normalisation.
// create_order()/cancel_order() in the database raise distinct SQLSTATE
// codes (SLTFU = slot full, ITMUN = item unavailable, ...) with stable
// English messages. The UI is Russian, so map by code first and fall back
// to the raw message — the old hardcoded "Оплата прошла успешно" flow had
// no error path at all.
// ---------------------------------------------------------------------------
const ERROR_TEXT: Record<string, string> = {
  NOSES: 'Нужно войти в систему, чтобы оформить заказ. Обновите страницу.',
  EMPT1: 'Корзина пуста.',
  RSTAV: 'Это заведение сейчас недоступно.',
  SLTRQ: 'Пожалуйста, выберите время получения.',
  SLTWT: 'Это время недоступно в данном заведении.',
  SLTOF: 'Это время больше не предлагается.',
  SLTPT: 'Это время уже прошло.',
  SLTLT: 'У вас уже есть активный заказ на это время.',
  SLTFU: 'Это время уже полностью занято. Выберите другое.',
  ITMUN: 'Одно из блюд из корзины больше недоступно.',
  QTYIN: 'Количество должно быть целым числом от 1 до 99.',
  ORDCN: 'Этот заказ уже нельзя отменить.',
};

export function getErrorMessage(err: unknown): string {
  const maybe = err as { code?: string; message?: string } | null;
  if (maybe?.code && ERROR_TEXT[maybe.code]) return ERROR_TEXT[maybe.code];
  if (maybe?.message) return maybe.message;
  return 'Что-то пошло не так. Попробуйте ещё раз.';
}

// ---------------------------------------------------------------------------
// snake_case -> camelCase mappers
// ---------------------------------------------------------------------------
function mapRestaurant(r: Record<string, unknown>): Restaurant {
  return {
    id: r.id as string,
    name: r.name as string,
    address: r.address as string,
    isActive: Boolean(r.is_active),
  };
}

function mapMenuItem(m: Record<string, unknown>): MenuItem {
  return {
    id: m.id as string,
    restaurantId: m.restaurant_id as string,
    categoryId: String(m.category ?? '').toLowerCase(),
    name: m.title as string,
    description: (m.description as string | null) ?? null,
    price: Number(m.price),
    isAvailable: Boolean(m.is_available),
    imageUrl: (m.image_url as string | null) ?? null,
  };
}

function mapPickupSlot(s: Record<string, unknown>): PickupSlot {
  return {
    id: s.id as string,
    restaurantId: s.restaurant_id as string,
    slotTime: s.slot_time as string,
    capacity: Number(s.capacity),
    bookedLoad: Number(s.booked_load),
  };
}

// create_order()/cancel_order() return a jsonb object in the exact `Order`
// shape documented in migration 0001 (items included).
function mapOrder(raw: Record<string, unknown>): Order {
  const items = (raw.items as Record<string, unknown>[] | null) ?? [];
  return {
    id: raw.id as string,
    orderNumber: raw.order_number as string,
    restaurantId: raw.restaurant_id as string,
    guestSessionId: raw.guest_id as string,
    pickupSlotId: (raw.slot_id as string | null) ?? null,
    status: raw.status as Order['status'],
    totalAmount: Number(raw.total_amount),
    qrToken: (raw.qr_token as string | null) ?? null,
    paymentStatus: raw.payment_status as Order['paymentStatus'],
    items: items.map((it) => ({
      id: it.id as string,
      title: it.title as string | undefined,
      quantity: Number(it.quantity),
      priceAtOrder: Number(it.price),
    })),
    createdAt: raw.created_at as string,
  };
}

// ---------------------------------------------------------------------------
// Catalog reads
// ---------------------------------------------------------------------------
export async function getRestaurants(): Promise<Restaurant[]> {
  const { data, error } = await supabase.from('restaurants').select('*');
  if (error) throw error;
  return (data ?? []).map(mapRestaurant);
}

export async function getMenuItems(restaurantId: string): Promise<MenuItem[]> {
  const { data, error } = await supabase
    .from('menu_items')
    .select('*')
    .eq('restaurant_id', restaurantId);
  if (error) throw error;
  return (data ?? []).map(mapMenuItem);
}

// Only slots that are bookable right now: active, with free capacity and
// in the future. The backend rejects stale slots authoritatively anyway
// (SLTPT / SLTFU), this just keeps the picker honest.
export async function getAvailablePickupSlots(restaurantId: string): Promise<PickupSlot[]> {
  const { data, error } = await supabase
    .from('pickup_slots')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('slot_time', { ascending: true });
  if (error) throw error;
  const nowMs = Date.now();
  return (data ?? [])
    .map(mapPickupSlot)
    .filter(
      (slot) =>
        slot.bookedLoad < slot.capacity && new Date(slot.slotTime).getTime() > nowMs
    );
}

export async function getPickupSlot(slotId: string): Promise<PickupSlot | null> {
  const { data, error } = await supabase
    .from('pickup_slots')
    .select('*')
    .eq('id', slotId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapPickupSlot(data as Record<string, unknown>) : null;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
export interface PlaceOrderParams {
  restaurantId: string;
  slotId: string;
  items: { menuItemId: string; quantity: number }[];
}

// Client-side validation mirroring the server checks in create_order(), so
// obviously-bad requests never leave the browser.
function validateBeforeSend(params: PlaceOrderParams) {
  if (!params.restaurantId) throw new Error(ERROR_TEXT.SLTRQ);
  if (!params.slotId) throw new Error(ERROR_TEXT.SLTRQ);
  if (!params.items.length) throw new Error(ERROR_TEXT.EMPT1);
  for (const line of params.items) {
    if (
      !Number.isInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > 99
    ) {
      throw new Error(ERROR_TEXT.QTYIN);
    }
  }
}

// Creates the order atomically (order + line items + slot booking in one
// transaction) and returns the fresh Order. Only menu_item_id + quantity
// are sent — the database looks up the real price itself, so a tampered
// request can never change what a guest is charged.
export async function placeOrder(params: PlaceOrderParams): Promise<Order> {
  validateBeforeSend(params);
  await ensureGuestSession();

  const { data, error } = await supabase.rpc('create_order', {
    p_restaurant_id: params.restaurantId,
    p_slot_id: params.slotId,
    p_items: params.items.map(({ menuItemId, quantity }) => ({
      menu_item_id: menuItemId,
      quantity,
    })),
  });
  if (error) throw error;
  return mapOrder(data as Record<string, unknown>);
}

// Releases the slot capacity immediately (see cancel_order() in 0001).
export async function cancelOrder(orderId: string): Promise<Order> {
  await ensureGuestSession();
  const { data, error } = await supabase.rpc('cancel_order', { p_order_id: orderId });
  if (error) throw error;
  return mapOrder(data as Record<string, unknown>);
}

// The guest's own order (RLS-scoped); null if it doesn't exist or belongs
// to another guest.
export async function getOrder(orderId: string): Promise<Order | null> {
  const { data, error } = await supabase
    .from('orders_with_items')
    .select('*')
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapOrder(data as Record<string, unknown>) : null;
}
