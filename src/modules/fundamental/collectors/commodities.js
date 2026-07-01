import { Collector } from "./base.js";

/**
 * Matières premières — proxy du risque géopolitique, de l'inflation et de la
 * croissance. Axe : commodities.
 *
 *  - Énergie & métaux industriels & agricoles via FRED (clé requise) :
 *      WTI, Brent, gaz, cuivre ("Dr Copper" = croissance), blé (alimentaire).
 *
 * Or & argent sont dans un collecteur DÉDIÉ (metals.js, même axe) : source
 * différente (gold-api/Yahoo, sans clé) et pannes rendues visibles séparément.
 */
const FRED_SERIES = {
  wtiOil: "DCOILWTICO",
  brentOil: "DCOILBRENTEU",
  natGas: "DHHNGSP",
  copper: "PCOPPUSDM", // $/tonne, mensuel
  wheat: "PWHEAMTUSDM", // $/tonne, mensuel
};

export class CommoditiesCollector extends Collector {
  constructor() {
    super("commodities", { axis: "commodities" });
  }

  async #latestFred(seriesId, apiKey) {
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

    const keys = Object.keys(FRED_SERIES);
    const settled = await Promise.allSettled(keys.map((k) => this.#latestFred(FRED_SERIES[k], apiKey)));
    const val = (i) => (settled[i].status === "fulfilled" ? settled[i].value : null);

    const out = {};
    keys.forEach((k, i) => (out[k] = val(i)));
    return out;
  }
}
