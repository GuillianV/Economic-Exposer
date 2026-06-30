import { Collector } from "./base.js";

/**
 * Liquidité GLOBALE via FRED — LE driver macro->BTC central de la thèse.
 * Nécessite process.env.FRED_API_KEY. Axe : liquidity.
 *
 * Liquidité nette Fed = Bilan Fed − Reverse Repo − Treasury General Account.
 * Liquidité GLOBALE = Fed (nette) + BCE + BoJ (en Md$). Le BTC suit la liquidité
 * MONDIALE, pas que la Fed. C'est sa TENDANCE qui compte.
 *
 * ⚠️ Unités hétérogènes :
 *   - WALCL & WTREGEN : millions USD ; RRP : milliards USD.
 *   - ECBASSETSW : millions EUR  -> Md$ via DEXUSEU (USD par EUR).
 *   - JPNASSETS  : 100 M JPY     -> Md$ via DEXJPUS (JPY par USD).
 * PBoC écartée : pas de série FRED de niveau gratuite et à jour.
 */
const FRED = "https://api.stlouisfed.org/fred/series/observations";

export class LiquidityCollector extends Collector {
  constructor() {
    super("liquidity", { axis: "liquidity" });
  }

  // Dernière observation valide (ignore les "." de FRED).
  async #latest(seriesId, apiKey) {
    const url = `${FRED}?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=10`;
    const json = await this.getJson(url);
    const obs = (json?.observations || []).find((o) => o.value !== ".");
    return obs ? { value: Number(obs.value), date: obs.date } : null;
  }

  async fetchData() {
    const apiKey = process.env.FRED_API_KEY;
    if (!apiKey) throw new Error("FRED_API_KEY absente du .env");

    const ids = {
      fedBalanceSheet: "WALCL", // millions USD
      reverseRepo: "RRPONTSYD", // milliards USD
      tga: "WTREGEN", // millions USD
      ecbAssetsEur: "ECBASSETSW", // millions EUR
      bojAssets100mJpy: "JPNASSETS", // 100 M JPY
      eurUsd: "DEXUSEU", // USD par EUR
      jpyUsd: "DEXJPUS", // JPY par USD
    };
    const keys = Object.keys(ids);
    const settled = await Promise.allSettled(keys.map((k) => this.#latest(ids[k], apiKey)));
    const raw = {};
    keys.forEach((k, i) => (raw[k] = settled[i].status === "fulfilled" ? settled[i].value : null));

    // --- Fed (nette), en Md$ ---
    const fedBalanceSheet = raw.fedBalanceSheet ? { value: raw.fedBalanceSheet.value / 1000, date: raw.fedBalanceSheet.date } : null;
    const reverseRepo = raw.reverseRepo ? { value: raw.reverseRepo.value, date: raw.reverseRepo.date } : null;
    const tga = raw.tga ? { value: raw.tga.value / 1000, date: raw.tga.date } : null;
    const netLiquidity =
      fedBalanceSheet && reverseRepo && tga
        ? { value: fedBalanceSheet.value - reverseRepo.value - tga.value, unit: "Md$" }
        : null;

    // --- BCE & BoJ, convertis en Md$ ---
    const ecbAssets =
      raw.ecbAssetsEur && raw.eurUsd
        ? { value: (raw.ecbAssetsEur.value * raw.eurUsd.value) / 1000, date: raw.ecbAssetsEur.date, unit: "Md$" }
        : null;
    const bojAssets =
      raw.bojAssets100mJpy && raw.jpyUsd
        ? { value: (raw.bojAssets100mJpy.value * 0.1) / raw.jpyUsd.value, date: raw.bojAssets100mJpy.date, unit: "Md$" }
        : null;

    // --- Liquidité globale = Fed nette + BCE + BoJ (Md$) ---
    const globalLiquidity =
      netLiquidity && ecbAssets && bojAssets
        ? { value: netLiquidity.value + ecbAssets.value + bojAssets.value, unit: "Md$" }
        : null;

    return { fedBalanceSheet, reverseRepo, tga, netLiquidity, ecbAssets, bojAssets, globalLiquidity };
  }
}
