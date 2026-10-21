
require("dotenv").config();
/* global __dirname */

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const { randomUUID } = require("crypto");
const fs = require("fs");
const path = require("path");

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
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
  } catch {
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

function workflowFailureMessage(error, subject) {
  if (["ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT"].includes(error.code)) {
    return `The database is unavailable, so ${subject} could not be saved or loaded. Please try again after the database connection is restored.`;
  }
  if (["42P01", "42703"].includes(error.code)) {
    return `${subject} database setup is incomplete. Apply 001_unified_checkout.sql followed by 002_request_approvals.sql.`;
  }
  return null;
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

// PostgreSQL DATE values are parsed by node-postgres as Date objects. Convert
// them through UTC ISO formatting so timezone and locale strings cannot shift
// the calendar day during comparisons with YYYY-MM-DD inputs.
function dateOnlyISO(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})(?:$|T)/);
    return match ? match[1] : "";
  }
  return "";
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
    const setupMessage = error.code === "ENOTFOUND" || error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT"
      ? "The artwork catalogue is temporarily unavailable because the database connection could not be reached. Please try again later."
      : error.code === "42P01"
        ? "The artwork catalogue table is not available in the configured database. Check the backend database configuration."
        : null;
    res.status(setupMessage ? 503 : 500).json({
      success: false,
      message: setupMessage || "Could not fetch paintings"
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
    const setupMessage = error.code === "ENOTFOUND" || error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT"
      ? "This artwork is temporarily unavailable because the database connection could not be reached. Please try again later."
      : error.code === "42P01"
        ? "The artwork catalogue table is not available in the configured database. Check the backend database configuration."
        : null;
    res.status(setupMessage ? 503 : 500).json({
      success: false,
      message: setupMessage || "Could not fetch painting"
    });
  }
});

function normalizePaintingImageUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const imageUrl = value.trim();
  if (/^https?:\/\//i.test(imageUrl)) {
    try {
      const parsed = new URL(imageUrl);
      return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : null;
    } catch {
      return null;
    }
  }

  const relativePath = imageUrl.replace(/^\/+/, "");
  if (!relativePath.startsWith("images/") || relativePath.includes("\\")) return null;
  const publicImages = path.resolve(__dirname, "../public/images");
  const filePath = path.resolve(__dirname, "../public", relativePath);
  if (!filePath.startsWith(`${publicImages}${path.sep}`)) return null;
  try {
    return fs.statSync(filePath).isFile() ? relativePath : null;
  } catch {
    return null;
  }
}

function validatePaintingPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Enter valid artwork details" };
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const artist = typeof body.artist === "string" ? body.artist.trim() : "";
  const description = body.description == null ? "" : typeof body.description === "string" ? body.description.trim() : null;
  const priceIsTyped = typeof body.price === "number" || typeof body.price === "string";
  const priceInput = typeof body.price === "string" ? body.price.trim() : body.price;
  const price = !priceIsTyped || priceInput === "" || priceInput == null ? NaN : Number(priceInput);
  const status = body.status;
  const imageUrl = normalizePaintingImageUrl(body.image_url);

  if (!title) return { error: "Title is required" };
  if (!artist) return { error: "Artist is required" };
  if (description === null) return { error: "Description must be text" };
  if (!Number.isFinite(price) || price < 0) return { error: "Price must be a valid non-negative number" };
  if (!imageUrl) return { error: "Enter an existing image under public/images or a valid HTTP(S) image URL" };
  if (!["available", "sold"].includes(status)) return { error: "Status must be available or sold" };
  return { painting: { title, artist, description, price, image_url: imageUrl, status } };
}

