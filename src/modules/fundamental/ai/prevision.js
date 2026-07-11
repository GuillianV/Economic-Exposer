import { getProviderChain, parseJsonLoose } from "./analyst.js";
import { ASSETS, buildTrajectory, r2 } from "./curve.js";
import { logger } from "../../logs/index.js";
import { loadMetricsSince } from "../persistence/store.js";

/**
 * PRÉVISIONS DIRECTIONNELLES 24h — remplace les courbes de prix chiffrées.
 * Choix produit : un modèle ne sait pas prédire un PRIX, mais une CLASSE de
 * mouvement est falsifiable et auditable. Chaque prévision est évaluée le
 * lendemain contre le réalisé → track record automatique, affiché tel quel.
 *
 * 5 classes, seuils INDEXÉS sur la volatilité 30 j de CHAQUE actif (±0.3 %
 * fixe serait du bruit permanent pour BTC et un événement pour EUR/USD) :
 *   envolee     : mouvement > +1.0 σ_quotidien
 *   hausse      : +0.25 σ à +1.0 σ
 *   calme       : entre −0.25 σ et +0.25 σ
 *   baisse      : −0.25 σ à −1.0 σ
 *   decrochage  : mouvement < −1.0 σ
 */

export const CLASSES = ["envolee", "hausse", "calme", "baisse", "decrochage"];
const CLASS_INDEX = new Map(CLASSES.map((c, i) => [c, i]));

const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const HORIZON_HOURS = 24;
const VOL_LOOKBACK_MS = 32 * DAY_MS;
const MIN_RETURN_SAMPLES = 8; // sous 8 rendements quotidiens, σ mesuré non fiable → repli
const SIGMA_FLOOR_FACTOR = 0.5;
const DEFAULT_SIGMA_PCT = 1.5; // σ quotidien par défaut (%) pour un actif hors FALLBACK_SIGMA
const TRAJECTORY_WINDOW_MS = 7 * DAY_MS;
const PREVISION_TIMEOUT_MS = 90000;
const RAISON_MAX_CHARS = 280;
const PRICE_MATCH_TOL_MS = 6 * HOUR_MS;
const AUTOPSY_CONTEXT_WINDOW_MS = 2 * DAY_MS;
const AUTOPSY_TIMEOUT_MS = 60000;
const AUTOPSY_MAX_CHARS = 900;
const RODAGE_JOURS = 7;

const DISCLAIMER =
  "Prévision directionnelle IA à 24h, évaluée publiquement contre le réalisé le " +
  "lendemain. PAS un conseil financier : même un bon système se trompe souvent — " +
  "le score affiché fait foi, pas la promesse.";

// Repli si moins de 8 jours d'historique : σ quotidien typique par famille (%).
const FALLBACK_SIGMA = {
  btcPrice: 2.4, ethPrice: 3.2, solPrice: 4.0,
  sp500: 0.9, nasdaq: 1.2,
  dxy: 0.35, eurusd: 0.4, usdjpy: 0.5,
  gold: 0.9,
};

/**
 * σ des rendements quotidiens (%) par actif, mesuré sur les snapshots des
 * ~30 derniers jours (dernier point de chaque jour). PLANCHER : un historique
 * court en période calme sous-estime σ de moitié (constaté 2026-07-09 :
 * EUR/USD « envolée » à +0.42%) — on ne descend jamais sous la moitié du σ
 * typique de l'actif (FALLBACK_SIGMA).
 * @returns {Promise<object>} { metricKey: sigmaPct } pour chaque actif d'ASSETS.
 */
export async function dailyVolatility() {
  const since = Date.now() - VOL_LOOKBACK_MS;
  const series = await loadMetricsSince(since);

  const byDay = new Map(); // dayKey -> metrics du dernier snapshot du jour
  for (const snap of series) byDay.set(Math.floor(snap.ts / DAY_MS), snap.metrics || {});
  const days = [...byDay.keys()].sort((a, b) => a - b);

  const sigmas = {};
  for (const [key] of ASSETS) {
    const returns = [];
    let previousValue = null;
    for (const day of days) {
      const value = byDay.get(day)?.[key];
      if (value == null || !Number.isFinite(value)) continue;
      if (previousValue != null && previousValue > 0) returns.push(Math.log(value / previousValue) * 100);
      previousValue = value;
    }

    const fallback = FALLBACK_SIGMA[key] ?? DEFAULT_SIGMA_PCT;
    if (returns.length >= MIN_RETURN_SAMPLES) {
      const mean = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
      const variance = returns.reduce((sum, ret) => sum + (ret - mean) ** 2, 0) / returns.length;
      const sigma = Math.sqrt(variance);
      sigmas[key] = Math.max(sigma, fallback * SIGMA_FLOOR_FACTOR);
    } else {
      sigmas[key] = fallback;
    }
  }
  return sigmas;
}

