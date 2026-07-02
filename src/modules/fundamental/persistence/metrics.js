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
  const metals = a.commodities?.metals ?? {};
  const markets = a.markets?.markets ?? {};
  const cot = a.positioning?.["cftc-cot"] ?? {};
  const structure = a.structure?.coingecko ?? {};
  const defillama = a.onchain?.defillama ?? {};
  const chain = a.onchain?.["blockchain-info"] ?? {};
  const mempool = a.onchain?.mempool ?? {};
  const gdelt = a.geopolitics?.gdelt ?? {};
  const acled = a.geopolitics?.acled ?? {};

  const fg = sentiment["fear-greed"] ?? {};
  const fut = sentiment["binance-futures"] ?? {};
  const eth = fut.eth ?? {};
  const sol = fut.sol ?? {};
  const bnb = fut.bnb ?? {};
  const xrp = fut.xrp ?? {};
  const deribit = sentiment.deribit ?? {};
  const fred = macro.fred ?? {};
  const cotMk = cot.markets ?? {};

  const num = (v) => (Number.isFinite(v) ? v : null);

  return {
    // sentiment
    fearGreed: num(fg.value),
    funding: num(fut.lastFundingRate),
    openInterest: num(fut.openInterest),
    btcPrice: num(fut.markPrice) ?? num(chain.marketPriceUsd),
    dvol: num(deribit.dvol),
    btcSkew: num(deribit.btc?.skew),
    btcPutCall: num(deribit.btc?.putCallOI),
    ethDvol: num(deribit.eth?.dvol),
    ethSkew: num(deribit.eth?.skew),
    ethPutCall: num(deribit.eth?.putCallOI),
    // positionnement de la foule (Binance long/short BTC)
    longShortAccountRatio: num(fut.longShortAccountRatio),
    topTraderPositionRatio: num(fut.topPositionRatio),
    // ETH / SOL (breadth crypto)
    ethPrice: num(eth.markPrice),
    ethFunding: num(eth.lastFundingRate),
    ethOpenInterest: num(eth.openInterest),
    solPrice: num(sol.markPrice),
    solFunding: num(sol.lastFundingRate),
    solOpenInterest: num(sol.openInterest),
    bnbPrice: num(bnb.markPrice),
    bnbFunding: num(bnb.lastFundingRate),
    xrpPrice: num(xrp.markPrice),
    xrpFunding: num(xrp.lastFundingRate),
    // positionnement (CFTC COT) — BTC + multi-actifs (net spéculatif)
    cotHedgeFundsNet: num(cot.hedgeFundsNet),
    cotAssetMgrNet: num(cot.assetMgrNet),
    cotOpenInterest: num(cot.openInterest),
    cotEurNet: num(cotMk.eurFx?.specNet),
    cotJpyNet: num(cotMk.jpy?.specNet),
    cotGbpNet: num(cotMk.gbp?.specNet),
    cotSp500Net: num(cotMk.sp500?.specNet),
    cotNasdaqNet: num(cotMk.nasdaq?.specNet),
    cotGoldNet: num(cotMk.gold?.specNet),
    cotWtiNet: num(cotMk.wti?.specNet),
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
    cpiYoY: num(fred.cpi?.yoy), // inflation en RYTHME annuel (le niveau seul est un non-signal)
    pce: num(fred.pce?.value),
    pceYoY: num(fred.pce?.yoy),
    m2YoY: num(fred.m2?.yoy),
    retailSales: num(fred.retailSales?.value),
    retailSalesYoY: num(fred.retailSales?.yoy),
    // Attentes de politique monétaire (dérivée) : 2Y − Fed Funds. > 0 = le marché
    // ne price PAS de baisses (voire des hausses/prime) ; < 0 = baisses pricées.
    policySpread2y:
      num(fred.yield2y?.value) != null && num(fred.fedFunds?.value) != null
        ? Math.round((fred.yield2y.value - fred.fedFunds.value) * 100) / 100
        : null,
    consumerSentiment: num(fred.consumerSentiment?.value),
    unemployment: num(fred.unemployment?.value),
    foodPriceIndex: num(fred.foodPriceIndex?.value),
    // liquidité (Md$) — driver clé : Fed nette + globale (Fed+BCE+BoJ)
    netLiquidity: num(liquidity.netLiquidity?.value),
    fedBalanceSheet: num(liquidity.fedBalanceSheet?.value),
    reverseRepo: num(liquidity.reverseRepo?.value),
    tga: num(liquidity.tga?.value),
    ecbAssets: num(liquidity.ecbAssets?.value),
    bojAssets: num(liquidity.bojAssets?.value),
    globalLiquidity: num(liquidity.globalLiquidity?.value),
    // commodités
    wtiOil: num(commodities.wtiOil?.value),
    brentOil: num(commodities.brentOil?.value),
    natGas: num(commodities.natGas?.value),
    copper: num(commodities.copper?.value),
    wheat: num(commodities.wheat?.value),
    gold: num(metals.gold?.value),
    silver: num(metals.silver?.value),
    // marchés TradFi (cross-market)
    sp500: num(markets.sp500?.value),
    nasdaq: num(markets.nasdaq?.value),
    djia: num(markets.djia?.value),
    vix: num(markets.vix?.value),
    cboeSkew: num(markets.cboeSkew?.value),
    // structure crypto
    btcDominance: num(structure.btcDominance),
    ethBtcRatio: num(structure.ethBtcRatio),
    totalMarketCapUsd: num(structure.totalMarketCapUsd),
    totalVolume24hUsd: num(structure.totalVolume24hUsd),
    altMarketCapUsd: num(structure.altMarketCapUsd),
    total3MarketCapUsd: num(structure.total3MarketCapUsd),
    // on-chain
    totalTvlUsd: num(defillama.totalTvlUsd),
    stablecoinMcapUsd: num(defillama.stablecoinMcapUsd),
    hashRate: num(chain.hashRate),
    txCount24h: num(chain.nTx),
    mempoolFeeFast: num(mempool.feeFast),
    mempoolCount: num(mempool.mempoolCount),
    // géopolitique (volumes = proxy d'intensité)
    gdeltHeadlines: num(gdelt.headlineCount),
    acledEvents: num(acled.totalEvents),
    acledFatalities: num(acled.totalFatalities),
  };
}

export const METRIC_KEYS = Object.keys(extractMetrics({}));
