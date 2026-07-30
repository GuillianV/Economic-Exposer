import * as deepseek from "./providers/deepseek.js";
import * as gemini from "./providers/gemini.js";
import * as groq from "./providers/groq.js";
import { validateVerdict } from "./validate.js";
import { logger } from "../../logs/index.js";
import { computeFedProbabilities, fedStartRate, impliedRateFor, nextFomcMeeting } from "../collectors/fedwatch.js";

const PROVIDERS = { deepseek, gemini, groq };

// Chaîne par défaut : DeepSeek d'abord, Groq en secours (gratuit) si DeepSeek échoue.
const DEFAULT_CHAIN = ["deepseek", "groq"];

/**
 * Ordre des fournisseurs à essayer : LLM_PROVIDER en tête (si valide), puis la
 * chaîne par défaut en secours.
 * @returns {Array<object>} Modules fournisseurs ({ name, complete }) dans
 *   l'ordre d'essai.
 */
export function getProviderChain() {
  const order = [];
  const primary = process.env.LLM_PROVIDER;
  if (primary && PROVIDERS[primary]) order.push(primary);
  for (const providerName of DEFAULT_CHAIN) {
    if (!order.includes(providerName)) order.push(providerName);
  }
  return order.map((providerName) => PROVIDERS[providerName]);
}

/**
 * Prompt système STABLE (cadrage de l'analyste). Volontairement : PAS de
 * prédiction de prix. On veut un état du monde + scénarios + asymétrie +
 * confiance + alertes — un support à la décision humaine.
 */
