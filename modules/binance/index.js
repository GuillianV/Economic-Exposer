import BinanceDataDownloader, {
  BinanceDataSetting,
  BinanceDataSettingsIntervals,
} from "./downloader.js";
import { timestampParser } from "../utils.js";
import { parseKlinesSaved } from "./parsers/kline.js";
import { logger } from "../logs/index.js";
import dotenv from "dotenv";
import EventEmitter from "../event-emmiter.js";

dotenv.config();

export default class CryptoBacktester extends EventEmitter {
  constructor(dataSettings) {
    super();
    this.dataSettings = dataSettings;
    this.dataDownloader = new BinanceDataDownloader(
      process.env.BINANCE_VISION_URL,
      this.dataSettings
    );
    this.ready = false;
    this.dataDownloader.onLoading(({ actual, total }, filename) => {
      if (actual === total) {
        this.initialize();
      }
    });

    this.on("ready", (entries) => {
      this.ready = true;
    });
  }

  async initialize() {
    const today = Date.now();
    const dataset = {};
    for (const dataSetting of this.dataSettings) {
      dataset[dataSetting.symbol] = {};

      for (const intervalChoosed of BinanceDataSettingsIntervals.all) {
        dataset[dataSetting.symbol][intervalChoosed] = {};

        const klinesCount =
          BinanceDataSettingsIntervals.getKlineIntervalCount(intervalChoosed) *
          dataSetting.backward_days;
        const awaitingDatas = [];

        for (
          let interval = 1;
          interval <= dataSetting.backward_days;
          interval++
        ) {
          const { utc } = timestampParser(
            today - 1000 * 60 * 60 * 24 * interval
          );
          awaitingDatas.push(
            this.dataDownloader.retrieveData(
              dataSetting.symbol,
              intervalChoosed,
              utc["yyyy-MM-dd"]
            )
          );
        }

        await Promise.all(awaitingDatas)
          .then((values) => {
            dataset[dataSetting.symbol][intervalChoosed] =
              parseKlinesSaved(values);
          })
          .catch((err) => {
            logger.error(`Error retrieving data ${err}`);
          });

        const entries = Object.entries(
          dataset[dataSetting.symbol][intervalChoosed]
        );
        if (entries.length !== klinesCount) {
          logger.error(
            `Dataset length is not equal to klinesCount ${entries.length} !== ${klinesCount} , intervalChoosed : ${intervalChoosed}`
          );
          return;
        }
      }
    }

    this.dataset = dataset;
    this.trigger("ready", [this.dataset]);
  }

  async data(callback = () => {}) {
    if (this.ready) {
      callback(this.dataset);
      return;
    }

    this.on("ready", (entries) => {
      callback(entries);
      this.ready = true;
    });
  }
}
