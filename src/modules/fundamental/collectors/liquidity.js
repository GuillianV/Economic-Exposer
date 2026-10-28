import { Collector } from "./base.js";
import { settleFredSeries } from "./fred-client.js";

/**
 * Liquidité GLOBALE via FRED — LE driver macro→BTC central de la thèse.
 * Nécessite process.env.FRED_API_KEY. Axe : liquidity.
 *
 * Liquidité nette Fed = Bilan Fed − Reverse Repo − Treasury General Account.
 * Liquidité GLOBALE = Fed (nette) + BCE + BoJ (en Md$). Le BTC suit la
 * liquidité MONDIALE, pas que la Fed ; c'est sa TENDANCE qui compte.
 * PBoC écartée : pas de série FRED de niveau gratuite et à jour.
 */
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
   * Récupère les 7 séries et assemble la liquidité nette Fed, BCE, BoJ et
   * globale, toutes en Md$. Chaque agrégat est null si un composant manque.
   * @returns {Promise<{fedBalanceSheet: object|null, reverseRepo: object|null,
   *   tga: object|null, netLiquidity: object|null, ecbAssets: object|null,
   *   bojAssets: object|null, globalLiquidity: object|null}>} Composants et
   *   agrégats de liquidité ({value, date?, unit?}).
   * @throws {Error} Si la clé FRED est absente ou si toutes les séries échouent.
   */
  async fetchData() {
    const apiKey = process.env.FRED_API_KEY;
    if (!apiKey) throw new Error("FRED_API_KEY absente du .env");

    const raw = await settleFredSeries(SERIES_IDS, apiKey, (url) => this.getJson(url), { source: "liquidity" });

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
