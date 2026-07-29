import { Collector } from "./base.js";

/**
 * VALORISATION on-chain du Bitcoin, basée sur la REALIZED CAP (coût de base
 * agrégé des pièces), là où cycle.js ne regarde que le prix et ses moyennes.
 * Lectures classiques (famille BitcoinMagazinePro / Glassnode) :
 *   - MVRV        : cap marché / cap réalisée — sur/sous-évaluation vs coût de base.
 *   - NUPL        : profit/perte latent net = 1 - 1/MVRV (reformulation de MVRV).
 *   - Prix réalisé: prix / MVRV — coût de base moyen du réseau (support/résistance).
 *   - Puell       : émission du jour (USD) / moyenne 365 j — cycle du revenu mineur.
 *
 * Source : API community CoinMetrics (gratuite, sans clé) — MVRV et IssTotUSD y
 * sont ouverts (la realized cap brute et NVT, eux, sont réservés au tier payant,
 * d'où les dérivations depuis MVRV). Historique 365 j tiré de la SOURCE (comme
 * baselines.js/cycle.js), pas de nos snapshots. Axe : onchain.
 */
const CM_URL = "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics";
const ASSET = "btc";
const METRICS = "CapMVRVCur,PriceUSD,IssTotUSD,CapMrktCurUSD";
const PUELL_WINDOW_DAYS = 365; // moyenne mobile de l'émission pour le Puell Multiple
const HISTORY_START = "2013-01-01"; // historique complet : l'écart-type du MVRV-Z se juge sur tous les cycles
const PAGE_SIZE = 10000; // couvre tout l'historique quotidien en une page (pas de pagination)
const FETCH_TIMEOUT_MS = 20000;
const CACHE_TTL_MS = 12 * 3600000; // donnée quotidienne : 2 rafraîchissements/jour suffisent

// Bornes de classe du MVRV (cap marché / cap réalisée). <1 = sous le coût de base
// (capitulation historique), >3,2 = zones de sommet.
const MVRV_BANDS = { sousEvalueHaut: 1.0, neutreHaut: 2.0, eleveHaut: 3.2 }; // multiples
// Bornes du MVRV Z-Score (écart cap marché - cap réalisée, normalisé par l'écart-
// type de la cap marché sur tout l'historique). <0,1 = creux de cycle, >7 = sommet.
const MVRVZ_BANDS = { creuxHaut: 0.1, sousEvalueHaut: 1.0, neutreHaut: 4.0, eleveHaut: 7.0 }; // z-score
// Bornes de NUPL (profit latent net, 0-1 hors capitulation).
const NUPL_BANDS = { capitulationHaut: 0.0, peurHaut: 0.25, optimismeHaut: 0.5, croyanceHaut: 0.75 }; // ratio
// Bornes du Puell Multiple (émission jour / MM365). <0,5 = revenu mineur déprimé
// (accumulation), >4 = zones de sommet.
const PUELL_BANDS = { basHaut: 0.5, neutreHaut: 2.0, eleveHaut: 4.0 }; // multiples

// Bornes de normalisation vers 0-100 (bon marché -> cher).
const MVRV_NORM = { lo: 0.8, hi: 3.7 };
const PUELL_NORM = { lo: 0.3, hi: 4.0 };
// Poids de la position combinée (somme = 1). NUPL exclu du mélange : dérivé de
// MVRV (1 - 1/MVRV), l'inclure double-compterait le même signal.
const BLEND = { mvrv: 0.6, puell: 0.4 };

// Bornes de la position combinée 0-100 vers un libellé lisible.
const POSITION_BANDS = { bonMarcheHaut: 25, basHaut: 45, milieuHaut: 65, cherHaut: 85 };
const PCT_MAX = 100;

/**
 * Convertit en nombre fini, null sinon (CoinMetrics renvoie les valeurs en chaîne).
 * @param {*} value Valeur brute.
 * @returns {number|null} Nombre fini ou null.
 */
function toFiniteNumber(value) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Moyenne des `n` dernières valeurs finies d'une série.
 * @param {Array<number>} series Série chronologique (ancien -> récent).
 * @param {number} n Taille de la fenêtre.
 * @returns {number|null} Moyenne, ou null si la série est vide.
 */
