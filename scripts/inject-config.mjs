/**
 * Build-time config injection.
 *
 * These pages are static HTML with no server, so the live date/time/price
 * arrive from a fetch() to the admin API *after* load. IYA_CONFIG is what
 * renders in the gap — and what stays if that fetch is slow, CORS-blocked or
 * the API is down. Nothing ever refreshed it, so it rotted: on 20 Sep
 * aam-thank-you.html still advertised a 23 Aug class.
 *
 * This runs on every Vercel build, reads the same endpoint the browser reads,
 * and writes the current values into that fallback. Paired with the deploy
 * hook that /admin/funnels fires on save, the fallback is never more than one
 * save behind.
 *
 * Pages are DISCOVERED, not listed: every *.html carrying an IYA_CONFIG block
 * is handled, so a new funnel page is covered the moment it is added and
 * nobody has to remember to edit this file.
 *
 * Fails soft on purpose: a bad build must never take the site down, so any
 * error leaves every file untouched and exits 0.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const API = "https://www.internetyouthacademy.com/api/masterclass/public-config?site=ai-affiliate-machine";

const M = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const D = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const cleanTime = (t) => String(t ?? "").replace(/\s*IST\s*$/i, "").trim();

/** Mirrors fmt() in the pages, so injected text matches what JS later renders. */
function display(cfg) {
  const time = `${cfg.webinarTime} IST`;
  const p = String(cfg.webinarDate ?? "").split("-");
  if (p.length !== 3) return { time, dateShort: "", dateFull: "" };
  const dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  const dateShort = `${D[dt.getUTCDay()]} ${+p[2]} ${M[+p[1] - 1]}`;
  return { time, dateShort, dateFull: `${dateShort} · ${time}` };
}

const setString = (src, k, v) => {
  const re = new RegExp(`(${k}:\\s*")[^"]*(")`);
  return re.test(src) ? src.replace(re, `$1${v}$2`) : src;
};
const setNumber = (src, k, v) => {
  const re = new RegExp(`(${k}:\\s*)\\d+`);
  return re.test(src) ? src.replace(re, `$1${v}`) : src;
};
/** Refresh the no-JS text inside <… data-cfg="key">…</…>. */
const setDataCfg = (src, k, v) =>
  src.replace(new RegExp(`(<[^>]*data-cfg="${k}"[^>]*>)[^<]*(<)`, "g"), `$1${v}$2`);

try {
  const res = await fetch(API, { headers: { "cache-control": "no-cache" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { config } = await res.json();
  if (!config?.webinar_date) throw new Error("no config in response");

  const cfg = {
    webinarDate: config.webinar_date,
    webinarTime: cleanTime(config.webinar_time),
    price: config.price,
    registrationUrl: config.registration_url,
    whatsappLink: config.whatsapp_link,
    seatCount: config.seat_count,
  };
  const text = display(cfg);
  console.log(`[inject-config] ${cfg.webinarDate} ${cfg.webinarTime} · ${cfg.price} → ${text.dateFull}`);

  const pages = readdirSync(".")
    .filter((f) => f.endsWith(".html"))
    .filter((f) => /IYA_CONFIG\s*=\s*\{/.test(readFileSync(f, "utf8")));

  if (!pages.length) throw new Error("no pages with an IYA_CONFIG block");

  for (const path of pages) {
    let src = readFileSync(path, "utf8");
    const before = src;

    // A page that reads registrationUrl from IYA_CONFIG instead of the API has
    // its own TagMango product — /aam and /second each do. The API carries the
    // MAIN funnel's link, so injecting it would hand their buyers to the wrong
    // product and the wrong pixel. Detected, not hardcoded, so a new pinned
    // page protects itself.
    const pinsCheckout = src.includes("registrationUrl:IYA_CONFIG.registrationUrl");

    for (const k of ["webinarDate","webinarTime","price","registrationUrl","whatsappLink"]) {
      if (cfg[k] == null) continue;
      if (k === "registrationUrl" && pinsCheckout) continue;
      src = setString(src, k, cfg[k]);
    }
    if (cfg.seatCount != null) src = setNumber(src, "seatCount", cfg.seatCount);

    if (cfg.price != null) src = setDataCfg(src, "price", cfg.price);
    for (const k of ["dateShort","dateFull","time"]) {
      if (text[k]) src = setDataCfg(src, k, text[k]);
    }

    const note = pinsCheckout ? " (kept its own checkout link)" : "";
    if (src !== before) {
      writeFileSync(path, src);
      console.log(`[inject-config] updated ${path}${note}`);
    } else {
      console.log(`[inject-config] ${path} already current${note}`);
    }
  }
} catch (err) {
  // Never fail the build over this — the committed fallback still renders.
  console.warn(`[inject-config] skipped, keeping committed fallback: ${err.message}`);
}
