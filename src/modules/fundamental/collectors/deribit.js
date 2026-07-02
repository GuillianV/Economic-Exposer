import { Collector } from "./base.js";

/**
 * Deribit — sentiment & POSITIONNEMENT options crypto (BTC + ETH). Sans clé,
 * API publique gratuite. Axe : sentiment.
 *
 *  - DVOL : indice de volatilité implicite ("VIX crypto"). ↑ = peur.
 *  - Put/Call ratio (open interest) : positionnement options. ↑ = couverture/peur.
 *  - Skew (risk reversal, proxy moneyness ±10 %) : IV(put OTM) − IV(call OTM) sur
 *    l'échéance ~30 j. > 0 = puts chers = peur crash (souvent près d'un creux,
 *    lecture CONTRARIAN) ; < 0 = calls chers = euphorie. C'est le meilleur tell
 *    de RETOURNEMENT côté options.
 *
 * ETH donne un signal INDÉPENDANT : une divergence de skew BTC vs ETH (peur
 * concentrée sur l'un) est en soi informative.
 */
const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
const round = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

/** "BTC-31JUL26-81000-C" -> { expiryMs, strike, type }. */
function parseInstrument(name) {
  const p = name.split("-");
  if (p.length < 4) return null;
  const m = p[1].match(/^(\d{1,2})([A-Z]{3})(\d{2})$/);
  if (!m || MONTHS[m[2]] == null) return null;
  const expiryMs = Date.UTC(2000 + Number(m[3]), MONTHS[m[2]], Number(m[1]), 8, 0, 0); // expiry Deribit 08:00 UTC
  const strike = Number(p[2]);
  const type = p[3]; // "C" | "P"
  return Number.isFinite(strike) ? { expiryMs, strike, type } : null;
}

export class DeribitCollector extends Collector {
  constructor() {
    super("deribit", { axis: "sentiment" });
  }

  async #dvol(currency) {
    const now = Date.now();
    const start = now - 6 * 3600 * 1000;
    const url =
      `https://www.deribit.com/api/v2/public/get_volatility_index_data` +
      `?currency=${currency}&start_timestamp=${start}&end_timestamp=${now}&resolution=3600`;
    const json = await this.getJson(url);
    const data = json?.result?.data || [];
    if (!data.length) return null;
    const last = data[data.length - 1]; // [ts, open, high, low, close]
    return { dvol: last[4], ts: last[0] };
  }

  /** Put/Call (OI & volume) + skew sur l'échéance ~30 j. */
  async #options(currency) {
    const url = `https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${currency}&kind=option`;
    const json = await this.getJson(url, { timeout: 15000 });
    const rows = json?.result || [];
    if (!rows.length) return null;

    const underlying = rows.find((x) => x.underlying_price)?.underlying_price ?? null;
    let oiPut = 0;
    let oiCall = 0;
    let volPut = 0;
    let volCall = 0;
    const byExpiry = new Map();

    for (const x of rows) {
      const inst = parseInstrument(x.instrument_name);
      if (!inst) continue;
      const oi = x.open_interest || 0;
      const vol = x.volume || 0;
      if (inst.type === "P") {
        oiPut += oi;
        volPut += vol;
      } else {
        oiCall += oi;
        volCall += vol;
      }
      if (!byExpiry.has(inst.expiryMs)) byExpiry.set(inst.expiryMs, []);
      byExpiry.get(inst.expiryMs).push({ ...inst, iv: x.mark_iv });
    }

    // Skew : échéance la plus proche de 30 j (au moins 3 j pour éviter le bruit
    // de l'expiration imminente), IV du put ~−10 % vs call ~+10 % de moneyness.
    const now = Date.now();
    const target = now + 30 * 86400000;
    let bestExp = null;
    let bestDist = Infinity;
    for (const t of byExpiry.keys()) {
      if (t <= now + 3 * 86400000) continue;
      const d = Math.abs(t - target);
      if (d < bestDist) {
        bestDist = d;
        bestExp = t;
      }
    }

    let skew = null;
    let expiryDays = null;
    if (bestExp != null && underlying) {
      expiryDays = Math.round((bestExp - now) / 86400000);
      const chain = byExpiry.get(bestExp);
      const nearest = (type, targetStrike) => {
        let best = null;
        let bd = Infinity;
        for (const c of chain) {
          if (c.type !== type || !(c.iv > 0)) continue;
          const d = Math.abs(c.strike - targetStrike);
          if (d < bd) {
            bd = d;
            best = c;
          }
        }
        return best;
      };
      const put = nearest("P", underlying * 0.9);
      const call = nearest("C", underlying * 1.1);
      if (put && call) skew = round(put.iv - call.iv);
    }

    return {
      putCallOI: oiCall > 0 ? round(oiPut / oiCall) : null,
      putCallVol: volCall > 0 ? round(volPut / volCall) : null,
      skew,
      expiryDays,
    };
  }

  async #pack(currency) {
    const [d, o] = await Promise.allSettled([this.#dvol(currency), this.#options(currency)]);
    const dvol = d.status === "fulfilled" ? d.value : null;
    const opt = o.status === "fulfilled" ? o.value : null;
    if (!dvol && !opt) return null;
    return { dvol: dvol?.dvol ?? null, ts: dvol?.ts ?? null, ...(opt || {}) };
  }

  async fetchData() {
    const [btc, eth] = await Promise.all([this.#pack("BTC"), this.#pack("ETH")]);
    if (!btc && !eth) throw new Error("Deribit vide (DVOL + options BTC/ETH échoués)");
    return {
      dvol: btc?.dvol ?? null, // compat : dvol BTC au niveau racine
      ts: btc?.ts ?? Date.now(),
      btc: btc ?? null,
      eth: eth ?? null,
    };
  }
}
