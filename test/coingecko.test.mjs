import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeVolume } from "../src/modules/fundamental/collectors/coingecko.js";

/**
 * Régression des volumes CoinGecko corrompus (154 points du 07/09 au 21/10/2026,
 * jusqu'à 1e21 $) : un volume 24h supérieur à la moitié de la capitalisation
 * totale est rejeté, un volume sain passe tel quel.
 */

const MARKET_CAP_USD = 2.72e12;

test("sanitizeVolume : volume sain conservé", () => {
  assert.equal(sanitizeVolume(6.3e10, MARKET_CAP_USD), 6.3e10);
});

test("sanitizeVolume : volumes corrompus observés en prod rejetés", () => {
  assert.equal(sanitizeVolume(9.086e18, MARKET_CAP_USD), null);
  assert.equal(sanitizeVolume(3.0e13, MARKET_CAP_USD), null);
});

test("sanitizeVolume : valeurs absentes ou invalides → null", () => {
  assert.equal(sanitizeVolume(null, MARKET_CAP_USD), null);
  assert.equal(sanitizeVolume(6.3e10, null), null);
  assert.equal(sanitizeVolume(-1, MARKET_CAP_USD), null);
});
