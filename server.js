import dotenv from "dotenv";
import express from "express";
import BinanceDataDownloader, {
  BinanceDataSetting,
  BinanceDataSettingsIntervals,
} from "./modules/binance/downloader.js";
const app = express();
const port = 3000;

dotenv.config();

app.use(express.static("public"));

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

const dataSettings = new BinanceDataSetting(
  "btcusdc",
  10,
  BinanceDataSettingsIntervals.all
);

const dataDownloader = new BinanceDataDownloader(
  process.env.BINANCE_VISION_URL,
  [dataSettings]
)

dataDownloader.onReady(async (datas) => {
  console.log("ready");
});

dataDownloader.onLoading(({actual, total},data) => {
  console.log(`loading : ${actual}/${total}, file : ${data}`);
});