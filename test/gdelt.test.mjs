import assert from "node:assert/strict";
import { test } from "node:test";
import { groupIntoBursts, isBurstComplete } from "../src/modules/fundamental/collectors/gdelt.js";

/**
 * Régression des 0 manchette GDELT (~10 % des snapshots, audit du 28/10/2026) :
 * le collecteur lisait un seul fichier, souvent le petit de fin de salve. Les
 * fichiers d'une salve sont regroupés, et une salve sans son gros fichier est
 * jugée incomplète.
 */

test("groupIntoBursts : fichiers du 28/10 regroupés par salve", () => {
  const backs = [3, 4, 5, 18, 19, 20, 33, 34];
  assert.deepEqual(groupIntoBursts(backs, 3), [
    [3, 4, 5],
    [18, 19, 20],
    [33, 34],
  ]);
});

test("groupIntoBursts : aucune minute disponible → aucune salve", () => {
  assert.deepEqual(groupIntoBursts([], 3), []);
});

test("isBurstComplete : petit fichier isolé incomplet, salve entière complète", () => {
  assert.equal(isBurstComplete(49), false);
  assert.equal(isBurstComplete(834), false);
  assert.equal(isBurstComplete(834 + 4225 + 49), true);
});
