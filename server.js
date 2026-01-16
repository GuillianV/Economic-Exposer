import dotenv from "dotenv";
import express from "express";
import { WebSocketServer } from "ws";
import { BinanceDataSetting, BinanceDataSettingsIntervals } from "./modules/binance/downloader.js";
import CryptoBacktester from "./modules/binance/index.js";
import Strategy from "./modules/binance/strategy.js";
const __dirname = import.meta.dirname;

const app = express();
const port = 3000;

dotenv.config();

app.use(express.static("public"));

const dataSettings = [new BinanceDataSetting("btcusdc", 30, BinanceDataSettingsIntervals.all)];
const backtester = new CryptoBacktester(dataSettings);

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

app.get("/strategy/", (req, res) => {
  res.sendFile(__dirname + "/public/html/index.html");
});

const wss = new WebSocketServer({ port: 3001 });

function onMessage(message, cb) {
  let type = null;
  let data = null;
  try {
    message = JSON.parse(message);
    type = message.message;
    data = message;
    delete data.message;
  } catch (e) {
    console.log(e);
    return;
  }

  if (typeof cb === "function") {
    cb(type, data);
  }
}

const strategies = {};
const sockets = {};

function onStart({ id }, ws) {
  sockets[id] = ws;

  backtester.data((entries) => {
    const options = {
      chain: "btcusdc",
      interval: "1m",
      startingTick: 60 * 24,
      initialTicks: 60, 
    };
    const strategy = new Strategy(entries, options);
    for (let i = 0; i < options.initialTicks; i++) {
      strategy.tick();
    }

    strategy.onEnd(() => {
      ws.send(JSON.stringify({ type: "end", data: strategy.retrieve() }));
    });

    strategies[id] = {
      id,
      options,
      strategy,
    };

    ws.send(JSON.stringify({ type: "start", data: strategy.retrieve() }));
  });
}

function onTick({ id, tick }, ws) {
  tick = tick || 1;
  for (let i = 0; i < tick; i++) {
    strategies[id].strategy.tick();
  }

  ws.send(JSON.stringify({ type: "tick", data: strategies[id].strategy.retrieve() }));
}

wss.on("connection", (ws) => {
  ws.on("message", (message) => {
    onMessage(message, (type, data) => {
      switch (type) {
        case "start":
          onStart(data, ws);
          break;
        case "tick":
          onTick(data, ws);
          break;
        default:
          break;
      }
    });
  });
});
app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});
