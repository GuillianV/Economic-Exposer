import { analyze } from "./analyst.js";
import { autopsyPrevision, evaluatePrevision, projectPrevisions } from "./prevision.js";
import { calendarToday, detectChanges, formatChange } from "./triggers.js";
import { logger } from "../../logs/index.js";
import { emitWebhook, verdictEvent } from "../../notify/webhook.js";
import { extractMetrics } from "../persistence/metrics.js";
import { collectOnce, getTrends, HOUR_MS } from "../persistence/scheduler.js";
import {
  loadAiState,
  loadLatestPrevision,
  loadLatestVerdict,
  loadPrevisionsSince,
  saveAiState,
  savePrevision,
  saveVerdict,
} from "../persistence/store.js";

const MINUTE_MS = 60000;
const DAY_MS = 86400000;
const EVAL_WINDOW_MS = 7 * DAY_MS; // fenêtre de rescan des prévisions à évaluer
const DEFAULT_BASELINE_HOURS = 4;
const DEFAULT_DAILY_HOUR = 12;

/**
 * Qualité des données ayant servi au verdict (fraîcheur des sources).
 * @param {object} state World-state complet.
 * @returns {{stale: Array<string>, ok: number|null, total: number|null,
 *   freshnessTs: number}} Synthèse de fraîcheur.
 */
function dataQualityOf(state) {
  return {
    stale: state.meta?.staleSources ?? [],
    ok: state.meta?.ok ?? null,
    total: state.meta?.total ?? null,
    freshnessTs: state.ts,
  };
}

const BASELINE_MS = (Number(process.env.AI_BASELINE_HOURS) || DEFAULT_BASELINE_HOURS) * HOUR_MS;

/**
 * Décide s'il faut lancer l'IA, et la lance le cas échéant.
 * Déclencheurs : (1) cadence de fond dépassée, (2) bascule détectée vs le
 * dernier point IA, (3) catalyseur calendaire du jour.
 * Persiste le verdict + met à jour l'état IA (référence + dernier run).
 * @param {object} state World-state complet de la collecte.
 * @param {object} trends Tendances (getTrends).
 * @returns {Promise<{triggered: boolean, reasons?: Array<string>,
 *   verdict?: object, record?: object, file?: string}>} Résultat du tour.
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
  // Hystérésis : le dernier verdict est passé comme hypothèse à tester (anti flip-flop).
  const previous = await loadLatestVerdict().catch(() => null);
  const { provider, verdict, raw, violations } = await analyze(state, trends, { previous });
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
 * @returns {Promise<{provider: string, verdict: object|null, raw: string,
 *   file: string, snapshotTs: number}>} Verdict enregistré.
 */
