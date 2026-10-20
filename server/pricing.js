const POTTERY_PRICES = {
  kulhad: { price: 100, unit: "item" },
  "kulhad clay cup": { price: 100, unit: "item" },
  surahi: { price: 200, unit: "item" },
  "surahi water jug": { price: 200, unit: "item" },
  matka: { price: 350, unit: "item" },
  "matka water pot": { price: 350, unit: "item" },
  "diya set": { price: 100, unit: "set" },
  gamla: { price: 500, unit: "item" },
  "gamla planter": { price: 500, unit: "item" }
};

function potteryPrice(name) {
  const key = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (POTTERY_PRICES[key]) return POTTERY_PRICES[key];
  if (key.includes("kulhad") || key.includes("clay cup")) return POTTERY_PRICES.kulhad;
  if (key.includes("surahi") || key.includes("water jug")) return POTTERY_PRICES.surahi;
  if (key.includes("matka") || key.includes("water pot")) return POTTERY_PRICES.matka;
  if (key.includes("diya") && key.includes("set")) return POTTERY_PRICES["diya set"];
  if (key.includes("gamla") || key.includes("planter")) return POTTERY_PRICES.gamla;
  return null;
}

function potteryEstimate(name, quantity) {
  const item = potteryPrice(name);
  const qty = Number(quantity);
  if (!item || !Number.isInteger(qty) || qty < 1 || qty > 12) return null;
  return { price_per_item: item.price, price_unit: item.unit, estimated_total: item.price * qty };
}

function validWallSize(value) {
  const size = Number(value);
  return Number.isInteger(size) && size >= 10 && size <= 500 ? size : null;
}

module.exports = { potteryPrice, potteryEstimate, validWallSize };
