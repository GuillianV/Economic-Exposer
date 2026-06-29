import { Collector } from "./base.js";

/**
 * Calendrier économique US (forward-looking) via FRED.
 * Endpoint /fred/releases/dates : dates de publication passées ET futures
 * des séries économiques. Avec include_release_dates_with_no_data=true, les
 * publications planifiées (futures) remontent.
 *
 * Nécessite process.env.FRED_API_KEY (même clé que le collecteur fred).
 * Axe : macro.
 *
 * On ne garde que les publications à FORT impact marché (filtre par nom de
 * release) et dans une fenêtre temporelle (horizon, défaut 45 jours).
 */
const HIGH_IMPACT = [
  "Consumer Price Index", // CPI (inflation)
  "Employment Situation", // NFP / chômage
  "Gross Domestic Product", // PIB
  "Personal Income and Outlays", // PCE (inflation préférée de la Fed)
  "Producer Price Index", // PPI
  "Advance Monthly Sales for Retail", // ventes au détail
];

// Exclusions : variantes secondaires qui matchent par sous-chaîne mais ne sont
// PAS la publication phare (ex. "Research CPI", "Debt to GDP Ratios").
const EXCLUDE = ["Research", "Debt to"];

export class EconomicCalendarCollector extends Collector {
  constructor({ horizonDays = 45, maxEvents = 25 } = {}) {
    super("economic-calendar", { axis: "macro" });
    this.horizonDays = horizonDays;
    this.maxEvents = maxEvents;
  }

  #isHighImpact(name) {
    if (!name) return false;
    if (EXCLUDE.some((kw) => name.includes(kw))) return false;
    return HIGH_IMPACT.some((kw) => name.includes(kw));
  }

  async fetchData() {
    const apiKey = process.env.FRED_API_KEY;
    if (!apiKey) throw new Error("FRED_API_KEY absente du .env");

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const horizon = new Date(now.getTime() + this.horizonDays * 86400000).toISOString().slice(0, 10);

    const url =
      `https://api.stlouisfed.org/fred/releases/dates` +
      `?api_key=${apiKey}&file_type=json` +
      `&realtime_start=${today}&realtime_end=${horizon}` +
      `&include_release_dates_with_no_data=true&sort_order=asc&limit=1000`;

    const json = await this.getJson(url);
    const dates = Array.isArray(json?.release_dates) ? json.release_dates : [];

    // Garde fort impact + dates >= aujourd'hui, dédup (nom+date), tri croissant.
    const seen = new Set();
    const upcoming = [];
    for (const d of dates) {
      if (d.date < today) continue;
      if (!this.#isHighImpact(d.release_name)) continue;
      const key = `${d.release_name}|${d.date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      upcoming.push({ name: d.release_name, date: d.date, releaseId: d.release_id });
    }
    upcoming.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    return {
      horizonDays: this.horizonDays,
      count: Math.min(upcoming.length, this.maxEvents),
      upcoming: upcoming.slice(0, this.maxEvents),
    };
  }
}
