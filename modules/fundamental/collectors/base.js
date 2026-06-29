import { logger } from "../../logs/index.js";
import { withHostGate } from "./throttle.js";

const DEFAULT_TIMEOUT_MS = 10000;

const safeHost = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

/**
 * Classe de base pour un collecteur de donnée fondamentale.
 *
 * Chaque collecteur surcharge `fetchData()` et renvoie un objet normalisé.
 * `collect()` enveloppe l'appel : une source en panne ne casse JAMAIS le
 * snapshot, elle renvoie `{ ok:false, stale:true, data:null, error }`.
 *
 * `axis` range le collecteur dans un des 4 axes du world-state :
 *   "sentiment" | "macro" | "onchain" | "structure".
 */
export class Collector {
  constructor(name, { axis = null } = {}) {
    this.name = name;
    this.axis = axis;
  }

  // À surcharger. Doit renvoyer un objet simple (donnée normalisée) ou throw.
  async fetchData() {
    throw new Error(`Collector ${this.name} must implement fetchData()`);
  }

  async collect() {
    const ts = Date.now();
    try {
      const data = await this.fetchData();
      return { source: this.name, axis: this.axis, ts, ok: true, stale: false, data, error: null };
    } catch (err) {
      logger.warn(`[fundamental] collecteur "${this.name}" en échec : ${err.message}`);
      return { source: this.name, axis: this.axis, ts, ok: false, stale: true, data: null, error: err.message };
    }
  }

  // Helper : GET JSON avec timeout (AbortController) et contrôle du status HTTP.
  // Passe par le limiteur par hôte ; le chrono du timeout ne démarre QU'APRÈS
  // l'obtention du créneau (pas pendant l'attente en file).
  async getJson(url, { headers = {}, timeout = DEFAULT_TIMEOUT_MS } = {}) {
    return withHostGate(safeHost(url), async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const res = await fetch(url, { headers, signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
        return await res.json();
      } finally {
        clearTimeout(timer);
      }
    });
  }
}
