import express from "express";
import { createSignatureAuthMiddleware } from "./auth.js";
import { statsOf } from "../fundamental/ai/prevision.js";
import * as groq from "../fundamental/ai/providers/groq.js";
import { computeRegime } from "../fundamental/ai/regime.js";
import { evaluateDuePrevisions } from "../fundamental/ai/runner.js";
import { buildCalendar } from "../fundamental/calendar.js";
import { BmproCollector } from "../fundamental/collectors/bmpro.js";
import { CoinglassDerivativesCollector } from "../fundamental/collectors/coinglass-derivatives.js";
import { CoinglassLiquidationsCollector } from "../fundamental/collectors/coinglass-liquidations.js";
import { CoinglassWhalesCollector } from "../fundamental/collectors/coinglass-whales.js";
import { CycleCollector } from "../fundamental/collectors/cycle.js";
import { FedWatchCollector, computeFedProbabilities, fedStartRate, impliedRateFor, nextFomcMeeting } from "../fundamental/collectors/fedwatch.js";
import { fetchMacroMomentum } from "../fundamental/collectors/macro-momentum.js";
import { NasdaqCalendarCollector } from "../fundamental/collectors/nasdaq-calendar.js";
import { OnChainValuationCollector } from "../fundamental/collectors/onchain-valuation.js";
import { TreasuriesCollector } from "../fundamental/collectors/treasuries.js";
import { GLOSSARY, METRIC_DICTIONARY } from "../fundamental/dictionary.js";
import { freshnessPayload } from "../fundamental/freshness.js";
import { extractMetrics } from "../fundamental/persistence/metrics.js";
import { computeOutcome } from "../fundamental/persistence/outcome.js";
import { getTrends } from "../fundamental/persistence/scheduler.js";
import {
  DATA_PARAMS_VERSION,
  SCHEMA_VERSION,
  getSnapshotForVerdict,
  getVerdictForSnapshot,
  listPrevisions,
  listSnapshots,
  listVerdicts,
  loadLatestPrevision,
  loadLatestSnapshot,
  loadLatestVerdict,
  loadMetricsSince,
  loadPrevisionByTs,
  loadPrevisionsSince,
  loadSnapshotByTs,
  loadVerdictByTs,
} from "../fundamental/persistence/store.js";
import { logger } from "../logs/index.js";

/**
 * API publique en lecture seule : snapshots, verdicts, prévisions, tendances,
 * calendrier, vulgarisation. Auth par signature HMAC (voir auth.js), Bearer
 * legacy tant qu'API_TOKEN est défini, rate-limit optionnel (API_RATE_LIMIT),
 * CORS ouvert.
 */
const MINUTE_MS = 60000;
const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const DEFAULT_LIMIT = 100;
const SNAPSHOTS_SINCE_DAYS = 7;
const HISTORY_SINCE_DAYS = 30;
const STATS_SINCE_DAYS = 90;
const TRENDS_LOOKBACK_DAYS = 8;
const RATE_WINDOW_MS = MINUTE_MS;
const CALENDAR_FRESH_MS = HOUR_MS;
const CYCLE_FRESH_MS = 12 * HOUR_MS;
const VALUATION_FRESH_MS = 12 * HOUR_MS;
const TREASURIES_FRESH_MS = 12 * HOUR_MS; // trésoreries : donnée lente (reporting par à-coups)
const SCRAPE_FRESH_MS = 2 * HOUR_MS;
const FEDWATCH_FRESH_MS = 6 * HOUR_MS;
const FED_SPREAD_DOVISH = -0.25; // pt : 2Y nettement sous le taux directeur = baisses pricées
const FED_SPREAD_HAWKISH = 0.35; // pt : 2Y nettement au-dessus = pas de baisse, biais restrictif
const PREVISION_PREVIOUS_WINDOW_MS = 7 * DAY_MS;
const EXPLAIN_MIN_CHARS = 8;
const EXPLAIN_MAX_CHARS = 600;
const EXPLAIN_TIMEOUT_MS = 20000;
const EXPLAIN_CACHE_MAX = 300;
const EXPLAIN_BODY_LIMIT = "4kb";

/**
 * Parse un timestamp de requête : epoch ms numérique ou date ISO.
 * @param {string|undefined} raw Valeur brute (query ou param).
 * @returns {number|null} Epoch ms, ou null si absent/invalide.
 */
