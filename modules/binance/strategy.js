import { intervalToSeconds } from "../utils.js";
import MoneyManager, { RR } from "./money-manager.js";
import { parseSimpleKline } from "./parsers/kline.js";
import Trade from "./trade.js";

export default class Strategy {
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
   * Gestionnaire de capital et résultats
   */
  moneyManager;

  /**
   * Liste des trades en cours
   */
  trades = [];

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
    }
  ) {
    this.options = options;
    this.entriesObjects = entriesObjects;

    // On cible la paire/intervalle demandée
    this.targetEntriesObjects =
      this.entriesObjects[options.chain][options.interval];
    this.targetEntriesArray = Object.entries(this.targetEntriesObjects);

    // Configuration de départ
    this.actualTick = parseInt(
      this.targetEntriesArray[this.targetEntriesArray.length - options.startingTick][0]
    );

    this.intervalMilliseconds = intervalToSeconds(options.interval) * 1000;

    // Ticks précédents (pour la détection de pivot)
    this.lastTick = this.actualTick - this.intervalMilliseconds;
    this.thirdTick = this.lastTick - this.intervalMilliseconds;

    this.finalTick = this.targetEntriesArray[this.targetEntriesArray.length - 1][0];

    this.ended = false;
    this.onEndCb = () => {};

    // Money Manager adapté à ton capital de 100 € + RR que tu utilises
    this.moneyManager = new MoneyManager(1000, RR[3]);

    // Trades actifs
    this.trades = [];
  }

  /**
   * Avance d'un tick (backtest ou live)
   */
  tick() {
    if (this.ended) return;

    if (this.finalTick === this.actualTick) {
      this.ended = true;
      this.onEndCb();
      return;
    }

    // Récupération des 3 bougies nécessaires
    const thirdKline = parseSimpleKline(
      this.targetEntriesObjects[this.thirdTick],
      this.thirdTick
    );
    const lastKline = parseSimpleKline(
      this.targetEntriesObjects[this.lastTick],
      this.lastTick
    );
    const currentKline = parseSimpleKline(
      this.targetEntriesObjects[this.actualTick],
      this.actualTick
    );

    // Détection des pivots locaux (force = 20 comme avant)
    this.#detectLocalHighsAndLows(currentKline, lastKline, thirdKline, 20);

    // Génération des supports/résistances (filtre identiques = 5)
    this.#generateSupportsAndResistances(20, 5);

    // Mise à jour des trades ouverts
    this.#updateOpenTrades(currentKline);

    // Vérification d'un nouveau signal d'entrée
    const newTrade = this.#checkEntryConditions(currentKline, lastKline);
    if (newTrade) {
      this.trades.push(newTrade);
      this.moneyManager.assignTradeStart(newTrade.result());
    }

    // Avance du temps
    this.tickCounter++;
    this.oldTicks.push(this.actualTick);

    this.thirdTick = this.lastTick;
    this.lastTick = this.actualTick;
    this.actualTick += this.intervalMilliseconds;
  }

  /**
   * Détecte les hauts/bas locaux sur la bougie précédente
   * (logique inchangée, juste plus lisible)
   */
  #detectLocalHighsAndLows(currentKline, lastKline, thirdKline, force = 50) {
    const thresholds = [force];

    const isCurrentGreen = currentKline.open < currentKline.close;
    const isLastGreen = lastKline.open < lastKline.close;
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
      lastKline.low < currentKline.low &&
      thirdKline.low > lastKline.low
    ) {
      const localLow = createLocalExtreme(lastKline.close, lastKline.time);

      thresholds.forEach((threshold) => {
        const nearbyLows = Object.values(this.datas.localLows).filter(
          (existing) =>
            Math.abs(existing.value - localLow.value) < threshold
        );

        nearbyLows.forEach((existing) => {
          localLow.force[threshold].push(existing.time);
          existing.force[threshold].push(localLow.time);
        });
      });

      this.datas.localLows[lastKline.time] = localLow;
    }

    // === Détection High ===
    if (
      (isCurrentGreen || isLastGreen || isThirdGreen) &&
      lastKline.high > currentKline.high &&
      thirdKline.high < lastKline.high
    ) {
      const localHigh = createLocalExtreme(lastKline.close, lastKline.time);

      thresholds.forEach((threshold) => {
        const nearbyHighs = Object.values(this.datas.localHighs).filter(
          (existing) =>
            Math.abs(existing.value - localHigh.value) < threshold
        );

        nearbyHighs.forEach((existing) => {
          localHigh.force[threshold].push(existing.time);
          existing.force[threshold].push(localHigh.time);
        });
      });

      this.datas.localHighs[lastKline.time] = localHigh;
    }
  }

  /**
   * Construit les niveaux de supports/résistances à partir des pivots
   * (logique identique, code nettoyé + noms clairs)
   */
  #generateSupportsAndResistances(forceValue = 50, filterSameLinesValue = 5) {
    const allExtremes = [
      ...Object.values(this.datas.localLows).map((low) => ({ ...low, type: "low" })),
      ...Object.values(this.datas.localHighs).map((high) => ({ ...high, type: "high" })),
    ];

    // Séparation uniques / multiples
    const groups = allExtremes.reduce((acc, extreme) => {
      const key = extreme.force[forceValue].length === 0 ? "uniques" : "multiples";
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
          (m) => m.time === time && m.type === extreme.type
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
          (resistance) =>
            Math.abs(resistance - support) < filterSameLinesValue
        );
        if (conflictingResistance) {
          toRemove.supports.push(support);
          toRemove.resistances.push(conflictingResistance);
        }
      });

      levels.supports = levels.supports.filter((s) => !toRemove.supports.includes(s));
      levels.resistances = levels.resistances.filter((r) => !toRemove.resistances.includes(r));
    }

    this.datas.supports = levels.supports;
    this.datas.resistances = levels.resistances;
  }

  /**
   * Mise à jour des trades ouverts
   */
  #updateOpenTrades(currentKline) {
    this.trades.forEach((trade) => {
      const result = trade.update(currentKline);
      if (result != null) {
        this.moneyManager.assignTradeResult(result);
        console.log(this.moneyManager.getWinrate());
        console.log(this.moneyManager.currencyCapital);
      }
    });
  }

  /**
   * Vérifie les conditions d'entrée (logique inchangée)
   */
  #checkEntryConditions(currentKline, lastKline) {
    const { supports, resistances } = this.datas;
    const lastGreen = lastKline.open < lastKline.close;
    const currentGreen = currentKline.open < currentKline.close;

    // Un seul trade ouvert autorisé
    if (this.trades.some((t) => !t.triggered)) return null;

    // === Signal Short (résistance cassée à la baisse) ===
    if (
      lastGreen &&
      resistances.some(
        (r) => r > lastKline.open && r < lastKline.close
      ) &&
      !currentGreen
    ) {
      return this.moneyManager.generateTrade(this.actualTick, currentKline.open, {
        stopLoss: 200,
        lot: 0.5,
      });
    }

    // === Signal Long (support cassé à la hausse) ===
    if (
      !lastGreen &&
      supports.some(
        (s) => s < lastKline.open && s > lastKline.close
      ) &&
      currentGreen &&
      this.moneyManager.canStartTrade()
    ) {
      return this.moneyManager.generateTrade(this.actualTick, currentKline.open, {
        takeProfit: 200,
        lot: 0.5,
      });
    }

    return null;
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
      trades: this.trades.map((trade) => trade.result()),
    };
  }
}