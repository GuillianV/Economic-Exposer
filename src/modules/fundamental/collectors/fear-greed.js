import { Collector } from "./base.js";

/**
 * Crypto Fear & Greed Index (alternative.me).
 * Sans clé, gratuit. Axe : sentiment.
 */
export class FearGreedCollector extends Collector {
  constructor() {
    super("fear-greed", { axis: "sentiment" });
  }

  /**
   * Dernier indice F&G + valeur de la veille (pour lire la tendance).
   * @returns {Promise<{value: number, classification: string, ts: number,
   *   previousValue: number|null}>} Indice courant (0-100, 0 = peur extrême).
   * @throws {Error} Si la réponse est vide.
   */
  async fetchData() {
    const json = await this.getJson("https://api.alternative.me/fng/?limit=2");
    const entries = Array.isArray(json?.data) ? json.data : [];
    if (entries.length === 0) throw new Error("réponse F&G vide");

    const [current, previous] = entries;
    return {
      value: Number(current.value),
      classification: current.value_classification,
      ts: Number(current.timestamp) * 1000,
      previousValue: previous ? Number(previous.value) : null,
    };
  }
}
