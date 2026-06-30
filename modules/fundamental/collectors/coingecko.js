import { Collector } from "./base.js";

/**
 * CoinGecko — structure de marché.
 * Clé "demo" optionnelle (process.env.COINGECKO_API_KEY) pour relever le quota.
 * Axe : structure.
 *
 * Donne : dominance BTC/ETH, market cap totale + variation 24h, ratio ETH/BTC,
 * et la force des alts via TOTAL2 (hors BTC) / TOTAL3 (hors BTC+ETH).
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
    const total = g.total_market_cap?.usd ?? null;
    const totalVolume = g.total_volume?.usd ?? null; // volume 24h global = conviction
    const btcDom = g.market_cap_percentage?.btc ?? null;
    const ethDom = g.market_cap_percentage?.eth ?? null;

    // TOTAL2 = mcap hors BTC ; TOTAL3 = hors BTC+ETH (force des alts).
    const altMarketCapUsd = total != null && btcDom != null ? total * (1 - btcDom / 100) : null;
    const total3MarketCapUsd = total != null && btcDom != null && ethDom != null ? total * (1 - (btcDom + ethDom) / 100) : null;

    return {
      btcDominance: btcDom,
      ethDominance: ethDom,
      totalMarketCapUsd: total,
      totalVolume24hUsd: totalVolume,
      altMarketCapUsd,
      total3MarketCapUsd,
      marketCapChange24h: g.market_cap_change_percentage_24h_usd ?? null,
      ethBtcRatio: ethBtc?.ethereum?.btc ?? null,
    };
  }
}
