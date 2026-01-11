window.addEventListener("DOMContentLoaded", () => {
  const ws = new WebSocketClient("ws://localhost:3001");
  const tick = document.querySelector("#tick1");
  const id = uuidv4();
  tick.addEventListener("click", () => {
    ws.send(
      JSON.stringify({
        message: "tick",
        id,
        tick: 1,
      })
    );
  });

  ws.send({
    message: "start",
    id,
  });

  ws.on("start", (data) => {
    console.log(data);
  });

  // ws.onopen = () => {
  //   ws.send(
  //     JSON.stringify({
  //       message: "start",
  //       id,
  //     })
  //   );
  // };

  // ws.onclose = () => {
  //   console.log("Connection closed");
  // };

  // ws.onerror = (error) => {
  //   console.log(error);
  // };

  // ws.onmessage = (event) => {
  //   onMessage(event.data, (type, data) => {
  //     switch (type) {
  //       case "start":
  //         console.log(data);
  //         break;
  //       case "tick":
  //         console.log(data);
  //       default:
  //         break;
  //     }
  //   });
  // };
});
