import { timestampParser } from "../utils.js";

export default class Trade {
  priceChange = 0;
  priceChangePercent = 0;
  triggered = false;

  constructor(tradeOption) {
    this.startTick = tradeOption.startTick;
    this.startPrice = parseFloat(tradeOption.startPrice);
    this.takeProfit = tradeOption.takeProfit;
    this.stopLoss = tradeOption.stopLoss;
    this.type = tradeOption.type;
  }

  update(kline) {
    if (this.triggered) {
      return;
    }

    this.priceChange = kline.close - this.startPrice;
    this.priceChangePercent = (this.startPrice + this.priceChange) / this.startPrice;

    if (this.type === TradesTypes.flat) {
      if (this.priceChange > this.takeProfit) {
        return this.trigger("takeProfit", kline);
      }
      if (this.priceChange < this.stopLoss) {
        return this.trigger("stopLoss", kline);
      }
    } else if (this.type === TradesTypes.percent) {
      if (this.priceChangePercent > this.takeProfit) {
        return this.trigger("takeProfit", kline);
      }
      if (this.priceChangePercent < this.stopLoss) {
        return this.trigger("stopLoss", kline);
      }
    }
  }

  result() {
    return {
      type: this.type,
      triggered: this.triggered,
      startTick: this.startTick,
      endTick: this.endTick,
      startPrice: this.startPrice,
      takeProfit: this.takeProfit,
      stopLoss: this.stopLoss,
      priceChange: this.priceChange,
      priceChangePercent: this.priceChangePercent,
    };
  }

  trigger(type, kline) {
    this.triggered = true;
    this.endTick = kline.time;
    this.type = type;
    return {
      type: type,
      startTick: this.startTick,
      takeProfit: this.takeProfit,
      stopLoss: this.stopLoss,
      endTick: kline.time,
      priceChange: this.priceChange,
      priceChangePercent: this.priceChangePercent,
    };
  }
}

export class TradesTypes {
  static flat = "flat";
  static percent = "percent";
}

export class TradeFlatOptions {
  constructor(startTick, startPrice, takeProfit, stopLoss) {
    this.startTick = startTick;
    this.startPrice = startPrice;
    this.takeProfit = takeProfit;
    this.stopLoss = stopLoss;
    this.type = TradesTypes.flat;
  }
}

export class TradePercentOptions {
  constructor(startTick, startPrice, takeProfit, stopLoss) {
    this.startTick = startTick;
    this.startPrice = startPrice;
    this.takeProfit = takeProfit;
    this.stopLoss = stopLoss;
    this.type = TradesTypes.percent;
  }
}
