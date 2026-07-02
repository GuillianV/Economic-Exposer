import { logger } from "../../logs/index.js";
import { getProviderChain } from "./analyst.js";
import { listVerdicts, loadVerdictByTs, loadMetricsSince } from "../persistence/store.js";
import { getTrends } from "../persistence/scheduler.js";
import { METRIC_DICTIONARY } from "../dictionary.js";

// Seuils d'extrême sur le rang percentile 5 ans (mean-reversion / contrarian).
const PCT_LOW = 10;
const PCT_HIGH = 90;

// Séries SÉCULAIRES (accumulateurs qui montent toujours) : leur p100 est
// structurel, PAS un signal de retournement. Exclues des extrêmes contrarian.
const SECULAR_DENY = new Set(["m2", "cpi", "pce", "retailSales", "foodPriceIndex"]);

// Catalyseurs "imminents" : événements binaires dans les prochains jours qui
// figent le marché (attente) → le modèle doit gater sa confiance dessus.
const IMMINENT_DAYS = 3;
function imminentCatalysts(verdict) {
  const arr = Array.isArray(verdict?.catalyseurs_a_venir) ? verdict.catalyseurs_a_venir : [];
  const now = Date.now();
  const lim = now + IMMINENT_DAYS * 86400000;
  return arr.filter((c) => {
    const t = Date.parse(c?.date);
    return Number.isFinite(t) && t >= now - 86400000 && t <= lim; // -1j pour inclure aujourd'hui
  });
}

/**
 * Métriques à un EXTRÊME de percentile (≤10 ou ≥90) — les meilleurs tells de
 * retournement (peur/euphorie, positionnement lessivé, sur-achat). Triées par
 * distance à la médiane (plus extrême d'abord).
 */
function extremesOf(trends) {
  const out = [];
  for (const [k, m] of Object.entries(trends?.metrics ?? {})) {
    if (!m || m.pctRank == null || SECULAR_DENY.has(k)) continue;
    if (m.pctRank > PCT_LOW && m.pctRank < PCT_HIGH) continue;
    const meta = METRIC_DICTIONARY[k];
    out.push({
      metric: k,
      label: meta?.label ?? k,
      sens: meta?.sens ?? null,
      value: r2(m.value),
      pctRank: m.pctRank,
      z: m.z != null ? r2(m.z) : null,
      extreme: m.pctRank <= PCT_LOW ? "bas" : "haut",
    });
  }
  out.sort((a, b) => Math.abs(b.pctRank - 50) - Math.abs(a.pctRank - 50));
  return out;
}

// Cours majeurs projetés : clé métrique -> libellé affiché.
export const ASSETS = [
  ["btcPrice", "BTC/USD"],
  ["ethPrice", "ETH/USD"],
  ["solPrice", "SOL/USD"],
  ["sp500", "S&P 500"],
  ["nasdaq", "Nasdaq 100"],
  ["dxy", "DXY (indice dollar)"],
  ["eurusd", "EUR/USD"],
  ["usdjpy", "USD/JPY"],
  ["gold", "Or (XAU/USD)"],
];

/**
 * COURBE PRÉVISIONNELLE (opt-in). Analyse TOUTE la trajectoire des verdicts
 * (régime/confiance dans le temps) + l'évolution des cours, puis demande au LLM
 * de PROJETER une courbe forward (chemin de prix) par actif majeur, traçable.
 *
 * Choix produit ASSUMÉ : ce sont des projections IA, à afficher AVEC disclaimer.
 * Un modèle ne prédit pas le marché — c'est probabiliste et faillible.
 *
 * Le point t0 de chaque courbe est ANCRÉ sur le cours réel actuel (pas laissé
 * au modèle) : la courbe part de la vérité, seuls les points futurs sont projetés.
 */

const DISCLAIMER =
  "Courbe projetée par une analyse IA sur l'historique des verdicts. PAS un conseil " +
  "financier ni une certitude : un modèle ne prédit pas le marché. Probabiliste, " +
  "faillible, à recouper. La projection diverge d'autant plus qu'on s'éloigne dans le temps.";

