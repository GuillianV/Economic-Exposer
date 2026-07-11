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
  solPrice: { type: "pct", value: 5, label: "Prix SOL" },
  bnbPrice: { type: "pct", value: 5, label: "Prix BNB" },
  xrpPrice: { type: "pct", value: 6, label: "Prix XRP" },
  funding: { type: "abs", value: 0.0003, label: "Funding BTC" },
  ethFunding: { type: "abs", value: 0.0003, label: "Funding ETH" },
  solFunding: { type: "abs", value: 0.0004, label: "Funding SOL" },
  wtiOil: { type: "pct", value: 3, label: "Pétrole WTI" },
  stablecoinMcapUsd: { type: "pct", value: 1, label: "Stablecoins" },
  longShortAccountRatio: { type: "abs", value: 0.3, label: "Ratio long/short BTC" },
  totalVolume24hUsd: { type: "pct", value: 30, label: "Volume crypto 24h" },
  mempoolFeeFast: { type: "pct", value: 50, label: "Frais réseau BTC" },
  gdeltHeadlines: { type: "abs", value: 8, label: "Volume géopol (GDELT)" },
};

/**
 * Compare les métriques courantes à la référence et liste les franchissements
 * de seuil (THRESHOLDS).
 * @param {object} current Métriques courantes (extractMetrics).
 * @param {object|null} ref Métriques au dernier point IA (ai-state).
 * @returns {Array<{metric: string, label: string, from: number, to: number,
 *   delta?: number, pct?: number}>} Bascules détectées (delta pour type "abs",
 *   pct pour type "pct").
 */
export function detectChanges(current, ref) {
  if (!ref) return [];
  const changes = [];
  for (const [metric, cfg] of Object.entries(THRESHOLDS)) {
    const currentValue = current?.[metric];
    const refValue = ref?.[metric];
    if (currentValue == null || refValue == null) continue;

    if (cfg.type === "abs") {
      const delta = currentValue - refValue;
      if (Math.abs(delta) >= cfg.value) changes.push({ metric, label: cfg.label, from: refValue, to: currentValue, delta });
    } else {
      if (refValue === 0) continue;
      const pct = ((currentValue - refValue) / Math.abs(refValue)) * 100;
      if (Math.abs(pct) >= cfg.value) changes.push({ metric, label: cfg.label, from: refValue, to: currentValue, pct });
    }
  }
  return changes;
}

/**
 * Libellé lisible d'une bascule (pour les logs et le champ triggers).
 * @param {{label: string, from: number, to: number, delta?: number,
 *   pct?: number}} change Bascule détectée.
 * @returns {string} Ex. "Dollar Index +0.62%" ou "Fear & Greed +8 (52→60)".
 */
export function formatChange(change) {
  if (change.pct != null) return `${change.label} ${change.pct >= 0 ? "+" : ""}${change.pct.toFixed(2)}%`;
  return `${change.label} ${change.delta >= 0 ? "+" : ""}${change.delta} (${change.from}→${change.to})`;
}

/**
 * Catalyseurs calendaires fort impact tombant aujourd'hui (CPI, NFP, FOMC…),
 * dédoublonnés par libellé.
 * @param {object} state World-state complet (calendrier investing-calendar).
 * @returns {Array<{name: string, date: string}>} Catalyseurs du jour.
 */
export function calendarToday(state) {
  const today = new Date().toISOString().slice(0, 10);
  const events = state?.axes?.macro?.["investing-calendar"]?.events || [];

  const catalysts = [];
  const seen = new Set();
  for (const event of events) {
    if (event.date !== today || event.impact !== "high") continue;
    const name = `${event.country || ""} ${event.event}`.trim();
    if (seen.has(name)) continue;
    seen.add(name);
    catalysts.push({ name, date: today });
  }
  return catalysts;
}
