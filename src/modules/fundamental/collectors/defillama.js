import { Collector } from "./base.js";
import { logger } from "../../logs/index.js";

const MAX_STABLECOIN_ASSET_USD = 1e12; // USD : aucun stablecoin n'approche 1 000 Md$ (USDT ~180 Md$) — au-delà, donnée corrompue

/**
 * Somme l'offre en circulation des stablecoins (peggedUSD) en écartant les
 * actifs non plausibles : un seul actif corrompu faisait exploser le total
 * (5,18e16 $ le 20/08/2026). Une corruption modérée (< 1 000 Md$) passe : la
 * borne vise les valeurs absurdes. Fonction PURE.
 * @param {Array<object>} assets Actifs DefiLlama ({ name, circulating: { peggedUSD } }).
 * @returns {{totalUsd: number|null, rejected: Array<string>}} Total (USD, null
 *   si rien d'exploitable) et noms des actifs écartés.
 */
export function sumStablecoinSupply(assets) {
  let totalUsd = 0;
  const rejected = [];
  for (const asset of assets) {
    const supplyUsd = asset?.circulating?.peggedUSD;
    if (supplyUsd == null) continue;
    const isPlausible = Number.isFinite(supplyUsd) && supplyUsd >= 0 && supplyUsd <= MAX_STABLECOIN_ASSET_USD;
    if (!isPlausible) {
      rejected.push(asset?.name ?? "inconnu");
      continue;
    }
    totalUsd += supplyUsd;
  }
  return { totalUsd: totalUsd || null, rejected };
}

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
    const { totalUsd: stablecoinMcapUsd, rejected } = sumStablecoinSupply(peggedAssets);
    if (rejected.length) {
      logger.warn(`[defillama] stablecoins écartés (offre non plausible) : ${rejected.join(", ")}`);
    }

    return {
      totalTvlUsd: lastTvlPoint?.tvl ?? null,
      tvlDate: lastTvlPoint?.date ? Number(lastTvlPoint.date) * 1000 : null,
      stablecoinMcapUsd,
      stablecoinCount: peggedAssets.length,
    };
  }
}
