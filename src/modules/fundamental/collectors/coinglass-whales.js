import { Collector } from "./base.js";
import { readScrapeCache } from "../scraper/cache.js";

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
   * @throws {Error} Si le cache est vide (scrape pas encore passé ou en panne).
   */
  async fetchData() {
    const record = await readScrapeCache(CACHE_NAME);
    if (!record) throw new Error("cache whales vide (scrape Coinglass pas encore passé)");
    return { ...record.data, scrapedTs: record.ts };
  }
}
