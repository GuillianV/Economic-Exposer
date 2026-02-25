class UI extends EventEmitter {
  constructor(canvas, sizes) {
    super();
    this.canvas = document.querySelector(canvas);
    this.ctx = this.canvas.getContext("2d");
    this.sizes = sizes;
    this.initCanvas();
    this.initTouch();
    this.initTabParentsButtons();
    this.initTickingMenu();
  }

  lateInit(indicators) {
    this.indicators = indicators;
    this.initIndicators();
  }

  initTabParentsButtons() {
    this.tabParentsButtons = document.querySelectorAll(".tab-parent-btn");
    this.tabParentsButtonsHandlers = {};
    this.tabParentsButtons.forEach((tabParentButton) => {
      this.tabParentsButtonsHandlers[tabParentButton.id] = [];
      tabParentButton.addEventListener("click", (event) => {
        this.tabParentsButtons.forEach((tabParentButton) => {
          if (tabParentButton.id != event.target.id) {
            tabParentButton.classList.remove("tab-parent-enabled");
          }
        });
        tabParentButton.classList.add("tab-parent-enabled");

        Object.values(this.tabParentsButtonsHandlers).forEach((handlers) => {
          handlers.forEach((handler) => {
            handler();
          });
        });
      });
    });
  }

  initTickingMenu() {
    this.tickContainer = document.querySelector("#tickContainer");
    this.tickContainer.classList.add("tab-hidden");

    this.tabParentsButtonsHandlers["tab-parent-btn-ticks"].push(() => {
      const parentEnabled = Array.from(this.tabParentsButtons)
        .find((tabParentButton) => tabParentButton.id == "tab-parent-btn-ticks")
        .classList.contains("tab-parent-enabled");
      if (parentEnabled) {
        this.tickContainer.classList.remove("tab-hidden");
      } else {
        this.tickContainer.classList.add("tab-hidden");
      }
    });

    const ticks = [1, 5, 10, 1000];
    ticks.forEach((tick, index) => {
      const tickButtonSample = ` <button id="tick${tick}" class="${index != 0 ? "ml-2" : ""} glass rounded-md p-2 border-2 border-blue-950">${tick}</button>`;
      this.tickContainer.insertAdjacentHTML("beforeend", tickButtonSample);
      const tickButton = document.querySelector(`#tick${tick}`);
      tickButton.addEventListener("click", () => {
        this.trigger("tick", [tick]);
      });
    });
  }

  initIndicators() {
    if (this.indicators == null) {
      return;
    }
    this.indicatorsContainer = document.querySelector("#indicatorsContainer");
    this.indicatorsContainer.classList.add("tab-hidden");

    this.tabParentsButtonsHandlers["tab-parent-btn-indicator"].push(() => {
      const parentEnabled = Array.from(this.tabParentsButtons)
        .find((tabParentButton) => tabParentButton.id == "tab-parent-btn-indicator")
        .classList.contains("tab-parent-enabled");
      if (parentEnabled) {
        this.indicatorsContainer.classList.remove("tab-hidden");
      } else {
        this.indicatorsContainer.classList.add("tab-hidden");
      }
    });

    Object.keys(this.indicators).forEach((indicator, index) => {
      const indicatorButtonSample = ` <button id="${indicator}" class="${index != 0 ? "ml-2" : ""} glass rounded-md p-2 border-2 border-blue-950">${indicator.replaceAll("_draw", "")}</button>`;
      this.indicatorsContainer.insertAdjacentHTML("beforeend", indicatorButtonSample);
      const indicatorButton = document.querySelector(`#${indicator}`);
      indicatorButton.addEventListener("click", () => {
        indicatorButton.classList.toggle("tab-child-enabled");

        this.trigger("indicator", [indicator, indicatorButton.classList.contains("tab-child-enabled")]);
      });
    });
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
