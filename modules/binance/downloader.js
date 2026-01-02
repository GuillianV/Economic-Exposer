import fs from "fs";
import { logger } from "../logs/index.js";
import { timestampParser } from "../utils.js";
import { parse } from "csv-parse";
import extract from "extract-zip";
import https from "https";
import path from "path";
import EventEmitter from "../event-emmiter.js";
import { parseKlines } from "./parsers/kline.js";

export default class BinanceDataDownloader extends EventEmitter {
  #binanceVisionUrl;
  #binanceDatasSettings;
  #timestamp_now;
  #loading;

  constructor(
    binanceVisionUrl,
    binanceDatasSettings = [
      new BinanceDataSetting("btcusdc", 5, BinanceDataSettingsIntervals.all),
    ]
  ) {
    super();

    if (!binanceVisionUrl) {
      logger.error("Binance Vision URL is not defined");
      process.exit(1);
    }

    if (!binanceDatasSettings || binanceDatasSettings.length === 0) {
      logger.error("Binance Datas Settings is not defined");
      process.exit(1);
    }

    this.#binanceVisionUrl = binanceVisionUrl;
    this.#binanceDatasSettings = binanceDatasSettings;
    this.#timestamp_now = Date.now();
    this.#loading = {
      actual: 0,
      total: this.#binanceDatasSettings
        .map((item) => item.klinesIntervals.length * item.backward_days)
        .reduce((a, b) => a + b, 0),
    };
    this._init();
    return this;
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

    this.trigger("ready");
  }

  onLoading(callback) {
    this.on("loading", async (filename) => {
      if (typeof callback !== "function") {
        throw new Error("Callback must be a function");
      }
      logger.debug(
        `loading : ${this.#loading.actual}/${
          this.#loading.total
        }, file : ${filename}`
      );

      callback(this.#loading, filename);
    });
  }

  onReady(callback) {
    this.on("ready", async () => {
      if (typeof callback !== "function") {
        throw new Error("Callback must be a function");
      }

      const fulldatas = {};

      //Klines part
      const datasPromises = [];
      fulldatas.klines = {};

      for (const binanceDatasSetting of this.#binanceDatasSettings) {
        for (const interval of binanceDatasSetting.klinesIntervals) {
          fulldatas.klines[interval] = {};
          for (let i = 1; i <= binanceDatasSetting.backward_days; i++) {
            const date = timestampParser(
              this.#timestamp_now - 1000 * 60 * 60 * 24 * i
            );
            const zipFilename = `${binanceDatasSetting.symbol.toUpperCase()}-${interval}-${
              date.utc["yyyy-MM-dd"]
            }.json`;
            const zipFileFullPath = `${
              this.symbolPaths[`kline${interval}Json`]
            }/${zipFilename}`;

            datasPromises.push(
              new Promise((resolve, reject) => {
                fs.readFile(zipFileFullPath, "utf8", (err, data) => {
                  if (err) {
                    reject(err);
                  }
                  resolve({ data: JSON.parse(data), interval });
                });
              })
            );
          }
        }
      }

      await Promise.all(datasPromises).then((datas) => {
        datas.forEach(({ data, interval }, index) => {
          for (const time in data) {
            fulldatas.klines[interval][time] = data[time];
          }
        });
      });

      //End klines part

      callback(fulldatas);
      this.off("ready");
    });
  }

  async _getKiles(binanceDatasSetting) {
    binanceDatasSetting.klinesIntervals.forEach((interval) => {
      this.symbolPaths[
        `kline${interval}Zip`
      ] = `${this.symbolPaths.kline}/${interval}/zip`;
      this.symbolPaths[
        `kline${interval}Csv`
      ] = `${this.symbolPaths.kline}/${interval}/csv`;
      this.symbolPaths[
        `kline${interval}Json`
      ] = `${this.symbolPaths.kline}/${interval}/json`;
    });

    Object.values(this.symbolPaths).forEach((path) => {
      if (!fs.existsSync(path)) {
        logger.info(`Creating ${path} directory`);
        fs.mkdirSync(path, { recursive: true });
      }
    });

    const datesToCheck = [];
    for (let i = 1; i <= binanceDatasSetting.backward_days; i++) {
      datesToCheck.push(
        timestampParser(this.#timestamp_now - 1000 * 60 * 60 * 24 * i)
      );
    }

    for (const date of datesToCheck) {
      for (const interval of binanceDatasSetting.klinesIntervals) {
        await this._getKline(binanceDatasSetting, date, interval);
      }
    }
  }

  async _getKline(binanceDatasSetting, date, interval) {
    const zipFilename = `${binanceDatasSetting.symbol.toUpperCase()}-${interval}-${
      date.utc["yyyy-MM-dd"]
    }.zip`;
    const zipFullpath = `${
      this.#binanceVisionUrl
    }spot/daily/klines/${binanceDatasSetting.symbol.toUpperCase()}/${interval}/${zipFilename}`;

    const zipFileFullPath = `${
      this.symbolPaths[`kline${interval}Zip`]
    }/${zipFilename}`;
    const csvFileFullPath = `${
      this.symbolPaths[`kline${interval}Csv`]
    }/${zipFilename.replace(".zip", ".csv")}`;
    const jsonFileFullPath = `${
      this.symbolPaths[`kline${interval}Json`]
    }/${zipFilename.replace(".zip", ".json")}`;

    // Downloading zip file from binance vision
    if (!fs.existsSync(zipFileFullPath)) {
      logger.info(`Start Downloading ${zipFullpath} into ${zipFileFullPath}`);

      const file = fs.createWriteStream(zipFileFullPath);

      const downloading = await new Promise(async (resolve, reject) => {
        const request = await https.get(zipFullpath, function (response) {
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
        logger.error(
          `Download ${zipFileFullPath} failed , error: ${downloading.error}`
        );
        throw new Error(downloading.error);
      }
    }

    const csvFilesUnpackingAbsolutePath = path.join(
      path.resolve("./"),
      this.symbolPaths[`kline${interval}Csv`]
    );
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
        logger.error(
          `Parsing ${csvFileFullPath} failed , error: ${parsing.error}`
        );
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
  constructor(
    symbol,
    backward_days,
    klinesIntervals = BinanceDataSettingsIntervals.all
  ) {
    this.symbol = symbol;
    this.backward_days = backward_days;
    this.klinesIntervals = klinesIntervals;
  }
}

export class BinanceDataSettingsIntervals {
  static m12 = "12h";
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
    BinanceDataSettingsIntervals.m12,
    BinanceDataSettingsIntervals.m15,
    BinanceDataSettingsIntervals.d1,
    BinanceDataSettingsIntervals.h1,
    BinanceDataSettingsIntervals.m1,
    BinanceDataSettingsIntervals.s1,
    BinanceDataSettingsIntervals.h2,
    BinanceDataSettingsIntervals.m30,
    BinanceDataSettingsIntervals.m3,
    BinanceDataSettingsIntervals.h4,
    BinanceDataSettingsIntervals.m5,
    BinanceDataSettingsIntervals.h6,
    BinanceDataSettingsIntervals.h8,
  ];
}
