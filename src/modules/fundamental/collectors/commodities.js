import { Collector } from "./base.js";
import { settleFredSeries } from "./fred-client.js";

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

/**
 *
 */
export class CommoditiesCollector extends Collector {
  /**
   * Initialise le collecteur et ses options.
   *
   */
  constructor() {
    super("commodities", { axis: "commodities" });
  }

  /**
   * Récupère toutes les séries en parallèle (relance, log et repli par série :
   * voir fred-client.js).
   * @returns {Promise<object>} Une entrée par clé de FRED_SERIES
   *   ({value, date, cached?} ou null si la série a échoué sans repli).
   * @throws {Error} Si la clé FRED est absente ou si toutes les séries échouent.
   */
  async fetchData() {
    const apiKey = process.env.FRED_API_KEY;
    if (!apiKey) throw new Error("FRED_API_KEY absente du .env");

    return settleFredSeries(FRED_SERIES, apiKey, (url) => this.getJson(url), { source: "commodities" });
  }
}