/** Studio-only artwork creation; customer catalogue reads the same paintings table. */
app.post("/api/admin/paintings", authenticateToken, requireRole("studio"), async (req, res) => {
  const validated = validatePaintingPayload(req.body);
  if (validated.error) return res.status(400).json({ success: false, message: validated.error });
  try {
    const { title, artist, description, price, image_url, status } = validated.painting;
    const result = await pool.query(
      `INSERT INTO public.paintings (id, title, artist, description, price, image_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, title, artist, description, price, image_url, status`,
      [`p-${randomUUID()}`, title, artist, description, price, image_url, status]
    );
    return res.status(201).json({ success: true, painting: result.rows[0] });
  } catch (error) {
    console.error("Studio artwork creation failed:", error.message);
    if (error.code === "23505") return res.status(409).json({ success: false, message: "An artwork with this ID already exists. Please try again." });
    const setupMessage = workflowFailureMessage(error, "Artwork catalogue");
    const invalidData = ["23502", "22P02", "22003", "22001", "23514"].includes(error.code);
    return res.status(setupMessage ? 503 : invalidData ? 400 : 500).json({
      success: false,
      message: setupMessage || (invalidData ? "The artwork details do not match the catalogue requirements" : "Could not add artwork")
    });
  }
});

/** Studio-only artwork editing; public GET routes immediately expose saved changes. */
app.patch("/api/admin/paintings/:id", authenticateToken, requireRole("studio"), async (req, res) => {
  const validated = validatePaintingPayload(req.body);
  if (validated.error) return res.status(400).json({ success: false, message: validated.error });
  try {
    const { title, artist, description, price, image_url, status } = validated.painting;
    const result = await pool.query(
      `UPDATE public.paintings
       SET title = $1, artist = $2, description = $3, price = $4, image_url = $5, status = $6
       WHERE id = $7
       RETURNING id, title, artist, description, price, image_url, status`,
      [title, artist, description, price, image_url, status, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Artwork not found" });
    return res.json({ success: true, painting: result.rows[0] });
  } catch (error) {
    console.error("Studio artwork update failed:", error.message);
    const setupMessage = workflowFailureMessage(error, "Artwork catalogue");
    const invalidData = ["23502", "22P02", "22003", "22001", "23514"].includes(error.code);
    return res.status(setupMessage ? 503 : invalidData ? 400 : 500).json({
      success: false,
      message: setupMessage || (invalidData ? "The artwork details do not match the catalogue requirements" : "Could not update artwork")
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

// Painting requests are persistent database records. Only the authenticated
// customer is used as owner; role and approval state are never client supplied.
app.post("/api/painting-requests", authenticateToken, requireRole("customer"), async (req, res) => {
  const paintingId = req.body?.painting_id;
  if (typeof paintingId !== "string" || !paintingId.trim()) {
    return res.status(400).json({ success: false, message: "Choose an artwork to request" });
  }
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const painting = await client.query(
      "SELECT id, title, artist, price, status, image_url FROM public.paintings WHERE id = $1 FOR UPDATE",
      [paintingId.trim()]
    );
    if (!painting.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Artwork not found" });
    }
    if (painting.rows[0].status !== "available") {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "This artwork is no longer available" });
    }
    const result = await client.query(
      `INSERT INTO public.painting_requests (user_id, painting_id, status)
       VALUES ($1, $2, 'pending') RETURNING *`,
      [req.user.id, paintingId.trim()]
    );
    await client.query("COMMIT");
    return res.status(201).json({ success: true, request: { ...result.rows[0], painting: painting.rows[0] } });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") return res.status(409).json({ success: false, message: "You already have an active request for this artwork" });
    console.error("Artwork request failed:", error.message);
    const setupMessage = workflowFailureMessage(error, "Artwork requests");
    return res.status(setupMessage ? 503 : 500).json({ success: false, message: setupMessage || "Could not submit artwork request" });
  } finally {
    client?.release();
  }
});

app.get("/api/painting-requests/my", authenticateToken, requireRole("customer"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT pr.*, p.title, p.artist, p.price, p.image_url
       FROM public.painting_requests pr
       JOIN public.paintings p ON p.id = pr.painting_id
       WHERE pr.user_id = $1 ORDER BY pr.created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, requests: result.rows });
  } catch (error) {
    console.error("Could not fetch artwork requests:", error.message);
    const setupMessage = workflowFailureMessage(error, "Artwork requests");
    res.status(setupMessage ? 503 : 500).json({ success: false, message: setupMessage || "Could not fetch artwork requests" });
  }
});

app.patch("/api/painting-requests/:id/cancel", authenticateToken, requireRole("customer"), async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE public.painting_requests
       SET status = 'cancelled', cancelled_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'approved'
         AND order_item_id IS NULL
       RETURNING *`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Request not found or no longer cancellable" });
    res.json({ success: true, request: result.rows[0] });
  } catch (error) {
    if (error.code === "22P02") return res.status(404).json({ success: false, message: "Request not found" });
    console.error("Artwork request cancellation failed:", error.message);
    res.status(500).json({ success: false, message: "Could not cancel artwork request" });
  }
});

app.post("/api/painting-requests/:id/cart-eligibility", authenticateToken, requireRole("customer"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT pr.id AS request_id, pr.status AS request_status, p.id, p.title, p.artist,
              p.price, p.status AS painting_status, p.image_url
       FROM public.painting_requests pr JOIN public.paintings p ON p.id = pr.painting_id
       WHERE pr.id = $1 AND pr.user_id = $2 AND pr.order_item_id IS NULL`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Artwork request not found" });
    const request = result.rows[0];
    if (request.request_status !== "approved" || request.painting_status !== "available") {
      return res.status(409).json({ success: false, message: "Only approved requests for available artwork can be added to the bag" });
    }
    res.json({ success: true, painting: request });
  } catch (error) {
    if (error.code === "22P02") return res.status(404).json({ success: false, message: "Artwork request not found" });
    console.error("Artwork cart eligibility check failed:", error.message);
    res.status(500).json({ success: false, message: "Could not verify artwork request" });
  }
});

