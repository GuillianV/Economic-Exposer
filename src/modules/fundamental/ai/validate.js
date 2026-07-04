// Validateur déterministe post-LLM. Applique les garde-fous DURS du prompt
// système que le modèle peut ignorer (observé sur DeepSeek) :
//   1. AUCUN objectif de prix (le service "ne prédit pas le prix").
//   2. AUCUN percentile [pXX/5a] inventé quand la normalisation est absente.
//   3. Pas d'extrapolation d'une source marquée stale.
// Le verdict est NETTOYÉ en place (redaction des 1 et 2) et les manquements
// sont retournés pour journalisation/qualité (le 3 est signalé, pas réécrit —
// trop risqué de mutiler la prose).

// --- Détecteurs (1) objectifs de prix ---------------------------------------
// Fourchette type "55k-62k" / "55 k à 62 k" / "57k et 60k".
const PRICE_RANGE = /\b\d{2,3}\s?k\s?(?:[-–]|à|et|and)\s?\d{2,3}\s?k\b/gi;
// Exclusions communes aux nombres EN CLAIR (4-6 chiffres) : pas une année 20xx,
// pas un montant suivi d'une unité (Md$/M$/%/pt/pb), pas le début d'un nombre
// plus long ("94918217772" ne doit pas matcher sur ses 6 premiers chiffres).
const NOT_YEAR = "(?!20\\d{2}\\b)";
const NOT_UNIT = "(?!\\s?(?:Md|M\\$|M\\b|%|pts?\\b|pb\\b))(?![\\d.,]\\d)";
// Fourchette en clair "58000-62000" / "60000 à 65000" (mais PAS "entre 2024 et 2026").
const PRICE_RANGE_PLAIN = new RegExp(
  `\\b${NOT_YEAR}\\d{4,6}${NOT_UNIT}\\s?(?:[-–]|à|et|and)\\s?${NOT_YEAR}\\d{4,6}${NOT_UNIT}\\b`,
  "gi",
);
// Niveau chiffré + verbe de cible : "vers 65k", "casse 55k", "franchit 65000",
// "repasse sous 60000"… Deux formats : milliers en "k" (2-3 chiffres) OU nombre
// en clair 4-6 chiffres (mêmes exclusions années/unités).
const PRICE_TRIGGER = new RegExp(
  "\\b(?:vers|test(?:er|e|ent)?|objectif|cible|fourchette|remont\\w+|retomb\\w+|chut\\w+|tomb\\w+|cass\\w+|franch\\w+|repass\\w+|dépass\\w+|atteind\\w+|vise\\w*|rebond\\w*\\s+(?:vers|à|jusqu))\\b" +
    `[^.;:\\n]{0,25}?\\b(?:\\d{2,3}\\s?k\\b|${NOT_YEAR}\\d{4,6}${NOT_UNIT}\\b)`,
  "gi",
);
// Prix en dollars explicite à 4-6 chiffres : "$58,000" / "$58 000".
const PRICE_DOLLAR = /\$\s?\d{2,3}[\s.,]\d{3}\b/g;

const PRICE_MARK = "[objectif de prix retiré]";

// --- Détecteur (2) percentile -----------------------------------------------
// Token "p53", "p53/5a", "p>95", "p<10", "p 53 / 5a". `p` MINUSCULE uniquement
// et non précédé d'une lettre, pour ne PAS attraper le "P" de "S&P500".
const PCT_TOKEN = /(?<![A-Za-zÀ-ÿ])p\s?[<>≥≤]?\s?\d{1,3}(?:\s?\/\s?5\s?a)?/g;
const PCT_MARK = "percentile n/d";

// Sources stale -> axe de lecture_par_axe correspondant (pour le signalement 3).
const STALE_AXIS = {
  fred: "macro",
  liquidity: "liquidite",
  commodities: "matieres_premieres",
  markets: "marches_tradfi",
  "markets-live": "marches_tradfi",
  gdelt: "geopolitique",
};

/** Applique `fn` à chaque chaîne-feuille de `node` (mutation en place). */
function walkStrings(node, fn) {
  if (typeof node === "string") return fn(node); // remplacée par le parent
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const r = walkStrings(node[i], fn);
      if (typeof node[i] === "string" && r !== undefined) node[i] = r;
    }
  } else if (node && typeof node === "object") {
    for (const k of Object.keys(node)) {
      const r = walkStrings(node[k], fn);
      if (typeof node[k] === "string" && r !== undefined) node[k] = r;
    }
  }
  return undefined;
}