/**
 * Seuils concrets (%) d'un actif depuis son σ quotidien : ±0.25 σ (calme) et
 * ±1.0 σ (fort).
 * @param {number} sigmaPct σ quotidien de l'actif (%).
 * @returns {{calme: number, fort: number}} Bornes de classe (%).
 */
export function thresholdsOf(sigmaPct) {
  return { calme: r2(0.25 * sigmaPct), fort: r2(1.0 * sigmaPct) };
}

/**
 * Classe le rendement réalisé (%) selon les seuils stockés à l'émission.
 * @param {number} retPct Rendement réalisé (%).
 * @param {{calme: number, fort: number}} th Seuils stockés du record.
 * @returns {string} Une classe de CLASSES.
 */
export function classify(retPct, th) {
  if (retPct > th.fort) return "envolee";
  if (retPct > th.calme) return "hausse";
  if (retPct >= -th.calme) return "calme";
  if (retPct >= -th.fort) return "baisse";
  return "decrochage";
}

const SYSTEM = `Tu es un stratège quantitatif. On te fournit la TRAJECTOIRE d'une analyse fondamentale (régime de marché : risk-on/off, confiance), l'évolution récente des cours, le contexte macro, les extrêmes de positionnement et les catalyseurs. Ta tâche : pour CHAQUE actif, prédire la CLASSE de mouvement des prochaines 24 HEURES.

Les 5 classes, avec les SEUILS PROPRES À CHAQUE ACTIF fournis dans le message (indexés sur sa volatilité réelle) :
- "envolee" : hausse forte (> seuil fort)
- "hausse" : hausse nette (entre seuil calme et seuil fort)
- "calme" : pas de mouvement significatif (± seuil calme)
- "baisse" : baisse nette
- "decrochage" : baisse forte (< − seuil fort)

RÈGLES :
- Base-toi UNIQUEMENT sur les données fournies. N'invente rien.
- "calme" est la classe par DÉFAUT : sur 24h, la plupart des actifs ne font rien de significatif. Une classe directionnelle exige un MOTEUR précis cité dans la raison (flux, extrême, catalyseur passé, momentum du régime). Les classes fortes (envolee/decrochage) exigent un moteur EXCEPTIONNEL — elles sont rares (~1 jour sur 6 par construction des seuils).
- CATALYSEUR IMMINENT ≤48h (NFP, CPI, FOMC listés) : le marché ATTEND → "calme" par défaut sur les actifs exposés, conviction ≤ 0.4. Ne prédis pas le résultat d'un événement binaire.
- DEVISES et OR : mêmes règles, leurs seuils sont plus petits — ne confonds pas "petit mouvement en %" et "calme", les seuils fournis font foi.
- CONFLIT prix/positionnement : positionnement extrême (COT p≤10 ou p≥90) prime à court terme — le squeeze pousse contre la foule.
- conviction ∈ [0,1] : ta probabilité subjective que la classe soit EXACTE (pas juste la direction). Sois calibré : si tu hésites entre 2 classes, conviction ≤ 0.5.
- Réponds en français.

Réponds UNIQUEMENT par un objet JSON valide :
{
  "actifs": [
    { "actif": "BTC/USD", "classe": "calme", "conviction": 0.45, "raison": "une phrase, le moteur précis" }
  ]
}
Un objet par actif fourni, classe ∈ {envolee, hausse, calme, baisse, decrochage}.`;

/**
 * Message utilisateur : trajectoire compacte + seuils par actif + contexte
 * (macro, extrêmes, catalyseurs, géopolitique). PROMPT FIGÉ : toute
 * modification relève du protocole anti-overfitting.
 * @param {object} traj Trajectoire (buildTrajectory).
 * @param {object} vols σ quotidiens par actif (dailyVolatility).
 * @returns {string} Message utilisateur complet.
 */