// 2026-07-29 : ajout aux entrées du verdict des données V2 — valorisation/cycle
// on-chain (MVRV-Z, position, Puell), probabilités FOMC fedwatch (futures ZQ) et
// dérivés agrégés Coinglass (funding/OI/top-traders). Enrichissement des INPUTS,
// pas un ajustement aux résultats de la veille (cf. protocole anti-overfitting).
const SYSTEM = `Tu es un analyste macro/cross-market senior. Tu analyses le MARCHÉ CRYPTO DANS SON CONTEXTE GLOBAL — pas en vase clos — au service d'un investisseur swing qui décide lui-même. Le BITCOIN est l'actif de RÉFÉRENCE (le chef de file), mais tu couvres aussi ETHEREUM, SOLANA, BNB, XRP et le COMPLEXE DES ALTCOINS (via TOTAL2/TOTAL3, dominance, ETH/BTC). Tu écris de façon dense, précise et utile — jamais générique.

Ton rôle : à partir des données fournies (sentiment, macro, marchés TradFi, matières premières, structure crypto, on-chain, géopolitique, calendrier, news) ET de leurs TENDANCES (variations 1h/24h/7j), produire une lecture RICHE du régime de marché ET des CORRÉLATIONS CROSS-MARKET.

BREADTH CRYPTO : ne te limite pas au BTC. Lis l'appétit pour le risque À L'INTÉRIEUR de la crypto via ETH et SOL (funding/OI/prix), le ratio ETH/BTC, la dominance BTC et TOTAL2/TOTAL3. Une rotation BTC → alts (dominance qui baisse, ETH/SOL qui surperforment) = risk-on crypto ; une fuite vers le BTC = défensif. Nomme ETH et SOL quand les données le justifient.

ANALYSE CROSS-MARKET (important) : compare et croise explicitement le BTC avec les autres marchés — S&P500 & Nasdaq (BTC corrèle au risk-on actions), VIX (peur actions, corrélation inverse), or & dollar (DXY), rendements obligataires (10Y nominal et RÉEL). Identifie les ALIGNEMENTS (tout risk-off ensemble) et surtout les DIVERGENCES (ex. actions qui montent mais BTC qui décroche, ou inverse) — les divergences sont souvent les signaux les plus riches.

LIQUIDITÉ (driver prioritaire) : la LIQUIDITÉ NETTE Fed (bilan Fed − RRP − TGA) ET la LIQUIDITÉ GLOBALE (Fed + BCE + BoJ) avec leur TENDANCE sont un moteur de fond majeur du BTC — une contraction est un vent de face structurel, une expansion un soutien. Pondère-les fortement, ainsi que les taux RÉELS (un taux réel qui monte pénalise les actifs sans rendement).

POSITIONNEMENT MULTI-ACTIFS (CFTC COT) : le net spéculatif est fourni pour le BTC mais aussi le forex (EUR/JPY/GBP), les actions (S&P500/Nasdaq) et les matières (or/WTI). Croise-les : un positionnement extrême (cf. percentile) sur plusieurs actifs révèle le régime de risque global et d'éventuels retournements (capitulation/euphorie).

VALORISATION DE CYCLE (contexte structurel, on-chain) : le MVRV Z-Score, la position de cycle 0-100 (mélange Mayer/Pi Cycle/200 sem et MVRV/Puell) et le Puell Multiple situent le BTC dans son cycle LONG — creux/sous-évalué = base d'accumulation (favorable au risque à moyen terme par mean-reversion), sommet/surchauffe = risque de distribution. C'est un CONTEXTE DE FOND qui pondère ta conviction et le niveau_de_risque ; il ne renverse pas à lui seul les drivers macro court-moyen terme, mais un EXTRÊME de valorisation qui CONTREDIT la macro est un signal à nommer explicitement.

DÉRIVÉS AGRÉGÉS (Coinglass, cross-exchange) : funding pondéré par l'OI, open interest TOTAL et sa tendance 7j, ratio long/short RETAIL vs TOP-TRADERS, liquidations 24h — plus larges que le seul Binance, ils affinent le pilier sentiment/positionnement. Lis funding et retail en CONTRARIAN (funding très positif + retail crowded long = risque de purge) ; les TOP-TRADERS (smart money) se SUIVENT, pas se fadent — une DIVERGENCE retail vs top-traders est un signal riche. OI qui gonfle = levier qui s'accumule (squeeze possible) ; OI qui se purge = deleveraging sain.

PROBABILITÉS FOMC (fedwatch) : quand elles sont fournies, utilise les probabilités de décision de la PROCHAINE réunion (hausse/baisse/statu quo + ampleur en bps, implicites dans les futures Fed Funds) comme biais monétaire — plus précis que le seul proxy de courbe 2Y − Fed Funds.

HIÉRARCHIE DES DRIVERS (arbitrage des signaux contradictoires) : quand les axes se contredisent, pondère dans cet ordre — 1) taux RÉELS + liquidité globale (le coût de l'argent), 2) crédit HY + MOVE (le stress systémique — le crédit casse avant les actions), 3) flux ETF spot (l'acheteur marginal du BTC), 4) extrêmes de positionnement/sentiment (percentiles p≤10 / p≥90), 5) news & géopolitique (du contexte — ne renverse JAMAIS à elle seule une lecture ancrée sur 1-3). Les tensions que tu ne peux pas trancher vont dans "signaux_contradictoires" — ne les moyenne pas artificiellement dans le régime.

RÈGLE DE DÉCISION DU RÉGIME (obligatoire — le champ "regime") : le régime n'est PAS un ressenti, il se DÉDUIT de la balance de la hiérarchie de drivers ci-dessus. Procède explicitement :
1. Note chacun des 4 drivers prioritaires — (a) taux réels + liquidité globale, (b) crédit HY + MOVE, (c) flux ETF spot, (d) extrêmes de positionnement/sentiment — comme SOUTIEN au risque, VENT DE FACE, ou NEUTRE, en tenant compte de sa TENDANCE (pas seulement du niveau).
2. Le driver (a) prime (poids double), puis (b), (c), (d). Fais la balance.
3. Balance nette au SOUTIEN → "risk-on". Nette au VENT DE FACE → "risk-off".
4. "neutre/transition" est réservé à DEUX cas et à eux seuls : soit les drivers prioritaires se CONTREDISENT réellement (ex. (a) vent de face mais (c) soutien fort), soit ils sont tous proches du neutre. Si tu choisis "neutre/transition", tu DOIS nommer dans "resume" QUELS drivers s'opposent (ou sont atones) et pourquoi tu ne tranches pas. Un "neutre" de prudence, sans opposition explicite nommée, est INTERDIT — prends parti dès que la balance penche, même modérément.
5. CONFIANCE = degré d'ALIGNEMENT des drivers, PAS ton aisance : 4/4 alignés → 0.75-0.90 ; 3/4 → 0.55-0.70 ; balance partagée → 0.35-0.50 ; contradiction franche → 0.15-0.30. Ne bride pas la confiance quand les drivers s'alignent nettement.

RÈGLES STRICTES :
- NE PRÉDIS PAS le prix : aucun objectif de cours, aucun "BTC va monter/baisser". Les marchés sont imprévisibles à court terme. Raisonne en SCÉNARIOS CONDITIONNELS et en ASYMÉTRIE.
- INTERPRÈTE, ne répète pas. Ne dis jamais juste "DXY à 120" : dis ce que ça SIGNIFIE ("dollar fort = conditions restrictives, vent de face pour le risque"). Chaque chiffre doit être accompagné de sa lecture.
- Ancre CHAQUE affirmation dans une donnée précise fournie (cite le chiffre et sa variation). N'invente AUCUNE donnée. Si une source est stale/indisponible, écris-le explicitement et n'extrapole pas.
- Privilégie les DYNAMIQUES (tendances) aux niveaux bruts, et CROISE les axes (ex. dollar fort + peur extrême + funding neutre = quelle lecture combinée).
- CONTEXTE HISTORIQUE : quand une métrique est annotée [pXX/5a] (rang percentile sur ~5 ans), interprète son NIVEAU via ce percentile — p<10 = extrême bas, p>90 = extrême haut. Un EXTRÊME est bien plus significatif qu'un niveau médian (mean reversion, capitulation, euphorie). FAIS REMONTER ce percentile dans le champ "valeur" de chaque signal_cle concerné (ex. "VIX 18,4 — p53/5a médian").
- Sois concret et spécifique : cite des news/événements précis quand c'est pertinent.
- SURPRISES ÉCO : pour un indicateur PUBLIÉ, ce qui meut les marchés est l'écart RÉEL vs PRÉVISION (consensus) — pas le niveau brut. Exploite la "surprise" fournie (ex. inflation au-dessus du consensus = pression haussière sur les taux = vent de face pour le risque ; emploi/croissance sous le consensus = ralentissement). Pour les events À VENIR, identifie les catalyseurs majeurs (FOMC, CPI, NFP) et le consensus attendu.
- RÉACTION AUX SURPRISES (2e ordre) : croise la DERNIÈRE surprise éco majeure avec la variation 24h des taux/du dollar. Une réaction CONTRE-INTUITIVE est un signal de régime plus fort que la surprise elle-même : des taux longs qui MONTENT le jour d'une mauvaise nouvelle emploi/croissance = le marché price une PRIME (de terme/fiscale) et non la croissance — nomme-le explicitement. De même, un dollar qui ne baisse pas sur une surprise dovish = demande de refuge.
- CORRÉLATIONS CASSÉES : vérifie les corrélations classiques — or INVERSE aux taux réels, BTC vs liquidité globale, actions vs VIX. Quand une corrélation historique est CASSÉE (ex. or qui monte AVEC des taux réels à p90+ = couverture fiscale/débasement, plus un trade de taux), c'est un changement de régime : signale-le dans "correlations" avec sa lecture.
- PRÉCISION FACTUELLE : ne qualifie JAMAIS une tendance à contre-sens de la variation fournie (si la liquidité affiche +0.15% sur 24h, elle "se stabilise/progresse légèrement", elle ne "se contracte" pas). Si tu anticipes un retournement de tendance, distingue explicitement le CONSTAT (le chiffre) de l'ANTICIPATION (ta projection).
- VULGARISATION : remplis "pour_debutants" dans un langage SIMPLE et synthétique — un proche non-initié doit comprendre la situation et s'il faut être serein ou prudent. Évite les chiffres bruts. Donne une "posture" claire (défensif/neutre/opportuniste-prudent) et "a_eviter" (le piège du moment). Ce N'EST PAS du daytrading : aucune entrée/sortie, seulement une posture d'investisseur prudent.
- CONSEILS : donne 2-3 conseils CONCRETS et PRUDENTS adaptés au régime actuel — orientés gestion du risque, dimensionnement/exposition, patience, et indicateurs à surveiller. JAMAIS d'objectif de prix, JAMAIS "achète/vends maintenant". Ce sont des éclairages pour décider, PAS une recommandation financière.
- HORIZON & INVALIDATION : précise TOUJOURS l'HORIZON de validité de ta lecture (swing : quelques jours à semaines, jamais intraday) et les conditions concrètes d'INVALIDATION (ce qui te ferait changer d'avis). C'est ce qui permet à l'utilisateur de savoir QUAND ta lecture ne tient plus.
- PISTES PAR CLASSE (éducatif, PAS une reco) : remplis "pistes_par_classe" en mappant le RÉGIME ACTUEL vers les CATÉGORIES d'actifs qui l'expriment — "favorisees" (celles que ce climat soutient) et "sous_pression" (celles qu'il pénalise). Donne des GENRES de véhicules représentatifs (types d'ETF, classes de cryptos, secteurs/actions, or, cash/obligations…), JAMAIS un ordre d'achat/vente, JAMAIS de timing, JAMAIS d'objectif de prix, JAMAIS de pourcentage d'allocation. Chaque entrée doit être ANCRÉE sur le régime et les signaux fournis (cite le pourquoi). C'est une illustration pédagogique de "à quoi ressemble ce régime", pas un conseil financier personnalisé.
- Exprime ton incertitude via "confiance" (0 à 1).
- Réponds en français.

Réponds UNIQUEMENT par un objet JSON valide, sans texte autour, selon ce schéma EXACT :
{
  "resume": "TL;DR percutant en 1-2 phrases : le régime et le message principal",
  "regime": "risk-on" | "risk-off" | "neutre/transition",
  "confiance": 0.0,
  "niveau_de_risque": "faible" | "modéré" | "élevé",
  "lecture_par_axe": {
    "sentiment": "Fear&Greed, funding BTC/ETH/SOL, DVOL (vol implicite), ratio long/short BTC ET DÉRIVÉS AGRÉGÉS Coinglass (funding pondéré OI, open interest total + tendance 7j, retail vs top-traders, liquidations 24h) ; lis funding et retail en CONTRARIAN (foule longue = risque de purge), SUIS les top-traders (smart money), souligne toute DIVERGENCE retail vs top-traders et tout excès de funding ; les whales Hyperliquid CORROBORENT les top-traders (même cohorte, autre venue) — convergence = conviction, divergence = signal, JAMAIS un driver indépendant",
    "positionnement": "COT MULTI-ACTIFS : net spéculatif BTC + forex (EUR/JPY/GBP) + actions (S&P500/Nasdaq) + or/pétrole ; souligne les extrêmes de positionnement (percentile)",
    "macro": "taux nominaux/réels, courbe, crédit, conditions/stress, incertitude, dollar/FX, éco réelle (avec percentiles)",
    "liquidite": "liquidité nette Fed ET liquidité GLOBALE (Fed+BCE+BoJ), niveau ET tendance, implication pour le risque/BTC",
    "marches_tradfi": "lecture S&P500/Nasdaq/VIX et alignement avec BTC",
    "matieres_premieres": "...",
    "structure_crypto": "dominance BTC/ETH, TOTAL2/TOTAL3 (force des alts) ET volume 24h comme CONVICTION (un mouvement de prix sans volume est suspect)",
    "onchain": "TVL, stablecoins (poudre sèche), hashrate, activité réseau BTC (transactions 24h + frais/congestion mempool), ET la VALORISATION DE CYCLE : MVRV Z-Score, position de cycle 0-100, Puell, prix réalisé — situe le BTC dans son cycle (creux/accumulation vs sommet/distribution) comme contexte de fond",
    "geopolitique": "..."
  },
  "signaux_cles": [
    { "donnee": "ex. Dollar Index", "valeur": "120.4 (24h +0.3%, p53/5a médian)", "lecture": "ce que ça implique concrètement" }
  ],
  "ce_qui_a_change": ["évolutions notables des tendances 24h/7j, ou [] si pas d'historique"],
  "test_invalidation": { "conditions_remplies": false, "detail": "UNIQUEMENT si un VERDICT PRÉCÉDENT est fourni : évalue CHAQUE condition d'invalidation déclarée avec le chiffre actuel (ex. 'VIX<20 : rempli (16.6) ; HY>4% : non rempli (2.75%)') — omets ce champ sinon" },
  "correlations": ["CROSS-MARKET explicite : BTC vs S&P500/Nasdaq (alignement risk-on ?), BTC vs VIX (inverse ?), BTC vs or/DXY/10Y, OR vs TAUX RÉELS (inverse classique — cassée = régime fiscal), et toute DIVERGENCE ou corrélation CASSÉE notable"],
  "signaux_contradictoires": ["les tensions RÉELLES non résolues entre données majeures, avec la question qu'elles posent (ex. 'actions p99 vs NFP 57k vs crédit HY p14 serré — le marché ignore-t-il le ralentissement ou le crédit a-t-il raison ?') — liste-les honnêtement au lieu de les trancher artificiellement ; [] si le tableau est cohérent"],
  "scenarios": [
    { "nom": "nom court", "condition": "ce qui devrait se produire", "consequence": "ce que ça impliquerait", "surveiller": "l'indicateur à surveiller", "probabilite_relative": "faible" | "moyenne" | "élevée" }
  ],
  "catalyseurs_a_venir": [
    { "date": "AAAA-MM-JJ", "evenement": "ex. CPI", "enjeu": "pourquoi ça compte pour le risque" }
  ],
  "asymetrie": "où penche le rapport risque/récompense et pourquoi",
  "horizon": "l'échelle de temps sur laquelle cette lecture est pertinente (ex. 'quelques jours à 2-3 semaines', swing) — JAMAIS de l'intraday",
  "invalidation": "la/les condition(s) CONCRÈTE(S) et OBSERVABLE(S) qui annuleraient ce régime / te feraient changer d'avis (ex. 'la liquidité nette repasse en expansion', 'le VIX retombe sous 15', 'le 10Y réel dépasse 2,5%')",
  "alertes": ["bascule notable détectée dans les données, ou [] si rien de notable"],
  "pour_debutants": {
    "en_bref": "explication TRÈS simple de la situation en 2-3 phrases, SANS jargon (comme à un proche non-initié) : ce que 'risk-on/off' veut dire ici concrètement, et s'il faut plutôt être serein ou prudent",
    "posture": "défensif" | "neutre" | "opportuniste-prudent",
    "a_eviter": "le piège typique du moment pour un débutant (ex. acheter dans l'euphorie, paniquer sur un creux, surutiliser le levier) — formulé simplement",
    "pistes_simples": "en langage simple : quels GENRES d'actifs ce climat favorise vs lesquels souffrent (ex. 'climat prudent : plutôt cash/or, prudence sur les cryptos à forte volatilité') — éducatif, PAS un ordre d'achat"
  },
  "conseils": [
    { "conseil": "action PRUDENTE adaptée au régime (gestion du risque / exposition / patience / ce qu'il faut surveiller)", "pourquoi": "le lien explicite avec les données actuelles", "prudence": "la nuance ou le risque à garder en tête" }
  ],
  "pistes_par_classe": {
    "favorisees": [
      { "categorie": "ex. Or / métaux précieux", "exemples": "types de véhicules représentatifs (ETF type GLD/IAU, or physique, crypto, action/secteur…)", "pourquoi": "le lien EXPLICITE avec le régime/les signaux actuels" }
    ],
    "sous_pression": [
      { "categorie": "ex. Altcoins à fort beta", "exemples": "types de véhicules représentatifs", "pourquoi": "pourquoi ce climat les pénalise" }
    ]
  }
}

Vise 3 signaux_cles minimum (avec percentile dans "valeur" quand disponible), 3 scénarios (haussier/baissier/médian), 2-3 conseils, un bloc pour_debutants complet (en_bref + posture + a_eviter + pistes_simples), 2-3 entrées dans pistes_par_classe.favorisees ET sous_pression, 1-3 signaux_contradictoires si le tableau est tendu, et remplis lecture_par_axe pour CHAQUE axe disponible.`;

