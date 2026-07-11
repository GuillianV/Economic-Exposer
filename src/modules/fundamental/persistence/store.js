import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Stockage unifié.
 *
 *  - SNAPSHOTS : 1 fichier JSON par collecte, contenant TOUT (état complet
 *    des axes + métriques extraites + ts + stale) :
 *      data/snapshots/YYYY-MM-DD/<ISO-ts>.json
 *    (fusion metrics + full : un seul fichier fait foi.)
 *
 *  - VERDICTS : 1 fichier JSON par analyse IA, corrélé au snapshot par le ts :
 *      data/verdicts/YYYY-MM-DD/<ISO-ts>.json
 *
 *  - ÉTAT IA : data/ai-state.json ({ lastRunTs, refMetrics }).
 *
 * Snapshot et verdict produits dans le même tour de service partagent le MÊME
 * ts -> corrélation directe (getVerdictForSnapshot / getSnapshotForVerdict).
 */
const DATA = path.resolve(process.cwd(), "data");
const SNAP_DIR = path.join(DATA, "snapshots");
const VERDICT_DIR = path.join(DATA, "verdicts");
const PREVISION_DIR = path.join(DATA, "previsions");
const AI_STATE_FILE = path.join(DATA, "ai-state.json");

/**
 * Version du format de stockage (snapshots & verdicts). À incrémenter si la
 * forme change, pour qu'un consommateur de l'API puisse s'adapter sans casser.
 */
export const SCHEMA_VERSION = 1;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MINUTE_MS = 60000;
const NEAREST_TOL_MS = MINUTE_MS;

/**
 * Clé de répertoire jour (AAAA-MM-JJ) d'un timestamp.
 * @param {number} ts Timestamp epoch ms.
 * @returns {string} Jour au format AAAA-MM-JJ.
 */
function dayKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * Nom de fichier d'un record depuis son timestamp (ISO avec `:`/`.` → `-`).
 * @param {number} ts Timestamp epoch ms.
 * @returns {string} Nom de fichier `<ISO-ts>.json`.
 */
function tsToName(ts) {
  return new Date(ts).toISOString().replace(/[:.]/g, "-") + ".json";
}

/**
 * Timestamp d'un nom de fichier record (inverse de tsToName).
 * @param {string} name Nom de fichier `<ISO-ts>.json`.
 * @returns {number|null} Timestamp epoch ms, ou null si non parsable.
 */
function nameToTs(name) {
  const iso = name.replace(/\.json$/, "").replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z");
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Lit et parse un fichier JSON.
 * @param {string} file Chemin du fichier.
 * @returns {Promise<object|null>} Contenu parsé, ou null si le fichier n'existe pas.
 * @throws {Error} Toute erreur autre que ENOENT (JSON corrompu, droits…).
 */
async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Liste les références de records d'un répertoire `jour/<ts>.json`.
 * @param {string} rootDir Répertoire racine (SNAP_DIR, VERDICT_DIR…).
 * @param {number} [sinceMs] Timestamp minimal (epoch ms) des records renvoyés.
 * @returns {Promise<Array<{ts: number, file: string}>>} Références triées croissant.
 */
async function listRecords(rootDir, sinceMs = 0) {
  let days;
  try {
    days = await fs.readdir(rootDir);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }

  const refs = [];
  const dayDirs = days.filter((day) => DAY_RE.test(day)).sort();
  for (const day of dayDirs) {
    let files;
    try {
      files = await fs.readdir(path.join(rootDir, day));
    } catch {
      continue;
    }
    for (const file of files.filter((name) => name.endsWith(".json"))) {
      const ts = nameToTs(file);
      if (ts != null && ts >= sinceMs) refs.push({ ts, file: path.join(rootDir, day, file) });
    }
  }

  refs.sort((a, b) => a.ts - b.ts);
  return refs;
}

/**
 * Référence la plus proche d'un timestamp, dans une tolérance.
 * @param {Array<{ts: number, file: string}>} records Références candidates.
 * @param {number} ts Timestamp cible (epoch ms).
 * @param {number} [tolMs] Écart maximal accepté (ms).
 * @returns {{ts: number, file: string}|null} Référence la plus proche, ou null.
 */
function findNearestRef(records, ts, tolMs = NEAREST_TOL_MS) {
  let best = null;
  let bestDist = Infinity;
  for (const record of records) {
    const dist = Math.abs(record.ts - ts);
    if (dist < bestDist) {
      bestDist = dist;
      best = record;
    }
  }
  return best && bestDist <= tolMs ? best : null;
}

/**
 * Écrit un record daté dans `rootDir/jour/<ts>.json` (schemaVersion injecté).
 * @param {string} rootDir Répertoire racine du type de record.
 * @param {number} ts Timestamp du record (nomme le fichier et le jour).
 * @param {object} record Contenu à persister.
 * @returns {Promise<string>} Chemin du fichier écrit.
 */
async function writeRecord(rootDir, ts, record) {
  const dayDir = path.join(rootDir, dayKey(ts));
  await fs.mkdir(dayDir, { recursive: true });
  const file = path.join(dayDir, tsToName(ts));
  await fs.writeFile(file, JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...record }, null, 2), "utf8");
  return file;
}

