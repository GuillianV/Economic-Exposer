window.addEventListener("DOMContentLoaded", () => {
  const ws = new WebSocketClient("ws://localhost:3001");
  const id = uuidv4();

  const ui = new UI("canvas#klines", {
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const strategies = new Strategies(ui);
  const klines = new Klines(ui);
  ui.lateInit(klines.getIndicators());

  ui.on("indicator", (indicator, enabled) => {
    const indicators = klines.getIndicators();
    indicators[indicator] = enabled;
    klines.enableDrawingIndicators(indicators);
  });

  ui.on("tick", (number) => {
    ws.send({
      message: "tick",
      id,
      tick: number,
    });
  });

  ui.onWheel((type, delta) => {
    const selectedKlinesOptions = {
      candlesOffsetValue: 0,
      candlesnumberValue: 0,
      heightOffsetValue: 0,
    };

    switch (type) {
      case "shift":
        selectedKlinesOptions.heightOffsetValue = delta;
        break;
      case "alt":
        selectedKlinesOptions.candlesnumberValue = delta;
        break;
      case "control":
        selectedKlinesOptions.candlesOffsetValue = delta;
      default:
        break;
    }

    klines.onOptionChange(selectedKlinesOptions);
  });

  ui.onButtonClick((category, subcategory, id, data) => {
    if (category == "strategy" && subcategory == "trades") {
      klines.enableDrawingTrades(id, data.enabled);
    }
  });

  ws.send({
    message: "start",
    id,
  });

  ws.on("start", (data) => {

    klines.onTrades(data.strategies);
    klines.onUpdate(data.klines, data.datas);
    strategies.upsert(data.strategies);
  });

  ws.on("tick", (data) => {

    klines.onTrades(data.strategies);
    klines.onUpdate(data.klines, data.datas);
    strategies.upsert(data.strategies);
  });

  ws.on("end", (data) => {
    console.log("end");
    klines.onTrades(data.strategies);
    klines.onUpdate(data.klines, data.datas);
    strategies.upsert(data.strategies);
  });
});
