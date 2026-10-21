/**
 * api.js — Centralised API communication layer for MAISON MIRO.
 * Every backend call goes through here. Components never construct URLs directly.
 */

const BASE = "http://localhost:3000";

// Keep network failures understandable in the storefront instead of exposing
// the browser's generic "Failed to fetch" message.
async function fetchApi(url, options) {
  try {
    return await fetch(url, options);
  } catch {
    throw new Error("The MAISON MIRO server could not be reached. Check that the backend is running, then try again.");
  }
}

/** Returns the JWT stored in sessionStorage (if any). */
export function getToken() {
  return sessionStorage.getItem("mm_token") || "";
}

/** Stores the JWT after login. */
export function setToken(token) {
  sessionStorage.setItem("mm_token", token);
}

/** Clears the JWT on logout. */
export function clearToken() {
  sessionStorage.removeItem("mm_token");
}

/** Throws a structured error: { status, message }. */
async function handleResponse(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function jsonHeaders() {
  return { "Content-Type": "application/json", ...authHeaders() };
}

// ── Public ──────────────────────────────────────────────────────────────────

export async function fetchPaintings() {
  const res = await fetchApi(`${BASE}/api/paintings`);
  return handleResponse(res); // { success, paintings }
}

export async function fetchPainting(id) {
  const res = await fetchApi(`${BASE}/api/paintings/${encodeURIComponent(id)}`);
  return handleResponse(res); // { success, painting }
}

export async function fetchPotteryItems() {
  const res = await fetch(`${BASE}/api/pottery-items`);
  return handleResponse(res); // { success, items }
}

export async function fetchGlazes() {
  const res = await fetch(`${BASE}/api/glazes`);
  return handleResponse(res); // { success, glazes }
}

// ── Auth ────────────────────────────────────────────────────────────────────

export async function apiRegister(email, password) {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return handleResponse(res); // { success, user }
}

export async function apiLogin(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return handleResponse(res); // { success, token, user }
}

export async function fetchMe() {
  const res = await fetch(`${BASE}/api/auth/me`, {
    headers: authHeaders(),
  });
  return handleResponse(res); // { success, user }
}

// ── Customer: orders ────────────────────────────────────────────────────────

export async function purchasePainting(paintingId, deliveryAddress) {
  const res = await fetch(`${BASE}/api/paintings/${paintingId}/purchase`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ delivery_address: deliveryAddress }),
  });
  return handleResponse(res); // { success, message, order }
}

export async function fetchMyOrders() {
  const res = await fetch(`${BASE}/api/orders/my`, {
    headers: authHeaders(),
  });
  return handleResponse(res); // { success, orders }
}

export async function createCheckoutOrder(payload) {
  const res = await fetch(`${BASE}/api/orders/checkout`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
  return handleResponse(res); // { success, order }
}

export async function cancelOrder(orderId) {
  const res = await fetch(`${BASE}/api/orders/${orderId}/cancel`, {
    method: "POST",
    headers: authHeaders(),
  });
  return handleResponse(res); // { success, message }
}

// ── Customer: artwork requests ─────────────────────────────────────────────

export async function createPaintingRequest(paintingId) {
  const res = await fetch(`${BASE}/api/painting-requests`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ painting_id: paintingId }),
  });
  return handleResponse(res);
}

