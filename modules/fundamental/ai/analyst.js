import { logger } from "../../logs/index.js";
import * as deepseek from "./providers/deepseek.js";
import * as gemini from "./providers/gemini.js";
import * as groq from "./providers/groq.js";

const PROVIDERS = { deepseek, gemini, groq };

// Chaîne par défaut : DeepSeek d'abord, Groq en secours (gratuit) si DeepSeek échoue.
const DEFAULT_CHAIN = ["deepseek", "groq"];

export function getProvider(nameOverride) {
  const wanted = nameOverride || process.env.LLM_PROVIDER || "deepseek";
  const p = PROVIDERS[wanted];
  if (!p) throw new Error(`Fournisseur LLM inconnu : ${wanted} (dispo : ${Object.keys(PROVIDERS).join(", ")})`);
  return p;
}

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

ANALYSE CROSS-MARKET (important) : compare et croise explicitement le BTC avec les autres marchés — S&P500 & Nasdaq (BTC corrèle au risk-on actions), VIX (peur actions, corrélation inverse), or & dollar (DXY), rendements obligataires (10Y). Identifie les ALIGNEMENTS (tout risk-off ensemble) et surtout les DIVERGENCES (ex. actions qui montent mais BTC qui décroche, ou inverse) — les divergences sont souvent les signaux les plus riches.

RÈGLES STRICTES :
- NE PRÉDIS PAS le prix : aucun objectif de cours, aucun "BTC va monter/baisser". Les marchés sont imprévisibles à court terme. Raisonne en SCÉNARIOS CONDITIONNELS et en ASYMÉTRIE.
- INTERPRÈTE, ne répète pas. Ne dis jamais juste "DXY à 120" : dis ce que ça SIGNIFIE ("dollar fort = conditions restrictives, vent de face pour le risque"). Chaque chiffre doit être accompagné de sa lecture.
- Ancre CHAQUE affirmation dans une donnée précise fournie (cite le chiffre et sa variation). N'invente AUCUNE donnée. Si une source est stale/indisponible, écris-le explicitement et n'extrapole pas.
- Privilégie les DYNAMIQUES (tendances) aux niveaux bruts, et CROISE les axes (ex. dollar fort + peur extrême + funding neutre = quelle lecture combinée).
- Sois concret et spécifique : cite des news/événements précis quand c'est pertinent.
- Exprime ton incertitude via "confiance" (0 à 1).
- Réponds en français.

Réponds UNIQUEMENT par un objet JSON valide, sans texte autour, selon ce schéma EXACT :
{
  "resume": "TL;DR percutant en 1-2 phrases : le régime et le message principal",
  "regime": "risk-on" | "risk-off" | "neutre/transition",
  "confiance": 0.0,
  "niveau_de_risque": "faible" | "modéré" | "élevé",
  "lecture_par_axe": {
    "sentiment": "lecture interprétée (ou 'données indisponibles')",
    "macro": "...",
    "marches_tradfi": "lecture S&P500/Nasdaq/VIX et alignement avec BTC",
    "matieres_premieres": "...",
    "structure_crypto": "...",
    "onchain": "...",
    "geopolitique": "..."
  },
  "signaux_cles": [
    { "donnee": "ex. Dollar Index", "valeur": "120.4 (24h +0.3%)", "lecture": "ce que ça implique concrètement" }
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
  "alertes": ["bascule notable détectée dans les données, ou [] si rien de notable"]
}

Vise 3 signaux_cles minimum, 3 scénarios (haussier/baissier/médian), et remplis lecture_par_axe pour CHAQUE axe disponible.`;

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

/** Met en forme le world-state + tendances en texte compact pour le LLM. */
export function formatState(state, trends) {
  const a = state.axes ?? {};
  const L = [];
  const push = (s) => L.push(s);

  push(`# CONTEXTE MARCHÉ — ${new Date(state.ts).toISOString()}`);
  if (state.meta?.staleSources?.length) push(`Sources indisponibles (stale) : ${state.meta.staleSources.join(", ")}`);

  const fg = a.sentiment?.["fear-greed"];
  const fut = a.sentiment?.["binance-futures"];
  push(`\n## SENTIMENT`);
  if (fg) push(`- Fear & Greed : ${fg.value} (${fg.classification})${fmtTrend(trends, "fearGreed")}, précédent ${fg.previousValue}`);
  if (fut) push(`- Funding BTCUSDT : ${fut.lastFundingRate}${fmtTrend(trends, "funding")} · Open Interest : ${fut.openInterest}${fmtTrend(trends, "openInterest")} · prix ${fut.markPrice}${fmtTrend(trends, "btcPrice")}`);

  const fred = a.macro?.fred;
  push(`\n## MACRO`);
  if (fred) {
    push(`- M2 : ${fred.m2?.value}${fmtTrend(trends, "m2")} · Dollar Index : ${fred.dollarIndex?.value}${fmtTrend(trends, "dxy")} · 10Y : ${fred.yield10y?.value}%${fmtTrend(trends, "yield10y")} · Fed Funds : ${fred.fedFunds?.value}% · CPI : ${fred.cpi?.value}`);
  } else push(`- (stale)`);

  const com = a.commodities?.commodities;
  if (com) push(`\n## MATIÈRES PREMIÈRES\n- WTI : ${com.wtiOil?.value}${fmtTrend(trends, "wtiOil")} · Brent : ${com.brentOil?.value} · Gaz : ${com.natGas?.value}`);

  const mk = a.markets?.markets;
  if (mk) push(`\n## MARCHÉS TRADFI (cross-market)\n- S&P500 : ${mk.sp500?.value}${fmtTrend(trends, "sp500")} · Nasdaq : ${mk.nasdaq?.value}${fmtTrend(trends, "nasdaq")} · Dow : ${mk.djia?.value} · VIX : ${mk.vix?.value}${fmtTrend(trends, "vix")}`);

  const cg = a.structure?.coingecko;
  if (cg) push(`\n## STRUCTURE CRYPTO\n- Dominance BTC : ${cg.btcDominance?.toFixed?.(2)}%${fmtTrend(trends, "btcDominance")} · ETH/BTC : ${cg.ethBtcRatio}${fmtTrend(trends, "ethBtcRatio")} · Mcap total : ${cg.totalMarketCapUsd}${fmtTrend(trends, "totalMarketCapUsd")}`);

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

  const cal = a.macro?.["economic-calendar"];
  if (cal?.upcoming?.length) {
    push(`\n## CALENDRIER ÉCO (à venir)`);
    cal.upcoming.forEach((e) => push(`- ${e.date} : ${e.name}`));
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
