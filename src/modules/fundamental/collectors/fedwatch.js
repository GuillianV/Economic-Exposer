import { Collector } from "./base.js";

/**
 * Attentes de décision de la Fed calculées depuis les FUTURES Fed Funds (ZQ),
 * méthode CME FedWatch — probabilités RÉELLES implicites dans les prix, pas le
 * proxy directionnel 2Y - taux directeur.
 *
 * Sans clé, gratuit : cotations ZQ mois par mois via Yahoo Finance (header-fetch,
 * même infra que le repli de metals.js). Un contrat Fed Funds règle à
 * `100 - moyenne du taux effectif (EFFR) sur le mois`, donc taux implicite du
 * mois = `100 - prix`. En découpant le mois de réunion en jours AVANT / APRÈS la
 * décision, on remonte au taux post-réunion, d'où la probabilité d'un palier de
 * 25 bps. Axe : macro.
 *
 * Limite assumée : le taux de départ de repli vient de DFF (EFFR quotidien FRED,
 * publié à J-1 ouvré) et les probabilités portent sur le NIVEAU du taux, pas sur les
 * fourchettes-cibles exactes de la Fed — les futures font l'essentiel du signal.
 */
const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const YAHOO_HEADERS = { "User-Agent": "Mozilla/5.0" };
const FETCH_TIMEOUT_MS = 12000;
const CACHE_TTL_MS = 6 * 3600000; // les futures Fed Funds bougent lentement : 4 rafraîchissements/jour

// Codes de mois des contrats à terme CBOT (1 = janvier … 12 = décembre).
const MONTH_CODES = ["F", "G", "H", "J", "K", "M", "N", "Q", "U", "V", "X", "Z"]; // Jan→Déc
const CONTRACTS_AHEAD = 4; // mois courant + 3 suivants : couvre toute réunion proche et son mois suivant
const FUTURES_SETTLE = 100; // un contrat ZQ règle à 100 - taux moyen du mois

// Calendrier officiel des réunions du FOMC (federalreserve.gov). Jour = date de
// la DÉCISION (2e jour de réunion) ; le nouveau taux prend effet le lendemain.
// À prolonger avec 2027 quand la Fed publie le calendrier suivant.
const FOMC_MEETINGS = [
  { year: 2026, month: 1, day: 28 },
  { year: 2026, month: 3, day: 18 },
  { year: 2026, month: 4, day: 29 },
  { year: 2026, month: 6, day: 17 },
  { year: 2026, month: 7, day: 29 },
  { year: 2026, month: 9, day: 16 },
  { year: 2026, month: 10, day: 28 },
  { year: 2026, month: 12, day: 9 },
];

const FUTURES_STEP_PCT = 0.25; // paliers de la Fed : mouvements de 25 bps
const BPS_PER_PCT = 100;
const MIN_DAYS_AFTER_MEETING = 5; // sous ce seuil, le contrat du mois de réunion est trop bruité → mois suivant
const POSITION_SPAN_BPS = 50; // amplitude (± bps) mappée sur la position 0-100 de la jauge Reader
const POSITION_MID = 50; // centre de la jauge = statu quo
const PCT_MAX = 100;

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
 * Construit le symbole Yahoo d'un contrat ZQ pour un mois donné.
 * @param {number} year Année (ex. 2026).
 * @param {number} monthIndex1 Mois 1-12.
 * @returns {string} Symbole Yahoo (ex. "ZQU26.CBT" pour septembre 2026).
 */
function zqSymbol(year, monthIndex1) {
  const code = MONTH_CODES[monthIndex1 - 1];
  const yy = String(year % 100).padStart(2, "0");
  return `ZQ${code}${yy}.CBT`;
}

/**
 * Liste des (année, mois) des contrats à récupérer à partir d'une date.
 * @param {Date} from Date de référence (le 1er contrat est son mois).
 * @param {number} count Nombre de mois consécutifs.
 * @returns {Array<{year: number, month: number}>} Couples année/mois 1-12.
 */
function upcomingContractMonths(from, count) {
  const months = [];
  for (let offset = 0; offset < count; offset += 1) {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + offset, 1));
    months.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
  }
  return months;
}

/**
 * Nombre de jours dans un mois.
 * @param {number} year Année.
 * @param {number} month Mois 1-12.
 * @returns {number} Jours du mois (28-31).
 */
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Repère un événement FOMC / décision de taux de la Fed (US) dans le calendrier.
const FOMC_EVENT_RX = /fomc|fed interest rate|federal funds rate/i;

/**
 * Prochaine réunion FOMC déduite du CALENDRIER scrappé (source vivante), plus
 * fiable que le planning codé (qui peut dater d'un jour et faire sauter la
 * réunion imminente).
 * @param {Date} now Date de référence.
 * @param {Array<object>} events Événements calendrier ({ datetime, event }).
 * @returns {{year: number, month: number, day: number}|null} Réunion à venir, ou null.
 */
