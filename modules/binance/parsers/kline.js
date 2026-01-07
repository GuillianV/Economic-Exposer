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
    const [time, open, high, low, close, volume, closeTime, quoteVolume, trades, takerBuyBaseVolume, takerBuyQuoteVolume, ignore] = row;

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
