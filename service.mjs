import "dotenv/config";
import { startService } from "./modules/fundamental/ai/runner.js";
import { HOUR_MS } from "./modules/fundamental/persistence/scheduler.js";

// Service 24/7 : collecte horaire + analyse IA (fond toutes les AI_BASELINE_HOURS
// h, défaut 4h + sur bascule). Arrêt propre sur Ctrl-C.
const stop = startService({ intervalMs: HOUR_MS });

process.on("SIGINT", () => {
  stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  stop();
  process.exit(0);
});
