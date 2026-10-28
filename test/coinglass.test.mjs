import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDerivatives, parseWhalePositions, toNumberOrNull } from "../src/modules/fundamental/scraper/coinglass.js";

/**
 * Régression de lsTopTraders = 0 (07/08/2026) : une valeur absente, vide ou
 * nulle devenait un 0 plausible. Elle donne désormais null, et un ratio
 * long/short nul est rejeté.
 */

test("toNumberOrNull : absent, vide ou non numérique → null", () => {
  assert.equal(toNumberOrNull(undefined), null);
  assert.equal(toNumberOrNull(null), null);
  assert.equal(toNumberOrNull(""), null);
  assert.equal(toNumberOrNull("abc"), null);
  assert.equal(toNumberOrNull("1.96"), 1.96);
  assert.equal(toNumberOrNull(0), 0);
});

test("parseDerivatives : ratio manquant ou nul → null, volume partiel → null", () => {
  const out = parseDerivatives({
    openInterest: 5.39e10,
    binanceTopAccountLsRadio: 0,
    binanceAccountLsRadio: null,
    h24LongVolUsd: 1e9,
  });
  assert.equal(out.openInterestUsd, 5.39e10);
  assert.equal(out.longShortTopTraders, null);
  assert.equal(out.longShortRetail, null);
  assert.equal(out.volume24hUsd, null);
  assert.equal(out.fundingPct, null);
});

test("parseDerivatives : valeurs saines conservées", () => {
  const out = parseDerivatives({ binanceTopAccountLsRadio: 1.961, h24LongVolUsd: 1e9, h24ShortVolUsd: 2e9 });
  assert.equal(out.longShortTopTraders, 1.961);
  assert.equal(out.volume24hUsd, 3e9);
});

test("parseWhalePositions : jambe absente → biais null (plus de « long » par défaut)", () => {
  assert.equal(parseWhalePositions({}).biais, null);
  assert.equal(parseWhalePositions({ longUserPercent: 63.66, shortUserPercent: 36.34 }).biais, "long");
});
