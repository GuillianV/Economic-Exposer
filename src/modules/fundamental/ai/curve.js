import { logger } from "../../logs/index.js";
import { METRIC_DICTIONARY } from "../dictionary.js";
import { getTrends } from "../persistence/scheduler.js";
import { listVerdicts, loadMetricsSince, loadVerdictByTs } from "../persistence/store.js";

const DAY_MS = 86400000;

// Seuils d'extrême sur le rang percentile 5 ans (mean-reversion / contrarian).
const PCT_LOW = 10;
const PCT_HIGH = 90;

// Séries SÉCULAIRES (accumulateurs qui montent toujours) : leur p100 est
// structurel, PAS un signal de retournement. Exclues des extrêmes contrarian.
const SECULAR_DENY = new Set(["m2", "cpi", "pce", "retailSales", "foodPriceIndex"]);

// Catalyseurs "imminents" : événements binaires dans les prochains jours qui
// figent le marché (attente) → le modèle doit gater sa confiance dessus.
const IMMINENT_DAYS = 3;

const DEFAULT_WINDOW_MS = 7 * DAY_MS;
const DEFAULT_MAX_POINTS = 24;

/**
 * Catalyseurs du verdict tombant dans la fenêtre imminente (hier inclus, pour
 * couvrir aujourd'hui quelle que soit l'heure).
 * @param {object} verdict Verdict parsé (catalyseurs_a_venir).
 * @returns {Array<object>} Catalyseurs imminents (peut être vide).
 */
function imminentCatalysts(verdict) {
  const catalysts = Array.isArray(verdict?.catalyseurs_a_venir) ? verdict.catalyseurs_a_venir : [];
  const now = Date.now();
  const limit = now + IMMINENT_DAYS * DAY_MS;
  return catalysts.filter((catalyst) => {
    const ts = Date.parse(catalyst?.date);
    return Number.isFinite(ts) && ts >= now - DAY_MS && ts <= limit;
  });
}

/**
 * Métriques à un EXTRÊME de percentile (≤10 ou ≥90) — les meilleurs tells de
 * retournement (peur/euphorie, positionnement lessivé, sur-achat). Triées par
 * distance à la médiane (plus extrême d'abord).
 * @param {object} trends Tendances (getTrends).
 * @returns {Array<{metric: string, label: string, sens: string|null,
 *   value: number, pctRank: number, z: number|null, extreme: string}>}
 *   Extrêmes triés, "extreme" ∈ {"bas", "haut"}.
 */
function extremesOf(trends) {
  const extremes = [];
  for (const [key, metric] of Object.entries(trends?.metrics ?? {})) {
    if (!metric || metric.pctRank == null || SECULAR_DENY.has(key)) continue;
    if (metric.pctRank > PCT_LOW && metric.pctRank < PCT_HIGH) continue;
    const meta = METRIC_DICTIONARY[key];
    extremes.push({
      metric: key,
      label: meta?.label ?? key,
      sens: meta?.sens ?? null,
      value: r2(metric.value),
      pctRank: metric.pctRank,
      z: metric.z != null ? r2(metric.z) : null,
      extreme: metric.pctRank <= PCT_LOW ? "bas" : "haut",
    });
  }
  extremes.sort((a, b) => Math.abs(b.pctRank - 50) - Math.abs(a.pctRank - 50));
  return extremes;
}

// Cours majeurs suivis : clé métrique -> libellé affiché.
// RETRAIT 2026-07-20 de dxy/eurusd/usdjpy (défaut de démarrage identifié) :
// ces trois cours viennent de FRED, séries QUOTIDIENNES publiées avec 1 à 2
// jours de retard et figées le week-end. Une prévision à 24h y était comparée
// à un cours inchangé (mouvement mesuré 0.00 % exact) ou au même saut recyclé
// plusieurs jours — la source est structurellement incapable de mesurer
// l'horizon prévu. Réintégrables le jour où une source intraday les alimente.
export const ASSETS = [
  ["btcPrice", "BTC/USD"],
  ["ethPrice", "ETH/USD"],
  ["solPrice", "SOL/USD"],
  ["sp500", "S&P 500"],
  ["nasdaq", "Nasdaq 100"],
  ["gold", "Or (XAU/USD)"],
];

/**
 * Arrondi à 2 décimales, en laissant passer les non-nombres tels quels.
 * @param {*} n Valeur à arrondir.
 * @returns {*} Nombre arrondi, ou la valeur d'origine si non-nombre.
 */
export function r2(n) {
  if (typeof n === "number" && Number.isFinite(n)) return Math.round(n * 100) / 100;
  return n;
}

/**
 * Construit la trajectoire depuis le store : timeline régime (verdicts) +
 * timeline des cours (métriques), sous-échantillonnée à ~maxPoints points,
 * plus extrêmes de percentile, contexte macro et signaux du dernier verdict.
 * @param {number} [windowMs] Fenêtre d'historique (ms).
 * @param {number} [maxPoints] Nombre maximal de points par timeline.
 * @returns {Promise<{regimes: Array<object>, prices: Array<object>,
 *   current: object, extremes: Array<object>, macroCtx: object|null,
 *   signals: object|null, span: object}>} Trajectoire complète.
 */
