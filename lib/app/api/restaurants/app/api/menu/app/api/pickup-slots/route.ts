import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const restaurantId = searchParams.get('restaurantId');

  let query = supabase.from('pickup_slots').select('*');
  if (restaurantId) query = query.eq('restaurant_id', restaurantId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Отдаём только слоты, где есть свободные места (booked_load < capacity)
  const availableSlots = data.filter(slot => slot.booked_load < slot.capacity);
  return NextResponse.json(availableSlots);
}