import { logger } from "../logs/index.js";
import { FearGreedCollector } from "./collectors/fear-greed.js";
import { FredCollector } from "./collectors/fred.js";
import { CoinGeckoCollector } from "./collectors/coingecko.js";
import { DefiLlamaCollector } from "./collectors/defillama.js";
import { BinanceFuturesCollector } from "./collectors/binance-futures.js";
import { OnChainCollector } from "./collectors/onchain.js";
import { MempoolCollector } from "./collectors/mempool.js";
import { NewsCollector } from "./collectors/news.js";
import { InvestingCalendarCollector } from "./collectors/investing-calendar.js";
import { CommoditiesCollector } from "./collectors/commodities.js";
import { MarketsCollector } from "./collectors/markets.js";
import { MarketsLiveCollector } from "./collectors/markets-live.js";
import { LiquidityCollector } from "./collectors/liquidity.js";
import { GdeltCollector } from "./collectors/gdelt.js";
import { GoogleNewsCollector } from "./collectors/google-news.js";
import { DeribitCollector } from "./collectors/deribit.js";
import { CftcCotCollector } from "./collectors/cftc-cot.js";

/**
 * Liste des collecteurs :
 *   sentiment   : fear-greed, binance-futures, deribit (DVOL)
 *   positioning : cftc-cot (positionnement futures BTC : hedge funds / institutionnels)
 *   macro       : fred (taux, FX+EM, crédit, conditions/stress, incertitude, éco réelle, alimentaire), investing-calendar (calendrier riche scrapé, repli FairEconomy interne)
 *   liquidity   : liquidity (bilan Fed − RRP − TGA = liquidité nette)
 *   commodities : commodities (WTI/Brent/gaz/cuivre/blé/or/argent)
 *   markets     : markets (S&P500/Nasdaq/DJIA/VIX) — cross-market
 *   structure   : coingecko
 *   onchain     : defillama, blockchain-info, mempool (frais/congestion réseau BTC)
 *   geopolitics : gdelt (manchettes) — acled désactivé (accès API non accordé)
 *   news        : news (RSS), google-news (thématique)
 */
export function buildCollectors() {
  return [
    new FearGreedCollector(),
    new DeribitCollector(),
    new CftcCotCollector(),
    new FredCollector(),
    new InvestingCalendarCollector(),
    new LiquidityCollector(),
    new CommoditiesCollector(),
    new MarketsCollector(),
    new MarketsLiveCollector(),
    new CoinGeckoCollector(),
    new DefiLlamaCollector(),
    new BinanceFuturesCollector(),
    new OnChainCollector(),
    new MempoolCollector(),
    new GdeltCollector(),
    // ACLED désactivé (accès API non accordé à un compte perso → 403). La géopol
    // reste couverte par GDELT + news. Réactiver : remettre `new AcledCollector()`
    // (import en haut) une fois l'accès Research obtenu sur myACLED.
    new NewsCollector(),
    new GoogleNewsCollector(),
  ];
}

/**
 * Lance tous les collecteurs en parallèle et assemble un snapshot du
 * "monde", rangé par axe. Une source en panne devient `stale` sans casser
 * le reste.
 *
 * Forme renvoyée :
 * {
 *   ts,
 *   axes: { sentiment:{...}, macro:{...}, onchain:{...}, structure:{...} },
 *   sources: { <name>: { ok, stale, ts, error } },
 *   meta: { total, ok, stale, staleSources: [...] }
 * }
 */
export async function getWorldState(collectors = buildCollectors()) {
  const ts = Date.now();
  const results = await Promise.all(collectors.map((c) => c.collect()));

  const axes = {};
  const sources = {};
  const staleSources = [];

  for (const r of results) {
    const axis = r.axis ?? "misc";
    (axes[axis] ??= {})[r.source] = r.data;
    sources[r.source] = { ok: r.ok, stale: r.stale, ts: r.ts, error: r.error };
    if (r.stale) staleSources.push(r.source);
  }

  const state = {
    ts,
    axes,
    sources,
    meta: {
      total: results.length,
      ok: results.length - staleSources.length,
      stale: staleSources.length,
      staleSources,
    },
  };

  if (staleSources.length) {
    logger.warn(`[fundamental] world-state : ${staleSources.length}/${results.length} source(s) stale (${staleSources.join(", ")})`);
  } else {
    logger.info(`[fundamental] world-state : ${results.length}/${results.length} sources OK`);
  }

  return state;
}
