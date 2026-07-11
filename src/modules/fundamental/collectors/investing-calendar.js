import { Collector } from "./base.js";
import { FfCalendarCollector } from "./ff-calendar.js";
import { logger } from "../../logs/index.js";

/**
 * Calendrier économique RICHE scrapé depuis investing.com (endpoint AJAX
 * `getCalendarFilteredData`, le même que celui qui alimente leur page).
 * GRATUIT, sans clé. Axe : macro.
 *
 * La source la plus complète : multi-pays, HEURE, impact, PRÉCÉDENT /
 * PRÉVISION et surtout le RÉEL (que FairEconomy ne fournit pas de façon
 * fiable et que FRED ne donne qu'en différé sur les US). Renvoie la même
 * forme d'event que ff-calendar (drop-in).
 *
 * Limites : scraping HTML (structure susceptible de changer) + protection
 * anti-bot → entêtes navigateur, throttle par hôte (throttle.js) et cache
 * mémoire. Si le scrape échoue, repli AUTOMATIQUE sur FairEconomy — une
 * seule entrée calendrier par snapshot, stale seulement si les DEUX tombent.
 */
const CALENDAR_URL = "https://www.investing.com/economic-calendar/Service/getCalendarFilteredData";
const SCRAPE_TIMEOUT_MS = 20000;
const TZ_GMT = 55; // timeZone investing.com = GMT/UTC → les heures sont en UTC
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min : 1 appel/h suffit en prod
let CACHE = { ts: 0, raw: null }; // cache mémoire du HTML brut

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

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  "X-Requested-With": "XMLHttpRequest",
  Accept: "*/*",
  Referer: "https://www.investing.com/economic-calendar/",
};

const DAY_MS = 86400000;

/**
 * Date ISO (AAAA-MM-JJ) d'un objet Date.
 * @param {Date} date Date à formater.
 * @returns {string} Date au format AAAA-MM-JJ.
 */
function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Nettoie un fragment HTML de cellule : balises, entités, espaces.
 * @param {string|null} html Fragment HTML.
 * @returns {string|null} Texte nettoyé, ou null si vide.
 */
