import { Collector } from "./base.js";

/**
 * mempool.space — activité & congestion du réseau Bitcoin.
 * Sans clé, gratuit. Axe : onchain.
 *
 * Donne les frais recommandés (sat/vB) et l'état du mempool (nb de tx en attente,
 * taille virtuelle). Des frais/congestion qui montent = demande réelle de
 * blockspace (activité on-chain), un signal de fond que les prix seuls ne disent pas.
 */
const API = "https://mempool.space/api";
const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);

export class MempoolCollector extends Collector {
  constructor() {
    super("mempool", { axis: "onchain" });
  }

  async fetchData() {
    const [fees, mp] = await Promise.all([
      this.getJson(`${API}/v1/fees/recommended`),
      this.getJson(`${API}/mempool`),
    ]);
    return {
      feeFast: num(fees?.fastestFee), // sat/vB pour confirmation rapide
      feeHour: num(fees?.hourFee), // sat/vB pour ~1h
      mempoolCount: num(mp?.count), // transactions en attente
      mempoolVsize: num(mp?.vsize), // taille virtuelle (vbytes)
    };
  }
}