const r2 = (n) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) / 100 : n);

const SYSTEM = `Tu es un stratège quantitatif. On te fournit la TRAJECTOIRE d'une analyse fondamentale (régime de marché heure par heure : risk-on/off, confiance) ET l'évolution récente des cours majeurs. Ta tâche : PROJETER une courbe forward (chemin de prix jour par jour) pour CHAQUE actif, cohérente avec la dynamique de la trajectoire.

RÈGLES :
- Base-toi UNIQUEMENT sur la trajectoire et les cours fournis. N'invente pas de données.
- Pour CHAQUE actif : une DIRECTION globale, une CONFIANCE (0 à 1), une COURBE = une valeur projetée par jour jusqu'à l'horizon, et un COMMENTAIRE (le lien avec la trajectoire du régime).
- La courbe doit être RÉALISTE : ancrée sur le cours actuel, mouvements journaliers modestes cohérents avec la volatilité du régime (un régime risk-off ferme ne fait pas +20% en 3 jours). Progression LISSE, pas de dents de scie aléatoires.
- Cohérence régime : un régime durablement risk-off → biais baissier/latéral sur le risque (crypto, actions) et haussier dollar ; risk-on → l'inverse.
- RETOURNEMENTS (crucial) : ne te contente PAS d'extrapoler le régime en ligne droite. EXPLOITE les SIGNAUX D'EXTRÊME et les DIVERGENCES fournis pour anticiper un point de bascule. Un extrême de peur/positionnement lessivé (percentile bas) dans un actif risqué peut précéder un CREUX puis un REBOND — la courbe doit alors s'INFLÉCHIR (baisse qui ralentit puis se retourne), pas continuer tout droit. À l'inverse un extrême d'euphorie/sur-achat (percentile haut) plaide pour un essoufflement/repli. N'invente pas le timing : ancre le retournement sur un extrême ou une divergence RÉELLEMENT fourni, sinon n'en mets pas.
- CONFLIT PRIX vs POSITIONNEMENT : quand un actif a un PRIX à un extrême (percentile de prix très haut/bas) ET un POSITIONNEMENT spéculatif (COT) à l'extrême OPPOSÉ, le POSITIONNEMENT prime à COURT TERME. Le débouclement (squeeze) pousse le prix dans le sens qui fait le plus mal aux positions lessivées AVANT tout essoufflement. Ex. actions chères (prix p99) mais shorts extrêmes (COT p5) → biais SQUEEZE HAUSSIER d'abord, pas baisse immédiate ; ne sois pas franchement baissier tant que le short n'est pas purgé.
- ÉVÉNEMENTS BINAIRES : si un CATALYSEUR IMMINENT (≤48h) est listé, un mouvement directionnel FRANC avant sa publication est peu probable — le marché attend. BAISSE la confiance et ÉLARGIS/aplatis la fourchette autour de cette date ; ne projette pas une tendance nette qui traverse l'événement comme s'il n'existait pas. Après l'événement, l'incertitude s'ouvre dans les deux sens.
- CONTEXTE MACRO (le POURQUOI) : le régime a une CAUSE — utilise-la pour différencier les actifs. Une STAGFLATION (inflation haute + croissance qui casse + PAS de baisses pricées) CAPPE les rallyes du risque (crypto/actions) mais SOUTIENT l'or (couverture débasement/fiscale) — surtout si une corrélation or/taux réels CASSÉE est signalée dans les divergences : dans ce cas les taux réels hauts ne freinent PLUS l'or, ne le projette pas "neutre" par réflexe. À l'inverse, désinflation + baisses pricées = soutien au risque, frein sur l'or.
- OPTIONS : le skew (> 0 = puts chers = peur crash) et les put/call sont du positionnement TEMPS RÉEL. Skew très élevé qui se détend = la peur reflue (support, début de rebond) ; skew bas avec prix à des extrêmes hauts = complaisance (fragilité). Un CBOE SKEW élevé = les institutionnels paient cher la protection crash actions malgré des indices au sommet — fragilité sous la surface.
- GÉOPOLITIQUE : la section GÉOPOLITIQUE décrit le stress géopolitique ACTUEL. Un choc géopolitique est IMPRÉVISIBLE — ne prétends pas prédire une frappe ou un cessez-le-feu. En revanche : un stress géopolitique ÉLEVÉ/qui s'aggrave = prime de risque, biais vers la baisse du risque (crypto/actions) et la hausse des refuges (or, dollar) + confiance PLUS BASSE (plus de queue de risque) ; une DÉSESCALADE = soulagement (risk-on, pétrole/refuges qui refluent). Reflète le stress décrit, ne l'invente pas.
- Plus l'horizon est lointain, plus l'incertitude est grande (confiance décroît).
- Horizon en jours (swing), JAMAIS d'intraday.
- Réponds en français.

Réponds UNIQUEMENT par un objet JSON valide selon ce schéma EXACT :
{
  "horizon_jours": 7,
  "actifs": [
    {
      "actif": "BTC/USD",
      "direction": "haussier" | "baissier" | "neutre",
      "confiance": 0.0,
      "courbe": [ { "t_jours": 1, "valeur": 60500 }, { "t_jours": 2, "valeur": 60800 } ],
      "retournement": { "probable": true, "fenetre_jours": "3-5", "biais": "haussier", "declencheur": "l'extrême/divergence qui le porte (cite-le)" },
      "commentaire": "le lien avec la trajectoire du régime et les extrêmes"
    }
  ]
}
Mets "retournement" seulement si un extrême/divergence le justifie, sinon { "probable": false }. La courbe va de t_jours=1 à t_jours=horizon (le t0 = cours actuel est ajouté automatiquement, ne le mets pas). Produis un actif pour CHAQUE cours fourni.`;

