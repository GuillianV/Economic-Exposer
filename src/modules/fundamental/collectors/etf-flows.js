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
 * Donnée en J-1 (clôture US) ; le week-end ne produit pas de flux.
 */
const FLOWS_URL = "https://api.sosovalue.xyz/openapi/v2/etf/historicalInflowChart";
const FLOWS_TIMEOUT_MS = 20000;
const ONE_MILLION = 1e6;

/**
 * Convertit un montant USD en millions de dollars entiers.
 * @param {number} usd Montant en USD.
 * @returns {number|null} Montant en M$ arrondi, ou null si non fini.
 */
function toMillionsUsd(usd) {
  return Number.isFinite(usd) ? Math.round(usd / ONE_MILLION) : null;
}

export class EtfFlowsCollector extends Collector {
  /**
   * @param {{ days?: number }} [options] Nombre de jours conservés dans la
   *   mini-série `recent` du snapshot.
   */
  constructor({ days = 8 } = {}) {
    super("etf-flows", { axis: "structure" });
    this.days = days;
  }

  /**
   * Historique de flux d'un type d'ETF (POST JSON, hors helpers de base.js).
   * @param {string} type "us-btc-spot" ou "us-eth-spot".
   * @returns {Promise<{date: string, dayFlowUsdM: number|null,
   *   flow7dUsdM: number|null, totalAssetsUsdM: number|null,
   *   cumFlowUsdM: number|null, recent: Array<object>}|null>} Flux du dernier
   *   jour, cumul 7 j, encours, cumul depuis lancement (M$) et mini-série,
   *   ou null si l'historique est vide.
   * @throws {Error} Statut HTTP non-2xx ou timeout.
   */
  async #flows(type) {
    const res = await fetch(FLOWS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
      body: JSON.stringify({ type }),
      signal: AbortSignal.timeout(FLOWS_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`SoSoValue HTTP ${res.status} (${type})`);

    const json = await res.json();
    const rows = Array.isArray(json?.data) ? json.data : []; // triés du plus récent au plus ancien
    if (!rows.length) return null;

    const recent = rows.slice(0, this.days).map((row) => ({
      date: row.date,
      netFlowUsdM: toMillionsUsd(row.totalNetInflow),
    }));
    const lastDay = rows[0];
    const flow7dUsd = rows.slice(0, 7).reduce((sum, row) => sum + (row.totalNetInflow || 0), 0);

    return {
      date: lastDay.date,
      dayFlowUsdM: toMillionsUsd(lastDay.totalNetInflow),
      flow7dUsdM: toMillionsUsd(flow7dUsd),
      totalAssetsUsdM: toMillionsUsd(lastDay.totalNetAssets),
      cumFlowUsdM: toMillionsUsd(lastDay.cumNetInflow),
      recent,
    };
  }

  /**
   * Flux BTC + ETH en parallèle, tolérant à l'échec de l'un des deux.
   * @returns {Promise<{btc: object|null, eth: object|null}>} Flux par actif.
   * @throws {Error} Si BTC ET ETH ont échoué.
   */
  async fetchData() {
    const [btcResult, ethResult] = await Promise.allSettled([
      this.#flows("us-btc-spot"),
      this.#flows("us-eth-spot"),
    ]);
    const btc = btcResult.status === "fulfilled" ? btcResult.value : null;
    const eth = ethResult.status === "fulfilled" ? ethResult.value : null;
    if (!btc && !eth) throw new Error("flux ETF indisponibles (BTC + ETH échoués)");
    return { btc, eth };
  }
}
