import "dotenv/config";
import { serviceTick } from "./modules/fundamental/ai/runner.js";

// Harness : exécute UN tour de service (collecte + analyse conditionnelle).
const r = await serviceTick();

console.log("\n=== TICK ===");
console.log("IA déclenchée :", r.triggered);
if (r.reasons) console.log("raisons       :", r.reasons.join(" | "));
if (r.verdict) {
  console.log("régime        :", r.verdict.regime, "| confiance:", r.verdict.confiance);
  console.log("résumé        :", r.verdict.resume);
}
if (r.file) console.log("verdict       :", r.file);

process.exit(0);
