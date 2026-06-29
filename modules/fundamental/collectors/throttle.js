/**
 * Limiteur de requêtes PAR HÔTE : borne la concurrence et espace les appels
 * vers une même API, pour éviter rate-limits et contention de sockets.
 *
 * N'affecte QUE les hôtes listés dans LIMITS ; tout autre hôte passe sans
 * limite (aucun surcoût). Le limiteur est partagé par tous les collecteurs via
 * `base.js`. Ex. FRED reçoit ~40 appels par collecte → sans bornage, les appels
 * lourds (economic-calendar) timeoutent en file d'attente.
 */
const LIMITS = {
  "api.stlouisfed.org": { concurrency: 6, minIntervalMs: 30 }, // FRED
  "api.gdeltproject.org": { concurrency: 1, minIntervalMs: 1000 }, // GDELT rate-limite fort
};

class Gate {
  constructor({ concurrency, minIntervalMs }) {
    this.concurrency = concurrency;
    this.minIntervalMs = minIntervalMs;
    this.active = 0;
    this.last = 0;
    this.queue = [];
    this.timer = null;
  }

  run(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.#pump();
    });
  }

  #pump() {
    if (this.queue.length === 0 || this.active >= this.concurrency) return;
    const now = Date.now();
    const earliest = this.last + this.minIntervalMs;
    if (now < earliest) {
      if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.#pump(); }, earliest - now);
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
    this.#pump(); // démarre d'autres créneaux si la concurrence le permet
  }
}

const gates = new Map();

/** Exécute `fn` à travers le créneau de l'hôte (ou directement si non borné). */
export function withHostGate(host, fn) {
  const cfg = host && LIMITS[host];
  if (!cfg) return fn();
  let gate = gates.get(host);
  if (!gate) {
    gate = new Gate(cfg);
    gates.set(host, gate);
  }
  return gate.run(fn);
}
