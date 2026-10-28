import assert from "node:assert/strict";
import { test } from "node:test";
import { freshnessRows, getCollectedTs } from "../src/modules/fundamental/freshness.js";

/**
 * Régression de la freshness trompeuse (audit du 28/10/2026) : les flux temps
 * réel recevaient « maintenant » même en échec, et mempool / nasdaq-calendar /
 * google-news n'étaient pas listés.
 */

const TS = Date.parse("2026-10-28T13:24:52Z");
const state = {
  ts: TS,
  axes: { geopolitics: { gdelt: { fileTs: TS - 5 * 60 * 1000, topHeadlines: [] } } },
  sources: {
    "binance-futures": { ok: true, ts: TS },
    coingecko: { ok: false, stale: true, ts: TS },
    mempool: { ok: true, ts: TS },
  },
};

test("getCollectedTs : source réussie datée, source en échec → null", () => {
  assert.equal(getCollectedTs(state, "binance-futures"), TS);
  assert.equal(getCollectedTs(state, "coingecko"), null);
  assert.equal(getCollectedTs(state, "inconnue"), null);
});

test("freshnessRows : sources ajoutées présentes, gdelt daté par sa salve", () => {
  const rows = freshnessRows(state);
  const bySource = Object.fromEntries(rows.map((row) => [row.source, row.dataTs]));
  assert.equal(bySource.coingecko, null);
  assert.equal(bySource.mempool, TS);
  assert.equal(bySource.gdelt, TS - 5 * 60 * 1000);
  assert.ok("google-news" in bySource);
  assert.ok("nasdaq-calendar (calendrier éco)" in bySource);
});
