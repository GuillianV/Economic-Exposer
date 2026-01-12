class UI extends EventEmitter {
  constructor(canvas, sizes) {
    super();
    this.canvas = document.querySelector(canvas);
    this.ctx = this.canvas.getContext("2d");
    this.sizes = sizes;
    this.initCanvas();
    this.initTouch();
  }

  onWheel(callback = () => {}) {
    this.on("wheel", (touch, delta) => {
      callback(touch, delta);
    });
  }

  _disableScroll(e) {
    e.preventDefault();
    e.stopPropagation();
    return false;
  }

  initTouch() {
    this.isShiftPressed = false;
    this.isAltPressed = false;

    window.addEventListener("keydown", (event) => {
      if (event.key === "Shift") {
        this.isShiftPressed = true;
      }
      if (event.key === "Alt") {
        this.isAltPressed = true;
      }
    });

    window.addEventListener("keyup", (event) => {
      if (event.key === "Shift") {
        this.isShiftPressed = false;
      }
      if (event.key === "Alt") {
        this.isAltPressed = false;
      }
    });
  }

  clearCanvas() {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  drawRect(x, y, width, height, color) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, width, height);
  }

  initCanvas() {
    this.canvas.width = this.sizes.width;
    this.canvas.height = this.sizes.height;
    this.width = this.canvas.width;
    this.height = this.canvas.height;

    this.canvas.addEventListener("wheel", (event) => {
      const delta = event.deltaY * 0.01;
      if (this.isShiftPressed) {
        this.trigger("wheel", ["shift", delta]);

        this._disableScroll(event);
      } else if (this.isAltPressed) {
        this.trigger("wheel", ["alt", delta]);

        this._disableScroll(event);
      } else {
        this.trigger("wheel", [null, delta]);
      }
    });
  }
}
