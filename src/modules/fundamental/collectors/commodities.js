import { Collector } from "./base.js";

/**
 * Matières premières — proxy du risque géopolitique, de l'inflation et de la
 * croissance. Axe : commodities.
 *
 * Énergie, métaux industriels et agricoles via FRED (clé requise) : WTI,
 * Brent, gaz, cuivre ("Dr Copper" = croissance), blé (alimentaire).
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

  /**
   * Dernière observation d'une série FRED.
   * @param {string} seriesId Identifiant de série FRED.
   * @param {string} apiKey Clé API FRED.
   * @returns {Promise<{value: number|null, date: string}|null>} Observation
   *   la plus récente (value null si FRED renvoie "."), ou null si vide.
   */
  async #latestFred(seriesId, apiKey) {
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
   * Récupère toutes les séries en parallèle, tolérant aux pannes par série.
   * @returns {Promise<object>} Une entrée par clé de FRED_SERIES
   *   ({value, date} ou null si la série a échoué).
   * @throws {Error} Si la clé FRED est absente.
   */
  async fetchData() {
    const apiKey = process.env.FRED_API_KEY;
    if (!apiKey) throw new Error("FRED_API_KEY absente du .env");

    const keys = Object.keys(FRED_SERIES);
    const settled = await Promise.allSettled(keys.map((key) => this.#latestFred(FRED_SERIES[key], apiKey)));

    const out = {};
    keys.forEach((key, i) => {
      out[key] = settled[i].status === "fulfilled" ? settled[i].value : null;
    });
    return out;
  }
}
