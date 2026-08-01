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

import { amortirBascule } from "./damper.js";

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

// Info par zone : biais directionnel + libellé d'override (null hors extrêmes).
// SOURCE UNIQUE DE VÉRITÉ — biais et override sont des fonctions PURES de la
// zone : quand l'amortisseur tient une zone, on n'a rien à reconstruire depuis
// le record précédent, on relit simplement cette table.
const ZONE_INFOS = {
  "accumulation forte": { biais: "haussier fort", override: "achat fort (capitulation / stress crédit)" },
  accumulation: { biais: "haussier", override: null },
  constructif: { biais: "haussier modéré", override: null },
  neutre: { biais: "neutre", override: null },
  prudence: { biais: "baissier modéré", override: null },
  "prudence forte": { biais: "baissier", override: null },
  distribution: { biais: "baissier", override: "distribution (euphorie / sommet de cycle)" },
};

// Magnitude du sous-score de valo au MILIEU (hors extrêmes) : faible par
// construction (l'edge y est quasi nul, cf. backtest).
const VALO_MILIEU_MAX = 0.35;

// Flux corporate (trésoreries BTC) : variation nette sur ~30 j sous laquelle le
// flux est PLAT (bruit de reporting, pas un signal de demande structurelle).
const CORP_FLUX_DEADBAND = 5000; // BTC

// Fraîcheur du snapshot d'entrée : au-delà, la boussole calcule sur des données
// vieillissantes -> confiance plafonnée et drapeau `perime`.
const STALE_SNAPSHOT_MS = 24 * 60 * 60 * 1000; // 24 h (on-chain quotidien)

// Seuils d'accord des blocs pour la confiance (fraction de blocs alignés).
const ACCORD_FORT = 0.99;
const ACCORD_MOYEN = 0.6;

