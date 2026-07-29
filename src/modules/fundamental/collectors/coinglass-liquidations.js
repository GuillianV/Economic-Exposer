import { Collector } from "./base.js";
import { readScrapeCache } from "../scraper/cache.js";

/**
 * Liquidations Coinglass par niveau de prix (aimants de liquidité). Ce collecteur
 * ne lance JAMAIS le navigateur : il LIT le cache disque alimenté par le job de
 * scrape découplé (voir scraper/refresh.js). Le cache absent = source stale, sans
 * ralentir le cycle de snapshot. Axe : structure (microstructure de marché).
 */
const CACHE_NAME = "coinglass-liquidations";

/**
 *
 */
export class CoinglassLiquidationsCollector extends Collector {
  /**
   * Initialise le collecteur (source "liquidations", axe structure).
   *
   */
  constructor() {
    super("liquidations", { axis: "structure" });
  }

  /**
   * Lit la dernière vue liquidations scrapée depuis le cache disque.
   * @returns {Promise<{asOf: string|null, levels: Array<object>,
   *   clusters: Array<object>, totalBuyUsd: number, totalSellUsd: number,
   *   scrapedTs: number}>} Vue liquidations enrichie de l'horodatage du scrape.
   * @throws {Error} Si le cache est vide (scrape pas encore passé ou en panne).
   */
  async fetchData() {
    const record = await readScrapeCache(CACHE_NAME);
    if (!record) throw new Error("cache liquidations vide (scrape Coinglass pas encore passé)");
    return { ...record.data, scrapedTs: record.ts };
  }
}
