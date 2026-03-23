import { BinanceDataSettingsIntervals } from "./importer/downloader.js";
import binanceImporter from "./importer/importer.js";

export function binanceImportersRoutes(app) {
  app.get("/api/importers/binance/intervals", (req, res) => {
    res.json(BinanceDataSettingsIntervals.getKlineList());
  });

  app.get("/api/importers/binance/settings/", (req, res) => {
    res.json(binanceImporter.getSettings());
  });

  app.post("/api/importers/binance/settings/", (req, res) => {
    const binanceSettings = req.body;
    binanceImporter.saveImporterSettings(binanceSettings);
    res.json(binanceImporter.getSettings());
  });

  app.get("/api/importers/binance/download", async (req, res) => {
    binanceImporter.import();
    res.json(binanceImporter.getSettings());
  });
}

