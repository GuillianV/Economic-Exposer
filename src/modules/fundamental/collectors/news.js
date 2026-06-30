import Parser from "rss-parser";
import { Collector } from "./base.js";
import { logger } from "../../logs/index.js";

/**
 * Agrégateur de news (Tier 3) — flux RSS/Atom crypto + macro.
 * Sans clé, gratuit. Axe : news.
 *
 * Chaque flux est tolérant : un flux KO n'empêche pas les autres.
 * Le collecteur n'échoue que si AUCUN flux ne répond.
 * Sortie : items normalisés { source, category, title, link, date },
 * dédupliqués (titre+lien) et triés du plus récent au plus ancien.
 *
 * Le bruit/biais des sources (ex. ZeroHedge bearish) est volontairement
 * conservé : c'est l'IA (phase C) qui en tirera le sentiment.
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

  async #fetchFeed(feed) {
    const parsed = await this.parser.parseURL(feed.url);
    return (parsed.items || []).map((it) => {
      const rawDate = it.isoDate || it.pubDate || null;
      const date = rawDate ? new Date(rawDate).getTime() : null;
      return {
        source: feed.name,
        category: feed.category,
        title: (it.title || "").trim(),
        link: it.link || it.guid || "",
        date: Number.isFinite(date) ? date : null,
      };
    });
  }

  async fetchData() {
    const feedStatus = {};
    const all = [];

    const results = await Promise.allSettled(FEEDS.map((f) => this.#fetchFeed(f)));
    results.forEach((r, i) => {
      const f = FEEDS[i];
      if (r.status === "fulfilled") {
        feedStatus[f.name] = { ok: true, count: r.value.length };
        all.push(...r.value);
      } else {
        const error = r.reason?.message ?? String(r.reason);
        feedStatus[f.name] = { ok: false, count: 0, error };
        logger.warn(`[fundamental] flux RSS "${f.name}" KO : ${error}`);
      }
    });

    const okFeeds = Object.values(feedStatus).filter((s) => s.ok).length;
    if (okFeeds === 0) throw new Error("aucun flux RSS disponible");

    // Déduplication (titre normalisé + lien) puis tri récent -> ancien.
    const seen = new Set();
    const deduped = [];
    for (const item of all) {
      if (!item.title) continue;
      const key = `${item.title.toLowerCase()}|${item.link}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
    }
    deduped.sort((a, b) => (b.date ?? 0) - (a.date ?? 0));

    return {
      items: deduped.slice(0, this.maxItems),
      feedCount: FEEDS.length,
      feedsOk: okFeeds,
      totalCollected: all.length,
      kept: Math.min(deduped.length, this.maxItems),
      feeds: feedStatus,
    };
  }
}