function trailingMean(series, n) {
  if (!Array.isArray(series) || series.length === 0) return null;
  const window = series.slice(Math.max(0, series.length - n));
  const sum = window.reduce((acc, value) => acc + value, 0);
  return sum / window.length;
}

/**
 * Écart-type de population d'une série.
 * @param {Array<number>} series Série de valeurs.
 * @returns {number|null} Écart-type, ou null si la série est vide.
 */
function standardDeviation(series) {
  if (!Array.isArray(series) || series.length === 0) return null;
  const mean = series.reduce((acc, value) => acc + value, 0) / series.length;
  const variance = series.reduce((acc, value) => acc + (value - mean) ** 2, 0) / series.length;
  return Math.sqrt(variance);
}

/**
 * Normalise une valeur vers 0-100 entre deux bornes (clampée).
 * @param {number} value Valeur à normaliser.
 * @param {number} lo Borne basse (-> 0).
 * @param {number} hi Borne haute (-> 100).
 * @returns {number} Position 0-100.
 */
function normalizeToPercent(value, lo, hi) {
  const ratio = (value - lo) / (hi - lo);
  const clamped = Math.min(Math.max(ratio, 0), 1);
  return clamped * PCT_MAX;
}

/**
 * Classe une valeur selon des bornes montantes.
 * @param {number} value Valeur à classer.
 * @param {Array<Array>} paliers Couples [borne haute croissante, libellé].
 * @param {string} dernier Libellé au-dessus de la dernière borne.
 * @returns {string} Libellé du palier.
 */
function classify(value, paliers, dernier) {
  for (const [borne, libelle] of paliers) {
    if (value < borne) return libelle;
  }
  return dernier;
}

/**
 * Calcule les indicateurs de valorisation on-chain depuis les lignes CoinMetrics.
 * Fonction PURE (aucune I/O) — testable isolément.
 * @param {Array<object>} rows Lignes quotidiennes (ancien -> récent), champs
 *   `CapMVRVCur`, `PriceUSD`, `IssTotUSD`, `CapMrktCurUSD` en chaîne.
 * @returns {{btcPrice: number|null, mvrv: object, mvrvZ: object, nupl: object,
 *   realizedPrice: number|null, puell: object, position: number|null,
 *   positionLabel: string|null}} Indicateurs + position combinée 0-100.
 */
