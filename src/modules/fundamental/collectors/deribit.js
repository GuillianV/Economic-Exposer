import { Collector } from "./base.js";

/**
 * Deribit — sentiment & positionnement options crypto (BTC + ETH). Sans clé,
 * API publique gratuite. Axe : sentiment.
 *
 * - DVOL : indice de volatilité implicite ("VIX crypto"). Hausse = peur.
 * - Put/Call ratio (open interest) : positionnement options. Hausse = couverture/peur.
 * - Skew (risk reversal, proxy moneyness ±10 %) : IV(put OTM) − IV(call OTM)
 *   sur l'échéance ~30 j. Positif = puts chers = peur du crash (souvent près
 *   d'un creux, lecture contrarian) ; négatif = calls chers = euphorie.
 *
 * ETH donne un signal indépendant : une divergence de skew BTC vs ETH (peur
 * concentrée sur l'un) est en soi informative.
 */
const HOUR_MS = 3600000;
const DAY_MS = 86400000;

const DVOL_LOOKBACK_MS = 6 * HOUR_MS; // fenêtre de récupération du DVOL
const SKEW_TARGET_DAYS = 30; // échéance visée pour le skew
const SKEW_MIN_DAYS = 3; // échéances plus proches ignorées (bruit d'expiration)
const MONEYNESS_PUT = 0.9; // strike du put ≈ spot −10 %
const MONEYNESS_CALL = 1.1; // strike du call ≈ spot +10 %
const OPTIONS_TIMEOUT_MS = 15000;

const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

/**
 * Arrondit à 2 décimales, null si la valeur n'est pas un nombre fini.
 * @param {number|null|undefined} value Valeur à arrondir.
 * @returns {number|null} Valeur arrondie ou null.
 */
function round2(value) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

/**
 * Décompose un nom d'instrument Deribit ("BTC-31JUL26-81000-C").
 * @param {string} name Nom d'instrument.
 * @returns {{expiryMs: number, strike: number, type: string}|null}
 *   Échéance (ms epoch, expiration Deribit à 08:00 UTC), strike et type
 *   ("C" call | "P" put), ou null si le nom est inattendu.
 */
function parseInstrument(name) {
  const parts = name.split("-");
  if (parts.length < 4) return null;

  const dateMatch = parts[1].match(/^(\d{1,2})([A-Z]{3})(\d{2})$/);
  if (!dateMatch || MONTHS[dateMatch[2]] == null) return null;

  const expiryMs = Date.UTC(2000 + Number(dateMatch[3]), MONTHS[dateMatch[2]], Number(dateMatch[1]), 8, 0, 0);
  const strike = Number(parts[2]);
  const type = parts[3];
  return Number.isFinite(strike) ? { expiryMs, strike, type } : null;
}

export class DeribitCollector extends Collector {
  constructor() {
    super("deribit", { axis: "sentiment" });
  }

  /**
   * Dernier point du DVOL (indice de volatilité implicite) d'une devise.
   * @param {string} currency "BTC" ou "ETH".
   * @returns {Promise<{dvol: number, ts: number}|null>} Dernière clôture
   *   horaire du DVOL, ou null si la série est vide.
   */
  async #dvol(currency) {
    const now = Date.now();
    const start = now - DVOL_LOOKBACK_MS;
    const url =
      `https://www.deribit.com/api/v2/public/get_volatility_index_data` +
      `?currency=${currency}&start_timestamp=${start}&end_timestamp=${now}&resolution=3600`;
    const json = await this.getJson(url);

