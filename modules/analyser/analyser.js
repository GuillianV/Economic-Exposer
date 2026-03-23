import { intervalToSeconds } from "../utils.js";
import { tripleStar, zonesRessist } from "./conditions/index.js";
import MoneyManager, { RR } from "./money-manager.js";
import { parseSimpleKline } from "./parsers/kline.js";
import Strategy, { Strategies } from "./strategy.js";
import util from "util";
export default class Analyser {
  /**
   * Données internes pour les extrêmes et niveaux
   */
  datas = {
    localExtremes: null,
    oppositionZones: [],
    s_r_zones: [],
  };

  /**
   * Compteur de ticks traités
   */
  tickCounter = 0;

  /**
   * Historique des ticks pour le retrieve
   */
  oldTicks = [];

  constructor(
    entriesObjects,
    options = {
      chain: "btcusdc",
      interval: "1m",
      startingTick: 60 * 24,
    },
  ) {
    this.options = options;
    this.entriesObjects = entriesObjects;

    // On cible la paire/intervalle demandée
    this.targetEntriesObjects =
      this.entriesObjects[options.chain][options.interval];
    this.targetEntriesArray = Object.entries(this.targetEntriesObjects);

    // Configuration de départ
    this.actualTick = parseInt(
      this.targetEntriesArray[
        this.targetEntriesArray.length - options.startingTick
      ][0],
    );

    this.intervalMilliseconds = intervalToSeconds(options.interval) * 1000;

    // Ticks précédents (pour la détection de pivot)
    this.secondTick = this.actualTick - this.intervalMilliseconds;
    this.thirdTick = this.secondTick - this.intervalMilliseconds;

    this.finalTick =
      this.targetEntriesArray[this.targetEntriesArray.length - 1][0];

    this.ended = false;
    this.onEndCb = () => {};

    this.strategies = new Strategies([
      // new Strategy(
      //   new MoneyManager(1000, RR["0.33"]),
      //   tripleStar,
      //   "tripleStar-033",
      // ),

      // new Strategy(
      //   new MoneyManager(1000, RR["0.5"]),
      //   tripleStar,
      //   "tripleStar-05",
      // ),
      new Strategy(new MoneyManager(1000, RR[1]), tripleStar, "tripleStar-1"),
      new Strategy(new MoneyManager(1000, RR[2]), tripleStar, "tripleStar-2"),
      new Strategy(new MoneyManager(1000, RR[3]), tripleStar, "tripleStar-3"),

      new Strategy(
        new MoneyManager(1000, RR[1]),
        zonesRessist,
        "zonesRessist-1",
      ),
      new Strategy(
        new MoneyManager(1000, RR[2]),
        zonesRessist,
        "zonesRessist-2",
      ),
      new Strategy(
        new MoneyManager(1000, RR[3]),
        zonesRessist,
        "zonesRessist-3",
      ),
    ]);
  }

  /**
   * Avance d'un tick (backtest ou live)
   */
  tick() {
    if (this.ended) return;

    const currentKline = parseSimpleKline(
      this.targetEntriesObjects[this.actualTick],
      this.actualTick,
    );

    this.datas.currentKline = currentKline;

    if (this.finalTick == this.actualTick) {
      this.ended = true;
      this.strategies.closeOpenTrades(this.datas);
      this.onEndCb();
      return;
    }

    const secondKline = parseSimpleKline(
      this.targetEntriesObjects[this.secondTick],
      this.secondTick,
    );

    this.datas.secondKline = secondKline;

    const thirdKline = parseSimpleKline(
      this.targetEntriesObjects[this.thirdTick],
      this.thirdTick,
    );

    this.datas.thirdKline = thirdKline;

    this.updateHighsLows(0.15, 0.15);

    this.updateSupportsResistances(1);

    this.updateTrendlines(1000, 0.001, 20);

    //Strategy part
    this.strategies.updateOpenTrades(
      this.datas,
      this.targetEntriesObjects,
      this.actualTick,
      this.intervalMilliseconds,
    );
    this.strategies.startupTrades(
      this.datas,
      this.targetEntriesObjects,
      this.actualTick,
      this.intervalMilliseconds,
    );

    // Avance du temps
    this.tickCounter++;
    this.oldTicks.push(this.actualTick);

    this.thirdTick = this.secondTick;
    this.secondTick = this.actualTick;
    this.actualTick += this.intervalMilliseconds;
  }

