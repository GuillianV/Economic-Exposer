import { Collector } from "./base.js";

/**
 * Calendrier économique RICHE via le flux hebdomadaire FairEconomy/ForexFactory
 * (le feed standard des EAs MetaTrader). GRATUIT, sans clé.
 *
 * Fournit le modèle type investing.com : multi-pays, HEURE, impact, PRÉCÉDENT /
 * PRÉVISION (consensus). Le champ `actual` (réel) se remplit au fil de la
 * semaine, dès qu'un event est publié.
 *
 * Limites : ~1 semaine d'horizon (seul `thisweek` existe), et le flux
 * rate-limite (429) si on le martèle → cache mémoire (TTL) + dégradation stale.
 * Axe : macro.
 */
const FEED_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min : un appel suffit largement
let CACHE = { ts: 0, raw: null };

// FairEconomy met le code DEVISE dans `country`. On mappe vers un code pays
// (pour les drapeaux) en gardant la devise à part.
const CCY_TO_COUNTRY = {
  USD: "US", EUR: "EU", GBP: "GB", JPY: "JP", CNY: "CN", CHF: "CH",
  AUD: "AU", CAD: "CA", NZD: "NZ", INR: "IN", BRL: "BR", KRW: "KR",
};
const IMPACT_RANK = { none: 0, holiday: 0, low: 1, medium: 2, high: 3 };

function normImpact(v) {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("high")) return "high";
  if (s.includes("med")) return "medium";
  if (s.includes("low")) return "low";
  if (s.includes("holiday")) return "holiday";
  return "none";
}

// "0.3%", "216K", "1,200", "6.0B" → nombre ; null sinon.
function num(v) {
  if (v == null || v === "") return null;
  let s = String(v).trim();
  let mult = 1;
  if (/k$/i.test(s)) mult = 1e3;
  else if (/m$/i.test(s)) mult = 1e6;
  else if (/b$/i.test(s)) mult = 1e9;
  s = s.replace(/[%,]/g, "").replace(/[kmb]$/i, "");
  const n = Number(s);
  return Number.isFinite(n) ? n * mult : null;
}

export class FfCalendarCollector extends Collector {
  constructor({ ttlMs = CACHE_TTL_MS } = {}) {
    super("ff-calendar", { axis: "macro" });
    this.ttlMs = ttlMs;
    this.currencies = (process.env.FF_CALENDAR_CURRENCIES || "USD,EUR,GBP,JPY,CNY")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    this.minImpact = (process.env.FF_CALENDAR_MIN_IMPACT || "medium").toLowerCase();
  }

  async #rawFeed() {
    if (CACHE.raw && Date.now() - CACHE.ts < this.ttlMs) return CACHE.raw;
    const json = await this.getJson(FEED_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (crypto-fundamental-radar)" },
      timeout: 15000,
    });
    if (!Array.isArray(json)) throw new Error("flux FairEconomy inattendu (non-JSON / rate-limit ?)");
    CACHE = { ts: Date.now(), raw: json };
    return json;
  }

  #normalize(r) {
    const dt = r.date || null; // "2026-07-14T08:30:00-04:00"
    const ms = dt ? Date.parse(dt) : NaN;
    const ccy = (r.country || "").toUpperCase();
    const actual = num(r.actual);
    const forecast = num(r.forecast);
    return {
      datetime: Number.isFinite(ms) ? ms : null,
      date: Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null,
      country: CCY_TO_COUNTRY[ccy] || ccy || null,
      currency: ccy || null,
      event: r.title || null,
      impact: normImpact(r.impact),
      previous: num(r.previous),
      forecast,
      actual,
      surprise: actual != null && forecast != null ? actual - forecast : null,
    };
  }

  async fetchData() {
    const raw = await this.#rawFeed();
    const minRank = IMPACT_RANK[this.minImpact] ?? 2;
    const events = raw
      .map((r) => this.#normalize(r))
      .filter((e) => e.event && e.datetime)
      .filter((e) => (IMPACT_RANK[e.impact] ?? 0) >= minRank)
      .filter((e) => !this.currencies.length || this.currencies.includes(e.currency))
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
