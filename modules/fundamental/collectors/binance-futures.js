import { Collector } from "./base.js";

/**
 * Binance Futures — positionnement / levier (proxy de sentiment).
 * Sans clé, gratuit. Axe : sentiment.
 *
 * Le funding et l'open interest se lisent sur le perpetual BTCUSDT
 * (référence du marché des dérivés), indépendamment du spot tradé.
 */
const SYMBOL = "BTCUSDT";

export class BinanceFuturesCollector extends Collector {
  constructor() {
    super("binance-futures", { axis: "sentiment" });
  }

  async fetchData() {
    const [premium, oi] = await Promise.all([
      this.getJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${SYMBOL}`),
      this.getJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${SYMBOL}`),
    ]);

    return {
      symbol: SYMBOL,
      lastFundingRate: premium?.lastFundingRate != null ? Number(premium.lastFundingRate) : null,
      markPrice: premium?.markPrice != null ? Number(premium.markPrice) : null,
      nextFundingTime: premium?.nextFundingTime ?? null,
      openInterest: oi?.openInterest != null ? Number(oi.openInterest) : null,
    };
  }
}