export function computeOnChainValuation(rows) {
  const mvrvRows = rows.filter((r) => toFiniteNumber(r.CapMVRVCur) != null);
  const latest = mvrvRows.length ? mvrvRows[mvrvRows.length - 1] : null;

  const mvrvValue = latest ? toFiniteNumber(latest.CapMVRVCur) : null;
  const btcPrice = latest ? toFiniteNumber(latest.PriceUSD) : null;
  const nuplValue = mvrvValue && mvrvValue > 0 ? 1 - 1 / mvrvValue : null;
  const realizedPrice = btcPrice != null && mvrvValue ? btcPrice / mvrvValue : null;

  // MVRV Z-Score : (cap marché - cap réalisée) / écart-type de la cap marché sur
  // tout l'historique. La cap réalisée se dérive de MVRV (cap marché / MVRV), la
  // cap réalisée brute étant réservée au tier payant de CoinMetrics.
  const marketCaps = mvrvRows.map((r) => toFiniteNumber(r.CapMrktCurUSD)).filter((v) => v != null);
  const marketCapNow = latest ? toFiniteNumber(latest.CapMrktCurUSD) : null;
  const realizedCapNow = marketCapNow != null && mvrvValue ? marketCapNow / mvrvValue : null;
  const stdMarketCap = standardDeviation(marketCaps);
  const mvrvZValue = marketCapNow != null && realizedCapNow != null && stdMarketCap
    ? (marketCapNow - realizedCapNow) / stdMarketCap
    : null;

  const issuances = rows.map((r) => toFiniteNumber(r.IssTotUSD)).filter((v) => v != null);
  const issToday = issuances.length ? issuances[issuances.length - 1] : null;
  const issMean = trailingMean(issuances, PUELL_WINDOW_DAYS);
  const puellValue = issToday != null && issMean ? issToday / issMean : null;

  const mvrv = {
    valeur: mvrvValue,
    statut: mvrvValue == null
      ? "indisponible"
      : classify(mvrvValue, [[MVRV_BANDS.sousEvalueHaut, "sous-évalué"], [MVRV_BANDS.neutreHaut, "neutre"], [MVRV_BANDS.eleveHaut, "élevé"]], "sommet"),
  };
  const mvrvZ = {
    valeur: mvrvZValue,
    statut: mvrvZValue == null
      ? "indisponible"
      : classify(mvrvZValue, [[MVRVZ_BANDS.creuxHaut, "creux de cycle"], [MVRVZ_BANDS.sousEvalueHaut, "sous-évalué"], [MVRVZ_BANDS.neutreHaut, "neutre"], [MVRVZ_BANDS.eleveHaut, "élevé"]], "sommet"),
  };
  const nupl = {
    valeur: nuplValue,
    statut: nuplValue == null
      ? "indisponible"
      : classify(nuplValue, [[NUPL_BANDS.capitulationHaut, "capitulation"], [NUPL_BANDS.peurHaut, "peur"], [NUPL_BANDS.optimismeHaut, "optimisme"], [NUPL_BANDS.croyanceHaut, "croyance"]], "euphorie"),
  };
  const puell = {
    valeur: puellValue,
    statut: puellValue == null
      ? "indisponible"
      : classify(puellValue, [[PUELL_BANDS.basHaut, "bas"], [PUELL_BANDS.neutreHaut, "neutre"], [PUELL_BANDS.eleveHaut, "élevé"]], "sommet"),
  };

  const parts = [];
  if (mvrvValue != null) parts.push([BLEND.mvrv, normalizeToPercent(mvrvValue, MVRV_NORM.lo, MVRV_NORM.hi)]);
  if (puellValue != null) parts.push([BLEND.puell, normalizeToPercent(puellValue, PUELL_NORM.lo, PUELL_NORM.hi)]);

  let position = null;
  let positionLabel = null;
  if (parts.length) {
    const poidsTotal = parts.reduce((acc, [poids]) => acc + poids, 0);
    const somme = parts.reduce((acc, [poids, valeur]) => acc + poids * valeur, 0);
    position = Math.round(somme / poidsTotal);
    positionLabel = classify(
      position,
      [[POSITION_BANDS.bonMarcheHaut, "bon marché"], [POSITION_BANDS.basHaut, "bas de cycle"], [POSITION_BANDS.milieuHaut, "milieu de cycle"], [POSITION_BANDS.cherHaut, "cher"]],
      "surchauffe",
    );
  }

  return { btcPrice, mvrv, mvrvZ, nupl, realizedPrice, puell, position, positionLabel };
}

/**
 *
 */
export class OnChainValuationCollector extends Collector {
  /**
   * Initialise le collecteur et son cache mémoire.
   *
   */
  constructor() {
    super("valuation", { axis: "onchain" });
    this.cache = null; // { ts: number, data: object } — dernier calcul valide
  }

  /**
   * Valorisation on-chain (MVRV / MVRV-Z / NUPL / prix réalisé / Puell). Sert le
   * cache si récent (< CACHE_TTL_MS), sinon recalcule depuis CoinMetrics.
   * @returns {Promise<{btcPrice: number|null, mvrv: object, mvrvZ: object,
   *   nupl: object, realizedPrice: number|null, puell: object,
   *   position: number|null, positionLabel: string|null}>} Indicateurs de valorisation.
   * @throws {Error} Si CoinMetrics ne renvoie aucune ligne exploitable.
   */
  async fetchData() {
    if (this.cache && Date.now() - this.cache.ts < CACHE_TTL_MS) return this.cache.data;

    const url = `${CM_URL}?assets=${ASSET}&metrics=${METRICS}&frequency=1d&start_time=${HISTORY_START}&page_size=${PAGE_SIZE}`;
    const json = await this.getJson(url, { timeout: FETCH_TIMEOUT_MS });
    const rows = Array.isArray(json?.data) ? json.data : [];
    if (rows.length === 0) throw new Error("aucune donnée CoinMetrics (valorisation on-chain)");

    const data = computeOnChainValuation(rows);
    this.cache = { ts: Date.now(), data };
    return data;
  }
}
