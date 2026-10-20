
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");
const { potteryPrice, potteryEstimate, validWallSize } = require("./pricing");
const { validateDeliveryAddress, normalizeDeliveryAddress, calculateLineTotal, calculateMuralTotal, sumCheckoutLines } = require("./checkout");

const app = express();
const PORT = 3000;
app.use(cors());
app.use(express.json());

// ─── Middleware ────────────────────────────────────────────────────────────────

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Authentication required"
    });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token"
    });
  }
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to perform this action"
      });
    }

    next();
  };
}

// ─── Database pool ─────────────────────────────────────────────────────────────

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function configuredWallRate() {
  const result = await pool.query(
    "SELECT setting_value FROM public.studio_settings WHERE setting_key = 'wall_rate_per_sqft'"
  );
  return result.rows.length ? Number(result.rows[0].setting_value) : null;
}


// ─── Date helpers ──────────────────────────────────────────────────────────────

/**
 * Returns today's date string (YYYY-MM-DD) in IST (UTC+5:30).
 * All date comparisons use this to be consistent with the studio's timezone.
 */
function todayIST() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Returns a new YYYY-MM-DD string offset by `days` from a given YYYY-MM-DD string. */
function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isValidISODate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

/** Returns the number of whole days from `from` to `to` (both YYYY-MM-DD strings). */
function daysBetween(from, to) {
  const a = new Date(from + "T00:00:00Z");
  const b = new Date(to + "T00:00:00Z");
  return Math.round((b - a) / 86400000);
}

// ─── Health & debug ────────────────────────────────────────────────────────────

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Art Studio backend is running"
  });
});

app.get("/api/db-test", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT COUNT(*)::int AS total FROM public.paintings"
    );

    res.json({
      success: true,
      message: "Database connected successfully",
      paintingCount: result.rows[0].total
    });
  } catch (error) {
    console.error("Database connection failed:", error);

    res.status(500).json({
      success: false,
      message: "Could not connect to the database"
    });
  }
});

// ─── Paintings: public ─────────────────────────────────────────────────────────

/** GET /api/paintings — list all paintings (used by homepage / collection page) */
app.get("/api/paintings", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM public.paintings ORDER BY id"
    );

    res.json({
      success: true,
      paintings: result.rows
    });
  } catch (error) {
    console.error("Could not fetch paintings:", error.message);

    res.status(500).json({
      success: false,
      message: "Could not fetch paintings"
    });
  }
});

/** GET /api/paintings/:id — single painting detail page */
app.get("/api/paintings/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM public.paintings WHERE id = $1",
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Painting not found"
      });
    }

    res.json({ success: true, painting: result.rows[0] });
  } catch (error) {
    console.error("Could not fetch painting:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not fetch painting"
    });
  }
});

// ─── Auth ──────────────────────────────────────────────────────────────────────

