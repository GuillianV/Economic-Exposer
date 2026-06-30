import { Collector } from "./base.js";

/**
 * CFTC COT — positionnement institutionnel MULTI-ACTIFS (futures). Sans clé,
 * API Socrata publique, publié hebdomadairement. Axe : positioning.
 *
 * Deux rapports :
 *  - TFF (Traders in Financial Futures, dataset gpe5-46if) : crypto, forex,
 *    indices actions. Catégories : leveraged money (hedge funds, spéculatif) &
 *    asset managers (institutionnels). NET = long − short.
 *  - DISAGGREGATED (dataset 72hh-3qpy) : matières premières (or, pétrole).
 *    Catégorie : managed money (spéculatif). NET = long − short.
 *
 * Le "specNet" (leveraged pour TFF, managed money pour commodités) est le
 * positionnement spéculatif suivi par le marché ; ses EXTRÊMES sont le signal.
 * ⚠️ La CFTC renomme parfois les contrats : les noms ci-dessous sont les
 * contrats actifs (données 2026 vérifiées).
 */
export const TFF_URL = "https://publicreporting.cftc.gov/resource/gpe5-46if.json";
export const DIS_URL = "https://publicreporting.cftc.gov/resource/72hh-3qpy.json";

// clé interne -> { name, report }. Source UNIQUE des noms de contrats (la CFTC
// les renomme : centralisé ici, réutilisé par baselines.js).
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

const n = (v) => (v != null && v !== "" ? Number(v) : null);
const net = (a, b) => (a != null && b != null ? a - b : null);

export class CftcCotCollector extends Collector {
  constructor() {
    super("cftc-cot", { axis: "positioning" });
  }

  async #latestRow(url, name) {
    const where = encodeURIComponent(`market_and_exchange_names = '${name}'`);
    const order = encodeURIComponent("report_date_as_yyyy_mm_dd DESC");
    const arr = await this.getJson(`${url}?$where=${where}&$order=${order}&$limit=1`);
    return Array.isArray(arr) ? arr[0] : null;
  }

  #parse(r, report) {
    if (!r) return null;
    const date = typeof r.report_date_as_yyyy_mm_dd === "string" ? r.report_date_as_yyyy_mm_dd.slice(0, 10) : null;
    const openInterest = n(r.open_interest_all);
    if (report === "tff") {
      const levNet = net(n(r.lev_money_positions_long), n(r.lev_money_positions_short));
      const amNet = net(n(r.asset_mgr_positions_long), n(r.asset_mgr_positions_short));
      return { date, openInterest, specNet: levNet, assetMgrNet: amNet };
    }
    // disaggregated : managed money
    const mmNet = net(n(r.m_money_positions_long_all), n(r.m_money_positions_short_all));
    return { date, openInterest, specNet: mmNet, assetMgrNet: null };
  }

  async fetchData() {
    const keys = Object.keys(MARKETS);
    const settled = await Promise.allSettled(
      keys.map((k) => {
        const m = MARKETS[k];
        return this.#latestRow(m.report === "tff" ? TFF_URL : DIS_URL, m.name);
      }),
    );

    const markets = {};
    keys.forEach((k, i) => {
      const row = settled[i].status === "fulfilled" ? settled[i].value : null;
      markets[k] = this.#parse(row, MARKETS[k].report);
    });

    if (Object.values(markets).every((v) => v == null)) throw new Error("COT : aucun marché récupéré");

    // Détail BTC à plat (rétro-compat avec l'existant).
    const btcRow = settled[0].status === "fulfilled" ? settled[0].value : null;
    const btc = {
      date: markets.btc?.date ?? null,
      openInterest: markets.btc?.openInterest ?? null,
      hedgeFundsLong: btcRow ? n(btcRow.lev_money_positions_long) : null,
      hedgeFundsShort: btcRow ? n(btcRow.lev_money_positions_short) : null,
      hedgeFundsNet: markets.btc?.specNet ?? null,
      assetMgrLong: btcRow ? n(btcRow.asset_mgr_positions_long) : null,
      assetMgrShort: btcRow ? n(btcRow.asset_mgr_positions_short) : null,
      assetMgrNet: markets.btc?.assetMgrNet ?? null,
    };

    return { ...btc, markets };
  }
}
