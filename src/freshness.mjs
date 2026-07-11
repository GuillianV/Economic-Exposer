import { config } from "dotenv";
config({ quiet: true });
process.env.LOG_LEVEL = "silent";

const { getWorldState } = await import("./modules/fundamental/index.js");
const { freshnessRows } = await import("./modules/fundamental/freshness.js");

/**
 * Harness CLI de FRAÎCHEUR : pour chaque source, la date réelle de la donnée
 * la plus récente + son âge + la cadence attendue. Vérité terrain, pas
 * promesse. Sortie stdout voulue (logs coupés).
 */
const state = await getWorldState();
const now = state.ts;

const SECONDS_AS_IS_MAX = 90;
const MINUTES_AS_IS_MAX = 90;
const HOURS_AS_IS_MAX = 48;

/**
 * Formate un âge en unité lisible (s, min, h, j).
 * @param {number|null} ts Epoch ms de la donnée.
 * @returns {string} Âge lisible, ou "—" si inconnu.
 */
function formatAge(ts) {
  if (ts == null) return "—";
  const seconds = Math.max(0, Math.round((now - ts) / 1000));
  if (seconds < SECONDS_AS_IS_MAX) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < MINUTES_AS_IS_MAX) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < HOURS_AS_IS_MAX) return `${hours} h`;
  return `${Math.round(hours / 24)} j`;
}

/**
 * Formate une date en "AAAA-MM-JJ HH:MM" UTC.
 * @param {number|null} ts Epoch ms.
 * @returns {string} Date lisible, ou "—" si inconnue.
 */
function formatDate(ts) {
  if (ts == null) return "—";
  return new Date(ts).toISOString().slice(0, 16).replace("T", " ");
}

console.log(`\n=== FRAÎCHEUR @ ${new Date(now).toISOString()} ===\n`);
console.log("source".padEnd(30), "donnée du".padEnd(18), "âge".padEnd(8), "cadence attendue");
console.log("-".repeat(86));
for (const { source, cadence, dataTs } of freshnessRows(state)) {
  console.log(source.padEnd(30), formatDate(dataTs).padEnd(18), formatAge(dataTs).padEnd(8), cadence);
}

const stale = state.meta?.staleSources || [];
if (stale.length) console.log("\nATTENTION — sources indisponibles ce run :", stale.join(", "));
process.exit(0);
