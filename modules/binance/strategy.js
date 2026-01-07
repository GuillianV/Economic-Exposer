import Trade, { TradeFlatOptions } from "./trade.js";

export default class Strategy {
  datas = {};

  constructor(entries) {
    this.entries = entries;
    this.targetEntries = entries["btcusdc"]["1m"];

    const entriesTest = Object.entries(this.targetEntries);

    //On prends les 20 derniers klines
    this.actualTick = parseInt(entriesTest[entriesTest.length - 20][0]);

    this.trades = [];
    this.hasTrade = false;
    this.tickCounter = 0;
  }

  tick() {
    const nextTick = this.actualTick;

    const kline = this.targetEntries[nextTick];
    if (kline == null) {
      console.log("No kline for tick", nextTick);
      return;
    }

    this.trades.forEach((trade) => {
      const result = trade.update( kline);
   
      if (result != null) {
        console.log(result);
      }
    });

    if (!this.hasTrade && this.tickCounter == 0) {
      this.hasTrade = true;
      this.trades.push(new Trade(new TradeFlatOptions(kline.open,  50,  -50)));
    }

    this.tickCounter++;
    this.actualTick = nextTick + 60000;
  }
}
