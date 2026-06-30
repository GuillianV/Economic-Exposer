import { Collector } from "./base.js";

/**
 * Cotations marché INTRADAY (temps réel) — comble le retard de FRED (clôture
 * J-1 sur actions, ~hebdo sur pétrole). Axe : markets (source "markets-live").
 * Complète FRED (gardé pour l'historique EOD), ne le remplace pas.
 *
 * Multi-fournisseurs via MARKET_LIVE_PROVIDER :
 *   - "finnhub"    : FINNHUB_API_KEY (gratuit 60/min) — défaut. ETF proxies.
 *   - "twelvedata" : TWELVEDATA_API_KEY (gratuit 800/j).
 * Symboles configurables via MARKET_LIVE_SYMBOLS.
 */
const PROVIDER = process.env.MARKET_LIVE_PROVIDER || "finnhub";

const DEFAULT_SYMBOLS = {
  finnhub: "SPY,QQQ,VIXY,USO", // ETF proxies : S&P, Nasdaq, VIX, pétrole
  twelvedata: "SPX,IXIC,VIX,WTI",
};

function symbols() {
  const raw = process.env.MARKET_LIVE_SYMBOLS || DEFAULT_SYMBOLS[PROVIDER] || "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export class MarketsLiveCollector extends Collector {
  constructor() {
    super("markets-live", { axis: "markets" });
  }

  async fetchData() {
    const syms = symbols();
    if (PROVIDER === "finnhub") return this.#finnhub(syms);
    if (PROVIDER === "twelvedata") return this.#twelvedata(syms);
    throw new Error(`MARKET_LIVE_PROVIDER inconnu : ${PROVIDER}`);
  }

  async #finnhub(syms) {
    const key = process.env.FINNHUB_API_KEY;
    if (!key) throw new Error("FINNHUB_API_KEY absente du .env");

    const results = await Promise.allSettled(
      syms.map((s) => this.getJson(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(s)}&token=${key}`)),
    );
    const out = {};
    results.forEach((r, i) => {
      const sym = syms[i];
      const q = r.status === "fulfilled" ? r.value : null;
      out[sym] = q && Number(q.c) > 0 ? { value: Number(q.c), datetime: q.t ? new Date(q.t * 1000).toISOString() : null } : null;
    });
    if (Object.values(out).every((v) => v == null)) throw new Error("Finnhub : aucune cote (clé / symboles / quota ?)");
    return out;
  }

  async #twelvedata(syms) {
    const key = process.env.TWELVEDATA_API_KEY;
    if (!key) throw new Error("TWELVEDATA_API_KEY absente du .env");

    const json = await this.getJson(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(syms.join(","))}&apikey=${key}`);
    const out = {};
    const assign = (sym, q) => {
      if (!q || q.status === "error" || q.code) return void (out[sym] = null);
      const close = q.close != null ? Number(q.close) : null;
      out[sym] = close != null ? { value: close, datetime: q.datetime || null, name: q.name } : null;
    };
    if (syms.length === 1) assign(syms[0], json);
    else for (const sym of syms) assign(sym, json[sym]);
    if (Object.values(out).every((v) => v == null)) throw new Error("Twelve Data : aucune cote (clé / symboles / quota ?)");
    return out;
  }
}
