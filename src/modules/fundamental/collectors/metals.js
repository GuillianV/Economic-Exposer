import { Collector } from "./base.js";
import { logger } from "../../logs/index.js";

/**
 * Or & argent (spot), sans clé. Collecteur DÉDIÉ (sorti de commodities) pour
 * qu'une panne métaux soit VISIBLE dans staleSources : l'axe commodities (FRED)
 * restait OK sur le pétrole et masquait le trou or/argent.
 *
 * Primaire : gold-api.com (spot, temps réel). Repli : Yahoo Finance (futures
 * COMEX GC=F/SI=F, proche spot, infra différente) car gold-api BLOQUE certaines
 * IP datacenter (403/timeout silencieux) → sur le serveur les métaux tombaient
 * à null. L'or = narratif "digital gold", inverse des taux réels.
 *
 * Axe : commodities (même axe que le pétrole FRED).
 */
const YF = { XAU: "GC=F", XAG: "SI=F" };

export class MetalsCollector extends Collector {
  constructor() {
    super("metals", { axis: "commodities" });
  }

  async #metal(symbol) {
    // Primaire : gold-api.com (spot).
    try {
      const json = await this.getJson(`https://api.gold-api.com/price/${symbol}`, {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
        timeout: 12000,
      });
      if (json?.price != null) return { value: Number(json.price), date: json.updatedAt };
    } catch (err) {
      logger.warn(`[metals] gold-api ${symbol} en échec (${err.message}) → repli Yahoo`);
    }

    // Repli : Yahoo Finance (futures COMEX).
    const yf = YF[symbol];
    if (!yf) return null;
    const j = await this.getJson(
      `https://query1.finance.yahoo.com/v8/finance/chart/${yf}?interval=1d&range=1d`,
      { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 12000 },
    );
    const m = j?.chart?.result?.[0]?.meta;
    if (m?.regularMarketPrice == null) return null;
    return {
      value: Number(m.regularMarketPrice),
      date: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
    };
  }

  async fetchData() {
    const [gold, silver] = await Promise.all([this.#metal("XAU"), this.#metal("XAG")]);
    // Stale seulement si les DEUX sources ET les DEUX métaux échouent.
    if (gold == null && silver == null) throw new Error("or & argent indisponibles (gold-api + Yahoo)");
    return { gold, silver };
  }
}
