import { Collector } from "./base.js";

/**
 * blockchain.info — on-chain BTC basique.
 * Sans clé, gratuit. Axe : onchain.
 *
 * Les champs total_fees_btc / miners_revenue_usd de /stats reviennent cassés
 * côté API — écartés.
 */
export class OnChainCollector extends Collector {
  /**
   * Initialise le collecteur et ses options.
   *
   */
  constructor() {
    super("blockchain-info", { axis: "onchain" });
  }

  /**
   * Statistiques réseau Bitcoin du jour.
   * @returns {Promise<{hashRate: number|null, nTx: number|null,
   *   marketPriceUsd: number|null}>} Hashrate, transactions, prix.
   */
  async fetchData() {
    const stats = await this.getJson("https://api.blockchain.info/stats");
    return {
      hashRate: stats?.hash_rate ?? null,
      nTx: stats?.n_tx ?? null,
      marketPriceUsd: stats?.market_price_usd ?? null,
    };
  }
}
