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

  async fetchData() {
    const apiKey = process.env.FRED_API_KEY;
    if (!apiKey) throw new Error("FRED_API_KEY absente du .env");

    const keys = Object.keys(SERIES);
    const settled = await Promise.allSettled(keys.map((k) => this.#latest(SERIES[k], apiKey)));
    const out = {};
    keys.forEach((k, i) => {
      out[k] = settled[i].status === "fulfilled" ? settled[i].value : null;
    });
    return out;
  }
}