/**
 * Construit la trajectoire depuis le store : timeline régime (verdicts) +
 * timeline des cours (métriques), sous-échantillonnée à ~maxPoints points.
 */
export async function buildTrajectory(windowMs = 7 * 86400000, maxPoints = 24) {
  const since = Date.now() - windowMs;
  const vlist = await listVerdicts(since);
  const mseries = await loadMetricsSince(since);

  const regimes = [];
  let lastVerdict = null;
  for (const { ts } of vlist) {
    const v = await loadVerdictByTs(ts);
    if (v?.verdict) {
      regimes.push({ ts, regime: v.verdict.regime, confiance: v.verdict.confiance, risque: v.verdict.niveau_de_risque });
      lastVerdict = v.verdict; // le plus récent (liste triée croissant)
    }
  }

  const downsample = (arr) => {
    if (arr.length <= maxPoints) return arr;
    const step = (arr.length - 1) / (maxPoints - 1);
    return Array.from({ length: maxPoints }, (_, i) => arr[Math.round(i * step)]);
  };

  const prices = mseries.map((s) => ({ ts: s.ts, m: s.metrics || {} }));
  const latest = prices.length ? prices[prices.length - 1].m : {};
  const current = {};
  for (const [key] of ASSETS) if (latest[key] != null) current[key] = latest[key];

  // Signaux de RETOURNEMENT : extrêmes de percentile (via tendances) +
  // divergences/alertes/bascules du dernier verdict. Et CONTEXTE macro/options :
  // les dérivées (cpiYoY, policySpread2y) et le skew n'ont pas de baseline 5 ans
  // (pas de pctRank) — sans injection directe, la courbe ne les verrait JAMAIS.
  let extremes = [];
  let macroCtx = null;
  try {
    const trends = await getTrends();
    extremes = extremesOf(trends);
    macroCtx = macroContextOf(trends);
  } catch (err) {
    logger.warn(`[curve] extrêmes/contexte indisponibles : ${err.message}`);
  }
  const signals = lastVerdict
    ? {
        alertes: lastVerdict.alertes ?? [],
        changements: lastVerdict.ce_qui_a_change ?? [],
        divergences: lastVerdict.correlations ?? [],
        catalyseurs: imminentCatalysts(lastVerdict),
        geopolitique: lastVerdict.lecture_par_axe?.geopolitique ?? null,
      }
    : null;

  return {
    regimes: downsample(regimes),
    prices: downsample(prices),
    current,
    extremes,
    macroCtx,
    signals,
    span: { fromTs: since, toTs: Date.now(), verdicts: regimes.length, snapshots: prices.length },
  };
}

