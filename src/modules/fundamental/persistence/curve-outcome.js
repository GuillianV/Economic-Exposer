import { loadCurveByTs, loadLatestCurve, loadMetricsSince } from "./store.js";
import { ASSETS } from "../ai/curve.js";

/**
 * Suivi A POSTERIORI d'une courbe projetée — « a-t-on été bon ? », comme DONNÉE.
 *
 * 100 % DÉTERMINISTE, aucun appel LLM : pour une courbe passée dont l'horizon
 * est (au moins partiellement) écoulé, on compare CHAQUE point projeté au prix
 * RÉELLEMENT observé (repris des snapshots déjà stockés) : erreur en % et
 * surtout JUSTESSE DIRECTIONNELLE (le projeté est-il parti du bon côté vs le
 * cours de départ ?). C'est ce qui compte pour une projection illustrative : la
 * DIRECTION, pas le point exact.
 *
 * On reste factuel (pas de note morale sur l'IA) mais on fournit un score
 * directionnel agrégé — c'est précisément l'usage voulu : vérifier la qualité
 * des projections dans le temps.
 */
const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const TOL_MS = 6 * HOUR_MS; // appariement du prix réalisé au jour cible (snapshots ~horaires)
// ZONE NEUTRE : sous ce mouvement réalisé (en % vs t0), le point n'est PAS noté
// en direction. Couvre le bruit de cotation (FX bouge de ±0.05 %/j) ET les
// marchés fermés (week-end, jours fériés US : prix figé = 0.00 %). Sans ça, on
// comptait des "mauvaises directions" sur des jours sans aucun mouvement.
const FLAT_PCT = 0.15;

const LABEL_TO_KEY = new Map(ASSETS.map(([key, label]) => [label, key]));

/**
 * Arrondit à 3 décimales, en laissant passer null/non-fini.
 * @param {number|null} value Valeur à arrondir.
 * @returns {number|null} Valeur arrondie, ou null.
 */
function round3(value) {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(value * 1000) / 1000;
}

/**
 * Snapshot le plus proche d'un timestamp dans la série, dans la tolérance.
 * @param {Array<{ts: number, metrics: object}>} series Snapshots candidats.
 * @param {number} ts Timestamp cible (epoch ms).
 * @param {number} tolMs Écart maximal accepté (ms).
 * @returns {{ts: number, metrics: object}|null} Snapshot le plus proche, ou null.
 */
function nearest(series, ts, tolMs) {
  let best = null;
  let bestDist = Infinity;
  for (const snap of series) {
    const dist = Math.abs(snap.ts - ts);
    if (dist < bestDist) {
      bestDist = dist;
      best = snap;
    }
  }
  return best && bestDist <= tolMs ? best : null;
}

/**
 * Évalue la courbe d'un actif contre les prix réalisés : erreur %, direction
 * point par point et agrégats (score directionnel, MAPE).
 * @param {object} asset Courbe d'actif { actif, direction, confiance, courbe }.
 * @param {number} baseTs Timestamp d'émission de la courbe (epoch ms).
 * @param {Array<{ts: number, metrics: object}>} series Historique de métriques.
 * @returns {object} { actif, direction, confiance, t0, pointsEvalues,
 *   directionScore, mapePct, points }.
 */
