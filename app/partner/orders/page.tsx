import type { MenuItem, Order, OrderStatus } from "@/types/shared";

// ---------------------------------------------------------------------------
// Mock data — replace with a fetch from the orders API once the backend exists.
// ---------------------------------------------------------------------------

const RESTAURANT_ID = "rest_qazan_house";

const MOCK_MENU: MenuItem[] = [
  { id: "mi_beshbarmak", restaurantId: RESTAURANT_ID, name: "Бешбармак", price: 3200, isAvailable: true, category: "Main" },
  { id: "mi_manty", restaurantId: RESTAURANT_ID, name: "Манты (6 шт)", price: 2100, isAvailable: true, category: "Main" },
  { id: "mi_baursak", restaurantId: RESTAURANT_ID, name: "Баурсаки", price: 800, isAvailable: true, category: "Sides" },
  { id: "mi_shubat", restaurantId: RESTAURANT_ID, name: "Шубат 0.5л", price: 900, isAvailable: true, category: "Drinks" },
  { id: "mi_tea", restaurantId: RESTAURANT_ID, name: "Чай с молоком", price: 500, isAvailable: true, category: "Drinks" },
];

const MOCK_ORDERS: Order[] = [
  {
    id: "ord_001",
    orderNumber: "A-1042",
    restaurantId: RESTAURANT_ID,
    guestSessionId: "gs_7f3a",
    pickupSlotId: "slot_1230",
    status: "Paid",
    totalAmount: 5300,
    qrToken: "qr_9d2c1e",
    items: [
      { id: "oi_1", menuItemId: "mi_beshbarmak", quantity: 1, priceAtOrder: 3200 },
      { id: "oi_2", menuItemId: "mi_manty", quantity: 1, priceAtOrder: 2100 },
    ],
    createdAt: "2026-09-19T12:04:00+05:00",
    slotTime: "2026-09-19T12:30:00+05:00",
  },
  {
    id: "ord_002",
    orderNumber: "A-1043",
    restaurantId: RESTAURANT_ID,
    guestSessionId: "gs_b81e",
    pickupSlotId: "slot_1245",
    status: "Preparing",
    totalAmount: 5000,
    qrToken: "qr_44a0f7",
    items: [
      { id: "oi_3", menuItemId: "mi_manty", quantity: 2, priceAtOrder: 2100 },
      { id: "oi_4", menuItemId: "mi_baursak", quantity: 1, priceAtOrder: 800 },
    ],
    createdAt: "2026-09-19T12:11:00+05:00",
    slotTime: "2026-09-19T12:45:00+05:00",
  },
  {
    id: "ord_003",
    orderNumber: "A-1041",
    restaurantId: RESTAURANT_ID,
    guestSessionId: "gs_c052",
    pickupSlotId: "slot_1215",
    status: "Ready",
    totalAmount: 1400,
    qrToken: "qr_e13b9a",
    items: [
      { id: "oi_5", menuItemId: "mi_shubat", quantity: 1, priceAtOrder: 900 },
      { id: "oi_6", menuItemId: "mi_tea", quantity: 1, priceAtOrder: 500 },
    ],
    createdAt: "2026-09-19T11:52:00+05:00",
    readyAt: "2026-09-19T12:09:00+05:00",
    slotTime: "2026-09-19T12:15:00+05:00",
  },
];

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<OrderStatus, { label: string; className: string }> = {
  Created: { label: "Создан", className: "bg-slate-100 text-slate-700 ring-slate-200" },
  Paid: { label: "Оплачен", className: "bg-blue-50 text-blue-700 ring-blue-200" },
  Accepted: { label: "Принят", className: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
  Preparing: { label: "Готовится", className: "bg-amber-50 text-amber-700 ring-amber-200" },
  Ready: { label: "Готов", className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  PickedUp: { label: "Выдан", className: "bg-slate-100 text-slate-500 ring-slate-200" },
  Cancelled: { label: "Отменён", className: "bg-rose-50 text-rose-700 ring-rose-200" },
  Rejected: { label: "Отклонён", className: "bg-rose-50 text-rose-700 ring-rose-200" },
  NoShow: { label: "Не пришёл", className: "bg-rose-50 text-rose-700 ring-rose-200" },
  Delayed: { label: "Задержка", className: "bg-orange-50 text-orange-700 ring-orange-200" },
};

/** The primary action a restaurant can take from a given status. */
const NEXT_ACTION: Partial<Record<OrderStatus, string>> = {
  Paid: "Принять заказ",
  Accepted: "Начать готовить",
  Preparing: "Заказ готов",
  Ready: "Выдать заказ",
};

const menuById = new Map(MOCK_MENU.map((m) => [m.id, m]));

const timeFormatter = new Intl.DateTimeFormat("ru-KZ", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Almaty",
});

const currencyFormatter = new Intl.NumberFormat("ru-KZ", {
  style: "currency",
  currency: "KZT",
  maximumFractionDigits: 0,
});

function formatTime(iso?: string) {
  return iso ? timeFormatter.format(new Date(iso)) : "—";
}

function StatusBadge({ status }: { status: OrderStatus }) {
  const { label, className } = STATUS_STYLES[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${className}`}
    >
      {label}
    </span>
  );
}

function SummaryTile({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-3xl font-semibold tabular-nums ${accent}`}>{value}</div>
    </div>
  );
}

