import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import logo from "../assets/logo.jpg";

import type { Restaurant } from "../types/shared";
import { getRestaurants, getErrorMessage } from "../lib/api";

type RestaurantCardData = {
  restaurant: Restaurant;
  rating: number;
  distance: number;
  closingTime: string;
  pickupTime: string;
  imageUrl?: string;
};

// The catalog (name/address/isActive) now comes from the `restaurants`
// table via Supabase — HomePage used to render a hardcoded list, so new
// restaurants never appeared. Ratings/distance/closing time are not in the
// schema yet; they stay as presentation-only defaults until the backend
// grows those columns.
const PRESENTATION_DEFAULTS = [
  {
    rating: 4.8,
    distance: 350,
    closingTime: "22:00",
    pickupTime: "12:40",
    imageUrl:
      "https://images.unsplash.com/photo-1571091718767-18b5b1457add?auto=format&fit=crop&w=900&q=80",
  },
  {
    rating: 4.6,
    distance: 700,
    closingTime: "23:00",
    pickupTime: "12:45",
    imageUrl:
      "https://images.unsplash.com/photo-1579751626657-72bc17010498?auto=format&fit=crop&w=900&q=80",
  },
];

const FALLBACK_IMAGE =
  "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=900&q=80";

const formatDistance = (distance: number) => {
  if (distance >= 1000) {
    return `${(distance / 1000).toFixed(1)} км`;
  }

  return `${distance} м`;
};

export default function HomePage() {
  const navigate = useNavigate();

  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getRestaurants()
      .then((rows) => {
        if (!cancelled) setRestaurants(rows);
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
  }, []);

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"nearest" | "rating">("nearest");

  const cards: RestaurantCardData[] = useMemo(
    () =>
      restaurants.map((restaurant, index) => ({
        restaurant,
        ...(PRESENTATION_DEFAULTS[index % PRESENTATION_DEFAULTS.length]),
        imageUrl: PRESENTATION_DEFAULTS[index % PRESENTATION_DEFAULTS.length]
          .imageUrl,
      })),
    [restaurants]
  );

  const filteredRestaurants = useMemo(() => {
    const query = search.trim().toLowerCase();

    const filtered = cards.filter((item) => {
      if (!query) return true;

      return (
        item.restaurant.name.toLowerCase().includes(query) ||
        item.restaurant.address.toLowerCase().includes(query)
      );
    });

    return [...filtered].sort((a, b) => {
      if (sort === "rating") {
        return b.rating - a.rating;
      }

      return a.distance - b.distance;
    });
  }, [cards, search, sort]);

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-950">
      {/* Header */}
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
          {/* Logo */}
          <button
            type="button"
            onClick={() => navigate("/")}
            className="text-xl font-bold tracking-tight"
          >
            <img
                src={logo}
                alt="Logo"
                className="h-8 w-auto object-contain" // Задайте нужную высоту (например, h-8, h-10 или h-12)
            />
          </button>


        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 pb-10">
        {/* Search */}
        <section className="pt-8">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Найти заведение
          </h1>

          <div className="relative mt-4">
            <svg
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-4-4" />
            </svg>

            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск..."
              className="h-12 w-full rounded-xl border border-neutral-200 bg-white pl-11 pr-4 text-sm outline-none transition placeholder:text-neutral-400 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100"
            />
          </div>
        </section>

        {/* Nearby */}
        <section className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              Рядом с вами
            </h2>

            <select
              value={sort}
              onChange={(event) =>
                setSort(
                  event.target.value as "nearest" | "rating"
                )
              }
              className="cursor-pointer appearance-none rounded-lg border border-neutral-200 bg-white px-3 py-2 pr-8 text-sm font-medium outline-none"
            >
              <option value="nearest">Ближайшие</option>
              <option value="rating">По рейтингу</option>
            </select>
          </div>

          {/* Restaurant list */}
          <div className="mt-4 space-y-4">
            {loading ? (
              <div className="rounded-2xl border border-neutral-200 bg-white px-6 py-12 text-center text-sm text-neutral-500">
                Загружаем заведения…
              </div>
            ) : error ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-8 text-center">
                <p className="font-medium text-red-600">{error}</p>
                <p className="mt-1 text-sm text-red-400">
                  Проверьте подключение к Supabase и обновите страницу.
                </p>
              </div>
            ) : filteredRestaurants.length > 0 ? (
              filteredRestaurants.map((item) => {
                const { restaurant } = item;

                return (
                  <button
                    key={restaurant.id}
                    type="button"
                    disabled={!restaurant.isActive}
                    onClick={() =>
                      navigate(
                        `/restaurants/${restaurant.id}/menu`
                      )
                    }
                    className="group block w-full overflow-hidden rounded-2xl border border-neutral-200 bg-white text-left shadow-sm transition hover:border-neutral-300 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {/* Image */}
                    <div className="aspect-[2/1] w-full overflow-hidden bg-neutral-100">
                      <img
                        src={item.imageUrl || FALLBACK_IMAGE}
                        alt={restaurant.name}
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                      />
                    </div>

                    {/* Information */}
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-lg font-semibold">
                            {restaurant.name}
                          </h3>

                          <div className="mt-1 flex items-center gap-2 text-sm text-neutral-500">
                            <span className="font-medium text-neutral-700">
                              ★ {item.rating.toFixed(1)}
                            </span>

                            <span>•</span>

                            <span>
                              {formatDistance(item.distance)}
                            </span>
                          </div>
                        </div>

                        <span
                          className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                            restaurant.isActive
                              ? "bg-green-500"
                              : "bg-neutral-400"
                          }`}
                        />
                      </div>

                      <div className="mt-3 flex items-center gap-2 text-sm text-neutral-500">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            restaurant.isActive
                              ? "bg-green-500"
                              : "bg-neutral-400"
                          }`}
                        />

                        <span>
                          {restaurant.isActive
                            ? `Открыто до ${item.closingTime}`
                            : "Закрыто"}
                        </span>
                      </div>

                      <p className="mt-2 truncate text-sm text-neutral-400">
                        {restaurant.address}
                      </p>

                      {restaurant.isActive && (
                        <div className="mt-3 border-t border-neutral-100 pt-3">
                          <span className="text-sm font-medium text-neutral-700">
                            Получение от {item.pickupTime}
                          </span>
                        </div>
                      )}
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-6 py-12 text-center">
                <p className="font-medium">
                  Заведения не найдены
                </p>

                <p className="mt-1 text-sm text-neutral-500">
                  Попробуйте изменить поисковый запрос
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