/**
 * POST /api/auth/register
 * Public registration — always creates a 'customer' account.
 * The role field in the request body is intentionally ignored.
 */
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      password.length < 8
    ) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid email and a password of at least 8 characters"
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO public.users (email, password_hash, role)
       VALUES ($1, $2, 'customer')
       RETURNING id, email, role, created_at`,
      [normalizedEmail, passwordHash]
    );

    res.status(201).json({
      success: true,
      user: result.rows[0]
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists"
      });
    }

    console.error("Registration failed:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not register account"
    });
  }
});

/** POST /api/auth/login */
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (
      typeof email !== "string" ||
      typeof password !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    const result = await pool.query(
      `SELECT id, email, password_hash, role
       FROM public.users
       WHERE email = $1`,
      [email.trim().toLowerCase()]
    );

    if (
      result.rows.length === 0 ||
      !(await bcrypt.compare(password, result.rows[0].password_hash))
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const user = result.rows[0];

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error("Login failed:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not log in"
    });
  }
});

/** GET /api/auth/me — verify token and return current user */
app.get("/api/auth/me", authenticateToken, (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
});

// ─── Purchase & orders ─────────────────────────────────────────────────────────

async function loadOrderDetails(db, orderId) {
  let result;
  try {
    result = await db.query(
      `SELECT id, user_id, painting_id, status, created_at, cancelled_at,
              delivery_address, payment_method, total_amount
       FROM public.orders WHERE id = $1`,
      [orderId]
    );
  } catch (error) {
    if (!['42703', '42P01'].includes(error.code)) throw error;
    return loadLegacyOrderDetails(db, orderId);
  }
  if (!result.rows.length) return null;
  const order = result.rows[0];
  let lines;
  try {
    lines = await db.query(
      `SELECT oi.id, oi.item_type AS type, oi.painting_id, oi.item_name AS name,
              oi.quantity, oi.unit_price, oi.line_total, oi.status AS item_status,
              oi.details, p.artist, p.image_url
       FROM public.order_items oi
       LEFT JOIN public.paintings p ON p.id = oi.painting_id
       WHERE oi.order_id = $1 ORDER BY oi.id`,
      [orderId]
    );
  } catch (error) {
    if (!['42703', '42P01'].includes(error.code)) throw error;
    return loadLegacyOrderDetails(db, orderId);
  }
  if (lines.rows.length) return { ...order, items: lines.rows };
  if (order.painting_id) {
    const legacy = await db.query("SELECT id, title, artist, price, image_url FROM public.paintings WHERE id = $1", [order.painting_id]);
    if (legacy.rows.length) {
      const painting = legacy.rows[0];
      return { ...order, total_amount: order.total_amount ?? painting.price, items: [{ type: "painting", painting_id: painting.id, name: painting.title, artist: painting.artist, quantity: 1, unit_price: painting.price, line_total: painting.price, item_status: order.status, details: {}, image_url: painting.image_url }] };
    }
  }
  return { ...order, items: [] };
}

async function loadLegacyOrderDetails(db, orderId) {
  const result = await db.query(
    `SELECT id, user_id, painting_id, status, created_at, cancelled_at
     FROM public.orders WHERE id = $1`,
    [orderId]
  );
  if (!result.rows.length) return null;
  const order = result.rows[0];
  if (!order.painting_id) return { ...order, items: [] };
  const legacy = await db.query(
    "SELECT id, title, artist, price, image_url FROM public.paintings WHERE id = $1",
    [order.painting_id]
  );
  if (!legacy.rows.length) return { ...order, items: [] };
  const painting = legacy.rows[0];
  return {
    ...order,
    total_amount: painting.price,
    payment_method: null,
    delivery_address: null,
    items: [{
      type: "painting",
      painting_id: painting.id,
      name: painting.title,
      artist: painting.artist,
      quantity: 1,
      unit_price: painting.price,
      line_total: painting.price,
      item_status: order.status,
      details: {},
      image_url: painting.image_url,
    }],
  };
}

/** POST /api/orders/checkout — atomically price and place one mixed COD order. */
app.post("/api/orders/checkout", authenticateToken, requireRole("customer"), async (req, res) => {
  const { checkout_key, payment_method, delivery_address, items } = req.body || {};
  const addressError = validateDeliveryAddress(delivery_address);
  if (addressError) return res.status(400).json({ success: false, message: addressError });
  const savedAddress = normalizeDeliveryAddress(delivery_address);
  if (payment_method !== "cod") return res.status(400).json({ success: false, message: "Only Cash on Delivery is available" });
  if (typeof checkout_key !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(checkout_key)) {
    return res.status(400).json({ success: false, message: "A valid checkout key is required" });
  }
  if (!Array.isArray(items) || items.length < 1 || items.length > 30) {
    return res.status(400).json({ success: false, message: "The cart must contain between 1 and 30 items" });
  }

  const client = await pool.connect();
  try {
    const existing = await client.query(
      "SELECT id FROM public.orders WHERE checkout_key = $1 AND user_id = $2",
      [checkout_key, req.user.id]
    );
    if (existing.rows.length) {
      await client.query("BEGIN");
      const order = await loadOrderDetails(client, existing.rows[0].id);
      await client.query("COMMIT");
      return res.status(200).json({ success: true, order, duplicate: true });
    }

    await client.query("BEGIN");
    const lineItems = [];
    const paintingIds = new Set();

    for (const entry of items) {
      if (!entry || !["painting", "pottery", "mural"].includes(entry.type)) throw Object.assign(new Error("Cart contains an unsupported item type"), { status: 400 });
      const qty = Number(entry.quantity);
      if (!Number.isInteger(qty) || qty < 1 || qty > 12) throw Object.assign(new Error("Item quantity must be a whole number between 1 and 12"), { status: 400 });
      const details = entry.details && typeof entry.details === "object" && !Array.isArray(entry.details) ? entry.details : {};

      if (entry.type === "painting") {
        if (qty !== 1 || typeof entry.id !== "string" || paintingIds.has(entry.id)) throw Object.assign(new Error("Each original painting may appear only once in the cart"), { status: 400 });
        paintingIds.add(entry.id);
        const result = await client.query("SELECT id, title, price, status FROM public.paintings WHERE id = $1 FOR UPDATE", [entry.id]);
        if (!result.rows.length) throw Object.assign(new Error("A painting in the cart could not be found"), { status: 404 });
        const painting = result.rows[0];
        if (painting.status !== "available") throw Object.assign(new Error(`“${painting.title}” is no longer available`), { status: 409 });
        const price = Number(painting.price);
        lineItems.push({ type: "painting", painting_id: painting.id, name: painting.title, quantity: 1, unit_price: price, line_total: calculateLineTotal(price, 1), status: "placed", details: {} });
      } else if (entry.type === "pottery") {
        if (typeof entry.id !== "string" || typeof details.glaze_id !== "string") throw Object.assign(new Error("Choose a pottery item and glaze"), { status: 400 });
        if (!isValidISODate(details.needed_by) || details.needed_by < addDays(todayIST(), 14)) throw Object.assign(new Error(`Pottery needed-by date must be at least 14 days from today (${addDays(todayIST(), 14)} or later)`), { status: 400 });
        const [pottery, glaze] = await Promise.all([
          client.query("SELECT id, name FROM public.pottery_items WHERE id = $1", [entry.id]),
          client.query("SELECT id, name FROM public.glazes WHERE id = $1", [details.glaze_id])
        ]);
        if (!pottery.rows.length || !glaze.rows.length) throw Object.assign(new Error("Choose a valid pottery item and glaze"), { status: 400 });
        const estimate = potteryEstimate(pottery.rows[0].name, qty);
        if (!estimate) throw Object.assign(new Error("This pottery item has no configured checkout price"), { status: 400 });
        lineItems.push({ type: "pottery", name: pottery.rows[0].name, quantity: qty, unit_price: estimate.price_per_item, line_total: estimate.estimated_total, status: "pending_confirmation", details: { glaze_id: glaze.rows[0].id, glaze_name: glaze.rows[0].name, needed_by: details.needed_by } });
      } else {
        const size = validWallSize(details.wall_size_sqft);
        if (!size) throw Object.assign(new Error("Mural wall size must be a whole number between 10 and 500 sq ft"), { status: 400 });
        if (qty !== 1) throw Object.assign(new Error("Mural quantity must be one per project"), { status: 400 });
        if (!isValidISODate(details.booking_date) || details.booking_date < addDays(todayIST(), 7) || details.booking_date > addDays(todayIST(), 90)) throw Object.assign(new Error("Mural preferred date must be 7 to 90 days from today"), { status: 400 });
        const rate = await configuredWallRate();
        if (rate === null || !Number.isFinite(rate) || rate < 0) throw Object.assign(new Error("Studio mural rate is not configured"), { status: 500 });
        const lineTotal = calculateMuralTotal(rate, size);
        const serviceAddress = typeof details.service_address === "string" && details.service_address.trim()
          ? details.service_address.trim()
          : [savedAddress.house, savedAddress.street, savedAddress.locality, savedAddress.city, savedAddress.state, savedAddress.pin_code].join(", ");
        lineItems.push({ type: "mural", name: "Wall mural service", quantity: 1, unit_price: rate, line_total: lineTotal, status: "pending_confirmation", details: { wall_size_sqft: size, rate_per_sqft: rate, booking_date: details.booking_date, service_address, estimate: true } });
      }
    }

    const total = sumCheckoutLines(lineItems);

    const orderResult = await client.query(
      `INSERT INTO public.orders (user_id, painting_id, status, delivery_address, payment_method, total_amount, checkout_key)
       VALUES ($1, NULL, 'placed', $2::jsonb, 'cod', $3, $4)
       RETURNING id, user_id, status, created_at, delivery_address, payment_method, total_amount`,
      [req.user.id, JSON.stringify(savedAddress), total, checkout_key]
    );
    const order = orderResult.rows[0];

    for (const line of lineItems) {
      await client.query(
        `INSERT INTO public.order_items
           (order_id, item_type, painting_id, item_name, quantity, unit_price, line_total, status, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
        [order.id, line.type, line.painting_id || null, line.name, line.quantity, line.unit_price, line.line_total, line.status, JSON.stringify(line.details)]
      );
    }
    for (const paintingId of paintingIds) await client.query("UPDATE public.paintings SET status = 'sold' WHERE id = $1", [paintingId]);

    await client.query("COMMIT");
    const responseOrder = { ...order, items: lineItems };
    return res.status(201).json({ success: true, order: responseOrder });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") {
      const existing = await pool.query("SELECT id FROM public.orders WHERE checkout_key = $1 AND user_id = $2", [checkout_key, req.user.id]).catch(() => ({ rows: [] }));
      if (existing.rows.length) {
        const order = await loadOrderDetails(pool, existing.rows[0].id).catch(() => null);
        if (order) return res.status(200).json({ success: true, order, duplicate: true });
      }
      return res.status(409).json({ success: false, message: "A painting in this order was just purchased by another customer. Refresh your cart and try again." });
    }
    if (error.status) return res.status(error.status).json({ success: false, message: error.message });
    console.error("Checkout failed:", error.message);
    return res.status(500).json({ success: false, message: "Could not place your order" });
  } finally {
    client.release();
  }
});

