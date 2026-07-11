import { loadSnapshotByTs, loadVerdictByTs } from "./store.js";

/**
 * Suivi A POSTERIORI d'un verdict — la couche CONFIANCE, comme DONNÉE.
 *
 * Pas de backtest, pas de note "juste/faux" (ce serait surinterpréter) : on
 * expose FACTUELLEMENT ce qui s'est passé depuis le verdict, sur des métriques
 * pertinentes pour le régime, à +24h et +7j (en réutilisant les snapshots déjà
 * stockés). Le consommateur (pro ou front) juge lui-même si la lecture tenait.
 *
 * N'exige PAS d'analyse technique : on lit ce qu'on a déjà (prix BTC, liquidité,
 * VIX, dollar, taux réels, actions…).
 */
const REGIME_METRICS = [
  "btcPrice", "fearGreed", "vix", "sp500", "nasdaq",
  "dxy", "realYield10y", "netLiquidity", "globalLiquidity",
];
const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const H24_MS = 24 * HOUR_MS;
const D7_MS = 7 * DAY_MS;
const TOL_24H_MS = 3 * HOUR_MS; // tolérance d'appariement (snapshots ~horaires)
const TOL_7D_MS = 12 * HOUR_MS;

/**
 * Arrondit à 3 décimales, en laissant passer null.
 * @param {number|null} value Valeur à arrondir.
 * @returns {number|null} Valeur arrondie, ou null.
 */
function round3(value) {
  if (value == null) return null;
  return Math.round(value * 1000) / 1000;
}

/**
 * Deltas des métriques de régime entre deux jeux de métriques.
 * @param {object} baseMetrics Métriques au moment du verdict.
 * @param {object} metrics Métriques de la fenêtre observée.
 * @returns {object} { métrique: { from, to, abs, pct } } — seules les
 *   métriques finies des deux côtés sont présentes.
 */
function deltasBetween(baseMetrics, metrics) {
  const deltas = {};
  for (const key of REGIME_METRICS) {
    const from = baseMetrics[key];
    const to = metrics[key];
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;

    const pct = from !== 0 ? round3(((to - from) / Math.abs(from)) * 100) : null;
    deltas[key] = {
      from,
      to,
      abs: round3(to - from),
      pct,
    };
  }
  return deltas;
}

/**
 * Fenêtre d'observation à +offsetMs du verdict : deltas vs base, ou statut
 * "pas prêt" / "pas de snapshot".
 * @param {string} label Libellé de la fenêtre ("+24h", "+7j").
 * @param {number} basisTs Timestamp de base du verdict (epoch ms).
 * @param {object} baseMetrics Métriques au moment du verdict.
 * @param {number} offsetMs Décalage de la fenêtre (ms).
 * @param {number} tolMs Tolérance d'appariement du snapshot (ms).
 * @returns {Promise<object>} { label, ready } complété de { available, atTs,
 *   atIso, deltas } quand un snapshot existe dans la fenêtre.
 */
async function buildWindow(label, basisTs, baseMetrics, offsetMs, tolMs) {
  const target = basisTs + offsetMs;
  if (Date.now() < target) return { label, ready: false };

  const snap = await loadSnapshotByTs(target, tolMs);
  if (!snap) return { label, ready: true, available: false, reason: "pas de snapshot dans la fenêtre" };

  return {
    label,
    ready: true,
    available: true,
    atTs: snap.ts,
    atIso: new Date(snap.ts).toISOString(),
    deltas: deltasBetween(baseMetrics, snap.metrics || {}),
  };
}

/**
 * Suivi a posteriori d'un verdict : deltas factuels des métriques-clés à +24h
 * et +7j depuis le snapshot de base.
 * @param {number} verdictTs Timestamp du verdict (epoch ms).
 * @returns {Promise<object|null>} Outcome complet, `available: false` si le
 *   snapshot de base est introuvable, null si le verdict n'existe pas.
 */
export async function computeOutcome(verdictTs) {
  const verdict = await loadVerdictByTs(verdictTs);
  if (!verdict) return null;

  const basisTs = verdict.snapshotTs ?? verdict.ts;
  const base = await loadSnapshotByTs(basisTs, TOL_24H_MS);
  if (!base) {
    return { verdictTs: verdict.ts, available: false, reason: "snapshot de base introuvable" };
  }

  const baseMetrics = base.metrics || {};
  const v = verdict.verdict || {};

  return {
    verdictTs: verdict.ts,
    verdictIso: new Date(verdict.ts).toISOString(),
    regime: v.regime ?? null,
    horizon: v.horizon ?? null,
    invalidation: v.invalidation ?? null,
    niveau_de_risque: v.niveau_de_risque ?? null,
    confiance: v.confiance ?? null,
    basisTs: base.ts,
    elapsedHours: round3((Date.now() - basisTs) / HOUR_MS),
    note: "Deltas factuels des métriques-clés depuis le verdict — à interpréter au regard du régime annoncé. Ce n'est pas une évaluation 'juste/faux'.",
    windows: {
      h24: await buildWindow("+24h", basisTs, baseMetrics, H24_MS, TOL_24H_MS),
      d7: await buildWindow("+7j", basisTs, baseMetrics, D7_MS, TOL_7D_MS),
    },
  };
}
