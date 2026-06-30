/**
 * Détecteur de bascule : compare les métriques courantes à une référence
 * (l'état au dernier point IA) et signale tout franchissement de seuil.
 * C'est ce qui déclenche une analyse IA "sur bascule" entre deux points de fond.
 *
 * type "abs" : variation absolue (points). type "pct" : variation en %.
 */
export const THRESHOLDS = {
  fearGreed: { type: "abs", value: 6, label: "Fear & Greed" },
  btcDominance: { type: "abs", value: 1, label: "Dominance BTC" },
  dxy: { type: "pct", value: 0.5, label: "Dollar Index" },
  netLiquidity: { type: "pct", value: 1.5, label: "Liquidité nette" },
  globalLiquidity: { type: "pct", value: 1.5, label: "Liquidité globale" },
  realYield10y: { type: "abs", value: 0.1, label: "Taux réel 10Y" },
  yieldCurve: { type: "abs", value: 0.1, label: "Courbe 10Y-2Y" },
  highYieldSpread: { type: "pct", value: 10, label: "Spread high yield" },
  yield10y: { type: "pct", value: 3, label: "10Y" },
  sp500: { type: "pct", value: 1.0, label: "S&P500" },
  nasdaq: { type: "pct", value: 1.5, label: "Nasdaq" },
  vix: { type: "pct", value: 10, label: "VIX" },
  dvol: { type: "pct", value: 15, label: "DVOL (vol crypto)" },
  cotHedgeFundsNet: { type: "abs", value: 2000, label: "Positionnement hedge funds BTC" },
  cotGoldNet: { type: "abs", value: 15000, label: "Positionnement or (COT)" },
  cotSp500Net: { type: "abs", value: 50000, label: "Positionnement S&P500 (COT)" },
  policyUncertainty: { type: "pct", value: 25, label: "Incertitude politique (EPU)" },
  gold: { type: "pct", value: 2, label: "Or" },
  btcPrice: { type: "pct", value: 3, label: "Prix BTC" },
  ethPrice: { type: "pct", value: 4, label: "Prix ETH" },
  funding: { type: "abs", value: 0.0003, label: "Funding BTC" },
  ethFunding: { type: "abs", value: 0.0003, label: "Funding ETH" },
  wtiOil: { type: "pct", value: 3, label: "Pétrole WTI" },
  stablecoinMcapUsd: { type: "pct", value: 1, label: "Stablecoins" },
  gdeltHeadlines: { type: "abs", value: 8, label: "Volume géopol (GDELT)" },
  acledFatalities: { type: "abs", value: 50, label: "Morts (ACLED)" },
};

export function detectChanges(current, ref) {
  if (!ref) return [];
  const out = [];
  for (const [metric, cfg] of Object.entries(THRESHOLDS)) {
    const a = current?.[metric];
    const b = ref?.[metric];
    if (a == null || b == null) continue;

    if (cfg.type === "abs") {
      const delta = a - b;
      if (Math.abs(delta) >= cfg.value) out.push({ metric, label: cfg.label, from: b, to: a, delta });
    } else {
      if (b === 0) continue;
      const pct = ((a - b) / Math.abs(b)) * 100;
      if (Math.abs(pct) >= cfg.value) out.push({ metric, label: cfg.label, from: b, to: a, pct });
    }
  }
  return out;
}

export function formatChange(c) {
  if (c.pct != null) return `${c.label} ${c.pct >= 0 ? "+" : ""}${c.pct.toFixed(2)}%`;
  return `${c.label} ${c.delta >= 0 ? "+" : ""}${c.delta} (${c.from}→${c.to})`;
}

/** Catalyseurs calendaires fort impact tombant aujourd'hui (CPI, NFP, FOMC, etc.). */
export function calendarToday(state) {
  const today = new Date().toISOString().slice(0, 10);
  const events = state?.axes?.macro?.["investing-calendar"]?.events || [];
  const out = [];
  for (const e of events) {
    if (e.date === today && e.impact === "high") {
      out.push({ name: `${e.country || ""} ${e.event}`.trim(), date: today });
    }
  }
  // Dédoublonnage par libellé.
  const seen = new Set();
  return out.filter((e) => (seen.has(e.name) ? false : (seen.add(e.name), true)));
}