/**
 * POST /api/paintings/:id/purchase
 * Atomically marks a painting as sold and creates an order.
 * Uses FOR UPDATE row lock + partial unique index to prevent concurrent purchases.
 */
app.post("/api/paintings/:id/purchase", authenticateToken, requireRole("customer"), async (req, res) => {
  const addressError = validateDeliveryAddress(req.body?.delivery_address);
  if (addressError) return res.status(400).json({ success: false, message: addressError });
  const deliveryAddress = normalizeDeliveryAddress(req.body.delivery_address);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const paintingResult = await client.query(
      "SELECT id, price, status FROM public.paintings WHERE id = $1 FOR UPDATE",
      [req.params.id]
    );

    if (paintingResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Painting not found"
      });
    }

    if (paintingResult.rows[0].status !== "available") {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        message: "This painting is no longer available"
      });
    }

    const orderResult = await client.query(
      `INSERT INTO public.orders (user_id, painting_id, status, delivery_address, payment_method, total_amount)
       VALUES ($1, $2, 'placed', $3::jsonb, 'cod', $4)
       RETURNING id, user_id, painting_id, status, created_at, delivery_address, payment_method, total_amount`,
      [req.user.id, req.params.id, JSON.stringify(deliveryAddress), paintingResult.rows[0].price]
    );

    await client.query(
      "UPDATE public.paintings SET status = 'sold' WHERE id = $1",
      [req.params.id]
    );

    await client.query("COMMIT");

    res.status(201).json({
      success: true,
      message: "Painting purchased successfully",
      order: orderResult.rows[0]
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Purchase failed:", error);
    res.setHeader("X-Debug-Error", error.message);
    res.status(500).json({
      success: false,
      message: "Could not complete purchase"
    });
  } finally {
    client.release();
  }
});

