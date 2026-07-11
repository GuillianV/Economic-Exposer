/**
 * Limiteur de requêtes PAR HÔTE : borne la concurrence et espace les appels
 * vers une même API, pour éviter rate-limits et contention de sockets.
 *
 * N'affecte QUE les hôtes listés dans LIMITS ; tout autre hôte passe sans
 * limite (aucun surcoût). Le limiteur est partagé par tous les collecteurs
 * via `base.js`.
 */
const LIMITS = {
  "api.stlouisfed.org": { concurrency: 6, minIntervalMs: 30 }, // FRED : nombreux appels par collecte
  "api.gdeltproject.org": { concurrency: 1, minIntervalMs: 1000 }, // GDELT : rate-limite fort (429)
  "www.investing.com": { concurrency: 1, minIntervalMs: 1500 }, // scraping poli (anti-bot)
};

/**
 * File d'exécution d'un hôte : au plus `concurrency` jobs actifs, espacés
 * d'au moins `minIntervalMs` entre deux démarrages.
 */
class Gate {
  /**
   * @param {{ concurrency: number, minIntervalMs: number }} limits Bornes de l'hôte.
   */
  constructor({ concurrency, minIntervalMs }) {
    this.concurrency = concurrency;
    this.minIntervalMs = minIntervalMs;
    this.active = 0; // jobs en cours d'exécution
    this.last = 0; // ts du dernier démarrage de job
    this.queue = []; // jobs en attente : { fn, resolve, reject }
    this.timer = null; // réveil programmé quand l'intervalle minimal bloque
  }

  /**
   * Met un job en file et renvoie sa promesse de résultat.
   * @param {() => Promise<*>} fn Job à exécuter dans un créneau.
   * @returns {Promise<*>} Résultat (ou rejet) du job.
   */
  run(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.#pump();
    });
  }

  /**
   * Démarre autant de jobs que les bornes le permettent ; se re-programme
   * si l'intervalle minimal entre démarrages n'est pas encore écoulé.
   */
  #pump() {
    if (this.queue.length === 0 || this.active >= this.concurrency) return;

    const now = Date.now();
    const earliestStart = this.last + this.minIntervalMs;
    if (now < earliestStart) {
      if (!this.timer) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.#pump();
        }, earliestStart - now);
      }
      return;
    }

    const job = this.queue.shift();
    this.active++;
    this.last = now;
    Promise.resolve()
      .then(job.fn)
      .then(job.resolve, job.reject)
      .finally(() => {
        this.active--;
        this.#pump();
      });
    this.#pump();
  }
}

const gates = new Map(); // hôte -> Gate (une file partagée par hôte)

/**
 * Exécute `fn` à travers le créneau de l'hôte, ou directement si l'hôte
 * n'est pas borné dans LIMITS.
 * @param {string|null} host Nom d'hôte de la requête.
 * @param {() => Promise<*>} fn Requête à exécuter.
 * @returns {Promise<*>} Résultat de `fn`.
 */
export function withHostGate(host, fn) {
  const limits = host && LIMITS[host];
  if (!limits) return fn();

  let gate = gates.get(host);
  if (!gate) {
    gate = new Gate(limits);
    gates.set(host, gate);
  }
  return gate.run(fn);
}
