import { Collector } from "./base.js";

/**
 * Liquidité GLOBALE via FRED — LE driver macro→BTC central de la thèse.
 * Nécessite process.env.FRED_API_KEY. Axe : liquidity.
 *
 * Liquidité nette Fed = Bilan Fed − Reverse Repo − Treasury General Account.
 * Liquidité GLOBALE = Fed (nette) + BCE + BoJ (en Md$). Le BTC suit la
 * liquidité MONDIALE, pas que la Fed ; c'est sa TENDANCE qui compte.
 * PBoC écartée : pas de série FRED de niveau gratuite et à jour.
 */
const FRED_URL = "https://api.stlouisfed.org/fred/series/observations";

// Unités hétérogènes côté FRED — chaque série est convertie en Md$ ci-dessous.
const SERIES_IDS = {
  fedBalanceSheet: "WALCL", // millions USD
  reverseRepo: "RRPONTSYD", // milliards USD
  tga: "WTREGEN", // millions USD
  ecbAssetsEur: "ECBASSETSW", // millions EUR
  bojAssets100mJpy: "JPNASSETS", // 100 M JPY
  eurUsd: "DEXUSEU", // USD par EUR
  jpyUsd: "DEXJPUS", // JPY par USD
};

/**
 *
 */
export class LiquidityCollector extends Collector {
  /**
   * Initialise le collecteur et ses options.
   *
   */
  constructor() {
    super("liquidity", { axis: "liquidity" });
  }

  /**
   * Dernière observation VALIDE d'une série FRED (ignore les "." de FRED).
   * @param {string} seriesId Identifiant de série FRED.
   * @param {string} apiKey Clé API FRED.
   * @returns {Promise<{value: number, date: string}|null>} Observation, ou null.
   */
  async #latest(seriesId, apiKey) {
    const url = `${FRED_URL}?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=10`;
    const json = await this.getJson(url);
    const observation = (json?.observations || []).find((o) => o.value !== ".");
    return observation ? { value: Number(observation.value), date: observation.date } : null;
  }

  /**
   * Récupère les 7 séries et assemble la liquidité nette Fed, BCE, BoJ et
   * globale, toutes en Md$. Chaque agrégat est null si un composant manque.
   * @returns {Promise<{fedBalanceSheet: object|null, reverseRepo: object|null,
   *   tga: object|null, netLiquidity: object|null, ecbAssets: object|null,
   *   bojAssets: object|null, globalLiquidity: object|null}>} Composants et
   *   agrégats de liquidité ({value, date?, unit?}).
   * @throws {Error} Si la clé FRED est absente.
   */
  async fetchData() {
    const apiKey = process.env.FRED_API_KEY;
    if (!apiKey) throw new Error("FRED_API_KEY absente du .env");

    const keys = Object.keys(SERIES_IDS);
    const settled = await Promise.allSettled(keys.map((key) => this.#latest(SERIES_IDS[key], apiKey)));
    const raw = {};
    keys.forEach((key, i) => {
      raw[key] = settled[i].status === "fulfilled" ? settled[i].value : null;
    });

    // Fed (nette), en Md$ : bilan et TGA arrivent en millions → /1000.
    const fedBalanceSheet = raw.fedBalanceSheet
      ? { value: raw.fedBalanceSheet.value / 1000, date: raw.fedBalanceSheet.date }
      : null;
    const reverseRepo = raw.reverseRepo ? { value: raw.reverseRepo.value, date: raw.reverseRepo.date } : null;
    const tga = raw.tga ? { value: raw.tga.value / 1000, date: raw.tga.date } : null;

    let netLiquidity = null;
    if (fedBalanceSheet && reverseRepo && tga) {
      netLiquidity = { value: fedBalanceSheet.value - reverseRepo.value - tga.value, unit: "Md$" };
    }

    // BCE : millions EUR → Md$ via le taux USD par EUR.
    let ecbAssets = null;
    if (raw.ecbAssetsEur && raw.eurUsd) {
      ecbAssets = {
        value: (raw.ecbAssetsEur.value * raw.eurUsd.value) / 1000,
        date: raw.ecbAssetsEur.date,
        unit: "Md$",
      };
    }

    // BoJ : unités de 100 M JPY → Md$ via le taux JPY par USD.
    let bojAssets = null;
    if (raw.bojAssets100mJpy && raw.jpyUsd) {
      bojAssets = {
        value: (raw.bojAssets100mJpy.value * 0.1) / raw.jpyUsd.value,
        date: raw.bojAssets100mJpy.date,
        unit: "Md$",
      };
    }

    let globalLiquidity = null;
    if (netLiquidity && ecbAssets && bojAssets) {
      globalLiquidity = { value: netLiquidity.value + ecbAssets.value + bojAssets.value, unit: "Md$" };
    }

    return { fedBalanceSheet, reverseRepo, tga, netLiquidity, ecbAssets, bojAssets, globalLiquidity };
  }
}