/**
 * POST /api/orders/:id/cancel
 * Customer cancels their own placed order and painting returns to available.
 */
app.post("/api/orders/:id/cancel", authenticateToken, requireRole("customer"), async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const orderResult = await client.query(
      `SELECT id, user_id, painting_id, status
       FROM public.orders
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [req.params.id, req.user.id]
    );

    if (orderResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Order not found"
      });
    }

    const order = orderResult.rows[0];

    if (order.status !== "placed") {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        message: "This order cannot be cancelled"
      });
    }

    await client.query(
      "UPDATE public.orders SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1",
      [order.id]
    );

    const checkoutPaintings = order.painting_id
      ? [order.painting_id]
      : (await client.query("SELECT painting_id FROM public.order_items WHERE order_id = $1 AND item_type = 'painting'", [order.id])).rows.map((row) => row.painting_id);
    for (const paintingId of checkoutPaintings) {
      await client.query("UPDATE public.paintings SET status = 'available' WHERE id = $1", [paintingId]);
    }
    if (!order.painting_id) {
      await client.query("UPDATE public.order_items SET status = 'cancelled' WHERE order_id = $1", [order.id]);
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Order cancelled and painting is available again"
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    // PostgreSQL error 22P02 = invalid input syntax for UUID
    if (error.code === "22P02") {
      return res.status(404).json({ success: false, message: "Order not found" });
    }
    console.error("Cancellation failed:", error);
    res.status(500).json({
      success: false,
      message: "Could not cancel order"
    });
  } finally {
    client.release();
  }
});

/**
 * GET /api/orders/my
 * Customer retrieves their own order history, including painting details.
 * Customers cannot access other customers' orders (user_id = req.user.id).
 */
app.get("/api/orders/my", authenticateToken, requireRole("customer"), async (req, res) => {
  try {
    const result = await pool.query("SELECT id FROM public.orders WHERE user_id = $1 ORDER BY created_at DESC", [req.user.id]);
    const orders = await Promise.all(result.rows.map((row) => loadOrderDetails(pool, row.id)));
    res.json({ success: true, orders });
  } catch (error) {
    console.error("Could not fetch orders:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not fetch your orders"
    });
  }
});

// ─── Pottery items & glazes: public ───────────────────────────────────────────

/** GET /api/pottery-items — list all available pottery items (used for request form dropdowns) */
app.get("/api/pottery-items", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM public.pottery_items ORDER BY id"
    );
    res.json({
      success: true,
      items: result.rows.map((item) => ({
        ...item,
        ...potteryPrice(item.name),
        price_per_item: potteryPrice(item.name)?.price ?? null,
        price_unit: potteryPrice(item.name)?.unit ?? null
      }))
    });
  } catch (error) {
    console.error("Could not fetch pottery items:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not fetch pottery items"
    });
  }
});

/** GET /api/glazes — list all glazes (used for request form dropdowns) */
app.get("/api/glazes", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM public.glazes ORDER BY id"
    );
    res.json({ success: true, glazes: result.rows });
  } catch (error) {
    console.error("Could not fetch glazes:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not fetch glazes"
    });
  }
});

// ─── Wall bookings: customer ───────────────────────────────────────────────────

/** GET /api/wall-bookings/estimate — read the configured server rate without creating a booking. */
app.get("/api/wall-bookings/estimate", async (req, res) => {
  const size = validWallSize(req.query.wall_size_sqft);
  if (!size) {
    return res.status(400).json({
      success: false,
      message: "wall_size_sqft must be a whole number between 10 and 500"
    });
  }

  try {
    const rate = await configuredWallRate();
    if (rate === null || !Number.isFinite(rate) || rate < 0) {
      return res.status(500).json({
        success: false,
        message: "Studio rate is not configured. Please contact the studio."
      });
    }
    res.json({
      success: true,
      estimate: { rate_per_sqft: rate, total_price: size * rate }
    });
  } catch (error) {
    console.error("Could not calculate wall estimate:", error.message);
    res.status(500).json({ success: false, message: "Could not calculate wall estimate" });
  }
});

/**
 * POST /api/wall-bookings
 * Customer submits a mural booking.
 * Rules:
 *   - booking_date must be 7–90 days from today (IST)
 *   - wall_size_sqft must be 10–500 (also enforced by DB CHECK)
 *   - address required
 *   - rate and total_price calculated server-side from studio_settings
 *   - one active booking per date enforced by DB partial unique index
 */
app.post("/api/wall-bookings", authenticateToken, requireRole("customer"), async (req, res) => {
  const { booking_date, wall_size_sqft, address } = req.body;
  const client = await pool.connect();

  try {
    // --- Input validation ---
    if (
      typeof booking_date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(booking_date)
    ) {
      return res.status(400).json({
        success: false,
        message: "booking_date must be a date in YYYY-MM-DD format"
      });
    }

    const size = validWallSize(wall_size_sqft);
    if (!size) {
      return res.status(400).json({
        success: false,
        message: "wall_size_sqft must be a whole number between 10 and 500"
      });
    }

    if (typeof address !== "string" || !address.trim()) {
      return res.status(400).json({
        success: false,
        message: "A valid address is required"
      });
    }

    // --- Date range validation (7–90 days from today, IST) ---
    const today   = todayIST();
    const minDate = addDays(today, 7);
    const maxDate = addDays(today, 90);

    if (booking_date < minDate || booking_date > maxDate) {
      return res.status(400).json({
        success: false,
        message: `Booking date must be between ${minDate} and ${maxDate} (7 to 90 days from today)`
      });
    }

    await client.query("BEGIN");

    // --- Fetch rate from studio_settings (never trust client-supplied price) ---
    const rate = await configuredWallRate();
    if (rate === null || !Number.isFinite(rate) || rate < 0) {
      await client.query("ROLLBACK");
      return res.status(500).json({
        success: false,
        message: "Studio rate is not configured. Please contact the studio."
      });
    }

    const total_price = size * rate;

    const result = await client.query(
      `INSERT INTO public.wall_bookings
         (user_id, booking_date, wall_size_sqft, address, rate_per_sqft, total_price, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'requested')
       RETURNING *`,
      [req.user.id, booking_date, size, address.trim(), rate, total_price]
    );

    await client.query("COMMIT");

    res.status(201).json({ success: true, booking: result.rows[0] });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});

    // Unique index violation → date already booked
    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "That date is already booked. Please choose a different date."
      });
    }

    console.error("Wall booking failed:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not create wall booking"
    });
  } finally {
    client.release();
  }
});

/** GET /api/wall-bookings/my — customer's own bookings */
app.get("/api/wall-bookings/my", authenticateToken, requireRole("customer"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM public.wall_bookings
       WHERE user_id = $1
       ORDER BY booking_date DESC`,
      [req.user.id]
    );

    res.json({ success: true, bookings: result.rows });
  } catch (error) {
    console.error("Could not fetch bookings:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not fetch your bookings"
    });
  }
});

