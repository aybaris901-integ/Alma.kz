"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Order, OrderStatus } from "@/types/shared";
import { supabase } from "@/lib/supabaseClient";
import { logOrderEvent } from "@/lib/analytics/logOrderEvent";
import { mapDbOrderToAppOrder, type DbOrderRow } from "@/lib/adapters/order";
import { slotStartLabel } from "@/lib/parseSlotTime";

// ---------------------------------------------------------------------------
// Data source
// ---------------------------------------------------------------------------

const RESTAURANT_ID = process.env.NEXT_PUBLIC_ALMA_RESTAURANT_ID ?? "";
if (!RESTAURANT_ID) {
  console.error("[verify] NEXT_PUBLIC_ALMA_RESTAURANT_ID is not set — lookups will find nothing.");
}

/** Same joined select as the orders page, so the adapter sees the same row shape. */
const ORDER_SELECT = "*, pickup_slots(slot_time)";

/**
 * Characters PostgREST treats as filter syntax. A typed/scanned code containing
 * one can't be a real number or token, so we short-circuit to "not found"
 * instead of building a broken `.or()` filter from it.
 */
const FILTER_SYNTAX = /[,()"\\]/;

/**
 * Look the order up by QR token OR order number, scoped to this restaurant.
 * Returns the mapped Order, `null` for no match, or throws on a query error.
 */
async function fetchOrderByCode(code: string): Promise<Order | null> {
  if (!RESTAURANT_ID || FILTER_SYNTAX.test(code)) return null;
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_SELECT)
    .eq("restaurant_id", RESTAURANT_ID)
    // Order numbers are uppercase by construction ("ALMA-001"), so a lowercase
    // entry still matches; QR tokens are compared exactly.
    .or(`qr_token.eq.${code},order_number.eq.${code.toUpperCase()}`)
    .maybeSingle();
  if (error) throw error;
  return data ? mapDbOrderToAppOrder(data as unknown as DbOrderRow) : null;
}

// ---------------------------------------------------------------------------
// Helpers
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

/**
 * Lead phrase for the amber "not ready" warning, per status in the 4-step
 * model. An already-issued or cancelled order needs its own wording —
 * "ещё готовится" would be plainly wrong there.
 */
function notReadyPhrase(status: OrderStatus) {
  switch (status) {
    case "Created":
      return "ещё не начали готовить";
    case "Preparing":
    case "Delayed":
      return "ещё готовится";
    case "PickedUp":
      return "уже выдан";
    case "Cancelled":
    case "Rejected":
    case "NoShow":
      return "нельзя выдать";
    case "Ready":
      return ""; // never shown — Ready renders the success card instead
  }
}

/** slotTime is the raw pickup_slots.slot_time ("17:30" / "17:00 - 17:15"); show its start. */
function formatPickupTime(slotTime?: string) {
  return slotStartLabel(slotTime) ?? "—";
}

const tengeFormatter = new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 0 });
function formatTenge(amount: number) {
  return `${tengeFormatter.format(amount)} ₸`;
}

/**
 * Outcome of the last lookup. Every submit re-queries Supabase, so a hit
 * carries the order as it was at that moment; confirming a pickup patches the
 * local copy's status so the success card can stay on screen afterwards.
 */
type Lookup =
  | { kind: "loading"; query: string }
  | { kind: "notFound"; query: string }
  | { kind: "error"; query: string; message: string }
  | { kind: "found"; order: Order };

