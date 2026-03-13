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

  checkEntryConditions(
    datas,
    targetEntriesArray,
    actualTick,
    intervalMilliseconds,
  ) {
    return this.strategies.forEach((strategy) => {
      const condition = strategy.checkEntryConditions(
        datas,
        targetEntriesArray,
        actualTick,
        intervalMilliseconds,
      );

      if (condition != null) {
        strategy.trades.push(condition);
        strategy.moneyManager.assignTradeStart(condition.result());
      }
    });
  }

  retrieve() {
    return this.strategies.map((strategy) => {
      return strategy.retrieve();
    });
  }
}

export default class Strategy {
  constructor(moneyManager, condition) {
    this.moneyManager = moneyManager;
    this.condition = condition;
    this.trades = [];
  }

  checkEntryConditions(
    datas,
    targetEntriesArray,
    actualTick,
    intervalMilliseconds,
  ) {
    return this.condition(
      datas,
      targetEntriesArray,
      actualTick,
      intervalMilliseconds,
      this.moneyManager,
      this.trades,
    );
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
    };
  }
}
