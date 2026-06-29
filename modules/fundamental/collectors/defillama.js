import { Collector } from "./base.js";

/**
 * DefiLlama — liquidité on-chain.
 * Sans clé, gratuit. Axe : onchain.
 *
 * Donne : TVL DeFi totale (dernier point) + offre totale de stablecoins
 * (somme du circulating peggedUSD) = pouvoir d'achat disponible.
 */
export class DefiLlamaCollector extends Collector {
  constructor() {
    super("defillama", { axis: "onchain" });
  }

  async fetchData() {
    const [tvlHistory, stablecoins] = await Promise.all([
      this.getJson("https://api.llama.fi/v2/historicalChainTvl"),
      this.getJson("https://stablecoins.llama.fi/stablecoins?includePrices=false"),
    ]);

    const lastTvl = Array.isArray(tvlHistory) && tvlHistory.length ? tvlHistory[tvlHistory.length - 1] : null;

    const assets = Array.isArray(stablecoins?.peggedAssets) ? stablecoins.peggedAssets : [];
    const stablecoinMcap = assets.reduce((sum, a) => sum + (a.circulating?.peggedUSD ?? 0), 0);

    return {
      totalTvlUsd: lastTvl?.tvl ?? null,
      tvlDate: lastTvl?.date ? Number(lastTvl.date) * 1000 : null,
      stablecoinMcapUsd: stablecoinMcap || null,
      stablecoinCount: assets.length,
    };
  }
}
