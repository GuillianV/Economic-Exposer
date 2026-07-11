import { Collector } from "./base.js";

/**
 * Calendrier économique via le flux hebdomadaire FairEconomy/ForexFactory
 * (le feed standard des EAs MetaTrader). GRATUIT, sans clé. Axe : macro.
 *
 * Fournit le modèle type investing.com : multi-pays, HEURE, impact,
 * PRÉCÉDENT / PRÉVISION (consensus). Le champ `actual` se remplit au fil de
 * la semaine, dès qu'un event est publié.
 *
 * Limites : ~1 semaine d'horizon (seul `thisweek` existe), et le flux
 * rate-limite (429) si on le martèle → cache mémoire (TTL).
 */
const FEED_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const FEED_TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min : un appel suffit largement
let CACHE = { ts: 0, raw: null }; // cache mémoire du flux brut

// FairEconomy met le code DEVISE dans `country` : on mappe vers un code pays
// (pour les drapeaux) en gardant la devise à part.
const CCY_TO_COUNTRY = {
  USD: "US", EUR: "EU", GBP: "GB", JPY: "JP", CNY: "CN", CHF: "CH",
  AUD: "AU", CAD: "CA", NZD: "NZ", INR: "IN", BRL: "BR", KRW: "KR",
};
const IMPACT_RANK = { none: 0, holiday: 0, low: 1, medium: 2, high: 3 };

/**
 * Normalise l'impact FairEconomy en rang standard.
 * @param {*} value Impact brut ("High Impact Expected"…).
 * @returns {string} "high" | "medium" | "low" | "holiday" | "none".
 */
function normImpact(value) {
  const impact = String(value ?? "").toLowerCase();
  if (impact.includes("high")) return "high";
  if (impact.includes("med")) return "medium";
  if (impact.includes("low")) return "low";
  if (impact.includes("holiday")) return "holiday";
  return "none";
}

/**
 * Convertit une valeur de calendrier en nombre : "0.3%", "216K", "1,200",
 * "6.0B" → nombre (multiplicateurs K/M/B appliqués) ; null sinon.
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

  text = text.replace(/[%,]/g, "").replace(/[kmb]$/i, "");
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed * multiplier : null;
}

export class FfCalendarCollector extends Collector {
  /**
   * @param {{ ttlMs?: number }} [options] Durée de validité du cache du flux.
   */
  constructor({ ttlMs = CACHE_TTL_MS } = {}) {
    super("ff-calendar", { axis: "macro" });
    this.ttlMs = ttlMs;
    this.currencies = (process.env.FF_CALENDAR_CURRENCIES || "USD,EUR,GBP,JPY,CNY")
      .split(",")
      .map((currency) => currency.trim().toUpperCase())
      .filter(Boolean);
    this.minImpact = (process.env.FF_CALENDAR_MIN_IMPACT || "medium").toLowerCase();
  }

  /**
   * Flux brut FairEconomy, servi du cache tant que le TTL court.
   * @returns {Promise<Array<object>>} Events bruts du flux.
   * @throws {Error} Si la réponse n'est pas le tableau attendu (rate-limit ?).
   */
  async #rawFeed() {
    if (CACHE.raw && Date.now() - CACHE.ts < this.ttlMs) return CACHE.raw;

    const json = await this.getJson(FEED_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (crypto-fundamental-radar)" },
      timeout: FEED_TIMEOUT_MS,
    });
    if (!Array.isArray(json)) throw new Error("flux FairEconomy inattendu (non-JSON / rate-limit ?)");

    CACHE = { ts: Date.now(), raw: json };
    return json;
  }

  /**
   * Normalise un event brut vers la forme commune des calendriers.
   * @param {object} raw Event brut FairEconomy.
   * @returns {{datetime: number|null, date: string|null, country: string|null,
   *   currency: string|null, event: string|null, impact: string,
   *   previous: number|null, forecast: number|null, actual: number|null,
   *   surprise: number|null}} Event normalisé.
   */
  #normalize(raw) {
    const rawDate = raw.date || null; // "2026-07-14T08:30:00-04:00"
    const datetimeMs = rawDate ? Date.parse(rawDate) : NaN;
    const currency = (raw.country || "").toUpperCase();
    const actual = toCalendarNumber(raw.actual);
    const forecast = toCalendarNumber(raw.forecast);

    return {
      datetime: Number.isFinite(datetimeMs) ? datetimeMs : null,
      date: Number.isFinite(datetimeMs) ? new Date(datetimeMs).toISOString().slice(0, 10) : null,
      country: CCY_TO_COUNTRY[currency] || currency || null,
      currency: currency || null,
      event: raw.title || null,
      impact: normImpact(raw.impact),
      previous: toCalendarNumber(raw.previous),
      forecast,
      actual,
      surprise: actual != null && forecast != null ? actual - forecast : null,
    };
  }

  /**
   * Events de la semaine, filtrés (impact minimal, devises suivies) et triés
   * chronologiquement.
   * @returns {Promise<{source: string, currencies: string[], minImpact: string,
   *   count: number, events: Array<object>}>} Calendrier normalisé.
   */
  async fetchData() {
    const raw = await this.#rawFeed();
    const minRank = IMPACT_RANK[this.minImpact] ?? 2;

    const events = raw
      .map((entry) => this.#normalize(entry))
      .filter((event) => event.event && event.datetime)
      .filter((event) => (IMPACT_RANK[event.impact] ?? 0) >= minRank)
      .filter((event) => !this.currencies.length || this.currencies.includes(event.currency))
      .sort((a, b) => a.datetime - b.datetime);

    return {
      source: "faireconomy",
      currencies: this.currencies,
      minImpact: this.minImpact,
      count: events.length,
      events,
    };
  }
}