function fomcFromCalendar(now, events) {
  if (!Array.isArray(events)) return null;
  const nowMs = now.getTime();
  const upcoming = events
    .filter((e) => e && typeof e.datetime === "number" && e.datetime > nowMs && FOMC_EVENT_RX.test(e.event || ""))
    .sort((a, b) => a.datetime - b.datetime)[0];
  if (!upcoming) return null;
  const decision = new Date(upcoming.datetime);
  return { year: decision.getUTCFullYear(), month: decision.getUTCMonth() + 1, day: decision.getUTCDate() };
}

/**
 * Prochaine réunion du FOMC strictement postérieure à une date : d'abord depuis
 * le calendrier fourni (à jour), sinon repli sur le planning FOMC codé en dur.
 * @param {Date} now Date de référence.
 * @param {Array<object>|null} [events] Événements calendrier (facultatif).
 * @returns {{year: number, month: number, day: number}|null} Réunion à venir,
 *   ou null si ni le calendrier ni le planning codé ne vont assez loin.
 */
export function nextFomcMeeting(now, events = null) {
  const fromCalendar = fomcFromCalendar(now, events);
  if (fromCalendar) return fromCalendar;
  const nowMs = now.getTime();
  for (const meeting of FOMC_MEETINGS) {
    const decisionMs = Date.UTC(meeting.year, meeting.month - 1, meeting.day);
    if (decisionMs > nowMs) return meeting;
  }
  return null;
}

/**
 * Vrai si une réunion du FOMC tombe dans un mois donné.
 * @param {number} year Année.
 * @param {number} month Mois 1-12.
 * @returns {boolean} Présence d'une réunion ce mois-là.
 */
function hasMeetingInMonth(year, month) {
  return FOMC_MEETINGS.some((m) => m.year === year && m.month === month);
}

/**
 * Taux de DÉPART pour le calcul d'une réunion. Si le mois PRÉCÉDENT ne contient
 * aucune réunion, son taux implicite est un plateau = le taux réellement en
 * vigueur à l'entrée du mois de réunion (choix propre, sans le retard de l'EFFR
 * mensuel, et sans double-compter une réunion passée). Sinon, repli sur l'EFFR.
 * @param {{meeting: {year: number, month: number}, contracts: Array<object>,
 *   fallbackRate: number|null}} input Réunion, contrats collectés, EFFR de repli.
 * @returns {number|null} Taux de départ (%), ou null si rien d'exploitable.
 */
export function fedStartRate({ meeting, contracts, fallbackRate }) {
  const isJanuary = meeting.month === 1;
  const prevYear = isJanuary ? meeting.year - 1 : meeting.year;
  const prevMonth = isJanuary ? 12 : meeting.month - 1;
  if (!hasMeetingInMonth(prevYear, prevMonth)) {
    const prevImplied = impliedRateFor(contracts, prevYear, prevMonth);
    if (prevImplied != null) return prevImplied;
  }
  return fallbackRate;
}

/**
 * Taux implicite (%) d'un contrat depuis son prix : 100 - prix.
 * @param {Array<object>} contracts Contrats collectés ({ year, month, impliedRate }).
 * @param {number} year Année recherchée.
 * @param {number} month Mois 1-12 recherché.
 * @returns {number|null} Taux implicite du contrat, ou null si absent.
 */
function impliedRateFor(contracts, year, month) {
  const found = contracts.find((c) => c.year === year && c.month === month);
  return found ? found.impliedRate : null;
}

/**
 * Répartit un mouvement de taux (en paliers de 25 bps) sur les deux issues
 * entières encadrantes, à la manière de CME FedWatch.
 * @param {number} steps Mouvement en nombre de paliers de 25 bps (signé, ex. -0,68).
 * @returns {Array<{mouvementBps: number, proba: number}>} Issues probables
 *   (mouvement en bps + probabilité), doublon fusionné, triées par proba décroissante.
 */
function distributeOutcomes(steps) {
  const lower = Math.floor(steps);
  const upper = Math.ceil(steps);
  const stepBps = FUTURES_STEP_PCT * BPS_PER_PCT;

  if (lower === upper) return [{ mouvementBps: lower * stepBps, proba: 1 }];

  const probaUpper = steps - lower;
  const probaLower = 1 - probaUpper;
  const issues = [
    { mouvementBps: lower * stepBps, proba: probaLower },
    { mouvementBps: upper * stepBps, proba: probaUpper },
  ];
  return issues.sort((a, b) => b.proba - a.proba);
}

/**
 * Formule le biais lisible d'un mouvement dominant.
 * @param {number} mouvementBps Mouvement de l'issue la plus probable, en bps.
 * @returns {string} "baisse" | "statu quo" | "hausse".
 */
function biaisOf(mouvementBps) {
  if (mouvementBps < 0) return "baisse";
  if (mouvementBps > 0) return "hausse";
  return "statu quo";
}

/**
 * Position 0-100 pour la jauge (0 = baisses, 50 = statu quo, 100 = hausses).
 * @param {number} deltaBps Mouvement attendu en bps (signé).
 * @returns {number} Position 0-100, clampée.
 */
