import { Collector } from "./base.js";

/**
 * Matières premières via FRED — proxy du risque géopolitique et de l'inflation.
 * Nécessite process.env.FRED_API_KEY (même clé que fred). Axe : commodities.
 *
 * Séries (dernière observation) :
 *   DCOILWTICO    - pétrole WTI ($/baril)
 *   DCOILBRENTEU  - pétrole Brent ($/baril)
 *   DHHNGSP       - gaz naturel Henry Hub ($/MMBtu)
 *
 * NB : les séries or LBMA de FRED sont discontinuées (404). L'or spot
 * nécessitera une source dédiée plus tard (proxy géopolitique = pétrole ici).
 */
const SERIES = {
  wtiOil: "DCOILWTICO",
  brentOil: "DCOILBRENTEU",
  natGas: "DHHNGSP",
};

export class CommoditiesCollector extends Collector {
  constructor() {
    super("commodities", { axis: "commodities" });
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

    // Tolérant par série : une série discontinuée (HTTP 400) ne casse pas le reste.
    const keys = Object.keys(SERIES);
    const settled = await Promise.allSettled(keys.map((k) => this.#latest(SERIES[k], apiKey)));
    const out = {};
    keys.forEach((k, i) => {
      out[k] = settled[i].status === "fulfilled" ? settled[i].value : null;
    });
    return out;
  }
}
