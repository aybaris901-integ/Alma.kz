import { useMemo, useState, type ChangeEvent } from 'react';
import { useRestaurants, useMenuItems, usePickupSlots } from '../hooks/useCatalog';
import { placeOrder, getErrorMessage, type CartLine } from '../lib/api';

// Minimal end-to-end example: pick a restaurant, add items, pick a slot,
// place the order. Drop into your router / replace with your own styling —
// this exists to prove the Vite <-> Supabase wiring works end to end.
export default function OrderPage() {
  const { data: restaurants, loading: loadingRestaurants, error: restaurantsError } =
    useRestaurants();
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  // menu/slots data are RESET while refetching (see useAsync), so the UI
  // never shows one restaurant's rows under another restaurant.
  const { data: menuItems, loading: loadingMenu } = useMenuItems(restaurantId);
  const { data: slots, loading: loadingSlots, refresh: refreshSlots } =
    usePickupSlots(restaurantId);

  const [cart, setCart] = useState<Record<string, number>>({});
  const [slotId, setSlotId] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [placedOrderNumber, setPlacedOrderNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Only rows that exist in the CURRENTLY loaded menu can enter the cart.
  // The previous version used menuItems.find(...)!. Non-null assertion: if
  // the restaurant was switched mid-tap, the stale cart key resolved to
  // undefined and the page went blank. Now unknown ids are skipped, so the
  // worst case is "that item vanished from your cart", never a crash.
  const cartLines: CartLine[] = useMemo(() => {
    if (!menuItems) return [];
    return Object.entries(cart)
      .filter(([itemId, qty]) => qty > 0 && menuItems.some((m) => m.id === itemId))
      .map(([itemId, qty]) => {
        const item = menuItems.find((m) => m.id === itemId)!;
        return { menu_item_id: item.id, title: item.title, price: item.price, quantity: qty };
      });
  }, [cart, menuItems]);

  const total = cartLines.reduce((sum, l) => sum + l.price * l.quantity, 0);

  async function handlePlaceOrder() {
    if (!restaurantId || !slotId || cartLines.length === 0) return;
    setPlacing(true);
    setError(null);
    try {
      const order = await placeOrder({ restaurantId, slotId, items: cartLines });
      setPlacedOrderNumber(order.order_number);
      setCart({});
      // Refetch slots so the counts ("4 spots left") and the just-booked
      // slot's availability reflect the order that was just placed.
      refreshSlots();
    } catch (err) {
      // getErrorMessage normalises supabase-js error shapes and maps the
      // backend's SQLSTATE codes (SLTFU, ITMUN, ...) to readable text, so
      // "slot full" never shows up as a generic "Failed to place order".
      setError(getErrorMessage(err));
      refreshSlots();
    } finally {
      setPlacing(false);
    }
  }

  if (loadingRestaurants) return <p>Loading restaurants…</p>;
  if (restaurantsError) return <p>Couldn't load restaurants: {restaurantsError.message}</p>;

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: 16 }}>
      <h1>Order pickup</h1>

      <label>
        Restaurant
        <select
          value={restaurantId ?? ''}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => {
            setRestaurantId(e.target.value || null);
            setCart({});
            setSlotId(null);
            setPlacedOrderNumber(null);
            setError(null);
          }}
        >
          <option value="">Select a restaurant</option>
          {restaurants?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>

      {restaurantId && (
        <>
          <h2>Menu</h2>
          {loadingMenu && <p>Loading menu…</p>}
          {menuItems?.map((item) => (
            <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>
                {item.title} — {item.price}₸
              </span>
              <input
                type="number"
                min={0}
                max={99}
                step={1}
                disabled={loadingMenu}
                value={cart[item.id] ?? 0}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  // Whole quantities only: "2.5" used to reach the server and
                  // fail the ::int cast. Floor + integer cast keeps the cart
                  // valid as you type.
                  setCart((c) => ({
                    ...c,
                    [item.id]: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                  }))
                }
                style={{ width: 56 }}
              />
            </div>
          ))}

          <h2>Pickup time</h2>
          {loadingSlots && <p>Loading slots…</p>}
          {!loadingSlots && slots?.length === 0 && (
            <p>No pickup slots available right now.</p>
          )}
          {slots?.map((slot) => (
            <label key={slot.id} style={{ display: 'block' }}>
              <input
                type="radio"
                name="slot"
                checked={slotId === slot.id}
                onChange={() => setSlotId(slot.id)}
              />
              {new Date(slot.slot_time).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}{' '}
              ({slot.capacity - slot.booked_load} spots left)
            </label>
          ))}

          <p>
            <strong>Total: {total}₸</strong>
          </p>

          <button
            onClick={handlePlaceOrder}
            disabled={placing || cartLines.length === 0 || !slotId}
          >
            {placing ? 'Placing order…' : 'Place order'}
          </button>
          {!slotId && cartLines.length > 0 && (
            <p style={{ color: 'gray' }}>Choose a pickup time to place the order.</p>
          )}

          {error && <p style={{ color: 'crimson' }}>{error}</p>}
          {placedOrderNumber && <p>Order placed! Number: {placedOrderNumber}</p>}
        </>
      )}
    </div>
  );
}
