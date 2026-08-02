import assert from "node:assert/strict";
import { test } from "node:test";
import { statsOfRegimes } from "../src/modules/fundamental/ai/regime-track.js";

/**
 * Honnêteté statistique du track record (audit 2.1 + 2.4) : les émissions
 * quotidiennes évaluées à 90 j se recouvrent -> il faut compter les fenêtres
 * DISJOINTES, et situer la boussole vs des benchmarks naïfs. Ce test fige les
 * deux mécanismes.
 */

const JOUR_MS = 86400000;
const BASE_TS = 1_700_000_000_000;

/**
 * Fabrique une émission évaluée synthétique.
 * @param {number} offsetJours Décalage du baseTs en jours.
 * @param {string} resultat "conforme" | "contraire" | "neutre".
 * @param {number} retPct Rendement réalisé (%).
 * @returns {object} Émission évaluée minimale.
 */
function emission(offsetJours, resultat, retPct) {
  return { baseTs: BASE_TS + offsetJours * JOUR_MS, realise: { resultat, retPct } };
}

test("statsOfRegimes : ne garde qu'une fenêtre 90j par recouvrement", () => {
  // 3 émissions dans la même fenêtre 90j (j0,j1,j2) + une à j90 + une à j200.
  const records = [
    emission(0, "conforme", 10),
    emission(1, "contraire", -8),
    emission(2, "conforme", 12),
    emission(90, "conforme", 7),
    emission(200, "neutre", 2),
  ];
  const stats = statsOfRegimes(records);
  assert.equal(stats.indicatif.n, 5, "indicatif compte toutes les évaluations");
  assert.equal(stats.independant.n, 3, "indépendant ne garde que les fenêtres disjointes (j0, j90, j200)");
});

test("statsOfRegimes : taux indépendants + benchmarks naïfs", () => {
  const records = [
    emission(0, "conforme", 10),
    emission(1, "contraire", -8),
    emission(2, "conforme", 12),
    emission(90, "conforme", 7),
    emission(200, "neutre", 2),
  ];
  const stats = statsOfRegimes(records);
  // Indépendant = [j0 conforme, j90 conforme, j200 neutre] -> 2/3 conforme.
  assert.equal(stats.independant.conformePct, 67);
  assert.equal(stats.independant.justesseDirection, 100);
  // Buy&hold (toujours haussier) : ret 10 et 7 > bande, ret 2 dans la bande -> 2/3.
  assert.equal(stats.independant.benchmarks.toujoursHaussier, 67);
  // Persistance : j90 suit +10 (juste), j200 suit +7 mais ret 2 neutre -> 1/2.
  assert.equal(stats.independant.benchmarks.persistance, 50);
});

test("statsOfRegimes : rodage gelé, jugé sur l'indépendant (pas le quotidien)", () => {
  const stats = statsOfRegimes([]);
  assert.equal(stats.independant.n, 0);
  assert.equal(stats.rodage.gelee, true);
  assert.equal(stats.rodage.pret, false);
  assert.ok(stats.rodage.minIndependant >= 4, "le seuil se compte en fenêtres indépendantes");
});