/**
 * Contexte macro & options depuis les tendances : le POURQUOI du régime
 * (inflation en rythme, attentes Fed, taux réels, plomberie) + le positionnement
 * options (skew/put-call). Valeurs brutes — pas besoin de baseline.
 */
function macroContextOf(trends) {
  const g = (k) => trends?.metrics?.[k]?.value ?? null;
  const d = (k) => {
    const p = trends?.metrics?.[k]?.d24h?.pct;
    return typeof p === "number" ? Math.round(p * 100) / 100 : null;
  };
  return {
    cpiYoY: g("cpiYoY"),
    pceYoY: g("pceYoY"),
    m2YoY: g("m2YoY"),
    policySpread2y: g("policySpread2y"),
    realYield10y: g("realYield10y"),
    realYield10yD24: d("realYield10y"),
    breakeven10y: g("breakeven10y"),
    breakeven10yD24: d("breakeven10y"),
    reverseRepo: g("reverseRepo"),
    tga: g("tga"),
    netLiquidityD24: d("netLiquidity"),
    globalLiquidityD24: d("globalLiquidity"),
    dvol: g("dvol"),
    btcSkew: g("btcSkew"),
    ethSkew: g("ethSkew"),
    btcPutCall: g("btcPutCall"),
    ethPutCall: g("ethPutCall"),
    cboeSkew: g("cboeSkew"),
  };
}

