/**
 * Extraction des métriques NUMÉRIQUES d'un world-state, à plat.
 * C'est ce qu'on historise (petit, stable) pour calculer les tendances.
 * Les champs textuels (news, manchettes) ne sont PAS persistés : l'IA les
 * lira en live au moment d'analyser.
 *
 * Chaque entrée = un accès défensif (optional chaining) -> null si la source
 * est stale/absente. L'ordre/les clés sont stables = format de stockage figé.
 */

/**
 * Garde un nombre fini, sinon null.
 * @param {*} value Valeur candidate.
 * @returns {number|null} Nombre fini ou null.
 */
function toFiniteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

/**
 * Spread 2Y − Fed Funds arrondi à 2 décimales : > 0 = le marché ne price PAS
 * de baisses (voire des hausses/prime) ; < 0 = baisses pricées.
 * @param {object} fred Bloc FRED du world-state.
 * @returns {number|null} Spread en points, ou null si une jambe manque.
 */
function policySpread(fred) {
  const yield2y = toFiniteNumber(fred.yield2y?.value);
  const fedFunds = toFiniteNumber(fred.fedFunds?.value);
  if (yield2y == null || fedFunds == null) return null;
  return Math.round((yield2y - fedFunds) * 100) / 100;
}

/**
 * Aplati un world-state en métriques numériques stables (clés figées).
 * @param {object} state World-state complet ({ axes, … }).
 * @returns {object} Dictionnaire { métrique: nombre|null } — mêmes clés à
 *   chaque appel (format de stockage).
 */
