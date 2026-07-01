import { logger } from "../../logs/index.js";
import { extractMetrics } from "../persistence/metrics.js";
import { collectOnce, getTrends, HOUR_MS } from "../persistence/scheduler.js";
import { loadAiState, saveAiState, saveVerdict, saveCurve, loadLatestCurve } from "../persistence/store.js";
import { analyze } from "./analyst.js";
import { projectCurves } from "./curve.js";
import { detectChanges, formatChange, calendarToday } from "./triggers.js";
import { emitWebhook, verdictEvent, curveEvent } from "../../notify/webhook.js";

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

// Défauts de la courbe quotidienne (fenêtre lue / horizon projeté).
const CURVE_DAYS = Number(process.env.CURVE_DAYS) || 7;
const CURVE_HORIZON = Number(process.env.CURVE_HORIZON) || 7;

/**
 * Génère la courbe projetée et la PERSISTE (une par jour). Ne throw jamais.
 * @returns le record stocké, ou null si échec/non parsé.
 */
export async function generateDailyCurve({ windowDays = CURVE_DAYS, horizonDays = CURVE_HORIZON } = {}) {
  try {
    const { provider, curves } = await projectCurves({ windowDays, horizonDays });
    if (!curves) {
      logger.warn("[curve] génération quotidienne : projection non parsée");
      return null;
    }
    const record = { provider, days: windowDays, ...curves };
    const file = await saveCurve(record);
    logger.info(`[curve] courbe quotidienne générée (${curves.actifs.length} actifs, ${windowDays}j→${horizonDays}j) → ${file}`);
    // SORTIE push : notifie le rafraîchissement de courbe (no-op si non configuré).
    await emitWebhook(curveEvent({ schemaVersion: 1, ...record }));
    return record;
  } catch (err) {
    logger.warn(`[curve] génération quotidienne échouée : ${err.message}`);
    return null;
  }
}

/**
 * Planifie la génération de la courbe UNE FOIS par jour à `hour` (heure locale
 * serveur). Renvoie une fonction stop. Ne bloque pas ; s'auto-replanifie.
 */
export function startDailyCurve({ hour = Number(process.env.CURVE_DAILY_HOUR) || 12 } = {}) {
  let timer = null;
  let stopped = false;
  const scheduleNext = () => {
    if (stopped) return;
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next - now;
    timer = setTimeout(async () => {
      if (stopped) return;
      await generateDailyCurve();
      scheduleNext();
    }, delay);
    logger.info(`[curve] prochaine génération quotidienne à ${next.toISOString()} (dans ${Math.round(delay / 60000)} min)`);
  };

  // Rattrapage au démarrage : si aucune courbe n'a été générée AUJOURD'HUI, on
  // en produit une tout de suite — sinon `latest`/l'historique resteraient vides
  // jusqu'à la prochaine échéance (comme observé après un déploiement).
  (async () => {
    try {
      const last = await loadLatestCurve();
      const today = new Date().toISOString().slice(0, 10);
      const lastDay = last?.baseTs ? new Date(last.baseTs).toISOString().slice(0, 10) : null;
      if (!stopped && lastDay !== today) {
        logger.info("[curve] rattrapage au démarrage : aucune courbe aujourd'hui, génération immédiate");
        await generateDailyCurve();
      }
    } catch (err) {
      logger.warn(`[curve] rattrapage au démarrage échoué : ${err.message}`);
    }
  })();

  scheduleNext();
  return function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
    logger.info("[curve] scheduler quotidien arrêté");
  };
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
