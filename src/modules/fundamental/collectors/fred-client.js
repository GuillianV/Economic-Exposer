import { logger } from "../../logs/index.js";

/**
 * Accès FRED partagé par les collecteurs (fred, liquidity, commodities,
 * markets) : une seule façon de lire la dernière observation valide, de
 * relancer une série en échec transitoire et de resservir la dernière valeur
 * connue. Une série en panne est TOUJOURS loggée (jamais avalée en silence).
 */
const FRED_URL = "https://api.stlouisfed.org/fred/series/observations";
const SECOND_MS = 1000;
const HOUR_MS = 60 * 60 * SECOND_MS;
const DAY_MS = 24 * HOUR_MS;

const LATEST_OBSERVATION_LOOKBACK = 10; // lignes lues pour sauter les « . » de queue (week-end, publication en attente)
const YOY_OBSERVATION_COUNT = 14; // observations mensuelles : de quoi retrouver le même mois un an plus tôt
const YOY_FALLBACK_INDEX = 12; // repli : 12e observation en arrière si le mois exact manque
const PERCENT = 100;
const ROUND_FACTOR = 100; // arrondi à 2 décimales
const FRED_RETRY_DELAY_MS = 2 * SECOND_MS; // pause avant l'unique relance d'une série en échec transitoire
const FRED_FALLBACK_MAX_AGE_MS = DAY_MS; // âge max (depuis sa RÉCUPÉRATION) d'une valeur resservie
const HTTP_CLIENT_ERROR_MIN = 400;
const HTTP_SERVER_ERROR_MIN = 500;

const lastGoodBySeries = new Map(); // seriesId -> { observation: {value, date, yoy?}, fetchedMs: epoch ms }

/**
 * Variation annuelle (%) : compare la dernière observation au même mois un an
 * plus tôt (match AAAA-MM ; repli : 12e observation en arrière). Fonction PURE.
 * @param {Array<{value: string, date: string}>} observations Observations
 *   valides triées de la plus récente à la plus ancienne.
 * @param {number} latestValue Valeur de l'observation la plus récente.
 * @returns {number|null} Variation YoY arrondie à 2 décimales, ou null.
 */
export function computeYearOverYear(observations, latestValue) {
  const latestDate = observations[0].date;
  const lastYear = Number(latestDate.slice(0, 4)) - 1;
  const sameMonthLastYear = `${lastYear}${latestDate.slice(4, 7)}`;
  const previous = observations.find((o) => o.date.startsWith(sameMonthLastYear)) ?? observations[YOY_FALLBACK_INDEX];
  const previousValue = previous ? Number(previous.value) : null;
  if (!previousValue) return null;

  const yoyPct = (latestValue / previousValue - 1) * PERCENT;
  return Math.round(yoyPct * ROUND_FACTOR) / ROUND_FACTOR;
}

/**
 * Dernière observation VALIDE d'une réponse FRED (ignore les « . »), avec
 * option rythme annuel. Fonction PURE.
 * @param {Array<{value: string, date: string}>} rawObservations Observations
 *   brutes triées de la plus récente à la plus ancienne.
 * @param {{yoy?: boolean}} [options] `yoy` ajoute la variation annuelle en %.
 * @returns {{value: number, date: string, yoy?: number|null}|null} Observation
 *   la plus récente, ou null si aucune valeur valide.
 */
export function pickLatestObservation(rawObservations, { yoy = false } = {}) {
  const observations = (rawObservations || []).filter((o) => o.value !== ".");
  const latest = observations[0];
  if (!latest) return null;

  const value = Number(latest.value);
  if (!Number.isFinite(value)) return null;

  const result = { value, date: latest.date };
  if (yoy) result.yoy = computeYearOverYear(observations, value);
  return result;
}

/**
 * Statut HTTP porté par un message d'erreur de requête (« HTTP 503 sur … »).
 * Fonction PURE.
 * @param {Error} err Erreur de requête.
 * @returns {number|null} Statut HTTP, ou null (timeout, coupure réseau).
 */
function httpStatusOf(err) {
  const match = /HTTP (\d{3})/.exec(err?.message ?? "");
  return match ? Number(match[1]) : null;
}

/**
 * Une série mérite-t-elle une relance ? Oui sur timeout, coupure réseau ou
 * 5xx ; jamais sur 4xx (429 compris : relancer aggraverait le rate-limit).
 * Fonction PURE.
 * @param {Error} err Erreur de requête.
 * @returns {boolean} true si l'échec est transitoire.
 */
export function isRetryableFredError(err) {
  const status = httpStatusOf(err);
  if (status == null) return true;
  if (status >= HTTP_SERVER_ERROR_MIN) return true;
  return status < HTTP_CLIENT_ERROR_MIN;
}

/**
 * Description d'un échec SANS l'URL (qui porte la clé API FRED). Fonction PURE.
 * @param {Error} err Erreur de requête.
 * @returns {string} « HTTP 503 », « timeout » ou le type d'erreur réseau.
 */
export function describeFredError(err) {
  const status = httpStatusOf(err);
  if (status != null) return `HTTP ${status}`;
  if (err?.name === "AbortError" || err?.name === "TimeoutError") return "timeout";
  return err?.name ?? "erreur inconnue";
}

