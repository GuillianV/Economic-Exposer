import { timestampParser, uuid } from "../utils.js";

export default class Trade {
  priceChange = 0;
  priceChangePercent = 0;
  triggered = false;

  constructor(tradeOption) {
    this.startTick = tradeOption.startTick;
    this.startPrice = parseFloat(tradeOption.startPrice);
    this.takeProfit = tradeOption.takeProfit;
    this.stopLoss = tradeOption.stopLoss;
    this.capitalToBuy = tradeOption.capitalToBuy;
    this.tradeResult = null;
    this.id = uuid();
  }

  update(kline) {
    if (this.triggered) {
      return;
    }
    const isTpNegative = this.takeProfit < 0;
    this.priceChange = kline.close - this.startPrice;
    const overflow =
      (this.priceChange > 0 ? kline.high : kline.low) - kline.close;
    this.priceChangePercent =
      (this.startPrice + this.priceChange + overflow) / this.startPrice;
    this.overflow = overflow;
    if (
      (!isTpNegative && this.priceChange + overflow > this.takeProfit) ||
      (isTpNegative && this.priceChange + overflow < this.takeProfit)
    ) {
      return this.trigger("takeProfit", kline);
    }
    if (
      (!isTpNegative && this.priceChange + overflow < this.stopLoss) ||
      (isTpNegative && this.priceChange + overflow > this.stopLoss)
    ) {
      return this.trigger("stopLoss", kline);
    }
  }

  result() {
    return {
      id: this.id,
      tradeResult: this.tradeResult,
      triggered: this.triggered,
      startTick: this.startTick,
      endTick: this.endTick,
      capitalToBuy: this.capitalToBuy,
      startPrice: this.startPrice,
      takeProfit: this.takeProfit,
      stopLoss: this.stopLoss,
      priceChange: this.priceChange + this.overflow,
      priceChangePercent: this.priceChangePercent,
    };
  }

  trigger(tradeResult, kline) {
    this.triggered = true;
    this.endTick = kline.time;
    this.tradeResult = tradeResult;
    return this.result();
  }
}
