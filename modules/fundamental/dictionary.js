/**
 * DICTIONNAIRE de données — rend l'API AUTO-DESCRIPTIVE. Le sens des métriques
 * vivait dans le code de l'analyste ; on l'expose ici pour qu'un consommateur
 * (front, bot, pro ou néophyte) interprète /api/metrics et /api/trends sans lire
 * notre code.
 *
 * Pour chaque clé de métrique :
 *   label  — nom lisible (FR)
 *   unit   — unité ("index", "%", "Md$", "USD", "ratio", "contrats", "count"…)
 *   axis   — axe d'appartenance
 *   source — d'où vient la donnée
 *   sens   — comment LIRE une variation pour le risque (le plus important)
 */
export const METRIC_DICTIONARY = {
  // --- sentiment ---
  fearGreed: { label: "Fear & Greed Index", unit: "index 0-100", axis: "sentiment", source: "alternative.me", sens: "↑ = avidité (risk-on, prudence aux extrêmes hauts) ; ↓ = peur (capitulation possible aux extrêmes bas)" },
  funding: { label: "Funding rate BTC perp", unit: "ratio", axis: "sentiment", source: "Binance Futures", sens: "↑ très positif = longs en excès (risque de purge) ; négatif = shorts dominants" },
  openInterest: { label: "Open Interest BTC perp", unit: "BTC", axis: "sentiment", source: "Binance Futures", sens: "↑ = effet de levier croissant (volatilité potentielle accrue)" },
  btcPrice: { label: "Prix BTC", unit: "USD", axis: "sentiment", source: "Binance / blockchain.info", sens: "référence de prix (non prédictif)" },
  dvol: { label: "DVOL (vol. implicite BTC)", unit: "index", axis: "sentiment", source: "Deribit", sens: "↑ = stress/volatilité anticipée (≈ VIX crypto)" },
  longShortAccountRatio: { label: "Ratio long/short BTC (tous comptes)", unit: "ratio", axis: "sentiment", source: "Binance Futures", sens: "positionnement de la FOULE ; >1 = majorité long, extrême = risque de retournement (contrarian)" },
  topTraderPositionRatio: { label: "Ratio long/short BTC (gros traders)", unit: "ratio", axis: "sentiment", source: "Binance Futures", sens: "positionnement des GROS comptes ; une divergence avec la foule est instructive" },
  ethPrice: { label: "Prix ETH", unit: "USD", axis: "sentiment", source: "Binance Futures", sens: "référence (breadth crypto)" },
  ethFunding: { label: "Funding rate ETH perp", unit: "ratio", axis: "sentiment", source: "Binance Futures", sens: "même lecture que le funding BTC, pour ETH" },
  ethOpenInterest: { label: "Open Interest ETH perp", unit: "ETH", axis: "sentiment", source: "Binance Futures", sens: "levier sur ETH" },
  solPrice: { label: "Prix SOL", unit: "USD", axis: "sentiment", source: "Binance Futures", sens: "référence (breadth crypto, alt à fort beta)" },
  solFunding: { label: "Funding rate SOL perp", unit: "ratio", axis: "sentiment", source: "Binance Futures", sens: "appétit/levier sur SOL ; extrême = excès spéculatif" },
  solOpenInterest: { label: "Open Interest SOL perp", unit: "SOL", axis: "sentiment", source: "Binance Futures", sens: "levier sur SOL" },
  bnbPrice: { label: "Prix BNB", unit: "USD", axis: "sentiment", source: "Binance Futures", sens: "référence (breadth crypto)" },
  bnbFunding: { label: "Funding rate BNB perp", unit: "ratio", axis: "sentiment", source: "Binance Futures", sens: "appétit/levier sur BNB" },
  xrpPrice: { label: "Prix XRP", unit: "USD", axis: "sentiment", source: "Binance Futures", sens: "référence (breadth crypto, alt à fort beta)" },
  xrpFunding: { label: "Funding rate XRP perp", unit: "ratio", axis: "sentiment", source: "Binance Futures", sens: "appétit/levier sur XRP" },

  // --- positionnement (CFTC COT, net spéculatif = long - short) ---
  cotHedgeFundsNet: { label: "COT net spéculatif BTC (leveraged)", unit: "contrats", axis: "positioning", source: "CFTC", sens: "extrêmes = euphorie/capitulation (retournement possible)" },
  cotAssetMgrNet: { label: "COT net asset managers BTC", unit: "contrats", axis: "positioning", source: "CFTC", sens: "positionnement institutionnel de fond" },
  cotOpenInterest: { label: "COT open interest BTC", unit: "contrats", axis: "positioning", source: "CFTC", sens: "profondeur du marché futures réglementé" },
  cotEurNet: { label: "COT net spéculatif EUR", unit: "contrats", axis: "positioning", source: "CFTC", sens: "appétit/risque sur l'euro (proxy dollar)" },
  cotJpyNet: { label: "COT net spéculatif JPY", unit: "contrats", axis: "positioning", source: "CFTC", sens: "yen = baromètre risk-off / carry trades" },
  cotGbpNet: { label: "COT net spéculatif GBP", unit: "contrats", axis: "positioning", source: "CFTC", sens: "positionnement livre sterling" },
  cotSp500Net: { label: "COT net spéculatif S&P 500", unit: "contrats", axis: "positioning", source: "CFTC", sens: "extrême long = complaisance ; extrême short = couverture/peur" },
  cotNasdaqNet: { label: "COT net spéculatif Nasdaq-100", unit: "contrats", axis: "positioning", source: "CFTC", sens: "positionnement tech (corrèle au risk-on crypto)" },
  cotGoldNet: { label: "COT net spéculatif Or (managed money)", unit: "contrats", axis: "positioning", source: "CFTC", sens: "demande de valeur refuge / anticipation taux réels" },
  cotWtiNet: { label: "COT net spéculatif Pétrole WTI", unit: "contrats", axis: "positioning", source: "CFTC", sens: "anticipation croissance/inflation énergie" },

  // --- macro ---
  m2: { label: "Masse monétaire M2 (US)", unit: "Md$", axis: "macro", source: "FRED", sens: "↑ = liquidité abondante (soutien aux actifs)" },
  dxy: { label: "Dollar Index (large)", unit: "index", axis: "macro", source: "FRED", sens: "↑ dollar fort = conditions restrictives (vent de face pour le risque/BTC)" },
  eurusd: { label: "EUR/USD", unit: "taux", axis: "macro", source: "FRED", sens: "↓ = dollar fort" },
  usdjpy: { label: "USD/JPY", unit: "taux", axis: "macro", source: "FRED", sens: "↑ = yen faible (carry on) ; chute brutale = risk-off" },
  brlusd: { label: "BRL/USD", unit: "taux", axis: "macro", source: "FRED", sens: "devise émergente (appétit pour le risque EM)" },
  mxnusd: { label: "MXN/USD", unit: "taux", axis: "macro", source: "FRED", sens: "devise émergente (risque EM)" },
  inrusd: { label: "INR/USD", unit: "taux", axis: "macro", source: "FRED", sens: "devise émergente (risque EM)" },
  zarusd: { label: "ZAR/USD", unit: "taux", axis: "macro", source: "FRED", sens: "rand = baromètre risque EM très sensible" },
  yield2y: { label: "Taux US 2 ans", unit: "%", axis: "macro", source: "FRED", sens: "anticipations de politique Fed" },
  yield10y: { label: "Taux US 10 ans (nominal)", unit: "%", axis: "macro", source: "FRED", sens: "↑ = conditions plus restrictives" },
  realYield10y: { label: "Taux US 10 ans RÉEL", unit: "%", axis: "macro", source: "FRED", sens: "↑ pénalise fortement les actifs sans rendement (or, BTC)" },
  breakeven10y: { label: "Point mort d'inflation 10 ans", unit: "%", axis: "macro", source: "FRED", sens: "anticipation d'inflation du marché" },
  yieldCurve: { label: "Pente 10Y-2Y", unit: "points", axis: "macro", source: "FRED", sens: "<0 = inversion (signal historique de récession)" },
  fedFunds: { label: "Taux Fed Funds", unit: "%", axis: "macro", source: "FRED", sens: "taux directeur (↑ = restrictif)" },
  sofr: { label: "SOFR", unit: "%", axis: "macro", source: "FRED", sens: "coût du financement court terme (tensions de liquidité)" },
  mortgage30y: { label: "Taux hypothécaire 30 ans", unit: "%", axis: "macro", source: "FRED", sens: "transmission des taux à l'économie réelle" },
  highYieldSpread: { label: "Spread crédit High Yield", unit: "points de %", axis: "macro", source: "FRED", sens: "↑ = stress crédit / aversion au risque (vent de face majeur)" },
  financialConditions: { label: "Conditions financières (NFCI)", unit: "index", axis: "macro", source: "FRED", sens: ">0 = conditions plus serrées que la moyenne" },
  financialStress: { label: "Indice de stress financier (StLouis)", unit: "index", axis: "macro", source: "FRED", sens: ">0 = stress supérieur à la normale" },
  policyUncertainty: { label: "Incertitude politique éco (EPU)", unit: "index", axis: "macro", source: "FRED", sens: "↑ = incertitude (prime de risque accrue)" },
  cpi: { label: "Indice des prix CPI", unit: "index", axis: "macro", source: "FRED", sens: "inflation : ↑ surprise = pression haussière sur les taux" },
  pce: { label: "Indice des prix PCE", unit: "index", axis: "macro", source: "FRED", sens: "inflation préférée de la Fed" },
  retailSales: { label: "Ventes au détail", unit: "M$", axis: "macro", source: "FRED", sens: "vigueur de la demande (croissance)" },
  consumerSentiment: { label: "Confiance des ménages (UMich)", unit: "index", axis: "macro", source: "FRED", sens: "anticipation de consommation" },
  unemployment: { label: "Taux de chômage US", unit: "%", axis: "macro", source: "FRED", sens: "↑ = ralentissement (mais peut appeler des baisses de taux)" },
  foodPriceIndex: { label: "Indice prix alimentaires (IMF)", unit: "index", axis: "macro", source: "FRED", sens: "pression inflationniste / tension sociale" },

  // --- liquidité (driver clé) ---
  netLiquidity: { label: "Liquidité nette Fed (bilan − RRP − TGA)", unit: "Md$", axis: "liquidity", source: "FRED", sens: "↑ = soutien de fond au risque/BTC ; ↓ = vent de face structurel" },
  fedBalanceSheet: { label: "Bilan de la Fed (WALCL)", unit: "Md$", axis: "liquidity", source: "FRED", sens: "↑ = QE (soutien) ; ↓ = QT (drainage)" },
  reverseRepo: { label: "Reverse Repo (RRP)", unit: "Md$", axis: "liquidity", source: "FRED", sens: "↑ = liquidité immobilisée (retirée du système)" },
  tga: { label: "Compte du Trésor (TGA)", unit: "Md$", axis: "liquidity", source: "FRED", sens: "↑ = liquidité drainée vers le Trésor" },
  ecbAssets: { label: "Bilan BCE (en $)", unit: "Md$", axis: "liquidity", source: "FRED", sens: "composante euro de la liquidité globale" },
  bojAssets: { label: "Bilan BoJ (en $)", unit: "Md$", axis: "liquidity", source: "FRED", sens: "composante yen de la liquidité globale" },
  globalLiquidity: { label: "Liquidité GLOBALE (Fed+BCE+BoJ)", unit: "Md$", axis: "liquidity", source: "FRED", sens: "moteur de fond du BTC : ↑ soutient, ↓ pèse" },

  // --- commodités ---
  wtiOil: { label: "Pétrole WTI", unit: "USD/baril", axis: "commodities", source: "FRED", sens: "↑ = pression inflationniste / coût énergie" },
  brentOil: { label: "Pétrole Brent", unit: "USD/baril", axis: "commodities", source: "FRED", sens: "référence pétrole mondiale" },
  natGas: { label: "Gaz naturel (Henry Hub)", unit: "USD/MMBtu", axis: "commodities", source: "FRED", sens: "coût énergie (saisonnier, volatil)" },
  copper: { label: "Cuivre", unit: "USD", axis: "commodities", source: "FRED", sens: "baromètre de la croissance industrielle (Dr. Copper)" },
  wheat: { label: "Blé", unit: "USD", axis: "commodities", source: "FRED", sens: "inflation alimentaire / risque géopolitique" },
  gold: { label: "Or", unit: "USD/oz", axis: "commodities", source: "gold-api", sens: "valeur refuge ; ↑ souvent avec baisse des taux réels" },
  silver: { label: "Argent", unit: "USD/oz", axis: "commodities", source: "gold-api", sens: "refuge + demande industrielle" },

  // --- marchés TradFi ---
  sp500: { label: "S&P 500", unit: "index", axis: "markets", source: "FRED", sens: "baromètre risk-on actions (BTC y corrèle)" },
  nasdaq: { label: "Nasdaq Composite", unit: "index", axis: "markets", source: "FRED", sens: "tech/croissance (forte corrélation crypto)" },
  djia: { label: "Dow Jones", unit: "index", axis: "markets", source: "FRED", sens: "actions value/industrielles" },
  vix: { label: "VIX (peur actions)", unit: "index", axis: "markets", source: "FRED", sens: "↑ = peur (risk-off, corrèle inversement au BTC)" },

  // --- structure crypto ---
  btcDominance: { label: "Dominance BTC", unit: "%", axis: "structure", source: "CoinGecko", sens: "↑ = fuite vers BTC (défensif) ; ↓ = appétit alts (risk-on crypto)" },
  ethBtcRatio: { label: "Ratio ETH/BTC", unit: "ratio", axis: "structure", source: "CoinGecko", sens: "↑ = surperformance ETH (appétit risque crypto)" },
  totalMarketCapUsd: { label: "Cap. marché crypto totale", unit: "USD", axis: "structure", source: "CoinGecko", sens: "taille globale du marché" },
  totalVolume24hUsd: { label: "Volume crypto 24h", unit: "USD", axis: "structure", source: "CoinGecko", sens: "la CONVICTION derrière les mouvements : un prix qui bouge sans volume est suspect" },
  altMarketCapUsd: { label: "Cap. alts hors BTC (TOTAL2)", unit: "USD", axis: "structure", source: "CoinGecko", sens: "force des altcoins" },
  total3MarketCapUsd: { label: "Cap. hors BTC+ETH (TOTAL3)", unit: "USD", axis: "structure", source: "CoinGecko", sens: "spéculation sur les alts (risk-on extrême)" },

  // --- on-chain ---
  totalTvlUsd: { label: "TVL DeFi totale", unit: "USD", axis: "onchain", source: "DefiLlama", sens: "capitaux engagés en DeFi (appétit risque on-chain)" },
  stablecoinMcapUsd: { label: "Cap. stablecoins", unit: "USD", axis: "onchain", source: "DefiLlama", sens: "↑ = poudre sèche / liquidité crypto disponible" },
  hashRate: { label: "Hashrate Bitcoin", unit: "H/s", axis: "onchain", source: "blockchain.info", sens: "sécurité/engagement des mineurs (signal de fond lent)" },
  txCount24h: { label: "Transactions BTC (24h)", unit: "count", axis: "onchain", source: "blockchain.info", sens: "activité d'usage du réseau" },
  mempoolFeeFast: { label: "Frais BTC rapides", unit: "sat/vB", axis: "onchain", source: "mempool.space", sens: "↑ = congestion / forte demande de blockspace (activité réelle)" },
  mempoolCount: { label: "Transactions en attente (mempool)", unit: "count", axis: "onchain", source: "mempool.space", sens: "↑ = réseau congestionné (pic d'activité)" },

  // --- géopolitique (volumes = proxy d'intensité) ---
  gdeltHeadlines: { label: "Volume de manchettes conflit (GDELT)", unit: "count", axis: "geopolitics", source: "GDELT", sens: "↑ = tension géopolitique médiatique" },
  acledEvents: { label: "Événements de conflit (ACLED, 7j)", unit: "count", axis: "geopolitics", source: "ACLED", sens: "intensité des conflits armés" },
  acledFatalities: { label: "Morts liés aux conflits (ACLED, 7j)", unit: "count", axis: "geopolitics", source: "ACLED", sens: "gravité des conflits" },
};

