import { logger } from "../../logs/index.js";
import { extractMetrics } from "../persistence/metrics.js";
import { collectOnce, getTrends, HOUR_MS } from "../persistence/scheduler.js";
import { loadAiState, saveAiState, saveVerdict } from "../persistence/store.js";
import { analyze } from "./analyst.js";
import { detectChanges, formatChange, calendarToday } from "./triggers.js";
import { emitWebhook, verdictEvent } from "../../notify/webhook.js";

/** Qualité des données ayant servi au verdict (fraîcheur des sources). */
function dataQualityOf(state) {
  return {
    stale: state.meta?.staleSources ?? [],
    ok: state.meta?.ok ?? null,
    total: state.meta?.total ?? null,
    freshnessTs: state.ts,
  };
}

const BASELINE_MS = (Number(process.env.AI_BASELINE_HOURS) || 4) * 3600000;

/**
 * Décide s'il faut lancer l'IA, et la lance le cas échéant.
 * Déclencheurs : (1) cadence de fond dépassée, (2) bascule détectée vs le
 * dernier point IA, (3) catalyseur calendaire du jour.
 * Persiste le verdict + met à jour l'état IA (référence + dernier run).
 */
export async function maybeAnalyze(state, trends) {
  const metrics = extractMetrics(state);
  const aiState = await loadAiState();
  const now = state.ts;

  const changes = detectChanges(metrics, aiState?.refMetrics);
  const events = calendarToday(state);
  const dueBaseline = !aiState?.lastRunTs || now - aiState.lastRunTs >= BASELINE_MS;

  const reasons = [];
  if (dueBaseline) reasons.push(aiState?.lastRunTs ? "cadence de fond" : "premier point");
  changes.forEach((c) => reasons.push(`bascule: ${formatChange(c)}`));
  events.forEach((e) => reasons.push(`catalyseur: ${e.name}`));

  if (reasons.length === 0) {
    logger.info("[ai] pas de déclenchement (rien de notable, point de fond pas encore dû)");
    return { triggered: false };
  }

  logger.info(`[ai] déclenchement → ${reasons.join(" | ")}`);
  const { provider, verdict, raw, violations } = await analyze(state, trends);
  const record = {
    ts: now,
    snapshotTs: now, // corrélation : même ts que le snapshot de cette collecte
    provider,
    triggers: reasons,
    dataQuality: dataQualityOf(state),
    guardrails: violations ?? [], // garde-fous déterministes appliqués au verdict
    verdict,
    raw: verdict ? undefined : raw,
  };
  const file = await saveVerdict(record);
  await saveAiState({ lastRunTs: now, refMetrics: metrics });
  logger.info(`[ai] verdict enregistré (${verdict?.regime ?? "non parsé"}) → ${file}`);

  // SORTIE push : notifie tout consommateur via webhook (no-op si non configuré).
  if (verdict) await emitWebhook(verdictEvent({ schemaVersion: 1, ...record }));

  return { triggered: true, reasons, verdict, record, file };
}

/**
 * Force une analyse MAINTENANT : collecte un snapshot, analyse sans condition,
 * et enregistre le verdict corrélé. NE met PAS à jour la référence de bascule
 * (ai-state) — une analyse à la demande ne doit pas fausser la cadence du
 * service. Utilisé par `fa:ai`.
 */
export async function analyzeNow() {
  const { state } = await collectOnce();
  const trends = await getTrends();
  const { provider, verdict, raw, violations } = await analyze(state, trends);
  const record = {
    ts: state.ts,
    snapshotTs: state.ts,
    provider,
    triggers: ["analyse forcée (fa:ai)"],
    dataQuality: dataQualityOf(state),
    guardrails: violations ?? [],
    verdict,
    raw: verdict ? undefined : raw,
  };
  const file = await saveVerdict(record);
  logger.info(`[ai] analyse forcée enregistrée (${verdict?.regime ?? "non parsé"}) → ${file}`);
  // Pas de webhook ici : fa:ai est une analyse manuelle/debug, pas le service.
  return { provider, verdict, raw, file, snapshotTs: state.ts };
}

/** Un tour de service : collecte → tendances → analyse conditionnelle. */
export async function serviceTick() {
  const { state } = await collectOnce();
  const trends = await getTrends();
  return maybeAnalyze(state, trends);
}

/** Boucle de service : un tick à chaque intervalle (défaut horaire). */
export function startService({ intervalMs = HOUR_MS } = {}) {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      await serviceTick();
    } catch (err) {
      logger.error(`[service] tick échoué : ${err.message}`);
    }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  logger.info(`[service] démarré — collecte ${Math.round(intervalMs / 60000)} min, IA de fond ${BASELINE_MS / 3600000}h + sur bascule`);
  return function stop() {
    stopped = true;
    clearInterval(timer);
    logger.info("[service] arrêté");
  };
}
