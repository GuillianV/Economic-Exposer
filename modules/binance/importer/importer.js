import dotenv from "dotenv";
import fs from "fs";
import { logger } from "../../logs/index.js";
import BinanceDataDownloader, { BinanceDataSetting, BinanceDataSettingsIntervals } from "./downloader.js";
dotenv.config();
class BinanceImporter {
  #initialized;
  #downloader;

  constructor() {
    this.BINANCE_VISION_SPOT_LIST_URL = process.env.BINANCE_VISION_SPOT_LIST_URL;
    this.BINANCE_VISION_URL = process.env.BINANCE_VISION_URL;

    this.#downloader = new BinanceDataDownloader(this.BINANCE_VISION_URL);

    this.settings_folder = `settings/importers/`;
    this.settings_file = `${this.settings_folder}binance.json`;
    if (!fs.existsSync(this.settings_folder)) {
      fs.mkdirSync(this.settings_folder, { recursive: true });
    }

    if (!fs.existsSync(this.settings_file)) {
      const defaultSettings = {
        importers: [
          {
            ticker: "btcusdc",
            rewinds: "3",
            interval: "all",
          },
        ],
        spots: [],
      };

      logger.info(`Creating ${this.settings_file} file`);
      fs.writeFileSync(this.settings_file, JSON.stringify(defaultSettings), "utf8");
    }

    const rawfile = fs.readFileSync(this.settings_file, "utf8");
    const settings = JSON.parse(rawfile);

    if (settings.spots.length === 0) {
      logger.info(`Spot list is empty, downloading from ${this.BINANCE_VISION_SPOT_LIST_URL}`);
      fetch(this.BINANCE_VISION_SPOT_LIST_URL)
        .then((res) => res.text())
        .then((data) => {
          const commonPrefixes = data
            .split("<CommonPrefixes>")
            .filter((text) => text.includes("data/spot/daily/klines/") && text.includes("</CommonPrefixes>"))
            .map((text) => {
              return text.replaceAll("<Prefix>data/spot/daily/klines/", "").replaceAll("/</Prefix></CommonPrefixes>", "").replaceAll("</listbucketresult>", "").toLowerCase();
            });
          settings.spots = commonPrefixes;
          fs.writeFileSync(this.settings_file, JSON.stringify(settings), "utf8");
        });
    }

    this.#initialized = true;
  }

  getSettings() {
    if (!this.#initialized) {
      logger.error("Importer is not initialized");
      return;
    }
    const rawSettings = fs.readFileSync(this.settings_file, "utf8");
    return JSON.parse(rawSettings);
  }
  saveImporterSettings(importers) {
    if (!this.#initialized) {
      logger.error("Importer is not initialized");
      return;
    }

    const settings = this.getSettings();
    settings.importers = importers;
    fs.writeFileSync(this.settings_file, JSON.stringify(settings), "utf8");
  }

  import() {
    const settings = this.getSettings();
    if (settings.importers.length === 0) {
      logger.error("No importers defined");
      return;
    }

    const binanceDatasSettings = [];
    for (const importer of settings.importers) {
      binanceDatasSettings.push(new BinanceDataSetting(importer.ticker, importer.rewinds, importer.interval == "all" ? BinanceDataSettingsIntervals.all : importer.interval));
    }
    this.#downloader.set(binanceDatasSettings);
  }

  onImport(callback = () => {}) {
    this.#downloader.onLoading(({ actual, total }) => {
      callback({ actual, total });
    });
  }
}

export default new BinanceImporter();