function stripHtml(html) {
  if (html == null) return null;
  const text = html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

/**
 * Convertit une valeur de calendrier en nombre : "0.3%", "216K", "1,200",
 * "6.0B", "-2.1" → nombre (multiplicateurs K/M/B/T appliqués) ; null sinon.
 * @param {*} value Valeur brute.
 * @returns {number|null} Nombre ou null.
 */
function toCalendarNumber(value) {
  if (value == null || value === "") return null;

  let text = String(value).trim();
  let multiplier = 1;
  if (/k$/i.test(text)) multiplier = 1e3;
  else if (/m$/i.test(text)) multiplier = 1e6;
  else if (/b$/i.test(text)) multiplier = 1e9;
  else if (/t$/i.test(text)) multiplier = 1e12;

  text = text.replace(/[%,]/g, "").replace(/[kmbt]$/i, "");
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed * multiplier : null;
}

/**
 * Premier groupe capturé d'une regex dans un bloc, ou null.
 * @param {string} block Texte à fouiller.
 * @param {RegExp} regex Regex avec un groupe capturant.
 * @returns {string|null} Capture ou null.
 */
function firstMatch(block, regex) {
  const match = block.match(regex);
  return match ? match[1] : null;
}

/**
 *
 */
export class InvestingCalendarCollector extends Collector {
  /**
   * Initialise le collecteur et ses options.
   *
   * @param {{ ttlMs?: number, pastDays?: number, futureDays?: number }}
   *   [options] TTL du cache et fenêtre (résultats publiés → à venir),
   *   surchargables par INVESTING_CAL_PAST_DAYS / INVESTING_CAL_FUTURE_DAYS.
   */
  constructor({ ttlMs = CACHE_TTL_MS, pastDays, futureDays } = {}) {
    super("investing-calendar", { axis: "macro" });
    this.ttlMs = ttlMs;
    this.pastDays = pastDays ?? Number(process.env.INVESTING_CAL_PAST_DAYS ?? 2);
    this.futureDays = futureDays ?? Number(process.env.INVESTING_CAL_FUTURE_DAYS ?? 14);
    this.currencies = (process.env.FF_CALENDAR_CURRENCIES || "USD,EUR,GBP,JPY,CNY")
      .split(",")
      .map((currency) => currency.trim().toUpperCase())
      .filter(Boolean);
    this.minImpact = (process.env.FF_CALENDAR_MIN_IMPACT || "medium").toLowerCase();
  }

  /**
   * Corps form-encoded de la requête AJAX (pays, impacts, fenêtre de dates).
   * @returns {string} Corps `x-www-form-urlencoded`.
   */
  #body() {
    const now = Date.now();
    const dateFrom = isoDay(new Date(now - this.pastDays * DAY_MS));
    const dateTo = isoDay(new Date(now + this.futureDays * DAY_MS));
    const minRank = IMPACT_RANK[this.minImpact] ?? 2;

    const parts = [];
    for (const currency of this.currencies) {
      const countryId = CCY_TO_ID[currency];
      if (countryId) parts.push(`country%5B%5D=${countryId}`);
    }
    for (let rank = minRank; rank <= 3; rank++) parts.push(`importance%5B%5D=${rank}`);
    parts.push(`timeZone=${TZ_GMT}`, "timeFilter=timeRemain", "currentTab=custom");
    parts.push(`dateFrom=${dateFrom}`, `dateTo=${dateTo}`, "limit_from=0");
    return parts.join("&");
  }

  /**
   * HTML brut du calendrier, servi du cache tant que le TTL court.
   * @returns {Promise<string>} HTML des lignes d'events.
   * @throws {Error} Réponse inattendue (anti-bot / structure changée).
   */
  async #rawHtml() {
    if (CACHE.raw && Date.now() - CACHE.ts < this.ttlMs) return CACHE.raw;

    const json = await this.postForm(CALENDAR_URL, this.#body(), {
      headers: BROWSER_HEADERS,
      timeout: SCRAPE_TIMEOUT_MS,
    });
    const html = json?.data;
    if (typeof html !== "string" || !html.includes("js-event-item")) {
      throw new Error("réponse investing.com inattendue (anti-bot / structure changée ?)");
    }

    CACHE = { ts: Date.now(), raw: html };
    return html;
  }

  /**
   * Découpe le HTML par event (entre deux `data-event-datetime`) et parse
   * chaque bloc vers la forme commune des calendriers.
   * @param {string} html HTML brut du calendrier.
   * @returns {Array<object>} Events normalisés (voir ff-calendar).
   */
  #parse(html) {
    const events = [];
    const eventBlockRegex = /data-event-datetime="([^"]+)"([\s\S]*?)(?=data-event-datetime="|class="theDay"|$)/g;

    let match;
    while ((match = eventBlockRegex.exec(html)) !== null) {
      const rawDatetime = match[1]; // "2026/06/30 12:55:00" en UTC (timeZone=55)
      const block = match[2];
      const datetimeMs = Date.parse(rawDatetime.replace(/\//g, "-").replace(" ", "T") + "Z");
      if (!Number.isFinite(datetimeMs)) continue;

      const currency = firstMatch(block, /flagCur[\s\S]*?<\/span>\s*([A-Z]{3})/);
      const impactRank = Number(firstMatch(block, /data-img_key="bull(\d)"/));
      const eventName = stripHtml(firstMatch(block, /class="[^"]*\bevent\b[^"]*"[^>]*>([\s\S]*?)<\/td>/));
      const actualRaw = stripHtml(firstMatch(block, /id="eventActual_\d+"[^>]*>([\s\S]*?)<\/td>/));
      const forecastRaw = stripHtml(firstMatch(block, /id="eventForecast_\d+"[^>]*>([\s\S]*?)<\/td>/));
      const previousRaw = stripHtml(firstMatch(block, /id="eventPrevious_\d+"[^>]*>([\s\S]*?)<\/td>/));
      if (!eventName) continue;

      const actual = toCalendarNumber(actualRaw);
      const forecast = toCalendarNumber(forecastRaw);
      events.push({
        datetime: datetimeMs,
        date: new Date(datetimeMs).toISOString().slice(0, 10),
        country: (currency && CCY_TO_COUNTRY[currency]) || currency || null,
        currency: currency || null,
        event: eventName,
        impact: RANK_TO_IMPACT[impactRank] || "none",
        previous: toCalendarNumber(previousRaw),
        forecast,
        actual,
        surprise: actual != null && forecast != null ? Math.round((actual - forecast) * 1e6) / 1e6 : null,
      });
    }
    return events;
  }

  /**
   * Calendrier investing.com filtré (impact minimal, devises) et trié.
   * @returns {Promise<{source: string, currencies: string[], minImpact: string,
   *   pastDays: number, futureDays: number, count: number,
   *   events: Array<object>}>} Calendrier normalisé.
   * @throws {Error} Si aucun event n'a pu être parsé.
   */
  async #fetchInvesting() {
    const html = await this.#rawHtml();
    const minRank = IMPACT_RANK[this.minImpact] ?? 2;

    const events = this.#parse(html)
      .filter((event) => (IMPACT_RANK[event.impact] ?? 0) >= minRank)
      .filter((event) => !this.currencies.length || !event.currency || this.currencies.includes(event.currency))
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

  /**
   * Source unique du calendrier : investing.com en primaire, repli
   * FairEconomy si le scrape échoue — stale seulement si les DEUX tombent.
   * @returns {Promise<object>} Calendrier normalisé (forme identique
   *   quelle que soit la source).
   */
  async fetchData() {
    try {
      return await this.#fetchInvesting();
    } catch (err) {
      logger.warn(`[investing-calendar] investing.com KO (${err.message}) → repli FairEconomy`);
      return await new FfCalendarCollector().fetchData();
    }
  }
}