function parseTs(raw) {
  if (raw == null) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parse un `?since=` avec repli sur une fenêtre par défaut.
 * @param {string|undefined} raw Valeur brute de la query.
 * @param {number} [defaultDays] Fenêtre par défaut (jours) si absent/invalide.
 * @returns {number} Epoch ms.
 */
function parseSince(raw, defaultDays = SNAPSHOTS_SINCE_DAYS) {
  const ts = parseTs(raw);
  return ts != null ? ts : Date.now() - defaultDays * DAY_MS;
}

/**
 * Référence de record réduite à { ts, iso } pour les listes.
 * @param {{ts: number}} record Référence avec timestamp.
 * @returns {{ts: number, iso: string}} Référence sérialisable.
 */
function withIso(record) {
  return { ts: record.ts, iso: new Date(record.ts).toISOString() };
}

/**
 * Enveloppe un handler async : toute erreur est loguée avec la route et
 * renvoyée en 500 JSON (jamais de requête pendante).
 * @param {Function} handler Handler async (req, res).
 * @returns {Function} Handler Express sûr.
 */
function wrapAsync(handler) {
  return (req, res) => {
    Promise.resolve(handler(req, res)).catch((err) => {
      logger.error(`[api] ${req.method} ${req.path} : ${err.message}`);
      res.status(500).json({ error: err.message });
    });
  };
}

/**
 * Middleware CORS ouvert (API publique en lecture), en-têtes de signature
 * autorisés pour les clients navigateur éventuels.
 * @returns {Function} Middleware Express.
 */
function createCorsMiddleware() {
  return (req, res, next) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Auth-Ts, X-Auth-Nonce, X-Auth-Sig");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  };
}

/**
 * Middleware de rate-limit par IP, fenêtre glissante de RATE_WINDOW_MS.
 * @param {number} maxPerWindow Nombre maximal de requêtes par fenêtre.
 * @returns {Function} Middleware Express.
 */
function createRateLimitMiddleware(maxPerWindow) {
  const hits = new Map(); // ip -> { count, reset } : compteur de la fenêtre courante

  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || "?";
    const now = Date.now();

    const window = hits.get(ip) || { count: 0, reset: now + RATE_WINDOW_MS };
    if (now > window.reset) {
      window.count = 0;
      window.reset = now + RATE_WINDOW_MS;
    }
    window.count++;
    hits.set(ip, window);

    if (window.count > maxPerWindow) return res.status(429).json({ error: "trop de requêtes (rate limit)" });
    next();
  };
}

// Index auto-descriptif servi sur / et /api.
const API_INDEX = {
  service: "crypto-fundamental",
  schemaVersion: SCHEMA_VERSION,
  paramsVersion: DATA_PARAMS_VERSION,
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
    "GET /api/forecast/previsions?since=&limit=",
    "GET /api/forecast/previsions/latest",
    "GET /api/forecast/previsions/stats?since=",
    "GET /api/forecast/previsions/:ts",
    "GET /api/trends?lookbackDays=",
    "GET /api/metrics?since=",
    "GET /api/dictionary",
    "GET /api/glossary",
    "POST /api/explain",
    "GET /api/calendar",
  ],
};

/**
 * Sert l'index des endpoints.
 * @param {object} req Requête Express.
 * @param {object} res Réponse Express.
 */
function sendIndex(req, res) {
  res.json(API_INDEX);
}

const EXPLAIN_SYSTEM =
  "Tu es un vulgarisateur financier. On te donne une phrase issue d'une analyse " +
  "de marché. Explique-la en français TRÈS simple (comme à un proche non-initié), " +
  "en 2-3 phrases maximum, sans jargon, sans chiffre inutile, sans conseil " +
  "d'investissement, sans prédiction de prix. Si la phrase contient un terme " +
  "technique, explique-le en une proposition. Réponds UNIQUEMENT par un objet " +
  'JSON : {"explication": "..."}';

const explainCache = new Map(); // texte normalisé -> explication (FIFO borné à EXPLAIN_CACHE_MAX)

/**
 * Extrait le champ `explication` d'une réponse Groq : JSON direct, sinon
 * premier bloc {...} trouvé dans le texte.
 * @param {string|null} raw Réponse brute du LLM.
 * @returns {string|null} Explication, ou null si non exploitable.
 */
function parseExplication(raw) {
  try {
    const direct = JSON.parse(raw)?.explication;
    if (direct) return direct;
  } catch {
    const match = raw?.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0])?.explication ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * POST /api/explain — vulgarisation à la demande, UNIQUEMENT via Groq (palier
 * gratuit, rapide). Pas de fallback DeepSeek : feature de confort, si Groq est
 * down on renvoie 503 (le contenu de base reste lisible). Cache borné (mêmes
 * phrases re-demandées par les visiteurs).
 * @param {object} req Requête Express ({ body.texte }).
 * @param {object} res Réponse Express.
 * @returns {Promise<void>} Rien — la réponse est envoyée via res.
 */
async function postExplain(req, res) {
  const texte = typeof req.body?.texte === "string" ? req.body.texte.trim() : "";
  if (texte.length < EXPLAIN_MIN_CHARS) {
    return res.status(400).json({ error: `texte manquant ou trop court (min ${EXPLAIN_MIN_CHARS} caractères)` });
  }
  if (texte.length > EXPLAIN_MAX_CHARS) {
    return res.status(400).json({ error: `texte trop long (max ${EXPLAIN_MAX_CHARS} caractères)` });
  }

  const key = texte.toLowerCase().replace(/\s+/g, " ");
  if (explainCache.has(key)) {
    return res.json({ provider: "groq", cached: true, explication: explainCache.get(key) });
  }

  let raw;
  try {
    raw = await groq.complete({ system: EXPLAIN_SYSTEM, user: texte, timeout: EXPLAIN_TIMEOUT_MS });
  } catch (err) {
    return res.status(503).json({ error: `vulgarisation indisponible (Groq) : ${err.message}` });
  }

  const explication = parseExplication(raw);
  if (!explication) return res.status(502).json({ error: "réponse Groq non exploitable" });

  if (explainCache.size >= EXPLAIN_CACHE_MAX) explainCache.delete(explainCache.keys().next().value);
  explainCache.set(key, explication);
  res.json({ provider: "groq", cached: false, explication });
}

