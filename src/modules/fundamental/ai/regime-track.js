import { pourcentage, r2 } from "./curve.js";
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

// Publication du track record GELÉE. La base de jugement N'EST PAS le nombre
// d'émissions quotidiennes (elles se recouvrent à 89/90 sur 90 j -> quasi UN
// seul échantillon), mais le nombre de fenêtres 90 j DISJOINTES (~4/an). Le
// rodage exige MIN_REGIME_INDEP fenêtres indépendantes -> plusieurs ANNÉES.
const PUBLICATION_GELEE = true;
const MIN_REGIME_INDEP = 8; // fenêtres 90 j non chevauchantes requises (~2 ans à 4/an)

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
 * @returns {Promise<{regime: object, snapshotTs: number|null,
 *   snapshotAgeMs: number|null}>} Boussole + ts/âge du snapshot source.
 */
export async function assembleRegime({ force = false } = {}) {
  if (!force && regimeCache.value && Date.now() - regimeCache.ts < REGIME_CACHE_TTL_MS) {
    return regimeCache.value;
  }

  // 4 I/O indépendantes en une vague (snapshot + FRED live + scan flux + dernière
  // émission, qui sert de mémoire à l'amortisseur).
  const [snap, macro, corpBtcMom, previousRegime] = await Promise.all([
    loadLatestSnapshot(),
    fetchMacroMomentum(),
    corpBtcFlux(),
    loadLatestRegime().catch(() => null),
  ]);

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
    const { regime, snapshotTs } = await assembleRegime({ force: true });
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
 * Compte conforme/contraire/neutre sur des émissions évaluées.
 * @param {Array<object>} recs Émissions (chacune avec `realise`).
 * @returns {{n: number, conforme: number, contraire: number, neutre: number}} Compteur.
 */
function compteResultats(recs) {
  const counts = { n: 0, conforme: 0, contraire: 0, neutre: 0 };
  for (const rec of recs) {
    if (!rec.realise) continue;
    counts.n++;
    if (rec.realise.resultat === "conforme") counts.conforme++;
    else if (rec.realise.resultat === "contraire") counts.contraire++;
    else counts.neutre++;
  }
  return counts;
}

/**
 * Taux (conforme/direction/neutre) d'un compteur.
 * @param {{n: number, conforme: number, contraire: number, neutre: number}} c Compteur.
 * @returns {{n: number, conformePct: number|null, justesseDirection: number|null,
 *   neutrePct: number|null}} Taux ; `justesseDirection` ignore les neutres.
 */
function tauxDe(c) {
  return {
    n: c.n,
    conformePct: pourcentage(c.conforme, c.n),
    justesseDirection: pourcentage(c.conforme, c.conforme + c.contraire),
    neutrePct: pourcentage(c.neutre, c.n),
  };
}

/**
 * Sélection gloutonne des émissions dont les fenêtres 90 j NE SE RECOUVRENT PAS.
 * Les émissions quotidiennes évaluées à 90 j se chevauchent à 89/90 -> n=30
 * quotidien ≈ 1 seul échantillon indépendant. On ne retient qu'une émission par
 * fenêtre d'horizon (~4/an). Fonction PURE.
 * @param {Array<object>} recsEvalues Émissions évaluées (avec baseTs).
 * @returns {Array<object>} Sous-ensemble aux fenêtres 90 j disjointes.
 */
function fenetresIndependantes(recsEvalues) {
  const tries = [...recsEvalues].sort((a, b) => a.baseTs - b.baseTs);
  const retenues = [];
  let borneLibre = -Infinity;
  for (const rec of tries) {
    if (rec.baseTs >= borneLibre) {
      retenues.push(rec);
      borneLibre = rec.baseTs + REGIME_HORIZON_MS;
    }
  }
  return retenues;
}

/**
 * Direction prédite (−1|0|+1) sous une bande neutre à partir d'un rendement.
 * @param {number|null} retPct Rendement réalisé (%).
 * @returns {number|null} Signe borné, ou null si absent.
 */
function signeSousBande(retPct) {
  if (retPct == null) return null;
  if (Math.abs(retPct) <= NEUTRE_BAND_PCT) return 0;
  return Math.sign(retPct);
}

/**
 * Taux de conformité d'une stratégie de BENCHMARK sur des fenêtres évaluées :
 * un biais fixe/dérivé scoré exactement comme la boussole (même horizon, même
 * bande neutre). Sert à situer l'edge de la boussole au-dessus du naïf.
 * @param {Array<object>} recs Émissions évaluées (ordre chronologique).
 * @param {Function} biaisSignDe (recs, i) -> direction prédite (−1|0|+1) du
 *   benchmark à l'indice i, ou null si pas de prédiction.
 * @returns {number|null} % conforme du benchmark, ou null si aucune prédiction.
 */
function conformePctBenchmark(recs, biaisSignDe) {
  let n = 0;
  let conforme = 0;
  for (let i = 0; i < recs.length; i++) {
    const retPct = recs[i].realise?.retPct;
    if (retPct == null) continue;
    const sign = biaisSignDe(recs, i);
    if (sign == null) continue;
    n++;
    if (resultatRegime(sign, retPct) === "conforme") conforme++;
  }
  return pourcentage(conforme, n);
}

/**
 * Track record du régime, HONNÊTE sur l'indépendance des échantillons. Deux
 * lectures : `n` (émissions quotidiennes, chevauchantes à 89/90 -> INDICATIF) et
 * `independant` (fenêtres 90 j disjointes -> BASE DE JUGEMENT + benchmarks naïfs
 * pour situer l'edge). La publication ne se dégèle que sur l'indépendant.
 * @param {Array<object>} records Émissions de régime (évaluées ou non).
 * @returns {object} Track record { horizonJours, indicatif, independant, rodage, note }.
 */
export function statsOfRegimes(records) {
  const evalues = records.filter((rec) => rec.realise);
  const indep = fenetresIndependantes(evalues);

  // Benchmarks naïfs sur les MÊMES fenêtres indépendantes : buy&hold (toujours
  // haussier) donne le taux de base des hausses ; persistance (continue le
  // dernier mouvement réalisé) est un baseline redoutable car les régimes sont
  // autocorrélés. L'edge de la boussole = son conforme AU-DESSUS de ceux-là.
  const benchmarks = {
    toujoursHaussier: conformePctBenchmark(indep, () => 1),
    persistance: conformePctBenchmark(indep, (recs, i) => (i > 0 ? signeSousBande(recs[i - 1].realise?.retPct) : null)),
  };

  return {
    horizonJours: REGIME_HORIZON_JOURS,
    indicatif: tauxDe(compteResultats(evalues)), // chevauchant : ne prouve rien seul
    independant: { ...tauxDe(compteResultats(indep)), benchmarks },
    rodage: { minIndependant: MIN_REGIME_INDEP, gelee: PUBLICATION_GELEE, pret: !PUBLICATION_GELEE && indep.n >= MIN_REGIME_INDEP },
    note: "n indicatif = émissions quotidiennes (fenêtres 90j chevauchantes à 89/90) ; la publication se juge sur independant.n (fenêtres 90j disjointes, ~4/an) et son edge vs benchmarks.",
  };
}
