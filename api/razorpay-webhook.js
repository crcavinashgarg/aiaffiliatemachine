// POST /api/razorpay-webhook — set this URL in Razorpay Dashboard → Settings → Webhooks
// Event to subscribe: payment.captured. Secret = RAZORPAY_WEBHOOK_SECRET.
// This is the reliable record of a sale: it fires even if the buyer closes the tab
// before our verify step runs.
const { env, json, readRawBody, hmac, safeEqual, notify, registrationRecord } = require("./_lib");


// WHOSE SALE IS THIS?
//
// Razorpay fires EVERY enabled webhook endpoint on the account for EVERY payment,
// regardless of which site took it. Both this site and the other one run an identical
// handler forwarding to the SAME automation, so one payment produced two WhatsApp
// messages and two spreadsheet rows. Measured 24 Oct 2026: a single payment delivered to
// aiaffiliatemachine.co at 11:48:41.257Z and nxtpath.co at 11:48:41.265Z — eight
// milliseconds apart, one Razorpay, two endpoints.
//
// Deleting the spare endpoint fixes it until somebody re-adds one. This makes it structural:
// each site forwards only the payments its own checkout created.
//
// IT FAILS OPEN, DELIBERATELY. A payment with no `site` note — anything created before this
// shipped — is still forwarded. A guard that goes silent on unfamiliar input would turn a
// duplicate message into NO message, which is the worse failure: the buyer pays and hears
// nothing.
const SITE = "aiaffiliatemachine.co";

function belongsToAnotherSite(p) {
  const site = String((p.notes || {}).site || "").toLowerCase().replace(/^www\./, "");
  if (!site) return false;        // unknown — forward it, never go silent
  return site !== SITE;           // known and someone else's — leave it to them
}

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
    if (p && !belongsToAnotherSite(p)) await notify(registrationRecord(p));
  }
  // Always 200 so Razorpay does not keep retrying events we ignore
  return json(res, 200, { received: true });
};

module.exports.config = { api: { bodyParser: false } };