/**
 * GET /api/calendar — calendrier économique unifié (format type investing.com).
 * Source riche : investing.com (scrapé) en primaire, FairEconomy en repli. Lit
 * le dernier snapshot ; collecte en direct si rien (ou snapshot de plus d'1 h).
 * @param {object} req Requête Express.
 * @param {object} res Réponse Express.
 * @returns {Promise<void>} Rien — la réponse est envoyée via res.
 */
async function getCalendar(req, res) {
  const snap = await loadLatestSnapshot();
  const fresh = snap && Date.now() - snap.ts < CALENDAR_FRESH_MS;
  let rich = fresh ? snap.axes?.macro?.["nasdaq-calendar"] : null;
  let source = fresh ? "snapshot" : "live";
  let ts = snap?.ts;

  if (!rich?.events?.length) {
    const result = await new NasdaqCalendarCollector().collect();
    if (!result.stale && result.data?.events?.length) {
      rich = result.data;
      source = fresh ? "snapshot+live" : "live";
      ts = Math.max(ts || 0, result.ts);
    }
  }

  const calendar = buildCalendar(rich);
  if (!calendar.events.length) {
    return res.status(503).json({ error: "calendrier indisponible (investing.com + FairEconomy en échec)" });
  }

  res.json({
    source,
    ts,
    iso: ts ? new Date(ts).toISOString() : null,
    ...calendar,
    count: calendar.events.length,
  });
}

/**
 * GET /api/cycle — position de cycle du BTC (Mayer / Pi Cycle / 200 semaines).
 * Sert la valeur du dernier snapshot si fraîche, sinon recalcule en direct.
 * @param {object} req Requête Express.
 * @param {object} res Réponse Express.
 * @returns {Promise<void>} Rien — la réponse est envoyée via res.
 */
async function getCycle(req, res) {
  const snap = await loadLatestSnapshot();
  const fresh = snap && Date.now() - snap.ts < CYCLE_FRESH_MS;
  let cycle = fresh ? snap.axes?.onchain?.cycle : null;
  let source = fresh ? "snapshot" : "live";
  let ts = snap?.ts;

  if (cycle?.position == null) {
    const result = await new CycleCollector().collect();
    if (!result.stale && result.data?.position != null) {
      cycle = result.data;
      source = "live";
      ts = result.ts;
    }
  }

  if (cycle?.position == null) {
    return res.status(503).json({ error: "indicateurs de cycle indisponibles (klines Binance en échec)" });
  }

  res.json({ source, ts, iso: ts ? new Date(ts).toISOString() : null, ...cycle });
}

/**
 * GET /api/valuation — valorisation on-chain du BTC (MVRV / NUPL / prix réalisé
 * / Puell), basée sur la realized cap. Sert la valeur du dernier snapshot si
 * fraîche, sinon recalcule en direct depuis CoinMetrics.
 * @param {object} req Requête Express.
 * @param {object} res Réponse Express.
 * @returns {Promise<void>} Rien — la réponse est envoyée via res.
 */
async function getValuation(req, res) {
  const snap = await loadLatestSnapshot();
  const fresh = snap && Date.now() - snap.ts < VALUATION_FRESH_MS;
  let valuation = fresh ? snap.axes?.onchain?.valuation : null;
  let source = fresh ? "snapshot" : "live";
  let ts = snap?.ts;

  if (valuation?.position == null) {
    const result = await new OnChainValuationCollector().collect();
    if (!result.stale && result.data?.position != null) {
      valuation = result.data;
      source = "live";
      ts = result.ts;
    }
  }

  if (valuation?.position == null) {
    return res.status(503).json({ error: "valorisation on-chain indisponible (CoinMetrics en échec)" });
  }

  res.json({ source, ts, iso: ts ? new Date(ts).toISOString() : null, ...valuation });
}

/**
 * GET /api/liquidations — niveaux/aimants de liquidation Coinglass (scrape
 * navigateur découplé). Sert la valeur du dernier snapshot si fraîche, sinon lit
 * le cache disque via le collecteur (jamais le navigateur dans le chemin route).
 * @param {object} req Requête Express.
 * @param {object} res Réponse Express.
 * @returns {Promise<void>} Rien — la réponse est envoyée via res.
 */
async function getLiquidations(req, res) {
  const snap = await loadLatestSnapshot();
  const fresh = snap && Date.now() - snap.ts < SCRAPE_FRESH_MS;
  let liquidations = fresh ? snap.axes?.structure?.liquidations : null;
  let source = fresh ? "snapshot" : "cache";
  let ts = snap?.ts;

  if (liquidations?.levels == null) {
    const result = await new CoinglassLiquidationsCollector().collect();
    if (!result.stale && result.data?.levels) {
      liquidations = result.data;
      source = "cache";
      ts = result.data.scrapedTs ?? result.ts;
    }
  }

  if (liquidations?.levels == null) {
    return res.status(503).json({ error: "liquidations indisponibles (scrape Coinglass pas encore passé)" });
  }

  res.json({ source, ts, iso: ts ? new Date(ts).toISOString() : null, ...liquidations });
}

/**
 * GET /api/derivatives — dérivés BTC agrégés Coinglass (funding, open interest,
 * long/short retail et top-traders, liquidations 24h, volume, leverage). Sert la
 * valeur du snapshot si fraîche, sinon lit le cache via le collecteur (jamais le
 * navigateur dans le chemin route).
 * @param {object} req Requête Express.
 * @param {object} res Réponse Express.
 * @returns {Promise<void>} Rien — la réponse est envoyée via res.
 */
