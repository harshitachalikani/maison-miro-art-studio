import { createContext, useCallback, useContext, useState } from "react";

const CartContext = createContext(null);

export function CartProvider({ children }) {
  const [items, setItems] = useState([]);

  const addToCart = useCallback((item) => {
    setItems((current) => {
      if (item.type === "pottery") {
        const existing = current.find((line) => line.type === "pottery" && line.id === item.id && line.details.glaze_id === item.details.glaze_id && line.details.needed_by === item.details.needed_by);
        if (existing && existing.quantity + item.quantity <= 12) return current.map((line) => line === existing ? { ...line, quantity: line.quantity + item.quantity } : line);
      } else if (item.type === "painting" || !item.type) {
        if (current.some((line) => line.type === "painting" && line.id === item.id)) return current;
      }
      const type = item.type || "painting";
      const normalized = type === "painting"
        ? { ...item, name: item.name || item.title, unit_price: Number(item.unit_price ?? item.price), quantity: 1 }
        : item;
      return [...current, { ...normalized, type, cartId: item.cartId || `${type}:${item.id}:${Date.now()}` }];
    });
  }, []);

  const updateQuantity = useCallback((cartId, quantity) => {
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 12) return;
    setItems((current) => current.map((item) => item.cartId === cartId ? { ...item, quantity: qty } : item));
  }, []);

  const updateMuralSize = useCallback((cartId, wallSizeSqft) => {
    const size = Number(wallSizeSqft);
    if (!Number.isInteger(size) || size < 10 || size > 500) return;
    setItems((current) => current.map((item) => item.cartId === cartId && item.type === "mural"
      ? { ...item, details: { ...item.details, wall_size_sqft: size } }
      : item));
  }, []);

  const removeFromCart = useCallback((cartId) => {
    setItems((current) => current.filter((item) => item.cartId !== cartId));
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

  const removeUnavailable = useCallback((availableIds) => {
    setItems((current) => current.filter((item) => item.type !== "painting" || availableIds.includes(item.id)));
  }, []);

  return <CartContext.Provider value={{ items, addToCart, updateQuantity, updateMuralSize, removeFromCart, clearCart, removeUnavailable }}>{children}</CartContext.Provider>;
}

// The context hook is intentionally exported beside its provider.
// eslint-disable-next-line react-refresh/only-export-components
export function useCart() {
  return useContext(CartContext);
}
