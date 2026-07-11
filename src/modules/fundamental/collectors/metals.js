import { Collector } from "./base.js";
import { logger } from "../../logs/index.js";

/**
 * Or & argent (spot), sans clé. Collecteur DÉDIÉ (sorti de commodities) pour
 * qu'une panne métaux soit VISIBLE dans staleSources : l'axe commodities
 * (FRED) restait OK sur le pétrole et masquait le trou or/argent.
 *
 * Primaire : gold-api.com (spot, temps réel). Repli : Yahoo Finance (futures
 * COMEX, proche spot, infra différente) car gold-api bloque certaines IP
 * datacenter (403/timeout silencieux). L'or = narratif "digital gold",
 * inverse des taux réels. Axe : commodities.
 */
const YAHOO_SYMBOLS = { XAU: "GC=F", XAG: "SI=F" }; // futures COMEX or / argent
const METAL_TIMEOUT_MS = 12000;

/**
 *
 */
export class MetalsCollector extends Collector {
  /**
   * Initialise le collecteur et ses options.
   *
   */
  constructor() {
    super("metals", { axis: "commodities" });
  }

  /**
   * Prix spot d'un métal : gold-api.com en primaire, Yahoo Finance en repli.
   * @param {string} symbol "XAU" (or) ou "XAG" (argent).
   * @returns {Promise<{value: number, date: string|null}|null>} Prix en USD
   *   et date de cotation, ou null si les deux sources échouent sans lever.
   */
  async #metal(symbol) {
    try {
      const json = await this.getJson(`https://api.gold-api.com/price/${symbol}`, {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
        timeout: METAL_TIMEOUT_MS,
      });
      if (json?.price != null) return { value: Number(json.price), date: json.updatedAt };
    } catch (err) {
      logger.warn(`[metals] gold-api ${symbol} en échec (${err.message}) → repli Yahoo`);
    }

    return this.#yahooFallback(symbol);
  }

  /**
   * Repli Yahoo Finance : dernier cours du future COMEX correspondant.
   * @param {string} symbol "XAU" ou "XAG".
   * @returns {Promise<{value: number, date: string|null}|null>} Cours du
   *   future, ou null si indisponible.
   */
  async #yahooFallback(symbol) {
    const yahooSymbol = YAHOO_SYMBOLS[symbol];
    if (!yahooSymbol) return null;

    const json = await this.getJson(
      `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=1d`,
      { headers: { "User-Agent": "Mozilla/5.0" }, timeout: METAL_TIMEOUT_MS },
    );
    const meta = json?.chart?.result?.[0]?.meta;
    if (meta?.regularMarketPrice == null) return null;

    return {
      value: Number(meta.regularMarketPrice),
      date: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
    };
  }

  /**
   * Or et argent en parallèle ; stale seulement si les DEUX métaux échouent.
   * @returns {Promise<{gold: object|null, silver: object|null}>} Prix spot.
   * @throws {Error} Si or ET argent sont indisponibles sur les deux sources.
   */
  async fetchData() {
    const [gold, silver] = await Promise.all([this.#metal("XAU"), this.#metal("XAG")]);
    if (gold == null && silver == null) throw new Error("or & argent indisponibles (gold-api + Yahoo)");
    return { gold, silver };
  }
}
