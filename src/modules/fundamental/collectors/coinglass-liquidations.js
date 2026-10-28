import { Collector } from "./base.js";
import { SCRAPE_MAX_AGE_MS, loadFreshScrape } from "../scraper/cache.js";

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
   * @throws {Error} Si le cache est vide ou périmé (scrape en panne).
   */
  async fetchData() {
    return loadFreshScrape(CACHE_NAME, { label: "liquidations", maxAgeMs: SCRAPE_MAX_AGE_MS });
  }
}
