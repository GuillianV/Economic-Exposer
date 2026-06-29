import { METRIC_KEYS } from "./metrics.js";

/**
 * Calcul des tendances : pour chaque métrique, sa valeur courante et ses
 * variations (absolue + %) sur 1h / 24h / 7j, en cherchant dans l'historique
 * le snapshot le plus proche de chaque horizon.
 *
 * Transforme une PHOTO (niveaux) en FILM (dynamiques) — le pouvoir prédictif
 * recherché selon la thèse macro->BTC.
 */
const HORIZONS = [
  { key: "d1h", ms: 3600000, tolMs: 2 * 3600000 },
  { key: "d24h", ms: 86400000, tolMs: 12 * 3600000 },
  { key: "d7d", ms: 7 * 86400000, tolMs: 2 * 86400000 },
];

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

function delta(current, past) {
  if (current == null || past == null) return null;
  const abs = current - past;
  const pct = past !== 0 ? (abs / Math.abs(past)) * 100 : null;
  const dir = abs > 0 ? "up" : abs < 0 ? "down" : "flat";
  return { abs, pct, dir };
}

/**
 * @param history snapshots triés croissant ({ ts, metrics })
 * @returns { ts, metrics: { <metric>: { value, d1h, d24h, d7d } }, count }
 */
export function computeTrends(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return { ts: Date.now(), metrics: {}, count: 0 };
  }
  const current = history[history.length - 1];
  const past = history.slice(0, -1); // exclut le snapshot courant de la recherche du passé
  const now = current.ts;
  const out = {};

  for (const key of METRIC_KEYS) {
    const value = current.metrics?.[key] ?? null;
    const entry = { value };
    for (const h of HORIZONS) {
      const ref = findNearest(past, now - h.ms, h.tolMs);
      entry[h.key] = delta(value, ref?.metrics?.[key] ?? null);
    }
    out[key] = entry;
  }

  return { ts: now, metrics: out, count: history.length };
}
