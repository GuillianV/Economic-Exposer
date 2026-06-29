import { logger } from "../../logs/index.js";
import { getWorldState } from "../world-state.js";
import { extractMetrics } from "./metrics.js";
import { saveSnapshot, loadMetricsSince } from "./store.js";
import { computeTrends } from "./trends.js";

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

/** Tendances courantes calculées sur l'historique des `lookbackDays` derniers jours. */
export async function getTrends(lookbackDays = 8) {
  const history = await loadMetricsSince(Date.now() - lookbackDays * 86400000);
  return computeTrends(history);
}

/**
 * Démarre la collecte périodique (défaut : horaire). Collecte immédiatement
 * une première fois, puis à chaque intervalle. Renvoie une fonction stop().
 */
export function startCollection({ intervalMs = HOUR_MS } = {}) {
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      await collectOnce();
    } catch (err) {
      logger.error(`[persistence] collecte échouée : ${err.message}`);
    }
  };

  tick(); // première collecte immédiate
  const timer = setInterval(tick, intervalMs);
  logger.info(`[persistence] collecte démarrée — intervalle ${Math.round(intervalMs / 60000)} min`);

  return function stop() {
    stopped = true;
    clearInterval(timer);
    logger.info("[persistence] collecte arrêtée");
  };
}
