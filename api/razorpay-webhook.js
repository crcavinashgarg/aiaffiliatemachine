// POST /api/razorpay-webhook — set this URL in Razorpay Dashboard → Settings → Webhooks
// Event to subscribe: payment.captured. Secret = RAZORPAY_WEBHOOK_SECRET.
// This is the reliable record of a sale: it fires even if the buyer closes the tab
// before our verify step runs.
const { env, json, readRawBody, hmac, safeEqual, notify, registrationRecord } = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  const raw = await readRawBody(req);
  const sig = req.headers["x-razorpay-signature"] || "";
  const expected = hmac(env("RAZORPAY_WEBHOOK_SECRET"), raw);
  if (!sig || !safeEqual(expected, sig)) return json(res, 400, { error: "Bad signature" });

  let evt;
  try { evt = JSON.parse(raw); } catch { return json(res, 400, { error: "Bad JSON" }); }

  if (evt.event === "payment.captured") {
    const p = evt.payload && evt.payload.payment && evt.payload.payment.entity;
    if (p) await notify(registrationRecord(p));
  }
  // Always 200 so Razorpay does not keep retrying events we ignore
  return json(res, 200, { received: true });
};

module.exports.config = { api: { bodyParser: false } };
