import { logger } from "../../logs/index.js";
import { getWorldState } from "../world-state.js";
import { extractMetrics } from "./metrics.js";
import { saveSnapshot, loadMetricsSince } from "./store.js";
import { computeTrends } from "./trends.js";
import { getBaselines } from "./baselines.js";

export const HOUR_MS = 3600000;

/**
 * Une collecte : récupère le world-state, extrait les métriques, persiste un
 * snapshot compact { ts, metrics, stale }. Renvoie le snapshot + le state brut.
 */
export async function collectOnce() {
  const state = await getWorldState();
  const metrics = extractMetrics(state);

  // Fichier unifié : tout l'état + les métriques extraites + ts/stale.
  const snapshot = {
    ts: state.ts,
    stale: state.meta.staleSources,
    metrics,
    axes: state.axes,
    sources: state.sources,
    meta: state.meta,
  };
  const file = await saveSnapshot(snapshot);

  const captured = Object.values(metrics).filter((v) => v != null).length;
  logger.info(`[persistence] snapshot @ ${new Date(state.ts).toISOString()} — ${captured} métriques (${state.meta.stale} stale) → ${file}`);
  return { snapshot, state, file };
}

/** Tendances courantes (deltas 1h/24h/7j) + normalisation (z/pctRank vs historique). */
export async function getTrends(lookbackDays = 8) {
  const [history, baselines] = await Promise.all([
    loadMetricsSince(Date.now() - lookbackDays * 86400000),
    getBaselines(),
  ]);
  return computeTrends(history, baselines);
}