/**
 * Charge le record le plus récent d'un répertoire.
 * @param {string} rootDir Répertoire racine du type de record.
 * @returns {Promise<object|null>} Record complet, ou null si aucun.
 */
async function loadLatestRecord(rootDir) {
  const refs = await listRecords(rootDir, 0);
  const last = refs[refs.length - 1];
  return last ? readJson(last.file) : null;
}

/**
 * Charge un record par timestamp exact, ou le plus proche dans la tolérance.
 * @param {string} rootDir Répertoire racine du type de record.
 * @param {number} ts Timestamp cible (epoch ms).
 * @param {number} tolMs Écart maximal accepté (ms).
 * @returns {Promise<object|null>} Record complet, ou null si aucun match.
 */
async function loadRecordByTs(rootDir, ts, tolMs) {
  const refs = await listRecords(rootDir, 0);
  const match = refs.find((ref) => ref.ts === ts) || findNearestRef(refs, ts, tolMs);
  return match ? readJson(match.file) : null;
}

/**
 * Persiste un snapshot de collecte.
 * @param {object} record Snapshot { ts, stale, metrics, axes, sources, meta }.
 * @returns {Promise<string>} Chemin du fichier écrit.
 */
export async function saveSnapshot(record) {
  return writeRecord(SNAP_DIR, record.ts, record);
}

/**
 * Références des snapshots depuis un timestamp.
 * @param {number} [sinceMs] Timestamp minimal (epoch ms).
 * @returns {Promise<Array<{ts: number, file: string}>>} Références triées croissant.
 */
export async function listSnapshots(sinceMs = 0) {
  return listRecords(SNAP_DIR, sinceMs);
}

/**
 * Snapshot par timestamp (exact ou le plus proche dans la tolérance).
 * @param {number} ts Timestamp cible (epoch ms).
 * @param {number} [tolMs] Écart maximal accepté (ms).
 * @returns {Promise<object|null>} Snapshot complet, ou null.
 */
export async function loadSnapshotByTs(ts, tolMs = NEAREST_TOL_MS) {
  return loadRecordByTs(SNAP_DIR, ts, tolMs);
}

/**
 * Snapshot le plus récent.
 * @returns {Promise<object|null>} Snapshot complet, ou null si aucun.
 */
export async function loadLatestSnapshot() {
  return loadLatestRecord(SNAP_DIR);
}

/**
 * Historique compact des métriques pour les tendances.
 * @param {number} sinceMs Timestamp minimal (epoch ms).
 * @returns {Promise<Array<{ts: number, metrics: object, stale: Array}>>}
 *   Entrées triées croissant.
 */
export async function loadMetricsSince(sinceMs) {
  const refs = await listSnapshots(sinceMs);
  const history = [];
  for (const { file } of refs) {
    const snap = await readJson(file);
    if (snap) history.push({ ts: snap.ts, metrics: snap.metrics, stale: snap.stale });
  }
  return history;
}

/**
 * Persiste un verdict d'analyse IA.
 * @param {object} record Verdict { ts, snapshotTs, verdict, provider… }.
 * @returns {Promise<string>} Chemin du fichier écrit.
 */
export async function saveVerdict(record) {
  return writeRecord(VERDICT_DIR, record.ts, record);
}

/**
 * Références des verdicts depuis un timestamp.
 * @param {number} [sinceMs] Timestamp minimal (epoch ms).
 * @returns {Promise<Array<{ts: number, file: string}>>} Références triées croissant.
 */
