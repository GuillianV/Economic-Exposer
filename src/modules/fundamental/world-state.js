import { logger } from "../logs/index.js";
import { BinanceFuturesCollector } from "./collectors/binance-futures.js";
import { BmproCollector } from "./collectors/bmpro.js";
import { CftcCotCollector } from "./collectors/cftc-cot.js";
import { CoinGeckoCollector } from "./collectors/coingecko.js";
import { CoinglassDerivativesCollector } from "./collectors/coinglass-derivatives.js";
import { CoinglassLiquidationsCollector } from "./collectors/coinglass-liquidations.js";
import { CoinglassWhalesCollector } from "./collectors/coinglass-whales.js";
import { CommoditiesCollector } from "./collectors/commodities.js";
import { CycleCollector } from "./collectors/cycle.js";
import { DefiLlamaCollector } from "./collectors/defillama.js";
import { DeribitCollector } from "./collectors/deribit.js";
import { EtfFlowsCollector } from "./collectors/etf-flows.js";
import { FearGreedCollector } from "./collectors/fear-greed.js";
import { FedWatchCollector } from "./collectors/fedwatch.js";
import { FredCollector } from "./collectors/fred.js";
import { GdeltCollector } from "./collectors/gdelt.js";
import { GoogleNewsCollector } from "./collectors/google-news.js";
import { LiquidityCollector } from "./collectors/liquidity.js";
import { MarketsLiveCollector } from "./collectors/markets-live.js";
import { MarketsCollector } from "./collectors/markets.js";
import { MempoolCollector } from "./collectors/mempool.js";
import { MetalsCollector } from "./collectors/metals.js";
import { NasdaqCalendarCollector } from "./collectors/nasdaq-calendar.js";
import { NewsCollector } from "./collectors/news.js";
import { OnChainValuationCollector } from "./collectors/onchain-valuation.js";
import { OnChainCollector } from "./collectors/onchain.js";

/**
 * Instancie la liste complète des collecteurs, par axe :
 *   sentiment   : fear-greed, binance-futures, deribit (DVOL)
 *   positioning : cftc-cot (positionnement futures BTC : hedge funds / institutionnels)
 *   macro       : fred (taux, FX+EM, crédit, conditions/stress, incertitude, éco réelle, alimentaire), fedwatch (probas de décision Fed via futures ZQ), nasdaq-calendar (calendrier riche API nasdaq avec réel, repli FairEconomy interne)
 *   liquidity   : liquidity (bilan Fed − RRP − TGA = liquidité nette)
 *   commodities : commodities (WTI/Brent/gaz/cuivre/blé FRED) + metals (or/argent, gold-api→Yahoo)
 *   markets     : markets (S&P500/Nasdaq/DJIA/VIX) — cross-market
 *   structure   : coingecko, etf-flows (flux ETF spot US BTC/ETH — l'acheteur marginal), derivatives (funding/OI/long-short/liquidations 24h Coinglass), liquidations (niveaux/aimants de liquidation Coinglass), whales (positionnement gros comptes Hyperliquid) — trois derniers via scrape navigateur découplé
 *   onchain     : defillama, blockchain-info, mempool (frais/congestion réseau BTC), cycle (Mayer/Pi Cycle/200 sem — position de cycle BTC prix), valuation (MVRV/NUPL/prix réalisé/Puell — valorisation realized-cap, CoinMetrics), bmpro (RHODL/Reserve Risk — cycle BitcoinMagazinePro via scrape navigateur)
 *   geopolitics : gdelt (manchettes conflit, dataset ngrams statique) — acled désactivé (accès API non accordé)
 *   news        : news (RSS), google-news (thématique)
 * @returns {Array<object>} Collecteurs prêts à l'emploi.
 */
export function buildCollectors() {
  return [
    new FearGreedCollector(),
    new DeribitCollector(),
    new CftcCotCollector(),
    new FredCollector(),
    new FedWatchCollector(),
    new NasdaqCalendarCollector(),
    new LiquidityCollector(),
    new CommoditiesCollector(),
    new MetalsCollector(),
    new MarketsCollector(),
    new MarketsLiveCollector(),
    new CoinGeckoCollector(),
    new CoinglassDerivativesCollector(),
    new CoinglassLiquidationsCollector(),
    new CoinglassWhalesCollector(),
    new EtfFlowsCollector(),
    new DefiLlamaCollector(),
    new BinanceFuturesCollector(),
    new OnChainCollector(),
    new MempoolCollector(),
    new CycleCollector(),
    new OnChainValuationCollector(),
    new BmproCollector(),
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
 * @param {Array<object>} [collectors] Collecteurs à interroger (défaut :
 *   buildCollectors()).
 * @returns {Promise<{ts: number, axes: object, sources: object,
 *   meta: {total: number, ok: number, stale: number,
 *   staleSources: Array<string>}}>} World-state complet
 *   (axes = { sentiment: {...}, macro: {...}, … },
 *   sources = { nom: { ok, stale, ts, error } }).
 */
export async function getWorldState(collectors = buildCollectors()) {
  const ts = Date.now();
  const results = await Promise.all(collectors.map((collector) => collector.collect()));

  const axes = {};
  const sources = {};
  const staleSources = [];

  for (const result of results) {
    const axis = result.axis ?? "misc";
    (axes[axis] ??= {})[result.source] = result.data;
    sources[result.source] = { ok: result.ok, stale: result.stale, ts: result.ts, error: result.error };
    if (result.stale) staleSources.push(result.source);
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
