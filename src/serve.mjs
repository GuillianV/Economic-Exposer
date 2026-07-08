import "dotenv/config";
import { startService, startDailyPrevision } from "./modules/fundamental/ai/runner.js";
import { HOUR_MS } from "./modules/fundamental/persistence/scheduler.js";
import { createApp } from "./modules/api/server.js";
import { logger } from "./modules/logs/index.js";

// Service 24/7 « lance et oublie » dans UN SEUL process :
//   - boucle de collecte horaire + analyse IA (fond toutes les AI_BASELINE_HOURS,
//     défaut 4h, + sur bascule) + push webhook sur verdict ;
//   - API HTTP de lecture (même process), pour qu'un consommateur lise les
//     snapshots/verdicts sans dépendre d'un second process.
const PORT = Number(process.env.API_PORT) || 3000;

const stop = startService({ intervalMs: HOUR_MS });
const stopPrevision = startDailyPrevision(); // prévision 24h 1×/jour à 12h (PREVISION_DAILY_HOUR)

const server = createApp().listen(PORT, () => {
  logger.info(`[api] API publique sur http://localhost:${PORT}/api`);
});
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") logger.error(`[api] port ${PORT} déjà utilisé — change API_PORT dans .env`);
  else logger.error(`[api] ${err.message}`);
});

function shutdown() {
  stop();
  stopPrevision();
  server.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
