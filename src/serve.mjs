import "dotenv/config";
import { createApp } from "./modules/api/server.js";
import { startDailyJobs, startService } from "./modules/fundamental/ai/runner.js";
import { HOUR_MS } from "./modules/fundamental/persistence/scheduler.js";
import { closeBrowser } from "./modules/fundamental/scraper/browser.js";
import { startScrapeJob } from "./modules/fundamental/scraper/refresh.js";
import { logger } from "./modules/logs/index.js";

/**
 * Service 24/7 « lance et oublie » dans UN SEUL process :
 *   - boucle de collecte horaire + analyse IA (fond toutes les
 *     AI_BASELINE_HOURS, défaut 4h, + sur bascule) + push webhook sur verdict ;
 *   - travaux quotidiens (PREVISION_DAILY_HOUR, défaut 21:00 UTC) : prévision
 *     24h + émission de la boussole de régime, chacun évaluant ses échéances ;
 *   - API HTTP de lecture (même process), pour qu'un consommateur lise les
 *     snapshots/verdicts sans dépendre d'un second process.
 */
const DEFAULT_PORT = 3000;
const PORT = Number(process.env.API_PORT) || DEFAULT_PORT;

const stopService = startService({ intervalMs: HOUR_MS });
const stopDailyJobs = startDailyJobs();
const stopScrapeJob = startScrapeJob();

const server = createApp().listen(PORT, () => {
  logger.info(`[api] API publique sur http://localhost:${PORT}/api`);
});
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") logger.error(`[api] port ${PORT} déjà utilisé — change API_PORT dans .env`);
  else logger.error(`[api] ${err.message}`);
});

/**
 * Arrêt propre : stoppe la boucle de service, le scheduler quotidien, le job de
 * scrape (et ferme le navigateur) et le serveur HTTP avant de quitter.
 */
function shutdown() {
  stopService();
  stopDailyJobs();
  stopScrapeJob();
  closeBrowser();
  server.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
