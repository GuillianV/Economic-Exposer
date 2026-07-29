import { Collector } from "./base.js";

/**
 * Indicateurs de POSITION DE CYCLE du Bitcoin, calculés depuis l'historique de
 * prix natif de la source (klines Binance publiques) — comme baselines.js lit
 * l'historique FRED, on ne dépend PAS de nos propres snapshots accumulés.
 * Sans clé, gratuit, sans géo-blocage (host data-api.binance.vision). Axe : onchain.
 *
 * Trois lectures classiques de valorisation, prix seul :
 *   - Mayer Multiple : prix / moyenne 200 jours (sur/sous-évaluation court-moyen terme).
 *   - Pi Cycle Top   : moyenne 111 jours vs 2 x moyenne 350 jours (proximité d'un sommet de cycle).
 *   - 200 semaines   : prix / moyenne 200 semaines (plancher/plafond de cycle long).
 * Combinées en une position 0-100 (bon marché -> cher). Heuristique documentée,
 * pas un modèle prédictif (le Stock-to-Flow, discrédité, est volontairement absent).
 */
const KLINES_URL = "https://data-api.binance.vision/api/v3/klines";
const SYMBOL = "BTCUSDT";
const DAILY_LIMIT = 1000; // ~2,7 ans de closes quotidiens : couvre la moyenne 350 jours
const WEEKLY_LIMIT = 1000; // ~19 ans de closes hebdo : couvre la moyenne 200 semaines
const CLOSE_INDEX = 4; // position du close dans un kline Binance [openTime, o, h, l, close, ...]
const FETCH_TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 12 * 3600000; // données quotidiennes : un rafraîchissement 2x/jour suffit

const MAYER_SMA_DAYS = 200;
const PI_FAST_DAYS = 111;
const PI_SLOW_DAYS = 350;
const W200_SMA_WEEKS = 200;

// Bornes de classe du Mayer Multiple (prix / MM200j). Historique : <1 sous la
// moyenne (bon marché), >2,4 zones de sommet.
const MAYER_BANDS = { basHaut: 1.0, neutreHaut: 1.5, cherHaut: 2.4 }; // multiples
// Ratio Pi Cycle = MM111j / (2 x MM350j) : proche de 1 = sommet historiquement imminent.
const PI_BANDS = { loinHaut: 0.6, neutreHaut: 0.85, procheHaut: 1.0 }; // ratio
// Multiple 200 semaines = prix / MM200sem : ~1 = plancher de cycle, >3,5 = haut.
const W200_BANDS = { basHaut: 2.0, neutreHaut: 3.5 }; // multiples

// Bornes de normalisation de chaque sous-indicateur vers 0-100 (bon marché -> cher).
const MAYER_NORM = { lo: 0.8, hi: 2.4 };
const PI_NORM = { lo: 0.5, hi: 1.0 };
const W200_NORM = { lo: 1.0, hi: 5.0 };
// Poids de la combinaison (somme = 1) : le Mayer prime, la 200 semaines ancre le
// long terme, le Pi Cycle affine la proximité d'un sommet.
const BLEND = { mayer: 0.4, w200: 0.35, pi: 0.25 };

// Bornes de la position combinée 0-100 vers un libellé lisible.
const POSITION_BANDS = { bonMarcheHaut: 25, basHaut: 45, milieuHaut: 65, cherHaut: 85 };
const PCT_MAX = 100;

/**
 * Convertit en nombre fini, null sinon.
 * @param {*} value Valeur brute (Binance renvoie les prix en chaîne).
 * @returns {number|null} Nombre fini ou null.
 */
function toFiniteNumber(value) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Moyenne mobile simple des `n` dernières valeurs d'une série.
 * @param {Array<number>} series Série chronologique (ancien -> récent).
 * @param {number} n Nombre de valeurs à moyenner.
 * @returns {number|null} Moyenne, ou null si moins de `n` valeurs disponibles.
 */
