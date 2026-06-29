import Parser from "rss-parser";
import { Collector } from "./base.js";
import { logger } from "../../logs/index.js";

/**
 * Google News RSS — surveillance thématique ciblée.
 * Sans clé, gratuit. Axe : news.
 *
 * Chaque thème = une requête RSS Google News (fenêtre récente). Permet de
 * cibler des sujets précis qui ne ressortent pas forcément des flux génériques
 * (Fed, régulation crypto, géopolitique, tarifs douaniers...).
 *
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

function gnUrl(query) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:2d`)}&hl=en-US&gl=US&ceid=US:en`;
}

export class GoogleNewsCollector extends Collector {
  constructor({ perThemeMax = 6, perFeedTimeout = 12000 } = {}) {
    super("google-news", { axis: "news" });
    this.perThemeMax = perThemeMax;
    this.parser = new Parser({
      timeout: perFeedTimeout,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CryptoFundamentalBot/0.1)" },
    });
  }

  async #fetchTheme(query) {
    const parsed = await this.parser.parseURL(gnUrl(query));
    return (parsed.items || []).slice(0, this.perThemeMax).map((it) => {
      const rawDate = it.isoDate || it.pubDate || null;
      const date = rawDate ? new Date(rawDate).getTime() : null;
      return {
        title: (it.title || "").trim(),
        link: it.link || "",
        date: Number.isFinite(date) ? date : null,
      };
    });
  }

  async fetchData() {
    const keys = Object.keys(THEMES);
    const results = await Promise.allSettled(keys.map((k) => this.#fetchTheme(THEMES[k])));

    const themes = {};
    let okThemes = 0;
    let total = 0;
    results.forEach((r, i) => {
      const key = keys[i];
      if (r.status === "fulfilled") {
        themes[key] = r.value;
        okThemes += 1;
        total += r.value.length;
      } else {
        themes[key] = [];
        logger.warn(`[fundamental] Google News thème "${key}" KO : ${r.reason?.message}`);
      }
    });

    if (okThemes === 0) throw new Error("aucun thème Google News disponible");

    return { themeCount: keys.length, themesOk: okThemes, totalItems: total, themes };
  }
}
