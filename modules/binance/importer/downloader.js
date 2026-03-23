import fs from "fs";
import { logger } from "../../logs/index.js";
import { timestampParser } from "../../utils.js";
import { parse } from "csv-parse";
import extract from "extract-zip";
import https from "https";
import path from "path";
import EventEmitter from "../../event-emmiter.js";
import { parseKlines } from "../parsers/kline.js";

export default class BinanceDataDownloader extends EventEmitter {
  #binanceVisionUrl;
  #binanceDatasSettings;
  #timestamp_now;
  #loading;

  constructor(binanceVisionUrl) {
    super();

    if (!binanceVisionUrl) {
      logger.error("Binance Vision URL is not defined");
      process.exit(1);
    }

    this.#binanceVisionUrl = binanceVisionUrl;

    this.#timestamp_now = Date.now();

    return this;
  }

  async set(binanceDatasSettings = [new BinanceDataSetting("btcusdc", 5, BinanceDataSettingsIntervals.all)]) {
    if (!binanceDatasSettings || binanceDatasSettings.length === 0) {
      logger.error("Binance Datas Settings is not defined");
      process.exit(1);
    }

    this.#binanceDatasSettings = binanceDatasSettings;

    this.#loading = {
      actual: 0,
      total: this.#binanceDatasSettings.map((item) => item.klinesIntervals.length * item.backward_days).reduce((a, b) => a + b, 0),
    };

