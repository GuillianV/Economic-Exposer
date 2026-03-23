import { formatTimestamp } from "../../utils.js";

export function parseKlines(rows) {
  const klines = {};
  rows.forEach((row) => {
    const [time, open, high, low, close, volume, closeTime, quoteVolume, trades, takerBuyBaseVolume, takerBuyQuoteVolume, ignore] = row;

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
