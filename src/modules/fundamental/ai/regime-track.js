import { r2 } from "./curve.js";
import { priceAt } from "./prevision.js";
import { computeRegime } from "./regime.js";
import { logger } from "../../logs/index.js";
import { fetchMacroMomentum } from "../collectors/macro-momentum.js";
import {
  loadLatestRegime,
  loadLatestSnapshot,
  loadMetricsSince,
  loadRegimesSince,
  saveRegime,
} from "../persistence/store.js";

/**
 * TRACK RECORD de la boussole de régime — l'accountability qui manquait : la
 * boussole (calcul PUR, sans IA) est ÉMISE une fois par jour et confrontée au
 * réalisé à 90 j (forward return du BTC). On juge le biais (haussier/baissier/
 * neutre) contre le mouvement effectif ; les taux backtestés inscrits dans
 * l'engine ne remplacent pas la mesure en live.
 *
 * Deux responsabilités séparées :
 *   - assembleRegime : orchestration I/O (snapshot + momentum macro + flux
 *     corporate + amortisseur), partagée par la route API et l'émission.
 *   - émission/évaluation : persiste une émission datée, l'évalue à échéance.
 */

const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const MINUTE_MS = 60000;

const CORP_FLUX_WINDOW_MS = 30 * DAY_MS; // fenêtre du flux net trésoreries corporate
const REGIME_HORIZON_JOURS = 90; // échéance d'évaluation (borne basse du swing/cycle)
const REGIME_HORIZON_MS = REGIME_HORIZON_JOURS * DAY_MS;
const PRICE_MATCH_TOL_MS = 12 * HOUR_MS; // appariement prix autour de l'échéance
const EVAL_WINDOW_MS = 200 * DAY_MS; // rescan : couvre l'horizon 90-180 j + marge
const NEUTRE_BAND_PCT = 5; // % : sous cette amplitude à 90 j, mouvement jugé neutre
const EMISSION_THROTTLE_MS = 20 * HOUR_MS; // une seule émission par jour
const EVAL_THROTTLE_MS = 10 * MINUTE_MS; // throttle du rescan d'évaluation
const REGIME_CACHE_TTL_MS = 15 * MINUTE_MS; // cache des lectures API (évite un fetch FRED live par requête)

// Publication du track record GELÉE tant que le rodage (~1 émission/j -> 30
// échéances à 90 j) n'est pas atteint sur des émissions non modifiées. Les
// évaluations à 90 j n'arrivent que 3 mois après la première émission — le
// score reste `null` d'ici là, affiché comme « en rodage », pas une performance.
const PUBLICATION_GELEE = true;
const MIN_REGIME_EVALS = 30; // échéances évaluées requises (~30 j de rodage)

const BIAIS_HAUSSIER = new Set(["haussier", "haussier modéré", "haussier fort"]);
const BIAIS_BAISSIER = new Set(["baissier", "baissier modéré"]);

let lastEvalTs = 0; // dernier scan d'évaluation (epoch ms)
let regimeCache = { ts: 0, value: null }; // dernière boussole assemblée (cache lecture API)

/**
 * Direction d'un biais de zone : +1 (haussier), −1 (baissier), 0 (neutre).
 * @param {string} biais Libellé de biais de la boussole.
 * @returns {number} −1 | 0 | +1.
 */
function directionBiais(biais) {
  if (BIAIS_HAUSSIER.has(biais)) return 1;
  if (BIAIS_BAISSIER.has(biais)) return -1;
  return 0;
}

/**
 * Flux net des trésoreries corporate BTC sur ~30 j (I/O) : dernière valeur
 * moins première sur la fenêtre. Repli null si moins de 2 points.
 * @returns {Promise<number|null>} Δ BTC détenus, ou null.
 */
export async function corpBtcFlux() {
  const series = await loadMetricsSince(Date.now() - CORP_FLUX_WINDOW_MS);
  const points = series
    .map((snap) => snap.metrics?.corpBtcHoldings)
    .filter((value) => value != null && Number.isFinite(value));
  if (points.length < 2) return null;
  return points[points.length - 1] - points[0];
}

/**
 * Assemble la boussole COURANTE : dernier snapshot + momentum macro + flux
 * corporate + amortisseur (vs dernière émission publiée). Orchestration I/O
 * partagée par la route API (lecture) et l'émission quotidienne (persistée).
 * Les lectures API ne persistent pas et sont mises en cache (REGIME_CACHE_TTL_MS)
 * pour ne pas déclencher un fetch FRED live à chaque requête ; l'amortisseur
 * recalcule le même état figé (le compteur n'avance qu'à l'émission).
 * @param {object} [options] Options.
 * @param {boolean} [options.force] Ignore le cache et le rafraîchit (émission).
 * @param {object|null} [options.previous] Dernière émission (évite un rechargement).
 * @returns {Promise<{regime: object, snapshotTs: number|null,
 *   snapshotAgeMs: number|null}>} Boussole + ts/âge du snapshot source.
 */
