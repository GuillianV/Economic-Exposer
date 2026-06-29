import { Collector } from "./base.js";

/**
 * FRED (Federal Reserve, St. Louis) — macro US (+ FX, conditions, éco réelle).
 * Nécessite une clé gratuite : process.env.FRED_API_KEY. Axe : macro.
 * Tolérant par série (allSettled) : une série en panne n'affecte pas les autres.
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
  fedFunds: "FEDFUNDS",
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

export class FredCollector extends Collector {
  constructor() {
    super("fred", { axis: "macro" });
  }

  async #latest(seriesId, apiKey) {
    const url =
      `https://api.stlouisfed.org/fred/series/observations` +
      `?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=1`;
    const json = await this.getJson(url);
    const obs = json?.observations?.[0];
    if (!obs) return null;
    return { value: obs.value === "." ? null : Number(obs.value), date: obs.date };
  }

  async fetchData() {
    const apiKey = process.env.FRED_API_KEY;
    if (!apiKey) throw new Error("FRED_API_KEY absente du .env");

    const keys = Object.keys(SERIES);
    const settled = await Promise.allSettled(keys.map((k) => this.#latest(SERIES[k], apiKey)));
    const out = {};
    keys.forEach((k, i) => {
      out[k] = settled[i].status === "fulfilled" ? settled[i].value : null;
    });
    return out;
  }
}
