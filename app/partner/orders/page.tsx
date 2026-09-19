"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import type { MenuItem, Order, OrderStatus } from "@/types/shared";
import OrderCard from "@/components/partner/OrderCard";
import AnalyticsSummary from "@/components/partner/AnalyticsSummary";
import { TONE_ROW, nextStatus, statusTone } from "@/lib/order-status";
import { supabase } from "@/lib/supabaseClient";
import { logOrderEvent } from "@/lib/analytics/logOrderEvent";
import { mapDbOrderToAppOrder, type DbOrderRow } from "@/lib/adapters/order";
import { slotStartLabel, slotStartMillis } from "@/lib/parseSlotTime";

// ---------------------------------------------------------------------------
// Data source
// ---------------------------------------------------------------------------

const RESTAURANT_ID = process.env.NEXT_PUBLIC_ALMA_RESTAURANT_ID ?? "";
if (!RESTAURANT_ID) {
  console.error("[orders] NEXT_PUBLIC_ALMA_RESTAURANT_ID is not set — the dashboard has no restaurant to load.");
}

/** Orders joined with their slot so each row carries pickup_slots.slot_time. */
const ORDERS_SELECT = "*, pickup_slots(slot_time)";

/** menu_items row subset the dashboard needs for item names. */
interface DbMenuItemRow {
  id: string;
  title: string | null;
  price: number | string | null;
  is_available: boolean | null;
  category: string | null;
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

type FilterKey = "all" | "new" | "preparing" | "ready";

const FILTERS: { key: FilterKey; label: string; statuses: OrderStatus[] | null }[] = [
  { key: "all", label: "Все", statuses: null },
  { key: "new", label: "New", statuses: ["Created"] },
  { key: "preparing", label: "Preparing", statuses: ["Preparing", "Delayed"] },
  { key: "ready", label: "Ready", statuses: ["Ready"] },
];

/**
 * Sort key: pickup slot start ascending; orders without a (parseable) slot go
 * last. slotTime is the raw "17:00 - 17:15" range, so it goes through
 * parseSlotStart rather than being compared as a string.
 */
function slotMillis(order: Order, referenceDate?: Date) {
  return slotStartMillis(order.slotTime, referenceDate);
}

// ---------------------------------------------------------------------------
// Compact ("Сейчас") view helpers
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<OrderStatus, string> = {
  Created: "Новый",
  Preparing: "Готовим",
  Ready: "Готов",
  PickedUp: "Выдан",
  Cancelled: "Отменён",
  Rejected: "Отклонён",
  NoShow: "Не пришёл",
  Delayed: "Задержка",
};

/** Statuses where the kitchen still owes work — a near/overdue slot here is a delay. */
const PRE_READY_STATUSES: OrderStatus[] = ["Created", "Preparing", "Delayed"];

/** Pickup slots this close to now (or already passed) are flagged as urgent. */
const URGENT_WINDOW_MS = 5 * 60 * 1000;

function isUrgent(order: Order, now: number | null) {
  if (now === null || !order.slotTime) return false;
  if (!PRE_READY_STATUSES.includes(order.status)) return false;
  const start = slotMillis(order, new Date(now));
  if (!Number.isFinite(start)) return false; // unparseable slot — can't judge urgency
  return start - now <= URGENT_WINDOW_MS;
}

/**
 * Row background for the compact view. Urgency is a time-based override, not a
 * status colour, so it stays here and always wins; everything else defers to
 * the shared status mapping in lib/order-status.ts.
 */
function compactRowClass(order: Order, now: number | null) {
  if (isUrgent(order, now)) return "bg-red-600 text-white";
  return TONE_ROW[statusTone(order.status)];
}

function formatSlot(order: Order) {
  return slotStartLabel(order.slotTime) ?? "--:--";
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PartnerOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [menuItemsById, setMenuItemsById] = useState<Record<string, MenuItem>>({});
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [compact, setCompact] = useState(false);

  // slot_id → slot_time. Realtime payloads carry only the raw row (no joined
  // pickup_slots), so INSERT/UPDATE resolve their slot label from this map
  // and fall back to a one-row query for slots we haven't seen yet.
  const slotTimeById = useRef<Map<string, string>>(new Map());

  const resolveSlotTime = useCallback(async (slotId: string | null): Promise<string | undefined> => {
    if (!slotId) return undefined;
    const cached = slotTimeById.current.get(slotId);
    if (cached) return cached;
    const { data, error } = await supabase.from("pickup_slots").select("slot_time").eq("id", slotId).maybeSingle();
    if (error) {
      console.warn(`[orders] could not load slot_time for slot ${slotId}:`, error.message);
      return undefined;
    }
    if (data?.slot_time) slotTimeById.current.set(slotId, data.slot_time);
    return data?.slot_time ?? undefined;
  }, []);

  // Wall clock for the urgency rule. Starts null so server and first client
  // render agree (no hydration mismatch), then ticks every 15s.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  // Initial load: menu (for item names), slots (lookup map), orders + slot.
  useEffect(() => {
    if (!RESTAURANT_ID) {
      setLoadState("error");
      setLoadError("NEXT_PUBLIC_ALMA_RESTAURANT_ID не задан");
      return;
    }
    let cancelled = false;

    (async () => {
      const [menuRes, slotsRes, ordersRes] = await Promise.all([
        supabase.from("menu_items").select("id, title, price, is_available, category").eq("restaurant_id", RESTAURANT_ID),
        supabase.from("pickup_slots").select("id, slot_time").eq("restaurant_id", RESTAURANT_ID),
        supabase.from("orders").select(ORDERS_SELECT).eq("restaurant_id", RESTAURANT_ID),
      ]);
      if (cancelled) return;

      if (menuRes.error) console.warn("[orders] menu_items load failed:", menuRes.error.message);
      else {
        const rows = (menuRes.data ?? []) as DbMenuItemRow[];
        setMenuItemsById(
          Object.fromEntries(
            rows.map((m) => [
              m.id,
              {
                id: m.id,
                restaurantId: RESTAURANT_ID,
                name: m.title ?? m.id,
                price: Number(m.price ?? 0),
                isAvailable: m.is_available ?? true,
                category: m.category ?? undefined,
              } satisfies MenuItem,
            ]),
          ),
        );
      }

      if (slotsRes.error) console.warn("[orders] pickup_slots load failed:", slotsRes.error.message);
      else {
        for (const slot of slotsRes.data ?? []) {
          if (slot.id && slot.slot_time) slotTimeById.current.set(slot.id, slot.slot_time);
        }
      }

      if (ordersRes.error) {
        console.error("[orders] orders load failed:", ordersRes.error);
        setLoadError(ordersRes.error.message);
        setLoadState("error");
        return;
      }

      const rows = (ordersRes.data ?? []) as unknown as DbOrderRow[];
      // The exact shape of orders.items (jsonb) isn't confirmed yet — surface
      // one raw row so the adapter's assumptions can be checked in DevTools.
      if (rows[0]) console.log("[orders] sample raw row:", rows[0]);
      const mapped = rows.map((r) => mapDbOrderToAppOrder(r));
      setOrders(mapped);
      setLoadState("ready");

      console.log(`[orders] loaded ${mapped.length} orders for restaurant ${RESTAURANT_ID}`);
      const withSlot = mapped.find((o) => o.slotTime);
      if (withSlot) {
        console.log(
          `[orders] rush-hour check uses parsed slot start: "${withSlot.slotTime}" → ${new Date(slotMillis(withSlot)).toISOString()} (not string comparison)`,
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Realtime: keep the list in sync with every change to this restaurant's orders.
  useEffect(() => {
    if (!RESTAURANT_ID) return;

    const handleChange = async (payload: RealtimePostgresChangesPayload<DbOrderRow>) => {
      if (payload.eventType === "DELETE") {
        const id = (payload.old as Partial<DbOrderRow>).id;
        if (id) setOrders((prev) => prev.filter((o) => o.id !== id));
        return;
      }

      const row = payload.new;
      const slotTime = await resolveSlotTime(row.slot_id);
      const incoming = mapDbOrderToAppOrder(row, slotTime);

      if (payload.eventType === "INSERT") {
        setOrders((prev) => (prev.some((o) => o.id === incoming.id) ? prev : [...prev, incoming]));
        return;
      }

      // UPDATE: merge changed fields into the local order; if the row is new
      // to us (e.g. inserted while we were offline) just add it.
      setOrders((prev) => {
        const idx = prev.findIndex((o) => o.id === incoming.id);
        if (idx === -1) return [...prev, incoming];
        const next = prev.slice();
        next[idx] = { ...prev[idx], ...incoming, slotTime: incoming.slotTime ?? prev[idx].slotTime };
        return next;
      });
    };

    const channel = supabase
      .channel("orders-changes")
      .on<DbOrderRow>(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `restaurant_id=eq.${RESTAURANT_ID}` },
        (payload) => {
          void handleChange(payload);
        },
      )
      .subscribe((status, err) => {
        if (status === "SUBSCRIBED") console.log("[orders] realtime subscribed to orders changes");
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error(`[orders] realtime ${status}`, err ?? "");
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [resolveSlotTime]);

  // Persist the next pipeline status. No optimistic local update: the realtime
  // subscription above reflects the confirmed row back into state, so
  // updating here too would double-apply and flicker.
  const handleAdvanceStatus = async (orderId: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    const next = nextStatus(order.status);
    if (!next) return;
    const { error } = await supabase.from("orders").update({ status: next }).eq("id", orderId);
    if (error) {
      console.error(`[orders] failed to advance ${order.orderNumber} to ${next}:`, error.message);
      return;
    }
    logOrderEvent(orderId, next);
  };

  const countFor = (statuses: OrderStatus[] | null) =>
    statuses ? orders.filter((o) => statuses.includes(o.status)).length : orders.length;

  const visibleOrders = useMemo(() => {
    const active = FILTERS.find((f) => f.key === filter)?.statuses ?? null;
    return orders
      .filter((o) => (active ? active.includes(o.status) : true))
      .sort((a, b) => slotMillis(a) - slotMillis(b));
  }, [orders, filter]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">Заказы</h1>
          <p className="mt-1 text-sm text-gray-500">Отсортированы по времени получения</p>
        </div>
      </div>

      <AnalyticsSummary orders={orders} />

      {/*
        Filter tabs + view toggle — large targets for gloved hands.
        On narrow screens the row scrolls horizontally (scrollbar hidden) rather
        than squeezing tabs into each other. The outer div bleeds into the page
        gutter (-mx / px pairs match <main>'s padding in the partner layout) so
        the row scrolls edge-to-edge; the inner row is `w-max min-w-full` so its
        trailing padding is part of the scrollable content. From `md:` up the
        tabs grow to fill the width, so desktop looks as before.
      */}
      <div className="scrollbar-hide -mx-4 -my-1 overflow-x-auto sm:-mx-6 lg:mx-0">
        {/* py-1 leaves room for the 4px rings, which overflow-x:auto would otherwise clip */}
        <div className="flex w-max min-w-full flex-nowrap items-stretch gap-2 px-4 py-1 sm:px-6 lg:px-0">
          <div
            role="tablist"
            aria-label="Фильтр по статусу"
            className="flex flex-1 flex-nowrap items-stretch gap-2"
          >
            {FILTERS.map((f) => {
              const selected = f.key === filter;
              return (
                <button
                  key={f.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setFilter(f.key)}
                  className={`flex min-h-[3rem] flex-shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full px-5 text-base font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 md:flex-1 ${
                    selected
                      ? "bg-gray-900 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                  }`}
                >
                  <span>{f.label}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-sm tabular-nums ${
                      selected ? "bg-white/20 text-white" : "bg-white text-gray-500"
                    }`}
                  >
                    {countFor(f.statuses)}
                  </span>
                </button>
              );
            })}
          </div>

          {/* "Сейчас" — rush-hour compact list toggle */}
          <button
            type="button"
            aria-pressed={compact}
            onClick={() => setCompact((v) => !v)}
            className={`flex min-h-[3rem] flex-shrink-0 items-center justify-center whitespace-nowrap rounded-full px-5 text-base font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 ${
              compact
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Сейчас
          </button>
        </div>
      </div>

      {loadState === "loading" ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-16 text-center text-lg font-medium text-gray-500">
          Загружаем заказы…
        </div>
      ) : loadState === "error" ? (
        <div
          role="alert"
          className="rounded-2xl border border-rose-200 bg-rose-50 px-6 py-16 text-center text-lg font-medium text-rose-700"
        >
          Не удалось загрузить заказы{loadError ? `: ${loadError}` : ""}
        </div>
      ) : visibleOrders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-16 text-center text-lg font-medium text-gray-500">
          Нет заказов в этой категории
        </div>
      ) : compact ? (
        <ul aria-label="Список заказов" className="space-y-2">
          {visibleOrders.map((order) => (
            <li
              key={order.id}
              className={`flex items-center gap-2 rounded-xl px-4 py-4 text-lg font-bold leading-none sm:gap-3 sm:text-xl ${compactRowClass(order, now)}`}
            >
              <span className="shrink-0 font-mono tabular-nums">{formatSlot(order)}</span>
              <span aria-hidden="true">—</span>
              <span className="shrink-0 whitespace-nowrap">№{order.orderNumber}</span>
              <span aria-hidden="true">—</span>
              <span className="min-w-0 truncate">{STATUS_LABEL[order.status]}</span>
              {isUrgent(order, now) ? (
                <span className="ml-auto hidden shrink-0 text-base font-extrabold uppercase tracking-wide sm:inline">
                  Срочно
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <section className="grid grid-cols-1 gap-5 lg:grid-cols-2 2xl:grid-cols-3">
          {visibleOrders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              menuItemsById={menuItemsById}
              onAdvanceStatus={handleAdvanceStatus}
            />
          ))}
        </section>
      )}
    </div>
  );
}
