import { Collector } from "./base.js";

/**
 * Binance Futures — positionnement / levier (proxy de sentiment), BTC + ETH.
 * Sans clé, gratuit. Axe : sentiment.
 *
 * Funding & open interest sur les perpétuels BTCUSDT / ETHUSDT (référence du
 * marché des dérivés). Les champs BTC restent à plat (rétro-compat) ; ETH est
 * ajouté sous `eth`.
 */
const FAPI = "https://fapi.binance.com/fapi/v1";
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

  async fetchData() {
    const [btc, eth] = await Promise.all([this.#symbol("BTCUSDT"), this.#symbol("ETHUSDT")]);
    // BTC à plat (rétro-compat) + ETH sous `eth`.
    return { ...btc, eth };
  }
}
