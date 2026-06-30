import { config } from "dotenv";
config({ quiet: true });
process.env.LOG_LEVEL = "silent";

const { getWorldState } = await import("./modules/fundamental/index.js");

// Diagnostic de FRAÎCHEUR : pour chaque source, la date réelle de la donnée
// la plus récente + son âge + la cadence attendue. Vérité terrain, pas promesse.
const state = await getWorldState();
const now = state.ts;
const a = state.axes;

const toMs = (v) => {
  if (v == null) return null;
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v; // sec -> ms si besoin
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};
const freshest = (...vals) => {
  const ms = vals.map(toMs).filter((x) => x != null);
  return ms.length ? Math.max(...ms) : null;
};
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

// Date la plus récente parmi un dict de {value,date}.
const fredFreshest = (obj) => (obj ? freshest(...Object.values(obj).map((o) => o?.date)) : null);

const rows = [
  ["fear-greed", "quotidien", freshest(a.sentiment?.["fear-greed"]?.ts)],
  ["binance-futures", "temps réel", now], // flux live, pas de date -> instant de collecte
  ["deribit (DVOL)", "temps réel (~h)", freshest(a.sentiment?.deribit?.ts)],
  ["cftc-cot", "HEBDO (mar., publié ven.)", toMs(a.positioning?.["cftc-cot"]?.date)],
  ["coingecko", "temps réel", now],
  ["blockchain-info", "temps réel (~10 min)", now],
  ["defillama", "quotidien", freshest(a.onchain?.defillama?.tvlDate)],
  ["fred (quotidien: DXY/taux)", "fin de séance J-1", freshest(a.macro?.fred?.dollarIndex?.date, a.macro?.fred?.yield10y?.date, a.macro?.fred?.yield2y?.date)],
  ["fred (mensuel: M2/CPI/PCE)", "MENSUEL", freshest(a.macro?.fred?.m2?.date, a.macro?.fred?.cpi?.date, a.macro?.fred?.pce?.date)],
  ["liquidity (Fed/RRP/TGA)", "hebdo/quotidien", freshest(a.liquidity?.liquidity?.fedBalanceSheet?.date, a.liquidity?.liquidity?.tga?.date)],
  ["markets (S&P/Nasdaq/VIX)", "fin de séance J-1", fredFreshest(a.markets?.markets)],
  ["markets-live (Finnhub/TD)", "temps réel (intraday)", freshest(...Object.values(a.markets?.["markets-live"] || {}).map((v) => v?.datetime))],
  ["commodities (pétrole)", "fin de séance J-1", freshest(a.commodities?.commodities?.wtiOil?.date)],
  ["commodities (or/argent)", "temps réel", freshest(a.commodities?.commodities?.gold?.date)],
  ["gdelt", "~15 min", freshest(...(a.geopolitics?.gdelt?.topHeadlines || []).map((h) => h.date))],
  ["acled", "hebdomadaire", freshest(...(a.geopolitics?.acled?.recentEvents || []).map((e) => e.date))],
  ["news (RSS)", "temps réel (min)", freshest(...(a.news?.news?.items || []).map((i) => i.date))],
];

console.log(`\n=== FRAÎCHEUR @ ${new Date(now).toISOString()} ===\n`);
console.log("source".padEnd(30), "donnée du".padEnd(18), "âge".padEnd(8), "cadence attendue");
console.log("-".repeat(86));
for (const [src, cadence, ts] of rows) {
  console.log(src.padEnd(30), fmtDate(ts).padEnd(18), fmtAge(ts).padEnd(8), cadence);
}

const stale = state.meta?.staleSources || [];
if (stale.length) console.log("\n⚠️ sources indisponibles ce run :", stale.join(", "));
process.exit(0);
