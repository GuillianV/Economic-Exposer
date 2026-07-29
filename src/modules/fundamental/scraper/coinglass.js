import { capturePayloads } from "./browser.js";

/**
 * Scrape Coinglass via le socle navigateur : distribution des LIQUIDATIONS par
 * niveau de prix (agrégée multi-exchange), telle que rendue sur la page publique
 * LiquidationData. La donnée arrive chiffrée et n'est déchiffrée que par le JS de
 * Coinglass — on la capture en sortie de leur `JSON.parse` (voir browser.js).
 *
 * Signal : les niveaux qui concentrent le plus de volume de liquidation agissent
 * comme des AIMANTS de prix (le marché tend à aller y chasser la liquidité).
 * Parse PUR séparé du scrape (I/O) pour rester testable.
 */
const LIQUIDATION_URL = "https://www.coinglass.com/LiquidationData";
const MATCH_KEYS = ["price", "buyVolUsd", "sellVolUsd"]; // signature d'un bucket de niveau de prix
const TOP_CLUSTERS = 5; // nombre d'aimants (plus gros volumes) retenus
const SETTLE_MS = 6000; // la page décrypte plusieurs XHR : marge confortable

const DERIVATIVES_URL = "https://www.coinglass.com/BitcoinOpenInterest";
const DERIVATIVES_MATCH_KEYS = ["avgFundingRateByOi", "h12LiquidationUsd", "symbol"]; // signature du résumé par coin
const TARGET_SYMBOL = "BTC"; // seul BTC nous intéresse dans les résumés multi-coins

const WHALES_URL = "https://www.coinglass.com/hyperliquid";
const WHALES_MATCH_KEYS = ["longUserPercent", "shortUserPercent", "symbol"]; // positionnement whale agrégé par coin

/**
 * Convertit en nombre fini, 0 sinon (les volumes manquants comptent pour zéro).
 * @param {*} value Valeur brute.
 * @returns {number} Nombre fini, ou 0.
 */
function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Transforme les buckets bruts (niveaux de prix) en vue exploitable : niveaux
 * triés par prix + aimants (clusters de plus gros volume). Fonction PURE.
 * @param {Array<object>} rows Buckets bruts ({ price, buyVolUsd, sellVolUsd,
 *   createTime, … }).
 * @returns {{asOf: string|null, levels: Array<{price: number, buyVolUsd: number,
 *   sellVolUsd: number, totalVolUsd: number}>, clusters: Array<{price: number,
 *   totalVolUsd: number}>, totalBuyUsd: number, totalSellUsd: number}}
 *   Vue liquidations (niveaux + aimants + totaux).
 */
export function computeLiquidationLevels(rows) {
  const levels = rows
    .map((row) => {
      const price = toNumber(row.price);
      const buyVolUsd = toNumber(row.buyVolUsd);
      const sellVolUsd = toNumber(row.sellVolUsd);
      return { price, buyVolUsd, sellVolUsd, totalVolUsd: buyVolUsd + sellVolUsd };
    })
    .filter((level) => level.price > 0)
    .sort((a, b) => a.price - b.price);

  const clusters = [...levels]
    .sort((a, b) => b.totalVolUsd - a.totalVolUsd)
    .slice(0, TOP_CLUSTERS)
    .map(({ price, totalVolUsd }) => ({ price, totalVolUsd }));

  const totalBuyUsd = levels.reduce((acc, level) => acc + level.buyVolUsd, 0);
  const totalSellUsd = levels.reduce((acc, level) => acc + level.sellVolUsd, 0);

  const times = rows.map((row) => toNumber(row.createTime)).filter((t) => t > 0);
  const asOf = times.length ? new Date(Math.max(...times)).toISOString() : null;

  return { asOf, levels, clusters, totalBuyUsd, totalSellUsd };
}

/**
 * Scrape la distribution des liquidations par niveau de prix depuis Coinglass.
 * Retient le plus grand tableau capturé (jeu complet de buckets ; la page
 * re-parse parfois la même donnée).
 * @returns {Promise<{asOf: string|null, levels: Array<object>,
 *   clusters: Array<object>, totalBuyUsd: number, totalSellUsd: number}>}
 *   Vue liquidations.
 * @throws {Error} Si aucun payload de niveaux n'a pu être capturé.
 */
export async function scrapeLiquidationLevels() {
  const payloads = await capturePayloads(LIQUIDATION_URL, { matchKeys: MATCH_KEYS, settleMs: SETTLE_MS });
  const arrays = payloads.filter((p) => Array.isArray(p) && p.length > 0);
  if (arrays.length === 0) throw new Error("liquidations Coinglass : aucun niveau capturé");

  const largest = arrays.reduce((best, current) => (current.length > best.length ? current : best));
  return computeLiquidationLevels(largest);
}

