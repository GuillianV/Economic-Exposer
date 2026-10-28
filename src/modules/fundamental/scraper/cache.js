import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Cache disque des scrapes navigateur. Le job de scrape (cadence propre) écrit
 * ici ; les collecteurs LISENT ce cache dans le cycle de snapshot, sans jamais
 * lancer Chromium — c'est le point de découplage entre le navigateur (lent) et
 * la collecte (rapide). Un fichier JSON par source, sous `data/scrape/`.
 */
const DATA = path.resolve(process.cwd(), "data");
const SCRAPE_DIR = path.join(DATA, "scrape");
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

export const SCRAPE_INTERVAL_MS = 30 * MINUTE_MS; // cadence propre du job de scrape, indépendante du snapshot horaire
export const SCRAPE_MAX_AGE_MS = 4 * SCRAPE_INTERVAL_MS; // au-delà, un scrape Coinglass est périmé (4 passages manqués)

/**
 * Chemin du fichier de cache d'une source.
 * @param {string} name Nom de la source (ex. "coinglass-liquidations").
 * @returns {string} Chemin absolu du fichier JSON.
 */
function cachePath(name) {
  return path.join(SCRAPE_DIR, `${name}.json`);
}

/**
 * Écrit le résultat d'un scrape dans le cache (horodaté à l'instant d'écriture).
 * @param {string} name Nom de la source.
 * @param {object} data Donnée scrapée à mémoriser.
 * @returns {Promise<{ts: number, data: object}>} Enregistrement écrit.
 */
export async function writeScrapeCache(name, data) {
  await mkdir(SCRAPE_DIR, { recursive: true });
  const record = { ts: Date.now(), data };
  await writeFile(cachePath(name), JSON.stringify(record), "utf8");
  return record;
}

/**
 * Lit le cache d'une source, null si absent ou illisible (le collecteur bascule
 * alors en stale sans jamais lever).
 * @param {string} name Nom de la source.
 * @returns {Promise<{ts: number, data: object}|null>} Enregistrement caché, ou null.
 */
export async function readScrapeCache(name) {
  try {
    const raw = await readFile(cachePath(name), "utf8");
    const record = JSON.parse(raw);
    if (record && typeof record.ts === "number") return record;
    return null;
  } catch {
    return null;
  }
}

/**
 * Indique si un scrape est encore exploitable compte tenu de son âge.
 * Fonction PURE.
 * @param {number|null|undefined} scrapedTs Horodatage du scrape (epoch ms).
 * @param {number} maxAgeMs Âge maximal toléré (ms).
 * @param {number} nowMs Instant de référence (epoch ms).
 * @returns {boolean} true si le scrape est daté et plus jeune que maxAgeMs.
 */
export function isScrapeFresh(scrapedTs, maxAgeMs, nowMs) {
  if (!Number.isFinite(scrapedTs)) return false;
  const ageMs = nowMs - scrapedTs;
  return ageMs <= maxAgeMs;
}

/**
 * Lit le cache d'une source et refuse un scrape périmé : un scrape qui ne se
 * rafraîchit plus doit faire passer la source en stale, jamais être resservi
 * comme frais.
 * @param {string} name Nom de la source dans le cache.
 * @param {{label: string, maxAgeMs: number}} options Libellé (messages
 *   d'erreur) et âge maximal toléré (ms).
 * @returns {Promise<object>} Donnée scrapée enrichie de `scrapedTs` (epoch ms).
 * @throws {Error} Si le cache est vide ou plus vieux que maxAgeMs.
 */
export async function loadFreshScrape(name, { label, maxAgeMs }) {
  const record = await readScrapeCache(name);
  if (!record) throw new Error(`cache ${label} vide (scrape pas encore passé)`);

  const nowMs = Date.now();
  if (!isScrapeFresh(record.ts, maxAgeMs, nowMs)) {
    const ageMin = Math.round((nowMs - record.ts) / MINUTE_MS);
    const scrapedIso = new Date(record.ts).toISOString();
    throw new Error(`cache ${label} périmé depuis ${scrapedIso} (âge ${ageMin} min)`);
  }
  return { ...record.data, scrapedTs: record.ts };
}
