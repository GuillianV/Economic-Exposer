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
    this.tradeType = tradeOption.tradeType;
    this.type = tradeOption.type;
    this.tradeResult = null;
    this.id = uuid();
  }

  update(kline) {
    if (this.triggered) {
      return;
    }
    const isTpNegative = this.takeProfit < 0;
    this.priceChange = kline.close - this.startPrice;
    const overflow = (this.priceChange > 0 ? kline.high : kline.low) - kline.close;
    this.priceChangePercent = (this.startPrice + this.priceChange + overflow) / this.startPrice;

    if (this.tradeType === TradesTypes.flat) {
      if ((!isTpNegative && this.priceChange + overflow > this.takeProfit) || (isTpNegative && this.priceChange + overflow < this.takeProfit)) {
        return this.trigger("takeProfit", kline);
      }
      if ((!isTpNegative && this.priceChange + overflow < this.stopLoss) || (isTpNegative && this.priceChange + overflow > this.stopLoss)) {
        return this.trigger("stopLoss", kline);
      }
    } else if (this.tradeType === TradesTypes.percent) {
      if ((!isTpNegative && this.priceChangePercent > this.takeProfit) || (isTpNegative && this.priceChangePercent < this.takeProfit)) {
        return this.trigger("takeProfit", kline);
      }
      if ((!isTpNegative && this.priceChangePercent < this.stopLoss) || (isTpNegative && this.priceChangePercent > this.stopLoss)) {
        return this.trigger("stopLoss", kline);
      }
    }
  }

  result() {
    return {
      id : this.id,
      tradeType: this.tradeType,
      tradeResult: this.tradeResult,
      type: this.type,
      triggered: this.triggered,
      startTick: this.startTick,
      endTick: this.endTick,
      capitalToBuy: this.capitalToBuy,
      startPrice: this.startPrice,
      takeProfit: this.takeProfit,
      stopLoss: this.stopLoss,
      priceChange: this.priceChange,
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

export class TradesTypes {
  static flat = "flat";
  static percent = "percent";
}

export class TradeFlatOptions {
  constructor(startTick, startPrice, capitalToBuy, takeProfit, stopLoss) {
    this.startTick = startTick;
    this.capitalToBuy = capitalToBuy;
    this.startPrice = startPrice;
    this.takeProfit = takeProfit;
    this.stopLoss = stopLoss;
    this.tradeType = TradesTypes.flat;
    this.type = takeProfit > 0 ? "buy" : "sell";
  }
}

export class TradePercentOptions {
  constructor(startTick, startPrice, takeProfit, stopLoss) {
    this.startTick = startTick;
    this.startPrice = startPrice;
    this.takeProfit = takeProfit;
    this.stopLoss = stopLoss;
    this.tradeType = TradesTypes.percent;
    this.type = takeProfit > 0 ? "buy" : "sell";
  }
}
