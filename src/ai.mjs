// fa:ai — force une analyse IA MAINTENANT, enregistre snapshot + verdict, et
// imprime le verdict en JSON pur sur stdout (logs coupés avant tout import).
import { config } from "dotenv";
config({ quiet: true });
process.env.LOG_LEVEL = "silent";

// Debug : --prompt affiche le prompt envoyé au LLM (sans rien enregistrer).
if (process.argv.includes("--prompt")) {
  const { getWorldState } = await import("./modules/fundamental/index.js");
  const { getTrends } = await import("./modules/fundamental/persistence/scheduler.js");
  const { formatState } = await import("./modules/fundamental/ai/index.js");
  const { loadLatestVerdict } = await import("./modules/fundamental/persistence/store.js");
  const state = await getWorldState();
  const trends = await getTrends();
  const previous = await loadLatestVerdict().catch(() => null);
  console.log(formatState(state, trends, previous));
  process.exit(0);
}

const { analyzeNow } = await import("./modules/fundamental/ai/runner.js");

try {
  const { provider, verdict, raw } = await analyzeNow();
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
