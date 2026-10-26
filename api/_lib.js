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
/**
 * A wall-clock timestamp in IST, for humans and for Google Sheets.
 *
 * Built with Intl rather than by adding 5.5 hours to a UTC date, because an offset typed as
 * a number is a second source of truth that nobody updates. `hourCycle: 'h23'` is deliberate:
 * `hour12: false` yields "24" for midnight in some runtimes, which Sheets rejects outright.
 */
function istStamp(epochSeconds) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(epochSeconds * 1000));
  const g = (t) => (parts.find((x) => x.type === t) || {}).value || '00';
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}:${g('second')}`;
}

function registrationRecord(p) {
  const n = p.notes || {};
  const paise = Number(p.amount || 0);
  const fee = Number(p.fee || 0);            // Razorpay fee incl. GST on the fee, in paise
  return {
    orderId: p.id,
    // ── TWO TIME FIELDS, AND THEY ARE NOT INTERCHANGEABLE (26 Oct 2026) ───────────
    //
    // `orderTime` STAYS UTC. The tracker parses it with Date.parse() and it decides which
    // webinar an order belongs to (D50) — "a wrong date puts real money on the wrong
    // cohort". A naive local string like "2026-10-26 18:13:52" has no offset, so Date.parse
    // reads it in the SERVER's zone; Vercel runs UTC, so every order would land 5h30m late
    // and some would jump to the next day's cohort. The machine field is left alone.
    //
    // `orderTimeIST` is the one for the Google Sheet. The sheet was showing UTC — a 6:13 pm
    // payment written as 12:43 — which reads as the row arriving hours late. It is not late:
    // measured over the last two days, payment to arrival is 5–67 seconds, mostly ~20.
    // Nothing was slow; the number was simply in the wrong zone.
    //
    // Format is `YYYY-MM-DD HH:MM:SS`, which Sheets parses as a real datetime in any locale.
    // `DD/MM/YYYY` would be read as US month-first by a sheet that is not set to en-IN.
    orderTime: new Date((p.created_at || 0) * 1000).toISOString(),
    orderTimeIST: istStamp(p.created_at || 0),
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
