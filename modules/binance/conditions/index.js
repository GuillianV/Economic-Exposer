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

export function zonesRessist(
  datas,
  targetEntriesArray,
  actualTick,
  intervalMilliseconds,
  trades,
) {
  const {
    currentKline,
    secondKline,
    thirdKline,
    s_r_zones, // ← on utilise directement le tableau historique que tu as dans Analyser
  } = datas;

  // On ne déclenche pas de nouvel ordre si un trade est encore en attente de trigger
  if (trades.some((t) => !t.triggered)) return null;

  // ===================== CONDITION : BREAKOUT HAUSSIER SUR RÉSISTANCE =====================
  // On détecte la résistance qui vient d’être cassée CE TICK (endTime = now)
  // + confirmation par clôture au-dessus (évite les faux breakouts sur wick)
  const brokenResistance = s_r_zones.find(
    (zone) =>
      zone.type === "resistance" &&
      zone.endTime === currentKline.time &&
      currentKline.close > zone.price,
  );
 
  if (brokenResistance) {
   
    return {
      startTick: actualTick + intervalMilliseconds,
      startPrice: currentKline.close, // entrée au marché au prochain tick
      options: {
        // Stop-loss juste sous la résistance cassée (avec un petit buffer dynamique)
        // On utilise la taille du mouvement de cassure pour adapter le stop
        stopLoss: (brokenResistance.price - currentKline.high) ,

        // Tu peux ajuster le lot ici (ou le laisser au MoneyManager)
        lot: 0.8,

        // Optionnel : tu peux ajouter takeProfit ou trailing dans tes stratégies
        // takeProfit: brokenResistance.price + (currentKline.close - brokenResistance.price) * 3,
      },
    };
  }

  return null;
}
