import { Collector } from "./base.js";
import { FfCalendarCollector } from "./ff-calendar.js";
import { logger } from "../../logs/index.js";

/**
 * Calendrier économique RICHE depuis l'API publique de nasdaq.com
 * (`api.nasdaq.com/api/calendar/economicevents`, celle qui alimente leur page).
 * GRATUIT, sans clé, JSON. Axe : macro.
 *
 * Retenu après le blocage anti-bot d'investing.com (403) : c'est la seule
 * source sans navigateur qui fournit le RÉEL publié (`actual`), en plus du
 * consensus et du précédent. Renvoie la même forme d'event que ff-calendar
 * (drop-in), avec repli AUTOMATIQUE sur FairEconomy.
 *
 * Deux particularités de la source, gérées ici :
 *   - PAS de niveau d'impact : nasdaq liste tout à plat (~50 events/jour, dont
 *     du bruit). On ne garde que les events dont le nom matche une whitelist de
 *     rendez-vous macro qui bougent les marchés (IMPORTANT_EVENT_PATTERNS) ;
 *     ils sortent tous en impact "high".
 *   - `actual` est parfois pré-rempli pour des dates FUTURES (recyclage côté
 *     nasdaq) : on ne fait confiance au réel que pour un event déjà PASSÉ.
 *   - Pas d'endpoint plage : un appel par jour sur la fenêtre, en parallèle.
 */
const CALENDAR_URL = "https://api.nasdaq.com/api/calendar/economicevents";
const FETCH_TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min : la fenêtre bouge lentement, 1 rafraîchissement/h suffit
const DAY_MS = 86400000;
const DEFAULT_PAST_DAYS = 2; // jours passés (pour récupérer les réels récemment publiés)
const DEFAULT_FUTURE_DAYS = 14; // jours à venir (catalyseurs)
const SURPRISE_ROUNDING = 1e6; // arrondi de la surprise à 6 décimales

let CACHE = { ts: 0, events: null }; // cache mémoire des events assemblés

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Origin: "https://www.nasdaq.com",
  Referer: "https://www.nasdaq.com/market-activity/economic-calendar",
};

// Nom de pays nasdaq → { devise, code 2 lettres }. Les membres de la zone euro
// sont mappés sur EUR pour rester aligné sur le filtre par devise existant.
const COUNTRY_TO_CCY = {
  "United States": { ccy: "USD", code: "US" },
  "Euro Zone": { ccy: "EUR", code: "EU" },
  "European Union": { ccy: "EUR", code: "EU" },
  Germany: { ccy: "EUR", code: "EU" },
  France: { ccy: "EUR", code: "EU" },
  Italy: { ccy: "EUR", code: "EU" },
  Spain: { ccy: "EUR", code: "EU" },
  Netherlands: { ccy: "EUR", code: "EU" },
  "United Kingdom": { ccy: "GBP", code: "GB" },
  Japan: { ccy: "JPY", code: "JP" },
  China: { ccy: "CNY", code: "CN" },
  Switzerland: { ccy: "CHF", code: "CH" },
  Canada: { ccy: "CAD", code: "CA" },
  Australia: { ccy: "AUD", code: "AU" },
  "New Zealand": { ccy: "NZD", code: "NZ" },
};

// Whitelist des rendez-vous macro qui meuvent les marchés (nasdaq n'a pas de
// niveau d'impact). Un event dont le nom matche l'une de ces regex est retenu
// en impact "high" ; tout le reste (immatriculations auto, Redbook, indices
// de prix immobiliers régionaux…) est écarté.
const IMPORTANT_EVENT_PATTERNS = [
  /\bCPI\b|consumer price|inflation rate|core inflation/i,
  /\bPCE\b|personal consumption/i,
  /\bPPI\b|producer price/i,
  /non-?farm|nonfarm payroll|\bNFP\b/i,
  /unemployment rate/i,
  /jobless claims|initial claims/i,
  /average hourly earnings/i,
  /\bGDP\b|gross domestic product/i,
  /retail sales/i,
  /\bISM\b|manufacturing pmi|services pmi|composite pmi|\bpmi\b/i,
  /durable goods/i,
  /industrial production/i,
  /\bFOMC\b|federal funds|fed interest rate|interest rate decision|rate statement|monetary policy|press conference/i,
  /\bECB\b|\bBoJ\b|\bBoE\b|\bSNB\b|\bRBA\b|\bBoC\b/i,
  /consumer confidence|consumer sentiment|michigan/i,
  /trade balance/i,
  /\bppi\b|\bcpi\b/i,
  /powell|lagarde|speech|speaks/i,
];