    this._init();
  }

  async _init() {
    for (const binanceDatasSetting of this.#binanceDatasSettings) {
      const symbolDataFolderPath = `data/${binanceDatasSetting.symbol}`;
      const symbolKlineFolderPath = `${symbolDataFolderPath}/kline`;

      this.symbolPaths = {
        data: symbolDataFolderPath,
        kline: symbolKlineFolderPath,
      };

      await this._getKiles(binanceDatasSetting);
    }
  }

  onLoading(callback = () => {}) {
    this.on("loading", async (filename) => {
      if (typeof callback !== "function") {
        throw new Error("Callback must be a function");
      }

      callback(this.#loading, filename);
    });
  }

  async retrieveData(symbol, binanceDataSettingsInterval = BinanceDataSettingsIntervals.m1, date) {
    return new Promise((resolve, reject) => {
      try {
        const klineFilePath = `${this.symbolPaths[`kline${binanceDataSettingsInterval}Json`]}/${symbol.toUpperCase()}-${binanceDataSettingsInterval}-${date}.json`;

        // if (!fs.existsSync(klineFilePath)) {
        //   logger.warn(`Kline file ${klineFilePath} does not exist`);
        //   reject(`Kline file ${klineFilePath} does not exist`);
        //   return;
        // }

        fs.readFile(klineFilePath, "utf8", (err, data) => {
          if (err) {
            logger.error(`Error reading kline file ${klineFilePath}`);
            reject(err);
            return;
          }
          resolve(JSON.parse(data));
        });
      } catch (err) {
        logger.error(`Error retrieving kline data ${err}`);
        reject(err);
      }
    });
  }

  async _getKiles(binanceDatasSetting) {
    binanceDatasSetting.klinesIntervals.forEach((interval) => {
      this.symbolPaths[`kline${interval}Zip`] = `${this.symbolPaths.kline}/${interval}/zip`;
      this.symbolPaths[`kline${interval}Csv`] = `${this.symbolPaths.kline}/${interval}/csv`;
      this.symbolPaths[`kline${interval}Json`] = `${this.symbolPaths.kline}/${interval}/json`;
    });

    Object.values(this.symbolPaths).forEach((path) => {
      if (!fs.existsSync(path)) {
        logger.info(`Creating ${path} directory`);
        fs.mkdirSync(path, { recursive: true });
      }
    });

    const datesToCheck = [];
    for (let i = 1; i <= binanceDatasSetting.backward_days; i++) {
      datesToCheck.push(timestampParser(this.#timestamp_now - 1000 * 60 * 60 * 24 * i));
    }

    for (const date of datesToCheck) {
      for (const interval of binanceDatasSetting.klinesIntervals) {
        await this._getKline(binanceDatasSetting, date, interval);
      }
    }
  }

  async _getKline(binanceDatasSetting, date, interval) {
    const zipFilename = `${binanceDatasSetting.symbol.toUpperCase()}-${interval}-${date.utc["yyyy-MM-dd"]}.zip`;
    const zipFullpath = `${this.#binanceVisionUrl}spot/daily/klines/${binanceDatasSetting.symbol.toUpperCase()}/${interval}/${zipFilename}`;

    const zipFileFullPath = `${this.symbolPaths[`kline${interval}Zip`]}/${zipFilename}`;
    const csvFileFullPath = `${this.symbolPaths[`kline${interval}Csv`]}/${zipFilename.replace(".zip", ".csv")}`;
    const jsonFileFullPath = `${this.symbolPaths[`kline${interval}Json`]}/${zipFilename.replace(".zip", ".json")}`;

    // Downloading zip file from binance vision
    if (!fs.existsSync(zipFileFullPath)) {
      logger.info(`Start Downloading ${zipFullpath} into ${zipFileFullPath}`);

      const file = fs.createWriteStream(zipFileFullPath);

      const downloading = await new Promise(async (resolve, reject) => {
        await https.get(zipFullpath, function (response) {
          response.pipe(file);

          file.on("finish", () => {
            file.close();
            resolve({ isDownload: true, error: null });
          });
          file.on("error", (err) => {
            resolve({ isDownload: false, error: err });
          });
        });
      });

      if (downloading.isDownload && downloading.error === null) {
        logger.info(`Download ${zipFileFullPath} done`);
      } else {
        logger.error(`Download ${zipFileFullPath} failed , error: ${downloading.error}`);
        throw new Error(downloading.error);
      }
    }

    const csvFilesUnpackingAbsolutePath = path.join(path.resolve("./"), this.symbolPaths[`kline${interval}Csv`]);
    if (!fs.existsSync(csvFileFullPath)) {
      logger.info(`Start Unpacking ${zipFileFullPath} into ${csvFileFullPath}`);

      try {
        await extract(zipFileFullPath, { dir: csvFilesUnpackingAbsolutePath });
        logger.info(`Unpacking ${zipFileFullPath} done`);
      } catch (err) {
        logger.error(`Unpacking ${zipFileFullPath} failed , error: ${err}`);
        throw new Error(err);
      }
    }

    if (!fs.existsSync(jsonFileFullPath)) {
      logger.info(`Start Parsing ${csvFileFullPath} into ${jsonFileFullPath}`);
      const fileStream = fs.createReadStream(csvFileFullPath);
      const parsing = await new Promise((resolve, reject) => {
        const values = [];
        fileStream
          .pipe(parse({ columns: false, skip_empty_lines: true }))
          .on("data", (row) => {
            values.push(row);
          })
          .on("end", () => {
            resolve({ isParsing: true, error: null, values });
          })
          .on("error", (err) => {
            resolve({ isParsing: false, error: err, values });
          });
      });

      if (!parsing.isParsing || parsing.error !== null) {
        logger.error(`Parsing ${csvFileFullPath} failed , error: ${parsing.error}`);
        throw new Error(parsing.error);
      }

      const finalvalues = parseKlines(parsing.values);

      fs.writeFileSync(jsonFileFullPath, JSON.stringify(finalvalues));
      logger.info(`Parsing ${jsonFileFullPath} done`);
    }

    this.#loading.actual += 1;
    this.trigger("loading", [jsonFileFullPath]);
  }
}

export class BinanceDataSetting {
  symbol;
  backward_days;
  klinesIntervals;
  constructor(symbol, backward_days, klinesIntervals = BinanceDataSettingsIntervals.all) {
    this.symbol = symbol;
    this.backward_days = backward_days;
    this.klinesIntervals = klinesIntervals;
  }
}

export class BinanceDataSettingsIntervals {
  static h12 = "12h";
  static m15 = "15m";
  static d1 = "1d";
  static h1 = "1h";
  static m1 = "1m";
  static s1 = "1s";
  static h2 = "2h";
  static m30 = "30m";
  static m3 = "3m";
  static h4 = "4h";
  static m5 = "5m";
  static h6 = "6h";
  static h8 = "8h";
  static all = [
    BinanceDataSettingsIntervals.h12,
    BinanceDataSettingsIntervals.m15,
    BinanceDataSettingsIntervals.d1,
    BinanceDataSettingsIntervals.h1,
    BinanceDataSettingsIntervals.m1,
    BinanceDataSettingsIntervals.h2,
    BinanceDataSettingsIntervals.m30,
    BinanceDataSettingsIntervals.m3,
    BinanceDataSettingsIntervals.h4,
    BinanceDataSettingsIntervals.m5,
    BinanceDataSettingsIntervals.h6,
    BinanceDataSettingsIntervals.h8,
  ];

  static getKlineList() {
    return [
      BinanceDataSettingsIntervals.s1,
      BinanceDataSettingsIntervals.m1,
      BinanceDataSettingsIntervals.m3,
      BinanceDataSettingsIntervals.m5,
      BinanceDataSettingsIntervals.m15,
      BinanceDataSettingsIntervals.m30,
      BinanceDataSettingsIntervals.h1,
      BinanceDataSettingsIntervals.h2,
      BinanceDataSettingsIntervals.h4,
      BinanceDataSettingsIntervals.h6,
      BinanceDataSettingsIntervals.h8,
      BinanceDataSettingsIntervals.h12,
      BinanceDataSettingsIntervals.d1,
    ];
  }

  static getKlineIntervalCount(interval) {
    switch (interval) {
      case BinanceDataSettingsIntervals.s1:
        return 86400;
      case BinanceDataSettingsIntervals.m1:
        return 1440;
      case BinanceDataSettingsIntervals.m3:
        return 480;
      case BinanceDataSettingsIntervals.m5:
        return 288;
      case BinanceDataSettingsIntervals.m15:
        return 96;
      case BinanceDataSettingsIntervals.m30:
        return 48;
      case BinanceDataSettingsIntervals.h1:
        return 24;
      case BinanceDataSettingsIntervals.h2:
        return 12;
      case BinanceDataSettingsIntervals.h4:
        return 6;
      case BinanceDataSettingsIntervals.h6:
        return 4;
      case BinanceDataSettingsIntervals.h8:
        return 3;
      case BinanceDataSettingsIntervals.h12:
        return 2;
      case BinanceDataSettingsIntervals.d1:
        return 1;
      default:
        throw new Error(`Interval ${interval} is not supported`);
    }
  }
}
