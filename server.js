import dotenv from "dotenv";
import express from "express";
import { WebSocketServer } from "ws";
import { BinanceDataSetting, BinanceDataSettingsIntervals } from "./modules/binance/downloader.js";
import CryptoBacktester from "./modules/binance/index.js";
import Analyser from "./modules/binance/analyser.js";
import { importers } from "./modules/api.js";
const __dirname = import.meta.dirname;

const app = express();
const port = 3000;

dotenv.config();

app.use(express.static("public"));
app.use(express.json());
importers(app);



// const rewindsDays = 3;
// const startingTicks = 60 * 24 * rewindsDays - 3;

// const dataSettings = [
//   new BinanceDataSetting(
//     "btcusdc",
//     rewindsDays,
//     BinanceDataSettingsIntervals.all,
//   ),
// ];
// const backtester = new CryptoBacktester(dataSettings);

// backtester.on("ready", (entries) => {
//   console.log("Backtester ready");
// });
// app.get("/api/:symbol/:interval/:timestamp", (req, res) => {
//   const { symbol, interval, timestamp } = req.params;

//   backtester.data((entries) => {
//     if (
//       entries[symbol] == null ||
//       entries[symbol][interval] == null ||
//       entries[symbol][interval][timestamp] == null
//     ) {
//       res.status(404).json({ error: "Not found" });
//       return;
//     }

//     res.json(entries[symbol][interval][timestamp]);
//   });
// });

// app.get("/api/:symbol/:interval", (req, res) => {
//   const { symbol, interval } = req.params;

//   backtester.data((entries) => {
//     if (entries[symbol] == null || entries[symbol][interval] == null) {
//       res.status(404).json({ error: "Not found" });
//       return;
//     }

//     res.json(entries[symbol][interval]);
//   });
// });

// app.get("/api/intervals", (req, res) => {
//   res.json(
//     BinanceDataSettingsIntervals.all.map((interval) => {
//       return {
//         interval,
//         count: BinanceDataSettingsIntervals.getKlineIntervalCount(interval),
//       };
//     }),
//   );
// });

// app.get("/strategy/", (req, res) => {
//   res.sendFile(__dirname + "/public/html/strategy.html");
// });

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/html/index.html");
});

app.get("/importers", (req, res) => {
  res.sendFile(__dirname + "/public/html/importers.html");
});

const wss = new WebSocketServer({ port: 3001 });

function onMessage(message, cb) {
  let page = null;
  let type = null;
  let data = null;
  try {
    message = JSON.parse(message);
    page = message.page;
    type = message.type;
    data = message.data;
  } catch (e) {
    console.log(e);
    return;
  }

  if (typeof cb === "function") {
    cb(page, type, data);
  }
}

// const strategies = {};
// const sockets = {};

// function onStart({ id }, ws) {
//   sockets[id] = ws;

//   backtester.data((entries) => {
//     const options = {
//       chain: "btcusdc",
//       interval: "1m",
//       startingTick: startingTicks,
//       initialTicks: 20,
//     };
//     const strategy = new Analyser(entries, options);
//     for (let i = 0; i < options.initialTicks; i++) {
//       strategy.tick();
//     }

//     strategy.onEnd(() => {
//       ws.send(JSON.stringify({ type: "end", data: strategy.retrieve() }));
//     });

//     strategies[id] = {
//       id,
//       options,
//       strategy,
//     };

//     ws.send(JSON.stringify({ type: "start", data: strategy.retrieve() }));
//   });
// }

// function onTick({ id, tick }, ws) {
//   tick = tick || 1;
//   for (let i = 0; i < tick; i++) {
//     strategies[id].strategy.tick();
//   }

//   ws.send(
//     JSON.stringify({ type: "tick", data: strategies[id].strategy.retrieve() }),
//   );
// }

let websocket = null;

wss.on("connection", (ws) => {
  websocket = ws;
  ws.on("message", (message) => {
    onMessage(message, (page, type, data) => {
      routeMessage(page, type, data);
      // switch (type) {
      //   case "start":
      //     onStart(data, ws);
      //     break;
      //   case "tick":
      //     onTick(data, ws);
      //     break;
      //   default:
      //     break;
      // }
    });
  });
});

function routeMessage(page, type, data) {
  switch (page) {
    case "home":
      routeHomeMessage(type, data);
      break;
  }
}

function routeHomeMessage(type, data) {
  switch (type) {
    case "connect":
      sendConnect();
      break;
    default:
      break;
  }
}

function sendConnect() {
  websocket.send(
    JSON.stringify({
      page: "home",
      type: "connect",
      data: {},
    }),
  );
}

app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});
