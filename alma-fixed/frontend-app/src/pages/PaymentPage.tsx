import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";

import { useCart } from "../context/CartContext";
import { placeOrder, getErrorMessage } from "../lib/api";
import type { Order } from "../types/shared";

type PaymentMethod = "card" | "cash";

export default function PaymentPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const {
    items,
    restaurantId,
    total,
    clearCart,
  } = useCart();

  // The slot chosen on CartPage travels through router state; the backend
  // rejects orders without one (SLTRQ), and the old page never sent
  // anything at all — the whole checkout was a mock.
  const pickupSlotId =
    (location.state as { pickupSlotId?: string } | null)?.pickupSlotId ?? null;

  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod>("card");

  const [placing, setPlacing] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePayment = async () => {
    if (!restaurantId || !pickupSlotId || items.length === 0) {
      setError("Выберите время получения и добавьте блюда в корзину.");
      return;
    }

    setPlacing(true);
    setError(null);
    try {
      // Server-side pricing: only ids and quantities are sent; the total is
      // computed in the database, so the displayed total can't be tampered
      // with from devtools.
      const created = await placeOrder({
        restaurantId,
        slotId: pickupSlotId,
        items: items.map((item) => ({
          menuItemId: item.menuItem.id,
          quantity: item.quantity,
        })),
      });
      setOrder(created);
      clearCart();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setPlacing(false);
    }
  };

  if (order) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <div className="rounded-2xl border bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-2xl text-green-600">
            ✓
          </div>

          <h1 className="text-3xl font-bold">
            Заказ оформлен
          </h1>

          <p className="mt-3 text-gray-500">
            {paymentMethod === "card"
              ? "Оплата прошла успешно"
              : "Заказ подтверждён"}
          </p>

          <div className="mt-6 rounded-xl bg-gray-50 p-5">
            <p className="text-sm text-gray-500">
              Номер заказа
            </p>

            <p className="mt-1 text-2xl font-bold">
              {order.orderNumber}
            </p>
          </div>

          <button
            onClick={() => navigate(`/orders/${order.id}`)}
            className="mt-6 w-full rounded-xl bg-black px-5 py-3 font-medium text-white"
          >
            Перейти к заказу
          </button>
        </div>
      </main>
    );
  }

  if (items.length === 0) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <div className="rounded-2xl border p-8 text-center">
          <h1 className="text-2xl font-bold">
            Корзина пуста
          </h1>

          <p className="mt-2 text-gray-500">
            Добавьте блюда перед оформлением заказа.
          </p>

          <button
            onClick={() => navigate("/")}
            className="mt-6 rounded-xl bg-black px-5 py-3 text-white"
          >
            Вернуться в меню
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <button
        onClick={() => navigate(-1)}
        className="mb-6 text-sm text-gray-500"
      >
        ← Назад
      </button>

      <h1 className="text-3xl font-bold">
        Оплата
      </h1>

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold">
          Ваш заказ
        </h2>

        <div className="divide-y rounded-2xl border">
          {items.map((item) => (
            <div
              key={item.menuItem.id}
              className="flex items-center justify-between gap-4 p-4"
            >
              <div>
                <p className="font-medium">
                  {item.menuItem.name}
                </p>

                <p className="text-sm text-gray-500">
                  {item.quantity} × {item.menuItem.price} ₸
                </p>
              </div>

              <p className="font-semibold">
                {item.menuItem.price * item.quantity} ₸
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-3 text-lg font-semibold">
          Способ оплаты
        </h2>

        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setPaymentMethod("card")}
            className={`w-full rounded-xl border p-4 text-left ${
              paymentMethod === "card"
                ? "border-black bg-gray-50"
                : "border-gray-200"
            }`}
          >
            <p className="font-medium">
              Банковская карта
            </p>

            <p className="mt-1 text-sm text-gray-500">
              Visa / Mastercard
            </p>
          </button>

          <button
            type="button"
            onClick={() => setPaymentMethod("cash")}
            className={`w-full rounded-xl border p-4 text-left ${
              paymentMethod === "cash"
                ? "border-black bg-gray-50"
                : "border-gray-200"
            }`}
          >
            <p className="font-medium">
              Оплата на месте
            </p>

            <p className="mt-1 text-sm text-gray-500">
              Оплатить при получении
            </p>
          </button>
        </div>
      </section>

      <section className="mt-6 rounded-2xl bg-gray-50 p-5">
        <div className="flex items-center justify-between">
          <span className="text-gray-500">
            Итого
          </span>

          <span className="text-2xl font-bold">
            {total} ₸
          </span>
        </div>
      </section>

      {error && (
        <p className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-600">
          {error}
        </p>
      )}

      <button
        onClick={handlePayment}
        disabled={placing}
        className={`mt-6 w-full rounded-xl px-5 py-4 font-medium text-white transition ${
          placing ? "cursor-wait bg-gray-400" : "bg-black hover:bg-gray-800"
        }`}
      >
        {placing
          ? "Оформляем заказ…"
          : paymentMethod === "card"
            ? `Оплатить ${total} ₸`
            : "Подтвердить заказ"}
      </button>
    </main>
  );
}