export async function analyzeNow() {
  const { state } = await collectOnce();
  const trends = await getTrends();
  const previous = await loadLatestVerdict().catch(() => null);
  const { provider, verdict, raw, violations } = await analyze(state, trends, { previous });
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

// Throttle : l'évaluation est aussi déclenchée par les lectures API (lazy-eval) —
// inutile de rescanner le répertoire plus d'une fois toutes les 10 min.
const EVAL_THROTTLE_MS = 10 * MINUTE_MS;
let lastEvalTs = 0; // dernier scan d'évaluation (epoch ms)

/**
 * Évalue les prévisions arrivées à échéance (classe réalisée vs prédite, avec
 * les seuils stockés à l'émission) et déclenche l'autopsie des records
 * entièrement évalués. Idempotent, throttlé, ne throw jamais.
 * @param {{ force?: boolean }} [options] force ignore le throttle.
 * @returns {Promise<number>} Nombre de records évalués sur ce scan.
 */
export async function evaluateDuePrevisions({ force = false } = {}) {
  if (!force && Date.now() - lastEvalTs < EVAL_THROTTLE_MS) return 0;
  lastEvalTs = Date.now();
  let done = 0;
  try {
    const recs = await loadPrevisionsSince(Date.now() - EVAL_WINDOW_MS);
    for (const rec of recs) {
      if (rec.outcome) continue;
      const { evaluated } = await evaluatePrevision(rec);
      if (evaluated) {
        // Post-mortem public des ratés, UNE fois, quand tout est évalué.
        // Best-effort : si le LLM échoue, le record part sans autopsie
        // (pas de retry — outcome posé, la boucle ne repassera pas ici).
        if (rec.outcome && !rec.autopsie) {
          const autopsie = await autopsyPrevision(rec).catch(() => null);
          if (autopsie) rec.autopsie = autopsie;
        }
        await savePrevision(rec); // même baseTs → réécrit le même fichier
        done++;
      }
    }
    if (done) logger.info(`[prevision] ${done} prévision(s) évaluée(s) contre le réalisé`);
  } catch (err) {
    logger.warn(`[prevision] évaluation échouée : ${err.message}`);
  }
  return done;
}

/**
 * Génère la prévision directionnelle 24h et la PERSISTE (remplace les courbes
 * de prix chiffrées — choix produit 2026-07-07). Évalue d'abord les prévisions
 * échues (track record). Ne throw jamais.
 * @returns {Promise<object|null>} Record persisté, ou null en cas d'échec.
 */
export async function generateDailyPrevision() {
  await evaluateDuePrevisions({ force: true });
  try {
    const { provider, previsions } = await projectPrevisions();
    if (!previsions) {
      logger.warn("[prevision] génération quotidienne : JSON non parsé");
      return null;
    }
    const record = { provider, ...previsions };
    const file = await savePrevision(record);
    logger.info(`[prevision] prévision 24h générée (${previsions.actifs.length} actifs) → ${file}`);
    return record;
  } catch (err) {
    logger.warn(`[prevision] génération quotidienne échouée : ${err.message}`);
    return null;
  }
}

/**
 * Planifie la génération de la prévision UNE FOIS par jour à `hour` (heure
 * locale serveur). Ne bloque pas ; s'auto-replanifie. Rattrapage au démarrage
 * si aucune prévision n'a été générée aujourd'hui.
 * @param {{ hour?: number }} [options] Heure locale de génération (défaut :
 *   PREVISION_DAILY_HOUR / CURVE_DAILY_HOUR / midi).
 * @returns {Function} Fonction stop (annule le timer en cours).
 */
export function startDailyPrevision({ hour = Number(process.env.PREVISION_DAILY_HOUR) || Number(process.env.CURVE_DAILY_HOUR) || DEFAULT_DAILY_HOUR } = {}) {
  let timer = null;
  let stopped = false;

  /**
   * Programme le prochain tir quotidien (à `hour`, aujourd'hui ou demain).
   */
  const scheduleNext = () => {
    if (stopped) return;
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next - now;
    timer = setTimeout(async () => {
      if (stopped) return;
      // Prévisions directionnelles 24h (remplaçantes des courbes chiffrées,
      // choix produit 2026-07-07). L'évaluation des échues est incluse.
      await generateDailyPrevision();
      scheduleNext();
    }, delay);
    logger.info(`[prevision] prochaine génération quotidienne à ${next.toISOString()} (dans ${Math.round(delay / MINUTE_MS)} min)`);
  };

  // Rattrapage au démarrage : si aucune prévision n'a été générée AUJOURD'HUI,
  // on en produit une tout de suite — sinon `latest` resterait vide jusqu'à la
  // prochaine échéance (comme observé après un déploiement).
  (async () => {
    try {
      const last = await loadLatestPrevision();
      const today = new Date().toISOString().slice(0, 10);
      const lastDay = last?.baseTs ? new Date(last.baseTs).toISOString().slice(0, 10) : null;
      if (!stopped && lastDay !== today) {
        logger.info("[prevision] rattrapage au démarrage : aucune prévision aujourd'hui, génération immédiate");
        await generateDailyPrevision();
      } else if (!stopped) {
        await evaluateDuePrevisions(); // même sans nouvelle génération, on évalue les échues
      }
    } catch (err) {
      logger.warn(`[prevision] rattrapage au démarrage échoué : ${err.message}`);
    }
  })();

  scheduleNext();
  return function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
    logger.info("[prevision] scheduler quotidien arrêté");
  };
}

/**
 * Un tour de service : collecte → tendances → analyse conditionnelle.
 * @returns {Promise<object>} Résultat de maybeAnalyze.
 */
export async function serviceTick() {
  const { state } = await collectOnce();
  const trends = await getTrends();
  return maybeAnalyze(state, trends);
}

/**
 * Boucle de service : un tick à chaque intervalle (défaut horaire).
 * @param {{ intervalMs?: number }} [options] Intervalle entre deux ticks (ms).
 * @returns {Function} Fonction stop (arrête la boucle).
 */
export function startService({ intervalMs = HOUR_MS } = {}) {
  let stopped = false;

  /**
   * Un tick protégé : un échec est logué, la boucle continue.
   */
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
  logger.info(`[service] démarré — collecte ${Math.round(intervalMs / MINUTE_MS)} min, IA de fond ${BASELINE_MS / HOUR_MS}h + sur bascule`);
  return function stop() {
    stopped = true;
    clearInterval(timer);
    logger.info("[service] arrêté");
  };
}
