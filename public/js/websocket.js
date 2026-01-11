class WebSocketClient extends EventEmitter {
  _queue = [];

  constructor(url) {
    super();
    this.url = url;
    this.ws = new WebSocket(url);
    this.ws.onopen = this.onOpen.bind(this);
    this.ws.onmessage = this.onMessage.bind(this);
    this.ws.onclose = this.onClose.bind(this);
    this.ws.onerror = this.onError.bind(this);

    this.on("ready", () => {
      this._queue.forEach((message) => {
        this._dequeue();
      });
    });
  }

  onOpen() {
    this.connected = true;
    this.trigger("ready");
  }

  onMessage(event) {
    this.parseMessage(event.data, (type, data) => {
      this.trigger(type, [data]);
    });
  }

  onClose() {
    console.log("WebSocket connection closed");
  }

  onError(event) {
    console.log("WebSocket error:", event);
  }

  send(message) {
    this._queue.push(message);

    if (this.connected) {
      this._dequeue();
    }
  }

  _dequeue() {
    const data = this._queue.shift();
    if (data) {
      this._send(data);
    }
  }

  _send(data) {
    this.ws.send(JSON.stringify(data));
  }

  parseMessage(message, cb) {
    let type = null;
    let data = null;
    try {
      message = JSON.parse(message);
      type = message.type;
      data = message.data;
    } catch (e) {
      console.log(e);
      return;
    }

    if (typeof cb === "function") {
      cb(type, data);
    }
  }
}
