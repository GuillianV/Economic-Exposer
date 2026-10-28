import { Collector } from "./base.js";
import { settleFredSeries } from "./fred-client.js";

/**
 * FRED (Federal Reserve, St. Louis) — macro US (+ FX, conditions, éco réelle).
 * Nécessite une clé gratuite : process.env.FRED_API_KEY. Axe : macro.
 * Tolérant par série (relance, log et repli : voir fred-client.js) : une série
 * en panne n'affecte pas les autres.
 */
const SERIES = {
  // monétaire
  m2: "M2SL",
  // dollar & FX (majeures + émergents)
  dollarIndex: "DTWEXBGS", // indice dollar large (proxy DXY)
  eurusd: "DEXUSEU",
  usdjpy: "DEXJPUS",
  usdcny: "DEXCHUS",
  brlusd: "DEXBZUS", // Brésil (EM)
  mxnusd: "DEXMXUS", // Mexique (EM)
  inrusd: "DEXINUS", // Inde (EM)
  zarusd: "DEXSFUS", // Afrique du Sud (EM)
  // taux
  yield2y: "DGS2",
  yield10y: "DGS10",
  realYield10y: "DFII10", // taux réel 10 ans (TIPS)
  breakeven10y: "T10YIE", // point mort d'inflation 10 ans
  yieldCurve: "T10Y2Y", // spread 10Y-2Y (signal récession)
  fedFunds: "DFF", // taux effectif QUOTIDIEN (pas FEDFUNDS, moyenne mensuelle retardée)
  sofr: "SOFR", // taux court garanti
  mortgage30y: "MORTGAGE30US",
  // crédit & conditions financières
  highYieldSpread: "BAMLH0A0HYM2",
  financialConditions: "NFCI", // Chicago Fed (négatif = conditions souples)
  financialStress: "STLFSI4", // St Louis Financial Stress
  policyUncertainty: "USEPUINDXD", // Economic Policy Uncertainty (quotidien)
  // économie réelle
  cpi: "CPIAUCSL",
  pce: "PCEPI", // inflation préférée de la Fed
  retailSales: "RSAFS",
  consumerSentiment: "UMCSENT",
  unemployment: "UNRATE",
  initialClaims: "ICSA",
  // alimentaire (coût de la vie / tensions)
  foodPriceIndex: "PFOODINDEXM", // IMF Global Food Price Index
};

// Séries mensuelles en NIVEAU (index/accumulateur) : le niveau seul est un
// non-signal, on calcule aussi le rythme annuel YoY % (la lecture macro utile).
const YOY_KEYS = new Set(["cpi", "pce", "m2", "retailSales"]);

/**
 *
 */
export class FredCollector extends Collector {
  /**
   * Initialise le collecteur et ses options.
   *
   */
  constructor() {
    super("fred", { axis: "macro" });
  }

  /**
   * Récupère toutes les séries en parallèle (relance, log et repli par série :
   * voir fred-client.js).
   * @returns {Promise<object>} Une entrée par clé de SERIES ({value, date,
   *   yoy?, cached?} ou null si la série a échoué sans repli).
   * @throws {Error} Si la clé FRED est absente ou si toutes les séries échouent.
   */
  async fetchData() {
    const apiKey = process.env.FRED_API_KEY;
    if (!apiKey) throw new Error("FRED_API_KEY absente du .env");

    return settleFredSeries(SERIES, apiKey, (url) => this.getJson(url), { source: "fred", yoyKeys: YOY_KEYS });
  }
}
