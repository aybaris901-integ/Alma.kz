import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import type { Order, OrderStatus, PickupSlot } from "../types/shared";
import {
  getOrder,
  getPickupSlot,
  cancelOrder,
  getErrorMessage,
} from "../lib/api";

const statusSteps: {
  status: OrderStatus;
  label: string;
}[] = [
  {
    status: "Created",
    label: "Заказ создан",
  },
  {
    status: "Paid",
    label: "Оплачен",
  },
  {
    status: "Accepted",
    label: "Принят рестораном",
  },
  {
    status: "Preparing",
    label: "Готовится",
  },
  {
    status: "Ready",
    label: "Готов к получению",
  },
  {
    status: "PickedUp",
    label: "Получен",
  },
];

function getStatusIndex(status: OrderStatus) {
  return statusSteps.findIndex(
    (step) => step.status === status
  );
}

export default function OrderStatusPage() {
  const navigate = useNavigate();
  const { orderId } = useParams<{ orderId: string }>();

  // The old page rendered a single hardcoded mockOrder no matter which
  // /orders/:orderId URL was opened. Now the order is fetched from
  // orders_with_items; RLS makes it visible only to the guest who placed it.
  const [order, setOrder] = useState<Order | null>(null);
  const [slot, setSlot] = useState<PickupSlot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    if (!orderId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    getOrder(orderId)
      .then((result) => {
        if (cancelled) return;
        setOrder(result);
        if (result?.pickupSlotId) {
          getPickupSlot(result.pickupSlotId)
            .then((s) => {
              if (!cancelled) setSlot(s);
            })
            .catch(() => {
              /* slot display is cosmetic — order still renders */
            });
        }
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [orderId]);

  async function handleCancel() {
    if (!order) return;
    setCancelling(true);
    setError(null);
    try {
      const updated = await cancelOrder(order.id);
      setOrder(updated);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setCancelling(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <p className="text-gray-500">Загружаем заказ…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <button
          onClick={() => navigate("/")}
          className="mb-6 text-sm text-gray-500 hover:text-black"
        >
          ← На главную
        </button>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
          <p className="font-medium text-red-600">{error}</p>
        </div>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <button
          onClick={() => navigate("/")}
          className="mb-6 text-sm text-gray-500 hover:text-black"
        >
          ← На главную
        </button>
        <div className="rounded-2xl border p-8 text-center">
          <p className="font-medium">Заказ не найден</p>
          <p className="mt-1 text-sm text-gray-500">
            Возможно, он был оформлен в другом браузере.
          </p>
        </div>
      </main>
    );
  }

  const currentStatusIndex = getStatusIndex(order.status);

  const pickupTime = slot
    ? new Date(slot.slotTime).toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

  const isCancelled =
    order.status === "Cancelled" ||
    order.status === "Rejected" ||
    order.status === "Expired";

  const cancellable =
    order.status === "Created" || order.status === "Paid";

  return (
    <main className="mx-auto max-w-2xl p-6">
      <button
        onClick={() => navigate("/")}
        className="mb-6 text-sm text-gray-500 hover:text-black"
      >
        ← На главную
      </button>

      {/* Заголовок */}
      <div className="text-center">
        <p className="text-sm text-gray-500">
          Заказ
        </p>

        <h1 className="mt-1 text-3xl font-bold">
          {order.orderNumber}
        </h1>

        <p className="mt-2 text-gray-500">
          Получение в {pickupTime}
        </p>
      </div>

      {/* Статус */}
      <section className="mt-8 rounded-2xl border p-6">
        <h2 className="mb-6 text-lg font-semibold">
          Статус заказа
        </h2>

        {isCancelled ? (
          <div className="rounded-xl bg-red-50 p-4 text-center">
            <p className="font-semibold text-red-600">
              {order.status === "Cancelled"
                ? "Заказ отменён"
                : order.status === "Expired"
                  ? "Заказ истёк — время оплаты вышло"
                  : "Заказ отклонён"}
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {statusSteps.map((step, index) => {
              const isCompleted =
                index <= currentStatusIndex;

              const isCurrent =
                index === currentStatusIndex;

              return (
                <div
                  key={step.status}
                  className="flex items-center gap-4"
                >
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                      isCompleted
                        ? "bg-black text-white"
                        : "bg-gray-100 text-gray-400"
                    }`}
                  >
                    {isCompleted ? "✓" : index + 1}
                  </div>

                  <div>
                    <p
                      className={`font-medium ${
                        isCurrent
                          ? "text-black"
                          : "text-gray-500"
                      }`}
                    >
                      {step.label}
                    </p>

                    {isCurrent && (
                      <p className="mt-1 text-sm text-gray-400">
                        Текущий статус
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {cancellable && (
          <button
            type="button"
            onClick={handleCancel}
            disabled={cancelling}
            className="mt-6 w-full rounded-xl border border-red-200 px-5 py-3 font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-60"
          >
            {cancelling ? "Отменяем…" : "Отменить заказ"}
          </button>
        )}
      </section>

      {/* QR */}
      <section className="mt-6">
        <button
          type="button"
          onClick={() => setShowQr((current) => !current)}
          className="w-full rounded-xl border px-5 py-4 font-medium"
        >
          {showQr
            ? "Скрыть QR-код"
            : "Показать QR-код"}
        </button>

        {showQr && (
          <div className="mt-4 rounded-2xl border p-6 text-center">
            <p className="font-mono text-xs text-gray-500">
              {order.qrToken ?? "QR-код недоступен"}
            </p>

            <p className="mt-4 text-sm text-gray-500">
              Покажите этот код сотруднику ресторана при получении.
            </p>
          </div>
        )}
      </section>

      {/* Состав заказа */}
      <section className="mt-6 rounded-2xl border p-5">
        <h2 className="mb-4 text-lg font-semibold">
          Состав заказа
        </h2>

        <div className="divide-y">
          {order.items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between py-3"
            >
              <div>
                <p className="font-medium">
                  {item.title ?? "Блюдо"}
                </p>

                <p className="text-sm text-gray-500">
                  {item.quantity} ×{" "}
                  {item.priceAtOrder} ₸
                </p>
              </div>

              <p className="font-semibold">
                {item.priceAtOrder * item.quantity} ₸
              </p>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between border-t pt-4">
          <span className="font-semibold">
            Итого
          </span>

          <span className="text-xl font-bold">
            {order.totalAmount} ₸
          </span>
        </div>
      </section>
    </main>
  );
}