/** How long the "выдан" confirmation stays up before the screen resets itself. */
const CONFIRMATION_MS = 4000;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PartnerVerifyPage() {
  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [confirmedNumber, setConfirmedNumber] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped on every submit so a slow, superseded lookup can't overwrite a newer one.
  const lookupSeq = useRef(0);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = null;
    setConfirmedNumber(null);
    setConfirmError(null);

    const code = query.trim();
    if (!code) return;
    const seq = ++lookupSeq.current;
    setLookup({ kind: "loading", query: code });

    // Pre-select the entry so the next order overwrites it with one keystroke.
    inputRef.current?.select();

    try {
      const order = await fetchOrderByCode(code);
      if (seq !== lookupSeq.current) return;
      setLookup(order ? { kind: "found", order } : { kind: "notFound", query: code });
    } catch (err) {
      if (seq !== lookupSeq.current) return;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[verify] lookup for "${code}" failed:`, err);
      setLookup({ kind: "error", query: code, message });
    }
  };

  // Direct client write, same pattern as the orders page's handleAdvanceStatus.
  const handleConfirmPickup = async (order: Order) => {
    setConfirming(true);
    setConfirmError(null);
    const { error } = await supabase.from("orders").update({ status: "PickedUp" }).eq("id", order.id);
    setConfirming(false);
    if (error) {
      console.error(`[verify] failed to mark ${order.orderNumber} as PickedUp:`, error.message);
      setConfirmError(error.message);
      return;
    }
    logOrderEvent(order.id, "PickedUp");

    setLookup({ kind: "found", order: { ...order, status: "PickedUp", pickedUpAt: new Date().toISOString() } });
    setConfirmedNumber(order.orderNumber);

    // Counter staff move straight on to the next guest, so clear the screen for
    // them rather than leaving the previous order on display.
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => {
      resetTimer.current = null;
      setLookup(null);
      setConfirmedNumber(null);
      setQuery("");
      inputRef.current?.focus();
    }, CONFIRMATION_MS);
  };

  const matched = lookup?.kind === "found" ? lookup.order : undefined;
  const justConfirmed = matched !== undefined && confirmedNumber === matched.orderNumber;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">Выдача заказа</h1>
        <p className="mt-1 text-sm text-gray-500">
          Отсканируйте QR гостя или введите номер заказа
        </p>
      </div>

      {/* Manual entry — the flow that works today */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <label htmlFor="order-query" className="block text-base font-bold text-gray-900">
          Номер заказа или QR-код
        </label>
        <input
          id="order-query"
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="ALMA-104"
          className="min-h-[4.5rem] w-full rounded-2xl border border-gray-300 bg-white px-5 text-3xl font-bold tracking-wide text-gray-900 placeholder:font-medium placeholder:text-gray-300 focus:border-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
        />
        <button
          type="submit"
          disabled={query.trim().length === 0 || lookup?.kind === "loading"}
          className="flex min-h-[4rem] w-full items-center justify-center rounded-full bg-gray-900 px-6 text-xl font-bold text-white transition hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 active:bg-black disabled:cursor-default disabled:bg-gray-100 disabled:text-gray-400"
        >
          {lookup?.kind === "loading" ? "Ищем…" : "Подтвердить"}
        </button>
      </form>

      {/*
        TODO: camera scanning is not wired up yet. When it is, open a video
        stream (getUserMedia, facingMode "environment"), decode the QR, and feed
        the decoded token through fetchOrderByCode() exactly like the manual entry.
      */}
      <div className="space-y-2">
        <button
          type="button"
          disabled
          aria-describedby="scan-hint"
          className="flex min-h-[4rem] w-full cursor-default items-center justify-center gap-3 rounded-full bg-gray-100 px-6 text-xl font-bold text-gray-400"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-7 w-7"
            aria-hidden="true"
          >
            <path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z" />
            <circle cx="12" cy="12.5" r="3.5" />
          </svg>
          Сканировать QR
        </button>
        <p id="scan-hint" className="text-center text-sm text-gray-500">
          Сканер скоро появится — пока вводите номер вручную
        </p>
      </div>

      {/* Lookup failed (network / RLS / query error) */}
      {lookup?.kind === "error" ? (
        <div
          role="alert"
          className="rounded-2xl border border-rose-200 bg-rose-50 px-6 py-8 text-center"
        >
          <p className="text-2xl font-bold text-rose-700">Не удалось проверить заказ</p>
          <p className="mt-2 break-words text-base text-rose-500">{lookup.message}</p>
        </div>
      ) : null}

      {/* Not found */}
      {lookup?.kind === "notFound" ? (
        <div
          role="alert"
          className="rounded-2xl border border-rose-200 bg-rose-50 px-6 py-8 text-center"
        >
          <p className="text-3xl font-bold text-rose-700">Заказ не найден</p>
          <p className="mt-2 break-all text-base text-rose-500">«{lookup.query}»</p>
        </div>
      ) : null}

      {/* Found, but not ready to hand over */}
      {matched && matched.status !== "Ready" && !justConfirmed ? (
        <div
          role="alert"
          className="rounded-2xl border border-amber-200 bg-amber-50 px-6 py-8 text-center"
        >
          <p className="text-2xl font-bold leading-snug text-amber-800">
            Заказ {matched.orderNumber} {notReadyPhrase(matched.status)} — статус:{" "}
            {STATUS_LABEL[matched.status]}
          </p>
        </div>
      ) : null}

      {/* Ready — hand it over. Stays on screen through the confirmation. */}
      {matched && (matched.status === "Ready" || justConfirmed) ? (
        <article className="rounded-2xl border border-emerald-200 bg-emerald-50">
          <header className="flex flex-wrap items-baseline justify-between gap-4 px-6 pb-5 pt-6">
            <h2 className="text-4xl font-bold tracking-tight text-emerald-900">
              {matched.orderNumber}
            </h2>
            <div className="text-right text-sm text-emerald-600">
              Получение:{" "}
              <span className="font-mono text-lg font-semibold tabular-nums text-emerald-800">
                {formatPickupTime(matched.slotTime)}
              </span>
            </div>
          </header>

          <hr className="border-t border-emerald-100" />

          <ul className="space-y-2 px-6 py-5">
            {matched.items.map((item) => (
              <li key={item.id} className="text-xl font-medium leading-snug text-emerald-950">
                {item.name ?? item.menuItemId}{" "}
                <span className="font-bold">×{item.quantity}</span>
              </li>
            ))}
          </ul>

          <hr className="border-t border-emerald-100" />

          <div className="flex items-baseline justify-between px-6 py-4 text-emerald-900">
            <span className="text-base font-semibold text-emerald-700">Итого</span>
            <span className="font-mono text-2xl font-bold tabular-nums">{formatTenge(matched.totalAmount)}</span>
          </div>

          <hr className="border-t border-emerald-100" />

          <div className="px-6 py-5">
            {justConfirmed ? (
              <p
                role="status"
                className="rounded-2xl bg-emerald-600 px-6 py-5 text-center text-xl font-bold text-white"
              >
                Заказ {matched.orderNumber} выдан ✓
              </p>
            ) : (
              <>
                <button
                  type="button"
                  disabled={confirming}
                  onClick={() => handleConfirmPickup(matched)}
                  className="min-h-[4.5rem] w-full rounded-full bg-gray-900 px-6 text-2xl font-bold text-white transition hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 active:bg-black disabled:cursor-default disabled:bg-gray-400"
                >
                  {confirming ? "Сохраняем…" : "Подтвердить выдачу"}
                </button>
                {confirmError ? (
                  <p role="alert" className="mt-3 text-center text-base font-semibold text-rose-600">
                    Не удалось сохранить: {confirmError}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </article>
      ) : null}

      <Link
        href="/partner/orders"
        className="flex min-h-[3rem] items-center justify-center rounded-full bg-gray-100 px-5 text-base font-bold text-gray-700 transition hover:bg-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
      >
        ← К списку заказов
      </Link>
    </div>
  );
}
