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
// non-signal, on calcule aussi le rythme annuel YoY % (la lecture macro utile).
const YOY_KEYS = new Set(["cpi", "pce", "m2", "retailSales"]);

// 14 observations mensuelles = de quoi retrouver le même mois un an plus tôt.
const YOY_OBSERVATION_COUNT = 14;

// Fenêtre d'observations récupérées pour une série SIMPLE (non-YoY). Corrige
// un défaut identifié le 2026-07-24 : avec limit=1 on ne prenait que la toute
// dernière ligne, souvent un « . » (valeur manquante) pour les séries
// quotidiennes le week-end ou en attente de publication (FX, taux) — la série
// retombait alors à null alors qu'une valeur réelle existait la veille. On
// récupère 10 lignes pour sauter les « . » de queue et retrouver la dernière
// valeur réellement publiée (un enchaînement de plus de 10 « . » = série
// vraiment morte, null légitime).
const LATEST_OBSERVATION_LOOKBACK = 10;

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
   * Dernière observation valide d'une série FRED, avec option rythme annuel.
   * @param {string} seriesId Identifiant de série FRED (ex. "CPIAUCSL").
   * @param {string} apiKey Clé API FRED.
   * @param {{ yoy?: boolean }} [options] `yoy` ajoute la variation annuelle en %.
   * @returns {Promise<{value: number, date: string, yoy?: number|null}|null>}
   *   Observation la plus récente, ou null si la série est vide.
   */
  async #latest(seriesId, apiKey, { yoy = false } = {}) {
    const limit = yoy ? YOY_OBSERVATION_COUNT : LATEST_OBSERVATION_LOOKBACK;
    const url =
      `https://api.stlouisfed.org/fred/series/observations` +
      `?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=${limit}`;
    const json = await this.getJson(url);

    const observations = (json?.observations || []).filter((o) => o.value !== ".");
    const latest = observations[0];
    if (!latest) return null;

    const result = { value: Number(latest.value), date: latest.date };
    if (yoy) {
      result.yoy = this.#yearOverYear(observations, result.value);
    }
    return result;
  }

  /**
   * Variation annuelle (%) : compare la dernière observation au même mois un
   * an plus tôt (match AAAA-MM ; repli : 12e observation en arrière).
   * @param {Array<{value: string, date: string}>} observations Observations
   *   triées de la plus récente à la plus ancienne.
   * @param {number} latestValue Valeur de l'observation la plus récente.
   * @returns {number|null} Variation YoY arrondie à 2 décimales, ou null.
   */
  #yearOverYear(observations, latestValue) {
    const latestDate = observations[0].date;
    const sameMonthLastYear = `${Number(latestDate.slice(0, 4)) - 1}${latestDate.slice(4, 7)}`;
    const previous = observations.find((o) => o.date.startsWith(sameMonthLastYear)) ?? observations[12];
    const previousValue = previous ? Number(previous.value) : null;
    if (!previousValue) return null;

    const yoyPct = (latestValue / previousValue - 1) * 100;
    return Math.round(yoyPct * 100) / 100;
  }

  /**
   * Récupère toutes les séries en parallèle, tolérant aux pannes par série.
   * @returns {Promise<object>} Une entrée par clé de SERIES ({value, date,
   *   yoy?} ou null si la série a échoué).
   */
  async fetchData() {
    const apiKey = process.env.FRED_API_KEY;
    if (!apiKey) throw new Error("FRED_API_KEY absente du .env");

    const keys = Object.keys(SERIES);
    const settled = await Promise.allSettled(
      keys.map((k) => this.#latest(SERIES[k], apiKey, { yoy: YOY_KEYS.has(k) })),
    );

    const out = {};
    keys.forEach((key, i) => {
      out[key] = settled[i].status === "fulfilled" ? settled[i].value : null;
    });
    return out;
  }
}
