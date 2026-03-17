export function tripleStar(
  datas,
  targetEntriesArray,
  actualTick,
  intervalMilliseconds,
  trades,
) {
  const { currentKline, secondKline, thirdKline } = datas;

  const thirdGreen = thirdKline.open < thirdKline.close;
  const ThirdSize = Math.abs(thirdKline.open - thirdKline.close);
  const lastGreen = secondKline.open < secondKline.close;
  const LastSize = Math.abs(secondKline.open - secondKline.close);
  const currentGreen = currentKline.open < currentKline.close;
  const CurrentSize = Math.abs(currentKline.open - currentKline.close);

  // Un seul trade ouvert autorisé
  if (trades.some((t) => !t.triggered)) return null;

  // === Signal Short (résistance cassée à la baisse) ===
  if (
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
        stopLoss: thirdKline.open - currentKline.close - 20,
        lot: 0.8,
      },
    };
  }

  // === Signal Long (support cassé à la hausse) ===
  if (
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
        stopLoss: thirdKline.open - currentKline.close + 20,
        lot: 0.8,
      },
    };
  }

  return null;
}