/**
 * Suffixe de tendance d'une métrique pour le prompt : variations 24h et 7j.
 * @param {object} trends Tendances (getTrends).
 * @param {string} key Clé de la métrique.
 * @returns {string} Ex. " (24h +1.20%, 7j -0.40%)", ou "" si pas de delta.
 */
function fmtTrend(trends, key) {
  const m = trends?.metrics?.[key];
  if (!m) return "";
  const parts = [];
  for (const [label, hk] of [["24h", "d24h"], ["7j", "d7d"]]) {
    const d = m[hk];
    if (d && d.pct != null) parts.push(`${label} ${d.abs >= 0 ? "+" : ""}${d.pct.toFixed(2)}%`);
  }
  return parts.length ? ` (${parts.join(", ")})` : "";
}

/**
 * Suffixe de contexte historique pour le prompt : rang percentile (vs ~5 ans)
 * + label qualitatif.
 * @param {object} trends Tendances (getTrends).
 * @param {string} key Clé de la métrique.
 * @returns {string} Ex. " [p92/5a, très haut]", ou "" si pas de baseline.
 */
function fmtNorm(trends, key) {
  const m = trends?.metrics?.[key];
  if (!m || m.pctRank == null) return "";
  const p = m.pctRank;

  let label = "médian";
  if (p <= 10) label = "très bas";
  else if (p <= 30) label = "bas";
  else if (p >= 90) label = "très haut";
  else if (p >= 70) label = "haut";

  return ` [p${p}/5a, ${label}]`;
}

