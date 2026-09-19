// Shared domain types for Alma.kz — used by both the guest app and the
// "Alma Partner" restaurant dashboard. Keep this file free of UI imports.

export type OrderStatus =
  | "Created"
  | "Paid"
  | "Accepted"
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