/**
 * Dernière observation valide d'une série FRED.
 * @param {string} seriesId Identifiant de série FRED (ex. "DGS2").
 * @param {string} apiKey Clé API FRED.
 * @param {function(string): Promise<object>} getJson GET JSON borné (timeout,
 *   limiteur par hôte, contrôle du statut) — celui du collecteur appelant.
 * @param {{yoy?: boolean}} [options] `yoy` ajoute la variation annuelle en %.
 * @returns {Promise<{value: number, date: string, yoy?: number|null}|null>}
 *   Observation la plus récente, ou null si la série n'a aucune valeur valide.
 * @throws {Error} Statut HTTP non-2xx, timeout ou JSON invalide.
 */
export async function fetchLatestFredObservation(seriesId, apiKey, getJson, { yoy = false } = {}) {
  const limit = yoy ? YOY_OBSERVATION_COUNT : LATEST_OBSERVATION_LOOKBACK;
  const url = `${FRED_URL}?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=${limit}`;
  const json = await getJson(url);
  return pickLatestObservation(json?.observations, { yoy });
}

/**
 * Attend une durée donnée.
 * @param {number} delayMs Durée d'attente (ms).
 * @returns {Promise<void>} Résolue après delayMs.
 */
function wait(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

/**
 * Lance une série et capture son issue, sans jamais lever.
 * @param {function(): Promise<object|null>} fetchOne Récupération d'une série.
 * @returns {Promise<{ok: boolean, value?: object|null, error?: Error}>} Issue.
 */
async function attempt(fetchOne) {
  try {
    const value = await fetchOne();
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Dernière valeur réussie d'une série si elle a été récupérée récemment.
 * @param {string} seriesId Identifiant de série FRED.
 * @param {number} nowMs Instant de référence (epoch ms).
 * @returns {object|null} Observation marquée `cached: true`, ou null.
 */
function recentFallback(seriesId, nowMs) {
  const entry = lastGoodBySeries.get(seriesId);
  if (!entry) return null;
  if (nowMs - entry.fetchedMs > FRED_FALLBACK_MAX_AGE_MS) return null;
  return { ...entry.observation, cached: true };
}

/**
 * Récupère un lot de séries FRED en parallèle : relance unique des échecs
 * transitoires, log de chaque échec final, repli sur la dernière valeur
 * réussie (récupérée il y a moins d'un jour). Lève si TOUTES les séries
 * échouent sans repli, pour que la source passe en stale au lieu de rester
 * « ok » avec que des null.
 * @param {Object<string, string>} seriesMap Clé de sortie -> identifiant FRED.
 * @param {string} apiKey Clé API FRED.
 * @param {function(string): Promise<object>} getJson GET JSON du collecteur.
 * @param {{source: string, yoyKeys?: Set<string>}} options Nom de la source
 *   (logs) et clés pour lesquelles calculer la variation annuelle.
 * @returns {Promise<Object<string, object|null>>} Une entrée par clé ({value,
 *   date, yoy?, cached?} ou null).
 * @throws {Error} Si toutes les séries ont échoué sans valeur de repli.
 */
export async function settleFredSeries(seriesMap, apiKey, getJson, { source, yoyKeys = new Set() }) {
  const keys = Object.keys(seriesMap);
  const fetchers = keys.map((key) => () => fetchLatestFredObservation(seriesMap[key], apiKey, getJson, { yoy: yoyKeys.has(key) }));

  const outcomes = await Promise.all(fetchers.map(attempt));
  const retryIndexes = outcomes
    .map((outcome, i) => (!outcome.ok && isRetryableFredError(outcome.error) ? i : -1))
    .filter((i) => i >= 0);
  if (retryIndexes.length) {
    await wait(FRED_RETRY_DELAY_MS);
    const retried = await Promise.all(retryIndexes.map((i) => attempt(fetchers[i])));
    retryIndexes.forEach((i, j) => {
      outcomes[i] = retried[j];
    });
  }

  const nowMs = Date.now();
  const out = {};
  const failures = [];
  let hasAnyValue = false;
  keys.forEach((key, i) => {
    const seriesId = seriesMap[key];
    const outcome = outcomes[i];
    if (outcome.ok) {
      out[key] = outcome.value;
      if (outcome.value) lastGoodBySeries.set(seriesId, { observation: outcome.value, fetchedMs: nowMs });
      hasAnyValue = true;
      return;
    }
    const reason = describeFredError(outcome.error);
    const fallback = recentFallback(seriesId, nowMs);
    out[key] = fallback;
    if (fallback) hasAnyValue = true;
    failures.push(`${seriesId} (${reason})`);
    const suite = fallback ? `dernière valeur resservie (${fallback.date})` : "aucune valeur de repli";
    logger.warn(`[${source}] série FRED ${seriesId} en échec : ${reason} — ${suite}`);
  });

  if (!hasAnyValue) {
    throw new Error(`toutes les séries FRED en échec : ${failures.join(", ")}`);
  }
  return out;
}

/**
 * Vide la mémoire des dernières valeurs réussies (tests uniquement).
 */
export function resetFredFallbacks() {
  lastGoodBySeries.clear();
}