/**
 * Cure le résumé dérivés BTC de Coinglass en une vue exploitable (clés FR).
 * Fonction PURE. Le funding est en % (par intervalle de financement), les LS
 * ratios sont des rapports (>1 = plus de longs), les liquidations en USD sur 24h.
 * @param {object} s Résumé brut Coinglass pour BTC.
 * @returns {{prix: number, variation24hPct: number, openInterestUsd: number,
 *   openInterestBtc: number, oiVariation24hPct: number, oiVariation7jPct: number,
 *   fundingPct: number, longShortRatio: number, longShortTopTraders: number,
 *   longShortRetail: number, liquidations24h: {totalUsd: number, longUsd: number,
 *   shortUsd: number}, volume24hUsd: number, oiSurMcap: number, oiSurVol: number}}
 *   Vue dérivés BTC.
 */
export function parseDerivatives(s) {
  return {
    prix: toNumber(s.price),
    variation24hPct: toNumber(s.h24PriceChangePercent),
    openInterestUsd: toNumber(s.openInterest),
    openInterestBtc: toNumber(s.openInterestAmount),
    oiVariation24hPct: toNumber(s.h24OiChangePercent),
    oiVariation7jPct: toNumber(s.oiChangePercent7d),
    fundingPct: toNumber(s.avgFundingRateByOi),
    longShortRatio: toNumber(s.h24Ls),
    longShortTopTraders: toNumber(s.binanceTopAccountLsRadio),
    longShortRetail: toNumber(s.binanceAccountLsRadio),
    liquidations24h: {
      totalUsd: toNumber(s.h24LiquidationUsd),
      longUsd: toNumber(s.h24LongLiquidationUsd),
      shortUsd: toNumber(s.h24ShortLiquidationUsd),
    },
    volume24hUsd: toNumber(s.h24LongVolUsd) + toNumber(s.h24ShortVolUsd),
    oiSurMcap: toNumber(s.oiMarketCapRadio),
    oiSurVol: toNumber(s.oiVolRadio),
  };
}

/**
 * Scrape le résumé dérivés BTC (funding agrégé, open interest, long/short retail
 * et top-traders, liquidations 24h, volume, leverage) depuis Coinglass.
 * @returns {Promise<object>} Vue dérivés BTC (voir parseDerivatives).
 * @throws {Error} Si le résumé BTC n'a pas pu être capturé.
 */
export async function scrapeDerivatives() {
  const payloads = await capturePayloads(DERIVATIVES_URL, { matchKeys: DERIVATIVES_MATCH_KEYS, settleMs: SETTLE_MS });
  for (const payload of payloads) {
    if (!Array.isArray(payload)) continue;
    const btc = payload.find((entry) => entry && entry.symbol === TARGET_SYMBOL);
    if (btc) return parseDerivatives(btc);
  }
  throw new Error("dérivés Coinglass : résumé BTC introuvable");
}

/**
 * Cure le positionnement whale BTC (Hyperliquid, via Coinglass) en clés FR.
 * Fonction PURE.
 * @param {object} s Agrégat whale brut pour BTC ({ longUserPercent,
 *   shortUserPercent, longUserSize, shortUserSize, positionUsd }).
 * @returns {{longPct: number, shortPct: number, comptesLong: number,
 *   comptesShort: number, positionUsd: number, biais: string}} Positionnement
 *   whale (biais "long" si plus de longs que de shorts).
 */
export function parseWhalePositions(s) {
  const longPct = toNumber(s.longUserPercent);
  const shortPct = toNumber(s.shortUserPercent);
  return {
    longPct,
    shortPct,
    comptesLong: toNumber(s.longUserSize),
    comptesShort: toNumber(s.shortUserSize),
    positionUsd: toNumber(s.positionUsd),
    biais: longPct >= shortPct ? "long" : "short",
  };
}

/**
 * Scrape le positionnement whale BTC (part long/short des gros comptes
 * Hyperliquid, taille totale des positions) depuis Coinglass.
 * @returns {Promise<object>} Positionnement whale BTC (voir parseWhalePositions).
 * @throws {Error} Si l'agrégat whale BTC n'a pas pu être capturé.
 */
export async function scrapeWhalePositions() {
  const payloads = await capturePayloads(WHALES_URL, { matchKeys: WHALES_MATCH_KEYS, settleMs: SETTLE_MS });
  for (const payload of payloads) {
    if (!Array.isArray(payload)) continue;
    const btc = payload.find((entry) => entry && entry.symbol === TARGET_SYMBOL);
    if (btc) return parseWhalePositions(btc);
  }
  throw new Error("whales Coinglass : agrégat BTC introuvable");
}
