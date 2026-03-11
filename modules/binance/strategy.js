import { intervalToSeconds } from "../utils.js";
import MoneyManager, { RR } from "./money-manager.js";
import { parseSimpleKline } from "./parsers/kline.js";
import Trade from "./trade.js";
import util from "util";

export default class Strategy {
  datas = {
    localLows: {},
    localHighs: {},
    supports: [],
    resistances: [],
  };
  moneyManager;

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
    this.targetEntriesObjects = this.entriesObjects[options.chain][options.interval];
    this.targetEntriesArray = Object.entries(this.targetEntriesObjects);
    this.onEndCb = () => {};
    this.actualTick = parseInt(this.targetEntriesArray[this.targetEntriesArray.length - options.startingTick][0]);
    this.intervalMilliseconds = intervalToSeconds(options.interval) * 1000;
    this.lastTick = this.actualTick - this.intervalMilliseconds;
    this.thirdTick = this.lastTick - this.intervalMilliseconds;
    this.finalTick = this.targetEntriesArray[this.targetEntriesArray.length - 1][0];
    this.ended = false;
    this.oldTicks = [];

    //Money Manager
    this.moneyManager = new MoneyManager(100, RR[1]);

    //Trades
    this.trades = [];
    this.tickCounter = 0;
  }

  tick() {
    if (this.ended) {
      return;
    }

    if (this.finalTick == this.actualTick) {
      this.ended = true;
      this.onEndCb();
      return;
    }
    const thirdKline = parseSimpleKline(this.targetEntriesObjects[this.thirdTick], this.thirdTick);
    const lastKline = parseSimpleKline(this.targetEntriesObjects[this.lastTick], this.lastTick);
    const kline = parseSimpleKline(this.targetEntriesObjects[this.actualTick], this.actualTick);

    const forcePriceValue = 20;
    const filterSameLinesValue = 5;
    this.detectLocalHighsLows(kline, lastKline, thirdKline, forcePriceValue);
    this.generateSupportsResitances(forcePriceValue, filterSameLinesValue);

    //Updating trades
    this.trades.forEach((trade) => {
      const result = trade.update(kline);

      if (result != null) {
        this.moneyManager.assignTradeResult(result);
      }
    });

    const trade = this.generateTradeConditions(kline, lastKline);
    if (trade) {
      this.trades.push(trade);
      this.moneyManager.assignTradeStart(trade.result());
    }

    this.tickCounter++;
    this.oldTicks.push(this.actualTick);
    this.thirdTick = this.lastTick;
    this.lastTick = this.actualTick;
    this.actualTick += this.intervalMilliseconds;
  }

  detectLocalHighsLows(actualKline, lastKline, thirdKline, force = 50) {
    const localLows = this.datas.localLows;
    const localLowsValues = Object.values(localLows);
    const thresholds = [force];
    const localHighs = this.datas.localHighs;
    const localHighsValues = Object.values(localHighs);

    const actualGreen = actualKline.open < actualKline.close;
    const lastGreen = lastKline.open < lastKline.close;
    const thirdGreen = thirdKline.open < thirdKline.close;

    function generateLastLocal(value) {
      const lastLocal = {
        value,
        time: lastKline.time,
        force: {},
      };
      for (let t = 0; t < thresholds.length; t++) {
        lastLocal.force[thresholds[t]] = [];
      }
      return lastLocal;
    }

    if ((!actualGreen || !lastGreen || !thirdGreen) && lastKline.low < actualKline.low && thirdKline.low > lastKline.low) {
      const lastLocalLow = generateLastLocal(lastKline.close);
      for (let j = 0; j < thresholds.length; j++) {
        const threshold = thresholds[j];
        const nearestLows = localLowsValues.filter((ll) => {
          return ll.value - threshold < lastLocalLow.value && ll.value + threshold > lastLocalLow.value;
        });

        if (nearestLows != null) {
          nearestLows.forEach((ll) => {
            lastLocalLow.force[threshold].push(ll.time);
            ll.force[threshold].push(lastLocalLow.time);
          });
        }
      }
      localLows[lastKline.time] = lastLocalLow;
    }

    if ((actualGreen || lastGreen || thirdGreen) && lastKline.high > actualKline.high && thirdKline.high < lastKline.high) {
      const lastLocalHigh = generateLastLocal(lastKline.close);

      for (let j = 0; j < thresholds.length; j++) {
        const threshold = thresholds[j];
        const nearestHighs = localHighsValues.filter((ll) => {
          return ll.value - threshold < lastLocalHigh.value && ll.value + threshold > lastLocalHigh.value;
        });

        if (nearestHighs != null) {
          nearestHighs.forEach((ll) => {
            lastLocalHigh.force[threshold].push(ll.time);
            ll.force[threshold].push(lastLocalHigh.time);
          });
        }
      }
      localHighs[lastKline.time] = lastLocalHigh;
    }
  }

  generateSupportsResitances(forceValue = 50, filterSameLinesValue = 5) {
    const localLows = this.datas.localLows;
    const localLowsEntries = Object.values(localLows);
    const localHighs = this.datas.localHighs;
    const localHighsEntries = Object.values(localHighs);

    const localExtremes = [
      ...localLowsEntries.map((entry) => {
        entry.type = "low";
        return entry;
      }),
      ...localHighsEntries.map((entry) => {
        entry.type = "high";
        return entry;
      }),
    ];

    const localGroups = localExtremes.reduce((acc, item) => {
      const group = item.force[forceValue].length == 0 ? "uniques" : "multiples";
      if (!acc[group]) acc[group] = [];
      acc[group].push(item);
      return acc;
    }, {});

    const uniques = Object.values(localGroups.uniques ?? {});
    const multiples = Object.values(localGroups.multiples ?? {});

    const cluster = {};

    multiples.forEach((extreme, index) => {
      if (extreme.used) {
        return;
      }

      cluster[`${index}_${extreme.type}`] = [extreme.value];
      const times = extreme.force[forceValue];
      times.forEach((time) => {
        const multipleFound = multiples.find((multiple) => multiple.time == time && multiple.type == extreme.type);
        if (multipleFound != null) {
          multipleFound.used = true;
          cluster[`${index}_${extreme.type}`].push(multipleFound.value);
        }
      });
    });

    const clusterDatas = {
      supports: [],
      resistances: [],
    };

    uniques.forEach((unique) => {
      clusterDatas[unique.type == "low" ? "supports" : "resistances"].push(unique.value);
    });

    Object.entries(cluster).forEach(([key, values]) => {
      clusterDatas[key.includes("_low") ? "supports" : "resistances"].push(values.reduce((acc, cur) => acc + cur, 0) / values.length);
    });

    if (filterSameLinesValue != 0) {
      const identicals = {
        supports: [],
        resistances: [],
      };
      clusterDatas.supports.forEach((support, index) => {
        const isResistance = clusterDatas.resistances.find((resistance) => (resistance > support && resistance - filterSameLinesValue < support) || (resistance < support && resistance + filterSameLinesValue > support));
        if (isResistance) {
          identicals.supports.push(support);
          identicals.resistances.push(isResistance);
        }
      });
      clusterDatas.supports = clusterDatas.supports.filter((support) => !identicals.supports.includes(support));
      clusterDatas.resistances = clusterDatas.resistances.filter((resistance) => !identicals.resistances.includes(resistance));
    }
    this.datas.supports = clusterDatas.supports;
    this.datas.resistances = clusterDatas.resistances;
  }

  generateTradeConditions(actualKline, lastKline) {
    const { supports, resistances } = this.datas;
    const lastGreen = lastKline.open < lastKline.close;
    const actualGreen = actualKline.open < actualKline.close;

    if (this.trades.find((trade) => !trade.triggered)) {
      return;
    }

    if (lastGreen && resistances.find((resistance) => resistance > lastKline.open && resistance < lastKline.close) && !actualGreen) {
      return this.moneyManager.generateTrade(this.actualTick, actualKline.open, {
        stopLoss: 300,
      });
    } else if (!lastGreen && supports.find((support) => support < lastKline.open && support > lastKline.close) && actualGreen && this.moneyManager.canStartTrade()) {
      return this.moneyManager.generateTrade(this.actualTick, actualKline.open, {
        takeProfit: 300,
      });
    }
  }

  onEnd(cb) {
    this.onEndCb = cb;
  }

  retrieve() {
    return {
      klines: this.oldTicks.map((tick) => {
        return { ...this.targetEntriesObjects[tick], time: tick };
      }),
      datas: this.datas,
      trades: this.trades.map((trade) => trade.result()),
    };
  }
}
