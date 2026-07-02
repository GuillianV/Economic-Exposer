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

// Séries mensuelles en NIVEAU (index/accumulateur) : le niveau seul est un
// non-signal (toujours au plus haut). On calcule aussi le RYTHME annuel (YoY %),
// qui est LA lecture macro utile (inflation en rythme, croissance monétaire…).
const YOY_KEYS = new Set(["cpi", "pce", "m2", "retailSales"]);

export class FredCollector extends Collector {
  constructor() {
    super("fred", { axis: "macro" });
  }

  async #latest(seriesId, apiKey, { yoy = false } = {}) {
    const limit = yoy ? 14 : 1; // 14 obs mensuelles = de quoi trouver le même mois N-1
    const url =
      `https://api.stlouisfed.org/fred/series/observations` +
      `?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=${limit}`;
    const json = await this.getJson(url);
    const all = (json?.observations || []).filter((o) => o.value !== ".");
    const obs = all[0];
    if (!obs) return null;
    const res = { value: Number(obs.value), date: obs.date };
    if (yoy) {
      // même mois un an plus tôt (match AAAA-MM ; repli : 12e observation)
      const target = `${Number(obs.date.slice(0, 4)) - 1}${obs.date.slice(4, 7)}`;
      const prev = all.find((o) => o.date.startsWith(target)) ?? all[12];
      const pv = prev ? Number(prev.value) : null;
      res.yoy = pv ? Math.round(((res.value / pv - 1) * 100) * 100) / 100 : null;
    }
    return res;
  }

  async fetchData() {
    const apiKey = process.env.FRED_API_KEY;
    if (!apiKey) throw new Error("FRED_API_KEY absente du .env");

    const keys = Object.keys(SERIES);
    const settled = await Promise.allSettled(keys.map((k) => this.#latest(SERIES[k], apiKey, { yoy: YOY_KEYS.has(k) })));
    const out = {};
    keys.forEach((k, i) => {
      out[k] = settled[i].status === "fulfilled" ? settled[i].value : null;
    });
    return out;
  }
}
