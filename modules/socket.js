import { WebSocketServer } from "ws";

class ServerSocket {
  constructor() {
    const wss = new WebSocketServer({ port: 3001 });
    this.websocket = null;
    this.handlers = [];

    function onMessage(message, cb) {
      let page = null;
      let type = null;
      let data = null;
      try {
        message = JSON.parse(message);
        page = message.page;
        type = message.type;
        data = message.data;
      } catch (e) {
        console.log(e);
        return;
      }

      if (typeof cb === "function") {
        cb(page, type, data);
      }
    }

    wss.on("connection", (ws) => {
      this.websocket = ws;
      ws.on("message", (message) => {
        onMessage(message, (page, type, data) => {
          this.handlers.forEach((handler) => {
            handler(page, type, data);
          });
        });
      });
    });
  }

  addHandler(handler) {
    if (typeof handler === "function") {
      this.handlers.push(handler);
    }
  }

  send(data, type, page) {
    if (this.websocket) {
      this.websocket.send(
        JSON.stringify({
          page,
          type,
          data,
        }),
      );
    }
  }
}

export default new ServerSocket();
