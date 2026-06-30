import { Collector } from "./base.js";
import { FfCalendarCollector } from "./ff-calendar.js";
import { logger } from "../../logs/index.js";

/**
 * Calendrier économique RICHE scrapé depuis investing.com (endpoint AJAX
 * `getCalendarFilteredData`, le même que celui qui alimente leur page). GRATUIT,
 * sans clé. C'est la source la plus complète : multi-pays, HEURE, impact,
 * PRÉCÉDENT / PRÉVISION et surtout le **RÉEL** (que FairEconomy ne fournit pas
 * de façon fiable et que FRED ne donne qu'en différé sur les US).
 *
 * Fenêtre : de `pastDays` (résultats déjà publiés) à `futureDays` (à venir).
 * Renvoie la MÊME forme d'event que ff-calendar (drop-in) :
 *   { datetime, date, country, currency, event, impact, previous, forecast, actual, surprise }
 *
 * Limites : c'est du scraping HTML (structure susceptible de changer) et le site
 * a une protection anti-bot → entêtes navigateur, throttle par hôte (throttle.js)
 * et cache mémoire. Si le scrape échoue, repli AUTOMATIQUE sur FairEconomy
 * (FfCalendarCollector) — une seule entrée calendrier par snapshot. Axe : macro.
 */
const URL = "https://www.investing.com/economic-calendar/Service/getCalendarFilteredData";
const TZ_GMT = 55; // timeZone investing.com = GMT/UTC → les heures sont en UTC
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min : 1 appel/h suffit en prod
let CACHE = { ts: 0, raw: null };

// Devise → id pays investing.com (vérifiés : US=5, EuroZone=72, JP=35, UK=4).
const CCY_TO_ID = {
  USD: 5, EUR: 72, GBP: 4, JPY: 35, CNY: 37, CHF: 12,
  CAD: 6, AUD: 25, NZD: 43, INR: 14, BRL: 32, KRW: 11,
};
// Devise → code pays 2 lettres (drapeaux), aligné sur ff-calendar.
const CCY_TO_COUNTRY = {
  USD: "US", EUR: "EU", GBP: "GB", JPY: "JP", CNY: "CN", CHF: "CH",
  AUD: "AU", CAD: "CA", NZD: "NZ", INR: "IN", BRL: "BR", KRW: "KR",
};
const IMPACT_RANK = { none: 0, low: 1, medium: 2, high: 3 };
const RANK_TO_IMPACT = { 1: "low", 2: "medium", 3: "high" };

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  "X-Requested-With": "XMLHttpRequest",
  Accept: "*/*",
  Referer: "https://www.investing.com/economic-calendar/",
};

const DAY_MS = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);

// Nettoie un fragment HTML de cellule : retire les balises, entités, espaces.
function strip(html) {
  if (html == null) return null;
  const s = html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return s || null;
}

// "0.3%", "216K", "1,200", "6.0B", "-2.1" → nombre ; null sinon.
function num(v) {
  if (v == null || v === "") return null;
  let s = String(v).trim();
  let mult = 1;
  if (/k$/i.test(s)) mult = 1e3;
  else if (/m$/i.test(s)) mult = 1e6;
  else if (/b$/i.test(s)) mult = 1e9;
  else if (/t$/i.test(s)) mult = 1e12;
  s = s.replace(/[%,]/g, "").replace(/[kmbt]$/i, "");
  const n = Number(s);
  return Number.isFinite(n) ? n * mult : null;
}

const first = (block, re) => {
  const m = block.match(re);
  return m ? m[1] : null;
};

export class InvestingCalendarCollector extends Collector {
  constructor({ ttlMs = CACHE_TTL_MS, pastDays, futureDays } = {}) {
    super("investing-calendar", { axis: "macro" });
    this.ttlMs = ttlMs;
    this.pastDays = pastDays ?? Number(process.env.INVESTING_CAL_PAST_DAYS ?? 2);
    this.futureDays = futureDays ?? Number(process.env.INVESTING_CAL_FUTURE_DAYS ?? 14);
    this.currencies = (process.env.FF_CALENDAR_CURRENCIES || "USD,EUR,GBP,JPY,CNY")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    this.minImpact = (process.env.FF_CALENDAR_MIN_IMPACT || "medium").toLowerCase();
  }