  updateHighsLows(minDepth = 0.15, minTimeRatio = 0.15) {
    const currentKline = this.datas.currentKline;
    const secondKline = this.datas.secondKline;

    if (!currentKline || !secondKline) return;

    // ===================== INITIALISATION =====================
    if (!this.datas.localExtremes) {
      const localExtremes = {
        lastConfirmedLow: {
          time: secondKline.time,
          price: secondKline.low,
        },
        lastConfirmedHigh: {
          time: secondKline.time,
          price: secondKline.high,
        },
        swingHighs: [],
        swingLows: [],

        impulseStartPrice: secondKline.low,
        impulseStartTime: secondKline.time,
        currentTrend: "neutral",
      };
      localExtremes.direction =
        currentKline.close > secondKline.close ? "up" : "down";

      this.datas.localExtremes = localExtremes;
      return;
    }

    const localExtremes = this.datas.localExtremes;

    if (localExtremes.direction === "up") {
      // --- Mise à jour du potentiel High ---
      if (
        currentKline.high >
        (localExtremes.potentialHigh?.price ??
          localExtremes.lastConfirmedHigh.price)
      ) {
        localExtremes.potentialHigh = {
          time: currentKline.time,
          price: currentKline.high,
        };
      }

      // --- Calcul du retracement ---
      if (localExtremes.potentialHigh) {
        const impulseSize =
          localExtremes.potentialHigh.price - localExtremes.impulseStartPrice;
        const retraceSize =
          localExtremes.potentialHigh.price - currentKline.low;
        const retraceDepth = impulseSize > 0 ? retraceSize / impulseSize : 0;

        const impulseDuration =
          currentKline.time - localExtremes.impulseStartTime;
        const retraceDuration =
          currentKline.time - localExtremes.potentialHigh.time;
        const retraceTimeRatio =
          impulseDuration > 0 ? retraceDuration / impulseDuration : 0;

        // Validation Dow
        if (retraceDepth >= minDepth && retraceTimeRatio >= minTimeRatio) {
          // Swing High confirmé
          localExtremes.swingHighs.push(localExtremes.potentialHigh);
          localExtremes.lastConfirmedHigh = localExtremes.potentialHigh;

          // On passe en tendance baissière
          localExtremes.direction = "down";
          localExtremes.potentialLow = {
            time: currentKline.time,
            price: currentKline.low,
          };
          localExtremes.impulseStartPrice = localExtremes.potentialHigh.price;
          localExtremes.impulseStartTime = localExtremes.potentialHigh.time;
          localExtremes.potentialHigh = null;
        }
      }
    } else if (localExtremes.direction === "down") {
      // --- Mise à jour du potentiel Low ---
      if (
        currentKline.low <
        (localExtremes.potentialLow?.price ??
          localExtremes.lastConfirmedLow.price)
      ) {
        localExtremes.potentialLow = {
          time: currentKline.time,
          price: currentKline.low,
        };
      }

      if (localExtremes.potentialLow) {
        const impulseSize =
          localExtremes.impulseStartPrice - localExtremes.potentialLow.price;
        const retraceSize =
          currentKline.high - localExtremes.potentialLow.price;
        const retraceDepth = impulseSize > 0 ? retraceSize / impulseSize : 0;

        const impulseDuration =
          currentKline.time - localExtremes.impulseStartTime;
        const retraceDuration =
          currentKline.time - localExtremes.potentialLow.time;
        const retraceTimeRatio =
          impulseDuration > 0 ? retraceDuration / impulseDuration : 0;

        if (retraceDepth >= minDepth && retraceTimeRatio >= minTimeRatio) {
          localExtremes.swingLows.push(localExtremes.potentialLow);
          localExtremes.lastConfirmedLow = localExtremes.potentialLow;

          localExtremes.direction = "up";
          localExtremes.potentialHigh = {
            time: currentKline.time,
            price: currentKline.high,
          };
          localExtremes.impulseStartPrice = localExtremes.potentialLow.price;
          localExtremes.impulseStartTime = localExtremes.potentialLow.time;
          localExtremes.potentialLow = null;
        }
      }
    }

    localExtremes.currentTrend =
      localExtremes.direction === "up" ? "bullish" : "bearish";
  }

