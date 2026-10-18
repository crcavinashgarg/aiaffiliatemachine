// Shared helpers for the Razorpay API routes (Vercel Node runtime, no deps)
const crypto = require("crypto");

function env(name, required = true) {
  const v = process.env[name];
  if (!v && required) throw new Error(`Missing env var ${name}`);
  return v;
}

function json(res, status, body) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.status(status).send(JSON.stringify(body));
}

function cors(req, res) {
  const allowed = (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  const origin = req.headers.origin || "";
  if (allowed.length === 0 || allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).end(); return true; }
  return false;
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", c => { raw += c; });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

// Raw body is needed for webhook signature checks (Vercel parses JSON otherwise)
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", c => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function hmac(secret, data) {
  return crypto.createHmac("sha256", secret).update(data).digest("hex");
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

async function razorpay(path, method, body) {
  const auth = Buffer.from(`${env("RAZORPAY_KEY_ID")}:${env("RAZORPAY_KEY_SECRET")}`).toString("base64");
  const r = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (data.error && data.error.description) || `Razorpay ${r.status}`;
    const e = new Error(msg); e.status = r.status; e.data = data; throw e;
  }
  return data;
}

/**
 * One paid registration, in the SAME field names TagMango's "New Order" trigger used
 * (orderId, orderTime, mangoName, amountPayable, status, phone, email, name, utm_*, fbclid,
 * utm_id). The Pabbly workflow's mappings therefore carry over label-for-label.
 * `cid` is sent both as `cid` and as `utm_id` because the old API step mapped cid ← utm_id.
 */
function registrationRecord(p) {
  const n = p.notes || {};
  const paise = Number(p.amount || 0);
  const fee = Number(p.fee || 0);            // Razorpay fee incl. GST on the fee, in paise
  return {
    orderId: p.id,
    orderTime: new Date((p.created_at || 0) * 1000).toISOString(),
    mangoName: n.mangoName || "AI Affiliate Masterclass",
    amountPayable: paise / 100,
    netAmountPayable: fee > 0 ? (paise - fee) / 100 : "",   // measured settlement, blank if unknown
    status: p.status === "captured" ? "completed" : p.status,
    paymentMethod: p.method || "",
    name: n.name || "", phone: n.phone || (p.contact || "").replace(/\D/g, "").slice(-10),
    email: n.email || p.email || "",
    utm_source: n.utm_source || "", utm_medium: n.utm_medium || "",
    utm_campaign: n.utm_campaign || "", utm_term: n.utm_term || "", utm_content: n.utm_content || "",
    fbclid: n.fbclid || "", gclid: n.gclid || "", ref: n.ref || "",
    cid: n.cid || "", utm_id: n.cid || "",
    page: n.page || "", gateway: "razorpay"
  };
}

// Forward a paid registration to the automation hub (Pabbly webhook URL)
async function notify(payload) {
  const url = process.env.REGISTRATION_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  } catch (e) {
    console.error("notify failed", e.message);
  }
}

module.exports = { env, json, cors, readBody, readRawBody, hmac, safeEqual, razorpay, notify, registrationRecord };
