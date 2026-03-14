import Trade from "./trade.js";

export default class MoneyManager {
  /**
   * Capital disponible en devise de base (USDT / €)
   */
  currencyCapital = 0;

  /**
   * Capital engagé dans les positions ouvertes
   */
  quoteCapital = 0;

  /**
   * Capital de départ (pour stats)
   */
  baseCapital = 0;

  /**
   * Frais de trading round-trip (avec BNB)
   */
  binanceTradingFeeRate = 0.00075;

  /**
   * Taux d’intérêt horaire d’emprunt USDT (Margin Isolated)
   */
  binanceHourlyBorrowRate = 0.0000035788;

  /**
   * Historique complet des tradesResults (clé = id)
   */
  tradesResults = {};

  /**
   * Ratio Risk/Reward choisi (ex: RR[3])
   */
  rr;

  /**
   * Suivi des moyennes pour le calcul du winrate requis
   * (gardé exactement comme avant, même nom "median" même si c’est une moyenne)
   */
  averagePositions = {
    medianRisk: [],
    medianDuration: [],
    medianPosition: [],
  };

  /**
   * Winrate moyen (non utilisé actuellement, conservé pour compatibilité)
   */
  averageWinrate = 0;

  constructor(baseCapital, rr) {
    this.baseCapital = baseCapital;
    this.currencyCapital = baseCapital;
    this.quoteCapital = 0;
    this.rr = rr;
  }

  canStartTrade() {
    return this.currencyCapital > 0;
  }

  availableCapital() {
    return this.currencyCapital;
  }

