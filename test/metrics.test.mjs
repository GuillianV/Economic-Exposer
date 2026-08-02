import assert from "node:assert/strict";
import { test } from "node:test";
import { biaisLongShort } from "../src/modules/fundamental/persistence/metrics.js";

/**
 * Régression du bug d'inversion long/short (corrigé le 2026-08-02) : la métrique
 * « retail » lisait le L/S global 24h (h24Ls ~0.8) au lieu du ratio des comptes
 * retail (~1.9), inversant le signe de la foule. Ce test fige la sémantique :
 * >1 = long, <1 = short, jamais l'inverse.
 */

test("biaisLongShort : ratio > 1 = majorité LONG", () => {
  assert.equal(biaisLongShort(1.9), "long");
  assert.equal(biaisLongShort(1.935), "long");
  assert.equal(biaisLongShort(3), "long");
});

test("biaisLongShort : ratio < 1 = majorité SHORT (pas d'inversion)", () => {
  assert.equal(biaisLongShort(0.8064), "short");
  assert.equal(biaisLongShort(0.5), "short");
});

test("biaisLongShort : proche de 1 = équilibré (bande neutre)", () => {
  assert.equal(biaisLongShort(1), "équilibré");
  assert.equal(biaisLongShort(1.05), "équilibré");
  assert.equal(biaisLongShort(0.95), "équilibré");
});

test("biaisLongShort : valeur absente ou non finie = null", () => {
  assert.equal(biaisLongShort(null), null);
  assert.equal(biaisLongShort(undefined), null);
  assert.equal(biaisLongShort(Number.NaN), null);
  assert.equal(biaisLongShort(Number.POSITIVE_INFINITY), null);
});