/**
 * Date ISO (AAAA-MM-JJ) d'un objet Date.
 * @param {Date} date Date à formater.
 * @returns {string} Date au format AAAA-MM-JJ.
 */
function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Convertit une valeur de calendrier nasdaq en nombre : nettoie les entités
 * HTML (`&nbsp;`), applique les multiplicateurs K/M/B/T et retire `%`/`,`.
 * @param {*} value Valeur brute ("-98.00B", "16.50K", "0.3%", "&nbsp;"…).
 * @returns {number|null} Nombre, ou null si vide/non numérique.
 */
function toCalendarNumber(value) {
  if (value == null) return null;
  let text = String(value).replace(/&nbsp;|&#160;/g, " ").trim();
  if (!text) return null;

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
 * Timestamp UTC d'un event à partir de sa date et de son heure nasdaq.
 * L'heure est le champ `gmt` ("08:30") ; toute valeur non horaire ("24H",
 * "All Day", vide) place l'event au début du jour.
 * @param {string} dateStr Jour de l'event (AAAA-MM-JJ).
 * @param {string} gmt Heure nasdaq (champ `gmt`).
 * @returns {number} Epoch ms UTC.
 */
function eventDatetime(dateStr, gmt) {
  const timeMatch = String(gmt || "").match(/^(\d{2}):(\d{2})$/);
  const time = timeMatch ? `${timeMatch[1]}:${timeMatch[2]}:00` : "00:00:00";
  return Date.parse(`${dateStr}T${time}Z`);
}

/**
 * Teste si un nom d'event fait partie des rendez-vous macro à fort impact.
 * @param {string} eventName Nom de l'event nasdaq.
 * @returns {boolean} true si l'event est retenu.
 */
function isImportant(eventName) {
  return IMPORTANT_EVENT_PATTERNS.some((pattern) => pattern.test(eventName));
}

/**
 *
 */
export class NasdaqCalendarCollector extends Collector {
  /**
   * Initialise le collecteur et sa fenêtre.
   * @param {{ ttlMs?: number, pastDays?: number, futureDays?: number }}
   *   [options] TTL du cache et fenêtre (jours passés → à venir),
   *   surchargeables par CAL_PAST_DAYS / CAL_FUTURE_DAYS.
   */
  constructor({ ttlMs = CACHE_TTL_MS, pastDays, futureDays } = {}) {
    super("nasdaq-calendar", { axis: "macro" });
    this.ttlMs = ttlMs;
    this.pastDays = pastDays ?? Number(process.env.CAL_PAST_DAYS ?? DEFAULT_PAST_DAYS);
    this.futureDays = futureDays ?? Number(process.env.CAL_FUTURE_DAYS ?? DEFAULT_FUTURE_DAYS);
    this.currencies = (process.env.FF_CALENDAR_CURRENCIES || "USD,EUR,GBP,JPY,CNY")
      .split(",")
      .map((currency) => currency.trim().toUpperCase())
      .filter(Boolean);
  }

  /**
   * Jours (AAAA-MM-JJ) couverts par la fenêtre, du plus ancien au plus récent.
   * @returns {Array<string>} Dates à interroger.
   */
  #windowDays() {
    const days = [];
    const now = Date.now();
    for (let offset = -this.pastDays; offset <= this.futureDays; offset++) {
      days.push(isoDay(new Date(now + offset * DAY_MS)));
    }
    return days;
  }

  /**
   * Events bruts d'un jour depuis l'API nasdaq (tableau vide si aucun).
   * @param {string} dateStr Jour interrogé (AAAA-MM-JJ).
   * @returns {Promise<Array<object>>} Lignes brutes nasdaq.
   */
  async #fetchDay(dateStr) {
    const json = await this.getJson(`${CALENDAR_URL}?date=${dateStr}`, {
      headers: BROWSER_HEADERS,
      timeout: FETCH_TIMEOUT_MS,
    });
    const rows = json?.data?.rows;
    return Array.isArray(rows) ? rows : [];
  }

  /**
   * Normalise une ligne nasdaq vers la forme commune des calendriers, ou null
   * si l'event est écarté (hors whitelist ou hors devises suivies). Le `actual`
   * n'est conservé que pour un event déjà passé (nasdaq pré-remplit le futur).
   * @param {object} row Ligne brute nasdaq.
   * @param {string} dateStr Jour de l'event (AAAA-MM-JJ).
   * @param {number} now Epoch ms courant (référence passé/futur).
   * @returns {object|null} Event normalisé, ou null.
   */
  #normalize(row, dateStr, now) {
    const eventName = String(row.eventName || "").trim();
    if (!eventName || !isImportant(eventName)) return null;

    const mapped = COUNTRY_TO_CCY[row.country] ?? null;
    const currency = mapped?.ccy ?? null;
    // Filtre par devise : un pays non mappé (currency null) est écarté quand une
    // liste de devises est fixée — sinon le Brésil/l'Inde… passeraient sans devise.
    if (this.currencies.length && (!currency || !this.currencies.includes(currency))) return null;

    const datetime = eventDatetime(dateStr, row.gmt);
    if (!Number.isFinite(datetime)) return null;

    const isPast = datetime <= now;
    const actual = isPast ? toCalendarNumber(row.actual) : null;
    const forecast = toCalendarNumber(row.consensus);
    const hasSurprise = actual != null && forecast != null;

    return {
      datetime,
      date: dateStr,
      country: mapped?.code ?? row.country ?? null,
      currency,
      event: eventName,
      impact: "high", // whitelist = rendez-vous à fort impact (nasdaq n'a pas de niveau)
      previous: toCalendarNumber(row.previous),
      forecast,
      actual,
      surprise: hasSurprise ? Math.round((actual - forecast) * SURPRISE_ROUNDING) / SURPRISE_ROUNDING : null,
    };
  }

  /**
   * Assemble le calendrier nasdaq sur la fenêtre (un appel par jour, en
   * parallèle et tolérant : un jour en échec est ignoré, pas fatal), filtré et
   * trié chronologiquement. Servi du cache tant que le TTL court.
   * @returns {Promise<{source: string, currencies: string[], minImpact: string,
   *   pastDays: number, futureDays: number, count: number,
   *   events: Array<object>}>} Calendrier normalisé.
   * @throws {Error} Si aucun event n'a pu être récupéré sur toute la fenêtre.
   */
  async #fetchNasdaq() {
    if (CACHE.events && Date.now() - CACHE.ts < this.ttlMs) return this.#wrap(CACHE.events);

    const now = Date.now();
    const days = this.#windowDays();
    const results = await Promise.allSettled(days.map((dateStr) => this.#fetchDay(dateStr)));

    const events = [];
    let anyDayOk = false;
    results.forEach((result, index) => {
      if (result.status !== "fulfilled") return;
      anyDayOk = true;
      for (const row of result.value) {
        const event = this.#normalize(row, days[index], now);
        if (event) events.push(event);
      }
    });
    if (!anyDayOk) throw new Error("nasdaq : aucun jour récupéré (API injoignable ?)");

    events.sort((a, b) => a.datetime - b.datetime);
    CACHE = { ts: Date.now(), events };
    return this.#wrap(events);
  }

  /**
   * Emballe une liste d'events dans la forme de sortie du collecteur.
   * @param {Array<object>} events Events normalisés.
   * @returns {{source: string, currencies: string[], minImpact: string,
   *   pastDays: number, futureDays: number, count: number,
   *   events: Array<object>}} Calendrier normalisé.
   */
  #wrap(events) {
    return {
      source: "nasdaq",
      currencies: this.currencies,
      minImpact: "high",
      pastDays: this.pastDays,
      futureDays: this.futureDays,
      count: events.length,
      events,
    };
  }

  /**
   * Source unique du calendrier : nasdaq en primaire, repli FairEconomy si
   * nasdaq échoue — stale seulement si les DEUX tombent.
   * @returns {Promise<object>} Calendrier normalisé (forme identique quelle
   *   que soit la source).
   */
  async fetchData() {
    try {
      return await this.#fetchNasdaq();
    } catch (err) {
      logger.warn(`[nasdaq-calendar] nasdaq KO (${err.message}) → repli FairEconomy`);
      return await new FfCalendarCollector().fetchData();
    }
  }
}
