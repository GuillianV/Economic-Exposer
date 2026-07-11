import Parser from "rss-parser";
import { logger } from "../../logs/index.js";
import { Collector } from "./base.js";

/**
 * Google News RSS — surveillance thématique ciblée.
 * Sans clé, gratuit. Axe : news.
 *
 * Chaque thème = une requête RSS Google News (fenêtre récente). Permet de
 * cibler des sujets précis qui ne ressortent pas des flux génériques (Fed,
 * régulation crypto, géopolitique, tarifs douaniers…).
 * Pour ajouter/retirer un thème : éditer THEMES.
 */
const THEMES = {
  fed: "Federal Reserve interest rate decision",
  cryptoRegulation: "cryptocurrency regulation SEC",
  bitcoinEtf: "Bitcoin ETF inflows",
  middleEast: "Middle East conflict",
  tradeWar: "tariffs trade war",
  chinaEconomy: "China economy stimulus",
  // Thèmes structurels (grille EY géostratégie)
  semiconductors: "semiconductor export controls China",
  energySecurity: "energy security oil supply",
  foodSecurity: "global food security crisis",
};

/**
 * URL du flux RSS Google News d'une requête (fenêtre de 2 jours).
 * @param {string} query Requête de recherche.
 * @returns {string} URL du flux RSS.
 */
function googleNewsUrl(query) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:2d`)}&hl=en-US&gl=US&ceid=US:en`;
}

export class GoogleNewsCollector extends Collector {
  /**
   * @param {{ perThemeMax?: number, perFeedTimeout?: number }} [options]
   *   Articles gardés par thème et timeout par flux (ms).
   */
  constructor({ perThemeMax = 6, perFeedTimeout = 12000 } = {}) {
    super("google-news", { axis: "news" });
    this.perThemeMax = perThemeMax;
    this.parser = new Parser({
      timeout: perFeedTimeout,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CryptoFundamentalBot/0.1)" },
    });
  }

  /**
   * Articles récents d'un thème, normalisés.
   * @param {string} query Requête du thème.
   * @returns {Promise<Array<{title: string, link: string, date: number|null}>>}
   *   Articles (au plus perThemeMax).
   */
  async #fetchTheme(query) {
    const parsed = await this.parser.parseURL(googleNewsUrl(query));
    return (parsed.items || []).slice(0, this.perThemeMax).map((item) => {
      const rawDate = item.isoDate || item.pubDate || null;
      const date = rawDate ? new Date(rawDate).getTime() : null;
      return {
        title: (item.title || "").trim(),
        link: item.link || "",
        date: Number.isFinite(date) ? date : null,
      };
    });
  }

  /**
   * Tous les thèmes en parallèle, tolérant par thème.
   * @returns {Promise<{themeCount: number, themesOk: number,
   *   totalItems: number, themes: object}>} Articles par thème (tableau vide
   *   pour un thème en échec).
   * @throws {Error} Si AUCUN thème n'a répondu.
   */
  async fetchData() {
    const keys = Object.keys(THEMES);
    const results = await Promise.allSettled(keys.map((key) => this.#fetchTheme(THEMES[key])));

    const themes = {};
    let themesOk = 0;
    let totalItems = 0;
    results.forEach((result, i) => {
      const key = keys[i];
      if (result.status === "fulfilled") {
        themes[key] = result.value;
        themesOk += 1;
        totalItems += result.value.length;
      } else {
        themes[key] = [];
        logger.warn(`[fundamental] Google News thème "${key}" KO : ${result.reason?.message}`);
      }
    });

    if (themesOk === 0) throw new Error("aucun thème Google News disponible");

    return { themeCount: keys.length, themesOk, totalItems, themes };
  }
}
