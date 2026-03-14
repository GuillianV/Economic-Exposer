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
    localLows: {},
    localHighs: {},
    supports: [],
    resistances: [],
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
      new Strategy(new MoneyManager(100, RR[1]), tripleStar, "tripleStar-1"),
      new Strategy(new MoneyManager(100, RR[2]), tripleStar, "tripleStar-2"),
      new Strategy(new MoneyManager(100, RR[3]), tripleStar, "tripleStar-3"),
      new Strategy(new MoneyManager(100, RR[4]), tripleStar, "tripleStar-4"),
      new Strategy(new MoneyManager(100, RR[5]), tripleStar, "tripleStar-5"),
      new Strategy(new MoneyManager(100, RR[6]), tripleStar, "tripleStar-6"),
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

    this.#detectLocalHighsAndLows(currentKline, secondKline, thirdKline, 20);

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

  /**
   * Détecte les hauts/bas locaux sur la bougie précédente
   * (logique inchangée, juste plus lisible)
   */
  #detectLocalHighsAndLows(currentKline, secondKline, thirdKline, force = 50) {
    const thresholds = [force];

    const isCurrentGreen = currentKline.open < currentKline.close;
    const isLastGreen = secondKline.open < secondKline.close;
    const isThirdGreen = thirdKline.open < thirdKline.close;

    // Helper pour créer un local extrême
    const createLocalExtreme = (value, time) => ({
      value,
      time,
      force: Object.fromEntries(thresholds.map((t) => [t, []])),
    });

    // === Détection Low ===
    if (
      (!isCurrentGreen || !isLastGreen || !isThirdGreen) &&
      secondKline.low < currentKline.low &&
      thirdKline.low > secondKline.low
    ) {
      const localLow = createLocalExtreme(secondKline.close, secondKline.time);

      thresholds.forEach((threshold) => {
        const nearbyLows = Object.values(this.datas.localLows).filter(
          (existing) => Math.abs(existing.value - localLow.value) < threshold,
        );

        nearbyLows.forEach((existing) => {
          localLow.force[threshold].push(existing.time);
          existing.force[threshold].push(localLow.time);
        });
      });

      this.datas.localLows[secondKline.time] = localLow;
    }

    // === Détection High ===
    if (
      (isCurrentGreen || isLastGreen || isThirdGreen) &&
      secondKline.high > currentKline.high &&
      thirdKline.high < secondKline.high
    ) {
      const localHigh = createLocalExtreme(secondKline.close, secondKline.time);

      thresholds.forEach((threshold) => {
        const nearbyHighs = Object.values(this.datas.localHighs).filter(
          (existing) => Math.abs(existing.value - localHigh.value) < threshold,
        );

        nearbyHighs.forEach((existing) => {
          localHigh.force[threshold].push(existing.time);
          existing.force[threshold].push(localHigh.time);
        });
      });

      this.datas.localHighs[secondKline.time] = localHigh;
    }
  }

  /**
   * Construit les niveaux de supports/résistances à partir des pivots
   * (logique identique, code nettoyé + noms clairs)
   */
  #generateSupportsAndResistances(forceValue = 50, filterSameLinesValue = 5) {
    const allExtremes = [
      ...Object.values(this.datas.localLows).map((low) => ({
        ...low,
        type: "low",
      })),
      ...Object.values(this.datas.localHighs).map((high) => ({
        ...high,
        type: "high",
      })),
    ];

    // Séparation uniques / multiples
    const groups = allExtremes.reduce((acc, extreme) => {
      const key =
        extreme.force[forceValue].length === 0 ? "uniques" : "multiples";
      acc[key] ??= [];
      acc[key].push(extreme);
      return acc;
    }, {});

    const uniques = groups.uniques || [];
    const multiples = groups.multiples || [];

    // Clustering des multiples (moyenne des niveaux connectés)
    const clusters = {};
    multiples.forEach((extreme, index) => {
      if (extreme.used) return;

      const clusterKey = `${index}_${extreme.type}`;
      clusters[clusterKey] = [extreme.value];

      extreme.force[forceValue].forEach((time) => {
        const match = multiples.find(
          (m) => m.time === time && m.type === extreme.type,
        );
        if (match) {
          match.used = true;
          clusters[clusterKey].push(match.value);
        }
      });
    });

    // Construction finale
    const levels = { supports: [], resistances: [] };

    // Uniques
    uniques.forEach((u) => {
      levels[u.type === "low" ? "supports" : "resistances"].push(u.value);
    });

    // Moyennes des clusters
    Object.entries(clusters).forEach(([key, values]) => {
      const average = values.reduce((sum, v) => sum + v, 0) / values.length;
      const isSupport = key.includes("_low");
      levels[isSupport ? "supports" : "resistances"].push(average);
    });

    // Suppression des niveaux trop proches (support vs resistance)
    if (filterSameLinesValue !== 0) {
      const toRemove = { supports: [], resistances: [] };

      levels.supports.forEach((support) => {
        const conflictingResistance = levels.resistances.find(
          (resistance) => Math.abs(resistance - support) < filterSameLinesValue,
        );
        if (conflictingResistance) {
          toRemove.supports.push(support);
          toRemove.resistances.push(conflictingResistance);
        }
      });

      levels.supports = levels.supports.filter(
        (s) => !toRemove.supports.includes(s),
      );
      levels.resistances = levels.resistances.filter(
        (r) => !toRemove.resistances.includes(r),
      );
    }

    this.datas.supports = levels.supports;
    this.datas.resistances = levels.resistances;
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
