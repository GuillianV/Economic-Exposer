import { Collector } from "./base.js";

/**
 * Trésoreries Bitcoin d'entités (entreprises, gouvernements, ETF) — l'acheteur
 * institutionnel, complément des flux ETF. Axe : structure.
 *
 * PRIMAIRE : scrape du HTML SSR de bitcointreasuries.net (table complète, toutes
 * catégories : publiques + privées + gouvernements + ETF). Le HTML est servi
 * rendu côté serveur et passe Cloudflare en simple fetch (pas de navigateur).
 * BACKUP : API CoinGecko /companies/public_treasury/bitcoin (entreprises
 * PUBLIQUES seulement, mais fiable) si le scrape échoue ou renvoie trop peu.
 *
 * Signal : le TOTAL détenu et sa TENDANCE = accumulation vs retrait de
 * l'acheteur marginal. À lire en PROCYCLIQUE (les trésoreries achètent haut,
 * capitulent bas) : un arrêt d'achat à valorisation basse est ambigu, pas
 * mécaniquement baissier.
 */
const BT_URL = "https://bitcointreasuries.net/";
const CG_URL = "https://api.coingecko.com/api/v3/companies/public_treasury/bitcoin";
const FETCH_TIMEOUT_MS = 20000;
const CACHE_TTL_MS = 6 * 3600000; // trésoreries : donnée lente (reporting par à-coups)
const MIN_HOLDING_BTC = 10; // sous ce seuil : bruit / colonne mNAV (ratio ~1-5), écarté
const MIN_ENTITIES_OK = 20; // moins d'entités parsées = scrape cassé -> bascule backup
const TOP_HOLDERS = 10;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

/**
 * Décode les entités HTML usuelles d'une chaîne (best-effort).
 * @param {string} text Texte brut.
 * @returns {string} Texte décodé.
 */
function decodeEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/**
 * Convertit une cellule en nombre de BTC (retire séparateurs de milliers).
 * @param {string} cell Texte de cellule.
 * @returns {number|null} Nombre fini, ou null si non numérique.
 */
function toBtcNumber(cell) {
  const cleaned = cell.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

/**
 * Extrait le texte des cellules d'une ligne de tableau HTML.
 * @param {string} rowHtml Fragment HTML d'un `<tr>`.
 * @returns {Array<string>} Textes de cellules nettoyés.
 */
function cellsOf(rowHtml) {
  const matches = [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)];
  return matches.map((m) => {
    const stripped = m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return decodeEntities(stripped);
  });
}

/**
 * Parse la table SSR de bitcointreasuries en holdings par entité. Fonction PURE
 * (aucune I/O) — testable isolément. Écarte les lignes de sous-total ("Total").
 * @param {string} htmlText HTML complet de la page.
 * @returns {{totalBtc: number, strategyBtc: number|null, entityCount: number,
 *   topHolders: Array<{name: string, btc: number}>}} Agrégat trésoreries.
 */
export function parseTreasuriesHtml(htmlText) {
  const rows = htmlText.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
  const byName = new Map(); // nom -> holdings BTC (max si doublon)
  for (const row of rows) {
    const cells = cellsOf(row);
    if (cells.length < 4) continue;

    const name = cells.find(
      (cell) => /[A-Za-z]{3}/.test(cell) && !/^total/i.test(cell) && !/BTC/i.test(cell) && cell.length < 60,
    );
    if (!name) continue;

    const numbers = cells.map(toBtcNumber).filter((value) => value != null && value >= MIN_HOLDING_BTC);
    if (!numbers.length) continue;

    const holding = Math.max(...numbers);
    byName.set(name, Math.max(byName.get(name) ?? 0, holding));
  }

  const holders = [...byName.entries()]
    .map(([name, btc]) => ({ name, btc }))
    .sort((a, b) => b.btc - a.btc);
  const totalBtc = holders.reduce((sum, holder) => sum + holder.btc, 0);
  const strategy = holders.find((holder) => /strategy|microstrategy/i.test(holder.name));

  return {
    totalBtc,
    strategyBtc: strategy?.btc ?? null,
    entityCount: holders.length,
    topHolders: holders.slice(0, TOP_HOLDERS),
  };
}

