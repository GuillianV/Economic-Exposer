class Strategies {
  strategies = {};

  constructor(ui) {
    this.ui = ui;
  }

  upsert(strategies) {
    for (const strategy of strategies) {
      let existing = this.strategies[strategy.name] != null;
      this.strategies[strategy.name] = strategy;
      this.render(strategy.name , existing);
    }
  }

  retrieve(strategyName) {
    return strategyName != null ? this.strategies[strategyName] : this.strategies;
  }

  render(strategyName, existing) {
    const strategy = this.strategies[strategyName];

    if (strategy == null) {
      return;
    }

    if (!existing) {
        this.ui.initStrategyDetailsContainer(strategyName);
    }
    
    const {requiredWinratePercent , winratePercent , requiredWinrate, winrate} = strategy.moneyManager.winrate
    const color = winrate > requiredWinrate ? "green" : "red";
    this.ui.updateStrategyDetailsContainer(strategyName, winratePercent ,requiredWinratePercent, color);
  }
}
