/**
 * Boussole de RÉGIME (swing / cycle, horizon 90-180 j) — le cœur produit qui
 * remplace la prévision 24 h (bruit mesuré). Calcul PUR, déterministe, sans IA
 * ni I/O : un score composé de 4 blocs dé-corrélés, un gate de tendance et des
 * overrides d'extrêmes, avec les taux de réussite HISTORIQUES (backtest BTC
 * 2010-2026, forward 90/180 j) inscrits en dur — ils font foi, pas une promesse.
 *
 * Blocs (pondérés par la puissance discriminante mesurée) :
 *   - trend  : BTC vs sa moyenne 200 j (Mayer). Discriminant n°1 : au-dessus,
 *              92 % haussier à 180 j ; en-dessous, 47 %.
 *   - valo   : MVRV / Mayer / Puell. Non-linéaire — quasi nul au milieu, DOMINE
 *              aux extrêmes (MVRV<0.8 -> 96 % haussier ; MVRV>3 -> distribution).
 *   - macro  : momentum liquidité nette / taux réel / dollar (corrélés ->
 *              blendés). Expansion liquidité 120 j -> 69 % haussier à 180 j.
 *   - stress : spread high yield, contrarian. >3.5 (stress crédit) -> 99 %
 *              haussier à 180 j (rare).
 */

// Seuils de valorisation (MVRV = prix / prix réalisé).
const MVRV_CAPITULATION = 0.8; // < : capitulation profonde, 94-96 % haussier 90-180 j
const MVRV_EUPHORIE = 3.0; // > : distribution, forward négatif
// Mayer (prix / MM200 j).
const MAYER_TREND = 1.0; // gate haussier/baissier (le split 92 %/47 %)
const MAYER_SWEET_BAS = 1.0; // [1.0-1.4] = meilleur bucket forward (+47 % 180 j)
const MAYER_SWEET_HAUT = 1.4;
const MAYER_EUPHORIE = 2.4; // > : sommet, forward négatif
// Puell (émission / MM365 j).
const PUELL_CAPITULATION = 0.5; // < : capitulation mineurs, +63 % 180 j
// Spread high yield (%).
const HY_STRESS = 3.5; // > : stress crédit, signal contrarian d'achat fort

// Bandes mortes du momentum macro : sous ces variations, le facteur est PLAT
// (neutre), pas directionnel — évite de lire un bruit comme un signal.
const NETLIQ_DEADBAND = 100; // Md$ sur ~120 j
const REALYIELD_DEADBAND = 0.1; // points de % sur ~30 j
const DXY_DEADBAND = 1.0; // % sur ~30 j

// Poids des blocs hors override (renormalisés si un bloc est indisponible).
const POIDS = { trend: 0.5, valo: 0.3, macro: 0.2 }; // somme 1 : le trend commande

// Bornes du score composé (-1 baissier .. +1 haussier) vers une zone lisible.
const ZONE_ACCUMULATION = 0.4;
const ZONE_CONSTRUCTIF = 0.15;
const ZONE_PRUDENCE = -0.15;
const ZONE_PRUDENCE_FORTE = -0.65; // réservé au cumul trend + valo + macro baissiers

// Magnitude du sous-score de valo au MILIEU (hors extrêmes) : faible par
// construction (l'edge y est quasi nul, cf. backtest).
const VALO_MILIEU_MAX = 0.35;

/**
 * Sous-score de TENDANCE (gate 200 j MA). Le discriminant le plus fiable.
 * @param {number|null} mayer Multiple de Mayer (prix / MM200 j).
 * @returns {{score: number, label: string, note: string}|null} Bloc, ou null.
 */
function blocTrend(mayer) {
  if (mayer == null) return null;
  const haussier = mayer >= MAYER_TREND;
  return {
    score: haussier ? 1 : -1,
    label: haussier ? "au-dessus du 200j MA (haussier)" : "sous le 200j MA (baissier)",
    note: haussier ? "92 % haussier a 180 j historiquement" : "47 % haussier a 180 j — ne pas acheter le downtrend",
  };
}

/**
 * Sous-score de VALORISATION (non-linéaire) : MVRV en tête, nuancé par Mayer et
 * Puell. Faible au milieu, fort aux extrêmes (gérés en override ailleurs).
 * @param {number|null} mvrv Ratio MVRV.
 * @param {number|null} mayer Multiple de Mayer.
 * @param {number|null} puell Multiple de Puell.
 * @returns {{score: number, label: string, note: string}|null} Bloc, ou null.
 */
