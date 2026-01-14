class Klines {
  constructor(ui, selectedKlinesOptions) {
    this.ui = ui;
    this.timeline = {};
    this.candlesOffset = 0;
    this.candlesnumber = 1;
    this.heightOffset = 0;
    this.klines = {};
    this.klinesEntries = [];
    this.onOptionChange(selectedKlinesOptions);
  }

  onOptionChange(selectedKlinesOptions) {
    this.candlesOffset = Math.max(0, selectedKlinesOptions.candlesOffset);
    this.candlesnumber = Math.max(1, selectedKlinesOptions.candlesnumber);
    this.heightOffset = Math.max(0, selectedKlinesOptions.heightOffset);
    this._draw();
  }

  onUpdate(klines) {
    this.klines = klines;
    this.klinesEntries = Object.entries(klines);
    this._draw();
  }

  _draw() {
    this.ui.clearCanvas();
    const klines_entries = this.klinesEntries.slice(this.candlesOffset, this.candlesOffset + this.candlesnumber);
    const klines_entries_length = klines_entries.length;
    const klines_lowest_price = Math.min(...klines_entries.map(([time, kline]) => parseFloat(kline.low))) - this.heightOffset;
    const klines_highest_price = Math.max(...klines_entries.map(([time, kline]) => parseFloat(kline.high))) + this.heightOffset;

    const clamped_highest_price = klines_highest_price - klines_lowest_price;
    const candle_width = this.ui.width / klines_entries_length;

    this.timeline = {};
    klines_entries.forEach(([time, kline], index) => {
      const klineClamped = {
        open: kline.open - klines_lowest_price,
        close: kline.close - klines_lowest_price,
        high: kline.high - klines_lowest_price,
        low: kline.low - klines_lowest_price,
      };

      const klineDeltas = {
        bougie: klineClamped.open - klineClamped.close,
        meche: klineClamped.high - klineClamped.low,
      };

      const positions = {
        bougie: {
          x1: candle_width * index,
          y1: this.ui.height - (klineClamped.open / clamped_highest_price) * this.ui.height,
          x2: candle_width,
          y2: (klineDeltas.bougie / clamped_highest_price) * this.ui.height,
        },
        meche: {
          x1: candle_width * index + candle_width / 2,
          y1: this.ui.height - (klineClamped.high / clamped_highest_price) * this.ui.height,
          x2: 1,
          y2: (klineDeltas.meche / clamped_highest_price) * this.ui.height,
        },
      };

      let ctxColor = "black";
      if (positions.bougie.y2 < 1 && positions.bougie.y2 > -1) {
        ctxColor = "orange";
        positions.bougie.y2 = 1;
      } else {
        ctxColor = klineDeltas.bougie > 0 ? "red" : "green";
      }

      this.timeline[kline.time] = {
        x: candle_width * index,
        width: candle_width,
        ...kline,
        timeline: kline.time,
      };

      this.ui.drawRect(positions.bougie.x1, positions.bougie.y1, positions.bougie.x2, positions.bougie.y2, ctxColor);
    });
  }
}