function formatUser(traj, vols) {
  const lines = [];
  lines.push(`# TRAJECTOIRE DU RÉGIME (${traj.regimes.length} points)`);
  for (const g of traj.regimes.slice(-12)) {
    lines.push(`- ${new Date(g.ts).toISOString().slice(5, 16).replace("T", " ")} : ${g.regime} (conf ${g.confiance})`);
  }
  const cols = ASSETS.filter(([k]) => traj.current[k] != null);
  lines.push(`\n# COURS (7 derniers points) ET SEUILS 24h PAR ACTIF`);
  for (const [k, l] of cols) {
    const pts = traj.prices.slice(-7).map((p) => r2(p.m[k])).filter((v) => v != null);
    const th = thresholdsOf(vols[k]);
    lines.push(`- ${l} : ${pts.join(" → ")} · seuils : calme ±${th.calme}% · fort ±${th.fort}%`);
  }
  // contexte réutilisé de la trajectoire (macro, extrêmes, signaux)
  const mc = traj.macroCtx;
  if (mc) {
    const m = [];
    if (mc.cpiYoY != null) m.push(`CPI ${mc.cpiYoY}% · PCE ${mc.pceYoY ?? "?"}%`);
    if (mc.realYield10y != null) m.push(`10Y réel ${mc.realYield10y}%`);
    if (mc.highYieldSpread != null) m.push(`HY ${mc.highYieldSpread}%`);
    if (mc.vix != null) m.push(`VIX ${mc.vix}`);
    if (mc.move != null) m.push(`MOVE ${mc.move}`);
    if (mc.btcEtfFlowUsdM != null) m.push(`ETF BTC J ${mc.btcEtfFlowUsdM > 0 ? "+" : ""}${mc.btcEtfFlowUsdM} M$ / 7j ${mc.btcEtfFlow7dUsdM > 0 ? "+" : ""}${mc.btcEtfFlow7dUsdM} M$`);
    if (mc.btcBasisAnnualized != null) m.push(`basis BTC ${mc.btcBasisAnnualized}%/an`);
    if (mc.cboeSkew != null) m.push(`CBOE SKEW ${mc.cboeSkew}`);
    lines.push(`\n# CONTEXTE MACRO\n- ` + m.join("\n- "));
  }
  if (traj.extremes?.length) {
    lines.push(`\n# EXTRÊMES DE POSITIONNEMENT (percentile 5 ans, lecture contrarian)`);
    for (const e of traj.extremes.slice(0, 10)) lines.push(`- ${e.label} : ${e.value} (p${e.pctRank}, extrême ${e.extreme})`);
  }
  if (traj.signals?.catalyseurs?.length) {
    lines.push(`\n# CATALYSEURS IMMINENTS (≤3j)\n- ` + traj.signals.catalyseurs.map((c) => `${c.date} : ${c.evenement}`).join("\n- "));
  }
  if (traj.signals?.changements?.length) lines.push(`\n# CE QUI A CHANGÉ\n- ` + traj.signals.changements.join("\n- "));
  // Sections perdues lors de la migration courbes → prévisions (constaté
  // 2026-07-09 : « or baisse » prédit avec un conflit Iran/US actif — la
  // lecture géopolitique du verdict n'était plus transmise au modèle).
  if (traj.signals?.divergences?.length) lines.push(`\n# DIVERGENCES CROSS-MARKET\n- ` + traj.signals.divergences.join("\n- "));
  if (traj.signals?.alertes?.length) lines.push(`\n# ALERTES\n- ` + traj.signals.alertes.join("\n- "));
  if (traj.signals?.geopolitique) {
    lines.push(
      `\n# GÉOPOLITIQUE (lecture du dernier verdict)\n${traj.signals.geopolitique}\n` +
        `Rappel : un stress géopolitique ÉLEVÉ ou qui s'aggrave soutient les REFUGES (or, dollar) et pèse sur le risque — ne prédis pas une baisse de l'or avec un conflit actif sans moteur précis qui la justifie.`,
    );
  }
  return lines.join("\n");
}

/**
 * Normalise un actif prédit par le LLM vers la forme stockée : classe validée,
 * conviction bornée [0,1], raison tronquée, prix de base et seuils de
 * l'émission (l'évaluation du lendemain réutilise EXACTEMENT ces seuils).
 * @param {object} predicted Actif brut du JSON LLM ({ actif, classe,
 *   conviction, raison }).
 * @param {string} metricKey Clé métrique de l'actif.
 * @param {number} prixBase Cours actuel de l'actif.
 * @param {number} sigmaPct σ quotidien de l'actif (%).
 * @returns {object} Actif normalisé prêt à persister.
 */
