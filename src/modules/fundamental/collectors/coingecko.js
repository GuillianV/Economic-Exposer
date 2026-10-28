import { Collector } from "./base.js";
import { logger } from "../../logs/index.js";

const VOLUME_MCAP_MAX_RATIO = 0.5; // ratio volume 24h / capitalisation totale : au-delà, volume non plausible (sain observé <= 0.14)

/**
 * Valide le volume 24h global contre la capitalisation totale : un volume
 * supérieur à la moitié de toute la capitalisation n'est pas plausible
 * (CoinGecko renvoie ponctuellement des volumes corrompus). Fonction PURE.
 * @param {number|null} volumeUsd Volume 24h global (USD).
 * @param {number|null} marketCapUsd Capitalisation totale (USD).
 * @returns {number|null} Le volume s'il est plausible, sinon null.
 */
export function sanitizeVolume(volumeUsd, marketCapUsd) {
  if (!Number.isFinite(volumeUsd) || !Number.isFinite(marketCapUsd)) return null;
  if (volumeUsd < 0) return null;
  const maxVolumeUsd = marketCapUsd * VOLUME_MCAP_MAX_RATIO;
  if (volumeUsd > maxVolumeUsd) return null;
  return volumeUsd;
}

/**
 * CoinGecko — structure de marché crypto. Axe : structure.
 * Clé "demo" optionnelle (process.env.COINGECKO_API_KEY) pour relever le quota.
 *
 * Donne : dominance BTC/ETH, market cap totale + variation 24h, ratio ETH/BTC,
 * et la force des alts via TOTAL2 (hors BTC) / TOTAL3 (hors BTC+ETH).
 */
export class CoinGeckoCollector extends Collector {
  /**
   * Initialise le collecteur et ses options.
   *
   */
  constructor() {
    super("coingecko", { axis: "structure" });
  }

  /**
   * Entêtes d'authentification si une clé démo est configurée.
   * @returns {object} Entêtes HTTP à joindre aux appels CoinGecko.
   */
  #headers() {
    const key = process.env.COINGECKO_API_KEY;
    return key ? { "x-cg-demo-api-key": key } : {};
  }

  /**
   * Interroge les endpoints globaux CoinGecko et normalise la structure de marché.
   * @returns {Promise<object>} Dominances, market caps (USD), ratio ETH/BTC.
   */
  async fetchData() {
    const headers = this.#headers();

    const [global, ethBtc] = await Promise.all([
      this.getJson("https://api.coingecko.com/api/v3/global", { headers }),
      this.getJson("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=btc", { headers }),
    ]);

    const marketData = global?.data ?? {};
    const totalMarketCapUsd = marketData.total_market_cap?.usd ?? null;
    const rawVolumeUsd = marketData.total_volume?.usd ?? null;
    const totalVolume24hUsd = sanitizeVolume(rawVolumeUsd, totalMarketCapUsd);
    if (rawVolumeUsd != null && totalVolume24hUsd == null) {
      logger.warn(`[coingecko] volume 24h rejeté (non plausible) : ${rawVolumeUsd} pour une capitalisation de ${totalMarketCapUsd}`);
    }
    const btcDominance = marketData.market_cap_percentage?.btc ?? null;
    const ethDominance = marketData.market_cap_percentage?.eth ?? null;

    // TOTAL2 = market cap hors BTC ; TOTAL3 = hors BTC+ETH (force des alts).
    let altMarketCapUsd = null;
    let total3MarketCapUsd = null;
    if (totalMarketCapUsd != null && btcDominance != null) {
      altMarketCapUsd = totalMarketCapUsd * (1 - btcDominance / 100);
      if (ethDominance != null) {
        total3MarketCapUsd = totalMarketCapUsd * (1 - (btcDominance + ethDominance) / 100);
      }
    }

    return {
      btcDominance,
      ethDominance,
      totalMarketCapUsd,
      totalVolume24hUsd,
      altMarketCapUsd,
      total3MarketCapUsd,
      marketCapChange24h: marketData.market_cap_change_percentage_24h_usd ?? null,
      ethBtcRatio: ethBtc?.ethereum?.btc ?? null,
    };
  }
}
