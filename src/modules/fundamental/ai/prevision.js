import { logger } from "../../logs/index.js";
import { getProviderChain } from "./analyst.js";
import { loadMetricsSince } from "../persistence/store.js";
import { buildTrajectory, ASSETS } from "./curve.js";

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

const DISCLAIMER =
  "Prévision directionnelle IA à 24h, évaluée publiquement contre le réalisé le " +
  "lendemain. PAS un conseil financier : même un bon système se trompe souvent — " +
  "le score affiché fait foi, pas la promesse.";

const r2 = (n) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) / 100 : n);

// Repli si moins de 8 jours d'historique : σ quotidien typique par famille (%).
const FALLBACK_SIGMA = {
  btcPrice: 2.4, ethPrice: 3.2, solPrice: 4.0,
  sp500: 0.9, nasdaq: 1.2,
  dxy: 0.35, eurusd: 0.4, usdjpy: 0.5,
  gold: 0.9,
};

/** σ des rendements quotidiens (%) par actif, depuis les snapshots ~30 j. */
export async function dailyVolatility() {
  const since = Date.now() - 32 * 86400000;
  const series = await loadMetricsSince(since);
  const byDay = new Map(); // dayKey -> metrics du dernier snapshot du jour
  for (const s of series) byDay.set(Math.floor(s.ts / 86400000), s.metrics || {});
  const days = [...byDay.keys()].sort((a, b) => a - b);
  const out = {};
  for (const [key] of ASSETS) {
    const rets = [];
    let prev = null;
    for (const d of days) {
      const v = byDay.get(d)?.[key];
      if (v == null || !Number.isFinite(v)) continue;
      if (prev != null && prev > 0) rets.push(Math.log(v / prev) * 100);
      prev = v;
    }
    if (rets.length >= 8) {
      const m = rets.reduce((a, b) => a + b, 0) / rets.length;
      out[key] = Math.sqrt(rets.reduce((s, x) => s + (x - m) ** 2, 0) / rets.length);
    } else out[key] = FALLBACK_SIGMA[key] ?? 1.5;
  }
  return out;
}

/** Seuils concrets (%) d'un actif depuis son σ quotidien. */
export function thresholdsOf(sigmaPct) {
  return { calme: r2(0.25 * sigmaPct), fort: r2(1.0 * sigmaPct) };
}

/** Classe le rendement réalisé (%) selon les seuils stockés. */
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

