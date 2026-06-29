import { Collector } from "./base.js";

/**
 * Liquidité nette (Fed) via FRED — LE driver macro->BTC central de la thèse.
 * Nécessite process.env.FRED_API_KEY. Axe : liquidity.
 *
 * Liquidité nette = Bilan Fed − Reverse Repo − Treasury General Account.
 * Quand elle monte, le risque (dont BTC) tend à être soutenu ; quand elle
 * baisse, vent de face. C'est sa TENDANCE qui compte.
 *
 * ⚠️ Unités hétérogènes chez FRED : WALCL & WTREGEN en MILLIONS, RRP en
 * MILLIARDS. On ramène tout en MILLIARDS de $.
 */
const SERIES = {
  fedBalanceSheet: { id: "WALCL", toBillions: 1 / 1000 }, // millions -> milliards
  reverseRepo: { id: "RRPONTSYD", toBillions: 1 }, // déjà milliards
  tga: { id: "WTREGEN", toBillions: 1 / 1000 }, // millions -> milliards
};

export class LiquidityCollector extends Collector {
  constructor() {
    super("liquidity", { axis: "liquidity" });
  }

  async #latest(seriesId, apiKey) {
    const url =
      `https://api.stlouisfed.org/fred/series/observations` +
      `?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=1`;
    const json = await this.getJson(url);
    const obs = json?.observations?.[0];
    if (!obs || obs.value === ".") return null;
    return { value: Number(obs.value), date: obs.date };
  }

  async fetchData() {
    const apiKey = process.env.FRED_API_KEY;
    if (!apiKey) throw new Error("FRED_API_KEY absente du .env");

    const keys = Object.keys(SERIES);
    const settled = await Promise.allSettled(keys.map((k) => this.#latest(SERIES[k].id, apiKey)));

    const out = {};
    keys.forEach((k, i) => {
      const obs = settled[i].status === "fulfilled" ? settled[i].value : null;
      out[k] = obs ? { value: obs.value * SERIES[k].toBillions, date: obs.date } : null;
    });

    // Liquidité nette (en Md$), si les 3 composantes sont dispo.
    const { fedBalanceSheet, reverseRepo, tga } = out;
    out.netLiquidity =
      fedBalanceSheet && reverseRepo && tga
        ? { value: fedBalanceSheet.value - reverseRepo.value - tga.value, unit: "Md$" }
        : null;

    return out;
  }
}