export async function buildTrajectory(windowMs = DEFAULT_WINDOW_MS, maxPoints = DEFAULT_MAX_POINTS) {
  const since = Date.now() - windowMs;
  const vlist = await listVerdicts(since);
  const mseries = await loadMetricsSince(since);

  const regimes = [];
  let lastVerdict = null;
  for (const { ts } of vlist) {
    const v = await loadVerdictByTs(ts);
    if (v?.verdict) {
      regimes.push({ ts, regime: v.verdict.regime, confiance: v.verdict.confiance, risque: v.verdict.niveau_de_risque });
      lastVerdict = v.verdict; // le plus récent (liste triée croissant)
    }
  }

  /**
   * Sous-échantillonne un tableau à maxPoints points équirépartis.
   * @param {Array} arr Tableau source.
   * @returns {Array} Tableau réduit (ou tel quel si déjà assez court).
   */
  const downsample = (arr) => {
    if (arr.length <= maxPoints) return arr;
    const step = (arr.length - 1) / (maxPoints - 1);
    return Array.from({ length: maxPoints }, (_, i) => arr[Math.round(i * step)]);
  };

  const prices = mseries.map((s) => ({ ts: s.ts, m: s.metrics || {} }));
  const latest = prices.length ? prices[prices.length - 1].m : {};
  const current = {};
  for (const [key] of ASSETS) if (latest[key] != null) current[key] = latest[key];

  // Signaux de RETOURNEMENT : extrêmes de percentile (via tendances) +
  // divergences/alertes/bascules du dernier verdict. Et CONTEXTE macro/options :
  // les dérivées (cpiYoY, policySpread2y) et le skew n'ont pas de baseline 5 ans
  // (pas de pctRank) — sans injection directe, la courbe ne les verrait JAMAIS.
  let extremes = [];
  let macroCtx = null;
  try {
    const trends = await getTrends();
    extremes = extremesOf(trends);
    macroCtx = macroContextOf(trends);
  } catch (err) {
    logger.warn(`[curve] extrêmes/contexte indisponibles : ${err.message}`);
  }
  const signals = lastVerdict
    ? {
        alertes: lastVerdict.alertes ?? [],
        changements: lastVerdict.ce_qui_a_change ?? [],
        divergences: lastVerdict.correlations ?? [],
        catalyseurs: imminentCatalysts(lastVerdict),
        geopolitique: lastVerdict.lecture_par_axe?.geopolitique ?? null,
      }
    : null;

  return {
    regimes: downsample(regimes),
    prices: downsample(prices),
    current,
    extremes,
    macroCtx,
    signals,
    span: { fromTs: since, toTs: Date.now(), verdicts: regimes.length, snapshots: prices.length },
  };
}

/**
 * Contexte macro & options depuis les tendances : le POURQUOI du régime
 * (inflation en rythme, attentes Fed, taux réels, plomberie) + le positionnement
 * options (skew/put-call). Valeurs brutes — pas besoin de baseline.
 * @param {object} trends Tendances (getTrends).
 * @returns {object} Contexte macro à plat (valeurs et deltas 24h/7j, null si
 *   métrique absente).
 */
function macroContextOf(trends) {
  /**
   * Valeur courante d'une métrique.
   * @param {string} k Clé de la métrique.
   * @returns {number|null} Valeur, ou null si absente.
   */
  const g = (k) => trends?.metrics?.[k]?.value ?? null;

  /**
   * Delta 24h (%) d'une métrique, arrondi à 2 décimales.
   * @param {string} k Clé de la métrique.
   * @returns {number|null} Delta, ou null si absent.
   */
  const d = (k) => {
    const pct = trends?.metrics?.[k]?.d24h?.pct;
    if (typeof pct !== "number") return null;
    return Math.round(pct * 100) / 100;
  };

  const claimsD7Pct = trends?.metrics?.initialClaims?.d7d?.pct;
  const initialClaimsD7 = claimsD7Pct == null ? null : Math.round(claimsD7Pct * 100) / 100;

  return {
    cpiYoY: g("cpiYoY"),
    pceYoY: g("pceYoY"),
    m2YoY: g("m2YoY"),
    policySpread2y: g("policySpread2y"),
    realYield10y: g("realYield10y"),
    realYield10yD24: d("realYield10y"),
    breakeven10y: g("breakeven10y"),
    breakeven10yD24: d("breakeven10y"),
    reverseRepo: g("reverseRepo"),
    tga: g("tga"),
    netLiquidityD24: d("netLiquidity"),
    globalLiquidityD24: d("globalLiquidity"),
    btcEtfFlowUsdM: g("btcEtfFlowUsdM"),
    btcEtfFlow7dUsdM: g("btcEtfFlow7dUsdM"),
    ethEtfFlowUsdM: g("ethEtfFlowUsdM"),
    ethEtfFlow7dUsdM: g("ethEtfFlow7dUsdM"),
    dvol: g("dvol"),
    btcSkew: g("btcSkew"),
    ethSkew: g("ethSkew"),
    btcPutCall: g("btcPutCall"),
    ethPutCall: g("ethPutCall"),
    cboeSkew: g("cboeSkew"),
    btcBasisAnnualized: g("btcBasisAnnualized"),
    // crédit & vol taux & emploi temps réel
    highYieldSpread: g("highYieldSpread"),
    highYieldSpreadD24: d("highYieldSpread"),
    move: g("move"),
    moveD24: d("move"),
    vix: g("vix"),
    initialClaims: g("initialClaims"),
    initialClaimsD7,
  };
}

/* Retiré 2026-07-08 : projection de courbes chiffrées (projectCurves,
 * projectCurvesFromTrajectory, inflectCurve, formatTrajectory) — remplacée par
 * les prévisions directionnelles 24h (prevision.js), choix produit 2026-07-07.
 * Ce module ne sert plus qu'à l'ASSEMBLAGE de la trajectoire (buildTrajectory,
 * ASSETS, extrêmes, contexte macro) consommée par prevision.js. */
