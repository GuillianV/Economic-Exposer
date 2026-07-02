import { promises as fs } from "node:fs";
import path from "node:path";
import { logger } from "../../logs/index.js";
import { withHostGate } from "../collectors/throttle.js";
import { MARKETS as COT_CONTRACTS, TFF_URL, DIS_URL } from "../collectors/cftc-cot.js";

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
const TTL_MS = (Number(process.env.BASELINE_TTL_HOURS) || 24) * 3600000;
const WINDOW_YEARS = Number(process.env.BASELINE_WINDOW_YEARS) || 5;

const FRED = "https://api.stlouisfed.org/fred/series/observations";

// metricKey -> série FRED (la distribution se lit sur ~WINDOW_YEARS ans).
const FRED_SERIES = {
  m2: "M2SL", dxy: "DTWEXBGS", eurusd: "DEXUSEU", usdjpy: "DEXJPUS", usdcny: "DEXCHUS",
  brlusd: "DEXBZUS", mxnusd: "DEXMXUS", inrusd: "DEXINUS", zarusd: "DEXSFUS",
  yield2y: "DGS2", yield10y: "DGS10", realYield10y: "DFII10", breakeven10y: "T10YIE",
  yieldCurve: "T10Y2Y", fedFunds: "FEDFUNDS", sofr: "SOFR", mortgage30y: "MORTGAGE30US",
  highYieldSpread: "BAMLH0A0HYM2", financialConditions: "NFCI", financialStress: "STLFSI4",
  policyUncertainty: "USEPUINDXD", cpi: "CPIAUCSL", pce: "PCEPI", retailSales: "RSAFS",
  consumerSentiment: "UMCSENT", unemployment: "UNRATE", foodPriceIndex: "PFOODINDEXM",
  wtiOil: "DCOILWTICO", brentOil: "DCOILBRENTEU", natGas: "DHHNGSP", copper: "PCOPPUSDM", wheat: "PWHEAMTUSDM",
  sp500: "SP500", nasdaq: "NASDAQCOM", djia: "DJIA", vix: "VIXCLS",
};

// metricKey de la métrique -> clé de contrat dans cftc-cot.js (noms centralisés là-bas).
const COT_METRIC_OF = {
  cotHedgeFundsNet: "btc", cotEurNet: "eurFx", cotJpyNet: "jpy", cotGbpNet: "gbp",
  cotSp500Net: "sp500", cotNasdaqNet: "nasdaq", cotGoldNet: "gold", cotWtiNet: "wti",
};

const num = (v) => (v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

async function fetchJson(url, timeout = 20000) {
  return withHostGate(new URL(url).hostname, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  });
}

// Statistiques de distribution depuis un tableau de nombres.
function computeStats(values) {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = xs.length;
  if (n < 12) return null; // pas assez d'historique pour être fiable
  const mean = xs.reduce((s, v) => s + v, 0) / n;
  const variance = xs.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  const pct = (p) => {
    const idx = (n - 1) * p;
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return xs[lo] + (xs[hi] - xs[lo]) * (idx - lo);
  };
  return {
    n, mean, std, min: xs[0], max: xs[n - 1],
    p5: pct(0.05), p25: pct(0.25), p50: pct(0.5), p75: pct(0.75), p95: pct(0.95),
    windowYears: WINDOW_YEARS,
  };
}

async function fredHistory(seriesId) {
  const start = new Date(Date.now() - WINDOW_YEARS * 365 * 86400000).toISOString().slice(0, 10);
  const url = `${FRED}?series_id=${seriesId}&api_key=${process.env.FRED_API_KEY}&file_type=json&observation_start=${start}&sort_order=asc`;
  const j = await fetchJson(url);
  return (j?.observations || []).map((o) => num(o.value)).filter((v) => v != null);
}

