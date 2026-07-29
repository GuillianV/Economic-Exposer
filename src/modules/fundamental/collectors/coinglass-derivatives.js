import { Collector } from "./base.js";
import { readScrapeCache } from "../scraper/cache.js";

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
   * @throws {Error} Si le cache est vide (scrape pas encore passé ou en panne).
   */
  async fetchData() {
    const record = await readScrapeCache(CACHE_NAME);
    if (!record) throw new Error("cache dérivés vide (scrape Coinglass pas encore passé)");
    return { ...record.data, scrapedTs: record.ts };
  }
}