function OrderCard({ order }: { order: Order }) {
  const action = NEXT_ACTION[order.status];

  return (
    <article className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div>
          <div className="text-lg font-semibold text-slate-900">№ {order.orderNumber}</div>
          <div className="text-xs text-slate-500">Создан в {formatTime(order.createdAt)}</div>
        </div>
        <StatusBadge status={order.status} />
      </header>

      <div className="grid grid-cols-2 gap-3 px-4 py-3 text-sm">
        <div>
          <div className="text-xs text-slate-500">Слот выдачи</div>
          <div className="font-medium tabular-nums text-slate-900">{formatTime(order.slotTime)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Готов в</div>
          <div className="font-medium tabular-nums text-slate-900">{formatTime(order.readyAt)}</div>
        </div>
      </div>

      <ul className="flex-1 space-y-1.5 border-t border-slate-100 px-4 py-3 text-sm">
        {order.items.map((item) => {
          const menuItem = menuById.get(item.menuItemId);
          return (
            <li key={item.id} className="flex items-baseline justify-between gap-3">
              <span className="text-slate-800">
                <span className="mr-1.5 font-semibold tabular-nums text-slate-500">{item.quantity}×</span>
                {menuItem?.name ?? item.menuItemId}
              </span>
              <span className="tabular-nums text-slate-600">
                {currencyFormatter.format(item.priceAtOrder * item.quantity)}
              </span>
            </li>
          );
        })}
      </ul>

      <footer className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
        <div>
          <div className="text-xs text-slate-500">Итого</div>
          <div className="text-base font-semibold tabular-nums text-slate-900">
            {currencyFormatter.format(order.totalAmount)}
          </div>
        </div>
        {action ? (
          <button
            type="button"
            className="rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
          >
            {action}
          </button>
        ) : null}
      </footer>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES: OrderStatus[] = ["Paid", "Accepted", "Preparing", "Ready", "Delayed"];

export default function PartnerOrdersPage() {
  const orders = MOCK_ORDERS;

  const countBy = (statuses: OrderStatus[]) =>
    orders.filter((o) => statuses.includes(o.status)).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Заказы</h1>
          <p className="text-sm text-slate-500">Активные заказы на самовывоз</p>
        </div>
        <div className="text-sm text-slate-500">
          Всего активных:{" "}
          <span className="font-semibold text-slate-900">{countBy(ACTIVE_STATUSES)}</span>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile label="Новые" value={countBy(["Paid"])} accent="text-blue-700" />
        <SummaryTile label="Принято" value={countBy(["Accepted"])} accent="text-indigo-700" />
        <SummaryTile label="Готовится" value={countBy(["Preparing", "Delayed"])} accent="text-amber-700" />
        <SummaryTile label="Готово к выдаче" value={countBy(["Ready"])} accent="text-emerald-700" />
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {orders.map((order) => (
          <OrderCard key={order.id} order={order} />
        ))}
      </section>
    </div>
  );
}
