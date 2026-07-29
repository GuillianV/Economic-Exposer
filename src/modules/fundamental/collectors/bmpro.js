import { Collector } from "./base.js";
import { readScrapeCache } from "../scraper/cache.js";

/**
 * Indicateurs de cycle BitcoinMagazinePro nécessitant une donnée on-chain
 * avancée (RHODL Ratio, Reserve Risk) indisponible en tier gratuit ailleurs.
 * Comme les collecteurs Coinglass, il LIT le cache disque alimenté par le job de
 * scrape découplé — jamais le navigateur dans le cycle de snapshot. Axe : onchain.
 */
const CACHE_NAME = "bmpro";

/**
 *
 */
export class BmproCollector extends Collector {
  /**
   * Initialise le collecteur (source "bmpro", axe onchain).
   *
   */
  constructor() {
    super("bmpro", { axis: "onchain" });
  }

  /**
   * Lit les derniers indicateurs BMPro scrapés depuis le cache disque.
   * @returns {Promise<object>} Indicateurs BMPro + horodatage du scrape.
   * @throws {Error} Si le cache est vide (scrape pas encore passé ou en panne).
   */
  async fetchData() {
    const record = await readScrapeCache(CACHE_NAME);
    if (!record) throw new Error("cache BMPro vide (scrape pas encore passé)");
    return { ...record.data, scrapedTs: record.ts };
  }
}
