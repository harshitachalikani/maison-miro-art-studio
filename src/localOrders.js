const ORDER_EVENT = "maison-miro:local-orders-changed";

function ordersKey(ownerId) {
  return `maison-miro:orders:${encodeURIComponent(String(ownerId))}`;
}

function readStoredOrders(ownerId) {
  if (!ownerId) return [];
  const stored = window.localStorage.getItem(ordersKey(ownerId));
  if (!stored) return [];
  const orders = JSON.parse(stored);
  if (!Array.isArray(orders)) throw new Error("Saved local order history is unreadable. It was left unchanged.");
  return orders;
}

export function getLocalOrders(ownerId) {
  try {
    return readStoredOrders(ownerId);
  } catch {
    return [];
  }
}

function saveLocalOrders(ownerId, orders) {
  window.localStorage.setItem(ordersKey(ownerId), JSON.stringify(orders));
  window.dispatchEvent(new Event(ORDER_EVENT));
}

export function getLocallySoldPaintingIds(ownerId) {
  const orders = [];
  const prefix = "maison-miro:orders:";
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const stored = window.localStorage.getItem(key);
      const accountOrders = stored ? JSON.parse(stored) : [];
      if (Array.isArray(accountOrders)) orders.push(...accountOrders);
    }
  } catch {
    orders.push(...getLocalOrders(ownerId));
  }
  return orders
    .filter((order) => order.status !== "cancelled")
    .flatMap((order) => (order.items || [])
      .filter((item) => item.type === "painting")
      .map((item) => String(item.painting_id || item.id)));
}

export function createLocalOrder(ownerId, cartItems, address) {
  if (!ownerId) throw new Error("Sign in before placing an order.");
  const now = new Date().toISOString();
  const id = `LOCAL-${window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;
  const items = cartItems.map((item) => {
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unit_price);
    const mural = item.type === "mural";
    const lineTotal = unitPrice * (mural ? Number(item.details?.wall_size_sqft) : quantity);
    return {
      type: item.type || "painting",
      painting_id: item.type === "painting" || !item.type ? String(item.id) : null,
      name: item.name || item.title,
      quantity,
      unit_price: unitPrice,
      line_total: lineTotal,
      item_status: item.type === "pottery" || mural ? "pending_confirmation" : "placed",
      details: { ...(item.details || {}) },
    };
  });
  const order = {
    id,
    local_only: true,
    created_at: now,
    status: "placed",
    payment_method: "cod",
    total_amount: items.reduce((total, item) => total + item.line_total, 0),
    delivery_address: { ...address },
    items,
  };
  saveLocalOrders(ownerId, [order, ...readStoredOrders(ownerId)]);
  return order;
}

export function cancelLocalOrder(ownerId, orderId) {
  const orders = readStoredOrders(ownerId);
  const order = orders.find((entry) => entry.id === orderId);
  if (!order || order.status !== "placed") throw new Error("This order can no longer be cancelled.");
  const updated = orders.map((entry) => entry.id === orderId
    ? { ...entry, status: "cancelled", cancelled_at: new Date().toISOString(), items: entry.items.map((item) => ({ ...item, item_status: "cancelled" })) }
    : entry);
  saveLocalOrders(ownerId, updated);
  return updated.find((entry) => entry.id === orderId);
}

export function localOrdersChangedEvent() {
  return ORDER_EVENT;
}
