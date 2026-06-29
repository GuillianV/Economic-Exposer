import "dotenv/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getWorldState } from "./modules/fundamental/index.js";

// Harness : récupère le world-state live, l'affiche (résumé) et écrit le
// snapshot COMPLET (toutes les news, manchettes, thèmes...) dans un fichier.
const state = await getWorldState();

const fmtDate = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") : "????");

// Dump complet inspectable.
const dumpPath = path.resolve(process.cwd(), "data", "last-check.json");
await fs.mkdir(path.dirname(dumpPath), { recursive: true });
await fs.writeFile(dumpPath, JSON.stringify(state, null, 2), "utf8");

console.log("\n=== WORLD-STATE @", new Date(state.ts).toISOString(), "===");
console.log("(snapshot COMPLET écrit dans", path.relative(process.cwd(), dumpPath) + ")\n");

// Axes structurés compacts (hors flux volumineux).
const { news, geopolitics, ...rest } = state.axes;
const compact = { ...rest };
delete compact.news;
console.dir(compact, { depth: null, colors: true });

// Géopolitique (GDELT).
const gdelt = geopolitics?.gdelt;
if (gdelt) {
  console.log("\n--- geopolitics (GDELT) ---");
  console.log(`manchettes : ${gdelt.headlineCount}`);
  (gdelt.topHeadlines || []).slice(0, 8).forEach((h) =>
    console.log(`  [${fmtDate(h.date)}] (${h.sourceCountry || "?"}) ${h.title}`),
  );
}

// Conflits structurés (ACLED).
const acled = geopolitics?.acled;
if (acled) {
  console.log("\n--- conflits (ACLED) ---");
  console.log(`fenêtre ${acled.windowDays}j · événements : ${acled.totalEvents} · morts : ${acled.totalFatalities}`);
  console.log("top pays :", (acled.topCountries || []).map((c) => `${c.country} (${c.events}ev/${c.fatalities}†)`).join(", "));
  (acled.recentEvents || []).slice(0, 6).forEach((e) =>
    console.log(`  [${e.date}] ${e.country} — ${e.subEventType} (${e.fatalities}†) ${e.actors}`),
  );
} else if (state.sources.acled?.stale) {
  console.log("\n--- conflits (ACLED) --- stale :", state.sources.acled.error);
}

// News RSS.
const newsData = news?.news;
if (newsData) {
  console.log("\n--- news RSS ---");
  console.log(`flux OK : ${newsData.feedsOk}/${newsData.feedCount} · collectés : ${newsData.totalCollected} · gardés : ${newsData.kept}`);
  const ko = Object.entries(newsData.feeds).filter(([, s]) => !s.ok);
  if (ko.length) console.log("flux KO :", ko.map(([n]) => n).join(", "));
  newsData.items.slice(0, 8).forEach((it) =>
    console.log(`  [${fmtDate(it.date)}] (${it.source}) ${it.title}`),
  );
}

// Google News thématique.
const gnews = news?.["google-news"];
if (gnews) {
  console.log("\n--- google-news (thématique) ---");
  console.log(`thèmes OK : ${gnews.themesOk}/${gnews.themeCount} · items : ${gnews.totalItems}`);
  for (const [theme, items] of Object.entries(gnews.themes)) {
    console.log(`  ${theme} (${items.length})${items[0] ? " — " + items[0].title : ""}`);
  }
}

console.log("\n--- meta ---");
console.dir(state.meta, { depth: null, colors: true });

process.exit(0);
