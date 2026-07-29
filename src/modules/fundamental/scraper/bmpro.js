import { captureResponses } from "./browser.js";

/**
 * Indicateurs de cycle BitcoinMagazinePro (ex-LookIntoBitcoin) qui exigent une
 * donnée on-chain AVANCÉE (realized cap par âge, coin-days, HODL bank) réservée
 * au tier PAYANT des fournisseurs bruts (Glassnode/CoinMetrics). BMPro les
 * calcule et les sert au navigateur via django_plotly_dash → on capture la
 * réponse `_dash-update-component` (figure Plotly : traces nommées avec x/y) et
 * on extrait la dernière valeur de la trace cible. Pas de login (pages publiques).
 *
 * Ne double PAS ce que le tier gratuit couvre déjà (MVRV/MVRV-Z/NUPL/Puell via
 * onchain-valuation.js) : ici, seulement les indicateurs INDISPONIBLES en free.
 * Parse PUR séparé du scrape. Axe : onchain.
 */
const DASH_PATTERN = /_dash-update-component/;
const SETTLE_MS = 6000;
const MIN_SERIES_LEN = 100; // ignore les traces de bornes/seuils (2-3 points)

// Chaque indicateur : page publique + nom EXACT de la trace Plotly + bornes de
// classe (heuristiques documentées, propres à chaque échelle).
const CHARTS = [
  {
    key: "rhodl",
    url: "https://www.bitcoinmagazinepro.com/charts/rhodl-ratio/",
    trace: "RHODL Ratio",
    // RHODL : creux de cycle ~ quelques centaines, sommets ~ 20-50 k.
    bands: [[1000, "creux de cycle"], [10000, "neutre"], [30000, "élevé"]],
    dernier: "sommet",
  },
  {
    key: "reserveRisk",
    url: "https://www.bitcoinmagazinepro.com/charts/reserve-risk/",
    trace: "Reserve Risk",
    // Reserve Risk : < 0,002 = accumulation attractive (forte conviction), > 0,02 = surévalué.
    bands: [[0.002, "attractif"], [0.008, "neutre"], [0.02, "élevé"]],
    dernier: "sommet",
  },
];

/**
 * Convertit en nombre fini, null sinon.
 * @param {*} value Valeur brute.
 * @returns {number|null} Nombre fini ou null.
 */
function toFiniteNumber(value) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
 * Extrait la dernière valeur (et sa date) d'une trace nommée dans les réponses
 * django_plotly_dash capturées. Fonction PURE.
 * @param {Array<object>} responses Corps des réponses `_dash-update-component`.
 * @param {string} traceName Nom EXACT de la trace Plotly recherchée.
 * @returns {{valeur: number|null, date: string|null}|null} Dernière valeur, ou null.
 */
export function extractTrace(responses, traceName) {
  for (const body of responses) {
    const resp = body?.response ?? {};
    for (const compId of Object.keys(resp)) {
      const data = resp[compId]?.figure?.data;
      if (!Array.isArray(data)) continue;
      const trace = data.find((t) => t?.name === traceName && Array.isArray(t.y) && t.y.length >= MIN_SERIES_LEN);
      if (!trace) continue;
      const valeur = toFiniteNumber(trace.y[trace.y.length - 1]);
      const date = Array.isArray(trace.x) && trace.x.length ? trace.x[trace.x.length - 1] : null;
      return { valeur, date };
    }
  }
  return null;
}

/**
 * Scrape les indicateurs BMPro configurés (une page publique par indicateur).
 * @returns {Promise<{asOf: string|null, rhodl: object, reserveRisk: object}>}
 *   Indicateurs avec valeur + statut (statut "indisponible" si une page échoue).
 * @throws {Error} Si AUCUN indicateur n'a pu être capturé.
 */
export async function scrapeBmpro() {
  const result = { asOf: null };
  let asOf = null;

  for (const chart of CHARTS) {
    const responses = await captureResponses(chart.url, { pattern: DASH_PATTERN, settleMs: SETTLE_MS });
    const hit = extractTrace(responses, chart.trace);
    if (hit?.valeur != null) {
      result[chart.key] = { valeur: hit.valeur, statut: classify(hit.valeur, chart.bands, chart.dernier) };
      if (hit.date) asOf = hit.date;
    } else {
      result[chart.key] = { valeur: null, statut: "indisponible" };
    }
  }

  result.asOf = asOf;
  const hasAny = CHARTS.some((chart) => result[chart.key]?.valeur != null);
  if (!hasAny) throw new Error("BMPro : aucun indicateur capturé");
  return result;
}