  updateSupportsResistances(breakCount = 1) {
    if (!this.datas.localExtremes) return;

    const { currentKline } = this.datas;
    const { swingHighs, swingLows } = this.datas.localExtremes;

    // Initialisation une seule fois
    if (!this.datas.s_r_zones) {
      this.datas.s_r_zones = [];
    }
    if (!this.datas.processedSwings) {
      this.datas.processedSwings = { high: 0, low: 0 };
    }

    const prevHigh = this.datas.processedSwings.high;
    const prevLow = this.datas.processedSwings.low;
    const currHigh = swingHighs.length;
    const currLow = swingLows.length;

    // ===================== AJOUT DES NOUVEAUX SWINGS =====================
    for (let i = prevHigh; i < currHigh; i++) {
      const swing = swingHighs[i];
      this.datas.s_r_zones.push({
        price: swing.price,
        type: "resistance",
        startTime: swing.time,
        breakCount: 0,
        endTime: null,
      });
    }

    for (let i = prevLow; i < currLow; i++) {
      const swing = swingLows[i];
      this.datas.s_r_zones.push({
        price: swing.price,
        type: "support",
        startTime: swing.time,
        breakCount: 0,
        endTime: null,
      });
    }

    this.datas.processedSwings.high = currHigh;
    this.datas.processedSwings.low = currLow;

    // ===================== DÉTECTION DES CASSURES =====================
    const activeZones = this.datas.s_r_zones.filter(
      (zone) => zone.endTime === null,
    );

    for (const zone of activeZones) {
      if (zone.type === "resistance" && currentKline.high > zone.price) {
        zone.breakCount++;
        // === RESISTANCE CASSÉE → SUPPRESSION IMMÉDIATE ===
        if (zone.breakCount >= breakCount) {
          zone.endTime = currentKline.time;
        }
      } else if (zone.type === "support" && currentKline.low < zone.price) {
        zone.breakCount++;
        // === SUPPORT CASSÉ → SUPPRESSION IMMÉDIATE ===
        if (zone.breakCount >= breakCount) {
          zone.endTime = currentKline.time;
        }
      }
    }
    this.datas.oppositionZones = this.datas.s_r_zones;
  }

