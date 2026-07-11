import { logger } from "../../logs/index.js";
import { getWorldState } from "../world-state.js";
import { getBaselines } from "./baselines.js";
import { extractMetrics } from "./metrics.js";
import { loadMetricsSince, saveSnapshot } from "./store.js";
import { computeTrends } from "./trends.js";

export const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const DEFAULT_LOOKBACK_DAYS = 8;

/**
 * Une collecte complète : récupère le world-state, extrait les métriques,
 * persiste un snapshot unifié (état complet + métriques + ts/stale).
 * @returns {Promise<{snapshot: object, state: object, file: string}>}
 *   Snapshot persisté, state brut et chemin du fichier écrit.
 */
export async function collectOnce() {
  const state = await getWorldState();
  const metrics = extractMetrics(state);

  const snapshot = {
    ts: state.ts,
    stale: state.meta.staleSources,
    metrics,
    axes: state.axes,
    sources: state.sources,
    meta: state.meta,
  };
  const file = await saveSnapshot(snapshot);

  const captured = Object.values(metrics).filter((value) => value != null).length;
  logger.info(`[persistence] snapshot @ ${new Date(state.ts).toISOString()} — ${captured} métriques (${state.meta.stale} stale) → ${file}`);
  return { snapshot, state, file };
}

/**
 * Tendances courantes : deltas 1h/24h/7j de chaque métrique + normalisation
 * (z-score / rang percentile) contre les baselines historiques.
 * @param {number} [lookbackDays] Profondeur d'historique chargée (jours).
 * @returns {Promise<object>} Résultat de computeTrends ({ ts, metrics, count }).
 */
export async function getTrends(lookbackDays = DEFAULT_LOOKBACK_DAYS) {
  const [history, baselines] = await Promise.all([
    loadMetricsSince(Date.now() - lookbackDays * DAY_MS),
    getBaselines(),
  ]);
  return computeTrends(history, baselines);
}