async function getDerivatives(req, res) {
  const snap = await loadLatestSnapshot();
  const fresh = snap && Date.now() - snap.ts < SCRAPE_FRESH_MS;
  let derivatives = fresh ? snap.axes?.structure?.derivatives : null;
  let source = fresh ? "snapshot" : "cache";
  let ts = snap?.ts;

  if (derivatives?.openInterestUsd == null) {
    const result = await new CoinglassDerivativesCollector().collect();
    if (!result.stale && result.data?.openInterestUsd != null) {
      derivatives = result.data;
      source = "cache";
      ts = result.data.scrapedTs ?? result.ts;
    }
  }

  if (derivatives?.openInterestUsd == null) {
    return res.status(503).json({ error: "dérivés indisponibles (scrape Coinglass pas encore passé)" });
  }

  res.json({ source, ts, iso: ts ? new Date(ts).toISOString() : null, ...derivatives });
}

/**
 * GET /api/whales — positionnement des gros comptes Hyperliquid sur BTC (part
 * long/short, taille totale). Sert la valeur du snapshot si fraîche, sinon lit le
 * cache via le collecteur (jamais le navigateur dans le chemin route).
 * @param {object} req Requête Express.
 * @param {object} res Réponse Express.
 * @returns {Promise<void>} Rien — la réponse est envoyée via res.
 */
async function getWhales(req, res) {
  const snap = await loadLatestSnapshot();
  const fresh = snap && Date.now() - snap.ts < SCRAPE_FRESH_MS;
  let whales = fresh ? snap.axes?.structure?.whales : null;
  let source = fresh ? "snapshot" : "cache";
  let ts = snap?.ts;

  if (whales?.longPct == null) {
    const result = await new CoinglassWhalesCollector().collect();
    if (!result.stale && result.data?.longPct != null) {
      whales = result.data;
      source = "cache";
      ts = result.data.scrapedTs ?? result.ts;
    }
  }

  if (whales?.longPct == null) {
    return res.status(503).json({ error: "whales indisponibles (scrape Coinglass pas encore passé)" });
  }

  res.json({ source, ts, iso: ts ? new Date(ts).toISOString() : null, ...whales });
}

/**
 * GET /api/treasuries — trésoreries BTC d'entités (total, top détenteurs,
 * Strategy). Sert la valeur du snapshot si fraîche, sinon lit le collecteur
 * (scrape bitcointreasuries, backup CoinGecko).
 * @param {object} req Requête Express.
 * @param {object} res Réponse Express.
 * @returns {Promise<void>} Rien — la réponse est envoyée via res.
 */
async function getTreasuries(req, res) {
  const snap = await loadLatestSnapshot();
  const fresh = snap && Date.now() - snap.ts < TREASURIES_FRESH_MS;
  let treasuries = fresh ? snap.axes?.structure?.treasuries : null;
  let source = fresh ? "snapshot" : "cache";
  let ts = snap?.ts;

  if (treasuries?.totalBtc == null) {
    const result = await new TreasuriesCollector().collect();
    if (!result.stale && result.data?.totalBtc != null) {
      treasuries = result.data;
      source = "cache";
      ts = result.ts;
    }
  }

  if (treasuries?.totalBtc == null) {
    return res.status(503).json({ error: "trésoreries indisponibles (scrape et backup CoinGecko en échec)" });
  }

  res.json({ source, ts, iso: ts ? new Date(ts).toISOString() : null, ...treasuries });
}

/**
 * GET /api/regime — boussole de régime swing/cycle (90-180 j) : zone, biais,
 * blocs, triggers et niveaux. Assemble les facteurs on-chain du dernier
 * snapshot (trend/valo via cycle + valuation) et le momentum macro (fetch FRED),
 * puis applique le moteur pur computeRegime.
 * @param {object} req Requête Express.
 * @param {object} res Réponse Express.
 * @returns {Promise<void>} Rien — la réponse est envoyée via res.
 */
async function getRegime(req, res) {
  const snap = await loadLatestSnapshot();
  const cycle = snap?.axes?.onchain?.cycle ?? {};
  const valuation = snap?.axes?.onchain?.valuation ?? {};
  const fred = snap?.axes?.macro?.fred ?? {};

  const macro = await fetchMacroMomentum();
  const regime = computeRegime({
    btcPrice: valuation.btcPrice ?? cycle.btcPrice ?? null,
    mayer: cycle.mayer?.valeur ?? null,
    mvrv: valuation.mvrv?.valeur ?? null,
    puell: valuation.puell?.valeur ?? null,
    realizedPrice: valuation.realizedPrice ?? null,
    cyclePosition: cycle.position ?? null,
    hySpread: fred.highYieldSpread?.value ?? null,
    ...macro,
  });

  res.json({ ts: snap?.ts ?? Date.now(), iso: snap?.ts ? new Date(snap.ts).toISOString() : null, ...regime });
}

/**
 * GET /api/onchain-extras — indicateurs de cycle BitcoinMagazinePro (RHODL Ratio,
 * Reserve Risk) via scrape. Sert la valeur du snapshot si fraîche, sinon lit le
 * cache via le collecteur (jamais le navigateur dans le chemin route).
 * @param {object} req Requête Express.
 * @param {object} res Réponse Express.
 * @returns {Promise<void>} Rien — la réponse est envoyée via res.
 */