/**
 * Agrège la réponse CoinGecko public_treasury (backup, entreprises publiques).
 * Fonction PURE.
 * @param {object} json Réponse CoinGecko.
 * @returns {{totalBtc: number, strategyBtc: number|null, entityCount: number,
 *   topHolders: Array<{name: string, btc: number}>}} Même forme que le scrape.
 */
export function parseCoinGeckoTreasury(json) {
  const companies = Array.isArray(json?.companies) ? json.companies : [];
  const holders = companies
    .map((company) => ({ name: company.name || company.symbol || "?", btc: Number(company.total_holdings) || 0 }))
    .filter((holder) => holder.btc >= MIN_HOLDING_BTC)
    .sort((a, b) => b.btc - a.btc);
  const strategy = holders.find((holder) => /strategy|microstrategy/i.test(holder.name));

  return {
    totalBtc: Number(json?.total_holdings) || holders.reduce((sum, holder) => sum + holder.btc, 0),
    strategyBtc: strategy?.btc ?? null,
    entityCount: holders.length,
    topHolders: holders.slice(0, TOP_HOLDERS),
  };
}

/**
 *
 */
export class TreasuriesCollector extends Collector {
  /**
   * Initialise le collecteur et son cache mémoire.
   *
   */
  constructor() {
    super("treasuries", { axis: "structure" });
    this.cache = null; // { ts: number, data: object } — dernier agrégat valide
  }

  /**
   * Scrape bitcointreasuries.net (HTML SSR) et parse la table complète.
   * @returns {Promise<object>} Agrégat trésoreries (source "scrape").
   * @throws {Error} Fetch en échec, HTTP non-2xx, ou table trop maigre.
   */
  async #scrape() {
    const res = await fetch(BT_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} sur bitcointreasuries`);

    const htmlText = await res.text();
    const data = parseTreasuriesHtml(htmlText);
    if (data.entityCount < MIN_ENTITIES_OK) {
      throw new Error(`table trop maigre (${data.entityCount} entités) — parse probablement cassé`);
    }
    return { ...data, source: "scrape", asOf: new Date().toISOString() };
  }

  /**
   * Backup CoinGecko : entreprises publiques uniquement, mais fiable.
   * @returns {Promise<object>} Agrégat trésoreries (source "coingecko").
   * @throws {Error} Clé absente ou réponse inexploitable.
   */
  async #coingecko() {
    const apiKey = process.env.COINGECKO_API_KEY;
    const headers = apiKey ? { "x-cg-demo-api-key": apiKey } : {};
    const json = await this.getJson(CG_URL, { headers, timeout: FETCH_TIMEOUT_MS });
    const data = parseCoinGeckoTreasury(json);
    return { ...data, source: "coingecko", asOf: new Date().toISOString() };
  }

  /**
   * Trésoreries BTC agrégées : scrape en primaire, CoinGecko en backup, cache
   * mémoire (< CACHE_TTL_MS). Ne laisse jamais une source en panne vider la
   * donnée : si scrape ET backup échouent mais qu'un cache existe, on le ressert.
   * @returns {Promise<{totalBtc: number, strategyBtc: number|null,
   *   entityCount: number, topHolders: Array<object>, source: string,
   *   asOf: string, cached?: boolean}>} Agrégat trésoreries.
   */
  async fetchData() {
    if (this.cache && Date.now() - this.cache.ts < CACHE_TTL_MS) return this.cache.data;

    let data = null;
    try {
      data = await this.#scrape();
    } catch (scrapeErr) {
      try {
        data = await this.#coingecko();
      } catch (backupErr) {
        if (this.cache) return { ...this.cache.data, cached: true };
        throw new Error(`scrape (${scrapeErr.message}) ET backup (${backupErr.message}) en échec`);
      }
    }

    this.cache = { ts: Date.now(), data };
    return data;
  }
}