/**
 * PATCH /api/wall-bookings/:id/cancel
 * Customer cancels their own booking.
 * Rules:
 *   - Only 'requested' or 'confirmed' bookings can be cancelled
 *   - Must be at least 3 days before the booking date
 */
app.patch("/api/wall-bookings/:id/cancel", authenticateToken, requireRole("customer"), async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `SELECT * FROM public.wall_bookings
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Booking not found"
      });
    }

    const booking = result.rows[0];

    if (!["requested", "confirmed"].includes(booking.status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        message: "This booking cannot be cancelled"
      });
    }

    // Cancellation window: must be ≥ 3 days before booking date
    const today      = todayIST();
    const bookingDay = String(booking.booking_date).slice(0, 10);
    const daysUntil  = daysBetween(today, bookingDay);

    if (daysUntil < 3) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        message: "Cancellations must be made at least 3 days before the booking date"
      });
    }

    await client.query(
      "UPDATE public.wall_bookings SET status = 'cancelled' WHERE id = $1",
      [booking.id]
    );

    await client.query("COMMIT");

    res.json({ success: true, message: "Booking cancelled successfully" });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Booking cancellation failed:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not cancel booking"
    });
  } finally {
    client.release();
  }
});

// ─── Pottery requests: customer ────────────────────────────────────────────────

/**
 * POST /api/pottery-requests
 * Customer submits a pottery request.
 * Rules:
 *   - item_id and glaze_id must exist in DB (FK validated server-side too)
 *   - quantity: 1–12 (also enforced by DB CHECK)
 *   - needed_by: at least 14 days from today (IST)
 */
app.post("/api/pottery-requests", authenticateToken, requireRole("customer"), async (req, res) => {
  const { item_id, glaze_id, quantity, needed_by } = req.body;

  try {
    // --- Validate needed_by ---
    if (
      typeof needed_by !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(needed_by)
    ) {
      return res.status(400).json({
        success: false,
        message: "needed_by must be a date in YYYY-MM-DD format"
      });
    }

    const today   = todayIST();
    const minDate = addDays(today, 14);

    if (needed_by < minDate) {
      return res.status(400).json({
        success: false,
        message: `needed_by date must be at least 14 days from today (${minDate} or later)`
      });
    }

    // --- Validate quantity ---
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 12) {
      return res.status(400).json({
        success: false,
        message: "Quantity must be a whole number between 1 and 12"
      });
    }

    // --- Validate item and glaze IDs ---
    if (typeof item_id !== "string" || !item_id.trim()) {
      return res.status(400).json({
        success: false,
        message: "A pottery item must be selected"
      });
    }

    if (typeof glaze_id !== "string" || !glaze_id.trim()) {
      return res.status(400).json({
        success: false,
        message: "A glaze must be selected"
      });
    }

    // --- Verify item and glaze exist in DB ---
    const [itemResult, glazeResult] = await Promise.all([
      pool.query("SELECT id, name FROM public.pottery_items WHERE id = $1", [item_id.trim()]),
      pool.query("SELECT id FROM public.glazes WHERE id = $1", [glaze_id.trim()])
    ]);

    if (itemResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "The selected pottery item does not exist"
      });
    }

    if (glazeResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "The selected glaze does not exist"
      });
    }

    const itemPrice = potteryPrice(itemResult.rows[0].name);
    if (!itemPrice) {
      return res.status(400).json({
        success: false,
        message: "The selected pottery item does not have a configured price"
      });
    }
    const potteryEstimateResult = potteryEstimate(itemResult.rows[0].name, qty);
    const estimated_total = potteryEstimateResult.estimated_total;

    const result = await pool.query(
      `INSERT INTO public.pottery_requests
         (user_id, item_id, glaze_id, quantity, needed_by, status)
       VALUES ($1, $2, $3, $4, $5, 'requested')
       RETURNING *`,
      [req.user.id, item_id.trim(), glaze_id.trim(), qty, needed_by]
    );

    res.status(201).json({
      success: true,
      request: result.rows[0],
      estimated_total,
      price_per_item: itemPrice.price,
      price_unit: itemPrice.unit
    });
  } catch (error) {
    console.error("Pottery request failed:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not submit pottery request"
    });
  }
});

/** GET /api/pottery-requests/my — customer's own pottery requests with item/glaze names */
app.get("/api/pottery-requests/my", authenticateToken, requireRole("customer"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT pr.*, pi.name AS item_name, g.name AS glaze_name
       FROM public.pottery_requests pr
       JOIN public.pottery_items pi ON pi.id = pr.item_id
       JOIN public.glazes g        ON g.id  = pr.glaze_id
       WHERE pr.user_id = $1
       ORDER BY pr.created_at DESC`,
      [req.user.id]
    );

    res.json({ success: true, requests: result.rows });
  } catch (error) {
    console.error("Could not fetch pottery requests:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not fetch your pottery requests"
    });
  }
});