  /**
   * Retourne uniquement le montant des frais de trading
   */
  #calculateTradingFee(amount) {
    return amount * this.binanceTradingFeeRate;
  }

  /**
   * Retourne uniquement le coût des intérêts d’emprunt
   */
  #calculateBorrowInterest(grossAmount, hours) {
    return grossAmount * this.binanceHourlyBorrowRate * hours;
  }

  /**
   * Met à jour les tableaux de suivi (exactement comme avant)
   */
  #updateAveragePositions(tradeDurationHours, riskAmount, position) {
    this.averagePositions.medianDuration.push(tradeDurationHours);
    this.averagePositions.medianRisk.push(riskAmount);
    this.averagePositions.medianPosition.push(position);
  }

  /**
   * Calcule les moyennes utilisées dans getWinrate (modulaire et précis)
   */
  #getAverageStats() {
    const pos = this.averagePositions.medianPosition;
    const risk = this.averagePositions.medianRisk;
    const dur = this.averagePositions.medianDuration;

    return {
      averagePosition:
        pos.length > 0 ? pos.reduce((sum, v) => sum + v, 0) / pos.length : 0,
      averageRisk:
        risk.length > 0 ? risk.reduce((sum, v) => sum + v, 0) / risk.length : 0,
      averageDuration:
        dur.length > 0 ? dur.reduce((sum, v) => sum + v, 0) / dur.length : 0,
    };
  }

  getWinrate() {
    const allTrades = Object.values(this.tradesResults);
    const winners = allTrades.filter(
      (t) => t.tradeResult === "takeProfit",
    ).length;
    const totalClosed = allTrades.filter((t) => t.triggered === true).length;

    // Récupération des moyennes via module privé (résultat identique)
    const requiredWinrate = this.#getAverageStats();

    // Calcul exact du requiredWinrateRaw (identique à l’original)
    const requiredWinrateRaw = this.getRequiredWinrateForRR(
      this.rr.rr,
      requiredWinrate.averagePosition,
      requiredWinrate.averageRisk,
      requiredWinrate.averageDuration,
    );

    return {
      winners,
      total: totalClosed,
      losers: totalClosed - winners,
      winrate: totalClosed > 0 ? winners / totalClosed : 0,
      requiredWinrate: requiredWinrateRaw,
      winratePercent:
        totalClosed > 0
          ? `${((winners / totalClosed) * 100).toFixed(1)}%`
          : "0%",
      requiredWinratePercent: `${(requiredWinrateRaw * 100).toFixed(1)}%`,
    };
  }


  getTradesResults() {
    

    const totalFees = Object.values(this.tradesResults).reduce((sum, trade) => sum + trade.totalFees, 0);
    const totalRawEarned = Object.values(this.tradesResults).reduce((sum, trade) => sum + trade.rawEarnedCapital, 0);
    const totalFinalEarned = Object.values(this.tradesResults).reduce((sum, trade) => sum + trade.finalEarnedCapital, 0);

    return {
      totalFees,
      totalRawEarned,
      totalFinalEarned,
    }

  }

  /**
   * Calcule le winrate minimum requis pour un RR donné
   * Position et riskAmount sont obligatoires en pratique (appelé avec les moyennes)
   */
  getRequiredWinrateForRR(
    targetRR = 1,
    position = 0.000001,
    riskAmount = 0.000001,
    avgDurationHours = 2,
  ) {
    // Calcul exact identique à l’original
    const tradingFees = 2 * this.#calculateTradingFee(position);
    const borrowInterest = this.#calculateBorrowInterest(
      position,
      avgDurationHours,
    );
    const totalFeesF = tradingFees + borrowInterest;

    const F_over_R = totalFeesF / riskAmount ;

    let requiredWinrate = (1 + F_over_R) / (1 + targetRR);
    if (isNaN(requiredWinrate)) {
      requiredWinrate = 0;
    }

    return parseFloat(requiredWinrate.toFixed(4));
  }

  generateTrade(startTick, startPrice, rroptions) {
    let takeProfit = 0;
    let stopLoss = 0;
    let lot = rroptions.lot ?? 0.5;

    if (rroptions.takeProfit != null) {
      takeProfit = rroptions.takeProfit;
      stopLoss = -(rroptions.takeProfit / this.rr.rr);
    } else if (rroptions.stopLoss != null) {
      stopLoss = rroptions.stopLoss;
      takeProfit = -(rroptions.stopLoss * this.rr.rr);
      lot = lot / this.rr.rr;
    }

    const options = {
      startTick,
      startPrice,
      takeProfit,
      stopLoss,
      capitalToBuy: this.availableCapital() * lot,
      lot,
    };

    return new Trade(options);
  }

  assignTradeStart(trade) {
    const entryFee = this.#calculateTradingFee(trade.capitalToBuy);
    const quoteAfterFees = trade.capitalToBuy - entryFee;

    this.currencyCapital -= trade.capitalToBuy;
    this.quoteCapital += quoteAfterFees;

    this.tradesResults[trade.id] = {
      ...trade,
      quoteCapital: quoteAfterFees,
      fees: [entryFee],
    };
  }

  assignTradeResult(closedTrade) {
    const openTrade = this.tradesResults[closedTrade.id];
    if (!openTrade) return;

    const { quoteCapital: borrowedNet, fees: existingFees } = openTrade;

    // === 1. Calcul du % de variation (exactement comme avant) ===
    const priceChangePercent =
      closedTrade.takeProfit > 0
        ? closedTrade.priceChangePercent
        : 2 - closedTrade.priceChangePercent;

    // === 2. Valeur brute après mouvement ===
    const grossValueAfterPriceMove = borrowedNet * priceChangePercent;

    // === 3. Durée en heures ===
    const tradeDurationHours =
      (closedTrade.endTick - closedTrade.startTick) / 1000 / 60 / 60;

    // === 4. Frais de sortie + intérêts ===
    const exitTradingFee = this.#calculateTradingFee(grossValueAfterPriceMove);
    const borrowInterest = this.#calculateBorrowInterest(
      grossValueAfterPriceMove,
      tradeDurationHours,
    );

    // === 5. Capital net qui revient ===
    const finalNetCapital =
      grossValueAfterPriceMove - exitTradingFee - borrowInterest;

    // Mise à jour capital global
    this.currencyCapital += finalNetCapital;
    this.quoteCapital -= borrowedNet;

    // === 6. Mise à jour du trade dans l’historique (exact) ===
    const allFees = [...existingFees, exitTradingFee, borrowInterest];
    const totalFees = allFees.reduce((sum, fee) => sum + fee, 0);

    this.tradesResults[closedTrade.id] = {
      ...openTrade,
      ...closedTrade,
      priceChangePercent,
      baseCapitalAfterTrade: grossValueAfterPriceMove,
      baseCapitalAfterTradeFees: finalNetCapital,
      fees: allFees,
      totalFees,
      rawEarnedCapital: finalNetCapital + totalFees - closedTrade.capitalToBuy,
      finalEarnedCapital: finalNetCapital - closedTrade.capitalToBuy,
    };

    // === Calcul du risque absolu (exactement comme avant) ===
    let absolutePriceChangePercent = priceChangePercent;
    if (priceChangePercent > 1) {
      absolutePriceChangePercent = 2 - priceChangePercent;
    }

    const riskAmount =
      closedTrade.capitalToBuy -
      closedTrade.capitalToBuy * absolutePriceChangePercent;

    // Mise à jour des stats via module privé (comportement identique)
    this.#updateAveragePositions(
      tradeDurationHours,
      riskAmount,
      closedTrade.capitalToBuy,
    );
  }

  retrieve() {
    return {
      baseCapital: this.baseCapital,
      currencyCapital: this.currencyCapital,
      quoteCapital: this.quoteCapital,
      totalTrades: Object.keys(this.tradesResults).length,
      tradesList : this.tradesResults,
      winrate: this.getWinrate(),
      tradesResults: this.getTradesResults(),
    };
  }
}

export const RR = {
  0.33: { winrate: 0.75, rr: 0.33 },
  0.5: { winrate: 0.67, rr: 0.5 },
  1: { winrate: 0.5, rr: 1 },
  2: { winrate: 0.33, rr: 2 },
  3: { winrate: 0.25, rr: 3 },
  4: { winrate: 0.2, rr: 4 },
};
