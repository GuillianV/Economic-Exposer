import "dotenv/config";
import { collectOnce, getTrends } from "./modules/fundamental/persistence/scheduler.js";

// Harness : collecte un snapshot, puis affiche les tendances sur l'historique.
await collectOnce();
const trends = await getTrends();

console.log(`\n=== TENDANCES (${trends.count} snapshot(s) dans l'historique) ===\n`);

const show = [
  "btcPrice", "fearGreed", "funding", "btcDominance", "ethBtcRatio",
  "dxy", "yield10y", "m2", "wtiOil",
  "totalTvlUsd", "stablecoinMcapUsd", "gdeltHeadlines", "acledEvents",
];

const pct = (d) => (d && d.pct != null ? `${d.abs >= 0 ? "+" : ""}${d.pct.toFixed(2)}%` : "—");

for (const k of show) {
  const m = trends.metrics[k];
  if (!m) continue;
  const v = m.value == null ? "stale" : m.value;
  console.log(`  ${k.padEnd(20)} = ${String(v).padEnd(16)} | 1h ${pct(m.d1h).padStart(8)} | 24h ${pct(m.d24h).padStart(8)} | 7j ${pct(m.d7d).padStart(8)}`);
}

process.exit(0);
