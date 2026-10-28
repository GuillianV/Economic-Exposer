import { Collector } from "./base.js";
import { loadFreshScrape } from "../scraper/cache.js";

/**
 * Indicateurs de cycle BitcoinMagazinePro nécessitant une donnée on-chain
 * avancée (RHODL Ratio, Reserve Risk) indisponible en tier gratuit ailleurs.
 * Comme les collecteurs Coinglass, il LIT le cache disque alimenté par le job de
 * scrape découplé — jamais le navigateur dans le cycle de snapshot. Axe : onchain.
 */
const HOUR_MS = 60 * 60 * 1000;
export const BMPRO_CACHE_MAX_AGE_MS = 6 * HOUR_MS; // donnée quotidienne scrapée toutes les 30 min : 6 h = panne avérée
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
   * @throws {Error} Si le cache est vide ou périmé (scrape en panne).
   */
  async fetchData() {
    return loadFreshScrape(CACHE_NAME, { label: "BMPro", maxAgeMs: BMPRO_CACHE_MAX_AGE_MS });
  }
}
