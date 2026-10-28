import { Collector } from "./base.js";
import { settleFredSeries } from "./fred-client.js";
import { logger } from "../../logs/index.js";

/**
 * Marchés actions / risque (TradFi) via FRED — pour les corrélations
 * cross-market. Nécessite process.env.FRED_API_KEY. Axe : markets.
 *
 * BTC corrèle fortement avec le risk-on actions (S&P/Nasdaq) et inversement
 * avec le VIX. Complété par deux indices Yahoo sans série FRED :
 * - CBOE SKEW : prix du hedge crash sur les options S&P (demande de
 *   protection contre un décrochage, tail risk).
 * - MOVE : volatilité implicite des Treasuries ("VIX des taux") — MOVE élevé
 *   avec VIX bas = stress caché dans les taux, pas encore dans les actions.
 */
const SERIES = {
  sp500: "SP500",
  nasdaq: "NASDAQCOM",
  djia: "DJIA",
  vix: "VIXCLS", // indice de la peur actions
};

const YAHOO_TIMEOUT_MS = 12000;

/**
 *
 */
export class MarketsCollector extends Collector {
  /**
   * Initialise le collecteur et ses options.
   *
   */
  constructor() {
    super("markets", { axis: "markets" });
  }

  /**
   * Dernier cours d'un indice Yahoo Finance (indices sans série FRED).
   * @param {string} symbol Symbole Yahoo (ex. "^SKEW").
   * @returns {Promise<{value: number, date: string|null}|null>} Dernier cours,
   *   ou null si indisponible.
   */
  async #yahooIndex(symbol) {
    const json = await this.getJson(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`,
      { headers: { "User-Agent": "Mozilla/5.0" }, timeout: YAHOO_TIMEOUT_MS },
    );
    const meta = json?.chart?.result?.[0]?.meta;
    if (meta?.regularMarketPrice == null) return null;

    return {
      value: Number(meta.regularMarketPrice),
      date: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
    };
  }

  /**
   * Séries FRED (relance, log et repli : voir fred-client.js) + SKEW + MOVE en
   * parallèle, tolérant aux pannes par série.
   * @returns {Promise<object>} Une entrée par clé de SERIES + `cboeSkew` et
   *   `move` ({value, date, cached?} ou null si la série a échoué).
   * @throws {Error} Si la clé FRED est absente ou si FRED et Yahoo échouent tous.
   */
  async fetchData() {
    const apiKey = process.env.FRED_API_KEY;
    if (!apiKey) throw new Error("FRED_API_KEY absente du .env");

    const [fredResult, skewResult, moveResult] = await Promise.allSettled([
      settleFredSeries(SERIES, apiKey, (url) => this.getJson(url), { source: "markets" }),
      this.#yahooIndex("^SKEW"),
      this.#yahooIndex("^MOVE"),
    ]);
    if (fredResult.status === "rejected" && skewResult.status === "rejected" && moveResult.status === "rejected") {
      throw new Error(`FRED et Yahoo en échec : ${fredResult.reason?.message}`);
    }

    const fredSeries = this.#fredOrEmpty(fredResult);
    return {
      ...fredSeries,
      cboeSkew: this.#yahooOrNull(skewResult, "^SKEW"),
      move: this.#yahooOrNull(moveResult, "^MOVE"),
    };
  }

  /**
   * Séries FRED du lot, ou toutes à null si le lot entier a échoué (déjà
   * loggé série par série par fred-client.js).
   * @param {PromiseSettledResult} result Issue de settleFredSeries.
   * @returns {object} Une entrée par clé de SERIES.
   */
  #fredOrEmpty(result) {
    if (result.status === "fulfilled") return result.value;
    const empty = {};
    for (const key of Object.keys(SERIES)) empty[key] = null;
    return empty;
  }

  /**
   * Cours Yahoo d'un indice, ou null (échec loggé avec le symbole).
   * @param {PromiseSettledResult} result Issue de #yahooIndex.
   * @param {string} symbol Symbole Yahoo (logs).
   * @returns {{value: number, date: string|null}|null} Dernier cours, ou null.
   */
  #yahooOrNull(result, symbol) {
    if (result.status === "fulfilled") return result.value;
    logger.warn(`[markets] indice Yahoo ${symbol} en échec : ${result.reason?.message}`);
    return null;
  }
}