async function cotHistory({ url, name, report }) {
  const where = encodeURIComponent(`market_and_exchange_names = '${name}'`);
  const order = encodeURIComponent("report_date_as_yyyy_mm_dd DESC");
  const rows = await fetchJson(`${url}?$where=${where}&$order=${order}&$limit=300`);
  return (Array.isArray(rows) ? rows : [])
    .map((r) =>
      report === "tff"
        ? num(r.lev_money_positions_long) - num(r.lev_money_positions_short)
        : num(r.m_money_positions_long_all) - num(r.m_money_positions_short_all),
    )
    .filter((v) => Number.isFinite(v));
}

async function fngHistory() {
  const j = await fetchJson("https://api.alternative.me/fng/?limit=1500&format=json");
  return (j?.data || []).map((d) => num(d.value)).filter((v) => v != null);
}

/** Reconstruit toutes les baselines depuis les sources (réseau). Tolérant. */
async function rebuild() {
  logger.info("[baselines] reconstruction des distributions (historique sources)…");
  const tasks = [];
  if (process.env.FRED_API_KEY) {
    for (const [key, id] of Object.entries(FRED_SERIES)) tasks.push([key, () => fredHistory(id)]);
  }
  for (const [metricKey, contractKey] of Object.entries(COT_METRIC_OF)) {
    const c = COT_CONTRACTS[contractKey];
    if (c) tasks.push([metricKey, () => cotHistory({ url: c.report === "tff" ? TFF_URL : DIS_URL, name: c.name, report: c.report })]);
  }
  tasks.push(["fearGreed", fngHistory]);

  const metrics = {};
  const settled = await Promise.allSettled(tasks.map(([, fn]) => fn()));
  settled.forEach((r, i) => {
    const key = tasks[i][0];
    if (r.status === "fulfilled") {
      const stats = computeStats(r.value);
      if (stats) metrics[key] = stats;
    } else {
      logger.warn(`[baselines] ${key} : ${r.reason?.message || r.reason}`);
    }
  });

  const out = { asOf: Date.now(), metrics };
  await fs.mkdir(DATA, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(out, null, 2), "utf8");
  logger.info(`[baselines] ${Object.keys(metrics).length}/${tasks.length} distributions calculées`);
  return out;
}

let memo = null;

/** Renvoie les baselines (cache ≤ TTL), reconstruit si périmé. Tolérant aux pannes. */
export async function getBaselines() {
  if (memo && Date.now() - memo.asOf < TTL_MS) return memo;
  try {
    const cached = JSON.parse(await fs.readFile(FILE, "utf8"));
    if (cached?.asOf && Date.now() - cached.asOf < TTL_MS) {
      memo = cached;
      return memo;
    }
  } catch {
    /* pas de cache valide */
  }
  try {
    memo = await rebuild();
  } catch (err) {
    logger.error(`[baselines] reconstruction échouée : ${err.message}`);
    memo = memo || { asOf: Date.now(), metrics: {} };
  }
  return memo;
}

/** z-score + rang percentile (0-100) d'une valeur vs sa distribution. */
export function normalize(metricKey, value, baselines) {
  const s = baselines?.metrics?.[metricKey];
  if (s == null || value == null || !Number.isFinite(value)) return { z: null, pctRank: null };
  const z = s.std > 0 ? (value - s.mean) / s.std : null;
  // rang percentile approximé par interpolation sur les percentiles connus.
  const pts = [
    [s.min, 0], [s.p5, 5], [s.p25, 25], [s.p50, 50], [s.p75, 75], [s.p95, 95], [s.max, 100],
  ];
  let pctRank;
  if (value <= s.min) pctRank = 0;
  else if (value >= s.max) pctRank = 100;
  else {
    for (let i = 1; i < pts.length; i++) {
      const [v0, r0] = pts[i - 1], [v1, r1] = pts[i];
      if (value <= v1) {
        pctRank = v1 === v0 ? r1 : r0 + ((value - v0) / (v1 - v0)) * (r1 - r0);
        break;
      }
    }
  }
  return {
    z: z != null ? Math.round(z * 100) / 100 : null,
    pctRank: pctRank != null ? Math.round(pctRank) : null,
  };
}
