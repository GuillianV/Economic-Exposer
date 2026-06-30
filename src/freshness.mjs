import { config } from "dotenv";
config({ quiet: true });
process.env.LOG_LEVEL = "silent";

const { getWorldState } = await import("./modules/fundamental/index.js");
const { freshnessRows } = await import("./modules/fundamental/freshness.js");

// Diagnostic de FRAÎCHEUR : pour chaque source, la date réelle de la donnée
// la plus récente + son âge + la cadence attendue. Vérité terrain, pas promesse.
const state = await getWorldState();
const now = state.ts;

const fmtAge = (ts) => {
  if (ts == null) return "—";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} j`;
};
const fmtDate = (ts) => (ts == null ? "—" : new Date(ts).toISOString().slice(0, 16).replace("T", " "));

console.log(`\n=== FRAÎCHEUR @ ${new Date(now).toISOString()} ===\n`);
console.log("source".padEnd(30), "donnée du".padEnd(18), "âge".padEnd(8), "cadence attendue");
console.log("-".repeat(86));
for (const { source, cadence, dataTs } of freshnessRows(state)) {
  console.log(source.padEnd(30), fmtDate(dataTs).padEnd(18), fmtAge(dataTs).padEnd(8), cadence);
}

const stale = state.meta?.staleSources || [];
if (stale.length) console.log("\n⚠️ sources indisponibles ce run :", stale.join(", "));
process.exit(0);
