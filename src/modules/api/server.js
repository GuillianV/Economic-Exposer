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
  loadLatestCurve,
  listCurves,
  loadCurveByTs,
} from "../fundamental/persistence/store.js";
import { computeCurveOutcome } from "../fundamental/persistence/curve-outcome.js";
import { getTrends } from "../fundamental/persistence/scheduler.js";
import { freshnessPayload } from "../fundamental/freshness.js";
import { InvestingCalendarCollector } from "../fundamental/collectors/investing-calendar.js";
import { buildCalendar } from "../fundamental/calendar.js";
import { METRIC_DICTIONARY, GLOSSARY } from "../fundamental/dictionary.js";
import { computeOutcome } from "../fundamental/persistence/outcome.js";
import { SCHEMA_VERSION } from "../fundamental/persistence/store.js";

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

  // Auth OPTIONNELLE : si API_TOKEN est défini, exige un Bearer token (ou ?token=)
  // sur tout /api/* sauf /api/health. Sans la variable : ouvert (dev local).
  const TOKEN = process.env.API_TOKEN;
  if (TOKEN) {
    app.use((req, res, next) => {
      if (req.path === "/api/health") return next();
      const auth = req.get("authorization") || "";
      const provided = auth.startsWith("Bearer ") ? auth.slice(7) : req.query.token;
      if (provided !== TOKEN) return res.status(401).json({ error: "non autorisé (token requis)" });
      next();
    });
  }

  // Rate-limit OPTIONNEL (par IP, fenêtre glissante 1 min) si API_RATE_LIMIT > 0.
  const RL = Number(process.env.API_RATE_LIMIT) || 0;
  if (RL > 0) {
    const hits = new Map();
    app.use((req, res, next) => {
      const ip = req.ip || req.socket?.remoteAddress || "?";
      const now = Date.now();
      const w = hits.get(ip) || { count: 0, reset: now + 60000 };
      if (now > w.reset) { w.count = 0; w.reset = now + 60000; }
      w.count++;
      hits.set(ip, w);
      if (w.count > RL) return res.status(429).json({ error: "trop de requêtes (rate limit)" });
      next();
    });
  }

  const wrap = (fn) => (req, res) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      logger.error(`[api] ${req.method} ${req.path} : ${err.message}`);
      res.status(500).json({ error: err.message });
    });
  };

  app.get("/api/health", (req, res) => res.json({ ok: true, ts: Date.now(), schemaVersion: SCHEMA_VERSION }));

  // --- Index : liste des endpoints (servi sur / ET /api) ---
  const apiIndex = {
    service: "crypto-fundamental",
    schemaVersion: SCHEMA_VERSION,
    endpoints: [
      "GET /api/health",
      "GET /api/snapshots?since=&limit=",
      "GET /api/snapshots/latest",
      "GET /api/snapshots/:ts",
      "GET /api/snapshots/:ts/verdict",
      "GET /api/snapshots/:ts/freshness",
      "GET /api/freshness",
      "GET /api/verdicts?since=&limit=",
      "GET /api/verdicts/latest",
      "GET /api/verdicts/:ts",
      "GET /api/verdicts/:ts/snapshot",
      "GET /api/verdicts/:ts/outcome",
      "GET /api/forecast/curves?since=&limit=",
      "GET /api/forecast/curves/latest",
      "GET /api/forecast/curves/:ts",
      "GET /api/forecast/curves/:ts/outcome",
      "GET /api/trends?lookbackDays=",
      "GET /api/metrics?since=",
      "GET /api/dictionary",
      "GET /api/glossary",
      "GET /api/calendar",
    ],
  };
  const sendIndex = (req, res) => res.json(apiIndex);
  app.get("/", sendIndex);
  app.get("/api", sendIndex);

  // --- API auto-descriptive : dictionnaire des métriques + glossaire ---
  app.get("/api/dictionary", (req, res) =>
    res.json({ schemaVersion: SCHEMA_VERSION, count: Object.keys(METRIC_DICTIONARY).length, metrics: METRIC_DICTIONARY }),
  );
  app.get("/api/glossary", (req, res) => res.json({ count: GLOSSARY.length, terms: GLOSSARY }));

  // --- Calendrier économique unifié (format type investing.com) ---
  // Source riche : investing.com (scrapé) en primaire, FairEconomy en repli. Lit
  // le dernier snapshot ; collecte en direct si rien (ou snapshot de plus d'1 h).
  app.get(
    "/api/calendar",
    wrap(async (req, res) => {
      const snap = await loadLatestSnapshot();
      const fresh = snap && Date.now() - snap.ts < 3600000;
      let rich = fresh ? snap.axes?.macro?.["investing-calendar"] : null;
      let source = fresh ? "snapshot" : "live";
      let ts = snap?.ts;

      if (!rich?.events?.length) {
        // Le collecteur gère lui-même le repli investing.com → FairEconomy.
        const r = await new InvestingCalendarCollector().collect();
        if (!r.stale && r.data?.events?.length) {
          rich = r.data;
          source = fresh ? "snapshot+live" : "live";
          ts = Math.max(ts || 0, r.ts);
        }
      }

      const cal = buildCalendar(rich);
      if (!cal.events.length) return res.status(503).json({ error: "calendrier indisponible (investing.com + FairEconomy en échec)" });

      res.json({
        source,
        ts,
        iso: ts ? new Date(ts).toISOString() : null,
        ...cal,
        count: cal.events.length,
      });
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

  // Fraîcheur des données d'un snapshot : date réelle + âge de chaque source,
  // pour que le consommateur sache de QUAND datent les données du verdict.
  app.get(
    "/api/snapshots/:ts/freshness",
    wrap(async (req, res) => {
      const ts = parseTs(req.params.ts);
      if (ts == null) return res.status(400).json({ error: "ts invalide" });
      const snap = await loadSnapshotByTs(ts);
      if (!snap) return res.status(404).json({ error: "snapshot introuvable" });
      res.json(freshnessPayload(snap));
    }),
  );

  // Fraîcheur du DERNIER snapshot (raccourci pratique).
  app.get(
    "/api/freshness",
    wrap(async (req, res) => {
      const snap = await loadLatestSnapshot();
      if (!snap) return res.status(404).json({ error: "aucun snapshot" });
      res.json(freshnessPayload(snap));
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

  // Courbes projetées : générées par le SERVICE (1/jour), l'API ne fait que
  // LIRE — exactement comme snapshots/verdicts (aucun appel LLM ici).

  // HISTORIQUE (liste).
  app.get(
    "/api/forecast/curves",
    wrap(async (req, res) => {
      const since = parseSince(req.query.since, 30);
      const limit = Number(req.query.limit) || 100;
      const list = await listCurves(since);
      res.json({ count: list.length, items: list.slice(-limit).map(withIso) });
    }),
  );

  // Dernière courbe (comme /verdicts/latest). AVANT la route générique `/:ts`.
  app.get(
    "/api/forecast/curves/latest",
    wrap(async (req, res) => {
      const c = await loadLatestCurve();
      if (!c) return res.status(404).json({ error: "aucune courbe" });
      res.json(c);
    }),
  );

  // Suivi A POSTERIORI d'une courbe : projeté vs réalisé + justesse directionnelle
  // (100 % déterministe, sans IA). AVANT la route générique `/:ts`.
  app.get(
    "/api/forecast/curves/:ts/outcome",
    wrap(async (req, res) => {
      const ts = parseTs(req.params.ts);
      if (ts == null) return res.status(400).json({ error: "ts invalide" });
      const out = await computeCurveOutcome(ts);
      if (!out) return res.status(404).json({ error: "courbe introuvable" });
      res.json(out);
    }),
  );

  // Une courbe passée par son ts (= baseTs).
  app.get(
    "/api/forecast/curves/:ts",
    wrap(async (req, res) => {
      const ts = parseTs(req.params.ts);
      if (ts == null) return res.status(400).json({ error: "ts invalide" });
      const c = await loadCurveByTs(ts);
      if (!c) return res.status(404).json({ error: "courbe introuvable" });
      res.json(c);
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

  // Suivi A POSTERIORI : ce qui s'est passé depuis le verdict (deltas factuels
  // des métriques-clés à +24h/+7j). Pas de note "juste/faux" — le consommateur juge.
  app.get(
    "/api/verdicts/:ts/outcome",
    wrap(async (req, res) => {
      const ts = parseTs(req.params.ts);
      if (ts == null) return res.status(400).json({ error: "ts invalide" });
      const out = await computeOutcome(ts);
      if (!out) return res.status(404).json({ error: "verdict introuvable" });
      res.json(out);
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
