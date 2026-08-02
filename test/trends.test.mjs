import assert from "node:assert/strict";
import { test } from "node:test";
import { METRIQUES_SANS_PCT, computeTrends } from "../src/modules/fundamental/persistence/trends.js";

/**
 * Régression de l'artefact « % sur grandeur qui traverse zéro » (corrigé le
 * 2026-08-02) : un funding passant de +0.0001 à -0.017 produisait un « -17100 % »
 * dénué de sens. Les métriques signées/plancher se lisent en ABSOLU (pct null).
 */

const HEURE_MS = 3600000;

test("computeTrends : funding (traverse zéro) -> pct null, abs conservé", () => {
  const now = Date.now();
  const history = [
    { ts: now - 24 * HEURE_MS, metrics: { funding: 0.0001, btcPrice: 60000 } },
    { ts: now, metrics: { funding: -0.017, btcPrice: 63000 } },
  ];
  const trends = computeTrends(history);
  const funding = trends.metrics.funding.d24h;
  assert.equal(funding.pct, null, "le funding ne doit PAS porter de variation relative");
  assert.ok(Math.abs(funding.abs - -0.0171) < 1e-9, "la variation absolue reste calculée");
  assert.equal(funding.dir, "down");
});

test("computeTrends : métrique normale (btcPrice) -> pct conservé", () => {
  const now = Date.now();
  const history = [
    { ts: now - 24 * HEURE_MS, metrics: { funding: 0.0001, btcPrice: 60000 } },
    { ts: now, metrics: { funding: -0.017, btcPrice: 63000 } },
  ];
  const trends = computeTrends(history);
  const price = trends.metrics.btcPrice.d24h;
  assert.ok(price.pct != null, "un prix garde sa variation relative");
  assert.ok(Math.abs(price.pct - 5) < 1e-9, "60000 -> 63000 = +5 %");
});

test("METRIQUES_SANS_PCT : couvre funding, nets COT, spreads, flux ETF, frais", () => {
  for (const key of ["funding", "solFunding", "fundingAgg", "cotHedgeFundsNet", "yieldCurve", "btcEtfFlowUsdM", "mempoolFeeFast"]) {
    assert.ok(METRIQUES_SANS_PCT.has(key), `${key} doit être exempté de %`);
  }
  assert.ok(!METRIQUES_SANS_PCT.has("btcPrice"), "un prix garde son %");
});