/** Glossaire des termes clés — pour un consommateur néophyte. */
export const GLOSSARY = [
  { terme: "Risk-on / Risk-off", definition: "Régime où les investisseurs recherchent le risque (risk-on, favorable au BTC) ou le fuient vers des refuges (risk-off, défavorable)." },
  { terme: "Liquidité nette (Fed)", definition: "Bilan de la Fed moins le Reverse Repo et le compte du Trésor : l'argent réellement disponible dans le système. Driver de fond majeur du BTC." },
  { terme: "Liquidité globale", definition: "Somme des liquidités Fed + BCE + BoJ. Le BTC suit la liquidité mondiale, pas seulement américaine." },
  { terme: "Taux réel", definition: "Taux d'intérêt corrigé de l'inflation. Un taux réel qui monte pénalise les actifs sans rendement (or, BTC)." },
  { terme: "Courbe des taux (10Y-2Y)", definition: "Écart entre taux long et court. Négatif (inversion) = signal historique de récession à venir." },
  { terme: "Spread High Yield", definition: "Surcoût payé par les entreprises risquées pour emprunter. Son envolée signale un stress de crédit et l'aversion au risque." },
  { terme: "COT (positionnement)", definition: "Rapport hebdomadaire CFTC du positionnement des gros intervenants sur les futures. Les EXTRÊMES (euphorie/capitulation) sont le signal." },
  { terme: "Funding rate", definition: "Coût de portage des positions à effet de levier en crypto. Très positif = excès de longs (risque de purge)." },
  { terme: "DVOL", definition: "Volatilité implicite du BTC (l'équivalent crypto du VIX). En hausse = stress anticipé." },
  { terme: "VIX", definition: "Indice de la peur sur les actions US. En hausse = risk-off (corrèle inversement au BTC)." },
  { terme: "Dominance BTC", definition: "Part du BTC dans la capitalisation crypto totale. En baisse = appétit pour les altcoins (risk-on crypto)." },
  { terme: "TOTAL2 / TOTAL3", definition: "Capitalisation crypto hors BTC (TOTAL2) et hors BTC+ETH (TOTAL3). Mesure la force spéculative des alts." },
  { terme: "Surprise économique", definition: "Écart entre la donnée RÉELLE publiée et la PRÉVISION du consensus. C'est l'écart, pas le niveau, qui meut les marchés." },
  { terme: "Percentile (pXX/5a)", definition: "Position d'une valeur dans sa distribution sur ~5 ans. p<10 = extrême bas, p>90 = extrême haut — bien plus parlant qu'un niveau brut." },
  { terme: "Stablecoins (poudre sèche)", definition: "Capitaux en stablecoins prêts à être déployés. Leur hausse = liquidité crypto disponible pour acheter." },
];
