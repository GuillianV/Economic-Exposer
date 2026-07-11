import Parser from "rss-parser";
import { logger } from "../../logs/index.js";
import { Collector } from "./base.js";

/**
 * Agrégateur de news (Tier 3) — flux RSS/Atom crypto + macro + monde.
 * Sans clé, gratuit. Axe : news.
 *
 * Chaque flux est tolérant : un flux KO n'empêche pas les autres ; le
 * collecteur n'échoue que si AUCUN flux ne répond. Le bruit/biais des sources
 * (ex. ZeroHedge bearish) est volontairement conservé : c'est l'IA qui en
 * tirera le sentiment.
 */
const FEEDS = [
  // --- Crypto ---
  { name: "CoinDesk", category: "crypto", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { name: "Cointelegraph", category: "crypto", url: "https://cointelegraph.com/rss" },
  { name: "Decrypt", category: "crypto", url: "https://decrypt.co/feed" },
  { name: "The Block", category: "crypto", url: "https://www.theblock.co/rss.xml" },
  { name: "Bitcoin Magazine", category: "crypto", url: "https://bitcoinmagazine.com/.rss/full/" },
  { name: "NewsBTC", category: "crypto", url: "https://www.newsbtc.com/feed/" },
  { name: "Bitcoinist", category: "crypto", url: "https://bitcoinist.com/feed/" },
  { name: "CoinJournal", category: "crypto", url: "https://coinjournal.net/news/feed/" },
  { name: "CryptoPotato", category: "crypto", url: "https://cryptopotato.com/feed/" },
  { name: "AMBCrypto", category: "crypto", url: "https://ambcrypto.com/feed/" },
  { name: "U.Today", category: "crypto", url: "https://u.today/rss" },
  // --- Macro / marchés ---
  { name: "ZeroHedge", category: "macro", url: "https://feeds.feedburner.com/zerohedge/feed" },
  { name: "MarketWatch Top", category: "macro", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories" },
  { name: "CNBC Finance", category: "macro", url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664" },
  { name: "Investing News", category: "macro", url: "https://www.investing.com/rss/news.rss" },
  // --- Monde / géopolitique ---
  { name: "Al Jazeera", category: "world", url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { name: "BBC World", category: "world", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { name: "Guardian World", category: "world", url: "https://www.theguardian.com/world/rss" },
  { name: "Reuters (GNews)", category: "world", url: "https://news.google.com/rss/search?q=site:reuters.com%20when:1d&hl=en-US&gl=US&ceid=US:en" },
  { name: "AP (GNews)", category: "world", url: "https://news.google.com/rss/search?q=site:apnews.com%20when:1d&hl=en-US&gl=US&ceid=US:en" },
  // --- Géopolitique curée (analyse) ---
  { name: "GZERO Media", category: "world", url: "https://www.gzeromedia.com/feeds/feed.rss" },
  { name: "Foreign Policy", category: "world", url: "https://foreignpolicy.com/feed/" },
];

export class NewsCollector extends Collector {
  /**
   * @param {{ maxItems?: number, perFeedTimeout?: number }} [options] Nombre
   *   maximal d'items conservés et timeout par flux (ms).
   */
  constructor({ maxItems = 80, perFeedTimeout = 12000 } = {}) {
    super("news", { axis: "news" });
    this.maxItems = maxItems;
    this.parser = new Parser({
      timeout: perFeedTimeout,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CryptoFundamentalBot/0.1; +https://localhost)",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      },
    });
  }

  /**
   * Items d'un flux, normalisés.
   * @param {{name: string, category: string, url: string}} feed Flux à lire.
   * @returns {Promise<Array<{source: string, category: string, title: string,
   *   link: string, date: number|null}>>} Items normalisés.
   */
  async #fetchFeed(feed) {
    const parsed = await this.parser.parseURL(feed.url);
    return (parsed.items || []).map((item) => {
      const rawDate = item.isoDate || item.pubDate || null;
      const date = rawDate ? new Date(rawDate).getTime() : null;
      return {
        source: feed.name,
        category: feed.category,
        title: (item.title || "").trim(),
        link: item.link || item.guid || "",
        date: Number.isFinite(date) ? date : null,
      };
    });
  }

  /**
   * Tous les flux en parallèle, puis déduplication (titre normalisé + lien)
   * et tri du plus récent au plus ancien.
   * @returns {Promise<{items: Array<object>, feedCount: number,
   *   feedsOk: number, totalCollected: number, kept: number, feeds: object}>}
   *   Items retenus + état par flux ({ok, count, error?}).
   * @throws {Error} Si AUCUN flux n'a répondu.
   */
  async fetchData() {
    const feedStatus = {};
    const collected = [];

    const results = await Promise.allSettled(FEEDS.map((feed) => this.#fetchFeed(feed)));
    results.forEach((result, i) => {
      const feed = FEEDS[i];
      if (result.status === "fulfilled") {
        feedStatus[feed.name] = { ok: true, count: result.value.length };
        collected.push(...result.value);
      } else {
        const error = result.reason?.message ?? String(result.reason);
        feedStatus[feed.name] = { ok: false, count: 0, error };
        logger.warn(`[fundamental] flux RSS "${feed.name}" KO : ${error}`);
      }
    });

    const feedsOk = Object.values(feedStatus).filter((status) => status.ok).length;
    if (feedsOk === 0) throw new Error("aucun flux RSS disponible");

    const seenKeys = new Set();
    const deduped = [];
    for (const item of collected) {
      if (!item.title) continue;
      const dedupKey = `${item.title.toLowerCase()}|${item.link}`;
      if (seenKeys.has(dedupKey)) continue;
      seenKeys.add(dedupKey);
      deduped.push(item);
    }
    deduped.sort((a, b) => (b.date ?? 0) - (a.date ?? 0));

    return {
      items: deduped.slice(0, this.maxItems),
      feedCount: FEEDS.length,
      feedsOk,
      totalCollected: collected.length,
      kept: Math.min(deduped.length, this.maxItems),
      feeds: feedStatus,
    };
  }
}
