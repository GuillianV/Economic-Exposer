import dotenv from "dotenv";
import express from "express";
import { BinanceDataSetting, BinanceDataSettingsIntervals } from "./modules/binance/downloader.js";
import CryptoBacktester from "./modules/binance/index.js";
import util from "util";
import Strategy from "./modules/binance/strategy.js";

const app = express();
const port = 3000;

dotenv.config();

app.use(express.static("public"));

const dataSettings = [new BinanceDataSetting("btcusdc", 730, BinanceDataSettingsIntervals.all)];
const backtester = new CryptoBacktester(dataSettings);

backtester.data((entries) => {
  const strategy = new Strategy(entries);

  for (let i = 0; i < 10; i++) {

  strategy.tick();
  }
});

app.get("/api/:symbol/:interval/:timestamp", (req, res) => {
  const { symbol, interval, timestamp } = req.params;

  backtester.data((entries) => {
    if (entries[symbol] == null || entries[symbol][interval] == null || entries[symbol][interval][timestamp] == null) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.json(entries[symbol][interval][timestamp]);
  });
});

app.get("/api/:symbol/:interval", (req, res) => {
  const { symbol, interval } = req.params;

  backtester.data((entries) => {
    if (entries[symbol] == null || entries[symbol][interval] == null) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.json(entries[symbol][interval]);
  });
});

app.get("/api/intervals", (req, res) => {
  res.json(
    BinanceDataSettingsIntervals.all.map((interval) => {
      return {
        interval,
        count: BinanceDataSettingsIntervals.getKlineIntervalCount(interval),
      };
    })
  );
});

app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});
