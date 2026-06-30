import { loadVerdictByTs, loadSnapshotByTs } from "./store.js";

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
const TOL_24H = 3 * 3600000; // tolérance d'appariement (snapshots ~horaires)
const TOL_7D = 12 * 3600000;
const round = (v) => (v == null ? null : Math.round(v * 1000) / 1000);

function deltasBetween(baseM, m) {
  const out = {};
  for (const k of REGIME_METRICS) {
    const a = baseM[k];
    const b = m[k];
    if (Number.isFinite(a) && Number.isFinite(b)) {
      out[k] = {
        from: a,
        to: b,
        abs: round(b - a),
        pct: a !== 0 ? round(((b - a) / Math.abs(a)) * 100) : null,
      };
    }
  }
  return out;
}

/** Construit la fenêtre à +offsetMs (deltas vs base), ou un statut "pas prêt". */
async function window(label, basisTs, baseM, offsetMs, tol) {
  const target = basisTs + offsetMs;
  if (Date.now() < target) return { label, ready: false }; // pas encore l'heure
  const snap = await loadSnapshotByTs(target, tol);
  if (!snap) return { label, ready: true, available: false, reason: "pas de snapshot dans la fenêtre" };
  return {
    label,
    ready: true,
    available: true,
    atTs: snap.ts,
    atIso: new Date(snap.ts).toISOString(),
    deltas: deltasBetween(baseM, snap.metrics || {}),
  };
}

/** Calcule le suivi a posteriori d'un verdict (par ts). null si verdict absent. */
export async function computeOutcome(verdictTs) {
  const verdict = await loadVerdictByTs(verdictTs);
  if (!verdict) return null;

  const basisTs = verdict.snapshotTs ?? verdict.ts;
  const base = await loadSnapshotByTs(basisTs, TOL_24H);
  if (!base) {
    return { verdictTs: verdict.ts, available: false, reason: "snapshot de base introuvable" };
  }
  const baseM = base.metrics || {};
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
    elapsedHours: round((Date.now() - basisTs) / 3600000),
    note: "Deltas factuels des métriques-clés depuis le verdict — à interpréter au regard du régime annoncé. Ce n'est pas une évaluation 'juste/faux'.",
    windows: {
      h24: await window("+24h", basisTs, baseM, 24 * 3600000, TOL_24H),
      d7: await window("+7j", basisTs, baseM, 7 * 24 * 3600000, TOL_7D),
    },
  };
}
