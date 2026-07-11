import { Collector } from "./base.js";

/**
 * Cotations marché INTRADAY (temps réel) — comble le retard de FRED (clôture
 * J-1 sur actions, ~hebdo sur pétrole). Complète FRED (gardé pour
 * l'historique EOD), ne le remplace pas. Axe : markets.
 *
 * Multi-fournisseurs via MARKET_LIVE_PROVIDER :
 * - "finnhub"    : FINNHUB_API_KEY (gratuit 60/min) — défaut. ETF proxies.
 * - "twelvedata" : TWELVEDATA_API_KEY (gratuit 800/j).
 * Symboles configurables via MARKET_LIVE_SYMBOLS.
 */
const PROVIDER = process.env.MARKET_LIVE_PROVIDER || "finnhub";

const DEFAULT_SYMBOLS = {
  finnhub: "SPY,QQQ,VIXY,USO", // ETF proxies : S&P, Nasdaq, VIX, pétrole
  twelvedata: "SPX,IXIC,VIX,WTI",
};

/**
 * Liste des symboles à coter (env ou défaut du fournisseur).
 * @returns {string[]} Symboles nettoyés, sans entrée vide.
 */
function symbols() {
  const raw = process.env.MARKET_LIVE_SYMBOLS || DEFAULT_SYMBOLS[PROVIDER] || "";
  return raw
    .split(",")
    .map((symbol) => symbol.trim())
    .filter(Boolean);
}

/**
 *
 */
export class MarketsLiveCollector extends Collector {
  /**
   * Initialise le collecteur et ses options.
   *
   */
  constructor() {
    super("markets-live", { axis: "markets" });
  }

  /**
   * Cote les symboles configurés via le fournisseur actif.
   * @returns {Promise<object>} Une entrée par symbole
   *   ({value, datetime} ou null si la cote a échoué).
   * @throws {Error} Fournisseur inconnu, clé absente ou aucune cote obtenue.
   */
  async fetchData() {
    const symbolList = symbols();
    if (PROVIDER === "finnhub") return this.#finnhub(symbolList);
    if (PROVIDER === "twelvedata") return this.#twelvedata(symbolList);
    throw new Error(`MARKET_LIVE_PROVIDER inconnu : ${PROVIDER}`);
  }

  /**
   * Cotations via Finnhub (un appel par symbole, tolérant par symbole).
   * @param {string[]} symbolList Symboles à coter.
   * @returns {Promise<object>} Une entrée par symbole ({value, datetime} ou null).
   * @throws {Error} Clé absente ou aucune cote valide.
   */
  async #finnhub(symbolList) {
    const key = process.env.FINNHUB_API_KEY;
    if (!key) throw new Error("FINNHUB_API_KEY absente du .env");

    const results = await Promise.allSettled(
      symbolList.map((symbol) =>
        this.getJson(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`),
      ),
    );

    const out = {};
    results.forEach((result, i) => {
      const symbol = symbolList[i];
      const quote = result.status === "fulfilled" ? result.value : null;
      if (quote && Number(quote.c) > 0) {
        out[symbol] = {
          value: Number(quote.c),
          datetime: quote.t ? new Date(quote.t * 1000).toISOString() : null,
        };
      } else {
        out[symbol] = null;
      }
    });

    if (Object.values(out).every((quote) => quote == null)) {
      throw new Error("Finnhub : aucune cote (clé / symboles / quota ?)");
    }
    return out;
  }

  /**
   * Cotations via Twelve Data (un appel groupé pour tous les symboles).
   * @param {string[]} symbolList Symboles à coter.
   * @returns {Promise<object>} Une entrée par symbole
   *   ({value, datetime, name} ou null).
   * @throws {Error} Clé absente ou aucune cote valide.
   */
  async #twelvedata(symbolList) {
    const key = process.env.TWELVEDATA_API_KEY;
    if (!key) throw new Error("TWELVEDATA_API_KEY absente du .env");

    const json = await this.getJson(
      `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbolList.join(","))}&apikey=${key}`,
    );

    const out = {};
    const assign = (symbol, quote) => {
      if (!quote || quote.status === "error" || quote.code) {
        out[symbol] = null;
        return;
      }
      const close = quote.close != null ? Number(quote.close) : null;
      if (close == null) {
        out[symbol] = null;
        return;
      }
      out[symbol] = { value: close, datetime: quote.datetime || null, name: quote.name };
    };

    if (symbolList.length === 1) {
      assign(symbolList[0], json);
    } else {
      for (const symbol of symbolList) assign(symbol, json[symbol]);
    }

    if (Object.values(out).every((quote) => quote == null)) {
      throw new Error("Twelve Data : aucune cote (clé / symboles / quota ?)");
    }
    return out;
  }
}
