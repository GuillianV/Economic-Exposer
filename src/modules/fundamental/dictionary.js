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
  btcSkew: { label: "Skew options BTC (25Δ RR)", unit: "pts d'IV", axis: "sentiment", source: "Deribit", sens: "> 0 = puts chers = peur crash (contrarian haussier) ; < 0 = calls chers = euphorie" },
  btcPutCall: { label: "Put/Call BTC (OI)", unit: "ratio", axis: "sentiment", source: "Deribit", sens: "↑ = couverture/peur (positionnement défensif options)" },
  ethDvol: { label: "DVOL (vol. implicite ETH)", unit: "index", axis: "sentiment", source: "Deribit", sens: "↑ = stress/volatilité anticipée sur ETH" },
  ethSkew: { label: "Skew options ETH (25Δ RR)", unit: "pts d'IV", axis: "sentiment", source: "Deribit", sens: "> 0 = peur crash ETH ; divergence vs skew BTC = signal" },
  ethPutCall: { label: "Put/Call ETH (OI)", unit: "ratio", axis: "sentiment", source: "Deribit", sens: "↑ = couverture/peur options ETH" },
  btcBasisAnnualized: { label: "Basis futures BTC (annualisé)", unit: "%/an", axis: "sentiment", source: "Binance Futures (trimestriel)", sens: "contango >10%/an = euphorie/levier spéculatif ; proche de 0 = désintérêt ; négatif (backwardation) = capitulation/stress" },
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
  usdcny: { label: "USD/CNY (yuan)", unit: "taux", axis: "macro", source: "FRED", sens: "↑ (yuan qui dévalue) = stress Chine / dévaluation compétitive — historiquement corrélé aux fuites de capitaux vers BTC mais risk-off global" },
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
  cpiYoY: { label: "Inflation CPI (rythme annuel)", unit: "% YoY", axis: "macro", source: "FRED (dérivé)", sens: "LE rythme d'inflation : ↑ = pression sur les taux (vent de face risque) ; ↓ = désinflation (soutien)" },
  pce: { label: "Indice des prix PCE", unit: "index", axis: "macro", source: "FRED", sens: "inflation préférée de la Fed" },
  pceYoY: { label: "Inflation PCE (rythme annuel)", unit: "% YoY", axis: "macro", source: "FRED (dérivé)", sens: "rythme d'inflation préféré de la Fed ; pilote la politique monétaire" },
  m2YoY: { label: "Croissance M2 (rythme annuel)", unit: "% YoY", axis: "macro", source: "FRED (dérivé)", sens: "expansion monétaire en rythme : ↑ = impulsion de liquidité (historiquement favorable au BTC)" },
  retailSales: { label: "Ventes au détail", unit: "M$", axis: "macro", source: "FRED", sens: "vigueur de la demande (croissance)" },
  retailSalesYoY: { label: "Ventes au détail (rythme annuel)", unit: "% YoY", axis: "macro", source: "FRED (dérivé)", sens: "croissance réelle de la demande ; ↓ = ralentissement conso" },
  policySpread2y: { label: "Spread 2Y − Fed Funds", unit: "pts", axis: "macro", source: "FRED (dérivé)", sens: "attentes de politique monétaire : < 0 = baisses pricées ; > 0 = pas de baisses pricées (ou prime) — divergence avec une éco qui casse = signal fort" },
  consumerSentiment: { label: "Confiance des ménages (UMich)", unit: "index", axis: "macro", source: "FRED", sens: "anticipation de consommation" },
  unemployment: { label: "Taux de chômage US", unit: "%", axis: "macro", source: "FRED", sens: "↑ = ralentissement (mais peut appeler des baisses de taux)" },
  initialClaims: { label: "Inscriptions chômage (hebdo)", unit: "count", axis: "macro", source: "FRED (ICSA)", sens: "signal récession temps réel : tendance ↑ soutenue = marché du travail qui casse, visible AVANT le NFP mensuel" },
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
  gold: { label: "Or", unit: "USD/oz", axis: "commodities", source: "gold-api → Yahoo (COMEX)", sens: "valeur refuge ; ↑ souvent avec baisse des taux réels" },
  silver: { label: "Argent", unit: "USD/oz", axis: "commodities", source: "gold-api → Yahoo (COMEX)", sens: "refuge + demande industrielle" },

  // --- marchés TradFi ---
  sp500: { label: "S&P 500", unit: "index", axis: "markets", source: "FRED", sens: "baromètre risk-on actions (BTC y corrèle)" },
  nasdaq: { label: "Nasdaq Composite", unit: "index", axis: "markets", source: "FRED", sens: "tech/croissance (forte corrélation crypto)" },
  djia: { label: "Dow Jones", unit: "index", axis: "markets", source: "FRED", sens: "actions value/industrielles" },
  vix: { label: "VIX (peur actions)", unit: "index", axis: "markets", source: "FRED", sens: "↑ = peur (risk-off, corrèle inversement au BTC)" },
  cboeSkew: { label: "CBOE SKEW (tail risk actions)", unit: "index", axis: "markets", source: "CBOE (Yahoo)", sens: "↑ = demande de hedge crash sur le S&P (protection tail) ; extrême = nervosité institutionnelle" },
  move: { label: "MOVE (vol des taux US)", unit: "index", axis: "markets", source: "ICE BofAML (Yahoo)", sens: "le \"VIX des Treasuries\" : ↑ = stress obligataire ; MOVE haut + VIX bas = stress caché dans les taux, pas encore transmis aux actions" },

  // --- structure crypto ---
  btcDominance: { label: "Dominance BTC", unit: "%", axis: "structure", source: "CoinGecko", sens: "↑ = fuite vers BTC (défensif) ; ↓ = appétit alts (risk-on crypto)" },
  btcEtfFlowUsdM: { label: "Flux ETF spot BTC (jour)", unit: "M$", axis: "structure", source: "SoSoValue", sens: "l'ACHETEUR MARGINAL : entrées = demande institutionnelle réelle ; sorties massives = distribution" },
  btcEtfFlow7dUsdM: { label: "Flux ETF spot BTC (7j cumulés)", unit: "M$", axis: "structure", source: "SoSoValue", sens: "tendance de fond de la demande ETF, lisse le bruit quotidien" },
  ethEtfFlowUsdM: { label: "Flux ETF spot ETH (jour)", unit: "M$", axis: "structure", source: "SoSoValue", sens: "demande institutionnelle ETH ; divergence vs BTC = rotation" },
  ethEtfFlow7dUsdM: { label: "Flux ETF spot ETH (7j cumulés)", unit: "M$", axis: "structure", source: "SoSoValue", sens: "tendance de fond de la demande ETF ETH" },
  ethBtcRatio: { label: "Ratio ETH/BTC", unit: "ratio", axis: "structure", source: "CoinGecko", sens: "↑ = surperformance ETH (appétit risque crypto)" },
  totalMarketCapUsd: { label: "Cap. marché crypto totale", unit: "USD", axis: "structure", source: "CoinGecko", sens: "taille globale du marché" },
  totalVolume24hUsd: { label: "Volume crypto 24h", unit: "USD", axis: "structure", source: "CoinGecko", sens: "la CONVICTION derrière les mouvements : un prix qui bouge sans volume est suspect" },
  altMarketCapUsd: { label: "Cap. alts hors BTC (TOTAL2)", unit: "USD", axis: "structure", source: "CoinGecko", sens: "force des altcoins" },
  total3MarketCapUsd: { label: "Cap. hors BTC+ETH (TOTAL3)", unit: "USD", axis: "structure", source: "CoinGecko", sens: "spéculation sur les alts (risk-on extrême)" },
  fundingAgg: { label: "Funding agrégé (pondéré OI)", unit: "%", axis: "structure", source: "Coinglass (scrape)", sens: "coût de portage cross-exchange ; très positif = longs en excès (risque de purge)" },
  oiAgg: { label: "Open Interest agrégé", unit: "USD", axis: "structure", source: "Coinglass (scrape)", sens: "levier total dans le système ; ↑ = accumulation de levier (squeeze possible) ; ↓ = deleveraging sain" },
  lsRetailAgg: { label: "Long/short retail (agrégé)", unit: "ratio", axis: "structure", source: "Coinglass (scrape)", sens: "positionnement de la foule ; à lire en contrarian" },
  lsTopTraders: { label: "Long/short top-traders", unit: "ratio", axis: "structure", source: "Coinglass (scrape)", sens: "positionnement smart money ; à SUIVRE, divergence vs retail = signal" },
  liq24hUsd: { label: "Liquidations 24h (agrégées)", unit: "USD", axis: "structure", source: "Coinglass (scrape)", sens: "purges de levier récentes ; pic = capitulation/stress court terme" },
  whalesLongPct: { label: "Whales Hyperliquid (% long)", unit: "%", axis: "structure", source: "Coinglass/Hyperliquid (scrape)", sens: "positionnement des gros comptes ; corrobore les top-traders (smart money)" },

  // --- on-chain ---
  totalTvlUsd: { label: "TVL DeFi totale", unit: "USD", axis: "onchain", source: "DefiLlama", sens: "capitaux engagés en DeFi (appétit risque on-chain)" },
  stablecoinMcapUsd: { label: "Cap. stablecoins", unit: "USD", axis: "onchain", source: "DefiLlama", sens: "↑ = poudre sèche / liquidité crypto disponible" },
  hashRate: { label: "Hashrate Bitcoin", unit: "H/s", axis: "onchain", source: "blockchain.info", sens: "sécurité/engagement des mineurs (signal de fond lent)" },
  txCount24h: { label: "Transactions BTC (24h)", unit: "count", axis: "onchain", source: "blockchain.info", sens: "activité d'usage du réseau" },
  mempoolFeeFast: { label: "Frais BTC rapides", unit: "sat/vB", axis: "onchain", source: "mempool.space", sens: "↑ = congestion / forte demande de blockspace (activité réelle)" },
  mempoolCount: { label: "Transactions en attente (mempool)", unit: "count", axis: "onchain", source: "mempool.space", sens: "↑ = réseau congestionné (pic d'activité)" },

  // --- valorisation / cycle on-chain (V2) ---
  mvrvZ: { label: "MVRV Z-Score", unit: "z-score", axis: "onchain", source: "CoinMetrics (calc)", sens: "valorisation de cycle : < 0,1 = creux historique (accumulation) ; > 7 = sommet (distribution) — LE repère de cycle" },
  mvrv: { label: "MVRV", unit: "ratio", axis: "onchain", source: "CoinMetrics", sens: "cap marché / cap réalisée : < 1 = sous le coût de base (capitulation) ; > 3,2 = zones de sommet" },
  nupl: { label: "NUPL (profit latent net)", unit: "ratio", axis: "onchain", source: "CoinMetrics (dérivé)", sens: "sentiment du réseau : < 0 = capitulation ; > 0,75 = euphorie" },
  puell: { label: "Puell Multiple", unit: "ratio", axis: "onchain", source: "CoinMetrics (calc)", sens: "revenu mineurs / moyenne 365j : < 0,5 = revenu déprimé (accumulation) ; > 4 = sommet" },
  valuationPosition: { label: "Position de valorisation on-chain", unit: "0-100", axis: "onchain", source: "calc (MVRV+Puell)", sens: "jauge bon marché → cher : bas = accumulation, haut = surchauffe" },
  cyclePosition: { label: "Position de cycle (prix)", unit: "0-100", axis: "onchain", source: "calc (Mayer/Pi Cycle/200 sem)", sens: "où est le BTC dans son cycle de PRIX : bas = plancher, haut = sommet" },
  rhodl: { label: "RHODL Ratio", unit: "ratio", axis: "onchain", source: "BitcoinMagazinePro (scrape)", sens: "âge relatif des pièces : creux (~centaines) = accumulation ; sommet (~dizaines de milliers) = distribution" },
  reserveRisk: { label: "Reserve Risk", unit: "ratio", axis: "onchain", source: "BitcoinMagazinePro (scrape)", sens: "conviction des HODLers vs prix : < 0,002 = accumulation attractive ; > 0,02 = surévalué" },

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
  { terme: "MVRV Z-Score", definition: "Écart entre capitalisation de marché et capitalisation réalisée (coût de base), normalisé sur tout l'historique. Repère de cycle : creux historique en bas, sommet en haut." },
  { terme: "Prix réalisé", definition: "Coût de base moyen du réseau (prix moyen auquel les pièces ont bougé pour la dernière fois). Sert de support/résistance macro." },
  { terme: "Puell Multiple", definition: "Revenu quotidien des mineurs rapporté à sa moyenne annuelle. Bas = revenu déprimé (fond de cycle) ; haut = zones de sommet." },
  { terme: "RHODL / Reserve Risk", definition: "Indicateurs on-chain avancés (âge des pièces, conviction des HODLers) : bas = accumulation attractive, haut = distribution. Data BitcoinMagazinePro." },
  { terme: "FedWatch (probas FOMC)", definition: "Probabilités de décision de la Fed implicites dans les futures Fed Funds (ZQ) : le mouvement de taux pricé par le marché pour la prochaine réunion." },
  { terme: "Smart money (top-traders / whales)", definition: "Positionnement des gros comptes (top-traders Binance, whales Hyperliquid). À SUIVRE plutôt qu'à contrer ; une divergence avec la foule retail est un signal riche." },
  { terme: "Aimants de liquidation", definition: "Niveaux de prix concentrant de gros volumes de liquidation. Le marché tend à aller y chasser la liquidité (cibles de prix court terme)." },
];
