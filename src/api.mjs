import "dotenv/config";
import { createApp } from "./modules/api/server.js";
import { logger } from "./modules/logs/index.js";

/**
 * Harness CLI : lance UNIQUEMENT l'API HTTP de lecture (sans la boucle de
 * collecte ni le scheduler de prévisions).
 */
const DEFAULT_PORT = 3000;
const PORT = Number(process.env.API_PORT) || DEFAULT_PORT;

const server = createApp().listen(PORT, () => {
  logger.info(`[api] API publique sur http://localhost:${PORT}/api`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    logger.error(`[api] port ${PORT} déjà utilisé — change API_PORT dans .env`);
  } else {
    logger.error(`[api] ${err.message}`);
  }
  process.exit(1);
});
