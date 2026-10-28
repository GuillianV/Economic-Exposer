import assert from "node:assert/strict";
import { test } from "node:test";
import { sumStablecoinSupply } from "../src/modules/fundamental/collectors/defillama.js";

/**
 * Régression du total stablecoins à 5,18e16 $ (20/08/2026) : un actif DefiLlama
 * corrompu est écarté au lieu de faire exploser la somme.
 */

test("sumStablecoinSupply : actif corrompu écarté, total sain conservé", () => {
  const assets = [
    { name: "Tether", circulating: { peggedUSD: 180e9 } },
    { name: "USDC", circulating: { peggedUSD: 75e9 } },
    { name: "Corrompu", circulating: { peggedUSD: 5.18e16 } },
    { name: "SansDonnée", circulating: {} },
  ];
  const { totalUsd, rejected } = sumStablecoinSupply(assets);
  assert.equal(totalUsd, 255e9);
  assert.deepEqual(rejected, ["Corrompu"]);
});

test("sumStablecoinSupply : rien d'exploitable → null", () => {
  assert.deepEqual(sumStablecoinSupply([]), { totalUsd: null, rejected: [] });
});
