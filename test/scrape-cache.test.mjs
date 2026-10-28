import assert from "node:assert/strict";
import { test } from "node:test";
import { SCRAPE_MAX_AGE_MS, isScrapeFresh } from "../src/modules/fundamental/scraper/cache.js";

/**
 * Régression de la heatmap liquidations figée depuis le 09/10/2026 mais servie
 * comme fraîche : un scrape plus vieux que l'âge maximal n'est plus exploitable.
 */

const NOW_MS = Date.parse("2026-10-28T13:24:52Z");

test("isScrapeFresh : scrape récent accepté", () => {
  assert.equal(isScrapeFresh(NOW_MS - 10 * 60 * 1000, SCRAPE_MAX_AGE_MS, NOW_MS), true);
});

test("isScrapeFresh : scrape du 09/10 rejeté le 28/10", () => {
  assert.equal(isScrapeFresh(Date.parse("2026-10-09T14:07:37Z"), SCRAPE_MAX_AGE_MS, NOW_MS), false);
});

test("isScrapeFresh : horodatage absent → non frais", () => {
  assert.equal(isScrapeFresh(undefined, SCRAPE_MAX_AGE_MS, NOW_MS), false);
  assert.equal(isScrapeFresh(null, SCRAPE_MAX_AGE_MS, NOW_MS), false);
});
