class Klines {
  constructor(ui) {
    this.ui = ui;
    this.timeline = {};

    this.options = {
      candlesOffset: {
        value: 0,
        min: 0,
        step: 1,
      },
      candlesnumber: {
        value: 60,
        min: 1,
        step: 1,
      },
      heightOffset: {
        value: 0,
        min: 0,
        max: 1000,
        step: 10,
      },
    };

    this.klines = {};
    this.klinesEntries = [];
    this.datas = {};
    this.trades = [];
    this.indicators = {
      _drawTrades: false,
      _drawHigsLows: false,
      _drawSupportsResistances: false,
    };
  }

  getIndicators() {
    return this.indicators;
  }

  enableDrawingIndicators(indicators) {
    this.indicators = indicators;
    this._draw();
  }

  onOptionChange({ candlesOffsetValue, candlesnumberValue, heightOffsetValue }) {
    const candlesOffsetOptions = this.options.candlesOffset;
    candlesOffsetOptions.value = Math.max(candlesOffsetOptions.min, Math.min(candlesOffsetOptions.value + candlesOffsetValue * candlesOffsetOptions.step, this.klinesEntries.length - 1));

    const candlesnumberOptions = this.options.candlesnumber;
    candlesnumberOptions.value = Math.max(candlesnumberOptions.min, Math.min(candlesnumberOptions.value + candlesnumberValue * candlesnumberOptions.step, this.klinesEntries.length - candlesOffsetOptions.value));

    const heightOffsetOptions = this.options.heightOffset;
    heightOffsetOptions.value = Math.max(heightOffsetOptions.min, Math.min(heightOffsetOptions.value + heightOffsetValue * heightOffsetOptions.step, heightOffsetOptions.max));

    this._draw();
  }

  onUpdate(klines, datas, trades) {
    this.klines = klines;
    this.klinesEntries = Object.entries(klines);
    this.datas = datas;
    this.trades = trades;
    this._draw();
  }

  _draw() {
    this.ui.clearCanvas();
    const klines_entries = this.klinesEntries.slice(this.options.candlesOffset.value, this.options.candlesOffset.value + this.options.candlesnumber.value);
    const klines_entries_length = klines_entries.length;
    const klines_lowest_price = Math.min(...klines_entries.map(([time, kline]) => parseFloat(kline.low))) - this.options.heightOffset.value;
    this.klines_lowest_price = klines_lowest_price;
    const klines_highest_price = Math.max(...klines_entries.map(([time, kline]) => parseFloat(kline.high))) + this.options.heightOffset.value;

    const clamped_highest_price = klines_highest_price - klines_lowest_price;
    this.clamped_highest_price = clamped_highest_price;
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
      this.ui.drawRect(positions.meche.x1, positions.meche.y1, positions.meche.x2, positions.meche.y2, ctxColor);
    });

    if (this.indicators._drawTrades) {
      this._drawTrades();
    }
    if (this.indicators._drawHigsLows) {
      this._drawHigsLows();
    }
    if (this.indicators._drawSupportsResistances) {
      this._drawSupportsResistances();
    }
  }

  _drawTrades() {
    const timelineKeys = Object.keys(this.timeline);

    this.trades.forEach((trade) => {
      const end = this.timeline[trade.endTick];
      const start = this.timeline[trade.startTick];

      if (start == null && end == null && (trade.endTick < timelineKeys[0] || trade.startTick > timelineKeys[timelineKeys.length - 1])) {
        return;
      }

      let x = 0;
      if (start != null) {
        x = start.x;
      }

      let width = x + this.ui.width;
      if (end != null) {
        width = end.x + end.width - x;
      }

      const startPrice = trade.startPrice;
      const tpPrice = startPrice + trade.takeProfit;
      const slPrice = startPrice + trade.stopLoss;

      const spClamped = startPrice - this.klines_lowest_price;
      const tpClamped = tpPrice - this.klines_lowest_price;
      const slClamped = slPrice - this.klines_lowest_price;

      const tpDiffClamped = tpClamped - spClamped;
      const slDiffClamped = spClamped - slClamped;

      const tpY = this.ui.height - (tpClamped / this.clamped_highest_price) * this.ui.height;
      const tpHeight = (tpDiffClamped / this.clamped_highest_price) * this.ui.height;
      const slY = this.ui.height - (spClamped / this.clamped_highest_price) * this.ui.height;
      const slHeight = (slDiffClamped / this.clamped_highest_price) * this.ui.height;

      this.ui.drawRect(x, tpY, width, tpHeight, "#00ff0044");
      this.ui.drawRect(x, slY, width, slHeight, "#ff000044");
    });
  }

  _drawHigsLows() {
    const supports = this.datas.localLows;
    const supportsKeys = Object.keys(supports);

    supportsKeys.forEach((time) => {
      const support = supports[time];
      const candle = this.timeline[time];

      if (candle == null) {
        return;
      }

      const x = candle.x;
      const y = this.ui.height - ((support.value - this.klines_lowest_price) / this.clamped_highest_price) * this.ui.height;

      this.ui.drawRect(x, y, this.ui.width, 1, "green");
    });

    const resistances = this.datas.localHighs;
    const resistancesKeys = Object.keys(resistances);

    resistancesKeys.forEach((time) => {
      const support = resistances[time];
      const candle = this.timeline[time];

      if (candle == null) {
        return;
      }

      const x = candle.x;
      const y = this.ui.height - ((support.value - this.klines_lowest_price) / this.clamped_highest_price) * this.ui.height;

      this.ui.drawRect(x, y, this.ui.width, 1, "red");
    });
  }

  _drawSupportsResistances() {
    const supports = this.datas.supports;
    supports.forEach((support) => {
      const x = 0;
      const y = this.ui.height - ((support - this.klines_lowest_price) / this.clamped_highest_price) * this.ui.height;
      this.ui.drawRect(x, y, this.ui.width, 1, "green");
    });

    const resistances = this.datas.resistances;
    resistances.forEach((resistance) => {
      const x = 0;
      const y = this.ui.height - ((resistance - this.klines_lowest_price) / this.clamped_highest_price) * this.ui.height;
      this.ui.drawRect(x, y, this.ui.width, 1, "red");
    });
  }
}
