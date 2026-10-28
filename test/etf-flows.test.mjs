import assert from "node:assert/strict";
import { test } from "node:test";
import { isPlausibleFlowRow, summarizeFlows } from "../src/modules/fundamental/collectors/etf-flows.js";

/**
 * Régression du flux ETH aberrant du 05/10/2026 (servi le 06/10) : −19 924 M$
 * pour un encours de 17 690 M$. Une ligne non plausible donne des montants null
 * sans basculer sur la veille, et invalide le cumul 7 j.
 */

const M = 1e6;
const row = (date, flowM, assetsM, cumM = 0) => ({
  date,
  totalNetInflow: flowM * M,
  totalNetAssets: assetsM * M,
  cumNetInflow: cumM * M,
});

test("isPlausibleFlowRow : ligne réelle du 05/10 rejetée", () => {
  assert.equal(isPlausibleFlowRow(row("2026-10-05", -19924, 17690)), false);
});

test("isPlausibleFlowRow : flux courant accepté, encours absent rejeté", () => {
  assert.equal(isPlausibleFlowRow(row("2026-10-02", -37, 17700)), true);
  assert.equal(isPlausibleFlowRow({ date: "2026-10-02", totalNetInflow: -37 * M }), false);
});

test("summarizeFlows : jour aberrant → null, date conservée, cumul 7 j null", () => {
  const rows = [
    row("2026-10-05", -19924, 17690, -6122),
    row("2026-10-02", -37, 17700, 13800),
    row("2026-10-01", -55, 17750, 13837),
  ];
  const out = summarizeFlows(rows, 8);
  assert.equal(out.date, "2026-10-05");
  assert.equal(out.dayFlowUsdM, null);
  assert.equal(out.cumFlowUsdM, null);
  assert.equal(out.flow7dUsdM, null);
  assert.equal(out.recent[0].netFlowUsdM, null);
  assert.equal(out.recent[1].netFlowUsdM, -37);
});

test("summarizeFlows : historique sain inchangé", () => {
  const rows = [row("2026-10-02", -37, 17700, 13800), row("2026-10-01", -55, 17750, 13837)];
  const out = summarizeFlows(rows, 8);
  assert.equal(out.dayFlowUsdM, -37);
  assert.equal(out.flow7dUsdM, -92);
  assert.equal(out.cumFlowUsdM, 13800);
});