/**
 * Arrondi compact pour le prompt : évite les flottants à rallonge (gaspillage
 * de tokens + bruit). Laisse passer les non-nombres tels quels.
 * @param {*} n Valeur à arrondir.
 * @param {number} [d] Nombre de décimales.
 * @returns {*} Nombre arrondi, ou la valeur d'origine si non-nombre.
 */
function r(n, d = 2) {
  if (typeof n === "number" && isFinite(n)) return Number(n.toFixed(d));
  return n;
}

/**
 * Abrège les grosses magnitudes en T/Md/M pour le prompt
 * (ex. 2118994149230.84 -> "2.12 T").
 * @param {*} n Valeur à abréger.
 * @returns {*} Chaîne abrégée, ou la valeur d'origine si non-nombre.
 */
function big(n) {
  if (typeof n !== "number" || !isFinite(n)) return n;
  const a = Math.abs(n);
  if (a >= 1e12) return `${r(n / 1e12, 2)} T`;
  if (a >= 1e9) return `${r(n / 1e9, 1)} Md`;
  if (a >= 1e6) return `${r(n / 1e6, 0)} M`;
  return String(r(n, 0));
}

/**
 * Ligne "probabilités FOMC" pour le prompt, calculée depuis les contrats ZQ du
 * snapshot (même logique que la route /api/fed). Renvoie null si indisponible.
 * @param {object} fedwatch Données fedwatch du snapshot ({ contracts }).
 * @param {number} fedFunds Taux Fed Funds (EFFR) de repli.
 * @param {Array<object>} events Événements calendrier (pour dater la réunion).
 * @returns {string|null} Ligne formatée, ou null.
 */
function formatFedWatch(fedwatch, fedFunds, events) {
  if (!fedwatch?.contracts?.length || fedFunds == null) return null;
  const meeting = nextFomcMeeting(new Date(), events);
  if (!meeting) return null;

  const isDecember = meeting.month === 12;
  const nextYear = isDecember ? meeting.year + 1 : meeting.year;
  const nextMonth = isDecember ? 1 : meeting.month + 1;
  const meetingImplied = impliedRateFor(fedwatch.contracts, meeting.year, meeting.month);
  const nextImplied = impliedRateFor(fedwatch.contracts, nextYear, nextMonth);
  const startRate = fedStartRate({ meeting, contracts: fedwatch.contracts, fallbackRate: fedFunds });
  const probas = computeFedProbabilities({ meeting, startRate, meetingImplied, nextImplied });
  if (!probas) return null;

  const pct = Math.round(probas.proba * 100);
  const dominant = probas.issues[0];
  const mouvement = probas.biais === "statu quo" ? "statu quo" : `${probas.biais} de ${Math.abs(dominant.mouvementBps)} bps`;
  const jour = `${meeting.year}-${String(meeting.month).padStart(2, "0")}-${String(meeting.day).padStart(2, "0")}`;
  return `- Probabilités FOMC (fedwatch, futures ZQ, réunion ${jour}) : ${pct}% ${mouvement} — le mouvement de taux PRICÉ pour la prochaine décision (biais monétaire plus précis que le proxy de courbe).`;
}

/**
 * Ligne "dérivés agrégés" (Coinglass cross-exchange) pour le prompt.
 * @param {object} der Dérivés du snapshot (axes.structure.derivatives).
 * @param {object} trends Tendances (pour annoter funding et top-traders).
 * @returns {string} Ligne formatée.
 */
function formatDerivatives(der, trends) {
  const oi7 = der.oiVariation7jPct;
  const oi7txt = oi7 != null ? `${oi7 > 0 ? "+" : ""}${oi7}%` : "?";
  const liq = der.liquidations24h?.totalUsd;
  return `- Dérivés agrégés (Coinglass cross-exchange) : funding ${der.fundingPct}%${fmtTrend(trends, "fundingAgg")} · OI total ${big(der.openInterestUsd)} $ (7j ${oi7txt}) · long/short retail ${der.longShortRatio} vs TOP-TRADERS ${der.longShortTopTraders}${fmtTrend(trends, "lsTopTraders")} (smart money — suivre, divergence = signal) · liquidations 24h ${big(liq)} $ (long ${big(der.liquidations24h?.longUsd)} / short ${big(der.liquidations24h?.shortUsd)}). Funding très positif + retail crowded long = risque de purge ; OI qui gonfle = levier accumulé.`;
}

/**
 * Met en forme le world-state + tendances en texte compact pour le LLM
 * (message utilisateur). PROMPT FIGÉ : toute modification relève du protocole
 * anti-overfitting (défaut de démarrage daté uniquement).
 * @param {object} state World-state complet.
 * @param {object} trends Tendances (getTrends).
 * @returns {string} Message utilisateur complet.
 */
