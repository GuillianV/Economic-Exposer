import { Collector } from "./base.js";
import { SCRAPE_MAX_AGE_MS, loadFreshScrape } from "../scraper/cache.js";

/**
 * Positionnement WHALE BTC (gros comptes Hyperliquid agrégés par Coinglass) :
 * part long/short et taille totale des positions. Comme les autres collecteurs
 * Coinglass, il LIT le cache disque alimenté par le job de scrape découplé —
 * jamais le navigateur dans le cycle de snapshot. Axe : structure.
 */
const CACHE_NAME = "coinglass-whales";

/**
 *
 */
export class CoinglassWhalesCollector extends Collector {
  /**
   * Initialise le collecteur (source "whales", axe structure).
   *
   */
  constructor() {
    super("whales", { axis: "structure" });
  }

  /**
   * Lit le dernier positionnement whale scrapé depuis le cache disque.
   * @returns {Promise<object>} Positionnement whale BTC + horodatage du scrape.
   * @throws {Error} Si le cache est vide ou périmé (scrape en panne).
   */
  async fetchData() {
    return loadFreshScrape(CACHE_NAME, { label: "whales", maxAgeMs: SCRAPE_MAX_AGE_MS });
  }
}
