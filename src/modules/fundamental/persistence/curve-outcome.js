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
const DAY = 86400000;
const TOL = 6 * 3600000; // appariement du prix réalisé au jour cible (snapshots ~horaires)
// ZONE NEUTRE : sous ce mouvement réalisé (en % vs t0), le point n'est PAS noté
// en direction. Couvre le bruit de cotation (FX bouge de ±0.05 %/j) ET les
// marchés fermés (week-end, jours fériés US : prix figé = 0.00 %). Sans ça, on
// comptait des "mauvaises directions" sur des jours sans aucun mouvement.
const FLAT_PCT = 0.15;
const round = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000);

const LABEL_TO_KEY = new Map(ASSETS.map(([k, l]) => [l, k]));

/** Snapshot le plus proche de `ts` dans la série, dans la tolérance. */
function nearest(series, ts, tol) {
  let best = null;
  let bestDist = Infinity;
  for (const s of series) {
    const d = Math.abs(s.ts - ts);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best && bestDist <= tol ? best : null;
}

/** Évalue une courbe d'actif contre les prix réalisés. */
function scoreAsset(a, baseTs, series) {
  const key = LABEL_TO_KEY.get(a.actif);
  const t0 = a.courbe?.find((p) => p.t_jours === 0)?.valeur ?? null;

  const points = [];
  let hits = 0;
  let scored = 0;
  let errSum = 0;
  let errCount = 0;

  for (const p of a.courbe ?? []) {
    if (p.t_jours === 0) continue; // t0 = ancre, pas une projection
    const target = baseTs + p.t_jours * DAY;
    if (Date.now() < target) {
      points.push({ t_jours: p.t_jours, projete: p.valeur, ready: false });
      continue;
    }
    const snap = key ? nearest(series, target, TOL) : null;
    const realise = snap ? snap.metrics?.[key] : null;
    if (!Number.isFinite(realise) || !Number.isFinite(t0)) {
      points.push({ t_jours: p.t_jours, projete: p.valeur, ready: true, realise: null });
      continue;
    }
    const dirProj = Math.sign(p.valeur - t0);
    const dirReal = Math.sign(realise - t0);
    const mouvementPct = t0 !== 0 ? round(((realise - t0) / Math.abs(t0)) * 100) : null;
    // Marché plat (|mouvement| < FLAT_PCT) : direction non notée — juger un
    // sens sur un non-mouvement (marché fermé, bruit FX) ne mesure rien.
    const flat = mouvementPct != null && Math.abs(mouvementPct) < FLAT_PCT;
    const bonneDirection = dirProj === 0 || flat ? null : dirProj === dirReal;
    const erreurPct = realise !== 0 ? round(((p.valeur - realise) / Math.abs(realise)) * 100) : null;
    if (bonneDirection != null) {
      scored++;
      if (bonneDirection) hits++;
    }
    if (erreurPct != null && !flat) {
      errSum += Math.abs(erreurPct);
      errCount++;
    }
    points.push({
      t_jours: p.t_jours,
      projete: p.valeur,
      realise: round(realise),
      mouvementPct,
      plat: flat || undefined,
      erreurPct,
      bonneDirection,
    });
  }

  return {
    actif: a.actif,
    direction: a.direction ?? null,
    confiance: a.confiance ?? null,
    t0,
    pointsEvalues: scored,
    directionScore: scored ? round((hits / scored) * 100) : null, // % de points bien orientés
    mapePct: errCount ? round(errSum / errCount) : null, // erreur absolue moyenne en %
    points,
  };
}

/**
 * Calcule le suivi a posteriori d'une courbe (par ts = baseTs, ou latest si
 * null). null si aucune courbe. `available:false` si les prix de la fenêtre ne
 * sont pas encore disponibles.
 */
export async function computeCurveOutcome(curveTs) {
  const curve = curveTs == null ? await loadLatestCurve() : await loadCurveByTs(curveTs);
  if (!curve) return null;

  const baseTs = curve.baseTs;
  const horizon = curve.horizonJours;
  const series = await loadMetricsSince(baseTs - TOL);

  const actifs = (curve.actifs ?? []).map((a) => scoreAsset(a, baseTs, series));

  // Agrégat directionnel sur les actifs effectivement évalués.
  const notés = actifs.filter((a) => a.directionScore != null);
  const directionScoreGlobal = notés.length
    ? round(notés.reduce((s, a) => s + a.directionScore, 0) / notés.length)
    : null;
  const mapésValides = actifs.filter((a) => a.mapePct != null);
  const mapeGlobal = mapésValides.length
    ? round(mapésValides.reduce((s, a) => s + a.mapePct, 0) / mapésValides.length)
    : null;

  const elapsedDays = round((Date.now() - baseTs) / DAY);

  return {
    curveTs: baseTs,
    curveIso: new Date(baseTs).toISOString(),
    provider: curve.provider ?? null,
    horizonJours: horizon,
    elapsedDays,
    complete: elapsedDays >= horizon,
    available: notés.length > 0,
    directionScoreGlobal, // % moyen de points bien orientés (tous actifs)
    mapeGlobal, // erreur absolue moyenne en % (tous actifs)
    note:
      "Comparaison FACTUELLE projeté vs réalisé (prix repris des snapshots), sans IA. Le score directionnel = % de points partis du bon côté vs le cours de départ. " +
      `Points "plats" (mouvement réalisé < ${FLAT_PCT} % : bruit, marché fermé) non notés en direction. ` +
      "Projections illustratives : juger la DIRECTION, pas le point exact.",
    actifs,
  };
}
