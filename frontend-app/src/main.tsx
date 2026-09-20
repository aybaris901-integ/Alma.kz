import './index.css'
import React from "react";
import ReactDOM from "react-dom/client";

import App from './App.tsx'
// Case-sensitive import: the file is CartContext.tsx. The old spelling
// ('./context/cartContext') broke the build on case-sensitive filesystems
// (Linux CI, Docker, some Windows toolchains) — one reason the app
// "wouldn't launch at all".
import { CartProvider } from './context/CartContext';

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CartProvider>
      <App />
    </CartProvider>
  </React.StrictMode>
);