/** Formate la trajectoire en message utilisateur compact pour le LLM. */
function formatTrajectory(traj, horizonDays) {
  const lines = [];
  lines.push(`# TRAJECTOIRE DU RÉGIME (${traj.regimes.length} points)`);
  for (const g of traj.regimes) {
    lines.push(`- ${new Date(g.ts).toISOString().slice(5, 16).replace("T", " ")} : ${g.regime} (conf ${g.confiance}, risque ${g.risque})`);
  }
  lines.push(`\n# ÉVOLUTION DES COURS (${traj.prices.length} points)`);
  const cols = ASSETS.filter(([k]) => traj.current[k] != null);
  lines.push("date · " + cols.map(([, l]) => l).join(" · "));
  for (const p of traj.prices) {
    lines.push(
      new Date(p.ts).toISOString().slice(5, 16).replace("T", " ") + " · " + cols.map(([k]) => r2(p.m[k])).join(" · "),
    );
  }
  lines.push("\n# COURS ACTUELS (ancre t0)");
  for (const [k, l] of cols) lines.push(`- ${l} : ${r2(traj.current[k])}`);

  // Le POURQUOI du régime + positionnement options (pas de baseline -> injection directe).
  const mc = traj.macroCtx;
  if (mc) {
    const macroLines = [];
    if (mc.cpiYoY != null || mc.pceYoY != null)
      macroLines.push(`- Inflation en rythme annuel : CPI ${mc.cpiYoY ?? "?"}% · PCE ${mc.pceYoY ?? "?"}%${mc.m2YoY != null ? ` · M2 ${mc.m2YoY > 0 ? "+" : ""}${mc.m2YoY}%` : ""} (cible Fed 2%)`);
    if (mc.policySpread2y != null)
      macroLines.push(`- Attentes de politique (2Y − Fed Funds) : ${mc.policySpread2y > 0 ? "+" : ""}${mc.policySpread2y} pt (> 0 = PAS de baisses pricées ; croisé avec une éco qui casse = Fed coincée)`);
    if (mc.realYield10y != null)
      macroLines.push(`- Taux réel 10Y : ${mc.realYield10y}%${mc.realYield10yD24 != null ? ` (24h ${mc.realYield10yD24 > 0 ? "+" : ""}${mc.realYield10yD24}%)` : ""} · breakeven ${mc.breakeven10y ?? "?"}%${mc.breakeven10yD24 != null ? ` (24h ${mc.breakeven10yD24 > 0 ? "+" : ""}${mc.breakeven10yD24}%)` : ""} — réels qui montent avec breakevens qui baissent = choc de taux RÉELS (prime fiscale), pas d'inflation`);
    if (mc.reverseRepo != null && mc.reverseRepo < 100)
      macroLines.push(`- Plomberie : RRP ${r2(mc.reverseRepo)} Md$ (coussin ÉPUISÉ — liquidité plus fragile)${mc.tga != null ? ` · TGA ${r2(mc.tga)} Md$${mc.tga > 750 ? " (réserve potentielle si drawdown)" : ""}` : ""}`);
    if (mc.netLiquidityD24 != null || mc.globalLiquidityD24 != null)
      macroLines.push(`- Liquidité 24h : nette Fed ${mc.netLiquidityD24 ?? "?"}% · globale ${mc.globalLiquidityD24 ?? "?"}%`);
    if (macroLines.length) lines.push("\n# CONTEXTE MACRO (le POURQUOI du régime)\n" + macroLines.join("\n"));

    const optLines = [];
    if (mc.btcSkew != null || mc.ethSkew != null)
      optLines.push(`- Skew (put−call IV, ~30j) : BTC ${mc.btcSkew ?? "?"} · ETH ${mc.ethSkew ?? "?"} (> 0 = puts chers = peur crash, lecture contrarian ; divergence BTC/ETH = signal)`);
    if (mc.btcPutCall != null || mc.ethPutCall != null)
      optLines.push(`- Put/Call OI : BTC ${mc.btcPutCall ?? "?"} · ETH ${mc.ethPutCall ?? "?"} (↑ = couverture/peur)`);
    if (mc.cboeSkew != null) optLines.push(`- CBOE SKEW (actions) : ${mc.cboeSkew} (↑ = demande de hedge crash sur le S&P)`);
    if (mc.dvol != null) optLines.push(`- DVOL BTC : ${mc.dvol} (vol implicite, "VIX crypto")`);
    if (optLines.length) lines.push("\n# OPTIONS (positionnement temps réel)\n" + optLines.join("\n"));
  }

  // Signaux de retournement — les plus prédictifs.
  if (traj.extremes?.length) {
    lines.push("\n# SIGNAUX D'EXTRÊME (rang percentile 5 ans — lecture CONTRARIAN / mean-reversion)");
    lines.push("Un extrême bas (p≤10) = capitulation/peur → retournement HAUSSIER possible ; un extrême haut (p≥90) = euphorie/sur-achat → retournement BAISSIER possible.");
    for (const e of traj.extremes) {
      const z = e.z != null ? `, z ${e.z}` : "";
      lines.push(`- ${e.label} : ${e.value} — p${e.pctRank}/5a (extrême ${e.extreme}${z})${e.sens ? ` · ${e.sens}` : ""}`);
    }
  }
  if (traj.signals) {
    const s = traj.signals;
    if (s.divergences?.length) lines.push("\n# DIVERGENCES CROSS-MARKET (dernier verdict)\n- " + s.divergences.join("\n- "));
    if (s.changements?.length) lines.push("\n# CE QUI A CHANGÉ (bascules récentes)\n- " + s.changements.join("\n- "));
    if (s.alertes?.length) lines.push("\n# ALERTES\n- " + s.alertes.join("\n- "));
    if (s.catalyseurs?.length)
      lines.push(
        "\n# CATALYSEURS IMMINENTS (≤3j — événements BINAIRES, le marché attend)\n- " +
          s.catalyseurs.map((c) => `${c.date} : ${c.evenement} — ${c.enjeu}`).join("\n- "),
      );
    if (s.geopolitique) lines.push("\n# GÉOPOLITIQUE (lecture du dernier verdict)\n" + s.geopolitique);
  }

  lines.push(`\n# HORIZON : ${horizonDays} jours`);
  return lines.join("\n");
}