// Niveaux de confiance, ordre CROISSANT (l'indice sert au plafonnement).
const NIVEAUX_CONFIANCE = ["faible", "moyenne", "haute"];

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
 * Classe le score composé en zone lisible (le biais s'en déduit via ZONE_INFOS).
 * @param {number} score Score composé (-1 .. +1).
 * @returns {string} Zone (clé de ZONE_INFOS).
 */
function classeZone(score) {
  if (score >= ZONE_ACCUMULATION) return "accumulation";
  if (score >= ZONE_CONSTRUCTIF) return "constructif";
  if (score > ZONE_PRUDENCE) return "neutre";
  if (score > ZONE_PRUDENCE_FORTE) return "prudence";
  return "prudence forte";
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
 * Sous-score de FLUX corporate (trésoreries BTC) : lecture STRUCTURELLE, HORS
 * score composé (aucun edge forward mesuré au backtest -> ne commande pas la
 * direction, protocole anti-overfitting). Sert de modulateur de confiance :
 * une distribution corporate nette qui contredit un biais haussier le fragilise.
 * @param {number|null} corpBtcMom Variation nette des trésoreries sur ~30 j (BTC).
 * @returns {{score: number, label: string, note: string}|null} Bloc, ou null.
 */
function blocFlux(corpBtcMom) {
  if (corpBtcMom == null) return null;
  if (corpBtcMom > CORP_FLUX_DEADBAND) {
    return { score: 1, label: "accumulation corporate nette", note: "demande structurelle des trésoreries sur ~30 j" };
  }
  if (corpBtcMom < -CORP_FLUX_DEADBAND) {
    return { score: -1, label: "distribution corporate nette", note: "retrait d'un bid structurel sur ~30 j" };
  }
  return { score: 0, label: "flux corporate stable", note: "pas de variation nette significative des trésoreries" };
}

/**
 * Amortisseur anti-girouette de la ZONE (adaptateur de l'amortisseur générique
 * amortirBascule) : la zone publiée ne bascule qu'après confirmation ; le
 * compteur n'avance qu'à la persistance quotidienne (les lectures API
 * recalculent le même état figé). Fonction PURE (mémoire portée par `previous`).
 * @param {string} zoneBrute Zone brute de la lecture courante.
 * @param {object|null} previous Dernière émission publiée ({ zone, damper: {
 *   zonePressentie, compteur } }).
 * @returns {{zonePubliee: string, zonePressentie: string|null, compteur: number,
 *   tenue: boolean}} Zone à publier + état de l'amortisseur ; `tenue` vrai si on
 *   conserve la zone précédente en attendant confirmation.
 */
function amortirZone(zoneBrute, previous) {
  const resultat = amortirBascule(zoneBrute, {
    confirmee: previous?.zone,
    pressenti: previous?.damper?.zonePressentie ?? null,
    compteur: previous?.damper?.compteur ?? 0,
  });
  return { zonePubliee: resultat.valeur, zonePressentie: resultat.pressenti, compteur: resultat.compteur, tenue: resultat.tenue };
}

/**
 * Indice d'un niveau dans NIVEAUX_CONFIANCE (croissant).
 * @param {string} niveau Niveau ("faible"|"moyenne"|"haute").
 * @returns {number} Indice, ou 0 si inconnu.
 */
function indiceConfiance(niveau) {
  const indice = NIVEAUX_CONFIANCE.indexOf(niveau);
  return indice < 0 ? 0 : indice;
}

/**
 * Plafonne un niveau de confiance par le plus bas d'une liste de plafonds.
 * @param {string} niveau Niveau de base.
 * @param {Array<string>} plafonds Plafonds à appliquer.
 * @returns {string} Niveau plafonné.
 */
function plafonneConfiance(niveau, plafonds) {
  let indiceMin = indiceConfiance(niveau);
  for (const plafond of plafonds) indiceMin = Math.min(indiceMin, indiceConfiance(plafond));
  return NIVEAUX_CONFIANCE[indiceMin];
}

/**
 * Niveau de confiance : accord des blocs directionnels, PLAFONNÉ par la
 * complétude des données (un seul bloc ne fait pas une conviction), une bascule
 * de zone en attente, la péremption du snapshot et une divergence du flux.
 * @param {object} params Paramètres.
 * @param {number} params.accord Fraction de blocs alignés sur le signe du score.
 * @param {number} params.score Score composé.
 * @param {string|null} params.override Override actif, ou null.
 * @param {number} params.blocsDirectionnels Blocs directionnels présents (0-3).
 * @param {boolean} params.tenue Vrai si une bascule de zone attend confirmation.
 * @param {boolean} params.perime Vrai si le snapshot d'entrée est périmé.
 * @param {boolean} params.fluxDivergent Vrai si le flux corporate contredit le biais.
 * @returns {string} Niveau ("faible"|"moyenne"|"haute").
 */
function niveauConfiance({ accord, score, override, blocsDirectionnels, tenue, perime, fluxDivergent }) {
  let niveau = "faible";
  if (override) niveau = "haute";
  else if (accord >= ACCORD_FORT && Math.abs(score) >= ZONE_CONSTRUCTIF) niveau = "haute";
  else if (accord >= ACCORD_MOYEN) niveau = "moyenne";

  const plafonds = [];
  if (blocsDirectionnels <= 1) plafonds.push("faible");
  else if (blocsDirectionnels === 2) plafonds.push("moyenne");
  if (tenue) plafonds.push("moyenne");
  if (perime) plafonds.push("faible");
  if (fluxDivergent) plafonds.push("moyenne");
  return plafonneConfiance(niveau, plafonds);
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
 * @param {number|null} [m.corpBtcMom] Flux net trésoreries corporate ~30 j (BTC).
 * @param {number|null} [m.snapshotAgeMs] Âge du snapshot d'entrée (ms).
 * @param {object|null} [previous] Dernière émission publiée (amortisseur de zone).
 * @returns {{zone: string, zoneBrute: string, biais: string, confiance: string,
 *   horizon: string, score: number, override: string|null, perime: boolean,
 *   snapshotAgeMs: number|null, damper: {zonePressentie: string|null,
 *   compteur: number}, blocs: object, triggers: Array, niveaux: object}}
 *   Boussole de régime sérialisable.
 */
export function computeRegime(m, previous = null) {
  const blocs = {
    trend: blocTrend(m.mayer),
    valorisation: blocValorisation(m.mvrv, m.mayer, m.puell),
    macro: blocMacro(m.netLiqMom, m.realYieldMom, m.dxyMom),
    stress: blocStress(m.hySpread),
    flux: blocFlux(m.corpBtcMom),
  };

  // Score composé : moyenne pondérée des blocs directionnels disponibles
  // (trend/valo/macro ; le flux est hors score par choix anti-overfitting),
  // poids renormalisés sur les seuls blocs présents.
  const parts = [];
  if (blocs.trend) parts.push([POIDS.trend, blocs.trend.score]);
  if (blocs.valorisation) parts.push([POIDS.valo, blocs.valorisation.score]);
  if (blocs.macro) parts.push([POIDS.macro, blocs.macro.score]);
  const poidsTotal = parts.reduce((sum, [poids]) => sum + poids, 0);
  const scoreBrut = poidsTotal ? parts.reduce((sum, [poids, score]) => sum + poids * score, 0) / poidsTotal : 0;
  const score = Math.round(scoreBrut * 100) / 100;

  // Zone BRUTE (avant amortisseur). Overrides d'extrêmes : court-circuitent le
  // blend (l'edge y est maximal) en imposant une zone d'extrême.
  let zoneBrute;
  if ((m.mvrv != null && m.mvrv < MVRV_CAPITULATION) || (m.hySpread != null && m.hySpread > HY_STRESS)) {
    zoneBrute = "accumulation forte";
  } else if ((m.mvrv != null && m.mvrv > MVRV_EUPHORIE) || (m.mayer != null && m.mayer > MAYER_EUPHORIE)) {
    zoneBrute = "distribution";
  } else {
    zoneBrute = classeZone(score);
  }

  // Amortisseur anti-girouette : zone publiée tenue tant qu'une bascule n'est
  // pas confirmée. biais/override sont des fonctions PURES de la zone publiée
  // (ZONE_INFOS) — aucune reconstruction depuis le record précédent.
  const damper = amortirZone(zoneBrute, previous);
  const zone = damper.zonePubliee;
  const { biais, override } = ZONE_INFOS[zone];

  // Confiance : accord des blocs, plafonné par complétude/attente/péremption/flux.
  const signes = parts.map(([, s]) => Math.sign(s)).filter((s) => s !== 0);
  const accord = signes.length ? signes.filter((s) => s === Math.sign(score || 1)).length / signes.length : 0;
  const perime = m.snapshotAgeMs != null && m.snapshotAgeMs > STALE_SNAPSHOT_MS;
  const fluxDivergent = Boolean(blocs.flux && blocs.flux.score !== 0 && Math.sign(blocs.flux.score) !== Math.sign(score || blocs.flux.score));
  const confiance = niveauConfiance({
    accord,
    score,
    override,
    blocsDirectionnels: parts.length,
    tenue: damper.tenue,
    perime,
    fluxDivergent,
  });

  const ma200 = m.btcPrice != null && m.mayer ? Math.round(m.btcPrice / m.mayer) : null;
  const prixRealise = m.realizedPrice != null ? Math.round(m.realizedPrice) : null;
  const triggers = [
    { type: "reconquete", nom: "Reconquête du 200j MA", niveau: ma200, condition: "BTC repasse au-dessus", tauxHistorique: "92 % haussier a 180 j" },
    { type: "coutBase", nom: "1re zone de valeur (coût de base)", niveau: prixRealise, condition: "BTC sous le prix réalisé (MVRV<1)", tauxHistorique: "détenteurs sous l'eau — accumulation prudente, pas encore le signal fort" },
    { type: "capitulation", nom: "Capitulation profonde", niveau: prixAuMvrv(MVRV_CAPITULATION, m.realizedPrice), condition: "BTC sous ce niveau (MVRV<0.8)", tauxHistorique: "94-96 % haussier a 90-180 j — achat fort" },
    { type: "distribution", nom: "Distribution", niveau: prixAuMvrv(MVRV_EUPHORIE, m.realizedPrice), condition: "BTC au-dessus (MVRV>3)", tauxHistorique: "forward negatif — alléger" },
  ];

  return {
    zone,
    zoneBrute,
    biais,
    confiance,
    horizon: "90-180 jours (swing / cycle)",
    score,
    override,
    perime,
    snapshotAgeMs: m.snapshotAgeMs ?? null,
    damper: { zonePressentie: damper.zonePressentie, compteur: damper.compteur },
    blocs,
    triggers,
    niveaux: {
      prixBtc: m.btcPrice != null ? Math.round(m.btcPrice) : null,
      ma200,
      prixRealise,
      capitulation: prixAuMvrv(MVRV_CAPITULATION, m.realizedPrice),
      distribution: prixAuMvrv(MVRV_EUPHORIE, m.realizedPrice),
      cyclePosition: m.cyclePosition ?? null,
    },
  };
}
