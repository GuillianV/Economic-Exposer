class Strategies {
  strategies = {};

  constructor(ui) {
    this.ui = ui;
  }

  upsert(strategies) {
    for (const strategy of strategies) {
      let existing = this.strategies[strategy.name] != null;
      this.strategies[strategy.name] = strategy;
      this.render(strategy.name, existing);
    }
  }

  retrieve(strategyName) {
    return strategyName != null
      ? this.strategies[strategyName]
      : this.strategies;
  }

  render(strategyName, existing) {
    const strategy = this.strategies[strategyName];

    if (strategy == null) {
      return;
    }

    if (!existing) {
      this.ui.initStrategyDetailsContainer(strategyName);
    }

    const { baseCapital, currencyCapital, totalTrades, tradesResults, riskReward } =
      strategy.moneyManager;
    const { requiredWinrate, winrate } = strategy.moneyManager.winrate;
    const { totalFees, totalRawEarned, totalFinalEarned } = tradesResults;
    const color = totalFinalEarned > 0 ? "green" : "red";
    this.ui.updateStrategyDetailsContainer(
      strategyName,
      riskReward,
      (winrate * 100).toFixed(2),
      (requiredWinrate * 100).toFixed(2),
      baseCapital,
      currencyCapital.toFixed(2),
      totalTrades,
      totalFees?.toFixed(2),
      totalRawEarned?.toFixed(2),
      totalFinalEarned?.toFixed(2),
      color,
    );
  }
}
