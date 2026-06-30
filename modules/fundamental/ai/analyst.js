import { logger } from "../../logs/index.js";
import * as deepseek from "./providers/deepseek.js";
import * as gemini from "./providers/gemini.js";
import * as groq from "./providers/groq.js";

const PROVIDERS = { deepseek, gemini, groq };

// Chaîne par défaut : DeepSeek d'abord, Groq en secours (gratuit) si DeepSeek échoue.
const DEFAULT_CHAIN = ["deepseek", "groq"];

/** Ordre des fournisseurs à essayer : LLM_PROVIDER en tête, puis le reste en secours. */
export function getProviderChain() {
  const order = [];
  const primary = process.env.LLM_PROVIDER;
  if (primary && PROVIDERS[primary]) order.push(primary);
  for (const n of DEFAULT_CHAIN) if (!order.includes(n)) order.push(n);
  return order.map((n) => PROVIDERS[n]);
}

/**
 * Prompt système STABLE (cadrage de l'analyste). Volontairement : PAS de
 * prédiction de prix. On veut un état du monde + scénarios + asymétrie +
 * confiance + alertes — un support à la décision humaine.
 */
const SYSTEM = `Tu es un analyste macro/cross-market senior. Tu analyses le Bitcoin DANS SON CONTEXTE GLOBAL — pas en vase clos — au service d'un investisseur swing qui décide lui-même. Tu écris de façon dense, précise et utile — jamais générique.

Ton rôle : à partir des données fournies (sentiment, macro, marchés TradFi, matières premières, structure crypto, on-chain, géopolitique, calendrier, news) ET de leurs TENDANCES (variations 1h/24h/7j), produire une lecture RICHE du régime de marché ET des CORRÉLATIONS CROSS-MARKET.

ANALYSE CROSS-MARKET (important) : compare et croise explicitement le BTC avec les autres marchés — S&P500 & Nasdaq (BTC corrèle au risk-on actions), VIX (peur actions, corrélation inverse), or & dollar (DXY), rendements obligataires (10Y nominal et RÉEL). Identifie les ALIGNEMENTS (tout risk-off ensemble) et surtout les DIVERGENCES (ex. actions qui montent mais BTC qui décroche, ou inverse) — les divergences sont souvent les signaux les plus riches.

LIQUIDITÉ (driver prioritaire) : la LIQUIDITÉ NETTE Fed (bilan Fed − RRP − TGA) ET la LIQUIDITÉ GLOBALE (Fed + BCE + BoJ) avec leur TENDANCE sont un moteur de fond majeur du BTC — une contraction est un vent de face structurel, une expansion un soutien. Pondère-les fortement, ainsi que les taux RÉELS (un taux réel qui monte pénalise les actifs sans rendement).

POSITIONNEMENT MULTI-ACTIFS (CFTC COT) : le net spéculatif est fourni pour le BTC mais aussi le forex (EUR/JPY/GBP), les actions (S&P500/Nasdaq) et les matières (or/WTI). Croise-les : un positionnement extrême (cf. percentile) sur plusieurs actifs révèle le régime de risque global et d'éventuels retournements (capitulation/euphorie).

RÈGLES STRICTES :
- NE PRÉDIS PAS le prix : aucun objectif de cours, aucun "BTC va monter/baisser". Les marchés sont imprévisibles à court terme. Raisonne en SCÉNARIOS CONDITIONNELS et en ASYMÉTRIE.
- INTERPRÈTE, ne répète pas. Ne dis jamais juste "DXY à 120" : dis ce que ça SIGNIFIE ("dollar fort = conditions restrictives, vent de face pour le risque"). Chaque chiffre doit être accompagné de sa lecture.
- Ancre CHAQUE affirmation dans une donnée précise fournie (cite le chiffre et sa variation). N'invente AUCUNE donnée. Si une source est stale/indisponible, écris-le explicitement et n'extrapole pas.
- Privilégie les DYNAMIQUES (tendances) aux niveaux bruts, et CROISE les axes (ex. dollar fort + peur extrême + funding neutre = quelle lecture combinée).
- CONTEXTE HISTORIQUE : quand une métrique est annotée [pXX/5a] (rang percentile sur ~5 ans), interprète son NIVEAU via ce percentile — p<10 = extrême bas, p>90 = extrême haut. Un EXTRÊME est bien plus significatif qu'un niveau médian (mean reversion, capitulation, euphorie). FAIS REMONTER ce percentile dans le champ "valeur" de chaque signal_cle concerné (ex. "VIX 18,4 — p53/5a médian").
- Sois concret et spécifique : cite des news/événements précis quand c'est pertinent.
- SURPRISES ÉCO : pour un indicateur PUBLIÉ, ce qui meut les marchés est l'écart RÉEL vs PRÉVISION (consensus) — pas le niveau brut. Exploite la "surprise" fournie (ex. inflation au-dessus du consensus = pression haussière sur les taux = vent de face pour le risque ; emploi/croissance sous le consensus = ralentissement). Pour les events À VENIR, identifie les catalyseurs majeurs (FOMC, CPI, NFP) et le consensus attendu.
- VULGARISATION : remplis "pour_debutants" dans un langage SIMPLE et synthétique — un proche non-initié doit comprendre la situation et s'il faut être serein ou prudent. Évite les chiffres bruts, explique 2-3 termes clés du moment. Donne une "posture" claire (défensif/neutre/opportuniste-prudent) et "a_eviter" (le piège du moment). Ce N'EST PAS du daytrading : aucune entrée/sortie, seulement une posture d'investisseur prudent.
- CONSEILS : donne 2-3 conseils CONCRETS et PRUDENTS adaptés au régime actuel — orientés gestion du risque, dimensionnement/exposition, patience, et indicateurs à surveiller. JAMAIS d'objectif de prix, JAMAIS "achète/vends maintenant". Ce sont des éclairages pour décider, PAS une recommandation financière.
- HORIZON & INVALIDATION : précise TOUJOURS l'HORIZON de validité de ta lecture (swing : quelques jours à semaines, jamais intraday) et les conditions concrètes d'INVALIDATION (ce qui te ferait changer d'avis). C'est ce qui permet à l'utilisateur de savoir QUAND ta lecture ne tient plus.
- Exprime ton incertitude via "confiance" (0 à 1).
- Réponds en français.

Réponds UNIQUEMENT par un objet JSON valide, sans texte autour, selon ce schéma EXACT :
{
  "resume": "TL;DR percutant en 1-2 phrases : le régime et le message principal",
  "regime": "risk-on" | "risk-off" | "neutre/transition",
  "confiance": 0.0,
  "niveau_de_risque": "faible" | "modéré" | "élevé",
  "lecture_par_axe": {
    "sentiment": "Fear&Greed, funding, DVOL (vol implicite) interprétés",
    "positionnement": "COT MULTI-ACTIFS : net spéculatif BTC + forex (EUR/JPY/GBP) + actions (S&P500/Nasdaq) + or/pétrole ; souligne les extrêmes de positionnement (percentile)",
    "macro": "taux nominaux/réels, courbe, crédit, conditions/stress, incertitude, dollar/FX, éco réelle (avec percentiles)",
    "liquidite": "liquidité nette Fed ET liquidité GLOBALE (Fed+BCE+BoJ), niveau ET tendance, implication pour le risque/BTC",
    "marches_tradfi": "lecture S&P500/Nasdaq/VIX et alignement avec BTC",
    "matieres_premieres": "...",
    "structure_crypto": "...",
    "onchain": "...",
    "geopolitique": "..."
  },
  "signaux_cles": [
    { "donnee": "ex. Dollar Index", "valeur": "120.4 (24h +0.3%, p53/5a médian)", "lecture": "ce que ça implique concrètement" }
  ],
  "ce_qui_a_change": ["évolutions notables des tendances 24h/7j, ou [] si pas d'historique"],
  "correlations": ["CROSS-MARKET explicite : BTC vs S&P500/Nasdaq (alignement risk-on ?), BTC vs VIX (inverse ?), BTC vs or/DXY/10Y, et toute DIVERGENCE notable"],
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
    "termes_cles": [
      { "terme": "ex. Liquidité nette", "explication": "définition en une phrase simple + pourquoi ça compte pour le BTC" }
    ]
  },
  "conseils": [
    { "conseil": "action PRUDENTE adaptée au régime (gestion du risque / exposition / patience / ce qu'il faut surveiller)", "pourquoi": "le lien explicite avec les données actuelles", "prudence": "la nuance ou le risque à garder en tête" }
  ]
}

Vise 3 signaux_cles minimum (avec percentile dans "valeur" quand disponible), 3 scénarios (haussier/baissier/médian), 2-3 conseils, un bloc pour_debutants complet (en_bref + posture + a_eviter + 2-3 termes_cles), et remplis lecture_par_axe pour CHAQUE axe disponible.`;

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