/**
 * PATCH /api/pottery-requests/:id
 * Customer edits or cancels their own pottery request.
 * Rules:
 *   - Only 'requested' status can be edited or cancelled
 *   - If body contains { status: 'cancelled' }, it cancels the request
 *   - Otherwise, updates item_id, glaze_id, quantity, needed_by
 *   - All validation rules apply on edit too
 */
app.patch("/api/pottery-requests/:id", authenticateToken, requireRole("customer"), async (req, res) => {
  const { item_id, glaze_id, quantity, needed_by, status } = req.body;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Load and lock the request, ensuring it belongs to this customer
    const result = await client.query(
      `SELECT * FROM public.pottery_requests
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [req.params.id, req.user.id]
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Pottery request not found"
      });
    }

    const pr = result.rows[0];

    if (pr.status !== "requested") {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        message: "Only requests with status 'requested' can be edited or cancelled"
      });
    }

    // --- Cancellation path ---
    if (status === "cancelled") {
      await client.query(
        "UPDATE public.pottery_requests SET status = 'cancelled' WHERE id = $1",
        [pr.id]
      );
      await client.query("COMMIT");
      return res.json({ success: true, message: "Pottery request cancelled" });
    }

    // --- Edit path: merge provided values with existing ---
    const newItemId   = (typeof item_id  === "string" && item_id.trim())  ? item_id.trim()  : pr.item_id;
    const newGlazeId  = (typeof glaze_id === "string" && glaze_id.trim()) ? glaze_id.trim() : pr.glaze_id;
    const newQty      = quantity  !== undefined ? Number(quantity) : pr.quantity;
    // pg returns date columns as JavaScript Date objects; normalise to YYYY-MM-DD string
    const normExisting = pr.needed_by instanceof Date
      ? pr.needed_by.toISOString().slice(0, 10)
      : String(pr.needed_by).slice(0, 10);
    const newNeededBy = needed_by !== undefined ? String(needed_by).slice(0, 10) : normExisting;

    if (!Number.isInteger(newQty) || newQty < 1 || newQty > 12) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Quantity must be a whole number between 1 and 12"
      });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(newNeededBy)) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "needed_by must be YYYY-MM-DD"
      });
    }

    const today   = todayIST();
    const minDate = addDays(today, 14);
    if (newNeededBy < minDate) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: `needed_by must be at least 14 days from today (${minDate} or later)`
      });
    }

    // Verify updated item and glaze exist
    const [itemResult, glazeResult] = await Promise.all([
      client.query("SELECT id, name FROM public.pottery_items WHERE id = $1", [newItemId]),
      client.query("SELECT id FROM public.glazes WHERE id = $1",        [newGlazeId])
    ]);

    if (itemResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "The selected pottery item does not exist"
      });
    }

    if (glazeResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "The selected glaze does not exist"
      });
    }

    const itemPrice = potteryPrice(itemResult.rows[0].name);
    if (!itemPrice) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "The selected pottery item does not have a configured price"
      });
    }
    const potteryEstimateResult = potteryEstimate(itemResult.rows[0].name, newQty);
    const estimated_total = potteryEstimateResult.estimated_total;

    const updated = await client.query(
      `UPDATE public.pottery_requests
       SET item_id = $1, glaze_id = $2, quantity = $3, needed_by = $4
       WHERE id = $5
       RETURNING *`,
      [newItemId, newGlazeId, newQty, newNeededBy, pr.id]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      request: updated.rows[0],
      estimated_total,
      price_per_item: itemPrice.price,
      price_unit: itemPrice.unit
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Pottery request update failed:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not update pottery request"
    });
  } finally {
    client.release();
  }
});

// ─── Admin: orders ─────────────────────────────────────────────────────────────

/**
 * GET /api/admin/orders
 * Studio role only — all orders with customer email and painting details.
 */
app.get("/api/admin/orders", authenticateToken, requireRole("studio"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.id, u.id AS customer_id, u.email AS customer_email
       FROM public.orders o
       JOIN public.users u ON u.id = o.user_id
       ORDER BY o.created_at DESC`
    );
    const orders = await Promise.all(result.rows.map(async (row) => ({ ...await loadOrderDetails(pool, row.id), customer_id: row.customer_id, customer_email: row.customer_email })));
    res.json({ success: true, orders });
  } catch (error) {
    console.error("Could not fetch admin orders:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not fetch orders"
    });
  }
});

