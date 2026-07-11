import "dotenv/config";
import { serviceTick } from "./modules/fundamental/ai/runner.js";

/**
 * Harness CLI : exécute UN tour de service (collecte + analyse
 * conditionnelle). Sortie stdout voulue.
 */
const result = await serviceTick();

console.log("\n=== TICK ===");
console.log("IA déclenchée :", result.triggered);
if (result.reasons) console.log("raisons       :", result.reasons.join(" | "));
if (result.verdict) {
  console.log("régime        :", result.verdict.regime, "| confiance:", result.verdict.confiance);
  console.log("résumé        :", result.verdict.resume);
}
if (result.file) console.log("verdict       :", result.file);

process.exit(0);
