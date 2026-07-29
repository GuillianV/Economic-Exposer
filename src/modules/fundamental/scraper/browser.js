import puppeteer from "puppeteer-extra";
import Stealth from "puppeteer-extra-plugin-stealth";
import { logger } from "../../logs/index.js";

/**
 * Socle de scraping par NAVIGATEUR (Puppeteer + stealth), pour les sources dont
 * la donnée n'est libérée que par leur propre JS (en-tête de requête signé côté
 * client + réponse chiffrée AES décryptée côté client — cas Coinglass). On ne
 * reverse NI la signature NI la clé : on laisse leur page faire le travail et on
 * intercepte le résultat DÉCHIFFRÉ via un hook sur `JSON.parse` (posé avant le
 * bundle), puisque leur code fait `JSON.parse(decrypt(payload))`.
 *
 * DÉCOUPLÉ du cycle de snapshot : Chromium est lourd et lent, donc seul le job
 * de scrape (cadence propre) lance le navigateur et écrit un cache disque ; les
 * collecteurs lisent ce cache, jamais le navigateur (voir cache.js).
 *
 * Le navigateur est un SINGLETON réutilisé entre scrapes (le lancement coûte
 * ~1 s). `PUPPETEER_EXECUTABLE_PATH` pointe le Chromium système en prod (Alpine).
 */
const LAUNCH_TIMEOUT_MS = 40000;
const NAV_TIMEOUT_MS = 45000;
const DEFAULT_SETTLE_MS = 5000; // délai après networkidle pour laisser les XHR tardifs décrypter
const DEFAULT_MIN_LEN = 1500; // longueur mini d'un texte JSON.parse retenu (filtre le bruit)

let browserPromise = null;

/**
 * Lance (ou réutilise) le navigateur stealth. Un échec de lancement réinitialise
 * le singleton pour permettre une nouvelle tentative au scrape suivant.
 * @returns {Promise<object>} Instance de navigateur Puppeteer.
 */
function getBrowser() {
  if (browserPromise) return browserPromise;
  puppeteer.use(Stealth());
  browserPromise = puppeteer
    .launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      timeout: LAUNCH_TIMEOUT_MS,
    })
    .catch((err) => {
      browserPromise = null;
      throw err;
    });
  return browserPromise;
}

/**
 * Ferme le navigateur singleton s'il est ouvert (arrêt propre du service).
 * @returns {Promise<void>} Résolue une fois le navigateur fermé.
 */
export async function closeBrowser() {
  if (!browserPromise) return;
  const current = browserPromise;
  browserPromise = null;
  try {
    const browser = await current;
    await browser.close();
  } catch (err) {
    logger.warn(`[scraper] fermeture navigateur : ${err.message}`);
  }
}

/**
 * Charge une URL et capture les objets JSON DÉCHIFFRÉS par le JS de la page dont
 * le premier élément (ou l'objet lui-même) porte toutes les clés attendues.
 * @param {string} url URL de la page à charger.
 * @param {{matchKeys?: Array<string>, minLen?: number, settleMs?: number}} [options]
 *   `matchKeys` : clés que doit contenir la donnée cible (filtre en page) ;
 *   `minLen` : taille mini du JSON brut ; `settleMs` : attente après chargement.
 * @returns {Promise<Array<object|Array>>} Payloads déchiffrés correspondants
 *   (peut contenir des doublons si la page re-parse la même donnée).
 * @throws {Error} Si le navigateur ou la navigation échoue.
 */
export async function capturePayloads(url, { matchKeys = [], minLen = DEFAULT_MIN_LEN, settleMs = DEFAULT_SETTLE_MS } = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await page.evaluateOnNewDocument(installParseHook, { minLen, matchKeys });
    await page.goto(url, { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS });
    await new Promise((resolve) => setTimeout(resolve, settleMs));
    return await page.evaluate(() => globalThis.__cap || []);
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Code INJECTÉ en page (avant le bundle) : remplace `JSON.parse` par un wrapper
 * qui retient les objets/arrays déchiffrés portant les clés attendues. Défini
 * hors de capturePayloads pour rester sérialisable et lisible.
 * @param {{minLen: number, matchKeys: Array<string>}} config Seuil de taille et
 *   clés cibles.
 * @returns {void}
 */
function installParseHook({ minLen, matchKeys }) {
  globalThis.__cap = [];
  const original = JSON.parse;
  const hasKeys = (obj) => obj && typeof obj === "object" && matchKeys.every((k) => k in obj);
  const matches = (out) => {
    if (matchKeys.length === 0) return true;
    if (Array.isArray(out)) return out.length > 0 && hasKeys(out[0]);
    return hasKeys(out);
  };
  JSON.parse = function wrapped(text, ...rest) {
    const out = original.call(this, text, ...rest);
    try {
      if (typeof text === "string" && text.length >= minLen && matches(out)) globalThis.__cap.push(out);
    } catch {
      /* le hook ne doit jamais casser le parse d'origine */
    }
    return out;
  };
}
