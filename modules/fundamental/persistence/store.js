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
const AI_STATE_FILE = path.join(DATA, "ai-state.json");

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function dayKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}
function tsToName(ts) {
  return new Date(ts).toISOString().replace(/[:.]/g, "-") + ".json";
}
function nameToTs(name) {
  const iso = name.replace(/\.json$/, "").replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z");
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

/** Liste générique {ts, file} d'un répertoire jour/<ts>.json, trié croissant. */
async function listRecords(rootDir, sinceMs = 0) {
  let days;
  try {
    days = await fs.readdir(rootDir);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const out = [];
  for (const day of days.filter((d) => DAY_RE.test(d)).sort()) {
    let files;
    try {
      files = await fs.readdir(path.join(rootDir, day));
    } catch {
      continue;
    }
    for (const f of files.filter((f) => f.endsWith(".json"))) {
      const ts = nameToTs(f);
      if (ts != null && ts >= sinceMs) out.push({ ts, file: path.join(rootDir, day, f) });
    }
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

function findNearestRef(records, ts, tolMs = 60000) {
  let best = null;
  let bestDist = Infinity;
  for (const r of records) {
    const d = Math.abs(r.ts - ts);
    if (d < bestDist) {
      bestDist = d;
      best = r;
    }
  }
  return best && bestDist <= tolMs ? best : null;
}

// ---- Snapshots ----

export async function saveSnapshot(record) {
  const dayDir = path.join(SNAP_DIR, dayKey(record.ts));
  await fs.mkdir(dayDir, { recursive: true });
  const file = path.join(dayDir, tsToName(record.ts));
  await fs.writeFile(file, JSON.stringify(record, null, 2), "utf8");
  return file;
}

export async function listSnapshots(sinceMs = 0) {
  return listRecords(SNAP_DIR, sinceMs);
}

export async function loadSnapshotByTs(ts, tolMs = 60000) {
  const list = await listSnapshots(0);
  const match = list.find((r) => r.ts === ts) || findNearestRef(list, ts, tolMs);
  return match ? readJson(match.file) : null;
}

export async function loadLatestSnapshot() {
  const list = await listSnapshots(0);
  const last = list[list.length - 1];
  return last ? readJson(last.file) : null;
}

/** Pour les tendances : [{ ts, metrics, stale }] sur une fenêtre, triés. */
export async function loadMetricsSince(sinceMs) {
  const list = await listSnapshots(sinceMs);
  const out = [];
  for (const { file } of list) {
    const snap = await readJson(file);
    if (snap) out.push({ ts: snap.ts, metrics: snap.metrics, stale: snap.stale });
  }
  return out;
}

// ---- Verdicts ----

export async function saveVerdict(record) {
  const dayDir = path.join(VERDICT_DIR, dayKey(record.ts));
  await fs.mkdir(dayDir, { recursive: true });
  const file = path.join(dayDir, tsToName(record.ts));
  await fs.writeFile(file, JSON.stringify(record, null, 2), "utf8");
  return file;
}

export async function listVerdicts(sinceMs = 0) {
  return listRecords(VERDICT_DIR, sinceMs);
}

export async function loadVerdictByTs(ts, tolMs = 60000) {
  const list = await listVerdicts(0);
  const match = list.find((r) => r.ts === ts) || findNearestRef(list, ts, tolMs);
  return match ? readJson(match.file) : null;
}

export async function loadLatestVerdict() {
  const list = await listVerdicts(0);
  const last = list[list.length - 1];
  return last ? readJson(last.file) : null;
}

// ---- Corrélation snapshot <-> verdict (par ts) ----

/** Le verdict produit à partir d'un snapshot (même ts). null si pas d'analyse. */
export async function getVerdictForSnapshot(ts, tolMs = 60000) {
  return loadVerdictByTs(ts, tolMs);
}

/** Le snapshot qui a produit un verdict (même ts). */
export async function getSnapshotForVerdict(ts, tolMs = 60000) {
  return loadSnapshotByTs(ts, tolMs);
}

// ---- État IA ----

export async function loadAiState() {
  return readJson(AI_STATE_FILE);
}

export async function saveAiState(state) {
  await fs.mkdir(DATA, { recursive: true });
  await fs.writeFile(AI_STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}
