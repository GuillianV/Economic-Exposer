import { intervalToSeconds } from "../utils.js";
import { parseSimpleKline } from "./parsers/kline.js";
import Trade, { TradeFlatOptions } from "./trade.js";
import util from "util";

export default class Strategy {
  datas = {};

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
    if (this.finalTick == this.actualTick || this.ended) {
      this.ended = true;
      return;
    }

    const lastKline = parseSimpleKline(this.targetEntriesObjects[this.lastTick], this.lastTick);
    const kline = parseSimpleKline(this.targetEntriesObjects[this.actualTick], this.actualTick);

    this.oldTicks.push(this.actualTick);

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
    this.lastTick = this.actualTick;
    this.actualTick += this.intervalMilliseconds;
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
