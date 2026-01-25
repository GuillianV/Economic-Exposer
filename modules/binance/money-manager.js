export default class MoneyManager {
  currecyCapital = 0;
  quoteCapital = 0;
  baseCapital = 0;

  binanceFees = 0.07125;
  trades = {};

  constructor(baseCapital) {
    this.baseCapital = baseCapital;
    this.currecyCapital = baseCapital;
  }

  canStartTrade() {
    return this.currecyCapital > 0;
  }

  availableCapital() {
    return this.currecyCapital;
  }

  assignTradeStart(tradeResult) {
    if (tradeResult.type === "buy") {
      const quoteCapital = this._applyFees(tradeResult.capitalToBuy);
      this.currecyCapital -= tradeResult.capitalToBuy;
      this.quoteCapital += quoteCapital;
      this.trades[tradeResult.id] = quoteCapital;
    }
  }

  _applyFees(amount) {
    return amount - amount * this.binanceFees;
  }

  assignTradeResult(tradeResult) {
    console.log(tradeResult);
    if (tradeResult.type === "buy") {
      const quoteCapital = this.trades[tradeResult.id];
      const quoteCapitalAfterTrade = quoteCapital * tradeResult.priceChangePercent;
      const quoteCapitalAfterFees = this._applyFees(quoteCapitalAfterTrade);
      this.currecyCapital += quoteCapitalAfterFees;
      this.quoteCapital -= quoteCapital;
      delete this.trades[tradeResult.id];

      console.log(this.currecyCapital);
    }
  }

  retrieve() {
    return {
      baseCapital: this.baseCapital,
    };
  }
}
