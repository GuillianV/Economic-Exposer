import zlib from "node:zlib";
import { Collector } from "./base.js";
import { logger } from "../../logs/index.js";

/**
 * GDELT Web News NGrams 3.0 (dataset "weblegacy") — monitoring géopolitique.
 * Sans clé, gratuit. Axe : geopolitics.
 *
 * L'ancienne DOC 2.0 API (api.gdeltproject.org) était bloquée AU NIVEAU RÉSEAU
 * pour les IP datacenter (fetch failed) et rate-limitée (429). On lit désormais
 * les fichiers STATIQUES du bucket Google Storage, servis sans blocage IP ni
 * rate-limit. Chaque intervalle publie une table des matières `*.toc.json.gz`
 * (ND-JSON : un article par ligne { ID, date, img, lang, title, url }) d'où l'on
 * extrait les manchettes conflit + leur volume.
 *
 * Les fichiers sortent en SALVES toutes les ~15 min (~2-3 min de délai) : un
 * gros fichier (milliers d'articles) entouré d'un ou deux petits (dizaines à
 * centaines). On agrège TOUS les fichiers de la dernière salve complète — lire
 * un seul fichier tombait souvent sur un petit et donnait 0 manchette.
 */
const NGRAMS_BASE = "https://storage.googleapis.com/data.gdeltproject.org/gdeltv5/weblegacy/ngrams";
const FETCH_TIMEOUT_MS = 20000;
const PROBE_START_MIN = 3; // les fichiers sortent avec ~2-3 min de délai
const PROBE_END_MIN = 40; // profondeur de sonde : couvre au moins deux salves (~15 min d'écart)
const BURST_SPAN_MIN = 3; // minutes : fichiers d'une même salve publiés sur 3 minutes consécutives au plus
const MIN_BURST_ARTICLES = 1500; // articles : salve complète observée 5 000-6 000, fichier isolé 50-850
const HEAD_TIMEOUT_MS = 10000;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const LAST_GOOD_MAX_AGE_MS = 2 * HOUR_MS; // collecte horaire : la dernière salve lue a toujours ~1 h
const MAX_HEADLINES = 15; // titres remontés au prompt (le volume, lui, compte tous les matchs)

// Filtre conflit multilingue (en/fr/it) sur les titres — bornes de mot pour
// éviter les faux positifs ; `\w*` là où la racine varie (sanction/sanzioni).
const CONFLICT_RX = new RegExp(
  "\\b(war|wars|warfare|conflict|military|militant|insurgen\\w*|sanction\\w*|invasion|invade|" +
    "ceasefire|airstrike|missile|troops|nuclear|coup|offensive|" +
    "guerre|conflit|militaire|frappe|invasion|cessez-le-feu|" +
    "guerra|conflitto|militare|sanzion\\w*)\\b",
  "i",
);

// Cache last-good (module : persiste entre collectes du process). Un intervalle
// manquant ou une coupure resservent la dernière collecte réussie plutôt que rien.
let lastGood = null; // { headlineCount, topHeadlines, fetchedTs, fileTs } — epoch ms

/**
 * Minute UTC (epoch ms, secondes tronquées) située `back` minutes avant nowMs.
 * Fonction PURE.
 * @param {number} back Minutes en arrière.
 * @param {number} nowMs Instant de référence (epoch ms).
 * @returns {number} Epoch ms de la minute visée.
 */
function minuteMsAgo(back, nowMs) {
  const flooredNowMs = Math.floor(nowMs / MINUTE_MS) * MINUTE_MS;
  return flooredNowMs - back * MINUTE_MS;
}

/**
 * Horodatage GDELT (UTC, minute) d'une minute donnée.
 * @param {number} minuteMs Epoch ms de la minute.
 * @returns {string} Timestamp au format YYYYMMDDHHMM00.
 */