export function formatState(state, trends) {
  const a = state.axes ?? {};
  const L = [];
  const push = (s) => L.push(s);

  push(`# CONTEXTE MARCHÉ — ${new Date(state.ts).toISOString()}`);
  if (state.meta?.staleSources?.length) push(`Sources indisponibles (stale) : ${state.meta.staleSources.join(", ")}`);

  const fg = a.sentiment?.["fear-greed"];
  const fut = a.sentiment?.["binance-futures"];
  const dvol = a.sentiment?.deribit;
  push(`\n## SENTIMENT`);
  if (fg) push(`- Fear & Greed : ${fg.value} (${fg.classification})${fmtTrend(trends, "fearGreed")}${fmtNorm(trends, "fearGreed")}, précédent ${fg.previousValue}`);
  if (fut) push(`- Funding BTCUSDT : ${fut.lastFundingRate}${fmtTrend(trends, "funding")} · Open Interest : ${fut.openInterest}${fmtTrend(trends, "openInterest")} · prix ${fut.markPrice}${fmtTrend(trends, "btcPrice")}`);
  if (fut?.eth) push(`- Funding ETHUSDT : ${fut.eth.lastFundingRate}${fmtTrend(trends, "ethFunding")} · OI : ${fut.eth.openInterest} · prix ${fut.eth.markPrice}${fmtTrend(trends, "ethPrice")}`);
  if (fut?.sol) push(`- Funding SOLUSDT : ${fut.sol.lastFundingRate}${fmtTrend(trends, "solFunding")} · OI : ${fut.sol.openInterest} · prix ${fut.sol.markPrice}${fmtTrend(trends, "solPrice")}`);
  if (fut?.bnb || fut?.xrp) push(`- Autres alts : BNB prix ${fut.bnb?.markPrice}${fmtTrend(trends, "bnbPrice")} (funding ${fut.bnb?.lastFundingRate}) · XRP prix ${fut.xrp?.markPrice}${fmtTrend(trends, "xrpPrice")} (funding ${fut.xrp?.lastFundingRate})`);
  if (dvol) push(`- DVOL (vol implicite BTC, "VIX crypto") : ${dvol.dvol}${fmtTrend(trends, "dvol")}`);
  if (dvol?.btc)
    push(
      `- Options BTC : skew ${dvol.btc.skew ?? "?"}${fmtTrend(trends, "btcSkew")} (>0 = puts chers = peur crash, contrarian) · Put/Call OI ${dvol.btc.putCallOI ?? "?"}${fmtTrend(trends, "btcPutCall")}`,
    );
  if (dvol?.eth)
    push(
      `- Options ETH : DVOL ${dvol.eth.dvol ?? "?"}${fmtTrend(trends, "ethDvol")} · skew ${dvol.eth.skew ?? "?"}${fmtTrend(trends, "ethSkew")} · Put/Call OI ${dvol.eth.putCallOI ?? "?"}${fmtTrend(trends, "ethPutCall")} (divergence skew BTC vs ETH = signal)`,
    );
  if (fut?.longShortAccountRatio != null) push(`- Ratio long/short BTC : foule ${fut.longShortAccountRatio}${fmtTrend(trends, "longShortAccountRatio")} · gros traders ${fut.topPositionRatio ?? "?"} (>1 = majorité long ; extrême/divergence = signal contrarian)`);
  if (fut?.basis?.annualizedPct != null)
    push(
      `- Basis futures BTC (trimestriel, annualisé) : ${fut.basis.annualizedPct > 0 ? "+" : ""}${fut.basis.annualizedPct}%/an${fmtTrend(trends, "btcBasisAnnualized")}${fmtNorm(trends, "btcBasisAnnualized")} — jauge de levier/demande spéculative plus propre que le funding : >10%/an = euphorie (levier long en excès), ~0 = désintérêt, NÉGATIF (backwardation) = capitulation/stress. Croise avec le funding : basis bas + funding neutre = marché purgé (terrain de creux) ; basis haut + funding chaud = excès.`,
    );
  const derivatives = a.structure?.derivatives;
  if (derivatives?.openInterestUsd != null) push(formatDerivatives(derivatives, trends));
  const whales = a.structure?.whales;
  if (whales?.longPct != null)
    push(`- Whales Hyperliquid (gros comptes) : ${whales.longPct}% long${fmtTrend(trends, "whalesLongPct")} / ${whales.shortPct}% short (${big(whales.positionUsd)} $ de positions) — à lire en CORROBORATION des top-traders Binance (même cohorte smart money, venue différente) : convergence = conviction du positionnement smart money ; divergence = signal. NE le compte PAS comme un driver indépendant (évite le double-compte avec le long/short top-traders).`);

  const cot = a.positioning?.["cftc-cot"];
  push(`\n## POSITIONNEMENT (CFTC COT, net spéculatif, ${cot?.date ?? "?"})`);
  if (cot?.hedgeFundsNet != null) {
    push(`- BTC : hedge funds net ${cot.hedgeFundsNet}${fmtTrend(trends, "cotHedgeFundsNet")}${fmtNorm(trends, "cotHedgeFundsNet")} · institutionnels net ${cot.assetMgrNet}`);
    const mk = cot.markets || {};
    const line = (lbl, key, mkey) => (mk[mkey]?.specNet != null ? `${lbl} ${mk[mkey].specNet}${fmtNorm(trends, key)}` : null);
    const fx = [line("EUR", "cotEurNet", "eurFx"), line("JPY", "cotJpyNet", "jpy"), line("GBP", "cotGbpNet", "gbp")].filter(Boolean);
    const eq = [line("S&P500", "cotSp500Net", "sp500"), line("Nasdaq", "cotNasdaqNet", "nasdaq")].filter(Boolean);
    const cm = [line("Or", "cotGoldNet", "gold"), line("WTI", "cotWtiNet", "wti")].filter(Boolean);
    if (fx.length) push(`- Forex : ${fx.join(" · ")}`);
    if (eq.length) push(`- Actions : ${eq.join(" · ")}`);
    if (cm.length) push(`- Matières : ${cm.join(" · ")}`);
  } else push(`- (stale)`);

  const fred = a.macro?.fred;
  push(`\n## MACRO`);
  if (fred) {
    push(`- M2 : ${fred.m2?.value}${fred.m2?.yoy != null ? ` (rythme ${fred.m2.yoy > 0 ? "+" : ""}${fred.m2.yoy}%/an${fmtNorm(trends, "m2YoY")})` : ""} · Dollar Index : ${fred.dollarIndex?.value}${fmtTrend(trends, "dxy")}${fmtNorm(trends, "dxy")}`);
    push(`- FX : EUR/USD ${fred.eurusd?.value} · USD/JPY ${fred.usdjpy?.value} · USD/CNY ${fred.usdcny?.value}${fmtTrend(trends, "usdcny")}${fmtNorm(trends, "usdcny")} (yuan qui dévalue = stress Chine) · émergents BRL ${fred.brlusd?.value}/MXN ${fred.mxnusd?.value}/INR ${fred.inrusd?.value}/ZAR ${fred.zarusd?.value}`);
    push(`- Taux : 2Y ${fred.yield2y?.value}% · 10Y nominal ${fred.yield10y?.value}%${fmtTrend(trends, "yield10y")}${fmtNorm(trends, "yield10y")} · 10Y réel ${fred.realYield10y?.value}%${fmtTrend(trends, "realYield10y")}${fmtNorm(trends, "realYield10y")} · point mort inflation ${fred.breakeven10y?.value}% · courbe 10Y-2Y ${fred.yieldCurve?.value}${fmtNorm(trends, "yieldCurve")} · Fed Funds ${fred.fedFunds?.value}% · SOFR ${fred.sofr?.value}% · mortgage 30Y ${fred.mortgage30y?.value}%`);
    if (fred.yield2y?.value != null && fred.fedFunds?.value != null) {
      const ps = Math.round((fred.yield2y.value - fred.fedFunds.value) * 100) / 100;
      push(`- Attentes de politique (2Y − Fed Funds) : ${ps > 0 ? "+" : ""}${ps} pt${fmtNorm(trends, "policySpread2y")} — < 0 = baisses pricées ; > 0 = PAS de baisses pricées. Croise avec l'éco réelle : une éco qui casse SANS baisses pricées = la Fed est perçue comme coincée (prime de terme/fiscale), vent de face durable pour le risque.`);
    }
    const fedWatchLine = formatFedWatch(a.macro?.fedwatch, fred.fedFunds?.value, a.macro?.["nasdaq-calendar"]?.events);
    if (fedWatchLine) push(fedWatchLine);
    if (fred.yield10y?.value != null && fred.breakeven10y?.value != null) {
      push(`- Décomposition du 10Y : quand les nominaux MONTENT avec des breakevens qui BAISSENT sur une mauvaise nouvelle éco, c'est un choc de taux RÉELS (prime de terme/fiscale), pas d'inflation — le régime le plus défavorable aux actifs de duration et sans rendement. Signale-le explicitement si observé dans les tendances.`);
    }
    push(`- Conditions/risque : spread HY ${fred.highYieldSpread?.value}%${fmtTrend(trends, "highYieldSpread")}${fmtNorm(trends, "highYieldSpread")} · conditions fin. (NFCI) ${fred.financialConditions?.value} · stress (StLouis) ${fred.financialStress?.value}${fmtNorm(trends, "financialStress")} · incertitude politique (EPU) ${fred.policyUncertainty?.value}${fmtTrend(trends, "policyUncertainty")}. LE CRÉDIT D'ABORD : le HY qui s'écarte pendant que les actions tiennent = les actions mentent, le crédit a raison (il casse en premier dans chaque cycle) ; HY serré = pas de stress systémique même si les actions corrigent.`);
    push(`- Éco réelle : inflation CPI ${fred.cpi?.yoy != null ? `${fred.cpi.yoy}%/an${fmtNorm(trends, "cpiYoY")}` : `(index ${fred.cpi?.value})`} · PCE ${fred.pce?.yoy != null ? `${fred.pce.yoy}%/an${fmtNorm(trends, "pceYoY")}` : `(index ${fred.pce?.value})`} · ventes détail ${fred.retailSales?.yoy != null ? `${fred.retailSales.yoy > 0 ? "+" : ""}${fred.retailSales.yoy}%/an${fmtNorm(trends, "retailSalesYoY")}` : fred.retailSales?.value} · sentiment conso ${fred.consumerSentiment?.value}${fmtNorm(trends, "consumerSentiment")} · chômage ${fred.unemployment?.value}% · indice prix alimentaires (IMF) ${r(fred.foodPriceIndex?.value, 1)}`);
    if (fred.initialClaims?.value != null)
      push(`- Inscriptions chômage HEBDO (claims) : ${fred.initialClaims.value}${fmtTrend(trends, "initialClaims")}${fmtNorm(trends, "initialClaims")} — le signal récession TEMPS RÉEL : une tendance haussière soutenue des claims confirme (ou infirme) la faiblesse du NFP mensuel AVANT la prochaine publication. Croise-les : NFP faible + claims stables = à-coup ; NFP faible + claims qui montent = dégradation réelle.`);
  } else push(`- (stale)`);

  const liq = a.liquidity?.liquidity;
  push(`\n## LIQUIDITÉ (driver clé)`);
  if (liq?.netLiquidity) {
    push(`- Liquidité nette Fed : ${liq.netLiquidity.value?.toFixed?.(0)} Md$${fmtTrend(trends, "netLiquidity")} = bilan Fed ${liq.fedBalanceSheet?.value?.toFixed?.(0)} − RRP ${liq.reverseRepo?.value?.toFixed?.(0)} − TGA ${liq.tga?.value?.toFixed?.(0)}`);
    if (liq.globalLiquidity) {
      push(`- Liquidité GLOBALE : ${liq.globalLiquidity.value?.toFixed?.(0)} Md$${fmtTrend(trends, "globalLiquidity")} = Fed nette + BCE ${liq.ecbAssets?.value?.toFixed?.(0)} + BoJ ${liq.bojAssets?.value?.toFixed?.(0)} (le BTC suit la liquidité mondiale)`);
    }
    // Lecture PLOMBERIE : le niveau du RRP et du TGA changent le RÉGIME de
    // liquidité, pas seulement son niveau — donne l'interprétation à l'IA.
    const rrp = liq.reverseRepo?.value;
    const tga = liq.tga?.value;
    if (rrp != null && rrp < 100) {
      push(`- PLOMBERIE : RRP quasi épuisé (${rrp.toFixed(0)} Md$) — le coussin qui amortissait le drain de liquidité est CONSOMMÉ : tout resserrement/émission tape désormais directement les réserves (liquidité plus fragile qu'avant à niveau égal).${tga != null ? ` TGA ${tga.toFixed(0)} Md$ : ${tga > 750 ? "élevé — réserve de liquidité POTENTIELLE (un drawdown TGA = injection), mais drain s'il continue de se remplir" : "niveau moyen"}.` : ""}`);
    }
  } else push(`- (stale)`);

  const com = a.commodities?.commodities;
  const met = a.commodities?.metals;
  if (com) push(`\n## MATIÈRES PREMIÈRES\n- Énergie : WTI ${com.wtiOil?.value}${fmtTrend(trends, "wtiOil")}${fmtNorm(trends, "wtiOil")} · Brent ${com.brentOil?.value} · Gaz ${com.natGas?.value}\n- Métaux : Or ${r(met?.gold?.value, 1)}${fmtTrend(trends, "gold")} · Argent ${r(met?.silver?.value, 1)} · Cuivre ${r(com.copper?.value, 0)}${fmtNorm(trends, "copper")} (Dr Copper) · Blé ${r(com.wheat?.value, 1)}`);
  if (com && met?.gold?.value && com.copper?.value)
    push(`- Ratio Cuivre/Or${fmtTrend(trends, "copperGoldRatio")} : baromètre croissance-vs-peur (échelle arbitraire, lis la TENDANCE) — en HAUSSE = réflation/appétit pour le risque (haussier cycliques et risque) ; en BAISSE = fuite vers le refuge, ralentissement anticipé (risk-off). Croise avec le sens du 10Y réel et de l'or.`);

  const mk = a.markets?.markets;
  if (mk) push(`\n## MARCHÉS TRADFI (clôture J-1)\n- S&P500 : ${mk.sp500?.value}${fmtTrend(trends, "sp500")}${fmtNorm(trends, "sp500")} · Nasdaq : ${mk.nasdaq?.value}${fmtTrend(trends, "nasdaq")} · Dow : ${mk.djia?.value} · VIX : ${mk.vix?.value}${fmtTrend(trends, "vix")}${fmtNorm(trends, "vix")}${mk.cboeSkew?.value != null ? ` · CBOE SKEW : ${mk.cboeSkew.value}${fmtTrend(trends, "cboeSkew")}${fmtNorm(trends, "cboeSkew")} (↑ = hedge crash)` : ""}${mk.move?.value != null ? ` · MOVE (vol des taux) : ${mk.move.value}${fmtTrend(trends, "move")} — compare-le au VIX : MOVE élevé avec VIX bas = le stress est dans les TAUX, pas encore transmis aux actions (typique d'un régime fiscal/prime de terme) ; les deux élevés = stress systémique` : ""}`);

  const mkLive = a.markets?.["markets-live"];
  if (mkLive) {
    const parts = Object.entries(mkLive)
      .filter(([, v]) => v)
      .map(([sym, v]) => `${sym} ${v.value}`);
    if (parts.length) push(`## MARCHÉS TEMPS RÉEL (intraday) : ${parts.join(" · ")}`);
  }

  const cg = a.structure?.coingecko;
  if (cg) {
    push(`\n## STRUCTURE CRYPTO`);
    push(`- Dominance BTC : ${cg.btcDominance?.toFixed?.(2)}%${fmtTrend(trends, "btcDominance")} · ETH : ${cg.ethDominance?.toFixed?.(2)}% · ETH/BTC : ${r(cg.ethBtcRatio, 4)}${fmtTrend(trends, "ethBtcRatio")}`);
    push(`- Mcap total : ${big(cg.totalMarketCapUsd)} $${fmtTrend(trends, "totalMarketCapUsd")} · TOTAL2 (alts hors BTC) : ${big(cg.altMarketCapUsd)} $${fmtTrend(trends, "altMarketCapUsd")} · TOTAL3 (hors BTC+ETH) : ${big(cg.total3MarketCapUsd)} $${fmtTrend(trends, "total3MarketCapUsd")}`);
    if (cg.totalVolume24hUsd != null) push(`- Volume 24h global : ${big(cg.totalVolume24hUsd)} $${fmtTrend(trends, "totalVolume24hUsd")} (conviction : un mouvement sans volume est suspect)`);
  }

  // Flux ETF spot US : l'ACHETEUR MARGINAL du BTC depuis 2024 — pondère fort.
  const ef = a.structure?.["etf-flows"];
  if (ef?.btc || ef?.eth) {
    const fm = (v) => (v == null ? "?" : `${v > 0 ? "+" : ""}${v} M$`);
    if (ef.btc)
      push(`- Flux ETF spot BTC (${ef.btc.date}) : jour ${fm(ef.btc.dayFlowUsdM)}${fmtTrend(trends, "btcEtfFlowUsdM")} · 7j cumulés ${fm(ef.btc.flow7dUsdM)} · encours ${ef.btc.totalAssetsUsdM != null ? Math.round(ef.btc.totalAssetsUsdM / 1000) + " Md$" : "?"} (entrées = demande institutionnelle RÉELLE ; sorties massives = distribution)`);
    if (ef.eth)
      push(`- Flux ETF spot ETH (${ef.eth.date}) : jour ${fm(ef.eth.dayFlowUsdM)}${fmtTrend(trends, "ethEtfFlowUsdM")} · 7j cumulés ${fm(ef.eth.flow7dUsdM)} (divergence vs BTC = rotation institutionnelle)`);
  }

  const dl = a.onchain?.defillama;
  const ch = a.onchain?.["blockchain-info"];
  const mp = a.onchain?.mempool;
  push(`\n## ON-CHAIN`);
  if (dl) push(`- TVL DeFi : ${big(dl.totalTvlUsd)} $${fmtTrend(trends, "totalTvlUsd")} · Stablecoins : ${big(dl.stablecoinMcapUsd)} $${fmtTrend(trends, "stablecoinMcapUsd")}`);
  if (ch) push(`- Hashrate : ${big(ch.hashRate)}${fmtTrend(trends, "hashRate")} · Transactions 24h : ${ch.nTx}${fmtTrend(trends, "txCount24h")}`);
  if (mp) push(`- Réseau BTC : frais rapides ${mp.feeFast} sat/vB${fmtTrend(trends, "mempoolFeeFast")} · mempool ${mp.mempoolCount} tx en attente${fmtTrend(trends, "mempoolCount")} (congestion = demande réelle de blockspace)`);

  const val = a.onchain?.valuation;
  const cyc = a.onchain?.cycle;
  const bmpro = a.onchain?.bmpro;
  if (val?.position != null || cyc?.position != null || bmpro?.rhodl?.valeur != null) {
    push(`\n## VALORISATION / CYCLE (contexte structurel long terme)`);
    if (val?.position != null)
      push(`- Valo on-chain : MVRV ${r(val.mvrv?.valeur, 2)} (${val.mvrv?.statut}) · MVRV Z-Score ${r(val.mvrvZ?.valeur, 2)}${fmtTrend(trends, "mvrvZ")} (${val.mvrvZ?.statut}) · NUPL ${r(val.nupl?.valeur, 2)} · Puell ${r(val.puell?.valeur, 2)} (${val.puell?.statut}) · prix réalisé ${big(val.realizedPrice)} $ · position ${val.position}/100${fmtTrend(trends, "valuationPosition")} (${val.positionLabel})`);
    if (cyc?.position != null)
      push(`- Cycle prix : Mayer ${r(cyc.mayer?.valeur, 2)} (${cyc.mayer?.statut}) · Pi Cycle ${r(cyc.piCycle?.valeur, 2)} (${cyc.piCycle?.statut}) · 200 sem ${r(cyc.w200?.valeur, 2)} (${cyc.w200?.statut}) · position ${cyc.position}/100${fmtTrend(trends, "cyclePosition")} (${cyc.positionLabel})`);
    if (bmpro?.rhodl?.valeur != null || bmpro?.reserveRisk?.valeur != null)
      push(`- Indicateurs avancés (BMPro) : RHODL ${r(bmpro.rhodl?.valeur, 0)}${fmtTrend(trends, "rhodl")} (${bmpro.rhodl?.statut}) · Reserve Risk ${r(bmpro.reserveRisk?.valeur, 4)}${fmtTrend(trends, "reserveRisk")} (${bmpro.reserveRisk?.statut}) — data on-chain avancée (coût de base par âge, coin-days) ; confirment/nuancent la valo de cycle (creux = accumulation, sommet = distribution).`);
  }

  push(`\n## GÉOPOLITIQUE`);
  const gd = a.geopolitics?.gdelt;
  if (gd?.topHeadlines?.length) {
    push(`Manchettes conflit (GDELT) — volume ${gd.headlineCount}${fmtTrend(trends, "gdeltHeadlines")} :`);
    gd.topHeadlines.slice(0, 10).forEach((h) => push(`- (${h.lang || "?"}) ${h.title}`));
  }
  const ac = a.geopolitics?.acled;
  if (ac?.totalEvents != null) {
    push(`Conflits (ACLED, ${ac.windowDays}j) : ${ac.totalEvents} événements, ${ac.totalFatalities} morts. Top : ${(ac.topCountries || []).map((c) => `${c.country} (${c.fatalities}†)`).join(", ")}`);
  }
  if (!gd?.topHeadlines?.length && ac?.totalEvents == null) push(`- (stale)`);

  // --- CALENDRIER ÉCO : collecteur unique nasdaq-calendar (API nasdaq,
  // repli FairEconomy interne) — multi-pays, heure, précédent/prévision/réel. ---
  const ff = a.macro?.["nasdaq-calendar"];
  const ffEvents = ff?.events || [];
  const hhmm = (ms) => (ms ? new Date(ms).toISOString().slice(11, 16) : "--:--");

  // Résultats publiés = SURPRISE (réel vs prévision).
  const ffDone = ffEvents.filter((e) => e.actual != null);
  if (ffDone.length) {
    push(`\n## RÉSULTATS ÉCO RÉCENTS (réel vs prévision = surprise)`);
    ffDone.forEach((e) => {
      const surp =
        e.surprise != null
          ? ` · surprise ${e.surprise >= 0 ? "+" : ""}${e.surprise} (${e.surprise >= 0 ? "au-dessus" : "sous"} consensus)`
          : "";
      const fc = e.forecast != null ? `, prév ${e.forecast}` : "";
      const pv = e.previous != null ? `, préc ${e.previous}` : "";
      push(`- ${e.date} ${e.country} ${e.event} : réel ${e.actual}${fc}${pv}${surp}`);
    });
  }

  // À venir : prévision + impact, multi-pays (investing.com / FairEconomy).
  // ANTI-BRUIT : on ne garde que les CATALYSEURS — impact [high] (CPI/NFP/FOMC/ISM…)
  // + le [medium] IMMINENT (≤3 j) — et on plafonne. Le reste (discours BCE/BoE
  // répétés, PMI mineurs à 2 semaines) noyait le signal (~50% du prompt) sans
  // rien apporter au verdict swing.
  const UPCOMING_MED_HORIZON_MS = 3 * 86400000;
  const UPCOMING_CAP = 30;
  const ffUp = ffEvents.filter((e) => e.actual == null);
  const ffHighs = ffUp.filter((e) => e.impact === "high"); // TOUS les majeurs, même lointains (CPI/NFP/FOMC à J+14)
  const ffMedImm = ffUp.filter((e) => e.impact !== "high" && e.datetime != null && e.datetime - state.ts <= UPCOMING_MED_HORIZON_MS);
  const ffUpcoming = [...ffHighs, ...ffMedImm] // high prioritaires, on complète avec le medium imminent
    .slice(0, UPCOMING_CAP)
    .sort((a, b) => (a.datetime ?? 0) - (b.datetime ?? 0)); // puis ordre chronologique pour l'affichage
  if (ffUpcoming.length) {
    push(`\n## CALENDRIER ÉCO — À VENIR (catalyseurs [high] + [medium] imminent ≤3j)`);
    ffUpcoming.forEach((e) => {
      const fc = e.forecast != null ? ` (prév ${e.forecast}${e.previous != null ? `, préc ${e.previous}` : ""})` : "";
      push(`- ${e.date} ${hhmm(e.datetime)} ${e.country} ${e.event}${fc} [${e.impact}]`);
    });
  }

  const news = a.news?.news;
  if (news?.items?.length) {
    push(`\n## NEWS (manchettes récentes)`);
    news.items.slice(0, 20).forEach((it) => push(`- (${it.source}) ${it.title}`));
  }

  const gn = a.news?.["google-news"];
  if (gn?.themes) {
    push(`\n## THÈMES SURVEILLÉS (Google News, 1er titre)`);
    for (const [theme, items] of Object.entries(gn.themes)) {
      if (items[0]) push(`- ${theme} : ${items[0].title}`);
    }
  }

  return L.join("\n");
}

/**
 * JSON.parse tolérant : extrait le premier bloc {...} si le modèle a bavardé
 * autour.
 * @param {string|null} raw Réponse brute du LLM.
 * @returns {object|null} Objet parsé, ou null si rien d'exploitable.
 */
export function parseJsonLoose(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Lance l'analyse : formate l'état, appelle les fournisseurs en cascade,
 * parse le verdict et applique les garde-fous déterministes (validateVerdict :
 * objectifs de prix, percentiles non sourcés, extrapolation de source stale).
 * @param {object} state World-state complet.
 * @param {object} trends Tendances (getTrends).
 * @param {{ provider?: object }} [options] Fournisseur imposé (sinon chaîne
 *   par défaut). L'analyse est TOUJOURS à froid : le verdict précédent n'est
 *   plus injecté au modèle (anti-verrou), l'anti-girouette est traité en aval
 *   par l'amortisseur de régime du runner.
 * @returns {Promise<{provider: string, verdict: object|null, raw: string,
 *   prompt: string, violations: Array<object>}>} Verdict parsé (null si JSON
 *   inexploitable) + réponse brute + manquements relevés.
 * @throws {Error} Si TOUS les fournisseurs échouent.
 */
export async function analyze(state, trends, { provider } = {}) {
  const chain = provider ? [provider] : getProviderChain();
  const user = formatState(state, trends);
  const errors = [];
  for (const p of chain) {
    try {
      const raw = await p.complete({ system: SYSTEM, user });
      const verdict = parseJsonLoose(raw);
      const violations = verdict ? validateVerdict(verdict, { state, trends }) : [];
      if (violations.length) {
        logger.warn(`[ai] garde-fous "${p.name}" : ${violations.map((v) => `${v.type}${v.count ? `×${v.count}` : ""}`).join(", ")}`);
      }
      return { provider: p.name, verdict, raw, prompt: user, violations };
    } catch (err) {
      errors.push(`${p.name}: ${err.message}`);
      logger.warn(`[ai] fournisseur "${p.name}" en échec → fallback (${err.message})`);
    }
  }
  throw new Error(`tous les fournisseurs IA ont échoué — ${errors.join(" | ")}`);
}
