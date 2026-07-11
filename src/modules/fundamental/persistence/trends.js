import { normalize } from "./baselines.js";
import { METRIC_KEYS } from "./metrics.js";

/**
 * Calcul des tendances : pour chaque métrique, sa valeur courante et ses
 * variations (absolue + %) sur 1h / 24h / 7j, en cherchant dans l'historique
 * le snapshot le plus proche de chaque horizon.
 *
 * Transforme une PHOTO (niveaux) en FILM (dynamiques) — le pouvoir prédictif
 * recherché selon la thèse macro->BTC.
 */
const HOUR_MS = 3600000;
const DAY_MS = 86400000;

// Horizons de comparaison : décalage visé + tolérance d'appariement.
const HORIZONS = [
  { key: "d1h", ms: HOUR_MS, tolMs: 2 * HOUR_MS },
  { key: "d24h", ms: DAY_MS, tolMs: 12 * HOUR_MS },
  { key: "d7d", ms: 7 * DAY_MS, tolMs: 2 * DAY_MS },
];

/**
 * Snapshot le plus proche d'un timestamp cible, dans une tolérance.
 * @param {Array<{ts: number, metrics: object}>} history Snapshots candidats.
 * @param {number} targetTs Timestamp visé (epoch ms).
 * @param {number} tolMs Écart maximal accepté (ms).
 * @returns {{ts: number, metrics: object}|null} Snapshot le plus proche, ou null.
 */
function findNearest(history, targetTs, tolMs) {
  let best = null;
  let bestDist = Infinity;
  for (const snap of history) {
    const dist = Math.abs(snap.ts - targetTs);
    if (dist < bestDist) {
      bestDist = dist;
      best = snap;
    }
  }
  return best && bestDist <= tolMs ? best : null;
}

/**
 * Variation entre deux valeurs : absolue, relative (%) et direction.
 * @param {number|null} current Valeur courante.
 * @param {number|null} past Valeur passée de référence.
 * @returns {{abs: number, pct: number|null, dir: string}|null} Delta, ou null
 *   si une des deux valeurs manque. `dir` vaut "up" | "down" | "flat".
 */
function delta(current, past) {
  if (current == null || past == null) return null;

  const abs = current - past;
  const pct = past !== 0 ? (abs / Math.abs(past)) * 100 : null;

  let dir = "flat";
  if (abs > 0) dir = "up";
  else if (abs < 0) dir = "down";

  return { abs, pct, dir };
}

/**
 * Tendances de toutes les métriques depuis un historique de snapshots.
 * @param {Array<{ts: number, metrics: object}>} history Snapshots triés croissant.
 * @param {object|null} [baselines] Distributions de normalisation — ajoute
 *   z-score et rang percentile si fournies.
 * @returns {{ts: number, metrics: object, count: number}} Par métrique :
 *   { value, d1h, d24h, d7d, z, pctRank }.
 */
export function computeTrends(history, baselines = null) {
  if (!Array.isArray(history) || history.length === 0) {
    return { ts: Date.now(), metrics: {}, count: 0 };
  }

  const current = history[history.length - 1];
  const past = history.slice(0, -1); // exclut le snapshot courant de la recherche du passé
  const now = current.ts;
  const trends = {};

  for (const key of METRIC_KEYS) {
    const value = current.metrics?.[key] ?? null;
    const entry = { value };
    for (const horizon of HORIZONS) {
      const ref = findNearest(past, now - horizon.ms, horizon.tolMs);
      entry[horizon.key] = delta(value, ref?.metrics?.[key] ?? null);
    }
    const { z, pctRank } = normalize(key, value, baselines);
    entry.z = z;
    entry.pctRank = pctRank;
    trends[key] = entry;
  }

  return { ts: now, metrics: trends, count: history.length };
}
