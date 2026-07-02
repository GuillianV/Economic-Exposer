// Fraîcheur par source : date réelle de la donnée la plus récente de chaque
// collecteur, dérivée d'un world-state (live) OU d'un snapshot stocké (mêmes
// axes). Partagé par le CLI `fa:freshness` et l'API (/api/freshness,
// /api/snapshots/:ts/freshness) — une seule source de vérité.

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
const fredFreshest = (obj) => (obj ? freshest(...Object.values(obj).map((o) => o?.date)) : null);

/**
 * Date la plus récente par source à partir d'un état (live ou snapshot).
 * `dataTs` est en ms epoch (ou null si la source n'a rien fourni).
 * @returns {{ source: string, cadence: string, dataTs: number|null }[]}
 */
export function freshnessRows(state) {
  const a = state?.axes ?? {};
  const now = state?.ts ?? Date.now(); // les flux "temps réel" sont aussi frais que la collecte
  return [
    ["fear-greed", "quotidien", freshest(a.sentiment?.["fear-greed"]?.ts)],
    ["binance-futures", "temps réel", now],
    ["deribit (DVOL/skew/P-C BTC+ETH)", "temps réel (~h)", freshest(a.sentiment?.deribit?.ts)],
    ["cftc-cot", "HEBDO (mar., publié ven.)", toMs(a.positioning?.["cftc-cot"]?.date)],
    ["coingecko", "temps réel", now],
    ["blockchain-info", "temps réel (~10 min)", now],
    ["defillama", "quotidien", freshest(a.onchain?.defillama?.tvlDate)],
    ["fred (quotidien: DXY/taux)", "fin de séance J-1", freshest(a.macro?.fred?.dollarIndex?.date, a.macro?.fred?.yield10y?.date, a.macro?.fred?.yield2y?.date)],
    ["fred (mensuel: M2/CPI/PCE)", "MENSUEL", freshest(a.macro?.fred?.m2?.date, a.macro?.fred?.cpi?.date, a.macro?.fred?.pce?.date)],
    ["liquidity (Fed/RRP/TGA)", "hebdo/quotidien", freshest(a.liquidity?.liquidity?.fedBalanceSheet?.date, a.liquidity?.liquidity?.tga?.date)],
    ["markets (S&P/Nasdaq/VIX/SKEW)", "fin de séance J-1", fredFreshest(a.markets?.markets)],
    ["markets-live (Finnhub/TD)", "temps réel (intraday)", freshest(...Object.values(a.markets?.["markets-live"] || {}).map((v) => v?.datetime))],
    ["commodities (pétrole)", "fin de séance J-1", freshest(a.commodities?.commodities?.wtiOil?.date)],
    ["metals (or/argent)", "temps réel", freshest(a.commodities?.metals?.gold?.date, a.commodities?.metals?.silver?.date)],
    ["gdelt", "~15 min", freshest(...(a.geopolitics?.gdelt?.topHeadlines || []).map((h) => h.date))],
    // acled retiré : collecteur désactivé dans world-state (accès API 403) — il
    // ne figure pas dans buildCollectors, donc axes.geopolitics.acled n'existe
    // jamais. Le lister ici produisait un null fantôme. À remettre si réactivé.
    ["news (RSS)", "temps réel (min)", freshest(...(a.news?.news?.items || []).map((i) => i.date))],
  ].map(([source, cadence, dataTs]) => ({ source, cadence, dataTs }));
}

/**
 * Payload API : fraîcheur par source (date + âge vs maintenant) + qualité globale.
 * @param {object} state world-state ou snapshot (doit porter axes + ts + meta).
 */
export function freshnessPayload(state) {
  const now = Date.now();
  const rows = freshnessRows(state);
  return {
    snapshotTs: state?.ts ?? null,
    snapshotIso: state?.ts != null ? new Date(state.ts).toISOString() : null,
    generatedAt: now,
    ok: state?.meta?.ok ?? null,
    total: state?.meta?.total ?? null,
    staleSources: state?.meta?.staleSources ?? [],
    sources: rows.map(({ source, cadence, dataTs }) => ({
      source,
      cadence,
      dataTs,
      dataIso: dataTs != null ? new Date(dataTs).toISOString() : null,
      ageSeconds: dataTs != null ? Math.max(0, Math.round((now - dataTs) / 1000)) : null,
    })),
  };
}
