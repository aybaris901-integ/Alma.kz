import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import CartItem from "../components/CartItem";
import { useCart } from "../context/CartContext";
import type { PickupSlot } from "../types/shared";
import { getAvailablePickupSlots, getErrorMessage } from "../lib/api";

function formatPickupTime(slotTime: string) {
  return new Date(slotTime).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function CartPage() {
  const navigate = useNavigate();

  const {
    items,
    restaurantId,
    total,
    addItem,
    removeItem,
    removeAllItem,
  } = useCart();

  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(
    null
  );

  // Pickup slots now come from the `pickup_slots` table for the restaurant
  // the cart belongs to. The old page rendered a hardcoded array with
  // dates frozen at 2026-09-19, so the list was stale the moment it shipped.
  const [slots, setSlots] = useState<PickupSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  useEffect(() => {
    if (!restaurantId) {
      setSlots([]);
      setLoadingSlots(false);
      return;
    }

    let cancelled = false;
    setLoadingSlots(true);
    setSlotsError(null);

    getAvailablePickupSlots(restaurantId)
      .then((rows) => {
        if (!cancelled) setSlots(rows);
      })
      .catch((err) => {
        if (!cancelled) setSlotsError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingSlots(false);
      });

    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  // Keep the selection valid if the slot list changes after a refetch.
  useEffect(() => {
    if (selectedSlotId && !slots.some((slot) => slot.id === selectedSlotId)) {
      setSelectedSlotId(null);
    }
  }, [slots, selectedSlotId]);

  const availableSlots = slots.filter(
    (slot) => slot.bookedLoad < slot.capacity
  );

  const increase = (menuItemId: string) => {
    const item = items.find(
      (item) => item.menuItem.id === menuItemId
    );

    if (item) {
      addItem(item.menuItem);
    }
  };

  const decrease = (menuItemId: string) => {
    removeItem(menuItemId);
  };

  const remove = (menuItemId: string) => {
    removeAllItem(menuItemId);
  };

  const handleCheckout = () => {
    if (!selectedSlotId) {
      return;
    }

    navigate("/payment", {
      state: {
        pickupSlotId: selectedSlotId,
      },
    });
  };

  return (
    <main className="mx-auto max-w-4xl p-6">
      <button
        onClick={() => navigate(-1)}
        className="mb-6 text-sm text-gray-500 hover:text-black"
      >
        ← Назад
      </button>

      <h1 className="mb-6 text-3xl font-bold">
        Корзина
      </h1>

      {items.length === 0 ? (
        <div className="rounded-xl border p-8 text-center">
          <p className="text-gray-500">
            Корзина пуста
          </p>

          <button
            onClick={() => navigate("/")}
            className="mt-5 rounded-lg bg-black px-6 py-3 text-white"
          >
            Вернуться в меню
          </button>
        </div>
      ) : (
        <>
          {/* Товары */}
          <section>
            <h2 className="mb-3 text-lg font-semibold">
              Ваш заказ
            </h2>

            <div className="rounded-xl border p-4">
              {items.map((item) => (
                <CartItem
                  key={item.menuItem.id}
                  item={item}
                  onIncrease={increase}
                  onDecrease={decrease}
                  onRemove={remove}
                />
              ))}
            </div>
          </section>

          {/* Время получения */}
          <section className="mt-8">
            <h2 className="mb-1 text-lg font-semibold">
              Время получения
            </h2>

            <p className="mb-4 text-sm text-gray-500">
              Выберите удобное время для получения заказа
            </p>

            {loadingSlots ? (
              <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-500">
                Загружаем доступное время…
              </p>
            ) : slotsError ? (
              <p className="rounded-xl bg-red-50 p-4 text-sm text-red-600">
                {slotsError}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {availableSlots.map((slot) => {
                  const isSelected =
                    selectedSlotId === slot.id;

                  return (
                    <button
                      key={slot.id}
                      type="button"
                      onClick={() =>
                        setSelectedSlotId(slot.id)
                      }
                      className={`rounded-xl border px-4 py-3 text-center transition ${
                        isSelected
                          ? "border-black bg-black text-white"
                          : "border-gray-200 bg-white hover:border-gray-400"
                      }`}
                    >
                      <span className="font-semibold">
                        {formatPickupTime(slot.slotTime)}
                      </span>

                      <span className="mt-1 block text-xs opacity-70">
                        мест: {slot.capacity - slot.bookedLoad}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {!loadingSlots && !slotsError && availableSlots.length === 0 && (
              <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-500">
                На данный момент доступных слотов нет.
              </p>
            )}
          </section>

          {/* Итог */}
          <section className="mt-8 rounded-xl bg-gray-50 p-5">
            <div className="flex items-center justify-between">
              <span className="text-lg font-medium">
                Итого
              </span>

              <span className="text-2xl font-bold">
                {total} ₸
              </span>
            </div>
          </section>

          {/* Оформление */}
          <button
            onClick={handleCheckout}
            disabled={!selectedSlotId}
            className={`mt-6 w-full rounded-xl px-6 py-4 font-medium text-white transition ${
              selectedSlotId
                ? "bg-black hover:bg-gray-800"
                : "cursor-not-allowed bg-gray-300"
            }`}
          >
            {selectedSlotId
              ? "Перейти к оплате"
              : "Выберите время получения"}
          </button>
        </>
      )}
    </main>
  );
}
