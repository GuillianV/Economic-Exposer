import { logger } from "../../logs/index.js";
import { listVerdicts, loadVerdictByTs, loadMetricsSince } from "../persistence/store.js";
import { getTrends } from "../persistence/scheduler.js";
import { METRIC_DICTIONARY } from "../dictionary.js";

// Seuils d'extrême sur le rang percentile 5 ans (mean-reversion / contrarian).
const PCT_LOW = 10;
const PCT_HIGH = 90;

// Séries SÉCULAIRES (accumulateurs qui montent toujours) : leur p100 est
// structurel, PAS un signal de retournement. Exclues des extrêmes contrarian.
const SECULAR_DENY = new Set(["m2", "cpi", "pce", "retailSales", "foodPriceIndex"]);

// Catalyseurs "imminents" : événements binaires dans les prochains jours qui
// figent le marché (attente) → le modèle doit gater sa confiance dessus.
const IMMINENT_DAYS = 3;
function imminentCatalysts(verdict) {
  const arr = Array.isArray(verdict?.catalyseurs_a_venir) ? verdict.catalyseurs_a_venir : [];
  const now = Date.now();
  const lim = now + IMMINENT_DAYS * 86400000;
  return arr.filter((c) => {
    const t = Date.parse(c?.date);
    return Number.isFinite(t) && t >= now - 86400000 && t <= lim; // -1j pour inclure aujourd'hui
  });
}

/**
 * Métriques à un EXTRÊME de percentile (≤10 ou ≥90) — les meilleurs tells de
 * retournement (peur/euphorie, positionnement lessivé, sur-achat). Triées par
 * distance à la médiane (plus extrême d'abord).
 */
function extremesOf(trends) {
  const out = [];
  for (const [k, m] of Object.entries(trends?.metrics ?? {})) {
    if (!m || m.pctRank == null || SECULAR_DENY.has(k)) continue;
    if (m.pctRank > PCT_LOW && m.pctRank < PCT_HIGH) continue;
    const meta = METRIC_DICTIONARY[k];
    out.push({
      metric: k,
      label: meta?.label ?? k,
      sens: meta?.sens ?? null,
      value: r2(m.value),
      pctRank: m.pctRank,
      z: m.z != null ? r2(m.z) : null,
      extreme: m.pctRank <= PCT_LOW ? "bas" : "haut",
    });
  }
  out.sort((a, b) => Math.abs(b.pctRank - 50) - Math.abs(a.pctRank - 50));
  return out;
}

// Cours majeurs suivis : clé métrique -> libellé affiché.
export const ASSETS = [
  ["btcPrice", "BTC/USD"],
  ["ethPrice", "ETH/USD"],
  ["solPrice", "SOL/USD"],
  ["sp500", "S&P 500"],
  ["nasdaq", "Nasdaq 100"],
  ["dxy", "DXY (indice dollar)"],
  ["eurusd", "EUR/USD"],
  ["usdjpy", "USD/JPY"],
  ["gold", "Or (XAU/USD)"],
];

const r2 = (n) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) / 100 : n);

/**
 * Construit la trajectoire depuis le store : timeline régime (verdicts) +
 * timeline des cours (métriques), sous-échantillonnée à ~maxPoints points.
 */
export async function buildTrajectory(windowMs = 7 * 86400000, maxPoints = 24) {
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
 */
function macroContextOf(trends) {
  const g = (k) => trends?.metrics?.[k]?.value ?? null;
  const d = (k) => {
    const p = trends?.metrics?.[k]?.d24h?.pct;
    return typeof p === "number" ? Math.round(p * 100) / 100 : null;
  };
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
    initialClaimsD7: (() => {
      const p = trends?.metrics?.initialClaims?.d7d?.pct;
      return p == null ? null : Math.round(p * 100) / 100;
    })(),
  };
}

/* Retiré 2026-07-08 : projection de courbes chiffrées (projectCurves,
 * projectCurvesFromTrajectory, inflectCurve, formatTrajectory) — remplacée par
 * les prévisions directionnelles 24h (prevision.js), choix produit 2026-07-07.
 * Ce module ne sert plus qu'à l'ASSEMBLAGE de la trajectoire (buildTrajectory,
 * ASSETS, extrêmes, contexte macro) consommée par prevision.js. */
