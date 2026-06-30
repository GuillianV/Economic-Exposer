import { Collector } from "./base.js";

/**
 * Binance Futures — positionnement / levier (proxy de sentiment), BTC + ETH.
 * Sans clé, gratuit. Axe : sentiment.
 *
 * Funding & open interest sur les perpétuels (référence du marché des dérivés) :
 * BTC (à plat, rétro-compat) + les grands alts ETH/SOL/BNB/XRP (sous leur clé).
 * On ajoute aussi le RATIO LONG/SHORT BTC (positionnement de la foule vs les gros
 * comptes) : un extrême signale un retournement possible.
 */
const FAPI = "https://fapi.binance.com/fapi/v1";
const FDATA = "https://fapi.binance.com/futures/data";
// Alts suivis (breadth crypto) ; BTC reste traité à part (champs à plat).
const ALTS = ["ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];
const num = (v) => (v != null ? Number(v) : null);

export class BinanceFuturesCollector extends Collector {
  constructor() {
    super("binance-futures", { axis: "sentiment" });
  }

  async #symbol(symbol) {
    const [premium, oi] = await Promise.all([
      this.getJson(`${FAPI}/premiumIndex?symbol=${symbol}`),
      this.getJson(`${FAPI}/openInterest?symbol=${symbol}`),
    ]);
    return {
      symbol,
      lastFundingRate: num(premium?.lastFundingRate),
      markPrice: num(premium?.markPrice),
      nextFundingTime: premium?.nextFundingTime ?? null,
      openInterest: num(oi?.openInterest),
    };
  }

  // Ratios long/short BTC (positionnement). Défensif : ne casse pas le collecteur
  // principal si ces endpoints échouent.
  async #ratios(symbol) {
    try {
      const [acc, top] = await Promise.all([
        this.getJson(`${FDATA}/globalLongShortAccountRatio?symbol=${symbol}&period=1h&limit=1`),
        this.getJson(`${FDATA}/topLongShortPositionRatio?symbol=${symbol}&period=1h&limit=1`),
      ]);
      const a = Array.isArray(acc) ? acc[acc.length - 1] : null;
      const t = Array.isArray(top) ? top[top.length - 1] : null;
      return {
        longShortAccountRatio: num(a?.longShortRatio), // foule (tous comptes)
        topPositionRatio: num(t?.longShortRatio), // gros traders (positions)
      };
    } catch {
      return { longShortAccountRatio: null, topPositionRatio: null };
    }
  }

  async fetchData() {
    const [btc, ratios, ...alts] = await Promise.all([
      this.#symbol("BTCUSDT"),
      this.#ratios("BTCUSDT"),
      ...ALTS.map((s) => this.#symbol(s)),
    ]);
    // BTC à plat (rétro-compat) + ratios long/short + alts sous leur clé (eth/sol/bnb/xrp).
    const out = { ...btc, ...ratios };
    ALTS.forEach((s, i) => {
      out[s.replace("USDT", "").toLowerCase()] = alts[i];
    });
    return out;
  }
}
