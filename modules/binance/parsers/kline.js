import { formatTimestamp } from "../../utils.js";

export function parseKlineStream({ t, T, i, o, c, h, l, v, n, x, V, Q, q }) {
  return {
    time: formatTimestamp(t),
    interval: i,
    closed: x,
    data: {
      time: formatTimestamp(t),
      open: o,
      high: h,
      low: l,
      close: c,
      volume: v,
      closeTime: formatTimestamp(T),
      quoteVolume: q,
      trades: n,
      takerBuyBaseVolume: V,
      takerBuyQuoteVolume: Q,
    },
  };
}

export function parseKlines(rows) {
  const klines = {};
  rows.forEach((row) => {
    const [
      time,
      open,
      high,
      low,
      close,
      volume,
      closeTime,
      quoteVolume,
      trades,
      takerBuyBaseVolume,
      takerBuyQuoteVolume,
      ignore,
    ] = row;

    const buyerQuote = parseFloat(takerBuyQuoteVolume);
    const sellerQuote = parseFloat(quoteVolume) - buyerQuote;

    const buyersQuoteVolumePercent = buyerQuote / quoteVolume;
    const sellersQuoteVolumePercent = sellerQuote / quoteVolume;
    
    const buyersVolume = buyersQuoteVolumePercent * volume;
    const sellersVolume = sellersQuoteVolumePercent * volume;

    klines[formatTimestamp(time)] = {
      open,
      high,
      low,
      close,
      volume,
      closeTime: formatTimestamp(closeTime),
      quoteVolume,
      trades,
      takerBuyBaseVolume,
      takerBuyQuoteVolume,
      buyersQuoteVolumePercent,
      sellersQuoteVolumePercent,
      buyersVolume,
      sellersVolume,
    };
  });
  return klines;
}

export function parseKlinesSaved(klinesPromises) {
  const klines = {};

  for (const klinesPromise of klinesPromises) {
    Object.entries(klinesPromise).forEach(([time, kline]) => {
      klines[time] = kline;
    });
  }

  const newklines = {};
  Object.entries(klines)
    .sort((a, b) => {
      return a[0] - b[0];
    })
    .forEach(([time, kline]) => {
      newklines[time] = kline;
    });
  return newklines;
}

export function parseSimpleKline(klineRaw, timestamp) {

  return {
    time: formatTimestamp(timestamp),
    open: parseFloat(klineRaw.open),
    high: parseFloat(klineRaw.high),
    low: parseFloat(klineRaw.low),
    close: parseFloat(klineRaw.close),
    volume: parseFloat(klineRaw.volume),
    closeTime: klineRaw.closeTime,
    quoteVolume: parseFloat(klineRaw.quoteVolume),
    trades: parseInt(klineRaw.trades),
    takerBuyBaseVolume: parseFloat(klineRaw.takerBuyBaseVolume),
    takerBuyQuoteVolume: parseFloat(klineRaw.takerBuyQuoteVolume),
    buyersQuoteVolumePercent: parseFloat(klineRaw.buyersQuoteVolumePercent),
    sellersQuoteVolumePercent: parseFloat(klineRaw.sellersQuoteVolumePercent),
    buyersVolume: parseFloat(klineRaw.buyersVolume),
    sellersVolume: parseFloat(klineRaw.sellersVolume),

  };
}
