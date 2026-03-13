export class Strategies {
  constructor(strategies = []) {
    this.strategies = strategies;
  }

  updateOpenTrades(datas) {
    this.strategies.forEach((strategy) => {
      strategy.updateOpenTrades(datas);
    });
  }

  closeOpenTrades(datas) {
    this.strategies.forEach((strategy) => {
      strategy.closeOpenTrades(datas);
    });
  }

  startupTrades(datas, targetEntriesArray, actualTick, intervalMilliseconds) {
    this.strategies.forEach((strategy) => {
      strategy.startupTrade(
        datas,
        targetEntriesArray,
        actualTick,
        intervalMilliseconds,
      );
    });
  }

  retrieve() {
    return this.strategies.map((strategy) => {
      return strategy.retrieve();
    });
  }
}

export default class Strategy {
  constructor(moneyManager, condition, name) {
    this.moneyManager = moneyManager;
    this.condition = condition;
    this.name = name;
    this.trades = [];
  }

  startupTrade(datas, targetEntriesArray, actualTick, intervalMilliseconds) {
    const condition = this.condition(
      datas,
      targetEntriesArray,
      actualTick,
      intervalMilliseconds,
      this.trades,
    );

    if (condition != null && this.moneyManager.canStartTrade()) {
      const trade = this.moneyManager.generateTrade(
        condition.startTick,
        condition.startPrice,
        condition.options,
      );
      this.trades.push(trade);
      this.moneyManager.assignTradeStart(trade.result());
    }
  }

  /**
   * Mise à jour des trades ouverts
   */
  updateOpenTrades(datas) {
    const { currentKline } = datas;
    this.trades.forEach((trade) => {
      const result = trade.update(currentKline);
      if (result != null) {
        this.moneyManager.assignTradeResult(result);
      }
    });
  }

  closeOpenTrades(datas) {
    const { currentKline } = datas;
    this.trades
      .filter((trade) => !trade.triggered)
      .forEach((trade) => {
        const result = trade.close(currentKline);
        if (result != null) {
          this.moneyManager.assignTradeResult(result);
        }
      });
  }

  retrieve() {
    return {
      moneyManager: this.moneyManager.retrieve(),
      name: this.name,
      trades: this.trades.map((trade) => trade.result()),
    };
  }
}
