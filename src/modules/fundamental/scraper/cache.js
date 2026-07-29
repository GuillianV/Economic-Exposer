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