app.get("/api/admin/painting-requests", authenticateToken, requireRole("studio"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT pr.*, p.title, p.artist, p.price, p.image_url, u.email AS customer_email
       FROM public.painting_requests pr
       JOIN public.paintings p ON p.id = pr.painting_id
       JOIN public.users u ON u.id = pr.user_id
       ORDER BY pr.created_at DESC`
    );
    res.json({ success: true, requests: result.rows });
  } catch (error) {
    console.error("Could not fetch admin artwork requests:", error.message);
    const setupMessage = workflowFailureMessage(error, "Artwork requests");
    res.status(setupMessage ? 503 : 500).json({ success: false, message: setupMessage || "Could not fetch artwork requests" });
  }
});

app.patch("/api/admin/painting-requests/:id", authenticateToken, requireRole("studio"), async (req, res) => {
  const { status } = req.body || {};
  if (!["approved", "declined"].includes(status)) {
    return res.status(400).json({ success: false, message: "Status must be approved or declined" });
  }
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const request = await client.query(
      `SELECT * FROM public.painting_requests WHERE id = $1 AND status = 'pending' FOR UPDATE`,
      [req.params.id]
    );
    if (!request.rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, message: "Pending artwork request not found" });
    }
    if (status === "approved") {
      const painting = await client.query("SELECT status FROM public.paintings WHERE id = $1 FOR UPDATE", [request.rows[0].painting_id]);
      if (!painting.rows.length || painting.rows[0].status !== "available") {
        await client.query("ROLLBACK");
        return res.status(409).json({ success: false, message: "This artwork is no longer available to approve" });
      }
    }
    const updated = await client.query(
      "UPDATE public.painting_requests SET status = $1, decided_at = NOW() WHERE id = $2 RETURNING *",
      [status, request.rows[0].id]
    );
    await client.query("COMMIT");
    res.json({ success: true, request: updated.rows[0] });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") return res.status(409).json({ success: false, message: "Another request for this artwork has already been approved" });
    if (error.code === "22P02") return res.status(404).json({ success: false, message: "Artwork request not found" });
    console.error("Admin artwork request update failed:", error.message);
    const setupMessage = workflowFailureMessage(error, "Artwork requests");
    res.status(setupMessage ? 503 : 500).json({ success: false, message: setupMessage || "Could not update artwork request" });
  } finally {
    client?.release();
  }
});

app.post("/api/wall-bookings/:id/cart-eligibility", authenticateToken, requireRole("customer"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM public.wall_bookings WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Mural request not found" });
    const booking = result.rows[0];
    if (booking.status !== "confirmed" || booking.order_item_id) return res.status(409).json({ success: false, message: "Only an approved mural request that has not been checked out can be added to the bag" });
    const date = dateOnlyISO(booking.booking_date);
    if (!isValidISODate(date) || date < addDays(todayIST(), 7) || date > addDays(todayIST(), 90)) return res.status(409).json({ success: false, message: "The mural date is no longer within the allowed booking window" });
    const rate = await configuredWallRate();
    const size = validWallSize(booking.wall_size_sqft);
    if (rate === null || !Number.isFinite(rate) || rate < 0 || !size) return res.status(409).json({ success: false, message: "The mural request can no longer be priced" });
    res.json({ success: true, booking: { ...booking, rate_per_sqft: rate, total_price: calculateMuralTotal(rate, size) } });
  } catch (error) {
    if (error.code === "22P02") return res.status(404).json({ success: false, message: "Mural request not found" });
    console.error("Mural cart eligibility check failed:", error.message);
    res.status(500).json({ success: false, message: "Could not verify mural request" });
  }
});

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

  let client;
  try {
    client = await pool.connect();
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
      if (entry.type === "painting") {
        if (qty !== 1 || typeof entry.id !== "string" || paintingIds.has(entry.id)) throw Object.assign(new Error("Each original painting may appear only once in the cart"), { status: 400 });
        if (typeof entry.request_id !== "string") throw Object.assign(new Error("An approved artwork request is required"), { status: 400 });
        const approvedRequest = await client.query(
          `SELECT id, painting_id, status FROM public.painting_requests
           WHERE id = $1 AND user_id = $2 AND order_item_id IS NULL FOR UPDATE`,
          [entry.request_id, req.user.id]
        );
        if (!approvedRequest.rows.length || approvedRequest.rows[0].painting_id !== entry.id) throw Object.assign(new Error("Artwork request not found"), { status: 404 });
        if (approvedRequest.rows[0].status !== "approved") throw Object.assign(new Error("Only approved artwork requests can be checked out"), { status: 409 });
        const requestId = approvedRequest.rows[0].id;
        const paintingId = entry.id;
        paintingIds.add(paintingId);
        const result = await client.query("SELECT id, title, price, status FROM public.paintings WHERE id = $1 FOR UPDATE", [paintingId]);
        if (!result.rows.length) throw Object.assign(new Error("A painting in the cart could not be found"), { status: 404 });
        const painting = result.rows[0];
        if (painting.status !== "available") throw Object.assign(new Error(`“${painting.title}” is no longer available`), { status: 409 });
        const price = Number(painting.price);
        lineItems.push({ type: "painting", painting_id: painting.id, request_id: requestId, name: painting.title, quantity: 1, unit_price: price, line_total: calculateLineTotal(price, 1), status: "placed", details: {} });
      } else if (entry.type === "pottery") {
        if (typeof entry.request_id !== "string") throw Object.assign(new Error("An accepted pottery request is required"), { status: 400 });
        const requestResult = await client.query(
          `SELECT pr.id, pr.item_id, pr.glaze_id, pr.quantity, pr.needed_by, pr.status, pr.order_item_id,
                  pi.name AS item_name, g.name AS glaze_name
           FROM public.pottery_requests pr
           JOIN public.pottery_items pi ON pi.id = pr.item_id
           JOIN public.glazes g ON g.id = pr.glaze_id
           WHERE pr.id = $1 AND pr.user_id = $2 FOR UPDATE OF pr`,
          [entry.request_id, req.user.id]
        );
        if (!requestResult.rows.length) throw Object.assign(new Error("Pottery request not found"), { status: 404 });
        const potteryRequest = requestResult.rows[0];
        if (potteryRequest.status !== "accepted" || potteryRequest.order_item_id) throw Object.assign(new Error("Only accepted pottery requests that are not already ordered can be checked out"), { status: 409 });
        if (String(potteryRequest.item_id) !== entry.id || Number(potteryRequest.quantity) !== qty) throw Object.assign(new Error("The pottery bag item no longer matches its accepted request"), { status: 409 });
        const neededBy = potteryRequest.needed_by instanceof Date
          ? potteryRequest.needed_by.toISOString().slice(0, 10)
          : String(potteryRequest.needed_by).slice(0, 10);
        if (!isValidISODate(neededBy)) throw Object.assign(new Error("The accepted pottery request has an invalid needed-by date"), { status: 409 });
        const estimate = potteryEstimate(potteryRequest.item_name, qty);
        if (!estimate) throw Object.assign(new Error("This pottery item has no configured checkout price"), { status: 400 });
        lineItems.push({ type: "pottery", pottery_request_id: potteryRequest.id, name: potteryRequest.item_name, quantity: qty, unit_price: estimate.price_per_item, line_total: estimate.estimated_total, status: "pending_confirmation", details: { glaze_id: potteryRequest.glaze_id, glaze_name: potteryRequest.glaze_name, needed_by: neededBy } });
      } else {
        if (qty !== 1 || typeof entry.request_id !== "string") throw Object.assign(new Error("An approved mural request is required"), { status: 400 });
        const muralRequestResult = await client.query(
          `SELECT * FROM public.wall_bookings WHERE id = $1 AND user_id = $2 FOR UPDATE`,
          [entry.request_id, req.user.id]
        );
        if (!muralRequestResult.rows.length) throw Object.assign(new Error("Mural request not found"), { status: 404 });
        const muralRequest = muralRequestResult.rows[0];
        if (muralRequest.status !== "confirmed" || muralRequest.order_item_id) throw Object.assign(new Error("Only an approved mural request that has not been checked out can be purchased"), { status: 409 });
        const bookingDate = dateOnlyISO(muralRequest.booking_date);
        if (!isValidISODate(bookingDate) || bookingDate < addDays(todayIST(), 7) || bookingDate > addDays(todayIST(), 90)) throw Object.assign(new Error("The approved mural date is no longer within the 7–90 day booking window"), { status: 409 });
        const size = validWallSize(muralRequest.wall_size_sqft);
        if (!size) throw Object.assign(new Error("Mural wall size must be a whole number between 10 and 500 sq ft"), { status: 400 });
        const rate = await configuredWallRate();
        if (rate === null || !Number.isFinite(rate) || rate < 0) throw Object.assign(new Error("Studio mural rate is not configured"), { status: 500 });
        const lineTotal = calculateMuralTotal(rate, size);
        lineItems.push({ type: "mural", mural_request_id: muralRequest.id, name: "Wall mural service", quantity: 1, unit_price: rate, line_total: lineTotal, status: "placed", details: { wall_size_sqft: size, rate_per_sqft: rate, booking_date: bookingDate, service_address: muralRequest.address, estimate: true } });
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
      const itemResult = await client.query(
        `INSERT INTO public.order_items
           (order_id, item_type, painting_id, item_name, quantity, unit_price, line_total, status, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb) RETURNING id`,
        [order.id, line.type, line.painting_id || null, line.name, line.quantity, line.unit_price, line.line_total, line.status, JSON.stringify(line.details)]
      );
      line.id = itemResult.rows[0].id;
      if (line.request_id) {
        const updated = await client.query(
          `UPDATE public.painting_requests SET status = 'purchased', order_item_id = $1
           WHERE id = $2 AND user_id = $3 AND status = 'approved' AND order_item_id IS NULL`,
          [line.id, line.request_id, req.user.id]
        );
        if (updated.rowCount !== 1) throw Object.assign(new Error("Artwork approval changed before checkout completed"), { status: 409 });
      }
      if (line.mural_request_id) {
        const updated = await client.query(
          `UPDATE public.wall_bookings SET order_item_id = $1
           WHERE id = $2 AND user_id = $3 AND status = 'confirmed' AND order_item_id IS NULL`,
          [line.id, line.mural_request_id, req.user.id]
        );
        if (updated.rowCount !== 1) throw Object.assign(new Error("Mural approval changed before checkout completed"), { status: 409 });
      }
      if (line.pottery_request_id) {
        const updated = await client.query(
          `UPDATE public.pottery_requests SET order_item_id = $1
           WHERE id = $2 AND user_id = $3 AND status = 'accepted' AND order_item_id IS NULL`,
          [line.id, line.pottery_request_id, req.user.id]
        );
        if (updated.rowCount !== 1) throw Object.assign(new Error("Pottery approval changed before checkout completed"), { status: 409 });
      }
    }
    for (const paintingId of paintingIds) await client.query("UPDATE public.paintings SET status = 'sold' WHERE id = $1", [paintingId]);

    await client.query("COMMIT");
    const responseOrder = { ...order, items: lineItems };
    return res.status(201).json({ success: true, order: responseOrder });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") {
      const existing = await pool.query("SELECT id FROM public.orders WHERE checkout_key = $1 AND user_id = $2", [checkout_key, req.user.id]).catch(() => ({ rows: [] }));
      if (existing.rows.length) {
        const order = await loadOrderDetails(pool, existing.rows[0].id).catch(() => null);
        if (order) return res.status(200).json({ success: true, order, duplicate: true });
      }
      return res.status(409).json({ success: false, message: "A request in this order was just used or is no longer available. Refresh your bag and try again." });
    }
    if (error.status) return res.status(error.status).json({ success: false, message: error.message });
    console.error("Checkout failed:", error.message);
    const setupMessage = workflowFailureMessage(error, "Checkout");
    return res.status(setupMessage ? 503 : 500).json({ success: false, message: setupMessage || "Could not place your order" });
  } finally {
    client?.release();
  }
});

/**
 * POST /api/paintings/:id/purchase
 * Legacy direct purchase is disabled so artwork cannot bypass Studio approval.
 */
app.post("/api/paintings/:id/purchase", authenticateToken, requireRole("customer"), async (req, res) => {
  return res.status(409).json({ success: false, message: "Direct artwork purchases are no longer available. Submit an artwork request and add it to your bag after Studio approval." });
});

/**
 * POST /api/orders/:id/cancel
 * Customer cancels their own placed order and painting returns to available.
 */
app.post("/api/orders/:id/cancel", authenticateToken, requireRole("customer"), async (req, res) => {
  let client;
  try {
    client = await pool.connect();
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

    if (order.painting_id) {
      const itemTable = await client.query("SELECT to_regclass('public.order_items') IS NOT NULL AS present");
      const mixedOrderCheck = itemTable.rows[0].present
        ? "OR EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = o.id AND oi.painting_id = p.id)"
        : "";
      await client.query(
        `UPDATE public.paintings p SET status = 'available'
         WHERE p.id = $1 AND NOT EXISTS (
           SELECT 1 FROM public.orders o
           WHERE o.id <> $2 AND o.status = 'placed'
             AND (o.painting_id = p.id ${mixedOrderCheck})
         )`,
        [order.painting_id, order.id]
      );
    } else {
      const lines = await client.query(
        "SELECT id, painting_id, item_type FROM public.order_items WHERE order_id = $1 FOR UPDATE",
        [order.id]
      );
      for (const line of lines.rows) {
        if (line.type === "painting" || line.item_type === "painting") {
          await client.query(
            `UPDATE public.paintings p SET status = 'available'
             WHERE p.id = $1 AND NOT EXISTS (
               SELECT 1 FROM public.orders o
               WHERE o.id <> $2 AND o.status = 'placed'
                 AND (o.painting_id = p.id OR EXISTS (
                   SELECT 1 FROM public.order_items other_line
                   WHERE other_line.order_id = o.id AND other_line.painting_id = p.id
                 ))
             )`,
            [line.painting_id, order.id]
          );
          await client.query(
            `UPDATE public.painting_requests
             SET status = 'approved', order_item_id = NULL
             WHERE order_item_id = $1 AND status = 'purchased'`,
            [line.id]
          );
        }
        if (line.item_type === "mural") {
          await client.query("UPDATE public.wall_bookings SET order_item_id = NULL WHERE order_item_id = $1", [line.id]);
        }
        if (line.item_type === "pottery") {
          await client.query("UPDATE public.pottery_requests SET order_item_id = NULL WHERE order_item_id = $1", [line.id]);
        }
      }
      await client.query("UPDATE public.order_items SET status = 'cancelled' WHERE order_id = $1", [order.id]);
    }

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Order cancelled and painting is available again"
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
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
    client?.release();
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
    const setupMessage = workflowFailureMessage(error, "Order history");
    res.status(setupMessage ? 503 : 500).json({
      success: false,
      message: setupMessage || "Could not fetch your orders"
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
  let client;
  try {
    client = await pool.connect();
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
    if (client) await client.query("ROLLBACK").catch(() => {});

    // Unique index violation → date already booked
    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "That date is already booked. Please choose a different date."
      });
    }

    console.error("Wall booking failed:", error.message);
    const setupMessage = workflowFailureMessage(error, "Mural requests");
    res.status(setupMessage ? 503 : 500).json({
      success: false,
      message: setupMessage || "Could not create wall booking"
    });
  } finally {
    client?.release();
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

    if (booking.order_item_id) {
      await client.query("ROLLBACK");
      return res.status(409).json({ success: false, message: "Cancel the checkout order before cancelling this mural booking" });
    }

    // Cancellation window: must be ≥ 3 days before booking date
    const today      = todayIST();
    const bookingDay = dateOnlyISO(booking.booking_date);
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

app.post("/api/pottery-requests/:id/cart-eligibility", authenticateToken, requireRole("customer"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT pr.*, pi.name AS item_name, g.name AS glaze_name
       FROM public.pottery_requests pr
       JOIN public.pottery_items pi ON pi.id = pr.item_id
       JOIN public.glazes g ON g.id = pr.glaze_id
       WHERE pr.id = $1 AND pr.user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: "Pottery request not found" });
    const request = result.rows[0];
    if (request.status !== "accepted" || request.order_item_id) {
      return res.status(409).json({ success: false, message: "Only accepted pottery requests that are not already ordered can be added to the bag" });
    }
    const estimate = potteryEstimate(request.item_name, request.quantity);
    if (!estimate) return res.status(409).json({ success: false, message: "This pottery request has no configured price" });
    res.json({ success: true, request: { ...request, ...estimate } });
  } catch (error) {
    if (error.code === "22P02") return res.status(404).json({ success: false, message: "Pottery request not found" });
    console.error("Pottery cart eligibility check failed:", error.message);
    res.status(500).json({ success: false, message: "Could not verify pottery request" });
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
    const setupMessage = workflowFailureMessage(error, "Studio orders");
    res.status(setupMessage ? 503 : 500).json({
      success: false,
      message: setupMessage || "Could not fetch orders"
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
    if (status === "confirmed") {
      const candidate = await pool.query(
        "SELECT booking_date FROM public.wall_bookings WHERE id = $1 AND status = 'requested'",
        [req.params.id]
      );
      if (!candidate.rows.length) return res.status(404).json({ success: false, message: "Pending booking not found" });
      const date = dateOnlyISO(candidate.rows[0].booking_date);
      if (!isValidISODate(date) || date < addDays(todayIST(), 7) || date > addDays(todayIST(), 90)) {
        return res.status(409).json({ success: false, message: "This booking date is no longer within the 7–90 day window" });
      }
    }
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
    if (error.code === "23505") return res.status(409).json({ success: false, message: "That date already has a pending or confirmed mural request" });
    if (error.code === "22P02") return res.status(404).json({ success: false, message: "Booking not found" });
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

const server = app.listen(PORT);
server.once("listening", () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});
server.once("error", (error) => {
  // Express 5 passes listen errors to an app.listen callback. Listen for the
  // event explicitly so a failed bind cannot be reported as a successful start.
  console.error(`Backend could not listen on port ${PORT}: ${error.code || error.message}`);
  process.exitCode = 1;
});
