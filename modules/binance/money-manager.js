import Trade from "./trade.js";

export default class MoneyManager {
  currecyCapital = 0;
  quoteCapital = 0;
  baseCapital = 0;

  binanceFees = 0.001;
  trades = {};

  constructor(baseCapital, rr) {
    this.baseCapital = baseCapital;
    this.currecyCapital = baseCapital;
    this.rr = rr;
  }

  canStartTrade() {
    return this.currecyCapital > 0;
  }

  availableCapital() {
    return this.currecyCapital;
  }

  getWinrate() {
    const values = Object.values(this.trades);

    const tps = values.filter(
      (value) => value.tradeResult == "takeProfit",
    ).length;
    const alls = values.filter((value) => value.triggered == true).length;


    return {
      winners : tps,
      alls : alls,
      losers : alls - tps,
      winrate : tps / alls
    }
  }

  assignTradeStart(tradeResult) {
    const quoteCapital = this._applyFees(tradeResult.capitalToBuy);
    this.currecyCapital -= tradeResult.capitalToBuy;
    this.quoteCapital += quoteCapital;
    this.trades[tradeResult.id] = { ...tradeResult, quoteCapital };
  }

  _applyFees(amount) {
    return amount - amount * this.binanceFees;
  }

  assignTradeResult(tradeResult) {
    const quoteCapital = this.trades[tradeResult.id].quoteCapital;
    tradeResult.priceChangePercent =
      tradeResult.takeProfit > 0
        ? tradeResult.priceChangePercent
        : 1 + 1 - tradeResult.priceChangePercent;
    const baseCapitalAfterTrade = quoteCapital * tradeResult.priceChangePercent;
    const baseCapitalAfterTradeFees = this._applyFees(baseCapitalAfterTrade );
    this.currecyCapital += baseCapitalAfterTradeFees;
    this.quoteCapital -= quoteCapital;
    this.trades[tradeResult.id] = {
      ...this.trades[tradeResult.id],
      ...tradeResult,
      baseCapitalAfterTrade,
      baseCapitalAfterTradeFees,
    };

    console.log( this.trades[tradeResult.id] );
    console.log(this.currecyCapital)
    console.log(this.quoteCapital)
  }

  retrieve() {
    return {
      baseCapital: this.baseCapital,
    };
  }

  generateTrade(startTick, startPrice, rroptions) {
    let takeProfit = 0;
    let stopLoss = 0;
    let lot = rroptions.lot;

    if (rroptions.takeProfit != null) {
      takeProfit = rroptions.takeProfit;
      stopLoss = -(rroptions.takeProfit / this.rr.rr);
    
    } else if (rroptions.stopLoss != null) {
      stopLoss = rroptions.stopLoss;
      takeProfit = -(rroptions.stopLoss * this.rr.rr);
      lot = lot / this.rr.rr
    }

    const options = {
      startTick: startTick,
      startPrice: startPrice,
      takeProfit: takeProfit,
      stopLoss: stopLoss,
      capitalToBuy: this.availableCapital() * lot,
      lot
    };

    const trade = new Trade(options);
    return trade;
  }
}

export class RR {
  static get 0.33() {
    return {
      winrate: 0.75,
      rr: 0.33,
    };
  }

  static get 0.5() {
    return {
      winrate: 0.67,
      rr: 0.5,
    };
  }

  static get 1() {
    return {
      winrate: 0.5,
      rr: 1,
    };
  }

  static get 2() {
    return {
      winrate: 0.33,
      rr: 2,
    };
  }

  static get 3() {
    return {
      winrate: 0.25,
      rr: 3,
    };
  }

  static get 4() {
    return {
      winrate: 0.2,
      rr: 4,
    };
  }
}
