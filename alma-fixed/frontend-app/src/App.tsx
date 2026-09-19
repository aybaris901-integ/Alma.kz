import { Routes, Route, BrowserRouter } from "react-router-dom";
import { useEffect } from "react";
import { getGuestSessionId } from "./lib/guestSession";
import MenuPage from "./pages/MenuPage";
import CartPage from "./pages/CartPage";
import HomePage from "./pages/HomePage";
import PaymentPage from "./pages/PaymentPage";
import OrderStatusPage from "./pages/OrderStatusPage";

// The CartProvider lives in main.tsx; wrapping again here would create a
// second, independent cart state that components under this tree would
// silently use instead of the one above.
export default function App() {
  useEffect(() => {
    getGuestSessionId();
  }, []);
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/orders/:orderId" element={<OrderStatusPage />} />
        <Route path="/" element={<HomePage />} />
        <Route path="/restaurants/:restaurantId/menu" element={<MenuPage />} />
        <Route path="/cart" element={<CartPage />} />
        <Route path="/payment" element={<PaymentPage />} />
      </Routes>
    </BrowserRouter>
  );
}
