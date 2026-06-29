import { Collector } from "./base.js";

/**
 * FRED (Federal Reserve, St. Louis) — macro US.
 * Nécessite une clé gratuite : process.env.FRED_API_KEY.
 * Sans clé, le collecteur throw -> il passe en "stale" dans le world-state.
 * Axe : macro.
 *
 * Séries suivies (dernière observation de chacune) :
 *   M2SL     - masse monétaire M2 (liquidité)
 *   DTWEXBGS - indice dollar large (proxy DXY)
 *   DGS10    - rendement Treasury 10 ans
 *   FEDFUNDS - taux directeur Fed
 *   CPIAUCSL - inflation (CPI)
 */
const SERIES = {
  m2: "M2SL",
  dollarIndex: "DTWEXBGS",
  yield10y: "DGS10",
  fedFunds: "FEDFUNDS",
  cpi: "CPIAUCSL",
};

export class FredCollector extends Collector {
  constructor() {
    super("fred", { axis: "macro" });
  }

  async #latestObservation(seriesId, apiKey) {
    const url =
      `https://api.stlouisfed.org/fred/series/observations` +
      `?series_id=${seriesId}&api_key=${apiKey}&file_type=json` +
      `&sort_order=desc&limit=1`;
    const json = await this.getJson(url);
    const obs = json?.observations?.[0];
    if (!obs) return null;
    const value = obs.value === "." ? null : Number(obs.value);
    return { value, date: obs.date };
  }

  async fetchData() {
    const apiKey = process.env.FRED_API_KEY;
    if (!apiKey) throw new Error("FRED_API_KEY absente du .env");

    const entries = await Promise.all(
      Object.entries(SERIES).map(async ([key, seriesId]) => [key, await this.#latestObservation(seriesId, apiKey)]),
    );
    return Object.fromEntries(entries);
  }
}