export function extractMetrics(state) {
  const axes = state?.axes ?? {};
  const sentiment = axes.sentiment ?? {};
  const macro = axes.macro ?? {};
  const liquidity = axes.liquidity?.liquidity ?? {};
  const commodities = axes.commodities?.commodities ?? {};
  const metals = axes.commodities?.metals ?? {};
  const markets = axes.markets?.markets ?? {};
  const cot = axes.positioning?.["cftc-cot"] ?? {};
  const structure = axes.structure?.coingecko ?? {};
  const etf = axes.structure?.["etf-flows"] ?? {};
  const defillama = axes.onchain?.defillama ?? {};
  const chain = axes.onchain?.["blockchain-info"] ?? {};
  const mempool = axes.onchain?.mempool ?? {};
  const valuation = axes.onchain?.valuation ?? {};
  const cycle = axes.onchain?.cycle ?? {};
  const bmpro = axes.onchain?.bmpro ?? {};
  const derivatives = axes.structure?.derivatives ?? {};
  const whales = axes.structure?.whales ?? {};
  const gdelt = axes.geopolitics?.gdelt ?? {};
  const acled = axes.geopolitics?.acled ?? {};

  const fearGreed = sentiment["fear-greed"] ?? {};
  const futures = sentiment["binance-futures"] ?? {};
  const eth = futures.eth ?? {};
  const sol = futures.sol ?? {};
  const bnb = futures.bnb ?? {};
  const xrp = futures.xrp ?? {};
  const deribit = sentiment.deribit ?? {};
  const fred = macro.fred ?? {};
  const cotMarkets = cot.markets ?? {};

  const copper = toFiniteNumber(commodities.copper?.value);
  const gold = toFiniteNumber(metals.gold?.value);
  // Ratio Cuivre/Or : baromètre croissance-vs-peur (Dr Copper industriel /
  // refuge). Échelle arbitraire (unités hétérogènes) — c'est la TENDANCE qui
  // porte le signal : ↑ = réflation/appétit risque, ↓ = fuite vers le refuge.
  const copperGoldRatio = copper != null && gold ? copper / gold : null;

  return {
    // sentiment
    fearGreed: toFiniteNumber(fearGreed.value),
    funding: toFiniteNumber(futures.lastFundingRate),
    openInterest: toFiniteNumber(futures.openInterest),
    btcPrice: toFiniteNumber(futures.markPrice) ?? toFiniteNumber(chain.marketPriceUsd),
    dvol: toFiniteNumber(deribit.dvol),
    btcSkew: toFiniteNumber(deribit.btc?.skew),
    btcPutCall: toFiniteNumber(deribit.btc?.putCallOI),
    ethDvol: toFiniteNumber(deribit.eth?.dvol),
    ethSkew: toFiniteNumber(deribit.eth?.skew),
    ethPutCall: toFiniteNumber(deribit.eth?.putCallOI),
    // positionnement de la foule (Binance long/short BTC)
    longShortAccountRatio: toFiniteNumber(futures.longShortAccountRatio),
    topTraderPositionRatio: toFiniteNumber(futures.topPositionRatio),
    btcBasisAnnualized: toFiniteNumber(futures.basis?.annualizedPct), // basis trimestriel annualisé (%) — levier/demande spéculative
    // ETH / SOL (breadth crypto)
    ethPrice: toFiniteNumber(eth.markPrice),
    ethFunding: toFiniteNumber(eth.lastFundingRate),
    ethOpenInterest: toFiniteNumber(eth.openInterest),
    solPrice: toFiniteNumber(sol.markPrice),
    solFunding: toFiniteNumber(sol.lastFundingRate),
    solOpenInterest: toFiniteNumber(sol.openInterest),
    bnbPrice: toFiniteNumber(bnb.markPrice),
    bnbFunding: toFiniteNumber(bnb.lastFundingRate),
    xrpPrice: toFiniteNumber(xrp.markPrice),
    xrpFunding: toFiniteNumber(xrp.lastFundingRate),
    // positionnement (CFTC COT) — BTC + multi-actifs (net spéculatif)
    cotHedgeFundsNet: toFiniteNumber(cot.hedgeFundsNet),
    cotAssetMgrNet: toFiniteNumber(cot.assetMgrNet),
    cotOpenInterest: toFiniteNumber(cot.openInterest),
    cotEurNet: toFiniteNumber(cotMarkets.eurFx?.specNet),
    cotJpyNet: toFiniteNumber(cotMarkets.jpy?.specNet),
    cotGbpNet: toFiniteNumber(cotMarkets.gbp?.specNet),
    cotSp500Net: toFiniteNumber(cotMarkets.sp500?.specNet),
    cotNasdaqNet: toFiniteNumber(cotMarkets.nasdaq?.specNet),
    cotGoldNet: toFiniteNumber(cotMarkets.gold?.specNet),
    cotWtiNet: toFiniteNumber(cotMarkets.wti?.specNet),
    // macro
    m2: toFiniteNumber(fred.m2?.value),
    dxy: toFiniteNumber(fred.dollarIndex?.value),
    eurusd: toFiniteNumber(fred.eurusd?.value),
    usdjpy: toFiniteNumber(fred.usdjpy?.value),
    brlusd: toFiniteNumber(fred.brlusd?.value),
    mxnusd: toFiniteNumber(fred.mxnusd?.value),
    inrusd: toFiniteNumber(fred.inrusd?.value),
    zarusd: toFiniteNumber(fred.zarusd?.value),
    usdcny: toFiniteNumber(fred.usdcny?.value), // yuan : dévaluation = stress/dévaluation compétitive Chine
    yield2y: toFiniteNumber(fred.yield2y?.value),
    yield10y: toFiniteNumber(fred.yield10y?.value),
    realYield10y: toFiniteNumber(fred.realYield10y?.value),
    breakeven10y: toFiniteNumber(fred.breakeven10y?.value),
    yieldCurve: toFiniteNumber(fred.yieldCurve?.value),
    fedFunds: toFiniteNumber(fred.fedFunds?.value),
    sofr: toFiniteNumber(fred.sofr?.value),
    mortgage30y: toFiniteNumber(fred.mortgage30y?.value),
    highYieldSpread: toFiniteNumber(fred.highYieldSpread?.value),
    financialConditions: toFiniteNumber(fred.financialConditions?.value),
    financialStress: toFiniteNumber(fred.financialStress?.value),
    policyUncertainty: toFiniteNumber(fred.policyUncertainty?.value),
    cpi: toFiniteNumber(fred.cpi?.value),
    cpiYoY: toFiniteNumber(fred.cpi?.yoy), // inflation en RYTHME annuel (le niveau seul est un non-signal)
    pce: toFiniteNumber(fred.pce?.value),
    pceYoY: toFiniteNumber(fred.pce?.yoy),
    m2YoY: toFiniteNumber(fred.m2?.yoy),
    retailSales: toFiniteNumber(fred.retailSales?.value),
    retailSalesYoY: toFiniteNumber(fred.retailSales?.yoy),
    policySpread2y: policySpread(fred),
    consumerSentiment: toFiniteNumber(fred.consumerSentiment?.value),
    unemployment: toFiniteNumber(fred.unemployment?.value),
    initialClaims: toFiniteNumber(fred.initialClaims?.value), // hebdo — signal récession temps réel

    foodPriceIndex: toFiniteNumber(fred.foodPriceIndex?.value),
    // liquidité (Md$) — driver clé : Fed nette + globale (Fed+BCE+BoJ)
    netLiquidity: toFiniteNumber(liquidity.netLiquidity?.value),
    fedBalanceSheet: toFiniteNumber(liquidity.fedBalanceSheet?.value),
    reverseRepo: toFiniteNumber(liquidity.reverseRepo?.value),
    tga: toFiniteNumber(liquidity.tga?.value),
    ecbAssets: toFiniteNumber(liquidity.ecbAssets?.value),
    bojAssets: toFiniteNumber(liquidity.bojAssets?.value),
    globalLiquidity: toFiniteNumber(liquidity.globalLiquidity?.value),
    // commodités
    wtiOil: toFiniteNumber(commodities.wtiOil?.value),
    brentOil: toFiniteNumber(commodities.brentOil?.value),
    natGas: toFiniteNumber(commodities.natGas?.value),
    copper,
    wheat: toFiniteNumber(commodities.wheat?.value),
    gold,
    silver: toFiniteNumber(metals.silver?.value),
    copperGoldRatio, // baromètre croissance-vs-peur ; lire la tendance, pas le niveau
    // marchés TradFi (cross-market)
    sp500: toFiniteNumber(markets.sp500?.value),
    nasdaq: toFiniteNumber(markets.nasdaq?.value),
    djia: toFiniteNumber(markets.djia?.value),
    vix: toFiniteNumber(markets.vix?.value),
    cboeSkew: toFiniteNumber(markets.cboeSkew?.value),
    move: toFiniteNumber(markets.move?.value), // vol implicite Treasuries — le "VIX des taux"
    // structure crypto
    btcDominance: toFiniteNumber(structure.btcDominance),
    btcEtfFlowUsdM: toFiniteNumber(etf.btc?.dayFlowUsdM), // flux net ETF spot BTC du dernier jour (M$)
    btcEtfFlow7dUsdM: toFiniteNumber(etf.btc?.flow7dUsdM),
    ethEtfFlowUsdM: toFiniteNumber(etf.eth?.dayFlowUsdM),
    ethEtfFlow7dUsdM: toFiniteNumber(etf.eth?.flow7dUsdM),
    ethBtcRatio: toFiniteNumber(structure.ethBtcRatio),
    totalMarketCapUsd: toFiniteNumber(structure.totalMarketCapUsd),
    totalVolume24hUsd: toFiniteNumber(structure.totalVolume24hUsd),
    altMarketCapUsd: toFiniteNumber(structure.altMarketCapUsd),
    total3MarketCapUsd: toFiniteNumber(structure.total3MarketCapUsd),
    // on-chain
    totalTvlUsd: toFiniteNumber(defillama.totalTvlUsd),
    stablecoinMcapUsd: toFiniteNumber(defillama.stablecoinMcapUsd),
    hashRate: toFiniteNumber(chain.hashRate),
    txCount24h: toFiniteNumber(chain.nTx),
    mempoolFeeFast: toFiniteNumber(mempool.feeFast),
    mempoolCount: toFiniteNumber(mempool.mempoolCount),
    // valorisation / cycle on-chain (V2)
    mvrvZ: toFiniteNumber(valuation.mvrvZ?.valeur),
    mvrv: toFiniteNumber(valuation.mvrv?.valeur),
    nupl: toFiniteNumber(valuation.nupl?.valeur),
    puell: toFiniteNumber(valuation.puell?.valeur),
    valuationPosition: toFiniteNumber(valuation.position),
    cyclePosition: toFiniteNumber(cycle.position),
    rhodl: toFiniteNumber(bmpro.rhodl?.valeur),
    reserveRisk: toFiniteNumber(bmpro.reserveRisk?.valeur),
    // dérivés agrégés Coinglass (V2) — funding pondéré OI, OI total, long/short, liquidations 24h
    fundingAgg: toFiniteNumber(derivatives.fundingPct),
    oiAgg: toFiniteNumber(derivatives.openInterestUsd),
    lsRetailAgg: toFiniteNumber(derivatives.longShortRatio),
    lsTopTraders: toFiniteNumber(derivatives.longShortTopTraders),
    liq24hUsd: toFiniteNumber(derivatives.liquidations24h?.totalUsd),
    whalesLongPct: toFiniteNumber(whales.longPct),
    // géopolitique (volumes = proxy d'intensité)
    gdeltHeadlines: toFiniteNumber(gdelt.headlineCount),
    acledEvents: toFiniteNumber(acled.totalEvents),
    acledFatalities: toFiniteNumber(acled.totalFatalities),
  };
}

/** Clés stables du format de stockage (dérivées d'une extraction à vide). */
export const METRIC_KEYS = Object.keys(extractMetrics({}));