function scoreAsset(asset, baseTs, series) {
  const metricKey = LABEL_TO_KEY.get(asset.actif);
  const t0 = asset.courbe?.find((point) => point.t_jours === 0)?.valeur ?? null;

  const points = [];
  let hits = 0;
  let scored = 0;
  let errSum = 0;
  let errCount = 0;

  for (const point of asset.courbe ?? []) {
    if (point.t_jours === 0) continue; // t0 = ancre, pas une projection

    const target = baseTs + point.t_jours * DAY_MS;
    if (Date.now() < target) {
      points.push({ t_jours: point.t_jours, projete: point.valeur, ready: false });
      continue;
    }

    const snap = metricKey ? nearest(series, target, TOL_MS) : null;
    const realise = snap ? snap.metrics?.[metricKey] : null;
    if (!Number.isFinite(realise) || !Number.isFinite(t0)) {
      points.push({ t_jours: point.t_jours, projete: point.valeur, ready: true, realise: null });
      continue;
    }

    const dirProj = Math.sign(point.valeur - t0);
    const dirReal = Math.sign(realise - t0);
    const mouvementPct = t0 !== 0 ? round3(((realise - t0) / Math.abs(t0)) * 100) : null;
    // Marché plat (|mouvement| < FLAT_PCT) : direction non notée — juger un
    // sens sur un non-mouvement (marché fermé, bruit FX) ne mesure rien.
    const flat = mouvementPct != null && Math.abs(mouvementPct) < FLAT_PCT;

    let bonneDirection = null;
    if (dirProj !== 0 && !flat) bonneDirection = dirProj === dirReal;

    const erreurPct = realise !== 0 ? round3(((point.valeur - realise) / Math.abs(realise)) * 100) : null;

    if (bonneDirection != null) {
      scored++;
      if (bonneDirection) hits++;
    }
    if (erreurPct != null && !flat) {
      errSum += Math.abs(erreurPct);
      errCount++;
    }

    points.push({
      t_jours: point.t_jours,
      projete: point.valeur,
      realise: round3(realise),
      mouvementPct,
      plat: flat || undefined,
      erreurPct,
      bonneDirection,
    });
  }

  return {
    actif: asset.actif,
    direction: asset.direction ?? null,
    confiance: asset.confiance ?? null,
    t0,
    pointsEvalues: scored,
    directionScore: scored ? round3((hits / scored) * 100) : null, // % de points bien orientés
    mapePct: errCount ? round3(errSum / errCount) : null, // erreur absolue moyenne en %
    points,
  };
}

/**
 * Suivi a posteriori d'une courbe : projeté vs réalisé point par point, avec
 * agrégats directionnels et d'erreur tous actifs confondus.
 * @param {number|null} curveTs Timestamp de la courbe (= baseTs), ou null pour
 *   la plus récente.
 * @returns {Promise<object|null>} Outcome complet, `available: false` si aucun
 *   point n'a encore pu être évalué, null si aucune courbe n'existe.
 */
export async function computeCurveOutcome(curveTs) {
  const curve = curveTs == null ? await loadLatestCurve() : await loadCurveByTs(curveTs);
  if (!curve) return null;

  const baseTs = curve.baseTs;
  const horizon = curve.horizonJours;
  const series = await loadMetricsSince(baseTs - TOL_MS);

  const actifs = (curve.actifs ?? []).map((asset) => scoreAsset(asset, baseTs, series));

  const actifsNotes = actifs.filter((asset) => asset.directionScore != null);
  const directionScoreGlobal = actifsNotes.length
    ? round3(actifsNotes.reduce((sum, asset) => sum + asset.directionScore, 0) / actifsNotes.length)
    : null;

  const actifsAvecMape = actifs.filter((asset) => asset.mapePct != null);
  const mapeGlobal = actifsAvecMape.length
    ? round3(actifsAvecMape.reduce((sum, asset) => sum + asset.mapePct, 0) / actifsAvecMape.length)
    : null;

  const elapsedDays = round3((Date.now() - baseTs) / DAY_MS);

  return {
    curveTs: baseTs,
    curveIso: new Date(baseTs).toISOString(),
    provider: curve.provider ?? null,
    horizonJours: horizon,
    elapsedDays,
    complete: elapsedDays >= horizon,
    available: actifsNotes.length > 0,
    directionScoreGlobal, // % moyen de points bien orientés (tous actifs)
    mapeGlobal, // erreur absolue moyenne en % (tous actifs)
    note:
      "Comparaison FACTUELLE projeté vs réalisé (prix repris des snapshots), sans IA. Le score directionnel = % de points partis du bon côté vs le cours de départ. " +
      `Points "plats" (mouvement réalisé < ${FLAT_PCT} % : bruit, marché fermé) non notés en direction. ` +
      "Projections illustratives : juger la DIRECTION, pas le point exact.",
    actifs,
  };
}