// ─── Admin: wall bookings ──────────────────────────────────────────────────────

/**
 * GET /api/admin/wall-bookings
 * Studio role only — all wall bookings with customer email.
 */
app.get("/api/admin/wall-bookings", authenticateToken, requireRole("studio"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT wb.*, u.email AS customer_email
       FROM public.wall_bookings wb
       JOIN public.users u ON u.id = wb.user_id
       ORDER BY wb.booking_date DESC`
    );

    res.json({ success: true, bookings: result.rows });
  } catch (error) {
    console.error("Could not fetch admin bookings:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not fetch bookings"
    });
  }
});

/**
 * PATCH /api/admin/wall-bookings/:id
 * Studio role only — confirm or decline a booking that is still 'requested'.
 * Body: { "status": "confirmed" | "declined" }
 */
app.patch("/api/admin/wall-bookings/:id", authenticateToken, requireRole("studio"), async (req, res) => {
  const { status } = req.body;

  if (!["confirmed", "declined"].includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Status must be 'confirmed' or 'declined'"
    });
  }

  try {
    const result = await pool.query(
      `UPDATE public.wall_bookings
       SET status = $1
       WHERE id = $2 AND status = 'requested'
       RETURNING *`,
      [status, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Booking not found or it is not in 'requested' status"
      });
    }

    res.json({ success: true, booking: result.rows[0] });
  } catch (error) {
    console.error("Admin booking update failed:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not update booking status"
    });
  }
});

// ─── Admin: pottery requests ───────────────────────────────────────────────────

/**
 * GET /api/admin/pottery-requests
 * Studio role only — all pottery requests with customer email and item/glaze names.
 */
app.get("/api/admin/pottery-requests", authenticateToken, requireRole("studio"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT pr.*, pi.name AS item_name, g.name AS glaze_name, u.email AS customer_email
       FROM public.pottery_requests pr
       JOIN public.pottery_items pi ON pi.id = pr.item_id
       JOIN public.glazes g        ON g.id  = pr.glaze_id
       JOIN public.users u         ON u.id  = pr.user_id
       ORDER BY pr.created_at DESC`
    );

    res.json({ success: true, requests: result.rows });
  } catch (error) {
    console.error("Could not fetch admin pottery requests:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not fetch pottery requests"
    });
  }
});

/**
 * PATCH /api/admin/pottery-requests/:id
 * Studio role only — accept or decline a pottery request still in 'requested' status.
 * Body: { "status": "accepted" | "declined" }
 */
app.patch("/api/admin/pottery-requests/:id", authenticateToken, requireRole("studio"), async (req, res) => {
  const { status } = req.body;

  if (!["accepted", "declined"].includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Status must be 'accepted' or 'declined'"
    });
  }

  try {
    const result = await pool.query(
      `UPDATE public.pottery_requests
       SET status = $1
       WHERE id = $2 AND status = 'requested'
       RETURNING *`,
      [status, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Pottery request not found or it is not in 'requested' status"
      });
    }

    res.json({ success: true, request: result.rows[0] });
  } catch (error) {
    console.error("Admin pottery request update failed:", error.message);
    res.status(500).json({
      success: false,
      message: "Could not update pottery request status"
    });
  }
});

// ─── Start server ──────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});
