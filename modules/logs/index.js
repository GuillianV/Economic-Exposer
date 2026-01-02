import pino from "pino";
import dotenv from "dotenv";

dotenv.config();

export const logger = pino({
  level: "trace",
  hooks: {
    logMethod(inputArgs, method, level) {
      switch (level) {
        case 30:
          jsonLogger.debug(inputArgs);
          break;

        case 40:
          jsonLogger.warn(inputArgs);
          break;

        case 50:
          jsonLogger.error(inputArgs);
          break;

        case 60:
          jsonLogger.fatal(inputArgs);
          break;

        default:
          jsonLogger.info(inputArgs);
          break;
      }

      return method.apply(this, inputArgs);
    },
  },

  transport: {
    target: "pino-pretty",
    options: {
      translateTime: "SYS:yyyy-mm-dd HH:MM:ss",
      ignore: "pid,hostname",
    },
  },
});

const jsonLogger = pino(
  pino.destination({
    sync: true,
    mkdir: true,
    dest: "logs/app.log",
  })
);
