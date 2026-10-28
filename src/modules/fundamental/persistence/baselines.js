import { promises as fs } from "node:fs";
import path from "node:path";
import { logger } from "../../logs/index.js";
import { MARKETS as COT_CONTRACTS, DIS_URL, TFF_URL } from "../collectors/cftc-cot.js";
import { withHostGate } from "../collectors/throttle.js";

/**
 * Baselines de NORMALISATION : pour chaque métrique, des statistiques de
 * distribution (moyenne, écart-type, percentiles) calculées depuis l'HISTORIQUE
 * NATIF DE LA SOURCE (pas depuis nos snapshots — pas de backfill). Permettent de
 * répondre « où en est-on dans la distribution ? » via z-score + rang percentile.
 *
 * Cache : data/baselines.json, rafraîchi si > BASELINE_TTL (défaut 24 h).
 * Sources : FRED (séries macro/commodities), CFTC Socrata (nets COT), F&G.
 */
const DATA = path.resolve(process.cwd(), "data");
const FILE = path.join(DATA, "baselines.json");
const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const YEAR_MS = 365 * DAY_MS;
const TTL_MS = (Number(process.env.BASELINE_TTL_HOURS) || 24) * HOUR_MS;
const WINDOW_YEARS = Number(process.env.BASELINE_WINDOW_YEARS) || 5;
const FETCH_TIMEOUT_MS = 20000;
const MIN_SAMPLES = 12; // sous ce nombre d'observations, la distribution n'est pas fiable
const COT_ROWS_LIMIT = 300; // rapports hebdo -> ~5.7 ans d'historique
const FNG_ROWS_LIMIT = 1500; // valeurs quotidiennes -> ~4 ans d'historique

const FRED_URL = "https://api.stlouisfed.org/fred/series/observations";

// metricKey -> série FRED (la distribution se lit sur ~WINDOW_YEARS ans).
const FRED_SERIES = {
  m2: "M2SL", dxy: "DTWEXBGS", eurusd: "DEXUSEU", usdjpy: "DEXJPUS", usdcny: "DEXCHUS",
  brlusd: "DEXBZUS", mxnusd: "DEXMXUS", inrusd: "DEXINUS", zarusd: "DEXSFUS",
  yield2y: "DGS2", yield10y: "DGS10", realYield10y: "DFII10", breakeven10y: "T10YIE",
  yieldCurve: "T10Y2Y", fedFunds: "DFF", sofr: "SOFR", mortgage30y: "MORTGAGE30US",
  highYieldSpread: "BAMLH0A0HYM2", financialConditions: "NFCI", financialStress: "STLFSI4",
  policyUncertainty: "USEPUINDXD", cpi: "CPIAUCSL", pce: "PCEPI", retailSales: "RSAFS",
  consumerSentiment: "UMCSENT", unemployment: "UNRATE", initialClaims: "ICSA", foodPriceIndex: "PFOODINDEXM",
  wtiOil: "DCOILWTICO", brentOil: "DCOILBRENTEU", natGas: "DHHNGSP", copper: "PCOPPUSDM", wheat: "PWHEAMTUSDM",
  sp500: "SP500", nasdaq: "NASDAQCOM", djia: "DJIA", vix: "VIXCLS",
};

// metricKey de la métrique -> clé de contrat dans cftc-cot.js (noms centralisés là-bas).
const COT_METRIC_OF = {
  cotHedgeFundsNet: "btc", cotEurNet: "eurFx", cotJpyNet: "jpy", cotGbpNet: "gbp",
  cotSp500Net: "sp500", cotNasdaqNet: "nasdaq", cotGoldNet: "gold", cotWtiNet: "wti",
};

/**
 * Convertit une valeur brute (chaîne FRED/Socrata) en nombre fini, sinon null.
 * @param {*} value Valeur brute.
 * @returns {number|null} Nombre fini ou null.
 */