/** True si AU MOINS une métrique des tendances porte un rang percentile. */
function hasAnyPctRank(trends) {
  const m = trends?.metrics;
  if (!m) return false;
  return Object.values(m).some((v) => v && v.pctRank != null);
}

/**
 * Valide et NETTOIE un verdict en place.
 * @param {object} verdict - objet verdict parsé (muté en place)
 * @param {{ state?: object, trends?: object, previous?: object }} ctx
 * @returns {Array<{type:string, count?:number, sample?:string, axis?:string}>} manquements
 */
export function validateVerdict(verdict, { state, trends, previous } = {}) {
  const violations = [];
  if (!verdict || typeof verdict !== "object") return violations;

  // (1) Objectifs de prix — redaction inconditionnelle.
  let priceHits = 0;
  let priceSample = null;
  walkStrings(verdict, (s) => {
    let out = s;
    for (const re of [PRICE_RANGE, PRICE_RANGE_PLAIN, PRICE_TRIGGER, PRICE_DOLLAR]) {
      out = out.replace(re, (mm) => {
        priceHits++;
        if (!priceSample) priceSample = mm.trim();
        return PRICE_MARK;
      });
    }
    return out;
  });
  if (priceHits) violations.push({ type: "price_target", count: priceHits, sample: priceSample });

  // (2) Percentiles — on n'agit QUE si la normalisation est ABSENTE des
  // tendances. Dans ce cas, tout [pXX] est forcément inventé -> redaction + flag.
  // Si les baselines existent, le prompt porte déjà les annotations [pXX/5a]
  // légitimes et le modèle ne fait que les CITER : on ne touche à rien et on ne
  // flag pas (ce ne serait que du bruit non actionnable, non attribuable).
  if (!hasAnyPctRank(trends)) {
    let pctHits = 0;
    let pctSample = null;
    walkStrings(verdict, (s) => {
      const m = s.match(PCT_TOKEN);
      if (!m) return s;
      pctHits += m.length;
      if (!pctSample) pctSample = m[0].trim();
      return s.replace(PCT_TOKEN, PCT_MARK);
    });
    if (pctHits) violations.push({ type: "percentile_invented", count: pctHits, sample: pctSample });
  }

  // (3) Extrapolation de source stale — signalement seul. Un axe dont la source
  // est stale doit mentionner "stale"/"indisponible" et ne pas avancer de
  // chiffres. Heuristique : présence d'un nombre sans aveu de staleness.
  const stale = state?.meta?.staleSources ?? [];
  const axes = verdict.lecture_par_axe || {};
  const flaggedAxes = new Set();
  for (const src of stale) {
    const axis = STALE_AXIS[src];
    if (!axis || flaggedAxes.has(axis)) continue; // dédoublonne (markets + markets-live)
    const txt = axes[axis];
    if (typeof txt !== "string" || !txt) continue;
    const admitsStale = /(stale|indisponible|absent|non\s+(?:disponible|fourni)|manqu|pas\s+de\s+donn)/i.test(txt);
    const hasNumber = /\d/.test(txt);
    if (!admitsStale && hasNumber) {
      flaggedAxes.add(axis);
      violations.push({ type: "stale_extrapolation", axis, sources: stale.filter((s) => STALE_AXIS[s] === axis) });
    }
  }

  // (4) Hystérésis — signalements seuls, pour suivi qualité :
  //   a. flip de régime avec "ce_qui_a_change" vide = relecture différente des
  //      mêmes données (ce que l'hystérésis interdit) ;
  //   b. conditions d'invalidation reconnues REMPLIES par l'IA elle-même
  //      (test_invalidation) mais régime conservé = auto-persuasion possible
  //      (toléré par l'exception drivers prioritaires, mais à auditer).
  const prevRegime = previous?.verdict?.regime;
  if (prevRegime && verdict.regime) {
    if (verdict.regime !== prevRegime) {
      const changed = Array.isArray(verdict.ce_qui_a_change)
        ? verdict.ce_qui_a_change.filter((s) => typeof s === "string" && s.trim())
        : [];
      if (!changed.length) {
        violations.push({ type: "regime_flip_unjustified", from: prevRegime, to: verdict.regime });
      }
    } else if (verdict.test_invalidation?.conditions_remplies === true) {
      violations.push({ type: "invalidation_met_regime_kept", regime: verdict.regime });
    }
  }

  return violations;
}