function ngramTimestamp(minuteMs) {
  const d = new Date(minuteMs);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`
  );
}

/**
 * Extrait l'hôte d'une URL (pour le champ domain), sans lever.
 * @param {string} url URL de l'article.
 * @returns {string} Nom d'hôte, ou chaîne vide si non parsable.
 */
function domainOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

/**
 * Filtre les manchettes conflit d'une table des matières GDELT. Fonction PURE
 * (aucune I/O) — testable isolément.
 * @param {Array<object>} records Articles bruts { title, url, lang, date }.
 * @param {number} maxHeadlines Nombre de titres à conserver (le volume compte tout).
 * @returns {{headlineCount: number, topHeadlines: Array<{title: string,
 *   domain: string, lang: string, date: number|null, url: string}>}}
 *   Volume de manchettes conflit + échantillon de titres.
 */
export function extractConflictHeadlines(records, maxHeadlines) {
  const seen = new Set();
  const matched = [];
  for (const rec of records) {
    const title = (rec?.title || "").trim();
    if (!title || !CONFLICT_RX.test(title)) continue;

    const url = rec?.url || "";
    const dedupKey = url || title.toLowerCase();
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    const parsedDate = Date.parse(rec?.date);
    matched.push({
      title,
      domain: domainOf(url),
      lang: rec?.lang || "",
      date: Number.isFinite(parsedDate) ? parsedDate : null,
      url,
    });
  }
  return { headlineCount: matched.length, topHeadlines: matched.slice(0, maxHeadlines) };
}

/**
 * Regroupe les minutes disponibles en salves : deux fichiers distants d'au
 * plus `spanMin` minutes du premier fichier d'une salve en font partie.
 * Fonction PURE.
 * @param {Array<number>} backs Minutes en arrière des fichiers disponibles,
 *   triées croissant (du plus récent au plus ancien).
 * @param {number} spanMin Étendue maximale d'une salve (minutes).
 * @returns {Array<Array<number>>} Salves, de la plus récente à la plus ancienne.
 */
export function groupIntoBursts(backs, spanMin) {
  const bursts = [];
  for (const back of backs) {
    const current = bursts.at(-1);
    const isSameBurst = current && back - current[0] <= spanMin;
    if (isSameBurst) {
      current.push(back);
    } else {
      bursts.push([back]);
    }
  }
  return bursts;
}

/**
 * Une salve est-elle complète (gros fichier publié) ? Fonction PURE.
 * @param {number} articleCount Nombre d'articles agrégés de la salve.
 * @returns {boolean} true si la salve compte au moins MIN_BURST_ARTICLES articles.
 */
export function isBurstComplete(articleCount) {
  return articleCount >= MIN_BURST_ARTICLES;
}

/**
 * Collecteur des manchettes conflit GDELT (volume + échantillon).
 */
export class GdeltCollector extends Collector {
  /**
   * Initialise le collecteur et son option d'échantillonnage.
   * @param {{ maxHeadlines?: number }} [options] Nombre de titres remontés au prompt.
   */
  constructor({ maxHeadlines = MAX_HEADLINES } = {}) {
    super("gdelt", { axis: "geopolitics" });
    this.maxHeadlines = maxHeadlines;
  }

  /**
   * Télécharge et décompresse une table des matières GDELT (ND-JSON gzippé).
   * @param {string} ts Timestamp GDELT (YYYYMMDDHHMM00).
   * @returns {Promise<Array<object>|null>} Articles parsés, ou null si absent (404).
   */
  async #fetchToc(ts) {
    const url = `${NGRAMS_BASE}/${ts}.toc.json.gz`;
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;

    const gz = Buffer.from(await res.arrayBuffer());
    const text = zlib.gunzipSync(gz).toString("utf-8");
    const records = [];
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed));
      } catch {
        continue; // ligne corrompue : on l'ignore, le reste du fichier reste exploitable
      }
    }
    return records;
  }

  /**
   * Teste la présence d'une table des matières (HEAD, sans téléchargement).
   * @param {string} ts Timestamp GDELT (YYYYMMDDHHMM00).
   * @returns {Promise<boolean>} true si le fichier est publié ; false si absent
   *   ou injoignable (une coupure isolée fait juste sauter cette minute).
   */
  async #exists(ts) {
    try {
      const res = await fetch(`${NGRAMS_BASE}/${ts}.toc.json.gz`, {
        method: "HEAD",
        signal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
      });
      return res.ok;
    } catch (err) {
      logger.warn(`[gdelt] sonde ${ts} en échec : ${err.message}`);
      return false;
    }
  }

  /**
   * Minutes (en arrière de nowMs) pour lesquelles un fichier est publié, sur
   * toute la fenêtre de sonde, en parallèle.
   * @param {number} nowMs Instant de référence (epoch ms).
   * @returns {Promise<Array<number>>} Minutes disponibles, triées croissant.
   */
  async #probeAvailableBacks(nowMs) {
    const backs = [];
    for (let back = PROBE_START_MIN; back <= PROBE_END_MIN; back += 1) backs.push(back);
    const found = await Promise.all(backs.map((back) => this.#exists(ngramTimestamp(minuteMsAgo(back, nowMs)))));
    return backs.filter((back, i) => found[i]);
  }

  /**
   * Télécharge et concatène les articles de tous les fichiers d'une salve. Un
   * fichier illisible est loggé et ignoré (la salve reste exploitable).
   * @param {Array<number>} burst Minutes en arrière des fichiers de la salve.
   * @param {number} nowMs Instant de référence (epoch ms).
   * @returns {Promise<Array<object>>} Articles bruts de la salve.
   */
  async #fetchBurstRecords(burst, nowMs) {
    const records = [];
    for (const back of burst) {
      const ts = ngramTimestamp(minuteMsAgo(back, nowMs));
      try {
        const fileRecords = await this.#fetchToc(ts);
        if (fileRecords) records.push(...fileRecords);
      } catch (err) {
        logger.warn(`[gdelt] fichier ${ts} illisible : ${err.message}`);
      }
    }
    return records;
  }

  /**
   * Dernière salve COMPLÈTE de la fenêtre de sonde (une salve en cours de
   * publication est sautée au profit de la précédente) ; à défaut, la plus
   * fournie.
   * @param {number} nowMs Instant de référence (epoch ms).
   * @returns {Promise<{records: Array<object>, fileTs: number}|null>} Articles
   *   et minute du fichier le plus récent de la salve (epoch ms), ou null si
   *   aucun fichier n'est publié dans la fenêtre.
   */
  async #loadLatestBurst(nowMs) {
    const bursts = groupIntoBursts(await this.#probeAvailableBacks(nowMs), BURST_SPAN_MIN);
    let best = null;
    for (const burst of bursts) {
      const records = await this.#fetchBurstRecords(burst, nowMs);
      const candidate = { records, fileTs: minuteMsAgo(burst[0], nowMs) };
      if (isBurstComplete(records.length)) return candidate;
      if (!best || records.length > best.records.length) best = candidate;
    }
    if (best) logger.warn(`[gdelt] aucune salve complète dans la fenêtre : salve partielle de ${best.records.length} articles retenue`);
    return best;
  }

  /**
   * Manchettes géopolitiques (conflit) de la dernière salve GDELT complète.
   * En cas d'échec total, ressert la dernière collecte réussie (marquée
   * `cached`) si elle a moins de 2 h ; sinon propage l'erreur (vraie staleness).
   * @returns {Promise<{headlineCount: number, topHeadlines: Array<object>,
   *   fetchedTs: number, fileTs: number, cached?: boolean}>} Volume + manchettes
   *   conflit {title, domain, lang, date, url} ; fileTs = minute de publication
   *   de la salve (epoch ms).
   * @throws {Error} Si aucune salve n'est publiée et aucun repli récent n'existe.
   */
  async fetchData() {
    const nowMs = Date.now();
    const burst = await this.#loadLatestBurst(nowMs);
    if (burst) {
      const { headlineCount, topHeadlines } = extractConflictHeadlines(burst.records, this.maxHeadlines);
      const data = { headlineCount, topHeadlines, fetchedTs: nowMs, fileTs: burst.fileTs };
      lastGood = data;
      return data;
    }

    const isLastGoodRecent = lastGood && nowMs - lastGood.fetchedTs <= LAST_GOOD_MAX_AGE_MS;
    if (isLastGoodRecent) return { ...lastGood, cached: true };
    throw new Error(`aucune salve GDELT publiée sur les ${PROBE_END_MIN} dernières minutes`);
  }
}