function normalizePredictedAsset(predicted, metricKey, prixBase, sigmaPct) {
  const classe = CLASSES.includes(predicted.classe) ? predicted.classe : "calme";

  let conviction = null;
  if (typeof predicted.conviction === "number") {
    conviction = r2(Math.min(1, Math.max(0, predicted.conviction)));
  }

  return {
    actif: predicted.actif,
    metricKey,
    classe,
    conviction,
    raison: String(predicted.raison ?? "").slice(0, RAISON_MAX_CHARS),
    prixBase: r2(prixBase),
    seuils: thresholdsOf(sigmaPct),
    sigmaJour: r2(sigmaPct),
  };
}

/**
 * Génère la prévision 24h : une classe par actif, ancrée sur le cours actuel,
 * seuils stockés avec le record.
 * @param {{ provider?: object }} [options] Fournisseur imposé (sinon chaîne
 *   par défaut).
 * @returns {Promise<{provider: string, previsions: object|null, raw: string}>}
 *   Record prêt à persister ({ disclaimer, baseTs, targetTs, horizonHeures,
 *   actifs }), previsions null si le JSON du LLM est inexploitable.
 * @throws {Error} Trajectoire vide, ou TOUS les fournisseurs en échec.
 */
export async function projectPrevisions({ provider } = {}) {
  const [traj, vols] = await Promise.all([buildTrajectory(TRAJECTORY_WINDOW_MS), dailyVolatility()]);
  if (!traj.regimes.length) throw new Error("aucun verdict sur la fenêtre — trajectoire vide");

  const chain = provider ? [provider] : getProviderChain();
  const user = formatUser(traj, vols);
  const labelToKey = new Map(ASSETS.map(([key, label]) => [label, key]));
  const errors = [];

  for (const p of chain) {
    try {
      const raw = await p.complete({ system: SYSTEM, user, timeout: PREVISION_TIMEOUT_MS });
      const parsed = parseJsonLoose(raw);
      if (!parsed || !Array.isArray(parsed.actifs)) {
        logger.warn(`[prevision] "${p.name}" : JSON non parsé`);
        return { provider: p.name, previsions: null, raw };
      }

      const baseTs = Date.now();
      const actifs = [];
      for (const predicted of parsed.actifs) {
        const key = labelToKey.get(predicted.actif);
        if (!key || traj.current[key] == null) continue;
        actifs.push(normalizePredictedAsset(predicted, key, traj.current[key], vols[key]));
      }

      return {
        provider: p.name,
        previsions: {
          disclaimer: DISCLAIMER,
          baseTs,
          targetTs: baseTs + HORIZON_HOURS * HOUR_MS,
          horizonHeures: HORIZON_HOURS,
          actifs,
        },
        raw,
      };
    } catch (err) {
      errors.push(`${p.name}: ${err.message}`);
      logger.warn(`[prevision] fournisseur "${p.name}" en échec → fallback (${err.message})`);
    }
  }
  throw new Error(`tous les fournisseurs IA ont échoué (prevision) — ${errors.join(" | ")}`);
}

/**
 * Prix d'un actif au plus près de `ts` dans une série déjà chargée : premier
 * snapshot ≥ ts, dans la tolérance PRICE_MATCH_TOL_MS.
 * @param {Array<{ts: number, metrics: object}>} series Snapshots triés croissant.
 * @param {string} metricKey Clé métrique de l'actif.
 * @param {number} ts Timestamp cible (epoch ms).
 * @returns {{v: number, ts: number}|null} Prix apparié, ou null.
 */
function priceAt(series, metricKey, ts) {
  for (const snap of series) {
    if (snap.ts >= ts && snap.ts <= ts + PRICE_MATCH_TOL_MS) {
      const value = snap.metrics?.[metricKey];
      if (value != null && Number.isFinite(value)) return { v: value, ts: snap.ts };
    }
  }
  return null;
}

/**
 * Direction d'une classe : +1 (hausse/envolee), −1 (baisse/decrochage),
 * 0 (calme).
 * @param {string} classe Une classe de CLASSES.
 * @returns {number} −1 | 0 | +1.
 */
function directionOf(classe) {
  if (classe === "calme") return 0;
  if (classe === "hausse" || classe === "envolee") return 1;
  return -1;
}

/**
 * Résultat d'une prédiction selon la distance entre classe prédite et classe
 * réalisée sur l'échelle ordonnée CLASSES.
 * @param {number} dist Distance d'index (0, 1, 2+).
 * @returns {string} "exact" | "adjacent" | "faux".
 */