// Contexte historique : rang percentile (vs ~5 ans) + label qualitatif.
function fmtNorm(trends, key) {
  const m = trends?.metrics?.[key];
  if (!m || m.pctRank == null) return "";
  const p = m.pctRank;
  const label = p <= 10 ? "très bas" : p <= 30 ? "bas" : p >= 90 ? "très haut" : p >= 70 ? "haut" : "médian";
  return ` [p${p}/5a, ${label}]`;
}

/** Met en forme le world-state + tendances en texte compact pour le LLM. */
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
  if (dvol) push(`- DVOL (vol implicite BTC, "VIX crypto") : ${dvol.dvol}${fmtTrend(trends, "dvol")}`);

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
    push(`- M2 : ${fred.m2?.value}${fmtTrend(trends, "m2")} · Dollar Index : ${fred.dollarIndex?.value}${fmtTrend(trends, "dxy")}${fmtNorm(trends, "dxy")}`);
    push(`- FX : EUR/USD ${fred.eurusd?.value} · USD/JPY ${fred.usdjpy?.value} · USD/CNY ${fred.usdcny?.value} · émergents BRL ${fred.brlusd?.value}/MXN ${fred.mxnusd?.value}/INR ${fred.inrusd?.value}/ZAR ${fred.zarusd?.value}`);
    push(`- Taux : 2Y ${fred.yield2y?.value}% · 10Y nominal ${fred.yield10y?.value}%${fmtTrend(trends, "yield10y")}${fmtNorm(trends, "yield10y")} · 10Y réel ${fred.realYield10y?.value}%${fmtTrend(trends, "realYield10y")}${fmtNorm(trends, "realYield10y")} · point mort inflation ${fred.breakeven10y?.value}% · courbe 10Y-2Y ${fred.yieldCurve?.value}${fmtNorm(trends, "yieldCurve")} · Fed Funds ${fred.fedFunds?.value}% · SOFR ${fred.sofr?.value}% · mortgage 30Y ${fred.mortgage30y?.value}%`);
    push(`- Conditions/risque : spread HY ${fred.highYieldSpread?.value}%${fmtTrend(trends, "highYieldSpread")}${fmtNorm(trends, "highYieldSpread")} · conditions fin. (NFCI) ${fred.financialConditions?.value} · stress (StLouis) ${fred.financialStress?.value}${fmtNorm(trends, "financialStress")} · incertitude politique (EPU) ${fred.policyUncertainty?.value}${fmtTrend(trends, "policyUncertainty")}`);
    push(`- Éco réelle : CPI ${fred.cpi?.value} · PCE ${fred.pce?.value} · ventes détail ${fred.retailSales?.value} · sentiment conso ${fred.consumerSentiment?.value} · chômage ${fred.unemployment?.value}% · indice prix alimentaires (IMF) ${fred.foodPriceIndex?.value}`);
  } else push(`- (stale)`);

  const liq = a.liquidity?.liquidity;
  push(`\n## LIQUIDITÉ (driver clé)`);
  if (liq?.netLiquidity) {
    push(`- Liquidité nette Fed : ${liq.netLiquidity.value?.toFixed?.(0)} Md$${fmtTrend(trends, "netLiquidity")} = bilan Fed ${liq.fedBalanceSheet?.value?.toFixed?.(0)} − RRP ${liq.reverseRepo?.value?.toFixed?.(0)} − TGA ${liq.tga?.value?.toFixed?.(0)}`);
    if (liq.globalLiquidity) {
      push(`- Liquidité GLOBALE : ${liq.globalLiquidity.value?.toFixed?.(0)} Md$${fmtTrend(trends, "globalLiquidity")} = Fed nette + BCE ${liq.ecbAssets?.value?.toFixed?.(0)} + BoJ ${liq.bojAssets?.value?.toFixed?.(0)} (le BTC suit la liquidité mondiale)`);
    }
  } else push(`- (stale)`);

  const com = a.commodities?.commodities;
  if (com) push(`\n## MATIÈRES PREMIÈRES\n- Énergie : WTI ${com.wtiOil?.value}${fmtTrend(trends, "wtiOil")}${fmtNorm(trends, "wtiOil")} · Brent ${com.brentOil?.value} · Gaz ${com.natGas?.value}\n- Métaux : Or ${com.gold?.value}${fmtTrend(trends, "gold")} · Argent ${com.silver?.value} · Cuivre ${com.copper?.value}${fmtNorm(trends, "copper")} (Dr Copper) · Blé ${com.wheat?.value}`);

  const mk = a.markets?.markets;
  if (mk) push(`\n## MARCHÉS TRADFI (clôture J-1)\n- S&P500 : ${mk.sp500?.value}${fmtTrend(trends, "sp500")}${fmtNorm(trends, "sp500")} · Nasdaq : ${mk.nasdaq?.value}${fmtTrend(trends, "nasdaq")} · Dow : ${mk.djia?.value} · VIX : ${mk.vix?.value}${fmtTrend(trends, "vix")}${fmtNorm(trends, "vix")}`);

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
    push(`- Dominance BTC : ${cg.btcDominance?.toFixed?.(2)}%${fmtTrend(trends, "btcDominance")} · ETH : ${cg.ethDominance?.toFixed?.(2)}% · ETH/BTC : ${cg.ethBtcRatio}${fmtTrend(trends, "ethBtcRatio")}`);
    push(`- Mcap total : ${cg.totalMarketCapUsd}${fmtTrend(trends, "totalMarketCapUsd")} · TOTAL2 (alts hors BTC) : ${cg.altMarketCapUsd?.toFixed?.(0)}${fmtTrend(trends, "altMarketCapUsd")} · TOTAL3 (hors BTC+ETH) : ${cg.total3MarketCapUsd?.toFixed?.(0)}${fmtTrend(trends, "total3MarketCapUsd")}`);
  }

  const dl = a.onchain?.defillama;
  const ch = a.onchain?.["blockchain-info"];
  push(`\n## ON-CHAIN`);
  if (dl) push(`- TVL DeFi : ${dl.totalTvlUsd}${fmtTrend(trends, "totalTvlUsd")} · Stablecoins : ${dl.stablecoinMcapUsd}${fmtTrend(trends, "stablecoinMcapUsd")}`);
  if (ch) push(`- Hashrate : ${ch.hashRate}${fmtTrend(trends, "hashRate")}`);

  push(`\n## GÉOPOLITIQUE`);
  const gd = a.geopolitics?.gdelt;
  if (gd?.topHeadlines?.length) {
    push(`Manchettes (GDELT) :`);
    gd.topHeadlines.slice(0, 10).forEach((h) => push(`- (${h.sourceCountry || "?"}) ${h.title}`));
  }
  const ac = a.geopolitics?.acled;
  if (ac?.totalEvents != null) {
    push(`Conflits (ACLED, ${ac.windowDays}j) : ${ac.totalEvents} événements, ${ac.totalFatalities} morts. Top : ${(ac.topCountries || []).map((c) => `${c.country} (${c.fatalities}†)`).join(", ")}`);
  }
  if (!gd?.topHeadlines?.length && ac?.totalEvents == null) push(`- (stale)`);

  // --- CALENDRIER ÉCO : collecteur unique investing-calendar (investing.com,
  // repli FairEconomy interne) — multi-pays, heure, impact, précédent/prévision/réel. ---
  const ff = a.macro?.["investing-calendar"];
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
  const ffUpcoming = ffEvents.filter((e) => e.actual == null);
  if (ffUpcoming.length) {
    push(`\n## CALENDRIER ÉCO — À VENIR`);
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

function parseVerdict(raw) {
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
 * Lance l'analyse : formate l'état, appelle le fournisseur, parse le verdict.
 * @returns { provider, verdict, raw, prompt }
 */
export async function analyze(state, trends, { provider } = {}) {
  const chain = provider ? [provider] : getProviderChain();
  const user = formatState(state, trends);
  const errors = [];
  for (const p of chain) {
    try {
      const raw = await p.complete({ system: SYSTEM, user });
      return { provider: p.name, verdict: parseVerdict(raw), raw, prompt: user };
    } catch (err) {
      errors.push(`${p.name}: ${err.message}`);
      logger.warn(`[ai] fournisseur "${p.name}" en échec → fallback (${err.message})`);
    }
  }
  throw new Error(`tous les fournisseurs IA ont échoué — ${errors.join(" | ")}`);
}
