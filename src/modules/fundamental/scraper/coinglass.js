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
 * Convertit en nombre fini, null si la valeur est absente, vide ou non
 * numérique : une donnée manquante ne doit jamais devenir un 0 plausible.
 * Fonction PURE.
 * @param {*} value Valeur brute.
 * @returns {number|null} Nombre fini, ou null.
 */
export function toNumberOrNull(value) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Ratio long/short exploitable : strictement positif (un ratio nul voudrait
 * dire zéro long — c'est une donnée manquante, pas un marché). Fonction PURE.
 * @param {*} value Ratio brut.
 * @returns {number|null} Ratio > 0, ou null.
 */
function toPositiveRatio(value) {
  const ratio = toNumberOrNull(value);
  if (ratio == null || ratio <= 0) return null;
  return ratio;
}

/**
 * Somme de deux jambes, null si l'une manque (une somme partielle
 * sous-estimerait le total). Fonction PURE.
 * @param {number|null} first Première jambe.
 * @param {number|null} second Seconde jambe.
 * @returns {number|null} Somme, ou null.
 */
function sumBothOrNull(first, second) {
  if (first == null || second == null) return null;
  return first + second;
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
 * Les deux ratios L/S exposés sont des ratios de COMPTES (>1 = plus de longs) :
 * `longShortRetail` = tous les comptes (la foule, à lire en contrarian),
 * `longShortTopTraders` = gros comptes (smart money). Le champ brut h24Ls (L/S
 * global 24h, échelle différente) n'est PAS exposé : le confondre avec le ratio
 * retail inversait le signe de la foule (défaut corrigé le 2026-08-02).
 * @returns {{prix: number|null, variation24hPct: number|null,
 *   openInterestUsd: number|null, openInterestBtc: number|null,
 *   oiVariation24hPct: number|null, oiVariation7jPct: number|null,
 *   fundingPct: number|null, longShortTopTraders: number|null,
 *   longShortRetail: number|null, liquidations24h: {totalUsd: number|null,
 *   longUsd: number|null, shortUsd: number|null}, volume24hUsd: number|null,
 *   oiSurMcap: number|null, oiSurVol: number|null}} Vue dérivés BTC (null =
 *   champ absent ou non plausible, jamais 0 par défaut).
 */
export function parseDerivatives(s) {
  return {
    prix: toNumberOrNull(s.price),
    variation24hPct: toNumberOrNull(s.h24PriceChangePercent),
    openInterestUsd: toNumberOrNull(s.openInterest),
    openInterestBtc: toNumberOrNull(s.openInterestAmount),
    oiVariation24hPct: toNumberOrNull(s.h24OiChangePercent),
    oiVariation7jPct: toNumberOrNull(s.oiChangePercent7d),
    fundingPct: toNumberOrNull(s.avgFundingRateByOi),
    longShortTopTraders: toPositiveRatio(s.binanceTopAccountLsRadio),
    longShortRetail: toPositiveRatio(s.binanceAccountLsRadio),
    liquidations24h: {
      totalUsd: toNumberOrNull(s.h24LiquidationUsd),
      longUsd: toNumberOrNull(s.h24LongLiquidationUsd),
      shortUsd: toNumberOrNull(s.h24ShortLiquidationUsd),
    },
    volume24hUsd: sumBothOrNull(toNumberOrNull(s.h24LongVolUsd), toNumberOrNull(s.h24ShortVolUsd)),
    oiSurMcap: toNumberOrNull(s.oiMarketCapRadio),
    oiSurVol: toNumberOrNull(s.oiVolRadio),
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
 * @returns {{longPct: number|null, shortPct: number|null,
 *   comptesLong: number|null, comptesShort: number|null,
 *   positionUsd: number|null, biais: "long"|"short"|null}} Positionnement
 *   whale (biais "long" si plus de longs que de shorts ; null = champ absent).
 */
export function parseWhalePositions(s) {
  const longPct = toNumberOrNull(s.longUserPercent);
  const shortPct = toNumberOrNull(s.shortUserPercent);
  return {
    longPct,
    shortPct,
    comptesLong: toNumberOrNull(s.longUserSize),
    comptesShort: toNumberOrNull(s.shortUserSize),
    positionUsd: toNumberOrNull(s.positionUsd),
    biais: whaleBias(longPct, shortPct),
  };
}

/**
 * Biais du positionnement whale, null si une jambe manque (comparer deux
 * valeurs absentes donnait « long » par défaut). Fonction PURE.
 * @param {number|null} longPct Part des comptes long (%).
 * @param {number|null} shortPct Part des comptes short (%).
 * @returns {"long"|"short"|null} Biais, ou null.
 */
function whaleBias(longPct, shortPct) {
  if (longPct == null || shortPct == null) return null;
  return longPct >= shortPct ? "long" : "short";
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
