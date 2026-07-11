import { Collector } from "./base.js";

/**
 * GDELT DOC 2.0 API — monitoring géopolitique mondial.
 * Sans clé, gratuit. Axe : geopolitics.
 *
 * Donne les manchettes géopolitiques récentes (guerre/conflits/sanctions),
 * filtrées en anglais et triées par pertinence, avec le pays source.
 *
 * Un seul appel (artlist) : le mode `timelinetone` est trop rate-limité par
 * GDELT (429 systématique) — écarté ; le sentiment est couvert ailleurs
 * (Fear & Greed, news).
 */
const BASE_URL = "https://api.gdeltproject.org/api/v2/doc/doc";
const GDELT_TIMEOUT_MS = 25000;

// sourcelang:english coupe le bruit multilingue ; sort=hybridrel = pertinence.
const GEO_QUERY = "(war OR conflict OR military OR sanctions OR invasion OR ceasefire) sourcelang:english";

// Cache last-good (au niveau module : persiste entre collectes du process).
// GDELT rate-limite fort (429 fréquent) et la géopolitique évolue lentement :
// resservir la dernière collecte réussie vaut mieux que rien.
let lastGood = null; // { headlineCount, topHeadlines, fetchedTs }

/**
 * Convertit une date GDELT ("20260629T131500Z") en ms epoch.
 * @param {string} raw Date au format GDELT.
 * @returns {number|null} Timestamp ms, ou null si le format est inattendu.
 */
function parseSeenDate(raw) {
  if (!raw || raw.length < 15) return null;
  const iso =
    `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` +
    `T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}Z`;
  const ts = new Date(iso).getTime();
  return Number.isFinite(ts) ? ts : null;
}

export class GdeltCollector extends Collector {
  /**
   * @param {{ maxRecords?: number }} [options] Nombre maximal d'articles demandés.
   */
  constructor({ maxRecords = 20 } = {}) {
    super("gdelt", { axis: "geopolitics" });
    this.maxRecords = maxRecords;
  }

  /**
   * Manchettes géopolitiques dédupliquées (même titre repris par plusieurs
   * domaines). En cas d'échec (429 fréquent), ressert la dernière collecte
   * réussie marquée `cached` ; sans cache, propage l'erreur (vraie staleness).
   * @returns {Promise<{headlineCount: number, topHeadlines: Array<object>,
   *   fetchedTs: number, cached?: boolean}>} Manchettes {title, domain,
   *   sourceCountry, date, url}.
   */
  async fetchData() {
    const url =
      `${BASE_URL}?query=${encodeURIComponent(GEO_QUERY)}` +
      `&mode=artlist&format=json&timespan=2d&maxrecords=${this.maxRecords}&sort=hybridrel`;

    let json;
    try {
      json = await this.getJson(url, { timeout: GDELT_TIMEOUT_MS });
    } catch (err) {
      if (lastGood) return { ...lastGood, cached: true };
      throw err;
    }

    const articles = Array.isArray(json?.articles) ? json.articles : [];
    const seenTitles = new Set();
    const headlines = [];
    for (const article of articles) {
      const title = (article.title || "").trim();
      if (!title) continue;

      const dedupKey = title.toLowerCase();
      if (seenTitles.has(dedupKey)) continue;
      seenTitles.add(dedupKey);

      headlines.push({
        title,
        domain: article.domain || "",
        sourceCountry: article.sourcecountry || "",
        date: parseSeenDate(article.seendate),
        url: article.url || "",
      });
    }

    const data = { headlineCount: headlines.length, topHeadlines: headlines, fetchedTs: Date.now() };
    lastGood = data;
    return data;
  }
}
