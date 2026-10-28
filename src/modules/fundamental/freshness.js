/**
 * Fraîcheur par source : date réelle de la donnée la plus récente de chaque
 * collecteur, dérivée d'un world-state (live) OU d'un snapshot stocké (mêmes
 * axes). Partagé par le CLI `fa:freshness` et l'API (/api/freshness,
 * /api/snapshots/:ts/freshness) — une seule source de vérité.
 */

import { DATA_PARAMS_VERSION } from "./persistence/store.js";

const SECONDS_EPOCH_THRESHOLD = 1e12; // en-dessous, un nombre est un epoch en secondes

/**
 * Convertit une date hétérogène (epoch s/ms, chaîne parsable) en epoch ms.
 * @param {*} value Date brute.
 * @returns {number|null} Epoch ms, ou null si non parsable.
 */
function toMs(value) {
  if (value == null) return null;
  if (typeof value === "number") {
    return value < SECONDS_EPOCH_THRESHOLD ? value * 1000 : value;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Date la plus récente parmi des dates hétérogènes.
 * @param {...*} values Dates brutes (epoch s/ms, chaînes).
 * @returns {number|null} Epoch ms de la plus récente, ou null si aucune.
 */
function freshest(...values) {
  const timestamps = values.map(toMs).filter((ms) => ms != null);
  return timestamps.length ? Math.max(...timestamps) : null;
}

/**
 * Date la plus récente parmi les séries d'un bloc FRED ({ serie: { date } }).
 * @param {object|null} block Bloc de séries datées.
 * @returns {number|null} Epoch ms de la plus récente, ou null.
 */
function fredFreshest(block) {
  if (!block) return null;
  return freshest(...Object.values(block).map((serie) => serie?.date));
}

/**
 * Horodatage de collecte d'une source, null si elle a échoué : pour les flux
 * temps réel, la donnée est aussi fraîche que sa dernière collecte RÉUSSIE —
 * jamais « maintenant » par défaut. Fonction PURE.
 * @param {object} state World-state ou snapshot (porte `sources`).
 * @param {string} name Nom de la source (clé de `sources`).
 * @returns {number|null} Epoch ms de la collecte réussie, ou null.
 */
export function getCollectedTs(state, name) {
  const source = state?.sources?.[name];
  if (!source?.ok) return null;
  return toMs(source.ts);
}

/**
 * Date la plus récente des articles Google News, tous thèmes confondus.
 * @param {object|null} googleNews Bloc google-news ({ themes: { thème: [{ date }] } }).
 * @returns {number|null} Epoch ms de l'article le plus récent, ou null.
 */
function googleNewsFreshest(googleNews) {
  const items = Object.values(googleNews?.themes ?? {}).flat();
  return freshest(...items.map((item) => item?.date));
}

/**
 * Date de la salve GDELT lue (fileTs) ; repli sur la date des manchettes pour
 * les snapshots antérieurs à fileTs.
 * @param {object|null} gdelt Bloc gdelt ({ fileTs?, topHeadlines }).
 * @returns {number|null} Epoch ms de la salve (ou de la manchette la plus récente), ou null.
 */
function gdeltFreshest(gdelt) {
  const fileMs = toMs(gdelt?.fileTs);
  if (fileMs != null) return fileMs;
  return freshest(...(gdelt?.topHeadlines || []).map((headline) => headline.date));
}

/**
 * Date la plus récente par source à partir d'un état (live ou snapshot).
 * @param {object} state World-state ou snapshot (doit porter axes, ts et
 *   sources — `sources` date les flux temps réel).
 * @returns {Array<{source: string, cadence: string, dataTs: number|null}>}
 *   Une ligne par source, dataTs en epoch ms (null si rien fourni).
 */
export function freshnessRows(state) {
  const a = state?.axes ?? {};
  return [
    ["fear-greed", "quotidien", freshest(a.sentiment?.["fear-greed"]?.ts)],
    ["binance-futures", "temps réel", getCollectedTs(state, "binance-futures")],
    ["deribit (DVOL/skew/P-C BTC+ETH)", "temps réel (~h)", freshest(a.sentiment?.deribit?.ts)],
    ["cftc-cot", "HEBDO (mar., publié ven.)", toMs(a.positioning?.["cftc-cot"]?.date)],
    ["coingecko", "temps réel", getCollectedTs(state, "coingecko")],
    ["etf-flows (BTC/ETH spot US)", "quotidien (J-1, clôture US)", freshest(a.structure?.["etf-flows"]?.btc?.date, a.structure?.["etf-flows"]?.eth?.date)],
    ["blockchain-info", "temps réel (~10 min)", getCollectedTs(state, "blockchain-info")],
    ["mempool", "temps réel", getCollectedTs(state, "mempool")],
    ["defillama", "quotidien", freshest(a.onchain?.defillama?.tvlDate)],
    ["fred (quotidien: DXY/taux)", "fin de séance J-1", freshest(a.macro?.fred?.dollarIndex?.date, a.macro?.fred?.yield10y?.date, a.macro?.fred?.yield2y?.date)],
    ["fred (mensuel: M2/CPI/PCE)", "MENSUEL", freshest(a.macro?.fred?.m2?.date, a.macro?.fred?.cpi?.date, a.macro?.fred?.pce?.date)],
    ["fedwatch (probas FOMC, futures ZQ)", "quotidien (~6h)", toMs(a.macro?.fedwatch?.asOf)],
    ["cycle (Mayer/Pi Cycle/200 sem)", "quotidien", toMs(a.onchain?.cycle?.asOf)],
    ["valuation (MVRV/MVRV-Z/Puell)", "quotidien", toMs(a.onchain?.valuation?.asOf)],
    ["bmpro (RHODL/Reserve Risk, scrape)", "quotidien (scrape)", toMs(a.onchain?.bmpro?.scrapedTs)],
    ["liquidations (Coinglass, scrape)", "~30 min (scrape)", toMs(a.structure?.liquidations?.scrapedTs)],
    ["derivatives (Coinglass, scrape)", "~30 min (scrape)", toMs(a.structure?.derivatives?.scrapedTs)],
    ["whales (Hyperliquid, scrape)", "~30 min (scrape)", toMs(a.structure?.whales?.scrapedTs)],
    ["treasuries (trésoreries BTC entités)", "quotidien (lent)", toMs(a.structure?.treasuries?.asOf)],
    ["liquidity (Fed/RRP/TGA)", "hebdo/quotidien", freshest(a.liquidity?.liquidity?.fedBalanceSheet?.date, a.liquidity?.liquidity?.tga?.date)],
    ["markets (S&P/Nasdaq/VIX/SKEW/MOVE)", "fin de séance J-1", fredFreshest(a.markets?.markets)],
    ["markets-live (Finnhub/TD)", "temps réel (intraday)", freshest(...Object.values(a.markets?.["markets-live"] || {}).map((quote) => quote?.datetime))],
    ["commodities (pétrole)", "quotidien, publié ~hebdo (EIA via FRED)", freshest(a.commodities?.commodities?.wtiOil?.date)],
    ["metals (or/argent)", "temps réel", freshest(a.commodities?.metals?.gold?.date, a.commodities?.metals?.silver?.date)],
    ["gdelt", "~15 min", gdeltFreshest(a.geopolitics?.gdelt)],
    // acled retiré : collecteur désactivé dans world-state (accès API 403) — il
    // ne figure pas dans buildCollectors, donc axes.geopolitics.acled n'existe
    // jamais. Le lister ici produisait un null fantôme. À remettre si réactivé.
    ["news (RSS)", "temps réel (min)", freshest(...(a.news?.news?.items || []).map((item) => item.date))],
    ["google-news", "temps réel (min)", googleNewsFreshest(a.news?.["google-news"])],
    ["nasdaq-calendar (calendrier éco)", "horaire (collecte)", getCollectedTs(state, "nasdaq-calendar")],
  ].map(([source, cadence, dataTs]) => ({ source, cadence, dataTs }));
}

/**
 * Payload API : fraîcheur par source (date + âge vs maintenant) + qualité
 * globale du snapshot.
 * @param {object} state World-state ou snapshot (doit porter axes + ts + meta).
 * @returns {{snapshotTs: number|null, snapshotIso: string|null,
 *   generatedAt: number, paramsVersion: number, ok: number|null,
 *   total: number|null, staleSources: Array<string>, sources: Array<object>}}
 *   Payload sérialisable.
 */
export function freshnessPayload(state) {
  const now = Date.now();
  const rows = freshnessRows(state);
  return {
    snapshotTs: state?.ts ?? null,
    snapshotIso: state?.ts != null ? new Date(state.ts).toISOString() : null,
    generatedAt: now,
    paramsVersion: DATA_PARAMS_VERSION,
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