export async function assembleRegime({ force = false, previous } = {}) {
  if (!force && regimeCache.value && Date.now() - regimeCache.ts < REGIME_CACHE_TTL_MS) {
    return regimeCache.value;
  }

  // 4 I/O indépendantes en une vague (snapshot + FRED live + scan flux + dernière
  // émission). `previous` fourni par l'émission -> évite un 2e chargement.
  const chargements = [loadLatestSnapshot(), fetchMacroMomentum(), corpBtcFlux()];
  if (previous === undefined) chargements.push(loadLatestRegime().catch(() => null));
  const [snap, macro, corpBtcMom, previousCharge] = await Promise.all(chargements);
  const previousRegime = previous === undefined ? previousCharge : previous;

  const cycle = snap?.axes?.onchain?.cycle ?? {};
  const valuation = snap?.axes?.onchain?.valuation ?? {};
  const fred = snap?.axes?.macro?.fred ?? {};
  const snapshotAgeMs = snap?.ts != null ? Date.now() - snap.ts : null;

  const regime = computeRegime(
    {
      btcPrice: valuation.btcPrice ?? cycle.btcPrice ?? null,
      mayer: cycle.mayer?.valeur ?? null,
      mvrv: valuation.mvrv?.valeur ?? null,
      puell: valuation.puell?.valeur ?? null,
      realizedPrice: valuation.realizedPrice ?? null,
      cyclePosition: cycle.position ?? null,
      hySpread: fred.highYieldSpread?.value ?? null,
      corpBtcMom,
      snapshotAgeMs,
      ...macro,
    },
    previousRegime,
  );
  const result = { regime, snapshotTs: snap?.ts ?? null, snapshotAgeMs };
  regimeCache = { ts: Date.now(), value: result };
  return result;
}

/**
 * Construit l'émission à persister depuis une boussole assemblée : instant
 * d'émission, échéance à 90 j, prix de base et état figé (les champs d'émission
 * ne sont jamais réécrits — seule l'évaluation ajoute `realise`/`outcome`).
 * @param {object} regime Boussole (computeRegime).
 * @param {number|null} snapshotTs Timestamp du snapshot source.
 * @returns {object} Record d'émission prêt à persister.
 */
function buildRegimeRecord(regime, snapshotTs) {
  const baseTs = Date.now();
  return {
    baseTs,
    targetTs: baseTs + REGIME_HORIZON_MS,
    snapshotTs,
    horizonJours: REGIME_HORIZON_JOURS,
    prixBase: regime.niveaux?.prixBtc ?? null,
    zone: regime.zone,
    zoneBrute: regime.zoneBrute,
    biais: regime.biais,
    biaisSign: directionBiais(regime.biais),
    confiance: regime.confiance,
    score: regime.score,
    override: regime.override,
    perime: regime.perime,
    damper: regime.damper,
    blocs: regime.blocs,
    niveaux: regime.niveaux,
  };
}

/**
 * Émet la boussole du jour si aucune émission récente (throttle 20 h) et si le
 * prix de base est disponible. Évalue d'abord les émissions échues. Ne throw
 * jamais — une panne d'émission ne fait pas tomber le service.
 * @returns {Promise<object|null>} Record émis, ou null (throttlé / sans prix / échec).
 */
export async function emitDailyRegime() {
  await evaluateDueRegimes({ force: true });
  const last = await loadLatestRegime().catch(() => null);
  if (last?.baseTs && Date.now() - last.baseTs < EMISSION_THROTTLE_MS) {
    logger.info("[regime] émission ignorée (déjà émise dans les 20 dernières heures)");
    return null;
  }
  try {
    const { regime, snapshotTs } = await assembleRegime({ force: true, previous: last });
    if (regime.niveaux?.prixBtc == null) {
      logger.warn("[regime] émission ignorée : pas de prix BTC dans le dernier snapshot");
      return null;
    }
    const record = buildRegimeRecord(regime, snapshotTs);
    const file = await saveRegime(record);
    logger.info(`[regime] boussole émise (${record.zone} / ${record.biais}, conf ${record.confiance}) → ${file}`);
    return record;
  } catch (err) {
    logger.warn(`[regime] émission quotidienne échouée : ${err.message}`);
    return null;
  }
}

/**
 * Résultat d'une émission : conforme/contraire/neutre. Un mouvement sous la
 * bande neutre (±NEUTRE_BAND_PCT) ne tranche pas un biais directionnel ; pour un
 * biais neutre, rester dans la bande EST conforme.
 * @param {number} biaisSign Direction du biais (−1 | 0 | +1).
 * @param {number} retPct Rendement réalisé à l'échéance (%).
 * @returns {string} "conforme" | "contraire" | "neutre".
 */