/** Message utilisateur : trajectoire compacte + seuils par actif. */
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
  return lines.join("\n");
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
 * Génère la prévision 24h : une classe par actif, ancrée sur le cours actuel,
 * seuils stockés avec le record (l'évaluation du lendemain réutilise EXACTEMENT
 * les seuils de l'émission — pas ceux du jour suivant).
 */
export async function projectPrevisions({ provider } = {}) {
  const traj = await buildTrajectory(7 * 86400000);
  if (!traj.regimes.length) throw new Error("aucun verdict sur la fenêtre — trajectoire vide");
  const vols = await dailyVolatility();
  const chain = provider ? [provider] : getProviderChain();
  const user = formatUser(traj, vols);
  const labelToKey = new Map(ASSETS.map(([k, l]) => [l, k]));
  const errors = [];
  for (const p of chain) {
    try {
      const raw = await p.complete({ system: SYSTEM, user, timeout: 90000 });
      const parsed = parseJson(raw);
      if (!parsed || !Array.isArray(parsed.actifs)) {
        logger.warn(`[prevision] "${p.name}" : JSON non parsé`);
        return { provider: p.name, previsions: null, raw };
      }
      const baseTs = Date.now();
      const actifs = [];
      for (const a of parsed.actifs) {
        const key = labelToKey.get(a.actif);
        if (!key || traj.current[key] == null) continue;
        const classe = CLASSES.includes(a.classe) ? a.classe : "calme";
        actifs.push({
          actif: a.actif,
          metricKey: key,
          classe,
          conviction: typeof a.conviction === "number" ? r2(Math.min(1, Math.max(0, a.conviction))) : null,
          raison: String(a.raison ?? "").slice(0, 280),
          prixBase: r2(traj.current[key]),
          seuils: thresholdsOf(vols[key]),
          sigmaJour: r2(vols[key]),
        });
      }
      return {
        provider: p.name,
        previsions: {
          disclaimer: DISCLAIMER,
          baseTs,
          targetTs: baseTs + 24 * 3600000,
          horizonHeures: 24,
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

// ---- Évaluation (le lendemain) ---------------------------------------------

/** Prix d'un actif au plus près de `ts` (premier snapshot ≥ ts, tolérance 6h). */
async function priceAt(metricKey, ts) {
  const series = await loadMetricsSince(ts - 3600000);
  for (const s of series) {
    if (s.ts >= ts && s.ts <= ts + 6 * 3600000) {
      const v = s.metrics?.[metricKey];
      if (v != null && Number.isFinite(v)) return { v, ts: s.ts };
    }
  }
  return null;
}

/**
 * Évalue un record de prévision si son échéance est passée : classe réalisée
 * par actif (avec LES SEUILS STOCKÉS), outcome exact/adjacent/faux + direction.
 * Renvoie le record MUTÉ (ou inchangé si trop tôt / déjà évalué / prix manquant).
 */
export async function evaluatePrevision(record) {
  if (!record?.actifs?.length || record.outcome) return record;
  if (Date.now() < record.targetTs) return record;
  let evaluated = 0;
  for (const a of record.actifs) {
    if (a.realise) continue;
    const px = await priceAt(a.metricKey, record.targetTs);
    if (!px || a.prixBase == null || a.prixBase === 0) continue;
    const retPct = r2(((px.v - a.prixBase) / a.prixBase) * 100);
    const classeReelle = classify(retPct, a.seuils);
    const dist = Math.abs(CLASS_INDEX.get(classeReelle) - CLASS_INDEX.get(a.classe));
    const dir = (c) => (c === "calme" ? 0 : c === "hausse" || c === "envolee" ? 1 : -1);
    a.realise = {
      prix: r2(px.v),
      ts: px.ts,
      retPct,
      classe: classeReelle,
      resultat: dist === 0 ? "exact" : dist === 1 ? "adjacent" : "faux",
      directionOk: dir(a.classe) === dir(classeReelle),
    };
    evaluated++;
  }
  if (evaluated && record.actifs.every((a) => a.realise)) {
    record.outcome = { evaluatedAt: Date.now() };
  }
  return record;
}

/** Statistiques agrégées sur une liste de records évalués. */
export function statsOf(records) {
  const global = { n: 0, exact: 0, adjacent: 0, directionOk: 0 };
  const parActif = {};
  for (const r of records) {
    for (const a of r.actifs ?? []) {
      if (!a.realise) continue;
      const s = (parActif[a.actif] ??= { n: 0, exact: 0, adjacent: 0, directionOk: 0 });
      for (const t of [global, s]) {
        t.n++;
        if (a.realise.resultat === "exact") t.exact++;
        if (a.realise.resultat === "adjacent") t.adjacent++;
        if (a.realise.directionOk) t.directionOk++;
      }
    }
  }
  const pct = (t) => ({
    n: t.n,
    exactPct: t.n ? Math.round((t.exact / t.n) * 100) : null,
    exactOuAdjacentPct: t.n ? Math.round(((t.exact + t.adjacent) / t.n) * 100) : null,
    directionPct: t.n ? Math.round((t.directionOk / t.n) * 100) : null,
  });
  return {
    global: pct(global),
    parActif: Object.fromEntries(Object.entries(parActif).map(([k, v]) => [k, pct(v)])),
    reperes: { hasardExact: 20, hasardDirection: 50 },
  };
}

export { DISCLAIMER as PREVISION_DISCLAIMER };
