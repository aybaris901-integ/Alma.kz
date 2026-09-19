"use client";

import { useEffect, useState } from "react";
import type { Order, OrderStatus } from "@/types/shared";
import { supabase } from "@/lib/supabaseClient";
import {
  PICKUP_TARGET_SEC,
  computePickupStats,
  formatMinSec,
  type OrderEventRow,
  type PickupStats,
} from "@/lib/analytics/pickupWaitingTime";

/** Statuses that mean the order no longer needs the kitchen. */
const FINISHED: ReadonlySet<OrderStatus> = new Set<OrderStatus>(["PickedUp", "Cancelled", "Rejected", "NoShow"]);

/** Refetch cadence when nothing else triggers one. */
const REFRESH_MS = 30_000;
/** Realtime echoes the status row before the fire-and-forget event insert lands; give it a beat. */
const REALTIME_SETTLE_MS = 1_500;

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export interface AnalyticsSummaryProps {
  /** The live order list from the page — used for the "in progress" count and as a refetch trigger. */
  orders: Order[];
}

/**
 * Today's pickup analytics, computed client-side from order_events.
 * Static-ish by design: refetches every 30s and shortly after the page's
 * realtime order updates, rather than holding its own subscription.
 */
export default function AnalyticsSummary({ orders }: AnalyticsSummaryProps) {
  const [stats, setStats] = useState<PickupStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const { data, error } = await supabase
        .from("order_events")
        .select("order_id, status, changed_at")
        .gte("changed_at", startOfToday().toISOString())
        .order("changed_at");
      if (cancelled) return;
      if (error) {
        console.warn("[analytics] order_events load failed:", error.message);
        setError(error.message);
        return;
      }
      setError(null);
      setStats(computePickupStats((data ?? []) as OrderEventRow[]));
    };

    // `orders` changes on every realtime update, so this effect re-runs then;
    // the delay lets the matching order_events insert land first.
    const settle = setTimeout(load, REALTIME_SETTLE_MS);
    const interval = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearTimeout(settle);
      clearInterval(interval);
    };
  }, [orders]);

  const inProgress = orders.filter((o) => !FINISHED.has(o.status)).length;
  const avg = stats?.averageWaitSec ?? null;
  const onTarget = avg !== null && avg <= PICKUP_TARGET_SEC;

  return (
    <section aria-label="Сводка за сегодня" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {/* Average waiting time */}
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-4 sm:col-span-1">
        <p className="text-sm font-semibold text-gray-500">Среднее время ожидания</p>
        {avg !== null ? (
          <>
            <p
              className={`mt-1 font-mono text-4xl font-bold tabular-nums ${onTarget ? "text-emerald-600" : "text-amber-600"}`}
            >
              {formatMinSec(avg)}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              (цель: ≤ 2 мин) · по {stats?.measured} {plural(stats?.measured ?? 0, "заказу", "заказам", "заказам")}
            </p>
          </>
        ) : (
          <>
            <p className="mt-1 text-xl font-bold text-gray-400">
              {error ? "Нет данных" : stats === null ? "…" : "Ещё нет завершённых заказов"}
            </p>
            <p className="mt-1 text-xs text-gray-500">(цель: ≤ 2 мин)</p>
          </>
        )}
      </div>

      {/* Picked up today */}
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-4">
        <p className="text-sm font-semibold text-gray-500">Заказов выдано сегодня</p>
        <p className="mt-1 font-mono text-4xl font-bold tabular-nums text-gray-900">
          {stats ? stats.completed : error ? "—" : "…"}
        </p>
      </div>

      {/* In progress now */}
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-4">
        <p className="text-sm font-semibold text-gray-500">Заказов сейчас в работе</p>
        <p className="mt-1 font-mono text-4xl font-bold tabular-nums text-gray-900">{inProgress}</p>
      </div>
    </section>
  );
}

/** Russian plural picker: 1 → one, 2–4 → few, 5–20 / 0 → many. */
function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
