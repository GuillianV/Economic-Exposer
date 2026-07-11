import dotenv from "dotenv";
import pino from "pino";

/**
 * Logger unique du service (pino + pino-pretty). Niveau piloté par LOG_LEVEL
 * (défaut "info", "silent" pour les CLI à sortie JSON pure). Charge .env avant
 * lecture du niveau — ce module est importé en premier partout.
 */
dotenv.config({ quiet: true });

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: {
      translateTime: "SYS:yyyy-mm-dd HH:MM:ss",
      ignore: "pid,hostname",
    },
  },
});
