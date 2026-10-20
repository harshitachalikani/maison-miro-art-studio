function validateDeliveryAddress(address) {
  if (!address || typeof address !== "object" || Array.isArray(address)) return "A delivery address is required";
  const required = ["full_name", "phone", "house", "street", "locality", "city", "state", "pin_code"];
  for (const field of required) {
    if (typeof address[field] !== "string" || !address[field].trim()) return `${field.replaceAll("_", " ")} is required`;
    if (address[field].trim().length > 180) return `${field.replaceAll("_", " ")} is too long`;
  }
  const phone = address.phone.replace(/[\s()-]/g, "");
  if (!/^\+?[0-9]{10,15}$/.test(phone)) return "Enter a valid phone number";
  if (!/^\d{6}$/.test(address.pin_code.trim())) return "PIN code must contain exactly 6 digits";
  if (address.instructions != null && (typeof address.instructions !== "string" || address.instructions.length > 500)) return "Delivery instructions must be 500 characters or fewer";
  return "";
}

function normalizeDeliveryAddress(address) {
  return {
    full_name: address.full_name.trim(),
    phone: address.phone.trim(),
    house: address.house.trim(),
    street: address.street.trim(),
    locality: address.locality.trim(),
    city: address.city.trim(),
    state: address.state.trim(),
    pin_code: address.pin_code.trim(),
    instructions: typeof address.instructions === "string" ? address.instructions.trim() : ""
  };
}

function calculateLineTotal(unitPrice, quantity) {
  const price = Number(unitPrice);
  const qty = Number(quantity);
  if (!Number.isFinite(price) || price < 0 || !Number.isInteger(qty) || qty < 1 || qty > 12) throw new Error("Invalid checkout line price or quantity");
  return price * qty;
}

function calculateMuralTotal(ratePerSqft, wallSizeSqft) {
  const rate = Number(ratePerSqft);
  const size = Number(wallSizeSqft);
  if (!Number.isFinite(rate) || rate < 0 || !Number.isInteger(size) || size < 10 || size > 500) throw new Error("Invalid mural rate or wall size");
  return rate * size;
}

function sumCheckoutLines(lines) {
  return lines.reduce((sum, line) => {
    const amount = Number(line.line_total);
    if (!Number.isFinite(amount) || amount < 0) throw new Error("Invalid checkout line total");
    return sum + amount;
  }, 0);
}

module.exports = { validateDeliveryAddress, normalizeDeliveryAddress, calculateLineTotal, calculateMuralTotal, sumCheckoutLines };