async function getOnchainExtras(req, res) {
  const snap = await loadLatestSnapshot();
  const fresh = snap && Date.now() - snap.ts < SCRAPE_FRESH_MS;
  let bmpro = fresh ? snap.axes?.onchain?.bmpro : null;
  let source = fresh ? "snapshot" : "cache";
  let ts = snap?.ts;

  if (bmpro?.rhodl?.valeur == null && bmpro?.reserveRisk?.valeur == null) {
    const result = await new BmproCollector().collect();
    if (!result.stale && (result.data?.rhodl?.valeur != null || result.data?.reserveRisk?.valeur != null)) {
      bmpro = result.data;
      source = "cache";
      ts = result.data.scrapedTs ?? result.ts;
    }
  }

  if (bmpro?.rhodl?.valeur == null && bmpro?.reserveRisk?.valeur == null) {
    return res.status(503).json({ error: "indicateurs BMPro indisponibles (scrape pas encore passé)" });
  }

  res.json({ source, ts, iso: ts ? new Date(ts).toISOString() : null, ...bmpro });
}

/**
 * Date ISO (minuit UTC) de la décision d'une réunion FOMC.
 * @param {{year: number, month: number, day: number}} meeting Réunion.
 * @returns {string} Date ISO du jour de décision.
 */
function reunionIso(meeting) {
  return new Date(Date.UTC(meeting.year, meeting.month - 1, meeting.day)).toISOString();
}

/**
 * Taux implicite du contrat du mois SUIVANT une réunion (gère décembre → janvier).
 * @param {{year: number, month: number}} meeting Réunion.
 * @param {Array<object>} contracts Contrats ZQ collectés.
 * @returns {number|null} Taux implicite du mois suivant, ou null si absent.
 */
function nextMonthImplied(meeting, contracts) {
  const isDecember = meeting.month === 12;
  const year = isDecember ? meeting.year + 1 : meeting.year;
  const month = isDecember ? 1 : meeting.month + 1;
  return impliedRateFor(contracts, year, month);
}

/**
 * Charge les futures Fed Funds : valeur du snapshot si fraîche, sinon collecte
 * en direct. Une panne renvoie null (le handler bascule alors sur le proxy FRED).
 * @param {object|null} snap Dernier snapshot.
 * @returns {Promise<{contracts: Array<object>, source: string,
 *   ts: number|null}|null>} Contrats ZQ, ou null si indisponibles.
 */
async function loadFedWatch(snap) {
  const fresh = snap && Date.now() - snap.ts < FEDWATCH_FRESH_MS;
  const snapData = fresh ? snap.axes?.macro?.fedwatch : null;
  if (snapData?.contracts?.length) return { contracts: snapData.contracts, source: "snapshot", ts: snap.ts };

  const result = await new FedWatchCollector().collect();
  if (!result.stale && result.data?.contracts?.length) {
    return { contracts: result.data.contracts, source: "live", ts: result.ts };
  }
  return null;
}

/**
 * GET /api/fed — attentes de décision de la Fed pour la prochaine réunion.
 * Voie PRIMAIRE : probabilités réelles implicites dans les futures Fed Funds
 * (ZQ, méthode CME FedWatch). REPLI si les futures manquent : proxy directionnel
 * 2Y - taux directeur (FRED) — spread négatif = baisses pricées, positif franc =
 * biais restrictif. Une panne d'une voie ne casse jamais la route.
 * @param {object} req Requête Express.
 * @param {object} res Réponse Express.
 * @returns {Promise<void>} Rien — la réponse est envoyée via res.
 */
async function getFedExpectation(req, res) {
  const snap = await loadLatestSnapshot();
  if (!snap) return res.status(404).json({ error: "aucun snapshot" });

  const metrics = extractMetrics(snap);
  const fedFunds = metrics?.fedFunds;
  const yield2y = metrics?.yield2y;

  const calendarEvents = snap.axes?.macro?.["nasdaq-calendar"]?.events ?? null;
  const meeting = nextFomcMeeting(new Date(), calendarEvents);
  const fedwatch = fedFunds != null && meeting ? await loadFedWatch(snap) : null;
  if (fedwatch) {
    const meetingImplied = impliedRateFor(fedwatch.contracts, meeting.year, meeting.month);
    const nextImplied = nextMonthImplied(meeting, fedwatch.contracts);
    const startRate = fedStartRate({ meeting, contracts: fedwatch.contracts, fallbackRate: fedFunds });
    const probas = computeFedProbabilities({ meeting, startRate, meetingImplied, nextImplied });
    if (probas) {
      return res.json({
        source: "fedwatch",
        methode: "futures Fed Funds (ZQ)",
        ts: fedwatch.ts,
        iso: fedwatch.ts ? new Date(fedwatch.ts).toISOString() : null,
        reunion: { annee: meeting.year, mois: meeting.month, jour: meeting.day, iso: reunionIso(meeting) },
        ...probas,
      });
    }
  }

  if (fedFunds == null || yield2y == null) {
    return res.status(503).json({ error: "attentes de taux indisponibles (futures ZQ + FRED en échec)" });
  }

  const spread = yield2y - fedFunds;
  let biais = "statu quo attendu";
  if (spread <= FED_SPREAD_DOVISH) biais = "baisses attendues";
  else if (spread >= FED_SPREAD_HAWKISH) biais = "pas de baisse pricée";

  res.json({
    source: "fred-proxy",
    ts: snap.ts,
    iso: new Date(snap.ts).toISOString(),
    fedFunds,
    yield2y,
    spread,
    biais,
  });
}

