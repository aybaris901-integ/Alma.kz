import { useCallback, useEffect, useState } from 'react';
import type { Restaurant, MenuItem, PickupSlot } from '../../types/shared';
import { getRestaurants, getMenuItems, getAvailablePickupSlots } from '../lib/api';

// Generic async-state hook so the three catalog hooks below stay tiny.
//
// Two behaviours matter for correctness here (both were sources of real
// crashes in the previous version):
// 1. When `deps` change (e.g. the user switches restaurant) `data` is reset
//    to null IMMEDIATELY. Previously the old restaurant's menu stayed
//    rendered while the new one loaded, and quantity taps on those stale
//    rows produced cart keys that `menuItems.find(...)` could not resolve
//    after the refetch landed — which crashed the page.
// 2. `refresh()` lets the caller refetch on demand (used after placing an
//    order so pickup-slot counts update instead of showing stale values).
function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    fn()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  return { data, loading, error, refresh };
}

export function useRestaurants() {
  return useAsync<Restaurant[]>(() => getRestaurants(), []);
}

export function useMenuItems(restaurantId: string | null) {
  return useAsync<MenuItem[]>(
    () => (restaurantId ? getMenuItems(restaurantId) : Promise.resolve([])),
    [restaurantId]
  );
}

export function usePickupSlots(restaurantId: string | null) {
  return useAsync<PickupSlot[]>(
    () => (restaurantId ? getAvailablePickupSlots(restaurantId) : Promise.resolve([])),
    [restaurantId]
  );
}