function toFiniteNumber(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * GET JSON avec throttle par hôte et timeout.
 * @param {string} url URL à interroger.
 * @param {number} [timeoutMs] Délai maximal (ms).
 * @returns {Promise<*>} Corps JSON parsé.
 * @throws {Error} Statut HTTP non-2xx ou timeout.
 */
async function fetchJson(url, timeoutMs = FETCH_TIMEOUT_MS) {
  return withHostGate(new URL(url).hostname, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  });
}

/**
 * Statistiques de distribution d'un échantillon.
 * @param {Array<number>} values Observations (les non-finies sont ignorées).
 * @returns {object|null} { n, mean, std, min, max, p5, p25, p50, p75, p95,
 *   windowYears }, ou null si moins de MIN_SAMPLES observations.
 */
function computeStats(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const n = sorted.length;
  if (n < MIN_SAMPLES) return null;

  const mean = sorted.reduce((sum, value) => sum + value, 0) / n;
  const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);

  const percentile = (p) => {
    const idx = (n - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  };

  return {
    n,
    mean,
    std,
    min: sorted[0],
    max: sorted[n - 1],
    p5: percentile(0.05),
    p25: percentile(0.25),
    p50: percentile(0.5),
    p75: percentile(0.75),
    p95: percentile(0.95),
    windowYears: WINDOW_YEARS,
  };
}

/**
 * Historique d'une série FRED sur la fenêtre WINDOW_YEARS.
 * @param {string} seriesId Identifiant de série FRED.
 * @returns {Promise<Array<number>>} Observations numériques triées croissant (dates).
 */
async function fredHistory(seriesId) {
  const start = new Date(Date.now() - WINDOW_YEARS * YEAR_MS).toISOString().slice(0, 10);
  const url = `${FRED_URL}?series_id=${seriesId}&api_key=${process.env.FRED_API_KEY}&file_type=json&observation_start=${start}&sort_order=asc`;
  const json = await fetchJson(url);
  return (json?.observations || [])
    .map((obs) => toFiniteNumber(obs.value))
    .filter((value) => value != null);
}

/**
 * Historique du net spéculatif d'un contrat COT (Socrata CFTC).
 * @param {{url: string, name: string, report: string}} contract URL du dataset,
 *   nom exact du marché et type de rapport ("tff" ou "dis").
 * @returns {Promise<Array<number>>} Nets spéculatifs (long − short) par rapport.
 */
async function cotHistory({ url, name, report }) {
  const where = encodeURIComponent(`market_and_exchange_names = '${name}'`);
  const order = encodeURIComponent("report_date_as_yyyy_mm_dd DESC");
  const rows = await fetchJson(`${url}?$where=${where}&$order=${order}&$limit=${COT_ROWS_LIMIT}`);

  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      if (report === "tff") {
        return toFiniteNumber(row.lev_money_positions_long) - toFiniteNumber(row.lev_money_positions_short);
      }
      return toFiniteNumber(row.m_money_positions_long_all) - toFiniteNumber(row.m_money_positions_short_all);
    })
    .filter((value) => Number.isFinite(value));
}

/**
 * Historique du Fear & Greed index (alternative.me).
 * @returns {Promise<Array<number>>} Valeurs quotidiennes de l'index.
 */
async function fngHistory() {
  const json = await fetchJson(`https://api.alternative.me/fng/?limit=${FNG_ROWS_LIMIT}&format=json`);
  return (json?.data || [])
    .map((entry) => toFiniteNumber(entry.value))
    .filter((value) => value != null);
}

/**
 * Reconstruit toutes les baselines depuis les sources (réseau) et persiste le
 * cache. Tolérant : une source en échec est loguée et ignorée.
 * @returns {Promise<{asOf: number, metrics: object}>} Baselines reconstruites.
 */
