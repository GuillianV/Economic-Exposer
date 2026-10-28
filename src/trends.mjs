import "dotenv/config";
import { collectOnce, getTrends } from "./modules/fundamental/persistence/scheduler.js";

/**
 * Harness CLI : collecte un snapshot, puis affiche les tendances sur
 * l'historique (sortie stdout voulue — pas le logger).
 */
await collectOnce();
const trends = await getTrends();

console.log(`\n=== TENDANCES (${trends.count} snapshot(s) dans l'historique) ===\n`);

const SHOWN_METRICS = [
  "btcPrice", "fearGreed", "funding", "btcDominance", "ethBtcRatio",
  "dxy", "yield10y", "m2", "wtiOil",
  "totalTvlUsd", "stablecoinMcapUsd", "gdeltHeadlines",
];

/**
 * Formate un delta en pourcentage signé.
 * @param {{abs: number, pct: number|null}|null} delta Delta d'une métrique.
 * @returns {string} Ex. "+1.20%", ou "—" si absent.
 */
function formatPct(delta) {
  if (!delta || delta.pct == null) return "—";
  const sign = delta.abs >= 0 ? "+" : "";
  return `${sign}${delta.pct.toFixed(2)}%`;
}

for (const key of SHOWN_METRICS) {
  const metric = trends.metrics[key];
  if (!metric) continue;
  const value = metric.value == null ? "stale" : metric.value;
  console.log(
    `  ${key.padEnd(20)} = ${String(value).padEnd(16)} | 1h ${formatPct(metric.d1h).padStart(8)} | 24h ${formatPct(metric.d24h).padStart(8)} | 7j ${formatPct(metric.d7d).padStart(8)}`,
  );
}

process.exit(0);
