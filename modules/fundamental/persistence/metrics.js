/**
 * Extraction des métriques NUMÉRIQUES d'un world-state, à plat.
 * C'est ce qu'on historise (petit, stable) pour calculer les tendances.
 * Les champs textuels (news, manchettes) ne sont PAS persistés : l'IA les
 * lira en live au moment d'analyser.
 *
 * Chaque entrée = un accès défensif (optional chaining) -> null si la source
 * est stale/absente. L'ordre/les clés sont stables = format de stockage figé.
 */
export function extractMetrics(state) {
  const a = state?.axes ?? {};
  const sentiment = a.sentiment ?? {};
  const macro = a.macro ?? {};
  const commodities = a.commodities?.commodities ?? {};
  const markets = a.markets?.markets ?? {};
  const structure = a.structure?.coingecko ?? {};
  const defillama = a.onchain?.defillama ?? {};
  const chain = a.onchain?.["blockchain-info"] ?? {};
  const gdelt = a.geopolitics?.gdelt ?? {};
  const acled = a.geopolitics?.acled ?? {};

  const fg = sentiment["fear-greed"] ?? {};
  const fut = sentiment["binance-futures"] ?? {};
  const fred = macro.fred ?? {};

  const num = (v) => (Number.isFinite(v) ? v : null);

  return {
    // sentiment
    fearGreed: num(fg.value),
    funding: num(fut.lastFundingRate),
    openInterest: num(fut.openInterest),
    btcPrice: num(fut.markPrice) ?? num(chain.marketPriceUsd),
    // macro
    m2: num(fred.m2?.value),
    dxy: num(fred.dollarIndex?.value),
    yield10y: num(fred.yield10y?.value),
    fedFunds: num(fred.fedFunds?.value),
    cpi: num(fred.cpi?.value),
    // commodités
    wtiOil: num(commodities.wtiOil?.value),
    brentOil: num(commodities.brentOil?.value),
    natGas: num(commodities.natGas?.value),
    // marchés TradFi (cross-market)
    sp500: num(markets.sp500?.value),
    nasdaq: num(markets.nasdaq?.value),
    djia: num(markets.djia?.value),
    vix: num(markets.vix?.value),
    // structure crypto
    btcDominance: num(structure.btcDominance),
    ethBtcRatio: num(structure.ethBtcRatio),
    totalMarketCapUsd: num(structure.totalMarketCapUsd),
    // on-chain
    totalTvlUsd: num(defillama.totalTvlUsd),
    stablecoinMcapUsd: num(defillama.stablecoinMcapUsd),
    hashRate: num(chain.hashRate),
    // géopolitique (volumes = proxy d'intensité)
    gdeltHeadlines: num(gdelt.headlineCount),
    acledEvents: num(acled.totalEvents),
    acledFatalities: num(acled.totalFatalities),
  };
}

export const METRIC_KEYS = Object.keys(extractMetrics({}));
