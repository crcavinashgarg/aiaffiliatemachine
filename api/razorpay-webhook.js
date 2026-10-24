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
// How long we are willing to hold Razorpay open. Comfortably inside its retry window,
// and far below the 13s that triggered a redelivery.
const ACK_BUDGET_MS = 2500;

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
    // DO NOT WAIT FOR THE AUTOMATION TO FINISH. Razorpay wants a prompt 2xx and
    // redelivers when it does not get one — and a redelivery runs the whole automation
    // again, which messages the buyer a second time.
    //
    // Measured 24 Oct 2026, one payment:
    //   12:32:35.752  Razorpay -> here
    //   12:32:48.774  the automation finally reached our tracker, 13.0s later
    //   12:32:49.333  Razorpay REDELIVERED, 13.6s after the first
    // Pabbly runs its five steps before acknowledging the webhook, so awaiting it meant
    // holding Razorpay open for thirteen seconds.
    //
    // The POST is still sent and still processed; we simply stop WAITING for it. The
    // request is never aborted — abandoning the wait must not cancel the delivery.
    if (p && !belongsToAnotherSite(p)) {
      const sent = notify(registrationRecord(p));
      await Promise.race([sent, new Promise((r) => setTimeout(r, ACK_BUDGET_MS))]);
    }
  }
  // Always 200 so Razorpay does not keep retrying events we ignore
  return json(res, 200, { received: true });
};

module.exports.config = { api: { bodyParser: false } };
