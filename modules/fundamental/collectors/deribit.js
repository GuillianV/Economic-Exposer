import { Collector } from "./base.js";

/**
 * Deribit DVOL — indice de volatilité implicite du BTC (la "VIX du crypto").
 * Sans clé, API publique gratuite. Axe : sentiment.
 *
 * DVOL élevé = peur/incertitude sur le marché des options BTC ; bas = complaisance.
 */
export class DeribitCollector extends Collector {
  constructor() {
    super("deribit", { axis: "sentiment" });
  }

  async fetchData() {
    const now = Date.now();
    const start = now - 6 * 3600 * 1000;
    const url =
      `https://www.deribit.com/api/v2/public/get_volatility_index_data` +
      `?currency=BTC&start_timestamp=${start}&end_timestamp=${now}&resolution=3600`;
    const json = await this.getJson(url);
    const data = json?.result?.data || [];
    if (data.length === 0) throw new Error("DVOL vide");
    const last = data[data.length - 1]; // [ts, open, high, low, close]
    return { dvol: last[4], ts: last[0] };
  }
}
