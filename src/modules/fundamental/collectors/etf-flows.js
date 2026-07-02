import { Collector } from "./base.js";

/**
 * Flux des ETF spot US (Bitcoin + Ethereum) via SoSoValue (openapi, sans clé).
 * Axe : structure.
 *
 * Depuis 2024, les ETF spot sont l'ACHETEUR MARGINAL dominant du BTC : les
 * créations/rachats quotidiens (net inflow) sont LE fondamental demande-side
 * moderne. Entrées soutenues = demande institutionnelle réelle ; sorties
 * massives = distribution — souvent plus lourd que le sentiment.
 *
 * NB : donnée en J-1 (clôture US) ; le week-end ne produit pas de flux.
 */
const URL = "https://api.sosovalue.xyz/openapi/v2/etf/historicalInflowChart";

const M = 1e6;
const rM = (v) => (Number.isFinite(v) ? Math.round(v / M) : null); // USD -> M$ entiers

export class EtfFlowsCollector extends Collector {
  constructor({ days = 8 } = {}) {
    super("etf-flows", { axis: "structure" });
    this.days = days; // fenêtre conservée dans le snapshot (dernier jours)
  }

  async #flows(type) {
    const res = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
      body: JSON.stringify({ type }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`SoSoValue HTTP ${res.status} (${type})`);
    const json = await res.json();
    const rows = Array.isArray(json?.data) ? json.data : [];
    if (!rows.length) return null;

    // rows triés du plus récent au plus ancien.
    const recent = rows.slice(0, this.days).map((r) => ({
      date: r.date,
      netFlowUsdM: rM(r.totalNetInflow),
    }));
    const last = rows[0];
    const flow7d = rows.slice(0, 7).reduce((s, r) => s + (r.totalNetInflow || 0), 0);

    return {
      date: last.date,
      dayFlowUsdM: rM(last.totalNetInflow), // flux net du dernier jour (M$)
      flow7dUsdM: rM(flow7d), // flux net cumulé 7 jours (M$)
      totalAssetsUsdM: rM(last.totalNetAssets), // encours total (M$)
      cumFlowUsdM: rM(last.cumNetInflow), // flux cumulés depuis lancement (M$)
      recent, // mini-série pour lecture de tendance
    };
  }

  async fetchData() {
    const [btc, eth] = await Promise.allSettled([this.#flows("us-btc-spot"), this.#flows("us-eth-spot")]);
    const b = btc.status === "fulfilled" ? btc.value : null;
    const e = eth.status === "fulfilled" ? eth.value : null;
    if (!b && !e) throw new Error("flux ETF indisponibles (BTC + ETH échoués)");
    return { btc: b, eth: e };
  }
}