    const candles = json?.result?.data || []; // barres [ts, open, high, low, close]
    if (!candles.length) return null;
    const lastCandle = candles[candles.length - 1];
    return { dvol: lastCandle[4], ts: lastCandle[0] };
  }

  /**
   * Ratios put/call (open interest et volume) + skew sur l'échéance ~30 j.
   * @param {string} currency "BTC" ou "ETH".
   * @returns {Promise<{putCallOI: number|null, putCallVol: number|null,
   *   skew: number|null, expiryDays: number|null}|null>} Positionnement
   *   options, ou null si la chaîne d'options est vide.
   */
  async #options(currency) {
    const url = `https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${currency}&kind=option`;
    const json = await this.getJson(url, { timeout: OPTIONS_TIMEOUT_MS });
    const rows = json?.result || [];
    if (!rows.length) return null;

    const underlying = rows.find((row) => row.underlying_price)?.underlying_price ?? null;
    let openInterestPuts = 0;
    let openInterestCalls = 0;
    let volumePuts = 0;
    let volumeCalls = 0;
    const chainsByExpiry = new Map(); // expiryMs -> [{ expiryMs, strike, type, iv }]

    for (const row of rows) {
      const instrument = parseInstrument(row.instrument_name);
      if (!instrument) continue;

      const openInterest = row.open_interest || 0;
      const volume = row.volume || 0;
      if (instrument.type === "P") {
        openInterestPuts += openInterest;
        volumePuts += volume;
      } else {
        openInterestCalls += openInterest;
        volumeCalls += volume;
      }

      if (!chainsByExpiry.has(instrument.expiryMs)) chainsByExpiry.set(instrument.expiryMs, []);
      chainsByExpiry.get(instrument.expiryMs).push({ ...instrument, iv: row.mark_iv });
    }

    const { skew, expiryDays } = this.#skewNear30d(chainsByExpiry, underlying);

    return {
      putCallOI: openInterestCalls > 0 ? round2(openInterestPuts / openInterestCalls) : null,
      putCallVol: volumeCalls > 0 ? round2(volumePuts / volumeCalls) : null,
      skew,
      expiryDays,
    };
  }

  /**
   * Skew (IV put −10 % − IV call +10 %) sur l'échéance la plus proche de 30 j,
   * en ignorant les échéances < SKEW_MIN_DAYS (bruit d'expiration imminente).
   * @param {Map<number, Array<object>>} chainsByExpiry Chaînes d'options par échéance.
   * @param {number|null} underlying Prix spot du sous-jacent.
   * @returns {{skew: number|null, expiryDays: number|null}} Skew et distance
   *   à l'échéance retenue (en jours), null si introuvable.
   */
  #skewNear30d(chainsByExpiry, underlying) {
    const now = Date.now();
    const targetTs = now + SKEW_TARGET_DAYS * DAY_MS;
    const minTs = now + SKEW_MIN_DAYS * DAY_MS;

    let bestExpiry = null;
    let bestDistance = Infinity;
    for (const expiryMs of chainsByExpiry.keys()) {
      if (expiryMs <= minTs) continue;
      const distance = Math.abs(expiryMs - targetTs);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestExpiry = expiryMs;
      }
    }
    if (bestExpiry == null || !underlying) return { skew: null, expiryDays: null };

    const chain = chainsByExpiry.get(bestExpiry);
    const put = this.#nearestStrike(chain, "P", underlying * MONEYNESS_PUT);
    const call = this.#nearestStrike(chain, "C", underlying * MONEYNESS_CALL);

    const skew = put && call ? round2(put.iv - call.iv) : null;
    const expiryDays = Math.round((bestExpiry - now) / DAY_MS);
    return { skew, expiryDays };
  }

  /**
   * Option du type demandé dont le strike est le plus proche de la cible,
   * parmi celles qui ont une IV exploitable.
   * @param {Array<{type: string, strike: number, iv: number}>} chain Chaîne d'une échéance.
   * @param {string} type "P" ou "C".
   * @param {number} targetStrike Strike visé.
   * @returns {object|null} Option la plus proche, ou null.
   */
  #nearestStrike(chain, type, targetStrike) {
    let best = null;
    let bestDistance = Infinity;
    for (const option of chain) {
      if (option.type !== type || !(option.iv > 0)) continue;
      const distance = Math.abs(option.strike - targetStrike);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = option;
      }
    }
    return best;
  }

  /**
   * Assemble DVOL + options d'une devise, tolérant à l'échec de l'un des deux.
   * @param {string} currency "BTC" ou "ETH".
   * @returns {Promise<object|null>} Paquet {dvol, ts, putCallOI, putCallVol,
   *   skew, expiryDays}, ou null si tout a échoué.
   */
  async #pack(currency) {
    const [dvolResult, optionsResult] = await Promise.allSettled([this.#dvol(currency), this.#options(currency)]);
    const dvol = dvolResult.status === "fulfilled" ? dvolResult.value : null;
    const options = optionsResult.status === "fulfilled" ? optionsResult.value : null;
    if (!dvol && !options) return null;

    return { dvol: dvol?.dvol ?? null, ts: dvol?.ts ?? null, ...(options || {}) };
  }

  /**
   * Collecte BTC + ETH en parallèle.
   * @returns {Promise<object>} `dvol`/`ts` à plat (BTC, rétro-compat) +
   *   paquets complets sous `btc` et `eth`.
   * @throws {Error} Si les deux devises ont entièrement échoué.
   */
  async fetchData() {
    const [btc, eth] = await Promise.all([this.#pack("BTC"), this.#pack("ETH")]);
    if (!btc && !eth) throw new Error("Deribit vide (DVOL + options BTC/ETH échoués)");

    return {
      dvol: btc?.dvol ?? null,
      ts: btc?.ts ?? Date.now(),
      btc: btc ?? null,
      eth: eth ?? null,
    };
  }
}
