import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import type { MenuItem } from "../types/shared";
import { useCart } from "../context/CartContext";
import { getMenuItems, getErrorMessage } from "../lib/api";

// Labels for the category tabs. The tab ids are derived from the actual
// `category` values of the restaurant's menu items in the database, so a
// new category added to the backend shows up without a code change.
const CATEGORY_LABELS: Record<string, string> = {
  popular: "Популярное",
  snacks: "Закуски",
  main: "Основные блюда",
  soups: "Супы",
  salads: "Салаты",
  drinks: "Напитки",
  desserts: "Десерты",
  grill: "Гриль",
};

const FALLBACK_LABEL = "Другое";

const formatPrice = (price: number) =>
  new Intl.NumberFormat("ru-RU").format(price);

export default function MenuPage() {
  const navigate = useNavigate();
  const { restaurantId } = useParams<{ restaurantId: string }>();

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);

  useEffect(() => {
    if (!restaurantId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setMenuItems([]);
    setActiveCategoryId(null);

    getMenuItems(restaurantId)
      .then((rows) => {
        if (cancelled) return;
        // Only available dishes, same filter the old hardcoded list applied.
        const available = rows.filter((item) => item.isAvailable);
        setMenuItems(available);
        setActiveCategoryId(available[0]?.categoryId ?? null);
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
  }, [restaurantId]);

  const {
    items: cartItems,
    itemsCount: cartItemsCount,
    total: cartTotal,
    addItem,
    removeItem,
  } = useCart();

  // Tabs follow the data: distinct categories of THIS restaurant's menu,
  // in the order the backend returns them.
  const categories = useMemo(() => {
    const seen: string[] = [];
    for (const item of menuItems) {
      if (!seen.includes(item.categoryId)) seen.push(item.categoryId);
    }
    return seen.map((id) => ({
      id,
      label: CATEGORY_LABELS[id] ?? FALLBACK_LABEL,
    }));
  }, [menuItems]);

  const visibleItems = useMemo(
    () => menuItems.filter((item) => item.categoryId === activeCategoryId),
    [menuItems, activeCategoryId]
  );

  const getCartQuantity = (menuItemId: string) =>
    cartItems.find(
      (item) => item.menuItem.id === menuItemId
    )?.quantity ?? 0;

  return (
    <main className="min-h-screen bg-neutral-50 pb-28 text-neutral-950">
      {/* Header */}
      <header className="border-b border-neutral-200 bg-white">

        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div>
                <button
                onClick={() => navigate(-1)}
                className=" text-sm text-gray-500 hover:text-black"
                >
                    ← Назад
                </button>


              <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
                Меню
              </h1>
            </div>
          </div>
        </div>
      </header>

      {/* Categories */}
      <nav className="sticky top-0 z-20 border-b border-neutral-200 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex gap-2 overflow-x-auto py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {categories.map((category) => {
              const isActive =
                category.id === activeCategoryId;

              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() =>
                    setActiveCategoryId(category.id)
                  }
                  className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition ${
                    isActive
                      ? "bg-neutral-950 text-white"
                      : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                  }`}
                >
                  {category.label}
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {/* Menu */}
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h2 className="text-xl font-bold">
            {
              categories.find(
                (category) =>
                  category.id === activeCategoryId
              )?.label
            }
          </h2>

          <p className="mt-1 text-sm text-neutral-500">
            Выберите блюда, которые хотите заказать
          </p>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-neutral-200 bg-white px-6 py-16 text-center text-sm text-neutral-500">
            Загружаем меню…
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-12 text-center">
            <p className="font-medium text-red-600">{error}</p>
            <p className="mt-1 text-sm text-red-400">
              Проверьте подключение к Supabase и попробуйте ещё раз.
            </p>
          </div>
        ) : visibleItems.length > 0 ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {visibleItems.map((item) => {
              const quantity = getCartQuantity(item.id);

              return (
                <article
                  key={item.id}
                  className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm transition hover:shadow-md"
                >
                  {/* Image */}
                  <div className="relative aspect-[4/3] overflow-hidden bg-neutral-100">
                    {item.imageUrl && (
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        className="h-full w-full object-cover transition duration-300 hover:scale-105"
                      />
                    )}

                    {quantity > 0 && (
                      <div className="absolute right-3 top-3 rounded-full bg-neutral-950 px-3 py-1 text-xs font-semibold text-white">
                        В корзине: {quantity}
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-4">
                    <h3 className="font-semibold">
                      {item.name}
                    </h3>

                    {item.description && (
                      <p className="mt-2 min-h-10 text-sm leading-5 text-neutral-500">
                        {item.description}
                      </p>
                    )}

                    <div className="mt-4 flex items-center justify-between gap-3">
                      <span className="text-lg font-bold">
                        {formatPrice(item.price)} ₸
                      </span>

                      {quantity === 0 ? (
                        <button
                          type="button"
                          onClick={() => addItem(item)}
                          className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-950 text-xl text-white transition hover:bg-neutral-800"
                          aria-label={`Добавить ${item.name}`}
                        >
                          +
                        </button>
                      ) : (
                        <div className="flex items-center gap-3 rounded-full bg-neutral-100 p-1">
                          <button
                            type="button"
                            onClick={() =>
                              removeItem(item.id)
                            }
                            className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-lg shadow-sm"
                            aria-label={`Уменьшить количество ${item.name}`}
                          >
                            −
                          </button>

                          <span className="min-w-4 text-center text-sm font-semibold">
                            {quantity}
                          </span>

                          <button
                            type="button"
                            onClick={() => addItem(item)}
                            className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-950 text-lg text-white"
                            aria-label={`Добавить ${item.name}`}
                          >
                            +
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-6 py-16 text-center">
            <p className="font-medium">
              В этой категории пока нет доступных блюд
            </p>
          </div>
        )}
      </section>

      {/* Sticky cart */}
      {cartItemsCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-neutral-200 bg-white/95 p-3 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <div>
              <p className="text-sm text-neutral-500">
                {cartItemsCount}{" "}
                {cartItemsCount === 1
                  ? "товар"
                  : cartItemsCount < 5
                    ? "товара"
                    : "товаров"}
              </p>

              <p className="font-bold">
                {formatPrice(cartTotal)} ₸
              </p>
            </div>

            <button
              type="button"
              onClick={() => navigate("/cart")}
              className="rounded-xl bg-neutral-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-neutral-800"
            >
              Перейти в корзину
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
