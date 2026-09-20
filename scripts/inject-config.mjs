/**
 * Build-time config injection.
 *
 * These pages are static HTML with no server, so the live date/time/price
 * arrive from a fetch() to the admin API *after* load. IYA_CONFIG is what
 * renders in the gap — and what stays if that fetch is slow, CORS-blocked or
 * the API is down. Nothing ever updated it, so it rotted: by Sep 20 the
 * thank-you page still advertised an Aug 23 class.
 *
 * This runs on every Vercel build, reads the same endpoint the browser reads,
 * and writes the current values into that fallback. Paired with a deploy hook
 * fired when /admin/funnels saves, the fallback is never more than one save
 * behind.
 *
 * Fails soft on purpose: a bad build must never take the site down, so any
 * error leaves the files untouched and exits 0.
 */
import { readFileSync, writeFileSync } from "node:fs";

const API = "https://www.internetyouthacademy.com/api/masterclass/public-config?site=ai-affiliate-machine";

// registrationUrl is per-funnel: second.html points at its own TagMango
// product (/l/74a5895f5e) and deliberately ignores the API value, because the
// API carries the MAIN funnel's link. Injecting it would silently redirect
// that funnel's buyers into the wrong product and the wrong pixel.
const FILES = [
  { path: "index.html",            skip: [] },
  { path: "second.html",           skip: ["registrationUrl"] },
  { path: "AF-Thank-You.html",     skip: [] },
  { path: "second-thank-you.html", skip: [] },
];

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

/** Replace one `key: "value"` inside the IYA_CONFIG literal, nothing else. */
function setConfigString(src, key, value) {
  const re = new RegExp(`(${key}:\\s*")[^"]*(")`);
  return re.test(src) ? src.replace(re, `$1${value}$2`) : src;
}
function setConfigNumber(src, key, value) {
  const re = new RegExp(`(${key}:\\s*)\\d+`);
  return re.test(src) ? src.replace(re, `$1${value}`) : src;
}
/** Refresh the no-JS text inside <… data-cfg="key">…</…>. */
function setDataCfg(src, key, value) {
  const re = new RegExp(`(<[^>]*data-cfg="${key}"[^>]*>)[^<]*(<)`, "g");
  return src.replace(re, `$1${value}$2`);
}

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

  for (const { path, skip } of FILES) {
    let src = readFileSync(path, "utf8");
    const before = src;

    for (const key of ["webinarDate","webinarTime","price","registrationUrl","whatsappLink"]) {
      if (skip.includes(key) || cfg[key] == null) continue;
      src = setConfigString(src, key, cfg[key]);
    }
    if (cfg.seatCount != null) src = setConfigNumber(src, "seatCount", cfg.seatCount);

    if (cfg.price != null) src = setDataCfg(src, "price", cfg.price);
    for (const k of ["dateShort","dateFull","time"]) {
      if (text[k]) src = setDataCfg(src, k, text[k]);
    }

    if (src !== before) {
      writeFileSync(path, src);
      console.log(`[inject-config] updated ${path}${skip.length ? ` (kept own ${skip.join(", ")})` : ""}`);
    } else {
      console.log(`[inject-config] ${path} already current`);
    }
  }
} catch (err) {
  // Never fail the build over this — the committed fallback still renders.
  console.warn(`[inject-config] skipped, keeping committed fallback: ${err.message}`);
}
