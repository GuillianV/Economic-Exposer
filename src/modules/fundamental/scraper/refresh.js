import { scrapeBmpro } from "./bmpro.js";
import { closeBrowser } from "./browser.js";
import { writeScrapeCache } from "./cache.js";
import { scrapeDerivatives, scrapeLiquidationLevels, scrapeWhalePositions } from "./coinglass.js";
import { logger } from "../../logs/index.js";

/**
 * Job de RAFRAÎCHISSEMENT des scrapes navigateur, découplé du cycle de snapshot.
 * Lancé par serve.mjs à sa propre cadence. Chaque source scrapée est écrite dans
 * le cache disque ; une source en échec est loggée sans faire tomber les autres.
 * Le navigateur est fermé en fin de cycle (pas de Chromium idle entre deux runs).
 */
const SCRAPES = [
  { name: "coinglass-liquidations", run: scrapeLiquidationLevels },
  { name: "coinglass-derivatives", run: scrapeDerivatives },
  { name: "coinglass-whales", run: scrapeWhalePositions },
  { name: "bmpro", run: scrapeBmpro },
];

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const DEFAULT_INTERVAL_MS = 30 * MINUTE_MS; // cadence propre du scrape, indépendante du snapshot horaire
const INITIAL_DELAY_MS = 15 * SECOND_MS; // laisse le service démarrer avant de lancer Chromium

/**
 * Exécute tous les scrapes en série (un seul navigateur à la fois) et met à jour
 * leur cache. Ne lève jamais : l'échec d'une source est capturé et loggé.
 * @returns {Promise<void>} Résolue une fois tous les scrapes tentés.
 */
export async function refreshScrapes() {
  for (const { name, run } of SCRAPES) {
    try {
      const data = await run();
      await writeScrapeCache(name, data);
      logger.info(`[scraper] ${name} rafraîchi`);
    } catch (err) {
      logger.warn(`[scraper] ${name} en échec : ${err.message}`);
    }
  }
  await closeBrowser();
}

/**
 * Démarre le job de scrape périodique, découplé du cycle de snapshot : un
 * premier passage différé (le temps que le service démarre), puis à intervalle
 * régulier. Ne bloque jamais l'appelant (chaque passage capture ses erreurs).
 * @param {{intervalMs?: number}} [options] Intervalle entre deux scrapes.
 * @returns {Function} Fonction d'arrêt (annule les minuteries en cours).
 */
export function startScrapeJob({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  const initial = setTimeout(() => {
    refreshScrapes().catch((err) => logger.warn(`[scraper] passage initial : ${err.message}`));
  }, INITIAL_DELAY_MS);
  const timer = setInterval(() => {
    refreshScrapes().catch((err) => logger.warn(`[scraper] passage périodique : ${err.message}`));
  }, intervalMs);
  return () => {
    clearTimeout(initial);
    clearInterval(timer);
  };
}
