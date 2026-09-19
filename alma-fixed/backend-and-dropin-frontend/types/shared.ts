export type OrderStatus = 'Created' | 'Paid' | 'Preparing' | 'Ready' | 'PickedUp' | 'Cancelled';
export type PaymentStatus = 'Pending' | 'Paid' | 'Failed';

export interface Restaurant {
  id: string;
  name: string;
  address: string;
  is_active: boolean;
  created_at?: string;
}

export interface MenuItem {
  id: string;
  restaurant_id: string;
  title: string;
  description: string | null;
  price: number;
  category: string;
  image_url: string | null;
  is_available: boolean;
  created_at?: string;
}

export interface PickupSlot {
  id: string;
  restaurant_id: string;
  slot_time: string;
  capacity: number;
  booked_load: number;
  is_active: boolean;
  created_at?: string;
}

export interface OrderItem {
  id: string;
  title: string;
  price: number;
  quantity: number;
}

export interface Order {
  id: string;
  order_number: string;
  guest_id: string;
  restaurant_id: string;
  slot_id: string | null;
  items: OrderItem[];
  total_amount: number;
  status: OrderStatus;
  qr_token: string | null;
  payment_status: PaymentStatus;
  created_at?: string;
  updated_at?: string;
}