async function rebuild() {
  logger.info("[baselines] reconstruction des distributions (historique sources)…");

  const tasks = [];
  if (process.env.FRED_API_KEY) {
    for (const [key, seriesId] of Object.entries(FRED_SERIES)) {
      tasks.push([key, () => fredHistory(seriesId)]);
    }
  }
  for (const [metricKey, contractKey] of Object.entries(COT_METRIC_OF)) {
    const contract = COT_CONTRACTS[contractKey];
    if (!contract) continue;
    const url = contract.report === "tff" ? TFF_URL : DIS_URL;
    tasks.push([metricKey, () => cotHistory({ url, name: contract.name, report: contract.report })]);
  }
  tasks.push(["fearGreed", fngHistory]);

  const metrics = {};
  const settled = await Promise.allSettled(tasks.map(([, fetchHistory]) => fetchHistory()));
  settled.forEach((result, i) => {
    const key = tasks[i][0];
    if (result.status === "fulfilled") {
      const stats = computeStats(result.value);
      if (stats) metrics[key] = stats;
    } else {
      logger.warn(`[baselines] ${key} : ${result.reason?.message || result.reason}`);
    }
  });

  const baselines = { asOf: Date.now(), metrics };
  await fs.mkdir(DATA, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(baselines, null, 2), "utf8");
  logger.info(`[baselines] ${Object.keys(metrics).length}/${tasks.length} distributions calculées`);
  return baselines;
}

let memo = null; // baselines en mémoire ({ asOf, metrics }) — évite les relectures disque

/**
 * Lit le cache disque des baselines.
 * @returns {Promise<object|null>} Baselines cachées, ou null si absentes/corrompues.
 */
async function readCachedBaselines() {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Baselines courantes : mémoire, puis cache disque (≤ TTL), sinon
 * reconstruction réseau. Tolérant aux pannes : renvoie au pire un objet vide.
 * @returns {Promise<{asOf: number, metrics: object}>} Baselines.
 */
export async function getBaselines() {
  if (memo && Date.now() - memo.asOf < TTL_MS) return memo;

  const cached = await readCachedBaselines();
  if (cached?.asOf && Date.now() - cached.asOf < TTL_MS) {
    memo = cached;
    return memo;
  }

  try {
    memo = await rebuild();
  } catch (err) {
    logger.error(`[baselines] reconstruction échouée : ${err.message}`);
    memo = memo || { asOf: Date.now(), metrics: {} };
  }
  return memo;
}

/**
 * z-score + rang percentile (0-100) d'une valeur vs sa distribution, le rang
 * étant interpolé linéairement entre les percentiles connus.
 * @param {string} metricKey Clé de la métrique.
 * @param {number|null} value Valeur courante.
 * @param {object|null} baselines Baselines ({ metrics }).
 * @returns {{z: number|null, pctRank: number|null}} Normalisation, champs null
 *   si distribution ou valeur absente.
 */
export function normalize(metricKey, value, baselines) {
  const stats = baselines?.metrics?.[metricKey];
  if (stats == null || value == null || !Number.isFinite(value)) return { z: null, pctRank: null };

  const z = stats.std > 0 ? (value - stats.mean) / stats.std : null;

  // Points (valeur, rang) connus de la distribution, pour l'interpolation.
  const anchors = [
    [stats.min, 0], [stats.p5, 5], [stats.p25, 25], [stats.p50, 50],
    [stats.p75, 75], [stats.p95, 95], [stats.max, 100],
  ];

  let pctRank;
  if (value <= stats.min) {
    pctRank = 0;
  } else if (value >= stats.max) {
    pctRank = 100;
  } else {
    for (let i = 1; i < anchors.length; i++) {
      const [lowValue, lowRank] = anchors[i - 1];
      const [highValue, highRank] = anchors[i];
      if (value <= highValue) {
        if (highValue === lowValue) {
          pctRank = highRank;
        } else {
          pctRank = lowRank + ((value - lowValue) / (highValue - lowValue)) * (highRank - lowRank);
        }
        break;
      }
    }
  }

  return {
    z: z != null ? Math.round(z * 100) / 100 : null,
    pctRank: pctRank != null ? Math.round(pctRank) : null,
  };
}
