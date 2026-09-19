"use client";

import type { MenuItem, Order, OrderStatus } from "@/types/shared";
import { PIPELINE, TONE_ACCENT, pipelineIndex, statusTone } from "@/lib/order-status";
import { slotStartLabel } from "@/lib/parseSlotTime";

// Pipeline steps and the status→step mapping live in lib/order-status.ts so the
// buttons below and the card accent (border + dot) are driven by one table.

const TERMINAL_LABEL: Partial<Record<OrderStatus, string>> = {
  Cancelled: "Заказ отменён",
  Rejected: "Заказ отклонён",
  NoShow: "Гость не пришёл",
};

/** slotTime is the raw "17:00 - 17:15" range from pickup_slots; show its start. */
function formatPickupTime(slotTime?: string) {
  return slotStartLabel(slotTime) ?? "—";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface OrderCardProps {
  order: Order;
  /** Called with the order id when staff tap the next pipeline step. */
  onAdvanceStatus: (orderId: string) => void;
  /** Lookup used to render item names; falls back to menuItemId when missing. */
  menuItemsById?: Record<string, Pick<MenuItem, "name">>;
}

export default function OrderCard({ order, onAdvanceStatus, menuItemsById }: OrderCardProps) {
  const current = pipelineIndex(order.status);
  const terminalLabel = TERMINAL_LABEL[order.status];
  const accent = TONE_ACCENT[statusTone(order.status)];

  return (
    <article
      className={`flex flex-col rounded-2xl border border-l-4 border-gray-200 bg-white ${accent.border}`}
    >
      {/* Header: order number + pickup time */}
      <header className="flex items-baseline justify-between gap-4 px-5 pb-4 pt-5">
        <h2 className="flex items-center gap-2.5 text-3xl font-bold tracking-tight text-gray-900">
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${accent.dot}`}
            aria-hidden="true"
          />
          {order.orderNumber}
        </h2>
        <div className="text-right text-sm text-gray-500">
          Получение:{" "}
          <span className="font-mono text-lg font-semibold tabular-nums text-gray-700">
            {formatPickupTime(order.slotTime)}
          </span>
        </div>
      </header>

      <hr className="border-t border-gray-100" />

      {/* Items */}
      <ul className="flex-1 space-y-2 px-5 py-5">
        {order.items.map((item) => (
          <li key={item.id} className="text-xl font-medium leading-snug text-gray-900">
            {menuItemsById?.[item.menuItemId]?.name ?? item.name ?? item.menuItemId}{" "}
            <span className="font-bold">×{item.quantity}</span>
          </li>
        ))}
      </ul>

      <hr className="border-t border-gray-100" />

      {/* Status pipeline */}
      <div className="px-5 py-5">
        {terminalLabel ? (
          <div
            role="status"
            className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-center text-xl font-bold text-rose-700"
          >
            {terminalLabel}
          </div>
        ) : null}

        <div
          role="group"
          aria-label="Статус заказа"
          className={`grid grid-cols-4 gap-2 ${terminalLabel ? "mt-3" : ""}`}
        >
          {PIPELINE.map((step, i) => {
            // Steps before the current one are done. The current step is the
            // action to take — except at the end of the pipeline, where the
            // last step is a terminal marker and reads as done too.
            const isFinal = current === PIPELINE.length - 1;
            const isDone = current !== null && (i < current || (isFinal && i === current));
            const isNext = current !== null && !isFinal && i === current;

            const base =
              "flex min-h-[3.5rem] items-center justify-center gap-1 rounded-full px-2 text-center text-xs font-bold leading-tight transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2 sm:text-sm lg:text-base";
            const variant = isNext
              ? "bg-gray-900 text-white hover:bg-gray-800 active:bg-black"
              : isDone
                ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200"
                : "bg-gray-100 text-gray-400";

            return (
              <button
                key={step.status}
                type="button"
                disabled={!isNext}
                aria-current={isNext ? "step" : undefined}
                onClick={isNext ? () => onAdvanceStatus(order.id) : undefined}
                className={`${base} ${variant} disabled:cursor-default`}
              >
                {isDone ? (
                  <span className="text-sm leading-none" aria-hidden="true">
                    ✓
                  </span>
                ) : null}
                <span>{step.label}</span>
                {isDone ? <span className="sr-only">(выполнено)</span> : null}
              </button>
            );
          })}
        </div>
      </div>
    </article>
  );
}
