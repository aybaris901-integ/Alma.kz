// Shared domain types for Alma.kz — used by both the guest app and the
// "Alma Partner" restaurant dashboard. Keep this file free of UI imports.

/**
 * The kitchen pipeline is Created → Preparing → Ready → PickedUp (payment is
 * tracked separately in orders.payment_status). The last four are reserved
 * edge cases that the backend may emit later.
 */
export type OrderStatus =
  | "Created"
  | "Preparing"
  | "Ready"
  | "PickedUp"
  | "Cancelled"
  | "Rejected"
  | "NoShow"
  | "Delayed";

export interface OrderItem {
  id: string;
  menuItemId: string;
  quantity: number;
  /** Unit price captured at the moment of ordering (₸). */
  priceAtOrder: number;
  /** Display name snapshotted in the order payload, if the backend includes one. */
  name?: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  restaurantId: string;
  guestSessionId: string;
  pickupSlotId: string;
  status: OrderStatus;
  totalAmount: number;
  qrToken: string;
  items: OrderItem[];
  createdAt: string;
  readyAt?: string;
  pickedUpAt?: string;
  /**
   * Pickup slot as stored in pickup_slots.slot_time — a range like
   * "17:00 - 17:15", NOT an ISO timestamp. Use lib/parseSlotTime to compare.
   */
  slotTime?: string;
}

export interface MenuItem {
  id: string;
  restaurantId: string;
  name: string;
  description?: string;
  price: number;
  imageUrl?: string;
  isAvailable: boolean;
  category?: string;
}

export interface PickupSlot {
  id: string;
  restaurantId: string;
  /** ISO datetime of the slot start. */
  startTime: string;
  /** ISO datetime of the slot end. */
  endTime: string;
  capacity: number;
  bookedCount: number;
}