/**
 * GET /api/snapshots — références des snapshots d'une fenêtre.
 * @param {object} req Requête Express (?since=&limit=).
 * @param {object} res Réponse Express.
 * @returns {Promise<void>} Rien — la réponse est envoyée via res.
 */
async function getSnapshots(req, res) {
  const since = parseSince(req.query.since);
  const limit = Number(req.query.limit) || DEFAULT_LIMIT;
  const list = await listSnapshots(since);
  res.json({ count: list.length, items: list.slice(-limit).map(withIso) });
}

/**
 * GET /api/snapshots/latest — dernier snapshot complet.
 * @param {object} req Requête Express.
 * @param {object} res Réponse Express.
 * @returns {Promise<void>} Rien — la réponse est envoyée via res.
 */
async function getLatestSnapshot(req, res) {
  const snap = await loadLatestSnapshot();
  if (!snap) return res.status(404).json({ error: "aucun snapshot" });
  res.json(snap);
}

/**
 * GET /api/snapshots/:ts/verdict — verdict produit depuis ce snapshot.
 * @param {object} req Requête Express.
 * @param {object} res Réponse Express.
 * @returns {Promise<void>} Rien — la réponse est envoyée via res.
 */
async function getSnapshotVerdict(req, res) {
  const ts = parseTs(req.params.ts);
  if (ts == null) return res.status(400).json({ error: "ts invalide" });
  const verdict = await getVerdictForSnapshot(ts);
  if (!verdict) return res.status(404).json({ error: "aucun verdict pour ce snapshot" });
  res.json(verdict);
}

/**
 * GET /api/snapshots/:ts/freshness — date réelle + âge de chaque source, pour
 * que le consommateur sache de QUAND datent les données du verdict.
 * @param {object} req Requête Express.
 * @param {object} res Réponse Express.
 * @returns {Promise<void>} Rien — la réponse est envoyée via res.
 */
async function getSnapshotFreshness(req, res) {
  const ts = parseTs(req.params.ts);
  if (ts == null) return res.status(400).json({ error: "ts invalide" });
  const snap = await loadSnapshotByTs(ts);
  if (!snap) return res.status(404).json({ error: "snapshot introuvable" });
  res.json(freshnessPayload(snap));
}

/**
 * GET /api/freshness — fraîcheur du DERNIER snapshot (raccourci).
 * @param {object} req Requête Express.
 * @param {object} res Réponse Express.
 * @returns {Promise<void>} Rien — la réponse est envoyée via res.
 */
async function getLatestFreshness(req, res) {
  const snap = await loadLatestSnapshot();
  if (!snap) return res.status(404).json({ error: "aucun snapshot" });
  res.json(freshnessPayload(snap));
}

/**
 * GET /api/snapshots/:ts — un snapshot complet par timestamp.
 * @param {object} req Requête Express.
 * @param {object} res Réponse Express.
 * @returns {Promise<void>} Rien — la réponse est envoyée via res.
 */
async function getSnapshotByTs(req, res) {
  const ts = parseTs(req.params.ts);
  if (ts == null) return res.status(400).json({ error: "ts invalide" });
  const snap = await loadSnapshotByTs(ts);
  if (!snap) return res.status(404).json({ error: "snapshot introuvable" });
  res.json(snap);
}

/**
 * GET /api/verdicts — références des verdicts d'une fenêtre. `?summary=1`
 * renvoie régime/confiance/contradictions de CHAQUE verdict en UNE requête
 * (sinon un client doit faire N appels /:ts et tape le rate-limit).
 * @param {object} req Requête Express (?since=&limit=&summary=).
 * @param {object} res Réponse Express.
 * @returns {Promise<void>} Rien — la réponse est envoyée via res.
 */
async function getVerdicts(req, res) {
  const since = parseSince(req.query.since, HISTORY_SINCE_DAYS);
  const limit = Number(req.query.limit) || DEFAULT_LIMIT;
  const list = await listVerdicts(since);
  const items = list.slice(-limit);

  if (req.query.summary === "1") {
    const summaries = [];
    for (const item of items) {
      const record = await loadVerdictByTs(item.ts).catch(() => null);
      const verdict = record?.verdict ?? {};
      summaries.push({
        ts: item.ts,
        iso: new Date(item.ts).toISOString(),
        regime: verdict.regime ?? null,
        confiance: verdict.confiance ?? null,
        contradictions: Array.isArray(verdict.signaux_contradictoires) ? verdict.signaux_contradictoires.length : 0,
      });
    }
    return res.json({ count: list.length, items: summaries });
  }

  res.json({ count: list.length, items: items.map(withIso) });
}

/**
 * GET /api/verdicts/latest — dernier verdict complet.
 * @param {object} req Requête Express.
 * @param {object} res Réponse Express.
 * @returns {Promise<void>} Rien — la réponse est envoyée via res.
 */
async function getLatestVerdict(req, res) {
  const verdict = await loadLatestVerdict();
  if (!verdict) return res.status(404).json({ error: "aucun verdict" });
  res.json(verdict);
}

