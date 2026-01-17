import { intervalToSeconds } from "../utils.js";
import { parseSimpleKline } from "./parsers/kline.js";
import Trade, { TradeFlatOptions } from "./trade.js";
import util from "util";

export default class Strategy {
  datas = {
    localLows: {},
    localHighs: {},
  };

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

    //Trades
    this.trades = [];
    this.hasTrade = false;
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

    this.detectLocalLowsHighs(kline, lastKline, thirdKline);

    //Updating trades
    this.trades.forEach((trade) => {
      const result = trade.update(kline);

      if (result != null) {
        // console.log(result);
      }
    });

    if (!this.hasTrade && this.tickCounter == 0) {
      this.hasTrade = true;
      this.trades.push(new Trade(new TradeFlatOptions(this.actualTick, kline.open, 50, -50)));
    }

    this.tickCounter++;
    this.oldTicks.push(this.actualTick);
    this.thirdTick = this.lastTick;
    this.lastTick = this.actualTick;
    this.actualTick += this.intervalMilliseconds;
  }

  detectLocalLowsHighs(actualKline, lastKline, thirdKline) {
    const localLows = this.datas.localLows;
    const localLowsValues = Object.values(localLows);
    const thresholds = [5, 15, 50];
    const localHighs = this.datas.localHighs;
    const localHighsValues = Object.values(localHighs);

    const actualGreen = actualKline.open < actualKline.close;
    const lastGreen = lastKline.open < lastKline.close;
    const thirdGreen = thirdKline.open < thirdKline.close;

    if ((!actualGreen || !lastGreen || !thirdGreen) && lastKline.low < actualKline.low && thirdKline.low > lastKline.low) {
      const lastLocalLow = {
        value: lastKline.low,
        time: lastKline.time,
        force: {},
      };
      for (let t = 0; t < thresholds.length; t++) {
        lastLocalLow.force[thresholds[t]] = 0;
      }
      localLows[lastKline.time] = lastLocalLow;
      for (let j = 0; j < thresholds.length; j++) {
        const threshold = thresholds[j];
        const nearestLows = localLowsValues.filter((ll) => {
          return ll.value - threshold < lastLocalLow.value && ll.value + threshold > lastLocalLow.value;
        });

        if (nearestLows != null) {
          nearestLows.forEach((ll) => {
            lastLocalLow.force[threshold] += 1;
            ll.force[threshold] += 1;
          });
        }
      }
    }

    if ((actualGreen || lastGreen || thirdGreen) && lastKline.high > actualKline.high && thirdKline.high < lastKline.high) {
      const lastLocalHigh = {
        value: lastKline.high,
        time: lastKline.time,
        force: {},
      };
      for (let t = 0; t < thresholds.length; t++) {
        lastLocalHigh.force[thresholds[t]] = 0;
      }
      localHighs[lastKline.time] = lastLocalHigh;
      for (let j = 0; j < thresholds.length; j++) {
        const threshold = thresholds[j];
        const nearestHighs = localHighsValues.filter((ll) => {
          return ll.value - threshold < lastLocalHigh.value && ll.value + threshold > lastLocalHigh.value;
        });

        if (nearestHighs != null) {
          nearestHighs.forEach((ll) => {
            lastLocalHigh.force[threshold] += 1;
            ll.force[threshold] += 1;
          });
        }
      }
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
