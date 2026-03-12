import Trade from "./trade.js";

/**
 * Gestionnaire de capital, frais et statistiques de trades
 * Adapté à ton setup : 100 € de capital + VIP 0 + paiement en BNB
 */
export default class MoneyManager {
  /**
   * Capital disponible en devise de base (USDT / €)
   */
  currencyCapital = 0;

  /**
   * Capital de départ (pour stats)
   */
  baseCapital = 0;

  /**
   * Frais Binance (round-trip)
   * → 0.075 % avec BNB activé (VIP 0) comme dans tes trades
   */
  binanceFees = 0.00075;

  /** Binance Location per Hours fees
   * → 0.0000035788 % avec BNB activé (VIP 0) comme dans tes trades
   */
  binanceLocationPerHoursFees = 0.0000035788;
  /**
   * Historique des trades (clé = id)
   */
  trades = {};

  /**
   * Ratio Risk/Reward choisi (ex: RR[3])
   */
  rr;

  constructor(baseCapital, rr) {
    this.baseCapital = baseCapital;
    this.currencyCapital = baseCapital;
    this.rr = rr;
  }

  /**
   * Peut-on ouvrir un nouveau trade ?
   */
  canStartTrade() {
    return this.currencyCapital > 0;
  }

  /**
   * Capital disponible pour un nouveau trade
   */
  availableCapital() {
    return this.currencyCapital;
  }

  /**
   * Applique les frais Binance (factorisé)
   */
  #applyFees(amount) {
    return amount - amount * (1 - this.binanceFees);
  }

  #applyLocationPerHoursFees(amount, hours) {
    return amount - amount * (1 - this.binanceLocationPerHoursFees * hours);
  }

  /**
   * Statistiques de performance
   * (winrate sécurisé, pas de NaN si aucun trade)
   */
  getWinrate() {
    const tradeResults = Object.values(this.trades);
    const winners = tradeResults.filter(
      (t) => t.tradeResult === "takeProfit",
    ).length;
    const total = tradeResults.filter((t) => t.triggered === true).length;

    return {
      winners,
      total,
      losers: total - winners,
      winrate: total > 0 ? winners / total : 0,
      winratePercent:
        total > 0 ? `${((winners / total) * 100).toFixed(1)}%` : "0%",
      requiredWinrate: `${this.rr.winrate * 100}.0%`,
    };
  }

  /**
   * Enregistre le départ d’un trade (achat + frais)
   */
  assignTradeStart(tradeResult) {
    const startingFees = this.#applyFees(tradeResult.capitalToBuy);
    const quoteAfterFees = tradeResult.capitalToBuy - startingFees;
    this.currencyCapital -= tradeResult.capitalToBuy;

    this.trades[tradeResult.id] = {
      tradeResult,
      quoteCapital: quoteAfterFees,
      fees: [startingFees],
    };
  }

  /**
   * Enregistre le résultat d’un trade fermé (vente + frais)
   * Logique originale conservée (y compris le calcul pour les shorts/loss)
   */
  assignTradeResult(finalTradeResult) {
    const { quoteCapital, tradeResult, fees } =
      this.trades[finalTradeResult.id];
    // Calcul du % de variation (hack original pour les pertes/shorts)
    const priceChangePercent =
      finalTradeResult.takeProfit > 0
        ? finalTradeResult.priceChangePercent
        : 2 - finalTradeResult.priceChangePercent;

    const tradeTimeHours =
      (finalTradeResult.endTick - finalTradeResult.startTick) / 1000 / 60 / 60;

    const baseAfterTrade = quoteCapital * priceChangePercent;
    const feesAfterTrade = this.#applyFees(baseAfterTrade);
    const locationFeesAfterTrade = this.#applyLocationPerHoursFees(
      baseAfterTrade,
      tradeTimeHours,
    );

    this.currencyCapital +=
      baseAfterTrade - locationFeesAfterTrade - feesAfterTrade;

    fees.push(feesAfterTrade);
    fees.push(locationFeesAfterTrade);

    // Mise à jour complète du trade
    this.trades[tradeResult.id] = {
      tradeResult: finalTradeResult,
      fees,
      quoteCapital,
      priceChangePercent,
      baseCapitalAfterTrade: baseAfterTrade,
      baseCapitalAfterTradeFees:
        baseAfterTrade - feesAfterTrade - locationFeesAfterTrade,
    };
    console.log(this.trades[tradeResult.id]);
  }

  /**
   * Génère un nouvel objet Trade avec SL/TP selon le RR
   */
  generateTrade(startTick, startPrice, rroptions) {
    let takeProfit = 0;
    let stopLoss = 0;
    let lot = rroptions.lot ?? 0.5;

    if (rroptions.takeProfit != null) {
      // Trade Long
      takeProfit = rroptions.takeProfit;
      stopLoss = -(rroptions.takeProfit / this.rr.rr);
    } else if (rroptions.stopLoss != null) {
      // Trade Short
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
   * Récupère l’état pour le backtest / export
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
 * Utilisation : RR[3] → { winrate: 0.25, rr: 3 }
 */
export const RR = {
  0.33: { winrate: 0.75, rr: 0.33 },
  0.5: { winrate: 0.67, rr: 0.5 },
  1: { winrate: 0.5, rr: 1 },
  2: { winrate: 0.33, rr: 2 },
  3: { winrate: 0.25, rr: 3 },
  4: { winrate: 0.2, rr: 4 },
};
