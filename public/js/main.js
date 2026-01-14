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

    klines.onOptionChange(window.selectedKlinesOptions);
  });

  ws.send({
    message: "start",
    id,
  });

  ws.on("start", (data) => {
    klines.onUpdate(data.klines);
  });

  ws.on("tick", (data) => {
    klines.onUpdate(data.klines);
  });
});