export async function listVerdicts(sinceMs = 0) {
  return listRecords(VERDICT_DIR, sinceMs);
}

/**
 * Verdict par timestamp (exact ou le plus proche dans la tolérance).
 * @param {number} ts Timestamp cible (epoch ms).
 * @param {number} [tolMs] Écart maximal accepté (ms).
 * @returns {Promise<object|null>} Verdict complet, ou null.
 */
export async function loadVerdictByTs(ts, tolMs = NEAREST_TOL_MS) {
  return loadRecordByTs(VERDICT_DIR, ts, tolMs);
}

/**
 * Verdict le plus récent.
 * @returns {Promise<object|null>} Verdict complet, ou null si aucun.
 */
export async function loadLatestVerdict() {
  return loadLatestRecord(VERDICT_DIR);
}

/**
 * Persiste une prévision directionnelle 24h (datée par son baseTs).
 * @param {object} record Prévision { baseTs, actifs, seuils… }.
 * @returns {Promise<string>} Chemin du fichier écrit.
 */
export async function savePrevision(record) {
  return writeRecord(PREVISION_DIR, record.baseTs, record);
}

/**
 * Références des prévisions depuis un timestamp.
 * @param {number} [sinceMs] Timestamp minimal (epoch ms).
 * @returns {Promise<Array<{ts: number, file: string}>>} Références triées croissant.
 */
export async function listPrevisions(sinceMs = 0) {
  return listRecords(PREVISION_DIR, sinceMs);
}

/**
 * Prévisions complètes depuis un timestamp — un seul scan du répertoire.
 * Un fichier corrompu (écriture interrompue) est ignoré, pas propagé : sinon un
 * seul JSON tronqué mettrait /latest et /stats en 500 permanent.
 * @param {number} [sinceMs] Timestamp minimal (epoch ms).
 * @returns {Promise<Array<object>>} Records complets triés croissant.
 */
export async function loadPrevisionsSince(sinceMs = 0) {
  const refs = await listRecords(PREVISION_DIR, sinceMs);
  const records = await Promise.all(refs.map((ref) => readJson(ref.file).catch(() => null)));
  return records.filter(Boolean);
}

/**
 * Prévision la plus récente.
 * @returns {Promise<object|null>} Record complet, ou null si aucun.
 */
export async function loadLatestPrevision() {
  return loadLatestRecord(PREVISION_DIR);
}

/**
 * Prévision par timestamp (exact ou le plus proche dans la tolérance).
 * @param {number} ts Timestamp cible (epoch ms).
 * @param {number} [tolMs] Écart maximal accepté (ms).
 * @returns {Promise<object|null>} Record complet, ou null.
 */
export async function loadPrevisionByTs(ts, tolMs = NEAREST_TOL_MS) {
  return loadRecordByTs(PREVISION_DIR, ts, tolMs);
}

/**
 * Verdict produit à partir d'un snapshot (même ts).
 * @param {number} ts Timestamp du snapshot (epoch ms).
 * @param {number} [tolMs] Écart maximal accepté (ms).
 * @returns {Promise<object|null>} Verdict, ou null si pas d'analyse.
 */
export async function getVerdictForSnapshot(ts, tolMs = NEAREST_TOL_MS) {
  return loadVerdictByTs(ts, tolMs);
}

/**
 * Snapshot qui a produit un verdict (même ts).
 * @param {number} ts Timestamp du verdict (epoch ms).
 * @param {number} [tolMs] Écart maximal accepté (ms).
 * @returns {Promise<object|null>} Snapshot, ou null.
 */
export async function getSnapshotForVerdict(ts, tolMs = NEAREST_TOL_MS) {
  return loadSnapshotByTs(ts, tolMs);
}

/**
 * État persistant du runner IA.
 * @returns {Promise<object|null>} { lastRunTs, refMetrics }, ou null si absent.
 */
export async function loadAiState() {
  return readJson(AI_STATE_FILE);
}

/**
 * Persiste l'état du runner IA.
 * @param {object} state État { lastRunTs, refMetrics }.
 * @returns {Promise<void>}
 */
export async function saveAiState(state) {
  await fs.mkdir(DATA, { recursive: true });
  await fs.writeFile(AI_STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}
