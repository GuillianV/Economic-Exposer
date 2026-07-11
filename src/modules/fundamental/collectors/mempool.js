import { Collector } from "./base.js";

/**
 * mempool.space — activité & congestion du réseau Bitcoin.
 * Sans clé, gratuit. Axe : onchain.
 *
 * Des frais/congestion qui montent = demande réelle de blockspace (activité
 * on-chain), un signal de fond que les prix seuls ne disent pas.
 */
const API = "https://mempool.space/api";

/**
 * Convertit en nombre fini, null sinon.
 * @param {*} value Valeur brute de l'API.
 * @returns {number|null} Nombre fini ou null.
 */
function toFiniteNumber(value) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export class MempoolCollector extends Collector {
  constructor() {
    super("mempool", { axis: "onchain" });
  }

  /**
   * Frais recommandés et état du mempool.
   * @returns {Promise<{feeFast: number|null, feeHour: number|null,
   *   mempoolCount: number|null, mempoolVsize: number|null}>} Frais en sat/vB
   *   (confirmation rapide / ~1h), transactions en attente, taille virtuelle
   *   en vbytes.
   */
  async fetchData() {
    const [fees, mempoolState] = await Promise.all([
      this.getJson(`${API}/v1/fees/recommended`),
      this.getJson(`${API}/mempool`),
    ]);
    return {
      feeFast: toFiniteNumber(fees?.fastestFee),
      feeHour: toFiniteNumber(fees?.hourFee),
      mempoolCount: toFiniteNumber(mempoolState?.count),
      mempoolVsize: toFiniteNumber(mempoolState?.vsize),
    };
  }
}
