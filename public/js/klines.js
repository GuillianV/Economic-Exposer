class Klines {
  constructor(ui) {
    this.ui = ui;
    this.timeline = {};

    this.options = {
      candlesOffset: {
        value: 0,
        min: 0,
        step: 20,
      },
      candlesnumber: {
        value: 60,
        min: 1,
        step: 20,
      },
      heightOffset: {
        value: 0,
        min: 0,
        max: 1000,
        step: 20,
      },
    };

    this.klines = {};
    this.klinesEntries = [];
    this.datas = {};
    this.trades = {};
    this.indicators = {
      _drawHigsLows: false,
      _drawSupportsResistances: false,
      _drawVolumes: false,
      _drawTrendlines: false,
    };
  }

  getIndicators() {
    return this.indicators;
  }

  enableDrawingIndicators(indicators) {
    this.indicators = indicators;
    this._draw();
  }

  enableDrawingTrades(strategyName, enabled) {
    this.trades[strategyName].draw = enabled;
    this._draw();
  }

  onOptionChange({
    candlesOffsetValue,
    candlesnumberValue,
    heightOffsetValue,
  }) {
    const candlesOffsetOptions = this.options.candlesOffset;
    candlesOffsetOptions.value = Math.max(
      candlesOffsetOptions.min,
      Math.min(
        candlesOffsetOptions.value +
          candlesOffsetValue * candlesOffsetOptions.step,
        this.klinesEntries.length - 1,
      ),
    );

    const candlesnumberOptions = this.options.candlesnumber;
    candlesnumberOptions.value = Math.max(
      candlesnumberOptions.min,
      Math.min(
        candlesnumberOptions.value +
          candlesnumberValue * candlesnumberOptions.step,
        this.klinesEntries.length - candlesOffsetOptions.value,
      ),
    );

    const heightOffsetOptions = this.options.heightOffset;
    heightOffsetOptions.value = Math.max(
      heightOffsetOptions.min,
      Math.min(
        heightOffsetOptions.value +
          heightOffsetValue * heightOffsetOptions.step,
        heightOffsetOptions.max,
      ),
    );

    this._draw();
  }

  onUpdate(klines, datas) {
    this.klines = klines;
    this.klinesEntries = Object.entries(klines);
    this.datas = datas;
    this._draw();
  }

  onTrades(strategies) {
    for (const strategy of strategies) {
      const { name, trades } = strategy;

      if (this.trades[name] == null) {
        this.trades[name] = {
          draw: false,
        };
      }

      this.trades[name] = {
        draw: this.trades[name].draw,
        trades,
      };
    }
  }

  _draw() {
    this.ui.clearCanvas();
    const klines_entries = this.klinesEntries.slice(
      this.options.candlesOffset.value,
      this.options.candlesOffset.value + this.options.candlesnumber.value,
    );
    const klines_entries_length = klines_entries.length;
    const klines_lowest_price =
      Math.min(
        ...klines_entries.map(([time, kline]) => parseFloat(kline.low)),
      ) - this.options.heightOffset.value;
    this.klines_lowest_price = klines_lowest_price;
    const klines_highest_price =
      Math.max(
        ...klines_entries.map(([time, kline]) => parseFloat(kline.high)),
      ) + this.options.heightOffset.value;

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
          y1:
            this.ui.height -
            (klineClamped.open / clamped_highest_price) * this.ui.height,
          x2: candle_width,
          y2: (klineDeltas.bougie / clamped_highest_price) * this.ui.height,
        },
        meche: {
          x1: candle_width * index + candle_width / 2,
          y1:
            this.ui.height -
            (klineClamped.high / clamped_highest_price) * this.ui.height,
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

      this.ui.drawRect(
        positions.bougie.x1,
        positions.bougie.y1,
        positions.bougie.x2,
        positions.bougie.y2,
        ctxColor,
      );
      this.ui.drawRect(
        positions.meche.x1,
        positions.meche.y1,
        positions.meche.x2,
        positions.meche.y2,
        ctxColor,
      );
    });

    if (this.indicators._drawHigsLows) {
      this._drawHigsLows();
    }
    if (this.indicators._drawSupportsResistances) {
      this._drawSupportsResistances();
    }
    if (this.indicators._drawVolumes) {
      this._drawVolumes();
    }

    if (this.indicators._drawTrendlines) {
      this._drawTrendlines();
    }

    this._drawTrades();
  }

  _drawTrades() {
    const timelineKeys = Object.keys(this.timeline);

    const allTrades = Object.values(this.trades)
      .filter((tradeInfos) => tradeInfos.draw)
      .map((tradeInfos) => tradeInfos.trades)
      .flat();

    allTrades.forEach((trade) => {
      const end = this.timeline[trade.endTick];
      const start = this.timeline[trade.startTick];

      if (
        start == null &&
        end == null &&
        (trade.endTick < timelineKeys[0] ||
          trade.startTick > timelineKeys[timelineKeys.length - 1])
      ) {
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

      const tpY =
        this.ui.height -
        (tpClamped / this.clamped_highest_price) * this.ui.height;
      const tpHeight =
        (tpDiffClamped / this.clamped_highest_price) * this.ui.height;
      const slY =
        this.ui.height -
        (spClamped / this.clamped_highest_price) * this.ui.height;
      const slHeight =
        (slDiffClamped / this.clamped_highest_price) * this.ui.height;

      this.ui.drawRect(x, tpY, width, tpHeight, "#00ff0044");
      this.ui.drawRect(x, slY, width, slHeight, "#ff000044");
    });
  }

  _drawHigsLows() {
    const supports = this.datas.localExtremes.swingLows;

    const supportsKeys = Object.keys(supports);

    supportsKeys.forEach((time) => {
      const support = supports[time];
      const candle = this.timeline[support.time];

      if (candle == null) {
        return;
      }

      const x = candle.x;
      const y =
        this.ui.height -
        ((support.price - this.klines_lowest_price) /
          this.clamped_highest_price) *
          this.ui.height;

      this.ui.drawRect(x, y, this.ui.width, 1, "green");
    });

    const resistances = this.datas.localExtremes.swingHighs;
    const resistancesKeys = Object.keys(resistances);

    resistancesKeys.forEach((time) => {
      const support = resistances[time];
      const candle = this.timeline[support.time];

      if (candle == null) {
        return;
      }

      const x = candle.x;
      const y =
        this.ui.height -
        ((support.price - this.klines_lowest_price) /
          this.clamped_highest_price) *
          this.ui.height;

      this.ui.drawRect(x, y, this.ui.width, 1, "red");
    });
  }

  _drawSupportsResistances() {
    const zones = this.datas.oppositionZones;
    const timelineKeys = Object.keys(this.timeline);

    zones.forEach((zone) => {
      const end = this.timeline[zone.endTime];
      const start = this.timeline[zone.startTime];
      let broken = false;
      let x = 0;
      let width = x + this.ui.width;

      if (!zone.endTime) {
        if (start != null) {
          x = start.x;
        }
      } else {
        if (start == null && end == null) {
          return;
        }
        broken = true;
        if (start != null) {
          x = start.x;
        }
        if (end != null) {
          width = end.x + end.width - x;
        }
      }

      if (zone.startTime > timelineKeys[timelineKeys.length - 1]) {
        return;
      }

      const y =
        this.ui.height -
        ((zone.price - this.klines_lowest_price) / this.clamped_highest_price) *
          this.ui.height;

      this.ui.drawRect(x, y, width, 1, broken ? "#ffffff20" : "white");
    });
  }

  _drawVolumes() {
    const timelineKeys = Object.keys(this.timeline);
    timelineKeys.forEach((time) => {
      const kline = this.timeline[time];
      const x = kline.x;
      const y = this.ui.height - kline.volume;
      let firstColor = kline.open > kline.close ? "red" : "green";
      let secondColor = kline.open < kline.close ? "red" : "green";

      let firstHeight = 0;
      let secondHeight = 0;
      if (kline.buyersQuoteVolumePercent > kline.sellersQuoteVolumePercent) {
        firstHeight = kline.buyersVolume;
        secondHeight = kline.sellersVolume;
      } else {
        firstHeight = kline.sellersVolume;
        secondHeight = kline.buyersVolume;
      }

      this.ui.drawRect(x + 1, y, kline.width - 2, firstHeight, firstColor);
      this.ui.drawRect(
        x + 1,
        y + firstHeight,
        kline.width - 2,
        secondHeight,
        secondColor,
      );
    });
  }

  _drawTrendlines() {
    if (!this.datas.trendlines || this.datas.trendlines.length === 0) return;

    const timelineKeys = Object.keys(this.timeline).map(Number);
    if (timelineKeys.length === 0) return;

    const firstVisibleTime = timelineKeys[0];
    const lastVisibleTime = timelineKeys[timelineKeys.length - 1];

    // ─── Helpers de projection (même formule que partout dans la classe) ─────

    const priceToY = (price) =>
      this.ui.height -
      ((price - this.klines_lowest_price) / this.clamped_highest_price) *
        this.ui.height;

    // Convertit un timestamp → X en pixels
    // Si le tick n'est pas dans la fenêtre visible, extrapole linéairement
    const timeToX = (time) => {
      const candle = this.timeline[time];
      if (candle) return candle.x + candle.width / 2;

      const first = this.timeline[firstVisibleTime];
      const last = this.timeline[lastVisibleTime];
      const pxPerMs =
        (last.x + last.width / 2 - (first.x + first.width / 2)) /
        (lastVisibleTime - firstVisibleTime);

      return first.x + first.width / 2 + (time - firstVisibleTime) * pxPerMs;
    };

    // ─── Dessin de chaque trendline active ───────────────────────────────────

    for (const tl of this.datas.trendlines) {
      // Point d'ancrage gauche : p1 (ou son extrapolation hors fenêtre)
      const x1 = timeToX(tl.p1.time);
      const y1 = priceToY(tl.p1.price);

      // Point droit : projection jusqu'au bord du canvas
      const projectedPrice =
        tl.p2.price + tl.slope * (lastVisibleTime - tl.p2.time);

      let x2 = this.ui.width;

      const y2 = priceToY(projectedPrice);

      // Couleur : vert pour support ascendant, rouge pour résistance descendante
      // Opacité croissante avec le nombre de touches (max 0.9)
      const broken = tl.broken;
    
      const getRand = jsf32(
        tl.startTime,
        tl.startTime,
        tl.startTime,
        tl.startTime,
      );

      const colorR = Math.floor(getRand() * 50) + 205;
      const colorG = Math.floor(getRand() * 50) + 205;
      const colorB = Math.floor(getRand() * 50) + 205;

      const opacity = (0.3 - (broken ? 0.25 : 0)).toFixed(2);
      const color = `rgba(${colorR},${colorG},${colorB} ,${opacity})`;
      const lw = tl.touchCount >= 3 ? 2 : 1;

      this.ui.drawLine(x1, y1, x2, y2, color, lw);

      for (const pivot of [tl.p1, tl.p2, tl.p3]) {
        const candle = this.timeline[pivot.time];
        if (!candle) continue;

        const px = candle.x + candle.width / 2;
        const py = priceToY(pivot.price);
        this.ui.drawRect(px - 3, py - 3, 6, 6, color);
      }
    }
  }
}