function resultatRegime(biaisSign, retPct) {
  const ampleurFaible = Math.abs(retPct) <= NEUTRE_BAND_PCT;
  if (biaisSign === 0) return ampleurFaible ? "conforme" : "contraire";
  if (ampleurFaible) return "neutre";
  return Math.sign(retPct) === biaisSign ? "conforme" : "contraire";
}

/**
 * Évalue une émission dont l'échéance est passée : forward return du BTC depuis
 * le prix de base, résultat vs biais. Idempotent (no-op si déjà évaluée ou trop
 * tôt). Les seuils/biais de l'émission font foi.
 * @mutates record — ajoute `realise` et `outcome`.
 * @param {object} record Émission de régime persistée.
 * @returns {Promise<{record: object, evaluated: boolean}>} Record + évaluée ou non.
 */
export async function evaluateRegime(record) {
  if (!record || record.realise || record.outcome) return { record, evaluated: false };
  if (record.prixBase == null || record.prixBase === 0 || record.targetTs == null) return { record, evaluated: false };
  if (Date.now() < record.targetTs) return { record, evaluated: false };

  const series = await loadMetricsSince(record.targetTs - PRICE_MATCH_TOL_MS);
  const px = priceAt(series, "btcPrice", record.targetTs, PRICE_MATCH_TOL_MS);
  if (!px) return { record, evaluated: false };

  const retPct = r2(((px.v - record.prixBase) / record.prixBase) * 100);
  const resultat = resultatRegime(record.biaisSign, retPct);
  record.realise = {
    prix: r2(px.v),
    ts: px.ts,
    retPct,
    resultat,
    directionOk: resultat === "conforme",
  };
  record.outcome = { evaluatedAt: Date.now() };
  return { record, evaluated: true };
}

/**
 * Évalue les émissions arrivées à échéance (forward 90 j). Idempotent, throttlé,
 * ne throw jamais.
 * @param {{ force?: boolean }} [options] force ignore le throttle.
 * @returns {Promise<number>} Nombre d'émissions évaluées sur ce scan.
 */
export async function evaluateDueRegimes({ force = false } = {}) {
  if (!force && Date.now() - lastEvalTs < EVAL_THROTTLE_MS) return 0;
  lastEvalTs = Date.now();
  let done = 0;
  try {
    const recs = await loadRegimesSince(Date.now() - EVAL_WINDOW_MS);
    for (const rec of recs) {
      if (rec.outcome) continue;
      const { evaluated } = await evaluateRegime(rec);
      if (evaluated) {
        await saveRegime(rec); // même baseTs → réécrit le même fichier
        done++;
      }
    }
    if (done) logger.info(`[regime] ${done} boussole(s) évaluée(s) contre le réalisé`);
  } catch (err) {
    logger.warn(`[regime] évaluation échouée : ${err.message}`);
  }
  return done;
}

/**
 * Pourcentage entier d'une part sur un total, ou null si total nul.
 * @param {number} part Numérateur.
 * @param {number} total Dénominateur.
 * @returns {number|null} Pourcentage arrondi, ou null.
 */
function pourcentage(part, total) {
  return total ? Math.round((part / total) * 100) : null;
}

/**
 * Statistiques agrégées du track record sur une liste d'émissions. Seules les
 * émissions évaluées comptent ; `justesseDirection` ignore les issues neutres
 * (le biais n'y était pas tranché).
 * @param {Array<object>} records Émissions de régime (évaluées ou non).
 * @returns {{n: number, conformePct: number|null, justesseDirection: number|null,
 *   neutrePct: number|null, horizonJours: number,
 *   rodage: {minEvals: number, gelee: boolean, pret: boolean}}} Track record.
 */
export function statsOfRegimes(records) {
  const counts = { n: 0, conforme: 0, contraire: 0, neutre: 0 };
  for (const rec of records) {
    if (!rec.realise) continue;
    counts.n++;
    if (rec.realise.resultat === "conforme") counts.conforme++;
    else if (rec.realise.resultat === "contraire") counts.contraire++;
    else counts.neutre++;
  }
  const tranchants = counts.conforme + counts.contraire;
  return {
    n: counts.n,
    conformePct: pourcentage(counts.conforme, counts.n),
    justesseDirection: pourcentage(counts.conforme, tranchants),
    neutrePct: pourcentage(counts.neutre, counts.n),
    horizonJours: REGIME_HORIZON_JOURS,
    rodage: { minEvals: MIN_REGIME_EVALS, gelee: PUBLICATION_GELEE, pret: !PUBLICATION_GELEE && counts.n >= MIN_REGIME_EVALS },
  };
}
