/**
 * Momentum macro pour la boussole de régime (regime.js) : variation récente de
 * la liquidité nette Fed, du taux réel 10 ans et du dollar. Ces MOMENTUMS
 * (pas les niveaux) sont les discriminants swing validés au backtest — mais ils
 * exigent l'historique de la source, absent des snapshots (~jours). On le
 * récupère donc directement chez FRED, comme baselines.js. Axe : macro (I/O).
 *
 * Séparé du calcul pur (regime.js ne touche ni réseau ni disque). Toute panne
 * renvoie des null : la boussole dégrade proprement (bloc macro neutre).
 */
import { Collector } from "./base.js";

const FRED_URL = "https://api.stlouisfed.org/fred/series/observations";
const FETCH_TIMEOUT_MS = 15000;
const HISTORY_DAYS = 160; // couvre le lookback le plus long (momentum 120 j) + marge

// Client HTTP mutualisé : passe par le limiteur par hôte + timeout + contrôle
// du statut de la classe Collector (convention "call API safe"), sans être un
// collecteur de snapshot (on-demand pour la boussole, pas dans le world-state).
const fredClient = new Collector("macro-momentum", { axis: "macro" });

// Séries FRED. WALCL & WTREGEN en MILLIONS (-> /1000 pour des Md$), RRP en Md$.
const SERIES = {
  walcl: "WALCL", // bilan Fed
  rrp: "RRPONTSYD", // reverse repo overnight
  tga: "WTREGEN", // Treasury General Account
  realYield: "DFII10", // taux réel 10 ans (TIPS)
  dxy: "DTWEXBGS", // indice dollar large
};

const MILLIONS_TO_BILLIONS = 1000;
const NETLIQ_LOOKBACK_DAYS = 120; // momentum liquidité nette
const RATE_DXY_LOOKBACK_DAYS = 30; // momentum taux réel / dollar

/**
 * Date ISO (AAAA-MM-JJ) il y a `days` jours.
 * @param {number} days Nombre de jours en arrière.
 * @returns {string} Date au format AAAA-MM-JJ.
 */
function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

/**
 * Récupère une série FRED (observations récentes) en couples {date, value}.
 * @param {string} seriesId Identifiant de série FRED.
 * @param {string} apiKey Clé API FRED.
 * @returns {Promise<Array<{date: string, value: number}>>} Observations triées
 *   croissantes (valeurs manquantes "." écartées).
 */
async function fetchSeries(seriesId, apiKey) {
  const url =
    `${FRED_URL}?series_id=${seriesId}&api_key=${apiKey}&file_type=json` +
    `&observation_start=${isoDaysAgo(HISTORY_DAYS)}&sort_order=asc`;
  const json = await fredClient.getJson(url, { timeout: FETCH_TIMEOUT_MS });
  return (json?.observations || [])
    .filter((o) => o.value !== ".")
    .map((o) => ({ date: o.date, value: Number(o.value) }));
}

/**
 * Valeur d'une série au plus proche (<=) d'une cible en jours en arrière.
 * @param {Array<{date: string, value: number}>} serie Observations triées.
 * @param {number} daysAgo Nombre de jours en arrière visé.
 * @returns {number|null} Valeur la plus proche antérieure, ou null.
 */
function valueDaysAgo(serie, daysAgo) {
  if (!serie.length) return null;
  return valueOnOrBefore(serie, isoDaysAgo(daysAgo)) ?? serie[0].value;
}

/**
 * Dernière valeur d'une série.
 * @param {Array<{date: string, value: number}>} serie Observations triées.
 * @returns {number|null} Dernière valeur, ou null si vide.
 */
function lastValue(serie) {
  return serie.length ? serie[serie.length - 1].value : null;
}

/**
 * Série de liquidité nette (Md$) à partir de WALCL/RRP/TGA, alignée sur les
 * dates de WALCL (hebdomadaire) — chaque point complété par la dernière valeur
 * connue de RRP et TGA.
 * @param {object} series Séries brutes par clé (walcl, rrp, tga).
 * @returns {Array<{date: string, value: number}>} Liquidité nette datée.
 */
function netLiquiditySeries(series) {
  const out = [];
  for (const point of series.walcl) {
    const rrp = valueOnOrBefore(series.rrp, point.date);
    const tga = valueOnOrBefore(series.tga, point.date);
    if (rrp == null || tga == null) continue;
    out.push({ date: point.date, value: point.value / MILLIONS_TO_BILLIONS - rrp - tga / MILLIONS_TO_BILLIONS });
  }
  return out;
}

/**
 * Dernière valeur d'une série à une date <= `date`.
 * @param {Array<{date: string, value: number}>} serie Observations triées.
 * @param {string} date Date pivot (AAAA-MM-JJ).
 * @returns {number|null} Valeur, ou null.
 */
function valueOnOrBefore(serie, date) {
  let choisie = null;
  for (const obs of serie) {
    if (obs.date <= date) choisie = obs.value;
    else break;
  }
  return choisie;
}

/**
 * Momentum macro pour la boussole de régime : variations récentes.
 * Ne throw jamais : renvoie des null par facteur en cas de panne.
 * @returns {Promise<{netLiqMom: number|null, realYieldMom: number|null,
 *   dxyMom: number|null}>} netLiqMom (Md$ sur 120 j), realYieldMom (pp sur
 *   30 j), dxyMom (% sur 30 j).
 */
export async function fetchMacroMomentum() {
  const vide = { netLiqMom: null, realYieldMom: null, dxyMom: null };
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) return vide;

  try {
    const keys = Object.keys(SERIES);
    const settled = await Promise.allSettled(keys.map((k) => fetchSeries(SERIES[k], apiKey)));
    const series = {};
    keys.forEach((key, i) => {
      series[key] = settled[i].status === "fulfilled" ? settled[i].value : [];
    });

    const netLiq = netLiquiditySeries(series);
    const netLiqNow = lastValue(netLiq);
    const netLiqPast = valueDaysAgo(netLiq, NETLIQ_LOOKBACK_DAYS);
    const realYieldNow = lastValue(series.realYield);
    const realYieldPast = valueDaysAgo(series.realYield, RATE_DXY_LOOKBACK_DAYS);
    const dxyNow = lastValue(series.dxy);
    const dxyPast = valueDaysAgo(series.dxy, RATE_DXY_LOOKBACK_DAYS);

    return {
      netLiqMom: netLiqNow != null && netLiqPast != null ? netLiqNow - netLiqPast : null,
      realYieldMom: realYieldNow != null && realYieldPast != null ? realYieldNow - realYieldPast : null,
      dxyMom: dxyNow != null && dxyPast != null ? (dxyNow / dxyPast - 1) * 100 : null,
    };
  } catch {
    return vide;
  }
}