function resultOf(dist) {
  if (dist === 0) return "exact";
  if (dist === 1) return "adjacent";
  return "faux";
}

/**
 * Évalue un record de prévision si son échéance est passée : classe réalisée
 * par actif (avec LES SEUILS STOCKÉS), outcome exact/adjacent/faux + direction.
 * Une seule lecture de la série : même fenêtre pour les 8+ actifs du record.
 * @mutates record — ajoute `realise` par actif et `outcome` quand tout est évalué
 *   (les champs d'émission ne sont JAMAIS réécrits).
 * @param {object} record Record de prévision persisté.
 * @returns {Promise<{record: object, evaluated: number}>} Record muté +
 *   nombre d'actifs évalués (0 si trop tôt / déjà évalué).
 */
export async function evaluatePrevision(record) {
  if (!record?.actifs?.length || record.outcome) return { record, evaluated: 0 };
  if (Date.now() < record.targetTs) return { record, evaluated: 0 };

  const series = await loadMetricsSince(record.targetTs);
  let evaluated = 0;
  for (const asset of record.actifs) {
    if (asset.realise) continue;
    const px = priceAt(series, asset.metricKey, record.targetTs);
    if (!px || asset.prixBase == null || asset.prixBase === 0) continue;

    const retPct = r2(((px.v - asset.prixBase) / asset.prixBase) * 100);
    const classeReelle = classify(retPct, asset.seuils);
    const dist = Math.abs(CLASS_INDEX.get(classeReelle) - CLASS_INDEX.get(asset.classe));

    asset.realise = {
      prix: r2(px.v),
      ts: px.ts,
      retPct,
      classe: classeReelle,
      resultat: resultOf(dist),
      directionOk: directionOf(asset.classe) === directionOf(classeReelle),
    };
    evaluated++;
  }

  if (evaluated && record.actifs.every((asset) => asset.realise)) {
    record.outcome = { evaluatedAt: Date.now() };
  }
  return { record, evaluated };
}

// Les providers forcent response_format json_object : le paragraphe est
// donc demandé DANS un objet JSON (pas de texte brut possible par ce chemin).
const AUTOPSY_SYSTEM = `Tu es un analyste quantitatif qui rédige le post-mortem PUBLIC d'une prévision de la veille. On te donne, par actif, la classe prédite (avec la raison d'origine) contre le réalisé, plus le contexte du jour écoulé. Explique POURQUOI les prévisions ratées ont raté : cite le moteur concret qui a joué (événement, flux, extrême contrarian, catalyseur) et ce que la raison d'origine avait sous-estimé. Factuel, pas d'excuses, pas de promesses. En français.
Réponds UNIQUEMENT par un objet JSON valide : {"texte": "un seul paragraphe de 2 à 4 phrases couvrant l'essentiel — pas un commentaire par actif, pas de liste"}.`;

/**
 * Message utilisateur du post-mortem : prédit vs réalisé par actif + contexte
 * du jour écoulé (best-effort — le post-mortem reste possible sans contexte).
 * @param {object} record Record de prévision entièrement évalué.
 * @returns {Promise<string>} Message utilisateur complet.
 */
async function formatAutopsyUser(record) {
  const lines = [`# PRÉVISION ÉMISE LE ${new Date(record.baseTs).toISOString().slice(0, 16).replace("T", " ")} — PRÉDIT vs RÉALISÉ 24h`];
  for (const a of record.actifs) {
    if (!a.realise) continue;
    lines.push(
      `- ${a.actif} : prédit ${a.classe} (conviction ${a.conviction ?? "?"}) → réalisé ${a.realise.classe} (${a.realise.retPct > 0 ? "+" : ""}${a.realise.retPct}%) — ${a.realise.resultat}` +
        (a.raison ? ` · raison d'origine : ${a.raison}` : ""),
    );
  }
  try {
    const traj = await buildTrajectory(AUTOPSY_CONTEXT_WINDOW_MS);
    const s = traj.signals ?? {};
    if (s.changements?.length) lines.push(`\n# CE QUI A CHANGÉ SUR LA FENÊTRE\n- ` + s.changements.join("\n- "));
    if (s.alertes?.length) lines.push(`\n# ALERTES\n- ` + s.alertes.join("\n- "));
    if (s.geopolitique) lines.push(`\n# GÉOPOLITIQUE\n${s.geopolitique}`);
  } catch (err) {
    logger.warn(`[prevision] autopsie ${record.baseTs} : contexte indisponible, post-mortem sans contexte (${err.message})`);
  }
  return lines.join("\n");
}

