import { Collector } from "./base.js";

/**
 * Marchés actions / risque (TradFi) via FRED — pour les corrélations cross-market.
 * Nécessite process.env.FRED_API_KEY (même clé que fred). Axe : markets.
 *
 * Séries (dernière observation) :
 *   SP500      - S&P 500
 *   NASDAQCOM  - Nasdaq Composite
 *   DJIA       - Dow Jones
 *   VIXCLS     - VIX (indice de la peur actions)
 *
 * BTC corrèle fortement avec le risk-on actions (S&P/Nasdaq) et inversement
 * avec le VIX. Permet à l'analyste de lire l'alignement / les divergences.
 */
const SERIES = {
  sp500: "SP500",
  nasdaq: "NASDAQCOM",
  djia: "DJIA",
  vix: "VIXCLS",
};

export class MarketsCollector extends Collector {
  constructor() {
    super("markets", { axis: "markets" });
  }

  async #latest(seriesId, apiKey) {
    const url =
      `https://api.stlouisfed.org/fred/series/observations` +
      `?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=1`;
    const json = await this.getJson(url);
    const obs = json?.observations?.[0];
    if (!obs) return null;
    return { value: obs.value === "." ? null : Number(obs.value), date: obs.date };
  }

  // Indice Yahoo (dernier cours) — utilisé pour les indices sans série FRED.
  async #yahooIndex(symbol) {
    const json = await this.getJson(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`,
      { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 12000 },
    );
    const m = json?.chart?.result?.[0]?.meta;
    if (m?.regularMarketPrice == null) return null;
    return {
      value: Number(m.regularMarketPrice),
      date: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
    };
  }

  // CBOE SKEW (^SKEW) : prix du hedge crash sur les options S&P. ↑ = demande de
  // protection contre un décrochage (tail risk). Sans clé.
  #cboeSkew() {
    return this.#yahooIndex("^SKEW");
  }

  // MOVE (^MOVE) : volatilité implicite des Treasuries — le "VIX des taux".
  // En régime fiscal/prime de terme, c'est la vol OBLIGATAIRE qui drive tout ;
  // MOVE élevé avec VIX bas = stress caché dans les taux, pas encore dans les actions.
  #move() {
    return this.#yahooIndex("^MOVE");
  }

  async fetchData() {
    const apiKey = process.env.FRED_API_KEY;
    if (!apiKey) throw new Error("FRED_API_KEY absente du .env");

    const keys = Object.keys(SERIES);
    const settled = await Promise.allSettled([
      ...keys.map((k) => this.#latest(SERIES[k], apiKey)),
      this.#cboeSkew(),
      this.#move(),
    ]);
    const out = {};
    keys.forEach((k, i) => {
      out[k] = settled[i].status === "fulfilled" ? settled[i].value : null;
    });
    out.cboeSkew = settled[keys.length].status === "fulfilled" ? settled[keys.length].value : null;
    out.move = settled[keys.length + 1].status === "fulfilled" ? settled[keys.length + 1].value : null;
    return out;
  }
}
