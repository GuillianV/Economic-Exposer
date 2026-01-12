window.addEventListener("DOMContentLoaded", () => {
  const ws = new WebSocketClient("ws://localhost:3001");
  const tick = document.querySelector("#tick1");

  const ui = new UI("canvas#klines", {
    width: window.innerWidth,
    height: window.innerHeight,
  });

  ui.onWheel((type, delta) => {
    switch (type) {
      case "shift":
        window.selectedKlinesOptions.heightOffset += delta * 10;
        break;
      case "alt":
        window.selectedKlinesOptions.candlesnumber += delta * 1;
        break;
      default:
        window.selectedKlinesOptions.candlesOffset += delta * 1;
        break;
    }

    drawKlines(ui, klinesEntries);
  });

  let klinesEntries = {};
  const id = uuidv4();
  tick.addEventListener("click", () => {
    ws.send({
      message: "tick",
      id,
      tick: 1,
    });
  });

  ws.send({
    message: "start",
    id,
  });

  ws.on("start", ({ klines }) => {
    klinesEntries = klines;
    drawKlines(ui, klinesEntries);
  });

  ws.on("tick", ({ klines }) => {
    klinesEntries = klines;
    drawKlines(ui, klinesEntries);
  });

  function drawKlines(ui, klines) {
    const selectedKlinesOptions = window.selectedKlinesOptions;
    ui.clearCanvas();

    const klines_1m_entries = Object.entries(klines).slice(Math.max(0, selectedKlinesOptions.candlesOffset), Math.max(1, selectedKlinesOptions.candlesOffset + selectedKlinesOptions.candlesnumber));
    const klines_1m_entries_length = klines_1m_entries.length;
    const klines_1m_lowest_price = Math.min(...klines_1m_entries.map(([time, klin]) => parseFloat(klin.low))) - Math.max(0, selectedKlinesOptions.heightOffset);
    const klines_1m_highest_price = Math.max(...klines_1m_entries.map(([time, klin]) => parseFloat(klin.high))) + Math.max(0, selectedKlinesOptions.heightOffset);

    const clamped_highest_price = klines_1m_highest_price - klines_1m_lowest_price;
    const candle_width = ui.width / klines_1m_entries_length;
    window.candle_width = candle_width;

    const timeline = {};
    klines_1m_entries.forEach(([time, kline], index) => {
      const klineClamped = {
        open: kline.open - klines_1m_lowest_price,
        close: kline.close - klines_1m_lowest_price,
        high: kline.high - klines_1m_lowest_price,
        low: kline.low - klines_1m_lowest_price,
      };

      const klineDeltas = {
        bougie: klineClamped.open - klineClamped.close,
        meche: klineClamped.high - klineClamped.low,
      };

      const positions = {
        bougie: {
          x1: candle_width * index,
          y1: ui.height - (klineClamped.open / clamped_highest_price) * ui.height,
          x2: candle_width,
          y2: (klineDeltas.bougie / clamped_highest_price) * ui.height,
        },
        meche: {
          x1: candle_width * index + candle_width / 2,
          y1: ui.height - (klineClamped.high / clamped_highest_price) * ui.height,
          x2: 1,
          y2: (klineDeltas.meche / clamped_highest_price) * ui.height,
        },
      };

      let ctxColor = klineDeltas.bougie > 0 ? "red" : "green";
      if (positions.bougie.y2 < 1 && positions.bougie.y2 > -1) {
        ctxColor = "orange";
        positions.bougie.y2 = 1;
      }

      timeline[time] = {
        x: candle_width * index,
        width: candle_width,
        kline: kline,
        time: time,
      };

      ui.drawRect(positions.bougie.x1, positions.bougie.y1, positions.bougie.x2, positions.bougie.y2, ctxColor);
    });
  }
});
