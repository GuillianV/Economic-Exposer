import { timestampParser } from "../utils.js";

export default class Trade {
  priceChange = 0;
  priceChangePercent = 0;
  triggered = false;
  result = null;

  constructor(tradeOption) {
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
        return this.trigger("takeProfit");
      }
      if (this.priceChange < this.stopLoss) {
        return this.trigger("stopLoss");
      }
    } else if (this.type === TradesTypes.percent) {
      if (this.priceChangePercent > this.takeProfit) {
        return this.trigger("takeProfit");
      }
      if (this.priceChangePercent < this.stopLoss) {
        return this.trigger("stopLoss");
      }
    }
  }

  trigger(type) {
    this.triggered = true;
    return {
      type: type,
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
  constructor(startPrice, takeProfit, stopLoss) {
    this.startPrice = startPrice;
    this.takeProfit = takeProfit;
    this.stopLoss = stopLoss;
    this.type = TradesTypes.flat;
  }
}

export class TradePercentOptions {
  constructor(startPrice, takeProfit, stopLoss) {
    this.startPrice = startPrice;
    this.takeProfit = takeProfit;
    this.stopLoss = stopLoss;
    this.type = TradesTypes.percent;
  }
}