/**
 * Middleware lazy-eval commun à TOUTES les lectures previsions (y compris
 * /:ts) : les prévisions échues sont évaluées avant de servir — throttlé côté
 * runner (10 min).
 * @param {object} req Requête Express.
 * @param {object} res Réponse Express.
 * @param {Function} next Chaîne Express.
 */
function evaluatePrevisionsBeforeServing(req, res, next) {
  evaluateDuePrevisions().then(() => next(), next);
}

/**
 * GET /api/forecast/previsions — références des prévisions d'une fenêtre.
 * `?full=1` : records complets (le tableau "prédit vs obtenu" du Reader en a
 * besoin — un aller-retour par ts serait un N+1 côté client).
 * @param {object} req Requête Express (?since=&limit=&full=).
 * @param {object} res Réponse Express.
 * @returns {Promise<void>} Rien — la réponse est envoyée via res.
 */
async function getPrevisions(req, res) {
  const since = parseSince(req.query.since, HISTORY_SINCE_DAYS);
  const limit = Number(req.query.limit) || DEFAULT_LIMIT;

  if (req.query.full === "1") {
    const records = await loadPrevisionsSince(since);
    return res.json({ count: records.length, items: records.slice(-limit) });
  }

  const list = await listPrevisions(since);
  res.json({ count: list.length, items: list.slice(-limit).map(withIso) });
}

/**
 * Prévision évaluée la plus récente ANTÉRIEURE à un baseTs (pour l'affichage
 * "hier : prédit vs réalisé" du Reader).
 * @param {Array<object>} records Prévisions triées croissant.
 * @param {number} baseTs baseTs de la prévision courante (epoch ms).
 * @returns {object|null} Record évalué le plus récent avant baseTs, ou null.
 */
function findPreviousEvaluated(records, baseTs) {
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].baseTs >= baseTs) continue;
    if (records[i].actifs?.some((asset) => asset.realise)) return records[i];
  }
  return null;
}

/**
 * GET /api/forecast/previsions/latest — dernière prévision, jointe à la
 * précédente ÉVALUÉE (`precedente`).
 * @param {object} req Requête Express.
 * @param {object} res Réponse Express.
 * @returns {Promise<void>} Rien — la réponse est envoyée via res.
 */
async function getLatestPrevisionRoute(req, res) {
  const prevision = await loadLatestPrevision();
  if (!prevision) return res.status(404).json({ error: "aucune prévision" });

  const records = await loadPrevisionsSince(Date.now() - PREVISION_PREVIOUS_WINDOW_MS);
  const previous = findPreviousEvaluated(records, prevision.baseTs);
  res.json({ ...prevision, precedente: previous });
}

/**
 * GET /api/forecast/previsions/stats — track record agrégé (statsOf) sur une
 * fenêtre.
 * @param {object} req Requête Express (?since=).
 * @param {object} res Réponse Express.
 * @returns {Promise<void>} Rien — la réponse est envoyée via res.
 */
async function getPrevisionStats(req, res) {
  const since = parseSince(req.query.since, STATS_SINCE_DAYS);
  const records = await loadPrevisionsSince(since);
  res.json({ since, count: records.length, ...statsOf(records) });
}

/**
 * GET /api/forecast/previsions/:ts — une prévision par timestamp.
 * @param {object} req Requête Express.
 * @param {object} res Réponse Express.
 * @returns {Promise<void>} Rien — la réponse est envoyée via res.
 */
async function getPrevisionByTsRoute(req, res) {
  const ts = parseTs(req.params.ts);
  if (ts == null) return res.status(400).json({ error: "ts invalide" });
  const prevision = await loadPrevisionByTs(ts);
  if (!prevision) return res.status(404).json({ error: "prévision introuvable" });
  res.json(prevision);
}

/**
 * GET /api/verdicts/:ts/snapshot — snapshot ayant produit ce verdict.
 * @param {object} req Requête Express.
 * @param {object} res Réponse Express.
 * @returns {Promise<void>} Rien — la réponse est envoyée via res.
 */
async function getVerdictSnapshot(req, res) {
  const ts = parseTs(req.params.ts);
  if (ts == null) return res.status(400).json({ error: "ts invalide" });
  const snap = await getSnapshotForVerdict(ts);
  if (!snap) return res.status(404).json({ error: "aucun snapshot pour ce verdict" });
  res.json(snap);
}

/**
 * GET /api/verdicts/:ts/outcome — suivi a posteriori : deltas factuels des
 * métriques-clés à +24h/+7j. Pas de note "juste/faux" — le consommateur juge.
 * @param {object} req Requête Express.
 * @param {object} res Réponse Express.
 * @returns {Promise<void>} Rien — la réponse est envoyée via res.
 */
async function getVerdictOutcome(req, res) {
  const ts = parseTs(req.params.ts);
  if (ts == null) return res.status(400).json({ error: "ts invalide" });
  const outcome = await computeOutcome(ts);
  if (!outcome) return res.status(404).json({ error: "verdict introuvable" });
  res.json(outcome);
}

/**
 * GET /api/verdicts/:ts — un verdict complet par timestamp.
 * @param {object} req Requête Express.
 * @param {object} res Réponse Express.
 * @returns {Promise<void>} Rien — la réponse est envoyée via res.
 */