function simpleMovingAverage(series, n) {
  if (!Array.isArray(series) || series.length < n) return null;
  const window = series.slice(series.length - n);
  const sum = window.reduce((acc, value) => acc + value, 0);
  return sum / n;
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
 * Classe une valeur selon des bornes montantes en trois ou quatre paliers.
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
 * Calcule les indicateurs de cycle à partir des séries de closes.
 * Fonction PURE (aucune I/O) — testable isolément.
 * @param {Array<number>} daily Closes quotidiens (ancien -> récent).
 * @param {Array<number>} weekly Closes hebdomadaires (ancien -> récent).
 * @returns {{btcPrice: number|null, mayer: object, piCycle: object,
 *   w200: object, position: number|null, positionLabel: string|null}}
 *   Indicateurs + position combinée 0-100 (bon marché -> cher).
 */
export function computeCycle(daily, weekly) {
  const btcPrice = daily.length ? daily[daily.length - 1] : null;

  const sma200d = simpleMovingAverage(daily, MAYER_SMA_DAYS);
  const sma111d = simpleMovingAverage(daily, PI_FAST_DAYS);
  const sma350d = simpleMovingAverage(daily, PI_SLOW_DAYS);
  const sma200w = simpleMovingAverage(weekly, W200_SMA_WEEKS);

  const mayerValue = btcPrice != null && sma200d ? btcPrice / sma200d : null;
  const piValue = sma111d && sma350d ? sma111d / (2 * sma350d) : null;
  const w200Value = btcPrice != null && sma200w ? btcPrice / sma200w : null;

  const mayer = {
    valeur: mayerValue,
    statut: mayerValue == null
      ? "indisponible"
      : classify(mayerValue, [[MAYER_BANDS.basHaut, "bas"], [MAYER_BANDS.neutreHaut, "neutre"], [MAYER_BANDS.cherHaut, "cher"]], "surchauffe"),
  };
  const piCycle = {
    valeur: piValue,
    statut: piValue == null
      ? "indisponible"
      : classify(piValue, [[PI_BANDS.loinHaut, "loin du top"], [PI_BANDS.neutreHaut, "neutre"], [PI_BANDS.procheHaut, "proche du top"]], "signal top"),
  };
  const w200 = {
    valeur: w200Value,
    statut: w200Value == null
      ? "indisponible"
      : classify(w200Value, [[W200_BANDS.basHaut, "bas"], [W200_BANDS.neutreHaut, "milieu"]], "haut"),
  };

  const parts = [];
  if (mayerValue != null) parts.push([BLEND.mayer, normalizeToPercent(mayerValue, MAYER_NORM.lo, MAYER_NORM.hi)]);
  if (w200Value != null) parts.push([BLEND.w200, normalizeToPercent(w200Value, W200_NORM.lo, W200_NORM.hi)]);
  if (piValue != null) parts.push([BLEND.pi, normalizeToPercent(piValue, PI_NORM.lo, PI_NORM.hi)]);

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

  return { btcPrice, mayer, piCycle, w200, position, positionLabel };
}

/**
 * Extrait la série des closes d'une réponse klines Binance.
 * @param {Array<Array<*>>} klines Réponse brute (tableau de klines).
 * @returns {Array<number>} Closes finis, ancien -> récent.
 */
function closesOf(klines) {
  if (!Array.isArray(klines)) return [];
  return klines.map((k) => toFiniteNumber(k?.[CLOSE_INDEX])).filter((c) => c != null);
}

/**
 *
 */
export class CycleCollector extends Collector {
  /**
   * Initialise le collecteur et son cache mémoire.
   *
   */
  constructor() {
    super("cycle", { axis: "onchain" });
    this.cache = null; // { ts: number, data: object } — dernier calcul valide
  }

  /**
   * Position de cycle du BTC (Mayer, Pi Cycle, 200 semaines + position combinée).
   * Sert le cache si récent (< CACHE_TTL_MS), sinon recalcule depuis les klines.
   * @returns {Promise<{btcPrice: number|null, mayer: object, piCycle: object,
   *   w200: object, position: number|null, positionLabel: string|null}>}
   *   Indicateurs de cycle.
   */
  async fetchData() {
    if (this.cache && Date.now() - this.cache.ts < CACHE_TTL_MS) return this.cache.data;

    const [dailyRaw, weeklyRaw] = await Promise.all([
      this.getJson(`${KLINES_URL}?symbol=${SYMBOL}&interval=1d&limit=${DAILY_LIMIT}`, { timeout: FETCH_TIMEOUT_MS }),
      this.getJson(`${KLINES_URL}?symbol=${SYMBOL}&interval=1w&limit=${WEEKLY_LIMIT}`, { timeout: FETCH_TIMEOUT_MS }),
    ]);

    const data = computeCycle(closesOf(dailyRaw), closesOf(weeklyRaw));
    const lastDaily = Array.isArray(dailyRaw) && dailyRaw.length ? dailyRaw[dailyRaw.length - 1] : null;
    data.asOf = lastDaily ? new Date(Number(lastDaily[0])).toISOString() : null;
    this.cache = { ts: Date.now(), data };
    return data;
  }
}
