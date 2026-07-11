import { Collector } from "./base.js";

/**
 * Binance Futures — positionnement / levier (proxy de sentiment), BTC + alts.
 * Sans clé, gratuit. Axe : sentiment.
 *
 * Funding & open interest sur les perpétuels (référence du marché des
 * dérivés) : BTC à plat (rétro-compat) + ETH/SOL/BNB/XRP sous leur clé.
 * S'ajoutent le ratio long/short BTC (foule vs gros comptes — un extrême
 * signale un retournement possible) et le basis des futures trimestriels
 * (contango/backwardation, jauge de levier plus propre que le funding).
 */
const FAPI_URL = "https://fapi.binance.com/fapi/v1";
const FDATA_URL = "https://fapi.binance.com/futures/data";
const ALT_SYMBOLS = ["ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"]; // breadth crypto

/**
 * Convertit en nombre, null si absent.
 * @param {*} value Valeur brute de l'API.
 * @returns {number|null} Nombre ou null.
 */
function toNumber(value) {
  return value != null ? Number(value) : null;
}

/**
 * Convertit un ratio Binance en pourcentage arrondi à 2 décimales.
 * @param {*} ratio Ratio brut (ex. 0.0329 = +3.29 %).
 * @returns {number|null} Pourcentage ou null.
 */
function ratioToPct(ratio) {
  const parsed = toNumber(ratio);
  if (parsed == null) return null;
  return Math.round(parsed * 10000) / 100;
}

export class BinanceFuturesCollector extends Collector {
  constructor() {
    super("binance-futures", { axis: "sentiment" });
  }

  /**
   * Funding et open interest du perpétuel d'un symbole.
   * @param {string} symbol Symbole perpétuel (ex. "BTCUSDT").
   * @returns {Promise<{symbol: string, lastFundingRate: number|null,
   *   markPrice: number|null, nextFundingTime: number|null,
   *   openInterest: number|null}>} Données du perpétuel.
   */
  async #symbol(symbol) {
    const [premium, openInterest] = await Promise.all([
      this.getJson(`${FAPI_URL}/premiumIndex?symbol=${symbol}`),
      this.getJson(`${FAPI_URL}/openInterest?symbol=${symbol}`),
    ]);
    return {
      symbol,
      lastFundingRate: toNumber(premium?.lastFundingRate),
      markPrice: toNumber(premium?.markPrice),
      nextFundingTime: premium?.nextFundingTime ?? null,
      openInterest: toNumber(openInterest?.openInterest),
    };
  }

  /**
   * Ratios long/short (foule et gros comptes). Défensif : ces endpoints
   * secondaires ne cassent pas le collecteur principal.
   * @param {string} symbol Symbole perpétuel.
   * @returns {Promise<{longShortAccountRatio: number|null,
   *   topPositionRatio: number|null}>} Ratios, nulls si les endpoints échouent.
   */
  async #ratios(symbol) {
    try {
      const [accounts, topTraders] = await Promise.all([
        this.getJson(`${FDATA_URL}/globalLongShortAccountRatio?symbol=${symbol}&period=1h&limit=1`),
        this.getJson(`${FDATA_URL}/topLongShortPositionRatio?symbol=${symbol}&period=1h&limit=1`),
      ]);
      const lastAccounts = Array.isArray(accounts) ? accounts[accounts.length - 1] : null;
      const lastTop = Array.isArray(topTraders) ? topTraders[topTraders.length - 1] : null;
      return {
        longShortAccountRatio: toNumber(lastAccounts?.longShortRatio), // foule (tous comptes)
        topPositionRatio: toNumber(lastTop?.longShortRatio), // gros traders (positions)
      };
    } catch {
      return { longShortAccountRatio: null, topPositionRatio: null };
    }
  }

  /**
   * Basis des futures trimestriels (annualisé). Les barres sont quotidiennes :
   * la dernière peut dater de ~24h, acceptable pour du swing. Défensif :
   * un échec renvoie null sans casser le collecteur principal.
   * @param {string} pair Paire (ex. "BTCUSDT").
   * @returns {Promise<{contractType: string, futuresPrice: number|null,
   *   indexPrice: number|null, basisRatePct: number|null,
   *   annualizedPct: number|null, date: number|null}|null>} Basis, ou null.
   */
  async #basis(pair) {
    try {
      const rows = await this.getJson(
        `${FDATA_URL}/basis?pair=${pair}&contractType=CURRENT_QUARTER&period=1d&limit=1`,
      );
      const lastBar = Array.isArray(rows) ? rows[rows.length - 1] : null;
      if (!lastBar) return null;

      return {
        contractType: lastBar.contractType,
        futuresPrice: toNumber(lastBar.futuresPrice),
        indexPrice: toNumber(lastBar.indexPrice),
        basisRatePct: ratioToPct(lastBar.basisRate),
        annualizedPct: ratioToPct(lastBar.annualizedBasisRate),
        date: lastBar.timestamp ?? null,
      };
    } catch {
      return null;
    }
  }

  /**
   * BTC (perpétuel + ratios + basis) et alts en parallèle.
   * @returns {Promise<object>} BTC à plat (rétro-compat) + ratios long/short +
   *   basis + un paquet perpétuel par alt sous sa clé (eth/sol/bnb/xrp).
   */
  async fetchData() {
    const [btc, ratios, basis, ...alts] = await Promise.all([
      this.#symbol("BTCUSDT"),
      this.#ratios("BTCUSDT"),
      this.#basis("BTCUSDT"),
      ...ALT_SYMBOLS.map((symbol) => this.#symbol(symbol)),
    ]);

    const out = { ...btc, ...ratios, basis };
    ALT_SYMBOLS.forEach((symbol, i) => {
      const altKey = symbol.replace("USDT", "").toLowerCase();
      out[altKey] = alts[i];
    });
    return out;
  }
}
