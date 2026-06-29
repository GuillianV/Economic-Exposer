import { Collector } from "./base.js";

/**
 * GDELT DOC 2.0 API — monitoring géopolitique mondial.
 * Sans clé, gratuit. Axe : geopolitics.
 *
 * Donne les manchettes géopolitiques récentes (guerre/conflits/sanctions),
 * filtrées en anglais et triées par pertinence, avec le pays source.
 *
 * NB : un seul appel (artlist). Le mode `timelinetone` (ton médiatique
 * structuré) est trop rate-limité par GDELT (429 systématique) — écarté ;
 * le sentiment est couvert ailleurs (Fear&Greed, news).
 */
const BASE = "https://api.gdeltproject.org/api/v2/doc/doc";

// sourcelang:english coupe le bruit multilingue ; sort=hybridrel = pertinence.
const GEO_QUERY = "(war OR conflict OR military OR sanctions OR invasion OR ceasefire) sourcelang:english";

function parseSeenDate(s) {
  // format GDELT : "20260629T131500Z"
  if (!s || s.length < 15) return null;
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

export class GdeltCollector extends Collector {
  constructor({ maxRecords = 20 } = {}) {
    super("gdelt", { axis: "geopolitics" });
    this.maxRecords = maxRecords;
  }

  async fetchData() {
    const url =
      `${BASE}?query=${encodeURIComponent(GEO_QUERY)}` +
      `&mode=artlist&format=json&timespan=2d&maxrecords=${this.maxRecords}&sort=hybridrel`;

    const json = await this.getJson(url, { timeout: 25000 });
    const articles = Array.isArray(json?.articles) ? json.articles : [];

    const seen = new Set();
    const headlines = [];
    for (const a of articles) {
      const title = (a.title || "").trim();
      if (!title) continue;
      const key = title.toLowerCase();
      if (seen.has(key)) continue; // dédup : même titre repris par plusieurs domaines
      seen.add(key);
      headlines.push({
        title,
        domain: a.domain || "",
        sourceCountry: a.sourcecountry || "",
        date: parseSeenDate(a.seendate),
        url: a.url || "",
      });
    }

    return {
      headlineCount: headlines.length,
      topHeadlines: headlines,
    };
  }
}
