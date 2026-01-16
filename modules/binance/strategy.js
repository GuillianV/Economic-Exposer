import { intervalToSeconds } from "../utils.js";
import { parseSimpleKline } from "./parsers/kline.js";
import Trade, { TradeFlatOptions } from "./trade.js";
import util from "util";

export default class Strategy {
  datas = {
    supports: {},
    resistances: {},
  };

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
    this.targetEntriesObjects = this.entriesObjects[options.chain][options.interval];
    this.targetEntriesArray = Object.entries(this.targetEntriesObjects);
    this.onEndCb = () => {};
    this.actualTick = parseInt(this.targetEntriesArray[this.targetEntriesArray.length - options.startingTick][0]);
    this.intervalMilliseconds = intervalToSeconds(options.interval) * 1000;
    this.lastTick = this.actualTick - this.intervalMilliseconds;
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

    const lastKline = parseSimpleKline(this.targetEntriesObjects[this.lastTick], this.lastTick);
    const kline = parseSimpleKline(this.targetEntriesObjects[this.actualTick], this.actualTick);

    this.detectSupportsResistances(kline, lastKline);

    //Updating trades
    this.trades.forEach((trade) => {
      const result = trade.update(kline);

      if (result != null) {
        // console.log(result);
      }
    });

    if (!this.hasTrade && this.tickCounter == 0) {
      this.hasTrade = true;
      this.trades.push(new Trade(new TradeFlatOptions(this.actualTick, kline.open, 500, -500)));
    }

    this.tickCounter++;
    this.oldTicks.push(this.actualTick);
    this.lastTick = this.actualTick;
    this.actualTick += this.intervalMilliseconds;
  }

  detectSupportsResistances(actualKline, lastKline) {
    const supports = this.datas.supports;
    const supportsEntries = Object.keys(supports);
    const resistances = this.datas.resistances;
    const resistancesEntries = Object.keys(resistances);

    if (supportsEntries.length == 0) {
      supports[actualKline.time] = {
        value: actualKline.close,
      };
    }

    const indexLastSupport = supportsEntries.indexOf(lastKline.time.toString());
    if (indexLastSupport != -1) {
      const key = supportsEntries[indexLastSupport];
      const lastSupport = supports[key];

      if (lastSupport.value > actualKline.close) {
        supports[actualKline.time] = {
          value: actualKline.close,
        };

        delete supports[key];
      }
    } else {
      if (actualKline.close > lastKline.close && lastKline.open > lastKline.close) {
        supports[lastKline.time] = {
          value: lastKline.close,
        };
      }
    }

    if (resistancesEntries.length == 0) {
      resistances[actualKline.time] = {
        value: actualKline.close,
      };
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
