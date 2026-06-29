import express from "express";
import { logger } from "../logs/index.js";
import {
  listSnapshots,
  loadSnapshotByTs,
  loadLatestSnapshot,
  loadMetricsSince,
  listVerdicts,
  loadVerdictByTs,
  loadLatestVerdict,
  getVerdictForSnapshot,
  getSnapshotForVerdict,
} from "../fundamental/persistence/store.js";
import { getTrends } from "../fundamental/persistence/scheduler.js";

const DAY = 86400000;

function parseTs(raw) {
  if (raw == null) return null;
  if (/^\d+$/.test(raw)) return Number(raw); // epoch ms
  const t = Date.parse(raw); // ISO
  return Number.isFinite(t) ? t : null;
}

function parseSince(raw, defaultDays = 7) {
  const t = parseTs(raw);
  return t != null ? t : Date.now() - defaultDays * DAY;
}

const withIso = (r) => ({ ts: r.ts, iso: new Date(r.ts).toISOString() });

/** Construit l'app Express (API publique en lecture seule). */
export function createApp() {
  const app = express();

  // CORS ouvert (API publique en lecture).
  app.use((req, res, next) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  const wrap = (fn) => (req, res) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      logger.error(`[api] ${req.method} ${req.path} : ${err.message}`);
      res.status(500).json({ error: err.message });
    });
  };

  app.get("/api/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

  // --- Index : liste des endpoints ---
  app.get("/api", (req, res) =>
    res.json({
      endpoints: [
        "GET /api/health",
        "GET /api/snapshots?since=&limit=",
        "GET /api/snapshots/latest",
        "GET /api/snapshots/:ts",
        "GET /api/snapshots/:ts/verdict",
        "GET /api/verdicts?since=&limit=",
        "GET /api/verdicts/latest",
        "GET /api/verdicts/:ts",
        "GET /api/verdicts/:ts/snapshot",
        "GET /api/trends?lookbackDays=",
        "GET /api/metrics?since=",
      ],
    }),
  );

  // --- Snapshots ---
  app.get(
    "/api/snapshots",
    wrap(async (req, res) => {
      const since = parseSince(req.query.since);
      const limit = Number(req.query.limit) || 100;
      const list = await listSnapshots(since);
      res.json({ count: list.length, items: list.slice(-limit).map(withIso) });
    }),
  );

  app.get(
    "/api/snapshots/latest",
    wrap(async (req, res) => {
      const snap = await loadLatestSnapshot();
      if (!snap) return res.status(404).json({ error: "aucun snapshot" });
      res.json(snap);
    }),
  );

  app.get(
    "/api/snapshots/:ts/verdict",
    wrap(async (req, res) => {
      const ts = parseTs(req.params.ts);
      if (ts == null) return res.status(400).json({ error: "ts invalide" });
      const v = await getVerdictForSnapshot(ts);
      if (!v) return res.status(404).json({ error: "aucun verdict pour ce snapshot" });
      res.json(v);
    }),
  );

  app.get(
    "/api/snapshots/:ts",
    wrap(async (req, res) => {
      const ts = parseTs(req.params.ts);
      if (ts == null) return res.status(400).json({ error: "ts invalide" });
      const snap = await loadSnapshotByTs(ts);
      if (!snap) return res.status(404).json({ error: "snapshot introuvable" });
      res.json(snap);
    }),
  );

  // --- Verdicts ---
  app.get(
    "/api/verdicts",
    wrap(async (req, res) => {
      const since = parseSince(req.query.since, 30);
      const limit = Number(req.query.limit) || 100;
      const list = await listVerdicts(since);
      res.json({ count: list.length, items: list.slice(-limit).map(withIso) });
    }),
  );

  app.get(
    "/api/verdicts/latest",
    wrap(async (req, res) => {
      const v = await loadLatestVerdict();
      if (!v) return res.status(404).json({ error: "aucun verdict" });
      res.json(v);
    }),
  );

  app.get(
    "/api/verdicts/:ts/snapshot",
    wrap(async (req, res) => {
      const ts = parseTs(req.params.ts);
      if (ts == null) return res.status(400).json({ error: "ts invalide" });
      const snap = await getSnapshotForVerdict(ts);
      if (!snap) return res.status(404).json({ error: "aucun snapshot pour ce verdict" });
      res.json(snap);
    }),
  );

  app.get(
    "/api/verdicts/:ts",
    wrap(async (req, res) => {
      const ts = parseTs(req.params.ts);
      if (ts == null) return res.status(400).json({ error: "ts invalide" });
      const v = await loadVerdictByTs(ts);
      if (!v) return res.status(404).json({ error: "verdict introuvable" });
      res.json(v);
    }),
  );

  // --- Tendances & métriques ---
  app.get(
    "/api/trends",
    wrap(async (req, res) => {
      const lookbackDays = Number(req.query.lookbackDays) || 8;
      res.json(await getTrends(lookbackDays));
    }),
  );

  app.get(
    "/api/metrics",
    wrap(async (req, res) => {
      const since = parseSince(req.query.since);
      res.json(await loadMetricsSince(since));
    }),
  );

  return app;
}
