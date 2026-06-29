import { logger } from "../logs/index.js";
import { FearGreedCollector } from "./collectors/fear-greed.js";
import { FredCollector } from "./collectors/fred.js";
import { CoinGeckoCollector } from "./collectors/coingecko.js";
import { DefiLlamaCollector } from "./collectors/defillama.js";
import { BinanceFuturesCollector } from "./collectors/binance-futures.js";
import { OnChainCollector } from "./collectors/onchain.js";
import { NewsCollector } from "./collectors/news.js";
import { EconomicCalendarCollector } from "./collectors/economic-calendar.js";
import { CommoditiesCollector } from "./collectors/commodities.js";
import { MarketsCollector } from "./collectors/markets.js";
import { GdeltCollector } from "./collectors/gdelt.js";
import { AcledCollector } from "./collectors/acled.js";
import { GoogleNewsCollector } from "./collectors/google-news.js";

/**
 * Liste des collecteurs :
 *   sentiment   : fear-greed, binance-futures
 *   macro       : fred, economic-calendar
 *   commodities : commodities (WTI/Brent/gaz)
 *   markets     : markets (S&P500/Nasdaq/DJIA/VIX) — cross-market
 *   structure   : coingecko
 *   onchain     : defillama, blockchain-info
 *   geopolitics : gdelt (manchettes), acled (conflits structurés)
 *   news        : news (RSS), google-news (thématique)
 */
export function buildCollectors() {
  return [
    new FearGreedCollector(),
    new FredCollector(),
    new EconomicCalendarCollector(),
    new CommoditiesCollector(),
    new MarketsCollector(),
    new CoinGeckoCollector(),
    new DefiLlamaCollector(),
    new BinanceFuturesCollector(),
    new OnChainCollector(),
    new GdeltCollector(),
    new AcledCollector(),
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
