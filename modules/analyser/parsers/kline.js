
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
