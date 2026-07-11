import { Collector } from "./base.js";

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

export class MarketsCollector extends Collector {
  constructor() {
    super("markets", { axis: "markets" });
  }

  /**
   * Dernière observation d'une série FRED.
   * @param {string} seriesId Identifiant de série FRED.
   * @param {string} apiKey Clé API FRED.
   * @returns {Promise<{value: number|null, date: string}|null>} Observation
   *   la plus récente (value null si FRED renvoie "."), ou null si vide.
   */
  async #latest(seriesId, apiKey) {
    const url =
      `https://api.stlouisfed.org/fred/series/observations` +
      `?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=1`;
    const json = await this.getJson(url);
    const observation = json?.observations?.[0];
    if (!observation) return null;

    const value = observation.value === "." ? null : Number(observation.value);
    return { value, date: observation.date };
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
   * Séries FRED + SKEW + MOVE en parallèle, tolérant aux pannes par série.
   * @returns {Promise<object>} Une entrée par clé de SERIES + `cboeSkew` et
   *   `move` ({value, date} ou null si la série a échoué).
   * @throws {Error} Si la clé FRED est absente.
   */
  async fetchData() {
    const apiKey = process.env.FRED_API_KEY;
    if (!apiKey) throw new Error("FRED_API_KEY absente du .env");

    const keys = Object.keys(SERIES);
    const settled = await Promise.allSettled([
      ...keys.map((key) => this.#latest(SERIES[key], apiKey)),
      this.#yahooIndex("^SKEW"),
      this.#yahooIndex("^MOVE"),
    ]);

    const valueAt = (i) => (settled[i].status === "fulfilled" ? settled[i].value : null);

    const out = {};
    keys.forEach((key, i) => {
      out[key] = valueAt(i);
    });
    out.cboeSkew = valueAt(keys.length);
    out.move = valueAt(keys.length + 1);
    return out;
  }
}