// ---- Inflexion déterministe des courbes -----------------------------------
// Le LLM décrit bien un retournement (champ `retournement` + commentaire) mais
// trace souvent une DROITE monotone qui le CONTREDIT. On réaligne le TRACÉ sur
// sa propre thèse : on garde la phase 1 du modèle jusqu'au pivot (début de la
// fenêtre), puis on replie la phase 2 vers le `biais`. On n'agit QUE sur les
// vrais RETOURNEMENTS (biais opposé au drift) — une continuation est déjà
// cohérente, on n'y touche pas.

const norm = (s) => String(s ?? "").toLowerCase();

/** "3-5" / "3–5" / "3 à 5" / "5" → { start, end } borné à l'horizon. */
function parseWindow(raw, horizonDays) {
  const nums = String(raw ?? "").match(/\d+/g);
  if (!nums?.length) return null;
  let start = Math.min(Math.max(Number(nums[0]), 1), horizonDays);
  const end = Math.min(Math.max(nums[1] != null ? Number(nums[1]) : start, start), horizonDays);
  return { start, end };
}

/** Valeur de la courbe à un jour donné (points quotidiens contigus → lookup). */
function valueAtDay(courbe, day) {
  const hit = courbe.find((p) => p.t_jours === day);
  return hit ? hit.valeur : null;
}

/**
 * Replie la phase 2 d'une courbe vers `retournement.biais` si c'est un vrai
 * retournement. Retourne la courbe inchangée sinon. `pivotOut` (optionnel)
 * reçoit le jour de pivot appliqué.
 */
export function inflectCurve(courbe, retournement, horizonDays, pivotOut) {
  if (!Array.isArray(courbe) || courbe.length < 3 || !retournement?.probable) return courbe;
  const biais = norm(retournement.biais);
  const sign = biais === "haussier" ? 1 : biais === "baissier" ? -1 : 0;
  if (!sign) return courbe;

  const win = parseWindow(retournement.fenetre_jours, horizonDays);
  if (!win) return courbe;
  const pivotDay = Math.min(win.start, horizonDays - 1); // laisse ≥1 jour à plier
  if (pivotDay < 1) return courbe;

  const t0 = courbe[0].valeur;
  const pivotVal = valueAtDay(courbe, pivotDay);
  if (pivotVal == null) return courbe;

  // Ne réécrit QUE les vrais retournements : si le biais va dans le sens du
  // drift déjà tracé (continuation/accélération), la courbe est cohérente.
  const drift = Math.sign(pivotVal - t0);
  if (drift !== 0 && sign === drift) return courbe;

  // Purement correctif : si la phase 2 du modèle exprime DÉJÀ le biais (il a
  // tracé le rebond lui-même), on ne l'écrase pas.
  const phase2Drift = Math.sign(courbe[courbe.length - 1].valeur - pivotVal);
  if (phase2Drift !== 0 && phase2Drift === sign) return courbe;

  // Pas quotidien de la phase 2 = mouvement moyen déjà tracé (plancher 0,3 % t0
  // pour qu'un actif quasi plat s'infléchisse quand même de façon visible),
  // amorti (un retournement est graduel), et borné pour ne pas surréagir.
  const phase1 = Math.abs(pivotVal - t0);
  const step = Math.max(phase1 / pivotDay, Math.abs(t0) * 0.003) * 0.7;
  const maxMove = Math.max(phase1 * 1.5, Math.abs(t0) * 0.02);

  const out = courbe.filter((p) => p.t_jours <= pivotDay).map((p) => ({ ...p }));
  for (let d = pivotDay + 1; d <= horizonDays; d++) {
    const move = Math.min(step * (d - pivotDay), maxMove);
    out.push({ t_jours: d, valeur: r2(pivotVal + sign * move) });
  }
  if (pivotOut) pivotOut.jour = pivotDay;
  return out;
}

