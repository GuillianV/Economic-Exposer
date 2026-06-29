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
  const liquidity = a.liquidity?.liquidity ?? {};
  const commodities = a.commodities?.commodities ?? {};
  const markets = a.markets?.markets ?? {};
  const cot = a.positioning?.["cftc-cot"] ?? {};
  const structure = a.structure?.coingecko ?? {};
  const defillama = a.onchain?.defillama ?? {};
  const chain = a.onchain?.["blockchain-info"] ?? {};
  const gdelt = a.geopolitics?.gdelt ?? {};
  const acled = a.geopolitics?.acled ?? {};

  const fg = sentiment["fear-greed"] ?? {};
  const fut = sentiment["binance-futures"] ?? {};
  const deribit = sentiment.deribit ?? {};
  const fred = macro.fred ?? {};

  const num = (v) => (Number.isFinite(v) ? v : null);

  return {
    // sentiment
    fearGreed: num(fg.value),
    funding: num(fut.lastFundingRate),
    openInterest: num(fut.openInterest),
    btcPrice: num(fut.markPrice) ?? num(chain.marketPriceUsd),
    dvol: num(deribit.dvol),
    // positionnement (CFTC COT)
    cotHedgeFundsNet: num(cot.hedgeFundsNet),
    cotAssetMgrNet: num(cot.assetMgrNet),
    cotOpenInterest: num(cot.openInterest),
    // macro
    m2: num(fred.m2?.value),
    dxy: num(fred.dollarIndex?.value),
    eurusd: num(fred.eurusd?.value),
    usdjpy: num(fred.usdjpy?.value),
    brlusd: num(fred.brlusd?.value),
    mxnusd: num(fred.mxnusd?.value),
    inrusd: num(fred.inrusd?.value),
    zarusd: num(fred.zarusd?.value),
    yield2y: num(fred.yield2y?.value),
    yield10y: num(fred.yield10y?.value),
    realYield10y: num(fred.realYield10y?.value),
    breakeven10y: num(fred.breakeven10y?.value),
    yieldCurve: num(fred.yieldCurve?.value),
    fedFunds: num(fred.fedFunds?.value),
    sofr: num(fred.sofr?.value),
    mortgage30y: num(fred.mortgage30y?.value),
    highYieldSpread: num(fred.highYieldSpread?.value),
    financialConditions: num(fred.financialConditions?.value),
    financialStress: num(fred.financialStress?.value),
    policyUncertainty: num(fred.policyUncertainty?.value),
    cpi: num(fred.cpi?.value),
    pce: num(fred.pce?.value),
    retailSales: num(fred.retailSales?.value),
    consumerSentiment: num(fred.consumerSentiment?.value),
    unemployment: num(fred.unemployment?.value),
    foodPriceIndex: num(fred.foodPriceIndex?.value),
    // liquidité nette (Md$) — driver clé
    netLiquidity: num(liquidity.netLiquidity?.value),
    fedBalanceSheet: num(liquidity.fedBalanceSheet?.value),
    reverseRepo: num(liquidity.reverseRepo?.value),
    tga: num(liquidity.tga?.value),
    // commodités
    wtiOil: num(commodities.wtiOil?.value),
    brentOil: num(commodities.brentOil?.value),
    natGas: num(commodities.natGas?.value),
    copper: num(commodities.copper?.value),
    wheat: num(commodities.wheat?.value),
    gold: num(commodities.gold?.value),
    silver: num(commodities.silver?.value),
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
