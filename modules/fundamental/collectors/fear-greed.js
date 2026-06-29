import { Collector } from "./base.js";

/**
 * Crypto Fear & Greed Index (alternative.me).
 * Sans clé, gratuit. Axe : sentiment.
 */
export class FearGreedCollector extends Collector {
  constructor() {
    super("fear-greed", { axis: "sentiment" });
  }

  async fetchData() {
    const json = await this.getJson("https://api.alternative.me/fng/?limit=2");
    const arr = Array.isArray(json?.data) ? json.data : [];
    if (arr.length === 0) throw new Error("réponse F&G vide");

    const [current, previous] = arr;
    return {
      value: Number(current.value),
      classification: current.value_classification,
      ts: Number(current.timestamp) * 1000,
      previousValue: previous ? Number(previous.value) : null,
    };
  }
}
