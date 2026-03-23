import ServerSocket from "../socket.js";
import BinanceImporter from "./importer/importer.js";

BinanceImporter.onImport(({ actual, total }) => {
  ServerSocket.send(
    {
      actual,
      total,
    },
    "binance-importer",
    "importers",
  );
});
