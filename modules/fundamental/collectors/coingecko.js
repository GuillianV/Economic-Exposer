import { Collector } from "./base.js";

/**
 * CoinGecko — structure de marché.
 * Clé "demo" optionnelle (process.env.COINGECKO_API_KEY) pour relever le quota.
 * Axe : structure.
 *
 * Donne : dominance BTC/ETH, market cap totale + variation 24h, ratio ETH/BTC.
 */
export class CoinGeckoCollector extends Collector {
  constructor() {
    super("coingecko", { axis: "structure" });
  }

  #headers() {
    const key = process.env.COINGECKO_API_KEY;
    return key ? { "x-cg-demo-api-key": key } : {};
  }

  async fetchData() {
    const headers = this.#headers();

    const [global, ethBtc] = await Promise.all([
      this.getJson("https://api.coingecko.com/api/v3/global", { headers }),
      this.getJson("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=btc", { headers }),
    ]);

    const g = global?.data ?? {};
    return {
      btcDominance: g.market_cap_percentage?.btc ?? null,
      ethDominance: g.market_cap_percentage?.eth ?? null,
      totalMarketCapUsd: g.total_market_cap?.usd ?? null,
      marketCapChange24h: g.market_cap_change_percentage_24h_usd ?? null,
      ethBtcRatio: ethBtc?.ethereum?.btc ?? null,
    };
  }
}