function blocValorisation(mvrv, mayer, puell) {
  if (mvrv == null) return null;
  if (mvrv < MVRV_CAPITULATION) {
    return { score: 1, label: "capitulation (MVRV bas)", note: "96 % haussier a 180 j — zone d'achat forte" };
  }
  if (mvrv > MVRV_EUPHORIE) {
    return { score: -1, label: "euphorie (MVRV haut)", note: "forward negatif — distribution" };
  }
  let score = 0;
  const notes = [];
  if (mayer != null && mayer >= MAYER_SWEET_BAS && mayer < MAYER_SWEET_HAUT) {
    score += VALO_MILIEU_MAX;
    notes.push("Mayer dans la zone porteuse [1.0-1.4]");
  } else if (mayer != null && mayer < MAYER_SWEET_BAS) {
    score -= VALO_MILIEU_MAX;
    notes.push("Mayer sous 1.0 (pire bucket forward)");
  }
  if (puell != null && puell < PUELL_CAPITULATION) {
    score += VALO_MILIEU_MAX / 2;
    notes.push("Puell bas (capitulation mineurs)");
  }
  const clamped = Math.max(-VALO_MILIEU_MAX, Math.min(VALO_MILIEU_MAX, score));
  return {
    score: clamped,
    label: "valorisation moyenne (milieu)",
    note: notes.length ? notes.join(" ; ") : "edge faible au milieu",
  };
}

/**
 * Sous-score MACRO : blend des momentums corrélés (liquidité nette, taux réel,
 * dollar). Signe seulement — expansion liquidité / taux réel ou dollar en baisse
 * = porteur. Null si aucun momentum fourni.
 * @param {number|null} netLiqMom Variation de liquidité nette sur ~120 j (Md$).
 * @param {number|null} realYieldMom Variation du taux réel 10 ans sur ~30 j (pp).
 * @param {number|null} dxyMom Variation du dollar sur ~30 j (%).
 * @returns {{score: number, label: string, note: string}|null} Bloc, ou null.
 */
function blocMacro(netLiqMom, realYieldMom, dxyMom) {
  const signeAvecBande = (value, bande) => (Math.abs(value) < bande ? 0 : Math.sign(value));
  const signaux = [];
  if (netLiqMom != null) signaux.push(signeAvecBande(netLiqMom, NETLIQ_DEADBAND)); // expansion = +
  if (realYieldMom != null) signaux.push(-signeAvecBande(realYieldMom, REALYIELD_DEADBAND)); // taux réel en baisse = +
  if (dxyMom != null) signaux.push(-signeAvecBande(dxyMom, DXY_DEADBAND)); // dollar en baisse = +
  if (!signaux.length) return null;

  const score = signaux.reduce((sum, s) => sum + s, 0) / signaux.length;
  let label = "conditions macro neutres";
  if (score > 0.3) label = "conditions macro porteuses (liquidité/taux/dollar)";
  else if (score < -0.3) label = "conditions macro contraires";
  return { score, label, note: "momentum liquidite/taux reel/dollar (blend)" };
}

/**
 * Sous-score de STRESS crédit (contrarian). Actif seulement en stress élevé.
 * @param {number|null} hySpread Spread high yield (%).
 * @returns {{score: number, label: string, note: string}|null} Bloc, ou null.
 */
function blocStress(hySpread) {
  if (hySpread == null) return null;
  if (hySpread > HY_STRESS) {
    return { score: 1, label: "stress crédit élevé (contrarian)", note: "99 % haussier a 180 j historiquement — achat" };
  }
  return { score: 0, label: "pas de stress crédit", note: "spread serré = pas de signal" };
}

/**
 * Classe le score composé en zone lisible.
 * @param {number} score Score composé (-1 .. +1).
 * @returns {{zone: string, biais: string}} Zone et biais directionnel.
 */
function classeZone(score) {
  if (score >= ZONE_ACCUMULATION) return { zone: "accumulation", biais: "haussier" };
  if (score >= ZONE_CONSTRUCTIF) return { zone: "constructif", biais: "haussier modéré" };
  if (score > ZONE_PRUDENCE) return { zone: "neutre", biais: "neutre" };
  if (score > ZONE_PRUDENCE_FORTE) return { zone: "prudence", biais: "baissier modéré" };
  return { zone: "prudence forte", biais: "baissier" };
}

/**
 * Prix correspondant à un niveau de MVRV donné (prix = MVRV × prix réalisé).
 * @param {number} mvrvCible Niveau de MVRV visé.
 * @param {number|null} realizedPrice Prix réalisé (plancher on-chain).
 * @returns {number|null} Prix cible, ou null.
 */
function prixAuMvrv(mvrvCible, realizedPrice) {
  return realizedPrice != null ? Math.round(mvrvCible * realizedPrice) : null;
}

