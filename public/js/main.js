window.addEventListener("DOMContentLoaded", () => {
  const ws = new WebSocketClient("ws://localhost:3001");
  const id = uuidv4();

  const ui = new UI("canvas#klines", {
    width: window.innerWidth,
    height: window.innerHeight,
  });

  const klines = new Klines(ui, window.selectedKlinesOptions);

  ui.on("tick", (number) => {
    ws.send({
      message: "tick",
      id,
      tick: number,
    });
  });

  ui.onWheel((type, delta) => {
    const selectedKlinesOptions = { candlesOffsetValue: 0, candlesnumberValue: 0, heightOffsetValue: 0 };
    switch (type) {
      case "shift":
        selectedKlinesOptions.heightOffsetValue = delta;
        break;
      case "alt":
        selectedKlinesOptions.candlesnumberValue = delta;
        break;
      default:
        selectedKlinesOptions.candlesOffsetValue = delta;
        break;
    }

    klines.onOptionChange(selectedKlinesOptions);
  });

  ws.send({
    message: "start",
    id,
  });

  ws.on("start", (data) => {
    klines.onUpdate(data.klines, data.datas, data.trades);
  });

  ws.on("tick", (data) => {
    klines.onUpdate(data.klines, data.datas, data.trades);
  });

  ws.on("end", (data) => {
    console.log("Ended");
  })
});
