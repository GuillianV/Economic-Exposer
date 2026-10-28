import { Collector } from "./base.js";
import { SCRAPE_MAX_AGE_MS, loadFreshScrape } from "../scraper/cache.js";

/**
 * Dérivés BTC agrégés Coinglass (funding, open interest, long/short retail et
 * top-traders, liquidations 24h, volume, leverage). Comme le collecteur
 * liquidations, il LIT le cache disque alimenté par le job de scrape découplé —
 * jamais le navigateur dans le cycle de snapshot. Axe : structure.
 */
const CACHE_NAME = "coinglass-derivatives";

/**
 *
 */
export class CoinglassDerivativesCollector extends Collector {
  /**
   * Initialise le collecteur (source "derivatives", axe structure).
   *
   */
  constructor() {
    super("derivatives", { axis: "structure" });
  }

  /**
   * Lit le dernier résumé dérivés scrapé depuis le cache disque.
   * @returns {Promise<object>} Vue dérivés BTC + horodatage du scrape.
   * @throws {Error} Si le cache est vide ou périmé (scrape en panne).
   */
  async fetchData() {
    return loadFreshScrape(CACHE_NAME, { label: "dérivés", maxAgeMs: SCRAPE_MAX_AGE_MS });
  }
}