/**
 * Boussole de régime complète : blocs, score composé, zone, triggers et niveaux.
 * Overrides d'extrêmes (capitulation / stress / euphorie) court-circuitant les
 * poids. Fonction PURE.
 * @param {object} m Facteurs courants.
 * @param {number|null} m.btcPrice Prix BTC.
 * @param {number|null} m.mayer Multiple de Mayer (prix / MM200 j).
 * @param {number|null} m.mvrv Ratio MVRV.
 * @param {number|null} m.puell Multiple de Puell.
 * @param {number|null} m.realizedPrice Prix réalisé.
 * @param {number|null} [m.cyclePosition] Position de cycle 0-100 (couleur).
 * @param {number|null} [m.hySpread] Spread high yield (%).
 * @param {number|null} [m.netLiqMom] Momentum liquidité nette ~120 j (Md$).
 * @param {number|null} [m.realYieldMom] Momentum taux réel ~30 j (pp).
 * @param {number|null} [m.dxyMom] Momentum dollar ~30 j (%).
 * @returns {{zone: string, biais: string, confiance: string, horizon: string,
 *   score: number, override: string|null, blocs: object, triggers: Array,
 *   niveaux: object}} Boussole de régime sérialisable.
 */
export function computeRegime(m) {
  const blocs = {
    trend: blocTrend(m.mayer),
    valorisation: blocValorisation(m.mvrv, m.mayer, m.puell),
    macro: blocMacro(m.netLiqMom, m.realYieldMom, m.dxyMom),
    stress: blocStress(m.hySpread),
  };

  // Score composé : moyenne pondérée des blocs directionnels disponibles
  // (trend/valo/macro), poids renormalisés sur les seuls blocs présents.
  const parts = [];
  if (blocs.trend) parts.push([POIDS.trend, blocs.trend.score]);
  if (blocs.valorisation) parts.push([POIDS.valo, blocs.valorisation.score]);
  if (blocs.macro) parts.push([POIDS.macro, blocs.macro.score]);
  const poidsTotal = parts.reduce((sum, [poids]) => sum + poids, 0);
  const scoreBrut = poidsTotal ? parts.reduce((sum, [poids, score]) => sum + poids * score, 0) / poidsTotal : 0;
  const score = Math.round(scoreBrut * 100) / 100;

  // Overrides d'extrêmes : court-circuitent le blend (l'edge y est maximal).
  let override = null;
  let zone;
  let biais;
  if ((m.mvrv != null && m.mvrv < MVRV_CAPITULATION) || (m.hySpread != null && m.hySpread > HY_STRESS)) {
    override = "achat fort (capitulation / stress crédit)";
    zone = "accumulation forte";
    biais = "haussier fort";
  } else if ((m.mvrv != null && m.mvrv > MVRV_EUPHORIE) || (m.mayer != null && m.mayer > MAYER_EUPHORIE)) {
    override = "distribution (euphorie / sommet de cycle)";
    zone = "distribution";
    biais = "baissier";
  } else {
    ({ zone, biais } = classeZone(score));
  }

  // Confiance : alignement des blocs directionnels (même signe) + override.
  const signes = parts.map(([, s]) => Math.sign(s)).filter((s) => s !== 0);
  const accord = signes.length ? signes.filter((s) => s === Math.sign(score || 1)).length / signes.length : 0;
  let confiance = "faible";
  if (override) confiance = "haute";
  else if (accord >= 0.99 && Math.abs(score) >= ZONE_CONSTRUCTIF) confiance = "haute";
  else if (accord >= 0.6) confiance = "moyenne";

  const ma200 = m.btcPrice != null && m.mayer ? Math.round(m.btcPrice / m.mayer) : null;
  const triggers = [
    { nom: "Reconquête du 200j MA", niveau: ma200, condition: "BTC repasse au-dessus", tauxHistorique: "92 % haussier a 180 j" },
    { nom: "Capitulation profonde", niveau: prixAuMvrv(MVRV_CAPITULATION, m.realizedPrice), condition: "BTC sous ce niveau (MVRV<0.8)", tauxHistorique: "94-96 % haussier a 90-180 j" },
    { nom: "Distribution", niveau: prixAuMvrv(MVRV_EUPHORIE, m.realizedPrice), condition: "BTC au-dessus (MVRV>3)", tauxHistorique: "forward negatif — alléger" },
  ];

  return {
    zone,
    biais,
    confiance,
    horizon: "90-180 jours (swing / cycle)",
    score,
    override,
    blocs,
    triggers,
    niveaux: {
      ma200,
      prixRealise: m.realizedPrice != null ? Math.round(m.realizedPrice) : null,
      capitulation: prixAuMvrv(MVRV_CAPITULATION, m.realizedPrice),
      distribution: prixAuMvrv(MVRV_EUPHORIE, m.realizedPrice),
      cyclePosition: m.cyclePosition ?? null,
    },
  };
}