  updateTrendlines(maxSwings = 300, touchTolerance = 0.002, minInterval = 10) {
    if (!this.datas.trendsWait) this.datas.trendsWait = {};
    if (!this.datas.trendlines) this.datas.trendlines = [];

    const { currentKline } = this.datas;
    if (!currentKline || !this.datas.s_r_zones) return;

    const swings = this.datas.s_r_zones.map((zone) => {
      return {
        price: zone.price,
        time: zone.startTime,
        type: zone.type,
      };
    });

    const swingHighs = swings.filter((zone) => zone.type === "resistance");
    const swingLows = swings.filter((zone) => zone.type === "support");

    const recentLows = swingLows.slice(-maxSwings);
    const recentHighs = swingHighs.slice(-maxSwings);

    const tlKey = (type, p1, p2, p3) =>
      `${type}_${p1.time}_${p2.time}_${p3.time}`;

    const existingKeys = new Set(
      this.datas.trendlines.map((tl) => tlKey(tl.type, tl.p1, tl.p2, tl.p3)),
    );

    const buildFromTriplets = (pivots, type) => {
      const dirCheck = (p1, p2) =>
        type === "ascending" ? p2.price > p1.price : p2.price < p1.price;

      for (let i = 0; i < pivots.length - 2; i++) {
        for (let j = i + 1; j < pivots.length - 1; j++) {
          const p1 = pivots[i];
          const p2 = pivots[j];

          if (!dirCheck(p1, p2)) continue;

          if (p1.time + this.intervalMilliseconds * minInterval > p2.time) continue;

          let cutsThroughCurrent = false;
          for (let k = p1.time; k < p2.time; k += this.intervalMilliseconds) {
            const kline = this.targetEntriesObjects[k];

            if (p1.price > kline.open && p2.price < kline.close) {
              cutsThroughCurrent = true;
              break;
            }

            if (p2.price > kline.open && p1.price < kline.close) {
              cutsThroughCurrent = true;
              break;
            }
          }

          if (cutsThroughCurrent) continue;

          const slope = (p2.price - p1.price) / (p2.time - p1.time);

          const projectedNow = p2.price + slope * (currentKline.time - p2.time);

          // ─── Recherche de p3 aligné ───────────────────────────────────────
          for (let k = j + 1; k < pivots.length; k++) {
            const p3 = pivots[k];

            if (!dirCheck(p2, p3)) continue;

            const expectedPrice = p2.price + slope * (p3.time - p2.time);
            const deviation =
              Math.abs(p3.price - expectedPrice) / expectedPrice;

            if (deviation > touchTolerance) continue;

            let cutsThroughCurrent = false;
            for (let k = p2.time; k < p3.time; k += this.intervalMilliseconds) {
              const kline = this.targetEntriesObjects[k];

              if (expectedPrice > kline.open && expectedPrice < kline.close) {
                cutsThroughCurrent = true;
                break;
              }

              if (expectedPrice > kline.close && expectedPrice < kline.open) {
                cutsThroughCurrent = true;
                break;
              }
            }

            if (cutsThroughCurrent) continue;

            const key = tlKey(type, p1, p2, p3);
            if (existingKeys.has(key)) continue;

            const isBroken =
              type === "ascending"
                ? currentKline.low < projectedNow
                : currentKline.high > projectedNow;

            const tl = {
              type,
              p1,
              p2,
              p3,
              slope,
              broken: isBroken,
              breakTime: isBroken ? currentKline.time : null,
              breakPrice: isBroken
                ? type === "ascending"
                  ? currentKline.low
                  : currentKline.high
                : null,
              startTime: p1.time,
              lastTouchTime: p3.time,
              currentProjected: projectedNow,
            };

            this.datas.trendlines.push(tl);
            existingKeys.add(key);
          }
        }
      }
    };

    buildFromTriplets(recentLows, "ascending");
    buildFromTriplets(recentHighs, "descending");

    // ─── Mise à jour tick-à-tick ──────────────────────────────────────────────
    for (const tl of this.datas.trendlines) {
      if (tl.broken) continue;

      const projected =
        tl.p2.price + tl.slope * (currentKline.time - tl.p2.time);

      if (tl.type === "ascending") {
        if (currentKline.low < projected) {
          tl.broken = true;
          tl.breakTime = currentKline.time;
          tl.breakPrice = currentKline.low;
          continue;
        }
      } else {
        if (currentKline.high > projected) {
          tl.broken = true;
          tl.breakTime = currentKline.time;
          tl.breakPrice = currentKline.high;
          continue;
        }
      }

      tl.currentProjected = projected;
    }

    this.datas.activeTrendlines = this.datas.trendlines.filter(
      (tl) => !tl.broken,
    );
  }
  onEnd(callback) {
    this.onEndCb = callback;
  }

  /**
   * Récupère l'état complet (pour l'export ou le debug)
   */
  retrieve() {
    return {
      klines: this.oldTicks.map((tick) => ({
        ...this.targetEntriesObjects[tick],
        time: tick,
      })),
      datas: this.datas,
      strategies: this.strategies.retrieve(),
    };
  }
}
