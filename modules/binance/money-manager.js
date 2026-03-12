import Trade from "./trade.js";

/**
 * Gestionnaire de capital, frais de trading ET frais d’emprunt horaires (Margin Isolated)
 * Adapté à ton setup : 100 € + VIP 0 + BNB (frais trading 0,075 % + intérêt USDT horaire)
 */
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
   * Historique complet des trades (clé = id)
   */
  trades = {};

  /**
   * Ratio Risk/Reward choisi (ex: RR[3])
   */
  rr;

  constructor(baseCapital, rr) {
    this.baseCapital = baseCapital;
    this.currencyCapital = baseCapital;
    this.quoteCapital = 0;
    this.rr = rr;
  }

  /**
   * Peut-on ouvrir un nouveau trade ?
   */
  canStartTrade() {
    return this.currencyCapital > 0;
  }

  /**
   * Capital disponible immédiatement
   */
  availableCapital() {
    return this.currencyCapital;
  }

  // ====================== MÉTHODES PRIVÉES DE CALCUL ======================

  /**
   * Retourne uniquement le montant des frais de trading
   */
  #calculateTradingFee(amount) {
    return amount * this.binanceTradingFeeRate;
  }

  /**
   * Retourne uniquement le coût des intérêts d’emprunt
   * (appliqué sur la valeur de la position après trade)
   */
  #calculateBorrowInterest(grossAmount, hours) {
    return grossAmount * this.binanceHourlyBorrowRate * hours;
  }

  // ====================== ASSIGNATION DES TRADES ======================

  /**
   * Enregistre l’ouverture d’un trade (achat + frais d’entrée)
   */
  assignTradeStart(trade) {
    const entryFee = this.#calculateTradingFee(trade.capitalToBuy);
    const quoteAfterFees = trade.capitalToBuy - entryFee;

    // On retire tout le capital investi du wallet
    this.currencyCapital -= trade.capitalToBuy;
    // On ajoute le montant net reçu en position
    this.quoteCapital += quoteAfterFees;

    this.trades[trade.id] = {
      ...trade,
      quoteCapital: quoteAfterFees,
      fees: [entryFee], // frais d’entrée
    };
  }

  /**
   * Enregistre la fermeture d’un trade (vente + frais de sortie + intérêts)
   */
  assignTradeResult(closedTrade) {
    const openTrade = this.trades[closedTrade.id];
    if (!openTrade) return;

    const { quoteCapital: borrowedNet, fees: existingFees } = openTrade;

    // === 1. Calcul du % de variation (logique originale conservée) ===
    const priceChangePercent =
      closedTrade.takeProfit > 0
        ? closedTrade.priceChangePercent
        : 2 - closedTrade.priceChangePercent;

    // === 2. Valeur brute après mouvement de prix ===
    const grossValueAfterPriceMove = borrowedNet * priceChangePercent;

    // === 3. Durée du trade en heures ===
    const tradeDurationHours =
      (closedTrade.endTick - closedTrade.startTick) / 1000 / 60 / 60;

    // === 4. Frais de sortie + intérêts d’emprunt ===
    const exitTradingFee = this.#calculateTradingFee(grossValueAfterPriceMove);
    const borrowInterest = this.#calculateBorrowInterest(
      grossValueAfterPriceMove,
      tradeDurationHours,
    );

    // === 5. Capital net qui revient dans le wallet ===
    const finalNetCapital =
      grossValueAfterPriceMove - exitTradingFee - borrowInterest;

    // Mise à jour du capital global
    this.currencyCapital += finalNetCapital;
    this.quoteCapital -= borrowedNet;

    // === 6. Mise à jour complète du trade dans l’historique ===
    const allFees = [...existingFees, exitTradingFee, borrowInterest];
    const totalFees = allFees.reduce((sum, fee) => sum + fee, 0);

    this.trades[closedTrade.id] = {
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

    console.log(this.trades[closedTrade.id]);
  }

  // ====================== STATS & GÉNÉRATION ======================

  /**
   * Statistiques de performance (winrate + winrate requis théorique)
   */
  getWinrate() {
    const allTrades = Object.values(this.trades);
    const winners = allTrades.filter(
      (t) => t.tradeResult === "takeProfit",
    ).length;
    const totalClosed = allTrades.filter((t) => t.triggered === true).length;

    return {
      winners,
      total: totalClosed,
      losers: totalClosed - winners,
      winrate: totalClosed > 0 ? winners / totalClosed : 0,
      winratePercent:
        totalClosed > 0
          ? `${((winners / totalClosed) * 100).toFixed(1)}%`
          : "0%",
      requiredWinrate: `${(this.rr.winrate * 100).toFixed(1)}%`,
    };
  }

  /**
   * Génère un nouvel objet Trade avec SL/TP calculés selon le RR
   */
  generateTrade(startTick, startPrice, rroptions) {
    let takeProfit = 0;
    let stopLoss = 0;
    let lot = rroptions.lot ?? 0.5;

    if (rroptions.takeProfit != null) {
      // Long
      takeProfit = rroptions.takeProfit;
      stopLoss = -(rroptions.takeProfit / this.rr.rr);
    } else if (rroptions.stopLoss != null) {
      // Short
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

  /**
   * Récupère l’état complet pour le backtest/export
   */
  retrieve() {
    return {
      baseCapital: this.baseCapital,
      currencyCapital: this.currencyCapital,
      quoteCapital: this.quoteCapital,
      totalTrades: Object.keys(this.trades).length,
      winrate: this.getWinrate(),
    };
  }
}

/**
 * Ratios Risk/Reward prêts à l’emploi
 */
export const RR = {
  0.33: { winrate: 0.75, rr: 0.33 },
  0.5: { winrate: 0.67, rr: 0.5 },
  1: { winrate: 0.5, rr: 1 },
  2: { winrate: 0.33, rr: 2 },
  3: { winrate: 0.25, rr: 3 },
  4: { winrate: 0.2, rr: 4 },
};
