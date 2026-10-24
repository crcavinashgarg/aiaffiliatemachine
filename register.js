/* ------------------------------------------------------------------
   AI Affiliate Machine — Razorpay registration flow
   Drop this on /fp:   <script src="/register.js" defer></script>
   It takes over every Register button (see SELECTOR below), opens the
   name / phone / email form, creates an order, and launches Razorpay
   Checkout with those details already filled in.
   ------------------------------------------------------------------ */
(function () {
  "use strict";

  var CONFIG = {
    // Buttons to take over. Any element matching this opens the form.
    // On /fp the TagMango links all point at learn.internetyouthacademy.com,
    // so the default catches all of them without touching the HTML.
    SELECTOR: '[data-cfg-href="registrationUrl"], a[href*="learn.internetyouthacademy.com"], [data-register]',
    CREATE_ORDER_URL: "/api/create-order",
    VERIFY_URL: "/api/verify-payment",
    THANK_YOU_URL: "/AF-Thank-You",
    PRODUCT_NAME: "AI Affiliate Machine — Live Masterclass",
    DESCRIPTION: "₹199 webinar ticket",
    BRAND_COLOR: "#F5B301",            // page gold
    LOGO_URL: "",                       // optional small square image for the checkout header
    CHECKOUT_JS: "https://checkout.razorpay.com/v1/checkout.js"
  };

  /* ---------- markup ---------- */
  var html =
    '<div class="rzp-overlay" id="rzpOverlay" aria-hidden="true">' +
    '  <div class="rzp-card" role="dialog" aria-modal="true" aria-labelledby="rzpTitle">' +
    '    <button class="rzp-close" type="button" aria-label="Close">&times;</button>' +
    '    <div class="rzp-head">' +
    '      <div class="rzp-eyebrow">Reserve your seat</div>' +
    '      <h2 class="rzp-title" id="rzpTitle">Live Masterclass · <em>₹199</em></h2>' +
    '      <p class="rzp-sub">Fill in three details. Payment opens right after.</p>' +
    '    </div>' +
    '    <form class="rzp-form" id="rzpForm" novalidate>' +
    '      <label class="rzp-field"><span>Full name</span>' +
    '        <input name="name" type="text" autocomplete="name" placeholder="Priya Sharma" required maxlength="80"></label>' +
    '      <label class="rzp-field"><span>WhatsApp number</span>' +
    '        <div class="rzp-phone"><em>+91</em>' +
    '        <input name="phone" type="tel" inputmode="numeric" autocomplete="tel-national" placeholder="98765 43210" required maxlength="10"></div></label>' +
    '      <label class="rzp-field"><span>Email</span>' +
    '        <input name="email" type="email" autocomplete="email" placeholder="you@example.com" required maxlength="120"></label>' +
    '      <div class="rzp-error" id="rzpError" role="alert"></div>' +
    '      <button class="rzp-submit" type="submit" id="rzpSubmit">' +
    '        <span class="rzp-submit-text">Continue to payment →</span>' +
    '        <span class="rzp-spinner" aria-hidden="true"></span>' +
    '      </button>' +
    '      <div class="rzp-trust">' +
    '        <span>🔒 Secured by Razorpay</span><span>UPI · Cards · Net banking</span>' +
    '      </div>' +
    '    </form>' +
    '  </div>' +
    '</div>';

  var overlay, form, errorBox, submitBtn, triggerEl;
  var checkoutLoaded = false;

  function mount() {
    if (document.getElementById("rzpOverlay")) return;
    var wrap = document.createElement("div");
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstChild);
    overlay = document.getElementById("rzpOverlay");
    form = document.getElementById("rzpForm");
    errorBox = document.getElementById("rzpError");
    submitBtn = document.getElementById("rzpSubmit");

    overlay.querySelector(".rzp-close").addEventListener("click", close);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && isOpen()) close(); });
    form.addEventListener("submit", onSubmit);

    // digits only in the phone field
    form.phone.addEventListener("input", function () {
      this.value = this.value.replace(/\D/g, "").slice(0, 10);
    });
  }

  function isOpen() { return overlay && overlay.classList.contains("is-open"); }

  function open(e) {
    if (e) { e.preventDefault(); triggerEl = e.currentTarget; }
    mount();
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("rzp-lock");
    setError("");
    setTimeout(function () { form.name.focus(); }, 60);
    // warm up Razorpay's script while they type
    loadCheckout();
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("rzp-lock");
    setBusy(false);
    if (triggerEl && triggerEl.focus) triggerEl.focus();
  }

  function setError(msg) { errorBox.textContent = msg || ""; errorBox.style.display = msg ? "block" : "none"; }
  function setBusy(on) {
    submitBtn.disabled = !!on;
    submitBtn.classList.toggle("is-busy", !!on);
    Array.prototype.forEach.call(form.querySelectorAll("input"), function (i) { i.disabled = !!on; });
  }

  function loadCheckout() {
    return new Promise(function (resolve, reject) {
      if (window.Razorpay) { checkoutLoaded = true; return resolve(); }
      if (checkoutLoaded) {
        var t = setInterval(function () { if (window.Razorpay) { clearInterval(t); resolve(); } }, 50);
        return;
      }
      checkoutLoaded = true;
      var s = document.createElement("script");
      s.src = CONFIG.CHECKOUT_JS;
      s.onload = resolve;
      s.onerror = function () { checkoutLoaded = false; reject(new Error("Could not load Razorpay")); };
      document.head.appendChild(s);
    });
  }

  function validate(d) {
    if (d.name.trim().length < 2) return "Please enter your full name.";
    if (!/^[6-9]\d{9}$/.test(d.phone)) return "Enter a valid 10-digit Indian mobile number.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) return "Enter a valid email address.";
    return "";
  }

  /* Attribution the page already tracks: the utm set + fbclid/gclid remembered
     by the source-tag code (window.IYA_source), and the tracker's browser id
     (iya_cid) minted by the visit recorder. These ride on the Razorpay order as
     notes, exactly as they rode on the TagMango checkout URL. */
  function attribution() {
    var a = {};
    try {
      var src = (window.IYA_source && window.IYA_source()) || {};
      ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "fbclid", "gclid"]
        .forEach(function (k) { if (src[k]) a[k] = String(src[k]).slice(0, 256); });
    } catch (_) {}
    try {
      var cid = localStorage.getItem("iya_cid");
      if (!cid) { var m = document.cookie.match(/(?:^|;\s*)iya_cid=([a-f0-9]{16,64})/i); if (m) cid = m[1]; }
      if (cid) a.cid = String(cid).toLowerCase().slice(0, 64);
    } catch (_) {}
    return a;
  }

  function onSubmit(e) {
    e.preventDefault();
    var data = {
      name: form.name.value.trim(),
      phone: form.phone.value.trim(),
      email: form.email.value.trim().toLowerCase()
    };
    var err = validate(data);
    if (err) { setError(err); return; }

    setError("");
    setBusy(true);

    var order;
    fetch(CONFIG.CREATE_ORDER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({}, data, {
        page: location.pathname, site: location.host, attribution: attribution() }))
    })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "Order failed"); return j; }); })
      .then(function (o) { order = o; return loadCheckout(); })
      .then(function () { launch(order, data); })
      .catch(function (ex) {
        setBusy(false);
        setError(ex.message === "Failed to fetch" ? "Network problem. Please try again." : ex.message);
      });
  }

  function launch(order, data) {
    var rzp = new window.Razorpay({
      key: order.key_id,
      amount: order.amount,
      currency: order.currency,
      order_id: order.order_id,
      name: CONFIG.PRODUCT_NAME,
      description: CONFIG.DESCRIPTION,
      image: CONFIG.LOGO_URL || undefined,
      prefill: { name: data.name, email: data.email, contact: "+91" + data.phone },
      theme: { color: CONFIG.BRAND_COLOR },
      remember_customer: true,
      retry: { enabled: true, max_count: 3 },
      modal: {
        ondismiss: function () { setBusy(false); setError("Payment not completed. You can try again."); }
      },
      handler: function (resp) { onPaid(resp, data); }
    });
    rzp.on("payment.failed", function (r) {
      setBusy(false);
      setError((r.error && r.error.description) || "Payment failed. Please try another method.");
    });
    // hide our form behind the checkout, keep it ready in case they come back
    rzp.open();
  }

  function onPaid(resp, data) {
    submitBtn.querySelector(".rzp-submit-text").textContent = "Confirming…";
    fetch(CONFIG.VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        razorpay_order_id: resp.razorpay_order_id,
        razorpay_payment_id: resp.razorpay_payment_id,
        razorpay_signature: resp.razorpay_signature
      })
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) throw new Error("Could not verify payment. Please WhatsApp us with payment id " + resp.razorpay_payment_id);
        /* eventID = Razorpay payment id = the orderId the tracker sends to Meta's server
           API, so Meta merges browser + server into ONE Purchase instead of two. */
        track("Purchase", { value: 199, currency: "INR" }, { eventID: resp.razorpay_payment_id });
        var q = "?pid=" + encodeURIComponent(resp.razorpay_payment_id) +
                "&n=" + encodeURIComponent(data.name) +
                "&e=" + encodeURIComponent(data.email);
        location.href = CONFIG.THANK_YOU_URL + q;
      })
      .catch(function (ex) { setBusy(false); setError(ex.message); });
  }

  function track(evt, params, opts) {
    try { if (window.fbq) window.fbq("track", evt, params || {}, opts || {}); } catch (_) {}
  }

  function bind() {
    Array.prototype.forEach.call(document.querySelectorAll(CONFIG.SELECTOR), function (el) {
      if (el.__rzpBound) return;
      el.__rzpBound = true;
      el.addEventListener("click", open, true);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
  // catch buttons injected later
  new MutationObserver(bind).observe(document.documentElement, { childList: true, subtree: true });

  window.AAMRegister = { open: open, close: close, config: CONFIG };
})();
