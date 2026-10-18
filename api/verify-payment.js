// POST /api/verify-payment { razorpay_order_id, razorpay_payment_id, razorpay_signature }
// Checks the checkout signature (HMAC of "order_id|payment_id" with the key secret),
// then confirms with Razorpay that the payment is captured. → { ok: true }
const { env, json, cors, readBody, hmac, safeEqual, razorpay } = require("./_lib");

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });

  let b;
  try { b = await readBody(req); } catch { return json(res, 400, { ok: false, error: "Bad JSON" }); }
  const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } = b || {};
  if (!oid || !pid || !sig) return json(res, 400, { ok: false, error: "Missing fields" });

  const expected = hmac(env("RAZORPAY_KEY_SECRET"), `${oid}|${pid}`);
  if (!safeEqual(expected, sig)) return json(res, 400, { ok: false, error: "Signature mismatch" });

  try {
    const p = await razorpay(`/payments/${pid}`, "GET");
    const paid = p.status === "captured" || p.status === "authorized";
    if (!paid || p.order_id !== oid) return json(res, 400, { ok: false, error: `Payment status: ${p.status}` });

    // Forwarding to Pabbly happens ONLY from the webhook, so a sale is recorded once.

    return json(res, 200, { ok: true, payment_id: p.id });
  } catch (e) {
    console.error("verify-payment", e.message);
    return json(res, 502, { ok: false, error: "Could not confirm payment" });
  }
};