/** Ancre t0 = cours réel, ordonne la courbe, garde les valeurs numériques. */
function normalizeCurves(parsed, traj, horizonDays) {
  if (!parsed || typeof parsed !== "object") return null;
  const labelToKey = new Map(ASSETS.map(([k, l]) => [l, k]));
  const actifs = Array.isArray(parsed.actifs) ? parsed.actifs : [];
  const out = [];
  for (const a of actifs) {
    const key = labelToKey.get(a.actif);
    const t0 = key ? traj.current[key] : null;
    const pts = Array.isArray(a.courbe) ? a.courbe : [];
    const courbe = pts
      .map((p) => ({ t_jours: Number(p.t_jours), valeur: Number(p.valeur) }))
      .filter((p) => Number.isFinite(p.t_jours) && Number.isFinite(p.valeur) && p.t_jours >= 1)
      .sort((x, y) => x.t_jours - y.t_jours);
    // Point t0 ancré sur le cours réel (pas celui du modèle).
    const full = t0 != null ? [{ t_jours: 0, valeur: r2(t0) }, ...courbe] : courbe;
    const retournement = a.retournement && typeof a.retournement === "object" ? a.retournement : { probable: false };
    // Réaligne le tracé sur la thèse de retournement (no-op si continuation).
    const piv = {};
    const shaped = inflectCurve(full, retournement, horizonDays, piv);
    out.push({
      actif: a.actif,
      direction: a.direction ?? "neutre",
      confiance: typeof a.confiance === "number" ? a.confiance : null,
      courbe: shaped,
      retournement,
      inflexion: piv.jour != null ? { applique: true, jour_pivot: piv.jour } : { applique: false },
      commentaire: a.commentaire ?? "",
    });
  }
  return {
    disclaimer: DISCLAIMER,
    baseTs: Date.now(),
    horizonJours: horizonDays,
    span: traj.span,
    actifs: out,
  };
}

function parseJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) try { return JSON.parse(m[0]); } catch { return null; }
    return null;
  }
}

/**
 * Projette les courbes à partir d'une trajectoire déjà construite (partie pure
 * LLM, testable en injectant une trajectoire).
 */
export async function projectCurvesFromTrajectory(traj, { horizonDays = 7, provider } = {}) {
  const chain = provider ? [provider] : getProviderChain();
  const user = formatTrajectory(traj, horizonDays);
  const errors = [];
  for (const p of chain) {
    try {
      const raw = await p.complete({ system: SYSTEM, user, timeout: 90000 });
      const res = normalizeCurves(parseJson(raw), traj, horizonDays);
      if (!res) {
        logger.warn(`[curve] "${p.name}" : JSON non parsé`);
        return { provider: p.name, curves: null, raw };
      }
      return { provider: p.name, curves: res, raw };
    } catch (err) {
      errors.push(`${p.name}: ${err.message}`);
      logger.warn(`[curve] fournisseur "${p.name}" en échec → fallback (${err.message})`);
    }
  }
  throw new Error(`tous les fournisseurs IA ont échoué (curve) — ${errors.join(" | ")}`);
}

/** Construit la trajectoire depuis le store puis projette les courbes. */
export async function projectCurves({ windowDays = 7, horizonDays = 7, provider } = {}) {
  const traj = await buildTrajectory(windowDays * 86400000);
  if (!traj.regimes.length) throw new Error("aucun verdict sur la fenêtre — trajectoire vide");
  return projectCurvesFromTrajectory(traj, { horizonDays, provider });
}

export { DISCLAIMER };
