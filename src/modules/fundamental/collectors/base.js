import { logger } from "../../logs/index.js";
import { withHostGate } from "./throttle.js";

const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Extrait le nom d'hôte d'une URL, sans jamais lever.
 * @param {string} url URL complète.
 * @returns {string|null} Nom d'hôte, ou null si l'URL est invalide.
 */
function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Classe de base d'un collecteur de donnée fondamentale.
 *
 * Chaque collecteur surcharge `fetchData()` et renvoie un objet normalisé.
 * `collect()` enveloppe l'appel : une source en panne ne casse JAMAIS le
 * snapshot, elle renvoie `{ ok: false, stale: true, data: null, error }`.
 */
export class Collector {
  /**
   * @param {string} name Nom unique de la source (clé dans le snapshot).
   * @param {{ axis?: string|null }} [options] `axis` range le collecteur dans
   *   un axe du world-state ("sentiment", "macro", "onchain", "structure"…).
   */
  constructor(name, { axis = null } = {}) {
    this.name = name;
    this.axis = axis;
  }

  /**
   * Récupère et normalise la donnée de la source. À surcharger.
   * @returns {Promise<object>} Donnée normalisée (objet simple).
   * @throws {Error} Si la source est indisponible ou la réponse inexploitable.
   */
  async fetchData() {
    throw new Error(`Collector ${this.name} must implement fetchData()`);
  }

  /**
   * Exécute `fetchData()` en capturant tout échec : la panne d'une source
   * devient un résultat `stale` loggé, jamais une exception propagée.
   * @returns {Promise<{source: string, axis: string|null, ts: number,
   *   ok: boolean, stale: boolean, data: object|null, error: string|null}>}
   */
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

  /**
   * Requête HTTP → JSON, bornée : passe par le limiteur par hôte, timeout via
   * AbortController (le chrono ne démarre qu'après l'obtention du créneau,
   * pas pendant l'attente en file), statut HTTP contrôlé avant lecture.
   * @param {string} url URL à appeler.
   * @param {RequestInit} init Options fetch (méthode, entêtes, corps).
   * @param {number} timeoutMs Délai maximal de la requête.
   * @returns {Promise<object>} Corps de réponse parsé en JSON.
   * @throws {Error} Statut HTTP non-2xx, timeout ou JSON invalide.
   */
  async #requestJson(url, init, timeoutMs) {
    return withHostGate(safeHost(url), async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { ...init, signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
        return await res.json();
      } finally {
        clearTimeout(timer);
      }
    });
  }

  /**
   * GET JSON sécurisé (limiteur par hôte + timeout + contrôle du statut).
   * @param {string} url URL à appeler.
   * @param {{ headers?: object, timeout?: number }} [options] Entêtes et
   *   timeout en ms (défaut : DEFAULT_TIMEOUT_MS).
   * @returns {Promise<object>} Corps de réponse parsé en JSON.
   */
  async getJson(url, { headers = {}, timeout = DEFAULT_TIMEOUT_MS } = {}) {
    return this.#requestJson(url, { headers }, timeout);
  }

  /**
   * POST form-encoded → JSON, mêmes garde-fous que `getJson`.
   * @param {string} url URL à appeler.
   * @param {string} body Corps `x-www-form-urlencoded` déjà sérialisé.
   * @param {{ headers?: object, timeout?: number }} [options] Entêtes et
   *   timeout en ms (défaut : DEFAULT_TIMEOUT_MS).
   * @returns {Promise<object>} Corps de réponse parsé en JSON.
   */
  async postForm(url, body, { headers = {}, timeout = DEFAULT_TIMEOUT_MS } = {}) {
    const init = {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
      body,
    };
    return this.#requestJson(url, init, timeout);
  }
}
