export function tripleStar(
  datas,
  targetEntriesArray,
  actualTick,
  intervalMilliseconds,
  trades,
) {
  const { localHighs, localLows, currentKline, secondKline, thirdKline } =
    datas;

  const thirdGreen = thirdKline.open < thirdKline.close;
  const ThirdSize = Math.abs(thirdKline.open - thirdKline.close);
  const lastGreen = secondKline.open < secondKline.close;
  const LastSize = Math.abs(secondKline.open - secondKline.close);
  const currentGreen = currentKline.open < currentKline.close;
  const CurrentSize = Math.abs(currentKline.open - currentKline.close);

  const localLow = localLows[thirdKline.time - intervalMilliseconds];
  const localHigh = localHighs[thirdKline.time - intervalMilliseconds];
  // Un seul trade ouvert autorisé
  if (trades.some((t) => !t.triggered)) return null;

  // === Signal Short (résistance cassée à la baisse) ===
  if (
    localLow &&
    thirdGreen &&
    lastGreen &&
    currentGreen &&
    LastSize > ThirdSize &&
    CurrentSize > LastSize
  ) {
    return {
      startTick: actualTick + intervalMilliseconds,
      startPrice: currentKline.close,
      options: {
        stopLoss: localLow.value - currentKline.close - 20,
        lot: 0.8,
      },
    };
  }

  // === Signal Long (support cassé à la hausse) ===
  if (
    localHigh &&
    !thirdGreen &&
    !lastGreen &&
    !currentGreen &&
    LastSize > ThirdSize &&
    CurrentSize > LastSize
  ) {
    return {
      startTick: actualTick + intervalMilliseconds,
      startPrice: currentKline.close,
      options: {
        stopLoss: localHigh.value - currentKline.close + 20,
        lot: 0.8,
      },
    };
  }

  return null;
}
