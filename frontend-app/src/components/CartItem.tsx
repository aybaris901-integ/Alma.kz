import type { CartItem as CartItemType } from "../types/shared";

interface CartItemProps {
  item: CartItemType;
  onIncrease: (menuItemId: string) => void;
  onDecrease: (menuItemId: string) => void;
  onRemove: (menuItemId: string) => void;
}

export default function CartItem({
  item,
  onIncrease,
  onDecrease,
  onRemove,
}: CartItemProps) {
  const { menuItem, quantity } = item;

  return (
    <div className="py-4">
      {/* Верхняя часть */}
      <div className="flex gap-3">
        {menuItem.imageUrl && (
          <img
            src={menuItem.imageUrl}
            alt={menuItem.name}
            className="h-20 w-20 shrink-0 rounded-lg object-cover"
          />
        )}

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold">
            {menuItem.name}
          </h3>

          {menuItem.description && (
            <p className="mt-1 line-clamp-2 text-xs leading-4 text-gray-500">
              {menuItem.description}
            </p>
          )}

          <p className="mt-2 text-sm font-medium">
            {menuItem.price} ₸
          </p>
        </div>
      </div>

      {/* Нижняя часть */}
      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onRemove(menuItem.id)}
          className="text-xs text-red-500"
        >
          Удалить
        </button>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onDecrease(menuItem.id)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border text-lg"
          >
            −
          </button>

          <span className="w-4 text-center text-sm font-medium">
            {quantity}
          </span>

          <button
            type="button"
            onClick={() => onIncrease(menuItem.id)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border text-lg"
          >
            +
          </button>
        </div>

        <span className="text-sm font-semibold">
          {menuItem.price * quantity} ₸
        </span>
      </div>
    </div>
  );
}