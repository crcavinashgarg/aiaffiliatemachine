// POST /api/create-order  { name, phone, email, page }
// → { order_id, amount, currency, key_id }
const { env, json, cors, readBody, razorpay } = require("./_lib");

const AMOUNT_PAISE = parseInt(process.env.TICKET_AMOUNT_PAISE || "19900", 10); // ₹199
// Must equal the TagMango Mango name EXACTLY: the tracker identifies the product by this string.
const PRODUCT_NAME = process.env.PRODUCT_NAME || "AI Affiliate Masterclass";

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  let body;
  try { body = await readBody(req); } catch { return json(res, 400, { error: "Bad JSON" }); }

  const name = String(body.name || "").trim().slice(0, 80);
  const phone = String(body.phone || "").replace(/\D/g, "").slice(-10);
  const email = String(body.email || "").trim().toLowerCase().slice(0, 120);
  const page = String(body.page || "").slice(0, 60);

  // Attribution from the landing page. Razorpay allows 15 notes of 256 chars each.
  // Kept as the SAME names TagMango returned, so downstream mappings do not change.
  const ATTR = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "fbclid", "gclid", "cid"];
  const attr = {};
  const src = body.attribution && typeof body.attribution === "object" ? body.attribution : {};
  for (const k of ATTR) if (src[k]) attr[k] = String(src[k]).slice(0, 256);

  if (name.length < 2) return json(res, 400, { error: "Please enter your full name." });
  if (!/^[6-9]\d{9}$/.test(phone)) return json(res, 400, { error: "Enter a valid 10-digit mobile number." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return json(res, 400, { error: "Enter a valid email address." });

  try {
    const order = await razorpay("/orders", "POST", {
      amount: AMOUNT_PAISE,
      currency: "INR",
      receipt: `aam_${Date.now().toString(36)}`,
      notes: Object.assign({ name, phone, email, page, mangoName: PRODUCT_NAME }, attr)
    });
    return json(res, 200, {
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: env("RAZORPAY_KEY_ID")
    });
  } catch (e) {
    console.error("create-order", e.message, e.data);
    return json(res, 502, { error: "Could not start payment. Please try again." });
  }
};
