import { Collector } from "./base.js";

/**
 * CFTC COT — positionnement institutionnel MULTI-ACTIFS (futures). Sans clé,
 * API Socrata publique, publication hebdomadaire. Axe : positioning.
 *
 * Deux rapports :
 * - TFF (Traders in Financial Futures) : crypto, forex, indices actions.
 *   Catégories : leveraged money (hedge funds, spéculatif) & asset managers
 *   (institutionnels). NET = long − short.
 * - DISAGGREGATED : matières premières (or, pétrole). Catégorie : managed
 *   money (spéculatif). NET = long − short.
 *
 * Le "specNet" (leveraged pour TFF, managed money pour commodités) est le
 * positionnement spéculatif suivi par le marché ; ses EXTRÊMES sont le signal.
 */
export const TFF_URL = "https://publicreporting.cftc.gov/resource/gpe5-46if.json";
export const DIS_URL = "https://publicreporting.cftc.gov/resource/72hh-3qpy.json";

// clé interne -> { name, report }. Source UNIQUE des noms de contrats (la
// CFTC les renomme : centralisé ici, réutilisé par baselines.js).
export const MARKETS = {
  btc: { name: "BITCOIN - CHICAGO MERCANTILE EXCHANGE", report: "tff" },
  eurFx: { name: "EURO FX - CHICAGO MERCANTILE EXCHANGE", report: "tff" },
  jpy: { name: "JAPANESE YEN - CHICAGO MERCANTILE EXCHANGE", report: "tff" },
  gbp: { name: "BRITISH POUND - CHICAGO MERCANTILE EXCHANGE", report: "tff" },
  sp500: { name: "E-MINI S&P 500 - CHICAGO MERCANTILE EXCHANGE", report: "tff" },
  nasdaq: { name: "NASDAQ-100 Consolidated - CHICAGO MERCANTILE EXCHANGE", report: "tff" },
  gold: { name: "GOLD - COMMODITY EXCHANGE INC.", report: "dis" },
  wti: { name: "CRUDE OIL, LIGHT SWEET-WTI - ICE FUTURES EUROPE", report: "dis" },
};

/**
 * Convertit une valeur Socrata en nombre, null si vide.
 * @param {*} value Valeur brute (chaîne ou null).
 * @returns {number|null} Nombre ou null.
 */
function toNumber(value) {
  return value != null && value !== "" ? Number(value) : null;
}

/**
 * Position nette = long − short, null si l'un des deux manque.
 * @param {number|null} long Positions longues.
 * @param {number|null} short Positions courtes.
 * @returns {number|null} Net ou null.
 */
function netPosition(long, short) {
  return long != null && short != null ? long - short : null;
}

export class CftcCotCollector extends Collector {
  constructor() {
    super("cftc-cot", { axis: "positioning" });
  }

  /**
   * Dernière ligne publiée d'un contrat dans un rapport Socrata.
   * @param {string} url URL du dataset (TFF_URL ou DIS_URL).
   * @param {string} name Nom exact du contrat CFTC.
   * @returns {Promise<object|null>} Ligne brute Socrata, ou null.
   */
  async #latestRow(url, name) {
    const where = encodeURIComponent(`market_and_exchange_names = '${name}'`);
    const order = encodeURIComponent("report_date_as_yyyy_mm_dd DESC");
    const rows = await this.getJson(`${url}?$where=${where}&$order=${order}&$limit=1`);
    return Array.isArray(rows) ? rows[0] : null;
  }

  /**
   * Normalise une ligne COT : date, open interest et positions nettes.
   * @param {object|null} row Ligne brute Socrata.
   * @param {string} report "tff" ou "dis".
   * @returns {{date: string|null, openInterest: number|null,
   *   specNet: number|null, assetMgrNet: number|null}|null} Positionnement
   *   normalisé, ou null si la ligne est absente.
   */
  #parse(row, report) {
    if (!row) return null;

    const date = typeof row.report_date_as_yyyy_mm_dd === "string" ? row.report_date_as_yyyy_mm_dd.slice(0, 10) : null;
    const openInterest = toNumber(row.open_interest_all);

    if (report === "tff") {
      const leveragedNet = netPosition(toNumber(row.lev_money_positions_long), toNumber(row.lev_money_positions_short));
      const assetMgrNet = netPosition(toNumber(row.asset_mgr_positions_long), toNumber(row.asset_mgr_positions_short));
      return { date, openInterest, specNet: leveragedNet, assetMgrNet };
    }

    const managedMoneyNet = netPosition(
      toNumber(row.m_money_positions_long_all),
      toNumber(row.m_money_positions_short_all),
    );
    return { date, openInterest, specNet: managedMoneyNet, assetMgrNet: null };
  }

  /**
   * Positionnement de tous les marchés suivis, tolérant par marché.
   * @returns {Promise<object>} Détail BTC à plat (rétro-compat) + `markets`
   *   (une entrée normalisée par clé de MARKETS, null si échec).
   * @throws {Error} Si AUCUN marché n'a pu être récupéré.
   */
  async fetchData() {
    const keys = Object.keys(MARKETS);
    const settled = await Promise.allSettled(
      keys.map((key) => {
        const market = MARKETS[key];
        return this.#latestRow(market.report === "tff" ? TFF_URL : DIS_URL, market.name);
      }),
    );

    const markets = {};
    keys.forEach((key, i) => {
      const row = settled[i].status === "fulfilled" ? settled[i].value : null;
      markets[key] = this.#parse(row, MARKETS[key].report);
    });

    if (Object.values(markets).every((market) => market == null)) {
      throw new Error("COT : aucun marché récupéré");
    }

    const btcRow = settled[0].status === "fulfilled" ? settled[0].value : null;
    const btc = {
      date: markets.btc?.date ?? null,
      openInterest: markets.btc?.openInterest ?? null,
      hedgeFundsLong: btcRow ? toNumber(btcRow.lev_money_positions_long) : null,
      hedgeFundsShort: btcRow ? toNumber(btcRow.lev_money_positions_short) : null,
      hedgeFundsNet: markets.btc?.specNet ?? null,
      assetMgrLong: btcRow ? toNumber(btcRow.asset_mgr_positions_long) : null,
      assetMgrShort: btcRow ? toNumber(btcRow.asset_mgr_positions_short) : null,
      assetMgrNet: markets.btc?.assetMgrNet ?? null,
    };

    return { ...btc, markets };
  }
}
