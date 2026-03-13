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
    this.initStrategyResultContainer();
  }

  lateInit(indicators) {
    this.indicators = indicators;
    this.initIndicators();
  }

  initStrategyResultContainer() {
    this.strategyResultContainer = document.querySelector(
      "#strategyResultContainer",
    );
  }

  initStrategyDetailsContainer(name) {
    const strategyResultContainer = document.createElement("div");
    strategyResultContainer.classList.add("flex", "flex-col", "p-4");
    strategyResultContainer.innerHTML = `
      <div class="p-4 border-2 rounded-md glass relative">

        <div class="absolute top-0 right-0 p-2">
          <button id="${name}strategyTrades" class="glass text-black rounded-md p-2 border-2 border-blue-950">
            Trades
          </button>
        </div>
        <h1 class="text-xl">${name}</h1>
        <div class="flex flex-col">
          <div class="p-4">
            <h2 class="text-lg">Winrates</h2>
            <div class="flex flex-col">
              <h3 class="text-md">Required Winrate</h3>
              <div id="${name}requiredWinrate" class="flex justify-center p-4">
              </div>
              <h3 class="text-md">Actual Winrate</h3>
              <div id="${name}actualWinrate" class="flex justify-center p-4">
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    this.strategyResultContainer.appendChild(strategyResultContainer);
    const strategyTradesButton = document.querySelector(
      `#${name}strategyTrades`,
    );
    strategyTradesButton.addEventListener("click", () => {
      strategyTradesButton.classList.toggle("tab-child-enabled");
      const enabled =
        strategyTradesButton.classList.contains("tab-child-enabled");
      this.trigger("button", ["strategy", "trades", name, {enabled}]);
    });
  }

  onButtonClick(callback = () => {}) {
    this.on("button", (category, subcategory, id, data) => {
      callback(category, subcategory, id, data);
    });
  }

  updateStrategyDetailsContainer(
    name,
    winratePercent,
    requiredWinratePercent,
    color,
  ) {
    const strategyResultContainer = document.querySelector(
      `#${name}requiredWinrate`,
    );
    const strategyResultContainer2 = document.querySelector(
      `#${name}actualWinrate`,
    );

    strategyResultContainer.innerHTML = `${requiredWinratePercent}`;
    strategyResultContainer2.innerHTML = `${winratePercent}`;
    strategyResultContainer2.style.color = color;
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

    const ticks = [1, 5, 10, 1000, 10000, 100000];
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
        .find(
          (tabParentButton) => tabParentButton.id == "tab-parent-btn-indicator",
        )
        .classList.contains("tab-parent-enabled");
      if (parentEnabled) {
        this.indicatorsContainer.classList.remove("tab-hidden");
      } else {
        this.indicatorsContainer.classList.add("tab-hidden");
      }
    });

    Object.keys(this.indicators).forEach((indicator, index) => {
      const indicatorButtonSample = ` <button id="${indicator}" class="${index != 0 ? "ml-2" : ""} glass rounded-md p-2 border-2 border-blue-950">${indicator.replaceAll("_draw", "")}</button>`;
      this.indicatorsContainer.insertAdjacentHTML(
        "beforeend",
        indicatorButtonSample,
      );
      const indicatorButton = document.querySelector(`#${indicator}`);
      indicatorButton.addEventListener("click", () => {
        indicatorButton.classList.toggle("tab-child-enabled");

        this.trigger("indicator", [
          indicator,
          indicatorButton.classList.contains("tab-child-enabled"),
        ]);
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
    this.isControlPressed = false;

    window.addEventListener("keydown", (event) => {
      if (event.key === "Shift") {
        this.isShiftPressed = true;
      }
      if (event.key === "Alt") {
        this.isAltPressed = true;
      }
      if (event.key === "Control") {
        this.isControlPressed = true;
      }
    });

    window.addEventListener("keyup", (event) => {
      if (event.key === "Shift") {
        this.isShiftPressed = false;
      }
      if (event.key === "Alt") {
        this.isAltPressed = false;
      }
      if (event.key === "Control") {
        this.isControlPressed = false;
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
      } else if (this.isControlPressed) {
        this.trigger("wheel", ["control", delta]);

        this._disableScroll(event);
      } else {
        this.trigger("wheel", [null, delta]);
      }
    });
  }
}