export async function fetchMyPaintingRequests() {
  const res = await fetch(`${BASE}/api/painting-requests/my`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function cancelPaintingRequest(requestId) {
  const res = await fetch(`${BASE}/api/painting-requests/${requestId}/cancel`, {
    method: "PATCH",
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function validatePaintingRequestForCart(requestId) {
  const res = await fetch(`${BASE}/api/painting-requests/${requestId}/cart-eligibility`, {
    method: "POST",
    headers: authHeaders(),
  });
  return handleResponse(res);
}

// ── Customer: wall bookings ─────────────────────────────────────────────────

export async function createWallBooking(payload) {
  // payload: { booking_date, wall_size_sqft, address }
  const res = await fetch(`${BASE}/api/wall-bookings`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
  return handleResponse(res); // { success, booking }
}

export async function fetchWallEstimate(wallSizeSqft) {
  const params = new URLSearchParams({ wall_size_sqft: wallSizeSqft });
  const res = await fetch(`${BASE}/api/wall-bookings/estimate?${params}`);
  return handleResponse(res); // { success, estimate: { rate_per_sqft, total_price } }
}

export async function fetchMyWallBookings() {
  const res = await fetch(`${BASE}/api/wall-bookings/my`, {
    headers: authHeaders(),
  });
  return handleResponse(res); // { success, bookings }
}

export async function cancelWallBooking(bookingId) {
  const res = await fetch(`${BASE}/api/wall-bookings/${bookingId}/cancel`, {
    method: "PATCH",
    headers: authHeaders(),
  });
  return handleResponse(res); // { success, message }
}

export async function validateWallBookingForCart(bookingId) {
  const res = await fetch(`${BASE}/api/wall-bookings/${bookingId}/cart-eligibility`, {
    method: "POST",
    headers: authHeaders(),
  });
  return handleResponse(res);
}

// ── Customer: pottery requests ──────────────────────────────────────────────

export async function createPotteryRequest(payload) {
  // payload: { item_id, glaze_id, quantity, needed_by }
  const res = await fetch(`${BASE}/api/pottery-requests`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
  return handleResponse(res); // { success, request }
}

export async function fetchMyPotteryRequests() {
  const res = await fetch(`${BASE}/api/pottery-requests/my`, {
    headers: authHeaders(),
  });
  return handleResponse(res); // { success, requests }
}

export async function updatePotteryRequest(requestId, payload) {
  // payload: partial { item_id, glaze_id, quantity, needed_by, status }
  const res = await fetch(`${BASE}/api/pottery-requests/${requestId}`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  });
  return handleResponse(res); // { success, message | request }
}

export async function validatePotteryRequestForCart(requestId) {
  const res = await fetch(`${BASE}/api/pottery-requests/${requestId}/cart-eligibility`, {
    method: "POST",
    headers: authHeaders(),
  });
  return handleResponse(res);
}

// ── Studio admin ────────────────────────────────────────────────────────────

export async function createAdminPainting(painting) {
  const res = await fetchApi(`${BASE}/api/admin/paintings`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(painting),
  });
  return handleResponse(res);
}

export async function updateAdminPainting(paintingId, painting) {
  const res = await fetchApi(`${BASE}/api/admin/paintings/${encodeURIComponent(paintingId)}`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify(painting),
  });
  return handleResponse(res);
}

export async function fetchAdminOrders() {
  const res = await fetch(`${BASE}/api/admin/orders`, {
    headers: authHeaders(),
  });
  return handleResponse(res); // { success, orders }
}

export async function fetchAdminPaintingRequests() {
  const res = await fetch(`${BASE}/api/admin/painting-requests`, { headers: authHeaders() });
  return handleResponse(res);
}

export async function updateAdminPaintingRequest(requestId, status) {
  const res = await fetch(`${BASE}/api/admin/painting-requests/${requestId}`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify({ status }),
  });
  return handleResponse(res);
}

export async function fetchAdminWallBookings() {
  const res = await fetch(`${BASE}/api/admin/wall-bookings`, {
    headers: authHeaders(),
  });
  return handleResponse(res); // { success, bookings }
}

export async function updateAdminWallBooking(bookingId, status) {
  const res = await fetch(`${BASE}/api/admin/wall-bookings/${bookingId}`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify({ status }),
  });
  return handleResponse(res); // { success, booking }
}

export async function fetchAdminPotteryRequests() {
  const res = await fetch(`${BASE}/api/admin/pottery-requests`, {
    headers: authHeaders(),
  });
  return handleResponse(res); // { success, requests }
}

export async function updateAdminPotteryRequest(requestId, status) {
  const res = await fetch(`${BASE}/api/admin/pottery-requests/${requestId}`, {
    method: "PATCH",
    headers: jsonHeaders(),
    body: JSON.stringify({ status }),
  });
  return handleResponse(res); // { success, request }
}
