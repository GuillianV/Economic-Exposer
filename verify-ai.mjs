// Sortie 100% JSON : on coupe le bandeau dotenv et les logs avant tout import.
import { config } from "dotenv";
config({ quiet: true });
process.env.LOG_LEVEL = "silent";

const { getWorldState } = await import("./modules/fundamental/index.js");
const { getTrends } = await import("./modules/fundamental/persistence/scheduler.js");
const { analyze, formatState } = await import("./modules/fundamental/ai/index.js");

const state = await getWorldState();
const trends = await getTrends();

// Debug optionnel : --prompt affiche le prompt envoyé au LLM (non-JSON).
if (process.argv.includes("--prompt")) {
  console.log(formatState(state, trends));
  process.exit(0);
}

try {
  const { provider, verdict, raw } = await analyze(state, trends);
  if (verdict) {
    console.log(JSON.stringify(verdict, null, 2));
  } else {
    console.log(JSON.stringify({ error: "verdict non parsé", provider, raw }, null, 2));
    process.exit(1);
  }
} catch (err) {
  console.log(JSON.stringify({ error: err.message }, null, 2));
  process.exit(1);
}
process.exit(0);
