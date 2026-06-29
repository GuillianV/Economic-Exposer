import { Collector } from "./base.js";

/**
 * Calendrier économique US via FRED — à la fois FORWARD (events à venir) et
 * BACKWARD (résultats publiés des events récents).
 *
 * - À venir : /fred/releases/dates (publications planifiées) + dates FOMC
 *   (codées en dur — la Fed n'est pas une "release" FRED).
 * - Résultats : pour chaque event récent à fort impact, on lit la série FRED
 *   correspondante (la dernière observation = le chiffre qui vient de sortir)
 *   et on calcule la variation vs le mois précédent.
 *
 * Nécessite process.env.FRED_API_KEY (même clé que le collecteur fred).
 * Axe : macro.
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
// PAS la publication phare (ex. "Research CPI", "Debt to GDP Ratios",
// "Gross Domestic Product by Industry/State").
const EXCLUDE = ["Research", "Debt to", " by "];

/**
 * Mapping release FRED → série FRED pour récupérer le RÉSULTAT publié.
 * NB : la date d'observation FRED = la période de référence (souvent le mois
 * précédent), pas la date de publication. Au moment où l'event tombe, la
 * dernière observation correspond au chiffre qui vient d'être publié.
 *   pctIsSignal : true  → la variation % (MoM/QoQ) est le chiffre à lire (CPI…)
 *   pctIsSignal : false → c'est la variation ABSOLUE qui parle (NFP : Δ niveau
 *                         d'emploi = créations d'emplois du mois, en milliers)
 */
const RELEASE_SERIES = [
  { match: "Consumer Price Index", id: "CPIAUCSL", label: "CPI", pctIsSignal: true },
  { match: "Producer Price Index", id: "PPIACO", label: "PPI", pctIsSignal: true },
  { match: "Personal Income and Outlays", id: "PCEPI", label: "PCE", pctIsSignal: true },
  { match: "Advance Monthly Sales for Retail", id: "RSAFS", label: "Ventes au détail", pctIsSignal: true },
  { match: "Gross Domestic Product", id: "GDPC1", label: "PIB réel", pctIsSignal: true },
  { match: "Employment Situation", id: "PAYEMS", label: "Emploi non-agricole (NFP)", pctIsSignal: false },
];

/**
 * Calendrier FOMC — jour de l'annonce (J2 de la réunion, statement à 14:00 ET),
 * source federalreserve.gov. Les réunions marquées projections incluent le
 * "dot plot" (impact renforcé sur les marchés).
 * ⚠️ À mettre à jour chaque année (la Fed publie le calendrier ~mi-année).
 */
const FOMC_DATES = [
  { date: "2026-01-28", projections: false },
  { date: "2026-03-18", projections: true },
  { date: "2026-04-29", projections: false },
  { date: "2026-06-17", projections: true },
  { date: "2026-07-29", projections: false },
  { date: "2026-09-16", projections: true },
  { date: "2026-10-28", projections: false },
  { date: "2026-12-09", projections: true },
];

const DAY_MS = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);

export class EconomicCalendarCollector extends Collector {
  constructor({ horizonDays = 45, recentDays = 10, maxEvents = 25 } = {}) {
    super("economic-calendar", { axis: "macro" });
    this.horizonDays = horizonDays;
    this.recentDays = recentDays;
    this.maxEvents = maxEvents;
  }

  #isHighImpact(name) {
    if (!name) return false;
    if (EXCLUDE.some((kw) => name.includes(kw))) return false;
    return HIGH_IMPACT.some((kw) => name.includes(kw));
  }

  #seriesFor(name) {
    if (!name) return null;
    if (EXCLUDE.some((kw) => name.includes(kw))) return null;
    return RELEASE_SERIES.find((s) => name.includes(s.match)) || null;
  }

  // Dernières observations valides d'une série (ignore les "." de FRED).
  async #latest(seriesId, apiKey, n = 2) {
    const url =
      `https://api.stlouisfed.org/fred/series/observations` +
      `?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=12`;
    const json = await this.getJson(url);
    const obs = (json?.observations || [])
      .filter((o) => o.value !== ".")
      .slice(0, n)
      .map((o) => ({ value: Number(o.value), date: o.date }));
    return obs;
  }

  // Récupère les dates de release fort-impact dans une fenêtre realtime donnée.
  async #releaseDates(apiKey, start, end) {
    const url =
      `https://api.stlouisfed.org/fred/releases/dates` +
      `?api_key=${apiKey}&file_type=json` +
      `&realtime_start=${start}&realtime_end=${end}` +
      `&include_release_dates_with_no_data=true&sort_order=asc&limit=1000`;
    const json = await this.getJson(url);
    const dates = Array.isArray(json?.release_dates) ? json.release_dates : [];
    const seen = new Set();
    const out = [];
    for (const d of dates) {
      if (!this.#isHighImpact(d.release_name)) continue;
      const key = `${d.release_name}|${d.date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name: d.release_name, date: d.date, releaseId: d.release_id, type: "release" });
    }
    return out;
  }

  async fetchData() {
    const apiKey = process.env.FRED_API_KEY;
    if (!apiKey) throw new Error("FRED_API_KEY absente du .env");

    const now = new Date();
    const today = iso(now);
    const since = iso(new Date(now.getTime() - this.recentDays * DAY_MS));
    const horizon = iso(new Date(now.getTime() + this.horizonDays * DAY_MS));

    // Deux fenêtres distinctes : forward (events à venir) et backward (résultats).
    const [forward, backward] = await Promise.all([
      this.#releaseDates(apiKey, today, horizon),
      this.#releaseDates(apiKey, since, today),
    ]);

    const upcoming = forward.filter((e) => e.date >= today);
    const recentEvents = backward.filter((e) => e.date < today);

    // Injecte les réunions FOMC à venir dans la fenêtre d'horizon.
    for (const f of FOMC_DATES) {
      if (f.date >= today && f.date <= horizon) {
        upcoming.push({
          name: f.projections ? "FOMC (décision Fed + projections/dot plot)" : "FOMC (décision Fed)",
          date: f.date,
          type: "fomc",
          projections: f.projections,
        });
      }
    }
    upcoming.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    // Récupère le RÉSULTAT publié pour chaque event récent mappable (en //).
    recentEvents.sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0)); // plus récent d'abord
    const results = await Promise.allSettled(
      recentEvents.map(async (ev) => {
        const s = this.#seriesFor(ev.name);
        if (!s) return { ...ev, result: null };
        const obs = await this.#latest(s.id, apiKey, 2);
        if (!obs.length) return { ...ev, result: null };
        const [last, prev] = obs;
        const change = prev ? last.value - prev.value : null;
        const changePct = prev && prev.value !== 0 ? (change / Math.abs(prev.value)) * 100 : null;
        return {
          ...ev,
          result: {
            label: s.label,
            pctIsSignal: s.pctIsSignal,
            value: last.value,
            refDate: last.date,
            previous: prev?.value ?? null,
            change,
            changePct,
          },
        };
      })
    );
    const recent = results.filter((r) => r.status === "fulfilled").map((r) => r.value);

    return {
      horizonDays: this.horizonDays,
      recentDays: this.recentDays,
      count: Math.min(upcoming.length, this.maxEvents),
      upcoming: upcoming.slice(0, this.maxEvents),
      recent,
    };
  }
}
