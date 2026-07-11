import { Collector } from "./base.js";

/**
 * DefiLlama — liquidité on-chain.
 * Sans clé, gratuit. Axe : onchain.
 *
 * Donne : TVL DeFi totale (dernier point) + offre totale de stablecoins
 * (somme du circulating peggedUSD) = pouvoir d'achat disponible.
 */
export class DefiLlamaCollector extends Collector {
  /**
   * Initialise le collecteur et ses options.
   *
   */
  constructor() {
    super("defillama", { axis: "onchain" });
  }

  /**
   * TVL DeFi et offre de stablecoins, en parallèle.
   * @returns {Promise<{totalTvlUsd: number|null, tvlDate: number|null,
   *   stablecoinMcapUsd: number|null, stablecoinCount: number}>} TVL (USD),
   *   date du point TVL (ms epoch), market cap stablecoins (USD), nb d'actifs.
   */
  async fetchData() {
    const [tvlHistory, stablecoins] = await Promise.all([
      this.getJson("https://api.llama.fi/v2/historicalChainTvl"),
      this.getJson("https://stablecoins.llama.fi/stablecoins?includePrices=false"),
    ]);

    const lastTvlPoint = Array.isArray(tvlHistory) && tvlHistory.length ? tvlHistory[tvlHistory.length - 1] : null;

    const peggedAssets = Array.isArray(stablecoins?.peggedAssets) ? stablecoins.peggedAssets : [];
    const stablecoinMcapUsd = peggedAssets.reduce((sum, asset) => sum + (asset.circulating?.peggedUSD ?? 0), 0);

    return {
      totalTvlUsd: lastTvlPoint?.tvl ?? null,
      tvlDate: lastTvlPoint?.date ? Number(lastTvlPoint.date) * 1000 : null,
      stablecoinMcapUsd: stablecoinMcapUsd || null,
      stablecoinCount: peggedAssets.length,
    };
  }
}
