import { Collector } from "./base.js";
import { logger } from "../../logs/index.js";

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
const FLOW_WINDOW_DAYS = 7; // jours sommés pour le cumul glissant
const ETF_FLOW_MAX_SHARE = 0.25; // part de l'encours : un flux net journalier au-delà n'est pas plausible

/**
 * Convertit un montant USD en millions de dollars entiers.
 * @param {number} usd Montant en USD.
 * @returns {number|null} Montant en M$ arrondi, ou null si non fini.
 */
function toMillionsUsd(usd) {
  return Number.isFinite(usd) ? Math.round(usd / ONE_MILLION) : null;
}

/**
 * Indique si une ligne journalière SoSoValue est plausible : encours positif
 * connu et flux net du jour inférieur à ETF_FLOW_MAX_SHARE de cet encours.
 * Fonction PURE.
 * @param {{totalNetInflow?: number, totalNetAssets?: number}} row Ligne brute
 *   SoSoValue (montants en USD).
 * @returns {boolean} true si la ligne est exploitable.
 */
export function isPlausibleFlowRow(row) {
  const flowUsd = row?.totalNetInflow;
  const assetsUsd = row?.totalNetAssets;
  if (!Number.isFinite(flowUsd) || !Number.isFinite(assetsUsd)) return false;
  if (assetsUsd <= 0) return false;
  const maxFlowUsd = assetsUsd * ETF_FLOW_MAX_SHARE;
  return Math.abs(flowUsd) <= maxFlowUsd;
}

/**
 * Cumul des flux nets sur une fenêtre de lignes : null si une seule ligne est
 * rejetée (un cumul sur une fenêtre amputée serait biaisé). Fonction PURE.
 * @param {Array<object>} rows Lignes SoSoValue de la fenêtre.
 * @returns {number|null} Somme des flux nets (USD), ou null.
 */
function sumPlausibleFlows(rows) {
  if (!rows.every(isPlausibleFlowRow)) return null;
  return rows.reduce((sum, row) => sum + row.totalNetInflow, 0);
}

/**
 * Normalise l'historique SoSoValue (du plus récent au plus ancien) : une ligne
 * non plausible donne des montants null, sans jamais basculer sur la veille
 * (la date reste celle de la dernière ligne publiée). Fonction PURE.
 * @param {Array<object>} rows Lignes SoSoValue triées du plus récent au plus ancien.
 * @param {number} days Nombre de jours de la mini-série `recent`.
 * @returns {{date: string, dayFlowUsdM: number|null, flow7dUsdM: number|null,
 *   totalAssetsUsdM: number|null, cumFlowUsdM: number|null,
 *   recent: Array<{date: string, netFlowUsdM: number|null}>}} Flux normalisés (M$).
 */
export function summarizeFlows(rows, days) {
  const recent = rows.slice(0, days).map((row) => {
    const netFlowUsdM = isPlausibleFlowRow(row) ? toMillionsUsd(row.totalNetInflow) : null;
    return { date: row.date, netFlowUsdM };
  });
  const lastDay = rows[0];
  const isLastDayPlausible = isPlausibleFlowRow(lastDay);
  const flow7dUsd = sumPlausibleFlows(rows.slice(0, FLOW_WINDOW_DAYS));

  return {
    date: lastDay.date,
    dayFlowUsdM: isLastDayPlausible ? toMillionsUsd(lastDay.totalNetInflow) : null,
    flow7dUsdM: flow7dUsd == null ? null : toMillionsUsd(flow7dUsd),
    totalAssetsUsdM: toMillionsUsd(lastDay.totalNetAssets),
    cumFlowUsdM: isLastDayPlausible ? toMillionsUsd(lastDay.cumNetInflow) : null,
    recent,
  };
}

/**
 * Raison lisible d'un résultat `allSettled` rejeté.
 * @param {PromiseSettledResult} result Résultat de Promise.allSettled.
 * @returns {string} Message d'erreur, "historique vide" si la promesse a abouti
 *   sans donnée, ou "ok".
 */
function describeFailure(result) {
  if (result.status === "rejected") return result.reason?.message ?? String(result.reason);
  if (result.value == null) return "historique vide";
  return "ok";
}

/**
 * Collecteur des flux nets quotidiens des ETF spot US BTC et ETH (SoSoValue).
 */
export class EtfFlowsCollector extends Collector {
  /**
   * Initialise le collecteur et ses options.
   *
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

    const rejected = rows.slice(0, FLOW_WINDOW_DAYS).filter((row) => !isPlausibleFlowRow(row));
    for (const row of rejected) {
      logger.warn(`[etf-flows] ${type} ${row.date} : ligne non plausible ignorée (flux ${row.totalNetInflow}, encours ${row.totalNetAssets})`);
    }
    return summarizeFlows(rows, this.days);
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
    if (!btc && !eth) {
      const btcReason = describeFailure(btcResult);
      const ethReason = describeFailure(ethResult);
      throw new Error(`flux ETF indisponibles — btc : ${btcReason} ; eth : ${ethReason}`);
    }
    return { btc, eth };
  }
}
