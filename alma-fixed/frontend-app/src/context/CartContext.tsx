import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { CartItem, MenuItem } from "../types/shared";

interface CartContextValue {
  items: CartItem[];
  // Which restaurant the cart belongs to. Needed to fetch that
  // restaurant's pickup slots (CartPage) and to create the order
  // (PaymentPage). Set from menuItem.restaurantId on the first add.
  restaurantId: string | null;
  itemsCount: number;
  total: number;
  addItem: (menuItem: MenuItem) => void;
  removeItem: (menuItemId: string) => void;
  removeAllItem: (menuItemId: string) => void;
  updateQuantity: (menuItemId: string, quantity: number) => void;
  clearCart: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [restaurantId, setRestaurantId] = useState<string | null>(null);

  const addItem = (menuItem: MenuItem) => {
    // Switching restaurants mid-order starts a fresh cart — the pickup
    // slot (and the order itself) can only belong to one restaurant.
    if (restaurantId && menuItem.restaurantId !== restaurantId) {
      setRestaurantId(menuItem.restaurantId);
      setItems([{ menuItem, quantity: 1 }]);
      return;
    }

    if (!restaurantId) {
      setRestaurantId(menuItem.restaurantId);
    }

    setItems((current) => {
      const existing = current.find(
        (item) => item.menuItem.id === menuItem.id
      );

      if (existing) {
        return current.map((item) =>
          item.menuItem.id === menuItem.id
            ? {
                ...item,
                quantity: item.quantity + 1,
              }
            : item
        );
      }

      return [
        ...current,
        {
          menuItem,
          quantity: 1,
        },
      ];
    });
  };

  const removeItem = (menuItemId: string) => {
    setItems((current) =>
      current
        .map((item) =>
          item.menuItem.id === menuItemId
            ? {
                ...item,
                quantity: item.quantity - 1,
              }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  };

  const removeAllItem = (menuItemId: string) => {
    setItems((current) =>
      current.filter((item) => item.menuItem.id !== menuItemId)
    );
  };

  const updateQuantity = (menuItemId: string, quantity: number) => {
    if (quantity <= 0) {
      removeItem(menuItemId);
      return;
    }

    setItems((current) =>
      current.map((item) =>
        item.menuItem.id === menuItemId
          ? {
              ...item,
              quantity,
            }
          : item
      )
    );
  };

  const clearCart = () => {
    setItems([]);
  };

  const itemsCount = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity, 0),
    [items]
  );

  const total = useMemo(
    () =>
      items.reduce(
        (sum, item) => sum + item.menuItem.price * item.quantity,
        0
      ),
    [items]
  );

  return (
    <CartContext.Provider
      value={{
        items,
        restaurantId,
        itemsCount,
        total,
        addItem,
        removeItem,
        removeAllItem,
        updateQuantity,
        clearCart,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);

  if (!context) {
    throw new Error(
      "useCart must be used inside CartProvider"
    );
  }

  return context;
}
