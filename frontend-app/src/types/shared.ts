// Shared types for the Alma.kz frontend.
//
// This is the canonical type file (all pages import `../types/shared`,
// which resolves HERE). The original version was missing the backend
// contract details, which made the Supabase integration impossible to
// type: OrderStatus lacked 'Expired', Order lacked paymentStatus /
// nullable slot / nullable QR, MenuItem lacked restaurantId (needed to
// know which restaurant's slots to show), and OrderItem carried no title
// even though create_order() returns one.
//
// These are the camelCase mirrors of the Postgres schema in
// supabase/migrations/0001_schema.sql; the field-by-field mapping lives in
// src/lib/api.ts.

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
  | "Delayed"
  // Produced by the backend: unpaid orders older than 30 minutes are
  // auto-expired and their slot capacity released (see expire_stale_orders
  // in supabase/migrations/0001_schema.sql).
  | "Expired";

export type PaymentStatus = "Pending" | "Paid" | "Failed";

export interface Restaurant {
  id: string;
  name: string;
  address: string;
  isActive: boolean;
  imageUrl?: string | null;
}

export interface MenuItem {
  id: string;
  // Which restaurant this dish belongs to — the cart and the pickup-slot
  // picker are scoped to it.
  restaurantId: string;
  categoryId: string;
  name: string;
  description?: string | null;
  price: number;
  prepWeight?: number;
  isAvailable: boolean;
  imageUrl?: string | null;
}

export interface CartItem {
  menuItem: MenuItem;
  quantity: number;
}

export interface PickupSlot {
  id: string;
  restaurantId: string;
  slotTime: string; // ISO timestamp
  capacity: number;
  bookedLoad: number;
}

export interface OrderItem {
  id: string;
  // The RPC result identifies lines by title (server-priced), so this is
  // optional; UI code should prefer `title ?? menuItemId ?? "Блюдо"`.
  menuItemId?: string;
  title?: string;
  quantity: number;
  priceAtOrder: number;
}

export interface Order {
  id: string;
  orderNumber: string; // напр. "260919-A1B2C3"
  restaurantId: string;
  guestSessionId: string;
  // Nullable: the schema allows an order without a slot; this app always
  // sends one, but the type must not lie about the API.
  pickupSlotId: string | null;
  status: OrderStatus;
  totalAmount: number;
  qrToken: string | null;
  paymentStatus?: PaymentStatus;
  items: OrderItem[];
  createdAt: string;
  readyAt?: string;
  pickedUpAt?: string;
}
