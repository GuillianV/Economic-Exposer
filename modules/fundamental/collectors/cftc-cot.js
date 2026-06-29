import { Collector } from "./base.js";

/**
 * CFTC COT — positionnement sur les futures Bitcoin (CME), rapport TFF.
 * Sans clé, API Socrata publique. Publié hebdomadairement. Axe : positioning.
 *
 * Catégories clés :
 *  - leveraged money = hedge funds (spéculatif, suit/anticipe la tendance),
 *  - asset managers = institutionnels (positions de fond).
 * Le NET (long − short) de chacun révèle le positionnement réel des gros.
 */
const URL = "https://publicreporting.cftc.gov/resource/gpe5-46if.json";

export class CftcCotCollector extends Collector {
  constructor() {
    super("cftc-cot", { axis: "positioning" });
  }

  async fetchData() {
    const where = encodeURIComponent("market_and_exchange_names like 'BITCOIN - CHICAGO%'");
    const order = encodeURIComponent("report_date_as_yyyy_mm_dd DESC");
    const arr = await this.getJson(`${URL}?$where=${where}&$order=${order}&$limit=1`);
    const r = Array.isArray(arr) ? arr[0] : null;
    if (!r) throw new Error("COT Bitcoin introuvable");

    const n = (v) => (v != null && v !== "" ? Number(v) : null);
    const net = (a, b) => (a != null && b != null ? a - b : null);

    const levLong = n(r.lev_money_positions_long);
    const levShort = n(r.lev_money_positions_short);
    const amLong = n(r.asset_mgr_positions_long);
    const amShort = n(r.asset_mgr_positions_short);

    return {
      date: typeof r.report_date_as_yyyy_mm_dd === "string" ? r.report_date_as_yyyy_mm_dd.slice(0, 10) : null,
      openInterest: n(r.open_interest_all),
      hedgeFundsLong: levLong,
      hedgeFundsShort: levShort,
      hedgeFundsNet: net(levLong, levShort),
      assetMgrLong: amLong,
      assetMgrShort: amShort,
      assetMgrNet: net(amLong, amShort),
    };
  }
}