async function getVerdictByTsRoute(req, res) {
  const ts = parseTs(req.params.ts);
  if (ts == null) return res.status(400).json({ error: "ts invalide" });
  const verdict = await loadVerdictByTs(ts);
  if (!verdict) return res.status(404).json({ error: "verdict introuvable" });
  res.json(verdict);
}

/**
 * GET /api/trends — tendances courantes (deltas 1h/24h/7j + normalisation).
 * @param {object} req Requête Express (?lookbackDays=).
 * @param {object} res Réponse Express.
 * @returns {Promise<void>} Rien — la réponse est envoyée via res.
 */
async function getTrendsRoute(req, res) {
  const lookbackDays = Number(req.query.lookbackDays) || TRENDS_LOOKBACK_DAYS;
  res.json(await getTrends(lookbackDays));
}

/**
 * GET /api/metrics — historique compact des métriques d'une fenêtre.
 * @param {object} req Requête Express (?since=).
 * @param {object} res Réponse Express.
 * @returns {Promise<void>} Rien — la réponse est envoyée via res.
 */
async function getMetrics(req, res) {
  const since = parseSince(req.query.since);
  res.json(await loadMetricsSince(since));
}

/**
 * GET /api/health — sonde de vie (jamais authentifiée).
 * @param {object} req Requête Express.
 * @param {object} res Réponse Express.
 */
function getHealth(req, res) {
  res.json({ ok: true, ts: Date.now(), schemaVersion: SCHEMA_VERSION, paramsVersion: DATA_PARAMS_VERSION });
}

/**
 * GET /api/dictionary — dictionnaire auto-descriptif des métriques.
 * @param {object} req Requête Express.
 * @param {object} res Réponse Express.
 */
function getDictionary(req, res) {
  res.json({ schemaVersion: SCHEMA_VERSION, paramsVersion: DATA_PARAMS_VERSION, count: Object.keys(METRIC_DICTIONARY).length, metrics: METRIC_DICTIONARY });
}

/**
 * GET /api/glossary — glossaire des termes.
 * @param {object} req Requête Express.
 * @param {object} res Réponse Express.
 */
function getGlossary(req, res) {
  res.json({ count: GLOSSARY.length, terms: GLOSSARY });
}

/**
 * Construit l'app Express : middlewares (CORS, auth optionnelle, rate-limit
 * optionnel) puis routes. Les routes spécifiques (latest, outcome…) sont
 * enregistrées AVANT les génériques `/:ts`.
 * @returns {object} App Express prête à écouter.
 */
export function createApp() {
  const app = express();

  app.use(createCorsMiddleware());
  app.use(createSignatureAuthMiddleware());

  // Rate-limit OPTIONNEL : actif seulement si API_RATE_LIMIT > 0.
  const rateLimit = Number(process.env.API_RATE_LIMIT) || 0;
  if (rateLimit > 0) app.use(createRateLimitMiddleware(rateLimit));

  app.get("/api/health", getHealth);
  app.get("/", sendIndex);
  app.get("/api", sendIndex);

  app.get("/api/dictionary", getDictionary);
  app.get("/api/glossary", getGlossary);

  app.post("/api/explain", express.json({ limit: EXPLAIN_BODY_LIMIT }), wrapAsync(postExplain));
  app.get("/api/calendar", wrapAsync(getCalendar));
  app.get("/api/cycle", wrapAsync(getCycle));
  app.get("/api/valuation", wrapAsync(getValuation));
  app.get("/api/liquidations", wrapAsync(getLiquidations));
  app.get("/api/derivatives", wrapAsync(getDerivatives));
  app.get("/api/whales", wrapAsync(getWhales));
  app.get("/api/treasuries", wrapAsync(getTreasuries));
  app.get("/api/regime", wrapAsync(getRegime));
  app.get("/api/onchain-extras", wrapAsync(getOnchainExtras));
  app.get("/api/fed", wrapAsync(getFedExpectation));

  app.get("/api/snapshots", wrapAsync(getSnapshots));
  app.get("/api/snapshots/latest", wrapAsync(getLatestSnapshot));
  app.get("/api/snapshots/:ts/verdict", wrapAsync(getSnapshotVerdict));
  app.get("/api/snapshots/:ts/freshness", wrapAsync(getSnapshotFreshness));
  app.get("/api/freshness", wrapAsync(getLatestFreshness));
  app.get("/api/snapshots/:ts", wrapAsync(getSnapshotByTs));

  app.get("/api/verdicts", wrapAsync(getVerdicts));
  app.get("/api/verdicts/latest", wrapAsync(getLatestVerdict));

  app.use("/api/forecast/previsions", evaluatePrevisionsBeforeServing);
  app.get("/api/forecast/previsions", wrapAsync(getPrevisions));
  app.get("/api/forecast/previsions/latest", wrapAsync(getLatestPrevisionRoute));
  app.get("/api/forecast/previsions/stats", wrapAsync(getPrevisionStats));
  app.get("/api/forecast/previsions/:ts", wrapAsync(getPrevisionByTsRoute));

  app.get("/api/verdicts/:ts/snapshot", wrapAsync(getVerdictSnapshot));
  app.get("/api/verdicts/:ts/outcome", wrapAsync(getVerdictOutcome));
  app.get("/api/verdicts/:ts", wrapAsync(getVerdictByTsRoute));

  app.get("/api/trends", wrapAsync(getTrendsRoute));
  app.get("/api/metrics", wrapAsync(getMetrics));

  return app;
}
