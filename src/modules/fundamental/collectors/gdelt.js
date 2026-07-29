import zlib from "node:zlib";
import { Collector } from "./base.js";

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
 * Les fichiers sortent par paires en bursts ~15 min avec ~2-3 min de délai :
 * on sonde les timestamps en arrière et on prend le plus récent disponible.
 */
const NGRAMS_BASE = "https://storage.googleapis.com/data.gdeltproject.org/gdeltv5/weblegacy/ngrams";
const FETCH_TIMEOUT_MS = 20000;
const PROBE_START_MIN = 3; // les fichiers sortent avec ~2-3 min de délai
const PROBE_END_MIN = 22; // profondeur de recherche du dernier intervalle publié (bursts ~15 min)
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
let lastGood = null; // { headlineCount, topHeadlines, fetchedTs }

/**
 * Horodatage GDELT (UTC, minute) pour `back` minutes en arrière.
 * @param {number} back Minutes en arrière depuis maintenant.
 * @returns {string} Timestamp au format YYYYMMDDHHMM00.
 */
function ngramTimestamp(back) {
  const d = new Date(Date.now() - back * 60000);
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
 *
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
   * Manchettes géopolitiques (conflit) du dernier intervalle GDELT publié.
   * Sonde les timestamps en arrière jusqu'au premier fichier disponible ; en cas
   * d'échec total, ressert la dernière collecte réussie marquée `cached` ; sans
   * cache, propage l'erreur (vraie staleness).
   * @returns {Promise<{headlineCount: number, topHeadlines: Array<object>,
   *   fetchedTs: number, cached?: boolean}>} Volume + manchettes conflit
   *   {title, domain, lang, date, url}.
   */
  async fetchData() {
    let lastErr = null;
    for (let back = PROBE_START_MIN; back <= PROBE_END_MIN; back += 1) {
      const ts = ngramTimestamp(back);
      let records;
      try {
        records = await this.#fetchToc(ts);
      } catch (err) {
        lastErr = err;
        continue; // timeout/coupure sur cet intervalle : on tente le précédent
      }
      if (!records) continue; // 404 : intervalle non encore publié, on remonte

      const { headlineCount, topHeadlines } = extractConflictHeadlines(records, this.maxHeadlines);
      const data = { headlineCount, topHeadlines, fetchedTs: Date.now() };
      lastGood = data;
      return data;
    }

    if (lastGood) return { ...lastGood, cached: true };
    throw lastErr || new Error(`aucun intervalle GDELT publié sur les ${PROBE_END_MIN} dernières minutes`);
  }
}