  #body() {
    const now = Date.now();
    const dateFrom = iso(new Date(now - this.pastDays * DAY_MS));
    const dateTo = iso(new Date(now + this.futureDays * DAY_MS));
    const minRank = IMPACT_RANK[this.minImpact] ?? 2;

    const parts = [];
    for (const ccy of this.currencies) {
      const id = CCY_TO_ID[ccy];
      if (id) parts.push(`country%5B%5D=${id}`);
    }
    for (let r = minRank; r <= 3; r++) parts.push(`importance%5B%5D=${r}`);
    parts.push(`timeZone=${TZ_GMT}`, "timeFilter=timeRemain", "currentTab=custom");
    parts.push(`dateFrom=${dateFrom}`, `dateTo=${dateTo}`, "limit_from=0");
    return parts.join("&");
  }

  async #rawHtml() {
    if (CACHE.raw && Date.now() - CACHE.ts < this.ttlMs) return CACHE.raw;
    const json = await this.postForm(URL, this.#body(), { headers: HEADERS, timeout: 20000 });
    const html = json?.data;
    if (typeof html !== "string" || !html.includes("js-event-item")) {
      throw new Error("réponse investing.com inattendue (anti-bot / structure changée ?)");
    }
    CACHE = { ts: Date.now(), raw: html };
    return html;
  }

  // Découpe le HTML par event (entre deux `data-event-datetime`) et parse chacun.
  #parse(html) {
    const events = [];
    const re = /data-event-datetime="([^"]+)"([\s\S]*?)(?=data-event-datetime="|class="theDay"|$)/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const rawDt = m[1]; // "2026/06/30 12:55:00" en UTC (timeZone=55)
      const block = m[2];
      const ms = Date.parse(rawDt.replace(/\//g, "-").replace(" ", "T") + "Z");
      if (!Number.isFinite(ms)) continue;

      const ccy = first(block, /flagCur[\s\S]*?<\/span>\s*([A-Z]{3})/);
      const impRank = Number(first(block, /data-img_key="bull(\d)"/));
      const event = strip(first(block, /class="[^"]*\bevent\b[^"]*"[^>]*>([\s\S]*?)<\/td>/));
      const actual = strip(first(block, /id="eventActual_\d+"[^>]*>([\s\S]*?)<\/td>/));
      const forecast = strip(first(block, /id="eventForecast_\d+"[^>]*>([\s\S]*?)<\/td>/));
      const previous = strip(first(block, /id="eventPrevious_\d+"[^>]*>([\s\S]*?)<\/td>/));

      if (!event) continue;
      const a = num(actual);
      const f = num(forecast);
      events.push({
        datetime: ms,
        date: new Date(ms).toISOString().slice(0, 10),
        country: (ccy && CCY_TO_COUNTRY[ccy]) || ccy || null,
        currency: ccy || null,
        event,
        impact: RANK_TO_IMPACT[impRank] || "none",
        previous: num(previous),
        forecast: f,
        actual: a,
        surprise: a != null && f != null ? Math.round((a - f) * 1e6) / 1e6 : null,
      });
    }
    return events;
  }

  async #fetchInvesting() {
    const html = await this.#rawHtml();
    const minRank = IMPACT_RANK[this.minImpact] ?? 2;
    const events = this.#parse(html)
      .filter((e) => (IMPACT_RANK[e.impact] ?? 0) >= minRank)
      .filter((e) => !this.currencies.length || !e.currency || this.currencies.includes(e.currency))
      .sort((a, b) => a.datetime - b.datetime);

    if (!events.length) throw new Error("investing.com : aucun event parsé");

    return {
      source: "investing.com",
      currencies: this.currencies,
      minImpact: this.minImpact,
      pastDays: this.pastDays,
      futureDays: this.futureDays,
      count: events.length,
      events,
    };
  }

  // Source unique du calendrier : investing.com en primaire, repli FairEconomy
  // SI le scrape échoue (anti-bot, structure changée…). Une seule entrée
  // calendrier par snapshot (pas de doublon). Stale seulement si les DEUX tombent.
  async fetchData() {
    try {
      return await this.#fetchInvesting();
    } catch (err) {
      logger.warn(`[investing-calendar] investing.com KO (${err.message}) → repli FairEconomy`);
      return await new FfCalendarCollector().fetchData();
    }
  }
}
