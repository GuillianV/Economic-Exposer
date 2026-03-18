import { intervalToSeconds } from "../utils.js";
import { tripleStar } from "./conditions/index.js";
import MoneyManager, { RR } from "./money-manager.js";
import { parseSimpleKline } from "./parsers/kline.js";
import Strategy, { Strategies } from "./strategy.js";

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
      new Strategy(
        new MoneyManager(1000, RR["0.33"]),
        tripleStar,
        "tripleStar-033",
      ),

      new Strategy(
        new MoneyManager(1000, RR["0.5"]),
        tripleStar,
        "tripleStar-05",
      ),
      new Strategy(new MoneyManager(10000, RR[1]), tripleStar, "tripleStar-1"),
      new Strategy(new MoneyManager(10000, RR[2]), tripleStar, "tripleStar-2"),
      new Strategy(new MoneyManager(10000, RR[3]), tripleStar, "tripleStar-3"),
      new Strategy(new MoneyManager(10000, RR[4]), tripleStar, "tripleStar-4"),
      new Strategy(new MoneyManager(10000, RR[5]), tripleStar, "tripleStar-5"),
      new Strategy(new MoneyManager(10000, RR[6]), tripleStar, "tripleStar-6"),
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

    this.updateSupportsResistances();
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

  updateSupportsResistances() {
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
        endTime: null,
      });
    }

    for (let i = prevLow; i < currLow; i++) {
      const swing = swingLows[i];
      this.datas.s_r_zones.push({
        price: swing.price,
        type: "support",
        startTime: swing.time,
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
        // === RESISTANCE CASSÉE → SUPPRESSION IMMÉDIATE ===
        zone.endTime = currentKline.time;
      } else if (zone.type === "support" && currentKline.low < zone.price) {
        // === SUPPORT CASSÉ → SUPPRESSION IMMÉDIATE ===
        zone.endTime = currentKline.time;
      }
    }
    this.datas.oppositionZones = this.datas.s_r_zones
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
