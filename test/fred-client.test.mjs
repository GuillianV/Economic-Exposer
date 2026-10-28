import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  describeFredError,
  isRetryableFredError,
  pickLatestObservation,
  resetFredFallbacks,
  settleFredSeries,
} from "../src/modules/fundamental/collectors/fred-client.js";

/**
 * Régression des null FRED silencieux (audit du 28/10/2026 : 2-5 % de null,
 * jamais stale). Une série transitoirement en échec est relancée (jamais sur
 * 429), resservie depuis la mémoire si possible, et le lot entier lève si tout
 * échoue sans repli.
 */

const httpError = (status) => new Error(`HTTP ${status} sur https://api.stlouisfed.org/fred/series/observations?api_key=SECRET`);
const observations = (value, date = "2026-10-26") => ({ observations: [{ value, date }] });

beforeEach(() => resetFredFallbacks());

test("pickLatestObservation : saute les « . » de queue", () => {
  const raw = [
    { value: ".", date: "2026-10-27" },
    { value: "4.68", date: "2026-10-26" },
  ];
  assert.deepEqual(pickLatestObservation(raw), { value: 4.68, date: "2026-10-26" });
  assert.equal(pickLatestObservation([{ value: ".", date: "2026-10-27" }]), null);
});

test("isRetryableFredError : 5xx et timeout oui, 429 et 4xx non", () => {
  assert.equal(isRetryableFredError(httpError(503)), true);
  assert.equal(isRetryableFredError(Object.assign(new Error("aborted"), { name: "AbortError" })), true);
  assert.equal(isRetryableFredError(httpError(429)), false);
  assert.equal(isRetryableFredError(httpError(400)), false);
});

test("describeFredError : ne recopie jamais l'URL (clé API)", () => {
  const text = describeFredError(httpError(503));
  assert.equal(text, "HTTP 503");
  assert.equal(text.includes("SECRET"), false);
});

test("settleFredSeries : relance un 503 une fois, jamais un 429", async () => {
  const calls = { DGS2: 0, DGS10: 0 };
  const getJson = async (url) => {
    const id = new URL(url).searchParams.get("series_id");
    calls[id] += 1;
    if (id === "DGS2" && calls[id] === 1) throw httpError(503);
    if (id === "DGS10") throw httpError(429);
    return observations("4.68");
  };
  const out = await settleFredSeries({ yield2y: "DGS2", yield10y: "DGS10" }, "SECRET", getJson, { source: "test" });
  assert.equal(out.yield2y.value, 4.68);
  assert.equal(out.yield10y, null);
  assert.equal(calls.DGS2, 2);
  assert.equal(calls.DGS10, 1);
});

test("settleFredSeries : repli sur la dernière valeur réussie, marquée cached", async () => {
  const ok = async () => observations("3.88");
  await settleFredSeries({ fedFunds: "DFF" }, "k", ok, { source: "test" });
  const failing = async () => {
    throw httpError(429);
  };
  const out = await settleFredSeries({ fedFunds: "DFF" }, "k", failing, { source: "test" });
  assert.deepEqual(out.fedFunds, { value: 3.88, date: "2026-10-26", cached: true });
});

test("settleFredSeries : lève si toutes les séries échouent sans repli", async () => {
  const failing = async () => {
    throw httpError(429);
  };
  await assert.rejects(
    settleFredSeries({ yield2y: "DGS2", yield10y: "DGS10" }, "k", failing, { source: "test" }),
    /toutes les séries FRED en échec/,
  );
});