function positionOf(deltaBps) {
  const ratio = deltaBps / POSITION_SPAN_BPS;
  const raw = POSITION_MID + ratio * POSITION_MID;
  return Math.round(Math.min(Math.max(raw, 0), PCT_MAX));
}

/**
 * Calcule les probabilités de décision Fed pour la prochaine réunion depuis les
 * taux implicites des futures. Fonction PURE (aucune I/O) — testable isolément.
 *
 * On découpe le mois de réunion : jours au taux de départ AVANT la prise d'effet
 * (lendemain de la décision) + jours au taux d'arrivée APRÈS, dont la moyenne
 * doit égaler le taux implicite du contrat. On en déduit le taux d'arrivée, donc
 * le mouvement en paliers de 25 bps. Si la décision tombe trop près de la fin du
 * mois (reste instable), on prend le taux implicite du mois SUIVANT comme taux
 * d'arrivée (mois entier au nouveau taux).
 * @param {{meeting: {year: number, month: number, day: number},
 *   startRate: number, meetingImplied: number, nextImplied: number|null}} input
 *   Réunion, taux de départ (EFFR %), taux implicite du mois de réunion et du
 *   mois suivant.
 * @returns {{tauxDepart: number, tauxArrivee: number, mouvementBps: number,
 *   issues: Array<{mouvementBps: number, proba: number}>, biais: string,
 *   proba: number, position: number}|null} Attentes, ou null si entrées
 *   insuffisantes.
 */
export function computeFedProbabilities({ meeting, startRate, meetingImplied, nextImplied }) {
  if (meeting == null || startRate == null || meetingImplied == null) return null;

  const totalDays = daysInMonth(meeting.year, meeting.month);
  const effectiveDay = meeting.day + 1; // le nouveau taux s'applique le lendemain de la décision
  const daysBefore = Math.min(effectiveDay - 1, totalDays);
  const daysAfter = totalDays - daysBefore;

  let endRate;
  if (daysAfter >= MIN_DAYS_AFTER_MEETING) {
    endRate = (meetingImplied * totalDays - startRate * daysBefore) / daysAfter;
  } else if (nextImplied != null) {
    endRate = nextImplied;
  } else {
    return null;
  }

  const deltaPct = endRate - startRate;
  const mouvementBps = Math.round(deltaPct * BPS_PER_PCT);
  const steps = deltaPct / FUTURES_STEP_PCT;
  const issues = distributeOutcomes(steps);
  const dominante = issues[0];

  return {
    tauxDepart: startRate,
    tauxArrivee: endRate,
    mouvementBps,
    issues,
    biais: biaisOf(dominante.mouvementBps),
    proba: dominante.proba,
    position: positionOf(mouvementBps),
  };
}

/**
 *
 */
export class FedWatchCollector extends Collector {
  /**
   * Initialise le collecteur et son cache mémoire.
   *
   */
  constructor() {
    super("fedwatch", { axis: "macro" });
    this.cache = null; // { ts: number, data: object } — dernière collecte valide
  }

  /**
   * Récupère un contrat ZQ (prix + taux implicite), null si Yahoo échoue.
   * @param {number} year Année du contrat.
   * @param {number} month Mois 1-12 du contrat.
   * @returns {Promise<{year: number, month: number, symbol: string,
   *   price: number, impliedRate: number}|null>} Contrat, ou null.
   */
  async #contract(year, month) {
    const symbol = zqSymbol(year, month);
    const json = await this.getJson(
      `${YAHOO_CHART_URL}/${symbol}?interval=1d&range=5d`,
      { headers: YAHOO_HEADERS, timeout: FETCH_TIMEOUT_MS },
    );
    const price = toFiniteNumber(json?.chart?.result?.[0]?.meta?.regularMarketPrice);
    if (price == null) return null;
    return { year, month, symbol, price, impliedRate: FUTURES_SETTLE - price };
  }

  /**
   * Taux implicites des prochains contrats Fed Funds (mois courant + suivants).
   * Sert le cache si récent (< CACHE_TTL_MS), sinon recollecte depuis Yahoo.
   * @returns {Promise<{asOf: string, contracts: Array<object>}>} Contrats
   *   collectés (ceux en échec sont simplement absents).
   * @throws {Error} Si aucun contrat n'a pu être récupéré.
   */
  async fetchData() {
    if (this.cache && Date.now() - this.cache.ts < CACHE_TTL_MS) return this.cache.data;

    const months = upcomingContractMonths(new Date(), CONTRACTS_AHEAD);
    const settled = await Promise.all(months.map(({ year, month }) => this.#contract(year, month)));
    const contracts = settled.filter((c) => c != null);
    if (contracts.length === 0) throw new Error("aucun contrat ZQ disponible (Yahoo Finance en échec)");

    const data = { asOf: new Date().toISOString(), contracts };
    this.cache = { ts: Date.now(), data };
    return data;
  }
}

export { impliedRateFor };