/**
 * Extrait le paragraphe d'autopsie d'une réponse LLM parsée. Rattrapage : un
 * modèle qui répond {actif: phrase, …} malgré la consigne (constaté 2026-07-09
 * avec DeepSeek) est aplati en paragraphe.
 * @param {object|null} parsed Réponse LLM parsée.
 * @returns {string} Paragraphe (tronqué à AUTOPSY_MAX_CHARS), ou "" si vide.
 */
function extractAutopsyText(parsed) {
  let texte = typeof parsed?.texte === "string" ? parsed.texte.trim() : "";
  if (!texte && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    texte = Object.entries(parsed)
      .filter(([, value]) => typeof value === "string" && value.trim())
      .map(([key, value]) => `${key} : ${value.trim()}`)
      .join(" ");
  }
  return texte.slice(0, AUTOPSY_MAX_CHARS);
}

/**
 * Post-mortem LLM d'un record ENTIÈREMENT évalué : pourquoi les ratés ont raté.
 * Narratif seulement — n'influence aucune règle (protocole anti-overfitting).
 * @param {object} record Record de prévision entièrement évalué.
 * @returns {Promise<{texte: string, provider: string, ts: number}|null>}
 *   Autopsie, ou null (tout exact, ou LLM indisponible).
 */
export async function autopsyPrevision(record) {
  const rates = (record.actifs ?? []).filter((a) => a.realise && a.realise.resultat !== "exact");
  if (!rates.length) return null;

  const user = await formatAutopsyUser(record);
  for (const p of getProviderChain()) {
    try {
      const raw = await p.complete({ system: AUTOPSY_SYSTEM, user, timeout: AUTOPSY_TIMEOUT_MS });
      const texte = extractAutopsyText(parseJsonLoose(raw));
      if (texte) return { texte, provider: p.name, ts: Date.now() };
    } catch (err) {
      logger.warn(`[prevision] autopsie "${p.name}" en échec → fournisseur suivant (${err.message})`);
    }
  }
  return null;
}

// Rodage : le front ne montre le track record qu'à partir de ~7 jours
// d'évaluations. Seuil calculé ICI (côté données) pour suivre ASSETS.
const MIN_EVALS = ASSETS.length * RODAGE_JOURS;

/**
 * Taux (%) d'un compteur de résultats.
 * @param {{n: number, exact: number, adjacent: number, directionOk: number}} t
 *   Compteur agrégé.
 * @returns {{n: number, exactPct: number|null, exactOuAdjacentPct: number|null,
 *   directionPct: number|null}} Taux arrondis, null si aucune évaluation.
 */
function ratesOf(t) {
  return {
    n: t.n,
    exactPct: t.n ? Math.round((t.exact / t.n) * 100) : null,
    exactOuAdjacentPct: t.n ? Math.round(((t.exact + t.adjacent) / t.n) * 100) : null,
    directionPct: t.n ? Math.round((t.directionOk / t.n) * 100) : null,
  };
}

/**
 * Statistiques agrégées (globales + par actif) sur une liste de records.
 * @param {Array<object>} records Records de prévision (évalués ou non).
 * @returns {{global: object, parActif: object, reperes: object,
 *   rodage: {minEvals: number, pret: boolean}}} Track record complet.
 */
export function statsOf(records) {
  const global = { n: 0, exact: 0, adjacent: 0, directionOk: 0 };
  const parActif = {};
  for (const record of records) {
    for (const asset of record.actifs ?? []) {
      if (!asset.realise) continue;
      const assetStats = (parActif[asset.actif] ??= { n: 0, exact: 0, adjacent: 0, directionOk: 0 });
      for (const target of [global, assetStats]) {
        target.n++;
        if (asset.realise.resultat === "exact") target.exact++;
        if (asset.realise.resultat === "adjacent") target.adjacent++;
        if (asset.realise.directionOk) target.directionOk++;
      }
    }
  }
  return {
    global: ratesOf(global),
    parActif: Object.fromEntries(Object.entries(parActif).map(([actif, counts]) => [actif, ratesOf(counts)])),
    reperes: { hasardExact: 20, hasardDirection: 50 },
    rodage: { minEvals: MIN_EVALS, pret: global.n >= MIN_EVALS },
  };
}
