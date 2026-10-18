# Razorpay registration flow (/fp)

Register buttons on /fp open a name / phone / email form, then Razorpay Checkout
prefilled with those details. No TagMango redirect.

## Files
- `register.js`, `register.css` — the form + checkout launcher (loaded from `<head>` of fp.html)
- `api/create-order.js` — creates the ₹199 order (secret stays server-side)
- `api/verify-payment.js` — checks Razorpay's signature + captured status before the thank-you redirect
- `api/razorpay-webhook.js` — `payment.captured` webhook; the reliable sale record
- `api/_lib.js` — shared helpers

## Vercel environment variables (Project → Settings → Environment Variables)
| name | value |
|---|---|
| `RAZORPAY_KEY_ID` | from Razorpay Dashboard → Account & Settings → API Keys |
| `RAZORPAY_KEY_SECRET` | same screen (shown once at generation) |
| `RAZORPAY_WEBHOOK_SECRET` | the secret you type when creating the webhook (below) |
| `REGISTRATION_WEBHOOK_URL` | the Pabbly "Webhook" trigger URL of the Razorpay copy of the AIaffiliatemasterclass workflow — every captured payment is POSTed there once |
| `PRODUCT_NAME` | optional — defaults to `AI Affiliate Masterclass`; must equal the TagMango Mango name the tracker knows |
| `TICKET_AMOUNT_PAISE` | optional — defaults to 19900 (₹199) |

Use **test** keys first (`rzp_test_...`), place a test order with Razorpay's test UPI/cards,
then swap to live keys.

## Razorpay webhook
Dashboard → Account & Settings → Webhooks → Add:
- URL: `https://www.aiaffiliatemachine.co/api/razorpay-webhook`
- Active events: `payment.captured`
- Secret: anything you choose → put the same value in `RAZORPAY_WEBHOOK_SECRET`

## Registration payload (POSTed to REGISTRATION_WEBHOOK_URL, once per sale, from the webhook only)
Same field names as TagMango's "New Order" trigger, so the Pabbly mappings carry over label for label:
```json
{ "orderId":"pay_...", "orderTime":"ISO", "mangoName":"AI Affiliate Masterclass",
  "amountPayable":199, "netAmountPayable":194.3, "status":"completed", "paymentMethod":"upi",
  "name":"...", "phone":"98xxxxxxxx", "email":"...",
  "utm_source":"broad", "utm_medium":"", "utm_campaign":"<Meta campaign id>", "utm_term":"<ad set id>",
  "utm_content":"<ad id>", "fbclid":"...", "gclid":"", "ref":"",
  "cid":"<tracker browser id>", "utm_id":"<same as cid>", "page":"/fp", "gateway":"razorpay" }
```
`netAmountPayable` = amount − Razorpay fee (a measured settlement figure, not a percentage guess).
The `cid`/`utm_*`/`fbclid` come from the landing page's own stores (`iya_cid`, `iya_src`) and are
stored on the Razorpay order as notes, so they are also visible on each payment in the dashboard.

## Thank-you
Buyers land on `/AF-Thank-You?pid=<payment id>&n=<name>&e=<email>`, which already fires the
Google Ads conversion. The Meta `Purchase` event (₹199) fires on /fp just before the redirect.
